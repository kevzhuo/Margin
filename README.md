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
| Writing | Slash menu on an empty line, a formatting toolbar over selected text, typing `*`, `_`, `` ` ``, `~` or `"` over a selection wraps it, brackets close themselves, pasting a URL over text makes a link, Enter continues lists, find and replace |
| Focus | Focus mode dims everything but the line you are on; typewriter mode keeps the caret near the middle of the window |
| Navigation | Command palette, quick switcher with recent notes and full-text search that jumps to and highlights the match, back and forward history (buttons, shortcuts, or a two-finger swipe), caret and scroll position remembered per note, relative links like `[x](Other.md#heading)` open in the app |
| Titles | A note's first heading is its name: editing it renames the file once you pause, renaming the file updates the heading, and new notes open with the title selected. Notes whose file name was set deliberately are left alone. Can be turned off in Settings |
| macOS | Native menu bar (File, Edit, View, Go, Format, Window) with standard shortcuts, translucent sidebar, inset traffic lights, two-finger swipe for back and forward, quotes that hang into the margin |
| Vault | Open any folder, file tree with notes and folders, drag and drop to move, rename inline, delete to the trash with a confirmation, copy path, show in Finder, resizable sidebar, autosave with atomic writes, reload when a file changes on disk |
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
  editor/         CodeMirror extensions: live preview, widgets, commands, slash menu,
                  bubble toolbar, typewriter scrolling, selection wrapping
  components/     React UI: sidebar, file tree, top bar, editor pane, outline,
                  palette, settings, dialogs, toasts
  state/          zustand store (vault, history, autosave, settings) and the command registry
  styles/         design tokens, motion keyframes, and stylesheets
src-tauri/        Rust shell: window config, vault commands, file watcher
e2e/              Playwright tests
docs/research.md  the research and design notes this project was built from
```

## How the live preview works

`src/editor/livePreview.ts` is a single CodeMirror `StateField` that rebuilds a
`DecorationSet` from the Lezer Markdown syntax tree whenever the document,
selection, or focus changes.

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
- Checkboxes, images, horizontal rules, code-fence language labels, and tables
  are widgets. Tables are block widgets that drop back to raw pipe syntax when
  the caret enters them.

## Performance

Live preview decorates only the part of a note that is on screen (rendered
tables live in a small separate field, because CodeMirror only allows block
widgets from state fields). The outline and word count update after a short
pause instead of on every keystroke. In a 3,600-line note a keystroke takes
about 3 ms (it was about 19 ms when the whole note was decorated), and an
end-to-end test keeps it under 10 ms.

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
(wiki links and backlinks, math blocks, export, full-text search).

## License

MIT
