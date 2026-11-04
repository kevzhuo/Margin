import { openSearchPanel } from "@codemirror/search";
import { basename, dirname, flattenFiles, platform, stripExtension } from "../backend";
import { useStore, type FontFamily, type LineWidth, type ThemePref } from "./store";

export interface AppCommand {
  id: string;
  title: string;
  /** Extra words the palette matches on. */
  keywords?: string;
  /** Shortcut in "Mod+Shift+P" form; Mod is Cmd on macOS and Ctrl elsewhere. */
  keys?: string;
  /** Handled by the window-level shortcut listener. */
  global?: boolean;
  enabled?: () => boolean;
  run: () => void | Promise<void>;
}

export const isMac = () => platform() === "macos";

const CODE_FOR: Record<string, string> = {
  "\\": "Backslash",
  "=": "Equal",
  "-": "Minus",
  "[": "BracketLeft",
  "]": "BracketRight",
  ",": "Comma",
  "/": "Slash",
  ".": "Period",
  "0": "Digit0",
};

/** Does a keyboard event match a "Mod+Shift+P" style shortcut? */
export function matchesShortcut(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("+");
  const key = parts.pop()!;
  const want = new Set(parts.map((p) => p.toLowerCase()));
  const mac = isMac();
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (want.has("mod") !== mod) return false;
  if (want.has("shift") !== e.shiftKey) return false;
  if (want.has("alt") !== e.altKey) return false;
  if (!want.has("mod") && (e.metaKey || e.ctrlKey)) return false;
  if (mac && want.has("ctrl") !== e.ctrlKey) return false;
  const code = CODE_FOR[key];
  if (code) return e.code === code || e.key === key;
  if (/^F\d+$/.test(key)) return e.key === key;
  return e.key.toLowerCase() === key.toLowerCase();
}

