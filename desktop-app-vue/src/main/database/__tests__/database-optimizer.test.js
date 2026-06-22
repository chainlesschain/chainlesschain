import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../logging/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import mod from "../database-optimizer.js";
const { QueryCache, DatabaseOptimizer } = mod;

// Minimal db stub — the pure helpers under test never touch it.
const fakeDb = () => ({
  run: vi.fn(),
  prepare: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []), get: vi.fn() })),
  exec: vi.fn(),
});

describe("QueryCache", () => {
  let cache;
  beforeEach(() => {
    cache = new QueryCache({ maxSize: 2, ttl: 1000 });
  });

  it("generates param-aware keys", () => {
    expect(cache.generateKey("SELECT 1", [1])).not.toBe(cache.generateKey("SELECT 1", [2]));
    expect(cache.generateKey("SELECT 1", [1])).toBe(cache.generateKey("SELECT 1", [1]));
  });

  it("hits on a stored entry and misses on different params", () => {
    cache.set("Q", [1], { r: 1 });
    expect(cache.get("Q", [1])).toEqual({ r: 1 });
    expect(cache.get("Q", [2])).toBeNull();
    const s = cache.getStats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
  });

  it("evicts the oldest entry at maxSize (FIFO)", () => {
    cache.set("A", [], { a: 1 });
    cache.set("B", [], { b: 1 });
    cache.set("C", [], { c: 1 }); // exceeds maxSize 2 → A evicted
    expect(cache.get("A", [])).toBeNull();
    expect(cache.get("C", [])).toEqual({ c: 1 });
    expect(cache.getStats().evictions).toBe(1);
  });

  it("expires entries past the ttl", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    cache.set("Q", [], { x: 1 });
    vi.setSystemTime(2000); // > ttl 1000
    expect(cache.get("Q", [])).toBeNull();
    vi.useRealTimers();
  });

  it("invalidate(pattern) drops only matching keys; no pattern clears all", () => {
    const c = new QueryCache();
    c.set("SELECT * FROM users", [], {});
    c.set("SELECT * FROM posts", [], {});
    c.invalidate("users");
    expect(c.get("SELECT * FROM users", [])).toBeNull();
    expect(c.get("SELECT * FROM posts", [])).toEqual({});
    c.invalidate(); // clears everything
    expect(c.get("SELECT * FROM posts", [])).toBeNull();
  });

  it("reports a formatted hit rate (and 0% with no traffic)", () => {
    expect(new QueryCache().getStats().hitRate).toBe("0%");
    cache.set("Q", [1], { r: 1 });
    cache.get("Q", [1]); // hit
    cache.get("Q", [2]); // miss
    expect(cache.getStats().hitRate).toBe("50.00%");
  });
});

describe("DatabaseOptimizer pure helpers", () => {
  let opt;
  beforeEach(() => {
    opt = new DatabaseOptimizer(fakeDb(), {});
  });

  describe("isSelectQuery", () => {
    it("recognizes SELECT (case/space-insensitive)", () => {
      expect(opt.isSelectQuery("  select * from t")).toBe(true);
      expect(opt.isSelectQuery("SELECT 1")).toBe(true);
    });
    it("rejects non-SELECT statements", () => {
      expect(opt.isSelectQuery("INSERT INTO t VALUES (1)")).toBe(false);
      expect(opt.isSelectQuery("UPDATE t SET a=1")).toBe(false);
    });
    it("does NOT recognize a WITH/CTE read query (documented limitation)", () => {
      // A `WITH cte AS (...) SELECT ...` is a read query but starts with WITH,
      // so it is treated as non-SELECT and bypasses the query cache. Flagged,
      // not changed (touches caching/write-detection semantics).
      expect(opt.isSelectQuery("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(false);
    });
  });

  describe("generateIndexSuggestion", () => {
    it("suggests an index for a WHERE-equality column", () => {
      opt.generateIndexSuggestion("SELECT * FROM users WHERE email = ?", 150);
      const s = opt.getIndexSuggestions();
      expect(s).toHaveLength(1);
      expect(s[0]).toMatchObject({ table: "users", column: "email" });
      expect(s[0].sql).toContain("CREATE INDEX IF NOT EXISTS idx_users_email");
    });

    it("does not duplicate an existing table/column suggestion", () => {
      opt.generateIndexSuggestion("SELECT * FROM users WHERE email = ?", 150);
      opt.generateIndexSuggestion("SELECT id FROM users WHERE email = 'x'", 300);
      expect(opt.getIndexSuggestions()).toHaveLength(1);
    });

    it("suggests nothing without a WHERE-equality clause", () => {
      opt.generateIndexSuggestion("SELECT * FROM users", 150);
      opt.generateIndexSuggestion("SELECT * FROM users WHERE created_at > ?", 150);
      expect(opt.getIndexSuggestions()).toHaveLength(0);
    });
  });

  describe("generateTableSuggestions", () => {
    it("warns on a missing primary key and missing indexes", () => {
      const s = opt.generateTableSuggestions("t", [{ name: "a", pk: 0 }], []);
      expect(s.map((x) => x.type)).toEqual(["warning", "info"]);
    });
    it("is silent for a table with a PK and at least one index", () => {
      expect(
        opt.generateTableSuggestions("t", [{ name: "id", pk: 1 }], [{ name: "idx" }]),
      ).toEqual([]);
    });
  });

  describe("recordQueryPerformance", () => {
    it("tracks totals/avg and flags slow queries past the threshold", () => {
      const o = new DatabaseOptimizer(fakeDb(), { slowQueryThreshold: 100 });
      o.recordQueryPerformance("SELECT 1", [], 10); // fast
      o.recordQueryPerformance("SELECT * FROM t WHERE a = ?", [1], 250); // slow
      const stats = o.getStats();
      expect(stats.totalQueries).toBe(2);
      expect(stats.slowQueries).toBe(1);
      expect(stats.avgQueryTime).toBe(130); // (10 + 250) / 2
      expect(o.getSlowQueries()).toHaveLength(1);
    });
  });
});
