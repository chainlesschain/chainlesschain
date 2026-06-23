/**
 * lru-cache 测试 — src/renderer/utils/lru-cache.ts
 *
 * Pure, dependency-free LRU cache + file-metadata cache. Fresh instances per
 * test; fake timers only for the TTL-expiry case.
 */

import { describe, it, expect, vi } from "vitest";

import { LRUCache, FileMetadataCache } from "@/utils/lru-cache";

describe("LRUCache — basic get/set/has/size", () => {
  it("stores and retrieves values", () => {
    const c = new LRUCache<number>(3);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.has("a")).toBe(true);
    expect(c.has("missing")).toBe(false);
    expect(c.get("missing")).toBeUndefined();
    expect(c.size()).toBe(1);
  });

  it("set on an existing key replaces the value", () => {
    const c = new LRUCache<number>(3);
    c.set("a", 1);
    c.set("a", 2);
    expect(c.get("a")).toBe(2);
    expect(c.size()).toBe(1);
  });
});

describe("LRUCache — eviction", () => {
  it("evicts the least-recently-used entry at capacity", () => {
    const c = new LRUCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now most-recently-used → b is the LRU
    c.set("c", 3); // capacity reached → evict b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.size()).toBe(2);
  });
});

describe("LRUCache — capacity bound is enforced under edge/desync conditions", () => {
  it("never exceeds capacity even if accessOrder desyncs from the map", () => {
    const c = new LRUCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    // Simulate a desync: accessOrder loses its entries while the map is full.
    // Old eviction did `delete(accessOrder[0])` === `delete(undefined)` (a
    // no-op), silently skipping eviction and letting size grow unbounded.
    (c as unknown as { accessOrder: string[] }).accessOrder = [];
    c.set("c", 3);
    c.set("d", 4);
    expect(c.size()).toBeLessThanOrEqual(2); // bound still honored via map fallback
    expect(c.get("d")).toBe(4); // most recent insert survives
  });

  it("capacity 0 keeps at most one transient entry and does not throw", () => {
    const c = new LRUCache<number>(0);
    expect(() => {
      c.set("a", 1);
      c.set("b", 2);
    }).not.toThrow();
    expect(c.size()).toBeLessThanOrEqual(1);
  });
});

describe("LRUCache — TTL expiry", () => {
  it("expires entries past the TTL and removes them", () => {
    vi.useFakeTimers();
    try {
      const c = new LRUCache<string>(10, 1000);
      c.set("k", "v");
      expect(c.get("k")).toBe("v");
      vi.advanceTimersByTime(1001);
      expect(c.get("k")).toBeUndefined();
      expect(c.has("k")).toBe(false);
      expect(c.size()).toBe(0); // expired entry was deleted
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LRUCache — delete / clear / getStats", () => {
  it("delete removes one entry; clear empties the cache", () => {
    const c = new LRUCache<number>(5);
    c.set("a", 1);
    c.set("b", 2);
    c.delete("a");
    expect(c.has("a")).toBe(false);
    expect(c.size()).toBe(1);
    c.clear();
    expect(c.size()).toBe(0);
  });

  it("getStats reports size/capacity/usage/ttl", () => {
    const c = new LRUCache<number>(4, 1234);
    c.set("a", 1);
    const s = c.getStats();
    expect(s).toMatchObject({ size: 1, capacity: 4, ttl: 1234 });
    expect(s.usage).toBe("25.00%");
  });
});

describe("FileMetadataCache — per-category hit tracking", () => {
  it("counts misses then hits and reports hitRate", () => {
    const fmc = new FileMetadataCache();
    expect(fmc.getFileType("/f.ts")).toBeUndefined(); // miss
    fmc.setFileType("/f.ts", { lang: "ts" });
    expect(fmc.getFileType("/f.ts")).toEqual({ lang: "ts" }); // hit
    const stats = fmc.getStats();
    expect(stats.type.hits).toBe(1);
    expect(stats.type.misses).toBe(1);
    expect(stats.type.hitRate).toBe("50.00%");
  });

  it("categories are independent and clearAll empties them all", () => {
    const fmc = new FileMetadataCache();
    fmc.setSyntaxConfig("ts", { theme: "dark" });
    fmc.setOCRResult("hash1", "text");
    expect(fmc.getSyntaxConfig("ts")).toEqual({ theme: "dark" });
    expect(fmc.getOCRResult("hash1")).toBe("text");
    fmc.clearAll();
    expect(fmc.getSyntaxConfig("ts")).toBeUndefined();
    expect(fmc.getOCRResult("hash1")).toBeUndefined();
  });
});
