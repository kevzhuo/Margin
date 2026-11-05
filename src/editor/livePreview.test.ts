import { describe, expect, it } from "vitest";
import { buildDecorations, buildBlockDecorations } from "./livePreview";
import { collect, dimmed, hidden, lineClass, markClass, stateOf, type DecoInfo } from "./testUtils";

function decos(doc: string, cursor?: number | { anchor: number; head?: number }, focused = true): DecoInfo[] {
  const state = stateOf(doc, cursor);
  return collect(buildDecorations(state, focused), doc);
}

const at = (list: DecoInfo[], from: number, to: number) => list.filter((d) => d.from === from && d.to === to);

describe("headings", () => {
  const doc = "# Title\n\nparagraph";
  it("gets a line class and hides `# ` when the caret is elsewhere", () => {
    const d = decos(doc, doc.length);
    expect(d.some((x) => lineClass(x, "cm-md-h1") && x.from === 0)).toBe(true);
    expect(at(d, 0, 2).some(hidden)).toBe(true);
    expect(d.some(dimmed)).toBe(false);
  });
  it("reveals `# ` as a dim margin mark when the caret is on the line", () => {
    const d = decos(doc, 3);
    expect(at(d, 0, 2).some((x) => markClass(x, "cm-md-margin-mark") && dimmed(x))).toBe(true);
    expect(at(d, 0, 2).some(hidden)).toBe(false);
    expect(d.some((x) => lineClass(x, "cm-md-h1"))).toBe(true);
  });
  it("handles every ATX level and closing hashes", () => {
    const doc = "### Three ###\n";
    const d = decos(doc, doc.length);
    expect(d.some((x) => lineClass(x, "cm-md-h3"))).toBe(true);
    expect(at(d, 0, 4).some(hidden)).toBe(true);
    expect(d.some((x) => hidden(x) && x.text === " ###")).toBe(true);
  });
  it("styles setext headings and dims their underline", () => {
    const doc = "Title\n=====\n\ntext";
    const d = decos(doc, doc.length);
    expect(d.some((x) => lineClass(x, "cm-md-h1") && x.from === 0)).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-setext-underline") && x.from === 6)).toBe(true);
    expect(at(d, 6, 11).some(dimmed)).toBe(true);
  });
});

describe("inline emphasis", () => {
  const doc = "a **bold** and *em* z";
  it("keeps marks hidden when the caret is on the line but outside the element", () => {
    const d = decos(doc, 0);
    expect(at(d, 2, 4).some(hidden)).toBe(true);
    expect(at(d, 8, 10).some(hidden)).toBe(true);
    expect(at(d, 15, 16).some(hidden)).toBe(true);
    expect(at(d, 18, 19).some(hidden)).toBe(true);
    expect(d.some((x) => markClass(x, "cm-md-strong") && x.from === 2 && x.to === 10)).toBe(true);
    expect(d.some((x) => markClass(x, "cm-md-em") && x.from === 15 && x.to === 19)).toBe(true);
  });
  it("reveals only the element the caret is inside", () => {
    const d = decos(doc, 5);
    expect(at(d, 2, 4).some(dimmed)).toBe(true);
    expect(at(d, 8, 10).some(dimmed)).toBe(true);
    expect(at(d, 2, 4).some(hidden)).toBe(false);
    expect(at(d, 15, 16).some(hidden)).toBe(true);
    expect(at(d, 18, 19).some(hidden)).toBe(true);
  });
  it("reveals when the caret touches the element boundary", () => {
    const d = decos(doc, 10);
    expect(at(d, 2, 4).some(dimmed)).toBe(true);
  });
  it("handles strikethrough and inline code", () => {
    const doc = "x `code` ~~gone~~ y";
    const d = decos(doc, 0);
    expect(d.some((x) => markClass(x, "cm-md-inline-code") && x.from === 2 && x.to === 8)).toBe(true);
    expect(at(d, 2, 3).some(hidden)).toBe(true);
    expect(at(d, 7, 8).some(hidden)).toBe(true);
    expect(d.some((x) => markClass(x, "cm-md-strike") && x.from === 9 && x.to === 17)).toBe(true);
    expect(at(d, 9, 11).some(hidden)).toBe(true);
    expect(at(d, 15, 17).some(hidden)).toBe(true);
    const active = decos(doc, 4);
    expect(at(active, 2, 3).some(dimmed)).toBe(true);
    expect(at(active, 9, 11).some(hidden)).toBe(true);
  });
});

