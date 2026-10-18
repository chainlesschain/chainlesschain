"use strict";

const {
  BOARD_NOTICE_SCHEMA,
  BOARD_NOTICE_PREFIX,
} = require("../notification/legacy-notification-filter");

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

// Caller owns a synchronous SQLite transaction and an authenticated actor check.
// Every projection is reconstructed from the event and its current source scope.
function readBoardNoticeProjection({ db, id, getActor }) {
  const actor = getActor();
  const row = db
    .prepare("SELECT * FROM notifications WHERE id=? AND user_did=?")
    .get(id, actor);
  if (!row || !id.startsWith(BOARD_NOTICE_PREFIX)) return null;
  const exists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_board_notice_events'",
    )
    .get();
  if (!exists) return null;
  const event = db
    .prepare(
      `SELECT e.*,t.board_id AS current_board,b.org_id AS current_org,
    a.task_id AS activity_task,a.actor_did AS activity_actor,a.action,a.metadata,
    a.created_at AS activity_time
    FROM task_board_notice_events e JOIN team_tasks t ON t.id=e.task_id
    JOIN task_boards b ON b.id=t.board_id JOIN task_activity_log a ON a.id=e.activity_id
    WHERE e.id=? AND e.recipient_did=?`,
    )
    .get(id, actor);
  if (
    !event ||
    event.current_board !== event.board_id ||
    event.current_org !== event.org_id ||
    event.activity_task !== event.task_id ||
    event.activity_actor !== event.actor_did ||
    event.action !== "task_mentioned" ||
    event.activity_time !== event.created_at ||
    row.created_at !== event.created_at ||
    row.type !== "comment" ||
    ![0, 1].includes(row.is_read)
  )
    return null;
  let reference, metadata;
  try {
    reference = JSON.parse(row.data);
    metadata = JSON.parse(event.metadata);
  } catch {
    return null;
  }
  if (
    !exactKeys(reference, ["schema", "eventId"]) ||
    reference.schema !== BOARD_NOTICE_SCHEMA ||
    reference.eventId !== id ||
    !exactKeys(metadata, ["recipientDid", "notificationId"]) ||
    metadata.recipientDid !== actor ||
    metadata.notificationId !== id
  )
    return null;
  if (
    !db
      .prepare(
        `SELECT 1 FROM organization_info o JOIN organization_members m ON m.org_id=o.org_id
    WHERE o.org_id=? AND m.member_did=? AND m.status='active'`,
      )
      .get(event.org_id, actor)
  )
    return null;
  // The task detail route gives canonical tasks precedence. Never return a link
  // that could resolve to an unrelated canonical task with a colliding ID.
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_tasks'",
      )
      .get() &&
    db.prepare("SELECT 1 FROM project_tasks WHERE id=?").get(event.task_id)
  )
    return null;
  if (getActor() !== actor)
    throw Object.assign(new Error("NOTIFICATION_AUTHENTICATION_CHANGED"), {
      code: "NOTIFICATION_AUTHENTICATION_CHANGED",
    });
  return {
    id,
    user_did: actor,
    type: "comment",
    title: "Task mention",
    content: null,
    data: JSON.stringify({
      schema: BOARD_NOTICE_SCHEMA,
      eventId: id,
      taskId: event.task_id,
      boardId: event.board_id,
      orgId: event.org_id,
    }),
    is_read: row.is_read,
    created_at: event.created_at,
  };
}

module.exports = {
  BOARD_NOTICE_SCHEMA,
  BOARD_NOTICE_PREFIX,
  readBoardNoticeProjection,
};
