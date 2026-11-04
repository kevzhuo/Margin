import { WidgetType, type EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

/** Replaces a bullet list marker (`-`, `*`, `+`). Same fixed width as the active-state mark. */
export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(other: BulletWidget) {
    return other.depth === this.depth;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-md-bullet cm-md-bullet-${Math.min(this.depth, 3)}`;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/** Shows raw syntax in the left margin while the line is active (used for task markers). */
export class GhostMarkWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostMarkWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-mark cm-md-margin-mark cm-md-ghost";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/** A real checkbox replacing `- [ ]`. Clicking it edits the document. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "Mark task as not done" : "Mark task as done");
    input.addEventListener("mousedown", (e) => e.preventDefault());
    input.addEventListener("click", (e) => {
      e.preventDefault();
      toggleTaskAt(view, view.posAtDOM(wrap));
    });
    wrap.appendChild(input);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** Flip the task marker that owns the list item starting at `pos`. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const tree = syntaxTree(view.state);
  let node = tree.resolveInner(pos, 1);
  while (node && node.name !== "ListItem") {
    if (!node.parent) return false;
    node = node.parent;
  }
  const task = node.getChild("Task");
  const marker = task?.getChild("TaskMarker");
  if (!marker) return false;
  const current = view.state.doc.sliceString(marker.from, marker.to);
  const checked = /x/i.test(current);
  view.dispatch({
    changes: { from: marker.from + 1, to: marker.to - 1, insert: checked ? " " : "x" },
  });
  return true;
}

/** Language label shown at the top-right of a fenced code block. */
export class LangLabelWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }
  eq(other: LangLabelWidget) {
    return other.lang === this.lang;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-lang";
    span.textContent = this.lang;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

export class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-hr";
    span.setAttribute("role", "separator");
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-image";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.draggable = false;
    img.addEventListener("error", () => {
      wrap.classList.add("cm-md-image-broken");
      wrap.textContent = this.alt || this.src;
    });
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

export interface TableCell {
  text: string;
  /** Offset of the cell content from the start of the table node. */
  offset: number;
  align: "left" | "center" | "right" | null;
}

export interface TableData {
  header: TableCell[];
  rows: TableCell[][];
}

/** Rendered table shown while the caret is outside the table. */
export class TableWidget extends WidgetType {
  constructor(readonly data: TableData) {
    super();
  }
  eq(other: TableWidget) {
    return JSON.stringify(other.data) === JSON.stringify(this.data);
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    const table = document.createElement("table");
    const place = (cell: HTMLElement, data: TableCell) => {
      cell.textContent = data.text;
      if (data.align) cell.style.textAlign = data.align;
      cell.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const start = view.posAtDOM(wrap);
        const pos = Math.min(start + data.offset + data.text.length, view.state.doc.length);
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      });
    };
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const c of this.data.header) {
      const th = document.createElement("th");
      place(th, c);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const row of this.data.rows) {
      const r = document.createElement("tr");
      for (const c of row) {
        const td = document.createElement("td");
        place(td, c);
        r.appendChild(td);
      }
      tbody.appendChild(r);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return 32 * (this.data.rows.length + 1) + 12;
  }
}

/** "Type / for commands" hint on the empty line the caret is on. */
export class LinePlaceholderWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: LinePlaceholderWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-line-placeholder";
    span.textContent = this.text;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent() {
    return false;
  }
}
