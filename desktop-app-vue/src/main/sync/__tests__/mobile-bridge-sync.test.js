/**
 * mobile-bridge-sync.js 单元测试 — Phase 3d M2 step 8
 *
 * 用 sql.js (WASM) 起内存 SQLite，建 5 张目标表 + cursor + tombstone schema +
 * 6 个触发器，验证：
 *   - resolveConflict LWW 算法严格对齐 Android ConflictResolver
 *   - 5 张表的 walker (p2p_chat_messages / friends / social_posts /
 *     post_comments / notifications) cursor 正确推进
 *   - 5 ResourceType 的 apply 写入 + DELETE 路径
 *   - handlePush 冲突 / 应用 / 失败三态
 *   - handleAck 清 pendingAcks
 *   - tombstone 走 resource_type 过滤 + trigger 自动 fan-out
 *   - 字段 normalizer（Android UPPERCASE → schema CHECK lowercase）
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

const MobileBridgeSync = require("../mobile-bridge-sync");
const { ResourceType, SyncOperation } = MobileBridgeSync;

// ── 内存 sql.js dbManager 适配器 ─────────────────────────────────
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

// ── fake mobileBridge：sendToMobile 默认成功，可 override ────────
function makeFakeMobileBridge(impl = {}) {
  const calls = [];
  return {
    calls,
    sendToMobile: vi.fn(async (deviceId, message) => {
      calls.push({ deviceId, message });
      if (impl.sendToMobile) {
        return impl.sendToMobile(deviceId, message);
      }
    }),
    dataChannels: new Map(),
  };
}

// ── 把 _invokeRemote 包成可 stub 的版本：测试时直接 mock ─────────
function patchInvokeRemote(sync, responder) {
  sync._invokeRemote = vi.fn(async (deviceId, method, params) => {
    return responder(method, params, deviceId);
  });
}

let initSqlJs;
let SQL;
let dbManager;

beforeAll(async () => {
  initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

/**
 * 建最小 schema：6 张目标表 + cursor + tombstone（带 resource_type）+ 4 个 trigger。
 * 镜像 database-schema.js 的相关定义；列限制范围最小化（只有 walker / apply 用得到的）。
 *
 * v1.1 W1 (2026-05-12)：加 knowledge_items 表 + trigger，让 KNOWLEDGE_ITEM 走全链路
 * round-trip。trigger 一刻同时写所有已建游标的 provider（包括 mobile + webdav + oss），
 * 这是 Phase 3c 的 fan-out per-provider 设计；本测试只验 mobile provider 路径。
 */
function bootstrapSchema(sqlDb) {
  sqlDb.exec(`
    CREATE TABLE knowledge_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('note', 'document', 'conversation', 'web_clip')),
      content TEXT,
      content_path TEXT,
      embedding_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      git_commit_hash TEXT,
      device_id TEXT,
      sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict'))
    );
    CREATE TABLE p2p_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender_did TEXT NOT NULL,
      receiver_did TEXT NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      file_path TEXT,
      file_size INTEGER,
      encrypted INTEGER DEFAULT 1,
      status TEXT DEFAULT 'sent',
      device_id TEXT,
      timestamp INTEGER NOT NULL,
      forwarded_from_id TEXT,
      forward_count INTEGER DEFAULT 0
    );
    CREATE TABLE friends (
      id TEXT PRIMARY KEY,
      user_did TEXT NOT NULL,
      friend_did TEXT NOT NULL,
      nickname TEXT,
      avatar TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_did, friend_did)
    );
    CREATE TABLE social_posts (
      id TEXT PRIMARY KEY,
      author_did TEXT NOT NULL,
      content TEXT NOT NULL,
      media TEXT,
      visibility TEXT DEFAULT 'public',
      likes_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      shares_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_did TEXT NOT NULL,
      content TEXT NOT NULL,
      parent_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_did TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
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
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
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

    CREATE TRIGGER trg_knowledge_items_del
    AFTER DELETE ON knowledge_items FOR EACH ROW BEGIN
      INSERT OR IGNORE INTO sync_external_tombstones
        (provider_id, account_key, item_id, resource_type, deleted_at)
      SELECT c.provider_id, c.account_key, OLD.id, 'KNOWLEDGE_ITEM', 1234567890
      FROM sync_external_provider_cursor c;
    END;
    CREATE TRIGGER trg_p2p_chat_messages_del
    AFTER DELETE ON p2p_chat_messages FOR EACH ROW BEGIN
      INSERT OR IGNORE INTO sync_external_tombstones
        (provider_id, account_key, item_id, resource_type, deleted_at)
      SELECT c.provider_id, c.account_key, OLD.id, 'MESSAGE', 1234567890
      FROM sync_external_provider_cursor c;
    END;
    CREATE TRIGGER trg_friends_del
    AFTER DELETE ON friends FOR EACH ROW BEGIN
      INSERT OR IGNORE INTO sync_external_tombstones
        (provider_id, account_key, item_id, resource_type, deleted_at)
      SELECT c.provider_id, c.account_key, OLD.friend_did, 'FRIEND', 1234567890
      FROM sync_external_provider_cursor c;
    END;
    CREATE TRIGGER trg_social_posts_del
    AFTER DELETE ON social_posts FOR EACH ROW BEGIN
      INSERT OR IGNORE INTO sync_external_tombstones
        (provider_id, account_key, item_id, resource_type, deleted_at)
      SELECT c.provider_id, c.account_key, OLD.id, 'POST', 1234567890
      FROM sync_external_provider_cursor c;
    END;
  `);
}

