import { EditorSelection, EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { livePreview } from "./livePreview";

/** Build an EditorState with the production markdown + live preview setup. */
export function stateOf(doc: string, selection?: number | { anchor: number; head?: number }): EditorState {
  let sel: EditorSelection | undefined;
  if (typeof selection === "number") sel = EditorSelection.single(selection);
  else if (selection) sel = EditorSelection.single(selection.anchor, selection.head ?? selection.anchor);
  return EditorState.create({
    doc,
    selection: sel,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: languages }), livePreview()],
  });
}

export type DecoKind = "line" | "mark" | "widget" | "replace";

export interface DecoInfo {
  from: number;
  to: number;
  kind: DecoKind;
  cls: string;
  widget: string;
  block: boolean;
  attrs: Record<string, string>;
  atomic: boolean;
  text: string;
  /** The widget instance itself, for widget-specific fields. */
  widgetObj: object | null;
}

/** Flatten a DecorationSet into plain objects for assertions. */
export function collect(set: DecorationSet, doc: string): DecoInfo[] {
  const out: DecoInfo[] = [];
  const cur = set.iter();
  while (cur.value) {
    const v = cur.value as unknown as {
      spec: { class?: string; widget?: object; block?: boolean; attributes?: Record<string, string>; atomic?: boolean };
      point: boolean;
      isReplace?: boolean;
      widget?: object;
      block?: boolean;
    };
    let kind: DecoKind;
    if ("isReplace" in v) kind = v.isReplace ? "replace" : "widget";
    else if (v.point) kind = "line";
    else kind = "mark";
    out.push({
      from: cur.from,
      to: cur.to,
      kind,
      cls: v.spec.class ?? "",
      widget: v.widget ? v.widget.constructor.name : "",
      block: !!v.block,
      attrs: v.spec.attributes ?? {},
      atomic: !!v.spec.atomic,
      text: doc.slice(cur.from, cur.to),
      widgetObj: v.widget ?? null,
    });
    cur.next();
  }
  return out;
}

export const hidden = (d: DecoInfo) => d.kind === "replace" && !d.widget;
export const dimmed = (d: DecoInfo) => d.kind === "mark" && /\bcm-md-mark\b/.test(d.cls);
export const lineClass = (d: DecoInfo, cls: string) => d.kind === "line" && d.cls.split(/\s+/).includes(cls);
export const markClass = (d: DecoInfo, cls: string) => d.kind === "mark" && d.cls.split(/\s+/).includes(cls);
