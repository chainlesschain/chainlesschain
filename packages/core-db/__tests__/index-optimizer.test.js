import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const {
  IndexOptimizer,
  getIndexOptimizer,
} = require("../lib/database/index-optimizer.js");
const { setLogger } = require("../lib/logger-adapter.js");

// Silence the adapter's default console logger during tests.
beforeAll(() => {
  setLogger({ debug() {}, info() {}, warn() {}, error() {} });
});

/**
 * Build a minimal db stand-in for IndexOptimizer (it only ever calls
 * `db.prepare(sql).all()`). `schema` maps tableName -> { columns, indexes },
 * where each index is { name, columns }. The fake answers the exact queries
 * analyze() issues: the table/index catalog and the table_info / index_info
 * PRAGMAs.
 */
function fakeDb(schema) {
  const tables = Object.keys(schema);
  const allIndexes = [];
  for (const t of tables) {
    for (const idx of schema[t].indexes || []) {
      allIndexes.push({ name: idx.name, tbl_name: t, columns: idx.columns });
    }
  }
  return {
    prepare(sql) {
      return {
        all() {
          if (sql.includes("type='table'")) {
            return tables.map((name) => ({ name }));
          }
          if (sql.includes("type='index'")) {
            return allIndexes.map((i) => ({
              name: i.name,
              tbl_name: i.tbl_name,
            }));
          }
          let m = sql.match(/PRAGMA table_info\((\w+)\)/);
          if (m) {
            return (schema[m[1]]?.columns || []).map((name) => ({ name }));
          }
          m = sql.match(/PRAGMA index_info\("(.+)"\)/);
          if (m) {
            const idxName = m[1].replace(/""/g, '"');
            const idx = allIndexes.find((i) => i.name === idxName);
            return (idx?.columns || []).map((name) => ({ name }));
          }
          return [];
        },
      };
    },
  };
}

describe("IndexOptimizer", () => {
  let opt;
  beforeEach(() => {
    opt = new IndexOptimizer();
  });

  describe("analyze", () => {
    it("returns empty result when no db is attached", () => {
      expect(opt.analyze()).toEqual({ suggestions: [], tables: [] });
    });

    it("flags a table with no indexes and more than 2 columns", () => {
      opt.db = fakeDb({
        notes: { columns: ["id", "title", "body"], indexes: [] },
      });
      const { suggestions } = opt.analyze();
      expect(suggestions.some((s) => s.type === "missing_index")).toBe(true);
    });

    it("does not flag a small (<=2 column) table as missing an index", () => {
      opt.db = fakeDb({ kv: { columns: ["k", "v"], indexes: [] } });
      const { suggestions } = opt.analyze();
      expect(suggestions.some((s) => s.type === "missing_index")).toBe(false);
    });

    it("suggests indexes on _id / _at / status / type columns that lack one", () => {
      opt.db = fakeDb({
        orders: {
          columns: ["order_id", "user_id", "status", "created_at", "note"],
          indexes: [],
        },
      });
      const cols = opt
        .analyze()
        .suggestions.filter((s) => s.type === "suggested_index")
        .map((s) => s.column);
      expect(cols).toEqual(
        expect.arrayContaining([
          "order_id",
          "user_id",
          "status",
          "created_at",
        ]),
      );
      expect(cols).not.toContain("note"); // plain column → no suggestion
    });

    it("recognizes an existing index by its actual columns, not its name (fixes substring match)", () => {
      // `idx_1` covers user_id but its NAME doesn't contain "user_id".
      // The old `idx.name.includes(col.name)` heuristic missed it and
      // suggested a duplicate; the column-aware check must suppress it.
      opt.db = fakeDb({
        orders: {
          columns: ["user_id", "status"],
          indexes: [{ name: "idx_1", columns: ["user_id"] }],
        },
      });
      const cols = opt
        .analyze()
        .suggestions.filter((s) => s.type === "suggested_index")
        .map((s) => s.column);
      expect(cols).not.toContain("user_id"); // already indexed under idx_1
      expect(cols).toContain("status"); // genuinely missing
    });

    it("does not let a name substring falsely suppress a needed suggestion", () => {
      // Index `idx_subtype` covers `subtype` only. Old code saw the name
      // contains "type" and wrongly suppressed the `type` suggestion.
      opt.db = fakeDb({
        items: {
          columns: ["type", "subtype"],
          indexes: [{ name: "idx_subtype", columns: ["subtype"] }],
        },
      });
      const cols = opt
        .analyze()
        .suggestions.filter((s) => s.type === "suggested_index")
        .map((s) => s.column);
      expect(cols).toContain("type"); // not actually indexed → must suggest
    });

    it("reports slow queries from the query log", () => {
      opt.db = fakeDb({ t: { columns: ["a", "b"], indexes: [] } });
      opt.logQuery("SELECT 1", 250);
      opt.logQuery("SELECT 2", 10);
      const slow = opt.analyze().suggestions.find((s) => s.type === "slow_queries");
      expect(slow).toBeDefined();
      expect(slow.message).toContain("1 queries");
    });

    it("returns an error result (not a throw) when a query fails", () => {
      opt.db = {
        prepare() {
          throw new Error("db is locked");
        },
      };
      const r = opt.analyze();
      expect(r.suggestions).toEqual([]);
      expect(r.error).toMatch(/db is locked/);
    });
  });

  describe("logQuery", () => {
    it("truncates the stored SQL to 500 chars", () => {
      opt.logQuery("x".repeat(2000), 5);
      expect(opt._queryLog[0].sql).toHaveLength(500);
    });

    it("caps the log at the configured limit (drops the oldest)", () => {
      opt._queryLogLimit = 3;
      for (let i = 0; i < 5; i++) opt.logQuery(`q${i}`, i);
      expect(opt._queryLog).toHaveLength(3);
      expect(opt._queryLog[0].sql).toBe("q2"); // q0,q1 dropped
    });
  });

  describe("getQueryStats", () => {
    it("returns zeros for an empty log", () => {
      expect(opt.getQueryStats()).toEqual({
        totalQueries: 0,
        avgDuration: 0,
        slowQueries: 0,
      });
    });

    it("computes rounded average, max and slow count", () => {
      opt.logQuery("a", 10);
      opt.logQuery("b", 20);
      opt.logQuery("c", 150);
      const s = opt.getQueryStats();
      expect(s.totalQueries).toBe(3);
      expect(s.avgDuration).toBe(60); // round((10+20+150)/3)
      expect(s.maxDuration).toBe(150);
      expect(s.slowQueries).toBe(1); // only the 150ms one is >100
    });
  });

  describe("getIndexOptimizer", () => {
    it("returns a shared singleton", () => {
      expect(getIndexOptimizer()).toBe(getIndexOptimizer());
    });
  });
});
