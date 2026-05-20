/**
 * `notification.*` WS handlers — Phase 3c.6 web-shell parity (2026-05-06).
 *
 * 暴露 6 个 topic 给 web-panel + cc CLI，对齐 V5/V6 桌面壳 `notification:*` IPC：
 *   notification.list              → SELECT * FROM notifications LIMIT/OFFSET
 *   notification.unread-count      → SELECT COUNT(*) WHERE is_read = 0
 *   notification.mark-read         → UPDATE … WHERE id = ?
 *   notification.mark-all-read     → UPDATE … (no WHERE)
 *   notification.send-desktop      → new Notification({title, body}).show()
 *   notification.send-mobile       → remoteGateway.handlers.notification.sendToMobile (#21 v1.3+)
 *
 * 为什么不复用 IPC handler：
 *   ipcMain.handle 绑死 Electron IPC 通道，web-shell 走 WS dispatcher。直接
 *   重写 SQL（同 sync-status-handlers）零依赖、最便宜。
 *
 * database 可能为 null（pre-bootstrap），各 handler 返回结构化错误而不抛，
 * 避免 ws-cli-loader 把 dispatcher trip 掉。
 */

const path = require("path");

function loadNotificationModule(options) {
  if (options.notificationModule) {
    return options.notificationModule;
  }
  // Lazy-require so unit tests don't pull in Electron.
  return require("electron").Notification;
}

function _getDb(database) {
  if (!database || !database.db) {
    return null;
  }
  return database.db;
}

function _persist(database) {
  // sql.js 后备需要 saveToFile() 落盘；SQLCipher 适配器自动持久化但调用无害。
  if (database && typeof database.saveToFile === "function") {
    try {
      database.saveToFile();
    } catch {
      /* ignore — write already landed in WAL */
    }
  }
}

function createNotificationListHandler({ database }) {
  return async function notificationListHandler(frame = {}) {
    const db = _getDb(database);
    if (!db) {
      return { success: true, notifications: [] };
    }
    try {
      const limit = Number.isFinite(Number(frame?.limit))
        ? Math.max(1, Math.min(500, Math.floor(Number(frame.limit))))
        : 50;
      const offset = Number.isFinite(Number(frame?.offset))
        ? Math.max(0, Math.floor(Number(frame.offset)))
        : 0;
      const isReadFilter =
        typeof frame?.isRead === "boolean" ? frame.isRead : undefined;

      let query = "SELECT * FROM notifications";
      const params = [];
      if (isReadFilter !== undefined) {
        query += " WHERE is_read = ?";
        params.push(isReadFilter ? 1 : 0);
      }
      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const notifications = db.prepare(query).all(...params);
      return { success: true, notifications: notifications || [] };
    } catch (err) {
      return {
        success: false,
        notifications: [],
        error: err?.message || String(err),
      };
    }
  };
}

function createNotificationUnreadCountHandler({ database }) {
  return async function notificationUnreadCountHandler() {
    const db = _getDb(database);
    if (!db) {
      return { success: true, count: 0 };
    }
    try {
      const row = db
        .prepare(
          "SELECT COUNT(*) as count FROM notifications WHERE is_read = 0",
        )
        .get();
      return { success: true, count: row?.count ?? 0 };
    } catch (err) {
      return { success: false, count: 0, error: err?.message || String(err) };
    }
  };
}

function createNotificationMarkReadHandler({ database }) {
  return async function notificationMarkReadHandler(frame = {}) {
    const db = _getDb(database);
    if (!db) {
      return { success: false, error: "数据库未初始化" };
    }
    const id = frame?.id;
    if (id === undefined || id === null || id === "") {
      return { success: false, error: "缺少 id" };
    }
    try {
      db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
      _persist(database);
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createNotificationMarkAllReadHandler({ database }) {
  return async function notificationMarkAllReadHandler() {
    const db = _getDb(database);
    if (!db) {
      return { success: false, error: "数据库未初始化" };
    }
    try {
      db.prepare("UPDATE notifications SET is_read = 1").run();
      _persist(database);
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createNotificationSendDesktopHandler(options = {}) {
  return async function notificationSendDesktopHandler(frame = {}) {
    const title =
      typeof frame?.title === "string" && frame.title.trim()
        ? frame.title
        : null;
    if (!title) {
      return { success: false, error: "缺少 title" };
    }
    const body = typeof frame?.body === "string" ? frame.body : "";
    try {
      const Notification = loadNotificationModule(options);
      if (!Notification || !Notification.isSupported?.()) {
        return { success: false, error: "桌面通知不可用" };
      }
      const iconPath =
        options.iconPath || path.join(__dirname, "../../../resources/icon.png");
      const n = new Notification({ title, body, icon: iconPath });
      n.show();
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createNotificationSendMobileHandler({ remoteGateway } = {}) {
  return async function notificationSendMobileHandler(frame = {}) {
    const title =
      typeof frame?.title === "string" && frame.title.trim()
        ? frame.title.trim()
        : null;
    if (!title) {
      return { success: false, error: "缺少 title" };
    }
    const body = typeof frame?.body === "string" ? frame.body : "";
    const target =
      typeof frame?.target === "string" && frame.target.trim()
        ? frame.target.trim()
        : null;
    if (!target) {
      return { success: false, error: "缺少 target (设备 DID)" };
    }
    const silent = frame?.silent === true || frame?.silenced === true;

    const notificationHandler = remoteGateway?.handlers?.notification;
    if (
      !notificationHandler ||
      typeof notificationHandler.sendToMobile !== "function"
    ) {
      return {
        success: false,
        error:
          "remote-gateway 不可用 (桌面尚未完成 P2P 初始化或 mobile-bridge 未绑)",
      };
    }

    // ws-bridge protocol uses frame.type as the topic name (e.g.
    // "notification.send-mobile"), so the notification-type semantic
    // (app/system/message/...) rides on frame.notificationType.
    const notificationType =
      typeof frame?.notificationType === "string" &&
      frame.notificationType.trim()
        ? frame.notificationType.trim()
        : "app";

    try {
      const result = await notificationHandler.sendToMobile(
        {
          title,
          body,
          targetDevices: [target],
          silent,
          urgency: silent ? "low" : "normal",
          type: notificationType,
        },
        { source: "ws-bridge:cli" },
      );
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  };
}

function createNotificationHandlers({ database, remoteGateway, ...rest } = {}) {
  return {
    "notification.list": createNotificationListHandler({ database }),
    "notification.unread-count": createNotificationUnreadCountHandler({
      database,
    }),
    "notification.mark-read": createNotificationMarkReadHandler({ database }),
    "notification.mark-all-read": createNotificationMarkAllReadHandler({
      database,
    }),
    "notification.send-desktop": createNotificationSendDesktopHandler(rest),
    "notification.send-mobile": createNotificationSendMobileHandler({
      remoteGateway,
    }),
  };
}

module.exports = {
  createNotificationHandlers,
  createNotificationListHandler,
  createNotificationUnreadCountHandler,
  createNotificationMarkReadHandler,
  createNotificationMarkAllReadHandler,
  createNotificationSendDesktopHandler,
  createNotificationSendMobileHandler,
};
