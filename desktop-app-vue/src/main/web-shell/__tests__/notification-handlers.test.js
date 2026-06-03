/**
 * notification.* WS handler 单元测试 — Phase 3c.6 web-shell parity
 *
 * 与 sync-status-handlers.test 同款 SQL-route fake-db pattern：handler 直接
 * 写 prepare(...).run/get/all，所以 mock 一个能按 SQL 字符串路由的 db。
 *
 * Notification.send-desktop 注入 `notificationModule` 替身，避免 require
 * Electron。
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  createNotificationHandlers,
  createNotificationListHandler,
  createNotificationUnreadCountHandler,
  createNotificationMarkReadHandler,
  createNotificationMarkAllReadHandler,
  createNotificationSendDesktopHandler,
  createNotificationSendMobileHandler,
} = require("../handlers/notification-handlers");

// ── helpers ─────────────────────────────────────────────────────

function makeFakeDb(rows = [], { throwOn } = {}) {
  let unread = rows.filter((r) => !r.is_read).length;
  const allRows = rows.slice();
  return {
    db: {
      prepare(sql) {
        if (throwOn && throwOn.test(sql)) {
          return {
            all: () => {
              throw new Error("simulated SQL failure");
            },
            get: () => {
              throw new Error("simulated SQL failure");
            },
            run: () => {
              throw new Error("simulated SQL failure");
            },
          };
        }
        if (/^SELECT \* FROM notifications/i.test(sql)) {
          return {
            all: (...args) => {
              if (sql.includes("WHERE is_read = ?")) {
                const filter = args[0] === 1;
                return allRows.filter((r) => Boolean(r.is_read) === filter);
              }
              return allRows;
            },
          };
        }
        if (/SELECT COUNT\(\*\) as count FROM notifications/i.test(sql)) {
          return { get: () => ({ count: unread }) };
        }
        if (/UPDATE notifications SET is_read = 1 WHERE id = \?/i.test(sql)) {
          return {
            run: (id) => {
              const row = allRows.find((r) => r.id === id);
              if (row && !row.is_read) {
                row.is_read = 1;
                unread = Math.max(0, unread - 1);
              }
            },
          };
        }
        if (/UPDATE notifications SET is_read = 1\s*$/i.test(sql)) {
          return {
            run: () => {
              for (const r of allRows) {
                r.is_read = 1;
              }
              unread = 0;
            },
          };
        }
        return { all: () => [], get: () => null, run: () => {} };
      },
    },
    saveToFile: vi.fn(),
  };
}

// ── factory ─────────────────────────────────────────────────────

describe("notification-handlers · factory", () => {
  it("returns exactly 6 topics", () => {
    const handlers = createNotificationHandlers({ database: makeFakeDb() });
    expect(Object.keys(handlers).sort()).toEqual([
      "notification.list",
      "notification.mark-all-read",
      "notification.mark-read",
      "notification.send-desktop",
      "notification.send-mobile",
      "notification.unread-count",
    ]);
  });

  it("works with no args (database + remoteGateway default to null)", () => {
    const handlers = createNotificationHandlers();
    expect(Object.keys(handlers)).toHaveLength(6);
    for (const fn of Object.values(handlers)) {
      expect(typeof fn).toBe("function");
    }
  });
});

// ── notification.list ───────────────────────────────────────────

describe("notification.list", () => {
  it("returns rows from notifications table", async () => {
    const handler = createNotificationListHandler({
      database: makeFakeDb([
        { id: 1, title: "a", is_read: 0, created_at: 1 },
        { id: 2, title: "b", is_read: 1, created_at: 2 },
      ]),
    });
    const result = await handler({});
    expect(result.success).toBe(true);
    expect(result.notifications).toHaveLength(2);
  });

  it("filters by isRead = true (only read rows)", async () => {
    const handler = createNotificationListHandler({
      database: makeFakeDb([
        { id: 1, title: "a", is_read: 0, created_at: 1 },
        { id: 2, title: "b", is_read: 1, created_at: 2 },
      ]),
    });
    const result = await handler({ isRead: true });
    expect(result.notifications).toEqual([
      { id: 2, title: "b", is_read: 1, created_at: 2 },
    ]);
  });

  it("returns empty list when database is null (no error)", async () => {
    const handler = createNotificationListHandler({ database: null });
    const result = await handler({});
    expect(result).toEqual({ success: true, notifications: [] });
  });

  it("returns error envelope on SQL failure", async () => {
    const handler = createNotificationListHandler({
      database: makeFakeDb([], { throwOn: /SELECT \* FROM/i }),
    });
    const result = await handler({});
    expect(result.success).toBe(false);
    expect(result.notifications).toEqual([]);
    expect(result.error).toMatch(/simulated/);
  });
});

// ── notification.unread-count ───────────────────────────────────

describe("notification.unread-count", () => {
  it("returns count from COUNT(*) query", async () => {
    const handler = createNotificationUnreadCountHandler({
      database: makeFakeDb([
        { id: 1, is_read: 0 },
        { id: 2, is_read: 0 },
        { id: 3, is_read: 1 },
      ]),
    });
    const result = await handler();
    expect(result).toEqual({ success: true, count: 2 });
  });

  it("returns 0 when database is null", async () => {
    const handler = createNotificationUnreadCountHandler({ database: null });
    const result = await handler();
    expect(result).toEqual({ success: true, count: 0 });
  });
});

// ── notification.mark-read ──────────────────────────────────────

describe("notification.mark-read", () => {
  it("marks a single row as read and persists", async () => {
    const db = makeFakeDb([
      { id: 1, is_read: 0 },
      { id: 2, is_read: 0 },
    ]);
    const handler = createNotificationMarkReadHandler({ database: db });
    const result = await handler({ id: 1 });
    expect(result).toEqual({ success: true });
    expect(db.saveToFile).toHaveBeenCalled();
  });

  it("rejects when id is missing", async () => {
    const handler = createNotificationMarkReadHandler({
      database: makeFakeDb(),
    });
    const result = await handler({});
    expect(result).toEqual({ success: false, error: "缺少 id" });
  });

  it("returns 数据库未初始化 when database is null", async () => {
    const handler = createNotificationMarkReadHandler({ database: null });
    const result = await handler({ id: 1 });
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });
});

// ── notification.mark-all-read ──────────────────────────────────

describe("notification.mark-all-read", () => {
  it("marks all rows as read", async () => {
    const db = makeFakeDb([
      { id: 1, is_read: 0 },
      { id: 2, is_read: 0 },
    ]);
    const handler = createNotificationMarkAllReadHandler({ database: db });
    const result = await handler();
    expect(result).toEqual({ success: true });
    expect(db.saveToFile).toHaveBeenCalled();
  });

  it("returns 数据库未初始化 when database is null", async () => {
    const handler = createNotificationMarkAllReadHandler({ database: null });
    const result = await handler();
    expect(result).toEqual({ success: false, error: "数据库未初始化" });
  });
});

// ── notification.send-desktop ───────────────────────────────────

describe("notification.send-desktop", () => {
  function makeNotificationStub({
    supported = true,
    throwOnShow = false,
  } = {}) {
    const calls = [];
    function FakeNotification(opts) {
      calls.push(opts);
      this.show = () => {
        if (throwOnShow) {
          throw new Error("show failed");
        }
      };
    }
    FakeNotification.isSupported = () => supported;
    FakeNotification.calls = calls;
    return FakeNotification;
  }

  it("constructs Notification with title + body and shows it", async () => {
    const stub = makeNotificationStub();
    const handler = createNotificationSendDesktopHandler({
      notificationModule: stub,
      iconPath: "/fake/icon.png",
    });
    const result = await handler({ title: "Hi", body: "There" });
    expect(result).toEqual({ success: true });
    expect(stub.calls).toEqual([
      { title: "Hi", body: "There", icon: "/fake/icon.png" },
    ]);
  });

  it("rejects when title is missing", async () => {
    const handler = createNotificationSendDesktopHandler({
      notificationModule: makeNotificationStub(),
    });
    const result = await handler({ body: "no title" });
    expect(result).toEqual({ success: false, error: "缺少 title" });
  });

  it("returns 桌面通知不可用 when isSupported returns false", async () => {
    const handler = createNotificationSendDesktopHandler({
      notificationModule: makeNotificationStub({ supported: false }),
    });
    const result = await handler({ title: "x" });
    expect(result).toEqual({ success: false, error: "桌面通知不可用" });
  });

  it("captures show() failures into envelope error", async () => {
    const handler = createNotificationSendDesktopHandler({
      notificationModule: makeNotificationStub({ throwOnShow: true }),
    });
    const result = await handler({ title: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/show failed/);
  });
});

// ── notification.send-mobile ────────────────────────────────────

describe("notification.send-mobile (#21 v1.3+)", () => {
  function makeRemoteGateway(sendToMobileImpl) {
    return {
      handlers: {
        notification: {
          sendToMobile: sendToMobileImpl,
        },
      },
    };
  }

  it("forwards title/body/target + wraps target in targetDevices array", async () => {
    const captured = [];
    const remoteGateway = makeRemoteGateway(async (params, context) => {
      captured.push({ params, context });
      return { id: "fake-id", timestamp: 12345 };
    });
    const handler = createNotificationSendMobileHandler({ remoteGateway });
    const result = await handler({
      type: "notification.send-mobile",
      id: "req-1",
      title: "Hello",
      body: "World",
      target: "did:cc:iphone-7890",
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ id: "fake-id", timestamp: 12345 });
    expect(captured).toHaveLength(1);
    expect(captured[0].params).toMatchObject({
      title: "Hello",
      body: "World",
      targetDevices: ["did:cc:iphone-7890"],
      silent: false,
      urgency: "normal",
      type: "app",
    });
    expect(captured[0].context).toEqual({ source: "ws-bridge:cli" });
  });

  it("uses notificationType (not frame.type) for the semantic type", async () => {
    let captured;
    const remoteGateway = makeRemoteGateway(async (params) => {
      captured = params;
      return {};
    });
    const handler = createNotificationSendMobileHandler({ remoteGateway });
    await handler({
      type: "notification.send-mobile", // topic name, must NOT leak into type
      title: "x",
      target: "did:cc:foo",
      notificationType: "alert",
    });
    expect(captured.type).toBe("alert");
  });

  it("rejects when title is missing", async () => {
    const handler = createNotificationSendMobileHandler({
      remoteGateway: makeRemoteGateway(async () => ({})),
    });
    const result = await handler({ target: "did:cc:foo" });
    expect(result).toEqual({ success: false, error: "缺少 title" });
  });

  it("rejects when target is missing", async () => {
    const handler = createNotificationSendMobileHandler({
      remoteGateway: makeRemoteGateway(async () => ({})),
    });
    const result = await handler({ title: "Hi" });
    expect(result).toEqual({ success: false, error: "缺少 target (设备 DID)" });
  });

  it("treats blank-string title/target as missing", async () => {
    const handler = createNotificationSendMobileHandler({
      remoteGateway: makeRemoteGateway(async () => ({})),
    });
    expect(await handler({ title: "   ", target: "did:cc:x" })).toEqual({
      success: false,
      error: "缺少 title",
    });
    expect(await handler({ title: "ok", target: "   " })).toEqual({
      success: false,
      error: "缺少 target (设备 DID)",
    });
  });

  it("returns remote-gateway 不可用 when no remoteGateway", async () => {
    const handler = createNotificationSendMobileHandler({
      remoteGateway: null,
    });
    const result = await handler({ title: "x", target: "did:cc:foo" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/remote-gateway 不可用/);
  });

  it("returns remote-gateway 不可用 when sendToMobile is not a function", async () => {
    const handler = createNotificationSendMobileHandler({
      remoteGateway: { handlers: { notification: {} } },
    });
    const result = await handler({ title: "x", target: "did:cc:foo" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/remote-gateway 不可用/);
  });

  it("captures sendToMobile errors into envelope", async () => {
    const remoteGateway = makeRemoteGateway(async () => {
      throw new Error("mobile-bridge offline");
    });
    const handler = createNotificationSendMobileHandler({ remoteGateway });
    const result = await handler({ title: "x", target: "did:cc:foo" });
    expect(result).toEqual({
      success: false,
      error: "mobile-bridge offline",
    });
  });

  it("silent=true sets urgency=low (quiet hours D6 path)", async () => {
    let captured;
    const remoteGateway = makeRemoteGateway(async (params) => {
      captured = params;
      return {};
    });
    const handler = createNotificationSendMobileHandler({ remoteGateway });
    await handler({
      title: "x",
      target: "did:cc:foo",
      silent: true,
    });
    expect(captured.silent).toBe(true);
    expect(captured.urgency).toBe("low");
  });

  it("accepts silenced alias for silent (CLI option name)", async () => {
    let captured;
    const remoteGateway = makeRemoteGateway(async (params) => {
      captured = params;
      return {};
    });
    const handler = createNotificationSendMobileHandler({ remoteGateway });
    await handler({
      title: "x",
      target: "did:cc:foo",
      silenced: true,
    });
    expect(captured.silent).toBe(true);
  });
});

// ── createNotificationHandlers (registry) ────────────────────────

describe("createNotificationHandlers registry", () => {
  it("registers notification.send-mobile topic alongside existing 5", () => {
    const handlers = createNotificationHandlers({
      database: null,
      remoteGateway: {
        handlers: { notification: { sendToMobile: async () => ({}) } },
      },
    });
    expect(Object.keys(handlers).sort()).toEqual([
      "notification.list",
      "notification.mark-all-read",
      "notification.mark-read",
      "notification.send-desktop",
      "notification.send-mobile",
      "notification.unread-count",
    ]);
  });
});
