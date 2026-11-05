import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import {
  basename,
  dirname,
  flattenFiles,
  getBackend,
  isWithin,
  joinPath,
  stripExtension,
  type FileNode,
  type VaultBackend,
  type WatchEvent,
} from "../backend";
import type { Heading } from "../editor/outline";
import { fileNameFromTitle, isPlaceholderName, replaceTitle, titleFromDoc } from "./title";
import { ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES, attachmentName, imageMarkdown, isImageFile, relativePath } from "./attachments";

export type ThemePref = "system" | "light" | "dark";
export type SaveState = "idle" | "saving" | "saved" | "error";
export type LineWidth = "narrow" | "medium" | "wide";
export type FontFamily = "sans" | "serif" | "mono";

/** Caret and scroll position remembered per note. */
export interface ViewState {
  anchor: number;
  head: number;
  scrollTop: number;
}

/** Where to put the caret after a note opens (search hits, heading links). */
export interface Jump {
  path: string;
  /** 1-based line to jump to. */
  line?: number;
  /** Text to select on that line (case-insensitive). */
  query?: string;
  /** Absolute document position. */
  pos?: number;
  /** Heading slug (for `[text](#heading)` links). */
  heading?: string;
  /** Briefly highlight the target (default true). */
  flash?: boolean;
}

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
  leaving?: boolean;
}

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

const SETTINGS_KEY = "margin.settings.v1";

export const FONT_SIZE_DEFAULT = 16;
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;
export const SIDEBAR_WIDTH_DEFAULT = 240;
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 420;
const HISTORY_MAX = 100;
const RECENT_MAX = 30;
const VIEW_STATES_MAX = 100;

interface Settings {
  theme: ThemePref;
  vaultRoot: string | null;
  lastNote: string | null;
  sidebarOpen: boolean;
  outlineOpen: boolean;
  expandedDirs: Record<string, boolean>;
  sidebarWidth: number;
  fontSize: number;
  lineWidth: LineWidth;
  fontFamily: FontFamily;
  /** Use the whole editor area instead of a centered column. */
  fullWidth: boolean;
  /** The caret glides between positions instead of jumping. */
  smoothCaret: boolean;
  /** Editing a note's first heading renames its file (and vice versa). */
  titleSync: boolean;
  focusMode: boolean;
  typewriter: boolean;
  recent: string[];
  /** Vaults opened before, most recent first, offered on the welcome screen. */
  recentVaults: string[];
  viewStates: Record<string, ViewState>;
}

const defaultSettings: Settings = {
  theme: "system",
  vaultRoot: null,
  lastNote: null,
  sidebarOpen: true,
  outlineOpen: true,
  expandedDirs: {},
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  fontSize: FONT_SIZE_DEFAULT,
  lineWidth: "medium",
  fontFamily: "sans",
  fullWidth: false,
  smoothCaret: false,
  titleSync: true,
  focusMode: false,
  typewriter: false,
  recent: [],
  recentVaults: [],
  viewStates: {},
};

function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // ignore
  }
  return { ...defaultSettings };
}

