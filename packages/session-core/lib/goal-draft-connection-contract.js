"use strict";
const {
  goalExtensionRef,
  normalizeGoalExtensionProposal,
} = require("./goal-extension-proposal-contract.js");
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const ACCESS_SCHEMA = "chainlesschain.goal-draft-access/v1";
const CONNECTION_SCHEMA = "chainlesschain.project-goal-connection/v3";
function fail() {
  throw Object.assign(new Error("GOAL_DRAFT_CONNECTION_INVALID"), {
    code: "GOAL_DRAFT_CONNECTION_INVALID",
  });
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}
function text(value, max = 256) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  )
    fail();
}
function hash(value) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
    fail();
}
function plugin(raw) {
  exact(raw, ["name", "scope", "version"]);
  text(raw.name);
  text(raw.version);
  if (!["user", "project", "local"].includes(raw.scope)) fail();
  return { ...raw };
}
function grantRef(raw) {
  exact(raw, ["id", "epoch"]);
  if (
    typeof raw.id !== "string" ||
    !/^goal-external-grant-[a-f0-9]{64}$/u.test(raw.id) ||
    !Number.isSafeInteger(raw.epoch) ||
    raw.epoch < 1
  )
    fail();
  return { ...raw };
}
function validateGoalDraftAccess(raw) {
  exact(raw, ["schema", "plugin", "declarationDigest"]);
  if (raw.schema !== ACCESS_SCHEMA) fail();
  const ref = plugin(raw.plugin);
  hash(raw.declarationDigest);
  return {
    schema: ACCESS_SCHEMA,
    plugin: ref,
    declarationDigest: raw.declarationDigest,
  };
}
function validateGoalDraftDescriptor(raw, now = Date.now()) {
  exact(raw, [
    "schema",
    "capability",
    "endpoint",
    "key",
    "goalRef",
    "expiresAt",
    "plugin",
    "declarationDigest",
    "grantRef",
  ]);
  if (
    raw.schema !== CONNECTION_SCHEMA ||
    raw.capability !== "goal.drafts" ||
    typeof raw.endpoint !== "string" ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/goal-drafts$/u.test(
      raw.endpoint,
    ) ||
    Number(new URL(raw.endpoint).port) > 65535 ||
    typeof raw.key !== "string" ||
    !/^([a-f0-9]{64})$/u.test(raw.key) ||
    !Number.isSafeInteger(raw.expiresAt) ||
    raw.expiresAt <= now ||
    raw.expiresAt > now + 905000
  )
    fail();
  const access = validateGoalDraftAccess({
    schema: ACCESS_SCHEMA,
    plugin: raw.plugin,
    declarationDigest: raw.declarationDigest,
  });
  return {
    ...raw,
    plugin: access.plugin,
    goalRef: goalExtensionRef(raw.goalRef),
    grantRef: grantRef(raw.grantRef),
  };
}
function validateGoalDraftSources(raw) {
  exact(raw, ["entries", "scannedCount", "unavailableCount", "nextCursor"]);
  if (
    !Array.isArray(raw.entries) ||
    raw.entries.length > 20 ||
    !Number.isSafeInteger(raw.scannedCount) ||
    raw.scannedCount < 0 ||
    raw.scannedCount > 20 ||
    !Number.isSafeInteger(raw.unavailableCount) ||
    raw.unavailableCount < 0 ||
    raw.scannedCount !== raw.entries.length + raw.unavailableCount ||
    (raw.nextCursor !== null &&
      (typeof raw.nextCursor !== "string" ||
        !/^goal-proposal-[a-f0-9]{64}$/u.test(raw.nextCursor) ||
        raw.scannedCount === 0))
  )
    fail();
  let previous = "";
  for (const row of raw.entries) {
    exact(row, ["id", "sourceTaskId", "reviewId", "reviewDigest"]);
    if (
      typeof row.id !== "string" ||
      !/^goal-proposal-[a-f0-9]{64}$/u.test(row.id) ||
      row.id <= previous
    )
      fail();
    previous = row.id;
    text(row.sourceTaskId);
    text(row.reviewId);
    hash(row.reviewDigest);
  }
  return JSON.parse(JSON.stringify(raw));
}
function validateGoalDraftProposal(raw) {
  const proposal = normalizeGoalExtensionProposal(raw);
  if (
    proposal.type !== "task.description.update" ||
    Buffer.byteLength(proposal.description, "utf8") > 8192 ||
    !/^goal-proposal-[a-f0-9]{64}$/u.test(proposal.sourceRef) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(
      proposal.description,
    )
  )
    fail();
  text(proposal.title);
  return JSON.parse(JSON.stringify(proposal));
}
function validateGoalDraftReceipt(raw) {
  exact(raw, ["state", "proposalId", "requestId", "inputDigest"]);
  text(raw.requestId, 128);
  hash(raw.inputDigest);
  if (
    !["saved", "not-found"].includes(raw.state) ||
    (raw.state === "not-found"
      ? raw.proposalId !== null
      : typeof raw.proposalId !== "string" ||
        !/^goal-extension-[a-f0-9]{64}$/u.test(raw.proposalId))
  )
    fail();
  return { ...raw };
}
const SUBMISSION_REFERENCE_SCHEMA =
  "chainlesschain.goal-draft-submission-ref/v1";
