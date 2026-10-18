"use strict";
const C = require("./board-task-update-contract");
const { fail } = require("./board-action-storage");
const { createBusinessObjectRef } = require("@chainlesschain/session-core/business-object-contract");

const LIMITS = Object.freeze({ count: 500, bytes: 65536, name: 1024, color: 128 });
const TRIGGERS = Object.freeze({
  trg_board_label_insert: `CREATE TRIGGER trg_board_label_insert AFTER INSERT ON task_labels BEGIN
    INSERT INTO task_board_label_revisions(label_id,revision) VALUES(NEW.id,1) ON CONFLICT(label_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_label_update: `CREATE TRIGGER trg_board_label_update AFTER UPDATE ON task_labels BEGIN
    INSERT INTO task_board_label_revisions(label_id,revision) VALUES(OLD.id,1) ON CONFLICT(label_id) DO UPDATE SET revision=revision+1;
    INSERT INTO task_board_label_revisions(label_id,revision) SELECT NEW.id,1 WHERE NEW.id<>OLD.id ON CONFLICT(label_id) DO UPDATE SET revision=revision+1; END`,
  trg_board_label_delete: `CREATE TRIGGER trg_board_label_delete AFTER DELETE ON task_labels BEGIN
    INSERT INTO task_board_label_revisions(label_id,revision) VALUES(OLD.id,1) ON CONFLICT(label_id) DO UPDATE SET revision=revision+1; END`,
});
const text = (value, max) => typeof value === "string" && Buffer.byteLength(value, "utf8") <= max;
const canonical = (sql) => sql.replace(/\bIF\s+NOT\s+EXISTS\b/giu, "").replace(/\s+/gu, "").toLowerCase();
function schema(db) {
  const tables = "'task_labels','task_board_label_revisions'";
  if (db.prepare(`SELECT 1 FROM sqlite_temp_master WHERE type='trigger' AND tbl_name IN (${tables}) LIMIT 1`).get())
    fail("BOARD_ACTION_UNEXPECTED_TRIGGER");
  const rows = db.prepare(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${tables})`).all();
  if (rows.some((row) => !Object.hasOwn(TRIGGERS, row.name))) fail("BOARD_ACTION_UNEXPECTED_TRIGGER");
  if (rows.length !== 3 || rows.some((row) => canonical(row.sql) !== canonical(TRIGGERS[row.name])))
    fail("BOARD_ACTION_REVISION_UNAVAILABLE");
}
function selected(task) {
  let ids;
  try {
    ids = task.labels === null ? [] : JSON.parse(task.labels);
    if (!Array.isArray(ids) || ids.length > LIMITS.count || new Set(ids).size !== ids.length) throw new Error();
    ids.forEach(C.id);
  } catch { fail("BOARD_ACTION_LABEL_SOURCE_INVALID"); }
  return ids;
}
function project(row) {
  try { C.id(row.id); } catch { fail("BOARD_ACTION_LABEL_SOURCE_INVALID"); }
  if (!text(row.name, LIMITS.name) || !row.name.trim() || (row.color !== null && !text(row.color, LIMITS.color)))
    fail("BOARD_ACTION_LABEL_SOURCE_INVALID");
  return { id: row.id, name: row.name, color: row.color };
}
function catalog(db, source) {
  schema(db);
  const size = db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(id AS BLOB))+length(CAST(name AS BLOB))+COALESCE(length(CAST(color AS BLOB)),0)),0) AS bytes FROM task_labels WHERE org_id=?").get(source.board.org_id);
  if (size.count > LIMITS.count || size.bytes > LIMITS.bytes) fail("BOARD_ACTION_LABEL_SOURCE_LIMIT");
  const labels = db.prepare("SELECT id,name,color FROM task_labels WHERE org_id=? ORDER BY id").all(source.board.org_id).map(project);
  const selectedLabelIds = selected(source.task);
  if (selectedLabelIds.some((id) => !labels.some((label) => label.id === id))) fail("BOARD_WRITE_SCOPE_CONFLICT");
  return { labels, selectedLabelIds };
}
function snapshot(db, taskId, labelId) {
  schema(db);
  C.id(labelId);
  const source = C.snapshot(db, taskId), ids = selected(source.task);
  const boundIds = [...new Set([...ids, labelId])].sort();
  if (boundIds.length > LIMITS.count) fail("BOARD_ACTION_LABEL_SOURCE_LIMIT");
  const where = boundIds.map(() => "?").join(",");
  const size = db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(id AS BLOB))+length(CAST(org_id AS BLOB))+length(CAST(name AS BLOB))+COALESCE(length(CAST(color AS BLOB)),0)+COALESCE(length(CAST(description AS BLOB)),0)+length(CAST(created_at AS BLOB))),0) AS bytes FROM task_labels WHERE id IN (${where})`).get(...boundIds);
  if (size.count !== boundIds.length) fail("BOARD_WRITE_SCOPE_CONFLICT");
  if (size.bytes > LIMITS.bytes) fail("BOARD_ACTION_LABEL_SOURCE_LIMIT");
  const labels = db.prepare(`SELECT l.id,l.org_id,l.name,l.color,l.description,l.created_at,r.revision FROM task_labels l LEFT JOIN task_board_label_revisions r ON r.label_id=l.id WHERE l.id IN (${where}) ORDER BY l.id`).all(...boundIds);
  for (const row of labels) {
    project(row);
    if (row.org_id !== source.board.org_id) fail("BOARD_WRITE_SCOPE_CONFLICT");
    if (!Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isSafeInteger(row.created_at) || row.created_at < 0 || (row.description !== null && !text(row.description, 8192)))
      fail("BOARD_ACTION_LABEL_SOURCE_INVALID");
  }
  return {
    ...source,
    labels,
    label: project(labels.find((label) => label.id === labelId)),
    ref: createBusinessObjectRef({ ...source.ref, version: C.digest({ taskVersion: source.ref.version, labels }) }),
  };
}
module.exports = { LIMITS, TRIGGERS, schema, selected, project, catalog, snapshot };
