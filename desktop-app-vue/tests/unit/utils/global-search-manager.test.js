/**
 * globalSearchManager 测试 — src/renderer/utils/globalSearchManager.ts
 *
 * Self-contained inverted-index search singleton (only logger + vue). Tested
 * through the useGlobalSearch() composable. Uses unique query tokens so the
 * shared singleton's index doesn't cross-contaminate cases.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useGlobalSearch, SearchType } from "@/utils/globalSearchManager";

let s;
beforeEach(() => {
  s = useGlobalSearch();
  s.clearHistory();
});

describe("globalSearchManager — index + search", () => {
  it("finds an indexed item by a title token", async () => {
    s.addToIndex(SearchType.NOTES, {
      id: "n-uniqalpha",
      title: "uniqalpha beta",
    });
    const results = await s.search("uniqalpha");
    expect(results.some((r) => r.id === "n-uniqalpha")).toBe(true);
  });

  it("batch-indexes and finds multiple items", async () => {
    s.addBatchToIndex(SearchType.FILES, [
      { id: "f-uniqgamma1", title: "uniqgamma one" },
      { id: "f-uniqgamma2", title: "uniqgamma two" },
    ]);
    const results = await s.search("uniqgamma");
    const ids = results.map((r) => r.id);
    expect(ids).toContain("f-uniqgamma1");
    expect(ids).toContain("f-uniqgamma2");
  });

  it("removeFromIndex drops an item from results", async () => {
    s.addToIndex(SearchType.NOTES, { id: "n-uniqdelta", title: "uniqdelta x" });
    expect(
      (await s.search("uniqdelta")).some((r) => r.id === "n-uniqdelta"),
    ).toBe(true);
    s.removeFromIndex(SearchType.NOTES, "n-uniqdelta");
    expect(
      (await s.search("uniqdelta")).some((r) => r.id === "n-uniqdelta"),
    ).toBe(false);
  });

  it("returns [] for an empty query", async () => {
    expect(await s.search("")).toEqual([]);
    expect(await s.search("   ")).toEqual([]);
  });

  it("scores title matches above content-only matches", async () => {
    s.addToIndex(SearchType.NOTES, {
      id: "hit-title",
      title: "uniqscore here",
    });
    s.addToIndex(SearchType.NOTES, {
      id: "hit-content",
      title: "other",
      content: "mentions uniqscore inside",
    });
    const results = await s.search("uniqscore");
    const title = results.find((r) => r.id === "hit-title");
    const content = results.find((r) => r.id === "hit-content");
    expect(title.score).toBeGreaterThan(content.score);
  });
});

describe("globalSearchManager — history + suggestions", () => {
  it("records searches and suggests by substring (recent first)", async () => {
    await s.search("hello world");
    await s.search("help me please");
    const sugg = s.getSuggestions("hel");
    expect(sugg).toContain("hello world");
    expect(sugg).toContain("help me please");
    // most recent first
    expect(sugg[0]).toBe("help me please");
  });

  it("getSuggestions returns [] for an empty query", () => {
    expect(s.getSuggestions("")).toEqual([]);
  });

  it("clearHistory empties history and suggestions", async () => {
    await s.search("temporary query");
    s.clearHistory();
    expect(s.searchHistory.value).toEqual([]);
    expect(s.getSuggestions("temp")).toEqual([]);
  });

  it("dedupes a repeated query to a single most-recent entry", async () => {
    await s.search("dupe query");
    await s.search("other");
    await s.search("dupe query");
    const matches = s.searchHistory.value.filter(
      (h) => h.query === "dupe query",
    );
    expect(matches).toHaveLength(1);
    expect(s.searchHistory.value[0].query).toBe("dupe query");
  });
});

describe("globalSearchManager — statistics + providers", () => {
  it("getStatistics reflects added items (delta)", () => {
    const before = s.getStatistics()[SearchType.PROJECTS] || 0;
    s.addBatchToIndex(SearchType.PROJECTS, [
      { id: "p-uniqstat1", title: "stat one" },
      { id: "p-uniqstat2", title: "stat two" },
    ]);
    expect(s.getStatistics()[SearchType.PROJECTS]).toBe(before + 2);
  });

  it("includes results from a registered provider", async () => {
    s.registerProvider(SearchType.COMMANDS, async (q) =>
      q.includes("uniqprov")
        ? [{ id: "cmd-uniqprov", title: "provided cmd" }]
        : [],
    );
    const results = await s.search("uniqprov");
    expect(results.some((r) => r.id === "cmd-uniqprov")).toBe(true);
  });
});
