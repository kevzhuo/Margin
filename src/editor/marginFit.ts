import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** Space kept between a margin mark and the editor's left edge, in px. */
const EDGE_GAP = 4;
/** Marks never shrink below this, so they stay readable. */
const MIN_SCALE = 0.4;

const MARKS = ".cm-md-margin-mark, .cm-md-checkbox .cm-md-ghost";

/** Which CSS variable scales a mark: one per heading level, one for task markers. */
export function fitKind(mark: Element): string | null {
  if (mark.classList.contains("cm-md-ghost")) return "task";
  const line = mark.closest(".cm-line");
  const level = line?.className.match(/\bcm-md-h([1-6])\b/);
  return level ? `h${level[1]}` : null;
}

/**
 * The scale that makes a mark fit: `right` is the mark's right edge (fixed,
 * since marks scale from the right), `width` its current width drawn at
 * `scale`, and `edge` the leftmost x it may reach.
 */
export function fitScale(right: number, width: number, scale: number, edge: number): number {
  const natural = width / scale;
  if (natural <= 0) return 1;
  const fit = Math.floor(((right - edge) / natural) * 1000) / 1000;
  return Math.max(MIN_SCALE, Math.min(1, fit));
}

/**
 * Heading marks ("## ") and raw task markers ("- [ ] ") are drawn in the left
 * margin, beside the caret's line. Their width depends on the font and text
 * size, and the margin narrows to 40px in small windows, so a deep heading's
 * "#####" can be wider than the margin. This measures the marks that are
 * showing and shrinks any that would cross the editor's edge, through a CSS
 * variable per kind of mark. Scaling, rather than resizing the font, keeps
 * the mark's position and vertical centering.
 */
export const marginFit = ViewPlugin.fromClass(
  class {
    scales = new Map<string, number>();

    constructor(readonly view: EditorView) {
      this.schedule();
    }

    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.geometryChanged || u.viewportChanged || u.focusChanged) this.schedule();
    }

    schedule() {
      this.view.requestMeasure({ key: this, read: (view) => this.read(view), write: (next, view) => this.write(next, view) });
    }

    read(view: EditorView): Map<string, number> {
      const next = new Map<string, number>();
      const edge = view.scrollDOM.getBoundingClientRect().left + EDGE_GAP;
      for (const mark of view.contentDOM.querySelectorAll(MARKS)) {
        const kind = fitKind(mark);
        const rect = mark.getBoundingClientRect();
        if (!kind || !rect.width) continue;
        const scale = fitScale(rect.right, rect.width, this.scales.get(kind) ?? 1, edge);
        next.set(kind, Math.min(next.get(kind) ?? 1, scale));
      }
      return next;
    }

    write(next: Map<string, number>, view: EditorView) {
      // Kinds that aren't showing keep their last scale: it is usually still
      // right, and they are measured again whenever they show.
      for (const [kind, scale] of next) {
        if (scale === (this.scales.get(kind) ?? 1)) continue;
        if (scale < 1) {
          this.scales.set(kind, scale);
          view.dom.style.setProperty(`--fit-${kind}`, String(scale));
        } else {
          this.scales.delete(kind);
          view.dom.style.removeProperty(`--fit-${kind}`);
        }
      }
    }

    destroy() {
      for (const kind of this.scales.keys()) this.view.dom.style.removeProperty(`--fit-${kind}`);
    }
  },
);
