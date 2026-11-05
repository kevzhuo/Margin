import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __setLastKeyForTest, hasMenuHandler, isEchoOfHandledKey, runMenuCommand } from "./menuBridge";
import { useStore } from "./store";

const menuSource = readFileSync(resolve(process.cwd(), "src-tauri/src/menu.rs"), "utf8");
// Every custom item is an ("id", "Label", ...) tuple; rustfmt may wrap it across lines.
const menuIds = [...menuSource.matchAll(/"([a-z]+\.[a-zA-Z0-9]+)",\s*"/g)].map((m) => m[1]);

afterEach(() => {
  __setLastKeyForTest(null);
  vi.restoreAllMocks();
});

describe("menu bridge", () => {
  it("reads the menu ids from the Rust menu", () => {
    expect(menuIds.length).toBeGreaterThan(30);
    expect(menuIds).toContain("format.bold");
    expect(menuIds).toContain("nav.back");
  });

  it("has a frontend handler for every native menu item", () => {
    const missing = menuIds.filter((id) => !hasMenuHandler(id));
    expect(missing).toEqual([]);
  });

  it("runs app commands from menu ids", () => {
    const toggle = vi.spyOn(useStore.getState(), "toggleSidebar");
    expect(runMenuCommand("view.sidebar")).toBe(true);
    expect(toggle).toHaveBeenCalledOnce();
    expect(runMenuCommand("help.shortcuts")).toBe(true);
    expect(useStore.getState().paletteOpen).toBe(true);
    expect(useStore.getState().paletteSeed).toBe(">");
  });

  it("ignores the menu echo of a keystroke the page already handled", () => {
    const handled = new KeyboardEvent("keydown", { key: "b", metaKey: true, cancelable: true });
    handled.preventDefault();
    __setLastKeyForTest(handled);
    expect(isEchoOfHandledKey()).toBe(true);
    expect(runMenuCommand("view.sidebar")).toBe(false);

    // A keystroke the page did not handle lets the menu act.
    __setLastKeyForTest(new KeyboardEvent("keydown", { key: "b", metaKey: true, cancelable: true }));
    expect(isEchoOfHandledKey()).toBe(false);

    // So does a click long after any keystroke.
    __setLastKeyForTest(handled, performance.now() - 1000);
    expect(isEchoOfHandledKey()).toBe(false);
  });
});
