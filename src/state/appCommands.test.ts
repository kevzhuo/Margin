import { describe, expect, it } from "vitest";
import { formatShortcut, matchesShortcut } from "./appCommands";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcuts (non-Mac)", () => {
  it("matches Mod as Ctrl and requires exact modifiers", () => {
    expect(matchesShortcut(key({ key: "p", ctrlKey: true }), "Mod+P")).toBe(true);
    expect(matchesShortcut(key({ key: "P", ctrlKey: true, shiftKey: true }), "Mod+P")).toBe(false);
    expect(matchesShortcut(key({ key: "P", ctrlKey: true, shiftKey: true }), "Mod+Shift+P")).toBe(true);
    expect(matchesShortcut(key({ key: "p" }), "Mod+P")).toBe(false);
  });

  it("matches symbol keys by code so Shift does not change them", () => {
    expect(matchesShortcut(key({ key: "|", code: "Backslash", ctrlKey: true, shiftKey: true }), "Mod+Shift+\\")).toBe(true);
    expect(matchesShortcut(key({ key: "=", code: "Equal", ctrlKey: true }), "Mod+=")).toBe(true);
    expect(matchesShortcut(key({ key: "[", code: "BracketLeft", ctrlKey: true }), "Mod+[")).toBe(true);
  });

  it("matches function keys only without modifiers", () => {
    expect(matchesShortcut(key({ key: "F8" }), "F8")).toBe(true);
    expect(matchesShortcut(key({ key: "F8", ctrlKey: true }), "F8")).toBe(false);
  });

  it("formats shortcuts for display", () => {
    expect(formatShortcut("Mod+Shift+P")).toBe("Ctrl+Shift+P");
    expect(formatShortcut("F2")).toBe("F2");
  });
});
