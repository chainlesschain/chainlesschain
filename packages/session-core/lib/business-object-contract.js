"use strict";

/**
 * Versioned business references and action records shared by hosts.
 *
 * These pure contracts neither authorize nor execute an action. Hosts must
 * check current permissions, consume approval, compare the target version
 * atomically and persist an idempotency record before writing. A valid digest
 * establishes content binding, not an authenticated or successful execution.
 * Run records contain references and digests only; resolve evidence through an
 * authorized reader. Never put credentials or document content in opaque IDs.
 */
const crypto = require("node:crypto");
const { isProxy } = require("node:util").types;

const BUSINESS_OBJECT_SCHEMA = "chainlesschain.business-object-ref/v1";
const BUSINESS_ACTION_SCHEMA = "chainlesschain.business-action-request/v1";
const BUSINESS_ACTION_RUN_SCHEMA = "chainlesschain.business-action-run/v1";
const BUSINESS_CONTRACT_VERSION = 1;
const BUSINESS_OBJECT_TYPES = Object.freeze([
  "Project",
  "Task",
  "Document",
  "Person",
  "Decision",
  "ActionRun",
]);
const BUSINESS_SCOPE_KINDS = Object.freeze([
  "personal",
  "team",
  "organization",
]);
const BUSINESS_ACTION_STATUSES = Object.freeze([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
  "denied",
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
// Opaque IDs permit UUID/DID forms, never URLs or filesystem paths.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;
const NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u;
const REF_KEYS = [
  "schema",
  "schemaVersion",
  "type",
  "id",
  "sourceKind",
  "scope",
  "version",
];
const REQUEST_KEYS = [
  "schema",
  "schemaVersion",
  "actionType",
  "actionVersion",
  "target",
  "expectedVersion",
  "input",
  "inputDigest",
  "idempotencyKey",
  "idempotencyDigest",
  "actionDigest",
  "invocationDigest",
];
const RUN_KEYS = [
  "schema",
  "schemaVersion",
  "id",
  "actionType",
  "actionVersion",
  "target",
  "expectedVersion",
  "inputDigest",
  "idempotencyDigest",
  "actionDigest",
  "invocationDigest",
  "status",
  "afterVersion",
  "startedAt",
  "completedAt",
  "approvalRef",
  "executionRef",
  "traceId",
  "evidenceRefs",
];

// Match the shared contracts' lexicographically sorted JSON convention, but
// reject ambiguous/non-JSON values before hashing. Bounds apply across a tree.
function copyJson(value) {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set();
  function visit(item, depth) {
    if (++nodes > 4096 || depth > 24)
      throw new TypeError("JSON bounds exceeded");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      bytes += Buffer.byteLength(item, "utf8");
      if (bytes > 65536) throw new TypeError("JSON bounds exceeded");
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || isProxy(item)) {
      throw new TypeError("Plain JSON values required");
    }
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Plain JSON objects required");
    }
    if (ancestors.has(item)) throw new TypeError("Circular JSON is invalid");
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    if (keys.length > 4096) throw new TypeError("JSON bounds exceeded");
    const result = array ? [] : {};
    if (array && (item.length > 4096 || keys.length !== item.length + 1)) {
      throw new TypeError("Dense JSON arrays required");
    }
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (
        typeof key !== "string" ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        (array && !/^(0|[1-9][0-9]*)$/u.test(key))
      )
        throw new TypeError("Enumerable JSON data properties required");
      bytes += Buffer.byteLength(key, "utf8");
      if (bytes > 65536) throw new TypeError("JSON bounds exceeded");
      Object.defineProperty(result, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    ancestors.delete(item);
    return result;
  }
  return visit(value, 0);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

/** Content-based version for sources without a native monotonic revision. */
function digestBusinessObjectContent(content) {
  return digest(copyJson(content));
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function fields(value, required, optional = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  ) {
    throw new TypeError("Unexpected or missing contract fields");
  }
}

function member(value, values, label) {
  if (!values.includes(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`Invalid ${label}`);
  return value;
}

function name(value, label) {
  if (typeof value !== "string" || value.length > 128 || !NAME.test(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function version(value) {
  if (
    !(Number.isSafeInteger(value) && value > 0) &&
    !(typeof value === "string" && DIGEST.test(value))
  ) {
    throw new TypeError("Version must be a positive integer or sha256 digest");
  }
  return value;
}

function schema(value, expected) {
  if (
    value.schema !== expected ||
    value.schemaVersion !== BUSINESS_CONTRACT_VERSION
  ) {
    throw new TypeError("Unsupported business contract schema/version");
  }
}

function normalizeRef(value) {
  fields(value, REF_KEYS);
  schema(value, BUSINESS_OBJECT_SCHEMA);
  member(value.type, BUSINESS_OBJECT_TYPES, "object type");
  identifier(value.id, "object id");
  name(value.sourceKind, "source kind");
  fields(value.scope, ["kind", "id"]);
  member(value.scope.kind, BUSINESS_SCOPE_KINDS, "scope kind");
  identifier(value.scope.id, "scope id");
  version(value.version);
  return value;
}

function createBusinessObjectRef(input) {
  const value = copyJson(input);
  fields(value, ["type", "id", "sourceKind", "scope", "version"]);
  return freeze(
    normalizeRef({
      schema: BUSINESS_OBJECT_SCHEMA,
      schemaVersion: BUSINESS_CONTRACT_VERSION,
      ...value,
    }),
  );
}

/** Throws on invalid serialized data and returns a detached immutable copy. */
function validateBusinessObjectRef(input) {
  return freeze(normalizeRef(copyJson(input)));
}

function actionBinding(value) {
  return {
    schema: BUSINESS_ACTION_SCHEMA,
    schemaVersion: BUSINESS_CONTRACT_VERSION,
    actionType: value.actionType,
    actionVersion: value.actionVersion,
    target: value.target,
    expectedVersion: value.expectedVersion,
    inputDigest: value.inputDigest,
  };
}

function invocationDigest(value) {
  return digest({
    schema: BUSINESS_ACTION_SCHEMA,
    actionDigest: value.actionDigest,
    idempotencyDigest: value.idempotencyDigest,
  });
}

function validateBinding(value) {
  name(value.actionType, "action type");
  if (value.actionVersion !== 1)
    throw new TypeError("Unsupported action version");
  normalizeRef(value.target);
  version(value.expectedVersion);
  if (value.expectedVersion !== value.target.version) {
    throw new TypeError("Expected version must match target reference");
  }
  for (const field of [
    "inputDigest",
    "idempotencyDigest",
    "actionDigest",
    "invocationDigest",
  ]) {
    if (typeof value[field] !== "string" || !DIGEST.test(value[field])) {
      throw new TypeError(`Invalid ${field}`);
    }
  }
  if (
    value.actionDigest !== digest(actionBinding(value)) ||
    value.invocationDigest !== invocationDigest(value)
  ) {
    throw new TypeError("Action digest binding mismatch");
  }
}

function createBusinessActionRequest(input) {
  const value = copyJson(input);
  fields(value, [
    "actionType",
    "actionVersion",
    "target",
    "expectedVersion",
    "input",
    "idempotencyKey",
  ]);
  identifier(value.idempotencyKey, "idempotency key");
  fields(value.input, [], Object.keys(value.input || {}));
  const request = {
    schema: BUSINESS_ACTION_SCHEMA,
    schemaVersion: BUSINESS_CONTRACT_VERSION,
    ...value,
    inputDigest: digest(value.input),
    idempotencyDigest: digest({
      schema: BUSINESS_ACTION_SCHEMA,
      scope: value.target.scope,
      idempotencyKey: value.idempotencyKey,
    }),
  };
  request.actionDigest = digest(actionBinding(request));
  request.invocationDigest = invocationDigest(request);
  validateBinding(request);
  // Generated bindings also count toward the serialized contract bounds.
  return freeze(copyJson(request));
}

function validateBusinessActionRequest(input) {
  const value = copyJson(input);
  fields(value, REQUEST_KEYS);
  schema(value, BUSINESS_ACTION_SCHEMA);
  const expected = createBusinessActionRequest(
    Object.fromEntries(
      [
        "actionType",
        "actionVersion",
        "target",
        "expectedVersion",
        "input",
        "idempotencyKey",
      ].map((key) => [key, value[key]]),
    ),
  );
  if (canonical(value) !== canonical(expected))
    throw new TypeError("Action digest binding mismatch");
  return expected;
}

/** Hosts must reject a reused key with different target, revision or input. */
function assertBusinessActionReplay(previous, candidate) {
  const before = validateBusinessActionRequest(previous);
  const after = validateBusinessActionRequest(candidate);
  if (
    before.idempotencyDigest !== after.idempotencyDigest ||
    before.invocationDigest !== after.invocationDigest
  ) {
    throw new TypeError("Business action idempotency conflict");
  }
  // Matching content does not authorize replay of an unknown outcome.
  return true;
}

function evidenceRef(value) {
  fields(value, ["id", "digest"]);
  identifier(value.id, "evidence id");
  if (typeof value.digest !== "string" || !DIGEST.test(value.digest)) {
    throw new TypeError("Invalid evidence digest");
  }
}

function instant(value) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError("Canonical timestamp required");
}

function normalizeRun(value) {
  fields(value, RUN_KEYS);
  schema(value, BUSINESS_ACTION_RUN_SCHEMA);
  identifier(value.id, "run id");
  validateBinding(value);
  member(value.status, BUSINESS_ACTION_STATUSES, "action status");
  instant(value.startedAt);
  const terminal = !["queued", "running"].includes(value.status);
  if (terminal) {
    instant(value.completedAt);
    if (Date.parse(value.completedAt) < Date.parse(value.startedAt))
      throw new TypeError("Completion precedes start");
  } else if (value.completedAt !== null)
    throw new TypeError("Unfinished run has completion time");
  if (value.afterVersion !== null) version(value.afterVersion);
  if (
    typeof value.afterVersion === "number" &&
    typeof value.expectedVersion === "number" &&
    value.afterVersion < value.expectedVersion
  ) {
    throw new TypeError("Resulting revision cannot precede expected revision");
  }
  if (
    ["queued", "running", "denied", "cancelled"].includes(value.status) &&
    value.afterVersion !== null
  ) {
    throw new TypeError("Unapplied action cannot claim a resulting version");
  }
  for (const key of ["approvalRef", "executionRef"]) {
    if (value[key] !== null) evidenceRef(value[key]);
  }
  if (value.traceId !== null) identifier(value.traceId, "trace id");
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 64) {
    throw new TypeError("Bounded evidence references required");
  }
  for (const reference of value.evidenceRefs) evidenceRef(reference);
  if (
    new Set(value.evidenceRefs.map((entry) => entry.id)).size !==
    value.evidenceRefs.length
  ) {
    throw new TypeError("Duplicate evidence references");
  }
  if (
    value.status === "succeeded" &&
    (value.afterVersion === null ||
      value.executionRef === null ||
      value.evidenceRefs.length === 0)
  ) {
    throw new TypeError(
      "Success requires a resulting version and execution evidence references",
    );
  }
  return value;
}

function createBusinessActionRun(input) {
  // The full request has its own JSON budget. The run only retains its binding,
  // so metadata must not push an otherwise valid request over that budget.
  // Read descriptors before separating it to avoid invoking outer accessors.
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  ) {
    throw new TypeError("Plain action run input required");
  }
  fields(
    input,
    ["id", "request", "status", "startedAt"],
    [
      "afterVersion",
      "completedAt",
      "approvalRef",
      "executionRef",
      "traceId",
      "evidenceRefs",
    ],
  );
  const metadata = {};
  let rawRequest;
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== "string" ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError("Enumerable action run data properties required");
    }
    if (key === "request") rawRequest = descriptor.value;
    else metadata[key] = descriptor.value;
  }
  const value = copyJson(metadata);
  const request = validateBusinessActionRequest(rawRequest);
  const binding = actionBinding(request);
  return freeze(
    normalizeRun({
      ...binding,
      schema: BUSINESS_ACTION_RUN_SCHEMA,
      id: value.id,
      idempotencyDigest: request.idempotencyDigest,
      actionDigest: request.actionDigest,
      invocationDigest: request.invocationDigest,
      status: value.status,
      startedAt: value.startedAt,
      afterVersion: value.afterVersion ?? null,
      completedAt: value.completedAt ?? null,
      approvalRef: value.approvalRef ?? null,
      executionRef: value.executionRef ?? null,
      traceId: value.traceId ?? null,
      evidenceRefs: value.evidenceRefs ?? [],
    }),
  );
}

function validateBusinessActionRun(input) {
  return freeze(normalizeRun(copyJson(input)));
}

module.exports = {
  BUSINESS_OBJECT_SCHEMA,
  BUSINESS_ACTION_SCHEMA,
  BUSINESS_ACTION_RUN_SCHEMA,
  BUSINESS_CONTRACT_VERSION,
  BUSINESS_OBJECT_TYPES,
  BUSINESS_SCOPE_KINDS,
  BUSINESS_ACTION_STATUSES,
  digestBusinessObjectContent,
  createBusinessObjectRef,
  validateBusinessObjectRef,
  createBusinessActionRequest,
  validateBusinessActionRequest,
  assertBusinessActionReplay,
  createBusinessActionRun,
  validateBusinessActionRun,
};
