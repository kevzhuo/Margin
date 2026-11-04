import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ROOT, MemoryBackend } from "./memory";
import { flattenFiles, type WatchEvent } from "./types";

const R = DEMO_ROOT;

function fixture(): Record<string, string> {
  return {
    [`${R}/b.md`]: "# b",
    [`${R}/a.md`]: "# a",
    [`${R}/Zed/z.md`]: "# z",
    [`${R}/Alpha/note 10.md`]: "# ten",
    [`${R}/Alpha/note 2.md`]: "# two",
    [`${R}/Alpha/Inner/deep.md`]: "# deep",
    [`${R}/ignored.txt`]: "not markdown",
  };
}

let backend: MemoryBackend;
beforeEach(() => {
  localStorage.clear();
  backend = new MemoryBackend(fixture());
});

describe("listTree", () => {
  it("puts folders first, sorts naturally and skips non-markdown files", async () => {
    const tree = await backend.listTree(R);
    expect(tree.map((n) => [n.kind, n.name])).toEqual([
      ["dir", "Alpha"],
      ["dir", "Zed"],
      ["file", "a.md"],
      ["file", "b.md"],
    ]);
    const alpha = tree[0];
    expect(alpha.children!.map((n) => n.name)).toEqual(["Inner", "note 2.md", "note 10.md"]);
    expect(flattenFiles(tree).map((f) => f.name)).toEqual(["deep.md", "note 2.md", "note 10.md", "z.md", "a.md", "b.md"]);
    expect(JSON.stringify(tree)).not.toContain("ignored.txt");
  });
  it("returns an empty tree for an unknown root", async () => {
    expect(await backend.listTree("/nowhere")).toEqual([]);
  });
});

describe("notes", () => {
  it("reads and writes", async () => {
    expect(await backend.readNote(`${R}/a.md`)).toBe("# a");
    await backend.writeNote(`${R}/a.md`, "changed");
    expect(await backend.readNote(`${R}/a.md`)).toBe("changed");
    await expect(backend.readNote(`${R}/missing.md`)).rejects.toThrow(/No such note/);
  });
  it("persists writes to localStorage and loads them back", async () => {
    await backend.writeNote(`${R}/a.md`, "persisted");
    const again = new MemoryBackend();
    expect(await again.readNote(`${R}/a.md`)).toBe("persisted");
  });
  it("creates notes with de-duplicated names and a title", async () => {
    const first = await backend.createNote(R, "Untitled");
    const second = await backend.createNote(R, "Untitled");
    const third = await backend.createNote(R, "Untitled.md");
    expect(first).toBe(`${R}/Untitled.md`);
    expect(second).toBe(`${R}/Untitled 2.md`);
    expect(third).toBe(`${R}/Untitled 3.md`);
    expect(await backend.readNote(second)).toBe("# Untitled 2\n\n");
  });
});

describe("rename and delete", () => {
  it("renames a file", async () => {
    await backend.renamePath(`${R}/a.md`, `${R}/renamed.md`);
    expect(await backend.readNote(`${R}/renamed.md`)).toBe("# a");
    await expect(backend.readNote(`${R}/a.md`)).rejects.toThrow();
  });
  it("refuses to overwrite an existing file", async () => {
    await expect(backend.renamePath(`${R}/a.md`, `${R}/b.md`)).rejects.toThrow(/Already exists/);
  });
  it("renames a folder and moves its children", async () => {
    await backend.renamePath(`${R}/Alpha`, `${R}/Beta`);
    const tree = await backend.listTree(R);
    expect(tree.map((n) => n.name)).toEqual(["Beta", "Zed", "a.md", "b.md"]);
    expect(await backend.readNote(`${R}/Beta/Inner/deep.md`)).toBe("# deep");
  });
  it("deletes a file and a folder", async () => {
    await backend.deletePath(`${R}/a.md`);
    await backend.deletePath(`${R}/Alpha`);
    const names = flattenFiles(await backend.listTree(R)).map((f) => f.name);
    expect(names).toEqual(["z.md", "b.md"]);
  });
});

