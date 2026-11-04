import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { insertLink, setHeading, toggleBlockquote, toggleInline, toggleTask } from "./commands";
import { livePreview } from "./livePreview";

let view: EditorView;

function mount(doc: string, anchor: number, head = anchor) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [markdown({ base: markdownLanguage }), livePreview()],
    }),
    parent: document.body,
  });
  return view;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  view?.destroy();
});

describe("toggleInline", () => {
  it("inserts a wrapper and places the caret inside for an empty selection", () => {
    mount("hello ", 6);
    expect(toggleInline("**")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello ****");
    expect(view.state.selection.main.head).toBe(8);
  });
  it("wraps a selection and keeps it selected", () => {
    mount("make this bold", 5, 9);
    toggleInline("**")(view);
    expect(view.state.doc.toString()).toBe("make **this** bold");
    const { from, to } = view.state.selection.main;
    expect(view.state.doc.sliceString(from, to)).toBe("this");
  });
  it("unwraps when the selection is already wrapped", () => {
    mount("make **this** bold", 7, 11);
    toggleInline("**")(view);
    expect(view.state.doc.toString()).toBe("make this bold");
    const { from, to } = view.state.selection.main;
    expect(view.state.doc.sliceString(from, to)).toBe("this");
  });
  it("unwraps when the selection includes the wrapper", () => {
    mount("a *b* c", 2, 5);
    toggleInline("*")(view);
    expect(view.state.doc.toString()).toBe("a b c");
  });
  it("supports multiple selections", () => {
    view = new EditorView({
      state: EditorState.create({
        doc: "one two",
        selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]),
        extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: markdownLanguage })],
      }),
      parent: document.body,
    });
    toggleInline("`")(view);
    expect(view.state.doc.toString()).toBe("`one` `two`");
  });
});

describe("setHeading", () => {
  it("sets a heading level on the caret line", () => {
    mount("Title\n\ntext", 2);
    setHeading(2)(view);
    expect(view.state.doc.toString()).toBe("## Title\n\ntext");
  });
  it("replaces an existing level and clears when the level matches", () => {
    mount("### Title", 5);
    setHeading(1)(view);
    expect(view.state.doc.toString()).toBe("# Title");
    setHeading(1)(view);
    expect(view.state.doc.toString()).toBe("Title");
  });
  it("level 0 removes the heading", () => {
    mount("## Title", 4);
    setHeading(0)(view);
    expect(view.state.doc.toString()).toBe("Title");
  });
  it("applies to every selected line once", () => {
    mount("a\nb\nc", 0, 5);
    setHeading(3)(view);
    expect(view.state.doc.toString()).toBe("### a\n### b\n### c");
  });
});

describe("toggleTask", () => {
  it("turns a plain line into a task", () => {
    mount("buy milk", 3);
    toggleTask(view);
    expect(view.state.doc.toString()).toBe("- [ ] buy milk");
  });
  it("adds a checkbox to a list item", () => {
    mount("- buy milk", 4);
    toggleTask(view);
    expect(view.state.doc.toString()).toBe("- [ ] buy milk");
  });
  it("flips an existing task marker", () => {
    mount("- [ ] buy milk", 8);
    toggleTask(view);
    expect(view.state.doc.toString()).toBe("- [x] buy milk");
    toggleTask(view);
    expect(view.state.doc.toString()).toBe("- [ ] buy milk");
  });
});

describe("insertLink", () => {
  it("wraps selected text and selects the url placeholder", () => {
    mount("read docs now", 5, 9);
    insertLink(view);
    expect(view.state.doc.toString()).toBe("read [docs](url) now");
    const { from, to } = view.state.selection.main;
    expect(view.state.doc.sliceString(from, to)).toBe("url");
  });
  it("uses a selected URL as the target", () => {
    mount("see https://a.b", 4, 15);
    insertLink(view);
    expect(view.state.doc.toString()).toBe("see [](https://a.b)");
    expect(view.state.selection.main.head).toBe(5);
  });
});

describe("toggleBlockquote", () => {
  it("adds and removes the quote marker", () => {
    mount("line", 1);
    toggleBlockquote(view);
    expect(view.state.doc.toString()).toBe("> line");
    toggleBlockquote(view);
    expect(view.state.doc.toString()).toBe("line");
  });
});
