import { syntaxHighlighting } from "@codemirror/language";
import { tagHighlighter, tags as t } from "@lezer/highlight";

/**
 * Syntax classes for code. The colors live in src/styles/editor.css, scoped
 * to fenced code lines, so Markdown's own tokens (a bare URL, an escaped
 * `\*`, a link title) never pick up code colors in prose.
 */
const codeTokens = tagHighlighter([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], class: "tok-keyword" },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], class: "tok-string" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "tok-comment" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName), t.className, t.typeName], class: "tok-function" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "tok-number" },
  { tag: [t.propertyName, t.attributeName, t.labelName], class: "tok-property" },
  { tag: [t.tagName, t.angleBracket], class: "tok-tag" },
  { tag: [t.meta, t.processingInstruction, t.annotation], class: "tok-meta" },
  { tag: t.invalid, class: "tok-invalid" },
]);

export const codeHighlighting = syntaxHighlighting(codeTokens);
