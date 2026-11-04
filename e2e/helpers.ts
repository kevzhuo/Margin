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
