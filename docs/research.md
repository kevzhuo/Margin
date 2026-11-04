# Building a local Markdown editor: Typora's editing model, Apple/Notion aesthetics

Research date: 2026-11-04

## 1. What "Typora's design" actually is

Typora has no split pane. The document is always rendered, and only the element you are
editing shows its raw Markdown. The file on disk stays plain Markdown; what you see is a
projection of that text. The specific behaviours worth copying:

- Inline marks (`**bold**`, `*em*`, `` `code` ``, `[link](url)`) reveal their delimiters only
  while the caret is inside that element, not merely on that line.
- Block marks (`#`, `>`, `-`, `1.`) reveal while the caret is on that line.
- Fenced code, tables, images, math, and HTML render as block widgets. A fence becomes a
  code editor with a language label; a table becomes a real table you edit cell by cell.
- Nothing shifts when you click into a line. Headings stay the same size whether the `#` is
  visible or hidden. This is the single hardest UX requirement and the one most clones miss
  (see the Obsidian forum complaints about lines jumping when syntax toggles).
- Chrome is almost invisible: no toolbar, centered column of text, optional sidebar.

## 2. The one big architectural decision

There are two ways to get this behaviour. Pick one before writing any code.

### A. Source-first: CodeMirror 6 + Lezer Markdown + decorations

The editor state is the Markdown string. A parser builds a syntax tree, and a decoration
layer hides delimiter tokens, styles ranges, and swaps in widgets. This is how Obsidian's
Live Preview works (a CM6 state field providing replace widgets when the cursor is not
overlapping the target text), and how Atomic Editor and TypeDown work.

- Round trip is perfect by construction. The decorations never touch the document, so
  saving, copying, and external tools see exactly what was typed.
- Any Markdown dialect can be supported by adding a Lezer parser extension.
- Notion-style block affordances (slash menu, drag handle) must be built by hand.
- Table editing is awkward: a table is either raw pipes on the active lines or a widget that
  needs its own editing UI.

### B. Model-first: ProseMirror document + Markdown serializer

The editor state is a rich-text tree. Markdown is parsed in on load and serialized out on
save. Milkdown (and its batteries-included "Crepe" editor), Tiptap with the official
`@tiptap/markdown` extension, and MarkText's Muya engine all work this way. Typora itself is
a closed-source custom contenteditable engine in this family.

- Notion-like UX is nearly free: slash menu, bubble toolbar, drag handles, real tables,
  nested blocks.
- Round trip is lossy. Anything the schema does not model (HTML blocks, reference links,
  exotic whitespace, front matter, unknown syntax) is normalized or dropped on save. Tiptap's
  own docs warn that re-importing exported Markdown yields a simplified document.
- Every external edit to a file forces a re-parse into the model, and opening a file in a
  second tool can produce diffs the user never made.

### Recommendation

For an Obsidian-style app where the vault is a folder of Markdown files that other tools
also touch, choose A. Lossless round trip is the property that makes "local Markdown" worth
having. Build the Notion-feeling affordances on top: a slash menu via CM6 autocomplete, a
hover gutter for drag handles, bubble toolbar on selection. Reserve option B for a product
where the app owns the files and Markdown is only an export format.

If you want to shortcut the decoration layer, Atomic Editor (MIT, React + CM6) is a working
reference implementation that already handles headings, emphasis, links, images, tables,
task checkboxes, stable line heights, and lazy-loaded code grammars.

