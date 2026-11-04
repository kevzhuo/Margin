import { useEffect, useRef, useState } from "react";
import { useStore, type ConfirmRequest } from "../state/store";
import { usePresence } from "./usePresence";

/** In-app replacement for window.confirm: consistent on every webview and animated. */
export function ConfirmDialog() {
  const request = useStore((s) => s.confirmRequest);
  const resolve = useStore((s) => s.resolveConfirm);
  const { mounted, closing } = usePresence(!!request, 140);
  // Keep showing the last request while the exit animation plays.
  const [shown, setShown] = useState<ConfirmRequest | null>(request);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (request) setShown(request);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const restore = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => confirmRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolve(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (restore?.isConnected) restore.focus();
    };
  }, [request, resolve]);

  if (!mounted || !shown) return null;
  return (
    <div className="modal-backdrop centered" data-closing={closing || undefined} onMouseDown={() => resolve(false)}>
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={shown.message ? "confirm-message" : undefined}
        data-closing={closing || undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="confirm-title">
          {shown.title}
        </h2>
        {shown.message && (
          <p id="confirm-message" className="confirm-message">
            {shown.message}
          </p>
        )}
        <div className="confirm-actions">
          <button className="button" onClick={() => resolve(false)}>
            {shown.cancelLabel ?? "Cancel"}
          </button>
          <button ref={confirmRef} className={`button ${shown.danger ? "danger" : "primary"}`} onClick={() => resolve(true)}>
            {shown.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
