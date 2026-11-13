import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { dirname, encodeLinkPath, isMarkdown, isWithin, relativePath, resolveRelative } from "../backend/types";
import { mathSyntax } from "../editor/mathSyntax";

/**
 * Keeping links working when files move.
 *
 * Links between notes, and to images and PDFs, are ordinary relative paths
 * (`../Projects/Roadmap.md#next`). Renaming or moving a file or folder
 * breaks two kinds of them: links in other notes that lead into what moved,
 * and links out of a note that now sits in a different folder. `relinkEdits`
 * finds both in one note and says how to rewrite them so that every link
 * leads where it did before.
 *
 * Only the path part of a link changes; its `#heading`, `?query`, title and
 * text stay as written. Web links, in-note anchors, absolute paths, links in
 * code and wiki links (`[[Name]]`) are left alone.
 */

/** A file or folder that was renamed or moved: where it was, and where it is now. */
export interface Move {
  from: string;
  to: string;
}

/** Replace `from`..`to` of a note's text with `insert`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** The editor's own parser, so links are found exactly where the editor shows them. */
const parser = (markdownLanguage.parser as MarkdownParser).configure(mathSyntax);

/** Nodes whose `URL` child is a destination: `[text](url)`, `![alt](url)` and `[id]: url`. */
const LINKING = new Set(["Link", "Image", "LinkReference"]);

/** Where `path` is now, if it was `move.from` or inside it; otherwise null. */
function movedPath(path: string, move: Move, existed: (path: string) => boolean): string | null {
  if (isWithin(path, move.from)) return move.to + path.slice(move.from.length);
  // macOS and Windows file systems ignore case, so "roadmap.md" opens
  // "Roadmap.md". Match that only when no file had the exact name.
  if (!existed(path) && isWithin(path.toLowerCase(), move.from.toLowerCase())) return move.to + path.slice(move.from.length);
  return null;
}

/**
 * The file a link led to before the move, as an absolute path where it is
 * now. A link without an extension reaches `Name.md` when nothing is called
 * just `Name`, the way Margin follows it; it stays without one.
 */
function currentTarget(target: string, move: Move, existed: (path: string) => boolean): string {
  const moved = movedPath(target, move, existed);
  if (moved !== null) return moved;
  if (isMarkdown(target) || existed(target)) return target;
  const note = movedPath(`${target}.md`, move, existed);
  if (note === null) return target;
  return /\.md$/i.test(note) ? note.slice(0, -3) : note;
}

/** Rewrite one link destination as written in a note, or return null to leave it. */
function relinkDestination(written: string, oldDir: string, newDir: string, move: Move, existed: (path: string) => boolean): string | null {
  const angled = written.length >= 2 && written.startsWith("<") && written.endsWith(">");
  const href = angled ? written.slice(1, -1) : written;
  const before = resolveRelative(oldDir, href);
  if (before === null) return null;
  const target = currentTarget(before, move, existed);
  // Still reaches the same file from where the note is now.
  if (resolveRelative(newDir, href) === target) return null;
  const split = href.search(/[?#]/);
  const pathPart = split < 0 ? href : href.slice(0, split);
  const suffix = split < 0 ? "" : href.slice(split);
  let rel = relativePath(newDir, target);
  if (pathPart.startsWith("./") && !rel.startsWith("../")) rel = `./${rel}`;
  // Inside <…> spaces are allowed; only what would end or garble the link is escaped.
  const path = angled ? `<${rel.replace(/[<>%]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}>` : encodeLinkPath(rel);
  return path + suffix;
}

/**
 * The edits that keep a note's links working after `move`. The note was at
 * `oldPath` and is now at `newPath` (the same unless the note itself moved).
 * `existed` tells whether a path (a note, PDF or folder) existed before the
 * move. Edits are in document order and don't overlap.
 */
export function relinkEdits(text: string, oldPath: string, newPath: string, move: Move, existed: (path: string) => boolean): TextEdit[] {
  // Most notes have no links at all; skip parsing them.
  if (!text.includes("](") && !text.includes("]:")) return [];
  const oldDir = dirname(oldPath);
  const newDir = dirname(newPath);
  const edits: TextEdit[] = [];
  parser.parse(text).iterate({
    enter(node) {
      if (node.name !== "URL" || !LINKING.has(node.node.parent?.name ?? "")) return;
      const written = text.slice(node.from, node.to);
      const insert = relinkDestination(written, oldDir, newDir, move, existed);
      if (insert !== null && insert !== written) edits.push({ from: node.from, to: node.to, insert });
    },
  });
  return edits;
}

/** Apply edits made against `text` (in document order, not overlapping). */
export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = "";
  let pos = 0;
  for (const e of edits) {
    out += text.slice(pos, e.from) + e.insert;
    pos = e.to;
  }
  return out + text.slice(pos);
}
