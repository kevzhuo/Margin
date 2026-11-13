import { expect, test as base, type Locator, type Page } from "@playwright/test";

/**
 * Shared fixture: every test fails if the page logged a console error or threw.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
      });
      await use(errors);
      expect(errors, "console errors during the test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const DESIGN_NOTE = "Editor design notes";

/** Load the app with a fresh demo vault (localStorage cleared). */
export async function openApp(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.app[data-ready="true"]');
  await expect(page.locator(".crumb.current")).toContainText(DESIGN_NOTE);
  await expect(page.locator(".cm-line.cm-md-h1")).toHaveCount(1);
}

export function docText(page: Page): Promise<string> {
  return page.evaluate(() => window.__margin!.store.getState().editor!.state.doc.toString());
}

export function caretPos(page: Page): Promise<number> {
  return page.evaluate(() => window.__margin!.store.getState().editor!.state.selection.main.head);
}

export function activePath(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__margin!.store.getState().activePath);
}

/** Move focus out of the editor so every element renders. */
export async function blurEditor(page: Page) {
  await page.locator(".sidebar .section-label").first().click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest(".cm-editor") == null)).toBe(true);
}

/** Click a point inside a line's text (offset from its left edge). */
export async function clickLine(line: Locator, xOffset = 12) {
  const box = await line.boundingBox();
  if (!box) throw new Error("line has no box");
  await line.page().mouse.click(box.x + xOffset, box.y + box.height / 2);
}

export function lineWithText(page: Page, text: string): Locator {
  return page.locator(".cm-line", { hasText: text }).first();
}

export function lastLine(page: Page): Locator {
  return page.locator(".cm-line").last();
}

/** Extras for a test PDF: a table of contents, and links from a page to another page or a URL. */
export interface PdfExtras {
  outline?: { title: string; page: number }[];
  links?: { from: number; toPage?: number; url?: string }[];
}

/**
 * A small, valid PDF with one line of Helvetica text on each page, built by
 * hand so tests need no files. Pages are US Letter; links cover the line of
 * text on their page.
 */
export function makePdf(pages: string[], extras: PdfExtras = {}): number[] {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  // Fixed numbers: 1 catalog, 2 pages, 3 font; then a page and its contents per page.
  add("");
  add("");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageObj = (i: number) => 4 + i * 2;
  const annots: string[][] = pages.map(() => []);
  const linkStart = 4 + pages.length * 2;
  (extras.links ?? []).forEach((link, k) => {
    const action = link.url ? `/A << /S /URI /URI (${link.url}) >>` : `/Dest [${pageObj(link.toPage! - 1)} 0 R /XYZ 0 792 0]`;
    objects[linkStart + k - 1] = `<< /Type /Annot /Subtype /Link /Rect [72 670 400 710] /Border [0 0 0] ${action} >>`;
    annots[link.from - 1].push(`${linkStart + k} 0 R`);
  });
  pages.forEach((text, i) => {
    const stream = `BT /F1 28 Tf 72 680 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    const annotRefs = annots[i].length ? ` /Annots [${annots[i].join(" ")}]` : "";
    objects[pageObj(i) - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj(i) + 1} 0 R${annotRefs} >>`;
    objects[pageObj(i)] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let outlineRef = "";
  if (extras.outline?.length) {
    const first = objects.length + 2; // after the Outlines dictionary
    const items = extras.outline;
    const outlinesNum = objects.length + 1;
    objects.push(`<< /Type /Outlines /First ${first} 0 R /Last ${first + items.length - 1} 0 R /Count ${items.length} >>`);
    items.forEach((item, k) => {
      const prev = k > 0 ? ` /Prev ${first + k - 1} 0 R` : "";
      const next = k < items.length - 1 ? ` /Next ${first + k + 1} 0 R` : "";
      objects.push(`<< /Title (${item.title}) /Parent ${outlinesNum} 0 R${prev}${next} /Dest [${pageObj(item.page - 1)} 0 R /XYZ 0 792 0] >>`);
    });
    outlineRef = ` /Outlines ${outlinesNum} 0 R`;
  }
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${outlineRef} >>`;
  objects[1] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...out].map((c) => c.charCodeAt(0));
}

/** Put a PDF into the demo vault, as if it had been copied into the folder. */
export async function addPdf(page: Page, dir: string, name: string, pages: string[], extras?: PdfExtras) {
  const bytes = makePdf(pages, extras);
  return page.evaluate(
    async ({ dir, name, bytes }) => {
      const st = window.__margin!.store.getState();
      const path = await st.backend!.saveAttachment(dir, name, new Uint8Array(bytes));
      await st.refreshTree();
      return path;
    },
    { dir, name, bytes },
  );
}
