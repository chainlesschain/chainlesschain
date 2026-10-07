"use strict";

const { logger } = require("../utils/logger.js");
const path = require("node:path");
const GOAL_NOTICE_SCHEMA = "chainlesschain.goal-notice-ref/v1";
const SCAN_BATCH = 100;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function errorCode(error) {
  return typeof error?.code === "string" &&
    /^(NOTIFICATION|GOAL)_[A-Z_]+$/u.test(error.code)
    ? error.code
    : "NOTIFICATION_OPERATION_FAILED";
}
function notificationId(value) {
  if (!(
    (typeof value === "string" && value.length > 0 && value.length <= 256) ||
    (Number.isSafeInteger(value) && value >= 0)
  ))
    fail("NOTIFICATION_INVALID_REQUEST");
  return String(value);
}
function listOptions(value) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).some(
      (key) => !["limit", "offset", "isRead"].includes(key),
    )
  )
    fail("NOTIFICATION_INVALID_REQUEST");
  const { limit = 50, offset = 0, isRead } = value;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    (isRead !== undefined && typeof isRead !== "boolean")
  )
    fail("NOTIFICATION_INVALID_REQUEST");
  return { limit, offset, isRead };
}

/** Notifications use the authenticated host session, never a renderer DID.
 * Goal rows are projections: source authorization is required even to count or
 * acknowledge one. The projection reader must be synchronous so its source
 * check and the notification mutation share a native SQLite transaction. */
