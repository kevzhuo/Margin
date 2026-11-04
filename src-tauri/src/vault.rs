//! Vault storage commands.
//!
//! Contract (mirrored in `src/backend/tauri.ts`):
//!
//! ```text
//! list_tree(root)            -> FileNode[]
//! read_note(path)            -> string
//! write_note(path, content)  -> void       (atomic: temp file + rename)
//! create_note(dir, name)     -> string     (new absolute path)
//! create_folder(dir, name)   -> string     (new absolute path)
//! search_vault(query, limit) -> SearchHit[]
//! rename_path(from, to)      -> void
//! delete_path(path)          -> void       (moves to the system trash)
//! watch_vault(root)          -> void       (emits "vault://changed")
//! unwatch_vault()            -> void
//! ```
//!
//! Every path argument must resolve to a location inside the current vault
//! root (set by `list_tree` or `watch_vault`); anything else is rejected.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// How long after our own write we ignore watcher events for that path.
const SUPPRESS_WINDOW: Duration = Duration::from_millis(1500);
/// How long the watcher thread waits for more events before emitting a batch.
const COALESCE_WINDOW: Duration = Duration::from_millis(200);
/// Name of the event delivered to the frontend.
pub const CHANGED_EVENT: &str = "vault://changed";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    /// 1-based line number.
    pub line: usize,
    pub text: String,
}

/// Longest line text returned in a search hit, in characters.
const SEARCH_LINE_MAX: usize = 240;
/// Matches reported per note before moving on to the next one.
const SEARCH_HITS_PER_FILE: usize = 5;
/// Notes larger than this are skipped by search.
const SEARCH_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct WatchEvent {
    pub kind: &'static str,
    pub paths: Vec<String>,
}

type RecentWrites = Arc<Mutex<HashMap<PathBuf, Instant>>>;

struct WatcherHandle {
    /// Dropping the watcher closes its channel, which ends the worker thread.
    _watcher: RecommendedWatcher,
}

#[derive(Default)]
pub struct VaultState {
    /// Canonical path of the current vault root.
    root: Mutex<Option<PathBuf>>,
    recent_writes: RecentWrites,
    watcher: Mutex<Option<WatcherHandle>>,
}

// ---------------------------------------------------------------------------
// Path helpers

fn io_err<E: std::fmt::Display>(context: &str, e: E) -> String {
    format!("{context}: {e}")
}

/// Strip the `\\?\` verbatim prefix Windows canonicalization adds, so the
/// paths we hand back look like the ones the user picked.
fn display_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC") {
                return rest.to_string();
            }
        }
    }
    s.into_owned()
}

/// Canonical form of a path that may not exist yet: canonicalize the longest
/// existing ancestor and re-append the rest.
fn canonical_lenient(path: &Path) -> Result<PathBuf, String> {
    if let Ok(c) = path.canonicalize() {
        return Ok(c);
    }
    let mut existing = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if existing.exists() {
            break;
        }
        match existing.file_name() {
            Some(name) => {
                tail.push(name.to_os_string());
                if !existing.pop() {
                    return Err(format!("Path does not exist: {}", path.display()));
                }
            }
            None => return Err(format!("Path does not exist: {}", path.display())),
        }
    }
    let mut out = existing
        .canonicalize()
        .map_err(|e| io_err("Could not resolve path", e))?;
    for part in tail.iter().rev() {
        out.push(part);
    }
    Ok(out)
}

fn has_dotdot(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir))
}

impl VaultState {
    fn set_root(&self, root: &Path) -> Result<PathBuf, String> {
        let canonical = root
            .canonicalize()
            .map_err(|e| io_err("Could not open vault folder", e))?;
        if !canonical.is_dir() {
            return Err(format!("Not a folder: {}", root.display()));
        }
        *self.root.lock().unwrap() = Some(canonical.clone());
        Ok(canonical)
    }

