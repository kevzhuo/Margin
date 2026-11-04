import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ROOT, MemoryBackend } from "../backend/memory";
import type { WatchEvent } from "../backend/types";

const R = DEMO_ROOT;
const DESIGN = `${R}/Projects/Editor design notes.md`;
const ROADMAP = `${R}/Projects/Roadmap.md`;

class FakeBackend extends MemoryBackend {
  watchers: ((e: WatchEvent) => void)[] = [];
  writes: [string, string][] = [];
  override async watch(_root: string, onEvent: (e: WatchEvent) => void) {
    this.watchers.push(onEvent);
    return () => {
      this.watchers = this.watchers.filter((l) => l !== onEvent);
    };
  }
  override async writeNote(path: string, content: string) {
    this.writes.push([path, content]);
    await super.writeNote(path, content);
  }
  fire(e: WatchEvent) {
    for (const l of this.watchers) l(e);
  }
}

type Store = typeof import("./store");

let backend: FakeBackend;
let mod: Store;

async function fresh() {
  vi.resetModules();
  localStorage.clear();
  backend = new FakeBackend();
  window.__MARGIN_BACKEND__ = backend;
  mod = await import("./store");
  await mod.useStore.getState().init();
  return mod.useStore;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete window.__MARGIN_BACKEND__;
});

describe("init", () => {
  it("opens the demo vault and the design notes first", async () => {
    const store = await fresh();
    const s = store.getState();
    expect(s.ready).toBe(true);
    expect(s.vaultRoot).toBe(R);
    expect(s.activePath).toBe(DESIGN);
    expect(s.content?.startsWith("# Editor design notes")).toBe(true);
    expect(s.tree.map((n) => n.name)).toEqual(["Journal", "Projects", "Reading", "Templates", "Inbox.md"]);
    expect(s.expandedDirs[`${R}/Projects`]).toBe(true);
  });
  it("reopens the last note from settings", async () => {
    let store = await fresh();
    await store.getState().openNote(ROADMAP);
    expect(JSON.parse(localStorage.getItem("margin.settings.v1")!).lastNote).toBe(ROADMAP);
    // keep settings but reset the module
    vi.resetModules();
    window.__MARGIN_BACKEND__ = backend;
    mod = await import("./store");
    store = mod.useStore;
    await store.getState().init();
    expect(store.getState().activePath).toBe(ROADMAP);
  });
});

describe("autosave", () => {
  it("marks dirty and writes after the delay", async () => {
    const store = await fresh();
    store.getState().updateContent("# changed");
    expect(store.getState().dirty).toBe(true);
    expect(backend.writes.length).toBe(0);
    await vi.advanceTimersByTimeAsync(mod.SAVE_DELAY_MS + 10);
    expect(backend.writes).toEqual([[DESIGN, "# changed"]]);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().saveState).toBe("saved");
    expect(await backend.readNote(DESIGN)).toBe("# changed");
  });
  it("coalesces rapid edits into one write", async () => {
    const store = await fresh();
    store.getState().updateContent("a");
    await vi.advanceTimersByTimeAsync(200);
    store.getState().updateContent("ab");
    await vi.advanceTimersByTimeAsync(200);
    store.getState().updateContent("abc");
    await vi.advanceTimersByTimeAsync(mod.SAVE_DELAY_MS + 10);
    expect(backend.writes).toEqual([[DESIGN, "abc"]]);
  });
  it("is not dirty when the text returns to the saved version", async () => {
    const store = await fresh();
    const original = store.getState().content!;
    store.getState().updateContent(original + "x");
    expect(store.getState().dirty).toBe(true);
    store.getState().updateContent(original);
    expect(store.getState().dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(mod.SAVE_DELAY_MS + 10);
    expect(backend.writes.length).toBe(0);
  });
  it("flushes a pending save before opening another note", async () => {
    const store = await fresh();
    store.getState().updateContent("pending");
    await store.getState().openNote(ROADMAP);
    expect(backend.writes).toEqual([[DESIGN, "pending"]]);
    expect(store.getState().activePath).toBe(ROADMAP);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().content?.startsWith("# Roadmap")).toBe(true);
  });
  it("flushSave is a no-op without edits", async () => {
    const store = await fresh();
    await store.getState().flushSave();
    expect(backend.writes.length).toBe(0);
  });
});

