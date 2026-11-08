import type { EditorState, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { titleLine } from "../state/title";
import { frontMatterRange } from "./livePreview";

export interface Heading {
  level: number;
  text: string;
  pos: number;
  /** The note's title (its first line, a `# ` heading); the outline leaves it out. */
  title?: boolean;
}

/** Blocks that can contain headings. Everything else is skipped without visiting its inline nodes. */
const HEADING_CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

export function extractHeadings(state: EditorState): Heading[] {
  const headings: Heading[] = [];
  const doc = state.doc;
  // The Markdown parser doesn't know front matter: its closing `---` reads as a heading underline.
  const frontMatterEnd = frontMatterRange(doc)?.to ?? -1;
  syntaxTree(state).iterate({
    enter(n) {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(n.name);
      if (!m) return HEADING_CONTAINERS.has(n.name) ? undefined : false;
      if (n.from <= frontMatterEnd) return false;
      const level = Number(m[2]);
      const line = doc.lineAt(n.from);
      const text = line.text
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\s+#+\s*$/, "")
        .replace(/[*_`~]/g, "")
        .trim();
      const heading: Heading = { level, text: text || "Untitled", pos: n.from };
      if (!headings.length && level === 1 && titleLine(doc.sliceString(0, line.to))?.line === line.number) heading.title = true;
      headings.push(heading);
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
