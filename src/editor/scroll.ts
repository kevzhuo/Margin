import type { EditorView } from "@codemirror/view";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export interface ScrollOptions {
  /** "start" puts the line `margin` px below the top; "center" centers it. */
  align?: "start" | "center";
  margin?: number;
  smooth?: boolean;
}

/** Scroll the editor so `pos` is at the top or center, optionally animated. */
export function scrollToPos(view: EditorView, pos: number, { align = "start", margin = 48, smooth = true }: ScrollOptions = {}) {
  view.requestMeasure({
    key: "margin-scroll",
    read(v) {
      const scroller = v.scrollDOM;
      const block = v.lineBlockAt(Math.min(pos, v.state.doc.length));
      const rect = scroller.getBoundingClientRect();
      const docTopInScroller = v.documentTop - rect.top + scroller.scrollTop;
      const lineTop = docTopInScroller + block.top;
      let target: number;
      if (align === "center") {
        // Center the caret's visual line, not the whole (possibly wrapped) paragraph.
        const coords = v.coordsAtPos(pos);
        const caretTop = coords ? coords.top - rect.top + scroller.scrollTop : lineTop;
        const caretHeight = coords ? coords.bottom - coords.top : block.height;
        target = caretTop - (scroller.clientHeight - caretHeight) * 0.45;
      } else {
        target = lineTop - margin;
      }
      return Math.max(0, Math.min(Math.round(target), scroller.scrollHeight - scroller.clientHeight));
    },
    write(target, v) {
      if (Math.abs(v.scrollDOM.scrollTop - target) < 2) return;
      v.scrollDOM.scrollTo({ top: target, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
    },
  });
}