beforeEach(() => {
  const sqlDb = new SQL.Database();
  bootstrapSchema(sqlDb);
  dbManager = new TestDbManager(sqlDb);
});

function makeSync(overrides = {}) {
  return new MobileBridgeSync({
    mobileBridge: makeFakeMobileBridge(),
    dbManager,
    deps: {
      getExternalStore: () => require("../sync-external-store"),
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
      now: () => 2000,
    },
    ...overrides,
  });
}

// ============================================================
// Constructor + 基础 invariants
// ============================================================
describe("MobileBridgeSync · constructor", () => {
  it("throws when mobileBridge missing", () => {
    expect(
      () => new MobileBridgeSync({ mobileBridge: null, dbManager }),
    ).toThrow(/mobileBridge/);
  });

  it("throws when dbManager missing", () => {
    expect(
      () =>
        new MobileBridgeSync({
          mobileBridge: makeFakeMobileBridge(),
          dbManager: null,
        }),
    ).toThrow(/dbManager/);
  });

  it("ResourceType / SyncOperation are exported & frozen", () => {
    expect(Object.isFrozen(ResourceType)).toBe(true);
    expect(Object.isFrozen(SyncOperation)).toBe(true);
    expect(ResourceType.MESSAGE).toBe("MESSAGE");
    expect(SyncOperation.DELETE).toBe("DELETE");
  });
});

// ============================================================
// resolveConflict — LWW 算法
// ============================================================
describe("MobileBridgeSync · resolveConflict", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("null local → remote wins (initial sync)", () => {
    expect(sync.resolveConflict(null, { version: 1, timestamp: 100 })).toBe(
      "remote",
    );
  });

  it("null remote → local wins", () => {
    expect(sync.resolveConflict({ version: 1, timestamp: 100 }, null)).toBe(
      "local",
    );
  });

  it("higher version wins regardless of timestamp", () => {
    const local = { version: 5, timestamp: 1000 };
    const remote = { version: 6, timestamp: 100 };
    expect(sync.resolveConflict(local, remote)).toBe("remote");
  });

  it("same version → timestamp tie-break", () => {
    const local = { version: 1, timestamp: 100 };
    const remote = { version: 1, timestamp: 200 };
    expect(sync.resolveConflict(local, remote)).toBe("remote");
  });

  it("same version + timestamp → deviceId tie-break (lex DESC)", () => {
    const local = { version: 1, timestamp: 100, deviceId: "device-a" };
    const remote = { version: 1, timestamp: 100, deviceId: "device-z" };
    expect(sync.resolveConflict(local, remote)).toBe("remote");
    // 反向：local 的 deviceId 大
    expect(sync.resolveConflict(remote, local)).toBe("local");
  });
});

