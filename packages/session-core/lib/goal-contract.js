"use strict";

/** Pure, bounded goal records. Valid records describe intent, never authority. */
const { randomUUID } = require("node:crypto");
const {
  normalizeGoalNotificationPolicy,
} = require("./goal-notification-policy.js");
const {
  digestBusinessObjectContent,
  validateBusinessObjectRef,
} = require("./business-object-contract.js");

const GOAL_SCHEMA = "chainlesschain.goal/v1";
const GOAL_SCHEMA_VERSION = 1;
const MAX_GOAL_RECORD_BYTES = 65536;
const GOAL_STATUSES = Object.freeze(["active", "paused", "done", "abandoned"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;
const MUTABLE_FIELDS = Object.freeze([
  "title",
  "objective",
  "status",
  "acceptanceCriteria",
  "budgetPolicy",
  "expiresAt",
  "nextCheckAt",
  "triggerRefs",
  "allowedActionTypes",
  "authorizationRefs",
  "notificationPolicy",
  "memoryRefs",
]);
const FIELDS = [
  "schema",
  "schemaVersion",
  "id",
  "storeId",
  "revision",
  "controlGeneration",
  "ownerRef",
  "projectRef",
  "title",
  "objective",
  "status",
  "progress",
  "keyResults",
  "linkedSessions",
  "notes",
  "drift",
  "createdAt",
  "updatedAt",
  "acceptanceCriteria",
  "budgetPolicy",
  "expiresAt",
  "nextCheckAt",
  "triggerRefs",
  "allowedActionTypes",
  "authorizationRefs",
  "notificationPolicy",
  "memoryRefs",
  "waitingReason",
  "executionState",
  "completion",
];

function goalError(code, message = code) {
  return Object.assign(new Error(message), { code });
}
function fail(code) {
  throw goalError(code);
}
function copy(value) {
  try {
    // Reject accessors, proxies, cycles, non-JSON values and oversized trees.
    digestBusinessObjectContent(value);
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_GOAL_RECORD_BYTES)
      fail("GOAL_INVALID_JSON");
    return JSON.parse(serialized);
  } catch {
    fail("GOAL_INVALID_JSON");
  }
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function identifier(value) {
  if (typeof value !== "string" || !ID.test(value)) fail("GOAL_INVALID_ID");
  return value;
}
function text(value, maximum, empty = false) {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    Buffer.byteLength(value, "utf8") > maximum
  )
    fail("GOAL_INVALID_TEXT");
  return value;
}
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum)
    fail("GOAL_INVALID_NUMBER");
  return value;
}
function timestamp(value, nullable = false) {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail("GOAL_INVALID_TIME");
  return value;
}
function fields(value, names) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).some((key) => !names.includes(key))
  )
    fail("GOAL_INVALID_FIELDS");
}
function array(value, maximum = 100) {
  if (!Array.isArray(value) || value.length > maximum)
    fail("GOAL_INVALID_ARRAY");
  return value;
}
function refs(value) {
  for (const ref of array(value)) {
    fields(ref, ["kind", "id", "version"]);
    identifier(ref.kind);
    identifier(ref.id);
    if (ref.version !== undefined && ref.version !== null)
      text(ref.version, 256);
  }
  return value;
}
function budget(value) {
  fields(value, ["maxRuns", "maxTokens", "maxTimeMs", "maxCostUsd"]);
  for (const key of ["maxRuns", "maxTokens", "maxTimeMs"]) {
    if (value[key] !== null) integer(value[key], 1);
  }
  if (
    value.maxCostUsd !== null &&
    (typeof value.maxCostUsd !== "number" ||
      !Number.isFinite(value.maxCostUsd) ||
      value.maxCostUsd <= 0)
  )
    fail("GOAL_INVALID_BUDGET");
}
function goalDefinitionDigest(goal) {
  return digestBusinessObjectContent(
    Object.fromEntries(
      [
        "id",
        "storeId",
        "ownerRef",
        "projectRef",
        "objective",
        "acceptanceCriteria",
        "allowedActionTypes",
        "authorizationRefs",
        "budgetPolicy",
        "expiresAt",
        "triggerRefs",
        "controlGeneration",
      ].map((key) => [key, goal[key]]),
    ),
  );
}
function validateGoalRecord(input) {
  const value = copy(input);
  fields(value, FIELDS);
  if (
    FIELDS.some((key) => !Object.hasOwn(value, key)) ||
    value.schema !== GOAL_SCHEMA ||
    value.schemaVersion !== GOAL_SCHEMA_VERSION
  )
    fail("GOAL_UNSUPPORTED_SCHEMA");
  identifier(value.id);
  identifier(value.storeId);
  integer(value.revision, 1);
  integer(value.controlGeneration);
  if (value.ownerRef !== null) identifier(value.ownerRef);
  if (value.projectRef !== null) {
    const ref = validateBusinessObjectRef(value.projectRef);
    if (
      ref.type !== "Project" ||
      !(
        (ref.scope.kind === "personal" && ref.scope.id === value.ownerRef) ||
        (ref.scope.kind === "organization" &&
          ref.sourceKind === "desktop.organization-project-goals" &&
          typeof value.ownerRef === "string" &&
          value.ownerRef.startsWith("did:"))
      )
    )
      fail("GOAL_INVALID_PROJECT_SCOPE");
  }
  text(value.title, 1024);
  text(value.objective, 8192);
  if (!GOAL_STATUSES.includes(value.status)) fail("GOAL_INVALID_STATUS");
  integer(value.progress);
  if (value.progress > 100) fail("GOAL_INVALID_NUMBER");
  for (const kr of array(value.keyResults)) {
    fields(kr, ["id", "text", "target", "current", "done"]);
    identifier(kr.id);
    text(kr.text, 2048, true);
    if (kr.target !== null && !Number.isFinite(kr.target))
      fail("GOAL_INVALID_NUMBER");
    if (!Number.isFinite(kr.current) || typeof kr.done !== "boolean")
      fail("GOAL_INVALID_NUMBER");
  }
  array(value.linkedSessions).forEach(identifier);
  for (const note of array(value.notes, 200)) {
    fields(note, ["at", "text", "by"]);
    timestamp(note.at);
    text(note.text, 8192, true);
    if (!["agent", "user"].includes(note.by)) fail("GOAL_INVALID_NOTE");
  }
  fields(value.drift, ["lastProgressAt", "flags"]);
  timestamp(value.drift.lastProgressAt, true);
  for (const flag of array(value.drift.flags, 20)) {
    fields(flag, ["at", "kind", "detail"]);
    timestamp(flag.at);
    text(flag.kind, 256);
    text(flag.detail, 2048, true);
  }
  timestamp(value.createdAt);
  timestamp(value.updatedAt);
  if (value.updatedAt < value.createdAt) fail("GOAL_INVALID_TIME");
  const criteriaIds = new Set();
  for (const criterion of array(value.acceptanceCriteria, 50)) {
    fields(criterion, ["id", "kind", "description"]);
    identifier(criterion.id);
    text(criterion.description, 2048);
    if (
      criteriaIds.has(criterion.id) ||
      !["manual", "business-assertion"].includes(criterion.kind)
    )
      fail("GOAL_INVALID_CRITERIA");
    criteriaIds.add(criterion.id);
  }
  budget(value.budgetPolicy);
  timestamp(value.expiresAt, true);
  timestamp(value.nextCheckAt, true);
  refs(value.triggerRefs);
  refs(value.authorizationRefs);
  refs(value.memoryRefs);
  array(value.allowedActionTypes).forEach((type) => {
    if (
      typeof type !== "string" ||
      !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u.test(type)
    )
      fail("GOAL_INVALID_ACTION_TYPE");
  });
  normalizeGoalNotificationPolicy(value.notificationPolicy);
  if (value.waitingReason !== null) text(value.waitingReason, 128);
  if (
    ![
      "idle",
      "queued",
      "running",
      "pause-requested",
      "paused",
      "waiting",
      "unknown",
    ].includes(value.executionState)
  )
    fail("GOAL_INVALID_EXECUTION_STATE");
  if (value.completion !== null) {
    const completion = value.completion;
    fields(completion, [
      "verifiedAt",
      "definitionDigest",
      "forRevision",
      "verifierRef",
      "criteriaIds",
      "evidenceRefs",
    ]);
    timestamp(completion.verifiedAt);
    identifier(completion.verifierRef);
    integer(completion.forRevision, 1);
    refs(completion.evidenceRefs);
    if (
      value.status !== "done" ||
      completion.forRevision !== value.revision ||
      completion.definitionDigest !== goalDefinitionDigest(value) ||
      completion.evidenceRefs.length === 0 ||
      criteriaIds.size === 0 ||
      !Array.isArray(completion.criteriaIds) ||
      new Set(completion.criteriaIds).size !== criteriaIds.size ||
      completion.criteriaIds.length !== criteriaIds.size ||
      completion.criteriaIds.some((id) => !criteriaIds.has(id))
    )
      fail("GOAL_INVALID_COMPLETION");
  }
  // Legacy standalone CLI goals retain explicit manual done. Project-bound
  // goals may never acquire a verified terminal state from model progress.
  if (
    value.projectRef !== null &&
    value.status === "done" &&
    value.completion === null
  )
    fail("GOAL_COMPLETION_EVIDENCE_REQUIRED");
  return freeze(value);
}

