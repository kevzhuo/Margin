import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder, rectangularSelection, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage, markdownKeymap } from "@codemirror/lang-markdown";
import { mathSyntax } from "./mathSyntax";
import { languages } from "@codemirror/language-data";
import { indentUnit } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { livePreview, linkHrefAt, type LivePreviewOptions } from "./livePreview";
import { codeHighlighting } from "./highlight";
import { findAndReplace, findKeymap } from "./findPanel";
import { formattingKeys } from "./commands";
import { slashMenu } from "./slashMenu";
import { bubbleToolbar } from "./bubbleToolbar";
import { typewriter } from "./typewriter";
import { wrapSelectionOnType } from "./wrapSelection";
import { jumpFlash } from "./flash";
import { marginFit } from "./marginFit";
import { scrollerClicks } from "./scrollerClicks";
import { imageInput, type ImageSaver } from "./images";

export interface EditorCallbacks {
  onDocChanged?: (doc: string, update: ViewUpdate) => void;
  onUpdate?: (update: ViewUpdate) => void;
  onOpenLink?: (href: string) => void;
  /** Mod-[ / Mod-]: history navigation. Return false to let the key through. */
  onNavigate?: (direction: -1 | 1) => boolean;
  /** Read on every update; true keeps the caret centered. */
  typewriter?: () => boolean;
  /** Saves pasted, dropped or picked images; without it, images can't be added. */
  onImages?: ImageSaver;
}

export interface CreateEditorOptions extends EditorCallbacks {
  parent: HTMLElement;
  doc: string;
  preview?: LivePreviewOptions;
  extraExtensions?: Extension[];
}

function editorExtensions(opts: Omit<CreateEditorOptions, "parent" | "doc">): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    EditorView.lineWrapping,
    indentUnit.of("  "),
    findAndReplace,
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, extensions: [mathSyntax] }),
    // Auto-close brackets only. Quotes and backticks would fight with prose
    // apostrophes and with typing ``` for a code fence.
    markdownLanguage.data.of({ closeBrackets: { brackets: ["(", "[", "{"] } }),
    closeBrackets(),
    wrapSelectionOnType,
    typewriter(opts.typewriter ?? (() => false)),
    codeHighlighting,
    livePreview(opts.preview ?? {}),
    jumpFlash,
    marginFit,
    scrollerClicks,
    imageInput(opts.onImages),
    slashMenu,
    bubbleToolbar(),
    placeholder("Type / for commands"),
    Prec.high(
      keymap.of([
        { key: "Mod-[", preventDefault: true, run: () => opts.onNavigate?.(-1) ?? false },
        { key: "Mod-]", preventDefault: true, run: () => opts.onNavigate?.(1) ?? false },
      ]),
    ),
    formattingKeys,
    keymap.of([...closeBracketsKeymap, ...markdownKeymap, ...findKeymap, indentWithTab, ...historyKeymap, ...defaultKeymap]),
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
