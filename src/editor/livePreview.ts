/**
 * Typora-style live preview for CodeMirror 6.
 *
 * The document is always plain Markdown. This extension builds a decoration
 * set from the Lezer syntax tree that:
 *   - styles rendered content (headings, emphasis, code, links, quotes, lists)
 *   - hides delimiter tokens unless the caret is inside the element they belong to
 *   - swaps whole constructs for widgets (checkboxes, bullets, images, tables,
 *     math, horizontal rules, code-fence language labels)
 *
 * Layout stability rules (so nothing jumps when you click into a line):
 *   - heading size/weight come from line classes that apply in both states
 *   - block delimiters (`#`, `>`, `- [ ]`) render in the left margin when
 *     revealed, so the text never shifts
 *   - bullet markers and their revealed `-` share one fixed-width box
 */
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { EditorState, Facet, StateEffect, StateField, type Extension, type Range, type Text, type Transaction } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";
import {
  BulletWidget,
  CheckboxWidget,
  HrWidget,
  ImageWidget,
  LangLabelWidget,
  LinePlaceholderWidget,
  TableWidget,
  type TableCell,
  type TableData,
} from "./widgets";
import { MathWidget } from "./mathRender";
import { mathTex } from "./mathSyntax";

export interface LivePreviewOptions {
  /** Turn an image `src` from the document into a loadable URL. */
  resolveImage?: (src: string) => string;
}

export const livePreviewConfig = Facet.define<LivePreviewOptions, LivePreviewOptions>({
  combine: (values) => values[0] ?? {},
});

// ---------------------------------------------------------------------------
// Focus tracking. Decorations depend on whether the editor has focus: an
// unfocused editor renders everything.

export const setFocused = StateEffect.define<boolean>();

export const focusedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) value = e.value;
    return value;
  },
});

const focusTracker = EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing));

/**
 * CodeMirror reports focus changes on a short timer, and a "focus lost" effect
 * queued during a dispatch can land after `view.focus()` has already run
 * (select-then-focus flows such as the outline panel). When that happens the
 * field says "unfocused" while the editor has focus, and CodeMirror sees no
 * further change to report. This plugin re-syncs the field after updates.
 */
const focusReconciler = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private dead = false;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (update.state.field(focusedField, false) !== update.view.hasFocus) this.schedule();
    }
    schedule() {
      if (this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.dead) return;
        const field = this.view.state.field(focusedField, false);
        if (field !== undefined && field !== this.view.hasFocus) {
          this.view.dispatch({ effects: setFocused.of(this.view.hasFocus) });
        }
      }, 20);
    }
    destroy() {
      this.dead = true;
      if (this.timer) clearTimeout(this.timer);
    }
  },
);

// ---------------------------------------------------------------------------

const markDeco = (cls: string) => Decoration.mark({ class: cls });
const hide = Decoration.replace({});
const dim = markDeco("cm-md-mark");
/** Revealed link syntax, which wraps with the text instead of staying on one line. */
const linkDim = markDeco("cm-md-mark cm-md-link-syntax");
const urlDim = markDeco("cm-md-mark cm-md-link-syntax cm-md-url");
/** TeX source of inline math on the caret's line. */
const mathSrc = markDeco("cm-md-math-src");
const marginMark = markDeco("cm-md-mark cm-md-margin-mark");
const lineDeco = (cls: string) => Decoration.line({ class: cls });

function frontMatterRange(doc: Text): { from: number; to: number } | null {
  if (doc.lines < 2) return null;
  const first = doc.line(1);
  if (first.text.trim() !== "---") return null;
  for (let i = 2; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (/^(---|\.\.\.)\s*$/.test(line.text)) return { from: first.from, to: line.to };
  }
  return null;
}

function listDepth(item: SyntaxNode): number {
  let depth = 0;
  for (let n: SyntaxNode | null = item.parent; n; n = n.parent) {
    if (n.name === "ListItem") depth++;
  }
  return depth;
}

function childText(node: SyntaxNode, name: string, doc: Text): string | null {
  const child = node.getChild(name);
  return child ? doc.sliceString(child.from, child.to) : null;
}

