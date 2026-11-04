import { useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { createEditor, createEditorState } from "../editor/createEditor";
import { countWords, extractHeadings } from "../editor/outline";
import { useStore } from "../state/store";

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activePath = useStore((s) => s.activePath);
  const content = useStore((s) => s.content);
  const contentVersion = useStore((s) => s.contentVersion);
  const backend = useStore((s) => s.backend);
  const externalChange = useStore((s) => s.externalChange);
  const reloadFromDisk = useStore((s) => s.reloadFromDisk);
  const keepLocal = useStore((s) => s.keepLocal);

  // Keep latest callbacks in refs so the editor is created once.
  const pathRef = useRef(activePath);
  pathRef.current = activePath;

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const store = useStore.getState();
    const view = createEditor({
      parent: hostRef.current,
      doc: "",
      preview: {
        resolveImage: (src) => {
          const b = useStore.getState().backend;
          const p = pathRef.current;
          return b && p ? b.resolveAsset(p, src) : src;
        },
      },
      onDocChanged: (doc, update) => {
        useStore.getState().updateContent(doc);
        useStore.getState().setWordCount(countWords(update.state.doc));
      },
      onUpdate: (update) => {
        if (update.docChanged || update.viewportChanged) {
          useStore.getState().setHeadings(extractHeadings(update.state));
        }
        if (update.selectionSet) useStore.getState().setCaret(update.state.selection.main.head);
      },
      onOpenLink: (href) => {
        void useStore.getState().backend?.openExternal(href);
      },
    });
    viewRef.current = view;
    store.setEditor(view);
    return () => {
      view.destroy();
      viewRef.current = null;
      useStore.getState().setEditor(null);
    };
  }, []);

  // Load a new document whenever the active note (or its on-disk content) changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = content ?? "";
    view.setState(
      createEditorState(doc, {
        preview: {
          resolveImage: (src) => {
            const b = useStore.getState().backend;
            const p = pathRef.current;
            return b && p ? b.resolveAsset(p, src) : src;
          },
        },
        onDocChanged: (d, update) => {
          useStore.getState().updateContent(d);
          useStore.getState().setWordCount(countWords(update.state.doc));
        },
        onUpdate: (update) => {
          if (update.docChanged || update.viewportChanged) useStore.getState().setHeadings(extractHeadings(update.state));
          if (update.selectionSet) useStore.getState().setCaret(update.state.selection.main.head);
        },
        onOpenLink: (href) => void useStore.getState().backend?.openExternal(href),
      }),
    );
    useStore.getState().setHeadings(extractHeadings(view.state));
    useStore.getState().setWordCount(countWords(view.state.doc));
    if (activePath) view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, contentVersion]);

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
      <div ref={hostRef} className="editor-host" data-backend={backend?.kind ?? ""} />
    </div>
  );
}
