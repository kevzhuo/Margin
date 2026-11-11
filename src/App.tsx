import { useEffect, useRef, useState } from "react";
import { isTauri, platform } from "./backend";
import { EditorPane } from "./components/EditorPane";
import { EmptyState } from "./components/EmptyState";
import { OutlinePanel } from "./components/OutlinePanel";
import { Palette } from "./components/Palette";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { AttachmentsDialog } from "./components/AttachmentsDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsPopover } from "./components/SettingsPopover";
import { Toasts } from "./components/Toasts";
import { noteTitle, outlineVisible, panelFits, sidebarVisible, useStore } from "./state/store";
import { appCommands, matchesShortcut } from "./state/appCommands";
import { prefersReducedMotion } from "./components/usePresence";
import { connectMenu } from "./state/menuBridge";
import { SwipeNavigation } from "./components/SwipeNavigation";

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
      // Off macOS the window is opaque: match its background to the theme so a
      // resize never exposes a white edge in dark mode.
      if (isTauri() && platform() !== "macos") {
        void import("@tauri-apps/api/window")
          .then(({ getCurrentWindow }) => getCurrentWindow().setBackgroundColor(resolved === "dark" ? "#191919" : "#ffffff"))
          .catch(() => {});
      }
    };
    apply();
    first.current = false;
    // The window follows the chosen theme too, not just the page: on macOS the
    // sidebar's frosted material and the traffic lights take the window's
    // appearance, so a dark theme on a light system would otherwise get a pale
    // sidebar behind light text. "system" hands it back to the OS.
    if (isTauri()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme === "system" ? null : theme))
        .catch(() => {});
    }
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
  const smoothCaret = useStore((s) => s.smoothCaret);
  const readingMode = useStore((s) => s.readingMode);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", `${fontSize}px`);
    root.style.setProperty("--font-editor", FONT_VAR[fontFamily]);
    root.style.setProperty("--editor-measure", MEASURE[lineWidth]);
    root.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
    root.classList.toggle("focus-mode", focusMode);
    root.classList.toggle("typewriter", typewriter);
    root.classList.toggle("full-width", fullWidth);
    root.classList.toggle("smooth-caret", smoothCaret);
    root.classList.toggle("reading-mode", readingMode);
    root.dataset.font = fontFamily;
  }, [fontSize, fontFamily, lineWidth, sidebarWidth, focusMode, typewriter, fullWidth, smoothCaret, readingMode]);
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
  useEffect(() => {
    const title = activePath ? `${noteTitle(activePath)} — Margin` : "Margin";
    document.title = title;
    if (isTauri()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => {});
    }
  }, [activePath]);
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

/**
 * A file dropped anywhere the editor doesn't handle it would make the web
 * view navigate to that file, replacing the app. Refuse such drops; the
 * editor takes its own (images) before this sees them.
 */
function useStrayDrops() {
  useEffect(() => {
    const refuse = (event: DragEvent) => {
      if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files") || event.defaultPrevented) return;
      event.preventDefault();
      if (event.type === "dragover") event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", refuse);
    window.addEventListener("drop", refuse);
    return () => {
      window.removeEventListener("dragover", refuse);
      window.removeEventListener("drop", refuse);
    };
  }, []);
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const activePath = useStore((s) => s.activePath);
  // Without a vault there's nothing for the panels to show; the welcome screen has the window.
  const hasVault = useStore((s) => s.vaultRoot !== null);
  const sidebarShown = useStore(sidebarVisible) && hasVault;
  const outlineShown = useStore(outlineVisible) && hasVault;
  const sidebarPeek = useStore((s) => s.sidebarPeek);
  const sidebarFits = useStore((s) => s.sidebarFits);
  const outlineFits = useStore((s) => s.outlineFits);
  const init = useStore((s) => s.init);
  useTheme();
  useAppearance();
  useResponsivePanels();
  useWindowTitle();
  useShortcuts();
  useStrayDrops();

  useEffect(() => {
    const root = document.documentElement;
    if (isTauri()) root.classList.add("tauri");
    root.classList.add(`platform-${platform()}`);
    if (isTauri() && platform() === "macos") root.classList.add("titlebar-overlay");
    void init();
    let disconnect: (() => void) | null = null;
    if (isTauri()) void connectMenu().then((d) => (disconnect = d));
    return () => disconnect?.();
  }, [init]);

  // Panels take their starting state in place (the vault loads after the
  // first render); only changes after startup animate.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  // The desktop window starts hidden; show it once the first real frame is painted.
  useEffect(() => {
    if (!ready || !isTauri()) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void import("@tauri-apps/api/window")
          .then(async ({ getCurrentWindow }) => {
            const win = getCurrentWindow();
            await win.show();
            await win.setFocus();
          })
          .catch(() => {});
      }),
    );
  }, [ready]);

  // Save what was just typed before the page or the window goes away. Closing
  // the desktop window waits for the save (Quit does the same, see menuBridge).
  useEffect(() => {
    const flush = () => void useStore.getState().flushSave();
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHide);
    let stopClose: (() => void) | null = null;
    let disposed = false;
    if (isTauri()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested(() => useStore.getState().flushSave()))
        .then((stop) => (disposed ? stop() : (stopClose = stop)))
        .catch(() => {});
    }
    return () => {
      disposed = true;
      stopClose?.();
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return (
    <div className={`app${sidebarShown && !sidebarPeek ? "" : " sidebar-hidden"}${outlineShown ? "" : " outline-hidden"}`} data-ready={ready ? "true" : "false"} data-settled={settled || undefined}>
      {/* A panel that doesn't fit is always an overlay, so opening or closing it never pushes the editor. */}
      <div className="sidebar-shell" data-open={sidebarShown} data-overlay={!sidebarFits || undefined} inert={!sidebarShown || undefined}>
        <Sidebar />
      </div>
      <main className="main">
        <TopBar />
        {activePath ? <EditorPane /> : <EmptyState />}
        <StatusBar />
        <SwipeNavigation />
      </main>
      <div className="outline-shell" data-open={outlineShown} data-overlay={!outlineFits || undefined} inert={!outlineShown || undefined}>
        <OutlinePanel />
      </div>
      <Palette />
      <SettingsPopover />
      <AttachmentsDialog />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
