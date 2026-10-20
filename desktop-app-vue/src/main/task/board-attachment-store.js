"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { TextDecoder } = require("node:util");
const PREFIX = "cc-board-attachment:";
const LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  taskBytes: 32 * 1024 * 1024,
  vaultBytes: 200 * 1024 * 1024,
  taskCount: 64,
  vaultCount: 1024,
  previewBytes: 64 * 1024,
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fail(code = "BOARD_ATTACHMENT_NOT_FOUND_OR_DENIED") {
  throw Object.assign(new Error(code), { code });
}
function safeName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 255 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in attachment names.
    /[\x00-\x1f\x7f/\\<>:"|?*]/u.test(name) ||
    name === "." ||
    name === ".." ||
    /[. ]$/u.test(name)
  )
    fail("BOARD_ATTACHMENT_INVALID_FILE");
  return name;
}
function source(db, taskId) {
  const row = db
    .prepare(
      "SELECT t.board_id,b.org_id FROM team_tasks t JOIN task_boards b ON b.id=t.board_id WHERE t.id=?",
    )
    .get(taskId);
  if (!row || db.prepare("SELECT 1 FROM project_tasks WHERE id=?").get(taskId))
    fail();
  return row;
}
function foreignKeys(db) {
  if (db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1)
    fail("BOARD_ATTACHMENT_STORAGE_UNAVAILABLE");
}
function managedRow(db, attachmentId, bytes = false) {
  const row = db
    .prepare(
      `SELECT a.*,p.board_id AS frozen_board,p.org_id AS frozen_org,
    p.task_id AS frozen_task,p.uploader_did AS frozen_uploader,p.file_name AS frozen_name,
    p.created_at AS frozen_time,length(p.content) AS actual_size,p.sha256
    FROM task_attachments a JOIN task_board_attachment_payloads p ON p.attachment_id=a.id WHERE a.id=?`,
    )
    .get(attachmentId);
  if (!row) fail();
  const current = source(db, row.task_id);
  if (
    row.file_path !== PREFIX + row.id ||
    row.task_id !== row.frozen_task ||
    current.board_id !== row.frozen_board ||
    current.org_id !== row.frozen_org ||
    row.uploader_did !== row.frozen_uploader ||
    row.file_name !== row.frozen_name ||
    row.created_at !== row.frozen_time ||
    row.file_size !== row.actual_size ||
    row.actual_size < 0 ||
    row.actual_size > LIMITS.fileBytes ||
    row.mime_type !== "application/octet-stream"
  )
    fail();
  safeName(row.file_name);
  if (bytes) {
    row.bytes = db
      .prepare(
        "SELECT content FROM task_board_attachment_payloads WHERE attachment_id=?",
      )
      .get(attachmentId)?.content;
    if (
      !(row.bytes instanceof Uint8Array) ||
      row.bytes.length !== row.actual_size ||
      digest(row.bytes) !== row.sha256
    )
      fail("BOARD_ATTACHMENT_CONTENT_DAMAGED");
  }
  return row;
}
function summary(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: "application/octet-stream",
    uploaderDid: row.uploader_did,
    createdAt: row.created_at,
  };
}
class BoardAttachmentStore {
  constructor(database) {
    this.database = database;
  }
  uploadAttachmentSync(taskId, payload, actor) {
    const db = this.database.getDatabase();
    foreignKeys(db);
    if (!payload || !Buffer.isBuffer(payload.bytes))
      fail("BOARD_ATTACHMENT_NATIVE_PICKER_REQUIRED");
    const { bytes } = payload,
      fileName = safeName(payload.fileName);
    if (bytes.length > LIMITS.fileBytes) fail("BOARD_ATTACHMENT_FILE_LIMIT");
    const scope = source(db, taskId);
    const usage = db
      .prepare(
        `SELECT COUNT(*) AS count,COALESCE(SUM(length(content)),0) AS bytes,
      COALESCE(SUM(CASE WHEN task_id=? THEN length(content) ELSE 0 END),0) AS task_bytes,
      COALESCE(SUM(CASE WHEN task_id=? THEN 1 ELSE 0 END),0) AS task_count
      FROM task_board_attachment_payloads`,
      )
      .get(taskId, taskId);
    if (
      usage.count >= LIMITS.vaultCount ||
      usage.task_count >= LIMITS.taskCount ||
      usage.bytes + bytes.length > LIMITS.vaultBytes ||
      usage.task_bytes + bytes.length > LIMITS.taskBytes
    )
      fail("BOARD_ATTACHMENT_QUOTA_EXCEEDED");
    const id = randomUUID(),
      now = Date.now(),
      sha256 = digest(bytes);
    db.prepare(
      `INSERT INTO task_attachments (id,task_id,file_name,file_path,file_size,mime_type,uploader_did,created_at)
      VALUES (?,?,?,?,?,'application/octet-stream',?,?)`,
    ).run(id, taskId, fileName, PREFIX + id, bytes.length, actor, now);
    db.prepare(
      `INSERT INTO task_board_attachment_payloads
      (attachment_id,task_id,board_id,org_id,uploader_did,file_name,content,sha256,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      taskId,
      scope.board_id,
      scope.org_id,
      actor,
      fileName,
      bytes,
      sha256,
      now,
    );
    const activityId = this.activity(
      db,
      taskId,
      actor,
      "attachment_uploaded",
      id,
      bytes.length,
    );
    managedRow(db, id, true);
    return { success: true, attachmentId: id, activityId };
  }
  deleteAttachmentSync(id, actor) {
    const db = this.database.getDatabase();
    foreignKeys(db);
    const row = managedRow(db, id);
    db.prepare("DELETE FROM task_attachments WHERE id=?").run(id);
    if (
      db
        .prepare(
          "SELECT 1 FROM task_board_attachment_payloads WHERE attachment_id=?",
        )
        .get(id)
    )
      fail();
    const activityId = this.activity(
      db,
      row.task_id,
      actor,
      "attachment_deleted",
      id,
      row.file_size,
    );
    const current = source(db, row.task_id);
    if (
      current.board_id !== row.frozen_board ||
      current.org_id !== row.frozen_org ||
      db.prepare("SELECT 1 FROM task_attachments WHERE id=?").get(id)
    )
      fail();
    return { success: true, attachmentId: id, activityId };
  }
  activity(db, taskId, actor, action, id, size) {
    const activityId = randomUUID();
    db.prepare(
      `INSERT INTO task_activity_log (id,task_id,actor_did,action,metadata,created_at)
      VALUES (?,?,?,?,?,?)`,
    ).run(
      activityId,
      taskId,
      actor,
      action,
      JSON.stringify({ attachmentId: id, fileSize: size }),
      Date.now(),
    );
    return activityId;
  }
  list(taskId) {
    const db = this.database.getDatabase();
    source(db, taskId);
    const rows = db
      .prepare(
        `SELECT a.id FROM task_attachments a JOIN task_board_attachment_payloads p
      ON p.attachment_id=a.id WHERE a.task_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT ?`,
      )
      .all(taskId, LIMITS.taskCount + 1);
    if (rows.length > LIMITS.taskCount) fail("BOARD_ATTACHMENT_QUOTA_EXCEEDED");
    return {
      success: true,
      attachments: rows.map((r) => summary(managedRow(db, r.id))),
    };
  }
  preview(id) {
    const row = managedRow(this.database.getDatabase(), id, true);
    const bytes = Buffer.from(row.bytes);
    const preview = { kind: "download", base64: bytes.toString("base64") };
    if (
      bytes.length <= LIMITS.previewBytes &&
      /\.(txt|md|csv|json|log)$/iu.test(row.file_name)
    ) {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        // eslint-disable-next-line no-control-regex -- Keep binary control characters out of text previews.
        if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) {
          preview.kind = "text";
          preview.text = text;
        }
      } catch {
        /* Binary/invalid UTF-8 remains explicit download only. */
      }
    }
    return { success: true, attachment: summary(row), preview };
  }
}
module.exports = {
  BoardAttachmentStore,
  LIMITS,
  PREFIX,
  safeName,
  digest,
  managedRow,
  foreignKeys,
};
