import { describe, expect, it } from "vitest";
import { fileNameFromTitle, isPlaceholderName, replaceTitle, titleFromDoc, titleLine } from "./title";

describe("titleFromDoc", () => {
  it("reads a leading level-one heading", () => {
    expect(titleFromDoc("# Meeting notes\n\nBody")).toBe("Meeting notes");
    expect(titleFromDoc("\n\n# After blank lines")).toBe("After blank lines");
    expect(titleFromDoc("# Closing hashes ##")).toBe("Closing hashes");
    expect(titleFromDoc("# ")).toBe("");
    expect(titleFromDoc("#")).toBe("");
  });

  it("skips front matter", () => {
    expect(titleFromDoc("---\ntags: [a]\n---\n# Titled\n")).toBe("Titled");
  });

  it("returns null when the note doesn't start with a level-one heading", () => {
    expect(titleFromDoc("Some text\n# Later")).toBeNull();
    expect(titleFromDoc("## Second level")).toBeNull();
    expect(titleFromDoc("#hashtag")).toBeNull();
    expect(titleFromDoc("")).toBeNull();
  });

  it("knows where the heading text is", () => {
    const doc = "---\na: 1\n---\n#  Spaced  \nbody";
    const t = titleLine(doc)!;
    expect(doc.slice(t.from, t.to)).toBe("Spaced");
    expect(t.line).toBe(4);
  });
});

describe("fileNameFromTitle", () => {
  it("drops markdown and keeps the words", () => {
    expect(fileNameFromTitle("**Bold** and *italic* with `code`")).toBe("Bold and italic with code");
    expect(fileNameFromTitle("[Linked](https://x.y) idea")).toBe("Linked idea");
  });

  it("replaces characters file systems don't allow", () => {
    expect(fileNameFromTitle("A/B: test?")).toBe("A-B- test");
    expect(fileNameFromTitle('Say "hi" <now>')).toBe("Say -hi- -now");
    expect(fileNameFromTitle("...hidden")).toBe("hidden");
    expect(fileNameFromTitle("trailing dots...")).toBe("trailing dots");
  });

  it("limits length and collapses whitespace", () => {
    expect(fileNameFromTitle("a   b\tc")).toBe("a b c");
    expect(fileNameFromTitle("x".repeat(300))).toHaveLength(120);
  });

  it("recognises placeholder names", () => {
    expect(isPlaceholderName("Untitled")).toBe(true);
    expect(isPlaceholderName("Untitled 3")).toBe(true);
    expect(isPlaceholderName("Untitled draft")).toBe(false);
  });
});

describe("replaceTitle", () => {
  it("returns the change that swaps the heading text", () => {
    const doc = "# Old name\n\nBody";
    const change = replaceTitle(doc, "New name")!;
    expect(doc.slice(0, change.from) + change.insert + doc.slice(change.to)).toBe("# New name\n\nBody");
    expect(replaceTitle("no heading", "x")).toBeNull();
  });

  it("fills an empty heading", () => {
    const doc = "# \nBody";
    const change = replaceTitle(doc, "Filled")!;
    expect(doc.slice(0, change.from) + change.insert + doc.slice(change.to)).toBe("# Filled\nBody");
  });
});
