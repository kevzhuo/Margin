import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { basename, fileManagerLabel } from "../backend";
import { useStore } from "../state/store";
import { formatShortcut } from "../state/appCommands";
import { FolderOpen } from "./icons";

GlobalWorkerOptions.workerSrc = workerUrl;

/** pdf.js data files, copied into the app by vite.config.ts. */
const DATA = `${import.meta.env.BASE_URL}pdfjs/`;
/** Pages never get wider than this at 100%, so a wide window doesn't blow text up. */
const MAX_PAGE_WIDTH = 920;
/** Space around the pages. */
const GUTTER = 32;
/** Pages this far outside the window are drawn ahead of time; further ones are dropped to save memory. */
const PRELOAD = "1200px 0px";

interface PageSize {
  width: number;
  height: number;
}

/** A PDF from the vault, shown in place of the editor. */
export default function PdfView() {
  const path = useStore((s) => s.activePath)!;
  const version = useStore((s) => s.contentVersion);
  const backend = useStore((s) => s.backend);
  const zoom = useStore((s) => s.pdfZoom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const restored = useRef<string | null>(null);

  // Load the file, and again if another app changes it.
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    let loading: PDFDocumentLoadingTask | null = null;
    setError(null);
    (async () => {
      const response = await fetch(backend.assetUrl(path));
      if (!response.ok) throw new Error(`the file couldn’t be read (${response.status})`);
      const data = new Uint8Array(await response.arrayBuffer());
      if (cancelled) return;
      loading = getDocument({
        data,
        cMapUrl: `${DATA}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${DATA}standard_fonts/`,
        wasmUrl: `${DATA}wasm/`,
        iccUrl: `${DATA}iccs/`,
      });
      const loaded = await loading.promise;
      // Every page's size up front, so the scroll height is right before pages are drawn.
      const pages: PageSize[] = [];
      for (let i = 1; i <= loaded.numPages; i++) {
        const viewport = (await loaded.getPage(i)).getViewport({ scale: 1 });
        pages.push({ width: viewport.width, height: viewport.height });
      }
      if (cancelled) return;
      setSizes(pages);
      setDoc(loaded);
    })().catch((e: unknown) => {
      if (cancelled) return;
      const name = e instanceof Error ? e.name : "";
      setError(name === "PasswordException" ? "This PDF is protected with a password." : `Couldn’t open this PDF: ${e instanceof Error ? e.message : String(e)}`);
      setDoc(null);
    });
    return () => {
      cancelled = true;
      void loading?.destroy();
    };
  }, [backend, path, version]);

  // Fit the pages to the space available.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc]);

  const widest = Math.max(1, ...sizes.map((s) => s.width));
  const scale = width ? (Math.min(width - GUTTER * 2, MAX_PAGE_WIDTH) / widest) * zoom : 0;

  // Come back to where this PDF was left, and remember the place when leaving it.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !doc || !scale || restored.current === path) return;
    restored.current = path;
    const saved = useStore.getState().viewStates[path];
    el.scrollTop = saved?.scrollTop ?? 0;
    el.focus({ preventScroll: true });
    return undefined;
  }, [doc, scale, path]);
  // Tracked while scrolling: by the time the viewer goes away, its element no longer scrolls.
  const scrollTop = useRef(0);
  useEffect(
    () => () => {
      if (restored.current === path) useStore.getState().saveViewState(path, { anchor: 0, head: 0, scrollTop: Math.round(scrollTop.current) });
    },
    [path],
  );

  // Keep the reading position when zooming: the same point of the same page stays put.
  const lastScale = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && lastScale.current && scale && lastScale.current !== scale) el.scrollTop = (el.scrollTop * scale) / lastScale.current;
    lastScale.current = scale;
  }, [scale]);

  // The page in the middle of the window is the current one.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    scrollTop.current = el.scrollTop;
    const middle = el.scrollTop + el.clientHeight / 2;
    let top = GUTTER;
    for (let i = 0; i < sizes.length; i++) {
      top += sizes[i].height * scale + GUTTER / 2;
      if (top > middle) {
        if (page !== i + 1) setPage(i + 1);
        return;
      }
    }
  };

  if (error) {
    return (
      <div className="pdf-view pdf-message">
        <p>{error}</p>
        {backend?.revealPath && (
          <button className="button" onClick={() => void useStore.getState().revealPath(path)}>
            <FolderOpen size={14} /> {fileManagerLabel()}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="pdf-view">
      <div className="pdf-scroll" ref={scrollRef} tabIndex={0} onScroll={onScroll} aria-label={`PDF: ${basename(path)}`} role="document">
        <div className="pdf-pages" style={{ "--gutter": `${GUTTER}px` } as CSSProperties}>
          {doc && scale > 0
            ? sizes.map((size, i) => <PdfPage key={`${version}-${i}`} doc={doc} index={i} size={size} scale={scale} root={scrollRef.current} />)
            : null}
        </div>
      </div>
      {doc && (
        <div className="status-pill pdf-controls">
          <span className="pdf-page-number">
            Page {page} of {sizes.length}
          </span>
          <span className="pdf-zoom">
            <button className="icon-button small" onClick={() => useStore.getState().zoomPdf(-1)} aria-label="Zoom out" title={`Zoom out (${formatShortcut("Mod+-")})`}>
              −
            </button>
            <button className="pdf-zoom-level" onClick={() => useStore.getState().zoomPdf(0)} title="Fit to window">
              {Math.round(zoom * 100)}%
            </button>
            <button className="icon-button small" onClick={() => useStore.getState().zoomPdf(1)} aria-label="Zoom in" title={`Zoom in (${formatShortcut("Mod+=")})`}>
              +
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * One page: drawn on a canvas at the screen's resolution once it is near the
 * window, with an invisible text layer on top so text can be selected and
 * copied. Redrawn when the zoom changes; the old drawing stays until the new
 * one is ready, so zooming never flashes blank.
 */
function PdfPage({ doc, index, size, scale, root }: { doc: PDFDocumentProxy; index: number; size: PageSize; scale: number; root: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root, rootMargin: PRELOAD });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!near) {
      el.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    let text: TextLayer | null = null;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (cancelled) return;
      const layer = document.createElement("div");
      layer.className = "textLayer";
      text = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
      el.replaceChildren(canvas, layer);
      await text.render();
    })().catch(() => {
      // A cancelled render rejects; a page that fails to draw stays blank.
    });
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [doc, index, scale, near]);

  return (
    <div
      ref={ref}
      className="pdf-page"
      data-page={index + 1}
      style={{ width: size.width * scale, height: size.height * scale, "--total-scale-factor": scale } as CSSProperties}
    />
  );
}