function createGoalRecord(input) {
  const value = copy(input);
  fields(value, [
    "id",
    "storeId",
    "ownerRef",
    "projectRef",
    "title",
    "objective",
    "keyResults",
    "createdAt",
    "acceptanceCriteria",
    "budgetPolicy",
    "expiresAt",
    "notificationPolicy",
  ]);
  const now = value.createdAt ?? new Date().toISOString();
  return validateGoalRecord({
    schema: GOAL_SCHEMA,
    schemaVersion: GOAL_SCHEMA_VERSION,
    id: value.id ?? `goal-${randomUUID()}`,
    storeId: value.storeId,
    revision: 1,
    controlGeneration: 0,
    ownerRef: value.ownerRef ?? null,
    projectRef: value.projectRef ?? null,
    title: value.title ?? value.objective,
    objective: value.objective,
    status: "active",
    progress: 0,
    keyResults: value.keyResults ?? [],
    linkedSessions: [],
    notes: [],
    drift: { lastProgressAt: null, flags: [] },
    createdAt: now,
    updatedAt: now,
    acceptanceCriteria: value.acceptanceCriteria ?? [],
    budgetPolicy: {
      maxRuns: null,
      maxTokens: null,
      maxTimeMs: null,
      maxCostUsd: null,
      ...value.budgetPolicy,
    },
    expiresAt: value.expiresAt ?? null,
    nextCheckAt: null,
    triggerRefs: [],
    allowedActionTypes: [],
    authorizationRefs: [],
    notificationPolicy: value.notificationPolicy ?? {
      channel: "in-app",
      mode: "changes-only",
    },
    memoryRefs: [],
    waitingReason: null,
    executionState: "idle",
    completion: null,
  });
}

