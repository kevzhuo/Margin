import { useEffect, useRef } from "react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { createEditor, createEditorState, type CreateEditorOptions } from "../editor/createEditor";
import { countWords, extractHeadings } from "../editor/outline";
import { scrollToPos } from "../editor/scroll";
import { flash } from "../editor/flash";
import { dirname, findMatch, flattenFiles, resolveRelative, slugify } from "../backend";
import { useStore, type Jump } from "../state/store";

const MAX_SELECTION_COUNT = 200_000;
const TYPING_IDLE_MS = 1200;
let typingTimer: ReturnType<typeof setTimeout> | null = null;

/** While the user types, the status bar steps aside so it never covers text. */
function markTyping() {
  const root = document.documentElement;
  root.classList.add("is-typing");
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => root.classList.remove("is-typing"), TYPING_IDLE_MS);
}

/** Outline and word count trail typing by a moment; neither needs every keystroke. */
const DERIVED_DELAY_MS = 180;
let derivedTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDerived(view: EditorView) {
  if (derivedTimer) clearTimeout(derivedTimer);
  derivedTimer = setTimeout(() => {
    derivedTimer = null;
    const s = useStore.getState();
    s.setHeadings(extractHeadings(view.state));
    s.setWordCount(countWords(view.state.doc));
  }, DERIVED_DELAY_MS);
}

function onUpdate(update: ViewUpdate) {
  const s = useStore.getState();
  if (update.docChanged) scheduleDerived(update.view);
  if (update.selectionSet || update.docChanged) {
    const sel = update.state.selection.main;
    s.setCaret(sel.head);
    s.setSelectionWords(sel.empty || sel.to - sel.from > MAX_SELECTION_COUNT ? 0 : countWords(update.state.doc.slice(sel.from, sel.to)));
  }
}

/** Follow a link clicked in the editor: in-note anchors, other notes, or the browser. */
function openLink(href: string) {
  const s = useStore.getState();
  const raw = href.trim();
  const current = s.activePath;
  if (raw.startsWith("#")) {
    if (current) void s.openNote(current, { jump: { heading: decodeURIComponent(raw.slice(1)) } });
    return;
  }
  const target = current ? resolveRelative(dirname(current), raw) : null;
  if (target === null) {
    void s.backend?.openExternal(raw);
    return;
  }
  const anchor = raw.includes("#") ? decodeURIComponent(raw.slice(raw.indexOf("#") + 1)) : "";
  const files = flattenFiles(s.tree).map((f) => f.path);
  const candidates = /\.(md|markdown)$/i.test(target) ? [target] : [target, `${target}.md`];
  const found =
    candidates.map((c) => files.find((f) => f === c)).find(Boolean) ??
    candidates.map((c) => files.find((f) => f.toLowerCase() === c.toLowerCase())).find(Boolean);
  if (found) {
    void s.openNote(found, anchor ? { jump: { heading: anchor } } : undefined);
  } else {
    s.pushToast(`No note found at “${raw}”`, "error");
  }
}

