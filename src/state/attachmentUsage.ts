import { basename, dirname, isWithin, joinPath, resolveRelative, type ImageFile } from "../backend/types";

/** A place in a note that refers to an image. */
export interface ImageUse {
  notePath: string;
  /** 1-based line. */
  line: number;
}

/** An image link as written, before it is matched to a file. */
interface Reference {
  /** The link's target: a path, or for `![[name]]` embeds just a name. */
  target: string;
  /** Obsidian-style embeds name a file, found wherever it is in the vault. */
  byName: boolean;
  line: number;
}

const PATTERNS: { re: RegExp; byName: boolean }[] = [
  // ![alt](dest "title"), [text](dest) and <dest with spaces>. Obsidian also
  // allows bare spaces, so take everything up to the closing parenthesis.
  { re: /\]\(\s*(<[^>]*>|[^)]*?)(?:\s+["'(][^)]*)?\)/g, byName: false },
  // <img src="…">
  { re: /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, byName: false },
  // [id]: dest — a reference definition.
  { re: /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/gm, byName: false },
  // ![[name.png]], [[name.png|alias]]
  { re: /!?\[\[([^\]|#^]+)/g, byName: true },
];

/** Every image-like link in a note, with its line. Links in code are counted too, to be safe. */
export function findReferences(text: string): Reference[] {
  const refs: Reference[] = [];
  const lineStarts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lineStarts.push(i + 1);
  const lineAt = (index: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  for (const { re, byName } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const raw = (m[1] ?? m[2] ?? "").trim().replace(/^<(.*)>$/, "$1").trim();
      if (raw) refs.push({ target: raw, byName, line: lineAt(m.index) });
    }
  }
  return refs;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Which notes use each image. A link counts when it resolves to the image's
 * path; one that doesn't resolve to any image (broken, or written the
 * "shortest path" way Obsidian allows) still counts for images with that file
 * name, so an image is never called unused while a note still names it.
 * Paths compare case-insensitively, as on a Mac.
 */
export function imageUsage(root: string, images: ImageFile[], notes: { path: string; text: string }[]): Map<string, ImageUse[]> {
  const usage = new Map<string, ImageUse[]>(images.map((img) => [img.path, []]));
  const byPath = new Map(images.map((img) => [img.path.toLowerCase(), img.path]));
  const imagesNamed = new Map<string, string[]>();
  for (const img of images) {
    const name = basename(img.path).toLowerCase();
    imagesNamed.set(name, [...(imagesNamed.get(name) ?? []), img.path]);
  }
  const use = (path: string, notePath: string, line: number) => {
    const list = usage.get(path)!;
    if (!list.some((u) => u.notePath === notePath && u.line === line)) list.push({ notePath, line });
  };
  for (const note of notes) {
    for (const ref of findReferences(note.text)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref.target) && !/^[a-zA-Z]:[\\/]/.test(ref.target)) continue; // web, data, mailto…
      const target = ref.target.split(/[?#]/)[0];
      let resolved: string | null = null;
      if (!ref.byName) {
        const plain = decode(target);
        if (/^([a-zA-Z]:[\\/]|\\\\)/.test(plain)) resolved = plain;
        else if (plain.startsWith("/")) resolved = isWithin(plain, root) ? plain : joinPath(root, plain.slice(1));
        else resolved = resolveRelative(dirname(note.path), target);
      }
      const exact = resolved ? byPath.get(resolved.toLowerCase()) : undefined;
      if (exact) {
        use(exact, note.path, ref.line);
        continue;
      }
      for (const path of imagesNamed.get(basename(decode(target)).toLowerCase()) ?? []) use(path, note.path, ref.line);
    }
  }
  // Last safety net: an image whose file name appears anywhere in a note (a
  // link written some way not parsed above) is used by that note.
  for (const [path, uses] of usage) {
    if (uses.length) continue;
    const name = basename(path).toLowerCase();
    const forms = [...new Set([name, encodeURI(name).toLowerCase(), name.replace(/ /g, "%20")])];
    for (const note of notes) {
      const lines = note.text.toLowerCase().split("\n");
      const i = lines.findIndex((l) => forms.some((f) => l.includes(f)));
      if (i !== -1) use(path, note.path, i + 1);
    }
  }
  return usage;
}
