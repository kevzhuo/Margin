import { useEffect, useState } from "react";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keep an element mounted long enough to play its exit animation.
 *
 * `mounted` stays true for `exitMs` after `open` turns false, and `closing`
 * is true during that window so CSS can switch to the exit keyframes.
 */
export function usePresence(open: boolean, exitMs = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(
      () => {
        setMounted(false);
        setClosing(false);
      },
      prefersReducedMotion() ? 0 : exitMs,
    );
    return () => clearTimeout(t);
    // `mounted` is read, not tracked: re-running when it flips would cancel the exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs]);

  return { mounted: mounted || open, closing: closing && !open };
}
