/**
 * sync-engine-cli 单元测试 — Phase 3c follow-up Phase 2.
 *
 * 用 sql.js 内存 SQLite 模拟 dbManager.run/all/get；fake client；验证
 * runSync 完整管线（push / conflict / hard error / tombstone drain /
 * cursor 推进）。
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

import {
  runSync,
  generateFilename,
  generateMarkdown,
  getCursor,
  ensureCursor,
  listTombstones,
} from "../sync-engine-cli.js";

class SqlJsDbManager {
  constructor(db) {
    this.db = db;
  }
  run(sql, params = []) {
    this.db.run(sql, params);
  }
  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    let row;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
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
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE knowledge_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'note',
      content TEXT,
      tags TEXT,
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
  dbManager = new SqlJsDbManager(db);
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
      overrides.putFile ?? (async () => ({ ok: true, etag: "new-etag" })),
    ),
    deleteFile: vi.fn(overrides.deleteFile ?? (async () => ({ ok: true }))),
  };
}

const baseDeps = () => ({ dbManager, providerId: "webdav", accountKey: "" });

describe("sync-engine-cli · renderer helpers", () => {
  it("generateFilename cleans unsafe chars + collapses runs", () => {
    const fn = generateFilename({ id: "abc", title: "My / cool: note?" });
    expect(fn).toBe("abc-My_cool_note.md");
  });

  it("generateMarkdown emits front-matter", () => {
    const md = generateMarkdown({
      id: "x",
      title: "T",
      type: "note",
      content: "body",
      created_at: 1,
      updated_at: 2,
      tags: "a,b",
    });
    expect(md).toContain("---");
    expect(md).toContain('title: "T"');
    expect(md).toContain("tags: a,b");
    expect(md.endsWith("body\n")).toBe(true);
  });
});

describe("sync-engine-cli · ensureCursor + getCursor", () => {
  it("ensureCursor creates row + returns it", () => {
    const cursor = ensureCursor(dbManager, "webdav");
    expect(cursor).toBeDefined();
    expect(cursor.providerId).toBe("webdav");
    expect(cursor.itemsPushed).toBe(0);
  });

  it("getCursor returns undefined when missing", () => {
    expect(getCursor(dbManager, "oss")).toBeUndefined();
  });
});

describe("sync-engine-cli · runSync happy path", () => {
  it("pushes all items + advances cursor", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
    ]);
    const client = makeFakeClient();
    const res = await runSync({ ...baseDeps(), client });
    expect(res.success).toBe(true);
    expect(res.status).toBe("success");
    expect(res.pushed).toBe(2);
    expect(client.putFile).toHaveBeenCalledTimes(2);
    const cursor = getCursor(dbManager, "webdav");
    expect(cursor.lastItemId).toBe("b");
    expect(cursor.itemsPushed).toBe(2);
  });

  it("re-run from advanced cursor pushes nothing new", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runSync({ ...baseDeps(), client });
    client.putFile.mockClear();
    const r2 = await runSync({ ...baseDeps(), client });
    expect(r2.pushed).toBe(0);
    expect(client.putFile).not.toHaveBeenCalled();
  });

  it("sends If-Match etag on modified item", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runSync({ ...baseDeps(), client });
    dbManager.run(`UPDATE knowledge_items SET updated_at = 999 WHERE id = 'a'`);
    client.putFile.mockClear();
    await runSync({ ...baseDeps(), client });
    expect(client.putFile).toHaveBeenCalledWith(
      "a-A.md",
      expect.any(String),
      "new-etag",
    );
  });
});

describe("sync-engine-cli · conflict path (412)", () => {
  it("412 → skipped + cursor advances + status=conflict", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
    ]);
    const client = makeFakeClient({
      putFile: vi.fn(async (fn) =>
        fn === "a-A.md"
          ? { ok: false, conflict: true, status: 412 }
          : { ok: true, etag: "e" },
      ),
    });
    const res = await runSync({ ...baseDeps(), client });
    expect(res.status).toBe("conflict");
    expect(res.pushed).toBe(1);
    expect(res.skipped).toBe(1);
    expect(getCursor(dbManager, "webdav").lastItemId).toBe("b");
  });
});

describe("sync-engine-cli · hard error stops loop", () => {
  it("4xx non-conflict → no advance past failure point", async () => {
    seedItems([
      { id: "a", title: "A", updated_at: 100 },
      { id: "b", title: "B", updated_at: 200 },
    ]);
    const client = makeFakeClient({
      putFile: vi.fn(async (fn) =>
        fn === "b-B.md"
          ? { ok: false, status: 403, error: "forbidden" }
          : { ok: true, etag: "e" },
      ),
    });
    const res = await runSync({ ...baseDeps(), client });
    expect(res.success).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.pushed).toBe(1);
    expect(res.error).toMatch(/forbidden/);
    expect(getCursor(dbManager, "webdav").lastItemId).toBe("a");
  });
});

describe("sync-engine-cli · tombstone drain", () => {
  it("drains tombstones via deleteFile + cleans maps", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runSync({ ...baseDeps(), client });
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'a'`);
    const res = await runSync({ ...baseDeps(), client });
    expect(res.deleted).toBe(1);
    expect(client.deleteFile).toHaveBeenCalledWith("a-A.md", "new-etag");
    expect(listTombstones(dbManager, "webdav")).toHaveLength(0);
  });
});

describe("sync-engine-cli · provider isolation", () => {
  it("oss cursor independent of webdav cursor", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const client = makeFakeClient();
    await runSync({ dbManager, client, providerId: "webdav", accountKey: "" });
    const webdav = getCursor(dbManager, "webdav");
    const oss = getCursor(dbManager, "oss");
    expect(webdav.itemsPushed).toBe(1);
    expect(oss).toBeUndefined();
  });
});

describe("sync-engine-cli · progress callback", () => {
  it("emits start + final events", async () => {
    seedItems([{ id: "a", title: "A", updated_at: 100 }]);
    const events = [];
    await runSync({
      ...baseDeps(),
      client: makeFakeClient(),
      onProgress: (e) => events.push(e),
    });
    expect(events.find((e) => e.phase === "start")).toBeDefined();
    expect(events[events.length - 1].phase).toBe("success");
  });
});
