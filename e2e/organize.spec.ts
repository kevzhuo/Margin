import { activePath, docText, expect, lineWithText, openApp, test } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("new folder, rename it, and drag a note into it", async ({ page }) => {
  await page.locator(".sidebar-head").hover();
  await page.getByRole("button", { name: "New folder" }).click();
  const input = page.locator(".rename-input");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("New folder");
  await input.fill("Archive");
  await input.press("Enter");
  const folder = page.locator('.tree-row[data-kind="dir"]', { hasText: "Archive" });
  await expect(folder).toHaveCount(1);

  // Drag the open note into the new folder.
  await page.locator(".tree-row", { hasText: "Editor design notes" }).dragTo(folder);
  await expect.poll(() => activePath(page)).toMatch(/\/Archive\/Editor design notes\.md$/);
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".crumbs")).toContainText("Archive");
  await expect(page.locator(".tree-row.selected")).toHaveText("Editor design notes");
});

test("dragging a folder into itself does nothing", async ({ page }) => {
  const projects = page.locator('.tree-row[data-kind="dir"]', { hasText: "Projects" });
  await projects.dragTo(page.locator(".tree-row", { hasText: "Roadmap" }));
  await expect(projects).toHaveCount(1);
  expect(await activePath(page)).toMatch(/\/Projects\/Editor design notes\.md$/);
});

test("dragging a note onto empty sidebar space moves it to the vault root", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Roadmap" }).dragTo(page.locator(".tree-spacer"));
  await expect(page.locator('.tree-row[data-path="/Demo Vault/Roadmap.md"]')).toHaveCount(1);
});

test("F2 renames the open note", async ({ page }) => {
  await page.locator(".section-label").first().click();
  await page.keyboard.press("F2");
  const input = page.locator(".rename-input");
  await expect(input).toBeFocused();
  await input.fill("Design notes");
  await input.press("Enter");
  await expect.poll(() => activePath(page)).toMatch(/\/Design notes\.md$/);
  await expect(page).toHaveTitle("Design notes — Margin");
});

test("renaming a note keeps links to it working", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Roadmap" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.locator(".rename-input");
  await input.fill("Plan");
  await input.press("Enter");
  await expect(page.locator(".toast", { hasText: "Updated links in 1 note" })).toBeVisible();

  // The inbox's link was rewritten, and following it opens the renamed note.
  await page.locator(".tree-row", { hasText: "Inbox" }).click();
  await expect.poll(() => docText(page)).toContain("[the roadmap](Projects/Plan.md#next)");
  await lineWithText(page, "Loose thoughts").click();
  await page.locator(".cm-md-link", { hasText: "the roadmap" }).click();
  await expect.poll(() => activePath(page)).toBe("/Demo Vault/Projects/Plan.md");
});

test("moving the open note to another folder rewrites its links, and undo leaves them", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Inbox" }).click();
  await expect.poll(() => activePath(page)).toBe("/Demo Vault/Inbox.md");
  await lineWithText(page, "Loose thoughts").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Typed.");

  await page.locator(".tree-row", { hasText: "Inbox" }).dragTo(page.locator('.tree-row[data-kind="dir"]', { hasText: "Journal" }));
  await expect.poll(() => activePath(page)).toBe("/Demo Vault/Journal/Inbox.md");
  await expect.poll(() => docText(page)).toContain("[the roadmap](../Projects/Roadmap.md#next)");

  // Undo takes back the typing, not the link that keeps working.
  await lineWithText(page, "Loose thoughts").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => docText(page)).not.toContain("Typed.");
  expect(await docText(page)).toContain("[the roadmap](../Projects/Roadmap.md#next)");
});

test("copy path shows a toast that dismisses itself", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Inbox" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy path" }).click();
  const toast = page.locator(".toast", { hasText: "Copied path" });
  await expect(toast).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("/Demo Vault/Inbox.md");
  await expect(toast).toHaveCount(0, { timeout: 6000 });
});

test("context menus support the keyboard", async ({ page }) => {
  await page.locator(".tree-row", { hasText: "Inbox" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Copy path" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rename-input")).toBeFocused();
});

test("the sidebar can be resized and reset", async ({ page }) => {
  const shell = page.locator(".sidebar-shell");
  const handle = page.locator(".sidebar-resizer");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 83, box.y + 300, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await shell.boundingBox())!.width)).toBe(320);
  await page.reload();
  await page.waitForSelector('.app[data-ready="true"]');
  await expect.poll(async () => Math.round((await shell.boundingBox())!.width)).toBe(320);
  await handle.dblclick();
  await expect.poll(async () => Math.round((await shell.boundingBox())!.width)).toBe(240);
});

test("sorting by last edited puts the note you just edited first, and the choice is remembered", async ({ page }) => {
  const projectRows = page.locator('.tree-row[data-kind="dir"]', { hasText: "Projects" }).locator("xpath=..").locator(".tree-children .tree-row");
  await expect(projectRows).toHaveText(["Editor design notes", "Roadmap", "Tauri vs Electron"]);

  await page.locator(".sidebar-head").hover();
  await page.getByRole("button", { name: /Sort notes/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Name" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Last edited" }).click();
  await expect(page.locator(".sidebar .section-label")).toHaveText("Files · Last edited");

  // Edit Roadmap: it moves to the top of its folder once saved.
  await page.locator(".tree-row", { hasText: "Roadmap" }).click();
  await page.evaluate(async () => {
    const st = window.__margin!.store.getState();
    st.editor!.dispatch({ changes: { from: st.editor!.state.doc.length, insert: "\nMore." } });
    await st.flushSave();
  });
  await expect(projectRows.first()).toHaveText("Roadmap");
  await expect(page.locator('.sidebar .tree > .tree-node > .tree-row').first()).toHaveText("Projects");

  await page.reload();
  await page.waitForSelector('.app[data-ready="true"]');
  await expect(page.locator(".sidebar .section-label")).toHaveText("Files · Last edited");
  await expect(projectRows.first()).toHaveText("Roadmap");

  // Back to name order.
  await page.locator(".sidebar-head").hover();
  await page.getByRole("button", { name: /Sort notes/ }).click();
  await page.getByRole("menuitemradio", { name: "Name" }).click();
  await expect(projectRows).toHaveText(["Editor design notes", "Roadmap", "Tauri vs Electron"]);
  await expect(page.locator(".sidebar .section-label")).toHaveText("Files");
});
