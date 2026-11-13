import { useStore } from "../state/store";
import { parseTableText, rewriteTable, tableAt, type Align, type CellRef, type TableOp } from "../editor/tableEdit";
import { ContextMenu, type MenuItem } from "./ContextMenu";

/** The right-click menu for a table: add and remove rows and columns, align a column, delete the table. */
export function TableMenu() {
  const request = useStore((s) => s.tableMenu);
  const view = useStore((s) => s.editor);
  if (!request || !view) return null;
  const table = tableAt(view.state, request.pos);
  if (!table) return null;
  const model = parseTableText(view.state.sliceDoc(table.from, table.to));
  const { row, col } = request.cell;
  const caretInside = (() => {
    const head = view.state.selection.main.head;
    return view.hasFocus && head >= table.from && head <= table.to;
  })();

  const run = (op: TableOp, focus?: CellRef) => () => {
    const current = tableAt(view.state, request.pos);
    if (!current) return;
    // While the table is being edited, the caret follows the change; a rendered table stays rendered.
    rewriteTable(view, current, op, caretInside ? focus : undefined);
    if (caretInside) view.focus();
  };
  // A column with no alignment set shows as left-aligned, so that's the one ticked.
  const current = model.aligns[col] ?? "left";
  const align = (value: Align, label: string): MenuItem => ({ label, checked: current === value, onSelect: run({ kind: "align", col, align: value }, { row, col }) });

  const items: MenuItem[] = [
    // Nothing goes above the header row.
    ...(row > 0 ? [{ label: "Insert row above", onSelect: run({ kind: "insertRow", at: row - 1 }, { row, col }) }] : []),
    { label: "Insert row below", onSelect: run({ kind: "insertRow", at: row }, { row: row + 1, col }) },
    ...(row > 0 ? [{ label: "Delete row", onSelect: run({ kind: "deleteRow", row }, { row: Math.min(row, model.rows.length - 1), col }) }] : []),
    { separator: true },
    { label: "Insert column left", onSelect: run({ kind: "insertColumn", at: col }, { row, col }) },
    { label: "Insert column right", onSelect: run({ kind: "insertColumn", at: col + 1 }, { row, col: col + 1 }) },
    ...(model.header.length > 1 ? [{ label: "Delete column", onSelect: run({ kind: "deleteColumn", col }, { row, col: Math.max(0, col - 1) }) }] : []),
    { separator: true },
    align("left", "Align left"),
    align("center", "Align center"),
    align("right", "Align right"),
    { separator: true },
    { label: "Delete table", danger: true, onSelect: run({ kind: "deleteTable" }) },
  ];

  return <ContextMenu key={`${request.x},${request.y},${request.pos}`} x={request.x} y={request.y} items={items} onClose={() => useStore.setState((s) => (s.tableMenu === request ? { tableMenu: null } : {}))} />;
}
