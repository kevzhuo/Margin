import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { isPdf } from "../backend";
import { useStore } from "../state/store";
import { selectAt } from "../editor/commands";

export function OutlinePanel() {
  const headings = useStore((s) => s.headings);
  const editor = useStore((s) => s.editor);
  const activePath = useStore((s) => s.activePath);
  const currentHeading = useStore((s) => s.currentHeading);
  const list = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  // The title already heads the page; the outline lists what is under it.
  const shown = headings.filter((h) => !h.title);
  const currentIndex = shown.findIndex((h) => h.pos === currentHeading);
  // Indent relative to the shallowest heading, so a note of "##" sections isn't all indented.
  const top = Math.min(...shown.map((h) => h.level));

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
      <div className="section-label">Outline</div>
      {!activePath || shown.length === 0 ? (
        <div className="outline-empty">{activePath && isPdf(activePath) ? "PDFs have no outline here" : "No headings"}</div>
      ) : (
        <div className="outline-list" ref={list}>
          {/* One highlight that slides between items instead of jumping. */}
          <span className="outline-indicator" ref={indicator} data-visible={currentIndex >= 0 || undefined} aria-hidden="true" />
          {shown.map((h, i) => (
            <button
              key={`${h.pos}-${i}`}
              className={`outline-item${h.level === top ? " top" : ""}${i === currentIndex ? " on" : ""}`}
              style={{ "--depth": Math.min(h.level - top, 3) } as CSSProperties}
              onClick={() => {
                useStore.getState().closePeeks();
                if (editor) selectAt(editor, h.pos);
              }}
              title={h.text}
            >
              <span className="outline-text">{h.text}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
