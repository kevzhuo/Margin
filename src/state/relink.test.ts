import { describe, expect, it } from "vitest";
import { applyEdits, relinkEdits, type Move } from "./relink";

const V = "/Vault";
/** Paths that existed before the move in these tests. */
const EXISTING = new Set([
  `${V}/Inbox.md`,
  `${V}/Projects`,
  `${V}/Projects/Roadmap.md`,
  `${V}/Projects/Notes.md`,
  `${V}/Archive`,
  `${V}/Archive/2025`,
]);
const existed = (path: string) => EXISTING.has(path);

/** The note's text after `move`, for a note at `oldPath` that is now at `newPath`. */
function relink(text: string, move: Move, oldPath = `${V}/Inbox.md`, newPath = oldPath): string {
  return applyEdits(text, relinkEdits(text, oldPath, newPath, move, existed));
}

const renameRoadmap: Move = { from: `${V}/Projects/Roadmap.md`, to: `${V}/Projects/Plan.md` };

describe("links into what moved", () => {
  it("follow a renamed note", () => {
    expect(relink("See [the roadmap](Projects/Roadmap.md).", renameRoadmap)).toBe("See [the roadmap](Projects/Plan.md).");
  });

  it("keep their heading, query and title", () => {
    expect(relink('[a](Projects/Roadmap.md#next "Plans") [b](Projects/Roadmap.md?v=2)', renameRoadmap)).toBe(
      '[a](Projects/Plan.md#next "Plans") [b](Projects/Plan.md?v=2)',
    );
  });

  it("stay without an extension when written without one", () => {
    expect(relink("[a](Projects/Roadmap) [b](Projects/Roadmap#next)", renameRoadmap)).toBe("[a](Projects/Plan) [b](Projects/Plan#next)");
  });

  it("follow a renamed or moved folder", () => {
    const text = "[a](Projects/Roadmap.md) [b](./Projects/Notes.md) [c](Projects)";
    expect(relink(text, { from: `${V}/Projects`, to: `${V}/Work` })).toBe("[a](Work/Roadmap.md) [b](./Work/Notes.md) [c](Work)");
    expect(relink(text, { from: `${V}/Projects`, to: `${V}/Archive/Projects` })).toBe(
      "[a](Archive/Projects/Roadmap.md) [b](./Archive/Projects/Notes.md) [c](Archive/Projects)",
    );
  });

  it("are written with escapes where the new name needs them", () => {
    const move = { from: `${V}/Projects/Roadmap.md`, to: `${V}/Projects/Road map (2026).md` };
    expect(relink("[a](Projects/Roadmap.md#next)", move)).toBe("[a](Projects/Road%20map%20%282026%29.md#next)");
    // Angle brackets allow spaces, so the new name is written as it is.
    expect(relink("[a](<Projects/Roadmap.md>)", move)).toBe("[a](<Projects/Road map (2026).md>)");
  });

  it("are found in images, reference definitions and tables", () => {
    const move = { from: `${V}/attachments`, to: `${V}/media` };
    const text = [
      "![sunset](attachments/sunset.png)",
      "",
      "[spec]: attachments/spec.pdf 'The spec'",
      "",
      "| File | Link |",
      "| --- | --- |",
      "| Spec | [open](attachments/spec.pdf) |",
    ].join("\n");
    expect(relink(text, move)).toBe(text.replace(/attachments\//g, "media/"));
  });

  it("match a name written in another case, as macOS does, unless that exact file existed", () => {
    expect(relink("[a](projects/roadmap.md)", renameRoadmap)).toBe("[a](Projects/Plan.md)");
    // Both names existed (a case-sensitive disk): the link meant the other file.
    const both = (p: string) => existed(p) || p === `${V}/Projects/roadmap.md`;
    const text = "[a](Projects/roadmap.md)";
    expect(applyEdits(text, relinkEdits(text, `${V}/Inbox.md`, `${V}/Inbox.md`, renameRoadmap, both))).toBe(text);
  });

  it("work with Windows paths", () => {
    const move = { from: "C:\\Vault\\Projects\\Roadmap.md", to: "C:\\Vault\\Projects\\Plan.md" };
    const text = "[a](Projects/Roadmap.md)";
    expect(applyEdits(text, relinkEdits(text, "C:\\Vault\\Inbox.md", "C:\\Vault\\Inbox.md", move, () => true))).toBe("[a](Projects/Plan.md)");
  });
});

describe("links out of a note that moved", () => {
  const moveNotes: Move = { from: `${V}/Projects/Notes.md`, to: `${V}/Archive/2025/Notes.md` };
  const from = `${V}/Projects/Notes.md`;
  const to = `${V}/Archive/2025/Notes.md`;

  it("are rewritten from the note's new folder", () => {
    const text = "[a](Roadmap.md#next) [b](../Inbox.md) ![c](../attachments/c.png) [d](Missing.md)";
    expect(relink(text, moveNotes, from, to)).toBe(
      "[a](../../Projects/Roadmap.md#next) [b](../../Inbox.md) ![c](../../attachments/c.png) [d](../../Projects/Missing.md)",
    );
  });

  it("still lead to the note itself", () => {
    expect(relink("[top](Notes.md#intro)", moveNotes, from, to)).toBe("[top](Notes.md#intro)");
  });

  it("between notes in a folder that moved are left as they are", () => {
    const move = { from: `${V}/Projects`, to: `${V}/Archive/Projects` };
    const text = "[a](Roadmap.md) [b](./Notes.md#x)";
    expect(relink(text, move, `${V}/Projects/Notes.md`, `${V}/Archive/Projects/Notes.md`)).toBe(text);
  });

  it("to outside a renamed folder are left as they are", () => {
    const text = "[a](../Inbox.md) ![b](../attachments/b.png)";
    expect(relink(text, { from: `${V}/Projects`, to: `${V}/Work` }, `${V}/Projects/Notes.md`, `${V}/Work/Notes.md`)).toBe(text);
  });
});

describe("what is never changed", () => {
  it("links that don't lead into what moved", () => {
    const text = "[a](Inbox.md) [b](Projects/Notes.md) [c](Archive)";
    expect(relinkEdits(text, `${V}/Inbox.md`, `${V}/Inbox.md`, renameRoadmap, existed)).toEqual([]);
  });

  it("web links, anchors, absolute paths and autolinks", () => {
    const text = "[a](https://example.com/Projects/Roadmap.md) [b](#roadmap) [c](/Vault/Projects/Roadmap.md) <https://x.dev> [d](mailto:a@b.c)";
    expect(relinkEdits(text, `${V}/Inbox.md`, `${V}/Inbox.md`, renameRoadmap, existed)).toEqual([]);
  });

  it("links in code and maths", () => {
    const text = ["`[a](Projects/Roadmap.md)`", "", "```md", "[b](Projects/Roadmap.md)", "```", "", "$$", "[c](Projects/Roadmap.md)", "$$"].join("\n");
    expect(relink(text, renameRoadmap)).toBe(text);
  });

  it("wiki links and plain mentions", () => {
    const text = "[[Roadmap]] and Projects/Roadmap.md";
    expect(relink(text, renameRoadmap)).toBe(text);
  });
});

describe("applyEdits", () => {
  it("applies edits in document order", () => {
    expect(
      applyEdits("abcdef", [
        { from: 1, to: 2, insert: "B" },
        { from: 4, to: 6, insert: "" },
      ]),
    ).toBe("aBcd");
  });
});