function parseTable(node: SyntaxNode, doc: Text): TableData {
  const aligns: TableCell["align"][] = [];
  const delimiterRow = node.getChild("TableDelimiter");
  if (delimiterRow) {
    const text = doc.sliceString(delimiterRow.from, delimiterRow.to);
    for (const part of text.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|")) {
      const t = part.trim();
      const left = t.startsWith(":");
      const right = t.endsWith(":");
      aligns.push(left && right ? "center" : right ? "right" : left ? "left" : null);
    }
  }
  const readRow = (row: SyntaxNode): TableCell[] => {
    const cells: TableCell[] = [];
    let i = 0;
    for (let c = row.firstChild; c; c = c.nextSibling) {
      if (c.name !== "TableCell") continue;
      cells.push({
        text: doc.sliceString(c.from, c.to).trim(),
        offset: c.from - node.from,
        align: aligns[i] ?? null,
      });
      i++;
    }
    return cells;
  };
  const headerNode = node.getChild("TableHeader");
  const header = headerNode ? readRow(headerNode) : [];
  const rows = node.getChildren("TableRow").map(readRow);
  return { header, rows };
}

// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Only decorate this range (the viewport). Defaults to the whole document. */
  from?: number;
  to?: number;
  /**
   * "widget" renders inactive tables as block widgets (whole-document builds,
   * tests). "skip" leaves them to `blockField`, because view plugins may not
   * provide block decorations.
   */
  tables?: "widget" | "skip";
}

/**
 * Build the decoration set for a state, for the whole document or one range.
 * Exported for tests.
 */
