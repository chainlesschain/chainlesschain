/**
 * incremental-walker 单元测试 — Phase 3c.2
 *
 * 用 sql.js 内存 SQLite 验证：
 *   - 字典序游标 (updated_at, id) > (since, sinceId) 正确推进
 *   - 同一 ms 内多条按 id 升序，跨 ms 按 updated_at 升序
 *   - 空 cursor 返回所有 items
 *   - countPending 与 fetchBatch 一致
 *   - cursor 大于最大值时返回空
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const walker = require("../incremental-walker");

class TestDbManager {
  constructor(sqlJsDb) {
    this.db = sqlJsDb;
  }
  run(sql, params = []) {
    this.db.run(sql, params);
  }
  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    let row;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row;
  }
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

let SQL;
let dbManager;

beforeAll(async () => {
  const initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

beforeEach(() => {
  const sqlDb = new SQL.Database();
  sqlDb.exec(`
    CREATE TABLE knowledge_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  dbManager = new TestDbManager(sqlDb);
});

function seed(items) {
  for (const it of items) {
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        it.id,
        it.title,
        it.type ?? "note",
        it.content ?? "",
        it.created_at ?? 1,
        it.updated_at,
      ],
    );
  }
}

describe("incremental-walker · fetchBatch", () => {
  it("returns empty when no items", () => {
    expect(
      walker.fetchBatch(dbManager, { lastSyncAt: 0, lastItemId: null }),
    ).toEqual([]);
  });

  it("with empty cursor returns all items in (updated_at, id) ASC order", () => {
    seed([
      { id: "b", title: "b", updated_at: 100 },
      { id: "a", title: "a", updated_at: 100 },
      { id: "c", title: "c", updated_at: 50 },
    ]);
    const out = walker.fetchBatch(dbManager, {
      lastSyncAt: 0,
      lastItemId: null,
    });
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("filters out items at-or-before cursor (strictly greater)", () => {
    seed([
      { id: "a", title: "a", updated_at: 100 },
      { id: "b", title: "b", updated_at: 100 },
      { id: "c", title: "c", updated_at: 200 },
    ]);
    const out = walker.fetchBatch(dbManager, {
      lastSyncAt: 100,
      lastItemId: "a",
    });
    // > (100, "a") strictly: b at (100, "b") and c at (200, "c")
    expect(out.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("respects batch limit", () => {
    seed(
      Array.from({ length: 10 }, (_, i) => ({
        id: `id-${String(i).padStart(2, "0")}`,
        title: `t-${i}`,
        updated_at: 100 + i,
      })),
    );
    const out = walker.fetchBatch(
      dbManager,
      { lastSyncAt: 0, lastItemId: null },
      3,
    );
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.id)).toEqual(["id-00", "id-01", "id-02"]);
  });

  it("clamps batch to MAX_BATCH", () => {
    seed([{ id: "a", title: "a", updated_at: 1 }]);
    const out = walker.fetchBatch(
      dbManager,
      { lastSyncAt: 0, lastItemId: null },
      999999,
    );
    expect(out).toHaveLength(1);
  });

  it("returns empty when cursor is past the end", () => {
    seed([{ id: "a", title: "a", updated_at: 100 }]);
    const out = walker.fetchBatch(dbManager, {
      lastSyncAt: 200,
      lastItemId: "z",
    });
    expect(out).toEqual([]);
  });
});

describe("incremental-walker · nextCursorFromBatch", () => {
  it("returns null for empty batch", () => {
    expect(walker.nextCursorFromBatch([])).toBeNull();
    expect(walker.nextCursorFromBatch(null)).toBeNull();
  });

  it("returns last item's (updated_at, id)", () => {
    const c = walker.nextCursorFromBatch([
      { id: "a", updated_at: 100 },
      { id: "b", updated_at: 200 },
    ]);
    expect(c).toEqual({ lastSyncAt: 200, lastItemId: "b" });
  });
});

describe("incremental-walker · cursorAfterItem", () => {
  it("extracts cursor from a single item", () => {
    expect(walker.cursorAfterItem({ id: "x", updated_at: 42 })).toEqual({
      lastSyncAt: 42,
      lastItemId: "x",
    });
  });
});

describe("incremental-walker · countPending", () => {
  it("returns 0 when no items past cursor", () => {
    seed([{ id: "a", title: "a", updated_at: 50 }]);
    expect(
      walker.countPending(dbManager, { lastSyncAt: 100, lastItemId: null }),
    ).toBe(0);
  });

  it("matches fetchBatch behavior on count", () => {
    seed([
      { id: "a", title: "a", updated_at: 100 },
      { id: "b", title: "b", updated_at: 100 },
      { id: "c", title: "c", updated_at: 200 },
      { id: "d", title: "d", updated_at: 50 },
    ]);
    const cursor = { lastSyncAt: 100, lastItemId: "a" };
    const items = walker.fetchBatch(dbManager, cursor);
    const count = walker.countPending(dbManager, cursor);
    expect(count).toBe(items.length);
    expect(count).toBe(2); // b at (100,b), c at (200,c)
  });

  it("returns total count for empty cursor", () => {
    seed(
      Array.from({ length: 7 }, (_, i) => ({
        id: `id-${i}`,
        title: `t-${i}`,
        updated_at: 100 + i,
      })),
    );
    expect(
      walker.countPending(dbManager, { lastSyncAt: 0, lastItemId: null }),
    ).toBe(7);
  });
});
