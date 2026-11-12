# How Margin works

Notes for people working on Margin's code. For what the app does and how to
run it, see the [README](../README.md).

## Project layout

```
src/
  backend/        VaultBackend interface, Tauri adapter, in-memory demo vault
  editor/         CodeMirror extensions: live preview, widgets, math syntax and
                  rendering, image paste and drop, commands, slash menu,
                  bubble toolbar, typewriter scrolling, selection wrapping
  components/     React UI: sidebar, file tree, top bar, editor pane, outline,
                  palette, settings, dialogs, toasts
  state/          zustand store (vault, history, autosave, settings, attachments)
                  and the command registry
  styles/         design tokens, motion keyframes, and stylesheets
src-tauri/        Rust shell: window config, vault commands, file watcher
assets/           the app icon's artwork and its 1024 px master
scripts/          ensure-deps.mjs, which installs changed dependencies before dev and build
e2e/              Playwright tests
docs/             this file, the README's screenshots, and research.md, the
                  research and design notes this project was built from
```

## The live preview

`src/editor/livePreview.ts` builds decorations from the Lezer Markdown syntax
tree whenever the document, selection, focus, or visible range changes: a view
plugin covers what is on screen, and a small state field holds the block
widgets (tables, math blocks, image previews).

- Heading size and weight come from line decorations that apply in both states.
- List items are padded by nesting depth plus a fixed-width marker box, and
  the first line is pulled back by the marker width, so wrapped lines hang
  under the text. The raw indentation is hidden in both states.
- Inline delimiters (`**`, `*`, `` ` ``, `[`, `](url)`) are replaced with empty
  decorations unless a selection range touches the element they belong to.
- Block delimiters (`#`, `>`) are replaced when the caret is off the line and
  rendered as absolutely positioned marks in the left margin when it is on it.
- A bullet marker and its revealed `-` share one fixed-width inline box, so the
  text after it does not move.
- Checkboxes, images, math, horizontal rules, code-fence language labels, and
  tables are widgets. Tables and `$$` math blocks are block widgets that drop
  back to their source when the caret enters them; a math block then gets a
  live preview underneath, and so does an image whose link the caret is on.
- Math syntax comes from a small Lezer extension (`src/editor/mathSyntax.ts`),
  so formulas are real syntax-tree nodes: Markdown inside them is never parsed,
  and code spans and fences are never mistaken for math. KaTeX output is cached
  per formula.
- Syntax colours are plain classes (`src/editor/highlight.ts`) that the
  stylesheet applies only inside fenced code, so Markdown's own tokens, such
  as a bare URL or an escaped `\*`, never pick up code colours in prose.
- Table cells are rendered by `src/editor/inlineMarkdown.ts`, which runs the
  editor's own parser over each cell; search results use it too, to show
  matching lines without their Markdown syntax.

## Images and the vault

Images are saved by the Rust command `save_attachment`, which receives the
image's bytes as the raw request body (no JSON, so large photos stay fast),
cleans the file name, and creates the file with `create_new` so nothing is ever
overwritten. The web view can load images only from the open vault: the asset
protocol starts with an empty scope and each vault is allowed when it is opened.
A file dropped anywhere the editor doesn't take it is refused, so a stray drop
can't replace the app with the file.

## Saving and syncing

Every save writes a temporary file next to the note and renames it over the
note, so a crash never leaves a half-written file; the new file takes on the
note's permissions and creation date. Saves, renames, moves and deletes run one
at a time, in order, so an autosave can never land on a path that is being
renamed. A file watcher (Rust, `notify`) reports changes made by other apps;
Margin ignores its own writes, reloads a note with nothing unsaved, and keeps
its own unsaved edits over a change made elsewhere. Quitting and closing the
window save first.

## Performance

Live preview decorates only the part of a note that is on screen (rendered
tables and math blocks live in a small separate field, because CodeMirror only allows block
widgets from state fields). The outline and word count update after a short
pause instead of on every keystroke. In a 3,600-line note a keystroke takes
about 3 ms (it was about 19 ms when the whole note was decorated), and an
end-to-end test keeps it under 10 ms, with the same bound for a note holding
900 formulas. KaTeX adds about 270 kB of script and 256 kB of fonts; its
stylesheet also lists woff and ttf copies of every font, which a small Vite
plugin drops because every web view Margin runs in reads woff2.

## Motion

Every transition uses the timing tokens in `src/styles/tokens.css` and the
keyframes in `src/styles/motion.css`. When the operating system asks for reduced
motion, the durations collapse to zero and panels, menus, and dialogs change
instantly.

Two rules keep motion from fighting the editor. Note switches fade without
moving, because CodeMirror measures positions from the live DOM. And widgets
that change state, such as checkboxes and the selection toolbar, keep their DOM
node so they animate instead of being rebuilt.

## The app icon

The icon's artwork is `assets/app-icon-artwork.png`. `assets/app-icon.png` is
that artwork cut out and placed on Apple's icon grid (an 824 px rounded square
with a soft shadow on a 1024 px canvas), so it matches other apps in the Dock.
To regenerate every size in `src-tauri/icons` from it:

```bash
npx tauri icon assets/app-icon.png
```

That also writes Android and iOS icon sets, which this app doesn't use; delete
`src-tauri/icons/android` and `src-tauri/icons/ios` afterwards.
