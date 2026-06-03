/**
 * sync.* WS handler 单元测试 — Phase 3b web-shell parity
 *
 * 测试结构：
 *   - sync.status 直接 raw SQL 查 cli_sync_state / cli_sync_conflicts (handler
 *     内 _safeCountQuery)，所以测试用 SQL 路由 stub 的 fake db。
 *   - 其它 4 个 (push/pull/conflicts/resolve) 经 sync-manager.js (ESM)。我们
 *     stub 一个 in-memory db 让 sync-manager 走真 SQL；ensureSyncTables 会建表，
 *     之后单元测试直接断言行数。better-sqlite3 没有时跳过这部分（CI 上 OK）。
 *
 * 设计取舍：
 *   - vi.mock 拦不住 dynamic import('file:///...')，所以不 mock sync-manager。
 *   - 用真 better-sqlite3 in-memory 跑后 4 个 handler 等于把它们升级为
 *     mini-integration 测试 — 是这层抽象的合适粒度。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "path";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  createSyncStatusHandlers,
  createSyncStatusHandler,
  createSyncPushHandler,
  createSyncPullHandler,
  createSyncConflictsHandler,
  createSyncResolveHandler,
} = require("../handlers/sync-status-handlers");

// ── helpers ─────────────────────────────────────────────────────

/**
 * Build a fake database wrapper for sync.status's raw-SQL path.
 * Routes SQL strings to canned counts.
 *
 * @param {{
 *   total?: number, pending?: number, synced?: number, conflicts?: number,
 *   throwOn?: RegExp,    // SQL pattern to throw on
 * }} counts
 */
function makeFakeStatusDb(counts = {}) {
  const t = counts.total ?? 0;
  const p = counts.pending ?? 0;
  const s = counts.synced ?? 0;
  const c = counts.conflicts ?? 0;
  return {
    getDatabase: () => ({
      prepare: (sql) => ({
        get: (...args) => {
          if (counts.throwOn && counts.throwOn.test(sql)) {
            throw new Error("simulated SQL failure");
          }
          if (
            /COUNT\(\*\)\s+as\s+c\s+FROM\s+cli_sync_state\s+WHERE/i.test(sql)
          ) {
            return { c: args[0] === "pending" ? p : s };
          }
          if (/COUNT\(\*\)\s+as\s+c\s+FROM\s+cli_sync_state\b/i.test(sql)) {
            return { c: t };
          }
          if (/cli_sync_conflicts/i.test(sql)) {
            return { c };
          }
          return { c: 0 };
        },
      }),
    }),
  };
}

let betterSqlite3 = null;
let nativeDbAvailable = false;
try {
  // Loaded only if dep is installed AND its native binding compiles for the
  // current Node ABI. The require can succeed even when bindings can't load
  // (the constructor is what trips); probe by trying to construct an
  // in-memory db. If either step fails, sync-manager-backed tests are
  // skipped — see memory/node_23_native_dep_trap.md for ABI gap context.
  betterSqlite3 = require("better-sqlite3-multiple-ciphers");
  const probe = new betterSqlite3(":memory:");
  probe.close();
  nativeDbAvailable = true;
} catch {
  /* missing better-sqlite3 OR ABI mismatch — skip integration tests */
}

const skipIfNoNativeDb = it.skipIf(!nativeDbAvailable);

/** Build an in-memory db wrapper accepted by handler._getDb + sync-manager. */
function makeRealDb() {
  const native = new betterSqlite3(":memory:");
  return {
    _native: native,
    getDatabase: () => native,
  };
}

// ── tests ───────────────────────────────────────────────────────

