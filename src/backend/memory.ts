import { sanitizeFileName } from "../state/attachments";
import {
  assetPath,
  basename,
  dirname,
  flattenFiles,
  headingText,
  isMarkdown,
  isWithin,
  joinPath,
  SEARCH_LINE_MAX,
  type FileNode,
  type ImageFile,
  type SearchHit,
  type VaultBackend,
  type WatchEvent,
} from "./types";

export const DEMO_ROOT = "/Demo Vault";
const STORAGE_KEY = "margin.demoVault.v1";

const DESIGN_NOTES = `# Editor design notes

The editor should feel like **Typora**: one pane, no preview toggle, and the *syntax only shows where you are typing*. Everything else reads like a finished page.

## Principles

- Files on disk are the source of truth, never a database export.
- Nothing moves when you click into a line. Headings keep their size whether the \`#\` is visible or not.
- Chrome stays out of the way. Formatting lives in shortcuts, a \`/\` menu and a bubble toolbar over selected text.

## Open questions

- [x] Pick the editor engine (CodeMirror 6 and Lezer)
- [ ] Decide how a table is edited while the caret is inside it
- [ ] Test IME composition on WKWebView before committing to Tauri

> A good tool is one you forget you are using. The comparison of engines lives in [the research notes](https://github.com/kevzhuo/Margin/blob/main/docs/research.md).

## Decoration plan

\`\`\`ts
const HIDE = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "LinkMark"]);

// Delimiters become empty replace decorations unless the
// selection touches the element they belong to.
if (!touches(parent.from, parent.to)) {
  ranges.push(Decoration.replace({}).range(node.from, node.to));
}
\`\`\`

| Node | Reveals when | Widget |
| --- | --- | --- |
| Heading | caret on the line | none, line class only |
| Emphasis, code, link | caret inside the element | none |
| Task item | caret on the line | checkbox |
| Table | caret inside the table | cell editor |

---

Type \`/\` on an empty line to insert a block.
`;

const ROADMAP = `# Roadmap

## Now

1. Live preview for every CommonMark and GFM construct
2. Vault sidebar with create, rename and delete
3. Autosave with atomic writes

## Next

- Quick switcher and full-text search
- Wiki links and backlinks
- Math blocks rendered with KaTeX
- Export to HTML and PDF

## Later

- Mobile companion
- Plugin API
`;

const TAURI_VS_ELECTRON = `# Tauri vs Electron

Tauri wins on size and on the native feel of the window chrome. Electron wins on consistency: one rendering engine on every platform and a plugin ecosystem that can \`require\` Node modules.

| | Tauri 2 | Electron |
| --- | --- | --- |
| Installer | 3 to 10 MB | 85 to 250 MB |
| Webview | system | bundled Chromium |
| Backend | Rust | Node.js |

**Decision:** Tauri, because the app should feel like it belongs on a Mac. We test IME and scrolling on WKWebView early.
`;

const JOURNAL_1 = `# 2026-11-04

Spent the morning on the decoration layer. The trick that made everything click: block markers live in the left margin instead of pushing the text around.

- [x] Heading reveal with stable layout
- [x] Bullets that keep their width
- [ ] Table widget

Tomorrow: the slash menu.
`;

const JOURNAL_2 = `# 2026-11-03

Read through the Obsidian forum threads on Live Preview. The consensus is that the hard part is not hiding syntax, it is keeping lines from jumping when you click into them.

Quote of the day:

> Make it work, make it right, make it fast.
`;

const READING = `# Reading list

- *The Elements of Typographic Style*, Robert Bringhurst
- *Designing Interfaces*, Jenifer Tidwell
- CodeMirror 6 system guide, https://codemirror.net/docs/guide/
- Lezer Markdown parser, https://github.com/lezer-parser/markdown
`;

const INBOX = `# Inbox

Loose thoughts go here before they get a home.

- Next up: [the roadmap](Projects/Roadmap.md#next)
- Try ~~Inter~~ SF Pro for body text on macOS
- Escaped characters: \\*not emphasis\\*
- Image syntax renders inline: ![Margin logo](https://raw.githubusercontent.com/github/explore/main/topics/markdown/markdown.png)
`;

const DEFAULT_FILES: Record<string, string> = {
  [`${DEMO_ROOT}/Projects/Editor design notes.md`]: DESIGN_NOTES,
  [`${DEMO_ROOT}/Projects/Roadmap.md`]: ROADMAP,
  [`${DEMO_ROOT}/Projects/Tauri vs Electron.md`]: TAURI_VS_ELECTRON,
  [`${DEMO_ROOT}/Journal/2026-11-04.md`]: JOURNAL_1,
  [`${DEMO_ROOT}/Journal/2026-11-03.md`]: JOURNAL_2,
  [`${DEMO_ROOT}/Reading/Reading list.md`]: READING,
  [`${DEMO_ROOT}/Templates/Daily note.md`]: `# {{date}}\n\n## Today\n\n- \n\n## Notes\n\n`,
  [`${DEMO_ROOT}/Inbox.md`]: INBOX,
};

interface FileTimes {
  created: number;
  modified: number;
}

