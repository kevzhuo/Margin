import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { mathSyntax, mathTex } from "./mathSyntax";

const parser = (markdownLanguage.parser as MarkdownParser).configure(mathSyntax);

/** Every math node in `doc` as "Kind: tex". */
function math(doc: string): string[] {
  const text = Text.of(doc.split("\n"));
  const out: string[] = [];
  parser.parse(doc).iterate({
    enter(n) {
      if (n.name === "InlineMath" || n.name === "BlockMath") out.push(`${n.name}: ${mathTex(n.node, text)}`);
    },
  });
  return out;
}

describe("inline math", () => {
  it("parses $…$", () => {
    expect(math("Energy is $E = mc^2$ here.")).toEqual(["InlineMath: E = mc^2"]);
  });

  it("parses several on a line", () => {
    expect(math("$a$ and $b$")).toEqual(["InlineMath: a", "InlineMath: b"]);
  });

  it("leaves prices alone", () => {
    expect(math("It costs $5 and $10.")).toEqual([]);
    expect(math("Between $5 and $10, or $20")).toEqual([]);
  });

  it("needs non-space just inside the dollars", () => {
    expect(math("$ x$")).toEqual([]);
    expect(math("$x $")).toEqual([]);
  });

  it("does not close before a digit", () => {
    expect(math("$x$5")).toEqual([]);
  });

  it("ignores escaped dollars", () => {
    expect(math("Not \\$math$ here")).toEqual([]);
    expect(math("$a \\$ b$")).toEqual(["InlineMath: a \\$ b"]);
  });

  it("ignores dollars in code", () => {
    expect(math("Use `$x$` literally")).toEqual([]);
    expect(math("```\n$x$\n```")).toEqual([]);
  });

  it("does not parse Markdown inside math", () => {
    const doc = "$a_1 * b_2 * c$";
    expect(math(doc)).toEqual(["InlineMath: a_1 * b_2 * c"]);
    const names: string[] = [];
    parser.parse(doc).iterate({ enter: (n) => void names.push(n.name) });
    expect(names).not.toContain("Emphasis");
  });

  it("treats $$…$$ inside a paragraph as display math", () => {
    expect(math("So $$x^2$$ is it")).toEqual(["InlineMath: x^2"]);
  });

  it("ignores empty pairs", () => {
    expect(math("$$ and $$$$")).toEqual([]);
  });
});

describe("block math", () => {
  it("parses a multi-line block", () => {
    expect(math("Before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nAfter")).toEqual(["BlockMath: \\int_0^1 x\\,dx"]);
  });

  it("parses a single-line block", () => {
    expect(math("$$ E = mc^2 $$")).toEqual(["BlockMath: E = mc^2"]);
  });

  it("accepts a closing $$ at the end of the last line", () => {
    expect(math("$$\na = b\\\\\nc = d$$")).toEqual(["BlockMath: a = b\\\\\nc = d"]);
  });

  it("interrupts a paragraph", () => {
    expect(math("The formula:\n$$\nx\n$$")).toEqual(["BlockMath: x"]);
  });

  it("ends an unclosed block at the next blank line", () => {
    const doc = "$$\nx = 1\n\nA paragraph with *emphasis*.";
    expect(math(doc)).toEqual(["BlockMath: x = 1"]);
    const names: string[] = [];
    parser.parse(doc).iterate({ enter: (n) => void names.push(n.name) });
    expect(names).toContain("Emphasis");
  });

  it("works inside a quote, without the quote markers", () => {
    expect(math("> $$\n> a + b\n> $$")).toEqual(["BlockMath: a + b"]);
  });

  it("works inside a list item", () => {
    expect(math("- Item\n\n  $$\n  x\n  $$")).toEqual(["BlockMath: x"]);
  });

  it("is not a block when text follows the closing $$", () => {
    expect(math("$$a$$ and more")).toEqual(["InlineMath: a"]);
  });
});
