import { blurEditor, expect, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

// Headless Chromium hides scrollbars by default; these tests press real ones.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] }, viewport: { width: 1400, height: 700 } });

const URL = "https://www.keychron.com/collections/keychron-he-keyboards/products/keychron-k8-he-wireless-magnetic-switch";
const FILLER = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of filler text.`).join("\n\n");

async function loadDoc(page: Page, doc: string) {
  await page.evaluate(async (text) => {
    await window.__margin!.store.getState().createNote(undefined, "Scrollbars");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, doc);
  await blurEditor(page);
}

function placeCaret(page: Page, text: string) {
  return page.evaluate((t) => {
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(t) + 3 } });
    view.focus();
    return view.state.selection.main.head;
  }, text);
}

const editorState = (page: Page) =>
  page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    const scroller = view.scrollDOM;
    return {
      focused: view.hasFocus && view.dom.classList.contains("cm-focused"),
      head: view.state.selection.main.head,
      revealed: !!document.querySelector(".cm-md-url"),
      scrollTop: scroller.scrollTop,
      scrollLeft: scroller.scrollLeft,
    };
  });

async function scrollerBox(page: Page) {
  return (await page.locator(".cm-scroller").boundingBox())!;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("dragging the vertical scrollbar keeps the caret and the revealed link", async ({ page }) => {
  await loadDoc(page, `- [Keyboard](${URL})\n\n${FILLER}\n`);
  const head = await placeCaret(page, "Keyboard");
  await expect(page.locator(".cm-md-url")).toBeVisible();
  const box = await scrollerBox(page);
  const x = box.x + box.width - 6;
  await page.mouse.move(x, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 50, { steps: 4 });
  await page.waitForTimeout(100); // longer than CodeMirror's focus-change timer
  const during = await editorState(page);
  await page.mouse.up();
  expect(during.focused).toBe(true);
  expect(during.head).toBe(head);
  expect(during.revealed).toBe(true);
  expect(during.scrollTop).toBeGreaterThan(0);
});

test("pressing the horizontal scrollbar keeps the caret", async ({ page }) => {
  await loadDoc(page, `- [Keyboard](${URL})\n\nA short line.\n`);
  // Nothing in a note scrolls sideways any more, so force it to.
  await page.addStyleTag({ content: ".cm-line:last-child { width: 4000px; }" });
  const head = await placeCaret(page, "Keyboard");
  const box = await scrollerBox(page);
  await expect.poll(() => page.locator(".cm-scroller").evaluate((el: HTMLElement) => el.offsetHeight - el.clientHeight)).toBeGreaterThan(0);
  const y = box.y + box.height - 6;
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, y, { steps: 4 });
  await page.waitForTimeout(100);
  const during = await editorState(page);
  await page.mouse.up();
  expect(during.focused).toBe(true);
  expect(during.head).toBe(head);
  expect(during.revealed).toBe(true);
  expect(during.scrollLeft).toBeGreaterThan(0);
});

test("pressing beside the text column puts the caret on that line", async ({ page }) => {
  await loadDoc(page, "First line of text.\n\nSecond line of text.\n\nThird line of text.\n");
  await blurEditor(page);
  const box = await scrollerBox(page);
  const content = (await page.locator(".cm-content").boundingBox())!;
  expect(box.x + box.width - (content.x + content.width)).toBeGreaterThan(40);
  expect(content.x - box.x).toBeGreaterThan(40);
  for (const [text, side] of [["Second line", "right"], ["Third line", "left"]] as const) {
    const line = (await page.locator(".cm-line", { hasText: text }).boundingBox())!;
    const x = side === "right" ? box.x + box.width - 30 : content.x - 20;
    await page.mouse.click(x, line.y + line.height / 2);
    const state = await page.evaluate(() => {
      const view = window.__margin!.store.getState().editor!;
      return { focused: view.hasFocus, line: view.state.doc.lineAt(view.state.selection.main.head).text };
    });
    expect(state.focused).toBe(true);
    expect(state.line).toContain(text);
  }
});

test("scrolling a wide table leaves it rendered", async ({ page }) => {
  const cols = Array.from({ length: 14 }, (_, i) => `Column ${i + 1}`);
  const table = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n| ${cols.map((c) => `${c} value`).join(" | ")} |`;
  await loadDoc(page, `Intro paragraph.\n\n${table}\n\nAfter the table.\n`);
  await placeCaret(page, "Intro");
  const wrap = page.locator(".cm-md-table");
  await expect(wrap).toBeVisible();
  const box = (await wrap.boundingBox())!;
  expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const y = box.y + box.height - 5;
  await page.mouse.move(box.x + 30, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await expect(wrap).toBeVisible();
  expect(await page.evaluate(() => window.__margin!.store.getState().editor!.state.doc.lineAt(window.__margin!.store.getState().editor!.state.selection.main.head).text)).toBe("Intro paragraph.");
});
