import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { imageSaver, pickImages } from "./images";

interface BlockItem {
  label: string;
  detail: string;
  keywords: string;
  icon: string;
  /** Text to insert; `|` marks where the caret goes (first occurrence). */
  template: string;
  /** Instead of the template: act on the view, given the range of the typed "/command". Return false to fall back to the template. */
  run?: (view: EditorView, from: number, to: number) => boolean;
}

const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const BLOCK_ITEMS: BlockItem[] = [
  { label: "Text", detail: "Plain paragraph", keywords: "paragraph plain", icon: svg('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'), template: "|" },
  { label: "Heading 1", detail: "Large section heading", keywords: "h1 title", icon: svg('<path d="M6 4v16M18 4v16M6 12h12"/>'), template: "# |" },
  { label: "Heading 2", detail: "Medium section heading", keywords: "h2 section", icon: svg('<path d="M6 4v16M18 4v16M6 12h12"/>'), template: "## |" },
  { label: "Heading 3", detail: "Small section heading", keywords: "h3 subsection", icon: svg('<path d="M6 4v16M18 4v16M6 12h12"/>'), template: "### |" },
  { label: "Bulleted list", detail: "Simple bulleted list", keywords: "ul bullet unordered", icon: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'), template: "- |" },
  { label: "Numbered list", detail: "List with numbering", keywords: "ol ordered numbers", icon: svg('<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M4 14h2a1 1 0 0 1 0 2l-2 2h2"/>'), template: "1. |" },
  { label: "To-do list", detail: "Track tasks with checkboxes", keywords: "task todo checkbox", icon: svg('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'), template: "- [ ] |" },
  { label: "Quote", detail: "Capture a quotation", keywords: "blockquote citation", icon: svg('<path d="M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z"/>'), template: "> |" },
  { label: "Code block", detail: "Fenced code with highlighting", keywords: "code fence pre", icon: svg('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'), template: "```|\n\n```" },
  { label: "Table", detail: "Pipe table, edited in place", keywords: "table grid", icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 16h18M9 4v16"/>'), template: "| |  |\n| --- | --- |\n|  |  |" },
  { label: "Math", detail: "LaTeX equation, rendered as you type", keywords: "latex equation formula tex katex", icon: svg('<path d="M18 5H7l5 7-5 7h11"/>'), template: "$$\n|\n$$" },
  { label: "Divider", detail: "Horizontal rule", keywords: "hr rule line separator", icon: svg('<path d="M4 12h16"/>'), template: "---\n|" },
  {
    label: "Image",
    detail: "Choose an image to add",
    keywords: "img picture photo upload file",
    icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>'),
    template: "![|](url)",
    run: (view, from, to) => {
      if (!view.state.facet(imageSaver)) return false;
      view.dispatch({ changes: { from, to }, selection: EditorSelection.cursor(from), userEvent: "input.complete" });
      return pickImages(view, from);
    },
  },
  { label: "Image link", detail: "Embed an image by URL or path", keywords: "img picture url web link", icon: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'), template: "![](|)" },
];

function applyTemplate(view: EditorView, item: BlockItem, from: number, to: number) {
  const caret = item.template.indexOf("|");
  const text = item.template.replace("|", "");
  const anchor = from + (caret < 0 ? text.length : caret);
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(anchor),
    scrollIntoView: true,
    userEvent: "input.complete",
  });
}

export function slashSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = /^(\s*)\/([\w ]*)$/.exec(before);
  if (!m) return null;
  const from = line.from + m[1].length;
  const options: Completion[] = BLOCK_ITEMS.map((item, index) => ({
    label: item.label,
    detail: item.detail,
    type: "block",
    // Keep the authored order instead of CodeMirror's alphabetical default.
    boost: BLOCK_ITEMS.length - index,
    apply: (view, _completion, _from, to) => {
      if (!item.run?.(view, from, to)) applyTemplate(view, item, from, to);
    },
  }));
  return {
    from: from + 1,
    options,
    validFor: /^[\w ]*$/,
  };
}

export const slashMenu = autocompletion({
  override: [slashSource],
  icons: false,
  activateOnTyping: true,
  closeOnBlur: true,
  defaultKeymap: true,
  addToOptions: [
    {
      position: 10,
      render(completion) {
        const item = BLOCK_ITEMS.find((b) => b.label === completion.label);
        const box = document.createElement("span");
        box.className = "cm-slash-icon";
        box.innerHTML = item?.icon ?? "";
        return box;
      },
    },
  ],
  optionClass: () => "cm-slash-option",
  tooltipClass: () => "cm-slash-menu",
});