interface Persisted {
  files: Record<string, string>;
  /** Folders that exist even when empty. */
  dirs?: string[];
  times?: Record<string, FileTimes>;
}

/** Demo notes get times an hour apart, newest first in the listing order, so sorting by date shows something. */
function demoTimes(files: Record<string, string>): Record<string, FileTimes> {
  const now = Date.now();
  return Object.fromEntries(Object.keys(files).map((path, i) => [path, { created: now - (i + 1) * 7_200_000, modified: now - (i + 1) * 3_600_000 }]));
}

function load(): Persisted {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed && parsed.files && typeof parsed.files === "object")
        return { files: { ...parsed.files }, dirs: parsed.dirs ?? [], times: { ...demoTimes(parsed.files), ...parsed.times } };
    }
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
  return { files: { ...DEFAULT_FILES }, dirs: [], times: demoTimes(DEFAULT_FILES) };
}

/**
 * In-memory vault with a handful of demo notes. Used in the browser (dev
 * server, Playwright) where there is no file system.
 */
export class MemoryBackend implements VaultBackend {
  readonly kind = "memory" as const;
  private files: Record<string, string>;
  private dirs: Set<string>;
  private times: Record<string, FileTimes>;
  private listeners = new Set<(e: WatchEvent) => void>();
  /** Saved images by path. Kept in memory only; images are too big for localStorage. */
  private assets = new Map<string, { url: string; size: number; modified: number }>();

  constructor(initial?: Record<string, string>, initialDirs: string[] = []) {
    if (initial) {
      this.files = { ...initial };
      this.dirs = new Set(initialDirs);
      this.times = demoTimes(initial);
    } else {
      const loaded = load();
      this.files = loaded.files;
      this.dirs = new Set(loaded.dirs ?? []);
      this.times = loaded.times ?? demoTimes(loaded.files);
    }
  }

  /** Record a write: the file is modified now, and created now if it is new. */
  private touch(path: string) {
    const now = Date.now();
    this.times[path] = { created: this.times[path]?.created ?? now, modified: now };
  }