    /// Resolve `path` and make sure it is inside the current vault root.
    fn resolve(&self, path: &str) -> Result<PathBuf, String> {
        let root = self
            .root
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "No vault is open".to_string())?;
        let raw = Path::new(path);
        if has_dotdot(raw) {
            return Err("Path may not contain '..'".to_string());
        }
        let resolved = canonical_lenient(raw)?;
        if !resolved.starts_with(&root) {
            return Err(format!("Path is outside the vault: {}", path));
        }
        Ok(resolved)
    }

    fn note_written(&self, path: &Path) {
        let mut map = self.recent_writes.lock().unwrap();
        let now = Instant::now();
        map.retain(|_, t| now.duration_since(*t) < SUPPRESS_WINDOW);
        map.insert(path.to_path_buf(), now);
    }
}

// ---------------------------------------------------------------------------
// Pure operations (unit tested)

fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// Case-insensitive natural ordering: "Note 2" sorts before "Note 10".
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let a = a.to_lowercase();
    let b = b.to_lowercase();
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let mut na = String::new();
                    while let Some(c) = ai.peek().copied() {
                        if c.is_ascii_digit() {
                            na.push(c);
                            ai.next();
                        } else {
                            break;
                        }
                    }
                    let mut nb = String::new();
                    while let Some(c) = bi.peek().copied() {
                        if c.is_ascii_digit() {
                            nb.push(c);
                            bi.next();
                        } else {
                            break;
                        }
                    }
                    let va: u128 = na.parse().unwrap_or(0);
                    let vb: u128 = nb.parse().unwrap_or(0);
                    match va.cmp(&vb).then(na.len().cmp(&nb.len())) {
                        Ordering::Equal => continue,
                        other => return other,
                    }
                } else {
                    match ca.cmp(&cb) {
                        Ordering::Equal => {
                            ai.next();
                            bi.next();
                        }
                        other => return other,
                    }
                }
            }
        }
    }
}

fn sort_nodes(nodes: &mut [FileNode]) {
    nodes.sort_by(|a, b| match (a.kind, b.kind) {
        ("dir", "file") => Ordering::Less,
        ("file", "dir") => Ordering::Greater,
        _ => natural_cmp(&a.name, &b.name),
    });
}

/// Recursively list a folder: directories and Markdown files only, hidden
/// entries and `node_modules` skipped, directories first, natural order.
pub fn list_tree_at(dir: &Path) -> Result<Vec<FileNode>, String> {
    let entries = fs::read_dir(dir).map_err(|e| io_err("Could not read folder", e))?;
    let mut nodes = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| io_err("Could not read folder entry", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden_name(&name) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|e| io_err("Could not read file type", e))?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            let children = list_tree_at(&path)?;
            nodes.push(FileNode {
                name,
                path: display_path(&path),
                kind: "dir",
                children: Some(children),
            });
        } else if file_type.is_file() && is_markdown(&name) {
            nodes.push(FileNode {
                name,
                path: display_path(&path),
                kind: "file",
                children: None,
            });
        }
    }
    sort_nodes(&mut nodes);
    Ok(nodes)
}

/// Write `content` to `path` by writing a sibling temp file and renaming it
/// over the target, so a crash never leaves a half-written note.
pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("Invalid path: {}", path.display()))?;
    if !dir.is_dir() {
        return Err(format!("Folder does not exist: {}", dir.display()));
    }
    let stem = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note".to_string());
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{stem}.{}.{nonce}.tmp", std::process::id()));
    {
        let mut file =
            fs::File::create(&tmp).map_err(|e| io_err("Could not create temp file", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| io_err("Could not write note", e))?;
        file.sync_all()
            .map_err(|e| io_err("Could not flush note", e))?;
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(io_err("Could not replace note", e));
    }
    Ok(())
}

/// Create `<dir>/<name>.md`, de-duplicating as `<name> 2.md`, `<name> 3.md`, ...
pub fn create_note_in(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !dir.is_dir() {
        return Err(format!("Folder does not exist: {}", dir.display()));
    }
    let base = name
        .trim()
        .trim_end_matches(".md")
        .trim_end_matches(".MD")
        .replace(['/', '\\'], "-");
    let base = if base.is_empty() {
        "Untitled".to_string()
    } else {
        base
    };
    let mut candidate = dir.join(format!("{base}.md"));
    let mut i = 2u32;
    while candidate.exists() {
        candidate = dir.join(format!("{base} {i}.md"));
        i += 1;
        if i > 10_000 {
            return Err("Too many notes with that name".to_string());
        }
    }
    let title = candidate
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or(base);
    write_atomic(&candidate, &format!("# {title}\n\n"))?;
    Ok(candidate)
}

