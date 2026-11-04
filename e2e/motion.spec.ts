import { activePath, blurEditor, clickLine, expect, lineWithText, openApp, test } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("revealed syntax fades in once and is not re-created while typing", async ({ page }) => {
  await blurEditor(page);
  const h1 = page.locator(".cm-line.cm-md-h1");
  await clickLine(h1, 400);
  await page.keyboard.press("End");
  const mark = h1.locator(".cm-md-margin-mark");
  await expect(mark).toHaveCSS("animation-name", "fade-in");
  await mark.evaluate((el) => ((el as HTMLElement & { __probe?: number }).__probe = 1));
  await page.keyboard.type(" draft");
  await expect(h1).toContainText("draft");
  expect(await mark.evaluate((el) => (el as HTMLElement & { __probe?: number }).__probe)).toBe(1);
});

test("checkbox keeps its element when toggled so the tick animates", async ({ page }) => {
  const line = lineWithText(page, "Decide how a table is edited");
  const box = line.locator(".cm-md-checkbox input");
  await box.evaluate((el) => ((el as HTMLElement & { __probe?: number }).__probe = 1));
  await box.click();
  await expect(line).toHaveClass(/cm-md-task-done/);
  await expect(box).toBeChecked();
  expect(await box.evaluate((el) => (el as HTMLElement & { __probe?: number }).__probe)).toBe(1);
  // The tick scales in: it ends at full size, not scale(0).
  await expect.poll(() => box.evaluate((el) => getComputedStyle(el, "::after").opacity)).toBe("1");
  // Done tasks are struck through.
  await expect(line).toHaveCSS("text-decoration-line", "line-through");
});

test("switching notes fades the new note in", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Roadmap" }).click();
  await expect(page.locator(".editor-host")).toHaveClass(/note-enter/);
  await expect(page.locator(".editor-host")).not.toHaveClass(/note-enter/);
  await expect.poll(() => activePath(page)).toMatch(/Roadmap\.md$/);
});

test("the bubble toolbar animates in once and follows the selection without being rebuilt", async ({ page }) => {
  const select = (text: string, length: number) =>
    page.evaluate(
      ([t, n]) => {
        const view = window.__margin!.store.getState().editor!;
        const from = view.state.doc.toString().indexOf(t as string);
        view.dispatch({ selection: { anchor: from, head: from + (n as number) } });
        view.focus();
      },
      [text, length],
    );
  await select("finished page.", 8);
  const toolbar = page.locator(".cm-bubble-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveCSS("animation-name", "rise-in");
  await toolbar.evaluate((el) => ((el as HTMLElement & { __probe?: number }).__probe = 1));
  const y1 = (await toolbar.boundingBox())!.y;
  // Move to a selection further down: the same element moves there.
  await select("Files on disk", 5);
  await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeGreaterThan(y1 + 50);
  expect(await toolbar.evaluate((el) => (el as HTMLElement & { __probe?: number }).__probe)).toBe(1);
});

test("menus and dialogs play an exit animation before unmounting", async ({ page }) => {
  await page.keyboard.press("Control+p");
  const palette = page.locator(".palette");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveAttribute("data-closing", "true");
  await expect(palette).toHaveCount(0);

  await page.locator(".tree-row", { hasText: "Inbox" }).click({ button: "right" });
  const menu = page.locator(".context-menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("data-closing", "true");
  await expect(menu).toHaveCount(0);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("panels and dialogs change instantly", async ({ page }) => {
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    // No transition: the width is already 0 on the next frame.
    await page.waitForTimeout(50);
    expect((await page.locator(".sidebar-shell").boundingBox())?.width).toBe(0);
    await page.keyboard.press("Control+p");
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).toHaveCount(0, { timeout: 100 });
  });
});