// ============================================================
// Walker — p2p_chat_messages
// ============================================================
describe("MobileBridgeSync · _fetchP2PChatMessages", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("returns empty when table empty", async () => {
    const rows = await sync._fetchP2PChatMessages(dbManager, 0, null, 100);
    expect(rows).toEqual([]);
  });

  it("emits SyncItem with MESSAGE resourceType + JSON-encoded data", async () => {
    dbManager.run(
      `INSERT INTO p2p_chat_messages
       (id, session_id, sender_did, receiver_did, content, message_type, encrypted, status, device_id, timestamp)
       VALUES ('m1', 's1', 'did:alice', 'did:bob', 'hello', 'text', 1, 'sent', 'dev-a', 100)`,
    );
    const rows = await sync._fetchP2PChatMessages(dbManager, 0, null, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resourceType: ResourceType.MESSAGE,
      resourceId: "m1",
      operation: SyncOperation.CREATE,
      timestamp: 100,
      deviceId: "dev-a",
    });
    const decoded = JSON.parse(rows[0].data);
    expect(decoded.senderDid).toBe("did:alice");
    expect(decoded.encrypted).toBe(true); // 1 → boolean
  });

  it("respects (timestamp, id) lex cursor", async () => {
    dbManager.run(
      `INSERT INTO p2p_chat_messages (id, session_id, sender_did, receiver_did, content, timestamp) VALUES
       ('a', 's', 'd1', 'd2', 'x', 100),
       ('b', 's', 'd1', 'd2', 'x', 100),
       ('c', 's', 'd1', 'd2', 'x', 200)`,
    );
    // sinceMs=100, sinceId='a' → 应只返 b 和 c
    const rows = await sync._fetchP2PChatMessages(dbManager, 100, "a", 100);
    expect(rows.map((r) => r.resourceId)).toEqual(["b", "c"]);
  });
});

// ============================================================
// Walker — friends
// ============================================================
describe("MobileBridgeSync · _fetchFriends", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("emits FRIEND SyncItem with friend_did as resourceId", async () => {
    dbManager.run(
      `INSERT INTO friends (id, user_did, friend_did, nickname, status, notes, created_at, updated_at)
       VALUES ('f1', 'me', 'did:alice', 'Alice', 'accepted', 'best friend', 50, 100)`,
    );
    const rows = await sync._fetchFriends(dbManager, 0, null, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceId).toBe("did:alice");
    expect(rows[0].resourceType).toBe(ResourceType.FRIEND);
    const data = JSON.parse(rows[0].data);
    expect(data.nickname).toBe("Alice");
    expect(data.remarkName).toBe("best friend");
  });
});

// ============================================================
// Apply — FRIEND（含 normalizer + UPSERT）
// ============================================================
describe("MobileBridgeSync · _applyFriend", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("INSERT new friend with status normalize (UPPERCASE → lowercase)", async () => {
    await sync._applyFriend({
      resourceId: "did:bob",
      operation: SyncOperation.UPDATE,
      timestamp: 1500,
      data: JSON.stringify({
        nickname: "Bob",
        status: "ACCEPTED", // Android enum UPPERCASE
        addedAt: 1000,
      }),
    });
    const row = dbManager.get(`SELECT * FROM friends WHERE friend_did = ?`, [
      "did:bob",
    ]);
    expect(row.nickname).toBe("Bob");
    expect(row.status).toBe("accepted"); // 已 normalize
    expect(row.updated_at).toBe(1500);
  });

  it("UPSERT updates existing row instead of duplicating", async () => {
    dbManager.run(
      `INSERT INTO friends (id, user_did, friend_did, nickname, status, created_at, updated_at)
       VALUES ('did:bob', '', 'did:bob', 'Bob old', 'pending', 100, 100)`,
    );
    await sync._applyFriend({
      resourceId: "did:bob",
      operation: SyncOperation.UPDATE,
      timestamp: 200,
      data: JSON.stringify({ nickname: "Bob new", status: "accepted" }),
    });
    const rows = dbManager.all(`SELECT * FROM friends`);
    expect(rows).toHaveLength(1);
    expect(rows[0].nickname).toBe("Bob new");
    expect(rows[0].status).toBe("accepted");
  });

  it("DELETE removes the row by friend_did", async () => {
    dbManager.run(
      `INSERT INTO friends (id, user_did, friend_did, status, created_at, updated_at)
       VALUES ('did:eve', '', 'did:eve', 'pending', 1, 1)`,
    );
    await sync._applyFriend({
      resourceId: "did:eve",
      operation: SyncOperation.DELETE,
      timestamp: 999,
    });
    const rows = dbManager.all(`SELECT * FROM friends`);
    expect(rows).toHaveLength(0);
  });

  it("invalid status falls back to 'pending'", async () => {
    await sync._applyFriend({
      resourceId: "did:x",
      operation: SyncOperation.UPDATE,
      timestamp: 1,
      data: JSON.stringify({ status: "GARBAGE" }),
    });
    const row = dbManager.get(
      `SELECT status FROM friends WHERE friend_did = 'did:x'`,
    );
    expect(row.status).toBe("pending");
  });
});

