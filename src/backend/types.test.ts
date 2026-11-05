import { describe, expect, it } from "vitest";
import { assetPath, findMatch, isWithin, resolveRelative, slugify } from "./types";

describe("resolveRelative", () => {
  it("resolves sibling, child and parent paths", () => {
    expect(resolveRelative("/Vault/Projects", "Roadmap.md")).toBe("/Vault/Projects/Roadmap.md");
    expect(resolveRelative("/Vault/Projects", "./Roadmap.md")).toBe("/Vault/Projects/Roadmap.md");
    expect(resolveRelative("/Vault", "Projects/Roadmap.md")).toBe("/Vault/Projects/Roadmap.md");
    expect(resolveRelative("/Vault/Projects", "../Journal/2026-11-04.md")).toBe("/Vault/Journal/2026-11-04.md");
  });

  it("decodes URL escapes and drops anchors and queries", () => {
    expect(resolveRelative("/Vault", "My%20Note.md#intro")).toBe("/Vault/My Note.md");
    expect(resolveRelative("/Vault", "a.md?x=1")).toBe("/Vault/a.md");
  });

  it("keeps Windows separators", () => {
    expect(resolveRelative("C:\\Notes\\Projects", "../Inbox.md")).toBe("C:\\Notes\\Inbox.md");
  });

  it("returns null for URLs, anchors and absolute paths", () => {
    expect(resolveRelative("/Vault", "https://example.com")).toBeNull();
    expect(resolveRelative("/Vault", "mailto:a@b.c")).toBeNull();
    expect(resolveRelative("/Vault", "#heading")).toBeNull();
    expect(resolveRelative("/Vault", "/etc/passwd")).toBeNull();
    expect(resolveRelative("/Vault", "")).toBeNull();
  });
});

describe("helpers", () => {
  it("slugifies headings like GitHub", () => {
    expect(slugify("Decoration plan")).toBe("decoration-plan");
    expect(slugify("  What's next?  ")).toBe("whats-next");
    expect(slugify("Café au lait")).toBe("café-au-lait");
  });

  it("finds case-insensitive matches", () => {
    expect(findMatch("The editor should feel like Typora", "typora")).toEqual([28, 34]);
    expect(findMatch("abc", "")).toBeNull();
    expect(findMatch("abc", "x")).toBeNull();
  });

  it("knows when a path is inside a folder", () => {
    expect(isWithin("/a/b/c.md", "/a/b")).toBe(true);
    expect(isWithin("/a/b", "/a/b")).toBe(true);
    expect(isWithin("/a/bc.md", "/a/b")).toBe(false);
    expect(isWithin("C:\\a\\b\\c.md", "C:\\a\\b")).toBe(true);
  });
});

describe("assetPath", () => {
  const note = "/Vault/Projects/Trip.md";

  it("resolves relative image links against the note's folder", () => {
    expect(assetPath(note, "../attachments/Sunset%20photo.png")).toBe("/Vault/attachments/Sunset photo.png");
    expect(assetPath(note, "photo.png")).toBe("/Vault/Projects/photo.png");
    expect(assetPath(note, "<../attachments/Sunset photo.png>")).toBe("/Vault/attachments/Sunset photo.png");
  });

  it("normalizes .. so a link can't hide where it points", () => {
    expect(assetPath(note, "../../../etc/passwd")).toBe("/etc/passwd");
  });

  it("keeps absolute paths, decoded", () => {
    expect(assetPath(note, "/Users/me/Pictures/a%20b.png")).toBe("/Users/me/Pictures/a b.png");
    expect(assetPath("C:\\Vault\\Trip.md", "C:\\Pictures\\a.png")).toBe("C:\\Pictures\\a.png");
  });

  it("leaves web, data and blob URLs to load as they are", () => {
    for (const src of ["https://example.com/a.png", "data:image/png;base64,AAAA", "blob:http://x/1", "asset://localhost/a"]) {
      expect(assetPath(note, src)).toBeNull();
    }
  });
});
