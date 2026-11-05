import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { countLabel, countMatches } from "./findPanel";

const state = (doc: string, from = 0, to = from) => EditorState.create({ doc, selection: EditorSelection.single(from, to) });

describe("countMatches", () => {
  it("counts matches and finds the selected one", () => {
    const q = new SearchQuery({ search: "ab" });
    expect(countMatches(state("ab ab ab", 3, 5), q)).toEqual({ total: 3, current: 2, capped: false });
    expect(countMatches(state("ab ab ab"), q)).toEqual({ total: 3, current: 0, capped: false });
  });

  it("stops counting at the limit", () => {
    expect(countMatches(state("a".repeat(50)), new SearchQuery({ search: "a" }), 10)).toEqual({ total: 10, current: 0, capped: true });
  });

  it("has nothing to count for an empty or invalid query", () => {
    expect(countMatches(state("x"), new SearchQuery({ search: "" }))).toBeNull();
    expect(countMatches(state("x"), new SearchQuery({ search: "(", regexp: true }))).toBeNull();
  });
});

describe("countLabel", () => {
  const q = new SearchQuery({ search: "a" });
  it("describes the count", () => {
    expect(countLabel({ total: 3, current: 2, capped: false }, q)).toBe("2 of 3");
    expect(countLabel({ total: 3, current: 0, capped: false }, q)).toBe("3 results");
    expect(countLabel({ total: 1, current: 0, capped: false }, q)).toBe("1 result");
    expect(countLabel({ total: 1000, current: 0, capped: true }, q)).toBe("1000+ results");
    expect(countLabel({ total: 0, current: 0, capped: false }, q)).toBe("No results");
  });
  it("flags a broken pattern and says nothing for an empty search", () => {
    expect(countLabel(null, new SearchQuery({ search: "(", regexp: true }))).toBe("Invalid pattern");
    expect(countLabel(null, new SearchQuery({ search: "" }))).toBe("");
  });
});
