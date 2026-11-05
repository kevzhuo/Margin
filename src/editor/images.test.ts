import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { imageInput, insertImages, placement } from "./images";

const text = (s: string) => Text.of(s.split("\n"));

describe("placement", () => {
  it("puts an image dropped mid-sentence after the line", () => {
    const doc = text("Second paragraph.\nNext");
    expect(placement(doc, { from: 6, to: 6 })).toEqual({ from: 17, to: 17, before: "\n", after: "" });
  });

  it("puts an image dropped at the start of a line before it", () => {
    const doc = text("Para\nSecond paragraph.");
    expect(placement(doc, { from: 5, to: 5 })).toEqual({ from: 5, to: 5, before: "", after: "\n" });
  });

  it("uses an empty line as it is", () => {
    const doc = text("a\n\nb");
    expect(placement(doc, { from: 2, to: 2 })).toEqual({ from: 2, to: 2, before: "", after: "" });
  });

  it("replaces a selection, keeping the image on its own line", () => {
    const doc = text("keep this replace and that");
    expect(placement(doc, { from: 10, to: 17 })).toEqual({ from: 10, to: 17, before: "\n", after: "\n" });
  });
});

describe("insertImages", () => {
  let view: EditorView | null = null;
  afterEach(() => view?.destroy());

  function setup(doc: string) {
    let resolve!: (snippets: string[]) => void;
    const saved: File[][] = [];
    const save = (files: File[]) => {
      saved.push(files);
      return new Promise<string[]>((r) => (resolve = r));
    };
    view = new EditorView({ state: EditorState.create({ doc, extensions: [imageInput(save)] }), parent: document.body });
    return { view, saved, finish: (s: string[]) => resolve(s) };
  }

  const file = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" });

  it("inserts where the image was dropped, even after edits made while saving", async () => {
    const { view, saved, finish } = setup("Line one\n\nLine two");
    const done = insertImages(view, [file("a.png")], 9, 9, "input.drop"); // the empty line
    expect(saved).toHaveLength(1);
    view.dispatch({ changes: { from: 0, insert: "Typed meanwhile. " } });
    finish(["![a](attachments/a.png)"]);
    await done;
    expect(view.state.doc.toString()).toBe("Typed meanwhile. Line one\n![a](attachments/a.png)\nLine two");
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf(")") + 1);
  });

  it("inserts several images on lines of their own, in one undoable step", async () => {
    const { view, finish } = setup("");
    const done = insertImages(view, [file("a.png"), file("b.png")], 0, 0, "input.paste");
    finish(["![a](a.png)", "![b](b.png)"]);
    await done;
    expect(view.state.doc.toString()).toBe("![a](a.png)\n![b](b.png)");
  });

  it("drops the insertion if the note was switched while saving", async () => {
    const { view, finish } = setup("First note");
    const done = insertImages(view, [file("a.png")], 5, 5, "input.drop");
    view.setState(EditorState.create({ doc: "Second note", extensions: [imageInput(async () => [])] }));
    finish(["![a](a.png)"]);
    await done;
    expect(view.state.doc.toString()).toBe("Second note");
  });

  it("changes nothing when no image could be saved", async () => {
    const { view, finish } = setup("Text");
    const done = insertImages(view, [file("a.png")], 4, 4, "input.drop");
    finish([]);
    await done;
    expect(view.state.doc.toString()).toBe("Text");
  });
});