/// Create `<dir>/<name>`, de-duplicating as `<name> 2`, `<name> 3`, ...
pub fn create_folder_in(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !dir.is_dir() {
        return Err(format!("Folder does not exist: {}", dir.display()));
    }
    let base = name.trim().replace(['/', '\\'], "-");
    let base = if base.is_empty() || base == "." || base == ".." {
        "New folder".to_string()
    } else {
        base
    };
    let mut candidate = dir.join(&base);
    let mut i = 2u32;
    while candidate.exists() {
        candidate = dir.join(format!("{base} {i}"));
        i += 1;
        if i > 10_000 {
            return Err("Too many folders with that name".to_string());
        }
    }
    fs::create_dir(&candidate).map_err(|e| io_err("Could not create folder", e))?;
    Ok(candidate)
}

fn collect_files(nodes: &[FileNode], out: &mut Vec<String>) {
    for n in nodes {
        match &n.children {
            Some(children) => collect_files(children, out),
            None => out.push(n.path.clone()),
        }
    }
}

/// Case-insensitive substring search over every note under `root`, in the
/// same order the sidebar lists them.
pub fn search_dir(root: &Path, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_files(&list_tree_at(root)?, &mut files);
    let mut hits = Vec::new();
    for path in files {
        let too_big = fs::metadata(&path)
            .map(|m| m.len() > SEARCH_MAX_FILE_BYTES)
            .unwrap_or(true);
        if too_big {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let mut per_file = 0;
        for (i, line) in content.lines().enumerate() {
            if !line.to_lowercase().contains(&needle) {
                continue;
            }
            hits.push(SearchHit {
                path: path.clone(),
                line: i + 1,
                text: line.trim().chars().take(SEARCH_LINE_MAX).collect(),
            });
            if hits.len() >= limit {
                return Ok(hits);
            }
            per_file += 1;
            if per_file >= SEARCH_HITS_PER_FILE {
                break;
            }
        }
    }
    Ok(hits)
}

/// Rename or move; refuses to overwrite an existing destination.
pub fn rename_checked(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Err(format!("Does not exist: {}", from.display()));
    }
    if to != from && to.starts_with(from) {
        return Err("Cannot move a folder into itself".to_string());
    }
    if to.exists() {
        return Err(format!("Already exists: {}", to.display()));
    }
    if let Some(parent) = to.parent() {
        if !parent.is_dir() {
            return Err(format!("Folder does not exist: {}", parent.display()));
        }
    }
    fs::rename(from, to).map_err(|e| io_err("Could not rename", e))
}

// ---------------------------------------------------------------------------
// Watcher

fn kind_label(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(ModifyKind::Name(_)) => Some("rename"),
        EventKind::Modify(_) => Some("modify"),
        EventKind::Remove(_) => Some("remove"),
        EventKind::Access(_) => None,
        EventKind::Any | EventKind::Other => Some("any"),
    }
}

/// Should the frontend hear about this path at all?
fn watch_path_relevant(root: &Path, path: &Path) -> bool {
    let rel = match path.strip_prefix(root) {
        Ok(r) => r,
        Err(_) => path,
    };
    for comp in rel.components() {
        if let Component::Normal(os) = comp {
            let name = os.to_string_lossy();
            if is_hidden_name(&name) || name.ends_with(".tmp") {
                return false;
            }
        }
    }
    // Directories and Markdown files only. A removed path no longer exists,
    // so judge by name when we cannot stat it.
    match path.file_name().map(|n| n.to_string_lossy().into_owned()) {
        Some(name) => {
            path.is_dir() || is_markdown(&name) || (!path.exists() && !name.contains('.'))
        }
        None => false,
    }
}

fn recently_written(recent: &RecentWrites, path: &Path) -> bool {
    let map = recent.lock().unwrap();
    match map.get(path) {
        Some(t) => t.elapsed() < SUPPRESS_WINDOW,
        None => false,
    }
}

