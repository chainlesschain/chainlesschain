/**
 * oss-engine 单元测试 — Phase 3c.3 task #2
 *
 * 与 webdav-engine.test.js 同构（sql.js + 真 store/walker/renderer + fake
 * client）。验证 OSS engine 走通 happy / conflict / hard error / tombstone
 * drain，cursor 用 providerId="oss" 与 webdav 隔离。
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

const { runOSSSync } = require("../oss-engine");
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
      resource_type TEXT,
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
        (provider_id, account_key, item_id, resource_type, deleted_at)
      SELECT c.provider_id, c.account_key, OLD.id, 'KNOWLEDGE_ITEM',
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
          etag: "new-etag",
        })),
    ),
    deleteFile: vi.fn(
      overrides.deleteFile ?? (async (_filename) => ({ ok: true })),
    ),
  };
}

const baseDeps = () => ({
  dbManager,
  store,
  walker,
  renderer,
  providerId: "oss",
  accountKey: "",
});

describe("oss-engine · happy path", () => {
  it("pushes all pending items + cursor advances + providerId=oss", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
    ]);
    const client = makeFakeClient();
    const res = await runOSSSync({ ...baseDeps(), client });
    expect(res.success).toBe(true);
    expect(res.status).toBe("success");
    expect(res.pushed).toBe(2);
    expect(client.putFile).toHaveBeenCalledTimes(2);

    const cursor = store.getCursor(dbManager, "oss");
    expect(cursor.lastItemId).toBe("b");
    expect(cursor.itemsPushed).toBe(2);
    expect(cursor.remoteEtagMap.a).toBe("new-etag");
  });

  it("re-run from advanced cursor pushes nothing", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runOSSSync({ ...baseDeps(), client });
    client.putFile.mockClear();
    const res2 = await runOSSSync({ ...baseDeps(), client });
    expect(res2.pushed).toBe(0);
    expect(client.putFile).not.toHaveBeenCalled();
  });

  it("sends IfMatch etag on subsequent push of modified item", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runOSSSync({ ...baseDeps(), client });
    dbManager.run(`UPDATE knowledge_items SET updated_at = 999 WHERE id = 'a'`);
    client.putFile.mockClear();
    await runOSSSync({ ...baseDeps(), client });
    expect(client.putFile).toHaveBeenCalledWith(
      "a-A.md",
      expect.any(String),
      "new-etag",
    );
  });
});

describe("oss-engine · conflict (412 / 501)", () => {
  it("412 → skipped + cursor advances + status=conflict", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
    ]);
    const client = makeFakeClient({
      putFile: vi.fn(async (filename) => {
        if (filename === "a-A.md") {
          return { ok: false, conflict: true, status: 412 };
        }
        return { ok: true, etag: "e" };
      }),
    });
    const res = await runOSSSync({ ...baseDeps(), client });
    expect(res.success).toBe(true);
    expect(res.status).toBe("conflict");
    expect(res.pushed).toBe(1);
    expect(res.skipped).toBe(1);
    const cursor = store.getCursor(dbManager, "oss");
    expect(cursor.lastItemId).toBe("b");
  });

  it("501 (IfMatch not supported degrade) also treated as conflict", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient({
      // OSSClient returns {ok:false, conflict:true} for 501 — same shape
      putFile: vi.fn(async () => ({ ok: false, conflict: true, status: 501 })),
    });
    const res = await runOSSSync({ ...baseDeps(), client });
    expect(res.skipped).toBe(1);
    expect(res.status).toBe("conflict");
  });
});

describe("oss-engine · hard error", () => {
  it("4xx non-conflict stops loop + leaves cursor at last good", async () => {
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
        return { ok: true, etag: "e" };
      }),
    });
    const res = await runOSSSync({ ...baseDeps(), client });
    expect(res.success).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.pushed).toBe(1);
    expect(res.error).toMatch(/forbidden/);
    const cursor = store.getCursor(dbManager, "oss");
    // 推到 a 后停在 b 上没 advance
    expect(cursor.lastItemId).toBe("a");
  });
});

describe("oss-engine · tombstone drain", () => {
  it("drains tombstones + counts deleted", async () => {
    // 1) 推送一条让 cursor 存在 + remoteFilenameMap 填充
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runOSSSync({ ...baseDeps(), client });
    // 2) 本地删 → trigger 写 tombstone
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'a'`);
    // 3) re-run → engine drain tombstone → client.deleteFile 调
    const res = await runOSSSync({ ...baseDeps(), client });
    expect(res.deleted).toBe(1);
    expect(client.deleteFile).toHaveBeenCalledWith("a-A.md", "new-etag");
    // tombstone 已消解
    const tombs = store.listTombstones(dbManager, "oss", "", 100, [
      "KNOWLEDGE_ITEM",
    ]);
    expect(tombs).toHaveLength(0);
  });

  it("tombstone delete 412 conflict → markFailed + skipped++", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runOSSSync({ ...baseDeps(), client });
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'a'`);
    client.deleteFile.mockImplementation(async () => ({
      ok: false,
      conflict: true,
      status: 412,
    }));
    const res = await runOSSSync({ ...baseDeps(), client });
    expect(res.skipped).toBe(1);
    expect(res.deleted).toBe(0);
    // tombstone 仍在 (markTombstoneFailed)
    const tombs = store.listTombstones(dbManager, "oss", "", 100, [
      "KNOWLEDGE_ITEM",
    ]);
    expect(tombs).toHaveLength(1);
    expect(tombs[0].last_error).toMatch(/etag/);
  });
});

describe("oss-engine · cursor isolated from webdav", () => {
  it("oss cursor lives independently from webdav cursor", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runOSSSync({ ...baseDeps(), client });

    const ossCursor = store.getCursor(dbManager, "oss");
    const webdavCursor = store.getCursor(dbManager, "webdav");
    expect(ossCursor.itemsPushed).toBe(1);
    // webdav never ran → no cursor row (null returned by sync-external-store)
    expect(webdavCursor == null).toBe(true);
  });
});

describe("oss-engine · progress events", () => {
  it("emits start + final progress with totalPending", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
    ]);
    const client = makeFakeClient();
    const events = [];
    await runOSSSync({
      ...baseDeps(),
      client,
      onProgress: (e) => events.push(e),
    });
    const startEvt = events.find((e) => e.phase === "start");
    expect(startEvt).toBeDefined();
    expect(startEvt.totalPending).toBe(2);
    const finalEvt = events[events.length - 1];
    expect(finalEvt.phase).toBe("success");
  });
});
