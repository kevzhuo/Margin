import { activePath, addPdf, docText, expect, makePdf, openApp, test } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("a PDF in the vault shows in the sidebar and opens in the viewer", async ({ page }) => {
  await addPdf(page, "/Demo Vault/Reading", "Paper.pdf", ["First page", "Second page", "Third page"]);
  const row = page.locator(".tree-row", { hasText: "Paper.pdf" });
  await expect(row.locator(".tree-icon")).toBeVisible();
  await row.click();

  const viewer = page.getByRole("document", { name: "PDF: Paper.pdf" });
  await expect(viewer).toBeVisible();
  await expect(page.locator(".pdf-page")).toHaveCount(3);
  await expect(page.locator(".pdf-page-number")).toHaveText("Page 1 of 3");
  // Drawn, with its text selectable.
  await expect(page.locator('.pdf-page[data-page="1"] canvas')).toBeVisible();
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer')).toContainText("First page");
  // Note-only things step aside.
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await expect(page.locator(".word-count")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reading mode" })).toHaveCount(0);
  await expect(page.locator(".crumb.current")).toContainText("Paper.pdf");

  // Zoom: wider pages; back to fit.
  const width = async () => (await page.locator('.pdf-page[data-page="1"]').boundingBox())!.width;
  const fit = await width();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".pdf-zoom-level")).toHaveText("110%");
  await expect.poll(width).toBeCloseTo(fit * 1.1, 0);
  await page.keyboard.press("ControlOrMeta+=");
  await expect(page.locator(".pdf-zoom-level")).toHaveText("125%");
  await page.locator(".pdf-zoom-level").click();
  await expect.poll(width).toBeCloseTo(fit, 0);

  // Scrolling to the last page updates the page number.
  await viewer.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.locator(".pdf-page-number")).toHaveText("Page 3 of 3");

  // Back to a note: the editor returns with its text.
  await page.locator(".tree-row", { hasText: "Roadmap" }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  expect(await docText(page)).toContain("Roadmap");
  // And back again, at the same place.
  await page.keyboard.press("ControlOrMeta+[");
  await expect(page.locator(".pdf-page-number")).toHaveText("Page 3 of 3");
});

test("a PDF can be found in the quick switcher, and renaming keeps it a PDF", async ({ page }) => {
  await addPdf(page, "/Demo Vault/Reading", "Paper.pdf", ["Hello"]);
  await page.keyboard.press("ControlOrMeta+p");
  await page.keyboard.type("paper");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pdf-page")).toHaveCount(1);
  await page.keyboard.press("F2");
  const input = page.locator(".rename-input");
  await expect(input).toHaveValue("Paper.pdf");
  await input.fill("Renamed");
  await input.press("Enter");
  await expect(page.locator(".tree-row", { hasText: "Renamed.pdf" })).toHaveCount(1);
  await expect(page.locator(".crumb.current")).toContainText("Renamed.pdf");
  await expect(page.locator(".pdf-page")).toHaveCount(1);
});

test("a file that isn't a valid PDF shows a message instead of the viewer", async ({ page }) => {
  await page.evaluate(async () => {
    const st = window.__margin!.store.getState();
    await st.backend!.saveAttachment("/Demo Vault", "Broken.pdf", new TextEncoder().encode("not a pdf"));
    await st.refreshTree();
  });
  await page.locator(".tree-row", { hasText: "Broken.pdf" }).click();
  await expect(page.locator(".pdf-message")).toContainText("Couldn’t open this PDF");
});

/** Drop files on an element the way Finder would. */
async function dropFiles(page: import("@playwright/test").Page, selector: string, files: { name: string; bytes: number[]; type: string }[]) {
  const data = await page.evaluateHandle((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
    return dt;
  }, files);
  await page.locator(selector).first().dispatchEvent("dragover", { dataTransfer: data });
  await page.locator(selector).first().dispatchEvent("drop", { dataTransfer: data });
}

