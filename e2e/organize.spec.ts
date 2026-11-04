import { activePath, expect, openApp, test } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("new folder, rename it, and drag a note into it", async ({ page }) => {
  await page.locator(".sidebar-body").hover();
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