// ============================================================
// Apply — MESSAGE
// ============================================================
describe("MobileBridgeSync · _applyMessage", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("INSERT OR REPLACE p2p_chat_messages", async () => {
    await sync._applyMessage({
      resourceId: "m42",
      operation: SyncOperation.CREATE,
      timestamp: 1000,
      deviceId: "device-x",
      data: JSON.stringify({
        sessionId: "s1",
        senderDid: "did:a",
        receiverDid: "did:b",
        content: "hi",
        messageType: "text",
        encrypted: true,
        status: "sent",
      }),
    });
    const row = dbManager.get(`SELECT * FROM p2p_chat_messages WHERE id = ?`, [
      "m42",
    ]);
    expect(row.content).toBe("hi");
    expect(row.encrypted).toBe(1);
    expect(row.device_id).toBe("device-x");
    expect(row.timestamp).toBe(1000);
  });

  it("DELETE removes by id", async () => {
    dbManager.run(
      `INSERT INTO p2p_chat_messages (id, session_id, sender_did, receiver_did, content, timestamp)
       VALUES ('m1', 's', 'd', 'd', 'x', 1)`,
    );
    await sync._applyMessage({
      resourceId: "m1",
      operation: SyncOperation.DELETE,
      timestamp: 999,
    });
    expect(dbManager.all(`SELECT * FROM p2p_chat_messages`)).toHaveLength(0);
  });
});

// ============================================================
// Apply — NOTIFICATION（含 type normalizer）
// ============================================================
describe("MobileBridgeSync · _applyNotification", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("normalizes Android UPPERCASE NotificationType to schema lowercase", async () => {
    await sync._applyNotification({
      resourceId: "n1",
      operation: SyncOperation.CREATE,
      timestamp: 1,
      data: JSON.stringify({
        type: "FRIEND_REQUEST",
        title: "Bob 请求加好友",
        isRead: false,
      }),
    });
    const row = dbManager.get(`SELECT * FROM notifications WHERE id = 'n1'`);
    expect(row.type).toBe("friend_request");
    expect(row.is_read).toBe(0);
  });

  it("unknown type falls back to 'system'", async () => {
    await sync._applyNotification({
      resourceId: "n2",
      operation: SyncOperation.CREATE,
      timestamp: 1,
      data: JSON.stringify({ type: "GARBAGE", title: "" }),
    });
    const row = dbManager.get(`SELECT * FROM notifications WHERE id = 'n2'`);
    expect(row.type).toBe("system");
  });
});

// ============================================================
// handlePush — 完整路径（无冲突 / 冲突）
// ============================================================
describe("MobileBridgeSync · handlePush", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("invalid item shape → status:failed", async () => {
    const res = await sync.handlePush({ item: null });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/invalid/i);
  });

  it("applies remote item when local doesn't exist", async () => {
    const res = await sync.handlePush({
      item: {
        resourceType: ResourceType.FRIEND,
        resourceId: "did:new",
        operation: SyncOperation.UPDATE,
        version: 1,
        timestamp: 100,
        data: JSON.stringify({ nickname: "New" }),
      },
    });
    expect(res.status).toBe("applied");
    expect(
      dbManager.get(`SELECT nickname FROM friends WHERE friend_did = 'did:new'`)
        .nickname,
    ).toBe("New");
  });

  it("returns conflict when local newer (LWW: local timestamp wins)", async () => {
    // 本地有更新的 friend 记录
    dbManager.run(
      `INSERT INTO friends (id, user_did, friend_did, nickname, status, created_at, updated_at)
       VALUES ('did:bob', '', 'did:bob', 'Bob LOCAL', 'accepted', 100, 5000)`,
    );
    const res = await sync.handlePush({
      item: {
        resourceType: ResourceType.FRIEND,
        resourceId: "did:bob",
        operation: SyncOperation.UPDATE,
        version: 1,
        timestamp: 100, // 比本地 5000 旧
        data: JSON.stringify({ nickname: "Bob REMOTE" }),
      },
    });
    expect(res.status).toBe("conflict");
    expect(res.resolved).toBeTruthy();
    // 本地未被覆盖
    expect(
      dbManager.get(`SELECT nickname FROM friends WHERE friend_did = 'did:bob'`)
        .nickname,
    ).toBe("Bob LOCAL");
  });

  it("unimplemented ResourceType (CONTACT) returns failed", async () => {
    const res = await sync.handlePush({
      item: {
        resourceType: ResourceType.CONTACT,
        resourceId: "x",
        operation: SyncOperation.UPDATE,
        version: 1,
        timestamp: 1,
        data: "{}",
      },
    });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/unimplemented/i);
  });
});

