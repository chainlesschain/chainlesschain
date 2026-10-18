"use strict";

const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const {
  normalizeGoalExtensionProposal,
  goalExtensionRef,
  validateGoalExtensionIntentRef,
  goalExtensionIntentId,
} = require("./goal-extension-proposal-contract.js");
const DRAFT_BYTES = 48 * 1024,
  CONVERSION_BYTES = 8 * 1024;
const same = (a, b) => digest(a) === digest(b);
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function exact(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("invalid record");
}
function readExtensionDraft(db, id, actorDid, plugin, origin) {
  if (typeof id !== "string" || !/^goal-extension-[a-f0-9]{64}$/u.test(id))
    fail("GOAL_EXTENSION_INVALID_REQUEST");
  const row = db
    .prepare(
      `SELECT CASE WHEN length(CAST(record_json AS BLOB))<=${DRAFT_BYTES} THEN record_json ELSE NULL END AS body,
    content_digest,goal_id,plugin_key FROM cc_project_goal_extension_drafts WHERE id=? AND actor_did=?`,
    )
    .get(id, actorDid);
  if (!row) fail("GOAL_EXTENSION_NOT_FOUND_OR_DENIED");
  try {
    const record = JSON.parse(row.body);
    exact(record, [
      "schema",
      "id",
      "actorDid",
      "plugin",
      "admissionEpoch",
      "origin",
      "proposal",
      "source",
      "state",
      "createdAt",
      "inputDigest",
    ]);
    exact(record.plugin, ["name", "scope", "version"]);
    const proposal = normalizeGoalExtensionProposal(record.proposal);
    if (
      record.schema !== "chainlesschain.project-goal-extension-draft/v1" ||
      record.id !== id ||
      record.actorDid !== actorDid ||
      record.state !== "pending-confirmation" ||
      !["builtin-rule", "extension-suggestion", "user-edited"].includes(
        record.origin,
      ) ||
      (origin !== undefined && record.origin !== origin) ||
      (plugin !== undefined && !same(record.plugin, plugin)) ||
      row.plugin_key !== digest(record.plugin) ||
      row.goal_id !== proposal.goalRef.id ||
      digest(record) !== row.content_digest ||
      !Number.isSafeInteger(record.createdAt) ||
      record.createdAt < 0 ||
      typeof record.admissionEpoch !== "string" ||
      !record.admissionEpoch ||
      record.admissionEpoch.length > 256 ||
      record.inputDigest !== digest(proposal) ||
      id !==
        `goal-extension-${digest({ actorDid, plugin: record.plugin, goalRef: proposal.goalRef, requestId: proposal.requestId }).slice(7)}`
    )
      throw 0;
    return record;
  } catch {
    fail("GOAL_EXTENSION_RECORD_CORRUPT");
  }
}
function conversionHash(draftId, draftDigest) {
  return digest({ draftId, draftDigest }).slice(7);
}
function conversionRef(record) {
  return validateGoalExtensionIntentRef({
    draftId: record.draftId,
    conversionId: record.id,
    draftDigest: record.draftDigest,
    conversionDigest: digest(record),
  });
}
function createExtensionConversion(draft, createdAt) {
  const draftDigest = digest(draft),
    hash = conversionHash(draft.id, draftDigest);
  const record = {
    schema: "chainlesschain.goal-extension-conversion/v1",
    id: `goal-extension-conversion-${hash}`,
    draftId: draft.id,
    draftDigest,
    actorDid: draft.actorDid,
    plugin: draft.plugin,
    goalRef: draft.proposal.goalRef,
    source: draft.source,
    requestId: `extension-prepare-${hash}`,
    intentId: `goal-intent-extension-${hash}`,
    descriptionDigest: digest(draft.proposal.description),
    createdAt,
  };
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    Buffer.byteLength(JSON.stringify(record), "utf8") > CONVERSION_BYTES
  )
    fail("GOAL_EXTENSION_RECORD_LIMIT");
  return record;
}
function readExtensionConversion(db, id, actorDid) {
  const row = db
    .prepare(
      `SELECT draft_id, CASE WHEN length(CAST(record_json AS BLOB))<=${CONVERSION_BYTES} THEN record_json ELSE NULL END AS body,
    content_digest FROM cc_project_goal_extension_conversions WHERE id=? AND actor_did=?`,
    )
    .get(id, actorDid);
  if (!row) fail("GOAL_EXTENSION_CONVERSION_NOT_FOUND");
  try {
    const record = JSON.parse(row.body);
    exact(record, [
      "schema",
      "id",
      "draftId",
      "draftDigest",
      "actorDid",
      "plugin",
      "goalRef",
      "source",
      "requestId",
      "intentId",
      "descriptionDigest",
      "createdAt",
    ]);
    const hash = conversionHash(record.draftId, record.draftDigest);
    goalExtensionRef(record.goalRef);
    conversionRef(record);
    if (
      record.schema !== "chainlesschain.goal-extension-conversion/v1" ||
      record.id !== id ||
      record.actorDid !== actorDid ||
      record.draftId !== row.draft_id ||
      digest(record) !== row.content_digest ||
      record.id !== `goal-extension-conversion-${hash}` ||
      record.requestId !== `extension-prepare-${hash}` ||
      record.intentId !== `goal-intent-extension-${hash}` ||
      !/^sha256:[a-f0-9]{64}$/u.test(record.descriptionDigest) ||
      !Number.isSafeInteger(record.createdAt) ||
      record.createdAt < 0
    )
      throw 0;
    return record;
  } catch {
    fail("GOAL_EXTENSION_CONVERSION_CORRUPT");
  }
}
function assertConversionDraft(conversion, draft) {
  if (
    conversion.draftId !== draft.id ||
    conversion.draftDigest !== digest(draft) ||
    conversion.actorDid !== draft.actorDid ||
    !same(conversion.plugin, draft.plugin) ||
    !same(conversion.goalRef, draft.proposal.goalRef) ||
    !same(conversion.source, draft.source) ||
    conversion.descriptionDigest !== digest(draft.proposal.description)
  )
    fail("GOAL_EXTENSION_CONVERSION_CORRUPT");
}
/** Integrity only: historical receipt reads do not re-enable extension admission. */
function readExtensionIntentBinding({ db, intent, actor }) {
  if (!db.inTransaction) fail("GOAL_EXTENSION_TRANSACTION_REQUIRED");
  const ref = validateGoalExtensionIntentRef(intent.extensionRef);
  const conversion = readExtensionConversion(db, ref.conversionId, actor);
  const draft = readExtensionDraft(db, ref.draftId, actor, conversion.plugin);
  assertConversionDraft(conversion, draft);
  const input = {
    goalId: conversion.goalRef.id,
    proposalId: conversion.source.proposalId,
    expectedRevision: conversion.goalRef.revision,
    requestId: conversion.requestId,
    description: draft.proposal.description,
    extensionRef: ref,
  };
  if (
    !same(ref, conversionRef(conversion)) ||
    intent.id !== goalExtensionIntentId(ref) ||
    intent.id !== conversion.intentId ||
    intent.actorDid !== actor ||
    intent.requestId !== conversion.requestId ||
    intent.goalId !== conversion.goalRef.id ||
    intent.storeId !== conversion.goalRef.storeId ||
    intent.goalRevision !== conversion.goalRef.revision ||
    intent.controlGeneration !== conversion.goalRef.controlGeneration ||
    intent.proposalId !== conversion.source.proposalId ||
    intent.reviewId !== conversion.source.reviewId ||
    intent.reviewDigest !== conversion.source.reviewDigest ||
    intent.taskType !== null ||
    intent.description !== draft.proposal.description ||
    intent.inputDigest !== digest(input)
  )
    fail("GOAL_EXTENSION_CONVERSION_CORRUPT");
  return { conversion, draft };
}
module.exports = {
  readExtensionDraft,
  createExtensionConversion,
  readExtensionConversion,
  conversionRef,
  assertConversionDraft,
  readExtensionIntentBinding,
};
