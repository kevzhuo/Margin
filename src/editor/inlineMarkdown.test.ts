import { describe, expect, it } from "vitest";
import { markdownToText, renderInline } from "./inlineMarkdown";

const html = (src: string) => {
  const div = document.createElement("div");
  div.append(renderInline(src));
  return div;
};

describe("renderInline", () => {
  it("renders emphasis, strikethrough and code", () => {
    const el = html("**bold** *it* ~~gone~~ `x = 1`");
    expect(el.querySelector("strong")!.textContent).toBe("bold");
    expect(el.querySelector("em")!.textContent).toBe("it");
    expect(el.querySelector("del")!.textContent).toBe("gone");
    expect(el.querySelector("code.cm-md-inline-code")!.textContent).toBe("x = 1");
    expect(el.textContent).toBe("bold it gone x = 1");
  });

  it("shows a link's text, not its URL", () => {
    const el = html("See [the docs](https://example.com) and https://bare.example");
    const links = el.querySelectorAll(".cm-md-link");
    expect([...links].map((l) => [l.textContent, (l as HTMLElement).title])).toEqual([
      ["the docs", "https://example.com"],
      ["https://bare.example", "https://bare.example"],
    ]);
  });

  it("renders math with KaTeX, and a mistake as red source", () => {
    expect(html("$x^2$").querySelector(".katex")).not.toBeNull();
    const bad = html("$\\frac{a}{$").querySelector(".cm-md-math-error")!;
    expect(bad.textContent).toBe("\\frac{a}{");
  });

  it("treats HTML and escapes as text", () => {
    const el = html("<b>not bold</b> \\*literal\\*");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toBe("<b>not bold</b> *literal*");
  });
});

describe("markdownToText", () => {
  it("strips block markers and inline syntax", () => {
    expect(markdownToText("- Next up: [the roadmap](Projects/Roadmap.md#next)")).toBe("Next up: the roadmap");
    expect(markdownToText("## Roadmap")).toBe("Roadmap");
    expect(markdownToText("- [ ] **Buy** `milk`")).toBe("Buy milk");
    expect(markdownToText("> A *quoted* line")).toBe("A quoted line");
    expect(markdownToText("1. ~~Old~~ new")).toBe("Old new");
  });

  it("keeps math as its TeX", () => {
    expect(markdownToText("Euler: $e^{i\\pi} + 1 = 0$")).toBe("Euler: e^{i\\pi} + 1 = 0");
  });
});
