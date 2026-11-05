import { EditorView } from "@codemirror/view";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export interface ScrollOptions {
  /** "start" puts the line `margin` px below the top; "center" centers it. */
  align?: "start" | "center";
  margin?: number;
  smooth?: boolean;
}

/** Distances beyond this many window heights jump instead of gliding. */
const FAR_SCREENS = 1.5;
/** A glide that ends further than this from its target was overridden by someone else's scroll. */
const NEAR_ENOUGH = 160;

/** Run `fn` once the element stops scrolling (scrollend where supported, else a timeout). */
function afterScroll(el: HTMLElement, fn: () => void) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.removeEventListener("scrollend", finish);
    fn();
  };
  el.addEventListener("scrollend", finish, { once: true });
  setTimeout(finish, 700);
}

/** A short fade that makes a long jump read as a transition rather than a cut. */
function fadeIn(view: EditorView) {
  const host = view.dom.parentElement;
  if (!host || reducedMotion()) return;
  host.classList.remove("jump-fade");
  void host.offsetWidth;
  host.classList.add("jump-fade");
  setTimeout(() => host.classList.remove("jump-fade"), 300);
}

/**
 * Scroll so `pos` is near the top (or centered). Nearby targets glide; distant
 * ones jump with a fade. Lines that have never been on screen only have
 * estimated heights, so a glide can stop short when CodeMirror corrects for
 * them; every scroll therefore finishes with CodeMirror's own scrollIntoView,
 * which re-measures until the target is exactly in place.
 */
export function scrollToPos(view: EditorView, pos: number, { align = "start", margin = 48, smooth = true }: ScrollOptions = {}) {
  const target = Math.min(pos, view.state.doc.length);
  const settle = () => {
    if (!view.dom.isConnected) return;
    view.dispatch({ effects: EditorView.scrollIntoView(target, align === "center" ? { y: "center" } : { y: "start", yMargin: margin }) });
  };
  view.requestMeasure({
    key: "margin-scroll",
    read(v) {
      const scroller = v.scrollDOM;
      const rect = scroller.getBoundingClientRect();
      const block = v.lineBlockAt(target);
      const docTopInScroller = v.documentTop - rect.top + scroller.scrollTop;
      let top: number;
      if (align === "center") {
        const coords = v.coordsAtPos(target);
        const caretTop = coords ? coords.top - rect.top + scroller.scrollTop : docTopInScroller + block.top;
        const caretHeight = coords ? coords.bottom - coords.top : block.height;
        top = caretTop - (scroller.clientHeight - caretHeight) * 0.45;
      } else {
        top = docTopInScroller + block.top - margin;
      }
      top = Math.max(0, Math.min(Math.round(top), scroller.scrollHeight - scroller.clientHeight));
      return { top, current: scroller.scrollTop, height: scroller.clientHeight };
    },
    write(m, v) {
      if (Math.abs(m.current - m.top) < 2) return;
      const far = Math.abs(m.current - m.top) > m.height * FAR_SCREENS;
      if (!smooth || far || reducedMotion()) {
        if (smooth && far) fadeIn(v);
        // Dispatching inside a measure cycle isn't allowed; do it right after.
        setTimeout(settle, 0);
        return;
      }
      const scroller = v.scrollDOM;
      scroller.scrollTo({ top: m.top, behavior: "smooth" });
      // Fine-tune once the glide ends, unless the user has taken over scrolling
      // since: then the view belongs to them and snapping back would be jarring.
      let userScrolled = false;
      const takeOver = () => (userScrolled = true);
      const events = ["wheel", "pointerdown", "keydown", "touchmove"] as const;
      for (const type of events) scroller.addEventListener(type, takeOver, { passive: true });
      afterScroll(scroller, () => {
        for (const type of events) scroller.removeEventListener(type, takeOver);
        if (userScrolled || Math.abs(scroller.scrollTop - m.top) > NEAR_ENOUGH) return;
        settle();
      });
    },
  });
}
