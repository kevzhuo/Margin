import { blurEditor, docText, expect, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

const DOC = `# Math

Einstein wrote $E = mc^2$ in 1905. Prices like $5 and $10 stay text.

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

Broken: $\\frac{a}{$ here.
`;

async function openNote(page: Page, doc: string) {
  await page.evaluate(async (text) => {
    await window.__margin!.store.getState().createNote(undefined, "Math");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, doc);
  await blurEditor(page);
}

const caret = (page: Page) => page.evaluate(() => window.__margin!.store.getState().editor!.state.selection.main.head);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("inline and block math render; prices stay text", async ({ page }) => {
  await openNote(page, DOC);
  const inline = page.locator(".cm-md-math-inline .katex");
  await expect(inline).toHaveCount(1);
  await expect(page.locator(".cm-md-math-block .katex-display")).toHaveCount(1);
  await expect(page.locator(".cm-line", { hasText: "Prices like $5 and $10 stay text." })).toBeVisible();
  // The rendered fraction, not its TeX.
  await expect(page.locator(".cm-md-math-block .mfrac")).toHaveCount(1);
});

test("clicking inline math shows its source with the caret inside", async ({ page }) => {
  await openNote(page, DOC);
  // Click the drawn formula: KaTeX also includes a 1px hidden MathML copy
  // for screen readers, which Playwright would otherwise aim at.
  await page.locator(".cm-md-math-inline .katex-html").first().click();
  await expect(page.locator(".cm-md-math-src")).toHaveText("$E = mc^2$");
  const doc = await docText(page);
  const at = await caret(page);
  expect(at).toBeGreaterThan(doc.indexOf("$E"));
  expect(at).toBeLessThan(doc.indexOf("mc^2$") + 5);
  // Leaving renders it again.
  await blurEditor(page);
  await expect(page.locator(".cm-md-math-src")).toHaveCount(0);
});

test("clicking a formula shows its source, with a preview that follows your typing", async ({ page }) => {
  await openNote(page, DOC);
  await page.locator(".cm-md-math-block .katex-html").click();
  await expect(page.locator(".cm-md-math-line")).toHaveCount(3);
  const preview = page.locator(".cm-md-math-preview");
  await expect(preview.locator(".mfrac")).toHaveCount(1);
  await page.keyboard.type(" + \\sqrt{2}");
  await expect(preview.locator(".sqrt")).toHaveCount(1);
  expect(await docText(page)).toContain("\\frac{1}{3} + \\sqrt{2}\n$$");
});

test("a formula with a mistake shows its source in red, with the reason", async ({ page }) => {
  await openNote(page, DOC);
  const broken = page.locator(".cm-md-math-error");
  await expect(broken).toHaveText("\\frac{a}{");
  expect(await broken.getAttribute("title")).toMatch(/expected|end of input/i);
  await expect(broken).toHaveCSS("color", /rgb\(/);
});

test("/math adds a block and puts the caret in it", async ({ page }) => {
  await openNote(page, "# Math\n\n");
  await page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });
  await page.keyboard.type("/math");
  await expect(page.locator(".cm-tooltip-autocomplete li[aria-selected] .cm-completionMatchedText")).toHaveText("Math");
  await page.waitForTimeout(150); // CodeMirror's interactionDelay
  await page.keyboard.press("Enter");
  await page.keyboard.type("a^2 + b^2 = c^2");
  expect(await docText(page)).toBe("# Math\n\n$$\na^2 + b^2 = c^2\n$$");
  await expect(page.locator(".cm-md-math-preview .katex")).toHaveCount(1);
  await blurEditor(page);
  await expect(page.locator(".cm-md-math-block .katex")).toHaveCount(1);
});

test("typing $ around a selection makes it inline math", async ({ page }) => {
  await openNote(page, "Area is pi r^2.\n");
  await page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    const from = view.state.doc.toString().indexOf("pi r^2");
    view.dispatch({ selection: { anchor: from, head: from + 6 } });
    view.focus();
  });
  await page.keyboard.type("$");
  expect(await docText(page)).toBe("Area is $pi r^2$.\n");
  await blurEditor(page);
  await expect(page.locator(".cm-md-math-inline .katex")).toHaveCount(1);
});

test("typing stays fast in a long note full of formulas", async ({ page }) => {
  const section = (i: number) => `## Section ${i}\n\nThe value $x_${i}^2 + \\frac{${i}}{2}$ appears inline, and so does $\\sum_{k=1}^{${i}} k$.\n\n$$\n\\int_0^{${i}} e^{-x^2}\\,dx\n$$\n`;
  await openNote(page, Array.from({ length: 300 }, (_, i) => section(i + 1)).join("\n"));
  const median = await page.evaluate(async () => {
    const view = window.__margin!.store.getState().editor!;
    const at = view.state.doc.toString().indexOf("appears inline", Math.floor(view.state.doc.length / 2));
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    view.focus();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
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
  // Same bound as plain text: formulas are cached and only visible lines render.
  expect(median).toBeLessThan(10);
});
