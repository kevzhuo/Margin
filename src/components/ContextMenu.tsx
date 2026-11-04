import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./usePresence";

export type MenuItem =
  | {
      label: string;
      onSelect: () => void;
      danger?: boolean;
      /** Shortcut shown on the right, already formatted. */
      hint?: string;
    }
  | { separator: true };

const EXIT_MS = 110;

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState({ left: x, top: y, originX: "left", originY: "top" });

  const close = (then?: () => void) => {
    if (closing) return;
    setClosing(true);
    // Run the action right away so the UI responds; let the menu fade out on its own.
    then?.();
    setTimeout(onClose, prefersReducedMotion() ? 0 : EXIT_MS);
  };

  // Keep the menu on screen, flipping it towards the cursor when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const flipX = x + width > window.innerWidth - 8;
    const flipY = y + height > window.innerHeight - 8;
    setPos({
      left: flipX ? Math.max(8, x - width) : x,
      top: flipY ? Math.max(8, y - height) : y,
      originX: flipX ? "right" : "left",
      originY: flipY ? "bottom" : "top",
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button.menu-item") ?? [])];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    const onBlur = () => close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button.menu-item")?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      data-closing={closing || undefined}
      style={{ left: pos.left, top: pos.top, transformOrigin: `${pos.originY} ${pos.originX}` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        "separator" in item ? (
          <div key={`sep-${i}`} className="menu-separator" role="separator" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            className={item.danger ? "menu-item danger" : "menu-item"}
            onClick={() => close(item.onSelect)}
            onMouseMove={(e) => e.currentTarget.focus({ preventScroll: true })}
          >
            <span>{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
