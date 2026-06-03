/**
 * NotificationHandler — Phase 4 桌面 debt 修复测试
 *
 * 覆盖 5 个新加的 method:
 *   broadcast / markAllAsRead / delete / clearAll / getUnreadCount
 *
 * 这些方法都是 Android `NotificationCommands.kt` + iOS Phase 4
 * `NotificationCommands.swift` typed wrapper 在调，但桌面 handler
 * 之前缺 — mobile peer 调到会拿 "Unknown action: <name>"。本测试
 * 防退保对 11 method 路由全连通 + 各 method 行为 + iOS 响应 shape
 * 兼容（key 名 / 数字类型 / success 默认值）。
 *
 * Reference:
 *   docs/design/Desktop_Mobile_Bridge_Namespace_Coverage.md §4.2 #9
 *   ios-app/Modules/CoreP2P/Sources/RemoteSkills/Notification/NotificationModels.swift
 *   android-app/app/src/main/java/com/chainlesschain/android/remote/commands/NotificationCommands.kt
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");

// Stub Electron's `Notification` so handler require doesn't blow up under
// vitest (no Electron runtime). The handler only uses Notification.isSupported
// + the constructor; we mock both as no-ops since the new methods don't fire
// system notifications.
vi.mock("electron", () => ({
  Notification: class {
    static isSupported() {
      return false;
    }
    constructor() {}
    show() {}
    on() {}
  },
}));

const { NotificationHandler } = require("../handlers/notification-handler");

function _seedRow(db, overrides = {}) {
  const id =
    overrides.id ||
    `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = overrides.createdAt || Date.now();
  const expiresAt =
    overrides.expiresAt === undefined
      ? createdAt + 7 * 24 * 60 * 60 * 1000
      : overrides.expiresAt;
  db.prepare(
    `INSERT INTO notification_history
       (id, type, title, body, urgency, source, read, sent_to_mobile, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    overrides.type || "app",
    overrides.title || "t",
    overrides.body || "b",
    overrides.urgency || "normal",
    overrides.source || "local",
    overrides.read ? 1 : 0,
    overrides.sentToMobile ? 1 : 0,
    createdAt,
    expiresAt,
  );
  return id;
}

describe("NotificationHandler — Phase 4 5 桌面 debt method fix", () => {
  let handler;
  let db;
  let emittedEvents;

  beforeEach(() => {
    db = new Database(":memory:");
    handler = new NotificationHandler(db, {});

    emittedEvents = [];
    handler.setEventEmitter({
      emit: (name, payload) => {
        emittedEvents.push({ name, payload });
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  // ─── handle() routing ───────────────────────────────────────────────

  describe("handle() routes the 5 new actions", () => {
    it("dispatches broadcast / markAllAsRead / delete / clearAll / getUnreadCount", async () => {
      // broadcast
      const b = await handler.handle(
        "broadcast",
        { title: "x", body: "y" },
        {},
      );
      expect(b.success).toBe(true);
      // markAllAsRead
      const m = await handler.handle("markAllAsRead", {}, {});
      expect(m).toHaveProperty("success");
      // delete (needs id; without one returns success:false but routing was hit)
      const d = await handler.handle("delete", {}, {});
      expect(d).toEqual({ success: false, error: "notificationId required" });
      // clearAll
      const c = await handler.handle("clearAll", {}, {});
      expect(c.success).toBe(true);
      // getUnreadCount
      const u = await handler.handle("getUnreadCount", {}, {});
      expect(u.success).toBe(true);
    });

    it("still throws Unknown action for a method that does not exist", async () => {
      await expect(handler.handle("nonExistentMethod", {}, {})).rejects.toThrow(
        /Unknown action/,
      );
    });
  });

  // ─── broadcast ──────────────────────────────────────────────────────

  describe("broadcast", () => {
    it("persists a row + emits broadcast event with targetDevices=null", async () => {
      const r = await handler.broadcast({ title: "hello", body: "world" }, {});
      expect(r.success).toBe(true);
      expect(r.deliveredCount).toBe(0);
      expect(r.failedCount).toBe(0);
      expect(typeof r.id).toBe("string");
      expect(typeof r.timestamp).toBe("number");

      const row = db
        .prepare(
          "SELECT id, title, body, source, sent_to_mobile FROM notification_history WHERE id = ?",
        )
        .get(r.id);
      expect(row.title).toBe("hello");
      expect(row.source).toBe("pc");
      expect(row.sent_to_mobile).toBe(1);

      const send = emittedEvents.find((e) => e.name === "notification:send");
      expect(send).toBeTruthy();
      expect(send.payload.broadcast).toBe(true);
      expect(send.payload.targetDevices).toBeNull();
      expect(send.payload.notification.title).toBe("hello");
    });

    it("rejects empty title with success:false (iOS NotificationBroadcastResponse shape)", async () => {
      const r = await handler.broadcast({ title: "", body: "x" }, {});
      expect(r).toEqual({
        success: false,
        deliveredCount: 0,
        failedCount: 0,
        error: "title required",
      });
      // No row persisted on validation failure.
      const count = db
        .prepare("SELECT COUNT(*) as c FROM notification_history")
        .get().c;
      expect(count).toBe(0);
    });

    it("returns iOS-compatible shape (success / deliveredCount / failedCount / error?)", async () => {
      const r = await handler.broadcast({ title: "k", body: "v" }, {});
      // Mandatory keys for iOS NotificationBroadcastResponse decoder
      expect(r).toHaveProperty("success");
      expect(r).toHaveProperty("deliveredCount");
      expect(r).toHaveProperty("failedCount");
      expect(typeof r.success).toBe("boolean");
      expect(typeof r.deliveredCount).toBe("number");
      expect(typeof r.failedCount).toBe("number");
    });
  });

  // ─── markAllAsRead ──────────────────────────────────────────────────

  describe("markAllAsRead", () => {
    it("flips every unread row to read=1 and reports actual count", async () => {
      _seedRow(db, { id: "a", read: false });
      _seedRow(db, { id: "b", read: false });
      _seedRow(db, { id: "c", read: true });

      const r = await handler.markAllAsRead({}, {});
      expect(r.success).toBe(true);
      expect(r.markedCount).toBe(2); // c was already read

      const unread = db
        .prepare(
          "SELECT COUNT(*) as c FROM notification_history WHERE read = 0",
        )
        .get().c;
      expect(unread).toBe(0);
    });

    it("returns markedCount=0 when nothing was unread (still success)", async () => {
      _seedRow(db, { id: "a", read: true });
      const r = await handler.markAllAsRead({}, {});
      expect(r).toEqual({ success: true, markedCount: 0 });
    });

    it("returns iOS NotificationMarkResponse shape (number markedCount, not string)", async () => {
      const r = await handler.markAllAsRead({}, {});
      // Phase 4 wire trap: existing markAsRead returned "all" as a string
      // when no id was supplied. iOS Int decoder would silently fall back
      // to 0. markAllAsRead must always return Int.
      expect(typeof r.markedCount).toBe("number");
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────

  describe("delete", () => {
    it("removes the specified notification by id", async () => {
      _seedRow(db, { id: "x", title: "delete-me" });
      _seedRow(db, { id: "y", title: "keep-me" });

      const r = await handler.delete({ notificationId: "x" }, {});
      expect(r).toEqual({ success: true });

      const remaining = db
        .prepare("SELECT id FROM notification_history")
        .all()
        .map((r) => r.id);
      expect(remaining).toEqual(["y"]);
    });

    it("returns NOT_FOUND when id doesn't exist (iOS reason fall-through)", async () => {
      const r = await handler.delete({ notificationId: "ghost" }, {});
      expect(r).toEqual({ success: false, error: "NOT_FOUND" });
    });

    it("rejects missing / non-string notificationId", async () => {
      expect(await handler.delete({}, {})).toEqual({
        success: false,
        error: "notificationId required",
      });
      expect(await handler.delete({ notificationId: 42 }, {})).toEqual({
        success: false,
        error: "notificationId required",
      });
    });
  });

  // ─── clearAll ───────────────────────────────────────────────────────

  describe("clearAll", () => {
    it("removes every row regardless of type / read / source", async () => {
      _seedRow(db, { id: "a", type: "app", read: false });
      _seedRow(db, { id: "b", type: "system", read: true });
      _seedRow(db, { id: "c", type: "alert", source: "pc" });

      const r = await handler.clearAll({}, {});
      expect(r.success).toBe(true);
      expect(r.clearedCount).toBe(3);

      const count = db
        .prepare("SELECT COUNT(*) as c FROM notification_history")
        .get().c;
      expect(count).toBe(0);
    });

    it("returns clearedCount=0 on empty table (still success)", async () => {
      const r = await handler.clearAll({}, {});
      expect(r).toEqual({ success: true, clearedCount: 0 });
    });
  });

  // ─── getUnreadCount ─────────────────────────────────────────────────

  describe("getUnreadCount", () => {
    it("counts only unread rows", async () => {
      _seedRow(db, { id: "a", read: false });
      _seedRow(db, { id: "b", read: false });
      _seedRow(db, { id: "c", read: true });

      const r = await handler.getUnreadCount({}, {});
      expect(r).toEqual({ success: true, count: 2 });
    });

    it("excludes expired rows from the count", async () => {
      const now = Date.now();
      _seedRow(db, { id: "fresh", read: false, expiresAt: now + 60_000 });
      _seedRow(db, { id: "stale", read: false, expiresAt: now - 60_000 });
      _seedRow(db, { id: "perpetual", read: false, expiresAt: null });

      const r = await handler.getUnreadCount({}, {});
      expect(r.count).toBe(2); // fresh + perpetual
    });

    it("returns count=0 (still success) on empty table", async () => {
      const r = await handler.getUnreadCount({}, {});
      expect(r).toEqual({ success: true, count: 0 });
    });
  });
});
