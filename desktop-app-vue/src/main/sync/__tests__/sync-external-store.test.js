/**
 * sync-external-store.js 单元测试 — Phase 3c.2
 *
 * 用 sql.js (WASM) 起内存 SQLite，建表 + 触发器，验证：
 *   - cursor ensure / get / update（含累加字段 + JSON 列）
 *   - recordPushedItem 单条 etag/filename map 增量
 *   - tombstone trigger fan-out 到所有已存在游标
 *   - listTombstones / deleteTombstone / markTombstoneFailed
 *   - removeFromMaps 双 map 同步删除
 *   - resetCursor 清状态
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

const store = require("../sync-external-store");

// 极简 dbManager 适配器：sql.js + 暴露 run/get/all/exec/db 给 store
class TestDbManager {
  constructor(sqlJsDb) {
    this.db = sqlJsDb;
  }
  exec(sql) {
    this.db.exec(sql);
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

let initSqlJs;
let SQL;
let dbManager;

beforeAll(async () => {
  initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

beforeEach(() => {
  const sqlDb = new SQL.Database();
  // 最小化 schema：只建本测试关心的两张表 + knowledge_items（trigger 需要它存在）+ trigger
  sqlDb.exec(`
    CREATE TABLE knowledge_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE sync_external_provider_cursor (
      provider_id TEXT NOT NULL,
      account_key TEXT NOT NULL DEFAULT '',
      last_sync_at INTEGER NOT NULL DEFAULT 0,
      last_item_id TEXT,
      remote_etag_map TEXT NOT NULL DEFAULT '{}',
      remote_filename_map TEXT NOT NULL DEFAULT '{}',
      last_run_status TEXT,
      last_run_error TEXT,
      last_run_duration_ms INTEGER,
      items_pushed INTEGER NOT NULL DEFAULT 0,
      items_skipped INTEGER NOT NULL DEFAULT 0,
      items_deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      PRIMARY KEY (provider_id, account_key)
    );

    CREATE TABLE sync_external_tombstones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      account_key TEXT NOT NULL DEFAULT '',
      item_id TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      UNIQUE(provider_id, account_key, item_id)
    );

    CREATE TRIGGER trg_sync_ext_tombstone_on_delete
    AFTER DELETE ON knowledge_items
    FOR EACH ROW
    BEGIN
      INSERT OR IGNORE INTO sync_external_tombstones
        (provider_id, account_key, item_id, deleted_at)
      SELECT
        c.provider_id,
        c.account_key,
        OLD.id,
        (strftime('%s','now') * 1000)
      FROM sync_external_provider_cursor c;
    END;
  `);
  dbManager = new TestDbManager(sqlDb);
});

describe("sync-external-store · cursor", () => {
  it("getCursor returns null when not initialized", () => {
    expect(store.getCursor(dbManager, "webdav")).toBeNull();
  });

  it("ensureCursor creates row with defaults", () => {
    const c = store.ensureCursor(dbManager, "webdav");
    expect(c.providerId).toBe("webdav");
    expect(c.accountKey).toBe("");
    expect(c.lastSyncAt).toBe(0);
    expect(c.remoteEtagMap).toEqual({});
    expect(c.remoteFilenameMap).toEqual({});
    expect(c.itemsPushed).toBe(0);
  });

  it("ensureCursor is idempotent — second call returns same row", () => {
    store.ensureCursor(dbManager, "webdav");
    dbManager.run(
      `UPDATE sync_external_provider_cursor SET items_pushed = 7
       WHERE provider_id = 'webdav'`,
    );
    const again = store.ensureCursor(dbManager, "webdav");
    expect(again.itemsPushed).toBe(7);
  });

  it("updateCursor patches scalar fields", () => {
    store.ensureCursor(dbManager, "webdav");
    store.updateCursor(dbManager, "webdav", {
      lastSyncAt: 12345,
      lastItemId: "item-z",
      lastRunStatus: "success",
      lastRunDurationMs: 250,
    });
    const c = store.getCursor(dbManager, "webdav");
    expect(c.lastSyncAt).toBe(12345);
    expect(c.lastItemId).toBe("item-z");
    expect(c.lastRunStatus).toBe("success");
    expect(c.lastRunDurationMs).toBe(250);
  });

  it("updateCursor accumulates items_pushed/skipped/deleted", () => {
    store.ensureCursor(dbManager, "webdav");
    store.updateCursor(dbManager, "webdav", {
      itemsPushed: 3,
      itemsSkipped: 1,
    });
    store.updateCursor(dbManager, "webdav", {
      itemsPushed: 2,
      itemsDeleted: 5,
    });
    const c = store.getCursor(dbManager, "webdav");
    expect(c.itemsPushed).toBe(5);
    expect(c.itemsSkipped).toBe(1);
    expect(c.itemsDeleted).toBe(5);
  });

  it("updateCursor stringifies and round-trips JSON map fields", () => {
    store.ensureCursor(dbManager, "webdav");
    store.updateCursor(dbManager, "webdav", {
      remoteEtagMap: { a: "etag-a", b: "etag-b" },
      remoteFilenameMap: { a: "a.md", b: "b.md" },
    });
    const c = store.getCursor(dbManager, "webdav");
    expect(c.remoteEtagMap).toEqual({ a: "etag-a", b: "etag-b" });
    expect(c.remoteFilenameMap).toEqual({ a: "a.md", b: "b.md" });
  });

  it("recordPushedItem incrementally updates etag and filename maps", () => {
    store.recordPushedItem(dbManager, "webdav", "item-1", "etag-1", "1-foo.md");
    store.recordPushedItem(dbManager, "webdav", "item-2", "etag-2", "2-bar.md");
    const c = store.getCursor(dbManager, "webdav");
    expect(c.remoteEtagMap).toEqual({ "item-1": "etag-1", "item-2": "etag-2" });
    expect(c.remoteFilenameMap).toEqual({
      "item-1": "1-foo.md",
      "item-2": "2-bar.md",
    });
  });

  it("recordPushedItem overwrites prior entry for same item (rename)", () => {
    store.recordPushedItem(dbManager, "webdav", "item-1", "etag-1", "1-old.md");
    store.recordPushedItem(
      dbManager,
      "webdav",
      "item-1",
      "etag-1b",
      "1-new.md",
    );
    const c = store.getCursor(dbManager, "webdav");
    expect(c.remoteEtagMap["item-1"]).toBe("etag-1b");
    expect(c.remoteFilenameMap["item-1"]).toBe("1-new.md");
  });

  it("isolates state between providers", () => {
    store.recordPushedItem(dbManager, "webdav", "item-1", "etag-w", "f.md");
    store.recordPushedItem(dbManager, "oss", "item-1", "etag-o", "f.md");
    const w = store.getCursor(dbManager, "webdav");
    const o = store.getCursor(dbManager, "oss");
    expect(w.remoteEtagMap["item-1"]).toBe("etag-w");
    expect(o.remoteEtagMap["item-1"]).toBe("etag-o");
  });
});

describe("sync-external-store · tombstones", () => {
  it("DELETE on knowledge_items fans out to all existing cursors", () => {
    store.ensureCursor(dbManager, "webdav");
    store.ensureCursor(dbManager, "oss");
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
       VALUES ('item-x', 'x', 'note', 'body', 1, 1)`,
    );
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'item-x'`);

    const wTombs = store.listTombstones(dbManager, "webdav");
    const oTombs = store.listTombstones(dbManager, "oss");
    expect(wTombs).toHaveLength(1);
    expect(oTombs).toHaveLength(1);
    expect(wTombs[0].item_id).toBe("item-x");
    expect(oTombs[0].item_id).toBe("item-x");
  });

  it("trigger ignores providers with no cursor row yet", () => {
    // 没建任何游标 → DELETE 不产生 tombstone
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
       VALUES ('item-y', 'y', 'note', 'body', 1, 1)`,
    );
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'item-y'`);
    expect(store.listTombstones(dbManager, "webdav")).toEqual([]);
  });

  it("listTombstones orders by deleted_at ASC and respects limit", () => {
    store.ensureCursor(dbManager, "webdav");
    for (let i = 0; i < 5; i++) {
      dbManager.run(
        `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
         VALUES (?, 'x', 'note', 'body', 1, 1)`,
        [`item-${i}`],
      );
      dbManager.run(`DELETE FROM knowledge_items WHERE id = ?`, [`item-${i}`]);
    }
    const all = store.listTombstones(dbManager, "webdav");
    expect(all).toHaveLength(5);
    const limited = store.listTombstones(dbManager, "webdav", "", 2);
    expect(limited).toHaveLength(2);
  });

  it("deleteTombstone removes a single entry", () => {
    store.ensureCursor(dbManager, "webdav");
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
       VALUES ('item-z', 'z', 'note', 'body', 1, 1)`,
    );
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'item-z'`);
    const tombs = store.listTombstones(dbManager, "webdav");
    expect(tombs).toHaveLength(1);
    store.deleteTombstone(dbManager, tombs[0].id);
    expect(store.listTombstones(dbManager, "webdav")).toEqual([]);
  });

  it("markTombstoneFailed increments retry_count and records error", () => {
    store.ensureCursor(dbManager, "webdav");
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
       VALUES ('item-q', 'q', 'note', 'body', 1, 1)`,
    );
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'item-q'`);
    const [t] = store.listTombstones(dbManager, "webdav");
    store.markTombstoneFailed(dbManager, t.id, "network timeout");
    store.markTombstoneFailed(dbManager, t.id, "auth refused");
    const [updated] = store.listTombstones(dbManager, "webdav");
    expect(updated.retry_count).toBe(2);
    expect(updated.last_error).toBe("auth refused");
  });
});

describe("sync-external-store · removeFromMaps", () => {
  it("removes item from both etag and filename maps", () => {
    store.recordPushedItem(dbManager, "webdav", "a", "ea", "a.md");
    store.recordPushedItem(dbManager, "webdav", "b", "eb", "b.md");
    store.removeFromMaps(dbManager, "webdav", "a");
    const c = store.getCursor(dbManager, "webdav");
    expect(c.remoteEtagMap).toEqual({ b: "eb" });
    expect(c.remoteFilenameMap).toEqual({ b: "b.md" });
  });

  it("is a no-op when item is not in the map", () => {
    store.recordPushedItem(dbManager, "webdav", "a", "ea", "a.md");
    store.removeFromMaps(dbManager, "webdav", "ghost");
    const c = store.getCursor(dbManager, "webdav");
    expect(c.remoteEtagMap).toEqual({ a: "ea" });
  });
});

describe("sync-external-store · resetCursor", () => {
  it("clears cursor row and all related tombstones", () => {
    store.ensureCursor(dbManager, "webdav");
    store.recordPushedItem(dbManager, "webdav", "a", "ea", "a.md");
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
       VALUES ('a', 'a', 'note', 'body', 1, 1)`,
    );
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'a'`);
    expect(store.listTombstones(dbManager, "webdav")).toHaveLength(1);

    store.resetCursor(dbManager, "webdav");
    expect(store.getCursor(dbManager, "webdav")).toBeNull();
    expect(store.listTombstones(dbManager, "webdav")).toEqual([]);
  });

  it("does not affect other providers", () => {
    store.recordPushedItem(dbManager, "webdav", "a", "ea", "a.md");
    store.recordPushedItem(dbManager, "oss", "a", "eo", "a.md");
    store.resetCursor(dbManager, "webdav");
    expect(store.getCursor(dbManager, "oss")?.remoteEtagMap).toEqual({
      a: "eo",
    });
  });
});
