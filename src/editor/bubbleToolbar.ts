/**
 * Notion-style formatting toolbar that floats above a non-empty selection.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, ViewPlugin, type Command } from "@codemirror/view";
import { headingLevelAt, insertLink, setHeading, toggleInline } from "./commands";
import { focusedField } from "./livePreview";

const setDragging = StateEffect.define<boolean>();

const draggingField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setDragging)) value = e.value;
    return value;
  },
});

interface ToolButton {
  label: string;
  title: string;
  className?: string;
  run: Command;
}

const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const cycleHeading: Command = (view) => {
  const level = headingLevelAt(view.state, view.state.selection.main.from);
  const next = level === 0 ? 2 : level >= 3 ? 0 : level + 1;
  return setHeading(next)(view);
};

const BUTTONS: ToolButton[] = [
  { label: "<b>B</b>", title: "Bold (Mod+B)", className: "cm-bubble-bold", run: toggleInline("**") },
  { label: "<i>I</i>", title: "Italic (Mod+I)", className: "cm-bubble-italic", run: toggleInline("*") },
  { label: "<s>S</s>", title: "Strikethrough (Mod+Shift+X)", run: toggleInline("~~") },
  { label: svg('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'), title: "Inline code (Mod+E)", run: toggleInline("`") },
  { label: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>'), title: "Link (Mod+K)", run: insertLink },
  { label: svg('<path d="M6 4v16M18 4v16M6 12h12"/>'), title: "Heading", run: cycleHeading },
];

function buildTooltip(view: EditorView): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-bubble-toolbar";
  dom.setAttribute("role", "toolbar");
  dom.setAttribute("aria-label", "Formatting");
  for (const b of BUTTONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cm-bubble-button${b.className ? " " + b.className : ""}`;
    btn.title = b.title;
    btn.setAttribute("aria-label", b.title);
    btn.innerHTML = b.label;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      b.run(view);
      view.focus();
    });
    dom.appendChild(btn);
  }
  return dom;
}

const createToolbar = (view: EditorView) => ({ dom: buildTooltip(view) });

const bubblePlugin = ViewPlugin.fromClass(
  class {
    private onDown = () => this.view.dispatch({ effects: setDragging.of(true) });
    private onUp = () => {
      if (this.view.state.field(draggingField)) this.view.dispatch({ effects: setDragging.of(false) });
    };
    constructor(readonly view: EditorView) {
      view.contentDOM.addEventListener("mousedown", this.onDown);
      window.addEventListener("mouseup", this.onUp);
    }
    destroy() {
      this.view.contentDOM.removeEventListener("mousedown", this.onDown);
      window.removeEventListener("mouseup", this.onUp);
    }
  },
);

// Tooltips are computed from state, so this reads the live preview's focus
// field (which re-checks real focus) rather than the view. The toolbar stays
// away while focus is elsewhere, such as in the find bar.
const bubbleTooltip = showTooltip.compute([draggingField, focusedField, "selection", "doc"], (state) => {
  const sel = state.selection.main;
  if (sel.empty || state.field(draggingField) || !state.field(focusedField)) return null;
  const fromLine = state.doc.lineAt(sel.from).number;
  const toLine = state.doc.lineAt(sel.to).number;
  if (toLine - fromLine > 3) return null;
  return {
    pos: sel.from,
    end: sel.to,
    above: true,
    strictSide: false,
    arrow: false,
    // CodeMirror keeps a tooltip's DOM when the new value has the same `create`
    // function, and only moves it. A stable function means the toolbar glides
    // with the selection instead of being rebuilt (and re-animated) each time.
    create: createToolbar,
  };
});

/** The formatting toolbar over selected text. Needs livePreview() for its focus field. */
export function bubbleToolbar(): Extension {
  return [draggingField, bubblePlugin, bubbleTooltip];
}
