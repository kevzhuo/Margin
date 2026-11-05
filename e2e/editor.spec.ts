import { blurEditor, caretPos, clickLine, docText, expect, lastLine, lineWithText, openApp, test } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("heading reveals its # in the margin without changing the line box", async ({ page }) => {
  await blurEditor(page);
  const h1 = page.locator(".cm-line.cm-md-h1").first();
  await expect(h1).toHaveText(/^Editor design notes$/);
  await expect(h1.locator(".cm-md-margin-mark")).toHaveCount(0);
  const before = await h1.boundingBox();

  await clickLine(h1, 40);
  await expect(h1.locator(".cm-md-margin-mark")).toHaveText("# ");
  const after = await h1.boundingBox();
  expect(after).toEqual(before);

  // Bullets keep the same x and height whether the dash is revealed or not.
  const bullet = page.locator(".cm-line.cm-md-li").first();
  await expect(bullet.locator(".cm-md-bullet")).toHaveCount(1);
  const b1 = await bullet.boundingBox();
  await clickLine(bullet, 200);
  await expect(bullet.locator(".cm-md-listmark")).toHaveText("-");
  await expect(bullet.locator(".cm-md-bullet")).toHaveCount(0);
  const b2 = await bullet.boundingBox();
  expect(b2).toEqual(b1);
});

test("clicking inside an italic span reveals only that element's marks", async ({ page }) => {
  const para = lineWithText(page, "The editor should feel like");
  await blurEditor(page);
  await expect(para.locator(".cm-md-mark")).toHaveCount(0);
  await para.locator(".cm-md-em").click();
  await expect(para.locator(".cm-md-mark")).toHaveText(["*", "*"]);
  await expect(para.locator(".cm-md-strong")).toHaveText("Typora");
  await expect(para).not.toContainText("**");
  // Now click into the bold span: its marks appear, the italic ones hide.
  await para.locator(".cm-md-strong").click();
  await expect(para.locator(".cm-md-mark")).toHaveText(["**", "**"]);
});

test("typing bold text renders it once the caret leaves", async ({ page }) => {
  const empty = lastLine(page);
  await clickLine(empty);
  await page.keyboard.type("**bold**");
  const line = lineWithText(page, "bold");
  // Caret touches the strong element, so its marks are revealed (dimmed).
  await expect(line.locator(".cm-md-mark")).toHaveText(["**", "**"]);
  await page.keyboard.type(" word");
  // Caret moved out of the element on the same line: marks hide (element-level reveal).
  await expect(line.locator(".cm-md-mark")).toHaveCount(0);
  await page.keyboard.press("ArrowUp");
  await expect(line.locator(".cm-md-strong")).toHaveText("bold");
  await expect(line).not.toContainText("**");
  await expect(line).toHaveText("bold word");
  expect(await docText(page)).toContain("**bold** word");
});

test("slash menu inserts a heading", async ({ page }) => {
  await clickLine(lastLine(page));
  await page.keyboard.type("/");
  const menu = page.locator(".cm-tooltip-autocomplete");
  await expect(menu).toBeVisible();
  await expect(menu.locator("li").first()).toContainText("Text");
  await page.keyboard.type("head");
  await expect(menu.locator("li")).toHaveCount(3);
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator("li[aria-selected]")).toContainText("Heading 2");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await page.keyboard.type("New section");
  const line = lineWithText(page, "New section");
  await expect(line).toHaveClass(/cm-md-h2/);
  await expect(line.locator(".cm-md-margin-mark")).toHaveText("## ");
  expect(await docText(page)).toContain("\n## New section");
});

test("empty active line shows a hint", async ({ page }) => {
  await clickLine(lastLine(page));
  await expect(lastLine(page).locator(".cm-md-line-placeholder")).toHaveText("Type / for commands");
  await blurEditor(page);
  await expect(page.locator(".cm-md-line-placeholder")).toHaveCount(0);
});

test("checkbox click toggles the task marker in the document", async ({ page }) => {
  const line = lineWithText(page, "Decide how a table");
  await expect(line).toHaveClass(/cm-md-task/);
  await expect(line).not.toHaveClass(/cm-md-task-done/);
  await line.locator("input[type=checkbox]").click();
  await expect.poll(() => docText(page)).toContain("- [x] Decide how a table");
  await expect(line).toHaveClass(/cm-md-task-done/);
  await line.locator("input[type=checkbox]").click();
  await expect.poll(() => docText(page)).toContain("- [ ] Decide how a table");
  await expect(line).not.toHaveClass(/cm-md-task-done/);
});

