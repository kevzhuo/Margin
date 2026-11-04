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
