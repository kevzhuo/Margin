import { activePath, clickLine, docText, expect, lastLine, openApp, test } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("loads the demo vault with its folders, notes and outline", async ({ page }) => {
  const tree = page.locator(".tree");
  await expect(tree.locator('[data-kind="dir"]')).toHaveText(["Journal", "Projects", "Reading", "Templates"]);
  await expect(tree.locator('[data-kind="file"]')).toHaveText([
    "2026-11-03",
    "2026-11-04",
    "Editor design notes",
    "Roadmap",
    "Tauri vs Electron",
    "Reading list",
    "Daily note",
    "Inbox",
  ]);
  await expect(tree.locator(".tree-row.selected")).toHaveText("Editor design notes");
  await expect(page.locator(".outline-item")).toHaveText(["Editor design notes", "Principles", "Open questions", "Decoration plan"]);
  await expect(page.locator(".crumbs")).toContainText("Projects");
  await expect(page.locator(".vault-name")).toHaveText("Demo Vault");
});

test("switching notes in the sidebar keeps edits via autosave", async ({ page }) => {
  await clickLine(lastLine(page));
  await page.keyboard.type("remember me");
  await expect(page.locator(".save-state")).toHaveText("Saving…");
  await page.locator(".tree-row", { hasText: "Roadmap" }).click();
  await expect(page.locator(".crumb.current")).toContainText("Roadmap");
  // The caret starts on line 1, so the heading mark is revealed.
  await expect(page.locator(".cm-line.cm-md-h1")).toContainText("Roadmap");
  await page.locator(".tree-row", { hasText: "Editor design notes" }).click();
  await expect(page.locator(".crumb.current")).toContainText("Editor design notes");
  await expect.poll(() => docText(page)).toContain("remember me");
});

test("edits survive a reload", async ({ page }) => {
  await clickLine(lastLine(page));
  await page.keyboard.type("persisted edit");
  await page.waitForTimeout(800);
  await expect(page.locator(".save-state.visible")).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('.app[data-ready="true"]');
  await expect(page.locator(".crumb.current")).toContainText("Editor design notes");
  await expect.poll(() => docText(page)).toContain("persisted edit");
});

test("quick switcher opens a note by name", async ({ page }) => {
  await page.keyboard.press("Control+p");
  const dialog = page.getByRole("dialog", { name: "Quick switcher" });
  await expect(dialog).toBeVisible();
  await page.keyboard.type("road");
  await expect(dialog.locator(".palette-item.on .palette-title")).toHaveText("Roadmap");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".crumb.current")).toContainText("Roadmap");
  expect(await activePath(page)).toMatch(/\/Roadmap\.md$/);
  await expect(page.locator(".tree-row.selected")).toHaveText("Roadmap");
});

test("quick switcher closes with Escape and the sidebar search button opens it", async ({ page }) => {
  await page.getByRole("button", { name: "Search notes" }).click();
  const dialog = page.getByRole("dialog", { name: "Quick switcher" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".palette-item")).toHaveCount(8);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a new note opens with its title selected, and typing names it", async ({ page }) => {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect.poll(() => activePath(page)).toMatch(/\/Untitled\.md$/);
  await expect(page.locator(".rename-input")).toHaveCount(0);
  // The placeholder title is selected, so typing replaces it.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__margin!.store.getState().editor!.state;
        return s.sliceDoc(s.selection.main.from, s.selection.main.to);
      }),
    )
    .toBe("Untitled");
  await page.keyboard.type("My first note");
  await expect(page.locator(".cm-line.cm-md-h1")).toContainText("My first note");
  // After a pause the file follows the title, without reloading the editor.
  await expect.poll(() => activePath(page)).toMatch(/\/My first note\.md$/);
  await expect(page.locator(".tree-row.selected")).toHaveText("My first note");
  await expect(page.locator(".crumb.current")).toContainText("My first note");
  await page.keyboard.type("s");
  await expect(page.locator(".cm-line.cm-md-h1")).toContainText("My first notes");
  // Undo history survived the rename.
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-line.cm-md-h1")).not.toContainText("notes");
});

test("notes can be renamed and deleted from the context menu", async ({ page }) => {
  const row = page.locator(".tree-row", { hasText: "Tauri vs Electron" });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.locator(".rename-input");
  await expect(input).toBeFocused();
  await input.fill("Shell choice");
  await input.press("Enter");
  await expect(page.locator(".tree-row", { hasText: "Shell choice" })).toHaveCount(1);
  await expect(page.locator(".tree-row", { hasText: "Tauri vs Electron" })).toHaveCount(0);

  await page.locator(".tree-row", { hasText: "Shell choice" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete note" }).click();
  // Cancelling keeps the note.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete “Shell choice”?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".tree-row", { hasText: "Shell choice" })).toHaveCount(1);
  // Confirming deletes it and says so.
  await page.locator(".tree-row", { hasText: "Shell choice" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete note" }).click();
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tree-row", { hasText: "Shell choice" })).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Deleted “Shell choice”");
  // Deleting a non-active note leaves the active note alone.
  await expect(page.locator(".crumb.current")).toContainText("Editor design notes");
});

test("right-clicking another row while a menu is open opens that row's menu", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Roadmap" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Delete note" })).toBeVisible();
  // Straight away, while the first menu is still fading out.
  await page.locator('.tree-row[data-kind="dir"]', { hasText: "Journal" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Delete folder" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: "Delete folder" })).toBeVisible();
});

test("folders collapse and expand", async ({ page }) => {
  const journal = page.locator('.tree-row[data-kind="dir"]', { hasText: "Journal" });
  await expect(journal).toHaveAttribute("aria-expanded", "true");
  await journal.click();
  await expect(journal).toHaveAttribute("aria-expanded", "false");
  // Children stay mounted so they can animate; collapsed ones are hidden.
  await expect(page.locator(".tree-row", { hasText: "2026-11-04" })).toBeHidden();
  await expect(journal.locator(".tree-chevron")).not.toHaveClass(/open/);
  await journal.click();
  await expect(page.locator(".tree-row", { hasText: "2026-11-04" })).toBeVisible();
  await expect(journal.locator(".tree-chevron")).toHaveClass(/open/);
});
