import { afterEach, describe, expect, it } from "vitest";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { BLOCK_ITEMS, slashSource } from "./slashMenu";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function ctx(doc: string, pos: number) {
  const state = EditorState.create({ doc, selection: EditorSelection.single(pos), extensions: [markdown({ base: markdownLanguage })] });
  return new CompletionContext(state, pos, false);
}

function run(doc: string, pos: number, label: string) {
  const result = slashSource(ctx(doc, pos));
  if (!result) throw new Error("no completion result");
  const option = result.options.find((o: Completion) => o.label === label);
  if (!option) throw new Error(`no option ${label}`);
  view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.single(pos), extensions: [markdown({ base: markdownLanguage })] }),
    parent: document.body,
  });
  (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(view, option, result.from, pos);
  return view;
}

describe("slashSource", () => {
  it("offers block items when the line is a slash command", () => {
    const result = slashSource(ctx("/", 1));
    expect(result).not.toBeNull();
    expect(result!.from).toBe(1);
    expect(result!.options.map((o) => o.label)).toEqual(BLOCK_ITEMS.map((b) => b.label));
  });
  it("keeps the typed query as the completion range", () => {
    const result = slashSource(ctx("text\n  /hea", 11));
    expect(result).not.toBeNull();
    expect(result!.from).toBe(8);
  });
  it("returns nothing when the slash is not at the line start", () => {
    expect(slashSource(ctx("a /b", 4))).toBeNull();
    expect(slashSource(ctx("http://x", 8))).toBeNull();
    expect(slashSource(ctx("plain", 5))).toBeNull();
  });
});

describe("applying a block item", () => {
  it("replaces the slash with a heading prefix and leaves the caret after it", () => {
    const v = run("intro\n/head", 11, "Heading 2");
    expect(v.state.doc.toString()).toBe("intro\n## ");
    expect(v.state.selection.main.head).toBe(9);
  });
  it("inserts a code fence with the caret on the middle line", () => {
    const v = run("/", 1, "Code block");
    expect(v.state.doc.toString()).toBe("```\n\n```");
    expect(v.state.selection.main.head).toBe(3);
  });
  it("inserts a task item", () => {
    const v = run("/to", 3, "To-do list");
    expect(v.state.doc.toString()).toBe("- [ ] ");
    expect(v.state.selection.main.head).toBe(6);
  });
  it("inserts a divider followed by a fresh line", () => {
    const v = run("/div", 4, "Divider");
    expect(v.state.doc.toString()).toBe("---\n");
    expect(v.state.selection.main.head).toBe(4);
  });
});
