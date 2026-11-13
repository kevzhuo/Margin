import { create } from "zustand";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  basename,
  dirname,
  flattenFiles,
  getBackend,
  isMarkdown,
  isPdf,
  isWithin,
  joinPath,
  relativePath,
  stripExtension,
  type FileNode,
  type ImageFile,
  type VaultBackend,
  type WatchEvent,
} from "../backend";
import type { Heading } from "../editor/outline";
import type { TableMenuRequest } from "../editor/tableEdit";
import { fileNameFromTitle, isPlaceholderName, replaceTitle, titleFromDoc } from "./title";
import { ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES, attachmentName, imageMarkdown, isImageFile } from "./attachments";
import { SORT_LABELS, touchFile, type SortBy } from "./treeSort";
import { imageUsage, type ImageUse } from "./attachmentUsage";
import { applyEdits, relinkEdits } from "./relink";

const SORT_KEYS = Object.keys(SORT_LABELS) as SortBy[];

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

/** The vault's images and the notes that use each, for the Attachments window. */
export interface AttachmentScan {
  images: ImageFile[];
  usage: Map<string, ImageUse[]>;
}

/** An entry in a PDF's own table of contents (its bookmarks). */
export interface PdfOutlineItem {
  title: string;
  /** 1-based page it points to. */
  page: number;
  /** Nesting depth, 0 at the top. */
  depth: number;
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
  /** Typed quotes, `--` and `...` become curly quotes, dashes and ellipses. */
  smartTypography: boolean;
  /** How the sidebar orders notes. */
  sortBy: SortBy;
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
  smartTypography: true,
  sortBy: "name",
  titleSync: true,
  focusMode: false,
  typewriter: false,
  recent: [],
  recentVaults: [],
  viewStates: {},
};

/** Settings the store keeps under the same name. `lastNote` is the store's `activePath`, and `vaultRoot` starts empty until the vault opens. */
type StoredSetting = Exclude<keyof Settings, "vaultRoot" | "lastNote">;
const STORED_SETTINGS = (Object.keys(defaultSettings) as (keyof Settings)[]).filter((k): k is StoredSetting => k !== "vaultRoot" && k !== "lastNote");

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

