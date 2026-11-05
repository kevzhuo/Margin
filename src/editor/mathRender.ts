import katex from "katex";
import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { onScrollbar } from "./scrollerClicks";

export type MathResult = { html: string } | { error: string };

const cache = new Map<string, MathResult>();
/** Rendered formulas kept for reuse; a long note's math re-renders from here as you scroll and type. */
export const MATH_CACHE_LIMIT = 500;

/** Render TeX with KaTeX. Results are cached, least recently used dropped first. */
export function renderMath(tex: string, display: boolean): MathResult {
  const key = (display ? "D" : "I") + tex;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let result: MathResult;
  try {
    result = { html: katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "ignore" }) };
  } catch (e) {
    result = { error: (e instanceof Error ? e.message : String(e)).replace(/^KaTeX parse error: /, "") };
  }
  cache.set(key, result);
  if (cache.size > MATH_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return result;
}

/**
 * - `inline`: `$…$` (or `$$…$$` inside a paragraph) away from the caret.
 * - `block`: a `$$` block away from the caret, drawn in place of its lines.
 * - `preview`: drawn under a `$$` block's source while the caret is in it.
 */
export type MathMode = "inline" | "block" | "preview";

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly mode: MathMode,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display && other.mode === this.mode;
  }

  toDOM(view: EditorView) {
    const el: HTMLElement = document.createElement(this.mode === "inline" ? "span" : "div");
    el.className = `cm-md-math cm-md-math-${this.mode}`;
    if (!this.tex) {
      el.classList.add("cm-md-math-empty");
      if (this.mode !== "preview") el.textContent = "Empty math";
    } else {
      const result = renderMath(this.tex, this.display);
      if ("html" in result) {
        el.innerHTML = result.html;
      } else {
        // Away from the caret, show the source in red; under the source, the message.
        el.classList.add("cm-md-math-error");
        el.textContent = this.mode === "preview" ? result.error : this.tex;
        el.title = result.error;
      }
    }
    if (this.mode !== "preview") {
      el.addEventListener("mousedown", (event: MouseEvent) => {
        if (event.button !== 0 || onScrollbar(el, event.clientX, event.clientY)) return;
        event.preventDefault();
        editSource(view, el);
      });
    }
    return el;
  }

  /** The widget handles its own presses (see toDOM). */
  ignoreEvent() {
    return true;
  }

  get estimatedHeight() {
    return this.mode === "inline" ? -1 : 56;
  }
}

/** Put the caret inside the math a widget stands for, which reveals its source. */
function editSource(view: EditorView, el: HTMLElement) {
  const doc = view.state.doc;
  const start = view.posAtDOM(el);
  const line = doc.lineAt(start);
  let anchor: number;
  if (el.classList.contains("cm-md-math-inline")) {
    anchor = start + (doc.sliceString(start, start + 2) === "$$" ? 2 : 1);
  } else {
    // Single-line block: just before the closing $$. Otherwise the end of the first line of TeX.
    const close = line.text.lastIndexOf("$$");
    const open = line.text.indexOf("$$");
    anchor = close > open ? line.from + close : line.number < doc.lines ? doc.line(line.number + 1).to : line.to;
  }
  view.dispatch({ selection: EditorSelection.cursor(anchor), userEvent: "select.pointer" });
  view.focus();
}
