import { activePath, docText, expect, openApp, test } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__margin!.store.getState().closeVault());
});

test("the welcome screen offers open, create and recent vaults, without idle panels", async ({ page }) => {
  await expect(page.locator(".welcome h1")).toHaveText("Margin");
  expect(await page.locator(".welcome-icon").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole("button", { name: "Open folder…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a vault…" })).toBeVisible();
  await expect(page.locator(".welcome-vault")).toHaveText(/Demo Vault/);
  // Nothing for the panels or top bar buttons to do yet.
  await expect(page.locator(".outline-shell")).toHaveAttribute("data-open", "false");
  await expect(page.locator(".sidebar-shell")).toHaveAttribute("data-open", "false");
  await expect(page.locator(".topbar button")).toHaveCount(0);
});

test("a recent vault opens in one click, and can be removed from the list", async ({ page }) => {
  await page.locator(".welcome-vault", { hasText: "Demo Vault" }).click();
  await expect(page.locator(".tree-row", { hasText: "Roadmap" })).toBeVisible();
  await page.evaluate(() => window.__margin!.store.getState().closeVault());
  await page.locator(".welcome-recent li").hover();
  await page.getByRole("button", { name: "Remove Demo Vault from recent vaults" }).click();
  await expect(page.locator(".welcome-recent")).toHaveCount(0);
});

test("creating a vault opens it with a first note ready to name", async ({ page }) => {
  await page.getByRole("button", { name: "Create a vault…" }).click();
  await expect.poll(() => activePath(page)).toBe("/New vault/Untitled.md");
  await expect(page.locator(".vault-name")).toHaveText("New vault");
  await page.keyboard.type("First thoughts");
  await expect.poll(() => docText(page)).toBe("# First thoughts\n\n");
});
