import { describe, expect, it } from "vitest";
import { countWords, extractHeadings } from "./outline";
import { stateOf } from "./testUtils";

describe("extractHeadings", () => {
  it("returns levels, stripped text and positions", () => {
    const doc = "# Title *with* `code`\n\ntext\n\n## Second **bold**\n\n### Third ###\n\nSetext\n======\n";
    const h = extractHeadings(stateOf(doc));
    expect(h.map((x) => [x.level, x.text])).toEqual([
      [1, "Title with code"],
      [2, "Second bold"],
      [3, "Third"],
      [1, "Setext"],
    ]);
    expect(h[0].pos).toBe(0);
    expect(h[1].pos).toBe(doc.indexOf("## Second"));
  });

  it("labels empty headings", () => {
    expect(extractHeadings(stateOf("# \n")).map((x) => x.text)).toEqual(["Untitled"]);
  });

  it("marks the title: a first-line # heading, after any front matter", () => {
    const titled = (doc: string) => extractHeadings(stateOf(doc)).map((h) => !!h.title);
    expect(titled("# Title\n\n## A\n\n# Later\n")).toEqual([true, false, false]);
    expect(titled("---\ntags: [x]\n---\n\n# Title\n\n## A\n")).toEqual([true, false]);
    // Text before the first heading means the note has no title.
    expect(titled("Intro\n\n# Heading\n")).toEqual([false]);
    expect(titled("## Section\n\n# Heading\n")).toEqual([false, false]);
    expect(titled("Setext\n======\n")).toEqual([false]);
  });
});

describe("countWords", () => {
  it("ignores markdown punctuation and markers", () => {
    const s = stateOf("# Hello **world**\n\n- [ ] one two\n> three `four` five\n\n---\n");
    expect(countWords(s.doc)).toBe(7);
  });
  it("counts plain prose", () => {
    expect(countWords(stateOf("It's a test, isn't it?").doc)).toBe(5);
  });
  it("is zero for an empty doc", () => {
    expect(countWords(stateOf("").doc)).toBe(0);
  });
});
