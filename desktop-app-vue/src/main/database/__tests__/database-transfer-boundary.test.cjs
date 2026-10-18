"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const originalLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === "electron") return { ipcMain: {} };
  if (id.endsWith("utils/logger.js"))
    return { logger: { info() {}, warn() {}, error() {} } };
  if (id.endsWith("ipc/ipc-guard")) return {};
  return originalLoad.call(this, id, parent, ...rest);
};
const { registerDatabaseIPC } = require("../database-ipc");
Module._load = originalLoad;

function fixture() {
  const handlers = new Map(),
    calls = [];
  const database = {
    backup: async (value) => {
      calls.push(["backup", value]);
    },
    getDatabasePath: (context) => {
      calls.push(["path", context]);
      return `vault/${context}.db`;
    },
    switchDatabase: async (...args) => {
      calls.push(["switch", ...args]);
    },
    getKnowledgeItems: (limit, offset) => [{ id: "knowledge", limit, offset }],
    getStatistics: () => ({ total: 7 }),
  };
  const config = {
    restoreFromBackup: (value) => calls.push(["restore", value]),
    setDatabasePath: (value) => calls.push(["set-path", value]),
    migrateDatabaseTo: async (value) => calls.push(["migrate", value]),
    createDatabaseBackup: () => {
      calls.push(["automatic-backup"]);
      return "managed/backup.db";
    },
    listBackups: () => ["managed/backup.db"],
  };
  registerDatabaseIPC({
    database,
    getAppConfig: () => {
      calls.push(["config"]);
      return config;
    },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    ipcGuard: { isModuleRegistered: () => false, markModuleRegistered() {} },
  });
  return { handlers, database, calls };
}

const transfers = [
  ["db:backup", "DATABASE_NATIVE_EXPORT_REQUIRED"],
  ["database:migrate", "DATABASE_NATIVE_EXPORT_REQUIRED"],
  ["database:restore-backup", "DATABASE_NATIVE_IMPORT_REQUIRED"],
  ["database:set-path", "DATABASE_NATIVE_IMPORT_REQUIRED"],
];
for (const [channel, code] of transfers)
  test(`${channel} denies every renderer path without calling filesystem/config delegates`, async () => {
    const f = fixture();
    for (const value of [
      "C:/projects/exfiltrate.db",
      "/tmp/forged.db",
      "../outside.db",
      null,
      { path: "forged.db" },
    ]) {
      await assert.rejects(f.handlers.get(channel)({}, value), {
        code,
        message: code,
      });
    }
    assert.deepEqual(f.calls, []);
  });

test("actual scoped preload and allowed generic backup both reach the same host denial", async () => {
  const f = fixture(),
    exposed = {};
  vm.runInNewContext(
    readFileSync(path.resolve(__dirname, "../../../preload/index.js"), "utf8"),
    {
      require(name) {
        assert.equal(name, "electron");
        return {
          ipcRenderer: {
            invoke: (channel, ...args) => f.handlers.get(channel)({}, ...args),
          },
          contextBridge: {
            exposeInMainWorld: (name, value) => {
              exposed[name] = value;
            },
          },
          desktopCapturer: {},
        };
      },
      console: { log() {}, info() {}, warn() {}, error() {} },
    },
  );
  for (const [method, code] of [
    ["backup", "DATABASE_NATIVE_EXPORT_REQUIRED"],
    ["migrate", "DATABASE_NATIVE_EXPORT_REQUIRED"],
    ["restoreBackup", "DATABASE_NATIVE_IMPORT_REQUIRED"],
    ["setPath", "DATABASE_NATIVE_IMPORT_REQUIRED"],
  ]) {
    await assert.rejects(
      exposed.electronAPI.db[method]("C:/projects/untrusted.db"),
      { code },
    );
  }
  for (const invoke of [
    exposed.electronAPI.invoke,
    exposed.electron.ipcRenderer.invoke,
    exposed.ipc.invoke,
  ]) {
    await assert.rejects(invoke("db:backup", "C:/projects/untrusted.db"), {
      code: "DATABASE_NATIVE_EXPORT_REQUIRED",
    });
  }
  assert.deepEqual(f.calls, []);
});

test("database switching rejects traversal, devices, malformed and unknown context IDs before delegation", async () => {
  const f = fixture();
  for (const id of [
    "org_../../projects/forged",
    "org_..\\..\\forged",
    "org_test:stream",
    "org_..",
    "org_",
    "org_" + "a".repeat(129),
    "default",
    "personal/../forged",
    "org_test\u0000",
    null,
    {},
    1,
  ]) {
    await assert.rejects(f.handlers.get("db:switch-database")({}, id), {
      code: "DATABASE_INVALID_CONTEXT",
    });
  }
  assert.deepEqual(f.calls, []);
});

test("valid context switching, knowledge reads and managed backup creation retain existing behavior", async () => {
  const f = fixture();
  for (const context of ["personal", "org_team-123_test"]) {
    const options = { encryptionEnabled: true };
    assert.deepEqual(
      await f.handlers.get("db:switch-database")({}, context, options),
      { success: true, path: `vault/${context}.db` },
    );
    assert.deepEqual(f.calls.at(-1), [
      "switch",
      `vault/${context}.db`,
      options,
    ]);
  }
  assert.deepEqual(await f.handlers.get("db:get-knowledge-items")({}, 5, 2), [
    { id: "knowledge", limit: 5, offset: 2 },
  ]);
  assert.deepEqual(await f.handlers.get("db:get-statistics")({}), { total: 7 });
  assert.equal(
    await f.handlers.get("database:create-backup")({}),
    "managed/backup.db",
  );
  assert.deepEqual(await f.handlers.get("database:list-backups")({}), [
    "managed/backup.db",
  ]);
  await f.database.backup("host-owned/path.db");
  assert.deepEqual(f.calls.at(-1), ["backup", "host-owned/path.db"]);
});
