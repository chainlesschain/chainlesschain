"use strict";

const {
  CONTEXT_KINDS,
  CONTEXT_SCOPES,
  CONTEXT_TRUST,
  SENSITIVITY,
  MEMORY_STATES,
  CONTEXT_ERROR_CODES,
} = require("./constants.js");
const { canonicalDigest, canonicalJson } = require("./canonical.js");
const { invalidArgument, kernelError } = require("./errors.js");

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SCOPE_ID_REQUIRED = new Set(["turn", "session", "agent", "project", "user"]);
const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/iu,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/iu,
  /\b(?:recovery|backup)\s+code\s*[:=]\s*[A-Za-z0-9 -]{8,}/iu,
  /\b(?:session|auth)(?:id|_token)?\s*=\s*[A-Za-z0-9%._~+/=-]{16,}/iu,
]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidArgument(`${label} must be an object`, { field: label });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidArgument(`${label} must be a plain object`, { field: label });
  }
  return value;
}

function assertKnownFields(value, fields, label) {
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length > 0) {
    throw invalidArgument(`${label} contains unknown fields`, { field: label, unknown });
  }
}

function boundedString(value, field, { min = 0, max = 4096 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw invalidArgument(`${field} must be a string between ${min} and ${max} characters`, { field });
  }
  return value;
}

function identifier(value, field = "identifier") {
  const output = boundedString(value, field, { min: 1, max: 160 });
  if (!IDENTIFIER_PATTERN.test(output)) throw invalidArgument(`${field} is not a safe identifier`, { field });
  return output;
}

function digestValue(value, field = "digest") {
  const output = boundedString(value, field, { min: 71, max: 71 });
  if (!DIGEST_PATTERN.test(output)) throw invalidArgument(`${field} must be a sha256 digest`, { field });
  return output;
}

function boundedInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalidArgument(`${field} must be an integer between ${min} and ${max}`, { field });
  }
  return value;
}

function boundedNumber(value, field, { min = 0, max = 1 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw invalidArgument(`${field} must be a finite number between ${min} and ${max}`, { field });
  }
  return value;
}

function booleanValue(value, field) {
  if (typeof value !== "boolean") throw invalidArgument(`${field} must be a boolean`, { field });
  return value;
}

function timestamp(value, field) {
  const text = boundedString(value, field, { min: 20, max: 64 });
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch)) throw invalidArgument(`${field} must be an ISO timestamp`, { field });
  return new Date(epoch).toISOString();
}

function stringSet(value, field, { minItems = 0, maxItems = 128, itemMax = 160 } = {}) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw invalidArgument(`${field} must contain ${minItems}-${maxItems} strings`, { field });
  }
  const output = value.map((entry, index) =>
    boundedString(entry, `${field}[${index}]`, { min: 1, max: itemMax }),
  );
  if (new Set(output).size !== output.length) throw invalidArgument(`${field} must not contain duplicates`, { field });
  return [...output].sort((left, right) => left.localeCompare(right, "en"));
}

function assertScope(scopeValue, scopeIdValue, field = "scope") {
  if (!CONTEXT_SCOPES.includes(scopeValue)) throw invalidArgument(`${field} is invalid`, { field, scope: scopeValue });
  if (SCOPE_ID_REQUIRED.has(scopeValue)) {
    return { scope: scopeValue, scopeId: identifier(scopeIdValue, `${field}Id`) };
  }
  if (scopeIdValue !== undefined && scopeIdValue !== null) {
    throw invalidArgument("global scope must not include scopeId", { field: `${field}Id` });
  }
  return { scope: scopeValue };
}

const SOURCE_REF_FIELDS = new Set(["store", "id", "revision", "eventSequence", "digest", "uri"]);
function normalizeSourceRef(input, field = "sourceRef") {
  const value = objectValue(input, field);
  assertKnownFields(value, SOURCE_REF_FIELDS, field);
  return {
    store: identifier(value.store, `${field}.store`),
    id: identifier(value.id, `${field}.id`),
    ...(value.revision === undefined ? {} : { revision: boundedInteger(value.revision, `${field}.revision`) }),
    ...(value.eventSequence === undefined
      ? {}
      : { eventSequence: boundedInteger(value.eventSequence, `${field}.eventSequence`) }),
    ...(value.digest === undefined ? {} : { digest: digestValue(value.digest, `${field}.digest`) }),
    ...(value.uri === undefined
      ? {}
      : { uri: boundedString(value.uri, `${field}.uri`, { min: 1, max: 4096 }) }),
  };
}

