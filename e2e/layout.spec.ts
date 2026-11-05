import { activePath, blurEditor, expect, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

const LIST_DOC = `# Layout check

- A top-level bullet whose text is long enough to wrap onto a second line in a narrow window
  - A nested bullet that also wraps onto another line so the hanging indent is visible
- Back to the top level

1. First numbered item, which is long enough to wrap and should align under its text
10. Tenth item keeps the same text column

- [ ] An unfinished task that wraps onto a second line to check the checkbox indent

#### Fourth-level heading
`;

async function loadDoc(page: Page, doc: string) {
  await page.evaluate(async (text) => {
    await window.__margin!.store.getState().createNote(undefined, "Layout check");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, doc);
  await blurEditor(page);
}

/** Horizontal geometry of a list line: where its text starts, and where each visual row starts. */
function lineGeometry(page: Page, startsWith: string) {
  return page.evaluate((prefix) => {
    const line = [...document.querySelectorAll<HTMLElement>(".cm-line")].find((l) => (l.textContent ?? "").replace(/^[-\d.\s[\]x]+/, "").startsWith(prefix))!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let text: Text | null = null;
    while ((node = walker.nextNode())) {
      if ((node.parentElement as Element).closest(".cm-md-listmark, .cm-md-olmark, .cm-md-ghost")) continue;
      if (node.textContent!.trim()) {
        text = node as Text;
        break;
      }
    }
    const r = document.createRange();
    r.setStart(text!, 0);
    r.setEnd(text!, text!.length);
    const rows = [...r.getClientRects()].map((rect) => Math.round(rect.left));
    return { textLeft: rows[0], rows };
  }, startsWith);
}

const hOverflow = (page: Page) => page.locator(".cm-scroller").evaluate((el) => el.scrollWidth - el.clientWidth);
const textWidth = (page: Page) =>
  page.locator(".cm-content").evaluate((el) => {
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  });

test.describe("in a small window", () => {
  test.use({ viewport: { width: 720, height: 600 } });

  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("the outline steps aside so the editor keeps a usable width", async ({ page }) => {
    await expect(page.locator(".outline-shell")).toHaveAttribute("data-open", "false");
    const main = (await page.locator(".main").boundingBox())!;
    expect(main.width).toBeGreaterThanOrEqual(470);
    expect(await textWidth(page)).toBeGreaterThanOrEqual(380);
    // The saved preference is untouched, so a wider window shows it again.
    expect(await page.evaluate(() => window.__margin!.store.getState().outlineOpen)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator(".outline-shell")).toHaveAttribute("data-open", "true");
    await expect(page.locator(".outline-shell")).not.toHaveAttribute("data-overlay", /.*/);
  });

  test("the outline opens over the editor instead of squeezing it", async ({ page }) => {
    const before = (await page.locator(".main").boundingBox())!.width;
    await page.getByRole("button", { name: "Toggle outline panel" }).click();
    const outline = page.locator(".outline-shell");
    await expect(outline).toHaveAttribute("data-open", "true");
    await expect(outline).toHaveAttribute("data-overlay", "true");
    await expect(page.locator(".outline")).toBeVisible();
    expect((await page.locator(".main").boundingBox())!.width).toBe(before);
    // Picking a heading closes the overlay and jumps there.
    await page.locator(".outline-item", { hasText: "Open questions" }).click();
    await expect(outline).toHaveAttribute("data-open", "false");
    // Escape closes it too.
    await page.getByRole("button", { name: "Toggle outline panel" }).click();
    await expect(outline).toHaveAttribute("data-open", "true");
    await page.keyboard.press("Escape");
    await expect(outline).toHaveAttribute("data-open", "false");
  });

  test("nothing runs off the side, even with the caret in a table or code", async ({ page }) => {
    expect(await hOverflow(page)).toBe(0);
    for (const needle of ["| Node |", "ranges.push"]) {
      await page.evaluate((n) => {
        const view = window.__margin!.store.getState().editor!;
        view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(n) + 3 }, scrollIntoView: true });
        view.focus();
      }, needle);
      if (needle.startsWith("|")) await expect(page.locator(".cm-md-table-raw").first()).toBeAttached();
      else await expect(page.locator(".cm-md-fence-active").first()).toBeAttached();
      expect(await hOverflow(page)).toBe(0);
    }
  });

  test("the breadcrumb keeps the note's name readable", async ({ page }) => {
    const name = page.locator(".crumb.current .crumb-text");
    await expect(name).toHaveText("Editor design notes");
    expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test("heading marks fit inside the narrowest gutter", async ({ page }) => {
    await loadDoc(page, LIST_DOC);
    const scrollerLeft = (await page.locator(".cm-scroller").boundingBox())!.x;
    for (const text of ["Layout check", "Fourth-level heading"]) {
      await page.evaluate((t) => {
        const view = window.__margin!.store.getState().editor!;
        view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(t) + 2 }, scrollIntoView: true });
        view.focus();
      }, text);
      const mark = page.locator(".cm-line", { hasText: text }).locator(".cm-md-margin-mark");
      await expect(mark).toBeVisible();
      expect((await mark.boundingBox())!.x).toBeGreaterThanOrEqual(scrollerLeft);
    }
  });

  test("wrapped list lines hang under their text, and nesting indents", async ({ page }) => {
    await loadDoc(page, LIST_DOC);
    const top = await lineGeometry(page, "A top-level bullet");
    const nested = await lineGeometry(page, "A nested bullet");
    const numbered = await lineGeometry(page, "First numbered item");
    const tenth = await lineGeometry(page, "Tenth item");
    const task = await lineGeometry(page, "An unfinished task");
    for (const g of [top, nested, numbered, task]) {
      expect(g.rows.length).toBeGreaterThan(1);
      for (const left of g.rows.slice(1)) expect(Math.abs(left - g.textLeft)).toBeLessThanOrEqual(1);
    }
    expect(nested.textLeft - top.textLeft).toBeGreaterThanOrEqual(20);
    expect(Math.abs(tenth.textLeft - numbered.textLeft)).toBeLessThanOrEqual(1);
  });

  test("the word count hides while typing and never covers text", async ({ page }) => {
    const status = page.locator(".statusbar");
    await expect(status).toHaveCSS("opacity", "1");
    await expect(page.locator(".status-pill")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.evaluate(() => {
      const view = window.__margin!.store.getState().editor!;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });
    await page.keyboard.type(" more");
    await expect(page.locator("html")).toHaveClass(/is-typing/);
    await expect.poll(() => status.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.1);
    await expect(page.locator("html")).not.toHaveClass(/is-typing/, { timeout: 3000 });
    await expect(status).toHaveCSS("opacity", "1");
  });
});

