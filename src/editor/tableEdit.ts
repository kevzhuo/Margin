import { EditorSelection, Facet, Prec, type EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { completionStatus } from "@codemirror/autocomplete";
import type { SyntaxNode } from "@lezer/common";
import { placeholderSelection } from "./placeholderSelection";

/**
 * Editing Markdown tables as tables: Tab between cells, and rows and columns
 * added, removed and aligned from a right-click menu. Every change rewrites
 * the whole table with its columns padded to line up, so the source stays
 * readable too.
 */

export type Align = "left" | "center" | "right" | null;

export interface TableModel {
  /** What starts every line before the table itself: a quote's "> " or a list item's indent. */
  prefix: string;
  header: string[];
  aligns: Align[];
  rows: string[][];
}

/** A cell: row 0 is the header, 1 and up the body rows. */
export interface CellRef {
  row: number;
  col: number;
}

/** Where a table is in the document: from the start of its first line to the end of its last. */
export interface TableRange {
  from: number;
  to: number;
}

export type TableOp =
  | { kind: "insertRow"; at: number }
  | { kind: "deleteRow"; row: number }
  | { kind: "insertColumn"; at: number }
  | { kind: "deleteColumn"; col: number }
  | { kind: "align"; col: number; align: Align }
  | { kind: "deleteTable" };

const PREFIX = /^(?:[ \t]*>)*[ \t]*/;

/** Walk a table row's text, calling `onPipe` at each unescaped pipe outside code spans. */
function scanPipes(text: string, onPipe: (index: number) => void) {
  let code = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
    } else if (c === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      code = code === 0 ? run : code === run ? 0 : code;
      i += run - 1;
    } else if (c === "|" && code === 0) {
      onPipe(i);
    }
  }
}

/** Split a table line into its cells. */
export function splitRow(line: string): string[] {
  const body = line.trim();
  const cells: string[] = [];
  let start = 0;
  scanPipes(body, (i) => {
    cells.push(body.slice(start, i));
    start = i + 1;
  });
  cells.push(body.slice(start));
  // A leading or trailing pipe has nothing outside it.
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

function parseAlign(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

/** Read a table's lines (with any quote or list prefix) into a model. */
export function parseTableText(text: string): TableModel {
  const lines = text.split("\n");
  const prefix = PREFIX.exec(lines[0])![0];
  const strip = (l: string) => l.slice(Math.min(prefix.length, PREFIX.exec(l)![0].length));
  const header = splitRow(strip(lines[0]));
  const fit = (cells: string[]) => Array.from({ length: header.length }, (_, i) => cells[i] ?? "");
  return {
    prefix,
    header,
    aligns: fit(lines[1] ? splitRow(strip(lines[1])) : []).map(parseAlign),
    rows: lines.slice(2).map((l) => fit(splitRow(strip(l)))),
  };
}

/** How wide text looks in a monospace column: wide (East Asian) characters count twice. */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(ch) ? 2 : 1;
  return w;
}

/** A table written out: its text, and where each cell's text starts in it (by row, then column). */
export interface TableLayout {
  text: string;
  cells: number[][];
}

/** Write a model out with every column padded to line up. */
export function layoutTable(model: TableModel): TableLayout {
  const all = [model.header, ...model.rows];
  const widths = model.header.map((_, c) => Math.max(3, ...all.map((r) => displayWidth(r[c] ?? ""))));
  const lines: string[] = [];
  const cells: number[][] = [];
  let offset = 0;
  const addLine = (parts: string[], record: boolean) => {
    let line = `${model.prefix}|`;
    const starts: number[] = [];
    parts.forEach((text, c) => {
      const space = widths[c] - displayWidth(text);
      const align = model.aligns[c];
      const before = align === "right" ? space : align === "center" ? Math.floor(space / 2) : 0;
      line += " " + " ".repeat(before);
      starts.push(offset + line.length);
      line += text + " ".repeat(space - before) + " |";
    });
    if (record) cells.push(starts);
    lines.push(line);
    offset += line.length + 1;
  };
  const rule = (c: number) => {
    const a = model.aligns[c];
    const dashes = "-".repeat(widths[c] - (a === "center" ? 2 : a ? 1 : 0));
    return a === "center" ? `:${dashes}:` : a === "left" ? `:${dashes}` : a === "right" ? `${dashes}:` : dashes;
  };
  addLine(model.header, true);
  addLine(model.header.map((_, c) => rule(c)), false);
  for (const row of model.rows) addLine(row, true);
  return { text: lines.join("\n"), cells };
}

/** Apply a change to a model. Returns null when the table should go entirely. */
export function applyOp(model: TableModel, op: TableOp): TableModel | null {
  const width = model.header.length;
  switch (op.kind) {
    case "insertRow": {
      const rows = [...model.rows];
      rows.splice(Math.max(0, Math.min(op.at, rows.length)), 0, Array.from({ length: width }, () => ""));
      return { ...model, rows };
    }
    case "deleteRow":
      return op.row < 1 ? model : { ...model, rows: model.rows.filter((_, i) => i !== op.row - 1) };
    case "insertColumn": {
      const at = Math.max(0, Math.min(op.at, width));
      const insert = <T,>(list: T[], value: T) => [...list.slice(0, at), value, ...list.slice(at)];
      return {
        ...model,
        header: insert(model.header, `Column ${width + 1}`),
        aligns: insert(model.aligns, null),
        rows: model.rows.map((r) => insert(r, "")),
      };
    }
    case "deleteColumn": {
      if (width <= 1) return null;
      const drop = <T,>(list: T[]) => list.filter((_, i) => i !== op.col);
      return { ...model, header: drop(model.header), aligns: drop(model.aligns), rows: model.rows.map(drop) };
    }
    case "align":
      return { ...model, aligns: model.aligns.map((a, i) => (i === op.col ? op.align : a)) };
    case "deleteTable":
      return null;
  }
}

/** The table at `pos` (or just touching it), if there is one. */
export function tableAt(state: EditorState, pos: number): TableRange | null {
  for (const side of [-1, 1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === "Table") return { from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to };
    }
  }
  return null;
}

