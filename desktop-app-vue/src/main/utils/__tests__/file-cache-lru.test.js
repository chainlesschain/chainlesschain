import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { LRUCache } = require("../file-cache.js");

describe("LRUCache", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stores and retrieves values; misses return null", () => {
    const c = new LRUCache({ maxSize: 10, maxBytes: 1000, ttl: 100000 });
    c.set("a", "A", 1);
    expect(c.get("a")).toBe("A");
    expect(c.get("missing")).toBeNull();
  });

  it("expires entries after ttl and removes them (ttl from write time)", () => {
    let t = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const c = new LRUCache({ maxSize: 10, maxBytes: 1000, ttl: 500 });
    c.set("a", "A", 1);
    t = 1499; // 499ms since write — still valid (and bumps LRU, keeping timestamp)
    expect(c.get("a")).toBe("A");
    t = 1600; // 600ms since write — expired
    expect(c.get("a")).toBeNull();
    expect(c.getStats().entries).toBe(0); // expiry deletes the entry
    expect(c.getStats().bytes).toBe(0);
  });

  it("evicts the least-recently-used entry when over the entry limit", () => {
    const c = new LRUCache({ maxSize: 2, maxBytes: 100000, ttl: 100000 });
    c.set("a", "A", 1);
    c.set("b", "B", 1);
    c.get("a"); // touch a → b is now least-recently-used
    c.set("c", "C", 1); // over maxSize → evict b
    expect(c.get("b")).toBeNull();
    expect(c.get("a")).toBe("A");
    expect(c.get("c")).toBe("C");
    expect(c.getStats().entries).toBe(2);
  });

  it("evicts to stay within the byte budget", () => {
    const c = new LRUCache({ maxSize: 100, maxBytes: 10, ttl: 100000 });
    c.set("a", "A", 6);
    c.set("b", "B", 6); // 6+6 > 10 → evict a before inserting b
    expect(c.get("a")).toBeNull();
    expect(c.get("b")).toBe("B");
    expect(c.getStats().bytes).toBe(6);
  });

  it("adjusts byte accounting when a key is overwritten", () => {
    const c = new LRUCache({ maxSize: 100, maxBytes: 1000, ttl: 100000 });
    c.set("a", "A", 10);
    expect(c.getStats().bytes).toBe(10);
    c.set("a", "A2", 3); // overwrite: remove old size (10) then add new (3)
    expect(c.get("a")).toBe("A2");
    expect(c.getStats().bytes).toBe(3);
    expect(c.getStats().entries).toBe(1);
  });

  it("delete removes the entry, returns true/false, and adjusts bytes", () => {
    const c = new LRUCache({ maxSize: 100, maxBytes: 1000, ttl: 100000 });
    c.set("a", "A", 5);
    expect(c.delete("a")).toBe(true);
    expect(c.delete("a")).toBe(false); // already gone
    expect(c.get("a")).toBeNull();
    expect(c.getStats().bytes).toBe(0);
  });

  it("clear empties the cache and resets byte accounting", () => {
    const c = new LRUCache({ maxSize: 100, maxBytes: 1000, ttl: 100000 });
    c.set("a", "A", 5);
    c.set("b", "B", 7);
    c.clear();
    expect(c.getStats().entries).toBe(0);
    expect(c.getStats().bytes).toBe(0);
    expect(c.get("a")).toBeNull();
  });

  it("has() reflects presence and expiry", () => {
    let t = 0;
    vi.spyOn(Date, "now").mockImplementation(() => t);
    const c = new LRUCache({ maxSize: 10, maxBytes: 1000, ttl: 100 });
    c.set("a", "A", 1);
    expect(c.has("a")).toBe(true);
    expect(c.has("missing")).toBe(false);
    t = 200; // past ttl
    expect(c.has("a")).toBe(false);
  });

  it("getStats reports entries, bytes and utilization", () => {
    const c = new LRUCache({ maxSize: 10, maxBytes: 100, ttl: 100000 });
    c.set("a", "A", 25);
    const stats = c.getStats();
    expect(stats.entries).toBe(1);
    expect(stats.bytes).toBe(25);
    expect(stats.maxEntries).toBe(10);
    expect(stats.maxBytes).toBe(100);
    expect(stats.utilizationPercent).toBe("25.00");
  });
});
