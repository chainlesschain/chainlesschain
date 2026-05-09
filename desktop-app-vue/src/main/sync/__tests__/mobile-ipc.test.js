/**
 * mobile-ipc 单元测试 — Phase 3d M2 step 8
 *
 * 注入 fake ipcMain + fake database (sql.js) + fake app（暴露
 * mobileBridgeSync / deviceManager / mobileBridge），验证：
 *   - registerMobileSyncIPC 注册 5 个 handle channel
 *   - ipcGuard 防止重复注册
 *   - run / run-all 在 mobileBridgeSync 未就绪时返回明确错误
 *   - run-all 聚合多设备 stats
 *   - status 读 cursor + filter tombstone
 *   - list-paired 复合 deviceManager + dataChannels online 标记
 *   - unpair 清 cursor + tombstones
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

const ipcGuard = require("../../ipc/ipc-guard");
const store = require("../sync-external-store");
const { registerMobileSyncIPC, PROVIDER_ID } = require("../mobile-ipc");

// ── sql.js 内存 dbManager ─────────────────────────────────────
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

// ── fake ipcMain ─────────────────────────────────────────────
function makeFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
    invoke: async (channel, ...args) => {
      const fn = handlers.get(channel);
      if (!fn) {
        throw new Error(`channel not registered: ${channel}`);
      }
      return fn({}, ...args);
    },
  };
}

let initSqlJs;
let SQL;
let database;

beforeAll(async () => {
  initSqlJs = (await import("sql.js")).default;
  SQL = await initSqlJs();
});

function bootstrapMinimalSchema(sqlDb) {
  sqlDb.exec(`
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
  `);
}

beforeEach(() => {
  ipcGuard.unregisterModule?.("mobile-ipc");
  const sqlDb = new SQL.Database();
  bootstrapMinimalSchema(sqlDb);
  database = new TestDbManager(sqlDb);
});

function fakeApp(overrides = {}) {
  return {
    mobileBridgeSync: null,
    mobileBridge: null,
    deviceManager: null,
    ...overrides,
  };
}

function fakeMobileBridgeSync({ runOnce } = {}) {
  return {
    runOnce: vi.fn(
      runOnce ||
        (async () => ({
          pushed: 0,
          pulled: 0,
          conflicts: 0,
          durationMs: 0,
        })),
    ),
  };
}

// ============================================================
// 注册
// ============================================================
describe("mobile-ipc · registration", () => {
  it("registers 5 handlers via injected ipcMain", () => {
    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp(),
      ipcMain,
    });
    expect(ipcMain.handle).toHaveBeenCalledTimes(5);
    const channels = [...ipcMain.handlers.keys()];
    expect(channels).toEqual(
      expect.arrayContaining([
        "sync:mobile:run",
        "sync:mobile:run-all",
        "sync:mobile:status",
        "sync:mobile:list-paired",
        "sync:mobile:unpair",
      ]),
    );
  });

  it("does not re-register when called twice (ipcGuard)", () => {
    const ipcMain1 = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp(),
      ipcMain: ipcMain1,
    });
    const ipcMain2 = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp(),
      ipcMain: ipcMain2,
    });
    expect(ipcMain2.handle).not.toHaveBeenCalled();
  });

  it("PROVIDER_ID is 'mobile'", () => {
    expect(PROVIDER_ID).toBe("mobile");
  });
});

// ============================================================
// sync:mobile:run
// ============================================================
describe("mobile-ipc · run", () => {
  it("returns error when deviceId missing", async () => {
    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp(),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:run");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/deviceId/);
  });

  it("returns error when mobileBridgeSync not ready", async () => {
    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({ mobileBridgeSync: null }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:run", "dev-1");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/未就绪/);
  });

  it("delegates to mobileBridgeSync.runOnce + returns mapped result", async () => {
    const ipcMain = makeFakeIpcMain();
    const sync = fakeMobileBridgeSync({
      runOnce: async () => ({
        pushed: 3,
        pulled: 2,
        conflicts: 1,
        durationMs: 42,
      }),
    });
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({ mobileBridgeSync: sync }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:run", "dev-1");
    expect(sync.runOnce).toHaveBeenCalledWith("dev-1");
    expect(res).toMatchObject({
      success: true,
      deviceId: "dev-1",
      pushed: 3,
      pulled: 2,
      conflicts: 1,
      durationMs: 42,
    });
  });

  it("propagates error from runOnce.error field", async () => {
    const ipcMain = makeFakeIpcMain();
    const sync = fakeMobileBridgeSync({
      runOnce: async () => ({
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        error: "remote unreachable",
      }),
    });
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({ mobileBridgeSync: sync }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:run", "dev-1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("remote unreachable");
  });
});

// ============================================================
// sync:mobile:run-all
// ============================================================
describe("mobile-ipc · run-all", () => {
  it("returns error when no paired devices", async () => {
    const ipcMain = makeFakeIpcMain();
    const sync = fakeMobileBridgeSync();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({
        mobileBridgeSync: sync,
        deviceManager: { getRegisteredDevices: () => [] },
      }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:run-all");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/无.*配对/);
    expect(res.devices).toEqual([]);
  });

  it("aggregates results across multiple paired devices", async () => {
    const ipcMain = makeFakeIpcMain();
    const sync = fakeMobileBridgeSync({
      runOnce: async (deviceId) => ({
        pushed: deviceId === "dev-a" ? 5 : 2,
        pulled: 1,
        conflicts: 0,
        durationMs: 10,
      }),
    });
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({
        mobileBridgeSync: sync,
        deviceManager: {
          getRegisteredDevices: () => [
            { deviceId: "dev-a" },
            { deviceId: "dev-b" },
          ],
        },
      }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:run-all");
    expect(res.success).toBe(true);
    expect(res.devices).toHaveLength(2);
    expect(res.devices.map((d) => d.deviceId).sort()).toEqual([
      "dev-a",
      "dev-b",
    ]);
    expect(sync.runOnce).toHaveBeenCalledTimes(2);
  });

  it("captures per-device error without aborting others", async () => {
    const ipcMain = makeFakeIpcMain();
    const sync = fakeMobileBridgeSync({
      runOnce: async (deviceId) => {
        if (deviceId === "dev-bad") {
          throw new Error("boom");
        }
        return { pushed: 1, pulled: 0, conflicts: 0, durationMs: 5 };
      },
    });
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({
        mobileBridgeSync: sync,
        deviceManager: {
          getRegisteredDevices: () => [
            { deviceId: "dev-bad" },
            { deviceId: "dev-good" },
          ],
        },
      }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:run-all");
    expect(res.success).toBe(false);
    const bad = res.devices.find((d) => d.deviceId === "dev-bad");
    const good = res.devices.find((d) => d.deviceId === "dev-good");
    expect(bad.error).toMatch(/boom/);
    expect(good.error).toBeUndefined();
    expect(good.pushed).toBe(1);
  });

  it("dedupes deviceManager + dataChannels sources", async () => {
    const ipcMain = makeFakeIpcMain();
    const sync = fakeMobileBridgeSync();
    const dataChannels = new Map([
      ["dev-a", {}],
      ["dev-b", {}],
    ]);
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({
        mobileBridgeSync: sync,
        mobileBridge: { dataChannels },
        deviceManager: {
          getRegisteredDevices: () => [{ deviceId: "dev-a" }], // 也在 dataChannels
        },
      }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:run-all");
    // dev-a 应只算一次（去重），dev-b 来自 dataChannels
    expect(sync.runOnce).toHaveBeenCalledTimes(2);
    const ids = sync.runOnce.mock.calls.map((c) => c[0]).sort();
    expect(ids).toEqual(["dev-a", "dev-b"]);
  });
});

// ============================================================
// sync:mobile:status
// ============================================================
describe("mobile-ipc · status", () => {
  it("reads cursor row + filters tombstone by mobile-5 ResourceType", async () => {
    // 准备 cursor + tombstones
    database.run(
      `INSERT INTO sync_external_provider_cursor
       (provider_id, account_key, last_sync_at, items_pushed, last_run_status)
       VALUES ('mobile', 'dev-1', 5000, 7, 'success')`,
    );
    database.run(
      `INSERT INTO sync_external_tombstones
       (provider_id, account_key, item_id, resource_type, deleted_at)
       VALUES ('mobile', 'dev-1', 'm1', 'MESSAGE', 100),
              ('mobile', 'dev-1', 'k1', 'KNOWLEDGE_ITEM', 100)`,
    );

    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({
        mobileBridgeSync: fakeMobileBridgeSync(),
        deviceManager: {
          getRegisteredDevices: () => [{ deviceId: "dev-1" }],
        },
      }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:status");
    expect(res.success).toBe(true);
    expect(res.bridgeReady).toBe(true);
    expect(res.devices).toHaveLength(1);
    expect(res.devices[0]).toMatchObject({
      deviceId: "dev-1",
      lastSyncAt: 5000,
      itemsPushed: 7,
      lastRunStatus: "success",
    });
    // pendingTombstones 只 count mobile-5（KNOWLEDGE_ITEM 行不算）
    expect(res.pendingTombstones).toBe(true);
  });

  it("bridgeReady=false when mobileBridgeSync absent", async () => {
    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({ mobileBridgeSync: null }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:status");
    expect(res.bridgeReady).toBe(false);
  });
});

// ============================================================
// sync:mobile:list-paired
// ============================================================
describe("mobile-ipc · list-paired", () => {
  it("returns deviceManager devices with online flag from dataChannels", async () => {
    const ipcMain = makeFakeIpcMain();
    const dataChannels = new Map([["dev-online", {}]]);
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({
        mobileBridge: { dataChannels },
        deviceManager: {
          getRegisteredDevices: () => [
            {
              deviceId: "dev-online",
              deviceName: "Pixel",
              platform: "android",
              did: "did:mobile:1",
              pairedAt: 1000,
            },
            {
              deviceId: "dev-offline",
              deviceName: "Old",
              platform: "android",
              did: "did:mobile:2",
              pairedAt: 500,
            },
          ],
        },
      }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:list-paired");
    expect(res.success).toBe(true);
    expect(res.devices).toHaveLength(2);
    const online = res.devices.find((d) => d.deviceId === "dev-online");
    const offline = res.devices.find((d) => d.deviceId === "dev-offline");
    expect(online.online).toBe(true);
    expect(online.deviceName).toBe("Pixel");
    expect(offline.online).toBe(false);
  });

  it("returns empty list when no deviceManager", async () => {
    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({ deviceManager: null }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:list-paired");
    expect(res.success).toBe(true);
    expect(res.devices).toEqual([]);
  });
});

// ============================================================
// sync:mobile:unpair
// ============================================================
describe("mobile-ipc · unpair", () => {
  it("returns error when deviceId missing", async () => {
    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp(),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:unpair");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/deviceId/);
  });

  it("clears cursor + tombstones + calls deviceManager.unregisterDevice", async () => {
    // seed 数据
    database.run(
      `INSERT INTO sync_external_provider_cursor
       (provider_id, account_key, last_sync_at, items_pushed)
       VALUES ('mobile', 'dev-1', 100, 5)`,
    );
    database.run(
      `INSERT INTO sync_external_tombstones
       (provider_id, account_key, item_id, resource_type, deleted_at)
       VALUES ('mobile', 'dev-1', 'm1', 'MESSAGE', 1)`,
    );

    const unregisterDevice = vi.fn();
    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({
        deviceManager: { unregisterDevice },
      }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:unpair", "dev-1");
    expect(res.success).toBe(true);
    expect(unregisterDevice).toHaveBeenCalledWith("dev-1");
    // cursor 通过 resetCursor 清状态，行还在但 last_sync_at 应为 0
    const cursor = store.getCursor(database, "mobile", "dev-1");
    expect(cursor?.lastSyncAt ?? 0).toBe(0);
    // tombstones 应被清掉
    const tombs = database.all(
      `SELECT * FROM sync_external_tombstones WHERE provider_id = 'mobile' AND account_key = 'dev-1'`,
    );
    expect(tombs).toEqual([]);
  });

  it("survives missing deviceManager.unregisterDevice (graceful degrade)", async () => {
    database.run(
      `INSERT INTO sync_external_provider_cursor (provider_id, account_key) VALUES ('mobile', 'dev-x')`,
    );
    const ipcMain = makeFakeIpcMain();
    registerMobileSyncIPC({
      database,
      mainWindow: null,
      app: fakeApp({ deviceManager: null }),
      ipcMain,
    });
    const res = await ipcMain.invoke("sync:mobile:unpair", "dev-x");
    expect(res.success).toBe(true);
  });
});
