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
function parseGoalEventCursor(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/u.test(token))
    throw new Error("GOAL_EVENT_CURSOR_INVALID");
  const bytes = Buffer.from(token, "base64url");
  if (bytes.toString("base64url") !== token)
    throw new Error("GOAL_EVENT_CURSOR_INVALID");
  const envelope = JSON.parse(bytes.toString("utf8"));
  exact(envelope, ["body", "signature"]);
  if (
    typeof envelope.body !== "string" ||
    !/^[a-f0-9]{64}$/u.test(envelope.signature)
  )
    throw new Error("GOAL_EVENT_CURSOR_INVALID");
  const value = JSON.parse(envelope.body);
  exact(value, ["epoch", "scope", "sequence", "digest"]);
  if (
    !/^[a-f0-9]{32}$/u.test(value.epoch) ||
    !/^[a-f0-9]{64}$/u.test(value.scope) ||
    !/^[a-f0-9]{64}$/u.test(value.digest)
  )
    throw new Error("GOAL_EVENT_CURSOR_INVALID");
  revision(value.sequence);
  return value;
}
function validateGoalEventHistoryPage(raw, expectedRef, after) {
  const { goalExtensionRef } = require("./goal-extension-proposal-contract.js");
  exact(raw, [
    "schema",
    "goalRef",
    "entries",
    "nextCursor",
    "hasMore",
    "retainedFrom",
    "highWatermark",
    "truncated",
  ]);
  const ref = goalExtensionRef(raw.goalRef);
  if (
    raw.schema !== "chainlesschain.goal-event-history/v1" ||
    JSON.stringify(ref) !== JSON.stringify(goalExtensionRef(expectedRef)) ||
    !Array.isArray(raw.entries) ||
    raw.entries.length > 20 ||
    typeof raw.hasMore !== "boolean" ||
    typeof raw.truncated !== "boolean" ||
    Buffer.byteLength(JSON.stringify(raw)) > 16384
  )
    throw new Error("GOAL_EVENT_HISTORY_INVALID");
  revision(raw.retainedFrom, 1);
  revision(raw.highWatermark);
  if (
    raw.retainedFrom > raw.highWatermark + 1 ||
    raw.highWatermark - raw.retainedFrom >= 1000
  )
    throw new Error("GOAL_EVENT_HISTORY_INVALID");
  const prior = after === undefined ? null : parseGoalEventCursor(after);
  let position = prior?.sequence ?? raw.retainedFrom - 1;
  if (position < raw.retainedFrom - 1 || position > raw.highWatermark)
    throw new Error("GOAL_EVENT_HISTORY_INVALID");
  for (const entry of raw.entries) {
    exact(entry, [
      "id",
      "sequence",
      "type",
      "sourceRef",
      "sourceId",
      "state",
      "actionType",
      "riskTaskCount",
      "recordedAt",
    ]);
    const source = goalExtensionRef(entry.sourceRef);
    if (
      !/^goal-event-[a-f0-9]{64}$/u.test(entry.id) ||
      source.id !== ref.id ||
      source.storeId !== ref.storeId ||
      source.revision > ref.revision ||
      source.controlGeneration > ref.controlGeneration ||
      entry.sequence !== position + 1 ||
      entry.sequence > raw.highWatermark
    )
      throw new Error("GOAL_EVENT_HISTORY_INVALID");
    text(entry.sourceId);
    text(entry.recordedAt, 64);
    if (!Number.isFinite(Date.parse(entry.recordedAt)))
      throw new Error("GOAL_EVENT_HISTORY_INVALID");
    if (entry.type === "risk.review.completed") {
      if (
        !["evaluated", "insufficient-data"].includes(entry.state) ||
        entry.actionType !== null ||
        (entry.state === "evaluated"
          ? !Number.isSafeInteger(entry.riskTaskCount) ||
            entry.riskTaskCount < 0
          : entry.riskTaskCount !== null)
      )
        throw new Error("GOAL_EVENT_HISTORY_INVALID");
    } else if (entry.type === "action.receipt.updated") {
      if (
        !["unresolved", "succeeded", "denied", "cancelled"].includes(
          entry.state,
        ) ||
        !["task.create", "task.update-description"].includes(
          entry.actionType,
        ) ||
        entry.riskTaskCount !== null
      )
        throw new Error("GOAL_EVENT_HISTORY_INVALID");
    } else throw new Error("GOAL_EVENT_HISTORY_INVALID");
    position = entry.sequence;
  }
  if (
    raw.hasMore !== position < raw.highWatermark ||
    (!raw.entries.length && raw.hasMore) ||
    raw.truncated !== (after === undefined && raw.retainedFrom > 1)
  )
    throw new Error("GOAL_EVENT_HISTORY_INVALID");
  if (raw.highWatermark === 0) {
    if (raw.nextCursor !== null || raw.entries.length || raw.retainedFrom !== 1)
      throw new Error("GOAL_EVENT_HISTORY_INVALID");
  } else {
    const next = parseGoalEventCursor(raw.nextCursor);
    if (
      next.sequence !== position ||
      (prior && (next.epoch !== prior.epoch || next.scope !== prior.scope))
    )
      throw new Error("GOAL_EVENT_HISTORY_INVALID");
  }
  return JSON.parse(JSON.stringify(raw));
}
module.exports = {
  validateGoalEvidenceProjection,
  formatGoalEvidenceProjection,
  parseGoalEventCursor,
  validateGoalEventHistoryPage,
};
