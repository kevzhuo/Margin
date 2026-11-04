import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { findMatch, flattenFiles, stripExtension, type SearchHit } from "../backend";
import { useStore } from "../state/store";
import { formatShortcut, paletteCommands, type AppCommand } from "../state/appCommands";
import { usePresence } from "./usePresence";
import { Command, FileText, Plus, Search } from "./icons";

type Item =
  | { kind: "note"; key: string; path: string; title: string; rel: string }
  | { kind: "hit"; key: string; hit: SearchHit; title: string; rel: string }
  | { kind: "command"; key: string; command: AppCommand }
  | { kind: "create"; key: string; name: string };

const SECTION: Record<Item["kind"], string> = { note: "Notes", hit: "In notes", command: "Commands", create: "" };

function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const idx = t.indexOf(q);
  if (idx >= 0) return 60 - Math.min(idx, 20);
  // Every word of the query appears somewhere.
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 40;
  // Subsequence match.
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
  return qi === q.length ? 20 : 0;
}

/** Wrap the first case-insensitive occurrence of `query` in <mark>. */
export function highlight(text: string, query: string): ReactNode {
  const m = findMatch(text, query.trim());
  if (!m) return text;
  return (
    <>
      {text.slice(0, m[0])}
      <mark>{text.slice(m[0], m[1])}</mark>
      {text.slice(m[1])}
    </>
  );
}

/** Center a long line on its match so the highlight is always visible. */
function snippet(text: string, query: string, max = 110): string {
  if (text.length <= max) return text;
  const m = findMatch(text, query);
  if (!m) return text.slice(0, max - 1) + "…";
  const start = Math.max(0, Math.min(m[0] - Math.floor((max - (m[1] - m[0])) / 2), text.length - max));
  return (start > 0 ? "…" : "") + text.slice(start, start + max).trim() + (start + max < text.length ? "…" : "");
}