function applyJump(view: EditorView, jump: Jump, smooth: boolean, highlight = true) {
  const doc = view.state.doc;
  let anchor = Math.min(jump.pos ?? 0, doc.length);
  let head = anchor;
  if (jump.heading) {
    const want = slugify(jump.heading);
    const heading = extractHeadings(view.state).find((h) => slugify(h.text) === want || h.text.toLowerCase() === jump.heading!.toLowerCase());
    if (heading) anchor = head = heading.pos;
  }
  if (jump.line) {
    const line = doc.line(Math.min(Math.max(1, jump.line), doc.lines));
    anchor = head = line.from;
    const m = jump.query ? findMatch(line.text, jump.query) : null;
    if (m) {
      anchor = line.from + m[0];
      head = line.from + m[1];
    }
  }
  view.dispatch({ selection: EditorSelection.single(anchor, head) });
  view.focus();
  scrollToPos(view, head, { align: "center", smooth });
  if (highlight) flash(view, Math.min(anchor, head), Math.max(anchor, head));
}

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownPath = useRef<string | null>(null);
  const shownVersion = useRef(-1);
  /** The jump the shown document opened with, kept in case the editor is rebuilt. */
  const loadedJump = useRef<Jump | null>(null);
  const activePath = useStore((s) => s.activePath);
  const contentVersion = useStore((s) => s.contentVersion);
  const jumpVersion = useStore((s) => s.jumpVersion);
  const backend = useStore((s) => s.backend);
  const externalChange = useStore((s) => s.externalChange);
  const reloadFromDisk = useStore((s) => s.reloadFromDisk);
  const keepLocal = useStore((s) => s.keepLocal);
  const fontSize = useStore((s) => s.fontSize);
  const fontFamily = useStore((s) => s.fontFamily);
  const lineWidth = useStore((s) => s.lineWidth);
  const typewriterOn = useStore((s) => s.typewriter);

  const options = (): Omit<CreateEditorOptions, "parent" | "doc"> => ({
    preview: {
      resolveImage: (src) => {
        const { backend: b, activePath: p } = useStore.getState();
        return b && p ? b.resolveAsset(p, src) : src;
      },
    },
    onDocChanged: (doc, update) => {
      useStore.getState().updateContent(doc);
      if (update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) markTyping();
    },
    onUpdate,
    onOpenLink: openLink,
    onImages: (files) => useStore.getState().saveImages(files),
    onNavigate: (direction) => {
      const s = useStore.getState();
      void (direction < 0 ? s.goBack() : s.goForward());
      return true;
    },
    typewriter: () => useStore.getState().typewriter,
  });

  const rememberView = (path: string | null) => {
    const view = viewRef.current;
    if (!view || !path) return;
    const sel = view.state.selection.main;
    useStore.getState().saveViewState(path, { anchor: sel.anchor, head: sel.head, scrollTop: Math.round(view.scrollDOM.scrollTop) });
  };

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const view = createEditor({ parent: hostRef.current, doc: "", ...options() });
    viewRef.current = view;
    useStore.getState().setEditor(view);
    // A hairline appears under the top bar once the note is scrolled.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        document.documentElement.classList.toggle("editor-scrolled", view.scrollDOM.scrollTop > 2);
      });
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    const save = () => rememberView(shownPath.current);
    const onHide = () => document.visibilityState === "hidden" && save();
    window.addEventListener("beforeunload", save);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      save();
      view.scrollDOM.removeEventListener("scroll", onScroll);
      document.documentElement.classList.remove("editor-scrolled");
      window.removeEventListener("beforeunload", save);
      document.removeEventListener("visibilitychange", onHide);
      view.destroy();
      viewRef.current = null;
      useStore.getState().setEditor(null);
      // A new editor (React mounts twice in development) loads the note afresh.
      shownPath.current = null;
      shownVersion.current = -1;
    };
    // The editor is created once; options read the store lazily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a new document whenever the active note (or its on-disk content) changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const s = useStore.getState();
    const previous = shownPath.current;
    // A rename or move changes the path but not the document (contentVersion only
    // moves on loads). Keep the editor, its caret and its undo history as they are.
    if (previous && activePath && previous !== activePath && contentVersion === shownVersion.current) {
      shownPath.current = activePath;
      return;
    }
    shownVersion.current = contentVersion;
    const switching = previous !== activePath;
    const before = view.state.selection.main;
    const beforeScroll = view.scrollDOM.scrollTop;
    if (switching) rememberView(previous);

    view.setState(createEditorState(s.content ?? "", options()));
    shownPath.current = activePath;
    s.setHeadings(extractHeadings(view.state));
    s.setWordCount(countWords(view.state.doc));
    s.setSelectionWords(0);
    if (!activePath) return;

    const len = view.state.doc.length;
    // A rebuilt editor re-applies the jump its note opened with (the store's copy is spent).
    const jump = (s.jump && s.jump.path === activePath ? s.jump : null) ?? (previous === null && loadedJump.current?.path === activePath ? loadedJump.current : null);
    loadedJump.current = jump;
    if (jump) {
      useStore.setState({ jump: null });
      applyJump(view, jump, false, jump.flash !== false);
    } else if (!switching) {
      // Reloaded from disk: keep the caret and scroll where they were.
      view.dispatch({ selection: EditorSelection.single(Math.min(before.anchor, len), Math.min(before.head, len)) });
      requestAnimationFrame(() => (view.scrollDOM.scrollTop = beforeScroll));
    } else {
      const saved = s.viewStates[activePath];
      if (saved) {
        view.dispatch({ selection: EditorSelection.single(Math.min(saved.anchor, len), Math.min(saved.head, len)) });
        requestAnimationFrame(() => (view.scrollDOM.scrollTop = saved.scrollTop));
      }
      view.focus();
    }

    if (switching && hostRef.current) {
      const host = hostRef.current;
      host.classList.remove("note-enter");
      void host.offsetWidth; // restart the animation
      host.classList.add("note-enter");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, contentVersion]);

  // Jumps within the note that is already open (search hits, heading links).
  useEffect(() => {
    const view = viewRef.current;
    const jump = useStore.getState().jump;
    if (!view || !jump || jump.path !== shownPath.current) return;
    useStore.setState({ jump: null });
    applyJump(view, jump, true, jump.flash !== false);
  }, [jumpVersion]);

  // Text size, font, and measure change line heights: let CodeMirror re-measure.
  useEffect(() => {
    viewRef.current?.requestMeasure();
  }, [fontSize, fontFamily, lineWidth, typewriterOn]);

  // Turning typewriter mode on centers the caret right away.
  useEffect(() => {
    const view = viewRef.current;
    if (typewriterOn && view) scrollToPos(view, view.state.selection.main.head, { align: "center", smooth: true });
  }, [typewriterOn]);

  return (
    <div className="editor-pane">
      {externalChange && (
        <div className="banner" role="alert">
          <span>This note changed on disk.</span>
          <button className="banner-button" onClick={() => void reloadFromDisk()}>
            Reload
          </button>
          <button className="banner-button" onClick={keepLocal}>
            Keep mine
          </button>
        </div>
      )}
      <div
        ref={hostRef}
        className="editor-host"
        data-backend={backend?.kind ?? ""}
        onAnimationEnd={(e) => {
          if (e.animationName === "note-enter") e.currentTarget.classList.remove("note-enter");
        }}
      />
    </div>
  );
}
