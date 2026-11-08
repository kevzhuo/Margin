import { useRef, useState, type PointerEvent } from "react";
import { basename } from "../backend";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, useStore } from "../state/store";
import { formatShortcut } from "../state/appCommands";
import { SORT_LABELS, type SortBy } from "../state/treeSort";
import { FileTree } from "./FileTree";
import { ContextMenu } from "./ContextMenu";
import { Book, ChevronDown, FilePlus, FolderPlus, Gear, Monitor, Moon, Plus, Search, SortLines, Sun } from "./icons";

function Resizer() {
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width: useStore.getState().sidebarWidth };
    document.documentElement.classList.add("resizing");
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const width = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, start.current.width + e.clientX - start.current.x));
    // Update the CSS variable directly while dragging; commit on release.
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const width = start.current.width + e.clientX - start.current.x;
    start.current = null;
    document.documentElement.classList.remove("resizing");
    setSidebarWidth(width);
  };

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={useStore.getState().sidebarWidth}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
    />
  );
}

export function Sidebar() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const backend = useStore((s) => s.backend);
  const theme = useStore((s) => s.theme);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const cycleTheme = useStore((s) => s.cycleTheme);
  const openVault = useStore((s) => s.openVault);
  const createNote = useStore((s) => s.createNote);
  const createFolder = useStore((s) => s.createFolder);
  const openPalette = useStore((s) => s.openPalette);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [filesScrolled, setFilesScrolled] = useState(false);
  const sortBy = useStore((s) => s.sortBy);
  const setSortBy = useStore((s) => s.setSortBy);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);

  const vaultName = vaultRoot ? basename(vaultRoot) || vaultRoot : "No vault";
  const themeLabel = theme === "system" ? "Theme: follows system" : theme === "light" ? "Theme: light" : "Theme: dark";

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar-top" data-tauri-drag-region="" />
      <div className="sidebar-head">
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
        <button className="search-row" onClick={() => openPalette("")} aria-label="Search notes">
          <Search />
          <span>Search</span>
          <kbd>{formatShortcut("Mod+P")}</kbd>
        </button>
        <div className="section-header">
          <div className="section-label">
            Files
            {sortBy !== "name" && <span className="section-sort"> · {SORT_LABELS[sortBy]}</span>}
          </div>
          <div className={`section-actions${sortMenu ? " held" : ""}`}>
            <button
              className={`icon-button small${sortBy !== "name" ? " on" : ""}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setSortMenu(sortMenu ? null : { x: r.left, y: r.bottom + 4 });
              }}
              disabled={!vaultRoot}
              aria-label={`Sort notes: ${SORT_LABELS[sortBy]}`}
              aria-haspopup="menu"
              title={`Sort by ${SORT_LABELS[sortBy].toLowerCase()}`}
            >
              <SortLines size={14} />
            </button>
            <button className="icon-button small" onClick={() => void createNote()} disabled={!vaultRoot} aria-label="New note in vault" title={`New note (${formatShortcut("Mod+N")})`}>
              <FilePlus size={14} />
            </button>
            <button className="icon-button small" onClick={() => void createFolder()} disabled={!vaultRoot} aria-label="New folder" title={`New folder (${formatShortcut("Mod+Shift+N")})`}>
              <FolderPlus size={14} />
            </button>
          </div>
        </div>
      </div>
      {/* Only the files scroll; the vault, search and section header stay put. */}
      <div className="sidebar-files" data-scrolled={filesScrolled || undefined} onScroll={(e) => setFilesScrolled(e.currentTarget.scrollTop > 2)}>
        <FileTree />
      </div>
      <div className="sidebar-foot">
        <button className="new-note" onClick={() => void createNote()} disabled={!vaultRoot} aria-label="New note">
          <Plus />
          <span>New note</span>
        </button>
        <button className="icon-button" onClick={cycleTheme} aria-label={themeLabel} title={themeLabel}>
          <span className="icon-swap" key={theme}>
            {theme === "system" ? <Monitor /> : theme === "light" ? <Sun /> : <Moon />}
          </span>
        </button>
        <button
          className={`icon-button settings-button${settingsOpen ? " on" : ""}`}
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-label="Settings"
          aria-expanded={settingsOpen}
          title={`Settings (${formatShortcut("Mod+,")})`}
        >
          <Gear />
        </button>
      </div>
      <Resizer />
      {sortMenu && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          items={(Object.keys(SORT_LABELS) as SortBy[]).map((by) => ({ label: SORT_LABELS[by], checked: by === sortBy, onSelect: () => setSortBy(by) }))}
          onClose={() => setSortMenu(null)}
        />
      )}
    </aside>
  );
}
