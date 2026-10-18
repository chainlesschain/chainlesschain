"use strict";

function exact(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...fields].sort().join()
  )
    throw new Error("GOAL_EVIDENCE_INVALID");
}
function text(value, max = 256) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\u0000-\u001f]/u.test(value)
  )
    throw new Error("GOAL_EVIDENCE_INVALID");
}
function revision(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min)
    throw new Error("GOAL_EVIDENCE_INVALID");
}
function validateGoalEvidenceProjection(value) {
  exact(value, ["risk", "receipts"]);
  const risk = value.risk,
    receipts = value.receipts;
  if (["not-recorded", "unavailable"].includes(risk?.state))
    exact(risk, ["state"]);
  else {
    exact(risk, [
      "state",
      "reviewId",
      "checkedAt",
      "goalRevision",
      "controlGeneration",
      "riskTaskCount",
      "reasonCodes",
      "history",
    ]);
    if (
      !["evaluated", "insufficient-data"].includes(risk.state) ||
      risk.history !== true
    )
      throw new Error("GOAL_EVIDENCE_INVALID");
    text(risk.reviewId);
    text(risk.checkedAt, 64);
    if (!Number.isFinite(Date.parse(risk.checkedAt)))
      throw new Error("GOAL_EVIDENCE_INVALID");
    revision(risk.goalRevision, 1);
    revision(risk.controlGeneration);
    if (risk.state === "evaluated") revision(risk.riskTaskCount);
    else if (risk.riskTaskCount !== null)
      throw new Error("GOAL_EVIDENCE_INVALID");
    if (
      !Array.isArray(risk.reasonCodes) ||
      risk.reasonCodes.length > 16 ||
      risk.reasonCodes.some(
        (code) => typeof code !== "string" || !/^[A-Z0-9_]{1,80}$/.test(code),
      )
    )
      throw new Error("GOAL_EVIDENCE_INVALID");
  }
  exact(receipts, ["state", "entries", "hasMore"]);
  if (
    !["recorded", "unavailable"].includes(receipts.state) ||
    typeof receipts.hasMore !== "boolean" ||
    !Array.isArray(receipts.entries) ||
    receipts.entries.length > 20 ||
    (receipts.state === "unavailable" &&
      (receipts.entries.length || receipts.hasMore)) ||
    new Set(receipts.entries.map((e) => e.id)).size !== receipts.entries.length
  )
    throw new Error("GOAL_EVIDENCE_INVALID");
  for (const item of receipts.entries) {
    exact(item, [
      "id",
      "status",
      "actionType",
      "goalRevision",
      "controlGeneration",
      "history",
    ]);
    text(item.id);
    if (
      !["unresolved", "succeeded", "denied", "cancelled"].includes(
        item.status,
      ) ||
      !["task.create", "task.update-description"].includes(item.actionType) ||
      item.history !== true
    )
      throw new Error("GOAL_EVIDENCE_INVALID");
    revision(item.goalRevision, 1);
    revision(item.controlGeneration);
  }
  return JSON.parse(JSON.stringify(value));
}
function formatGoalEvidenceProjection(raw) {
  const { risk, receipts } = validateGoalEvidenceProjection(raw);
  const riskSummary =
    risk.state === "unavailable"
      ? "Native risk-check storage is unavailable; risk is unknown."
      : risk.state === "not-recorded"
        ? "No risk check has been recorded for this goal; risk is unknown."
        : `Historical check ${risk.reviewId} at ${risk.checkedAt} (goal revision ${risk.goalRevision}, generation ${risk.controlGeneration}): ${risk.state}; risk task count ${risk.riskTaskCount === null ? "unknown" : risk.riskTaskCount}. ${risk.reasonCodes.join(", ")} This does not establish current risk or goal completion.`;
  const receiptSummary =
    receipts.state === "unavailable"
      ? "Native action-receipt storage is unavailable."
      : `Historical receipts: ${receipts.entries.length} in this page${receipts.hasMore ? "; older receipts exist" : ""}. Showing ${Math.min(5, receipts.entries.length)} IDs: ${receipts.entries
          .slice(0, 5)
          .map(
            (item) =>
              `${item.id}: ${item.status} (${item.actionType}, revision ${item.goalRevision}, generation ${item.controlGeneration})`,
          )
          .join(
            "; ",
          )}. Unresolved outcomes must be checked in the native host; an action receipt does not prove goal completion.`;
  if (riskSummary.length > 4096 || receiptSummary.length > 4096)
    throw new Error("GOAL_EVIDENCE_INVALID");
  return { riskSummary, receiptSummary };
}
module.exports = {
  validateGoalEvidenceProjection,
  formatGoalEvidenceProjection,
};
