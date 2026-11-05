import { canGoBack, canGoForward, crumbsFor, outlineVisible, sidebarVisible, useStore } from "../state/store";
import { formatShortcut } from "../state/appCommands";
import { ArrowsHorizontal, ArrowsInward, ChevronLeft, ChevronRightLg, FileText, PanelLeft, PanelRight } from "./icons";

export function TopBar() {
  const vaultRoot = useStore((s) => s.vaultRoot);
  const activePath = useStore((s) => s.activePath);
  const sidebarOpen = useStore(sidebarVisible);
  const outlineOpen = useStore(outlineVisible);
  const fullWidth = useStore((s) => s.fullWidth);
  const setFullWidth = useStore((s) => s.setFullWidth);
  const back = useStore(canGoBack);
  const forward = useStore(canGoForward);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleOutline = useStore((s) => s.toggleOutline);
  const goBack = useStore((s) => s.goBack);
  const goForward = useStore((s) => s.goForward);
  const crumbs = crumbsFor(vaultRoot, activePath);

  // Before a vault is open the bar is only a place to drag the window by.
  if (!vaultRoot) return <div className="topbar" data-tauri-drag-region="" />;

  return (
    <div className="topbar" data-tauri-drag-region="">
      <div className="topbar-nav">
        <button
          className="icon-button sidebar-toggle panel-toggle"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={sidebarOpen}
          title={`${sidebarOpen ? "Hide" : "Show"} sidebar (${formatShortcut("Mod+\\")})`}
        >
          <PanelLeft />
        </button>
        <button className="icon-button" onClick={() => void goBack()} disabled={!back} aria-label="Go back" title={`Back (${formatShortcut("Mod+[")})`}>
          <ChevronLeft />
        </button>
        <button className="icon-button" onClick={() => void goForward()} disabled={!forward} aria-label="Go forward" title={`Forward (${formatShortcut("Mod+]")})`}>
          <ChevronRightLg />
        </button>
      </div>
      <nav className="crumbs" aria-label="Breadcrumb" data-tauri-drag-region="" key={activePath ?? ""}>
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
        <button
          className={`icon-button${fullWidth ? " on" : ""}`}
          onClick={() => setFullWidth(!fullWidth)}
          aria-label="Full width"
          aria-pressed={fullWidth}
          title={fullWidth ? "Use page margins" : "Use full width"}
        >
          {fullWidth ? <ArrowsInward /> : <ArrowsHorizontal />}
        </button>
        <button
          className={`icon-button panel-toggle${outlineOpen ? " on" : ""}`}
          onClick={toggleOutline}
          aria-label="Toggle outline panel"
          aria-pressed={outlineOpen}
          title={`Outline (${formatShortcut("Mod+Shift+\\")})`}
        >
          <PanelRight />
        </button>
      </div>
    </div>
  );
}
