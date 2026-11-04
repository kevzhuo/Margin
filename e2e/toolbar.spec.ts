import { clickLine, docText, expect, lineWithText, openApp, test } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("bubble toolbar appears over a selection and Bold wraps it", async ({ page }) => {
  const line = lineWithText(page, "Everything else reads like a finished");
  await clickLine(line, 200);
  await expect(page.locator(".cm-bubble-toolbar")).toHaveCount(0);

  // Select the word "page" at the end of the paragraph. Set it directly:
  // where End lands depends on how the paragraph wraps with the system fonts.
  await page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    const from = view.state.doc.toString().indexOf("finished page.") + "finished ".length;
    view.dispatch({ selection: { anchor: from + 4, head: from } });
    view.focus();
  });
  const selected = await page.evaluate(() => {
    const s = window.__margin!.store.getState().editor!.state;
    return s.sliceDoc(s.selection.main.from, s.selection.main.to);
  });
  expect(selected).toBe("page");

  const toolbar = page.locator(".cm-bubble-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: /Bold/ }).click();
  expect(await docText(page)).toContain("**page**.");
  // The wrapped text stays selected, so the toolbar stays and the marks are revealed.
  await expect(toolbar).toBeVisible();
  await expect(line.locator(".cm-md-strong").last()).toHaveText("**page**");
  await expect(line.locator(".cm-md-mark")).toHaveText(["**", "**"]);

  // Collapsing the selection hides the toolbar and the marks.
  await page.keyboard.press("End");
  await expect(page.locator(".cm-bubble-toolbar")).toHaveCount(0);
  await expect(line.locator(".cm-md-mark")).toHaveCount(0);
  await expect(line).not.toContainText("**");
  await expect(line.locator(".cm-md-strong").last()).toHaveText("page");
});

test("bubble toolbar heading button cycles the line's heading level", async ({ page }) => {
  const line = lineWithText(page, "Everything else reads like a finished page");
  await clickLine(line, 30);
  await page.keyboard.press("Shift+End");
  const toolbar = page.locator(".cm-bubble-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: /Heading/ }).click();
  await expect(line).toHaveClass(/cm-md-h2/);
  await toolbar.getByRole("button", { name: /Heading/ }).click();
  await expect(line).toHaveClass(/cm-md-h3/);
  await toolbar.getByRole("button", { name: /Heading/ }).click();
  await expect(line).not.toHaveClass(/cm-md-h/);
});
