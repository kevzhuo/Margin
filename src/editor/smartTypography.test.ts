import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { mathSyntax } from "./mathSyntax";
import { smartTypography } from "./smartTypography";
import { wrapSelectionOnType } from "./wrapSelection";

let view: EditorView | null = null;
let enabled = true;
afterEach(() => {
  view?.destroy();
  view = null;
  enabled = true;
});

/** A doc with the caret at `‸`, or a selection between two `‸`s. */
function setup(marked: string) {
  const anchor = marked.indexOf("‸");
  const rest = marked.slice(0, anchor) + marked.slice(anchor + 1);
  const head = rest.indexOf("‸");
  const doc = head === -1 ? rest : rest.slice(0, head) + rest.slice(head + 1);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head: head === -1 ? anchor : head },
      extensions: [history(), markdown({ base: markdownLanguage, extensions: [mathSyntax] }), smartTypography(() => enabled), wrapSelectionOnType],
    }),
    parent: document.body,
  });
  return view;
}

/** Type characters one at a time, running the input handlers as CodeMirror does. */
function type(v: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = v.state.selection.main;
    const insert = () => v.state.update({ changes: { from, to, insert: ch }, selection: { anchor: from + 1 }, userEvent: "input.type" });
    const handled = v.state.facet(EditorView.inputHandler).some((h) => h(v, from, to, ch, insert));
    if (!handled) v.dispatch(insert());
  }
}

/** The doc with `‸` at the caret. */
function shown(v: EditorView) {
  const doc = v.state.doc.toString();
  const head = v.state.selection.main.head;
  return doc.slice(0, head) + "‸" + doc.slice(head);
}

describe("smart typography", () => {
  it("curls double and single quotes, and apostrophes", () => {
    const v = setup("‸");
    type(v, `She said "it's 'fine'" (and "ok").`);
    expect(v.state.doc.toString()).toBe("She said “it’s ‘fine’” (and “ok”).");
  });

  it("opens a quote after emphasis marks and closes one after emphasised text", () => {
    const v = setup("‸");
    type(v, `*"a"* **bold**"`);
    expect(v.state.doc.toString()).toBe("*“a”* **bold**”");
  });

  it("turns two hyphens into an em dash and three dots into an ellipsis", () => {
    const v = setup("‸");
    type(v, "wait--what...");
    expect(shown(v)).toBe("wait—what…‸");
  });

  it("leaves rules, table rows, list markers and HTML comments alone", () => {
    for (const [start, typed, expected] of [
      ["‸", "---", "---"],
      ["‸", "> ---", "> ---"],
      ["| a | b |\n‸", "| --- | :--: |", "| a | b |\n| --- | :--: |"],
      ["‸", "- item", "- item"],
      ["‸", "<!-- note", "<!-- note"],
    ]) {
      const v = setup(start);
      type(v, typed);
      expect(v.state.doc.toString()).toBe(expected);
      v.destroy();
    }
  });

  it("types literally in code, math, URLs, HTML tags and front matter", () => {
    for (const [start, typed, expected] of [
      ["`‸`", `"a"--b...`, '`"a"--b...`'],
      ["‸", '`x = "y"', '`x = "y"'],
      ["```\n‸\n```", `print("hi")...`, '```\nprint("hi")...\n```'],
      ["‸", "$f'(x)", "$f'(x)"],
      ["$$\n‸\n$$", "a--b", "$$\na--b\n$$"],
      ["[link](‸)", "../a--b", "[link](../a--b)"],
      ["‸", "see https://x.com/a--b...", "see https://x.com/a--b..."],
      ["‸", '<span title="x', '<span title="x'],
      ["---\ntitle: ‸\n---\n", '"A"', '---\ntitle: "A"\n---\n'],
    ]) {
      const v = setup(start);
      type(v, typed);
      expect(v.state.doc.toString()).toBe(expected);
      v.destroy();
    }
  });

  it("still curls quotes in prose next to code, and after a price", () => {
    const v = setup("‸");
    type(v, `\`x\`'s "y" costs $5 "z"`);
    expect(v.state.doc.toString()).toBe("`x`’s “y” costs $5 “z”");
  });

  it("wraps a selection in curly quotes", () => {
    const v = setup("say ‸hello‸ now");
    type(v, '"');
    expect(v.state.doc.toString()).toBe("say “hello” now");
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe("hello");
  });

  it("undo right after a change brings back what was typed", () => {
    const v = setup("a‸");
    type(v, "--");
    expect(v.state.doc.toString()).toBe("a—");
    undo(v);
    expect(shown(v)).toBe("a--‸");
    const q = setup("‸");
    type(q, '"');
    undo(q);
    expect(shown(q)).toBe('"‸');
  });

  it("does nothing when turned off", () => {
    enabled = false;
    const v = setup("‸");
    type(v, `"it's"--...`);
    expect(v.state.doc.toString()).toBe(`"it's"--...`);
  });
});
