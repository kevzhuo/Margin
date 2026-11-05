import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Typing one of these while text is selected wraps the selection instead of replacing it. */
const WRAP_PAIRS: Record<string, string> = {
  "*": "*",
  _: "_",
  "`": "`",
  "~": "~",
  '"': '"',
  $: "$",
};

/**
 * Select a word and type `*` to italicise it, again for bold, `` ` `` for code,
 * `$` for math.
 * The wrapped text stays selected so delimiters can be stacked.
 */
export const wrapSelectionOnType = EditorView.inputHandler.of((view, _from, _to, text) => {
  const close = WRAP_PAIRS[text];
  if (!close || view.composing) return false;
  const { state } = view;
  if (state.selection.ranges.every((r) => r.empty)) return false;
  view.dispatch(
    state.changeByRange((range) => {
      if (range.empty) {
        return { changes: { from: range.from, insert: text }, range: EditorSelection.cursor(range.from + text.length) };
      }
      return {
        changes: [
          { from: range.from, insert: text },
          { from: range.to, insert: close },
        ],
        range: EditorSelection.range(range.anchor + text.length, range.head + text.length),
      };
    }),
    { userEvent: "input.type", scrollIntoView: true },
  );
  return true;
});
