import { describe, expect, it } from "vitest";
import { fitKind, fitScale } from "./marginFit";

describe("fitScale", () => {
  it("leaves a mark that fits at full size", () => {
    expect(fitScale(300, 30, 1, 260)).toBe(1);
  });

  it("shrinks a mark just enough to reach the edge", () => {
    // 40px wide, ending at 300, may reach 268: 32px of room.
    expect(fitScale(300, 40, 1, 268)).toBe(0.8);
  });

  it("works from the width at the current scale", () => {
    // Drawn at 0.5, the mark's natural width is 40px.
    expect(fitScale(300, 20, 0.5, 268)).toBe(0.8);
    // Once the window widens, it grows back to full size.
    expect(fitScale(300, 20, 0.5, 200)).toBe(1);
  });

  it("rounds down so the mark never crosses the edge", () => {
    const scale = fitScale(300, 45.5, 1, 268);
    expect(45.5 * scale).toBeLessThanOrEqual(32);
  });

  it("never shrinks below the readable minimum", () => {
    expect(fitScale(300, 200, 1, 290)).toBe(0.4);
  });
});

describe("fitKind", () => {
  function markIn(lineClass: string, markClass: string) {
    const line = document.createElement("div");
    line.className = `cm-line ${lineClass}`;
    const mark = document.createElement("span");
    mark.className = markClass;
    line.append(mark);
    return mark;
  }

  it("names heading marks by level", () => {
    expect(fitKind(markIn("cm-md-heading cm-md-h4", "cm-md-mark cm-md-margin-mark"))).toBe("h4");
  });

  it("ignores marks outside headings", () => {
    expect(fitKind(markIn("cm-md-quote", "cm-md-mark cm-md-margin-mark"))).toBeNull();
  });
});
