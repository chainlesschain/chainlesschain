/**
 * Sync conflict notifier — Phase 3c follow-up D10.
 *
 * 按设计文档 D10 决策：
 *
 *   - 单次 sync 内 `items_skipped > 0` 且 `lastRunStatus === "conflict"`
 *     → 系统通知（NotificationCenter / macOS / Win 通知中心）
 *   - 同一冲突批次重复 sync 不再推（前次 status 已是 "conflict"）
 *   - 再激活：一次 clean sync (status === "success") 后再出现 conflict → 再推
 *
 * 状态判定通过比较 prevStatus（本次 sync 前 cursor.lastRunStatus）与
 * result.status 实现 — 无需新 schema 列。
 *
 * Electron `Notification` 通过 DI seam (`_setNotificationFactoryForTest`)
 * 替换，单测不真发系统通知。
 */

"use strict";

const { logger } = require("../utils/logger.js");

/**
 * Default factory uses real Electron Notification. Tests inject a fake.
 * Lazy-require electron so non-electron environments (sql.js test) don't fail.
 */
function defaultNotificationFactory(opts) {
  // eslint-disable-next-line global-require
  const { Notification } = require("electron");
  return new Notification(opts);
}

let _notificationFactory = defaultNotificationFactory;

function _setNotificationFactoryForTest(factory) {
  _notificationFactory = factory;
}

function _resetNotificationFactoryForTest() {
  _notificationFactory = defaultNotificationFactory;
}

/**
 * Should we push a system notification for this sync result?
 * Pure decision function — exported for testing.
 *
 * @param {{result: object, prevStatus: string|null|undefined}} args
 * @returns {boolean}
 */
function shouldNotifyConflict({ result, prevStatus }) {
  if (!result) {
    return false;
  }
  if (result.status !== "conflict") {
    return false;
  }
  if (!Number.isFinite(result.skipped) || result.skipped <= 0) {
    return false;
  }
  // Suppress repeated conflict notifications: only emit on transition
  // (previous run was not conflict OR no previous run at all).
  if (prevStatus === "conflict") {
    return false;
  }
  return true;
}

/**
 * Push a system notification if D10 conditions are met.
 *
 * @param {object} args
 * @param {string} args.provider  — "WebDAV" / "OSS / S3" / any human name
 * @param {object} args.result    — engine result { status, skipped, pushed, deleted, ... }
 * @param {string|null|undefined} args.prevStatus  — cursor.lastRunStatus BEFORE this run
 * @returns {{notified: boolean, reason?: string}}
 */
function notifyIfNewConflict({ provider, result, prevStatus }) {
  if (!shouldNotifyConflict({ result, prevStatus })) {
    return {
      notified: false,
      reason:
        result?.status !== "conflict"
          ? "not-conflict"
          : !Number.isFinite(result?.skipped) || result?.skipped <= 0
            ? "no-skipped"
            : prevStatus === "conflict"
              ? "already-notified-prior-run"
              : "unknown",
    };
  }
  const providerLabel = String(provider || "Sync");
  const skipped = result.skipped;
  const body = `${skipped} 个文件被跳过，远端可能有手动修改。点击查看详情或运行" 清理远端孤儿文件"。`;
  try {
    const notification = _notificationFactory({
      title: `${providerLabel} 同步冲突`,
      body,
      silent: false,
      urgency: "normal",
    });
    if (notification && typeof notification.show === "function") {
      notification.show();
    }
    return { notified: true };
  } catch (err) {
    logger.warn(
      `[sync-conflict-notifier] Notification show failed (非致命): ${err?.message || err}`,
    );
    return { notified: false, reason: "notification-error" };
  }
}

module.exports = {
  notifyIfNewConflict,
  shouldNotifyConflict,
  _setNotificationFactoryForTest,
  _resetNotificationFactoryForTest,
};
