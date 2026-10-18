"use strict";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { DatabaseSync } = require("node:sqlite");
const filter = require("../legacy-notification-filter");
const {
  createNotificationHandlers,
} = require("../../web-shell/handlers/notification-handlers");

const originalLoad = Module._load;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
Module._load = function (id, parent, ...rest) {
  if (id.endsWith("utils/logger.js")) return { logger: quiet };
  if (id === "electron")
    return { Notification: { isSupported: () => false }, app: {} };
  if (id.endsWith("did/did-signer")) return {};
  return originalLoad.call(this, id, parent, ...rest);
};
const NotificationManager = require("../../system/notification-manager");
const MobileBridgeSync = require("../../sync/mobile-bridge-sync");
Module._load = originalLoad;

let SQL;
before(async () => {
  if (process.env.CC_BOARD_TEST_SQLITE === "sql.js")
    SQL = await require("sql.js")();
});

function sqlJsDatabase() {
  const native = new SQL.Database();
  return {
    exec: (sql) => native.exec(sql),
    close: () => native.close(),
    prepare(sql) {
      const all = (...params) => {
        const stmt = native.prepare(sql);
        try {
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
        }
      };
      return {
        all,
        get: (...params) => all(...params)[0],
        run: (...params) => {
          native.run(sql, params);
          return { changes: native.getRowsModified() };
        },
      };
    },
  };
}