const PROVENANCE_FIELDS = new Set(["source", "actor", "observedAt", "parentDigests", "degraded"]);
function normalizeProvenance(input, field = "provenance") {
  const value = objectValue(input, field);
  assertKnownFields(value, PROVENANCE_FIELDS, field);
  return {
    source: identifier(value.source, `${field}.source`),
    ...(value.actor === undefined ? {} : { actor: identifier(value.actor, `${field}.actor`) }),
    observedAt: timestamp(value.observedAt, `${field}.observedAt`),
    ...(value.parentDigests === undefined
      ? {}
      : {
          parentDigests: stringSet(value.parentDigests, `${field}.parentDigests`, {
            maxItems: 128,
            itemMax: 71,
          }).map((entry) => digestValue(entry, `${field}.parentDigests`)),
        }),
    ...(value.degraded === undefined ? {} : { degraded: booleanValue(value.degraded, `${field}.degraded`) }),
  };
}

const CONTENT_REF_FIELDS = new Set([
  "store",
  "objectId",
  "digest",
  "byteLength",
  "mimeType",
  "summary",
  "recoverable",
  "accessPolicy",
]);
function normalizeContentRef(input, field = "contentRef") {
  const value = objectValue(input, field);
  assertKnownFields(value, CONTENT_REF_FIELDS, field);
  return {
    store: identifier(value.store, `${field}.store`),
    objectId: identifier(value.objectId, `${field}.objectId`),
    digest: digestValue(value.digest, `${field}.digest`),
    byteLength: boundedInteger(value.byteLength, `${field}.byteLength`, { max: 1024 ** 4 }),
    ...(value.mimeType === undefined
      ? {}
      : { mimeType: boundedString(value.mimeType, `${field}.mimeType`, { min: 1, max: 256 }) }),
    summary: boundedString(value.summary, `${field}.summary`, { min: 1, max: 16 * 1024 }),
    recoverable: booleanValue(value.recoverable, `${field}.recoverable`),
    ...(value.accessPolicy === undefined
      ? {}
      : { accessPolicy: identifier(value.accessPolicy, `${field}.accessPolicy`) }),
  };
}

const BINDING_FIELDS = new Set([
  "taskState",
  "toolCallId",
  "toolRole",
  "toolOutcome",
  "approvalId",
  "questionId",
  "humanTaskId",
  "requiredForRecovery",
  "cwdIdentity",
  "worktreeIdentity",
  "permissionCeilingDigest",
  "budgetRevision",
]);
function normalizeContextBinding(input, field = "binding") {
  const value = objectValue(input, field);
  assertKnownFields(value, BINDING_FIELDS, field);
  const output = {};
  if (value.taskState !== undefined) {
    if (!["pending", "running", "waiting", "terminal"].includes(value.taskState)) {
      throw invalidArgument(`${field}.taskState is invalid`, { field: `${field}.taskState` });
    }
    output.taskState = value.taskState;
  }
  if (value.toolCallId !== undefined) output.toolCallId = identifier(value.toolCallId, `${field}.toolCallId`);
  if (value.toolRole !== undefined) {
    if (!["call", "result"].includes(value.toolRole)) throw invalidArgument(`${field}.toolRole is invalid`);
    output.toolRole = value.toolRole;
  }
  if (value.toolOutcome !== undefined) {
    if (!["pending", "succeeded", "failed", "unknown"].includes(value.toolOutcome)) {
      throw invalidArgument(`${field}.toolOutcome is invalid`);
    }
    output.toolOutcome = value.toolOutcome;
  }
  if ((output.toolRole || output.toolOutcome) && !output.toolCallId) {
    throw invalidArgument("toolRole/toolOutcome requires toolCallId", { field });
  }
  for (const key of ["approvalId", "questionId", "humanTaskId", "cwdIdentity", "worktreeIdentity"]) {
    if (value[key] !== undefined) output[key] = identifier(value[key], `${field}.${key}`);
  }
  if (value.permissionCeilingDigest !== undefined) {
    output.permissionCeilingDigest = digestValue(value.permissionCeilingDigest, `${field}.permissionCeilingDigest`);
  }
  if (value.budgetRevision !== undefined) {
    output.budgetRevision = boundedInteger(value.budgetRevision, `${field}.budgetRevision`);
  }
  if (value.requiredForRecovery !== undefined) {
    output.requiredForRecovery = booleanValue(value.requiredForRecovery, `${field}.requiredForRecovery`);
  }
  return output;
}

const CONTEXT_ITEM_FIELDS = new Set([
  "schemaVersion",
  "itemId",
  "kind",
  "scope",
  "scopeId",
  "sourceRef",
  "provenance",
  "trust",
  "sensitivity",
  "allowedSinks",
  "tokenEstimate",
  "priority",
  "pinned",
  "createdAt",
  "expiresAt",
  "digest",
  "content",
  "contentRef",
  "binding",
]);

function computeContextItemDigest(input) {
  const value = { ...input };
  delete value.digest;
  return canonicalDigest(value, "chainlesschain.context-item/v1");
}

