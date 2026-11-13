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
  await page.waitForTimeout(150); // CodeMirror's interactionDelay: Enter right after an update is ignored
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
  await expect(link).toHaveText("CodeMirror");
  await link.click();
  await expect.poll(opened).toEqual(["https://codemirror.net"]);

  // Put the caret inside the link with the keyboard so the syntax is revealed.
  const quote = lineWithText(page, "A good tool");
  const box = (await quote.boundingBox())!;
  await page.mouse.click(box.x + box.width - 4, box.y + box.height - 10);
  await page.keyboard.press("End");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(quote.locator(".cm-md-mark", { hasText: "[" })).toHaveCount(1);
  await page.locator(".cm-md-link").first().click();
  await page.waitForTimeout(100);
  expect(await opened()).toEqual(["https://codemirror.net"]);
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

test("a task shows only its checkbox while you edit it, and Backspace at its start removes the checkbox", async ({ page }) => {
  const line = lineWithText(page, "Decide how a table");
  await page.evaluate(() => {
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Decide how a table") } });
    view.focus();
  });
  // The caret's line: the checkbox, the text, and no raw "- [ ]" beside them.
  await expect(line.locator("input[type=checkbox]")).toBeVisible();
  await expect(line).toHaveText("Decide how a table is edited while the caret is inside it");
  await expect(line.locator(".cm-md-mark")).toHaveCount(0);
  // In a list, the text then continues the item above, as in any Markdown editor.
  await page.keyboard.press("Backspace");
  await expect.poll(() => docText(page)).toMatch(/\n +Decide how a table is edited/);
  expect(await docText(page)).not.toContain("- [ ] Decide how a table");
  await expect(line.locator("input[type=checkbox]")).toHaveCount(0);
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

test("/table makes a table you can fill in by typing and Tab", async ({ page }) => {
  await page.evaluate(async () => {
    await window.__margin!.store.getState().createNote("/Demo Vault/Projects", "Prices");
    const view = window.__margin!.store.getState().editor!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "# Prices\n\nSome text\n" }, selection: { anchor: "# Prices\n\nSome text".length } });
    view.focus();
  });
  // Right after a line of text: the table makes room for itself.
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  const menu = page.locator(".cm-tooltip-autocomplete");
  await expect(menu.locator("li[aria-selected]")).toContainText("Table");
  await page.waitForTimeout(150); // CodeMirror's interactionDelay
  await page.keyboard.press("Enter");
  // The first column's name is selected to type over, without the formatting toolbar in the way.
  await expect.poll(() => page.evaluate(() => { const v = window.__margin!.store.getState().editor!; const s = v.state.selection.main; return v.state.sliceDoc(s.from, s.to); })).toBe("Column 1");
  await page.waitForTimeout(300);
  await expect(page.locator(".cm-bubble-toolbar")).toHaveCount(0);
  await page.keyboard.type("Fruit");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Price");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Notes");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Apple");
  await page.keyboard.press("Tab");
  await page.keyboard.type("1.20");
  const doc = await docText(page);
  expect(doc).toContain("Some text\n\n| Fruit | Price | Notes |");
  expect(doc).toMatch(/\| Apple +\| 1\.20 +\| +\|/);
  // Away from the caret it renders as a table.
  await page.evaluate(() => window.__margin!.store.getState().editor!.dispatch({ selection: { anchor: 0 } }));
  await expect(page.locator(".cm-md-table th", { hasText: "Fruit" })).toBeVisible();
});

test("right-clicking a table adds and removes rows and columns, and aligns columns", async ({ page }) => {
  const table = page.locator(".cm-md-table table");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  // Rendered table: a body cell.
  await table.locator("td", { hasText: "Heading" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert row below" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(5);
  // Still rendered: the caret didn't move into it.
  await expect(page.locator(".cm-md-table-raw")).toHaveCount(0);

  await table.locator("th", { hasText: "Widget" }).click({ button: "right" });
  // The header row can't be deleted or have a row put above it.
  await expect(page.getByRole("menuitem", { name: "Delete row" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Insert row above" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Insert column right" }).click();
  await expect(table.locator("th")).toHaveText(["Node", "Reveals when", "Widget", "Column 4"]);

  await table.locator("th", { hasText: "Reveals when" }).click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Align center" }).click();
  await expect(table.locator("th").nth(1)).toHaveCSS("text-align", "center");
  expect(await docText(page)).toMatch(/\| :-+: \|/);

  await table.locator("th", { hasText: "Column 4" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete column" }).click();
  await expect(table.locator("th")).toHaveText(["Node", "Reveals when", "Widget"]);

  await table.locator("td", { hasText: "Task item" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete row" }).click();
  await expect(table.locator("td", { hasText: "Task item" })).toHaveCount(0);

  // While editing the source, the same menu works on the line clicked.
  await table.locator("td", { hasText: "Heading" }).first().click();
  await expect(page.locator(".cm-md-table-raw").first()).toBeVisible();
  // The "| Table |" row. (Text matching ignores case, so "Table" alone would
  // also find "Decide how a table is edited" above the table.)
  const tableRow = page.locator(".cm-md-table-raw", { hasText: "caret inside the table" });
  await tableRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert row above" }).click();
  expect(await docText(page)).toMatch(/\| +\| +\| +\|\n\| Table/);

  await tableRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete table" }).click();
  await expect(page.locator(".cm-md-table, .cm-md-table-raw")).toHaveCount(0);
  expect(await docText(page)).not.toContain("| Node");
});
