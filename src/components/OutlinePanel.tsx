import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { isPdf } from "../backend";
import { useStore } from "../state/store";
import { selectAt } from "../editor/commands";

interface Item {
  key: string;
  text: string;
  /** Indent, 0 at the top level. */
  depth: number;
  go: () => void;
}

/**
 * The open note's sections, or the open PDF's own table of contents, with the
 * one you're in highlighted. Clicking an entry goes there.
 */
export function OutlinePanel() {
  const headings = useStore((s) => s.headings);
  const editor = useStore((s) => s.editor);
  const activePath = useStore((s) => s.activePath);
  const currentHeading = useStore((s) => s.currentHeading);
  const pdfOutline = useStore((s) => s.pdfOutline);
  const pdfPage = useStore((s) => s.pdfPage);
  const list = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const pdf = !!activePath && isPdf(activePath);

  let items: Item[];
  let currentIndex: number;
  if (pdf) {
    items = pdfOutline.map((o, i) => ({ key: `${i}-${o.page}`, text: o.title, depth: o.depth, go: () => useStore.getState().goToPdfPage(o.page) }));
    // The last entry that starts at or before the page being read.
    currentIndex = pdfOutline.reduce((found, o, i) => (o.page <= pdfPage ? i : found), -1);
  } else {
    // The title already heads the page; the outline lists what is under it.
    const shown = headings.filter((h) => !h.title);
    // Indent relative to the shallowest heading, so a note of "##" sections isn't all indented.
    const top = Math.min(...shown.map((h) => h.level));
    items = shown.map((h, i) => ({ key: `${h.pos}-${i}`, text: h.text, depth: h.level - top, go: () => editor && selectAt(editor, h.pos) }));
    currentIndex = shown.findIndex((h) => h.pos === currentHeading);
  }

  // Items wrap to two lines, so the highlight takes its place and size from the item itself.
  useLayoutEffect(() => {
    const item = list.current?.children[currentIndex + 1] as HTMLElement | undefined;
    const el = indicator.current;
    if (!item || !el) return;
    el.style.transform = `translateY(${item.offsetTop}px)`;
    el.style.height = `${item.offsetHeight}px`;
  });

  return (
    <aside className="outline" aria-label="Outline">
      <div className="section-label">{pdf ? "Contents" : "Outline"}</div>
      {!activePath || items.length === 0 ? (
        <div className="outline-empty">{pdf ? "This PDF has no table of contents" : "No headings"}</div>
      ) : (
        <div className="outline-list" ref={list}>
          {/* One highlight that slides between items instead of jumping. */}
          <span className="outline-indicator" ref={indicator} data-visible={currentIndex >= 0 || undefined} aria-hidden="true" />
          {items.map((item, i) => (
            <button
              key={item.key}
              className={`outline-item${item.depth === 0 ? " top" : ""}${i === currentIndex ? " on" : ""}`}
              style={{ "--depth": Math.min(item.depth, 3) } as CSSProperties}
              onClick={() => {
                useStore.getState().closePeeks();
                item.go();
              }}
              title={item.text}
            >
              <span className="outline-text">{item.text}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