## 3. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | Tauri 2 | ~3 to 10 MB installer vs ~85 to 250 MB for Electron; uses the OS webview, so on macOS text is rendered by WebKit with the real SF Pro; native window materials (vibrancy) via `windowEffects`; Rust backend for file watching and indexing. |
| UI framework | React 18 + TypeScript + Vite | Atomic Editor is React; largest CM6 ecosystem. Svelte 5 is a fine alternative (TypeDown uses it). |
| Editor engine | CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/language`) | Viewport rendering, incremental parsing, decoration API, compartments for live reconfiguration. |
| Markdown parser | `@codemirror/lang-markdown` + `@lezer/markdown` with the GFM bundle (Table, TaskList, Strikethrough, Autolink) | Produces the node names the decoration layer keys on. Add Lezer extensions for `==highlight==`, `[[wiki links]]`, `$math$`, callouts, front matter. |
| Widgets | KaTeX (math), Mermaid (diagrams), `@codemirror/language` grammars for fences | Loaded lazily on first use. |
| Export/preview | `unified` + `remark-gfm` + `rehype` | A separate render path for HTML/PDF export so the editor never depends on it. |
| Files | `@tauri-apps/plugin-fs` (read, write, watch), `plugin-dialog`, `plugin-store` | Watching uses the `notify` crate under the hood. |
| Index/search | Rust side: walk the vault, keep an in-memory index of titles, headings, links; optional `tantivy` for full text | Quick switcher and backlinks stay instant on large vaults. |
| Styling | Plain CSS with custom properties, `prefers-color-scheme` | Theme = one token file. Avoid Tailwind in the editor column; CM6 theming is CSS-class based. |

Electron is the right call instead if you want one rendering engine on all three platforms,
a plugin ecosystem that can `require` Node modules (Obsidian's model), or you already know
you will ship Windows and Linux on day one. Tauri means testing on WKWebView, WebView2, and
WebKitGTK, which differ in contenteditable, IME, and scrolling details.

## 4. The live preview engine in detail

### 4.1 Node names you will key on

Lezer Markdown's `Type` enum, which is what `syntaxTree(state)` yields:

- Blocks: `Document`, `Paragraph`, `ATXHeading1`..`ATXHeading6`, `SetextHeading1/2`,
  `Blockquote`, `FencedCode`, `CodeBlock`, `HorizontalRule`, `BulletList`, `OrderedList`,
  `ListItem`, `HTMLBlock`, `LinkReference`.
- Inline: `Emphasis`, `StrongEmphasis`, `InlineCode`, `Link`, `Image`, `Autolink`, `URL`,
  `HTMLTag`, `Escape`, `Entity`, `HardBreak`.
- Delimiter tokens (the things you hide): `HeaderMark`, `QuoteMark`, `ListMark`,
  `LinkMark`, `EmphasisMark`, `CodeMark`, `CodeInfo`, `CodeText`, `LinkTitle`, `LinkLabel`.
- From the GFM extension: `Table`, `TableHeader`, `TableRow`, `TableCell`, `TableDelimiter`,
  `Task`, `TaskMarker`, `Strikethrough`, `StrikethroughMark`.

### 4.2 Plugin shape

Two pieces, because CM6 has a rule: block-level decorations (widgets that replace whole
lines, such as an image or a rendered table) must come from a `StateField`, while a
`ViewPlugin` may only provide inline decorations and must not let a replace cross a line
break.

1. `inlinePreview`: a `ViewPlugin` that rebuilds a `DecorationSet` on `docChanged`,
   `selectionSet`, `focusChanged`, and when the parse tree grows. It walks
   `syntaxTree(view.state).iterate(...)` once and emits:
   - `Decoration.line({class: "md-h1"})` on heading lines, unconditionally, so font size never
     depends on cursor position.
   - `Decoration.mark({class: "md-strong"})` over the content of emphasis, code, links.
   - `Decoration.replace({})` over `HeaderMark`, `EmphasisMark`, `CodeMark`, `LinkMark`,
     `URL`, `LinkTitle` when the element is not active.
   - `Decoration.replace({widget: new BulletWidget()})` over `ListMark`, and a checkbox
     widget over `TaskMarker` that dispatches `[ ]`/`[x]` on click.
2. `blockPreview`: a `StateField<DecorationSet>` for images, tables, math blocks, and
   mermaid, producing `Decoration.replace({widget, block: true})` over the whole block when
   no selection touches it. When the selection enters, the block drops back to raw text (or,
   for tables, to a cell-editing widget).

### 4.3 What counts as "active"

- Compute the set of lines intersecting every selection range. Block delimiters reveal on
  those lines.
- For inline elements, reveal only when a selection range touches the node's `[from, to]`
  range. That is the Typora nuance (Obsidian reveals the whole line). Atomic Editor already
  does this for links via an `activeLinkStarts` set; extend it to emphasis and code.
- If any line of a fenced block is active, the whole fence is active.
- Read-only mode: nothing is active, everything renders.
- Unfocused editor: nothing is active. (Decide this deliberately; Typora keeps the last
  element revealed, Obsidian hides everything on blur.)

### 4.4 Keeping layout stable

- Hidden delimiters are empty `replace` decorations, not removed text, so the DOM keeps the
  characters and widths are predictable.
- Heading size and weight come from line decorations applied in both states.
- List bullets live in a fixed-width "alcove" (around 1.2em) set in CSS, not measured from
  the marker glyph, so `-` and `•` occupy the same width.
- Never put `display: none` on a source line; keep an empty line above an image widget.
- Freeze decoration rebuilds between `pointerdown` and `pointerup` (plus ~100 ms), so the
  text does not shift under the mouse mid-click. Document changes still rebuild.

### 4.5 Mid-typing flicker

CommonMark's flanking rules mean `**foo` or `**foo **` is not yet emphasis, so the parser
emits nothing and the styling flickers on and off while typing. Add a small supplemental pass
on the active line that styles unbalanced delimiters as "pending emphasis" so the visual
state is continuous.

### 4.6 Skeleton

```ts
import { ViewPlugin, Decoration, DecorationSet, EditorView, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

const HIDE = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "LinkMark", "URL", "LinkTitle", "StrikethroughMark"]);
const LINE_CLASS: Record<string, string> = { ATXHeading1: "md-h1", ATXHeading2: "md-h2", ATXHeading3: "md-h3", Blockquote: "md-quote" };
const MARK_CLASS: Record<string, string> = { StrongEmphasis: "md-strong", Emphasis: "md-em", InlineCode: "md-code", Link: "md-link", Strikethrough: "md-strike" };

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const sel = state.selection.ranges;
  const touches = (from: number, to: number) => sel.some(r => r.from <= to && r.to >= from);
  const activeLines = new Set<number>();
  for (const r of sel) for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) activeLines.add(l);

  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      const n = node.name;
      if (LINE_CLASS[n]) {
        const line = state.doc.lineAt(node.from);
        ranges.push({ from: line.from, to: line.from, deco: Decoration.line({ class: LINE_CLASS[n] }) });
      }
      if (MARK_CLASS[n] && node.to > node.from) {
        ranges.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: MARK_CLASS[n] }) });
      }
      if (HIDE.has(n)) {
        const parent = node.node.parent!;
        const isBlockMark = n === "HeaderMark" || n === "QuoteMark";
        const active = isBlockMark
          ? activeLines.has(state.doc.lineAt(node.from).number)   // block marks: line-level reveal
          : touches(parent.from, parent.to);                       // inline marks: element-level reveal (Typora)
        if (!active) ranges.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
      }
    },
  });
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const b = new RangeSetBuilder<Decoration>();
  for (const r of ranges) b.add(r.from, r.to, r.deco);
  return b.finish();
}