describe("external changes", () => {
  it("reloads a clean note when it changes on disk", async () => {
    const store = await fresh();
    const before = store.getState().contentVersion;
    await backend.writeNote(DESIGN, "# from disk");
    backend.fire({ kind: "modify", paths: [DESIGN] });
    await vi.advanceTimersByTimeAsync(10);
    expect(store.getState().content).toBe("# from disk");
    expect(store.getState().contentVersion).toBe(before + 1);
    expect(store.getState().externalChange).toBe(false);
  });
  it("flags a conflict when there are unsaved edits", async () => {
    const store = await fresh();
    store.getState().updateContent("local edit");
    await backend.writeNote(DESIGN, "# from disk");
    backend.fire({ kind: "modify", paths: [DESIGN] });
    await vi.advanceTimersByTimeAsync(10);
    expect(store.getState().externalChange).toBe(true);
    expect(store.getState().content).not.toBe("# from disk");
    // Keep mine: saves the local text over the disk version.
    store.getState().keepLocal();
    await vi.advanceTimersByTimeAsync(10);
    expect(store.getState().externalChange).toBe(false);
    expect(await backend.readNote(DESIGN)).toBe("local edit");
  });
  it("reloadFromDisk replaces local edits", async () => {
    const store = await fresh();
    store.getState().updateContent("local edit");
    await backend.writeNote(DESIGN, "# from disk");
    backend.fire({ kind: "modify", paths: [DESIGN] });
    await store.getState().reloadFromDisk();
    expect(store.getState().content).toBe("# from disk");
    expect(store.getState().dirty).toBe(false);
  });
  it("ignores a modify event for a note that matches what we saved", async () => {
    const store = await fresh();
    const before = store.getState().contentVersion;
    backend.fire({ kind: "modify", paths: [DESIGN] });
    await vi.advanceTimersByTimeAsync(10);
    expect(store.getState().contentVersion).toBe(before);
  });
  it("refreshes the tree on create and remove events", async () => {
    const store = await fresh();
    await backend.writeNote(`${R}/Fresh.md`, "# fresh");
    backend.fire({ kind: "create", paths: [`${R}/Fresh.md`] });
    await vi.advanceTimersByTimeAsync(200);
    expect(store.getState().tree.some((n) => n.name === "Fresh.md")).toBe(true);
  });
});

describe("files", () => {
  it("creates a note, opens it and enters rename mode", async () => {
    const store = await fresh();
    const path = await store.getState().createNote();
    expect(path).toBe(`${R}/Untitled.md`);
    expect(store.getState().activePath).toBe(path);
    expect(store.getState().renaming).toBe(path);
    expect(store.getState().tree.some((n) => n.name === "Untitled.md")).toBe(true);
  });
  it("renames the active note and keeps it active", async () => {
    const store = await fresh();
    await store.getState().renamePath(DESIGN, "Design");
    expect(store.getState().activePath).toBe(`${R}/Projects/Design.md`);
    expect(store.getState().renaming).toBeNull();
    expect(await backend.readNote(`${R}/Projects/Design.md`)).toContain("# Editor design notes");
  });
  it("renames a folder containing the active note", async () => {
    const store = await fresh();
    await store.getState().renamePath(`${R}/Projects`, "Work");
    expect(store.getState().activePath).toBe(`${R}/Work/Editor design notes.md`);
  });
  it("cancels a rename with an empty name", async () => {
    const store = await fresh();
    store.getState().setRenaming(DESIGN);
    await store.getState().renamePath(DESIGN, "   ");
    expect(store.getState().activePath).toBe(DESIGN);
    expect(store.getState().renaming).toBeNull();
  });
  it("deletes the active note and clears the editor", async () => {
    const store = await fresh();
    await store.getState().deletePath(DESIGN);
    expect(store.getState().activePath).toBeNull();
    expect(store.getState().tree.find((n) => n.name === "Projects")!.children!.map((c) => c.name)).toEqual(["Roadmap.md", "Tauri vs Electron.md"]);
  });
});

describe("ui state", () => {
  it("cycles the theme and persists it", async () => {
    const store = await fresh();
    expect(store.getState().theme).toBe("system");
    store.getState().cycleTheme();
    expect(store.getState().theme).toBe("light");
    store.getState().cycleTheme();
    expect(store.getState().theme).toBe("dark");
    expect(JSON.parse(localStorage.getItem("margin.settings.v1")!).theme).toBe("dark");
  });
  it("toggles panels and folders", async () => {
    const store = await fresh();
    store.getState().toggleSidebar();
    store.getState().toggleOutline();
    store.getState().toggleDir(`${R}/Projects`);
    const s = store.getState();
    expect(s.sidebarOpen).toBe(false);
    expect(s.outlineOpen).toBe(false);
    expect(s.expandedDirs[`${R}/Projects`]).toBe(false);
  });
  it("derives titles and breadcrumbs", async () => {
    await fresh();
    expect(mod.noteTitle(DESIGN)).toBe("Editor design notes");
    expect(mod.crumbsFor(R, DESIGN)).toEqual(["Projects", "Editor design notes"]);
    expect(mod.crumbsFor(null, DESIGN)).toEqual([]);
  });
});
