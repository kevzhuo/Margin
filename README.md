# Margin

A local Markdown editor in the spirit of Typora, with the look of macOS and Notion.
Your notes are plain `.md` files in a folder you choose. Nothing is copied into a
database, and nothing moves on screen when you click into a line.

- **One pane, no preview toggle.** The document is always rendered. The element
  under the caret reveals its Markdown; everything else reads like a finished page.
- **Markers live in the margin.** `#`, `>`, and `- [ ]` appear to the left of the
  text when revealed, so headings keep their size and text never shifts.
- **Files are the source of truth.** The editor is CodeMirror 6 over the raw
  Markdown string with a decoration layer on top, so round trips are lossless.
- **Native chrome.** Tauri 2 shell: a few megabytes, system webview, inset traffic
  lights and a translucent sidebar on macOS.

## Features

| Area | What works |
| --- | --- |
| Live preview | Headings, bold, italic, strikethrough, inline code, links, bare URLs, images, bullet and numbered lists, task lists with real checkboxes, blockquotes, fenced code with syntax highlighting and a language label, tables (rendered when the caret is outside, raw when inside), horizontal rules, escapes, YAML front matter |
| Writing | Slash menu on an empty line, `Mod+B` / `Mod+I` / `Mod+E` / `Mod+K` / `Mod+Shift+X`, `Mod+1`..`Mod+6` for headings, `Mod+Enter` toggles a task, Enter continues lists, Backspace unwinds list markup, find and replace |
| Vault | Open any folder, file tree with create, rename, and delete (to trash), quick switcher (`Mod+P`), outline panel, autosave with atomic writes, reload when a file changes on disk |
| Appearance | Light and dark palettes, follows the system by default, SF Pro on macOS, Inter or Segoe UI elsewhere |

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
  editor/         CodeMirror extensions: live preview, widgets, commands, slash menu
  components/     React UI: sidebar, file tree, top bar, editor pane, outline, quick switcher
  state/          zustand store: vault, autosave, settings
  styles/         design tokens and stylesheets
src-tauri/        Rust shell: window config, vault commands, file watcher
e2e/              Playwright tests
docs/research.md  the research and design notes this project was built from
```

## How the live preview works

`src/editor/livePreview.ts` is a single CodeMirror `StateField` that rebuilds a
`DecorationSet` from the Lezer Markdown syntax tree whenever the document,
selection, or focus changes.

- Heading size and weight come from line decorations that apply in both states.
- Inline delimiters (`**`, `*`, `` ` ``, `[`, `](url)`) are replaced with empty
  decorations unless a selection range touches the element they belong to.
- Block delimiters (`#`, `>`) are replaced when the caret is off the line and
  rendered as absolutely positioned marks in the left margin when it is on it.
- A bullet marker and its revealed `-` share one fixed-width inline box, so the
  text after it does not move.
- Checkboxes, images, horizontal rules, code-fence language labels, and tables
  are widgets. Tables are block widgets that drop back to raw pipe syntax when
  the caret enters them.

## Status

Early. It is usable for daily notes, but see `docs/research.md` for the roadmap
(wiki links and backlinks, math blocks, export, full-text search).

## License

MIT
