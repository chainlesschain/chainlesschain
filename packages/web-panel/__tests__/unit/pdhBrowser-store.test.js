/**
 * Phase 16 — pdhBrowser Pinia store covers:
 *   - search() replaces results + cursor + facets, races resolve correctly
 *   - loadMore() appends pages and advances cursor
 *   - setFilter() debounces (300ms) before re-search
 *   - reset() clears everything
 *   - facet call drops adapter/subtype/category (else sidebar bucket counts
 *     would always show 100% in the selected category)
 *
 * The composable's searchEvents/facetCounts are mocked so this runs without
 * a WS connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const searchEvents = vi.fn();
const facetCounts = vi.fn();

vi.mock("../../src/composables/usePersonalDataHub.js", () => ({
  usePersonalDataHub: () => ({
    searchEvents: (...args) => searchEvents(...args),
    facetCounts: (...args) => facetCounts(...args),
  }),
}));

import { usePdhBrowserStore } from "../../src/stores/pdhBrowser.js";

function eventFx(id, occurredAt, adapter = "wechat") {
  return {
    id,
    type: "event",
    subtype: "chat.message",
    occurredAt,
    content: { text: `event-${id}` },
    source: { adapter, adapterVersion: "0.1", capturedAt: 0, capturedBy: "t" },
  };
}

describe("pdhBrowser store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    searchEvents.mockReset();
    facetCounts.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initial state is empty", () => {
    const s = usePdhBrowserStore();
    expect(s.results).toEqual([]);
    expect(s.cursor).toBeNull();
    expect(s.hasResults).toBe(false);
    expect(s.canLoadMore).toBe(false);
    expect(s.facets.total).toBe(0);
    expect(s.filters.q).toBe("");
  });

  it("search() populates results / cursor / facets / mode", async () => {
    searchEvents.mockResolvedValueOnce({
      rows: [eventFx("a", 100), eventFx("b", 90)],
      nextCursor: { occurredAt: 90, id: "b" },
      mode: "fts5",
      shortQuery: false,
    });
    facetCounts.mockResolvedValueOnce({
      byCategory: { chat: 2 },
      byAdapter: { wechat: 2 },
      bySubtype: { "chat.message": 2 },
      total: 2,
      mode: "fts5",
      shortQuery: false,
    });

    const s = usePdhBrowserStore();
    await s.search();

    expect(s.results.length).toBe(2);
    expect(s.cursor).toEqual({ occurredAt: 90, id: "b" });
    expect(s.facets.byCategory.chat).toBe(2);
    expect(s.mode).toBe("fts5");
    expect(s.isLoading).toBe(false);
    expect(s.hasResults).toBe(true);
    expect(s.canLoadMore).toBe(true);
  });

  it("loadMore() appends and advances cursor", async () => {
    // First page
    searchEvents.mockResolvedValueOnce({
      rows: [eventFx("a", 100)],
      nextCursor: { occurredAt: 100, id: "a" },
      mode: "fts5",
      shortQuery: false,
    });
    facetCounts.mockResolvedValueOnce({
      byCategory: {}, byAdapter: {}, bySubtype: {}, total: 1,
    });
    const s = usePdhBrowserStore();
    await s.search();
    expect(s.results.length).toBe(1);

    // loadMore
    searchEvents.mockResolvedValueOnce({
      rows: [eventFx("b", 90), eventFx("c", 80)],
      nextCursor: null,
      mode: "fts5",
      shortQuery: false,
    });
    await s.loadMore();

    expect(s.results.length).toBe(3);
    expect(s.results.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(s.cursor).toBeNull();
    expect(s.canLoadMore).toBe(false);
    expect(s.isAppending).toBe(false);
  });

  it("loadMore() is no-op when no cursor", async () => {
    const s = usePdhBrowserStore();
    s.cursor = null;
    await s.loadMore();
    expect(searchEvents).not.toHaveBeenCalled();
  });

  it("setFilter() debounces search 300ms", async () => {
    searchEvents.mockResolvedValue({
      rows: [], nextCursor: null, mode: "fts5", shortQuery: false,
    });
    facetCounts.mockResolvedValue({ byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0 });

    const s = usePdhBrowserStore();
    s.setFilter("q", "a");
    s.setFilter("q", "ab");
    s.setFilter("q", "abc"); // only this last value should fire
    expect(searchEvents).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(searchEvents).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    // allow promise microtasks to flush
    await vi.runAllTicks();
    await Promise.resolve();
    expect(searchEvents).toHaveBeenCalledOnce();
    expect(searchEvents.mock.calls[0][0].q).toBe("abc");
  });

  it("setFilter rejects unknown keys", () => {
    const s = usePdhBrowserStore();
    expect(() => s.setFilter("noSuchKey", 1)).toThrow(/unknown key/);
  });

  it("facetCounts call strips adapter/category/subtype", async () => {
    searchEvents.mockResolvedValueOnce({
      rows: [], nextCursor: null, mode: "fts5", shortQuery: false,
    });
    facetCounts.mockResolvedValueOnce({ byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0 });

    const s = usePdhBrowserStore();
    s.filters.q = "kw";
    s.filters.category = "chat";
    s.filters.adapter = "wechat";
    s.filters.subtype = "chat.message";
    s.filters.since = 1000;
    s.filters.until = 2000;

    await s.search();

    const facetArgs = facetCounts.mock.calls[0][0];
    expect(facetArgs).toEqual({ q: "kw", since: 1000, until: 2000 });
    expect(facetArgs.adapter).toBeUndefined();
    expect(facetArgs.category).toBeUndefined();
    expect(facetArgs.subtype).toBeUndefined();
  });

  it("stale search response is dropped when newer search started", async () => {
    let resolveFirst;
    searchEvents.mockImplementationOnce(
      () => new Promise((r) => { resolveFirst = r; })
    );
    facetCounts.mockResolvedValueOnce({ byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0 });

    const s = usePdhBrowserStore();
    const firstP = s.search();

    // Second search kicks in before first resolves
    searchEvents.mockResolvedValueOnce({
      rows: [eventFx("new", 999)], nextCursor: null, mode: "fts5", shortQuery: false,
    });
    facetCounts.mockResolvedValueOnce({ byCategory: {}, byAdapter: {}, bySubtype: {}, total: 1 });
    await s.search();
    expect(s.results.map((e) => e.id)).toEqual(["new"]);

    // Now resolve the stale first response with different data
    resolveFirst({
      rows: [eventFx("stale", 1)], nextCursor: null, mode: "fts5", shortQuery: false,
    });
    await firstP;

    // Stale response must NOT overwrite the newer results
    expect(s.results.map((e) => e.id)).toEqual(["new"]);
  });

  it("reset() clears filters + results + facets", async () => {
    const s = usePdhBrowserStore();
    s.filters.q = "x";
    s.results = [eventFx("a", 100)];
    s.cursor = { occurredAt: 100, id: "a" };
    s.facets = { byCategory: { chat: 1 }, byAdapter: {}, bySubtype: {}, total: 1 };
    s.reset();
    expect(s.filters.q).toBe("");
    expect(s.results).toEqual([]);
    expect(s.cursor).toBeNull();
    expect(s.facets.total).toBe(0);
  });

  it("error from searchEvents lands in store.error and clears results", async () => {
    searchEvents.mockRejectedValueOnce(new Error("WS gateway timeout"));
    facetCounts.mockResolvedValueOnce({ byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0 });

    const s = usePdhBrowserStore();
    await s.search();
    expect(s.error).toMatch(/WS gateway timeout/);
    expect(s.results).toEqual([]);
    expect(s.isLoading).toBe(false);
  });
});
