import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { wrapSelectionOnType } from "./wrapSelection";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function setup(doc: string, anchor: number, head = anchor) {
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: [wrapSelectionOnType] }),
    parent: document.body,
  });
  return view;
}

/** Run the input handlers the way CodeMirror does for typed text. */
function type(v: EditorView, text: string) {
  const { from, to } = v.state.selection.main;
  const handled = v.state.facet(EditorView.inputHandler).some((h) => h(v, from, to, text, () => v.state.update({ changes: { from, to, insert: text } })));
  if (!handled) v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
}

describe("wrap selection on type", () => {
  it("wraps the selection and keeps it selected so delimiters stack", () => {
    const v = setup("make it bold", 8, 12);
    type(v, "*");
    expect(v.state.doc.toString()).toBe("make it *bold*");
    type(v, "*");
    expect(v.state.doc.toString()).toBe("make it **bold**");
    const sel = v.state.selection.main;
    expect(v.state.sliceDoc(sel.from, sel.to)).toBe("bold");
  });

  it("wraps backwards selections and other delimiters", () => {
    const v = setup("a code b", 6, 2);
    type(v, "`");
    expect(v.state.doc.toString()).toBe("a `code` b");
    expect(v.state.selection.main.head).toBe(3);
    expect(v.state.selection.main.anchor).toBe(7);
  });

  it("types normally with an empty selection or other characters", () => {
    const v = setup("abc", 3);
    type(v, "*");
    expect(v.state.doc.toString()).toBe("abc*");
    const w = setup("abc", 0, 3);
    view = w;
    type(w, "x");
    expect(w.state.doc.toString()).toBe("x");
  });
});
