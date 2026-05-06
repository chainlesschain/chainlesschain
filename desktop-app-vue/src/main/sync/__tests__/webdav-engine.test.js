/**
 * webdav-engine 单元测试 — Phase 3c.2 task #5（engine 部分）
 *
 * 路线：sql.js 内存 SQLite 跑真 store + walker；renderer 真模块；fake client。
 * 验证 happy path（push N 条）/ conflict path / error path / tombstone drain /
 * 进度节流 / cursor 推进。
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

const { runWebDAVSync, PROGRESS_FLUSH_EVERY } = require("../webdav-engine");
const store = require("../sync-external-store");
const walker = require("../incremental-walker");
const renderer = require("../markdown-renderer");

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
  SQL = await (await import("sql.js")).default();
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
      SELECT c.provider_id, c.account_key, OLD.id,
             (strftime('%s','now') * 1000)
      FROM sync_external_provider_cursor c;
    END;
  `);
  dbManager = new TestDbManager(sqlDb);
});

function seedItems(items) {
  for (const it of items) {
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        it.id,
        it.title,
        it.type ?? "note",
        it.content ?? "body",
        it.created_at ?? 1,
        it.updated_at ?? 100,
      ],
    );
  }
}

function makeFakeClient(overrides = {}) {
  return {
    putFile: vi.fn(
      overrides.putFile ??
        (async (_filename, _content, _etag) => ({
          ok: true,
          etag: '"new-etag"',
        })),
    ),
    deleteFile: vi.fn(
      overrides.deleteFile ?? (async (_filename, _etag) => ({ ok: true })),
    ),
  };
}

const baseDeps = () => ({
  dbManager,
  store,
  walker,
  renderer,
  providerId: "webdav",
  accountKey: "",
});

describe("webdav-engine · happy path", () => {
  it("pushes all pending items and advances cursor", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
      { id: "c", title: "C", updated_at: 300 },
    ]);
    const client = makeFakeClient();
    const res = await runWebDAVSync({ ...baseDeps(), client });

    expect(res.success).toBe(true);
    expect(res.status).toBe("success");
    expect(res.pushed).toBe(3);
    expect(res.skipped).toBe(0);
    expect(res.deleted).toBe(0);
    expect(client.putFile).toHaveBeenCalledTimes(3);

    const cursor = store.getCursor(dbManager, "webdav");
    expect(cursor.lastSyncAt).toBe(300);
    expect(cursor.lastItemId).toBe("c");
    expect(cursor.itemsPushed).toBe(3);
    expect(cursor.lastRunStatus).toBe("success");
    expect(cursor.remoteEtagMap.a).toBe('"new-etag"');
    expect(cursor.remoteFilenameMap.a).toBe("a-A.md");
  });

  it("re-run from advanced cursor pushes nothing new", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runWebDAVSync({ ...baseDeps(), client });
    client.putFile.mockClear();
    const res2 = await runWebDAVSync({ ...baseDeps(), client });
    expect(res2.pushed).toBe(0);
    expect(client.putFile).not.toHaveBeenCalled();
  });

  it("sends If-Match etag on previously-pushed items", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runWebDAVSync({ ...baseDeps(), client });
    // 模拟 item 被本地修改
    dbManager.run(`UPDATE knowledge_items SET updated_at = 999 WHERE id = 'a'`);
    client.putFile.mockClear();
    await runWebDAVSync({ ...baseDeps(), client });
    expect(client.putFile).toHaveBeenCalledWith(
      "a-A.md",
      expect.any(String),
      '"new-etag"',
    );
  });
});

describe("webdav-engine · conflict path (412)", () => {
  it("counts skipped + advances cursor + status = conflict", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
    ]);
    const client = makeFakeClient({
      putFile: vi.fn(async (filename) => {
        if (filename === "a-A.md") {
          return { ok: false, conflict: true, status: 412 };
        }
        return { ok: true, etag: '"e"' };
      }),
    });
    const res = await runWebDAVSync({ ...baseDeps(), client });
    expect(res.success).toBe(true);
    expect(res.status).toBe("conflict");
    expect(res.pushed).toBe(1);
    expect(res.skipped).toBe(1);

    const cursor = store.getCursor(dbManager, "webdav");
    // 即使冲突也推进游标，避免下次又冲突轰炸
    expect(cursor.lastItemId).toBe("b");
    expect(cursor.itemsSkipped).toBe(1);
  });
});

describe("webdav-engine · hard error path", () => {
  it("4xx non-412 stops the loop and leaves cursor at last successful item", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
      { id: "c", title: "C", updated_at: 300 },
    ]);
    const client = makeFakeClient({
      putFile: vi.fn(async (filename) => {
        if (filename === "b-B.md") {
          return { ok: false, status: 403, error: "forbidden" };
        }
        return { ok: true, etag: '"e"' };
      }),
    });
    const res = await runWebDAVSync({ ...baseDeps(), client });
    expect(res.success).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/forbidden/);
    expect(res.pushed).toBe(1); // a
    expect(res.skipped).toBe(0);

    const cursor = store.getCursor(dbManager, "webdav");
    expect(cursor.lastItemId).toBe("a"); // 不前进到 b
    expect(cursor.lastRunStatus).toBe("failed");
  });

  it("retries on next run from where it left off", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
    ]);
    let callCount = 0;
    const client = makeFakeClient({
      putFile: vi.fn(async () => {
        callCount++;
        if (callCount === 2) {
          return { ok: false, status: 500, error: "boom" };
        }
        return { ok: true, etag: '"e"' };
      }),
    });
    const r1 = await runWebDAVSync({ ...baseDeps(), client });
    expect(r1.pushed).toBe(1);
    expect(r1.success).toBe(false);

    // 重跑：a 已推 → b 重试
    const r2 = await runWebDAVSync({ ...baseDeps(), client });
    expect(r2.pushed).toBe(1); // 只推 b
  });
});

describe("webdav-engine · tombstones", () => {
  it("drains tombstones via DELETE before push", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    // 第一轮：建游标 + 推 a
    await runWebDAVSync({ ...baseDeps(), client });

    // 删除 a → trigger 写 tombstone
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'a'`);
    expect(store.listTombstones(dbManager, "webdav")).toHaveLength(1);

    client.deleteFile.mockClear();
    const res = await runWebDAVSync({ ...baseDeps(), client });
    expect(res.deleted).toBe(1);
    expect(res.pushed).toBe(0);
    expect(client.deleteFile).toHaveBeenCalledWith("a-A.md", '"new-etag"');
    expect(store.listTombstones(dbManager, "webdav")).toEqual([]);
    const cursor = store.getCursor(dbManager, "webdav");
    expect(cursor.remoteEtagMap.a).toBeUndefined();
    expect(cursor.itemsDeleted).toBe(1);
  });

  it("tombstone for item that was never pushed → silently consumed", async () => {
    // 建游标但不推任何 item
    store.ensureCursor(dbManager, "webdav");
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'a'`);

    const client = makeFakeClient();
    const res = await runWebDAVSync({ ...baseDeps(), client });
    expect(client.deleteFile).not.toHaveBeenCalled();
    expect(res.deleted).toBe(0);
    expect(store.listTombstones(dbManager, "webdav")).toEqual([]);
  });

  it("tombstone DELETE 412 → skipped + tombstone retry_count++", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    let client = makeFakeClient();
    await runWebDAVSync({ ...baseDeps(), client });
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'a'`);

    client = makeFakeClient({
      deleteFile: vi.fn(async () => ({
        ok: false,
        conflict: true,
        status: 412,
      })),
    });
    const res = await runWebDAVSync({ ...baseDeps(), client });
    expect(res.deleted).toBe(0);
    expect(res.skipped).toBe(1);
    const tombs = store.listTombstones(dbManager, "webdav");
    expect(tombs).toHaveLength(1);
    expect(tombs[0].retry_count).toBe(1);
  });
});

describe("webdav-engine · progress callback", () => {
  it("emits start + finalize at minimum", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const events = [];
    const client = makeFakeClient();
    await runWebDAVSync({
      ...baseDeps(),
      client,
      onProgress: (e) => events.push(e),
    });
    expect(events[0].phase).toBe("start");
    expect(events[events.length - 1].phase).toBe("success");
    expect(events[events.length - 1].pushed).toBe(1);
  });

  it("totalPending counted correctly at start", async () => {
    seedItems(
      Array.from({ length: 10 }, (_, i) => ({
        id: `id-${i}`,
        title: `t-${i}`,
        updated_at: 100 + i,
      })),
    );
    const events = [];
    const client = makeFakeClient();
    await runWebDAVSync({
      ...baseDeps(),
      client,
      onProgress: (e) => events.push(e),
    });
    expect(events[0]).toMatchObject({ phase: "start", totalPending: 10 });
  });

  it("flush throttle: 5+ items in tight loop fires per-batch", async () => {
    seedItems(
      Array.from({ length: 12 }, (_, i) => ({
        id: `id-${i}`,
        title: `t-${i}`,
        updated_at: 100 + i,
      })),
    );
    const events = [];
    const client = makeFakeClient();
    await runWebDAVSync({
      ...baseDeps(),
      client,
      onProgress: (e) => events.push(e),
    });
    // start + 至少 floor(12/5) + 终态
    const pushEvents = events.filter((e) => e.phase === "push");
    expect(pushEvents.length).toBeGreaterThanOrEqual(2);
    // 确认 PROGRESS_FLUSH_EVERY 阈值生效
    expect(PROGRESS_FLUSH_EVERY).toBe(5);
  });
});