describe("links", () => {
  const doc = "see [text](http://a.b) now";
  it("hides the brackets and URL when inactive and tags the text", () => {
    const d = decos(doc, 0);
    expect(at(d, 4, 5).some(hidden)).toBe(true);
    expect(at(d, 9, 22).some(hidden)).toBe(true);
    const link = d.find((x) => markClass(x, "cm-md-link"));
    expect(link).toBeDefined();
    expect(link!.from).toBe(4);
    expect(link!.to).toBe(22);
    expect(link!.attrs["data-href"]).toBe("http://a.b");
  });
  it("dims the syntax when the caret is inside", () => {
    const d = decos(doc, 6);
    expect(at(d, 4, 5).some(dimmed)).toBe(true);
    expect(d.some(hidden)).toBe(false);
    expect(d.some((x) => dimmed(x) && x.text === "http://a.b")).toBe(true);
  });
  it("marks bare URLs and autolinks", () => {
    const d = decos("go https://x.y/ now <https://z.z>", 0);
    const bare = d.find((x) => markClass(x, "cm-md-link") && x.text === "https://x.y/");
    expect(bare?.attrs["data-href"]).toBe("https://x.y/");
    const auto = d.find((x) => markClass(x, "cm-md-link") && x.text === "<https://z.z>");
    expect(auto?.attrs["data-href"]).toBe("https://z.z");
    expect(d.some((x) => hidden(x) && x.text === "<")).toBe(true);
    expect(d.some((x) => hidden(x) && x.text === ">")).toBe(true);
  });
});

describe("images", () => {
  const doc = "![alt](img.png)\n\ntext";
  it("replaces the image with a widget when inactive", () => {
    const d = decos(doc, doc.length);
    const img = d.find((x) => x.widget === "ImageWidget");
    expect(img).toBeDefined();
    expect([img!.from, img!.to]).toEqual([0, 15]);
    expect(img!.kind).toBe("replace");
  });
  it("shows raw syntax when active", () => {
    const d = decos(doc, 2);
    expect(d.some((x) => x.widget === "ImageWidget")).toBe(false);
    expect(d.some((x) => dimmed(x) && x.text === "img.png")).toBe(true);
  });
});

describe("fenced code", () => {
  const doc = "```ts\nconst a = 1\n```\n\ntext";
  it("adds head/foot line classes, a language label and hides the closing fence", () => {
    const d = decos(doc, doc.length);
    expect(d.some((x) => lineClass(x, "cm-md-fence-head") && x.from === 0)).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-fence") && x.from === 6)).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-fence-foot") && x.from === 18)).toBe(true);
    const label = d.find((x) => x.widget === "LangLabelWidget");
    expect(label).toBeDefined();
    expect([label!.from, label!.to]).toEqual([0, 5]);
    expect(at(d, 18, 21).some(hidden)).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-fence-active"))).toBe(false);
  });
  it("dims the fences when the caret is inside the block", () => {
    const d = decos(doc, 8);
    expect(d.some((x) => x.widget === "LangLabelWidget")).toBe(false);
    expect(at(d, 0, 5).some(dimmed)).toBe(true);
    expect(at(d, 18, 21).some(dimmed)).toBe(true);
    expect(d.filter((x) => lineClass(x, "cm-md-fence-active")).length).toBe(3);
  });
});

