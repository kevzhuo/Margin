/**
 * A note's title is its first line when that line is a level-one heading
 * (`# Title`), after any YAML front matter. Notes without one have no title,
 * and title syncing leaves them alone.
 */

export interface TitleLine {
  /** Heading text, without the `#` and any closing `#`s. */
  text: string;
  /** Character offsets of the heading text within the document. */
  from: number;
  to: number;
  /** 1-based line number. */
  line: number;
}

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function titleLine(doc: string): TitleLine | null {
  let offset = 0;
  const fm = FRONT_MATTER.exec(doc);
  if (fm) offset = fm[0].length;
  // Skip blank lines before the heading.
  const lead = /^(?:[ \t]*\r?\n)*/.exec(doc.slice(offset))![0];
  offset += lead.length;
  const end = doc.indexOf("\n", offset);
  const raw = doc.slice(offset, end === -1 ? doc.length : end).replace(/\r$/, "");
  const m = /^ {0,3}#(?:[ \t]+|$)(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(raw);
  if (!m || raw.startsWith("##") || /^ {0,3}##/.test(raw)) return null;
  const text = m[1];
  const textStart = offset + raw.indexOf(text, raw.indexOf("#") + 1);
  const line = doc.slice(0, offset).split("\n").length;
  return { text, from: text ? textStart : offset + raw.length, to: text ? textStart + text.length : offset + raw.length, line };
}

export function titleFromDoc(doc: string): string | null {
  return titleLine(doc)?.text ?? null;
}

const MAX_NAME = 120;

/** Turn a heading into a file name: markdown removed, unsafe characters replaced. */
export function fileNameFromTitle(title: string): string {
  let name = title
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target) // wiki links
    .replace(/(\*\*|__|\*|_|~~|==|`)/g, "") // emphasis and code marks
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1") // escapes
    .replace(/\s+/g, " ")
    // Characters macOS, Windows or Linux don't allow (or treat specially) in names.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim()
    // No hidden files, and Windows drops trailing dots and spaces.
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s-]+$/, "");
  if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME).trim();
  return name;
}

/** The new document with its title replaced, or null if it has no title line. */
export function replaceTitle(doc: string, title: string): { from: number; to: number; insert: string } | null {
  const t = titleLine(doc);
  if (!t) return null;
  return { from: t.from, to: t.to, insert: title };
}

/** Default names a note starts with; these always follow the title. */
export const isPlaceholderName = (stem: string) => /^Untitled(?: \d+)?$/.test(stem);
