import { useEffect, useRef } from "react";
import { isTauri, platform } from "./backend";
import { EditorPane } from "./components/EditorPane";
import { EmptyState } from "./components/EmptyState";
import { OutlinePanel } from "./components/OutlinePanel";
import { Palette } from "./components/Palette";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPopover } from "./components/SettingsPopover";
import { Toasts } from "./components/Toasts";
import { noteTitle, outlineVisible, panelFits, sidebarVisible, useStore } from "./state/store";
import { appCommands, matchesShortcut } from "./state/appCommands";
import { prefersReducedMotion } from "./components/usePresence";

const MEASURE = { narrow: "600px", medium: "720px", wide: "900px" } as const;
const FONT_VAR = { sans: "var(--font-editor-sans)", serif: "var(--font-editor-serif)", mono: "var(--font-editor-mono)" } as const;

function useTheme() {
  const theme = useStore((s) => s.theme);
  const first = useRef(true);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      const resolved = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      if (root.dataset.theme === resolved) return;
      // Crossfade colors when the theme changes after the first paint.
      if (!first.current && !prefersReducedMotion()) {
        root.classList.add("theme-transition");
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => root.classList.remove("theme-transition"), 320);
      }
      root.dataset.theme = resolved;
    };
    apply();
    first.current = false;
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      if (timer) clearTimeout(timer);
    };
  }, [theme]);
}

/** Appearance settings live in CSS variables and classes on <html>. */
function useAppearance() {
  const fontSize = useStore((s) => s.fontSize);
  const fontFamily = useStore((s) => s.fontFamily);
  const lineWidth = useStore((s) => s.lineWidth);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const focusMode = useStore((s) => s.focusMode);
  const typewriter = useStore((s) => s.typewriter);
  const fullWidth = useStore((s) => s.fullWidth);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", `${fontSize}px`);
    root.style.setProperty("--font-editor", FONT_VAR[fontFamily]);
    root.style.setProperty("--editor-measure", MEASURE[lineWidth]);
    root.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
    root.classList.toggle("focus-mode", focusMode);
    root.classList.toggle("typewriter", typewriter);
    root.classList.toggle("full-width", fullWidth);
    root.dataset.font = fontFamily;
  }, [fontSize, fontFamily, lineWidth, sidebarWidth, focusMode, typewriter, fullWidth]);
}

/**
 * Keep the editor comfortably wide: panels that would squeeze it below
 * MIN_EDITOR_WIDTH hide themselves, and their toggles open them as overlays.
 */
function useResponsivePanels() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const peeking = useStore((s) => s.sidebarPeek || s.outlinePeek);
  useEffect(() => {
    const update = () => {
      const fits = panelFits(window.innerWidth, sidebarOpen, sidebarWidth);
      useStore.getState().setFits(fits.sidebarFits, fits.outlineFits);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [sidebarOpen, sidebarWidth]);

  // An overlay panel closes on Escape or a click anywhere else.
  useEffect(() => {
    if (!peeking) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest(".sidebar-shell, .outline-shell, .panel-toggle, .context-menu, .modal-backdrop, .settings-popover")) return;
      useStore.getState().closePeeks();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) useStore.getState().closePeeks();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [peeking]);
}

function useWindowTitle() {
  const activePath = useStore((s) => s.activePath);
  const dirty = useStore((s) => s.dirty);
  useEffect(() => {
    const title = activePath ? `${noteTitle(activePath)} — Margin` : "Margin";
    document.title = title;
    if (isTauri()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => {});
    }
  }, [activePath]);
  // macOS shows unsaved changes as a dot in the close button.
  useEffect(() => {
    document.documentElement.classList.toggle("unsaved", dirty);
  }, [dirty]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      const typingInField = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA") && !target.closest(".cm-editor");
      for (const command of appCommands()) {
        if (!command.global || !command.keys || !matchesShortcut(e, command.keys)) continue;
        // Plain keys like F2 belong to text fields while one is focused.
        if (typingInField && !command.keys.startsWith("Mod")) return;
        if (command.enabled && !command.enabled()) return;
        e.preventDefault();
        void command.run();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const activePath = useStore((s) => s.activePath);
  const sidebarShown = useStore(sidebarVisible);
  const outlineShown = useStore(outlineVisible);
  const sidebarPeek = useStore((s) => s.sidebarPeek);
  const sidebarFits = useStore((s) => s.sidebarFits);
  const outlineFits = useStore((s) => s.outlineFits);
  const init = useStore((s) => s.init);
  useTheme();
  useAppearance();
  useResponsivePanels();
  useWindowTitle();
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
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return (
    <div className={`app${sidebarShown && !sidebarPeek ? "" : " sidebar-hidden"}${outlineShown ? "" : " outline-hidden"}`} data-ready={ready ? "true" : "false"}>
      {/* A panel that doesn't fit is always an overlay, so opening or closing it never pushes the editor. */}
      <div className="sidebar-shell" data-open={sidebarShown} data-overlay={!sidebarFits || undefined} inert={!sidebarShown || undefined}>
        <Sidebar />
      </div>
      <main className="main">
        <TopBar />
        {activePath ? <EditorPane /> : <EmptyState />}
        <StatusBar />
      </main>
      <div className="outline-shell" data-open={outlineShown} data-overlay={!outlineFits || undefined} inert={!outlineShown || undefined}>
        <OutlinePanel />
      </div>
      <Palette />
      <SettingsPopover />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
