import { describe, expect, it } from "vitest";
import { findReferences, imageUsage } from "./attachmentUsage";

const R = "/Vault";
const img = (path: string) => ({ path, size: 1 });
const unused = (usage: Map<string, unknown[]>) => [...usage].filter(([, uses]) => uses.length === 0).map(([p]) => p);

describe("findReferences", () => {
  it("finds Markdown images and links, HTML images, reference definitions and embeds, with their lines", () => {
    const text = [
      "# Note",
      '![a](../attachments/a.png "Title") and [link](b.png)',
      '<img width="200" src="c.png">',
      "[ref]: <attachments/d e.png>",
      "![[e.png|300]] and [[f.png]]",
      "![spaces](attachments/my photo.png)",
    ].join("\n");
    expect(findReferences(text).map((r) => [r.target, r.byName, r.line])).toEqual([
      ["../attachments/a.png", false, 2],
      ["b.png", false, 2],
      ["attachments/my photo.png", false, 6],
      ["c.png", false, 3],
      ["attachments/d e.png", false, 4],
      ["e.png", true, 5],
      ["f.png", true, 5],
    ]);
  });
});

describe("imageUsage", () => {
  const images = [
    img(`${R}/attachments/used.png`),
    img(`${R}/attachments/Pasted image 2026.png`),
    img(`${R}/attachments/embedded.png`),
    img(`${R}/attachments/orphan.png`),
    img(`${R}/Trips/beach.jpg`),
  ];

  it("matches links relative to each note, encoded or not, case-insensitively", () => {
    const usage = imageUsage(R, images, [
      { path: `${R}/Projects/Plan.md`, text: "# Plan\n\n![](../attachments/USED.png)\n" },
      { path: `${R}/Inbox.md`, text: "![](attachments/Pasted%20image%202026.png)" },
      { path: `${R}/Journal/Day.md`, text: "Look: ![[embedded.png]]" },
      { path: `${R}/Trips/Notes.md`, text: '<img src="beach.jpg" width="50%">' },
    ]);
    expect(usage.get(`${R}/attachments/used.png`)).toEqual([{ notePath: `${R}/Projects/Plan.md`, line: 3 }]);
    expect(usage.get(`${R}/attachments/Pasted image 2026.png`)).toEqual([{ notePath: `${R}/Inbox.md`, line: 1 }]);
    expect(usage.get(`${R}/attachments/embedded.png`)).toEqual([{ notePath: `${R}/Journal/Day.md`, line: 1 }]);
    expect(usage.get(`${R}/Trips/beach.jpg`)).toEqual([{ notePath: `${R}/Trips/Notes.md`, line: 1 }]);
    expect(unused(usage)).toEqual([`${R}/attachments/orphan.png`]);
  });

  it("never calls an image unused while a note still names it, however the link is written", () => {
    const usage = imageUsage(R, images, [
      // A "shortest path" link from a note in another folder.
      { path: `${R}/Deep/Down/Note.md`, text: "![](orphan.png)" },
    ]);
    expect(unused(usage)).toEqual([`${R}/attachments/used.png`, `${R}/attachments/Pasted image 2026.png`, `${R}/attachments/embedded.png`, `${R}/Trips/beach.jpg`]);
    const odd = imageUsage(R, [img(`${R}/attachments/chart (final).png`)], [{ path: `${R}/a.md`, text: "see ![x](attachments/chart%20(final).png)" }]);
    expect(unused(odd)).toEqual([]);
  });

  it("ignores web images and vault-absolute links resolve from the root", () => {
    const usage = imageUsage(R, [img(`${R}/attachments/x.png`), img(`${R}/attachments/y.png`)], [
      { path: `${R}/n.md`, text: "![](https://example.com/x2.png) ![](/attachments/y.png)" },
    ]);
    expect(unused(usage)).toEqual([`${R}/attachments/x.png`]);
  });
});
