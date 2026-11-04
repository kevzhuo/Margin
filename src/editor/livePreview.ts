/**
 * Typora-style live preview for CodeMirror 6.
 *
 * The document is always plain Markdown. This extension builds a decoration
 * set from the Lezer syntax tree that:
 *   - styles rendered content (headings, emphasis, code, links, quotes, lists)
 *   - hides delimiter tokens unless the caret is inside the element they belong to
 *   - swaps whole constructs for widgets (checkboxes, bullets, images, tables,
 *     horizontal rules, code-fence language labels)
 *
 * Layout stability rules (so nothing jumps when you click into a line):
 *   - heading size/weight come from line classes that apply in both states
 *   - block delimiters (`#`, `>`, `- [ ]`) render in the left margin when
 *     revealed, so the text never shifts
 *   - bullet markers and their revealed `-` share one fixed-width box
 */
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { EditorState, Facet, StateEffect, StateField, type Extension, type Range, type Text } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";
import {
  BulletWidget,
  CheckboxWidget,
  GhostMarkWidget,
  HrWidget,
  ImageWidget,
  LangLabelWidget,
  TableWidget,
  type TableCell,
  type TableData,
} from "./widgets";

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

// ---------------------------------------------------------------------------

const markDeco = (cls: string) => Decoration.mark({ class: cls });
const hide = Decoration.replace({});
const dim = markDeco("cm-md-mark");
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

/**
 * Build the complete decoration set for a state. Exported for tests.
 */
export function buildDecorations(state: EditorState, focused = state.field(focusedField, false) ?? true): DecorationSet {
  const doc = state.doc;
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

  const tree: Tree = ensureSyntaxTree(state, doc.length, 150) ?? syntaxTree(state);
  const out: Range<Decoration>[] = [];
  let skipUntil = -1;

  const fm = frontMatterRange(doc);
  if (fm) {
    for (const from of lineRange(fm.from, fm.to)) out.push(lineDeco("cm-md-frontmatter").range(from));
    skipUntil = fm.to;
  }

  const hideOrDim = (from: number, to: number, active: boolean, activeDeco: Decoration = dim) => {
    if (to <= from) return;
    out.push((active ? activeDeco : hide).range(from, to));
  };

  tree.iterate({
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
            if (touches(parent.from, parent.to)) out.push(dim.range(n.from, n.to));
          }
          return;
        }
        case "URL": {
          const parent = n.node.parent;
          if (!parent) return;
          if (parent.name === "Link" || parent.name === "Autolink" || parent.name === "Image") {
            if (touches(parent.from, parent.to)) out.push(dim.range(n.from, n.to));
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

        case "FencedCode": {
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
          const node = n.node;
          const depth = listDepth(node);
          const task = node.getChild("Task");
          let cls = `cm-md-li cm-md-li-${Math.min(depth, 5)}`;
          if (task) {
            const marker = task.getChild("TaskMarker");
            const checked = marker ? /x/i.test(doc.sliceString(marker.from, marker.to)) : false;
            cls += checked ? " cm-md-task cm-md-task-done" : " cm-md-task";
          }
          out.push(lineDeco(cls).range(doc.lineAt(n.from).from));
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
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked), atomic: true }).range(n.from, to));
            if (active) {
              out.push(Decoration.widget({ widget: new GhostMarkWidget(doc.sliceString(n.from, marker.to)), side: -1 }).range(n.from));
            }
            return;
          }
          if (list.name === "BulletList") {
            if (active) out.push(markDeco("cm-md-listmark").range(n.from, n.to));
            else out.push(Decoration.replace({ widget: new BulletWidget(listDepth(item)) }).range(n.from, n.to));
          } else {
            out.push(markDeco("cm-md-olmark").range(n.from, n.to));
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
            out.push(
              Decoration.replace({ widget: new TableWidget(parseTable(node, doc)), block: true }).range(firstLine.from, lastLine.to),
            );
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
        case "HTMLTag":
        case "CommentBlock":
          out.push(markDeco("cm-md-html").range(n.from, n.to));
          return;
      }
    },
  });

  return Decoration.set(out, true);
}

function treeChanged(a: EditorState, b: EditorState): boolean {
  return syntaxTree(a) !== syntaxTree(b);
}

export const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(deco, tr) {
    const focusChanged = tr.effects.some((e) => e.is(setFocused));
    if (tr.docChanged || tr.selection || focusChanged || tr.reconfigured || treeChanged(tr.startState, tr.state)) {
      return buildDecorations(tr.state);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f).update({ filter: (_from, _to, value) => !!value.spec.atomic })),
  ],
});

/** Find the link URL under a DOM target, if the target is a rendered link. */
export function linkHrefAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(".cm-md-link");
  return el?.dataset.href || null;
}

export function livePreview(options: LivePreviewOptions = {}): Extension {
  return [livePreviewConfig.of(options), focusedField, focusTracker, livePreviewField];
}
