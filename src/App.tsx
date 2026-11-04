import { useEffect } from "react";
import { isTauri, platform } from "./backend";
import { EditorPane } from "./components/EditorPane";
import { EmptyState } from "./components/EmptyState";
import { OutlinePanel } from "./components/OutlinePanel";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { useStore } from "./state/store";
import { X } from "./components/icons";

function useTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const s = useStore.getState();
      const key = e.key.toLowerCase();
      if ((key === "p" || key === "o") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        s.setQuickOpen(!s.quickOpen);
      } else if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        void s.createNote();
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        void s.flushSave();
      } else if (key === "\\" && !e.shiftKey) {
        e.preventDefault();
        s.toggleSidebar();
      } else if (key === "\\" && e.shiftKey) {
        e.preventDefault();
        s.toggleOutline();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const activePath = useStore((s) => s.activePath);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const outlineOpen = useStore((s) => s.outlineOpen);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);
  const init = useStore((s) => s.init);
  useTheme();
  useShortcuts();

  useEffect(() => {
    const root = document.documentElement;
    if (isTauri()) root.classList.add("tauri");
    root.classList.add(`platform-${platform()}`);
    if (isTauri() && platform() === "macos") root.classList.add("titlebar-overlay");
    void init();
  }, [init]);

  useEffect(() => {
    const flush = () => void useStore.getState().flushSave();
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  return (
    <div className={`app${sidebarOpen ? "" : " sidebar-hidden"}`} data-ready={ready ? "true" : "false"}>
      {sidebarOpen && <Sidebar />}
      <main className="main">
        <TopBar />
        {activePath ? <EditorPane /> : <EmptyState />}
        <StatusBar />
      </main>
      {outlineOpen && <OutlinePanel />}
      <QuickSwitcher />
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={clearError} aria-label="Dismiss">
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
