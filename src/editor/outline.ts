import type { EditorState, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export interface Heading {
  level: number;
  text: string;
  pos: number;
}

/** Blocks that can contain headings. Everything else is skipped without visiting its inline nodes. */
const HEADING_CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

export function extractHeadings(state: EditorState): Heading[] {
  const headings: Heading[] = [];
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter(n) {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(n.name);
      if (!m) return HEADING_CONTAINERS.has(n.name) ? undefined : false;
      const level = Number(m[2]);
      const line = doc.lineAt(n.from);
      const text = line.text
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\s+#+\s*$/, "")
        .replace(/[*_`~]/g, "")
        .trim();
      headings.push({ level, text: text || "Untitled", pos: n.from });
      return false;
    },
  });
  return headings;
}

export function countWords(doc: Text): number {
  let count = 0;
  for (const line of doc.iterLines()) {
    const stripped = line.replace(/^[\s>#*+-]+|[`*_~\[\]()]/g, " ");
    const words = stripped.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu);
    if (words) count += words.length;
  }
  return count;
}

/** Title for a note: its first H1, else the file name. */
export function firstHeading(state: EditorState): string | null {
  const headings = extractHeadings(state);
  return headings.length ? headings[0].text : null;
}
