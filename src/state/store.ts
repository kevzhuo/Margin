import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import {
  basename,
  dirname,
  flattenFiles,
  getBackend,
  joinPath,
  stripExtension,
  type FileNode,
  type VaultBackend,
  type WatchEvent,
} from "../backend";
import type { Heading } from "../editor/outline";

export type ThemePref = "system" | "light" | "dark";
export type SaveState = "idle" | "saving" | "saved" | "error";

const SETTINGS_KEY = "margin.settings.v1";

interface Settings {
  theme: ThemePref;
  vaultRoot: string | null;
  lastNote: string | null;
  sidebarOpen: boolean;
  outlineOpen: boolean;
  expandedDirs: Record<string, boolean>;
}

const defaultSettings: Settings = {
  theme: "system",
  vaultRoot: null,
  lastNote: null,
  sidebarOpen: true,
  outlineOpen: true,
  expandedDirs: {},
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
  quickOpen: boolean;
  headings: Heading[];
  /** Position of the heading whose section contains the caret, or null. */
  currentHeading: number | null;
  wordCount: number;
  expandedDirs: Record<string, boolean>;
  error: string | null;
  editor: EditorView | null;
  renaming: string | null;

  init(): Promise<void>;
  openVault(root?: string): Promise<void>;
  closeVault(): void;
  refreshTree(): Promise<void>;
  openNote(path: string): Promise<void>;
  updateContent(doc: string): void;
  flushSave(): Promise<void>;
  createNote(dir?: string): Promise<string | null>;
  renamePath(path: string, newName: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  reloadFromDisk(): Promise<void>;
  keepLocal(): void;
  setTheme(theme: ThemePref): void;
  cycleTheme(): void;
  toggleSidebar(): void;
  toggleOutline(): void;
  setQuickOpen(open: boolean): void;
  setHeadings(headings: Heading[]): void;
  setCaret(head: number): void;
  setWordCount(count: number): void;
  toggleDir(path: string): void;
  setEditor(view: EditorView | null): void;
  setRenaming(path: string | null): void;
  clearError(): void;
}

// Save scheduling lives outside the store so it never triggers renders.
let latestDoc: string | null = null;
let savedDoc: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unwatch: (() => void) | null = null;
let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export const SAVE_DELAY_MS = 500;

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
    });
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
    quickOpen: false,
    headings: [],
    currentHeading: null,
    wordCount: 0,
    expandedDirs: settings.expandedDirs,
    error: null,
    editor: null,
    renaming: null,

    async init() {
      const backend = await getBackend();
      set({ backend });
      if (backend.kind === "memory") {
        await get().openVault((await backend.pickVault()) ?? undefined);
      } else if (settings.vaultRoot) {
        try {
          await get().openVault(settings.vaultRoot);
        } catch (e) {
          set({ error: `Could not open the last vault: ${String(e)}` });
        }
      }
      const { tree, activePath } = get();
      const files = flattenFiles(tree);
      const preferred = settings.lastNote ?? (backend.kind === "memory" ? files.find((f) => /Editor design notes/.test(f.name))?.path : null);
      if (!activePath && preferred && files.some((f) => f.path === preferred)) {
        await get().openNote(preferred);
      } else if (!activePath && files.length) {
        await get().openNote(files[0].path);
      }
      set({ ready: true });
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
      set({ vaultRoot: chosen, tree, expandedDirs, activePath: null, content: null, dirty: false, externalChange: false, headings: [], wordCount: 0 });
      try {
        unwatch = await backend.watch(chosen, onWatchEvent);
      } catch (e) {
        console.warn("watch failed", e);
      }
      persist();
    },

    closeVault() {
      unwatch?.();
      unwatch = null;
      set({ vaultRoot: null, tree: [], activePath: null, content: null, dirty: false, headings: [], wordCount: 0 });
      persist();
    },

    async refreshTree() {
      const { backend, vaultRoot } = get();
      if (!backend || !vaultRoot) return;
      try {
        const tree = await backend.listTree(vaultRoot);
        set({ tree });
      } catch (e) {
        set({ error: `Could not read the vault: ${String(e)}` });
      }
    },

    async openNote(path) {
      const { backend, activePath } = get();
      if (!backend) return;
      if (path === activePath) return;
      await get().flushSave();
      try {
        const content = await backend.readNote(path);
        latestDoc = content;
        savedDoc = content;
        set((s) => ({ activePath: path, content, contentVersion: s.contentVersion + 1, dirty: false, externalChange: false, saveState: "idle", renaming: null }));
        persist();
      } catch (e) {
        set({ error: `Could not open ${basename(path)}: ${String(e)}` });
      }
    },

    updateContent(doc) {
      latestDoc = doc;
      const dirty = doc !== savedDoc;
      if (dirty !== get().dirty) set({ dirty });
      if (!dirty) return;
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
        set({ saveState: "error", error: `Could not save ${basename(activePath)}: ${String(e)}` });
      }
    },

    async createNote(dir) {
      const { backend, vaultRoot } = get();
      if (!backend || !vaultRoot) return null;
      try {
        const path = await backend.createNote(dir ?? vaultRoot, "Untitled");
        await get().refreshTree();
        if (dir) set((s) => ({ expandedDirs: { ...s.expandedDirs, [dir]: true } }));
        await get().openNote(path);
        set({ renaming: path });
        return path;
      } catch (e) {
        set({ error: `Could not create a note: ${String(e)}` });
        return null;
      }
    },

    async renamePath(path, newName) {
      const { backend, activePath } = get();
      if (!backend) return;
      const clean = newName.trim().replace(/[\\/]/g, "");
      if (!clean) {
        set({ renaming: null });
        return;
      }
      const isFile = /\.md$/i.test(basename(path)) || !get().tree.length;
      const finalName = isFile && !/\.(md|markdown)$/i.test(clean) ? `${clean}.md` : clean;
      const to = joinPath(dirname(path), finalName);
      if (to === path) {
        set({ renaming: null });
        return;
      }
      try {
        if (activePath === path) await get().flushSave();
        await backend.renamePath(path, to);
        await get().refreshTree();
        if (activePath === path) {
          set({ activePath: to });
          persist();
        } else if (activePath && activePath.startsWith(path + "/")) {
          set({ activePath: joinPath(to, activePath.slice(path.length + 1)) });
        }
        set({ renaming: null });
      } catch (e) {
        set({ error: `Could not rename: ${String(e)}`, renaming: null });
      }
    },

    async deletePath(path) {
      const { backend, activePath } = get();
      if (!backend) return;
      try {
        if (activePath === path || (activePath && activePath.startsWith(path + "/"))) {
          latestDoc = null;
          savedDoc = null;
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = null;
          set({ activePath: null, content: null, dirty: false, headings: [], wordCount: 0 });
        }
        await backend.deletePath(path);
        await get().refreshTree();
        persist();
      } catch (e) {
        set({ error: `Could not delete: ${String(e)}` });
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
        set((s) => ({ content, contentVersion: s.contentVersion + 1, dirty: false, externalChange: false }));
      } catch (e) {
        set({ error: `Could not reload ${basename(activePath)}: ${String(e)}` });
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
      set((s) => ({ sidebarOpen: !s.sidebarOpen }));
      persist();
    },

    toggleOutline() {
      set((s) => ({ outlineOpen: !s.outlineOpen }));
      persist();
    },

    setQuickOpen(open) {
      set({ quickOpen: open });
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

    clearError() {
      set({ error: null });
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