test("dropping a PDF on a sidebar folder copies it there and opens it", async ({ page }) => {
  const bytes = makePdf(["Dropped"]);
  await dropFiles(page, '.tree-row[data-kind="dir"]:has-text("Journal")', [{ name: "Ticket.pdf", bytes, type: "application/pdf" }]);
  await expect(page.locator(".toast")).toContainText("Added “Ticket.pdf”");
  await expect.poll(() => activePath(page)).toBe("/Demo Vault/Journal/Ticket.pdf");
  await expect(page.locator(".pdf-page")).toHaveCount(1);
  // The same name again never overwrites.
  await dropFiles(page, '.tree-row[data-kind="dir"]:has-text("Journal")', [{ name: "Ticket.pdf", bytes, type: "application/pdf" }]);
  await expect.poll(() => activePath(page)).toBe("/Demo Vault/Journal/Ticket 2.pdf");
});

test("dropping a PDF on the editor adds it next to the open note, and other files are turned away", async ({ page }) => {
  const before = await docText(page);
  await dropFiles(page, ".cm-content", [{ name: "Spec.pdf", bytes: makePdf(["Spec"]), type: "application/pdf" }]);
  await expect.poll(() => activePath(page)).toBe("/Demo Vault/Projects/Spec.pdf");
  await page.locator(".tree-row", { hasText: "Editor design notes" }).click();
  expect(await docText(page)).toBe(before);

  await dropFiles(page, ".topbar", [{ name: "archive.zip", bytes: [80, 75, 3, 4], type: "application/zip" }]);
  await expect(page.locator(".toast", { hasText: "Drop PDFs anywhere to add them to the vault" })).toBeVisible();
});

test("reading aids: the PDF's contents in the outline, links, go to page, and pinch to zoom", async ({ page }) => {
  await addPdf(page, "/Demo Vault/Reading", "Book.pdf", ["Cover", "Chapter one", "Chapter two", "Notes", "Index"], {
    outline: [
      { title: "Chapter one", page: 2 },
      { title: "Chapter two", page: 3 },
      { title: "Index", page: 5 },
    ],
    links: [
      { from: 1, toPage: 4 },
      { from: 2, url: "https://example.com/" },
    ],
  });
  await page.locator(".tree-row", { hasText: "Book.pdf" }).click();
  const viewer = page.getByRole("document", { name: "PDF: Book.pdf" });
  const pageNumber = page.locator(".pdf-page-number");
  await expect(pageNumber).toHaveText("Page 1 of 5");

  // The table of contents, and following it.
  const outline = page.locator(".outline");
  await expect(outline.locator(".section-label")).toHaveText("Contents");
  await expect(outline.locator(".outline-item")).toHaveText(["Chapter one", "Chapter two", "Index"]);
  await outline.locator(".outline-item", { hasText: "Index" }).click();
  await expect(pageNumber).toHaveText("Page 5 of 5");
  await expect(outline.locator(".outline-item.on")).toHaveText("Index");

  // Go to page: click the page number and type one.
  await pageNumber.click();
  await page.getByRole("textbox", { name: "Go to page" }).fill("2");
  await page.keyboard.press("Enter");
  await expect(pageNumber).toHaveText("Page 2 of 5");
  await expect(outline.locator(".outline-item.on")).toHaveText("Chapter one");

  // A web link opens in the browser, not in Margin.
  await page.evaluate(() => {
    const b = window.__margin!.store.getState().backend!;
    (window as unknown as { opened: string[] }).opened = [];
    b.openExternal = async (url: string) => void (window as unknown as { opened: string[] }).opened.push(url);
  });
  await page.locator('.pdf-page[data-page="2"] .pdf-link').click();
  expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual(["https://example.com/"]);

  // A link to another page goes there.
  await outline.locator(".outline-item", { hasText: "Chapter one" }).click();
  await viewer.evaluate((el) => (el.scrollTop = 0));
  await expect(pageNumber).toHaveText("Page 1 of 5");
  await page.locator('.pdf-page[data-page="1"] .pdf-link').click();
  await expect(pageNumber).toHaveText("Page 4 of 5");

  // Pinch (a ctrl+wheel gesture on most trackpads) zooms the PDF, not the window.
  await viewer.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect(page.locator(".pdf-zoom-level")).not.toHaveText("100%");
});

test("a PDF without a table of contents says so", async ({ page }) => {
  await addPdf(page, "/Demo Vault/Reading", "Plain.pdf", ["Just text"]);
  await page.locator(".tree-row", { hasText: "Plain.pdf" }).click();
  await expect(page.locator(".outline-empty")).toHaveText("This PDF has no table of contents");
});