  private persist() {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ files: this.files, dirs: [...this.dirs], times: this.times } satisfies Persisted));
    } catch {
      // ignore
    }
  }

  private dirExists(path: string): boolean {
    if (this.dirs.has(path)) return true;
    const prefix = path + "/";
    return [...Object.keys(this.files), ...this.dirs, ...this.assets.keys()].some((p) => p.startsWith(prefix));
  }

  private emit(event: WatchEvent) {
    for (const l of this.listeners) l(event);
  }

  /** Test helper: reset to the default demo notes. */
  reset() {
    this.files = { ...DEFAULT_FILES };
    this.dirs = new Set();
    this.times = demoTimes(DEFAULT_FILES);
    this.persist();
  }

  async pickVault(): Promise<string | null> {
    return DEMO_ROOT;
  }

  async createVault(): Promise<string | null> {
    let root = "/New vault";
    for (let i = 2; this.dirExists(root); i++) root = `/New vault ${i}`;
    this.dirs.add(root);
    this.persist();
    return root;
  }

  async listTree(root: string): Promise<FileNode[]> {
    const prefix = root.endsWith("/") ? root : root + "/";
    const dirs = new Map<string, FileNode>();
    const rootChildren: FileNode[] = [];

    const ensureDir = (path: string): FileNode[] => {
      if (path === root || path === "") return rootChildren;
      let node = dirs.get(path);
      if (!node) {
        node = { name: basename(path), path, kind: "dir", children: [] };
        dirs.set(path, node);
        ensureDir(dirname(path)).push(node);
      }
      return node.children!;
    };

    for (const dir of this.dirs) {
      if (dir.startsWith(prefix)) ensureDir(dir);
    }
    for (const path of Object.keys(this.files)) {
      if (!path.startsWith(prefix) || !isMarkdown(path)) continue;
      ensureDir(dirname(path)).push({ name: basename(path), path, kind: "file", ...this.times[path] });
    }

    const sort = (list: FileNode[]) => {
      list.sort((a, b) =>
        a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      );
      for (const n of list) if (n.children) sort(n.children);
    };
    sort(rootChildren);
    return rootChildren;
  }

  async readNote(path: string): Promise<string> {
    const content = this.files[path];
    if (content === undefined) throw new Error(`No such note: ${path}`);
    return content;
  }

  async writeNote(path: string, content: string): Promise<void> {
    this.files[path] = content;
    this.touch(path);
    this.persist();
  }

  async createNote(dir: string, name: string): Promise<string> {
    const base = name.replace(/\.md$/i, "") || "Untitled";
    let candidate = joinPath(dir, `${base}.md`);
    let i = 2;
    while (this.files[candidate] !== undefined) {
      candidate = joinPath(dir, `${base} ${i}.md`);
      i++;
    }
    this.files[candidate] = `# ${basename(candidate).replace(/\.md$/i, "")}\n\n`;
    this.touch(candidate);
    this.persist();
    this.emit({ kind: "create", paths: [candidate] });
    return candidate;
  }

  async createFolder(dir: string, name: string): Promise<string> {
    const base = name.trim().replace(/[\\/]/g, "-") || "New folder";
    let candidate = joinPath(dir, base);
    let i = 2;
    while (this.dirExists(candidate) || this.files[candidate] !== undefined) {
      candidate = joinPath(dir, `${base} ${i}`);
      i++;
    }
    this.dirs.add(candidate);
    this.persist();
    this.emit({ kind: "create", paths: [candidate] });
    return candidate;
  }

  async renamePath(from: string, to: string): Promise<void> {
    if (this.files[to] !== undefined || this.dirExists(to)) throw new Error(`Already exists: ${to}`);
    if (to !== from && isWithin(to, from)) throw new Error("Cannot move a folder into itself");
    // A move keeps a file's times, as it does on disk.
    const moveTimes = (a: string, b: string) => {
      if (this.times[a]) this.times[b] = this.times[a];
      delete this.times[a];
    };
    if (this.files[from] !== undefined) {
      this.files[to] = this.files[from];
      delete this.files[from];
      moveTimes(from, to);
    } else if (this.dirExists(from)) {
      const prefix = from + "/";
      const moved: Record<string, string> = {};
      for (const [p, c] of Object.entries(this.files)) {
        if (p.startsWith(prefix)) {
          moved[joinPath(to, p.slice(prefix.length))] = c;
          moveTimes(p, joinPath(to, p.slice(prefix.length)));
          delete this.files[p];
        }
      }
      Object.assign(this.files, moved);
      for (const [p, asset] of [...this.assets]) {
        if (!p.startsWith(prefix)) continue;
        this.assets.delete(p);
        this.assets.set(joinPath(to, p.slice(prefix.length)), asset);
      }
      const dirs = new Set<string>();
      for (const d of this.dirs) dirs.add(d === from ? to : d.startsWith(prefix) ? joinPath(to, d.slice(prefix.length)) : d);
      this.dirs = dirs;
    } else {
      throw new Error(`Does not exist: ${from}`);
    }
    this.persist();
    this.emit({ kind: "rename", paths: [from, to] });
  }

  async deletePath(path: string): Promise<void> {
    if (this.assets.has(path)) {
      this.assets.delete(path);
    } else if (this.files[path] !== undefined) {
      delete this.files[path];
      delete this.times[path];
    } else {
      const prefix = path + "/";
      for (const p of Object.keys(this.files)) {
        if (!p.startsWith(prefix)) continue;
        delete this.files[p];
        delete this.times[p];
      }
      for (const p of [...this.assets.keys()]) if (p.startsWith(prefix)) this.assets.delete(p);
      for (const d of [...this.dirs]) if (d === path || d.startsWith(prefix)) this.dirs.delete(d);
    }
    this.persist();
    this.emit({ kind: "remove", paths: [path] });
  }

  async searchVault(root: string, query: string, limit = 100): Promise<SearchHit[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const prefix = root.endsWith("/") ? root : root + "/";
    const hits: SearchHit[] = [];
    const paths = Object.keys(this.files)
      .filter((p) => p.startsWith(prefix) && isMarkdown(p))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    for (const path of paths) {
      let perFile = 0;
      let heading: string | null = null;
      let inFence = false;
      const lines = this.files[path].split("\n");
      for (let i = 0; i < lines.length && perFile < 5; i++) {
        const line = lines[i];
        const matched = line.toLowerCase().includes(q);
        if (matched) hits.push({ path, line: i + 1, text: line.trim().slice(0, SEARCH_LINE_MAX), heading });
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        else if (!inFence) heading = headingText(line) ?? heading;
        if (!matched) continue;
        perFile++;
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }

  async watch(_root: string, onEvent: (event: WatchEvent) => void): Promise<() => void> {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }

  async saveAttachment(dir: string, name: string, data: Uint8Array): Promise<string> {
    const clean = sanitizeFileName(name);
    if (!clean) throw new Error("The image needs a file name");
    const dot = clean.lastIndexOf(".");
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : "";
    let candidate = joinPath(dir, clean);
    for (let i = 2; this.assets.has(candidate) || this.files[candidate] !== undefined; i++) candidate = joinPath(dir, `${stem} ${i}${ext}`);
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([data.slice()])) : `memory:${candidate}`;
    this.assets.set(candidate, { url, size: data.byteLength, modified: Date.now() });
    return candidate;
  }

  resolveAsset(notePath: string, src: string): string {
    const path = assetPath(notePath, src);
    return (path && this.assets.get(path)?.url) ?? src;
  }

  async listImages(root: string): Promise<ImageFile[]> {
    return [...this.assets]
      .filter(([path]) => isWithin(path, root))
      .map(([path, { size, modified }]) => ({ path, size, modified }))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
  }

  assetUrl(path: string): string {
    return this.assets.get(path)?.url ?? "";
  }

  async openExternal(url: string): Promise<void> {
    globalThis.open?.(url, "_blank", "noopener");
  }

  /** Test helper. */
  allFiles(): FileNode[] {
    const tree: FileNode[] = [];
    for (const path of Object.keys(this.files)) tree.push({ name: basename(path), path, kind: "file" });
    return flattenFiles(tree);
  }
}