// ============================================================
// handleAck — pendingAcks cleanup
// ============================================================
describe("MobileBridgeSync · handleAck", () => {
  it("resolves matching pendingAcks promise", async () => {
    const sync = makeSync();
    // 手动塞一个 pendingAck（模拟 _invokeRemote 已发出但未 ack）
    let resolved = false;
    const timer = setTimeout(() => {}, 1000);
    const p = new Promise((resolve) => {
      sync.pendingAcks.set("req-123", {
        resolve: (v) => {
          resolved = true;
          resolve(v);
        },
        reject: () => {},
        timer,
      });
    });
    sync.handleAck({ requestId: "req-123", status: "applied" });
    await p;
    expect(resolved).toBe(true);
    expect(sync.pendingAcks.has("req-123")).toBe(false);
  });

  it("ignores unknown requestId silently", () => {
    const sync = makeSync();
    expect(() => sync.handleAck({ requestId: "nope" })).not.toThrow();
  });
});

// ============================================================
// pushPending — tombstone iteration with resourceType filter
// ============================================================
describe("MobileBridgeSync · pushPending tombstone integration", () => {
  it("iterates mobile-aware ResourceType tombstones incl. KNOWLEDGE_ITEM (v1.1 W1), excl. CONTACT", async () => {
    const sync = makeSync();

    // 为 mobile provider 建 cursor 让 trigger fan-out
    dbManager.run(
      `INSERT INTO sync_external_provider_cursor (provider_id, account_key) VALUES ('mobile', 'dev-1')`,
    );

    // 删一个 friend → trigger 写 FRIEND tombstone
    dbManager.run(
      `INSERT INTO friends (id, user_did, friend_did, status, created_at, updated_at)
       VALUES ('did:x', 'me', 'did:x', 'pending', 1, 1)`,
    );
    dbManager.run(`DELETE FROM friends WHERE friend_did = 'did:x'`);

    // 删一个 knowledge_items → trigger 写 KNOWLEDGE_ITEM tombstone
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at)
       VALUES ('k1', 'old note', 'note', 'body', 1, 1)`,
    );
    dbManager.run(`DELETE FROM knowledge_items WHERE id = 'k1'`);

    // 手动塞一行 CONTACT tombstone（v1 不在 mobile-aware filter 内）
    dbManager.run(
      `INSERT INTO sync_external_tombstones (provider_id, account_key, item_id, resource_type, deleted_at)
       VALUES ('mobile', 'dev-1', 'c1', 'CONTACT', 999)`,
    );

    // stub _invokeRemote 让 push 不真发网络
    patchInvokeRemote(sync, () => ({ status: "applied" }));

    const result = await sync.pushPending("dev-1");
    // FRIEND + KNOWLEDGE_ITEM 应被 push（CONTACT 跳过）
    expect(result.pushed).toBe(2);
    const calls = sync._invokeRemote.mock.calls;
    const pushCalls = calls.filter((c) => c[1] === "sync.push");
    expect(pushCalls).toHaveLength(2);
    const pushedTypes = pushCalls.map((c) => c[2].item.resourceType).sort();
    expect(pushedTypes).toEqual([
      ResourceType.FRIEND,
      ResourceType.KNOWLEDGE_ITEM,
    ]);
    expect(
      pushCalls.every((c) => c[2].item.operation === SyncOperation.DELETE),
    ).toBe(true);
  });
});

// ============================================================
// Walker — knowledge_items (v1.1 W1)
// ============================================================
describe("MobileBridgeSync · _fetchKnowledgeItems", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("returns empty when table empty", async () => {
    const rows = await sync._fetchKnowledgeItems(dbManager, 0, null, 100);
    expect(rows).toEqual([]);
  });

  it("emits SyncItem with KNOWLEDGE_ITEM resourceType + JSON-encoded data", async () => {
    dbManager.run(
      `INSERT INTO knowledge_items
       (id, title, type, content, created_at, updated_at, device_id)
       VALUES ('k1', 'My Note', 'note', 'body text', 100, 100, 'dev-a')`,
    );
    const rows = await sync._fetchKnowledgeItems(dbManager, 0, null, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resourceType: ResourceType.KNOWLEDGE_ITEM,
      resourceId: "k1",
      operation: SyncOperation.CREATE, // updated_at == created_at
      timestamp: 100,
      deviceId: "dev-a",
    });
    const decoded = JSON.parse(rows[0].data);
    expect(decoded.title).toBe("My Note");
    expect(decoded.type).toBe("note");
    expect(decoded.content).toBe("body text");
  });

  it("emits UPDATE op when updated_at > created_at", async () => {
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, created_at, updated_at)
       VALUES ('k2', 'Edited', 'document', 100, 500)`,
    );
    const rows = await sync._fetchKnowledgeItems(dbManager, 0, null, 100);
    expect(rows[0].operation).toBe(SyncOperation.UPDATE);
  });

  it("respects (updated_at, id) lex cursor", async () => {
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, created_at, updated_at) VALUES
       ('a', 'A', 'note', 100, 100),
       ('b', 'B', 'note', 100, 100),
       ('c', 'C', 'note', 200, 200)`,
    );
    const rows = await sync._fetchKnowledgeItems(dbManager, 100, "a", 100);
    expect(rows.map((r) => r.resourceId)).toEqual(["b", "c"]);
  });

  it("skips local-only columns from payload (no content_path / embedding_path / git_commit_hash)", async () => {
    dbManager.run(
      `INSERT INTO knowledge_items
       (id, title, type, content, content_path, embedding_path, git_commit_hash,
        created_at, updated_at)
       VALUES ('k3', 't', 'note', 'c', '/local/path', '/emb', 'abc123', 1, 1)`,
    );
    const rows = await sync._fetchKnowledgeItems(dbManager, 0, null, 100);
    const decoded = JSON.parse(rows[0].data);
    expect(decoded.content_path).toBeUndefined();
    expect(decoded.embedding_path).toBeUndefined();
    expect(decoded.git_commit_hash).toBeUndefined();
  });
});

// ============================================================
// Apply — KNOWLEDGE_ITEM (v1.1 W1)
// ============================================================
describe("MobileBridgeSync · _applyKnowledgeItem", () => {
  let sync;
  beforeEach(() => {
    sync = makeSync();
  });

  it("INSERT new knowledge_item with type normalize + sync_status=synced", async () => {
    await sync._applyKnowledgeItem({
      resourceId: "k1",
      operation: SyncOperation.CREATE,
      timestamp: 500,
      deviceId: "dev-android",
      data: JSON.stringify({
        title: "Mobile Note",
        type: "NOTE", // Android KnowledgeType.value 实为 lowercase 但兜底 normalize
        content: "from phone",
        createdAt: 100,
        updatedAt: 500,
      }),
    });
    const row = dbManager.get(`SELECT * FROM knowledge_items WHERE id = ?`, [
      "k1",
    ]);
    expect(row.title).toBe("Mobile Note");
    expect(row.type).toBe("note");
    expect(row.content).toBe("from phone");
    expect(row.sync_status).toBe("synced");
    expect(row.device_id).toBe("dev-android");
  });

  it("UPSERT preserves local-only columns (content_path / embedding_path / git_commit_hash)", async () => {
    dbManager.run(
      `INSERT INTO knowledge_items
       (id, title, type, content, content_path, embedding_path, git_commit_hash,
        created_at, updated_at, sync_status)
       VALUES ('k2', 'Old', 'note', 'old body', '/local/x.md', '/emb/x.bin',
               'sha1', 100, 100, 'synced')`,
    );
    await sync._applyKnowledgeItem({
      resourceId: "k2",
      operation: SyncOperation.UPDATE,
      timestamp: 200,
      data: JSON.stringify({
        title: "New",
        type: "note",
        content: "new body",
        createdAt: 100,
        updatedAt: 200,
      }),
    });
    const row = dbManager.get(`SELECT * FROM knowledge_items WHERE id = 'k2'`);
    expect(row.title).toBe("New");
    expect(row.content).toBe("new body");
    // 本地独有列未被清空
    expect(row.content_path).toBe("/local/x.md");
    expect(row.embedding_path).toBe("/emb/x.bin");
    expect(row.git_commit_hash).toBe("sha1");
  });

  it("DELETE removes by id", async () => {
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, created_at, updated_at)
       VALUES ('k3', 't', 'note', 1, 1)`,
    );
    await sync._applyKnowledgeItem({
      resourceId: "k3",
      operation: SyncOperation.DELETE,
      timestamp: 999,
    });
    expect(dbManager.all(`SELECT * FROM knowledge_items`)).toHaveLength(0);
  });

  it("invalid type falls back to 'note' (防绕过 CHECK 约束)", async () => {
    await sync._applyKnowledgeItem({
      resourceId: "k4",
      operation: SyncOperation.CREATE,
      timestamp: 1,
      data: JSON.stringify({
        title: "Bad Type",
        type: "GARBAGE",
        content: "x",
      }),
    });
    const row = dbManager.get(
      `SELECT type FROM knowledge_items WHERE id = 'k4'`,
    );
    expect(row.type).toBe("note");
  });

  it("_normalizeKnowledgeType accepts all 4 KnowledgeType values + falls back", () => {
    expect(sync._normalizeKnowledgeType("note")).toBe("note");
    expect(sync._normalizeKnowledgeType("document")).toBe("document");
    expect(sync._normalizeKnowledgeType("conversation")).toBe("conversation");
    expect(sync._normalizeKnowledgeType("web_clip")).toBe("web_clip");
    expect(sync._normalizeKnowledgeType("NOTE")).toBe("note"); // case-insensitive
    expect(sync._normalizeKnowledgeType(null)).toBe("note");
    expect(sync._normalizeKnowledgeType("anything")).toBe("note");
  });
});

