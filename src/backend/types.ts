/**
 * The vault backend is the only thing that touches storage.
 *
 * Two implementations exist:
 *  - `TauriBackend`  talks to the Rust side over `invoke` and is used in the
 *    desktop app.
 *  - `MemoryBackend` keeps a demo vault in memory (persisted to localStorage)
 *    and is used when the UI runs in a plain browser, which is how the
 *    Playwright suite exercises the editor.
 */

export interface FileNode {
  /** Display name, including the `.md` extension for files. */
  name: string;
  /** Absolute path (Tauri) or a virtual absolute path (memory). */
  path: string;
  kind: "file" | "dir";
  children?: FileNode[];
}

export type WatchEventKind = "create" | "modify" | "remove" | "rename" | "any";

export interface WatchEvent {
  kind: WatchEventKind;
  paths: string[];
}

/** One line of a note that matched a full-text search. */
export interface SearchHit {
  path: string;
  /** 1-based line number. */
  line: number;
  /** The matching line, trimmed to a readable length. */
  text: string;
}

export interface VaultBackend {
  readonly kind: "tauri" | "memory";

  /**
   * Ask the user for a vault folder. Resolves to the chosen root, or null if
   * they cancelled. The memory backend returns its demo root immediately.
   */
  pickVault(): Promise<string | null>;

  /** Recursively list the vault. Hidden entries and non-Markdown files are omitted. */
  listTree(root: string): Promise<FileNode[]>;

  readNote(path: string): Promise<string>;

  /** Writes atomically (temp file + rename) on the Tauri side. */
  writeNote(path: string, content: string): Promise<void>;

  /** Create `<dir>/<name>.md`, de-duplicating the name. Resolves to the new path. */
  createNote(dir: string, name: string): Promise<string>;

  /** Create `<dir>/<name>`, de-duplicating the name. Resolves to the new path. */
  createFolder(dir: string, name: string): Promise<string>;

  /** Case-insensitive full-text search over every note in the vault. */
  searchVault(root: string, query: string, limit?: number): Promise<SearchHit[]>;

  /** Show a file or folder in the system file manager. Desktop only. */
  revealPath?(path: string): Promise<void>;

  renamePath(from: string, to: string): Promise<void>;

  /** Moves to the system trash on the Tauri side. */
  deletePath(path: string): Promise<void>;

  /**
   * Watch the vault for external changes. Resolves to an unsubscribe function.
   * The memory backend never emits.
   */
  watch(root: string, onEvent: (event: WatchEvent) => void): Promise<() => void>;

  /** Resolve a relative image path in a note to something an <img> can load. */
  resolveAsset(notePath: string, src: string): string;

  openExternal(url: string): Promise<void>;
}

export const PATH_SEP = "/";

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i <= 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? path : path.slice(i + 1);
}

export function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/** Depth-first flatten of a tree, files only. */
export function flattenFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.kind === "file") out.push(n);
      else if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** True when `path` is `dir` itself or lives somewhere below it. */
export function isWithin(path: string, dir: string): boolean {
  if (path === dir) return true;
  return path.startsWith(dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + "/") || path.startsWith(dir + "\\");
}

/**
 * Resolve a relative link (as written in a note) against the note's folder.
 * Handles `./`, `../`, URL-encoded characters and Windows separators.
 * Returns null for links that are not relative paths (URLs, anchors, absolute paths).
 */
export function resolveRelative(fromDir: string, href: string): string | null {
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("\\")) return null;
  let rel = href.split("#")[0].split("?")[0];
  try {
    rel = decodeURIComponent(rel);
  } catch {
    // keep the raw text
  }
  if (!rel) return null;
  const sep = fromDir.includes("\\") && !fromDir.includes("/") ? "\\" : "/";
  const parts = fromDir.split(/[\\/]/);
  const lead = fromDir.startsWith("/") ? "/" : "";
  const stack = parts.filter((p, i) => p !== "" || i === 0);
  if (lead && stack[0] === "") stack.shift();
  for (const piece of rel.split(/[\\/]/)) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") {
      if (stack.length) stack.pop();
      continue;
    }
    stack.push(piece);
  }
  return lead + stack.join(sep);
}

/** GitHub-style heading slug, used for `[text](#heading)` links. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/** Case-insensitive search of `query` in `text`; returns [start, end) or null. */
export function findMatch(text: string, query: string): [number, number] | null {
  if (!query) return null;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  return i < 0 ? null : [i, i + query.length];
}

export const SEARCH_LINE_MAX = 240;
