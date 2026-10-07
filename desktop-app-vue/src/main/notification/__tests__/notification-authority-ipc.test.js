import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { registerNotificationIPC } = require("../notification-ipc.js");
const auth = require("../../task/project-goal-auth-session.js");
const owner = "did:chainless:alice";
const other = "did:chainless:bob";
const goalData = JSON.stringify({
  schema: "chainlesschain.goal-notice-ref/v1",
  goalId: "g1",
});

describe("notification IPC actor and projection authority", () => {
  let db, activeDb, actor, generation, event, window, electron, handlers;
  let projectionAllowed, projectionHook, readGoalProjection, show, database;
  function add(id, actorDid = owner, data = null, read = 0, time = 1) {
    db.prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?)").run(
      id,
      actorDid,
      "system",
      `Title ${id}`,
      `Cached ${id}`,
      data,
      read,
      time,
    );
  }
  function register(overrides = {}) {
    registerNotificationIPC({
      database,
      electron,
      getActor: () => actor,
      getAuthGeneration: () => generation,
      readGoalProjection,
      ...overrides,
    });
  }
  const call = (channel, ...args) =>
    handlers.get(`notification:${channel}`)(event, ...args);
  const state = (id) =>
    db.prepare("SELECT is_read FROM notifications WHERE id=?").get(id).is_read;
  beforeEach(() => {
    auth.disposeProjectGoalAuth();
    db = new Database(":memory:");
    activeDb = db;
    db.exec(`CREATE TABLE notifications (
      id TEXT PRIMARY KEY,user_did TEXT NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,
      content TEXT,data TEXT,is_read INTEGER DEFAULT 0,created_at INTEGER NOT NULL)`);
    actor = owner;
    generation = 1;
    handlers = new Map();
    projectionAllowed = true;
    projectionHook = null;
    window = { isDestroyed: vi.fn(() => false) };
    event = {
      sender: { isDestroyed: vi.fn(() => false) },
      senderFrame: { url: "http://localhost:5173", parent: null },
    };
    show = vi.fn();
    class Notification {
      static isSupported = vi.fn(() => true);
      constructor(options) {
        this.options = options;
      }
      show() {
        show(this.options);
      }
    }
    electron = {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      BrowserWindow: { fromWebContents: () => window },
      Notification,
    };
    database = { getDatabase: () => activeDb, saveToFile: vi.fn() };
    readGoalProjection = vi.fn(({ id, db: supplied, getActor }) => {
      expect(supplied).toBe(db);
      expect(db.inTransaction).toBe(true);
      expect(getActor()).toBe(owner);
      const row = db.prepare("SELECT * FROM notifications WHERE id=?").get(id);
      projectionHook?.();
      return projectionAllowed
        ? {
            ...row,
            title: "Current authorized goal",
            content: "Current authorized projection",
          }
        : null;
    });
    add("a-legacy");
    add("z-goal", owner, goalData, 0, 2);
    add("bob", other, goalData, 0, 3);
    register();
  });
  afterEach(() => {
    auth.disposeProjectGoalAuth();
    if (activeDb !== db && activeDb?.open) activeDb.close();
    if (db.open) db.close();
    vi.restoreAllMocks();
  });

  it("lists only current actor rows and replaces goal display text with a fresh authorized projection", async () => {
    const result = await call("get-all");
    expect(result.success).toBe(true);
    expect(result.notifications.map((row) => row.id)).toEqual([
      "z-goal",
      "a-legacy",
    ]);
    expect(result.notifications[0].content).toBe(
      "Current authorized projection",
    );
    expect(JSON.stringify(result)).not.toContain("Cached z-goal");
    expect(readGoalProjection).toHaveBeenCalledOnce();
    expect(await call("get-unread-count")).toEqual({ success: true, count: 2 });
    expect(show).not.toHaveBeenCalled();
  });

  it("never reads or acknowledges another actor's rows", async () => {
    await expect(call("mark-read", "bob")).rejects.toMatchObject({
      code: "NOTIFICATION_NOT_FOUND_OR_DENIED",
    });
    expect(state("bob")).toBe(0);
    expect(await call("mark-all-read")).toEqual({ success: true });
    expect(state("a-legacy")).toBe(1);
    expect(state("z-goal")).toBe(1);
    expect(state("bob")).toBe(0);
    expect(await call("get-unread-count")).toEqual({ success: true, count: 0 });
  });

  it("revalidates goal projections before list, count and both read mutations", async () => {
    expect((await call("get-all")).notifications).toHaveLength(2);
    projectionAllowed = false;
    const result = await call("get-all");
    expect(result.notifications.map((row) => row.id)).toEqual(["a-legacy"]);
    expect(await call("get-unread-count")).toEqual({ success: true, count: 1 });
    await expect(call("mark-read", "z-goal")).rejects.toMatchObject({
      code: "NOTIFICATION_NOT_FOUND_OR_DENIED",
    });
    await call("mark-all-read");
    expect(state("z-goal")).toBe(0);
    expect(state("a-legacy")).toBe(1);
  });

  it("fails explicitly without login and returns no cached list or count", async () => {
    await call("get-all");
    actor = null;
    expect(await call("get-all")).toEqual({
      success: false,
      notifications: [],
      error: "NOTIFICATION_IDENTITY_REQUIRED",
    });
    expect(await call("get-unread-count")).toEqual({
      success: false,
      count: 0,
      error: "NOTIFICATION_IDENTITY_REQUIRED",
    });
    await expect(call("mark-read", "a-legacy")).rejects.toMatchObject({
      code: "NOTIFICATION_IDENTITY_REQUIRED",
    });
    await expect(call("mark-all-read")).rejects.toMatchObject({
      code: "NOTIFICATION_IDENTITY_REQUIRED",
    });
    expect((await call("send-desktop", "Title", "Body")).success).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });

  it("defaults to the actual authenticated session instead of a loaded DID", async () => {
    auth.configureProjectGoalAuth({
      getDid: () => owner,
      getUKeyManager: () => null,
    });
    register({ getActor: undefined, getAuthGeneration: undefined });
    expect((await call("get-all")).error).toBe(
      "NOTIFICATION_IDENTITY_REQUIRED",
    );
    expect(
      auth.authenticateProjectGoalPassword(
        auth.beginProjectGoalAuthentication(),
      ),
    ).toBe(true);
    expect((await call("get-all")).success).toBe(true);
    auth.clearProjectGoalAuth();
    expect((await call("get-all")).notifications).toEqual([]);
  });

  it.each([
    [
      "actor",
      () => {
        actor = other;
      },
      "NOTIFICATION_AUTHENTICATION_CHANGED",
    ],
    [
      "same DID reauthentication",
      () => {
        generation++;
      },
      "NOTIFICATION_AUTHENTICATION_CHANGED",
    ],
    [
      "trusted navigation",
      () => {
        event.senderFrame.url = "http://localhost:5173/new";
      },
      "NOTIFICATION_WINDOW_CHANGED",
    ],
    [
      "frame replacement",
      () => {
        event.senderFrame = { ...event.senderFrame };
      },
      "NOTIFICATION_WINDOW_CHANGED",
    ],
    [
      "window replacement",
      () => {
        window = { isDestroyed: () => false };
      },
      "NOTIFICATION_WINDOW_CHANGED",
    ],
    [
      "database replacement",
      () => {
        activeDb = new Database(":memory:");
      },
      "NOTIFICATION_DATABASE_CHANGED",
    ],
  ])(
    "rejects a %s change during projection and rolls back earlier acknowledgments",
    async (_name, change, code) => {
      projectionHook = change;
      await expect(call("mark-all-read")).rejects.toMatchObject({ code });
      expect(state("a-legacy")).toBe(0);
      expect(state("z-goal")).toBe(0);
      expect(database.saveToFile).not.toHaveBeenCalled();
    },
  );

  it("does not return accumulated rows when authorization changes during output assembly", async () => {
    projectionHook = () => {
      generation++;
    };
    const result = await call("get-all");
    expect(result).toEqual({
      success: false,
      notifications: [],
      error: "NOTIFICATION_AUTHENTICATION_CHANGED",
    });
  });

  it.each([
    [
      "untrusted origin",
      () => {
        event.senderFrame.url = "https://untrusted.example";
      },
    ],
    [
      "subframe",
      () => {
        event.senderFrame.parent = {};
      },
    ],
    [
      "closed window",
      () => {
        window.isDestroyed.mockReturnValue(true);
      },
    ],
  ])("rejects %s for every channel", async (_name, change) => {
    change();
    expect((await call("get-all")).success).toBe(false);
    expect((await call("get-unread-count")).success).toBe(false);
    await expect(call("mark-read", "a-legacy")).rejects.toThrow();
    await expect(call("mark-all-read")).rejects.toThrow();
    expect((await call("send-desktop", "Title", "Body")).success).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });

  it.each([
    { actorDid: other },
    { user_did: other },
    { limit: 101 },
    { limit: 0 },
    { offset: -1 },
    { offset: 100001 },
    { offset: 1.5 },
    { isRead: "true" },
  ])("rejects renderer authority and unbounded options %j", async (options) => {
    expect(await call("get-all", options)).toEqual({
      success: false,
      notifications: [],
      error: "NOTIFICATION_INVALID_REQUEST",
    });
  });

  it("bounds pagination within the current actor and filters read state", async () => {
    expect(
      (await call("get-all", { limit: 1, offset: 1 })).notifications.map(
        (row) => row.id,
      ),
    ).toEqual(["a-legacy"]);
    await call("mark-read", "a-legacy");
    expect(
      (await call("get-all", { isRead: true })).notifications.map(
        (row) => row.id,
      ),
    ).toEqual(["a-legacy"]);
    expect(
      (await call("get-all", { isRead: false })).notifications.map(
        (row) => row.id,
      ),
    ).toEqual(["z-goal"]);
    await expect(
      call("mark-read", { id: "a-legacy", actorDid: other }),
    ).rejects.toMatchObject({ code: "NOTIFICATION_INVALID_REQUEST" });
    await expect(
      call("mark-all-read", { actorDid: other }),
    ).rejects.toMatchObject({ code: "NOTIFICATION_INVALID_REQUEST" });
  });

  it("never substitutes an asynchronous or cross-actor projection for authority", async () => {
    register({ readGoalProjection: () => Promise.resolve(null) });
    expect((await call("get-all")).error).toBe(
      "NOTIFICATION_SYNCHRONOUS_PROJECTION_REQUIRED",
    );
    register({ readGoalProjection: ({ id }) => ({ id, user_did: other }) });
    expect((await call("get-all")).error).toBe(
      "NOTIFICATION_PROJECTION_INVALID",
    );
    expect(state("z-goal")).toBe(0);
  });

  it("does not expose a malformed projection's stale content", async () => {
    db.prepare("UPDATE notifications SET data=? WHERE id='z-goal'").run(
      '{"schema":"chainlesschain.goal-notice-ref/v1"',
    );
    expect((await call("get-all")).notifications.map((row) => row.id)).toEqual([
      "a-legacy",
    ]);
    await expect(call("mark-read", "z-goal")).rejects.toThrow(
      "NOTIFICATION_NOT_FOUND_OR_DENIED",
    );
  });

  it("supports database.db hosts and scans unread rows in stable bounded batches", async () => {
    for (let i = 0; i < 205; i++) add(`batch-${String(i).padStart(3, "0")}`);
    const saveToFile = vi.fn();
    register({ database: { db, saveToFile } });
    expect(await call("get-unread-count")).toEqual({
      success: true,
      count: 207,
    });
    await call("mark-all-read");
    expect(await call("get-unread-count")).toEqual({ success: true, count: 0 });
    expect(saveToFile).toHaveBeenCalledOnce();
    expect(state("bob")).toBe(0);
  });

  it("keeps desktop delivery explicit and rechecks authority immediately before show", async () => {
    expect(
      await call("send-desktop", "Explicit title", "Explicit body"),
    ).toEqual({ success: true });
    expect(show).toHaveBeenCalledOnce();
    electron.Notification.isSupported.mockImplementation(() => {
      generation++;
      return true;
    });
    expect(
      (await call("send-desktop", "Stale title", "Stale body")).error,
    ).toBe("NOTIFICATION_AUTHENTICATION_CHANGED");
    expect(show).toHaveBeenCalledOnce();
  });
  it("broadcasts a body-free invalidation on host auth changes and unsubscribes at quit", () => {
    const send = vi.fn();
    let quit;
    electron.BrowserWindow.getAllWindows = () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }];
    electron.app = { once: (name, listener) => { expect(name).toBe("will-quit"); quit = listener; } };
    register();
    auth.clearProjectGoalAuth();
    expect(send).toHaveBeenCalledWith("notification:invalidated", {});
    expect(send).toHaveBeenCalledOnce();
    quit();
    auth.clearProjectGoalAuth();
    expect(send).toHaveBeenCalledOnce();
  });
});
