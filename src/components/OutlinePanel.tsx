import { useStore } from "../state/store";
import { selectAt } from "../editor/commands";

export function OutlinePanel() {
  const headings = useStore((s) => s.headings);
  const editor = useStore((s) => s.editor);
  const activePath = useStore((s) => s.activePath);

  const head = editor?.state.selection.main.head ?? 0;
  let currentIndex = -1;
  headings.forEach((h, i) => {
    if (h.pos <= head) currentIndex = i;
  });

  return (
    <aside className="outline" aria-label="Outline">
      <div className="section-label">Outline</div>
      {!activePath || headings.length === 0 ? (
        <div className="outline-empty">No headings</div>
      ) : (
        headings.map((h, i) => (
          <button
            key={`${h.pos}-${i}`}
            className={`outline-item level-${Math.min(h.level, 4)}${i === currentIndex ? " on" : ""}`}
            onClick={() => editor && selectAt(editor, h.pos)}
            title={h.text}
          >
            {h.text}
          </button>
        ))
      )}
    </aside>
  );
}