test.describe("full width", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("toggles between a centered column and the whole editor area", async ({ page }) => {
    await openApp(page);
    expect(Math.round(await textWidth(page))).toBe(720);
    const toggle = page.getByRole("button", { name: "Full width" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => textWidth(page)).toBeGreaterThan(950);
    // Comfortable gutters remain.
    const gutter = await page.locator(".cm-content").evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(gutter).toBeGreaterThanOrEqual(40);

    // The setting survives a reload and shows in Settings, where line width is disabled.
    await page.reload();
    await page.waitForSelector('.app[data-ready="true"]');
    await expect.poll(() => textWidth(page)).toBeGreaterThan(950);
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("switch", { name: "Full width" })).toBeChecked();
    await expect(settings.getByRole("radio", { name: "Narrow" })).toBeDisabled();
    await settings.getByRole("switch", { name: "Full width" }).click();
    await expect.poll(async () => Math.round(await textWidth(page))).toBe(720);
    await expect(settings.getByRole("radio", { name: "Narrow" })).toBeEnabled();
  });

  test("is available from the command palette", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.type("full width");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Full width" })).toHaveAttribute("aria-pressed", "true");
    expect(await activePath(page)).toMatch(/Editor design notes\.md$/);
  });
});

test("blank lines between blocks are shorter than lines of text", async ({ page }) => {
  await openApp(page);
  await blurEditor(page);
  const heights = await page.evaluate(() => {
    const blank = document.querySelector<HTMLElement>(".cm-line.cm-md-blank")!;
    // A single-row list item has the same padding and line height as a paragraph.
    const text = [...document.querySelectorAll<HTMLElement>(".cm-line.cm-md-li")].find((l) => l.getBoundingClientRect().height < 40)!;
    return { blank: blank.getBoundingClientRect().height, text: text.getBoundingClientRect().height };
  });
  expect(heights.blank).toBeLessThan(heights.text * 0.8);
});
