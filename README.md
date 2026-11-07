# Margin

A local Markdown editor in the spirit of Typora, with the look of macOS and Notion.
Your notes are plain `.md` files in a folder you choose. Nothing is copied into a
database, and nothing moves on screen when you click into a line.

- **One pane, no preview toggle.** The document is always rendered. The element
  under the caret reveals its Markdown; everything else reads like a finished page.
- **Markers live in the margin.** `#` and `>` appear to the left of the text
  when revealed, so headings keep their size and text never shifts. A task's
  checkbox stays a checkbox even on the line you're editing.
- **Files are the source of truth.** The editor is CodeMirror 6 over the raw
  Markdown string with a decoration layer on top, so round trips are lossless.
- **Native chrome.** Tauri 2 shell: a few megabytes, system webview, inset traffic
  lights and a translucent sidebar on macOS.

## Features

| Area | What works |
| --- | --- |
| Live preview | Headings, bold, italic, strikethrough, inline code, links, bare URLs, images, LaTeX math, bullet and numbered lists, task lists with real checkboxes, blockquotes, fenced code with syntax highlighting and a language label, tables (rendered with bold, code, links and math inside cells, keeping their quote bar or list indent, and shown as plain source while the caret is inside), horizontal rules, escapes, YAML front matter. An image that can't be found shows its file name in a dashed box |
| Images | Paste a screenshot, drag photos in from Finder or a browser, or type `/image` to pick files. Each image is copied into an `attachments` folder at the top of the vault (never overwriting: a second `photo.png` becomes `photo 2.png`) and linked with a standard relative path, so Typora, Obsidian, VS Code and GitHub show it too. A drop in the middle of a sentence lands on its own line after it. With the caret on an image's link, the picture stays visible underneath |
| Math | `$…$` inline and `$$…$$` blocks, rendered with KaTeX (bundled, so it works offline). Moving the caret into a formula shows its TeX; blocks show a live preview under the source as you type. A formula with a mistake shows its source in red with the reason. Prices like "$5 and $10" stay text, `\$` is a literal dollar, and an unfinished `$$` never turns the rest of the note into math. `/math`, `Mod+Alt+B` or typing `$` over a selection start one |
| Writing | Slash menu on an empty line, a formatting toolbar over selected text, typing `*`, `_`, `` ` ``, `~`, `$` or `"` over a selection wraps it, brackets close themselves, pasting a URL over text makes a link, Enter continues lists, and a find and replace bar that floats over the note with a match count and case, whole-word and regex toggles |
| Focus | Focus mode dims everything but the line you are on; typewriter mode keeps the caret near the middle of the window |
| Navigation | Command palette, quick switcher with recent notes and full-text search (each match shows its note, its section and the line without Markdown syntax) that jumps to and highlights the match, back and forward history (buttons, shortcuts, or a two-finger swipe), caret and scroll position remembered per note, relative links like `[x](Other.md#heading)` open in the app |
| Titles | A note's first heading is its name: editing it renames the file once you pause, renaming the file updates the heading, and new notes open with the title selected. Notes whose file name was set deliberately are left alone. Can be turned off in Settings |
| macOS | Native menu bar (File, Edit, View, Go, Format, Window) with standard shortcuts and Format items for math and images, translucent sidebar, inset traffic lights, two-finger swipe for back and forward, quotes that hang into the margin |
| Vault | A welcome screen to open a folder, create a vault, or reopen a recent one; file tree with notes and folders (the `attachments` folder stays out of the way until it holds a note), new notes go in the open note's folder, drag and drop to move, rename inline, delete to the trash with a confirmation, copy path, show in Finder, resizable sidebar, autosave with atomic writes, reload when a file changes on disk |
| Layout | Full width or a centered column with margins (top bar button, Settings, or the palette), gutters that scale with the editor's width, hanging indents for wrapped list items and real nesting, tighter spacing between blocks, tables that wrap or scroll inside their own box, and panels that step aside in small windows and open as overlays instead |
| Appearance | Light and dark palettes that follow the system, sans, serif or mono text, adjustable text size and line width, an accent caret that fades rather than blinks (optionally gliding), a hairline under the top bar once a note scrolls, slim scrollbars on Windows and Linux, smooth transitions throughout that switch off when the system asks for reduced motion |
| Window | Opens without a flash in either theme and remembers its size and position |

## Keyboard shortcuts

`Mod` is Cmd on macOS and Ctrl elsewhere.

| Shortcut | Action |
| --- | --- |
| `Mod+P` or `Mod+O` | Go to a note, or search all notes |
| `Mod+Shift+P` | Run a command (or type `>` in the switcher) |
| `Mod+Shift+F` | Search all notes |
| `Mod+F` | Find and replace in the note |
| `Mod+N` / `Mod+Shift+N` | New note / new folder |
| `Mod+[` / `Mod+]` | Back / forward |
| `F2` | Rename the open note |
| `Mod+B` `Mod+I` `Mod+E` `Mod+K` `Mod+Shift+X` | Bold, italic, inline code, link, strikethrough |
| `Mod+1` … `Mod+6`, `Mod+0` | Heading level, or plain paragraph |
| `Mod+Enter` | Toggle a task |
| `Mod+Shift+M` / `Mod+Alt+B` | Inline math / math block |
| `Mod+=` / `Mod+-` | Larger / smaller text |
| `Mod+\` / `Mod+Shift+\` | Toggle the sidebar / outline |
| `F8` / `F9` | Focus mode / typewriter mode |
| `Mod+,` | Settings |
| `Shift+Mod+/` | Keyboard shortcuts (macOS menu) |

## Development

Requirements: Node 22, Rust stable, and the Tauri prerequisites for your OS
(see https://v2.tauri.app/start/prerequisites/).

```bash
npm install
```

Run the UI in a browser with an in-memory demo vault (no Rust needed):

```bash
npm run dev
```

Run the desktop app:

```bash
npm run tauri dev
```

Build installers for the current platform into `src-tauri/target/release/bundle`:

```bash
npm run tauri build
```

`npm run dev` and `npm run build` (and so the two `tauri` commands) first
install dependencies if `package-lock.json` changed since the last install,
so pulling a change that adds a package just works.

### App icon

The icon's artwork is `assets/app-icon-artwork.webp`. `assets/app-icon.png` is
that artwork cut out and placed on Apple's icon grid (an 824 px rounded square
with a soft shadow on a 1024 px canvas), so it matches other apps in the Dock.
To regenerate every size in `src-tauri/icons` from it:

```bash
npx tauri icon assets/app-icon.png
```

That also writes Android and iOS icon sets, which this app doesn't use; delete
`src-tauri/icons/android` and `src-tauri/icons/ios` afterwards.

### Checks

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

The end-to-end suite runs the real editor in Chromium against the demo vault,
and asserts the layout-stability rules (for example, that a heading's line box
has the same height before and after its `#` is revealed).

Rust unit tests for the vault commands:

```bash
cd src-tauri && cargo test
```

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
docs/research.md  the research and design notes this project was built from
```

## How the live preview works

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

## Status

Early. It is usable for daily notes, but see `docs/research.md` for the roadmap
(wiki links and backlinks, export). Images are linked by relative path, so
moving a note to another folder breaks its image links for now; updating links
on moves and renames is the next step.

## License

MIT
