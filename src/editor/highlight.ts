import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Syntax colors for fenced code blocks. Values are CSS variables so the
 * light/dark palettes live in one stylesheet (src/styles/editor.css).
 */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--code-keyword)" },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], color: "var(--code-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName), t.className, t.typeName], color: "var(--code-function)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal], color: "var(--code-number)" },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: "var(--code-property)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--code-tag)" },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: "var(--code-comment)" },
  { tag: t.invalid, color: "var(--code-invalid)" },
]);

export const codeHighlighting = syntaxHighlighting(codeHighlightStyle);
