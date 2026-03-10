import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { IndexOptimizer } = require("../index-optimizer");

describe("IndexOptimizer", () => {
  let optimizer;
  let db;

  beforeEach(() => {
    optimizer = new IndexOptimizer();
    db = createMockDB();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with empty state", () => {
      expect(optimizer.db).toBeNull();
      expect(optimizer.initialized).toBe(false);
      expect(optimizer._queryLog).toEqual([]);
      expect(optimizer._suggestions).toEqual([]);
    });
  });

  describe("initialize", () => {
    it("should set db and mark initialized", async () => {
      await optimizer.initialize(db);
      expect(optimizer.db).toBe(db);
      expect(optimizer.initialized).toBe(true);
    });

    it("should be idempotent", async () => {
      await optimizer.initialize(db);
      const db2 = createMockDB();
      await optimizer.initialize(db2);
      expect(optimizer.db).toBe(db); // Still first db
    });
  });

  describe("logQuery", () => {
    it("should add query to the log", () => {
      optimizer.logQuery("SELECT * FROM users", 50);
      expect(optimizer._queryLog).toHaveLength(1);
      expect(optimizer._queryLog[0].sql).toBe("SELECT * FROM users");
      expect(optimizer._queryLog[0].duration).toBe(50);
    });

    it("should truncate long SQL to 500 chars", () => {
      const longSQL = "X".repeat(1000);
      optimizer.logQuery(longSQL, 10);
      expect(optimizer._queryLog[0].sql.length).toBe(500);
    });

    it("should evict oldest entry when exceeding limit", () => {
      optimizer._queryLogLimit = 3;
      optimizer.logQuery("q1", 10);
      optimizer.logQuery("q2", 20);
      optimizer.logQuery("q3", 30);
      optimizer.logQuery("q4", 40);
      expect(optimizer._queryLog).toHaveLength(3);
      expect(optimizer._queryLog[0].sql).toBe("q2");
    });

    it("should store timestamp", () => {
      optimizer.logQuery("q1", 10);
      expect(typeof optimizer._queryLog[0].timestamp).toBe("number");
    });
  });

  describe("analyze", () => {
    it("should return empty results when db is null", () => {
      const result = optimizer.analyze();
      expect(result).toEqual({ suggestions: [], tables: [] });
    });

    it("should detect tables without indexes", async () => {
      await optimizer.initialize(db);

      // First call: tables, second: indexes, third+: PRAGMA table_info per table
      const callCount = 0;
      db.prepare.mockImplementation((sql) => {
        if (sql.includes("sqlite_master") && sql.includes("type='table'")) {
          return { all: () => [{ name: "users" }] };
        }
        if (sql.includes("sqlite_master") && sql.includes("type='index'")) {
          return { all: () => [] }; // No indexes
        }
        if (sql.includes("PRAGMA table_info")) {
          return {
            all: () => [{ name: "id" }, { name: "name" }, { name: "email" }],
          };
        }
        return { all: () => [], get: () => null, run: vi.fn() };
      });

      const result = optimizer.analyze();
      expect(result.suggestions.some((s) => s.type === "missing_index")).toBe(
        true,
      );
      expect(result.tables).toEqual(["users"]);
    });

    it("should suggest indexes for _id and _at columns", async () => {
      await optimizer.initialize(db);

      db.prepare.mockImplementation((sql) => {
        if (sql.includes("type='table'")) {
          return { all: () => [{ name: "orders" }] };
        }
        if (sql.includes("type='index'")) {
          return { all: () => [] };
        }
        if (sql.includes("PRAGMA")) {
          return {
            all: () => [
              { name: "id" },
              { name: "user_id" },
              { name: "created_at" },
            ],
          };
        }
        return { all: () => [], get: () => null, run: vi.fn() };
      });

      const result = optimizer.analyze();
      const indexSuggestions = result.suggestions.filter(
        (s) => s.type === "suggested_index",
      );
      expect(indexSuggestions.length).toBeGreaterThanOrEqual(2);
      expect(indexSuggestions.some((s) => s.column === "user_id")).toBe(true);
      expect(indexSuggestions.some((s) => s.column === "created_at")).toBe(
        true,
      );
    });

    it("should detect slow queries", async () => {
      await optimizer.initialize(db);

      db.prepare.mockImplementation(() => ({
        all: () => [],
        get: () => null,
        run: vi.fn(),
      }));

      optimizer.logQuery("SELECT * FROM big_table", 200);
      optimizer.logQuery("SELECT * FROM small_table", 10);

      const result = optimizer.analyze();
      const slowSuggestion = result.suggestions.find(
        (s) => s.type === "slow_queries",
      );
      expect(slowSuggestion).toBeDefined();
      expect(slowSuggestion.severity).toBe("high");
    });

    it("should not flag slow queries when all are fast", async () => {
      await optimizer.initialize(db);

      db.prepare.mockImplementation(() => ({
        all: () => [],
        get: () => null,
        run: vi.fn(),
      }));

      optimizer.logQuery("q1", 10);
      optimizer.logQuery("q2", 50);

      const result = optimizer.analyze();
      expect(
        result.suggestions.find((s) => s.type === "slow_queries"),
      ).toBeUndefined();
    });

    it("should handle analysis errors gracefully", async () => {
      await optimizer.initialize(db);
      db.prepare.mockImplementation(() => {
        throw new Error("db error");
      });
      const result = optimizer.analyze();
      expect(result.suggestions).toEqual([]);
      expect(result.error).toBe("db error");
    });

    it("should report existing index count", async () => {
      await optimizer.initialize(db);

      db.prepare.mockImplementation((sql) => {
        if (sql.includes("type='table'")) {
          return { all: () => [] };
        }
        if (sql.includes("type='index'")) {
          return {
            all: () => [
              { name: "idx1", tbl_name: "t1" },
              { name: "idx2", tbl_name: "t2" },
            ],
          };
        }
        return { all: () => [], get: () => null, run: vi.fn() };
      });

      const result = optimizer.analyze();
      expect(result.existingIndexes).toBe(2);
    });
  });

  describe("getQueryStats", () => {
    it("should return zeros when no queries logged", () => {
      const stats = optimizer.getQueryStats();
      expect(stats).toEqual({
        totalQueries: 0,
        avgDuration: 0,
        slowQueries: 0,
      });
    });

    it("should compute correct statistics", () => {
      optimizer.logQuery("q1", 50);
      optimizer.logQuery("q2", 150);
      optimizer.logQuery("q3", 100);
      const stats = optimizer.getQueryStats();
      expect(stats.totalQueries).toBe(3);
      expect(stats.avgDuration).toBe(100);
      expect(stats.maxDuration).toBe(150);
      expect(stats.slowQueries).toBe(1); // only 150 > 100
    });

    it("should count all slow queries correctly", () => {
      optimizer.logQuery("q1", 200);
      optimizer.logQuery("q2", 300);
      optimizer.logQuery("q3", 50);
      const stats = optimizer.getQueryStats();
      expect(stats.slowQueries).toBe(2);
    });
  });
});
