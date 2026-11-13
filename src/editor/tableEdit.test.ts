import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { applyOp, cellAt, insertTable, layoutTable, parseTableText, splitRow, tableAt, tableEditing, type TableModel } from "./tableEdit";

const model = (header: string[], rows: string[][], prefix = ""): TableModel => ({ prefix, header, aligns: header.map(() => null), rows });

describe("reading and writing tables", () => {
  it("splits rows at pipes, but not escaped ones or ones in code", () => {
    expect(splitRow("| a | b \\| c | `x | y` |")).toEqual(["a", "b \\| c", "`x | y`"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
    expect(splitRow("|  | b |")).toEqual(["", "b"]);
  });

  it("reads alignment, fits rows to the header, and keeps a quote's prefix", () => {
    const m = parseTableText("> | A | B | C |\n> | :-- | :-: | --: |\n> | 1 |\n> | 1 | 2 | 3 | 4 |");
    expect(m.prefix).toBe("> ");
    expect(m.aligns).toEqual(["left", "center", "right"]);
    expect(m.rows).toEqual([
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });

  it("writes columns padded to line up, honouring alignment, and knows where each cell starts", () => {
    const m: TableModel = { prefix: "", header: ["Name", "Qty"], aligns: [null, "right"], rows: [["Apples", "3"]] };
    const { text, cells } = layoutTable(m);
    expect(text).toBe("| Name   | Qty |\n| ------ | --: |\n| Apples |   3 |");
    expect(text.slice(cells[1][1], cells[1][1] + 1)).toBe("3");
    expect(text.slice(cells[0][0], cells[0][0] + 4)).toBe("Name");
    // Round trip.
    expect(parseTableText(text)).toEqual(m);
  });

  it("adds and removes rows and columns, aligns, and deletes", () => {
    const m = model(["A", "B"], [["1", "2"]]);
    expect(applyOp(m, { kind: "insertRow", at: 0 })!.rows).toEqual([["", ""], ["1", "2"]]);
    expect(applyOp(m, { kind: "deleteRow", row: 1 })!.rows).toEqual([]);
    expect(applyOp(m, { kind: "deleteRow", row: 0 })).toBe(m);
    const wider = applyOp(m, { kind: "insertColumn", at: 1 })!;
    expect(wider.header).toEqual(["A", "Column 3", "B"]);
    expect(wider.rows).toEqual([["1", "", "2"]]);
    expect(applyOp(m, { kind: "deleteColumn", col: 0 })!.header).toEqual(["B"]);
    expect(applyOp(model(["A"], []), { kind: "deleteColumn", col: 0 })).toBeNull();
    expect(applyOp(m, { kind: "align", col: 1, align: "center" })!.aligns).toEqual([null, "center"]);
    expect(applyOp(m, { kind: "deleteTable" })).toBeNull();
  });
});

describe("in the editor", () => {
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });
  const setup = (doc: string, anchor: number, head = anchor) => {
    view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown({ base: markdownLanguage }), tableEditing()] }),
      parent: document.body,
    });
    return view;
  };
  const press = (v: EditorView, key: string, shiftKey = false) => runScopeHandlers(v, new KeyboardEvent("keydown", { key, shiftKey }), "editor");
  const selected = (v: EditorView) => v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);

  it("finds the cell under the caret, including tables without outer pipes", () => {
    const doc = "Intro\n\n| A | B |\n| - | - |\n| 1 | 2 |\n";
    const v = setup(doc, 0);
    const table = tableAt(v.state, doc.indexOf("| 1"))!;
    expect(v.state.sliceDoc(table.from, table.to)).toBe("| A | B |\n| - | - |\n| 1 | 2 |");
    expect(cellAt(v.state, table, doc.indexOf("2"))).toEqual({ row: 1, col: 1 });
    expect(cellAt(v.state, table, doc.indexOf("B"))).toEqual({ row: 0, col: 1 });
    const bare = "a | b\n--|--\nc | d\n";
    const w = setup(bare, 0);
    expect(cellAt(w.state, tableAt(w.state, 1)!, bare.indexOf("d"))).toEqual({ row: 1, col: 1 });
  });

  it("inserts a table with the first column name selected, and Tab walks the cells, adding a row at the end", () => {
    const v = setup("\n", 0);
    insertTable(v, 0, 0);
    expect(selected(v)).toBe("Column 1");
    expect(v.state.doc.toString().split("\n")).toHaveLength(5);
    press(v, "Tab");
    expect(selected(v)).toBe("Column 2");
    press(v, "Tab", true);
    expect(selected(v)).toBe("Column 1");
    // To the last cell, then one more Tab adds a row.
    for (let i = 0; i < 8; i++) press(v, "Tab");
    const before = v.state.doc.toString().split("\n").length;
    press(v, "Tab");
    expect(v.state.doc.toString().split("\n").length).toBe(before + 1);
    const table = tableAt(v.state, v.state.selection.main.head)!;
    expect(cellAt(v.state, table, v.state.selection.main.head)).toEqual({ row: 3, col: 0 });
  });

  it("makes room for an inserted table and carries a quote's marker onto every row", () => {
    const v = setup("Text above\n\nText below", "Text above\n".length);
    insertTable(v, "Text above\n".length, "Text above\n".length);
    const lines = v.state.doc.toString().split("\n");
    expect(lines[0]).toBe("Text above");
    expect(lines[1]).toBe("");
    expect(lines[2]).toMatch(/^\| Column 1 /);
    expect(lines[6]).toBe("");
    expect(lines[7]).toBe("Text below");
    const q = setup("> ", 2);
    insertTable(q, 2, 2);
    expect(q.state.doc.toString().split("\n").every((l) => l.startsWith("> | "))).toBe(true);
    expect(selected(q)).toBe("Column 1");
  });

  it("leaves Tab alone outside tables", () => {
    const v = setup("Just text", 4);
    expect(press(v, "Tab")).toBe(false);
  });
});
