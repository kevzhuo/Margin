import { useEffect, useMemo, useRef, useState } from "react";
import { flattenFiles, stripExtension } from "../backend";
import { useStore } from "../state/store";
import { Search } from "./icons";

function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const idx = t.indexOf(q);
  if (idx >= 0) return 60 - Math.min(idx, 20);
  // subsequence match
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
  return qi === q.length ? 20 : 0;
}

export function QuickSwitcher() {
  const open = useStore((s) => s.quickOpen);
  const setOpen = useStore((s) => s.setQuickOpen);
  const tree = useStore((s) => s.tree);
  const vaultRoot = useStore((s) => s.vaultRoot);
  const openNote = useStore((s) => s.openNote);
  const createNote = useStore((s) => s.createNote);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const files = useMemo(() => flattenFiles(tree), [tree]);
  const results = useMemo(() => {
    const scored = files
      .map((f) => {
        const title = stripExtension(f.name);
        const rel = vaultRoot && f.path.startsWith(vaultRoot) ? f.path.slice(vaultRoot.length).replace(/^[\\/]/, "") : f.path;
        return { file: f, title, rel, s: Math.max(score(query, title), score(query, rel) - 5) };
      })
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.title.localeCompare(b.title));
    return scored.slice(0, 12);
  }, [files, query, vaultRoot]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const choose = (i: number) => {
    const r = results[i];
    if (r) {
      void openNote(r.file.path);
      setOpen(false);
    } else if (query.trim()) {
      void createNote().then(() => setOpen(false));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="quick-switcher" role="dialog" aria-label="Quick switcher" onMouseDown={(e) => e.stopPropagation()}>
        <div className="quick-input-row">
          <Search />
          <input
            ref={inputRef}
            className="quick-input"
            placeholder="Find a note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(index);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            aria-label="Find a note"
            aria-activedescendant={results[index] ? `quick-${index}` : undefined}
          />
        </div>
        <div className="quick-results" role="listbox">
          {results.length === 0 ? (
            <div className="quick-empty">{query ? "No matches. Press Enter to create a new note." : "No notes"}</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.file.path}
                id={`quick-${i}`}
                role="option"
                aria-selected={i === index}
                className={`quick-item${i === index ? " on" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className="quick-title">{r.title}</span>
                <span className="quick-path">{r.rel}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