test("outline click moves the caret to the heading", async ({ page }) => {
  await page.locator(".outline-item", { hasText: "Open questions" }).click();
  const doc = await docText(page);
  expect(await caretPos(page)).toBe(doc.indexOf("## Open questions"));
  const line = lineWithText(page, "Open questions").filter({ has: page.locator(".cm-md-margin-mark") });
  await expect(line.locator(".cm-md-margin-mark")).toHaveText("## ");
  await expect(page.locator(".outline-item.on")).toHaveText("Open questions");
  // Moving the caret into another section updates the highlight.
  const bullet = lineWithText(page, "Files on disk are the source");
  await bullet.scrollIntoViewIfNeeded(); // scrolled out of view by the jump above
  await clickLine(bullet, 40);
  await expect(page.locator(".outline-item.on")).toHaveText("Principles");
});

test("rendered links open on click, revealed links do not", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await openApp(page);
  const opened = () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  await blurEditor(page);
  const link = page.locator(".cm-md-link").first();
  await expect(link).toHaveText("the research notes");
  await link.click();
  await expect.poll(opened).toEqual(["https://github.com/kevzhuo/Margin/blob/main/docs/research.md"]);

  // Put the caret inside the link with the keyboard so the syntax is revealed.
  const quote = lineWithText(page, "A good tool");
  const box = (await quote.boundingBox())!;
  await page.mouse.click(box.x + box.width - 4, box.y + box.height - 10);
  await page.keyboard.press("End");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(quote.locator(".cm-md-mark", { hasText: "[" })).toHaveCount(1);
  await page.locator(".cm-md-link").first().click();
  await page.waitForTimeout(100);
  expect(await opened()).toEqual(["https://github.com/kevzhuo/Margin/blob/main/docs/research.md"]);
});

test("tables render as a widget and open for editing on click", async ({ page }) => {
  await blurEditor(page);
  const table = page.locator(".cm-md-table table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("th")).toHaveText(["Node", "Reveals when", "Widget"]);
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await table.locator("td", { hasText: "Heading" }).first().click();
  await expect(page.locator(".cm-md-table-raw")).toHaveCount(6);
  await expect(page.locator(".cm-md-table table")).toHaveCount(0);
  const doc = await docText(page);
  const pos = await caretPos(page);
  expect(doc.slice(pos - 7, pos)).toBe("Heading");
  await page.keyboard.type("!");
  expect(await docText(page)).toContain("| Heading! |");
  await blurEditor(page);
  await expect(page.locator(".cm-md-table table")).toHaveCount(1);
  await expect(page.locator(".cm-md-table td", { hasText: "Heading!" })).toHaveCount(1);
});

test("code fences show a language label and reveal the fence when active", async ({ page }) => {
  await blurEditor(page);
  await expect(page.locator(".cm-md-lang")).toHaveText("ts");
  const head = page.locator(".cm-line.cm-md-fence-head");
  await expect(head).not.toContainText("```");
  await clickLine(page.locator(".cm-line.cm-md-fence").nth(1), 30);
  await expect(head).toContainText("```ts");
  await expect(page.locator(".cm-md-lang")).toHaveCount(0);
  await expect(page.locator(".cm-line.cm-md-fence-foot")).toContainText("```");
});

test("Mod+B wraps the selection in bold", async ({ page }) => {
  const line = lineWithText(page, "never a database export");
  // Select the word "truth" through the editor API (a double click lands on
  // the line, not a word, in headless layout).
  await page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    const from = view.state.doc.toString().indexOf("truth");
    view.dispatch({ selection: { anchor: from, head: from + 5 } });
    view.focus();
  });
  await page.keyboard.press("Control+b");
  await expect.poll(() => docText(page)).toContain("source of **truth**, never");
  await expect(line.locator(".cm-md-mark")).toHaveText(["**", "**"]);
  await page.keyboard.press("Control+b");
  await expect.poll(() => docText(page)).toContain("source of truth, never");
});

test("Mod+Enter turns the caret line into a task and toggles it", async ({ page }) => {
  const line = lineWithText(page, "Everything else reads like");
  await clickLine(line, 20);
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => docText(page)).toContain("- [ ] The editor should feel like");
  await expect(line).toHaveClass(/cm-md-task/);
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => docText(page)).toContain("- [x] The editor should feel like");
});

test("word count updates while typing", async ({ page }) => {
  const count = page.locator(".word-count");
  const before = Number((await count.innerText()).replace(/\D/g, ""));
  await clickLine(lastLine(page));
  await page.keyboard.type("alpha beta gamma");
  await expect(count).toHaveText(`${before + 3} words`);
});