describe("blockquotes", () => {
  const doc = "> quoted\n\ntext";
  it("hides `> ` and adds the line class", () => {
    const d = decos(doc, doc.length);
    expect(d.some((x) => lineClass(x, "cm-md-quote") && x.from === 0)).toBe(true);
    expect(at(d, 0, 2).some(hidden)).toBe(true);
  });
  it("reveals `> ` in the margin when active", () => {
    const d = decos(doc, 3);
    expect(at(d, 0, 2).some((x) => markClass(x, "cm-md-margin-mark"))).toBe(true);
  });
});

describe("lists", () => {
  it("replaces bullets (and the space after them) with widgets unless the line is active", () => {
    const doc = "- item\n- two";
    const d = decos(doc, doc.length);
    expect(d.some((x) => lineClass(x, "cm-md-li") && lineClass(x, "cm-md-li-ul") && x.from === 0)).toBe(true);
    expect(at(d, 0, 2).some((x) => x.widget === "BulletWidget")).toBe(true);
    expect(at(d, 7, 9).some((x) => markClass(x, "cm-md-listmark"))).toBe(true);
    expect(at(d, 7, 9).some((x) => x.widget === "BulletWidget")).toBe(false);
  });
  it("keeps ordered numbers visible in a fixed-width box", () => {
    const d = decos("1. one\n2. two", 13);
    expect(at(d, 0, 3).some((x) => markClass(x, "cm-md-olmark"))).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-li-ol") && x.from === 0)).toBe(true);
    expect(d.some((x) => x.widget === "BulletWidget")).toBe(false);
  });
  it("nests by depth and hides the raw indentation in both states", () => {
    const doc = "- a\n  - b";
    for (const caret of [0, doc.length]) {
      const d = decos(doc, caret);
      const nested = d.find((x) => lineClass(x, "cm-md-li-1") && x.from === 4)!;
      expect(nested.attrs.style).toBe("--li-depth: 1");
      expect(at(d, 4, 6).some((x) => x.kind === "replace" && !x.widget)).toBe(true);
    }
    const top = decos(doc, 0).find((x) => lineClass(x, "cm-md-li-0"))!;
    expect(top.attrs.style).toBe("--li-depth: 0");
    expect(at(decos(doc, 0), 6, 8).some((x) => x.widget === "BulletWidget")).toBe(true);
  });
  it("indents continuation lines of an item like the item itself", () => {
    const doc = "- first line\n  continues here\n- next";
    const d = decos(doc, doc.length);
    const cont = d.find((x) => lineClass(x, "cm-md-li-cont") && x.from === 13)!;
    expect(cont.attrs.style).toBe("--li-depth: 0");
    expect(at(d, 13, 15).some((x) => x.kind === "replace" && !x.widget)).toBe(true);
  });
});

describe("tasks", () => {
  const doc = "- [ ] todo\n- [x] done\n\nz";
  const source = (x: { widgetObj: object | null }) => (x.widgetObj as { source: string | null }).source;
  it("uses a checkbox widget in both states and marks done lines", () => {
    const d = decos(doc, doc.length);
    const boxes = d.filter((x) => x.widget === "CheckboxWidget");
    expect(boxes.map((b) => [b.from, b.to])).toEqual([
      [0, 6],
      [11, 17],
    ]);
    expect(boxes.every((b) => b.atomic && b.kind === "replace")).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-task") && lineClass(x, "cm-md-li-task") && x.from === 0)).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-task-done") && x.from === 11)).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-task-done") && x.from === 0)).toBe(false);
    expect(boxes.every((b) => source(b) === null)).toBe(true);
  });
  it("shows the raw marker beside the checkbox only on the active line", () => {
    const d = decos(doc, 8);
    const boxes = d.filter((x) => x.widget === "CheckboxWidget");
    expect(boxes.map(source)).toEqual(["- [ ]", null]);
  });
});

