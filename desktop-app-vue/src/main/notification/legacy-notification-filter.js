"use strict";

// Legacy transports cannot project board notices against current source authority.
// Keep this exclusion in SQL, before pagination and inside mutation predicates.
const BOARD_NOTICE_PREFIX = "cc-board-mention:";
const BOARD_NOTICE_SCHEMA = "chainlesschain.board-notice-ref/v1";

function get(db, sql, params = []) {
  return typeof db.prepare === "function"
    ? db.prepare(sql).get(...params)
    : db.get(sql, params);
}

function hasLedger(db) {
  return Boolean(
    get(
      db,
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_board_notice_events'",
    ),
  );
}

function legacyNotificationPredicate(db) {
  const ledger = hasLedger(db)
    ? "AND NOT EXISTS (SELECT 1 FROM task_board_notice_events AS board_notice WHERE board_notice.id = notifications.id)"
    : "";
  // json_each checks every key, including duplicate/escaped schema keys. Invalid
  // legacy JSON remains readable unless its ID or authoritative ledger is protected.
  return `(notifications.id NOT GLOB '${BOARD_NOTICE_PREFIX}*'
    AND NOT EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(notifications.data)
        THEN notifications.data ELSE '{}' END) AS notice_ref
      WHERE (notice_ref.key = 'schema' AND notice_ref.value = '${BOARD_NOTICE_SCHEMA}')
        OR (notice_ref.key = 'eventId' AND notice_ref.value GLOB '${BOARD_NOTICE_PREFIX}*')
    ) ${ledger})`;
}

function isBoardNoticeReference(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  return Boolean(
    value &&
      typeof value === "object" &&
      (value.schema === BOARD_NOTICE_SCHEMA ||
        (typeof value.eventId === "string" &&
          value.eventId.startsWith(BOARD_NOTICE_PREFIX))),
  );
}

function isProtectedLegacyNotification(db, id, data) {
  if (
    (typeof id === "string" && id.startsWith(BOARD_NOTICE_PREFIX)) ||
    isBoardNoticeReference(data)
  ) {
    return true;
  }
  if (
    hasLedger(db) &&
    get(db, "SELECT 1 FROM task_board_notice_events WHERE id = ?", [id])
  ) {
    return true;
  }
  return Boolean(
    get(
      db,
      `SELECT 1 FROM notifications WHERE id = ? AND NOT ${legacyNotificationPredicate(db)}`,
      [id],
    ),
  );
}

module.exports = {
  BOARD_NOTICE_SCHEMA,
  BOARD_NOTICE_PREFIX,
  legacyNotificationPredicate,
  isProtectedLegacyNotification,
  isBoardNoticeReference,
  isProtectedBoardNotice: (db, row) =>
    isProtectedLegacyNotification(db, row.id, row.data),
};