export const inlinePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.focusChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = build(u.view);
  }
}, { decorations: v => v.decorations });
```

This is the whole idea; the real version adds per-line splitting of replace ranges (a
`ViewPlugin` replace may not cross a newline), widgets, the freeze guard, and the
`ensureSyntaxTree` call so content beyond the parser's first pass is not left raw.

## 5. Visual language: Apple chrome, Notion surfaces, Typora column

### 5.1 Typography

| Role | Value | Source of the convention |
|---|---|---|
| UI chrome | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif` at 13px | macOS standard control size; Notion UI is Inter-based. SF Pro is picked up automatically on macOS; do not bundle it. |
| Editor body | same stack at 16px, line-height 1.6 | Typora's default theme (`github.css`) uses 16px/1.6; Notion pages are 16px. |
| Headings | H1 2.0 to 2.25em / 700, H2 1.5 to 1.75em / 600, H3 1.25em / 600, line-height 1.2 to 1.4 | Typora: 2.25/1.75/1.5em bold. Notion: 30/24/20px. Pick the Notion sizes for a softer look. |
| Monospace | `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace` at 0.9em | Typora sets code at 0.9em. |
| Measure | 700 to 860px column, `margin: 0 auto`, 30px side padding | Typora `#write` is 860px max (1024px above 1400px viewports). Notion's content column is ~708px. |

### 5.2 Color tokens

Light mode (Notion's warm neutrals; these are from third-party reconstructions and a color
picker study, not an official Notion spec, so sanity-check against the app):

```css
:root {
  --bg: #ffffff;
  --bg-sidebar: #f7f6f3;             /* Notion sidebar; swap for vibrancy on macOS */
  --bg-hover: rgba(55, 53, 47, 0.08);
  --bg-selected: rgba(35, 131, 226, 0.14);
  --text: #37352f;
  --text-secondary: rgba(55, 53, 47, 0.65);
  --text-tertiary: rgba(55, 53, 47, 0.45);
  --border: rgba(55, 53, 47, 0.09);
  --accent: #2383e2;                 /* Notion blue; Apple systemBlue is #007aff if you prefer */
  --selection: rgba(35, 131, 226, 0.28);
  --code-text: #eb5757;
  --code-bg: rgba(135, 131, 120, 0.15);
  --quote-border: #dfe2e5;           /* Typora */
  --radius-sm: 3px; --radius-md: 6px; --radius-lg: 10px;
  --shadow-popover: 0 0 0 1px rgba(15,15,15,.05), 0 3px 6px rgba(15,15,15,.1), 0 9px 24px rgba(15,15,15,.2);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #191919;
    --bg-sidebar: #202020;
    --bg-hover: rgba(255, 255, 255, 0.055);
    --text: rgba(255, 255, 255, 0.81);   /* reads as ~#d4d4d4 */
    --text-secondary: rgba(255, 255, 255, 0.46);
    --border: rgba(255, 255, 255, 0.094);
    --accent: #529cca;
    --selection: rgba(82, 156, 202, 0.35);
  }
}
```

