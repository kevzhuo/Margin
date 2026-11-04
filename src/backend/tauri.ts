import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { dirname, type FileNode, type VaultBackend, type WatchEvent } from "./types";

/**
 * Rust command contract (see src-tauri/src/vault.rs):
 *
 *   list_tree(root: string)                     -> FileNode[]
 *   read_note(path: string)                     -> string
 *   write_note(path: string, content: string)   -> void      (atomic: temp + rename)
 *   create_note(dir: string, name: string)      -> string    (new absolute path)
 *   rename_path(from: string, to: string)       -> void
 *   delete_path(path: string)                   -> void      (moves to trash)
 *   watch_vault(root: string)                   -> void      (emits "vault://changed")
 *   unwatch_vault()                             -> void
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

  resolveAsset(notePath: string, src: string): string {
    if (/^(https?:|data:|asset:|blob:)/i.test(src)) return src;
    const dir = dirname(notePath);
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    const abs = /^([a-zA-Z]:[\\/]|\/)/.test(src) ? src : dir + sep + src.replace(/^\.\//, "");
    return convertFileSrc(abs);
  }

  async openExternal(url: string): Promise<void> {
    await openUrl(url);
  }
}
