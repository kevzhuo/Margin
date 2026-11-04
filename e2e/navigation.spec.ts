import { activePath, blurEditor, caretPos, docText, expect, lineWithText, openApp, test } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const selectedText = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = window.__margin!.store.getState().editor!.state;
    return s.sliceDoc(s.selection.main.from, s.selection.main.to);
  });

test("back and forward move through visited notes", async ({ page }) => {
  const back = page.getByRole("button", { name: "Go back" });
  const forward = page.getByRole("button", { name: "Go forward" });
  await expect(back).toBeDisabled();
  await page.locator(".tree-row", { hasText: "Roadmap" }).click();
  await page.locator(".tree-row", { hasText: "Inbox" }).click();
  await expect.poll(() => activePath(page)).toMatch(/Inbox\.md$/);

  await back.click();
  await expect.poll(() => activePath(page)).toMatch(/Roadmap\.md$/);
  await expect(forward).toBeEnabled();
  // Keyboard, with focus in the editor: Mod+[ goes back instead of outdenting.
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+[");
  await expect.poll(() => activePath(page)).toMatch(/Editor design notes\.md$/);
  await page.keyboard.press("Control+]");
  await expect.poll(() => activePath(page)).toMatch(/Roadmap\.md$/);
});

test("returning to a note restores the caret and scroll position", async ({ page }) => {
  await page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    const pos = view.state.doc.toString().indexOf("Decoration plan");
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  });
  const pos = await caretPos(page);
  const scrolled = await page.locator(".cm-scroller").evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);

  await page.locator(".tree-row", { hasText: "Roadmap" }).click();
  await expect.poll(() => activePath(page)).toMatch(/Roadmap\.md$/);
  await page.locator(".tree-row", { hasText: "Editor design notes" }).click();
  await expect.poll(() => activePath(page)).toMatch(/Editor design notes\.md$/);
  await expect.poll(() => caretPos(page)).toBe(pos);
  await expect.poll(() => page.locator(".cm-scroller").evaluate((el) => el.scrollTop)).toBeGreaterThan(scrolled - 40);
});

test("full-text search jumps to and selects the match", async ({ page }) => {
  await page.keyboard.press("Control+Shift+f");
  const dialog = page.getByRole("dialog", { name: "Quick switcher" });
  await page.keyboard.type("right, make");
  const hit = dialog.locator(".palette-item.kind-hit").first();
  await expect(hit).toContainText("Make it work, make it right, make it fast.");
  await expect(hit.locator("mark")).toHaveText("right, make");
  await expect(dialog.locator(".palette-section")).toHaveText(["In notes"]);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect.poll(() => activePath(page)).toMatch(/2026-11-03\.md$/);
  await expect.poll(() => selectedText(page)).toBe("right, make");
});

test("the palette lists recent notes first and can create a note by name", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Roadmap" }).click();
  await page.locator(".tree-row", { hasText: "Inbox" }).click();
  await expect.poll(() => activePath(page)).toMatch(/Inbox\.md$/);
  await page.keyboard.press("Control+p");
  const dialog = page.getByRole("dialog", { name: "Quick switcher" });
  await expect(dialog.locator(".palette-title").nth(0)).toHaveText("Inbox");
  await expect(dialog.locator(".palette-title").nth(1)).toHaveText("Roadmap");
  await expect(dialog.locator(".palette-title").nth(2)).toHaveText("Editor design notes");

  await page.keyboard.type("Weekly review");
  await expect(dialog.locator(".palette-item.kind-create")).toContainText("Create note “Weekly review”");
  await dialog.locator(".palette-item.kind-create").click();
  await expect.poll(() => activePath(page)).toMatch(/\/Weekly review\.md$/);
  await expect(page.locator(".cm-line.cm-md-h1")).toHaveText(/Weekly review/);
  await expect(page.locator(".rename-input")).toHaveCount(0);
});

test("command mode runs commands and shows their shortcuts", async ({ page }) => {
  await page.keyboard.press("Control+Shift+p");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog.getByRole("textbox")).toHaveValue(">");
  await page.keyboard.type("dark");
  await expect(dialog.locator(".palette-item.on")).toContainText("Theme: Dark");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("sidebar");
  await expect(page.locator(".palette-item.on .palette-kbd")).toHaveText("Ctrl+\\");
  // Backspace on a lone ">" leaves command mode.
  await page.keyboard.press("Control+a");
  await page.keyboard.type(">");
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("dialog", { name: "Quick switcher" })).toBeVisible();
});

test("relative links open notes in the app and jump to the heading", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Inbox" }).click();
  await expect.poll(() => activePath(page)).toMatch(/Inbox\.md$/);
  await blurEditor(page);
  await lineWithText(page, "Next up").locator(".cm-md-link").click();
  await expect.poll(() => activePath(page)).toMatch(/Projects\/Roadmap\.md$/);
  const nextHeading = await page.evaluate(() => window.__margin!.store.getState().editor!.state.doc.toString().indexOf("## Next"));
  await expect.poll(() => caretPos(page)).toBe(nextHeading);
  await expect(page.locator(".crumb.current")).toContainText("Roadmap");
});

test("the window title follows the open note", async ({ page }) => {
  await expect(page).toHaveTitle("Editor design notes — Margin");
  await page.locator(".tree-row", { hasText: "Roadmap" }).click();
  await expect(page).toHaveTitle("Roadmap — Margin");
  expect(await docText(page)).toContain("# Roadmap");
});
