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
  /** Last modified, in milliseconds since 1970, when known. */
  modified?: number;
  /** Created, in milliseconds since 1970, when the file system records it. */
  created?: number;
}

/** An image somewhere in the vault. */
export interface ImageFile {
  path: string;
  /** Size in bytes. */
  size: number;
  /** Last modified, in milliseconds since 1970, when known. */
  modified?: number;
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
  /** The nearest heading above the line, without its `#`s. */
  heading?: string | null;
}

/** The text of an ATX heading line ("## Title ##" gives "Title"), or null. */
export function headingText(line: string): string | null {
  const m = /^\s*#{1,6}(?:[ \t]+(.*?))?[ \t#]*$/.exec(line);
  return m?.[1]?.trim() || null;
}

export interface VaultBackend {
  readonly kind: "tauri" | "memory";

  /**
   * Ask the user for a vault folder. Resolves to the chosen root, or null if
   * they cancelled. The memory backend returns its demo root immediately.
   */
  pickVault(): Promise<string | null>;

  /**
   * Ask where to put a new vault and create its (empty) folder. Resolves to
   * the new root, or null if they cancelled.
   */
  createVault(): Promise<string | null>;

  /** Recursively list the vault: folders, notes and PDFs. Hidden entries and other files are omitted. */
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

  /**
   * Save a file (an image added to a note) as `<dir>/<name>`, creating the
   * folder if needed and never overwriting: a taken name becomes "name 2.png",
   * "name 3.png"… Resolves to the saved path.
   */
  saveAttachment(dir: string, name: string, data: Uint8Array): Promise<string>;

  /** Resolve an image path in a note (relative or absolute) to something an <img> can load. */
  resolveAsset(notePath: string, src: string): string;

  /** Every image in the vault (hidden folders skipped), sorted by path. */
  listImages(root: string): Promise<ImageFile[]>;

  /** Something an <img> can load for an image's absolute path. */
  assetUrl(path: string): string;

  openExternal(url: string): Promise<void>;
}

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

/** PDFs are listed beside notes and open in Margin's viewer instead of the editor. */
export function isPdf(name: string): boolean {
  return /\.pdf$/i.test(name);
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

/**
 * Relative path from the folder `fromDir` to the file `to`, with `/`
 * separators. Both are absolute paths in the same vault.
 */
export function relativePath(fromDir: string, to: string): string {
  const split = (p: string) => p.split(/[\\/]+/).filter(Boolean);
  const from = split(fromDir);
  const target = split(to);
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common++;
  return [...from.slice(common).map(() => ".."), ...target.slice(common)].join("/");
}

/**
 * Percent-encode the characters that would end or confuse a Markdown link
 * destination (spaces, brackets, parentheses, `<>`, `#`, `?`, `%`). Letters
 * from any language stay as they are, as Obsidian and Typora write them.
 */
export function encodeLinkPath(path: string): string {
  return path.replace(/[ ()[\]<>#?%]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

/**
 * The file an image link in a note points at, as an absolute path: relative
 * links resolve against the note's folder, `%20`-style escapes are decoded and
 * `<…>` destinations unwrapped. Null for web, data and blob URLs, which load
 * as they are.
 */
export function assetPath(notePath: string, src: string): string | null {
  const link = src.trim().replace(/^<(.*)>$/, "$1");
  const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(link) && !/^[a-zA-Z]:[\\/]/.test(link);
  if (!link || isUrl) return null;
  if (/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(link)) {
    try {
      return decodeURIComponent(link);
    } catch {
      return link;
    }
  }
  return resolveRelative(dirname(notePath), link);
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