function saveSettings(s: Settings) {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Replace `from` (or anything under it) with the same path under `to`. */
function remap(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (isWithin(path, from)) return to + path.slice(from.length);
  return path;
}

export interface AppState {
  backend: VaultBackend | null;
  ready: boolean;
  vaultRoot: string | null;
  tree: FileNode[];
  activePath: string | null;
  /** Content of the active note as last loaded from the backend. */
  content: string | null;
  /** Bumped whenever `content` should replace the editor document. */
  contentVersion: number;
  dirty: boolean;
  saveState: SaveState;
  /** The active note changed on disk while there were unsaved edits. */
  externalChange: boolean;
  theme: ThemePref;
  sidebarOpen: boolean;
  outlineOpen: boolean;
  sidebarWidth: number;
  fontSize: number;
  lineWidth: LineWidth;
  fontFamily: FontFamily;
  fullWidth: boolean;
  smoothCaret: boolean;
  titleSync: boolean;
  focusMode: boolean;
  typewriter: boolean;
  /** Whether each panel fits beside a comfortably wide editor right now. */
  sidebarFits: boolean;
  outlineFits: boolean;
  /** A panel that doesn't fit can still be opened over the editor. */
  sidebarPeek: boolean;
  outlinePeek: boolean;
  paletteOpen: boolean;
  /** Text the palette starts with; ">" opens it in command mode. */
  paletteSeed: string;
  paletteVersion: number;
  settingsOpen: boolean;
  headings: Heading[];
  /** Position of the heading whose section contains the caret, or null. */
  currentHeading: number | null;
  wordCount: number;
  /** Words in the current selection, 0 when the selection is empty. */
  selectionWords: number;
  expandedDirs: Record<string, boolean>;
  toasts: Toast[];
  confirmRequest: ConfirmRequest | null;
  editor: EditorView | null;
  renaming: string | null;
  history: string[];
  historyIndex: number;
  recent: string[];
  recentVaults: string[];
  viewStates: Record<string, ViewState>;
  jump: Jump | null;
  jumpVersion: number;

  init(): Promise<void>;
  openVault(root?: string): Promise<void>;
  /** Open a vault from the welcome screen's list, dropping it from the list if it's gone. */
  openRecentVault(root: string): Promise<void>;
  /** Ask where to make a new vault, open it, and start its first note. */
  createVault(): Promise<void>;
  forgetVault(root: string): void;
  closeVault(): void;
  refreshTree(): Promise<void>;
  openNote(path: string, opts?: { history?: boolean; jump?: Omit<Jump, "path"> }): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  updateContent(doc: string): void;
  flushSave(): Promise<void>;
  /** With a name, the note is created under that name; without one it starts as "Untitled" in rename mode. */
  /** Create a note in `dir`, or by default in the open note's folder (the vault's top level if none is open). */
  createNote(dir?: string, name?: string): Promise<string | null>;
  createFolder(dir?: string): Promise<string | null>;
  /**
   * Copy images into the vault's attachments folder and return the Markdown
   * that embeds each one in the open note. Files that aren't images, or are
   * too large, are skipped with a message.
   */
  saveImages(files: File[]): Promise<string[]>;
  /** `updateHeading: false` skips retitling the note (used when the title itself drove the rename). */
  renamePath(path: string, newName: string, opts?: { updateHeading?: boolean }): Promise<void>;
  /** Rename the open note after its title if the two were in sync. Runs automatically after edits. */
  syncTitle(): Promise<void>;
  movePath(from: string, toDir: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  copyPath(path: string): Promise<void>;
  reloadFromDisk(): Promise<void>;
  keepLocal(): void;
  setTheme(theme: ThemePref): void;
  cycleTheme(): void;
  toggleSidebar(): void;
  toggleOutline(): void;
  setSidebarWidth(width: number): void;
  setFontSize(size: number): void;
  bumpFontSize(delta: number): void;
  setLineWidth(width: LineWidth): void;
  setFontFamily(family: FontFamily): void;
  setFullWidth(on: boolean): void;
  setSmoothCaret(on: boolean): void;
  setTitleSync(on: boolean): void;
  setFits(sidebarFits: boolean, outlineFits: boolean): void;
  closePeeks(): void;
  setFocusMode(on: boolean): void;
  setTypewriter(on: boolean): void;
  openPalette(seed?: string): void;
  closePalette(): void;
  /** Kept for the existing keyboard shortcut and tests. */
  setQuickOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setHeadings(headings: Heading[]): void;
  setCaret(head: number): void;
  setWordCount(count: number): void;
  setSelectionWords(count: number): void;
  toggleDir(path: string): void;
  setEditor(view: EditorView | null): void;
  setRenaming(path: string | null): void;
  saveViewState(path: string, state: ViewState): void;
  pushToast(message: string, kind?: Toast["kind"]): number;
  dismissToast(id: number): void;
  askConfirm(request: ConfirmRequest): Promise<boolean>;
  resolveConfirm(ok: boolean): void;
}

// Save scheduling lives outside the store so it never triggers renders.
let latestDoc: string | null = null;
let savedDoc: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unwatch: (() => void) | null = null;
let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;
let initPromise: Promise<void> | null = null;
/** The open note's title as of its last load or rename; edits are compared against it. */
let syncedTitle: string | null = null;
let titleTimer: ReturnType<typeof setTimeout> | null = null;
let confirmResolver: ((ok: boolean) => void) | null = null;

export const SAVE_DELAY_MS = 500;
/** How many vaults the welcome screen remembers. */
export const RECENT_VAULTS_MAX = 6;
/** Wait for a pause in typing before renaming a note after its title. */
export const TITLE_SYNC_MS = 700;
export const TOAST_MS = { info: 3500, error: 7000 } as const;
export const TOAST_EXIT_MS = 200;

export const useStore = create<AppState>((set, get) => {
  const settings = loadSettings();

  const persist = () => {
    const s = get();
    saveSettings({
      theme: s.theme,
      vaultRoot: s.vaultRoot,
      lastNote: s.activePath,
      sidebarOpen: s.sidebarOpen,
      outlineOpen: s.outlineOpen,
      expandedDirs: s.expandedDirs,
      sidebarWidth: s.sidebarWidth,
      fontSize: s.fontSize,
      lineWidth: s.lineWidth,
      fontFamily: s.fontFamily,
      fullWidth: s.fullWidth,
      smoothCaret: s.smoothCaret,
      titleSync: s.titleSync,
      focusMode: s.focusMode,
      typewriter: s.typewriter,
      recent: s.recent,
      recentVaults: s.recentVaults,
      viewStates: s.viewStates,
    });
  };

  const fail = (message: string, e: unknown) => {
    get().pushToast(`${message}: ${e instanceof Error ? e.message : String(e)}`, "error");
  };

  const scheduleTreeRefresh = () => {
    if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
    treeRefreshTimer = setTimeout(() => {
      treeRefreshTimer = null;
      void get().refreshTree();
    }, 150);
  };

  const onWatchEvent = (event: WatchEvent) => {
    const { activePath, dirty } = get();
    if (event.kind !== "modify") scheduleTreeRefresh();
    if (activePath && event.paths.includes(activePath)) {
      if (event.kind === "remove") {
        scheduleTreeRefresh();
        return;
      }
      if (dirty) set({ externalChange: true });
      else void get().reloadFromDisk();
    }
  };

  /** A file or folder moved: rewrite every remembered path that pointed into it. */
  const remapPaths = (from: string, to: string) => {
    set((s) => {
      const viewStates: Record<string, ViewState> = {};
      for (const [p, v] of Object.entries(s.viewStates)) viewStates[remap(p, from, to)] = v;
      const expandedDirs: Record<string, boolean> = {};
      for (const [p, v] of Object.entries(s.expandedDirs)) expandedDirs[remap(p, from, to)] = v;
      return {
        activePath: s.activePath ? remap(s.activePath, from, to) : null,
        history: s.history.map((p) => remap(p, from, to)),
        recent: s.recent.map((p) => remap(p, from, to)),
        viewStates,
        expandedDirs,
        jump: s.jump ? { ...s.jump, path: remap(s.jump.path, from, to) } : null,
      };
    });
    persist();
  };

  /** A file or folder was deleted: forget it everywhere. */
  const forgetPaths = (path: string) => {
    set((s) => {
      const keep = (p: string) => !isWithin(p, path);
      const history: string[] = [];
      let historyIndex = s.historyIndex;
      s.history.forEach((p, i) => {
        if (keep(p)) history.push(p);
        else if (i <= s.historyIndex) historyIndex--;
      });
      // Collapse neighbours that became duplicates.
      const deduped: string[] = [];
      history.forEach((p, i) => {
        if (deduped[deduped.length - 1] === p) {
          if (i <= historyIndex) historyIndex--;
        } else deduped.push(p);
      });
      const viewStates = Object.fromEntries(Object.entries(s.viewStates).filter(([p]) => keep(p)));
      return {
        history: deduped,
        historyIndex: clamp(historyIndex, deduped.length ? 0 : -1, deduped.length - 1),
        recent: s.recent.filter(keep),
        viewStates,
      };
    });
    persist();
  };

  const loadNote = async (path: string) => {
    const backend = get().backend;
    if (!backend) return false;
    // Finish a pending title rename for the note we're leaving.
    if (titleTimer) await get().syncTitle();
    await get().flushSave();
    try {
      const content = await backend.readNote(path);
      latestDoc = content;
      savedDoc = content;
      syncedTitle = titleFromDoc(content);
      set((s) => ({
        activePath: path,
        content,
        contentVersion: s.contentVersion + 1,
        dirty: false,
        externalChange: false,
        saveState: "idle",
        renaming: s.renaming === path ? path : null,
        selectionWords: 0,
        recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, RECENT_MAX),
      }));
      persist();
      return true;
    } catch (e) {
      fail(`Could not open ${stripExtension(basename(path))}`, e);
      return false;
    }
  };

  /** After a file rename, retitle the note if its heading matched the old name. */
  const retitle = async (path: string, oldStem: string, newStem: string) => {
    const { activePath, editor, backend } = get();
    if (!backend) return;
    const apply = (doc: string, c: { from: number; to: number; insert: string }) => doc.slice(0, c.from) + c.insert + doc.slice(c.to);
    if (path === activePath) {
      const doc = editor ? editor.state.doc.toString() : latestDoc;
      if (doc === null) return;
      const title = titleFromDoc(doc);
      if (title === null || fileNameFromTitle(title) !== oldStem) return;
      const change = replaceTitle(doc, newStem)!;
      syncedTitle = newStem;
      if (editor) editor.dispatch({ changes: change, userEvent: "input.rename" });
      else get().updateContent(apply(doc, change));
      return;
    }
    try {
      const content = await backend.readNote(path);
      const title = titleFromDoc(content);
      if (title === null || fileNameFromTitle(title) !== oldStem) return;
      await backend.writeNote(path, apply(content, replaceTitle(content, newStem)!));
    } catch (e) {
      fail("Could not update the note's title", e);
    }
  };

  const navigateHistory = async (delta: -1 | 1) => {
    const { history, historyIndex } = get();
    let i = historyIndex + delta;
    while (i >= 0 && i < history.length) {
      const path = history[i];
      if (flattenFiles(get().tree).some((f) => f.path === path)) {
        set({ historyIndex: i });
        if (path !== get().activePath) await loadNote(path);
        return;
      }
      i += delta;
    }
  };

  return {
    backend: null,
    ready: false,
    vaultRoot: null,
    tree: [],
    activePath: null,
    content: null,
    contentVersion: 0,
    dirty: false,
    saveState: "idle",
    externalChange: false,
    theme: settings.theme,
    sidebarOpen: settings.sidebarOpen,
    outlineOpen: settings.outlineOpen,
    sidebarWidth: clamp(settings.sidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
    fontSize: clamp(settings.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
    lineWidth: settings.lineWidth,
    fontFamily: settings.fontFamily,
    fullWidth: settings.fullWidth,
    smoothCaret: settings.smoothCaret,
    titleSync: settings.titleSync,
    focusMode: settings.focusMode,
    typewriter: settings.typewriter,
    sidebarFits: true,
    outlineFits: true,
    sidebarPeek: false,
    outlinePeek: false,
    paletteOpen: false,
    paletteSeed: "",
    paletteVersion: 0,
    settingsOpen: false,
    headings: [],
    currentHeading: null,
    wordCount: 0,
    selectionWords: 0,
    expandedDirs: settings.expandedDirs,
    toasts: [],
    confirmRequest: null,
    editor: null,
    renaming: null,
    history: [],
    historyIndex: -1,
    recent: settings.recent,
    recentVaults: settings.recentVaults,
    viewStates: settings.viewStates,
    jump: null,
    jumpVersion: 0,

    init() {
      // React StrictMode runs effects twice in development; start up only once.
      initPromise ??= (async () => {
        const backend = await getBackend();
        set({ backend });
        if (backend.kind === "memory") {
          await get().openVault((await backend.pickVault()) ?? undefined);
        } else if (settings.vaultRoot) {
          try {
            await get().openVault(settings.vaultRoot);
          } catch (e) {
            fail("Could not open the last vault", e);
          }
        }
        const { tree, activePath } = get();
        const files = flattenFiles(tree);
        // Drop remembered paths that no longer exist.
        const exists = new Set(files.map((f) => f.path));
        set((s) => ({
          recent: s.recent.filter((p) => exists.has(p)),
          viewStates: Object.fromEntries(Object.entries(s.viewStates).filter(([p]) => exists.has(p))),
        }));
        const preferred = settings.lastNote ?? (backend.kind === "memory" ? files.find((f) => /Editor design notes/.test(f.name))?.path : null);
        if (!activePath && preferred && exists.has(preferred)) {
          await get().openNote(preferred);
        } else if (!activePath && files.length) {
          await get().openNote(files[0].path);
        }
        set({ ready: true });
      })();
      return initPromise;
    },

    async openVault(root) {
      const backend = get().backend ?? (await getBackend());
      let chosen = root ?? null;
      if (!chosen) chosen = await backend.pickVault();
      if (!chosen) return;
      await get().flushSave();
      unwatch?.();
      unwatch = null;
      const tree = await backend.listTree(chosen);
      // Expand top-level folders by default.
      const expandedDirs = { ...get().expandedDirs };
      for (const n of tree) if (n.kind === "dir" && expandedDirs[n.path] === undefined) expandedDirs[n.path] = true;
      const switching = get().vaultRoot !== null && get().vaultRoot !== chosen;
      set({
        vaultRoot: chosen,
        tree,
        expandedDirs,
        activePath: null,
        content: null,
        dirty: false,
        externalChange: false,
        headings: [],
        wordCount: 0,
        history: [],
        historyIndex: -1,
        recentVaults: [chosen, ...get().recentVaults.filter((p) => p !== chosen)].slice(0, RECENT_VAULTS_MAX),
        ...(switching ? { recent: [], viewStates: {} } : {}),
      });
      try {
        unwatch = await backend.watch(chosen, onWatchEvent);
      } catch (e) {
        console.warn("watch failed", e);
      }
      persist();
    },

    async openRecentVault(root) {
      try {
        await get().openVault(root);
      } catch (e) {
        get().forgetVault(root);
        fail(`Could not open ${basename(root) || root}`, e);
      }
    },

    async createVault() {
      const backend = get().backend;
      if (!backend) return;
      try {
        const root = await backend.createVault();
        if (!root) return;
        await get().openVault(root);
        await get().createNote();
      } catch (e) {
        fail("Could not create the vault", e);
      }
    },

    forgetVault(root) {
      set((s) => ({ recentVaults: s.recentVaults.filter((p) => p !== root) }));
      persist();
    },

    closeVault() {
      unwatch?.();
      unwatch = null;
      set({ vaultRoot: null, tree: [], activePath: null, content: null, dirty: false, headings: [], wordCount: 0, history: [], historyIndex: -1 });
      persist();
    },

    async refreshTree() {
      const { backend, vaultRoot } = get();
      if (!backend || !vaultRoot) return;
      try {
        const tree = await backend.listTree(vaultRoot);
        set({ tree });
      } catch (e) {
        fail("Could not read the vault", e);
      }
    },

    async openNote(path, opts = {}) {
      const { backend, activePath } = get();
      if (!backend) return;
      const jump = opts.jump ? { ...opts.jump, path } : null;
      if (path === activePath) {
        if (jump) set((s) => ({ jump, jumpVersion: s.jumpVersion + 1 }));
        return;
      }
      if (jump) set({ jump });
      const ok = await loadNote(path);
      if (!ok) {
        if (jump) set({ jump: null });
        return;
      }
      if (opts.history !== false) {
        set((s) => {
          if (s.history[s.historyIndex] === path) return {};
          const history = [...s.history.slice(0, s.historyIndex + 1), path].slice(-HISTORY_MAX);
          return { history, historyIndex: history.length - 1 };
        });
      }
    },

    goBack() {
      return navigateHistory(-1);
    },

    goForward() {
      return navigateHistory(1);
    },

    updateContent(doc) {
      latestDoc = doc;
      const dirty = doc !== savedDoc;
      if (dirty !== get().dirty) set({ dirty });
      if (!dirty) return;
      if (get().titleSync) {
        if (titleTimer) clearTimeout(titleTimer);
        titleTimer = setTimeout(() => void get().syncTitle(), TITLE_SYNC_MS);
      }
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void get().flushSave();
      }, SAVE_DELAY_MS);
    },

    async flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const { backend, activePath } = get();
      if (!backend || !activePath || latestDoc === null || latestDoc === savedDoc) return;
      const doc = latestDoc;
      set({ saveState: "saving" });
      try {
        await backend.writeNote(activePath, doc);
        savedDoc = doc;
        set({ saveState: "saved", dirty: latestDoc !== savedDoc, content: doc });
      } catch (e) {
        set({ saveState: "error" });
        fail(`Could not save ${stripExtension(basename(activePath))}`, e);
      }
    },

    async createNote(dir, name) {
      const { backend, vaultRoot, activePath } = get();
      if (!backend || !vaultRoot) return null;
      const openDir = activePath ? dirname(activePath) : null;
      const target = dir ?? (openDir && isWithin(openDir, vaultRoot) ? openDir : vaultRoot);
      try {
        const clean = name?.trim().replace(/[\\/]/g, "-");
        const path = await backend.createNote(target, clean || "Untitled");
        await get().refreshTree();
        if (target !== vaultRoot) set((s) => ({ expandedDirs: { ...s.expandedDirs, [target]: true } }));
        if (!clean && get().titleSync) {
          // Open with the placeholder title selected: typing names the note.
          await get().openNote(path, { jump: { line: 1, query: stripExtension(basename(path)), flash: false } });
        } else {
          await get().openNote(path);
          if (!clean) set({ renaming: path });
        }
        return path;
      } catch (e) {
        fail("Could not create a note", e);
        return null;
      }
    },

    async saveImages(files) {
      const { backend, vaultRoot, activePath } = get();
      if (!backend || !vaultRoot || !activePath) return [];
      const snippets: string[] = [];
      const now = new Date();
      for (const file of files) {
        if (!isImageFile(file)) continue;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          get().pushToast(`${file.name || "That image"} is too large to add (over ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB).`, "error");
          continue;
        }
        try {
          const data = new Uint8Array(await file.arrayBuffer());
          const saved = await backend.saveAttachment(joinPath(vaultRoot, ATTACHMENTS_DIR), attachmentName(file, now), data);
          snippets.push(imageMarkdown(relativePath(dirname(activePath), saved), basename(saved)));
        } catch (e) {
          fail("Could not add the image", e);
        }
      }
      return snippets;
    },

    async createFolder(dir) {
      const { backend, vaultRoot } = get();
      if (!backend || !vaultRoot) return null;
      try {
        const parent = dir ?? vaultRoot;
        const path = await backend.createFolder(parent, "New folder");
        await get().refreshTree();
        set((s) => ({ expandedDirs: { ...s.expandedDirs, [parent]: true, [path]: true }, renaming: path }));
        persist();
        return path;
      } catch (e) {
        fail("Could not create a folder", e);
        return null;
      }
    },

    async renamePath(path, newName, opts = {}) {
      const { backend, activePath } = get();
      if (!backend) return;
      const clean = newName.trim().replace(/[\\/]/g, "");
      if (!clean) {
        set({ renaming: null });
        return;
      }
      const isFile = /\.(md|markdown)$/i.test(basename(path));
      const finalName = isFile && !/\.(md|markdown)$/i.test(clean) ? `${clean}.md` : clean;
      const to = joinPath(dirname(path), finalName);
      if (to === path) {
        set({ renaming: null });
        return;
      }
      try {
        if (activePath && isWithin(activePath, path)) await get().flushSave();
        await backend.renamePath(path, to);
        remapPaths(path, to);
        await get().refreshTree();
        set({ renaming: null });
        if (isFile && get().titleSync && opts.updateHeading !== false) {
          await retitle(to, stripExtension(basename(path)), stripExtension(basename(to)));
        }
      } catch (e) {
        set({ renaming: null });
        fail("Could not rename", e);
      }
    },

    async syncTitle() {
      if (titleTimer) {
        clearTimeout(titleTimer);
        titleTimer = null;
      }
      const { activePath, titleSync, backend } = get();
      if (!titleSync || !activePath || !backend || latestDoc === null) return;
      const title = titleFromDoc(latestDoc);
      // No heading, or an empty one while the user retypes it: keep the current name.
      if (title === null || fileNameFromTitle(title) === "" || title === syncedTitle) return;
      const stem = stripExtension(basename(activePath));
      // Only follow the title if the name already did; a deliberately different name stays.
      const wasInSync = isPlaceholderName(stem) || (syncedTitle !== null && fileNameFromTitle(syncedTitle) === stem);
      syncedTitle = title;
      if (!wasInSync) return;
      const wanted = fileNameFromTitle(title);
      if (wanted === stem) return;
      const dir = dirname(activePath);
      const taken = new Set(
        flattenFiles(get().tree)
          .filter((f) => dirname(f.path) === dir && f.path !== activePath)
          .map((f) => stripExtension(f.name).toLowerCase()),
      );
      let name = wanted;
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${wanted} ${i}`;
      if (name !== stem) await get().renamePath(activePath, name, { updateHeading: false });
    },

    async movePath(from, toDir) {
      const { backend, activePath } = get();
      if (!backend) return;
      const to = joinPath(toDir, basename(from));
      if (to === from || dirname(from) === toDir) return;
      if (isWithin(toDir, from)) {
        get().pushToast("A folder can't be moved into itself.", "error");
        return;
      }
      try {
        if (activePath && isWithin(activePath, from)) await get().flushSave();
        await backend.renamePath(from, to);
        remapPaths(from, to);
        set((s) => ({ expandedDirs: { ...s.expandedDirs, [toDir]: true } }));
        await get().refreshTree();
        persist();
      } catch (e) {
        fail(`Could not move ${stripExtension(basename(from))}`, e);
      }
    },

    async deletePath(path) {
      const { backend, activePath } = get();
      if (!backend) return;
      const wasActive = !!activePath && isWithin(activePath, path);
      try {
        if (wasActive) {
          latestDoc = null;
          savedDoc = null;
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = null;
          set({ activePath: null, content: null, dirty: false, headings: [], wordCount: 0, selectionWords: 0 });
        }
        await backend.deletePath(path);
        forgetPaths(path);
        await get().refreshTree();
        const name = stripExtension(basename(path));
        get().pushToast(backend.kind === "tauri" ? `Moved “${name}” to the trash` : `Deleted “${name}”`);
        if (wasActive) {
          // Land on the most recent note that still exists.
          const exists = new Set(flattenFiles(get().tree).map((f) => f.path));
          const next = get().recent.find((p) => exists.has(p));
          if (next) await get().openNote(next);
        }
        persist();
      } catch (e) {
        fail("Could not delete", e);
      }
    },

    async revealPath(path) {
      const { backend } = get();
      if (!backend?.revealPath) return;
      try {
        await backend.revealPath(path);
      } catch (e) {
        fail("Could not show the file", e);
      }
    },

    async copyPath(path) {
      try {
        await navigator.clipboard.writeText(path);
        get().pushToast("Copied path");
      } catch (e) {
        fail("Could not copy the path", e);
      }
    },

    async reloadFromDisk() {
      const { backend, activePath } = get();
      if (!backend || !activePath) return;
      try {
        const content = await backend.readNote(activePath);
        if (content === savedDoc && content === latestDoc) {
          set({ externalChange: false });
          return;
        }
        latestDoc = content;
        savedDoc = content;
        syncedTitle = titleFromDoc(content);
        set((s) => ({ content, contentVersion: s.contentVersion + 1, dirty: false, externalChange: false }));
      } catch (e) {
        fail(`Could not reload ${stripExtension(basename(activePath))}`, e);
      }
    },

    keepLocal() {
      set({ externalChange: false });
      void get().flushSave();
    },

    setTheme(theme) {
      set({ theme });
      persist();
    },

    cycleTheme() {
      const order: ThemePref[] = ["system", "light", "dark"];
      const next = order[(order.indexOf(get().theme) + 1) % order.length];
      get().setTheme(next);
    },

    toggleSidebar() {
      // In a window too small for the sidebar, toggle it as an overlay instead
      // of changing the saved preference.
      if (!get().sidebarFits) {
        set((s) => ({ sidebarPeek: !s.sidebarPeek, outlinePeek: false }));
        return;
      }
      set((s) => ({ sidebarOpen: !s.sidebarOpen, sidebarPeek: false }));
      persist();
    },

    toggleOutline() {
      if (!get().outlineFits) {
        set((s) => ({ outlinePeek: !s.outlinePeek, sidebarPeek: false }));
        return;
      }
      set((s) => ({ outlineOpen: !s.outlineOpen, outlinePeek: false }));
      persist();
    },

    setFits(sidebarFits, outlineFits) {
      const s = get();
      if (s.sidebarFits === sidebarFits && s.outlineFits === outlineFits) return;
      set({
        sidebarFits,
        outlineFits,
        // An overlay is only needed while the panel doesn't fit.
        sidebarPeek: sidebarFits ? false : s.sidebarPeek,
        outlinePeek: outlineFits ? false : s.outlinePeek,
      });
    },

    closePeeks() {
      if (get().sidebarPeek || get().outlinePeek) set({ sidebarPeek: false, outlinePeek: false });
    },

    setSidebarWidth(width) {
      set({ sidebarWidth: clamp(Math.round(width), SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX) });
      persist();
    },

    setFontSize(size) {
      set({ fontSize: clamp(Math.round(size), FONT_SIZE_MIN, FONT_SIZE_MAX) });
      persist();
    },

    bumpFontSize(delta) {
      get().setFontSize(get().fontSize + delta);
    },

    setLineWidth(lineWidth) {
      set({ lineWidth });
      persist();
    },

    setFontFamily(fontFamily) {
      set({ fontFamily });
      persist();
    },

    setFullWidth(fullWidth) {
      set({ fullWidth });
      persist();
    },

    setSmoothCaret(smoothCaret) {
      set({ smoothCaret });
      persist();
    },

    setTitleSync(titleSync) {
      set({ titleSync });
      persist();
    },

    setFocusMode(focusMode) {
      set({ focusMode });
      persist();
    },

    setTypewriter(typewriter) {
      set({ typewriter });
      persist();
    },

    openPalette(seed = "") {
      set((s) => ({ paletteOpen: true, paletteSeed: seed, paletteVersion: s.paletteVersion + 1, settingsOpen: false }));
    },

    closePalette() {
      set({ paletteOpen: false });
    },

    setQuickOpen(open) {
      if (open) get().openPalette("");
      else get().closePalette();
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open });
    },

    setHeadings(headings) {
      set({ headings });
      const head = get().editor?.state.selection.main.head;
      if (head !== undefined) get().setCaret(head);
    },

    setCaret(head) {
      let current: number | null = null;
      for (const h of get().headings) if (h.pos <= head) current = h.pos;
      if (current !== get().currentHeading) set({ currentHeading: current });
    },

    setWordCount(count) {
      if (count !== get().wordCount) set({ wordCount: count });
    },

    setSelectionWords(count) {
      if (count !== get().selectionWords) set({ selectionWords: count });
    },

    toggleDir(path) {
      set((s) => ({ expandedDirs: { ...s.expandedDirs, [path]: !s.expandedDirs[path] } }));
      persist();
    },

    setEditor(view) {
      set({ editor: view });
    },

    setRenaming(path) {
      set({ renaming: path });
    },

    saveViewState(path, state) {
      set((s) => {
        const next = { ...s.viewStates };
        delete next[path];
        next[path] = state;
        const keys = Object.keys(next);
        for (const k of keys.slice(0, Math.max(0, keys.length - VIEW_STATES_MAX))) delete next[k];
        return { viewStates: next };
      });
      persist();
    },

    pushToast(message, kind = "info") {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts.filter((t) => t.message !== message), { id, message, kind }].slice(-4) }));
      setTimeout(() => get().dismissToast(id), TOAST_MS[kind]);
      return id;
    },

    dismissToast(id) {
      if (!get().toasts.some((t) => t.id === id && !t.leaving)) return;
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_EXIT_MS);
    },

    askConfirm(request) {
      confirmResolver?.(false);
      set({ confirmRequest: request });
      return new Promise<boolean>((resolve) => {
        confirmResolver = resolve;
      });
    },

    resolveConfirm(ok) {
      const resolve = confirmResolver;
      confirmResolver = null;
      set({ confirmRequest: null });
      resolve?.(ok);
    },
  };
});

export function noteTitle(path: string | null): string {
  return path ? stripExtension(basename(path)) : "";
}

/** Path of a note relative to the vault root, split into crumbs. */
export function crumbsFor(vaultRoot: string | null, path: string | null): string[] {
  if (!vaultRoot || !path) return [];
  const rel = path.startsWith(vaultRoot) ? path.slice(vaultRoot.length) : path;
  return rel.split(/[\\/]/).filter(Boolean).map((p, i, arr) => (i === arr.length - 1 ? stripExtension(p) : p));
}

export function canGoBack(s: Pick<AppState, "historyIndex">): boolean {
  return s.historyIndex > 0;
}

export function canGoForward(s: Pick<AppState, "history" | "historyIndex">): boolean {
  return s.historyIndex >= 0 && s.historyIndex < s.history.length - 1;
}

/** Is the sidebar on screen, docked or as an overlay? */
export function sidebarVisible(s: Pick<AppState, "sidebarOpen" | "sidebarFits" | "sidebarPeek">): boolean {
  return (s.sidebarOpen && s.sidebarFits) || s.sidebarPeek;
}

export function outlineVisible(s: Pick<AppState, "outlineOpen" | "outlineFits" | "outlinePeek">): boolean {
  return (s.outlineOpen && s.outlineFits) || s.outlinePeek;
}

/** Narrowest editor area that panels may leave before they hide themselves. */
const MIN_EDITOR_WIDTH = 560;
/** Below this window width the sidebar becomes an overlay. */
const SIDEBAR_DOCK_MIN_WINDOW = 640;
const OUTLINE_WIDTH = 220;

/** Which panels fit beside the editor at a given window width. */
export function panelFits(windowWidth: number, sidebarOpen: boolean, sidebarWidth: number): { sidebarFits: boolean; outlineFits: boolean } {
  const sidebarFits = windowWidth >= SIDEBAR_DOCK_MIN_WINDOW;
  const sidebarSpace = sidebarOpen && sidebarFits ? sidebarWidth : 0;
  return { sidebarFits, outlineFits: windowWidth - sidebarSpace - OUTLINE_WIDTH >= MIN_EDITOR_WIDTH };
}
