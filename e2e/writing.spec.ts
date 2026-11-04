import { clickLine, docText, expect, lineWithText, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** Put the caret at the very end of the document (lines outside the viewport aren't rendered). */
async function caretToEnd(page: Page) {
  await page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
    view.focus();
  });
}

async function selectText(page: Page, text: string) {
  await page.evaluate((t) => {
    const view = window.__margin!.store.getState().editor!;
    const from = view.state.doc.toString().indexOf(t);
    view.dispatch({ selection: { anchor: from, head: from + t.length } });
    view.focus();
  }, text);
}

test("typing a delimiter over a selection wraps it", async ({ page }) => {
  await selectText(page, "database export");
  await page.keyboard.type("**");
  expect(await docText(page)).toContain("never a **database export**.");
  await selectText(page, "source of truth");
  await page.keyboard.type("`");
  expect(await docText(page)).toContain("the `source of truth`, never");
});

test("brackets close themselves and are stepped over", async ({ page }) => {
  await caretToEnd(page);
  await page.keyboard.type("See (");
  expect(await docText(page)).toMatch(/See \(\)$/);
  await page.keyboard.type("notes)");
  expect(await docText(page)).toMatch(/See \(notes\)$/);
  // Quotes are not paired, so apostrophes stay single.
  await page.keyboard.type(" it's");
  expect(await docText(page)).toMatch(/See \(notes\) it's$/);
});

test("pasting a URL over selected text makes a link", async ({ page }) => {
  await selectText(page, "source of truth");
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "https://example.com/truth");
    window.__margin!.store.getState().editor!.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  expect(await docText(page)).toContain("[source of truth](https://example.com/truth)");
});

test("the status bar counts selected words and estimates reading time", async ({ page }) => {
  await expect(page.locator(".reading-time")).toHaveText("1 min read");
  const total = Number((await page.locator(".word-count").textContent())!.replace(/\D/g, ""));
  await selectText(page, "Files on disk are the source of truth");
  await expect(page.locator(".word-count")).toHaveText(`8 of ${total} words`);
});

test("settings change the text size, font and line width", async ({ page }) => {
  const content = page.locator(".cm-content");
  const editor = page.locator(".cm-editor");
  await expect(editor).toHaveCSS("font-size", "16px");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();

  await settings.getByRole("radio", { name: "Serif" }).click();
  await expect(settings.getByRole("radio", { name: "Serif" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => editor.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("serif");

  const wide = (await content.boundingBox())!.width;
  await settings.getByRole("radio", { name: "Narrow" }).click();
  await expect.poll(async () => (await content.boundingBox())!.width).toBeLessThan(wide);

  const slider = settings.getByRole("slider", { name: "Text size" });
  await slider.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(editor).toHaveCSS("font-size", "20px");
  await expect(settings.getByRole("button", { name: /Text size 20 pixels/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // Keyboard zoom.
  await page.keyboard.press("Control+-");
  await expect(editor).toHaveCSS("font-size", "19px");
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  await expect(editor).toHaveCSS("font-size", "21px");

  // Settings survive a reload.
  await page.reload();
  await page.waitForSelector('.app[data-ready="true"]');
  await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "21px");
});

test("focus mode dims everything except the caret's line", async ({ page }) => {
  const active = lineWithText(page, "Nothing moves when you click");
  const other = lineWithText(page, "Files on disk are the source");
  await clickLine(active, 200);
  await page.keyboard.press("F8");
  await expect(page.locator("html")).toHaveClass(/focus-mode/);
  await expect.poll(() => other.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.5);
  await expect(active).toHaveCSS("opacity", "1");
  await page.keyboard.press("F8");
  await expect.poll(() => other.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

test("typewriter mode keeps the caret near the middle while typing", async ({ page }) => {
  await caretToEnd(page);
  await page.keyboard.press("F9");
  await expect(page.locator("html")).toHaveClass(/typewriter/);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(`Line ${i}`);
  }
  const ratio = () =>
    page.evaluate(() => {
      const view = window.__margin!.store.getState().editor!;
      const caret = view.coordsAtPos(view.state.selection.main.head)!;
      const box = view.scrollDOM.getBoundingClientRect();
      return (caret.top - box.top) / box.height;
    });
  await expect.poll(ratio, { timeout: 3000 }).toBeGreaterThan(0.3);
  await expect.poll(ratio, { timeout: 3000 }).toBeLessThan(0.6);
});