export function Palette() {
  const open = useStore((s) => s.paletteOpen);
  const seed = useStore((s) => s.paletteSeed);
  const version = useStore((s) => s.paletteVersion);
  const close = useStore((s) => s.closePalette);
  const tree = useStore((s) => s.tree);
  const recent = useStore((s) => s.recent);
  const vaultRoot = useStore((s) => s.vaultRoot);
  const backend = useStore((s) => s.backend);
  const { mounted, closing } = usePresence(open, 140);

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [hits, setHits] = useState<{ query: string; hits: SearchHit[] }>({ query: "", hits: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);

  // Seed and focus synchronously, in the same commit that shows the palette, so
  // keys typed right after the shortcut land in the input rather than the note.
  useLayoutEffect(() => {
    if (!open) return;
    setQuery(seed);
    setIndex(0);
    setHits({ query: "", hits: [] });
    const input = inputRef.current;
    if (input) {
      input.value = seed;
      input.focus();
      input.setSelectionRange(seed.length, seed.length);
    }
    // Re-seed every time the palette is (re)opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, version]);

  const commandMode = query.startsWith(">");
  const q = (commandMode ? query.slice(1) : query).trim();

  // Full-text search, debounced, ignoring stale responses.
  useEffect(() => {
    if (!open || commandMode || q.length < 2 || !backend || !vaultRoot) {
      setHits((h) => (h.hits.length ? { query: "", hits: [] } : h));
      return;
    }
    const seq = ++searchSeq.current;
    const t = setTimeout(() => {
      backend
        .searchVault(vaultRoot, q, 60)
        .then((result) => {
          if (seq === searchSeq.current) setHits({ query: q, hits: result });
        })
        .catch(() => {
          if (seq === searchSeq.current) setHits({ query: q, hits: [] });
        });
    }, 120);
    return () => clearTimeout(t);
  }, [open, commandMode, q, backend, vaultRoot]);

  const relOf = (path: string) => (vaultRoot && path.startsWith(vaultRoot) ? path.slice(vaultRoot.length).replace(/^[\\/]/, "") : path);

  const items = useMemo<Item[]>(() => {
    if (commandMode) {
      return paletteCommands()
        .map((command) => ({ command, s: Math.max(score(q, command.title), score(q, command.keywords ?? "") - 10) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => (q ? b.s - a.s : 0))
        .map(({ command }) => ({ kind: "command" as const, key: `c:${command.id}`, command }));
    }
    const files = flattenFiles(tree);
    let notes: Item[];
    if (!q) {
      const rank = new Map(recent.map((p, i) => [p, i]));
      notes = [...files]
        .sort((a, b) => (rank.get(a.path) ?? 1e9) - (rank.get(b.path) ?? 1e9) || a.name.localeCompare(b.name, undefined, { numeric: true }))
        .slice(0, 50)
        .map((f) => ({ kind: "note" as const, key: `n:${f.path}`, path: f.path, title: stripExtension(f.name), rel: relOf(f.path) }));
    } else {
      notes = files
        .map((f) => {
          const title = stripExtension(f.name);
          const rel = relOf(f.path);
          return { f, title, rel, s: Math.max(score(q, title), score(q, rel) - 5) };
        })
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || a.title.localeCompare(b.title))
        .slice(0, 8)
        .map(({ f, title, rel }) => ({ kind: "note" as const, key: `n:${f.path}`, path: f.path, title, rel }));
    }
    const contentHits: Item[] =
      q && hits.query === q
        ? hits.hits.map((hit) => ({
            kind: "hit" as const,
            key: `h:${hit.path}:${hit.line}`,
            hit,
            title: stripExtension(hit.path.split(/[\\/]/).pop() ?? hit.path),
            rel: relOf(hit.path),
          }))
        : [];
    const out = [...notes, ...contentHits];
    if (q && !notes.some((n) => n.kind === "note" && n.title.toLowerCase() === q.toLowerCase())) {
      out.push({ kind: "create", key: "create", name: q });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandMode, q, tree, recent, hits, vaultRoot]);

  useEffect(() => setIndex(0), [q, commandMode]);
  useEffect(() => {
    if (index >= items.length) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!mounted) return null;

  const dismiss = (refocusEditor = true) => {
    close();
    // Skip the refocus if the palette was reopened in the meantime.
    if (refocusEditor)
      requestAnimationFrame(() => {
        if (!useStore.getState().paletteOpen) useStore.getState().editor?.focus();
      });
  };

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    const s = useStore.getState();
    switch (item.kind) {
      case "note":
        dismiss(false);
        void s.openNote(item.path);
        break;
      case "hit":
        dismiss(false);
        void s.openNote(item.hit.path, { jump: { line: item.hit.line, query: q } });
        break;
      case "create":
        dismiss(false);
        void s.createNote(undefined, item.name);
        break;
      case "command":
        dismiss(true);
        void item.command.run();
        break;
    }
  };

  const label = commandMode ? "Command palette" : "Quick switcher";
  let lastSection = "";

  return (
    <div className="modal-backdrop" data-closing={closing || undefined} onMouseDown={() => dismiss()}>
      <div className="palette" role="dialog" aria-label={label} data-closing={closing || undefined} onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          {commandMode ? <Command /> : <Search />}
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={commandMode ? "Run a command…" : "Search notes, or type > for commands"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(index);
              } else if (e.key === "Escape") {
                e.preventDefault();
                dismiss();
              } else if (e.key === "Backspace" && query === ">") {
                e.preventDefault();
                setQuery("");
              }
            }}
            aria-label={commandMode ? "Run a command" : "Find a note"}
            aria-activedescendant={items[index] ? `palette-${index}` : undefined}
            aria-controls="palette-results"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {items.length === 0 ? (
            <div className="palette-empty">{commandMode ? "No matching commands" : "No notes yet"}</div>
          ) : (
            items.map((item, i) => {
              const section = SECTION[item.kind];
              const header = section && section !== lastSection && (!commandMode || i === 0) ? section : null;
              lastSection = section || lastSection;
              return (
                <Fragment key={item.key}>
                  {header && !commandMode && q && (
                    <div className="palette-section" role="presentation">
                      {header}
                    </div>
                  )}
                  <div
                    id={`palette-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === index}
                    className={`palette-item kind-${item.kind}${i === index ? " on" : ""}`}
                    onMouseMove={() => i !== index && setIndex(i)}
                    onClick={() => choose(i)}
                  >
                    {item.kind === "note" && (
                      <>
                        <FileText className="palette-icon" size={15} />
                        <span className="palette-title">{highlight(item.title, q)}</span>
                        <span className="palette-meta">{item.rel}</span>
                      </>
                    )}
                    {item.kind === "hit" && (
                      <>
                        <span className="palette-hit-line">{item.hit.line}</span>
                        <span className="palette-hit">
                          <span className="palette-snippet">{highlight(snippet(item.hit.text, q), q)}</span>
                          <span className="palette-meta">{item.title}</span>
                        </span>
                      </>
                    )}
                    {item.kind === "command" && (
                      <>
                        <span className="palette-title">{highlight(item.command.title, q)}</span>
                        {item.command.keys && <kbd className="palette-kbd">{formatShortcut(item.command.keys)}</kbd>}
                      </>
                    )}
                    {item.kind === "create" && (
                      <>
                        <Plus className="palette-icon" />
                        <span className="palette-title">
                          Create note “<strong>{item.name}</strong>”
                        </span>
                      </>
                    )}
                  </div>
                </Fragment>
              );
            })
          )}
        </div>
        <div className="palette-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          {!commandMode && (
            <span>
              <kbd>&gt;</kbd> for commands
            </span>
          )}
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
