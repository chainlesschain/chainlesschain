// @vitest-environment node
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { DatabaseManager } from "../../../src/main/database.js";

const require = createRequire(import.meta.url);
const {
  registerNotificationIPC,
} = require("../../../src/main/notification/notification-ipc.js");

describe("sql.js transaction compatibility", () => {
  let SQL, manager, db;
  beforeAll(async () => {
    SQL = await initSqlJs();
  });
  beforeEach(() => {
    manager = Object.create(DatabaseManager.prototype);
    manager.db = db = new SQL.Database();
    manager.inTransaction = false;
    manager.saveToFile = vi.fn();
    manager.applyStatementCompat();
    db.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");
  });
  afterEach(() => db.close());
  const insert = (id) => db.prepare("INSERT INTO items VALUES (?)").run(id);
  const items = () => db.prepare("SELECT id FROM items ORDER BY id").all();

  it("executes a real immediate transaction and exposes its active state", () => {
    const run = vi.spyOn(db, "run");
    const receiver = { id: "a" };
    const transaction = db.transaction(function (suffix) {
      expect(db.inTransaction).toBe(true);
      insert(this.id + suffix);
      return 42;
    });
    expect(transaction.immediate.call(receiver, "1")).toBe(42);
    expect(run).toHaveBeenCalledWith("BEGIN IMMEDIATE");
    expect(items()).toEqual([{ id: "a1" }]);
    expect(db.inTransaction).toBe(false);
    expect(manager.saveToFile).toHaveBeenCalledTimes(1);
  });

  it("rolls back a failed callback and restores transaction state", () => {
    expect(() =>
      db
        .transaction(() => {
          insert("a");
          throw new Error("abort");
        })
        .immediate(),
    ).toThrow("abort");
    expect(items()).toEqual([]);
    expect(db.inTransaction).toBe(false);
    expect(manager.saveToFile).not.toHaveBeenCalled();
  });

  it("rolls back only a failed nested savepoint and persists the outer commit", () => {
    db.transaction(() => {
      insert("a");
      expect(() =>
        db
          .transaction(() => {
            insert("b");
            throw new Error("nested abort");
          })
          .immediate(),
      ).toThrow("nested abort");
      expect(db.inTransaction).toBe(true);
      db.transaction(() => insert("c"))();
    }).exclusive();
    expect(items()).toEqual([{ id: "a" }, { id: "c" }]);
    expect(db.inTransaction).toBe(false);
    expect(manager.saveToFile).toHaveBeenCalledTimes(1);
  });

  it("rejects async callbacks and rolls back writes before a promise is returned", () => {
    expect(() =>
      db.transaction(() => {
        insert("a");
        return Promise.resolve();
      })(),
    ).toThrow("must be synchronous");
    expect(items()).toEqual([]);
    expect(db.inTransaction).toBe(false);
  });

  it("rolls back successful nested writes when the outer transaction fails", () => {
    expect(() =>
      db
        .transaction(() => {
          db.transaction(() => insert("nested"))();
          throw new Error("outer abort");
        })
        .immediate(),
    ).toThrow("outer abort");
    expect(items()).toEqual([]);
    expect(db.inTransaction).toBe(false);
    expect(manager.saveToFile).not.toHaveBeenCalled();
  });

  it("does not rollback an existing raw transaction when BEGIN fails", () => {
    db.exec("BEGIN");
    db.exec("INSERT INTO items VALUES ('outer')");
    expect(() => db.transaction(() => insert("inner")).immediate()).toThrow();
    expect(items()).toEqual([{ id: "outer" }]);
    db.exec("ROLLBACK");
    expect(db.inTransaction).toBe(false);
  });

  it("serves authenticated notification reads and writes through the sql.js adapter", async () => {
    db.exec(`CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_did TEXT, data TEXT, is_read INTEGER
    ); INSERT INTO notifications VALUES ('a','did:chainless:owner',NULL,0),
      ('b','did:chainless:other',NULL,0)`);
    const handlers = new Map();
    const window = { isDestroyed: () => false };
    const event = {
      sender: { isDestroyed: () => false },
      senderFrame: { url: "http://localhost:5173" },
    };
    let actor = "did:chainless:owner";
    registerNotificationIPC({
      database: manager,
      electron: {
        ipcMain: {
          handle: (channel, handler) => handlers.set(channel, handler),
        },
        BrowserWindow: { fromWebContents: () => window },
      },
      getActor: () => actor,
      getAuthGeneration: () => 1,
      validateSender: () => ({ trusted: true }),
    });
    const call = (name, ...args) =>
      handlers.get(`notification:${name}`)(event, ...args);
    expect(await call("get-unread-count")).toEqual({ success: true, count: 1 });
    expect(await call("mark-all-read")).toEqual({ success: true });
    expect(await call("get-unread-count")).toEqual({ success: true, count: 0 });
    expect(
      db.prepare("SELECT is_read FROM notifications WHERE id='b'").get()
        .is_read,
    ).toBe(0);
    actor = null;
    expect(await call("get-unread-count")).toMatchObject({
      success: false,
      error: "NOTIFICATION_IDENTITY_REQUIRED",
    });
  });
});