### 5.3 Layout and window chrome (macOS)

- Three columns: file tree sidebar (resizable, 220 to 300px), editor, optional outline or
  backlinks panel on the right. Sidebar and right panel collapse; editor column stays centered.
- Hidden title bar with the traffic lights inset into the sidebar. In Tauri 2:

```json
{
  "app": { "windows": [{
    "title": "Notes",
    "titleBarStyle": "Overlay",
    "hiddenTitle": true,
    "trafficLightPosition": { "x": 14, "y": 18 },
    "transparent": true,
    "windowEffects": { "effects": ["sidebar"], "state": "followsWindowActiveState" },
    "minWidth": 720, "minHeight": 480
  }]}
}
```

  `Overlay` requires a drag region (`data-tauri-drag-region` on the sidebar header and the
  editor's top strip) and the window cannot be dragged while unfocused. `windowEffects`
  requires `transparent: true`; the `sidebar` material gives the frosted translucent sidebar
  that Finder, Notes, and Mail use. On macOS 26 you can add `liquidGlassRegular` as a first
  effect and fall back to `sidebar`. In Electron the equivalent is
  `titleBarStyle: 'hiddenInset'`, `trafficLightPosition`, `vibrancy: 'sidebar'`, and
  `-webkit-app-region: drag`.
- Keep the editor surface opaque (`--bg`) and let only the sidebar be translucent.
- No toolbar. Formatting lives in keyboard shortcuts, a bubble toolbar that appears over a
  text selection, and a slash menu on `/` at the start of a line.
- Bottom-right word count that fades in on hover, Typora style.

### 5.4 Notion idioms worth copying, Apple idioms worth copying

- Notion: 1px hairlines in `--border`, 3px radius on inline chips, 6px on menus, a hover
  "+" and drag handle in the left gutter of each block, hover background rather than
  outlines, 150 ms `ease` transitions, popovers with the layered shadow above, pastel
  callout backgrounds, sidebar rows at 28px height with 13px text.
- Apple: SF Pro at 13px for all chrome, source-list sidebar with rounded (6px) selected
  rows and 4px side inset, vibrancy, native menu bar (Tauri `Menu` API) with standard
  shortcuts, `Cmd+,` for settings, `Cmd+Shift+F` for vault search, `Cmd+P`/`Cmd+O` for the
  quick switcher, system accent color respected where possible, smooth focus rings only for
  keyboard navigation.

## 6. Vault, files, and persistence

- Open a folder, walk it in Rust, send a tree to the UI. Ignore `.git`, `node_modules`, and
  a `.app/` config dir inside the vault.
- Watch the folder with `plugin-fs` `watch`. On an external change to the open file: if the
  editor is clean, reload; if dirty, show a non-modal "file changed on disk" banner with
  Reload / Keep mine.
- Autosave with a 500 ms debounce after the last keystroke, and on blur/close. Write
  atomically (write to a temp file, then rename) so a crash never leaves a half-written note.
- Store per-vault settings and workspace state (open tabs, sidebar width, scroll position) in
  the vault's `.app/` dir; global settings in `plugin-store`.
- Links: support `[[wiki links]]` and standard links. Maintain a link graph in the Rust
  index for backlinks and for rename refactoring.
- Images: on paste, write to `attachments/` next to the note and insert `![](attachments/x.png)`.

## 7. Phased plan

| Phase | Scope | Exit criterion |
|---|---|---|
| 0. Spike (about a week) | Tauri 2 + Vite + React, CM6 with `lang-markdown`, headings/bold/italic/code hide-on-inactive, Overlay title bar, sidebar vibrancy | Typing feels right on macOS; no layout shift when clicking into a heading. |
| 1. Editor core | Full inline set, lists, tasks, quotes, hr, fences with language highlighting, links, element-level reveal, mid-typing supplement, freeze guard, `markdownKeymap`, history, find/replace | Can write a long document without ever wanting source mode. |
| 2. Vault | Open folder, tree, create/rename/delete, watcher, autosave, atomic writes, quick switcher, recent files, tabs | Daily-driver for plain notes. |
| 3. Widgets | Image blocks, table widget with cell editing, KaTeX, Mermaid, task checkboxes, wiki links + backlinks, outline panel | Parity with Typora's block rendering. |
| 4. Polish | Settings UI, themes, export HTML/PDF, command palette, native menus, auto-update, code signing and notarization, Windows/Linux pass | Shippable. |

## 8. Risks and gotchas

- Three webviews with Tauri. WKWebView has its own caret, IME, and momentum-scroll
  behaviours; test Japanese/Chinese input early because decorations interact with
  composition.
- Tables are the hardest widget in a source-first editor. Plan the table widget as its own
  mini-editor (cell focus, Tab navigation, serialize back to pipes).
- Non-standard syntax (highlight, wiki links, math, callouts, front matter) needs Lezer
  parser extensions. Each is small but there are several.
- Whole-tree decoration rebuilds are O(document). Fine to tens of thousands of lines; add
  viewport-scoped rebuilding only if profiling demands it.
- `Overlay` title bars cannot be dragged when the window is unfocused (Tauri docs caveat).
- MarkText is MIT and the most complete Typora clone, but effectively unmaintained; use it as
  a design reference, not a dependency.

## 9. Reference projects

| Project | Model | Stack | License | Status / use |
|---|---|---|---|---|
| Atomic Editor | Source-first decorations | React + CM6 | MIT | Best reference for section 4; could be used as a base. |
| TypeDown | Source-first | Tauri 2 + SvelteKit + CM6 | MIT | Small, shows the exact shell combo recommended here. |
| Obsidian | Source-first | Electron + CM6 | Proprietary | The UX bar for a local vault; its internals are not accessible to plugins. |
| Milkdown / Crepe | Model-first | ProseMirror + remark | MIT | ~12k stars; pick if you decide Notion-style block editing matters more than round trip. |
| Tiptap + `@tiptap/markdown` | Model-first | ProseMirror + marked | MIT (core) | Official bidirectional Markdown since Tiptap 3.7; still fixing round-trip edge cases in 3.20.x. |
| MarkText | Model-first (Muya) | Electron + Vue | MIT | 63k stars, "in development", no recent releases. Design reference only. |
| Zettlr | Source-first | Electron + CM6 | GPL-3 | Active, academic focus; good for seeing CM6 markdown extensions in production. |
| Typora | Model-first (custom) | Electron | Proprietary | The target behaviour; its themes are plain CSS (`github.css` values used above). |

## Sources

- Atomic Editor: https://github.com/kenforthewin/atomic-editor and its `src/inline-preview.ts`
- TypeDown: https://github.com/gupsammy/typedown
- Obsidian forum on Live Preview internals: https://forum.obsidian.md/t/plugin-api-expose-live-edit-functionality-for-extension/73447 and https://forum.obsidian.md/t/to-hide-markdown-syntax-in-live-preview-so-it-doesnt-show-formatting-markers/109155
- CodeMirror lang-markdown: https://github.com/codemirror/lang-markdown
- Lezer Markdown node types: https://github.com/lezer-parser/markdown (`src/markdown.ts`)
- CodeMirror forum, ProseMirror vs CodeMirror: https://discuss.codemirror.net/t/should-i-use-prosemirror-or-codemirror/4168 and https://discuss.codemirror.net/t/implementing-wysiwyg-markdown-editor-in-codemirror/2403
- Milkdown: https://github.com/Milkdown/milkdown
- Tiptap bidirectional Markdown: https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap
- MarkText: https://github.com/marktext/marktext
- Typora default theme values: https://raw.githubusercontent.com/typora/typora-default-themes/master/themes/github.css
- Tauri 2 window customization and config (`TitleBarStyle`, `trafficLightPosition`, `windowEffects`): https://github.com/tauri-apps/tauri-docs (learn/window-customization.mdx) and https://github.com/tauri-apps/tauri (crates/tauri-utils/src/config.rs, lib.rs)
- Tauri vs Electron size and memory: https://dev.to/gethopp/tauri-vs-electron-performance-bundle-size-and-the-real-trade-offs-1el4
- Electron hidden title bar and vibrancy: https://github.com/electron/electron/issues/14529
- Notion color reconstructions: https://www.oppadu.com/tools/design-systems-site/brand/notion.html, https://dev.classmethod.jp/articles/check-notion-contrast-ratio-by-change-color/, https://community.obsidian.md/themes/notion-style