describe("sync-status-handlers · factory", () => {
  it("returns exactly 5 topics", () => {
    const handlers = createSyncStatusHandlers({ database: makeFakeStatusDb() });
    expect(Object.keys(handlers).sort()).toEqual([
      "sync.conflicts",
      "sync.pull",
      "sync.push",
      "sync.resolve",
      "sync.status",
    ]);
  });

  it("works with no args (database defaults to null)", () => {
    const handlers = createSyncStatusHandlers();
    expect(Object.keys(handlers)).toHaveLength(5);
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("sync.status (raw SQL path)", () => {
  it("returns success + status fields from cli_sync_* counts", async () => {
    const handler = createSyncStatusHandler({
      database: makeFakeStatusDb({
        total: 12,
        pending: 3,
        synced: 9,
        conflicts: 0,
      }),
    });
    const result = await handler();
    expect(result).toEqual({
      success: true,
      totalResources: 12,
      pending: 3,
      synced: 9,
      conflicts: 0,
    });
  });

  it("returns 数据库未初始化 when database is null", async () => {
    const handler = createSyncStatusHandler({ database: null });
    const result = await handler();
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });

  it("returns 数据库未初始化 when database.getDatabase throws", async () => {
    const handler = createSyncStatusHandler({
      database: {
        getDatabase: () => {
          throw new Error("not initialized");
        },
      },
    });
    const result = await handler();
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });

  it("returns counts as 0 when tables do not exist (swallowed by _safeCountQuery)", async () => {
    // Fake db that always throws on prepare — same as missing tables
    const handler = createSyncStatusHandler({
      database: {
        getDatabase: () => ({
          prepare: () => {
            throw new Error("no such table: cli_sync_state");
          },
        }),
      },
    });
    const result = await handler();
    expect(result).toEqual({
      success: true,
      totalResources: 0,
      pending: 0,
      synced: 0,
      conflicts: 0,
    });
  });
});

describe("sync.push / sync.pull (sync-manager-backed, requires better-sqlite3)", () => {
  let db;
  beforeEach(() => {
    if (!nativeDbAvailable) {
      return;
    }
    db = makeRealDb();
  });

  skipIfNoNativeDb(
    "sync.push returns success + push stats with no resources",
    async () => {
      const handler = createSyncPushHandler({ database: db });
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result).toMatchObject({ pushed: 0, total: 0 });
    },
  );

  skipIfNoNativeDb(
    "sync.pull returns success + pull stats with no resources",
    async () => {
      const handler = createSyncPullHandler({ database: db });
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result).toMatchObject({ checked: 0, updated: 0 });
    },
  );

  it("sync.push returns 数据库未初始化 when database is null", async () => {
    const handler = createSyncPushHandler({ database: null });
    const result = await handler({});
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });

  it("sync.pull returns 数据库未初始化 when database is null", async () => {
    const handler = createSyncPullHandler({ database: null });
    const result = await handler({});
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });
});

describe("sync.conflicts (sync-manager-backed)", () => {
  skipIfNoNativeDb(
    "returns success + empty conflicts on fresh db",
    async () => {
      const db = makeRealDb();
      const handler = createSyncConflictsHandler({ database: db });
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(Array.isArray(result.conflicts)).toBe(true);
    },
  );

  it("returns 数据库未初始化 when database is null", async () => {
    const handler = createSyncConflictsHandler({ database: null });
    const result = await handler({});
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });
});

describe("sync.resolve (sync-manager-backed)", () => {
  skipIfNoNativeDb(
    "returns success:false when conflict id does not exist",
    async () => {
      const db = makeRealDb();
      const handler = createSyncResolveHandler({ database: db });
      const result = await handler({
        conflictId: "non-existent-id",
        side: "local",
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-existent-id|冲突/);
    },
  );

  it("rejects missing conflictId", async () => {
    const handler = createSyncResolveHandler({
      database: makeFakeStatusDb(),
    });
    const result = await handler({ side: "local" });
    expect(result).toEqual({ success: false, error: "缺少 conflictId" });
  });

  it("rejects invalid side", async () => {
    const handler = createSyncResolveHandler({
      database: makeFakeStatusDb(),
    });
    const result = await handler({ conflictId: "c1", side: "merge" });
    expect(result).toEqual({
      success: false,
      error: "side 必须是 local 或 remote",
    });
  });

  it("returns 数据库未初始化 when database is null", async () => {
    const handler = createSyncResolveHandler({ database: null });
    const result = await handler({ conflictId: "c1", side: "local" });
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });
});