// ============================================================
// handlePush — KNOWLEDGE_ITEM round-trip (v1.1 W1)
// ============================================================
describe("MobileBridgeSync · handlePush KNOWLEDGE_ITEM", () => {
  it("applies remote KB item when local doesn't exist", async () => {
    const sync = makeSync();
    const res = await sync.handlePush({
      item: {
        resourceType: ResourceType.KNOWLEDGE_ITEM,
        resourceId: "k-remote",
        operation: SyncOperation.CREATE,
        version: 1,
        timestamp: 100,
        data: JSON.stringify({
          title: "From Phone",
          type: "note",
          content: "captured via OCR",
          createdAt: 50,
          updatedAt: 100,
        }),
      },
    });
    expect(res.status).toBe("applied");
    const row = dbManager.get(`SELECT * FROM knowledge_items WHERE id = ?`, [
      "k-remote",
    ]);
    expect(row.title).toBe("From Phone");
    expect(row.sync_status).toBe("synced");
  });

  it("returns conflict when local KB newer (LWW)", async () => {
    const sync = makeSync();
    dbManager.run(
      `INSERT INTO knowledge_items (id, title, type, content, created_at, updated_at, device_id, sync_status)
       VALUES ('k-conf', 'LOCAL', 'note', 'local body', 100, 5000, 'desktop', 'synced')`,
    );
    const res = await sync.handlePush({
      item: {
        resourceType: ResourceType.KNOWLEDGE_ITEM,
        resourceId: "k-conf",
        operation: SyncOperation.UPDATE,
        version: 1,
        timestamp: 100, // 比本地 5000 旧
        data: JSON.stringify({
          title: "REMOTE",
          type: "note",
          content: "remote body",
        }),
      },
    });
    expect(res.status).toBe("conflict");
    expect(
      dbManager.get(`SELECT title FROM knowledge_items WHERE id = 'k-conf'`)
        .title,
    ).toBe("LOCAL");
  });
});