function upgradeLegacyGoal(input, storeId) {
  const old = copy(input);
  if (Object.hasOwn(old, "schemaVersion") || Object.hasOwn(old, "schema"))
    return validateGoalRecord(old);
  const base = createGoalRecord({
    id: old.id,
    storeId,
    objective: old.objective,
    title: old.title,
    keyResults: old.keyResults ?? [],
    createdAt: old.createdAt,
  });
  return validateGoalRecord({
    ...base,
    revision: old.revision ?? base.revision,
    controlGeneration: old.controlGeneration ?? base.controlGeneration,
    status: old.status,
    progress: old.progress ?? 0,
    linkedSessions: old.linkedSessions ?? [],
    notes: old.notes ?? [],
    drift: old.drift ?? base.drift,
    updatedAt: old.updatedAt ?? base.updatedAt,
  });
}

function reviseGoalRecord(record, patch, now = new Date().toISOString()) {
  const current = validateGoalRecord(record);
  const changes = copy(patch);
  fields(changes, MUTABLE_FIELDS);
  if (changes.status === "done") fail("GOAL_COMPLETION_EVIDENCE_REQUIRED");
  if (
    current.status === "done" &&
    !["active", "abandoned"].includes(changes.status)
  )
    fail("GOAL_TERMINAL_REVISION_DENIED");
  const stamp = timestamp(now);
  if (stamp < current.updatedAt) fail("GOAL_CLOCK_MOVED_BACKWARDS");
  return validateGoalRecord({
    ...current,
    ...changes,
    revision: integer(current.revision + 1, 1),
    controlGeneration: integer(current.controlGeneration + 1),
    updatedAt: stamp,
    completion: null,
  });
}

function completeGoalRecord(
  record,
  verification,
  now = new Date().toISOString(),
) {
  const current = validateGoalRecord(record);
  const proof = copy(verification);
  fields(proof, ["met", "verifierRef", "criteriaIds", "evidenceRefs"]);
  if (
    current.status !== "active" ||
    proof.met !== true ||
    (current.expiresAt !== null && now >= current.expiresAt)
  )
    fail("GOAL_COMPLETION_NOT_MET");
  if (now < current.updatedAt) fail("GOAL_CLOCK_MOVED_BACKWARDS");
  return validateGoalRecord({
    ...current,
    status: "done",
    progress: 100,
    revision: current.revision + 1,
    updatedAt: now,
    completion: {
      verifiedAt: now,
      forRevision: current.revision + 1,
      definitionDigest: goalDefinitionDigest(current),
      verifierRef: proof.verifierRef,
      criteriaIds: proof.criteriaIds,
      evidenceRefs: proof.evidenceRefs,
    },
  });
}

module.exports = {
  GOAL_SCHEMA,
  GOAL_SCHEMA_VERSION,
  MAX_GOAL_RECORD_BYTES,
  GOAL_STATUSES,
  MUTABLE_FIELDS,
  goalError,
  validateGoalRecord,
  createGoalRecord,
  upgradeLegacyGoal,
  reviseGoalRecord,
  completeGoalRecord,
  goalDefinitionDigest,
};
