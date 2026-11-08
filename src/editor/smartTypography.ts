import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { frontMatterRange } from "./livePreview";

/**
 * Smart typography, as you type:
 *
 * - "quotes" and 'quotes' become “curly” and ‘curly’, and an apostrophe
 *   becomes ’;
 * - two hyphens become an em dash (—);
 * - three dots become an ellipsis (…).
 *
 * Never inside code, math, URLs, HTML or front matter, and never on lines of
 * dashes (`---` rules, table rows). Each change is its own undo step, so ⌘Z
 * right after it brings back what you typed.
 */
export function smartTypography(enabled: () => boolean) {
  return EditorView.inputHandler.of((view, from, to, text, insert) => {
    if (!enabled() || view.composing || text.length !== 1 || !`"'-.`.includes(text)) return false;
    const { state } = view;
    if (state.selection.ranges.length > 1) return false;
    if (from !== to) {
      // A selection typed over with a quote is wrapped in curly quotes.
      if (text !== '"' || isLiteral(state, from)) return false;
      view.dispatch({
        changes: [
          { from, insert: "“" },
          { from: to, insert: "”" },
        ],
        selection: EditorSelection.range(from + 1, to + 1),
        userEvent: "input.type",
        scrollIntoView: true,
      });
      return true;
    }
    const replacement = smartReplacement(state, from, text);
    if (!replacement || isLiteral(state, from)) return false;
    // Type the character as usual, then swap it in a separate undo step.
    view.dispatch(insert());
    const start = from - replacement.consumed;
    view.dispatch({
      changes: { from: start, to: from + 1, insert: replacement.insert },
      selection: EditorSelection.cursor(start + replacement.insert.length),
      userEvent: "input.type",
      annotations: isolateHistory.of("full"),
    });
    return true;
  });
}

/** Characters before the caret that a typed character can combine with. */
interface Replacement {
  insert: string;
  /** How many characters before the caret it replaces as well. */
  consumed: number;
}

function smartReplacement(state: EditorState, pos: number, text: string): Replacement | null {
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  switch (text) {
    case '"':
      return { insert: opensQuote(before) ? "“" : "”", consumed: 0 };
    case "'":
      return { insert: opensQuote(before) ? "‘" : "’", consumed: 0 };
    case "-":
      // `--` makes a dash, except on lines of dashes (`---`, `| --- |`) and in `<!--` comments.
      if (!before.endsWith("-") || /^[\s>|:-]*$/.test(before) || /<!-*$/.test(before) || before.includes("<!--")) return null;
      return { insert: "—", consumed: 1 };
    case ".":
      if (!before.endsWith("..") || before.endsWith("...")) return null;
      return { insert: "…", consumed: 2 };
  }
  return null;
}

/** A quote opens at the start of a line, after a space, or after opening punctuation. */
function opensQuote(before: string): boolean {
  // Look past emphasis marks, so `*"` opens and `**bold**"` closes.
  const prev = before.replace(/[*_~]+$/, "").slice(-1);
  return prev === "" || /[\s([{<“‘—–/-]/.test(prev);
}

/** Code, math and HTML blocks: anywhere inside, up to their end, is literal. */
const LITERAL_BLOCKS = new Set(["FencedCode", "CodeBlock", "BlockMath", "HTMLBlock", "CommentBlock", "ProcessingInstructionBlock"]);
/** Inline spans: literal strictly inside, so text typed just after `code` is prose again. */
const LITERAL_SPANS = new Set(["InlineCode", "InlineMath", "URL", "Autolink", "HTMLTag", "Comment"]);

/** Whether text typed at `pos` is meant literally: code, math, a URL, HTML, front matter. */
function isLiteral(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (LITERAL_BLOCKS.has(n.name) || (LITERAL_SPANS.has(n.name) && pos < n.to)) return true;
  }
  const fm = frontMatterRange(state.doc);
  if (fm && pos <= fm.to) return true;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  // Code, math and HTML tags still being typed, which the parser can't see yet.
  if ((before.match(/`+/g)?.length ?? 0) % 2 === 1) return true;
  if (insideOpenMath(before)) return true;
  if (/<[a-zA-Z][^>]*$/.test(before)) return true;
  // A link destination or bare URL being typed.
  if (/\]\([^)\s]*$/.test(before) || /(?:https?:\/\/|www\.)\S*$/i.test(before)) return true;
  return false;
}

/**
 * Whether `before` ends inside `$…` math that hasn't been closed yet. An
 * opening `$` is followed by something other than a space or a digit, so
 * prices like "$5" don't count.
 */
function insideOpenMath(before: string): boolean {
  let open = false;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c !== "$") continue;
    let j = i;
    while (before[j + 1] === "$") j++;
    const next = before[j + 1];
    if (!open) {
      if (next !== undefined && !/[\s\d]/.test(next)) open = true;
    } else if (!/\s/.test(before[i - 1] ?? " ")) {
      open = false;
    }
    i = j;
  }
  return open;
}
