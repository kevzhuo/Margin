import { addPdf, docText, expect, openApp, test } from "./helpers";

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
