import { expect, openApp, test } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

const theme = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.dataset.theme);

test("theme button cycles system, light, dark", async ({ page }) => {
  const button = page.getByRole("button", { name: /^Theme:/ });
  await expect(button).toHaveAttribute("aria-label", "Theme: follows system");
  expect(await theme(page)).toBe("light");
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Theme: light");
  expect(await theme(page)).toBe("light");
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Theme: dark");
  await expect.poll(() => theme(page)).toBe("dark");
  // Colors crossfade briefly; the background settles on the dark value.
  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector(".cm-editor")!).backgroundColor);
  await expect.poll(bg).toBe("rgb(25, 25, 25)");
  await expect(page.locator("html")).not.toHaveClass(/theme-transition/);
  await page.reload();
  await page.waitForSelector('.app[data-ready="true"]');
  await expect.poll(() => theme(page)).toBe("dark");
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Theme: follows system");
  await expect.poll(() => theme(page)).toBe("light");
});

test("dark mode follows the system preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => theme(page)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
});

test("sidebar and outline panels toggle from the top bar and keyboard", async ({ page }) => {
  // Panels stay mounted and animate their width; closed ones are hidden and inert.
  const sidebar = page.locator(".sidebar-shell");
  const outline = page.locator(".outline-shell");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(sidebar).toHaveAttribute("data-open", "false");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(240);

  await expect(page.locator(".outline")).toBeVisible();
  await page.getByRole("button", { name: "Toggle outline panel" }).click();
  await expect(page.locator(".outline")).toBeHidden();
  await expect(outline).toHaveAttribute("inert", "");
  await page.keyboard.press("Control+Shift+\\");
  await expect(page.locator(".outline")).toBeVisible();
  await page.keyboard.press("Control+\\");
  await expect(page.locator(".sidebar")).toBeHidden();
});

test("word count and breadcrumb reflect the open note", async ({ page }) => {
  await expect(page.locator(".word-count")).toHaveText(/^\d+ words$/);
  await expect(page.locator(".crumbs .crumb")).toHaveText(["Projects/", "Editor design notes"]);
});