export function buildDecorations(state: EditorState, focused = state.field(focusedField, false) ?? true, opts: BuildOptions = {}): DecorationSet {
  const doc = state.doc;
  const rangeFrom = Math.max(0, opts.from ?? 0);
  const rangeTo = Math.min(doc.length, opts.to ?? doc.length);
  const tableMode = opts.tables ?? "widget";
  const config = state.facet(livePreviewConfig);
  const resolveImage = config.resolveImage ?? ((s: string) => s);
  const ranges = focused ? state.selection.ranges : [];

  const activeLines = new Set<number>();
  for (const r of ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let l = a; l <= b; l++) activeLines.add(l);
  }
  const touches = (from: number, to: number) => {
    for (const r of ranges) if (r.from <= to && r.to >= from) return true;
    return false;
  };
  const lineActive = (pos: number) => activeLines.has(doc.lineAt(pos).number);
  const lineRange = (from: number, to: number) => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(to).number;
    const out: number[] = [];
    for (let l = a; l <= b; l++) out.push(doc.line(l).from);
    return out;
  };

  const tree: Tree = ensureSyntaxTree(state, rangeTo, 100) ?? syntaxTree(state);
  const out: Range<Decoration>[] = [];
  let skipUntil = -1;

  // Hint on an empty line that holds the (single, empty) cursor.
  if (focused && ranges.length === 1 && ranges[0].empty && doc.length > 0) {
    const line = doc.lineAt(ranges[0].from);
    if (line.length === 0) {
      out.push(Decoration.widget({ widget: new LinePlaceholderWidget("Type / for commands"), side: 1 }).range(line.from));
    }
  }

  /** Blocks whose blank lines keep full height (code, tables, raw HTML, front matter). */
  const keepBlankLines: { from: number; to: number }[] = [];

  const fm = frontMatterRange(doc);
  if (fm) keepBlankLines.push(fm);
  if (fm) {
    for (const from of lineRange(fm.from, fm.to)) if (from >= rangeFrom && from <= rangeTo) out.push(lineDeco("cm-md-frontmatter").range(from));
    skipUntil = fm.to;
  }

  const hideOrDim = (from: number, to: number, active: boolean, activeDeco: Decoration = dim) => {
    if (to <= from) return;
    out.push((active ? activeDeco : hide).range(from, to));
  };

  /** Hide leading spaces or tabs between `from` and `to` (list indentation). */
  const hideIndent = (from: number, to: number) => {
    if (to > from && /^[ \t]+$/.test(doc.sliceString(from, to))) out.push(hide.range(from, to));
  };

  const innermostListItem = (pos: number): SyntaxNode | null => {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
      if (node.name === "ListItem") return node;
    }
    return null;
  };

  const insideCode = (pos: number): boolean => {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
      if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "Table" || node.name === "HTMLBlock" || node.name === "BlockMath") return true;
    }
    return false;
  };

  tree.iterate({
    from: rangeFrom,
    to: rangeTo,
    enter: (n: SyntaxNodeRef): boolean | void => {
      if (n.name !== "Document" && n.from < skipUntil) return false;

      switch (n.name) {
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6": {
          const level = n.name.slice(-1);
          out.push(lineDeco(`cm-md-heading cm-md-h${level}`).range(doc.lineAt(n.from).from));
          return;
        }
        case "SetextHeading1":
        case "SetextHeading2": {
          const level = n.name.slice(-1);
          const lines = lineRange(n.from, n.to);
          for (let i = 0; i < lines.length; i++) {
            out.push(lineDeco(i === lines.length - 1 ? "cm-md-setext-underline" : `cm-md-heading cm-md-h${level}`).range(lines[i]));
          }
          return;
        }
        case "HeaderMark": {
          const parent = n.node.parent;
          if (!parent) return;
          if (parent.name.startsWith("ATXHeading")) {
            const active = lineActive(n.from);
            if (n.from === parent.from) {
              let to = n.to;
              while (to < doc.length && doc.sliceString(to, to + 1) === " ") to++;
              hideOrDim(n.from, to, active, marginMark);
            } else {
              // closing #'s
              let from = n.from;
              while (from > parent.from && doc.sliceString(from - 1, from) === " ") from--;
              hideOrDim(from, n.to, active);
            }
          } else {
            out.push(dim.range(n.from, n.to));
          }
          return;
        }

        case "Emphasis":
          out.push(markDeco("cm-md-em").range(n.from, n.to));
          return;
        case "StrongEmphasis":
          out.push(markDeco("cm-md-strong").range(n.from, n.to));
          return;
        case "Strikethrough":
          out.push(markDeco("cm-md-strike").range(n.from, n.to));
          return;
        case "InlineCode":
          out.push(markDeco("cm-md-inline-code").range(n.from, n.to));
          return;
        case "EmphasisMark":
        case "StrikethroughMark":
        case "CodeMark": {
          const parent = n.node.parent;
          if (!parent || parent.name === "FencedCode") return;
          hideOrDim(n.from, n.to, touches(parent.from, parent.to));
          return;
        }

        case "Link": {
          const node = n.node;
          const active = touches(n.from, n.to);
          const url = childText(node, "URL", doc) ?? "";
          out.push(
            Decoration.mark({
              class: "cm-md-link",
              attributes: { "data-href": url, title: url },
            }).range(n.from, n.to),
          );
          if (!active) {
            const marks = node.getChildren("LinkMark");
            const open = marks[0];
            const close = marks[1];
            if (open) out.push(hide.range(open.from, open.to));
            if (close) out.push(hide.range(close.from, n.to));
          }
          return;
        }
        case "Autolink": {
          const node = n.node;
          const active = touches(n.from, n.to);
          const url = childText(node, "URL", doc) ?? doc.sliceString(n.from + 1, n.to - 1);
          out.push(Decoration.mark({ class: "cm-md-link", attributes: { "data-href": url } }).range(n.from, n.to));
          if (!active) for (const m of node.getChildren("LinkMark")) out.push(hide.range(m.from, m.to));
          return;
        }
        case "LinkMark":
        case "LinkTitle":
        case "LinkLabel": {
          const parent = n.node.parent;
          if (!parent) return;
          if (parent.name === "Link" || parent.name === "Autolink" || parent.name === "Image") {
            if (touches(parent.from, parent.to)) out.push(linkDim.range(n.from, n.to));
          }
          return;
        }
        case "URL": {
          const parent = n.node.parent;
          if (!parent) return;
          if (parent.name === "Link" || parent.name === "Autolink" || parent.name === "Image") {
            if (touches(parent.from, parent.to)) out.push(urlDim.range(n.from, n.to));
          } else {
            // bare URL (GFM autolink)
            const url = doc.sliceString(n.from, n.to);
            out.push(Decoration.mark({ class: "cm-md-link", attributes: { "data-href": url } }).range(n.from, n.to));
          }
          return;
        }

        case "Image": {
          const node = n.node;
          const active = touches(n.from, n.to);
          if (!active) {
            const src = childText(node, "URL", doc) ?? "";
            const marks = node.getChildren("LinkMark");
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
            out.push(Decoration.replace({ widget: new ImageWidget(resolveImage(src), alt) }).range(n.from, n.to));
            skipUntil = n.to;
            return false;
          }
          return;
        }

        // Math: rendered by KaTeX away from the caret, TeX source at it.
        // Blocks are drawn by the block field (buildBlockDecorations); here
        // they only get their source styling.
        case "InlineMath": {
          if (touches(n.from, n.to)) {
            out.push(mathSrc.range(n.from, n.to));
            return;
          }
          const display = doc.sliceString(n.from, n.from + 2) === "$$";
          out.push(Decoration.replace({ widget: new MathWidget(mathTex(n.node, doc), display, "inline") }).range(n.from, n.to));
          return false;
        }
        case "BlockMath": {
          const closed = n.node.getChildren("MathMark").length >= 2;
          if (closed && !touches(n.from, n.to)) return false;
          for (const from of lineRange(n.from, n.to)) if (from >= rangeFrom && from <= rangeTo) out.push(lineDeco("cm-md-math-line").range(from));
          return;
        }
        case "MathMark": {
          const parent = n.node.parent;
          if (parent && touches(parent.from, parent.to)) out.push(dim.range(n.from, n.to));
          return;
        }

        case "FencedCode": {
          keepBlankLines.push({ from: n.from, to: n.to });
          const node = n.node;
          const active = touches(n.from, n.to);
          const firstLine = doc.lineAt(n.from);
          const lastLine = doc.lineAt(n.to);
          const marks = node.getChildren("CodeMark");
          const openMark = marks[0];
          const closeMark = marks.length > 1 ? marks[marks.length - 1] : null;
          const info = node.getChild("CodeInfo");
          const headEnd = info ? info.to : openMark ? openMark.to : n.from;
          const lang = info ? doc.sliceString(info.from, info.to).trim() : "";
          for (let l = firstLine.number; l <= lastLine.number; l++) {
            const line = doc.line(l);
            let cls = "cm-md-fence";
            if (l === firstLine.number) cls += " cm-md-fence-head";
            if (closeMark && l === lastLine.number) cls += " cm-md-fence-foot";
            if (active) cls += " cm-md-fence-active";
            out.push(lineDeco(cls).range(line.from));
          }
          if (openMark && headEnd > n.from) {
            if (active) out.push(dim.range(n.from, headEnd));
            else out.push(Decoration.replace({ widget: new LangLabelWidget(lang) }).range(n.from, headEnd));
          }
          if (closeMark) hideOrDim(closeMark.from, closeMark.to, active);
          return;
        }
        case "CodeBlock": {
          keepBlankLines.push({ from: n.from, to: n.to });
          for (const from of lineRange(n.from, n.to)) out.push(lineDeco("cm-md-fence cm-md-indented-code").range(from));
          return;
        }

        case "Blockquote": {
          for (const from of lineRange(n.from, n.to)) out.push(lineDeco("cm-md-quote").range(from));
          return;
        }
        case "QuoteMark": {
          let to = n.to;
          if (doc.sliceString(to, to + 1) === " ") to++;
          hideOrDim(n.from, to, lineActive(n.from), marginMark);
          return;
        }

        case "ListItem": {
          // Lists get real nesting and hanging indents: the line is padded by
          // depth + marker width and the first line is pulled back by the marker
          // width (CSS in editor.css), so wrapped lines align with the text.
          const node = n.node;
          const depth = listDepth(node);
          const task = node.getChild("Task");
          const kind = task ? "task" : node.parent?.name === "OrderedList" ? "ol" : "ul";
          let cls = `cm-md-li cm-md-li-${Math.min(depth, 5)} cm-md-li-${kind}`;
          if (task) {
            const marker = task.getChild("TaskMarker");
            const checked = marker ? /x/i.test(doc.sliceString(marker.from, marker.to)) : false;
            cls += checked ? " cm-md-task cm-md-task-done" : " cm-md-task";
          }
          const first = doc.lineAt(n.from);
          const style = `--li-depth: ${depth}`;
          out.push(Decoration.line({ class: cls, attributes: { style } }).range(first.from));
          // Indentation is drawn by the padding, so hide the raw spaces. They stay
          // hidden on the active line too, so nothing moves when the caret arrives.
          hideIndent(first.from, n.from);
          // Continuation lines of this item (not nested items or code) share the indent.
          const last = doc.lineAt(n.to);
          for (let l = first.number + 1; l <= last.number; l++) {
            const line = doc.line(l);
            const textStart = line.from + (/^[ \t]*/.exec(line.text)?.[0].length ?? 0);
            if (textStart === line.to) continue;
            if (innermostListItem(textStart)?.from !== node.from) continue;
            if (insideCode(textStart)) continue;
            out.push(Decoration.line({ class: `cm-md-li-cont cm-md-li-${kind}`, attributes: { style } }).range(line.from));
            hideIndent(line.from, textStart);
          }
          return;
        }
        case "ListMark": {
          const item = n.node.parent;
          const list = item?.parent;
          if (!item || !list) return;
          const active = lineActive(n.from);
          const task = item.getChild("Task");
          const marker = task?.getChild("TaskMarker");
          if (marker && marker.from >= n.to) {
            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
            let to = marker.to;
            if (doc.sliceString(to, to + 1) === " ") to++;
            // On the caret's line the raw "- [ ]" shows beside the checkbox.
            const source = active ? doc.sliceString(n.from, marker.to) : null;
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked, source), atomic: true }).range(n.from, to));
            return;
          }
          // The marker box includes the space after it, so the text starts at the
          // same place whether the raw marker or the rendered bullet is showing.
          const to = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
          if (list.name === "BulletList") {
            if (active) out.push(markDeco("cm-md-listmark").range(n.from, to));
            else out.push(Decoration.replace({ widget: new BulletWidget(listDepth(item)) }).range(n.from, to));
          } else {
            out.push(markDeco("cm-md-olmark").range(n.from, to));
          }
          return;
        }
        case "Task":
        case "TaskMarker":
          return;

        case "HorizontalRule": {
          const active = lineActive(n.from);
          out.push(lineDeco("cm-md-hr-line").range(doc.lineAt(n.from).from));
          if (active) out.push(dim.range(n.from, n.to));
          else out.push(Decoration.replace({ widget: new HrWidget() }).range(n.from, n.to));
          return;
        }

        case "Table": {
          const node = n.node;
          const active = touches(n.from, n.to);
          const firstLine = doc.lineAt(n.from);
          const lastLine = doc.lineAt(n.to);
          if (!active) {
            if (tableMode === "widget") {
              out.push(
                Decoration.replace({ widget: new TableWidget(parseTable(node, doc)), block: true }).range(firstLine.from, lastLine.to),
              );
            }
            skipUntil = lastLine.to;
            return false;
          }
          for (const from of lineRange(n.from, n.to)) out.push(lineDeco("cm-md-table-raw").range(from));
          return;
        }
        case "TableDelimiter":
          out.push(dim.range(n.from, n.to));
          return;

        case "Escape": {
          hideOrDim(n.from, n.from + 1, lineActive(n.from));
          return;
        }

        case "HTMLBlock":
        case "CommentBlock":
          keepBlankLines.push({ from: n.from, to: n.to });
          out.push(markDeco("cm-md-html").range(n.from, n.to));
          return;
        case "HTMLTag":
          out.push(markDeco("cm-md-html").range(n.from, n.to));
          return;
      }
    },
  });

  // Blank lines between blocks are shorter than text lines, so paragraphs and
  // headings are spaced like a page rather than by a full empty line.
  let keep = 0;
  const lastLineInRange = doc.lineAt(rangeTo).number;
  for (let l = doc.lineAt(rangeFrom).number; l <= lastLineInRange; l++) {
    const line = doc.line(l);
    if (line.length > 0 && line.text.trim() !== "") continue;
    while (keep < keepBlankLines.length && keepBlankLines[keep].to < line.from) keep++;
    if (keepBlankLines.some((r, i) => i >= keep && r.from <= line.from && r.to >= line.to)) continue;
    out.push(lineDeco("cm-md-blank").range(line.from));
  }

  // Mark the caret's lines so focus mode can dim everything else.
  for (const l of activeLines) {
    const from = doc.line(l).from;
    if (from >= rangeFrom && from <= rangeTo) out.push(lineDeco("cm-md-active").range(from));
  }

  return Decoration.set(out, true);
}

