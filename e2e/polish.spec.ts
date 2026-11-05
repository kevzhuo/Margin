import { activePath, blurEditor, caretPos, expect, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

async function longNote(page: Page, sections = 120) {
  const doc = Array.from({ length: sections }, (_, i) => `## Section ${i}\n\nParagraph ${i} with **bold** and a [link](https://example.com).\n\n- item\n- [ ] task\n`).join("\n");
  await page.evaluate(async (text) => {
    await window.__margin!.store.getState().createNote(undefined, "Long note");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, doc);
  return doc;
}

test.describe("polish", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("jumps from the outline land exactly and highlight the heading, even far down a long note", async ({ page }) => {
    await longNote(page);
    await expect(page.locator(".outline-item")).toHaveCount(120);
    for (const n of [97, 15]) {
      const item = page.locator(".outline-item", { hasText: new RegExp(`^Section ${n}$`) });
      await item.scrollIntoViewIfNeeded();
      await item.click();
      const line = page.locator(".cm-line.cm-md-h2", { hasText: new RegExp(`Section ${n}$`) });
      await expect(line).toHaveClass(/cm-md-flash/);
      await expect
        .poll(async () => {
          const top = (await line.boundingBox())?.y ?? -1;
          const scroller = (await page.locator(".cm-scroller").boundingBox())!.y;
          return Math.round(top - scroller);
        })
        .toBeLessThan(80);
      // The highlight fades and is removed.
      await expect(line).not.toHaveClass(/cm-md-flash/, { timeout: 3000 });
    }
  });

  test("scrolling away right after a jump is not undone", async ({ page }) => {
    await page.locator(".outline-item", { hasText: "Decoration plan" }).click();
    const scroller = page.locator(".cm-scroller");
    // Move the view somewhere else while the glide is under way (as a link,
    // scrollbar drag or keyboard scroll would). The glide's final correction
    // must not drag it back to the heading.
    await page.waitForTimeout(100);
    await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(1200);
    // The heading sits about 600px down; a snap-back would land there. A little
    // residual movement from the interrupted glide is fine.
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(200);
  });

  test("search results highlight the match they jump to", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await page.keyboard.type("IME composition");
    await expect(page.locator(".palette-item.kind-hit")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.locator(".cm-line.cm-md-flash")).toContainText("IME composition");
  });

  test("a hairline appears under the top bar once the note scrolls", async ({ page }) => {
    const topbar = page.locator(".topbar");
    await expect(page.locator("html")).not.toHaveClass(/editor-scrolled/);
    await page.locator(".cm-scroller").evaluate((el) => el.scrollTo({ top: 300 }));
    await expect(page.locator("html")).toHaveClass(/editor-scrolled/);
    await expect.poll(() => topbar.evaluate((el) => getComputedStyle(el).boxShadow)).not.toContain("rgba(0, 0, 0, 0)");
    await page.locator(".cm-scroller").evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(page.locator("html")).not.toHaveClass(/editor-scrolled/);
  });

  test("the caret is accent-coloured, fades, and can glide", async ({ page }) => {
    await page.locator(".cm-content").click({ position: { x: 60, y: 120 } });
    const layer = page.locator(".cm-cursorLayer");
    await expect(layer).toHaveCSS("animation-name", /caret-fade-[ab]/);
    const cursor = page.locator(".cm-cursor").first();
    await expect(cursor).toHaveCSS("border-left-color", "rgb(35, 131, 226)");
    await expect(cursor).toHaveCSS("transition-property", "all");
    await page.evaluate(() => window.__margin!.store.getState().setSmoothCaret(true));
    await expect(cursor).toHaveCSS("transition-property", "left, top, height");
    // Moving the caret restarts the blink (CodeMirror swaps the animation name).
    const before = await layer.evaluate((el) => getComputedStyle(el).animationName);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => layer.evaluate((el) => getComputedStyle(el).animationName)).not.toBe(before);
  });

  test("the saved theme is applied before the app's code runs", async ({ page }) => {
    // Plant the setting before any page script runs (the open app re-saves its own on unload).
    await page.addInitScript(() => localStorage.setItem("margin.settings.v1", JSON.stringify({ theme: "dark" })));
    // Hold back the app bundle to see the first frame on its own.
    await page.route("**/src/main.tsx", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    // Look as soon as the page starts parsing, while the app bundle is still held back.
    await page.reload({ waitUntil: "commit" });
    await page.waitForFunction(() => !!document.documentElement.dataset.theme && !!document.body);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe("rgb(25, 25, 25)");
    expect(await page.locator(".app").count()).toBe(0);
    await page.waitForSelector('.app[data-ready="true"]');
  });

  test("typing stays fast in a long note", async ({ page }) => {
    await longNote(page, 300);
    const median = await page.evaluate(async () => {
      const view = window.__margin!.store.getState().editor!;
      view.dispatch({ selection: { anchor: Math.floor(view.state.doc.length / 2) } });
      view.focus();
      const times: number[] = [];
      for (let i = 0; i < 25; i++) {
        const t0 = performance.now();
        const pos = view.state.selection.main.head;
        view.dispatch({ changes: { from: pos, insert: "a" }, selection: { anchor: pos + 1 }, userEvent: "input.type" });
        times.push(performance.now() - t0);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      times.sort((a, b) => a - b);
      return times[12];
    });
    // Generous bound: before this change the median was about 19 ms on a fast machine.
    expect(median).toBeLessThan(10);
  });

  test("decorations only cover the visible part of a long note", async ({ page }) => {
    await longNote(page, 300);
    await blurEditor(page);
    const rendered = await page.locator(".cm-line").count();
    const total = await page.evaluate(() => window.__margin!.store.getState().editor!.state.doc.lines);
    expect(total).toBeGreaterThan(2000);
    expect(rendered).toBeLessThan(total / 5);
  });
});

test.describe("trackpad swipes", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.locator(".tree-row", { hasText: "Roadmap" }).click();
    await expect.poll(() => activePath(page)).toMatch(/Roadmap\.md$/);
  });

  const swipe = async (page: Page, dx: number, steps = 6) => {
    const box = (await page.locator(".cm-scroller").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < steps; i++) await page.mouse.wheel(dx / steps, 0);
  };

  test("swiping right goes back, swiping left goes forward", async ({ page }) => {
    await swipe(page, -240);
    await expect(page.locator(".swipe-indicator.back")).toHaveAttribute("data-armed", "true");
    await expect.poll(() => activePath(page)).toMatch(/Editor design notes\.md$/);
    await expect(page.locator(".swipe-indicator.back")).toHaveAttribute("data-armed", "false");
    await page.waitForTimeout(500);
    await swipe(page, 240);
    await expect.poll(() => activePath(page)).toMatch(/Roadmap\.md$/);
  });

  test("a short swipe or vertical scrolling does nothing", async ({ page }) => {
    await swipe(page, -60);
    await page.waitForTimeout(400);
    expect(await activePath(page)).toMatch(/Roadmap\.md$/);
    const box = (await page.locator(".cm-scroller").boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 100);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(-30, 120);
    await page.waitForTimeout(400);
    expect(await activePath(page)).toMatch(/Roadmap\.md$/);
    expect(await caretPos(page)).toBeGreaterThanOrEqual(0);
  });
});