// ============================================================
// runOnce — orchestration
// ============================================================
describe("MobileBridgeSync · runOnce", () => {
  it("throws when deviceId missing", async () => {
    const sync = makeSync();
    await expect(sync.runOnce()).rejects.toThrow(/deviceId/);
  });

  it("ensures cursor + writes durationMs", async () => {
    const sync = makeSync({
      deps: {
        getExternalStore: () => require("../sync-external-store"),
        getLogger: () => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        }),
        // Sequential clock: start=2000, end=2050
        now: vi.fn().mockReturnValueOnce(2000).mockReturnValueOnce(2050),
      },
    });
    patchInvokeRemote(sync, (method) =>
      method === "sync.pull"
        ? { items: [], nextCursor: null, hasMore: false }
        : { status: "applied" },
    );
    const res = await sync.runOnce("dev-1");
    expect(res.error).toBeFalsy();
    expect(res.durationMs).toBe(50);
    const cursor = require("../sync-external-store").getCursor(
      dbManager,
      "mobile",
      "dev-1",
    );
    expect(cursor).toBeTruthy();
    expect(cursor.lastRunStatus).toBe("success");
    expect(cursor.lastRunDurationMs).toBe(50);
  });

  it("captures error string when push throws", async () => {
    const sync = makeSync();
    patchInvokeRemote(sync, () => {
      throw new Error("network down");
    });
    // 让 walker 找到一行让 push 路径走起来
    dbManager.run(
      `INSERT INTO friends (id, user_did, friend_did, status, created_at, updated_at)
       VALUES ('did:x', 'me', 'did:x', 'pending', 1, 100)`,
    );
    const res = await sync.runOnce("dev-1");
    expect(res.error).toMatch(/network down/);
    const cursor = require("../sync-external-store").getCursor(
      dbManager,
      "mobile",
      "dev-1",
    );
    expect(cursor.lastRunStatus).toBe("failed");
    expect(cursor.lastRunError).toMatch(/network down/);
  });
});

