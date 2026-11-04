import { EditorSelection, type ChangeSpec, type EditorState, type SelectionRange } from "@codemirror/state";
import { EditorView, keymap, type Command, type KeyBinding } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { toggleTaskAt } from "./widgets";

function wrapRange(state: EditorState, range: SelectionRange, left: string, right: string) {
  const from = range.from;
  const to = range.to;
  const before = state.doc.sliceString(Math.max(0, from - left.length), from);
  const after = state.doc.sliceString(to, Math.min(state.doc.length, to + right.length));
  const inner = state.doc.sliceString(from, to);

  // Already wrapped outside the selection: unwrap.
  if (before === left && after === right) {
    return {
      changes: [
        { from: from - left.length, to: from, insert: "" },
        { from: to, to: to + right.length, insert: "" },
      ] as ChangeSpec,
      range: EditorSelection.range(from - left.length, to - left.length),
    };
  }
  // Selection includes the wrapper: unwrap.
  if (inner.startsWith(left) && inner.endsWith(right) && inner.length >= left.length + right.length) {
    return {
      changes: { from, to, insert: inner.slice(left.length, inner.length - right.length) },
      range: EditorSelection.range(from, to - left.length - right.length),
    };
  }
  return {
    changes: [
      { from, insert: left },
      { from: to, insert: right },
    ] as ChangeSpec,
    range: EditorSelection.range(from + left.length, to + left.length),
  };
}

/** Toggle an inline wrapper such as `**` around each selection. */
export function toggleInline(left: string, right = left): Command {
  return (view) => {
    const tr = view.state.changeByRange((range) => wrapRange(view.state, range, left, right));
    view.dispatch(tr, { scrollIntoView: true, userEvent: "input.format" });
    return true;
  };
}

/** Set, or clear when already set, an ATX heading level on every selected line. */
export function setHeading(level: number): Command {
  return (view) => {
    const { state } = view;
    const changes: ChangeSpec[] = [];
    const seen = new Set<number>();
    for (const range of state.selection.ranges) {
      const a = state.doc.lineAt(range.from).number;
      const b = state.doc.lineAt(range.to).number;
      for (let l = a; l <= b; l++) {
        if (seen.has(l)) continue;
        seen.add(l);
        const line = state.doc.line(l);
        const m = /^(#{1,6})\s+/.exec(line.text);
        const current = m ? m[1].length : 0;
        const prefixLen = m ? m[0].length : 0;
        const next = current === level || level === 0 ? "" : "#".repeat(level) + " ";
        changes.push({ from: line.from, to: line.from + prefixLen, insert: next });
      }
    }
    view.dispatch({ changes, userEvent: "input.format" });
    return true;
  };
}

export const toggleTask: Command = (view) => {
  const { state } = view;
  const head = state.selection.main.head;
  if (toggleTaskAt(view, head)) return true;
  // Not a task yet: turn the line into one.
  const line = state.doc.lineAt(head);
  const m = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line.text);
  if (m) {
    if (m[3]) return true;
    view.dispatch({ changes: { from: line.from + m[0].length, insert: "[ ] " } });
  } else {
    view.dispatch({ changes: { from: line.from + (/^\s*/.exec(line.text)?.[0].length ?? 0), insert: "- [ ] " } });
  }
  return true;
};

export const insertLink: Command = (view) => {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    const isUrl = /^https?:\/\//i.test(text);
    const insert = isUrl ? `[](${text})` : `[${text}](url)`;
    const cursorFrom = isUrl ? range.from + 1 : range.from + text.length + 3;
    const cursorTo = isUrl ? cursorFrom : cursorFrom + 3;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(cursorFrom, cursorTo) };
  });
  view.dispatch(tr, { userEvent: "input.format" });
  return true;
};

export const toggleBlockquote: Command = (view) => {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const a = state.doc.lineAt(range.from).number;
    const b = state.doc.lineAt(range.to).number;
    for (let l = a; l <= b; l++) {
      if (seen.has(l)) continue;
      seen.add(l);
      const line = state.doc.line(l);
      const m = /^>\s?/.exec(line.text);
      changes.push(m ? { from: line.from, to: line.from + m[0].length, insert: "" } : { from: line.from, insert: "> " });
    }
  }
  view.dispatch({ changes, userEvent: "input.format" });
  return true;
};

/** Jump the caret to the heading or element that contains `pos`. */
export function selectAt(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 48 }) });
  view.focus();
}

export function headingLevelAt(state: EditorState, pos: number): number {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos, 1);
  while (node.parent && !/^(ATX|Setext)Heading/.test(node.name)) node = node.parent;
  const m = /Heading(\d)/.exec(node.name);
  return m ? Number(m[1]) : 0;
}

export const formattingKeymap: KeyBinding[] = [
  { key: "Mod-b", run: toggleInline("**") },
  { key: "Mod-i", run: toggleInline("*") },
  { key: "Mod-e", run: toggleInline("`") },
  { key: "Mod-Shift-x", run: toggleInline("~~") },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-Enter", run: toggleTask },
  { key: "Mod-Shift-.", run: toggleBlockquote },
  { key: "Mod-1", run: setHeading(1) },
  { key: "Mod-2", run: setHeading(2) },
  { key: "Mod-3", run: setHeading(3) },
  { key: "Mod-4", run: setHeading(4) },
  { key: "Mod-5", run: setHeading(5) },
  { key: "Mod-6", run: setHeading(6) },
  { key: "Mod-0", run: setHeading(0) },
];

export const formattingKeys = keymap.of(formattingKeymap);
