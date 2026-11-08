import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { assetPath, type FileNode, type SearchHit, type VaultBackend, type WatchEvent } from "./types";

/**
 * Rust command contract (see src-tauri/src/vault.rs and menu.rs):
 *
 *   list_tree(root: string)                     -> FileNode[]
 *   read_note(path: string)                     -> string
 *   write_note(path: string, content: string)   -> void      (atomic: temp + rename)
 *   create_note(dir: string, name: string)      -> string    (new absolute path)
 *   create_folder(dir: string, name: string)    -> string    (new absolute path)
 *   search_vault(query: string, limit: number)  -> SearchHit[]
 *   rename_path(from: string, to: string)       -> void
 *   delete_path(path: string)                   -> void      (moves to trash)
 *   watch_vault(root: string)                   -> void      (emits "vault://changed")
 *   unwatch_vault()                             -> void
 *   save_attachment(bytes; dir, name headers)   -> string    (saved path, never overwriting)
 *   create_vault(path: string)                  -> string    (new, empty vault folder)
 *   quit_app()                                  -> void      (see menuBridge's "app.quit")
 *
 * The "vault://changed" event payload is `{ kind, paths }` (a WatchEvent).
 */
export class TauriBackend implements VaultBackend {
  readonly kind = "tauri" as const;

  async pickVault(): Promise<string | null> {
    const selected = await openDialog({ directory: true, multiple: false, title: "Open vault folder" });
    if (!selected) return null;
    return Array.isArray(selected) ? (selected[0] ?? null) : selected;
  }

  async createVault(): Promise<string | null> {
    const path = await saveDialog({ title: "Create a vault", defaultPath: "Notes" });
    return path ? invoke<string>("create_vault", { path }) : null;
  }

  listTree(root: string): Promise<FileNode[]> {
    return invoke<FileNode[]>("list_tree", { root });
  }

  readNote(path: string): Promise<string> {
    return invoke<string>("read_note", { path });
  }

  writeNote(path: string, content: string): Promise<void> {
    return invoke<void>("write_note", { path, content });
  }

  createNote(dir: string, name: string): Promise<string> {
    return invoke<string>("create_note", { dir, name });
  }

  createFolder(dir: string, name: string): Promise<string> {
    return invoke<string>("create_folder", { dir, name });
  }

  searchVault(_root: string, query: string, limit = 100): Promise<SearchHit[]> {
    return invoke<SearchHit[]>("search_vault", { query, limit });
  }

  async revealPath(path: string): Promise<void> {
    await revealItemInDir(path);
  }

  renamePath(from: string, to: string): Promise<void> {
    return invoke<void>("rename_path", { from, to });
  }

  deletePath(path: string): Promise<void> {
    return invoke<void>("delete_path", { path });
  }

  async watch(root: string, onEvent: (event: WatchEvent) => void): Promise<() => void> {
    const unlisten = await listen<WatchEvent>("vault://changed", (e) => onEvent(e.payload));
    await invoke<void>("watch_vault", { root });
    return () => {
      unlisten();
      void invoke<void>("unwatch_vault").catch(() => {});
    };
  }

  async saveAttachment(dir: string, name: string, data: Uint8Array): Promise<string> {
    // The bytes go as the raw request body; JSON would turn a photo into a
    // huge array of numbers. Headers must be ASCII, so the paths are encoded.
    return invoke<string>("save_attachment", data, {
      headers: { "x-dir": encodeURIComponent(dir), "x-name": encodeURIComponent(name) },
    });
  }

  resolveAsset(notePath: string, src: string): string {
    const path = assetPath(notePath, src);
    return path ? convertFileSrc(path) : src;
  }

  async openExternal(url: string): Promise<void> {
    await openUrl(url);
  }
}
