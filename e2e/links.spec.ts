import { blurEditor, expect, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

const URL = "https://www.keychron.com/collections/keychron-he-keyboards/products/keychron-k8-he-wireless-magnetic-switch-custom-keyboard-all-wood-sakura-edition?variant=1234567890";
const LONG = "Pneumonoultramicroscopicsilicovolcanoconiosis".repeat(4);

/** Long, unbreakable content in every place it can appear, keyed by text to put the caret in. */
const CASES: Record<string, string> = {
  "Link in a list": `- [Link in a list](${URL})`,
  "Link in a paragraph": `Some text then [Link in a paragraph](${URL}) and more.`,
  "Link in a quote": `> [Link in a quote](${URL})`,
  "Link with a title": `[Link with a title](${URL} "${LONG}")`,
  "Image source": `![Image source](${URL}.png)`,
  "keychron.com/collections": `<${URL}>`,
  "www.keychron.com": URL,
  "ref-definition": `[ref-definition]: ${URL}`,
  [LONG.slice(0, 20)]: `Code: \`${LONG}\``,
  "Heading": `## Heading ${LONG}`,
};

async function loadDoc(page: Page, doc: string) {
  await page.evaluate(async (text) => {
    await window.__margin!.store.getState().createNote(undefined, "Long links");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, doc);
  await blurEditor(page);
}

function placeCaret(page: Page, text: string) {
  return page.evaluate((t) => {
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(t) + 3 }, scrollIntoView: true });
    view.focus();
  }, text);
}

const overflow = (page: Page) =>
  page.locator(".cm-scroller").evaluate((el) => el.scrollWidth - el.clientWidth);

for (const width of [720, 1100]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 700 } });

    test("revealed long URLs and words wrap instead of running off the page", async ({ page }) => {
      await openApp(page);
      await loadDoc(page, Object.values(CASES).join("\n\n") + "\n");
      for (const key of Object.keys(CASES)) {
        await placeCaret(page, key);
        await expect.poll(() => overflow(page), { message: key }).toBe(0);
      }
    });
  });
}

test("a revealed URL starts right after its link text and hangs under it", async ({ page }) => {
  await openApp(page);
  await loadDoc(page, CASES["Link in a list"] + "\n");
  await placeCaret(page, "Link in a list");
  const url = page.locator(".cm-md-url");
  await expect(url).toBeVisible();
  const geometry = await page.evaluate(() => {
    const syntax = [...document.querySelectorAll(".cm-md-link-syntax")];
    const open = syntax.find((el) => el.textContent === "[")!.getBoundingClientRect();
    const paren = syntax.find((el) => el.textContent === "(")!.getBoundingClientRect();
    const rows = [...document.querySelector(".cm-md-url")!.getClientRects()];
    return { textLeft: open.left, parenTop: paren.top, rows: rows.map((r) => ({ top: r.top, left: r.left })) };
  });
  // "(" and the URL stay on the link text's row instead of jumping to a new line.
  expect(Math.abs(geometry.rows[0].top - geometry.parenTop)).toBeLessThan(2);
  // The URL's wrapped rows hang under the item's text, not under its bullet.
  expect(geometry.rows.length).toBeGreaterThan(1);
  for (const row of geometry.rows.slice(1)) expect(Math.abs(row.left - geometry.textLeft)).toBeLessThan(2);
});