describe("blank lines", () => {
  it("tags blank lines between blocks so they can be shorter", () => {
    const doc = "# Title\n\nPara\n   \n- item";
    const d = decos(doc, 0);
    const blanks = d.filter((x) => lineClass(x, "cm-md-blank")).map((x) => x.from);
    expect(blanks).toEqual([8, 14]);
  });
  it("keeps blank lines inside code blocks and front matter at full height", () => {
    const doc = "---\na: 1\n\n---\n\n```\none\n\ntwo\n```\n";
    const d = decos(doc, 0);
    const blanks = d.filter((x) => lineClass(x, "cm-md-blank")).map((x) => doc.slice(0, x.from).split("\n").length);
    // Line 3 is inside front matter and line 8 inside the fence; 5 and 11 are between blocks.
    expect(blanks).toEqual([5, 11]);
  });
});

describe("horizontal rules", () => {
  const doc = "a\n\n---\n\nb";
  it("becomes a widget when inactive", () => {
    const d = decos(doc, 0);
    expect(at(d, 3, 6).some((x) => x.widget === "HrWidget")).toBe(true);
    expect(d.some((x) => lineClass(x, "cm-md-hr-line") && x.from === 3)).toBe(true);
  });
  it("shows the dashes dimmed when active", () => {
    const d = decos(doc, 4);
    expect(at(d, 3, 6).some(dimmed)).toBe(true);
    expect(d.some((x) => x.widget === "HrWidget")).toBe(false);
  });
});

describe("tables", () => {
  const doc = "| a | b |\n| - | - |\n| 1 | 2 |\n\ntext";
  it("renders a block table widget when the caret is outside", () => {
    const d = decos(doc, doc.length);
    const t = d.find((x) => x.widget === "TableWidget");
    expect(t).toBeDefined();
    expect(t!.block).toBe(true);
    expect([t!.from, t!.to]).toEqual([0, 29]);
    expect(d.some((x) => lineClass(x, "cm-md-table-raw"))).toBe(false);
  });
  it("shows raw rows when the caret is inside", () => {
    const d = decos(doc, 2);
    expect(d.some((x) => x.widget === "TableWidget")).toBe(false);
    expect(d.filter((x) => lineClass(x, "cm-md-table-raw")).length).toBe(3);
    expect(d.some((x) => dimmed(x) && x.text === "| - | - |")).toBe(true);
  });
});

describe("escapes and front matter", () => {
  it("hides the backslash of an escape", () => {
    const doc = "\\*not\\* a\n\nb";
    const d = decos(doc, doc.length);
    expect(at(d, 0, 1).some(hidden)).toBe(true);
    expect(at(d, 5, 6).some(hidden)).toBe(true);
    const active = decos(doc, 2);
    expect(at(active, 0, 1).some(dimmed)).toBe(true);
  });
  it("styles front matter and leaves its contents alone", () => {
    const doc = "---\ntitle: *x*\n---\n\n# H";
    const d = decos(doc, doc.length);
    const fm = d.filter((x) => lineClass(x, "cm-md-frontmatter"));
    expect(fm.map((x) => x.from)).toEqual([0, 4, 15]);
    expect(d.filter((x) => !lineClass(x, "cm-md-frontmatter") && x.from < 18).length).toBe(0);
    expect(d.some((x) => lineClass(x, "cm-md-h1") && x.from === 20)).toBe(true);
  });
});

describe("focus and placeholder", () => {
  it("renders everything when the editor is not focused", () => {
    const d = decos("# T\n\n**b**", 1, false);
    expect(d.some(dimmed)).toBe(false);
    expect(at(d, 0, 2).some(hidden)).toBe(true);
    expect(at(d, 5, 7).some(hidden)).toBe(true);
  });
  it("adds a hint widget on an empty active line", () => {
    const d = decos("text\n\nmore", 5);
    const ph = d.find((x) => x.widget === "LinePlaceholderWidget");
    expect(ph?.from).toBe(5);
    expect(decos("text\n\nmore", 0).some((x) => x.widget === "LinePlaceholderWidget")).toBe(false);
  });
});

