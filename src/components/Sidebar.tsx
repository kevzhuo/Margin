import { basename } from "../backend";
import { useStore } from "../state/store";
import { FileTree } from "./FileTree";
import { Book, ChevronDown, Monitor, Moon, Plus, Search, Sun } from "./icons";

export function Sidebar() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const backend = useStore((s) => s.backend);
  const theme = useStore((s) => s.theme);
  const cycleTheme = useStore((s) => s.cycleTheme);
  const openVault = useStore((s) => s.openVault);
  const createNote = useStore((s) => s.createNote);
  const setQuickOpen = useStore((s) => s.setQuickOpen);

  const vaultName = vaultRoot ? basename(vaultRoot) || vaultRoot : "No vault";
  const themeLabel = theme === "system" ? "Theme: follows system" : theme === "light" ? "Theme: light" : "Theme: dark";
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar-top" data-tauri-drag-region="" />
      <div className="sidebar-body">
        <button
          className="vault-row"
          onClick={() => void openVault()}
          title={backend?.kind === "tauri" ? "Open another vault folder" : "Demo vault"}
          aria-label={`Vault: ${vaultName}. Open another vault`}
        >
          <Book />
          <span className="vault-name">{vaultName}</span>
          <ChevronDown className="vault-chevron" />
        </button>
        <button className="search-row" onClick={() => setQuickOpen(true)} aria-label="Search notes">
          <Search />
          <span>Search</span>
          <kbd>{modKey}P</kbd>
        </button>
        <div className="section-label">Files</div>
        <FileTree />
      </div>
      <div className="sidebar-foot">
        <button className="new-note" onClick={() => void createNote()} disabled={!vaultRoot} aria-label="New note">
          <Plus />
          <span>New note</span>
        </button>
        <button className="icon-button" onClick={cycleTheme} aria-label={themeLabel} title={themeLabel}>
          {theme === "system" ? <Monitor /> : theme === "light" ? <Sun /> : <Moon />}
        </button>
      </div>
    </aside>
  );
}
