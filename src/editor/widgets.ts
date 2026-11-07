import { WidgetType, type EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { renderInline } from "./inlineMarkdown";

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

/**
 * A real checkbox replacing `- [ ] `. Clicking it edits the document.
 * `source` is the raw marker, shown beside the box while the caret is on the line.
 */
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
    // Keep focus in the editor.
    input.addEventListener("mousedown", (e) => e.preventDefault());
    // Let the native toggle happen (cancelling the click would make the browser
    // restore the old state after we update it), then mirror it into the document.
    input.addEventListener("change", () => {
      if (!toggleTaskAt(view, view.posAtDOM(wrap))) input.checked = !input.checked;
    });
    wrap.appendChild(input);
    this.sync(wrap);
    return wrap;
  }
  /** Reuse the element when only the state changed, so CSS transitions play. */
  updateDOM(dom: HTMLElement) {
    if (!dom.querySelector("input")) return false;
    this.sync(dom);
    return true;
  }
  private sync(wrap: HTMLElement) {
    const input = wrap.querySelector("input")!;
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "Mark task as not done" : "Mark task as done");
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
    /** What the <img> loads (the link resolved to a file or URL). */
    readonly src: string,
    /** The link as written in the note, named in the placeholder if it fails. */
    readonly link: string,
    readonly alt: string,
    /** Drawn under the image's source while the caret is on it. */
    readonly preview = false,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.link === this.link && other.alt === this.alt && other.preview === this.preview;
  }
  toDOM() {
    const wrap = document.createElement(this.preview ? "div" : "span");
    wrap.className = this.preview ? "cm-md-image cm-md-image-preview" : "cm-md-image";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.draggable = false;
    img.addEventListener("error", () => wrap.replaceChildren(missingImage(this.link, this.alt)), { once: true });
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent() {
    // The rendered image takes clicks (they put the caret on it); the preview doesn't.
    return this.preview;
  }
}

/** A placeholder for an image that didn't load, naming the file so a broken link is easy to spot. */
function missingImage(link: string, alt: string): HTMLElement {
  const box = document.createElement("span");
  box.className = "cm-md-image-missing";
  box.title = link;
  box.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/><path d="M3 3l18 18"/></svg>';
  let name = link.split(/[\\/]/).pop() || link;
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep it as written
  }
  const label = document.createElement("span");
  label.className = "cm-md-image-missing-name";
  label.textContent = name || alt || "Image";
  const note = document.createElement("span");
  note.textContent = /^[a-z][a-z0-9+.-]*:/i.test(link) && !/^[a-z]:[\\/]/i.test(link) ? "Couldn't load" : "Not found";
  box.append(label, note);
  return box;
}

export interface TableCell {
  text: string;
  /** Offset of the cell content from the start of the table's first line. */
  offset: number;
  align: "left" | "center" | "right" | null;
}

/** What a table is nested in, so it keeps its quote bar and list indent. */
export interface TableNest {
  quote: boolean;
  list: { depth: number; kind: "ul" | "ol" | "task" } | null;
}

export interface TableData {
  header: TableCell[];
  rows: TableCell[][];
}

/** Rendered table shown while the caret is outside the table. */
export class TableWidget extends WidgetType {
  constructor(
    readonly data: TableData,
    readonly nest: TableNest = { quote: false, list: null },
  ) {
    super();
  }
  eq(other: TableWidget) {
    return JSON.stringify([other.data, other.nest]) === JSON.stringify([this.data, this.nest]);
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    if (this.nest.quote) wrap.classList.add("in-quote");
    if (this.nest.list) {
      wrap.classList.add("in-list", `cm-md-li-${this.nest.list.kind}`);
      wrap.style.setProperty("--li-depth", String(this.nest.list.depth));
    }
    const table = document.createElement("table");
    const place = (cell: HTMLElement, data: TableCell) => {
      cell.append(renderInline(data.text));
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