/// Turn a burst of notify events into the compact events we emit.
fn coalesce(root: &Path, recent: &RecentWrites, events: Vec<notify::Event>) -> Vec<WatchEvent> {
    let mut out: Vec<WatchEvent> = Vec::new();
    for ev in events {
        let Some(kind) = kind_label(&ev.kind) else {
            continue;
        };
        let mut paths: Vec<String> = Vec::new();
        for p in ev.paths {
            let canonical = p.canonicalize().unwrap_or(p.clone());
            if !watch_path_relevant(root, &canonical) {
                continue;
            }
            if recently_written(recent, &canonical) {
                continue;
            }
            let s = display_path(&canonical);
            if !paths.contains(&s) {
                paths.push(s);
            }
        }
        if paths.is_empty() {
            continue;
        }
        if let Some(existing) = out.iter_mut().find(|e| e.kind == kind) {
            for p in paths {
                if !existing.paths.contains(&p) {
                    existing.paths.push(p);
                }
            }
        } else {
            out.push(WatchEvent { kind, paths });
        }
    }
    out
}

fn start_watcher(
    app: AppHandle,
    root: PathBuf,
    recent: RecentWrites,
) -> Result<WatcherHandle, String> {
    let (tx, rx) = mpsc::channel::<notify::Event>();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        notify::Config::default(),
    )
    .map_err(|e| io_err("Could not start file watcher", e))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| io_err("Could not watch vault folder", e))?;

    thread::Builder::new()
        .name("margin-vault-watcher".into())
        .spawn(move || {
            // `recv` fails once the watcher (and its sender) is dropped.
            while let Ok(first) = rx.recv() {
                let mut batch = vec![first];
                let deadline = Instant::now() + COALESCE_WINDOW;
                loop {
                    let now = Instant::now();
                    if now >= deadline {
                        break;
                    }
                    match rx.recv_timeout(deadline - now) {
                        Ok(ev) => batch.push(ev),
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
                for event in coalesce(&root, &recent, batch) {
                    let _ = app.emit(CHANGED_EVENT, event);
                }
            }
        })
        .map_err(|e| io_err("Could not start watcher thread", e))?;

    Ok(WatcherHandle { _watcher: watcher })
}

// ---------------------------------------------------------------------------
// Commands

#[tauri::command]
pub fn list_tree(root: String, state: State<'_, VaultState>) -> Result<Vec<FileNode>, String> {
    let canonical = state.set_root(Path::new(&root))?;
    list_tree_at(&canonical)
}

#[tauri::command]
pub fn read_note(path: String, state: State<'_, VaultState>) -> Result<String, String> {
    let resolved = state.resolve(&path)?;
    fs::read_to_string(&resolved).map_err(|e| io_err("Could not read note", e))
}

#[tauri::command]
pub fn write_note(
    path: String,
    content: String,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    let resolved = state.resolve(&path)?;
    if resolved.is_dir() {
        return Err("Cannot write a folder".to_string());
    }
    state.note_written(&resolved);
    write_atomic(&resolved, &content)
}

#[tauri::command]
pub fn create_note(
    dir: String,
    name: String,
    state: State<'_, VaultState>,
) -> Result<String, String> {
    let resolved = state.resolve(&dir)?;
    let created = create_note_in(&resolved, &name)?;
    state.note_written(&created);
    Ok(display_path(&created))
}

#[tauri::command]
pub fn create_folder(
    dir: String,
    name: String,
    state: State<'_, VaultState>,
) -> Result<String, String> {
    let resolved = state.resolve(&dir)?;
    let created = create_folder_in(&resolved, &name)?;
    Ok(display_path(&created))
}

#[tauri::command]
pub fn search_vault(
    query: String,
    limit: Option<usize>,
    state: State<'_, VaultState>,
) -> Result<Vec<SearchHit>, String> {
    let root = state
        .root
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No vault is open".to_string())?;
    search_dir(&root, &query, limit.unwrap_or(100).min(1000))
}

#[tauri::command]
pub fn rename_path(from: String, to: String, state: State<'_, VaultState>) -> Result<(), String> {
    let from_resolved = state.resolve(&from)?;
    let to_resolved = state.resolve(&to)?;
    rename_checked(&from_resolved, &to_resolved)
}

#[tauri::command]
pub fn delete_path(path: String, state: State<'_, VaultState>) -> Result<(), String> {
    let resolved = state.resolve(&path)?;
    let root = state.root.lock().unwrap().clone();
    if root.as_deref() == Some(resolved.as_path()) {
        return Err("Refusing to delete the vault root".to_string());
    }
    trash::delete(&resolved).map_err(|e| io_err("Could not move to trash", e))
}

#[tauri::command]
pub fn watch_vault(
    root: String,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    let canonical = state.set_root(Path::new(&root))?;
    let handle = start_watcher(app, canonical, state.recent_writes.clone())?;
    *state.watcher.lock().unwrap() = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn unwatch_vault(state: State<'_, VaultState>) -> Result<(), String> {
    *state.watcher.lock().unwrap() = None;
    Ok(())
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn names(nodes: &[FileNode]) -> Vec<String> {
        nodes.iter().map(|n| n.name.clone()).collect()
    }

    #[test]
    fn lists_markdown_files_and_dirs_in_natural_order() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("Projects")).unwrap();
        fs::create_dir(root.join(".obsidian")).unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join("Projects/Note 10.md"), "ten").unwrap();
        fs::write(root.join("Projects/Note 2.md"), "two").unwrap();
        fs::write(root.join("Projects/image.png"), "x").unwrap();
        fs::write(root.join("Inbox.md"), "inbox").unwrap();
        fs::write(root.join("alpha.markdown"), "a").unwrap();
        fs::write(root.join(".hidden.md"), "h").unwrap();

        let tree = list_tree_at(root).unwrap();
        assert_eq!(names(&tree), vec!["Projects", "alpha.markdown", "Inbox.md"]);
        let projects = &tree[0];
        assert_eq!(projects.kind, "dir");
        assert_eq!(
            names(projects.children.as_ref().unwrap()),
            vec!["Note 2.md", "Note 10.md"]
        );
        for n in &tree {
            assert!(Path::new(&n.path).is_absolute());
        }
    }

    #[test]
    fn create_folder_dedupes_names() {
        let tmp = tempdir().unwrap();
        let a = create_folder_in(tmp.path(), "Ideas").unwrap();
        let b = create_folder_in(tmp.path(), "Ideas").unwrap();
        let c = create_folder_in(tmp.path(), "  ").unwrap();
        let d = create_folder_in(tmp.path(), "a/b").unwrap();
        assert!(a.is_dir() && b.is_dir() && c.is_dir() && d.is_dir());
        assert_eq!(a.file_name().unwrap(), "Ideas");
        assert_eq!(b.file_name().unwrap(), "Ideas 2");
        assert_eq!(c.file_name().unwrap(), "New folder");
        assert_eq!(d.file_name().unwrap(), "a-b");
        // Empty folders show up in the tree.
        let tree = list_tree_at(tmp.path()).unwrap();
        assert_eq!(tree.len(), 4);
    }

    #[test]
    fn search_finds_lines_case_insensitively_in_tree_order() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("B")).unwrap();
        fs::write(root.join("a.md"), "# Alpha\nnothing here\nTypora is nice").unwrap();
        fs::write(
            root.join("B/c.md"),
            "typora again\n\n  indented TYPORA line  ",
        )
        .unwrap();
        fs::write(root.join("B/skip.txt"), "typora in a text file").unwrap();
        fs::write(root.join(".hidden.md"), "typora hidden").unwrap();

        let hits = search_dir(root, "Typora", 100).unwrap();
        let summary: Vec<(String, usize, String)> = hits
            .iter()
            .map(|h| {
                (
                    Path::new(&h.path)
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    h.line,
                    h.text.clone(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("c.md".to_string(), 1, "typora again".to_string()),
                ("c.md".to_string(), 3, "indented TYPORA line".to_string()),
                ("a.md".to_string(), 3, "Typora is nice".to_string()),
            ]
        );
        assert_eq!(search_dir(root, "typora", 2).unwrap().len(), 2);
        assert!(search_dir(root, "   ", 10).unwrap().is_empty());
    }

    #[test]
    fn rename_refuses_to_move_a_folder_into_itself() {
        let tmp = tempdir().unwrap();
        let dir = create_folder_in(tmp.path(), "Outer").unwrap();
        let err = rename_checked(&dir, &dir.join("Inner")).unwrap_err();
        assert!(err.contains("into itself"), "{err}");
    }

    #[test]
    fn create_note_dedupes_names() {
        let tmp = tempdir().unwrap();
        let a = create_note_in(tmp.path(), "Untitled").unwrap();
        let b = create_note_in(tmp.path(), "Untitled").unwrap();
        let c = create_note_in(tmp.path(), "Untitled.md").unwrap();
        assert_eq!(a.file_name().unwrap(), "Untitled.md");
        assert_eq!(b.file_name().unwrap(), "Untitled 2.md");
        assert_eq!(c.file_name().unwrap(), "Untitled 3.md");
        assert_eq!(fs::read_to_string(&b).unwrap(), "# Untitled 2\n\n");
        let empty = create_note_in(tmp.path(), "   ").unwrap();
        assert_eq!(empty.file_name().unwrap(), "Untitled 4.md");
    }

    #[test]
    fn write_atomic_replaces_content_and_leaves_no_temp_files() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("note.md");
        write_atomic(&path, "first").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");
        write_atomic(&path, "second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        let leftovers: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
        assert!(write_atomic(&tmp.path().join("missing/note.md"), "x").is_err());
    }

    #[test]
    fn rename_refuses_to_overwrite() {
        let tmp = tempdir().unwrap();
        let a = tmp.path().join("a.md");
        let b = tmp.path().join("b.md");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        assert!(rename_checked(&a, &b).is_err());
        let c = tmp.path().join("c.md");
        rename_checked(&a, &c).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read_to_string(&c).unwrap(), "a");
        assert!(rename_checked(&tmp.path().join("nope.md"), &tmp.path().join("x.md")).is_err());
    }

    #[test]
    fn state_rejects_paths_outside_root() {
        let tmp = tempdir().unwrap();
        let vault = tmp.path().join("vault");
        let other = tmp.path().join("other");
        fs::create_dir_all(&vault).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("secret.md"), "s").unwrap();
        fs::write(vault.join("note.md"), "n").unwrap();

        let state = VaultState::default();
        assert!(
            state
                .resolve(vault.join("note.md").to_str().unwrap())
                .is_err(),
            "no root yet"
        );
        state.set_root(&vault).unwrap();
        assert!(state
            .resolve(vault.join("note.md").to_str().unwrap())
            .is_ok());
        assert!(
            state
                .resolve(vault.join("new.md").to_str().unwrap())
                .is_ok(),
            "new files inside root are fine"
        );
        assert!(state
            .resolve(other.join("secret.md").to_str().unwrap())
            .is_err());
        assert!(state
            .resolve(vault.join("../other/secret.md").to_str().unwrap())
            .is_err());
    }

    #[test]
    fn coalesce_filters_temp_hidden_and_recent_writes() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let note = root.join("note.md");
        let other = root.join("other.md");
        let temp = root.join(".note.md.123.tmp");
        let hidden = root.join(".git").join("x.md");
        fs::write(&note, "n").unwrap();
        fs::write(&other, "o").unwrap();
        fs::write(&temp, "t").unwrap();
        fs::create_dir_all(hidden.parent().unwrap()).unwrap();
        fs::write(&hidden, "h").unwrap();

        let recent: RecentWrites = Arc::new(Mutex::new(HashMap::new()));
        recent.lock().unwrap().insert(note.clone(), Instant::now());

        let mk = |kind: EventKind, paths: Vec<PathBuf>| {
            let mut e = notify::Event::new(kind);
            e.paths = paths;
            e
        };
        let events = vec![
            mk(
                EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
                vec![note.clone()],
            ),
            mk(
                EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
                vec![other.clone()],
            ),
            mk(
                EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any)),
                vec![other.clone()],
            ),
            mk(
                EventKind::Create(notify::event::CreateKind::File),
                vec![temp.clone()],
            ),
            mk(
                EventKind::Create(notify::event::CreateKind::File),
                vec![hidden.clone()],
            ),
            mk(
                EventKind::Access(notify::event::AccessKind::Any),
                vec![other.clone()],
            ),
        ];
        let out = coalesce(&root, &recent, events);
        assert_eq!(
            out,
            vec![WatchEvent {
                kind: "modify",
                paths: vec![display_path(&other)]
            }]
        );
    }

    #[test]
    fn natural_order_is_case_insensitive() {
        let mut v = vec!["b.md", "A.md", "a10.md", "a2.md"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["A.md", "a2.md", "a10.md", "b.md"]);
    }
}
