import { describe, expect, it } from "vitest";
import type { FileNode } from "../backend/types";
import { sortTree, touchFile } from "./treeSort";

const file = (path: string, modified: number, created = modified): FileNode => ({ name: path.split("/").pop()!, path, kind: "file", modified, created });
const dir = (path: string, children: FileNode[], modified = 0): FileNode => ({ name: path.split("/").pop()!, path, kind: "dir", children, modified, created: modified });

const tree = [
  dir("/v/Archive", [file("/v/Archive/Old.md", 10, 1), file("/v/Archive/Older.md", 5, 2)]),
  dir("/v/Projects", [file("/v/Projects/Alpha.md", 30, 3), file("/v/Projects/Beta.md", 50, 4)]),
  dir("/v/Empty", [], 40),
  file("/v/Inbox.md", 20, 9),
  file("/v/Note 2.md", 60, 6),
  file("/v/Note 10.md", 60, 5),
];
const names = (nodes: FileNode[]) => nodes.map((n) => n.name);

describe("sortTree", () => {
  it("leaves the backend's name order alone", () => {
    expect(sortTree(tree, "name")).toBe(tree);
  });

  it("puts the most recently edited first, folders first, folders as new as their newest note", () => {
    const sorted = sortTree(tree, "modified");
    expect(names(sorted)).toEqual(["Projects", "Empty", "Archive", "Note 2.md", "Note 10.md", "Inbox.md"]);
    expect(names(sorted[0].children!)).toEqual(["Beta.md", "Alpha.md"]);
  });

  it("sorts by creation date the same way", () => {
    const sorted = sortTree(tree, "created");
    expect(names(sorted)).toEqual(["Empty", "Projects", "Archive", "Inbox.md", "Note 2.md", "Note 10.md"]);
    expect(names(sorted[2].children!)).toEqual(["Older.md", "Old.md"]);
  });

  it("puts notes without a time last", () => {
    const sorted = sortTree([{ name: "b.md", path: "/v/b.md", kind: "file" }, file("/v/a.md", 1)], "created");
    expect(names(sorted)).toEqual(["a.md", "b.md"]);
  });
});

describe("touchFile", () => {
  it("updates one file's modified time and keeps the rest of the tree", () => {
    const next = touchFile(tree, "/v/Archive/Old.md", 99);
    expect(next[0].children![0].modified).toBe(99);
    expect(next[1]).toBe(tree[1]);
    expect(names(sortTree(next, "modified"))[0]).toBe("Archive");
  });

  it("returns the same tree when the file isn't in it", () => {
    expect(touchFile(tree, "/v/Missing.md", 99)).toBe(tree);
  });
});