// ============================================================
// pullRemote — apply incoming items
// ============================================================
describe("MobileBridgeSync · pullRemote", () => {
  it("applies items returned from sync.pull", async () => {
    const sync = makeSync();
    require("../sync-external-store").ensureCursor(
      dbManager,
      "mobile",
      "dev-1",
    );
    patchInvokeRemote(sync, (method) =>
      method === "sync.pull"
        ? {
            items: [
              {
                resourceType: ResourceType.FRIEND,
                resourceId: "did:remote",
                operation: SyncOperation.UPDATE,
                version: 1,
                timestamp: 5000,
                data: JSON.stringify({ nickname: "Remote" }),
              },
            ],
            nextCursor: null,
            hasMore: false,
          }
        : { status: "applied" },
    );
    const res = await sync.pullRemote("dev-1");
    expect(res.pulled).toBe(1);
    expect(res.conflicts).toBe(0);
    expect(
      dbManager.get(
        `SELECT nickname FROM friends WHERE friend_did = 'did:remote'`,
      ).nickname,
    ).toBe("Remote");
  });

  it("returns 0/0 when remote returns no items", async () => {
    const sync = makeSync();
    require("../sync-external-store").ensureCursor(
      dbManager,
      "mobile",
      "dev-1",
    );
    patchInvokeRemote(sync, () => ({
      items: [],
      nextCursor: null,
      hasMore: false,
    }));
    const res = await sync.pullRemote("dev-1");
    expect(res).toEqual({ pulled: 0, conflicts: 0 });
  });
});

// ============================================================
// handlePull — emits SyncItems by cursor
// ============================================================
describe("MobileBridgeSync · handlePull", () => {
  it("returns items above cursor + nextCursor", async () => {
    const sync = makeSync();
    dbManager.run(
      `INSERT INTO friends (id, user_did, friend_did, nickname, status, created_at, updated_at)
       VALUES ('did:a', 'me', 'did:a', 'A', 'accepted', 1, 100),
              ('did:b', 'me', 'did:b', 'B', 'accepted', 1, 200)`,
    );
    const res = await sync.handlePull({ cursor: { ts: 50, id: null } });
    expect(res.items.length).toBeGreaterThanOrEqual(2);
    const friends = res.items.filter(
      (i) => i.resourceType === ResourceType.FRIEND,
    );
    expect(friends.map((f) => f.resourceId).sort()).toEqual(["did:a", "did:b"]);
    expect(res.nextCursor.ts).toBeGreaterThan(0);
  });

  it("respects requestedTypes filter", async () => {
    const sync = makeSync();
    dbManager.run(
      `INSERT INTO friends (id, user_did, friend_did, nickname, status, created_at, updated_at)
       VALUES ('did:a', 'me', 'did:a', 'A', 'accepted', 1, 100)`,
    );
    dbManager.run(
      `INSERT INTO p2p_chat_messages (id, session_id, sender_did, receiver_did, content, timestamp)
       VALUES ('m1', 's', 'd', 'd', 'x', 100)`,
    );
    const res = await sync.handlePull({
      cursor: { ts: 0, id: null },
      resourceTypes: [ResourceType.MESSAGE],
    });
    const types = new Set(res.items.map((i) => i.resourceType));
    expect(types).toEqual(new Set([ResourceType.MESSAGE]));
  });
});
