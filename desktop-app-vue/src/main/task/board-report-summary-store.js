"use strict";
const { createHash } = require("node:crypto");
const SOURCE_FIELDS = Object.freeze([
  "id",
  "org_id",
  "board_id",
  "report_type",
  "author_did",
  "author_name",
  "yesterday_work",
  "today_plan",
  "blockers",
  "notes",
  "report_date",
  "created_at",
]);
const CONTENT_FIELDS = Object.freeze([
  "yesterday_work",
  "today_plan",
  "blockers",
  "notes",
]);
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const sourceHash = (row) =>
  hash(SOURCE_FIELDS.map((key) => [key, row[key] ?? null]));
const versionHash = (row) =>
  hash([sourceHash(row), row.ai_summary ?? null, row.updated_at]);
function validScope(db, row) {
  return (
    row &&
    (!row.board_id ||
      db.prepare("SELECT org_id FROM task_boards WHERE id=?").get(row.board_id)
        ?.org_id === row.org_id)
  );
}
function currentSummary(db, row) {
  if (
    !validScope(db, row) ||
    typeof row.ai_summary !== "string" ||
    !row.ai_summary.trim()
  )
    return null;
  const runs = db
    .prepare(
      `SELECT 1 FROM task_report_summary_runs WHERE report_id=? AND org_id=?
    AND board_id IS ? AND status='succeeded' AND source_hash=? AND summary_hash=? LIMIT 1`,
    )
    .get(
      row.id,
      row.org_id,
      row.board_id,
      sourceHash(row),
      hash(row.ai_summary),
    );
  return runs ? row.ai_summary : null;
}
function projectRun(row) {
  if (!row) return undefined;
  return {
    requestId: row.request_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    sourceHash: row.source_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usage:
      row.prompt_tokens == null && row.completion_tokens == null
        ? null
        : {
            promptTokens: row.prompt_tokens,
            completionTokens: row.completion_tokens,
          },
  };
}
module.exports = {
  SOURCE_FIELDS,
  CONTENT_FIELDS,
  hash,
  sourceHash,
  versionHash,
  validScope,
  currentSummary,
  projectRun,
};