/** The saved settings the store starts with, with anything out of range corrected. */
function initialSettings(saved: Settings): Pick<Settings, StoredSetting> {
  const picked = Object.fromEntries(STORED_SETTINGS.map((k) => [k, saved[k]])) as Pick<Settings, StoredSetting>;
  return {
    ...picked,
    sidebarWidth: clamp(saved.sidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
    fontSize: clamp(saved.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
    sortBy: SORT_KEYS.includes(saved.sortBy) ? saved.sortBy : "name",
  };
}

/** Replace `from` (or anything under it) with the same path under `to`. */
function remap(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (isWithin(path, from)) return to + path.slice(from.length);
  return path;
}

/** Every file and folder in a tree, depth first. */
function allNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((n) => [n, ...allNodes(n.children ?? [])]);
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
  theme: ThemePref;
  sidebarOpen: boolean;
  outlineOpen: boolean;
  sidebarWidth: number;
  fontSize: number;
  lineWidth: LineWidth;
  fontFamily: FontFamily;
  fullWidth: boolean;
  smoothCaret: boolean;
  smartTypography: boolean;
  sortBy: SortBy;
  titleSync: boolean;
  focusMode: boolean;
  typewriter: boolean;
  /** The note reads as a finished page and can't be edited. Not remembered between launches. */
  readingMode: boolean;
  /** PDF zoom, where 1 fits the page to the window's width. */
  pdfZoom: number;
  /** The open PDF's table of contents, shown in the outline panel. */
  pdfOutline: PdfOutlineItem[];
  /** The page in the middle of the PDF viewer. */
  pdfPage: number;
  /** A page the viewer should scroll to; `seq` changes on every request. */
  pdfJump: { page: number; seq: number } | null;
  /** The row and column menu for a right-clicked table, while it's open. */
  tableMenu: TableMenuRequest | null;
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
  attachmentsOpen: boolean;
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
  closeVault(): Promise<void>;
  refreshTree(): Promise<void>;
  openNote(path: string, opts?: { history?: boolean; jump?: Omit<Jump, "path"> }): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  updateContent(doc: string): void;
  flushSave(): Promise<void>;
  /**
   * Create a note in `dir`, or by default in the open note's folder (the
   * vault's top level if none is open). With a name, the note is created under
   * that name; without one it is "Untitled" until you name it.
   */
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
  /**
   * The open note changed on disk. Margin's version always wins: its own saves
   * coming back are ignored, unsaved edits are kept and saved over the file,
   * and a note with nothing unsaved quietly reloads.
   */
  syncFromDisk(): Promise<void>;
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
  setSmartTypography(on: boolean): void;
  setSortBy(by: SortBy): void;
  setReadingMode(on: boolean): void;
  /** Step the PDF zoom in or out, or back to fitting the width (0). */
  zoomPdf(direction: -1 | 0 | 1): void;
  /** Scroll the open PDF to a page. */
  goToPdfPage(page: number): void;
  setTitleSync(on: boolean): void;
  setFits(sidebarFits: boolean, outlineFits: boolean): void;
  closePeeks(): void;
  setFocusMode(on: boolean): void;
  setTypewriter(on: boolean): void;
  openPalette(seed?: string): void;
  closePalette(): void;
  setSettingsOpen(open: boolean): void;
  setAttachmentsOpen(open: boolean): void;
  /** List the vault's images and find which notes use each (the open note as it is now). */
  scanAttachments(): Promise<AttachmentScan | null>;
  /**
   * Copy PDFs dropped from elsewhere into the vault: into `dir`, or the open
   * note's folder. Opens the last one. Resolves to the new paths.
   */
  addPdfs(files: File[], dir?: string): Promise<string[]>;
  /** Move images to the Trash. Resolves to the paths that were moved. */
  trashImages(paths: string[]): Promise<string[]>;
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

/**
 * Saves, renames, moves and deletes run one at a time, in order. Otherwise an
 * autosave could land during a rename and recreate the old file, or two saves
 * could finish out of order and leave the older text on disk.
 */
let fileOps: Promise<unknown> = Promise.resolve();
function serially<T>(op: () => Promise<T>): Promise<T> {
  const run = fileOps.then(op, op);
  fileOps = run.catch(() => {});
  return run;
}

export const SAVE_DELAY_MS = 500;
/** Largest PDF that can be dropped in, in bytes. Bigger ones can still be copied into the folder in Finder. */
export const MAX_PDF_BYTES = 500 * 1024 * 1024;
/** PDF zoom levels, as fractions of the fit-to-width size. */
export const PDF_ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
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
    const stored = Object.fromEntries(STORED_SETTINGS.map((k) => [k, s[k]])) as Pick<Settings, StoredSetting>;
    saveSettings({ ...stored, vaultRoot: s.vaultRoot, lastNote: s.activePath });
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
    const { activePath } = get();
    if (event.kind !== "modify") scheduleTreeRefresh();
    // Any kind of event can mean new text: editors that save by swapping in a
    // new file report a rename or a create. syncFromDisk ignores Margin's own
    // writes and a note that has moved away.
    if (activePath && event.paths.includes(activePath)) void get().syncFromDisk();
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

  /**
   * `from` was renamed or moved to `to`: rewrite relative links in every note
   * so each leads where it did before (see relink.ts). Runs inside the move's
   * turn in the file-operation queue, so nothing else writes notes meanwhile.
   * The open note changes in the editor, keeping its caret and unsaved edits,
   * and outside its undo history (undoing it would only break the links
   * again). Never throws: notes that can't be updated are reported.
   */
  const relinkAfterMove = async (backend: VaultBackend, root: string, from: string, to: string) => {
    let nodes: FileNode[];
    try {
      nodes = allNodes(await backend.listTree(root));
    } catch (e) {
      fail("Could not update links", e);
      return;
    }
    // Everything at `to` was at `from` before: a move never replaces a file.
    const before = (path: string) => remap(path, to, from);
    const existedBefore = new Set(nodes.map((n) => before(n.path)));
    const existed = (path: string) => existedBefore.has(path);
    const move = { from, to };
    let updated = 0;
    const failed: string[] = [];
    const relinkNote = async (path: string) => {
      const edits = (text: string) => relinkEdits(text, before(path), path, move, existed);
      const { activePath, editor } = get();
      if (path === activePath && (editor || latestDoc !== null)) {
        const text = editor ? editor.state.doc.toString() : latestDoc!;
        const changes = edits(text);
        if (!changes.length) return;
        if (editor) editor.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
        else get().updateContent(applyEdits(text, changes));
        updated++;
        return;
      }
      const text = await backend.readNote(path);
      const changes = edits(text);
      if (!changes.length) return;
      await backend.writeNote(path, applyEdits(text, changes));
      updated++;
    };
    await Promise.all(
      nodes
        .filter((n) => n.kind === "file" && isMarkdown(n.name))
        .map((n) => relinkNote(n.path).catch(() => void failed.push(n.path))),
    );
    if (failed.length) {
      const which = failed.length === 1 ? `“${stripExtension(basename(failed[0]))}”` : `${failed.length} notes`;
      get().pushToast(`Could not update links in ${which}`, "error");
    }
    if (updated) get().pushToast(`Updated links in ${updated} ${updated === 1 ? "note" : "notes"}`);
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
      // A PDF has no text to edit or save: the viewer loads the file itself.
      const content = isPdf(path) ? null : await backend.readNote(path);
      latestDoc = content;
      savedDoc = content;
      syncedTitle = content === null ? null : titleFromDoc(content);
      set((s) => ({
        activePath: path,
        content,
        contentVersion: s.contentVersion + 1,
        dirty: false,
        saveState: "idle",
        renaming: s.renaming === path ? path : null,
        selectionWords: 0,
        // The editor fills these in for a note; a PDF has none.
        ...(content === null ? { headings: [], currentHeading: null, wordCount: 0 } : {}),
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
      await serially(() => backend.writeNote(path, apply(content, replaceTitle(content, newStem)!)));
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
    ...initialSettings(settings),
    readingMode: false,
    pdfZoom: 1,
    pdfOutline: [],
    pdfPage: 1,
    pdfJump: null,
    tableMenu: null,
    sidebarFits: true,
    outlineFits: true,
    sidebarPeek: false,
    outlinePeek: false,
    paletteOpen: false,
    paletteSeed: "",
    paletteVersion: 0,
    settingsOpen: false,
    attachmentsOpen: false,
    headings: [],
    currentHeading: null,
    wordCount: 0,
    selectionWords: 0,
    toasts: [],
    confirmRequest: null,
    editor: null,
    renaming: null,
    history: [],
    historyIndex: -1,
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
          await get().openNote((files.find((f) => isMarkdown(f.name)) ?? files[0]).path);
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

    async closeVault() {
      if (titleTimer) await get().syncTitle();
      await get().flushSave();
      latestDoc = savedDoc = null;
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

    flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      // Which note and what text are read when the save's turn comes, after any rename before it.
      return serially(async () => {
        const { backend, activePath } = get();
        if (!backend || !activePath || latestDoc === null || latestDoc === savedDoc) return;
        const doc = latestDoc;
        set({ saveState: "saving" });
        try {
          await backend.writeNote(activePath, doc);
          savedDoc = doc;
          // The watcher skips Margin's own writes, so keep "Last edited" order current here.
          set((s) => ({
            saveState: "saved",
            dirty: latestDoc !== savedDoc,
            content: doc,
            tree: s.sortBy === "modified" ? touchFile(s.tree, activePath, Date.now()) : s.tree,
          }));
        } catch (e) {
          set({ saveState: "error" });
          fail(`Could not save ${stripExtension(basename(activePath))}`, e);
        }
      });
    },

    async createNote(dir, name) {
      const { backend, vaultRoot, activePath } = get();
      if (!backend || !vaultRoot) return null;
      const openDir = activePath ? dirname(activePath) : null;
      const target = dir ?? (openDir && isWithin(openDir, vaultRoot) ? openDir : vaultRoot);
      try {
        const clean = name?.trim().replace(/[\\/]/g, "-");
        const path = await backend.createNote(target, clean || "Untitled");
        // A new note is for writing in.
        set({ readingMode: false });
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
      const { backend, vaultRoot, activePath } = get();
      if (!backend || !vaultRoot) return;
      const clean = newName.trim().replace(/[\\/]/g, "");
      if (!clean) {
        set({ renaming: null });
        return;
      }
      // A note or PDF keeps its kind of file when renamed without an extension.
      const isNote = isMarkdown(basename(path));
      const pdf = isPdf(basename(path));
      const finalName = isNote && !isMarkdown(clean) ? `${clean}.md` : pdf && !isPdf(clean) ? `${clean}.pdf` : clean;
      const to = joinPath(dirname(path), finalName);
      if (to === path) {
        set({ renaming: null });
        return;
      }
      try {
        if (activePath && isWithin(activePath, path)) await get().flushSave();
        await serially(async () => {
          await backend.renamePath(path, to);
          remapPaths(path, to);
          await relinkAfterMove(backend, vaultRoot, path, to);
        });
        await get().refreshTree();
        set({ renaming: null });
        if (isNote && get().titleSync && opts.updateHeading !== false) {
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
      const { backend, vaultRoot, activePath } = get();
      if (!backend || !vaultRoot) return;
      const to = joinPath(toDir, basename(from));
      if (to === from || dirname(from) === toDir) return;
      if (isWithin(toDir, from)) {
        get().pushToast("A folder can't be moved into itself.", "error");
        return;
      }
      try {
        if (activePath && isWithin(activePath, from)) await get().flushSave();
        await serially(async () => {
          await backend.renamePath(from, to);
          remapPaths(from, to);
          await relinkAfterMove(backend, vaultRoot, from, to);
        });
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
        await serially(() => backend.deletePath(path));
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

    async syncFromDisk() {
      const { backend, activePath } = get();
      if (!backend || !activePath) return;
      // A PDF changed by another app: the viewer reloads it.
      if (isPdf(activePath)) {
        set((s) => ({ contentVersion: s.contentVersion + 1 }));
        return;
      }
      let content: string;
      try {
        content = await backend.readNote(activePath);
      } catch {
        // Gone (moved or deleted elsewhere): the tree refresh shows that.
        return;
      }
      // Margin's own save, reported back by the watcher (often after more typing).
      if (content === savedDoc || content === latestDoc) return;
      // Another program changed it. Unsaved edits win and go over the file.
      if (get().dirty) {
        await get().flushSave();
        return;
      }
      latestDoc = content;
      savedDoc = content;
      syncedTitle = titleFromDoc(content);
      set((s) => ({ content, contentVersion: s.contentVersion + 1, dirty: false }));
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

    setSmartTypography(smartTypography) {
      set({ smartTypography });
      persist();
    },

    setSortBy(sortBy) {
      set({ sortBy });
      persist();
    },

    setReadingMode(readingMode) {
      set({ readingMode });
    },

    goToPdfPage(page) {
      set((s) => ({ pdfJump: { page, seq: (s.pdfJump?.seq ?? 0) + 1 } }));
    },

    zoomPdf(direction) {
      const steps = PDF_ZOOM_STEPS;
      const current = get().pdfZoom;
      const next =
        direction === 0
          ? 1
          : direction > 0
            ? (steps.find((z) => z > current + 0.001) ?? steps[steps.length - 1])
            : ([...steps].reverse().find((z) => z < current - 0.001) ?? steps[0]);
      set({ pdfZoom: next });
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

    setSettingsOpen(open) {
      set({ settingsOpen: open });
    },

    setAttachmentsOpen(open) {
      set(open ? { attachmentsOpen: true, paletteOpen: false, settingsOpen: false } : { attachmentsOpen: false });
    },

    async scanAttachments() {
      const { backend, vaultRoot } = get();
      if (!backend || !vaultRoot) return null;
      // The open note's latest text counts, and the list of notes is current.
      await get().flushSave();
      await get().refreshTree();
      // A note that can't be read fails the whole scan rather than make its images look unused.
      const [images, notes] = await Promise.all([
        backend.listImages(vaultRoot),
        Promise.all(
          flattenFiles(get().tree)
            .filter((f) => isMarkdown(f.name))
            .map(async (f) => ({ path: f.path, text: await backend.readNote(f.path) })),
        ),
      ]);
      return { images, usage: imageUsage(vaultRoot, images, notes) };
    },

    async addPdfs(files, dir) {
      const { backend, vaultRoot, activePath } = get();
      if (!backend || !vaultRoot) return [];
      const openDir = activePath ? dirname(activePath) : null;
      const target = dir ?? (openDir && isWithin(openDir, vaultRoot) ? openDir : vaultRoot);
      const added: string[] = [];
      for (const file of files) {
        if (file.size > MAX_PDF_BYTES) {
          get().pushToast(`${file.name} is too large to add (over ${MAX_PDF_BYTES / 1024 / 1024} MB).`, "error");
          continue;
        }
        try {
          const data = new Uint8Array(await file.arrayBuffer());
          const name = isPdf(file.name) ? file.name : `${file.name || "Document"}.pdf`;
          // Never overwrites: a taken name becomes "Paper 2.pdf".
          added.push(await serially(() => backend.saveAttachment(target, name, data)));
        } catch (e) {
          fail(`Could not add ${file.name || "the PDF"}`, e);
        }
      }
      if (!added.length) return added;
      await get().refreshTree();
      if (target !== vaultRoot) set((s) => ({ expandedDirs: { ...s.expandedDirs, [target]: true } }));
      persist();
      get().pushToast(added.length === 1 ? `Added “${basename(added[0])}”` : `Added ${added.length} PDFs`);
      await get().openNote(added[added.length - 1]);
      return added;
    },

    async trashImages(paths) {
      const { backend } = get();
      if (!backend) return [];
      const moved: string[] = [];
      for (const path of paths) {
        try {
          await serially(() => backend.deletePath(path));
          moved.push(path);
        } catch (e) {
          fail(`Could not move ${basename(path)} to the trash`, e);
        }
      }
      if (moved.length) {
        const what = moved.length === 1 ? `“${basename(moved[0])}”` : `${moved.length} images`;
        get().pushToast(backend.kind === "tauri" ? `Moved ${what} to the trash` : `Deleted ${what}`);
      }
      return moved;
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
  const rel = isWithin(path, vaultRoot) ? path.slice(vaultRoot.length) : path;
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