function normalizeContextItem(input) {
  const value = objectValue(input, "ContextItem");
  assertKnownFields(value, CONTEXT_ITEM_FIELDS, "ContextItem");
  if (value.schemaVersion !== 1) throw invalidArgument("ContextItem schemaVersion must be 1");
  if (!CONTEXT_KINDS.includes(value.kind)) throw invalidArgument("ContextItem kind is invalid", { kind: value.kind });
  if (!CONTEXT_TRUST.includes(value.trust)) throw invalidArgument("ContextItem trust is invalid", { trust: value.trust });
  if (!SENSITIVITY.includes(value.sensitivity)) {
    throw invalidArgument("ContextItem sensitivity is invalid", { sensitivity: value.sensitivity });
  }
  if ((value.content === undefined) === (value.contentRef === undefined)) {
    throw invalidArgument("ContextItem must contain exactly one of content or contentRef");
  }
  const normalized = {
    schemaVersion: 1,
    itemId: identifier(value.itemId, "itemId"),
    kind: value.kind,
    ...assertScope(value.scope, value.scopeId),
    sourceRef: normalizeSourceRef(value.sourceRef),
    provenance: normalizeProvenance(value.provenance),
    trust: value.trust,
    sensitivity: value.sensitivity,
    allowedSinks: stringSet(value.allowedSinks, "allowedSinks", { minItems: 1, maxItems: 128, itemMax: 128 }),
    tokenEstimate: boundedInteger(value.tokenEstimate, "tokenEstimate", { min: 1, max: 16_777_216 }),
    priority: boundedInteger(value.priority, "priority", { max: 1_000_000 }),
    pinned: booleanValue(value.pinned, "pinned"),
    createdAt: timestamp(value.createdAt, "createdAt"),
    ...(value.expiresAt === undefined ? {} : { expiresAt: timestamp(value.expiresAt, "expiresAt") }),
    ...(value.binding === undefined ? {} : { binding: normalizeContextBinding(value.binding) }),
    ...(value.content === undefined
      ? { contentRef: normalizeContentRef(value.contentRef) }
      : { content: boundedString(value.content, "content", { max: 4 * 1024 * 1024 }) }),
  };
  const digest = computeContextItemDigest(normalized);
  if (value.digest !== undefined && digestValue(value.digest) !== digest) {
    throw kernelError(CONTEXT_ERROR_CODES.DIGEST_MISMATCH, "ContextItem digest does not match canonical content", {
      itemId: normalized.itemId,
    });
  }
  normalized.digest = digest;
  return normalized;
}

const RETENTION_FIELDS = new Set(["mode", "expiresAt", "maxAgeDays", "legalHoldId"]);
function normalizeRetentionPolicy(input) {
  const value = objectValue(input, "retentionPolicy");
  assertKnownFields(value, RETENTION_FIELDS, "retentionPolicy");
  if (!["ephemeral", "session", "durable", "until_expired", "legal_hold"].includes(value.mode)) {
    throw invalidArgument("retentionPolicy.mode is invalid");
  }
  if (value.mode === "until_expired" && value.expiresAt === undefined) {
    throw invalidArgument("until_expired retention requires expiresAt");
  }
  if (value.mode === "legal_hold" && value.legalHoldId === undefined) {
    throw invalidArgument("legal_hold retention requires legalHoldId");
  }
  return {
    mode: value.mode,
    ...(value.expiresAt === undefined ? {} : { expiresAt: timestamp(value.expiresAt, "retentionPolicy.expiresAt") }),
    ...(value.maxAgeDays === undefined
      ? {}
      : { maxAgeDays: boundedInteger(value.maxAgeDays, "retentionPolicy.maxAgeDays", { min: 1, max: 365_000 }) }),
    ...(value.legalHoldId === undefined ? {} : { legalHoldId: identifier(value.legalHoldId, "retentionPolicy.legalHoldId") }),
  };
}

function containsSecretMaterial(content) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

const MEMORY_FIELDS = new Set([
  "schemaVersion",
  "memoryId",
  "scope",
  "scopeId",
  "category",
  "content",
  "contentRef",
  "summary",
  "provenance",
  "evidenceRefs",
  "confidence",
  "importance",
  "tags",
  "sensitivity",
  "allowedSinks",
  "state",
  "retentionPolicy",
  "createdAt",
  "updatedAt",
  "lastAccessedAt",
  "accessCount",
  "supersedes",
  "revision",
  "digest",
  "deletionFence",
]);

function computeMemoryRecordDigest(input) {
  const value = { ...input };
  delete value.digest;
  return canonicalDigest(value, "chainlesschain.memory-record/v1");
}

