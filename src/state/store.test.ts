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
  it("creates a note and opens it with its title selected for typing", async () => {
    const store = await fresh();
    const path = await store.getState().createNote();
    expect(path).toBe(`${R}/Untitled.md`);
    expect(store.getState().activePath).toBe(path);
    expect(store.getState().renaming).toBeNull();
    expect(store.getState().jump).toEqual({ path, line: 1, query: "Untitled", flash: false });
    expect(store.getState().tree.some((n) => n.name === "Untitled.md")).toBe(true);
  });
  it("creates a note in rename mode when title syncing is off", async () => {
    const store = await fresh();
    store.getState().setTitleSync(false);
    const path = await store.getState().createNote();
    expect(store.getState().renaming).toBe(path);
  });
  it("renames the active note, keeps it active, and retitles it", async () => {
    const store = await fresh();
    await store.getState().renamePath(DESIGN, "Design");
    expect(store.getState().activePath).toBe(`${R}/Projects/Design.md`);
    expect(store.getState().renaming).toBeNull();
    await store.getState().flushSave();
    expect(await backend.readNote(`${R}/Projects/Design.md`)).toMatch(/^# Design\n/);
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

describe("navigation history", () => {
  const INBOX = `${R}/Inbox.md`;

  it("goes back and forward, and a new note drops the forward stack", async () => {
    const store = await fresh();
    const s = () => store.getState();
    await s().openNote(ROADMAP);
    await s().openNote(INBOX);
    expect(s().history).toEqual([DESIGN, ROADMAP, INBOX]);
    expect(mod.canGoBack(s())).toBe(true);
    expect(mod.canGoForward(s())).toBe(false);

    await s().goBack();
    expect(s().activePath).toBe(ROADMAP);
    await s().goBack();
    expect(s().activePath).toBe(DESIGN);
    expect(mod.canGoBack(s())).toBe(false);
    await s().goForward();
    expect(s().activePath).toBe(ROADMAP);

    const journal = `${R}/Journal/2026-11-04.md`;
    await s().openNote(journal);
    expect(s().history).toEqual([DESIGN, ROADMAP, journal]);
    expect(mod.canGoForward(s())).toBe(false);
  });

  it("skips notes that were deleted", async () => {
    const store = await fresh();
    const s = () => store.getState();
    await s().openNote(ROADMAP);
    await s().openNote(INBOX);
    await s().deletePath(ROADMAP);
    expect(s().history).toEqual([DESIGN, INBOX]);
    await s().goBack();
    expect(s().activePath).toBe(DESIGN);
  });

  it("keeps a most-recently-used list", async () => {
    const store = await fresh();
    const s = () => store.getState();
    await s().openNote(ROADMAP);
    await s().openNote(INBOX);
    await s().openNote(ROADMAP);
    expect(s().recent.slice(0, 3)).toEqual([ROADMAP, INBOX, DESIGN]);
  });
});

describe("jumps", () => {
  it("records where to put the caret, and bumps a version for the open note", async () => {
    const store = await fresh();
    const s = () => store.getState();
    await s().openNote(ROADMAP, { jump: { line: 3, query: "Live" } });
    expect(s().jump).toEqual({ path: ROADMAP, line: 3, query: "Live" });
    const v = s().jumpVersion;
    await s().openNote(ROADMAP, { jump: { heading: "next" } });
    expect(s().jumpVersion).toBe(v + 1);
    expect(s().jump).toEqual({ path: ROADMAP, heading: "next" });
  });
});

describe("folders, moves and deletes", () => {
  it("creates a folder and starts renaming it", async () => {
    const store = await fresh();
    const path = await store.getState().createFolder();
    expect(path).toBe(`${R}/New folder`);
    expect(store.getState().renaming).toBe(path);
    expect(store.getState().tree.some((n) => n.path === path && n.kind === "dir")).toBe(true);
  });

  it("moving the open note updates every remembered path", async () => {
    const store = await fresh();
    const s = () => store.getState();
    s().saveViewState(DESIGN, { anchor: 5, head: 5, scrollTop: 120 });
    const folder = (await s().createFolder())!;
    await s().movePath(DESIGN, folder);
    const moved = `${folder}/Editor design notes.md`;
    expect(s().activePath).toBe(moved);
    expect(s().history).toEqual([moved]);
    expect(s().recent[0]).toBe(moved);
    expect(s().viewStates[moved]).toEqual({ anchor: 5, head: 5, scrollTop: 120 });
    expect(s().viewStates[DESIGN]).toBeUndefined();
    expect(s().expandedDirs[folder]).toBe(true);
    expect(await backend.readNote(moved)).toContain("# Editor design notes");
  });

  it("refuses to move a folder into itself", async () => {
    const store = await fresh();
    const s = () => store.getState();
    await s().movePath(`${R}/Projects`, `${R}/Projects`);
    await s().movePath(`${R}/Journal`, `${R}/Journal`);
    const inner = (await s().createFolder(`${R}/Projects`))!;
    await s().movePath(`${R}/Projects`, inner);
    expect(s().toasts.at(-1)?.message).toMatch(/into itself/);
    expect(s().tree.some((n) => n.path === `${R}/Projects`)).toBe(true);
  });

  it("deleting the open note lands on the most recent remaining note", async () => {
    const store = await fresh();
    const s = () => store.getState();
    await s().openNote(ROADMAP);
    await s().deletePath(ROADMAP);
    expect(s().activePath).toBe(DESIGN);
    expect(s().toasts.at(-1)?.message).toBe("Deleted “Roadmap”");
  });

  it("creates a note with a given name without entering rename mode", async () => {
    const store = await fresh();
    const path = await store.getState().createNote(undefined, "Meeting notes");
    expect(path).toBe(`${R}/Meeting notes.md`);
    expect(store.getState().activePath).toBe(path);
    expect(store.getState().renaming).toBeNull();
  });
});

describe("toasts and confirmation", () => {
  it("toasts dismiss themselves and play an exit before disappearing", async () => {
    const store = await fresh();
    const s = () => store.getState();
    s().pushToast("Hello");
    expect(s().toasts.map((t) => t.message)).toEqual(["Hello"]);
    vi.advanceTimersByTime(mod.TOAST_MS.info);
    expect(s().toasts[0].leaving).toBe(true);
    vi.advanceTimersByTime(mod.TOAST_EXIT_MS);
    expect(s().toasts).toEqual([]);
  });

  it("askConfirm resolves with the user's answer", async () => {
    const store = await fresh();
    const s = () => store.getState();
    const yes = s().askConfirm({ title: "Sure?" });
    expect(s().confirmRequest?.title).toBe("Sure?");
    s().resolveConfirm(true);
    await expect(yes).resolves.toBe(true);
    expect(s().confirmRequest).toBeNull();
    const no = s().askConfirm({ title: "Again?" });
    s().resolveConfirm(false);
    await expect(no).resolves.toBe(false);
  });
});

describe("appearance settings", () => {
  it("clamps text size and sidebar width, and persists them", async () => {
    const store = await fresh();
    const s = () => store.getState();
    s().setFontSize(40);
    expect(s().fontSize).toBe(mod.FONT_SIZE_MAX);
    s().bumpFontSize(-100);
    expect(s().fontSize).toBe(mod.FONT_SIZE_MIN);
    s().setSidebarWidth(10);
    expect(s().sidebarWidth).toBe(mod.SIDEBAR_WIDTH_MIN);
    s().setLineWidth("wide");
    s().setFontFamily("serif");
    s().setFocusMode(true);
    const saved = JSON.parse(localStorage.getItem("margin.settings.v1")!);
    expect(saved).toMatchObject({ fontSize: mod.FONT_SIZE_MIN, sidebarWidth: mod.SIDEBAR_WIDTH_MIN, lineWidth: "wide", fontFamily: "serif", focusMode: true });
  });

  it("remembers at most 100 view states, dropping the oldest", async () => {
    const store = await fresh();
    for (let i = 0; i < 105; i++) store.getState().saveViewState(`/n${i}.md`, { anchor: i, head: i, scrollTop: 0 });
    const keys = Object.keys(store.getState().viewStates);
    expect(keys).toHaveLength(100);
    expect(keys[0]).toBe("/n5.md");
  });
});

describe("responsive panels and full width", () => {
  it("decides which panels fit beside a comfortable editor", () => {
    expect(mod.panelFits(1280, true, 240)).toEqual({ sidebarFits: true, outlineFits: true });
    expect(mod.panelFits(900, true, 240)).toEqual({ sidebarFits: true, outlineFits: false });
    // With the sidebar closed there is room for the outline again.
    expect(mod.panelFits(900, false, 240)).toEqual({ sidebarFits: true, outlineFits: true });
    // Too small to dock the sidebar, and still too small for the outline.
    expect(mod.panelFits(600, true, 240)).toEqual({ sidebarFits: false, outlineFits: false });
  });

  it("toggling a panel that doesn't fit opens it as an overlay and keeps the preference", async () => {
    const store = await fresh();
    const s = () => store.getState();
    s().setFits(true, false);
    expect(mod.outlineVisible(s())).toBe(false);
    s().toggleOutline();
    expect(s().outlinePeek).toBe(true);
    expect(s().outlineOpen).toBe(true);
    expect(mod.outlineVisible(s())).toBe(true);
    s().closePeeks();
    expect(mod.outlineVisible(s())).toBe(false);
    // Becoming wide enough drops any overlay and docks per the preference.
    s().toggleOutline();
    s().setFits(true, true);
    expect(s().outlinePeek).toBe(false);
    expect(mod.outlineVisible(s())).toBe(true);
  });

  it("persists full width", async () => {
    const store = await fresh();
    store.getState().setFullWidth(true);
    expect(JSON.parse(localStorage.getItem("margin.settings.v1")!).fullWidth).toBe(true);
  });
});

describe("title and file name sync", () => {
  const typeTitle = (store: Awaited<ReturnType<typeof fresh>>, title: string) => {
    const doc = store.getState().content!;
    store.getState().updateContent(doc.replace(/^# .*$/m, `# ${title}`));
  };

  it("renames a new note after its title once typing pauses", async () => {
    const store = await fresh();
    await store.getState().createNote();
    typeTitle(store, "Meeting notes");
    expect(store.getState().activePath).toBe(`${R}/Untitled.md`);
    await vi.advanceTimersByTimeAsync(mod.TITLE_SYNC_MS);
    expect(store.getState().activePath).toBe(`${R}/Meeting notes.md`);
    expect(store.getState().history.at(-1)).toBe(`${R}/Meeting notes.md`);
  });

  it("follows later title edits while the two stay in sync", async () => {
    const store = await fresh();
    typeTitle(store, "Design notes");
    await vi.advanceTimersByTimeAsync(mod.TITLE_SYNC_MS);
    expect(store.getState().activePath).toBe(`${R}/Projects/Design notes.md`);
    typeTitle(store, "Design notes v2");
    await vi.advanceTimersByTimeAsync(mod.TITLE_SYNC_MS);
    expect(store.getState().activePath).toBe(`${R}/Projects/Design notes v2.md`);
  });

  it("leaves a deliberately different file name alone", async () => {
    const store = await fresh();
    const daily = `${R}/Templates/Daily note.md`;
    await store.getState().openNote(daily);
    typeTitle(store, "Tuesday");
    await vi.advanceTimersByTimeAsync(mod.TITLE_SYNC_MS);
    expect(store.getState().activePath).toBe(daily);
  });

  it("keeps the name while the title is empty, and avoids taking another note's name", async () => {
    const store = await fresh();
    typeTitle(store, "");
    await vi.advanceTimersByTimeAsync(mod.TITLE_SYNC_MS);
    expect(store.getState().activePath).toBe(DESIGN);
    typeTitle(store, "Roadmap");
    await vi.advanceTimersByTimeAsync(mod.TITLE_SYNC_MS);
    expect(store.getState().activePath).toBe(`${R}/Projects/Roadmap 2.md`);
  });

  it("does nothing when turned off", async () => {
    const store = await fresh();
    store.getState().setTitleSync(false);
    typeTitle(store, "Something else");
    await vi.advanceTimersByTimeAsync(mod.TITLE_SYNC_MS);
    expect(store.getState().activePath).toBe(DESIGN);
  });

  it("retitles a note that isn't open when its file is renamed", async () => {
    const store = await fresh();
    await store.getState().renamePath(ROADMAP, "Plan");
    expect(await backend.readNote(`${R}/Projects/Plan.md`)).toMatch(/^# Plan\n/);
  });

  it("finishes a pending rename before switching notes", async () => {
    const store = await fresh();
    typeTitle(store, "Quick switch");
    await store.getState().openNote(ROADMAP);
    expect(store.getState().tree.some((n) => n.children?.some((c) => c.name === "Quick switch.md"))).toBe(true);
  });
});

describe("images", () => {
  const png = (name: string, size = 3) => new File([new Uint8Array(size)], name, { type: "image/png" });

  it("saves images to the attachments folder and links them relative to the note", async () => {
    const store = await fresh();
    await store.getState().openNote(DESIGN);
    const snippets = await store.getState().saveImages([png("Sunset photo.png"), png("image.png")]);
    expect(snippets[0]).toBe("![Sunset photo](../attachments/Sunset%20photo.png)");
    expect(snippets[1]).toMatch(/^!\[\]\(\.\.\/attachments\/Pasted%20image%20\d{4}-\d\d-\d\d%20at%20\d\d\.\d\d\.\d\d\.png\)$/);
    // The link resolves to the saved image.
    const src = "../attachments/Sunset%20photo.png";
    expect(backend.resolveAsset(DESIGN, src)).not.toBe(src);
  });

  it("links from a note at the vault root without ../", async () => {
    const store = await fresh();
    await store.getState().openNote(`${R}/Inbox.md`);
    expect(await store.getState().saveImages([png("a.png")])).toEqual(["![a](attachments/a.png)"]);
  });

  it("skips files that aren't images, and refuses ones that are too large", async () => {
    const store = await fresh();
    await store.getState().openNote(DESIGN);
    const huge = png("huge.png");
    Object.defineProperty(huge, "size", { value: 200 * 1024 * 1024 });
    const pdf = new File([new Uint8Array(1)], "notes.pdf", { type: "application/pdf" });
    expect(await store.getState().saveImages([pdf, huge])).toEqual([]);
    expect(store.getState().toasts.map((t) => t.message)).toEqual(["huge.png is too large to add (over 100 MB)."]);
  });

  it("needs an open note", async () => {
    const store = await fresh();
    store.setState({ activePath: null });
    expect(await store.getState().saveImages([png("a.png")])).toEqual([]);
  });
});
