import type { EditorView } from "@codemirror/view";
import { insertLink, insertMathBlock, setHeading, toggleBlockquote, toggleInline, toggleTask } from "../editor/commands";
import { pickImages } from "../editor/images";
import { appCommands } from "./appCommands";
import { useStore } from "./store";

/** Formatting items run against the editor. */
const FORMAT: Record<string, (view: EditorView) => boolean> = {
  "format.bold": toggleInline("**"),
  "format.italic": toggleInline("*"),
  "format.strike": toggleInline("~~"),
  "format.code": toggleInline("`"),
  "format.link": insertLink,
  "format.math": toggleInline("$"),
  "insert.mathBlock": insertMathBlock,
  "insert.image": (view) => pickImages(view, view.state.selection.main.head),
  "format.h1": setHeading(1),
  "format.h2": setHeading(2),
  "format.h3": setHeading(3),
  "format.paragraph": setHeading(0),
  "format.task": toggleTask,
  "format.quote": toggleBlockquote,
};

const EXTRA: Record<string, () => void> = {
  // The command list shows every shortcut beside its command.
  "help.shortcuts": () => useStore.getState().openPalette(">"),
  // Save what was just typed, then quit (the app quits on its own after a moment if this fails).
  "app.quit": () =>
    void useStore
      .getState()
      .flushSave()
      .finally(async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("quit_app");
      }),
};

export function hasMenuHandler(id: string): boolean {
  return id in FORMAT || id in EXTRA || appCommands().some((c) => c.id === id) || ALWAYS_REGISTERED.has(id);
}

/** Commands that only exist on some backends (they are always in the menu). */
const ALWAYS_REGISTERED = new Set(["note.reveal", "vault.open"]);

let lastKey: { event: KeyboardEvent; at: number } | null = null;
const SAME_KEYSTROKE_MS = 150;

/**
 * A menu shortcut can reach the app twice: once as a keydown the page handles,
 * and once as the menu item. If a keydown was handled a moment ago, the menu
 * event is the echo of that keystroke and is ignored.
 */
export function isEchoOfHandledKey(now = performance.now()): boolean {
  return !!lastKey && now - lastKey.at < SAME_KEYSTROKE_MS && lastKey.event.defaultPrevented;
}

export function runMenuCommand(id: string): boolean {
  if (isEchoOfHandledKey()) return false;
  const s = useStore.getState();
  const format = FORMAT[id];
  if (format) {
    const view = s.editor;
    if (!view) return false;
    format(view);
    view.focus();
    return true;
  }
  const extra = EXTRA[id];
  if (extra) {
    extra();
    return true;
  }
  const command = appCommands().find((c) => c.id === id);
  if (!command || (command.enabled && !command.enabled())) return false;
  void command.run();
  return true;
}

/** Listen for native menu items (macOS desktop app). Returns an unsubscribe function. */
export async function connectMenu(): Promise<() => void> {
  const onKey = (event: KeyboardEvent) => {
    lastKey = { event, at: performance.now() };
  };
  window.addEventListener("keydown", onKey, true);
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<string>("menu://command", (e) => runMenuCommand(e.payload));
  return () => {
    window.removeEventListener("keydown", onKey, true);
    unlisten();
  };
}

/** Test hook: pretend a keydown just happened. */
export function __setLastKeyForTest(event: KeyboardEvent | null, at = performance.now()) {
  lastKey = event ? { event, at } : null;
}
