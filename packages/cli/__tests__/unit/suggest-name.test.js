/**
 * Unit tests for suggest-name — "did you mean?" typo suggestions.
 * Claude-Code 2.1.186 `mcp get/remove` typo-suggestion parity.
 */
import { describe, it, expect } from "vitest";
import {
  editDistance,
  suggestNames,
  notFoundWithSuggestion,
} from "../../src/lib/suggest-name.js";

describe("editDistance", () => {
  it("is 0 for identical strings", () => {
    expect(editDistance("context7", "context7")).toBe(0);
  });
  it("counts single-char typos and transpositions", () => {
    expect(editDistance("cotnext7", "context7")).toBe(2); // transposition = 2 edits
    expect(editDistance("contex7", "context7")).toBe(1); // deletion
    expect(editDistance("contextt7", "context7")).toBe(1); // insertion
  });
  it("handles empty inputs", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("", "")).toBe(0);
    expect(editDistance(null, undefined)).toBe(0);
  });
});

describe("suggestNames", () => {
  const servers = ["context7", "github", "filesystem", "fetch"];

  it("suggests the closest name for a single-char typo", () => {
    expect(suggestNames("contex7", servers)).toEqual(["context7"]);
    expect(suggestNames("gihub", servers)).toEqual(["github"]);
  });

  it("ranks substring matches first", () => {
    // "fet" is a substring of "fetch" (contains) → before any edit-distance one
    expect(suggestNames("fet", servers)[0]).toBe("fetch");
  });

  it("excludes an exact match (not a typo)", () => {
    expect(suggestNames("github", servers)).not.toContain("github");
  });

  it("returns [] when nothing is close", () => {
    expect(suggestNames("zzzzzzzz", servers)).toEqual([]);
  });

  it("respects limit", () => {
    const many = ["aaa", "aab", "aac", "aad", "aae"];
    expect(suggestNames("aaa", many, { limit: 2 })).toHaveLength(2);
  });

  it("is stable/alphabetical for equal-distance ties", () => {
    // both 1 edit from "aaX": order by name
    expect(suggestNames("aax", ["aaz", "aab"])).toEqual(["aab", "aaz"]);
  });

  it("guards bad inputs", () => {
    expect(suggestNames("", servers)).toEqual([]);
    expect(suggestNames("x", null)).toEqual([]);
    expect(suggestNames(undefined, servers)).toEqual([]);
  });
});

describe("notFoundWithSuggestion", () => {
  const servers = ["context7", "github"];

  it("appends a did-you-mean hint when close", () => {
    expect(notFoundWithSuggestion("contex7", servers, { noun: "Server" })).toBe(
      'Server "contex7" not found — did you mean "context7"?',
    );
  });

  it("returns just the base when nothing is close", () => {
    expect(notFoundWithSuggestion("zzz", servers, { noun: "Server" })).toBe(
      'Server "zzz" not found',
    );
  });

  it("defaults the noun to 'item'", () => {
    expect(notFoundWithSuggestion("zzz", [])).toBe('item "zzz" not found');
  });

  it("lists multiple hints comma-separated", () => {
    const out = notFoundWithSuggestion("aa", ["aab", "aac"], { noun: "X" });
    expect(out).toBe('X "aa" not found — did you mean "aab", "aac"?');
  });
});
