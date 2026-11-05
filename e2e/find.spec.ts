import { docText, expect, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

const DOC = "# Fruit\n\nApple pie, apple tart and APPLE juice.\n\nPears and plums.\n";

async function openNote(page: Page, doc = DOC) {
  await page.evaluate(async (text) => {
    await window.__margin!.store.getState().createNote(undefined, "Fruit");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
    view.focus();
  }, doc);
}

const bar = (page: Page) => page.locator(".cm-find");
const count = (page: Page) => page.locator(".cm-find-count");

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openNote(page);
});

test("Mod+F opens the find bar, counts matches and steps through them", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+f");
  await expect(bar(page)).toBeVisible();
  await expect(page.locator(".cm-find-field").first()).toBeFocused();
  await page.keyboard.type("apple");
  await expect(count(page)).toHaveText("3 results");
  await expect(page.locator(".cm-searchMatch")).toHaveCount(3);
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("1 of 3");
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("2 of 3");
  await page.keyboard.press("Shift+Enter");
  await expect(count(page)).toHaveText("1 of 3");
  // The selected match doesn't bring up the formatting toolbar over the bar.
  await expect(page.locator(".cm-bubble-toolbar")).toHaveCount(0);
});

test("match case, whole words and regular expressions narrow the search", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("apple");
  await page.getByRole("button", { name: "Match case" }).click();
  await expect(count(page)).toHaveText("1 result");
  await page.getByRole("button", { name: "Match case" }).click();
  await page.locator(".cm-find-field").first().fill("p");
  await page.getByRole("button", { name: "Whole words" }).click();
  await expect(count(page)).toHaveText("No results");
  await expect(bar(page)).toHaveClass(/no-results/);
  await page.getByRole("button", { name: "Whole words" }).click();
  await page.getByRole("button", { name: "Regular expression" }).click();
  await page.locator(".cm-find-field").first().fill("p(ie|lums");
  await expect(count(page)).toHaveText("Invalid pattern");
  await page.locator(".cm-find-field").first().fill("p(ie|lums)");
  await expect(count(page)).toHaveText("2 results");
});

test("replace one or all", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("apple");
  await expect(page.locator(".cm-find-replace")).toBeHidden();
  await page.getByRole("button", { name: "Show replace" }).click();
  await page.getByRole("textbox", { name: "Replace with" }).fill("pear");
  await page.getByRole("button", { name: "Replace every match" }).click();
  expect(await docText(page)).toBe("# Fruit\n\npear pie, pear tart and pear juice.\n\nPears and plums.\n");
  await expect(count(page)).toHaveText("No results");
});

test("Escape closes the bar and returns to the note", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("plums");
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__margin!.store.getState().editor!.hasFocus)).toBe(true);
});

test("selected text becomes the search", async ({ page }) => {
  await page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    const from = view.state.doc.toString().indexOf("Pears");
    view.dispatch({ selection: { anchor: from, head: from + 5 } });
  });
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator(".cm-find-field").first()).toHaveValue("Pears");
  await expect(count(page)).toHaveText("1 of 1");
});

test("the bar floats at the top right of the note", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+f");
  const card = (await bar(page).boundingBox())!;
  const editor = (await page.locator(".cm-editor").boundingBox())!;
  expect(editor.x + editor.width - (card.x + card.width)).toBeLessThan(40);
  expect(card.y - editor.y).toBeLessThan(30);
  // Floating: the note's text doesn't move down.
  const titleY = await page.locator(".cm-line").first().evaluate((el) => el.getBoundingClientRect().y);
  await page.keyboard.press("Escape");
  expect(await page.locator(".cm-line").first().evaluate((el) => el.getBoundingClientRect().y)).toBe(titleY);
});