describe("watch", () => {
  it("emits create, rename and remove events until unsubscribed", async () => {
    const events: WatchEvent[] = [];
    const stop = await backend.watch(R, (e) => events.push(e));
    const created = await backend.createNote(R, "New");
    await backend.renamePath(created, `${R}/Newer.md`);
    await backend.deletePath(`${R}/Newer.md`);
    expect(events.map((e) => e.kind)).toEqual(["create", "rename", "remove"]);
    expect(events[1].paths).toEqual([created, `${R}/Newer.md`]);
    stop();
    await backend.createNote(R, "Silent");
    expect(events.length).toBe(3);
  });
});

describe("misc", () => {
  it("resolves assets as-is and opens links in a new tab", async () => {
    expect(backend.resolveAsset(`${R}/a.md`, "img.png")).toBe("img.png");
    const open = vi.spyOn(globalThis, "open").mockImplementation(() => null);
    await backend.openExternal("https://x.y");
    expect(open).toHaveBeenCalledWith("https://x.y", "_blank", "noopener");
    open.mockRestore();
  });
  it("pickVault returns the demo root", async () => {
    expect(await backend.pickVault()).toBe(R);
  });
});

describe("folders and search", () => {
  const R = "/Demo Vault";

  it("creates folders, de-duplicates names and lists empty ones", async () => {
    const b = new MemoryBackend({ [`${R}/a.md`]: "x" });
    const one = await b.createFolder(R, "Ideas");
    const two = await b.createFolder(R, "Ideas");
    expect(one).toBe(`${R}/Ideas`);
    expect(two).toBe(`${R}/Ideas 2`);
    const tree = await b.listTree(R);
    expect(tree.map((n) => [n.name, n.kind])).toEqual([
      ["Ideas", "dir"],
      ["Ideas 2", "dir"],
      ["a.md", "file"],
    ]);
    expect(tree[0].children).toEqual([]);
  });

  it("moves notes into folders and renames folders with their empty subfolders", async () => {
    const b = new MemoryBackend({ [`${R}/a.md`]: "x" });
    await b.createFolder(R, "Outer");
    await b.createFolder(`${R}/Outer`, "Inner");
    await b.renamePath(`${R}/a.md`, `${R}/Outer/a.md`);
    await b.renamePath(`${R}/Outer`, `${R}/Renamed`);
    const tree = await b.listTree(R);
    expect(tree[0].name).toBe("Renamed");
    expect(tree[0].children!.map((c) => c.path)).toEqual([`${R}/Renamed/Inner`, `${R}/Renamed/a.md`]);
    await expect(b.renamePath(`${R}/Renamed`, `${R}/Renamed/Inner/Renamed`)).rejects.toThrow(/into itself/);
  });

  it("deleting a folder removes its empty subfolders too", async () => {
    const b = new MemoryBackend({});
    await b.createFolder(R, "A");
    await b.createFolder(`${R}/A`, "B");
    await b.deletePath(`${R}/A`);
    expect(await b.listTree(R)).toEqual([]);
  });

  it("searches case-insensitively in natural path order with a per-note cap", async () => {
    const b = new MemoryBackend({
      [`${R}/b.md`]: "Typora\nno\nTYPORA again",
      [`${R}/a.md`]: Array.from({ length: 8 }, (_, i) => `typora ${i}`).join("\n"),
      [`${R}/c.txt`]: "typora",
    });
    const hits = await b.searchVault(R, "typora");
    expect(hits.map((h) => [h.path.split("/").pop(), h.line])).toEqual([
      ["a.md", 1],
      ["a.md", 2],
      ["a.md", 3],
      ["a.md", 4],
      ["a.md", 5],
      ["b.md", 1],
      ["b.md", 3],
    ]);
    expect(await b.searchVault(R, "typora", 2)).toHaveLength(2);
    expect(await b.searchVault(R, "  ")).toEqual([]);
  });
});
