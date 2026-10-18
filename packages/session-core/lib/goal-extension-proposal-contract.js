"use strict";

const GOAL_EXTENSION_ACTION_MAP = Object.freeze({
  "task.description.update": "task.update-description",
  "task.create": "task.create",
});
function goalExtensionRef(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        !["id", "storeId", "revision", "controlGeneration"].includes(key),
    ) ||
    ![value.id, value.storeId].every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
    ) ||
    ![value.revision, value.controlGeneration].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    )
  )
    throw new Error("a versioned authoritative goal reference is required");
  return Object.freeze({
    id: value.id,
    storeId: value.storeId,
    revision: value.revision,
    controlGeneration: value.controlGeneration,
  });
}
function normalizeGoalExtensionProposal(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some(
      (key) =>
        ![
          "type",
          "goalRef",
          "sourceRef",
          "requestId",
          "title",
          "description",
        ].includes(key),
    )
  )
    throw new Error("unsupported goal extension proposal fields");
  if (!Object.hasOwn(GOAL_EXTENSION_ACTION_MAP, raw.type))
    throw new Error("unsupported goal extension proposal type");
  const goalRef = goalExtensionRef(raw.goalRef);
  for (const [key, max] of [
    ["sourceRef", 256],
    ["requestId", 128],
    ["title", 256],
    ["description", 8192],
  ]) {
    if (
      typeof raw[key] !== "string" ||
      !raw[key].trim() ||
      raw[key].length > max
    )
      throw new Error(`invalid proposal ${key}`);
  }
  return Object.freeze({
    type: raw.type,
    goalRef,
    sourceRef: raw.sourceRef,
    requestId: raw.requestId,
    title: raw.title,
    description: raw.description,
  });
}
function validateGoalExtensionIntentRef(value) {
  const fields = ["draftId", "conversionId", "draftDigest", "conversionDigest"];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key)) ||
    typeof value.draftId !== "string" ||
    !/^goal-extension-[a-f0-9]{64}$/u.test(value.draftId) ||
    typeof value.conversionId !== "string" ||
    !/^goal-extension-conversion-[a-f0-9]{64}$/u.test(value.conversionId) ||
    ![value.draftDigest, value.conversionDigest].every(
      (v) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/u.test(v),
    )
  )
    throw new Error("invalid goal extension intent reference");
  return Object.freeze(
    Object.fromEntries(fields.map((key) => [key, value[key]])),
  );
}
function goalExtensionIntentId(ref) {
  return `goal-intent-extension-${validateGoalExtensionIntentRef(ref).conversionId.slice("goal-extension-conversion-".length)}`;
}
module.exports = {
  validateGoalExtensionIntentRef,
  goalExtensionIntentId,
  GOAL_EXTENSION_ACTION_MAP,
  goalExtensionRef,
  normalizeGoalExtensionProposal,
};
