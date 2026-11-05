import type { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { BlockContext, Element, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";

/**
 * LaTeX math in Markdown, as Obsidian, Typora and GitHub write it:
 *
 * - `$x^2$` inline. Following Pandoc, the opening `$` must be followed by a
 *   non-space and the closing `$` preceded by a non-space and not followed by
 *   a digit, so prices ("$5 and $10") stay text. `\$` is a literal dollar.
 * - `$$ … $$` as a block, on one line or across several. A block that has not
 *   been closed yet ends at the next blank line, so typing `$$` never turns
 *   the rest of the note into math.
 * - `$$…$$` inside a paragraph is display math too.
 *
 * Nodes: `InlineMath` and `BlockMath`, each with `MathMark` children for the
 * delimiters. Math content is never parsed as Markdown.
 */

const DOLLAR = 36;
const BACKSLASH = 92;

const isSpace = (ch: number) => ch === 32 || ch === 9 || ch === 10 || ch === 13;
const isDigit = (ch: number) => ch >= 48 && ch <= 57;

/** How a line opens a math block: closed on the same line, still open, or not at all. */
function blockOpening(line: Line): "single" | "open" | null {
  if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) return null;
  if (line.indent - line.baseIndent >= 4) return null;
  const close = findClose(line.text, line.pos + 2);
  if (close < 0) return "open";
  // "$$a$$ and more" is display math inside a paragraph, not a block.
  return line.text.slice(close + 2).trim() === "" ? "single" : null;
}

/** Index of the next unescaped `$$` in `text` at or after `from`, or -1. */
function findClose(text: string, from: number): number {
  for (let i = from; i < text.length - 1; i++) {
    const ch = text.charCodeAt(i);
    if (ch === BACKSLASH) {
      i++;
      continue;
    }
    if (ch === DOLLAR && text.charCodeAt(i + 1) === DOLLAR) return i;
  }
  return -1;
}

function parseBlockMath(cx: BlockContext, line: Line): boolean {
  const kind = blockOpening(line);
  if (!kind) return false;
  const from = cx.lineStart + line.pos;
  const marks: Element[] = [cx.elt("MathMark", from, from + 2)];

  if (kind === "single") {
    const close = cx.lineStart + findClose(line.text, line.pos + 2);
    marks.push(cx.elt("MathMark", close, close + 2));
    cx.nextLine();
    cx.addElement(cx.elt("BlockMath", from, close + 2, marks));
    return true;
  }

  let end = cx.lineStart + line.text.length;
  // `depth` counts the containers (quotes, list items) the line continues.
  // Lezer's own fenced code uses it the same way; it is missing from the typings.
  const stillInside = () => (line as Line & { depth: number }).depth >= cx.depth;
  while (cx.nextLine() && stillInside()) {
    if (line.pos === line.text.length) break; // a blank line ends an unclosed block
    for (const m of line.markers) marks.push(m);
    const close = findClose(line.text, line.pos);
    if (close >= 0) {
      const at = cx.lineStart + close;
      marks.push(cx.elt("MathMark", at, at + 2));
      end = at + 2;
      cx.nextLine();
      cx.addElement(cx.elt("BlockMath", from, end, marks));
      return true;
    }
    end = cx.lineStart + line.text.length;
  }
  cx.addElement(cx.elt("BlockMath", from, end, marks));
  return true;
}

function parseInlineMath(cx: InlineContext, next: number, start: number): number {
  if (next !== DOLLAR) return -1;
  const display = cx.char(start + 1) === DOLLAR;
  const contentStart = start + (display ? 2 : 1);
  const first = cx.char(contentStart);
  if (first < 0 || isSpace(first) || first === DOLLAR) return -1;

  for (let i = contentStart; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === BACKSLASH) {
      i++;
      continue;
    }
    if (ch !== DOLLAR) continue;
    if (display) {
      if (cx.char(i + 1) !== DOLLAR) continue;
      return cx.addElement(cx.elt("InlineMath", start, i + 2, [cx.elt("MathMark", start, start + 2), cx.elt("MathMark", i, i + 2)]));
    }
    if (isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) continue;
    return cx.addElement(cx.elt("InlineMath", start, i + 1, [cx.elt("MathMark", start, start + 1), cx.elt("MathMark", i, i + 1)]));
  }
  return -1;
}

export const mathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "BlockMath", block: true, style: t.monospace },
    { name: "InlineMath", style: t.monospace },
    { name: "MathMark", style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: "BlockMath",
      before: "FencedCode",
      parse: parseBlockMath,
      endLeaf: (_cx, line) => blockOpening(line) !== null,
    },
  ],
  parseInline: [{ name: "InlineMath", parse: parseInlineMath }],
};

/**
 * The TeX source of an `InlineMath` or `BlockMath` node: its text without the
 * delimiters, or the quote and list markers of a block's continuation lines.
 */
export function mathTex(node: SyntaxNode, doc: Text): string {
  let out = "";
  let pos = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    out += doc.sliceString(pos, child.from);
    pos = child.to;
  }
  return (out + doc.sliceString(pos, node.to)).trim();
}