function registerNotificationIPC({
  database,
  electron = null,
  getActor = () =>
    require("../task/project-goal-auth-session").getProjectGoalActor(),
  getAuthGeneration = () =>
    require("../task/project-goal-auth-session").getProjectGoalAuthGeneration(),
  validateSender = (event) =>
    require("../ipc/ipc-sender-guard").validateSender(event),
  readGoalProjection = null,
} = {}) {
  const platform = electron || require("electron");
  if (platform.app?.once && platform.BrowserWindow?.getAllWindows) {
    const unsubscribe =
      require("../task/project-goal-auth-session").subscribeProjectGoalAuthChanges(
        () => {
          for (const window of platform.BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
              window.webContents.send("notification:invalidated", {});
            }
          }
        },
      );
    platform.app.once("will-quit", unsubscribe);
  }
  const currentDatabase = () =>
    typeof database?.getDatabase === "function"
      ? database.getDatabase()
      : (database?.db ?? database);

  function currentWindow(event) {
    if (validateSender(event)?.trusted !== true)
      fail("NOTIFICATION_UNTRUSTED_SENDER");
    const window = platform.BrowserWindow.fromWebContents(event?.sender);
    if (!window || window.isDestroyed() || event?.sender?.isDestroyed?.())
      fail("NOTIFICATION_WINDOW_UNAVAILABLE");
    return window;
  }
  function bind(event) {
    const window = currentWindow(event);
    const frame = event.senderFrame;
    const url = frame?.url;
    const db = currentDatabase();
    if (
      !db ||
      typeof db.prepare !== "function" ||
      typeof db.transaction !== "function" ||
      db.open === false
    )
      fail("NOTIFICATION_DATABASE_UNAVAILABLE");
    const actor = getActor();
    if (
      typeof actor !== "string" ||
      !actor.startsWith("did:") ||
      actor.length > 1024
    )
      fail("NOTIFICATION_IDENTITY_REQUIRED");
    const generation = getAuthGeneration();
    if (!Number.isSafeInteger(generation) || generation < 0)
      fail("NOTIFICATION_AUTHENTICATION_REQUIRED");
    const authorize = () => {
      if (
        currentWindow(event) !== window ||
        event.senderFrame !== frame ||
        frame?.url !== url
      )
        fail("NOTIFICATION_WINDOW_CHANGED");
      if (currentDatabase() !== db) fail("NOTIFICATION_DATABASE_CHANGED");
      if (getActor() !== actor || getAuthGeneration() !== generation)
        fail("NOTIFICATION_AUTHENTICATION_CHANGED");
      return actor;
    };
    authorize();
    let projectionService = null;
    if (
      !readGoalProjection &&
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cc_project_goal_notice_events'",
        )
        .get()
    ) {
      const {
        ProjectGoalNotificationService,
      } = require("@chainlesschain/session-core/project-goal-notifications");
      projectionService = new ProjectGoalNotificationService({
        db,
        getActor: authorize,
      });
    }
    return { db, actor, authorize, projectionService };
  }

  function authorizedRow(context, row) {
    context.authorize();
    if (!row || row.user_did !== context.actor) return null;
    let data = row.data;
    if (data !== null && data !== undefined && data !== "") {
      try {
        if (typeof data === "string") data = JSON.parse(data);
      } catch {
        // A damaged reference must never fall back to its stale display text.
        return null;
      }
    }
    if (data?.schema !== GOAL_NOTICE_SCHEMA) return row;
    let projected;
    if (readGoalProjection) {
      projected = readGoalProjection({
        id: row.id,
        db: context.db,
        getActor: context.authorize,
      });
    } else {
      if (!context.projectionService) {
        return null;
      }
      projected = context.db.inTransaction
        ? context.projectionService.readProjectionInTransaction(row.id)
        : context.projectionService.readProjection({ id: row.id });
    }
    context.authorize();
    if (projected?.then) fail("NOTIFICATION_SYNCHRONOUS_PROJECTION_REQUIRED");
    if (projected === null) return null;
    if (
      !projected ||
      projected.id !== row.id ||
      projected.user_did !== context.actor
    )
      fail("NOTIFICATION_PROJECTION_INVALID");
    return projected;
  }

  function transaction(event, operation, persist = false) {
    const context = bind(event);
    if (context.db.inTransaction) fail("NOTIFICATION_TRANSACTION_BUSY");
    const result = context.db
      .transaction(() => {
        context.authorize();
        const value = operation(context);
        context.authorize();
        return value;
      })
      .immediate();
    // Native SQLite persisted the transaction. Some wrappers additionally
    // maintain a compatible on-disk image or checkpoint.
    if (persist && typeof database?.saveToFile === "function") {
      context.authorize();
      database.saveToFile();
    }
    context.authorize();
    return result;
  }

  function forEachUnread(context, visit) {
    let afterId = null;
    while (true) {
      context.authorize();
      const rows = context.db
        .prepare(
          `SELECT * FROM notifications WHERE user_did = ? AND is_read = 0${afterId === null ? "" : " AND id > ?"} ORDER BY id LIMIT ?`,
        )
        .all(context.actor, ...(afterId === null ? [] : [afterId]), SCAN_BATCH);
      for (const row of rows) {
        const projected = authorizedRow(context, row);
        if (projected && projected.is_read === 0) visit(projected);
      }
      if (rows.length < SCAN_BATCH) break;
      afterId = rows.at(-1).id;
    }
  }

  platform.ipcMain.handle(
    "notification:get-all",
    async (event, options = {}) => {
      try {
        const { limit, offset, isRead } = listOptions(options);
        return transaction(event, (context) => {
          const rows = context.db
            .prepare(
              `SELECT * FROM notifications WHERE user_did = ?${isRead === undefined ? "" : " AND is_read = ?"} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
            )
            .all(
              context.actor,
              ...(isRead === undefined ? [] : [isRead ? 1 : 0]),
              limit,
              offset,
            );
          const notifications = rows
            .map((row) => authorizedRow(context, row))
            .filter(
              (row) =>
                row &&
                (isRead === undefined || row.is_read === (isRead ? 1 : 0)),
            );
          return { success: true, notifications };
        });
      } catch (error) {
        return { success: false, notifications: [], error: errorCode(error) };
      }
    },
  );
  platform.ipcMain.handle(
    "notification:get-unread-count",
    async (event, ...extra) => {
      try {
        if (extra.length) fail("NOTIFICATION_INVALID_REQUEST");
        return transaction(event, (context) => {
          let count = 0;
          forEachUnread(context, () => count++);
          return { success: true, count };
        });
      } catch (error) {
        return { success: false, count: 0, error: errorCode(error) };
      }
    },
  );
  platform.ipcMain.handle(
    "notification:get-goals",
    async (event, options = {}) => {
      try {
        const { limit, offset, isRead } = listOptions(options);
        return transaction(event, (context) => {
          const notifications = [];
          let after = null,
            skipped = 0;
          while (notifications.length < limit) {
            context.authorize();
            const rows = context.db
              .prepare(
                `SELECT * FROM notifications WHERE user_did=?${after ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
              )
              .all(
                context.actor,
                ...(after
                  ? [after.created_at, after.created_at, after.id]
                  : []),
                SCAN_BATCH,
              );
            for (const row of rows) {
              const projected = authorizedRow(context, row);
              if (!projected) continue;
              const data =
                typeof projected.data === "string"
                  ? JSON.parse(projected.data || "null")
                  : projected.data;
              if (
                data?.schema !== GOAL_NOTICE_SCHEMA ||
                (isRead !== undefined && projected.is_read !== (isRead ? 1 : 0))
              )
                continue;
              if (skipped++ < offset) continue;
              notifications.push(projected);
              if (notifications.length === limit) break;
            }
            if (rows.length < SCAN_BATCH) break;
            after = rows.at(-1);
          }
          return { success: true, notifications };
        });
      } catch (error) {
        return { success: false, notifications: [], error: errorCode(error) };
      }
    },
  );
  platform.ipcMain.handle(
    "notification:mark-read",
    async (event, id, ...extra) => {
      if (extra.length) fail("NOTIFICATION_INVALID_REQUEST");
      const target = notificationId(id);
      return transaction(
        event,
        (context) => {
          const row = context.db
            .prepare(
              "SELECT * FROM notifications WHERE id = ? AND user_did = ?",
            )
            .get(target, context.actor);
          if (!authorizedRow(context, row))
            fail("NOTIFICATION_NOT_FOUND_OR_DENIED");
          context.authorize();
          context.db
            .prepare(
              "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_did = ?",
            )
            .run(target, context.actor);
          return { success: true };
        },
        true,
      );
    },
  );
  platform.ipcMain.handle(
    "notification:mark-all-read",
    async (event, ...extra) => {
      if (extra.length) fail("NOTIFICATION_INVALID_REQUEST");
      return transaction(
        event,
        (context) => {
          forEachUnread(context, (row) => {
            context.authorize();
            context.db
              .prepare(
                "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_did = ?",
              )
              .run(row.id, context.actor);
          });
          return { success: true };
        },
        true,
      );
    },
  );
  platform.ipcMain.handle(
    "notification:open-goal",
    async (event, value, ...extra) => {
      try {
        if (extra.length) fail("NOTIFICATION_INVALID_REQUEST");
        const id = notificationId(value);
        return transaction(event, (context) => {
          const row = context.db
            .prepare("SELECT * FROM notifications WHERE id=? AND user_did=?")
            .get(id, context.actor);
          const projected = authorizedRow(context, row);
          if (!projected) fail("NOTIFICATION_NOT_FOUND_OR_DENIED");
          const data =
            typeof projected.data === "string"
              ? JSON.parse(projected.data)
              : projected.data;
          if (
            data?.schema !== GOAL_NOTICE_SCHEMA ||
            data.eventId !== projected.id ||
            ![
              data.goalId,
              data.projectId,
              data.storeId,
              data.sourceVersion,
            ].every((item) => typeof item === "string" && item.length > 0)
          )
            fail("NOTIFICATION_NOT_FOUND_OR_DENIED");
          return {
            success: true,
            target: {
              goalId: data.goalId,
              projectId: data.projectId,
              storeId: data.storeId,
              sourceVersion: data.sourceVersion,
            },
          };
        });
      } catch (error) {
        return { success: false, error: errorCode(error) };
      }
    },
  );
  platform.ipcMain.handle(
    "notification:send-desktop",
    async (event, title, body, ...extra) => {
      try {
        if (
          extra.length ||
          typeof title !== "string" ||
          !title.trim() ||
          title.length > 256 ||
          typeof body !== "string" ||
          body.length > 8192
        )
          fail("NOTIFICATION_INVALID_REQUEST");
        const context = bind(event);
        if (platform.Notification.isSupported()) {
          context.authorize();
          const notification = new platform.Notification({
            title,
            body,
            icon: path.join(__dirname, "../../resources/icon.png"),
          });
          context.authorize();
          notification.show();
        }
        context.authorize();
        return { success: true };
      } catch (error) {
        return { success: false, error: errorCode(error) };
      }
    },
  );
  logger.info(
    "[Notification IPC] Registered 7 authenticated notification handlers",
  );
}

module.exports = { registerNotificationIPC };