/** Human-readable shortcut: "⌘⇧P" on macOS, "Ctrl+Shift+P" elsewhere. */
export function formatShortcut(spec: string): string {
  const parts = spec.split("+");
  if (isMac()) {
    const sym: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };
    return parts.map((p) => sym[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join("");
  }
  return parts.map((p) => (p === "Mod" ? "Ctrl" : p.length === 1 ? p.toUpperCase() : p)).join("+");
}

export async function confirmAndDelete(path: string, kind: "file" | "dir") {
  const s = useStore.getState();
  const name = kind === "file" ? stripExtension(basename(path)) : basename(path);
  const toTrash = s.backend?.kind === "tauri";
  const ok = await s.askConfirm({
    title: kind === "dir" ? `Delete the folder “${name}”?` : `Delete “${name}”?`,
    message:
      (kind === "dir" ? "Everything inside it will be deleted too. " : "") +
      (toTrash ? "You can restore it from the trash." : "This can't be undone."),
    confirmLabel: "Delete",
    danger: true,
  });
  if (ok) await useStore.getState().deletePath(path);
}

/** Start renaming the active note in the sidebar. */
function renameActive() {
  const s = useStore.getState();
  const path = s.activePath;
  if (!path) return;
  if (!s.sidebarOpen) s.toggleSidebar();
  // Make sure every ancestor folder is expanded so the row is visible.
  let dir = dirname(path);
  const expanded = { ...s.expandedDirs };
  while (dir && s.vaultRoot && dir.length > s.vaultRoot.length) {
    expanded[dir] = true;
    dir = dirname(dir);
  }
  useStore.setState({ expandedDirs: expanded });
  s.setRenaming(path);
}

const fileManager = () => (isMac() ? "Finder" : platform() === "windows" ? "Explorer" : "file manager");

export function appCommands(): AppCommand[] {
  const s = useStore.getState();
  const hasNote = () => !!useStore.getState().activePath;
  const hasVault = () => !!useStore.getState().vaultRoot;
  const theme = (t: ThemePref, label: string): AppCommand => ({
    id: `theme.${t}`,
    title: `Theme: ${label}`,
    keywords: "appearance dark light mode color",
    run: () => useStore.getState().setTheme(t),
  });
  const width = (w: LineWidth, label: string): AppCommand => ({
    id: `width.${w}`,
    title: `Line width: ${label}`,
    keywords: "measure column page",
    run: () => useStore.getState().setLineWidth(w),
  });
  const font = (f: FontFamily, label: string): AppCommand => ({
    id: `font.${f}`,
    title: `Font: ${label}`,
    keywords: "typeface typography",
    run: () => useStore.getState().setFontFamily(f),
  });

  const commands: AppCommand[] = [
    { id: "note.new", title: "New note", keys: "Mod+N", global: true, enabled: hasVault, run: () => void useStore.getState().createNote() },
    { id: "folder.new", title: "New folder", keys: "Mod+Shift+N", global: true, enabled: hasVault, run: () => void useStore.getState().createFolder() },
    { id: "palette.open", title: "Go to note…", keywords: "quick open switcher search find", keys: "Mod+P", global: true, run: () => useStore.getState().openPalette("") },
    { id: "palette.openAlt", title: "Go to note…", keys: "Mod+O", global: true, run: () => useStore.getState().openPalette("") },
    { id: "palette.commands", title: "Show all commands", keywords: "palette actions", keys: "Mod+Shift+P", global: true, run: () => useStore.getState().openPalette(">") },
    { id: "search.vault", title: "Search all notes", keywords: "find text content grep", keys: "Mod+Shift+F", global: true, run: () => useStore.getState().openPalette("") },
    {
      id: "search.note",
      title: "Find in note",
      keywords: "search replace",
      keys: "Mod+F",
      enabled: hasNote,
      run: () => {
        const view = useStore.getState().editor;
        if (view) openSearchPanel(view);
      },
    },
    { id: "nav.back", title: "Go back", keys: "Mod+[", global: true, run: () => void useStore.getState().goBack() },
    { id: "nav.forward", title: "Go forward", keys: "Mod+]", global: true, run: () => void useStore.getState().goForward() },
    { id: "note.rename", title: "Rename note", keys: "F2", global: true, enabled: hasNote, run: renameActive },
    {
      id: "note.delete",
      title: "Delete note",
      keywords: "remove trash",
      enabled: hasNote,
      run: () => {
        const p = useStore.getState().activePath;
        if (p) void confirmAndDelete(p, "file");
      },
    },
    {
      id: "note.copyPath",
      title: "Copy note path",
      keywords: "clipboard file location",
      enabled: hasNote,
      run: () => {
        const p = useStore.getState().activePath;
        if (p) void useStore.getState().copyPath(p);
      },
    },
    ...(s.backend?.revealPath
      ? [
          {
            id: "note.reveal",
            title: `Show note in ${fileManager()}`,
            keywords: "reveal finder explorer folder",
            enabled: hasNote,
            run: () => {
              const p = useStore.getState().activePath;
              if (p) void useStore.getState().revealPath(p);
            },
          } satisfies AppCommand,
        ]
      : []),
    { id: "view.sidebar", title: "Toggle sidebar", keys: "Mod+\\", global: true, run: () => useStore.getState().toggleSidebar() },
    { id: "view.outline", title: "Toggle outline", keys: "Mod+Shift+\\", global: true, run: () => useStore.getState().toggleOutline() },
    {
      id: "view.focus",
      title: s.focusMode ? "Turn off focus mode" : "Turn on focus mode",
      keywords: "dim distraction free zen",
      keys: "F8",
      global: true,
      run: () => useStore.getState().setFocusMode(!useStore.getState().focusMode),
    },
    {
      id: "view.typewriter",
      title: s.typewriter ? "Turn off typewriter mode" : "Turn on typewriter mode",
      keywords: "center caret scroll",
      keys: "F9",
      global: true,
      run: () => useStore.getState().setTypewriter(!useStore.getState().typewriter),
    },
    { id: "text.bigger", title: "Increase text size", keywords: "zoom in font larger", keys: "Mod+=", global: true, run: () => useStore.getState().bumpFontSize(1) },
    { id: "text.smaller", title: "Decrease text size", keywords: "zoom out font smaller", keys: "Mod+-", global: true, run: () => useStore.getState().bumpFontSize(-1) },
    { id: "text.reset", title: "Reset text size", keywords: "zoom actual size font", run: () => useStore.getState().setFontSize(16) },
    width("narrow", "Narrow"),
    width("medium", "Medium"),
    width("wide", "Wide"),
    font("sans", "Sans serif"),
    font("serif", "Serif"),
    font("mono", "Monospace"),
    theme("system", "Match system"),
    theme("light", "Light"),
    theme("dark", "Dark"),
    { id: "settings.open", title: "Open settings", keywords: "preferences appearance", keys: "Mod+,", global: true, run: () => useStore.getState().setSettingsOpen(true) },
  ];
  if (s.backend?.kind === "tauri") {
    commands.push({ id: "vault.open", title: "Open another vault…", keywords: "folder switch", run: () => void useStore.getState().openVault() });
  }
  return commands;
}

/** Commands shown in the palette: one per id, the alternates dropped. */
export function paletteCommands(): AppCommand[] {
  return appCommands().filter((c) => c.id !== "palette.openAlt" && c.id !== "palette.commands" && (c.enabled?.() ?? true));
}

export function noteCount(): number {
  return flattenFiles(useStore.getState().tree).length;
}
