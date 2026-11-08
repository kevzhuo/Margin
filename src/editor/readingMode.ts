import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Reading mode: the note can't be edited, and since an editor that isn't
 * being edited reveals no Markdown, every line reads as a finished page.
 * Text can still be selected and copied, links followed and tasks ticked.
 */
const reading = new Compartment();

const config = (on: boolean): Extension => (on ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : []);

export const readingMode = (on: boolean): Extension => reading.of(config(on));

export function setReadingMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: reading.reconfigure(config(on)) });
}