function treeChanged(a: EditorState, b: EditorState): boolean {
  return syntaxTree(a) !== syntaxTree(b);
}

/** Containers a GFM table can sit inside; everything else is skipped when looking for tables. */
const BLOCK_CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

/**
 * Rendered tables are block widgets, which view plugins may not provide, so they
 * live in this field. It only walks block containers, so it stays cheap even in
 * long notes.
 */
/**
 * Block widgets: tables, and `$$` math blocks. They replace whole lines,
 * which a view plugin may not do, so they live in a state field. Away from
 * the caret a table or formula is drawn in place of its source; at the caret,
 * a table shows its source and a formula shows its source with a live
 * preview underneath. Exported for tests.
 */
export function buildBlockDecorations(state: EditorState, focused = state.field(focusedField, false) ?? true): DecorationSet {
  const doc = state.doc;
  const ranges = focused ? state.selection.ranges : [];
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(n) {
      if (n.name === "Table" || n.name === "BlockMath") {
        const active = ranges.some((r) => r.from <= n.to && r.to >= n.from);
        const first = doc.lineAt(n.from);
        const last = doc.lineAt(n.to);
        if (n.name === "Table") {
          if (!active) out.push(Decoration.replace({ widget: new TableWidget(parseTable(n.node, doc)), block: true }).range(first.from, last.to));
        } else {
          const tex = mathTex(n.node, doc);
          const closed = n.node.getChildren("MathMark").length >= 2;
          if (active) out.push(Decoration.widget({ widget: new MathWidget(tex, true, "preview"), block: true, side: 1 }).range(last.to));
          else if (closed) out.push(Decoration.replace({ widget: new MathWidget(tex, true, "block"), block: true }).range(first.from, last.to));
        }
        return false;
      }
      return BLOCK_CONTAINERS.has(n.name) ? undefined : false;
    },
  });
  // An image at the caret shows its source, with the picture underneath so
  // you can see what the link points at.
  const resolveImage = state.facet(livePreviewConfig).resolveImage ?? ((s: string) => s);
  const previewed = new Set<number>();
  for (const r of ranges) {
    const line = doc.lineAt(r.head);
    syntaxTree(state).iterate({
      from: line.from,
      to: line.to,
      enter(n) {
        if (n.name === "Table" || n.name === "BlockMath" || n.name === "FencedCode") return false;
        if (n.name !== "Image" || previewed.has(n.from) || r.from > n.to || r.to < n.from) return;
        previewed.add(n.from);
        const src = childText(n.node, "URL", doc);
        if (!src) return false;
        const marks = n.node.getChildren("LinkMark");
        const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
        out.push(Decoration.widget({ widget: new ImageWidget(resolveImage(src), alt, true), block: true, side: 1 }).range(doc.lineAt(n.to).to));
        return false;
      },
    });
  }
  return Decoration.set(out, true);
}

