import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/** How long the highlight stays before it is removed (the CSS fades it out). */
export const FLASH_MS = 1400;

const addFlash = StateEffect.define<{ from: number; to: number }>();
const clearFlash = StateEffect.define<null>();
const flashLine = Decoration.line({ class: "cm-md-flash" });

/** Lines briefly highlighted after a jump so the eye can find where it landed. */
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearFlash)) deco = Decoration.none;
      else if (e.is(addFlash)) {
        const doc = tr.state.doc;
        const first = doc.lineAt(Math.min(e.value.from, doc.length));
        const last = doc.lineAt(Math.min(e.value.to, doc.length));
        const lines = [];
        for (let l = first.number; l <= last.number; l++) lines.push(flashLine.range(doc.line(l).from));
        deco = Decoration.set(lines);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

/** Highlight the lines from `from` to `to` for a moment. */
export function flash(view: EditorView, from: number, to = from) {
  if (!view.state.field(flashField, false)) return;
  const previous = timers.get(view);
  if (previous) clearTimeout(previous);
  // Clear first so a repeated jump to the same line restarts the animation.
  view.dispatch({ effects: clearFlash.of(null) });
  view.dispatch({ effects: addFlash.of({ from, to }) });
  timers.set(
    view,
    setTimeout(() => {
      if (view.dom.isConnected) view.dispatch({ effects: clearFlash.of(null) });
    }, FLASH_MS),
  );
}

export const jumpFlash: Extension = flashField;
