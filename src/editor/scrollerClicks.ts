import { EditorSelection } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

/**
 * Width of the strips along the scroller's right and bottom edges that count
 * as its scrollbars. Wide enough for classic bars (about 15px on macOS, 12px
 * elsewhere) and for macOS overlay bars, which take no space.
 */
const SCROLLBAR_ZONE = 16;

/** Whether a press at (x, y), in client coordinates, is on one of `el`'s scrollbars. */
export function onScrollbar(el: HTMLElement, x: number, y: number): boolean {
  const r = el.getBoundingClientRect();
  const scrollsY = el.scrollHeight > el.clientHeight;
  const scrollsX = el.scrollWidth > el.clientWidth;
  return (scrollsY && x >= r.right - SCROLLBAR_ZONE) || (scrollsX && y >= r.bottom - SCROLLBAR_ZONE);
}

/**
 * CodeMirror makes its scroller focusable, so pressing the scroller itself,
 * rather than the text, moves focus off the text. The caret disappears and
 * the caret line's revealed syntax folds away, which can even remove the
 * scrollbar being pressed (a long link's URL is what made it scroll). So:
 *
 * - pressing a scrollbar scrolls, and leaves focus and the caret alone;
 * - pressing beside the text column puts the caret on the nearest line, as
 *   pressing the margin inside the column already does.
 */
export const scrollerClicks = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      view.scrollDOM.addEventListener("mousedown", this.onDown);
    }

    onDown = (event: MouseEvent) => {
      const view = this.view;
      if (event.target !== view.scrollDOM || event.button !== 0) return;
      if (onScrollbar(view.scrollDOM, event.clientX, event.clientY)) {
        if (view.hasFocus) keepFocus(view);
        return;
      }
      event.preventDefault();
      const content = view.contentDOM.getBoundingClientRect();
      const x = Math.min(Math.max(event.clientX, content.left + 1), content.right - 1);
      const y = Math.min(Math.max(event.clientY, content.top + 1), content.bottom - 1);
      const pos = view.posAtCoords({ x, y }, false);
      const anchor = view.state.selection.main.anchor;
      view.dispatch({
        selection: event.shiftKey ? EditorSelection.range(anchor, pos) : EditorSelection.cursor(pos),
        userEvent: "select.pointer",
      });
      view.focus();
    };

    destroy() {
      this.view.scrollDOM.removeEventListener("mousedown", this.onDown);
    }
  },
);

/**
 * The browser focuses the scroller as the press's default action, right after
 * this event. Hand focus straight back, before CodeMirror (which reports
 * focus changes on a short timer) sees the text lose it.
 */
function keepFocus(view: EditorView) {
  const restore = () => view.focus();
  view.scrollDOM.addEventListener("focus", restore, { once: true });
  setTimeout(() => view.scrollDOM.removeEventListener("focus", restore), 0);
}
