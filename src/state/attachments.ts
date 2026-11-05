/**
 * Images added to a note (pasted, dropped or picked) are copied into one
 * `attachments` folder at the top of the vault and linked with an ordinary
 * relative path, so Typora, Obsidian, VS Code and GitHub all show them too.
 */

export const ATTACHMENTS_DIR = "attachments";

/** Largest image accepted, in bytes. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|svg|avif|heic|heif|bmp|tiff?)$/i;

export function isImageFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith("image/") || IMAGE_NAME.test(file.name);
}

/**
 * Make a name safe to save on any platform: no folder separators or
 * characters Windows rejects, no leading dot (hidden), at most 120 characters
 * with the extension kept.
 */
export function sanitizeFileName(name: string): string {
  let clean = name
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim()
    .replace(/^[.\s-]+/, "");
  if (clean.length > 120) {
    const dot = clean.lastIndexOf(".");
    const ext = dot > 0 && clean.length - dot <= 6 ? clean.slice(dot) : "";
    clean = clean.slice(0, 120 - ext.length).trimEnd() + ext;
  }
  return clean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The name an image is saved under: its own name when it has one (dropped,
 * picked, or a file copied in Finder), otherwise a timestamp like a macOS
 * screenshot's: "Pasted image 2026-11-05 at 14.32.07.png".
 */
export function attachmentName(file: { name: string; type: string }, now = new Date()): string {
  const typed = EXTENSIONS[file.type];
  const own = sanitizeFileName(file.name);
  // Browsers name every pasted screenshot "image.png", which says nothing.
  if (own && !/^image\.\w+$/i.test(own)) return IMAGE_NAME.test(own) || !typed ? own : `${own}.${typed}`;
  const ext = typed ?? own.match(IMAGE_NAME)?.[1]?.toLowerCase() ?? "png";
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

/**
 * Relative path from the folder `fromDir` to the file `to`, with `/`
 * separators. Both are absolute paths in the same vault.
 */
export function relativePath(fromDir: string, to: string): string {
  const split = (p: string) => p.split(/[\\/]+/).filter(Boolean);
  const from = split(fromDir);
  const target = split(to);
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common++;
  return [...from.slice(common).map(() => ".."), ...target.slice(common)].join("/");
}

/**
 * Percent-encode the characters that would end or confuse a Markdown link
 * destination (spaces, brackets, parentheses, `<>`, `#`, `?`, `%`). Letters
 * from any language stay as they are, as Obsidian and Typora write them.
 */
export function encodeLinkPath(path: string): string {
  return path.replace(/[ ()[\]<>#?%]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

/** Markdown for an image. The alt text is the file's name without its extension. */
export function imageMarkdown(link: string, name: string): string {
  const alt = name.startsWith("Pasted image ") ? "" : name.replace(IMAGE_NAME, "").replace(/[[\]\\]/g, "");
  return `![${alt}](${encodeLinkPath(link)})`;
}
