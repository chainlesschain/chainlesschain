const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const LIST_SCHEMA = "chainlesschain.governed-knowledge-review-list/v1";
const LIST_KEYS = new Set([
  "schema",
  "tenantId",
  "deviceId",
  "items",
  "nextCursor",
  "total",
]);
const ITEM_KEYS = new Set([
  "conflictEnvelopeDigest",
  "knowledgeId",
  "scope",
  "scopeId",
  "action",
  "senderDeviceId",
  "localContentDigest",
  "remoteContentDigest",
  "remoteVectorClock",
  "committedAt",
]);

function validVectorClock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.length <= 64 &&
    entries.every(
      ([deviceId, revision]) =>
        ID.test(deviceId) && Number.isSafeInteger(revision) && revision >= 0,
    )
  );
}

export function validateGovernedKnowledgeConflictResponse(response) {
  const value = response?.result;
  if (
    response?.success !== true ||
    !value ||
    Object.keys(value).some((key) => !LIST_KEYS.has(key)) ||
    value.schema !== LIST_SCHEMA ||
    !ID.test(value.tenantId || "") ||
    !ID.test(value.deviceId || "") ||
    !Array.isArray(value.items) ||
    value.items.length > 256 ||
    !Number.isSafeInteger(value.total) ||
    value.total < value.items.length ||
    !(
      value.nextCursor === null ||
      (Number.isSafeInteger(value.nextCursor) && value.nextCursor >= 0)
    )
  ) {
    throw new Error(
      response?.error || "Knowledge conflict projection is invalid",
    );
  }
  for (const item of value.items) {
    if (
      !item ||
      typeof item !== "object" ||
      Object.keys(item).some((key) => !ITEM_KEYS.has(key)) ||
      !DIGEST.test(item.conflictEnvelopeDigest || "") ||
      !ID.test(item.knowledgeId || "") ||
      !["personal", "project", "team", "org"].includes(item.scope) ||
      !ID.test(item.scopeId || "") ||
      !["upsert", "tombstone", "revoke"].includes(item.action) ||
      !ID.test(item.senderDeviceId || "") ||
      !DIGEST.test(item.localContentDigest || "") ||
      !DIGEST.test(item.remoteContentDigest || "") ||
      !validVectorClock(item.remoteVectorClock) ||
      !Number.isFinite(Date.parse(item.committedAt || ""))
    ) {
      throw new Error("Knowledge conflict item is invalid or not redacted");
    }
  }
  return value;
}

export function buildGovernedKnowledgeMergeRequest(
  conflict,
  recordJson,
  reason,
) {
  if (!DIGEST.test(conflict?.conflictEnvelopeDigest || "")) {
    throw new Error("A valid conflict must be selected");
  }
  const rationale = typeof reason === "string" ? reason.trim() : "";
  if (!rationale || rationale.length > 2048) {
    throw new Error("A bounded human merge reason is required");
  }
  let mergedRecord;
  try {
    mergedRecord = JSON.parse(recordJson);
  } catch {
    throw new Error("Merged record must be valid JSON");
  }
  if (
    !mergedRecord ||
    typeof mergedRecord !== "object" ||
    Array.isArray(mergedRecord)
  ) {
    throw new Error("Merged record must be a JSON object");
  }
  return {
    conflictEnvelopeDigest: conflict.conflictEnvelopeDigest,
    mergedRecord,
    reason: rationale,
  };
}

export function shortKnowledgeDigest(value) {
  return DIGEST.test(value || "")
    ? `${value.slice(0, 15)}…${value.slice(-8)}`
    : "—";
}