const DEMO = `# Editor design notes

The editor should feel like **Typora**: one pane, no preview toggle, and the *syntax only shows where you are typing*. Everything else reads like a finished page.

## Principles

- Files on disk are the source of truth, never a database export.
- Nothing moves when you click into a line. Headings keep their size whether the \`#\` is visible or not.
  - nested with [a link](https://example.com) and ![img](x.png)

1. first
2. second ~~strike~~

- [x] Pick the editor engine (CodeMirror 6 and Lezer)
- [ ] Decide how a table is edited while the caret is inside it

> A good tool is one you forget you are using. See [the research notes](https://github.com/kevzhuo/Nota/blob/main/docs/research.md).

\`\`\`ts
const HIDE = new Set(["HeaderMark", "EmphasisMark"]);
if (!touches(parent.from, parent.to)) {
  ranges.push(Decoration.replace({}).range(node.from, node.to));
}
\`\`\`

| Node | Reveals when | Widget |
| --- | --- | --- |
| Heading | caret on the line | none |
| Emphasis | caret inside | none |

---

Escaped \\*stars\\* and <https://auto.link> and bare https://bare.link/path.
`;

describe("whole document", () => {
  const positions = [0, 10, 40, 120, 200, 260, 330, 420, 500, 600, 700, 760, DEMO.length];
  it("never produces overlapping replace decorations", () => {
    for (const pos of positions) {
      const d = decos(DEMO, Math.min(pos, DEMO.length))
        .filter((x) => x.kind === "replace")
        .sort((a, b) => a.from - b.from || a.to - b.to);
      for (let i = 1; i < d.length; i++) {
        expect(d[i].from, `at caret ${pos}: ${JSON.stringify(d[i - 1])} vs ${JSON.stringify(d[i])}`).toBeGreaterThanOrEqual(d[i - 1].to);
      }
    }
  });
  it("builds a decoration set for every caret position without throwing", () => {
    for (let pos = 0; pos <= DEMO.length; pos += 7) {
      expect(() => decos(DEMO, pos)).not.toThrow();
    }
  });
  it("keeps line decorations at line starts", () => {
    const state = stateOf(DEMO, 0);
    const d = decos(DEMO, 0).filter((x) => x.kind === "line");
    for (const x of d) {
      expect(state.doc.lineAt(x.from).from).toBe(x.from);
      expect(x.to).toBe(x.from);
    }
  });
});

describe("viewport-limited builds", () => {
  const long = Array.from({ length: 200 }, (_, i) => `## Heading ${i}\n\nText with **bold** ${i}.\n`).join("\n");

  it("only decorates the requested range, so cost follows the viewport", () => {
    const state = stateOf(long, 0);
    const lineTwelveEnd = state.doc.line(12).to;
    const set = buildDecorations(state, true, { from: 0, to: state.doc.line(10).to, tables: "skip" });
    const d = collect(set, long);
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => x.from <= lineTwelveEnd)).toBe(true);
    const full = collect(buildDecorations(state, true), long);
    expect(full.length).toBeGreaterThan(d.length * 10);
  });

  it("leaves tables to the table field when asked", () => {
    const doc = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nend";
    const state = stateOf(doc, 0);
    expect(collect(buildDecorations(state, true, { tables: "skip" }), doc).some((x) => x.widget === "TableWidget")).toBe(false);
    const tables = collect(buildBlockDecorations(state, true), doc);
    expect(tables.map((x) => [x.widget, x.block])).toEqual([["TableWidget", true]]);
    // With the caret inside, the table is raw and the field adds nothing.
    const inside = stateOf(doc, doc.indexOf("| 1"));
    expect(collect(buildBlockDecorations(inside, true), doc)).toEqual([]);
  });

  it("finds tables nested in lists and quotes", () => {
    const doc = "> | a |\n> | - |\n> | 1 |\n\nx";
    expect(collect(buildBlockDecorations(stateOf(doc, doc.length), true), doc).some((x) => x.widget === "TableWidget")).toBe(true);
  });
});