function normalizeMemoryRecord(input) {
  const value = objectValue(input, "MemoryRecord");
  assertKnownFields(value, MEMORY_FIELDS, "MemoryRecord");
  if (value.schemaVersion !== 1) throw invalidArgument("MemoryRecord schemaVersion must be 1");
  if (!MEMORY_STATES.includes(value.state)) throw invalidArgument("MemoryRecord state is invalid", { state: value.state });
  if (!SENSITIVITY.includes(value.sensitivity)) throw invalidArgument("MemoryRecord sensitivity is invalid");
  const tombstoned = ["deleted", "purged"].includes(value.state);
  const content = boundedString(value.content, "content", {
    min: tombstoned ? 0 : 1,
    max: 4 * 1024 * 1024,
  });
  if (!tombstoned && containsSecretMaterial(content)) {
    throw invalidArgument("MemoryRecord content appears to contain secret material", { field: "content" });
  }
  if (tombstoned && content !== "") throw invalidArgument("deleted/purged MemoryRecord content must be empty");
  if (tombstoned && value.summary !== undefined) throw invalidArgument("deleted/purged MemoryRecord must not retain summary");
  if (tombstoned && value.contentRef !== undefined) throw invalidArgument("deleted/purged MemoryRecord must not retain contentRef");
  if (tombstoned && value.deletionFence === undefined) throw invalidArgument("deleted/purged MemoryRecord requires deletionFence");
  const normalized = {
    schemaVersion: 1,
    memoryId: identifier(value.memoryId, "memoryId"),
    ...assertScope(value.scope, value.scopeId),
    category: identifier(value.category, "category"),
    content,
    ...(value.contentRef === undefined ? {} : { contentRef: normalizeContentRef(value.contentRef) }),
    ...(value.summary === undefined
      ? {}
      : { summary: boundedString(value.summary, "summary", { min: 1, max: 16 * 1024 }) }),
    provenance: normalizeProvenance(value.provenance),
    evidenceRefs: (() => {
      if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0 || value.evidenceRefs.length > 128) {
        throw invalidArgument("evidenceRefs must contain 1-128 entries");
      }
      return value.evidenceRefs.map((entry, index) => normalizeSourceRef(entry, `evidenceRefs[${index}]`));
    })(),
    confidence: boundedNumber(value.confidence, "confidence"),
    importance: boundedNumber(value.importance, "importance"),
    tags: stringSet(value.tags, "tags", { maxItems: 128, itemMax: 128 }),
    sensitivity: value.sensitivity,
    allowedSinks: stringSet(value.allowedSinks, "allowedSinks", { minItems: 1, maxItems: 128, itemMax: 128 }),
    state: value.state,
    retentionPolicy: normalizeRetentionPolicy(value.retentionPolicy),
    createdAt: timestamp(value.createdAt, "createdAt"),
    updatedAt: timestamp(value.updatedAt, "updatedAt"),
    ...(value.lastAccessedAt === undefined ? {} : { lastAccessedAt: timestamp(value.lastAccessedAt, "lastAccessedAt") }),
    accessCount: boundedInteger(value.accessCount, "accessCount", { max: Number.MAX_SAFE_INTEGER }),
    ...(value.supersedes === undefined
      ? {}
      : { supersedes: stringSet(value.supersedes, "supersedes", { maxItems: 128, itemMax: 160 }).map((entry) => identifier(entry, "supersedes")) }),
    revision: boundedInteger(value.revision, "revision", { min: 1 }),
    ...(value.deletionFence === undefined ? {} : { deletionFence: identifier(value.deletionFence, "deletionFence") }),
  };
  const digest = computeMemoryRecordDigest(normalized);
  if (value.digest !== undefined && digestValue(value.digest) !== digest) {
    throw kernelError(CONTEXT_ERROR_CODES.DIGEST_MISMATCH, "MemoryRecord digest does not match canonical content", {
      memoryId: normalized.memoryId,
    });
  }
  normalized.digest = digest;
  return normalized;
}

function jsonByteLength(value, field, maximum) {
  const length = Buffer.byteLength(canonicalJson(value), "utf8");
  if (length > maximum) throw invalidArgument(`${field} exceeds ${maximum} bytes`, { field, length, maximum });
  return length;
}

module.exports = {
  IDENTIFIER_PATTERN,
  DIGEST_PATTERN,
  objectValue,
  assertKnownFields,
  boundedString,
  identifier,
  digestValue,
  boundedInteger,
  boundedNumber,
  booleanValue,
  timestamp,
  stringSet,
  assertScope,
  normalizeSourceRef,
  normalizeProvenance,
  normalizeContentRef,
  normalizeContextBinding,
  normalizeContextItem,
  computeContextItemDigest,
  normalizeRetentionPolicy,
  containsSecretMaterial,
  normalizeMemoryRecord,
  computeMemoryRecordDigest,
  jsonByteLength,
};
