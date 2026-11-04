import { MemoryBackend } from "./memory";
import type { VaultBackend } from "./types";

export * from "./types";
export { MemoryBackend, DEMO_ROOT } from "./memory";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __MARGIN_BACKEND__?: VaultBackend;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

export function platform(): "macos" | "windows" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "unknown";
}

let backend: VaultBackend | null = null;

export async function getBackend(): Promise<VaultBackend> {
  if (backend) return backend;
  if (typeof window !== "undefined" && window.__MARGIN_BACKEND__) {
    backend = window.__MARGIN_BACKEND__;
    return backend;
  }
  if (isTauri()) {
    const { TauriBackend } = await import("./tauri");
    backend = new TauriBackend();
  } else {
    backend = new MemoryBackend();
  }
  return backend;
}