describe("math", () => {
  const blocks = (doc: string, cursor: number, focused = true) => collect(buildBlockDecorations(stateOf(doc, cursor), focused), doc);
  const math = (d: DecoInfo) => d.widgetObj as { tex: string; display: boolean; mode: string };

  it("renders inline math away from the caret", () => {
    const doc = "Energy $E = mc^2$ here.\n\nend";
    const d = decos(doc, doc.length);
    const w = d.find((x) => x.widget === "MathWidget")!;
    expect([w.kind, w.text]).toEqual(["replace", "$E = mc^2$"]);
    expect(math(w)).toMatchObject({ tex: "E = mc^2", display: false, mode: "inline" });
  });

  it("shows inline math's source at the caret, delimiters dimmed", () => {
    const doc = "Energy $E = mc^2$ here.";
    const d = decos(doc, doc.indexOf("mc"));
    expect(d.some((x) => x.widget === "MathWidget")).toBe(false);
    expect(d.some((x) => markClass(x, "cm-md-math-src") && x.text === "$E = mc^2$")).toBe(true);
    expect(d.filter((x) => dimmed(x) && x.text === "$")).toHaveLength(2);
  });

  it("draws $$ inside a paragraph in display style", () => {
    const doc = "So $$x^2$$ is it\n\nend";
    expect(math(decos(doc, doc.length).find((x) => x.widget === "MathWidget")!).display).toBe(true);
  });

  it("replaces a closed block with a rendered formula away from the caret", () => {
    const doc = "Intro\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nend";
    const b = blocks(doc, doc.length);
    expect(b).toHaveLength(1);
    expect([b[0].kind, b[0].block, b[0].text]).toEqual(["replace", true, "$$\n\\int_0^1 x\\,dx\n$$"]);
    expect(math(b[0])).toMatchObject({ tex: "\\int_0^1 x\\,dx", display: true, mode: "block" });
    // The view plugin leaves the block alone.
    expect(decos(doc, doc.length).some((x) => lineClass(x, "cm-md-math-line"))).toBe(false);
  });

  it("shows a block's source with a live preview under it at the caret", () => {
    const doc = "Intro\n\n$$\nx^2\n$$\n\nend";
    const caret = doc.indexOf("x^2");
    const b = blocks(doc, caret);
    expect(b.map((x) => [x.kind, x.block, x.from])).toEqual([["widget", true, doc.indexOf("$$\n\nend") + 2]]);
    expect(math(b[0])).toMatchObject({ tex: "x^2", mode: "preview" });
    const d = decos(doc, caret);
    expect(d.filter((x) => lineClass(x, "cm-md-math-line"))).toHaveLength(3);
    expect(d.filter((x) => dimmed(x) && x.text === "$$")).toHaveLength(2);
  });

  it("renders everything when the editor isn't focused", () => {
    const doc = "$$\nx\n$$";
    expect(blocks(doc, 3, false).map((x) => math(x).mode)).toEqual(["block"]);
  });

  it("leaves an unclosed block as source, without a preview elsewhere", () => {
    const doc = "$$\nx = 1\n\nAfter";
    expect(blocks(doc, doc.length)).toEqual([]);
    expect(decos(doc, doc.length).filter((x) => lineClass(x, "cm-md-math-line"))).toHaveLength(2);
  });
});

describe("image previews", () => {
  const doc = "Text\n\n![Sunset](attachments/sunset.png)\n\nend";

  it("shows the picture under an image's source at the caret", () => {
    const b = collect(buildBlockDecorations(stateOf(doc, doc.indexOf("Sunset")), true), doc);
    const lineEnd = doc.indexOf(")") + 1;
    expect(b.map((x) => [x.widget, x.block, x.from])).toEqual([["ImageWidget", true, lineEnd]]);
    expect(b[0].widgetObj).toMatchObject({ src: "attachments/sunset.png", alt: "Sunset", preview: true });
  });

  it("adds no preview when the caret is elsewhere", () => {
    expect(collect(buildBlockDecorations(stateOf(doc, doc.length), true), doc)).toEqual([]);
  });
});
