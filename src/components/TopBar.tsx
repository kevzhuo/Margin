import { crumbsFor, useStore } from "../state/store";
import { FileText, PanelLeft, PanelRight } from "./icons";

export function TopBar() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const activePath = useStore((s) => s.activePath);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const outlineOpen = useStore((s) => s.outlineOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleOutline = useStore((s) => s.toggleOutline);
  const crumbs = crumbsFor(vaultRoot, activePath);

  return (
    <div className="topbar" data-tauri-drag-region="">
      {!sidebarOpen && (
        <button className="icon-button" onClick={toggleSidebar} aria-label="Show sidebar" aria-pressed={sidebarOpen}>
          <PanelLeft />
        </button>
      )}
      <nav className="crumbs" aria-label="Breadcrumb" data-tauri-drag-region="">
        {crumbs.map((c, i) =>
          i < crumbs.length - 1 ? (
            <span key={i} className="crumb">
              <span className="crumb-text">{c}</span>
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
            </span>
          ) : (
            <span key={i} className="crumb current">
              <FileText size={15} />
              <span className="crumb-text">{c}</span>
            </span>
          ),
        )}
      </nav>
      <div className="topbar-actions">
        {sidebarOpen && (
          <button className="icon-button" onClick={toggleSidebar} aria-label="Hide sidebar" aria-pressed={sidebarOpen}>
            <PanelLeft />
          </button>
        )}
        <button className={`icon-button${outlineOpen ? " on" : ""}`} onClick={toggleOutline} aria-label="Toggle outline panel" aria-pressed={outlineOpen}>
          <PanelRight />
        </button>
      </div>
    </div>
  );
}
