"use strict";
const {
  digestBusinessObjectContent: digest,
} = require("./business-object-contract.js");
const {
  normalizeGoalExtensionProposal,
} = require("./goal-extension-proposal-contract.js");
const SCHEMA = "chainlesschain.goal-draft-request/v1";
const CREATE_SCHEMA = "chainlesschain.goal-task-create-request/v1";
const MAX_REQUEST_BYTES = 16 * 1024;
function fail() {
  throw Object.assign(new Error("GOAL_DRAFT_REQUEST_INVALID"), {
    code: "GOAL_DRAFT_REQUEST_INVALID",
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
function buildRequest(
  { declaredPlugin, declarationDigest, proposal },
  creation,
) {
  exact(declaredPlugin, ["name", "scope", "version"]);
  if (
    ![declaredPlugin.name, declaredPlugin.version].every(
      (value) =>
        typeof value === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,255}$/u.test(value),
    ) ||
    !["user", "project", "local"].includes(declaredPlugin.scope) ||
    typeof declarationDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(declarationDigest)
  )
    fail();
  proposal = normalizeGoalExtensionProposal(proposal);
  if (
    proposal.type !== (creation ? "task.create" : "task.description.update") ||
    Buffer.byteLength(proposal.description, "utf8") > 8192 ||
    !/^goal-proposal-[a-f0-9]{64}$/u.test(proposal.sourceRef) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(proposal.title) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(
      proposal.description,
    )
  )
    fail();
  const body = {
    schema: creation ? CREATE_SCHEMA : SCHEMA,
    declaredPlugin: { ...declaredPlugin },
    declarationDigest,
    proposal,
  };
  const request = { ...body, contentDigest: digest(body) };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REQUEST_BYTES)
    fail();
  return JSON.parse(JSON.stringify(request));
}
function createGoalDraftRequest(raw) {
  return buildRequest(raw, false);
}
function createGoalTaskCreateRequest(raw) {
  return buildRequest(raw, true);
}
function validateRequest(raw, creation) {
  exact(raw, [
    "schema",
    "declaredPlugin",
    "declarationDigest",
    "proposal",
    "contentDigest",
  ]);
  const result = buildRequest(raw, creation);
  if (
    raw.schema !== result.schema ||
    raw.contentDigest !== result.contentDigest
  )
    fail();
  return result;
}
function validateGoalDraftRequest(raw) {
  return validateRequest(raw, false);
}
function validateGoalTaskCreateRequest(raw) {
  return validateRequest(raw, true);
}
function validateGoalDraftImportRequest(raw) {
  return raw?.schema === CREATE_SCHEMA
    ? validateGoalTaskCreateRequest(raw)
    : validateGoalDraftRequest(raw);
}
module.exports = {
  SCHEMA,
  CREATE_SCHEMA,
  MAX_REQUEST_BYTES,
  createGoalDraftRequest,
  validateGoalDraftRequest,
  createGoalTaskCreateRequest,
  validateGoalTaskCreateRequest,
  validateGoalDraftImportRequest,
};