const MAX_SUBMISSION_REFERENCE_BYTES = 4096;
function createGoalDraftSubmissionReference(raw) {
  exact(raw, [
    "goalRef",
    "plugin",
    "declarationDigest",
    "grantRef",
    "requestId",
    "inputDigest",
  ]);
  const access = validateGoalDraftAccess({
    schema: ACCESS_SCHEMA,
    plugin: raw.plugin,
    declarationDigest: raw.declarationDigest,
  });
  text(raw.requestId, 128);
  hash(raw.inputDigest);
  const body = {
    schema: SUBMISSION_REFERENCE_SCHEMA,
    goalRef: goalExtensionRef(raw.goalRef),
    plugin: access.plugin,
    declarationDigest: access.declarationDigest,
    grantRef: grantRef(raw.grantRef),
    requestId: raw.requestId,
    inputDigest: raw.inputDigest,
  };
  const result = { ...body, contentDigest: digest(body) };
  if (
    Buffer.byteLength(JSON.stringify(result), "utf8") >
    MAX_SUBMISSION_REFERENCE_BYTES
  )
    fail();
  return JSON.parse(JSON.stringify(result));
}
function validateGoalDraftSubmissionReference(raw) {
  exact(raw, [
    "schema",
    "goalRef",
    "plugin",
    "declarationDigest",
    "grantRef",
    "requestId",
    "inputDigest",
    "contentDigest",
  ]);
  const result = createGoalDraftSubmissionReference(
    Object.fromEntries(
      [
        "goalRef",
        "plugin",
        "declarationDigest",
        "grantRef",
        "requestId",
        "inputDigest",
      ].map((key) => [key, raw[key]]),
    ),
  );
  if (
    raw.schema !== SUBMISSION_REFERENCE_SCHEMA ||
    raw.contentDigest !== result.contentDigest
  )
    fail();
  return result;
}
module.exports = {
  ACCESS_SCHEMA,
  CONNECTION_SCHEMA,
  validateGoalDraftAccess,
  validateGoalDraftDescriptor,
  validateGoalDraftSources,
  validateGoalDraftProposal,
  validateGoalDraftReceipt,
  goalDraftRequestDigest: (proposal) =>
    digest(validateGoalDraftProposal(proposal)),
  validateGoalDraftGrantRef: grantRef,
  SUBMISSION_REFERENCE_SCHEMA,
  MAX_SUBMISSION_REFERENCE_BYTES,
  createGoalDraftSubmissionReference,
  validateGoalDraftSubmissionReference,
};
