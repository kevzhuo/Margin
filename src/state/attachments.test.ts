import { describe, expect, it } from "vitest";
import { attachmentName, imageMarkdown, isImageFile, sanitizeFileName } from "./attachments";

describe("attachment names", () => {
  const at = new Date(2026, 10, 5, 14, 32, 7);

  it("keeps a dropped or picked file's own name", () => {
    expect(attachmentName({ name: "IMG_2041.HEIC", type: "image/heic" }, at)).toBe("IMG_2041.HEIC");
    expect(attachmentName({ name: "Sunset photo.jpg", type: "image/jpeg" }, at)).toBe("Sunset photo.jpg");
  });

  it("names pasted screenshots like macOS does", () => {
    expect(attachmentName({ name: "image.png", type: "image/png" }, at)).toBe("Pasted image 2026-11-05 at 14.32.07.png");
    expect(attachmentName({ name: "", type: "image/jpeg" }, at)).toBe("Pasted image 2026-11-05 at 14.32.07.jpg");
  });

  it("adds a missing extension from the file type", () => {
    expect(attachmentName({ name: "diagram", type: "image/svg+xml" }, at)).toBe("diagram.svg");
  });

  it("makes names safe to save", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeFileName('a/b\\c:d*e?"f<g>h|i.png')).toBe("a-b-c-d-e--f-g-h-i.png");
    expect(sanitizeFileName(".hidden.png")).toBe("hidden.png");
    expect(sanitizeFileName("  lots   of\tspace.png ")).toBe("lots of space.png");
    const long = sanitizeFileName(`${"x".repeat(300)}.jpeg`);
    expect(long).toHaveLength(120);
    expect(long.endsWith(".jpeg")).toBe(true);
  });
});

describe("image links", () => {
  it("use the file name as alt text, except for pasted images", () => {
    expect(imageMarkdown("../attachments/Sunset photo.png", "Sunset photo.png")).toBe("![Sunset photo](../attachments/Sunset%20photo.png)");
    expect(imageMarkdown("attachments/Pasted image 2026-11-05 at 14.32.07.png", "Pasted image 2026-11-05 at 14.32.07.png")).toBe(
      "![](attachments/Pasted%20image%202026-11-05%20at%2014.32.07.png)",
    );
    expect(imageMarkdown("a/[x].png", "[x].png")).toBe("![x](a/%5Bx%5D.png)");
  });
});

describe("isImageFile", () => {
  it("accepts image types and image extensions", () => {
    expect(isImageFile({ name: "a.bin", type: "image/png" })).toBe(true);
    expect(isImageFile({ name: "photo.JPG", type: "" })).toBe(true);
    expect(isImageFile({ name: "notes.pdf", type: "application/pdf" })).toBe(false);
  });
});