function fixture({ ledger = true } = {}) {
  const db =
    process.env.CC_BOARD_TEST_SQLITE === "sql.js"
      ? sqlJsDatabase()
      : process.env.CC_BOARD_TEST_SQLITE === "better-sqlite3"
        ? new (require("better-sqlite3"))(":memory:")
        : new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE notifications (id TEXT PRIMARY KEY, user_did TEXT, type TEXT,
    title TEXT, content TEXT, data TEXT, is_read INTEGER, created_at INTEGER);`);
  if (ledger)
    db.exec("CREATE TABLE task_board_notice_events (id TEXT PRIMARY KEY)");
  const protectedIds = [
    "cc-board-mention:orphan",
    "schema-only",
    "escaped-schema",
    "duplicate-schema",
  ];
  const rows = [
    ["ordinary", null, 10],
    ["ordinary-invalid", "{broken", 11],
    [protectedIds[0], null, 1],
    [
      protectedIds[1],
      JSON.stringify({ schema: filter.BOARD_NOTICE_SCHEMA, taskId: "secret" }),
      2,
    ],
    [
      protectedIds[2],
      '{"schema":"chainlesschain.board-notice-ref\\u002fv1"}',
      3,
    ],
    [
      protectedIds[3],
      '{"schema":"ordinary","schema":"chainlesschain.board-notice-ref\\u002fv1"}',
      4,
    ],
  ];
  if (ledger) {
    protectedIds.push("ledger-only");
    rows.push(["ledger-only", null, 5]);
    db.exec("INSERT INTO task_board_notice_events VALUES ('ledger-only')");
  }
  for (const [id, data, timestamp] of rows)
    db.prepare(
      "INSERT INTO notifications VALUES (?, 'did:member', 'system', 'title', 'secret-body', ?, 0, ?)",
    ).run(id, data, timestamp);
  const dbManager = {
    db,
    getDatabase: () => db,
    saveToFile() {},
    get: (sql, params = []) => db.prepare(sql).get(...params),
    all: (sql, params = []) => db.prepare(sql).all(...params),
    run: (sql, params = []) => db.prepare(sql).run(...params),
  };
  const mobile = new MobileBridgeSync({
    mobileBridge: {},
    dbManager,
    deps: { getLogger: () => quiet, now: () => 100 },
  });
  mobile._getLocalUserDid = () => "did:member";
  return {
    db,
    dbManager,
    mobile,
    protectedIds,
    ws: createNotificationHandlers({ database: dbManager }),
    manager: new NotificationManager(dbManager),
  };
}

test("WS pagination/count and both mark paths exclude all protected classifications", async () => {
  const f = fixture();
  assert.deepEqual(
    (
      await f.ws["notification.list"]({ limit: 1, offset: 1 })
    ).notifications.map((r) => r.id),
    ["ordinary"],
  );
  assert.equal((await f.ws["notification.unread-count"]()).count, 2);
  for (const id of f.protectedIds) await f.ws["notification.mark-read"]({ id });
  await f.ws["notification.mark-all-read"]();
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE is_read = 1")
      .get().n,
    2,
  );
  assert.deepEqual(
    (await f.ws["notification.list"]({ isRead: false })).notifications,
    [],
  );
  f.db.close();
});

test("system manager raw lists, mark, delete and clear cannot touch protected notices", async () => {
  const f = fixture();
  for (const list of [
    await f.manager.getAllNotifications(),
    await f.manager.getUnreadNotifications(),
    await f.manager.getNotificationsByType("system"),
  ]) {
    assert.equal(list.length, 2);
    assert.ok(list.every((r) => r.id.startsWith("ordinary")));
  }
  assert.equal(await f.manager.getUnreadCount(), 2);
  for (const id of f.protectedIds) {
    assert.equal(await f.manager.markAsRead(id), false);
    assert.equal(await f.manager.deleteNotification(id), false);
  }
  await f.manager.markAllAsRead();
  await f.manager.clearAllNotifications();
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0")
      .get().n,
    f.protectedIds.length,
  );
  await assert.rejects(
    f.manager.createNotification({
      data: { schema: filter.BOARD_NOTICE_SCHEMA },
    }),
    /authorized source/,
  );
  f.db.close();
});

test("mobile walker filters before both cursor forms and never emits protected refs", async () => {
  const f = fixture();
  for (const cursor of [null, "a"]) {
    const batch = await f.mobile._fetchNotifications(f.dbManager, 0, cursor, 1);
    assert.equal(batch.length, 1);
    assert.equal(batch[0].resourceId, "ordinary");
  }
  f.mobile._tableFetchers = () => [f.mobile._fetchNotifications.bind(f.mobile)];
  const result = await f.mobile.handlePull({
    resourceTypes: ["NOTIFICATION"],
    limit: 100,
  });
  assert.deepEqual(
    result.items.map((r) => r.resourceId),
    ["ordinary", "ordinary-invalid"],
  );
  let sent = false;
  f.mobile._invokeRemote = async () => {
    sent = true;
  };
  for (const id of f.protectedIds) {
    assert.equal(
      (
        await f.mobile._sendItem("phone", {
          resourceType: "NOTIFICATION",
          resourceId: id,
          data: "{}",
        })
      ).status,
      "failed",
    );
  }
  assert.equal(sent, false);
  f.db.close();
});

test("mobile inbound replacement/delete and schema spoofing fail before conflict disclosure", async () => {
  const f = fixture();
  for (const id of [...f.protectedIds, "cc-board-mention:not-yet-created"]) {
    for (const operation of ["CREATE", "UPDATE", "DELETE"]) {
      const result = await f.mobile.handlePush({
        item: {
          resourceType: "NOTIFICATION",
          resourceId: id,
          operation,
          timestamp: 99,
          data: '{"title":"injected","isRead":true}',
        },
      });
      assert.deepEqual(result, {
        status: "failed",
        error: "Protected notification",
      });
    }
  }
  for (const data of [
    { schema: filter.BOARD_NOTICE_SCHEMA },
    { data: JSON.stringify({ schema: filter.BOARD_NOTICE_SCHEMA }) },
  ]) {
    assert.equal(
      (
        await f.mobile.handlePush({
          item: {
            resourceType: "NOTIFICATION",
            resourceId: "injected",
            operation: "CREATE",
            data: JSON.stringify(data),
          },
        })
      ).status,
      "failed",
    );
  }
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE is_read = 1")
      .get().n,
    0,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM notifications").get().n,
    f.protectedIds.length + 2,
  );
  const ordinary = {
    resourceType: "NOTIFICATION",
    resourceId: "ordinary",
    operation: "UPDATE",
    timestamp: 99,
    version: 1,
    data: '{"title":"updated","isRead":true}',
  };
  assert.equal(
    (await f.mobile.handlePush({ item: ordinary })).status,
    "applied",
  );
  assert.equal(
    f.db.prepare("SELECT title FROM notifications WHERE id = 'ordinary'").get()
      .title,
    "updated",
  );
  assert.equal(
    (
      await f.mobile.handlePush({
        item: { ...ordinary, operation: "DELETE", timestamp: 100 },
      })
    ).status,
    "applied",
  );
  assert.equal(
    f.db.prepare("SELECT id FROM notifications WHERE id = 'ordinary'").get(),
    undefined,
  );
  f.db.close();
});

test("missing or removed ledger does not downgrade reserved orphan IDs; DB failures propagate", async () => {
  const f = fixture({ ledger: false });
  assert.equal((await f.ws["notification.unread-count"]()).count, 2);
  assert.equal(
    filter.isProtectedBoardNotice(f.db, {
      id: "cc-board-mention:orphan",
      data: null,
    }),
    true,
  );
  f.db.exec(
    "CREATE TABLE task_board_notice_events (id TEXT PRIMARY KEY); INSERT INTO task_board_notice_events VALUES ('ordinary');",
  );
  assert.equal(
    filter.isProtectedBoardNotice(f.db, { id: "ordinary", data: null }),
    true,
  );
  assert.equal((await f.ws["notification.unread-count"]()).count, 1);
  f.db.exec("DROP TABLE task_board_notice_events");
  assert.equal((await f.ws["notification.unread-count"]()).count, 2);
  f.db.close();
  assert.throws(() =>
    filter.isProtectedBoardNotice(f.db, { id: "ordinary", data: null }),
  );
});

test("mobile tombstones discard protected IDs without transmitting or mutating notices", async () => {
  const f = fixture();
  const discarded = [],
    sent = [];
  f.mobile.deps.getExternalStore = () => ({
    getCursor: () => null,
    listTombstones: () =>
      [...f.protectedIds, "ordinary-deleted"].map((id, i) => ({
        id: i,
        item_id: id,
        resource_type: "NOTIFICATION",
        deleted_at: 50,
      })),
    deleteTombstone: (_db, id) => discarded.push(id),
  });
  f.mobile._tableFetchers = () => [];
  f.mobile._invokeRemote = async (_device, _method, { item }) => {
    sent.push(item.resourceId);
    return { status: "applied" };
  };
  await f.mobile.pushPending("phone");
  assert.deepEqual(sent, ["ordinary-deleted"]);
  assert.equal(discarded.length, f.protectedIds.length + 1);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM notifications").get().n,
    f.protectedIds.length + 2,
  );
  f.db.close();
});