/** The cell a position in a table's source falls in. The delimiter line counts as the header. */
export function cellAt(state: EditorState, table: TableRange, pos: number): CellRef {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  const prefix = PREFIX.exec(line.text)![0].length;
  const body = line.text.slice(prefix);
  let pipes = 0;
  scanPipes(body.slice(0, Math.max(0, pos - line.from - prefix)), () => pipes++);
  const width = parseTableText(doc.sliceString(table.from, table.to)).header.length;
  const col = Math.max(0, Math.min(pipes - (body.startsWith("|") ? 1 : 0), width - 1));
  const lineIndex = line.number - doc.lineAt(table.from).number;
  return { row: lineIndex <= 1 ? 0 : lineIndex - 1, col };
}

/**
 * Replace a table with its edited (and tidied) version. With `focus`, the
 * caret goes to that cell, selecting its text when `select` is set;
 * otherwise it stays where it was, mapped through the change.
 */
export function rewriteTable(view: EditorView, table: TableRange, op: TableOp | null, focus?: CellRef & { select?: boolean }): boolean {
  if (view.state.readOnly) return false;
  const doc = view.state.doc;
  const model = parseTableText(doc.sliceString(table.from, table.to));
  const next = op ? applyOp(model, op) : model;
  if (!next) {
    // Take the blank line after it too, so no gap is left behind.
    const end = table.to < doc.length && doc.lineAt(table.to + 1).text.trim() === "" ? doc.lineAt(table.to + 1).to : table.to;
    view.dispatch({ changes: { from: table.from, to: Math.min(end + 1, doc.length) }, userEvent: "delete" });
    return true;
  }
  const { text, cells } = layoutTable(next);
  let selection: EditorSelection | undefined;
  if (focus) {
    const row = Math.max(0, Math.min(focus.row, cells.length - 1));
    const col = Math.max(0, Math.min(focus.col, cells[row].length - 1));
    const start = table.from + cells[row][col];
    const cellText = (row === 0 ? next.header : next.rows[row - 1])[col] ?? "";
    selection = focus.select && cellText ? EditorSelection.create([EditorSelection.range(start, start + cellText.length)]) : EditorSelection.create([EditorSelection.cursor(start + cellText.length)]);
  }
  view.dispatch({
    changes: { from: table.from, to: table.to, insert: text },
    selection,
    scrollIntoView: !!focus,
    userEvent: "input",
    annotations: focus?.select ? placeholderSelection.of(true) : [],
  });
  return true;
}

