import { useStore } from "../state/store";

/** Average adult silent-reading speed, words per minute. */
const READING_WPM = 230;

export function StatusBar() {
  const wordCount = useStore((s) => s.wordCount);
  const selectionWords = useStore((s) => s.selectionWords);
  const dirty = useStore((s) => s.dirty);
  const saveState = useStore((s) => s.saveState);
  const activePath = useStore((s) => s.activePath);
  if (!activePath) return null;
  const status = saveState === "error" ? "Save failed" : dirty || saveState === "saving" ? "Saving…" : "";
  // A note you can read in under a minute doesn't need a reading time.
  const minutes = wordCount >= READING_WPM ? Math.round(wordCount / READING_WPM) : 0;
  const words = (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;
  return (
    <div className="statusbar" aria-live="polite">
      <span className={`save-state${status ? " visible" : ""}${saveState === "error" ? " error" : ""}`}>{status || "Saved"}</span>
      <span className="status-pill">
        {selectionWords > 0 ? (
          <span className="word-count selection">
            {selectionWords.toLocaleString()} of {words(wordCount)}
          </span>
        ) : (
          <span className="word-count">{words(wordCount)}</span>
        )}
        {minutes > 0 && <span className="reading-time">{minutes} min read</span>}
      </span>
    </div>
  );
}