const needsRebuild = (u: { docChanged: boolean; startState: EditorState; state: EditorState; transactions: readonly Transaction[] }) =>
  u.docChanged ||
  u.transactions.some((tr) => !!tr.selection || tr.reconfigured || tr.effects.some((e) => e.is(setFocused))) ||
  treeChanged(u.startState, u.state);

export const blockField = StateField.define<DecorationSet>({
  create: (state) => buildBlockDecorations(state),
  update(deco, tr) {
    if (needsRebuild({ docChanged: tr.docChanged, startState: tr.startState, state: tr.state, transactions: [tr] })) return buildBlockDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Everything else is decorated only for the viewport, so the cost of a keystroke
 * or caret move depends on what is on screen, not on the length of the note.
 */
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    atomic: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.viewportChanged || needsRebuild(u)) this.build(u.view);
    }
    build(view: EditorView) {
      const { state } = view;
      const { from, to } = view.viewport;
      const doc = state.doc;
      // View plugins may not hide line breaks; leave any such range raw.
      this.decorations = buildDecorations(state, undefined, { from, to, tables: "skip" }).update({
        filter: (f, t, value) => !(value.point && t > f && doc.lineAt(f).number !== doc.lineAt(t).number),
      });
      this.atomic = this.decorations.update({ filter: (_f, _t, value) => !!value.spec.atomic });
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

/** Find the link URL under a DOM target, if the target is a rendered link. */
export function linkHrefAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(".cm-md-link");
  return el?.dataset.href || null;
}

export function livePreview(options: LivePreviewOptions = {}): Extension {
  return [livePreviewConfig.of(options), focusedField, focusTracker, focusReconciler, blockField, livePreviewPlugin];
}