/**
 * A table for the slash menu: three columns and two rows, with the first
 * column's name selected to type over. It takes the line's indent or quote
 * marker onto every row, and blank lines around it where needed, so it
 * never runs into the text next to it.
 */
export function insertTable(view: EditorView, from: number, to: number): boolean {
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const prefix = doc.sliceString(line.from, from);
  const model: TableModel = { prefix, header: ["Column 1", "Column 2", "Column 3"], aligns: [null, null, null], rows: [["", "", ""], ["", "", ""]] };
  const { text, cells } = layoutTable(model);
  const blank = (n: number) => n < 1 || n > doc.lines || doc.line(n).text.slice(prefix.length).trim() === "";
  const before = blank(line.number - 1) ? "" : `\n${prefix.trimEnd() ? prefix : ""}`;
  const after = doc.lineAt(to).number < doc.lines && !blank(doc.lineAt(to).number + 1) ? "\n" : "";
  const start = line.from + before.length + cells[0][0];
  view.dispatch({
    changes: { from: line.from, to, insert: before + text + after },
    selection: EditorSelection.create([EditorSelection.range(start, start + "Column 1".length)]),
    scrollIntoView: true,
    userEvent: "input.complete",
    annotations: placeholderSelection.of(true),
  });
  return true;
}

/** Tab to the next cell (adding a row after the last), Shift-Tab to the previous; the cell's text is selected. */
function moveCell(direction: 1 | -1) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const head = state.selection.main.head;
    // Only an open menu takes Tab; a check for one that's still pending (just after typing) doesn't.
    if (state.selection.ranges.length > 1 || state.readOnly || completionStatus(state) === "active") return false;
    const table = tableAt(state, head);
    if (!table) return false;
    const model = parseTableText(state.sliceDoc(table.from, table.to));
    const { row, col } = cellAt(state, table, head);
    const width = model.header.length;
    let next = { row, col: col + direction };
    if (next.col >= width) next = { row: row + 1, col: 0 };
    if (next.col < 0) next = { row: row - 1, col: width - 1 };
    if (next.row < 0) return true;
    if (next.row > model.rows.length) return rewriteTable(view, table, { kind: "insertRow", at: model.rows.length }, { ...next, select: true });
    return rewriteTable(view, table, null, { ...next, select: true });
  };
}

/** A right-click on a table: where, and which cell. */
export interface TableMenuRequest {
  x: number;
  y: number;
  /** A position inside the table. */
  pos: number;
  cell: CellRef;
}

/** Who shows the table menu (the app). Without one, tables keep the native menu. */
export const tableMenuHandler = Facet.define<(request: TableMenuRequest) => void, ((request: TableMenuRequest) => void) | null>({
  combine: (values) => values[0] ?? null,
});

export function tableEditing(onMenu?: (request: TableMenuRequest) => void) {
  return [
    onMenu ? tableMenuHandler.of(onMenu) : [],
    Prec.high(
      keymap.of([
        { key: "Tab", run: moveCell(1) },
        { key: "Shift-Tab", run: moveCell(-1) },
      ]),
    ),
    // A right-click in a table's source, while it is being edited. The
    // rendered table handles its own (see TableWidget).
    EditorView.domEventHandlers({
      contextmenu(event, view) {
        const handler = view.state.facet(tableMenuHandler);
        if (!handler || view.state.readOnly) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const table = tableAt(view.state, pos);
        if (!table) return false;
        event.preventDefault();
        handler({ x: event.clientX, y: event.clientY, pos, cell: cellAt(view.state, table, pos) });
        return true;
      },
    }),
  ];
}
