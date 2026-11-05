import { useEffect, useRef } from "react";
import { canGoBack, canGoForward, useStore } from "../state/store";
import { ChevronLeft, ChevronRightLg } from "./icons";

/** Horizontal travel (px) needed to arm a back/forward swipe. */
export const SWIPE_THRESHOLD = 140;
/** The gesture is over once wheel events stop for this long. */
const GESTURE_END_MS = 140;
/** After navigating, ignore the tail of the same gesture's momentum. */
const COOLDOWN_MS = 450;

/** Is `el` (or an ancestor) able to scroll horizontally in this direction? Then the swipe is theirs. */
function scrollsHorizontally(target: EventTarget | null, deltaX: number): boolean {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const style = getComputedStyle(el);
      if (style.overflowX === "auto" || style.overflowX === "scroll") {
        if (deltaX < 0 && el.scrollLeft > 0) return true;
        if (deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
      }
    }
  }
  return false;
}

/**
 * Two-finger horizontal swipe on a trackpad goes back or forward through
 * visited notes, like Safari and Finder. An arrow slides in from the edge as
 * the swipe progresses and fills in once letting go will navigate.
 */
export function SwipeNavigation() {
  const backRef = useRef<HTMLDivElement>(null);
  const forwardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let travel = 0;
    let endTimer: ReturnType<typeof setTimeout> | null = null;
    let cooldownUntil = 0;
    let tracking = false;

    const paint = () => {
      const s = useStore.getState();
      const back = travel > 0;
      const allowed = back ? canGoBack(s) : canGoForward(s);
      // Without anywhere to go, the arrow only peeks so the gesture still feels answered.
      const progress = Math.min(Math.abs(travel) / SWIPE_THRESHOLD, allowed ? 1.15 : 0.3);
      for (const [el, isBack] of [
        [backRef.current, true],
        [forwardRef.current, false],
      ] as const) {
        if (!el) continue;
        const mine = tracking && back === isBack;
        el.style.setProperty("--progress", mine ? String(progress) : "0");
        el.dataset.armed = mine && allowed && progress >= 1 ? "true" : "false";
      }
    };

    const reset = () => {
      travel = 0;
      tracking = false;
      for (const el of [backRef.current, forwardRef.current]) el?.classList.remove("tracking");
      paint();
    };

    const finish = () => {
      endTimer = null;
      const s = useStore.getState();
      const back = travel > 0;
      if (Math.abs(travel) >= SWIPE_THRESHOLD && (back ? canGoBack(s) : canGoForward(s))) {
        cooldownUntil = performance.now() + COOLDOWN_MS;
        void (back ? s.goBack() : s.goForward());
      }
      reset();
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || performance.now() < cooldownUntil) return;
      const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (!tracking) {
        // Only clearly horizontal movement starts a swipe.
        if (Math.abs(dx) < 2 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
        const target = e.target as Element | null;
        if (target?.closest?.(".modal-backdrop, .context-menu, .settings-popover, .cm-tooltip, .sidebar")) return;
        if (scrollsHorizontally(e.target, dx)) return;
        tracking = true;
        for (const el of [backRef.current, forwardRef.current]) el?.classList.add("tracking");
      }
      // Two fingers moving right (negative deltaX) means "back", as in Safari.
      travel -= dx;
      paint();
      if (endTimer) clearTimeout(endTimer);
      endTimer = setTimeout(finish, GESTURE_END_MS);
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (endTimer) clearTimeout(endTimer);
    };
  }, []);

  return (
    <>
      <div ref={backRef} className="swipe-indicator back" aria-hidden="true" data-armed="false">
        <ChevronLeft size={18} />
      </div>
      <div ref={forwardRef} className="swipe-indicator forward" aria-hidden="true" data-armed="false">
        <ChevronRightLg size={18} />
      </div>
    </>
  );
}
