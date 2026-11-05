import { blurEditor, expect, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

async function openNote(page: Page, doc: string) {
  await page.evaluate(async (text) => {
    await window.__margin!.store.getState().createNote(undefined, "Rendering");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, doc);
  await blurEditor(page);
}

const color = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("horizontal rules are drawn", async ({ page }) => {
  await openNote(page, "Above\n\n---\n\nBelow\n");
  const rule = page.locator(".cm-md-hr");
  await expect(rule).toBeVisible();
  const box = (await rule.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(1);
  expect(box.width).toBeGreaterThan(200);
});

test("bare URLs and escapes look like text; code keeps its colors", async ({ page }) => {
  await openNote(page, "Visit https://example.com/path and \\*this\\*.\n\n```js\nconst x = 1;\n```\n");
  const text = await color(page, ".cm-line:has-text('Visit')");
  const url = page.locator(".cm-md-link", { hasText: "example.com" });
  // The URL's own text (any nested token span) is drawn in the text color.
  expect(await url.evaluate((el) => getComputedStyle(el.querySelector("span") ?? el).color)).toBe(text);
  const escaped = page.locator(".cm-line:has-text('Visit') span", { hasText: /^\*$/ });
  for (const el of await escaped.all()) expect(await el.evaluate((e) => getComputedStyle(e).color)).toBe(text);
  const keyword = page.locator(".cm-md-fence .tok-keyword", { hasText: "const" });
  await expect(keyword).toBeVisible();
  expect(await keyword.evaluate((e) => getComputedStyle(e).color)).not.toBe(text);
});

test("an empty corner cell keeps the header in line", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Tauri vs Electron" }).click();
  await blurEditor(page);
  const header = page.locator(".cm-md-table th");
  await expect(header).toHaveCount(3);
  expect(await header.allTextContents()).toEqual(["", "Tauri 2", "Electron"]);
  // Each header sits over its own column.
  const headerX = await header.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  const cellX = await page.locator(".cm-md-table tbody tr").first().locator("td").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  expect(headerX).toEqual(cellX);
});

test("table cells render their Markdown", async ({ page }) => {
  await openNote(page, "| Feature | Notes |\n| --- | --- |\n| **Math** | $e^{i\\pi}+1=0$ and `code` |\n\nAfter\n");
  const row = page.locator(".cm-md-table tbody tr").first();
  await expect(row.locator("strong")).toHaveText("Math");
  await expect(row.locator(".katex")).toHaveCount(1);
  await expect(row.locator(".cm-md-inline-code")).toHaveText("code");
  // Clicking a cell still edits the table's source.
  await row.locator("strong").click();
  await expect(page.locator(".cm-md-table-raw").first()).toBeAttached();
});

test("an image that fails to load names the missing file", async ({ page }) => {
  await openNote(page, "Before\n\n![Diagram](attachments/Flow%20chart.png)\n\nAfter\n");
  const missing = page.locator(".cm-md-image-missing");
  await expect(missing).toBeVisible();
  await expect(missing).toContainText("Flow chart.png");
  await expect(missing).toContainText("Not found");
  expect(await missing.getAttribute("title")).toBe("attachments/Flow%20chart.png");
});
