import { EditorSelection, Facet, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isImageFile } from "../state/attachments";

/** Saves image files into the vault and returns the Markdown that embeds each one. */
export type ImageSaver = (files: File[]) => Promise<string[]>;

export const imageSaver = Facet.define<ImageSaver, ImageSaver | null>({
  combine: (values) => values[0] ?? null,
});

export interface Pending {
  from: number;
  to: number;
}

const addPending = StateEffect.define<{ id: number; range: Pending }>();
const removePending = StateEffect.define<number>();

/**
 * Where each image that is still being saved will go, kept in step with any
 * edits made meanwhile. Switching notes replaces the editor state, which
 * drops these, so an image saved after a switch is never put in the wrong note.
 */
const pendingField = StateField.define<ReadonlyMap<number, Pending>>({
  create: () => new Map(),
  update(map, tr) {
    let next = map;
    if (tr.docChanged && map.size) {
      next = new Map(
        [...map].map(([id, r]) => {
          const from = tr.changes.mapPos(r.from, r.from === r.to ? -1 : 1);
          return [id, { from, to: Math.max(from, tr.changes.mapPos(r.to, -1)) }];
        }),
      );
    }
    for (const e of tr.effects) {
      if (e.is(addPending)) next = new Map(next).set(e.value.id, e.value.range);
      else if (e.is(removePending) && next.has(e.value)) {
        const copy = new Map(next);
        copy.delete(e.value);
        next = copy;
      }
    }
    return next;
  },
});

let nextId = 0;

/**
 * Save `files` and put their Markdown at `from`–`to`, each image on a line
 * of its own. Images are blocks, so a drop or paste in the middle of a line
 * goes after that line, never splitting the sentence; one at the start of a
 * line goes before it. A selection is replaced.
 */
export async function insertImages(view: EditorView, files: File[], from: number, to: number, userEvent: string): Promise<void> {
  const save = view.state.facet(imageSaver);
  if (!save || !files.length) return;
  const id = ++nextId;
  view.dispatch({ effects: addPending.of({ id, range: { from, to } }) });
  let snippets: string[] = [];
  try {
    snippets = await save(files);
  } finally {
    const range = view.state.field(pendingField, false)?.get(id);
    if (range) {
      const body = snippets.join("\n");
      if (!body) {
        view.dispatch({ effects: removePending.of(id) });
      } else {
        const { from, to, before, after } = placement(view.state.doc, range);
        view.dispatch({
          changes: { from, to, insert: before + body + after },
          selection: EditorSelection.cursor(from + before.length + body.length),
          effects: removePending.of(id),
          scrollIntoView: true,
          userEvent,
        });
      }
    }
  }
}

/** Where images go for a pending range, and the line breaks that keep them on lines of their own. */
export function placement(doc: Text, range: Pending): { from: number; to: number; before: string; after: string } {
  const line = doc.lineAt(range.from);
  if (range.from === range.to) {
    if (doc.sliceString(line.from, range.from).trim()) return { from: line.to, to: line.to, before: "\n", after: "" };
    if (doc.sliceString(range.from, line.to).trim()) return { from: line.from, to: line.from, before: "", after: "\n" };
    return { from: range.from, to: range.to, before: "", after: "" };
  }
  return {
    from: range.from,
    to: range.to,
    before: doc.sliceString(line.from, range.from).trim() ? "\n" : "",
    after: doc.sliceString(range.to, doc.lineAt(range.to).to).trim() ? "\n" : "",
  };
}

/** Image files in a paste or drop. Some sources only offer them as items. */
function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files].filter(isImageFile);
  if (files.length) return files;
  return [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file && isImageFile(file));
}

const carriesFiles = (data: DataTransfer | null) => !!data && [...data.types].includes("Files");

/** Ask for image files with the system picker, then insert them at `pos`. */
export function pickImages(view: EditorView, pos: number): boolean {
  if (!view.state.facet(imageSaver)) return false;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.hidden = true;
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.remove();
    view.focus();
    void insertImages(view, files, pos, pos, "input.drop");
  });
  input.addEventListener("cancel", () => {
    input.remove();
    view.focus();
  });
  document.body.append(input);
  input.click();
  return true;
}

/**
 * Paste or drop images into a note: they are copied into the vault's
 * attachments folder and linked where they landed. A drop goes where the
 * drop cursor shows; a paste replaces the selection.
 */
export function imageInput(save: ImageSaver | undefined): Extension {
  if (!save) return [];
  return [
    imageSaver.of(save),
    pendingField,
    EditorView.domEventHandlers({
      paste(event, view) {
        const files = imageFiles(event.clipboardData);
        if (!files.length) return false;
        event.preventDefault();
        const { from, to } = view.state.selection.main;
        void insertImages(view, files, from, to, "input.paste");
        return true;
      },
      dragover(event) {
        if (!carriesFiles(event.dataTransfer)) return false;
        event.preventDefault();
        event.dataTransfer!.dropEffect = "copy";
        // Not handled: CodeMirror's drop cursor still follows the pointer.
        return false;
      },
      drop(event, view) {
        const files = imageFiles(event.dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        view.focus();
        void insertImages(view, files, pos, pos, "input.drop");
        return true;
      },
    }),
  ];
}
