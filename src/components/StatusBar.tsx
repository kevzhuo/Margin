import { useStore } from "../state/store";

export function StatusBar() {
  const wordCount = useStore((s) => s.wordCount);
  const dirty = useStore((s) => s.dirty);
  const saveState = useStore((s) => s.saveState);
  const activePath = useStore((s) => s.activePath);
  if (!activePath) return null;
  const status = saveState === "error" ? "Save failed" : dirty || saveState === "saving" ? "Saving…" : "";
  return (
    <div className="statusbar" aria-live="polite">
      {status && <span className="save-state">{status}</span>}
      <span className="word-count">
        {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}
      </span>
    </div>
  );
}
