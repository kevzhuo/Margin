import { blurEditor, docText, expect, openApp, test } from "./helpers";
import type { Page } from "@playwright/test";

/** A 1×1 PNG, for the file picker. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function openNote(page: Page, doc: string) {
  await page.evaluate(async (text) => {
    await window.__margin!.store.getState().createNote("/Demo Vault/Projects", "Photos");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, doc);
}

function placeCaret(page: Page, text: string, offset = 0) {
  return page.evaluate(
    ({ t, o }) => {
      const view = window.__margin!.store.getState().editor!;
      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(t) + o } });
      view.focus();
    },
    { t: text, o: offset },
  );
}

/**
 * Paste or drop a generated PNG of the given size. Drops land at (x, y), on
 * whatever element is there, the way a real drop would.
 */
function sendImage(page: Page, how: "paste" | "drop", name: string, size: [number, number], at?: { x: number; y: number }) {
  return page.evaluate(
    async ({ how, name, size, at }) => {
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = size;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#4a90d9";
      ctx.fillRect(0, 0, size[0], size[1]);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], name, { type: "image/png" }));
      const view = window.__margin!.store.getState().editor!;
      if (how === "paste") {
        view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        return;
      }
      const target = document.elementFromPoint(at!.x, at!.y)!;
      const init = { dataTransfer: data, clientX: at!.x, clientY: at!.y, bubbles: true, cancelable: true };
      target.dispatchEvent(new DragEvent("dragover", init));
      target.dispatchEvent(new DragEvent("drop", init));
    },
    { how, name, size, at },
  );
}

const renderedSizes = (page: Page) =>
  page.locator(".cm-md-image:not(.cm-md-image-preview) img").evaluateAll((imgs) => imgs.map((i) => `${(i as HTMLImageElement).naturalWidth}x${(i as HTMLImageElement).naturalHeight}`));

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("a pasted screenshot is saved to attachments and shown", async ({ page }) => {
  await openNote(page, "# Photos\n\nFirst paragraph.\n\nSecond paragraph.\n");
  await placeCaret(page, "First paragraph.", 16);
  await sendImage(page, "paste", "image.png", [320, 180]);
  await expect.poll(() => docText(page)).toMatch(
    /^# Photos\n\nFirst paragraph\.\n!\[\]\(\.\.\/attachments\/Pasted%20image%20\d{4}-\d\d-\d\d%20at%20\d\d\.\d\d\.\d\d\.png\)\n\nSecond paragraph\.\n$/,
  );
  await blurEditor(page);
  await expect.poll(() => renderedSizes(page)).toEqual(["320x180"]);
});

test("a dropped photo goes after the line it lands on, without splitting it", async ({ page }) => {
  await openNote(page, "# Photos\n\nA sentence that should stay whole.\n\nEnd.\n");
  await blurEditor(page);
  const line = (await page.locator(".cm-line", { hasText: "A sentence" }).boundingBox())!;
  await sendImage(page, "drop", "Sunset photo.png", [240, 160], { x: line.x + 60, y: line.y + line.height / 2 });
  await expect.poll(() => docText(page)).toBe("# Photos\n\nA sentence that should stay whole.\n![Sunset photo](../attachments/Sunset%20photo.png)\n\nEnd.\n");
  await blurEditor(page);
  await expect.poll(() => renderedSizes(page)).toEqual(["240x160"]);
  // The attachments folder stays out of the sidebar.
  await expect(page.locator(".tree-row", { hasText: "attachments" })).toHaveCount(0);
});

test("dropping the same name twice keeps both images", async ({ page }) => {
  await openNote(page, "# Photos\n\n");
  for (let i = 0; i < 2; i++) {
    await placeCaret(page, "# Photos", 8);
    await sendImage(page, "paste", "IMG_2041.png", [10, 10]);
  }
  await expect.poll(() => docText(page)).toContain("../attachments/IMG_2041%202.png");
  expect(await docText(page)).toContain("../attachments/IMG_2041.png");
});

test("/image opens the file picker and adds the chosen images", async ({ page }) => {
  await openNote(page, "# Photos\n\n");
  // Listen for the picker well before it opens: Playwright starts catching
  // file choosers asynchronously, and one that opens first is missed.
  const chooser = page.waitForEvent("filechooser");
  await placeCaret(page, "# Photos", 8);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/image");
  // Wait for the menu to match the whole word, then past CodeMirror's
  // interactionDelay (75 ms), during which Enter after an update is ignored.
  const menu = page.locator(".cm-tooltip-autocomplete");
  await expect(menu.locator("li[aria-selected] .cm-completionMatchedText")).toHaveText("Image");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([
    { name: "one.png", mimeType: "image/png", buffer: PIXEL },
    { name: "two.png", mimeType: "image/png", buffer: PIXEL },
  ]);
  // Enter opened a new line under the heading; the images fill it.
  await expect.poll(() => docText(page)).toBe("# Photos\n![one](../attachments/one.png)\n![two](../attachments/two.png)\n\n");
});

test("the picture stays visible under its source while you edit it", async ({ page }) => {
  await openNote(page, "# Photos\n\nText.\n");
  await placeCaret(page, "Text.", 5);
  await sendImage(page, "paste", "Chart.png", [200, 100]);
  await expect.poll(() => docText(page)).toContain("![Chart](../attachments/Chart.png)");
  await placeCaret(page, "Chart]", 2);
  await expect(page.locator(".cm-line", { hasText: "![Chart](../attachments/Chart.png)" })).toBeVisible();
  const preview = page.locator(".cm-md-image-preview img");
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(200);
  // Moving away shows just the image again.
  await placeCaret(page, "# Photos", 2);
  await expect(page.locator(".cm-md-image-preview")).toHaveCount(0);
  await expect.poll(() => renderedSizes(page)).toEqual(["200x100"]);
});

test("undo takes a pasted image back out in one step", async ({ page }) => {
  await openNote(page, "# Photos\n\nText.\n");
  await placeCaret(page, "Text.", 5);
  await sendImage(page, "paste", "Undo me.png", [10, 10]);
  await expect.poll(() => docText(page)).toContain("Undo%20me.png");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => docText(page)).toBe("# Photos\n\nText.\n");
});

test("a file dropped outside the editor is refused instead of opened", async ({ page }) => {
  const refused = await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "notes.pdf", { type: "application/pdf" }));
    const target = document.querySelector(".sidebar")!;
    const over = new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true });
    const drop = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
    target.dispatchEvent(over);
    target.dispatchEvent(drop);
    return over.defaultPrevented && drop.defaultPrevented;
  });
  expect(refused).toBe(true);
});
