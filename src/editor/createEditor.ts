import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder, rectangularSelection, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, search } from "@codemirror/search";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { indentUnit } from "@codemirror/language";
import { livePreview, linkHrefAt, type LivePreviewOptions } from "./livePreview";
import { codeHighlighting } from "./highlight";
import { formattingKeys } from "./commands";
import { slashMenu } from "./slashMenu";

export interface EditorCallbacks {
  onDocChanged?: (doc: string, update: ViewUpdate) => void;
  onUpdate?: (update: ViewUpdate) => void;
  onOpenLink?: (href: string) => void;
}

export interface CreateEditorOptions extends EditorCallbacks {
  parent: HTMLElement;
  doc: string;
  preview?: LivePreviewOptions;
  extraExtensions?: Extension[];
}

export function editorExtensions(opts: Omit<CreateEditorOptions, "parent" | "doc">): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    EditorView.lineWrapping,
    indentUnit.of("  "),
    search({ top: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false }),
    codeHighlighting,
    livePreview(opts.preview ?? {}),
    slashMenu,
    placeholder("Type / for commands"),
    formattingKeys,
    keymap.of([...markdownKeymap, ...searchKeymap, indentWithTab, ...historyKeymap, ...defaultKeymap]),
    EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences", "aria-label": "Note editor" }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const href = linkHrefAt(event.target);
        if (!href) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        // Links render only while the caret is outside them, so a plain click
        // on rendered link text opens it; clicking a revealed link edits it.
        const touching = view.state.selection.ranges.some((r) => {
          const el = (event.target as Element).closest(".cm-md-link");
          if (!el) return false;
          const start = view.posAtDOM(el);
          const end = start + (el.textContent?.length ?? 0);
          return r.from <= end && r.to >= start;
        });
        if (touching && view.hasFocus) return false;
        event.preventDefault();
        opts.onOpenLink?.(href);
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      opts.onUpdate?.(update);
      if (update.docChanged) opts.onDocChanged?.(update.state.doc.toString(), update);
    }),
    ...(opts.extraExtensions ?? []),
  ];
}

export function createEditorState(doc: string, opts: Omit<CreateEditorOptions, "parent" | "doc">): EditorState {
  return EditorState.create({ doc, extensions: editorExtensions(opts) });
}

export function createEditor(opts: CreateEditorOptions): EditorView {
  const { parent, doc, ...rest } = opts;
  return new EditorView({ state: createEditorState(doc, rest), parent });
}
