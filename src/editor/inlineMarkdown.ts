import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownParser } from "@lezer/markdown";
import { renderMath } from "./mathRender";
import { mathSyntax } from "./mathSyntax";

/**
 * A short stretch of Markdown (a table cell, a line from a search result)
 * turned into DOM or plain text, using the editor's own parser so it
 * understands exactly the same syntax.
 */

const parser = (markdownLanguage.parser as MarkdownParser).configure(mathSyntax);

/** Syntax that is never shown: delimiters and block markers. */
const HIDDEN = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "StrikethroughMark",
  "MathMark",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "TaskMarker",
  "LinkTitle",
  "LinkLabel",
]);

type Style = "em" | "strong" | "del" | "link" | "image";

interface Output {
  text(s: string): void;
  code(s: string): void;
  math(tex: string, display: boolean): void;
  open(style: Style, href?: string): void;
  close(): void;
}

function walk(src: string, node: SyntaxNode, from: number, to: number, out: Output) {
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > pos) out.text(src.slice(pos, child.from));
    visit(src, child, out);
    pos = Math.max(pos, child.to);
  }
  if (pos < to) out.text(src.slice(pos, to));
}

/** Where the content of a node sits between its first and last delimiter of `mark`. */
function inner(node: SyntaxNode, mark: string): [number, number] {
  const marks = node.getChildren(mark);
  return [marks[0]?.to ?? node.from, marks.length > 1 ? marks[marks.length - 1].from : node.to];
}

function visit(src: string, node: SyntaxNode, out: Output) {
  const name = node.name;
  if (HIDDEN.has(name)) return;
  switch (name) {
    case "Escape":
      out.text(src.slice(node.from + 1, node.to));
      return;
    case "InlineCode":
      out.code(src.slice(...inner(node, "CodeMark")));
      return;
    case "InlineMath": {
      const [a, b] = inner(node, "MathMark");
      out.math(src.slice(a, b).trim(), src.startsWith("$$", node.from));
      return;
    }
    case "Emphasis":
    case "StrongEmphasis":
    case "Strikethrough":
      out.open(name === "Emphasis" ? "em" : name === "StrongEmphasis" ? "strong" : "del");
      walk(src, node, node.from, node.to, out);
      out.close();
      return;
    case "Link":
    case "Image": {
      // The text is between "[" and "]"; the URL and title are not shown.
      const marks = node.getChildren("LinkMark");
      const url = node.getChild("URL");
      out.open(name === "Image" ? "image" : "link", url ? src.slice(url.from, url.to) : "");
      walk(src, node, marks[0]?.to ?? node.from, marks[1]?.from ?? node.to, out);
      out.close();
      return;
    }
    case "Autolink":
    case "URL": {
      const url = name === "URL" ? node : node.getChild("URL");
      const href = url ? src.slice(url.from, url.to) : "";
      out.open("link", href);
      out.text(href);
      out.close();
      return;
    }
    default:
      walk(src, node, node.from, node.to, out);
  }
}

function parse(src: string): SyntaxNode {
  return parser.parse(src).topNode;
}

const TAGS: Record<Exclude<Style, "link" | "image">, string> = { em: "em", strong: "strong", del: "del" };

/** Render inline Markdown as DOM: formatting, code, links (as text), math. Never interprets HTML. */
export function renderInline(src: string): DocumentFragment {
  const root = document.createDocumentFragment();
  const stack: (DocumentFragment | HTMLElement)[] = [root];
  const top = () => stack[stack.length - 1];
  walk(src, parse(src), 0, src.length, {
    text: (s) => top().append(s),
    code(s) {
      const el = document.createElement("code");
      el.className = "cm-md-inline-code";
      el.textContent = s;
      top().append(el);
    },
    math(tex, display) {
      const el = document.createElement("span");
      el.className = "cm-md-math cm-md-math-inline";
      const result = renderMath(tex, display);
      if ("html" in result) el.innerHTML = result.html;
      else {
        el.classList.add("cm-md-math-error");
        el.textContent = tex;
        el.title = result.error;
      }
      top().append(el);
    },
    open(style, href) {
      let el: HTMLElement;
      if (style === "link" || style === "image") {
        el = document.createElement("span");
        el.className = style === "link" ? "cm-md-link" : "cm-md-image-alt";
        if (href) el.title = href;
      } else {
        el = document.createElement(TAGS[style]);
      }
      top().append(el);
      stack.push(el);
    },
    close: () => void stack.pop(),
  });
  return root;
}

/** The words of a line of Markdown, without its syntax: "- [ ] **Buy** [milk](x)" becomes "Buy milk". */
export function markdownToText(src: string): string {
  let out = "";
  walk(src, parse(src), 0, src.length, {
    text: (s) => (out += s),
    code: (s) => (out += s),
    math: (tex) => (out += tex),
    open: () => {},
    close: () => {},
  });
  return out.replace(/\s+/g, " ").trim();
}
