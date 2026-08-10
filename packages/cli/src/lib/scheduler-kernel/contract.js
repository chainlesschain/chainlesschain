import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

export const SCHEDULER_SCHEMA_VERSION = 1;
export const AUTHORITY_ENVELOPE_VERSION = 1;

export const OCCURRENCE_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  RETRY_WAIT: "retry_wait",
  SUCCEEDED: "succeeded",
  DEAD_LETTER: "dead_letter",
});

export const DEFAULT_MAX_ATTEMPTS = 3;
export const MAX_JOB_ATTEMPTS = 32;
export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;
export const MAX_JSON_BYTES = 1024 * 1024;

const AUTHORITY_FIELDS = new Set([
  "schemaVersion",
  "principal",
  "tenantId",
  "workspaceId",
  "requestedCapabilities",
  "authorizationRefs",
]);
const PRINCIPAL_FIELDS = new Set(["type", "id"]);
const AUTHORIZATION_REF_FIELDS = new Set([
  "decisionId",
  "policyRevision",
  "grantIds",
  "approvalIds",
  "delegationIds",
]);

export class SchedulerKernelError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = "SchedulerKernelError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function invalidArgument(message, details = undefined) {
  return new SchedulerKernelError(
    "SCHEDULER_INVALID_ARGUMENT",
    message,
    details,
  );
}

function assertPlainObject(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidArgument(`${field} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidArgument(`${field} must be a plain object`);
  }
  return value;
}

function assertKnownFields(value, fields, field) {
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length > 0) {
    throw invalidArgument(`${field} contains unknown fields`, {
      fields: unknown.sort(),
    });
  }
}

export function normalizeIdentifier(value, field, { maxLength = 256 } = {}) {
  if (typeof value !== "string") {
    throw invalidArgument(`${field} must be a string`);
  }
  const normalized = value.trim();
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    hasControlCharacter
  ) {
    throw invalidArgument(`${field} is not a valid identifier`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(value, field) {
  if (value === undefined || value === null) return null;
  return normalizeIdentifier(value, field);
}

function normalizeIdentifierList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw invalidArgument(`${field} must be an array`);
  }
  if (value.length > 256) {
    throw invalidArgument(`${field} exceeds 256 entries`);
  }
  return [
    ...new Set(
      value.map((entry, index) =>
        normalizeIdentifier(entry, `${field}[${index}]`),
      ),
    ),
  ].sort();
}

/**
 * Normalize the authority evidence carried by a job and every occurrence.
 *
 * This envelope is deliberately descriptive. The scheduler stores the actor,
 * requested capabilities and immutable decision/grant references, but it does
 * not infer that those references authorize execution. A future dispatcher
 * must still resolve and enforce the referenced policy before doing work.
 */
export function normalizeAuthorityEnvelope(input) {
  const authority = assertPlainObject(input, "authority");
  assertKnownFields(authority, AUTHORITY_FIELDS, "authority");
  if (
    authority.schemaVersion !== undefined &&
    authority.schemaVersion !== AUTHORITY_ENVELOPE_VERSION
  ) {
    throw invalidArgument(
      `authority.schemaVersion must be ${AUTHORITY_ENVELOPE_VERSION}`,
    );
  }

  const principal = assertPlainObject(
    authority.principal,
    "authority.principal",
  );
  assertKnownFields(principal, PRINCIPAL_FIELDS, "authority.principal");
  const refs = assertPlainObject(
    authority.authorizationRefs ?? {},
    "authority.authorizationRefs",
  );
  assertKnownFields(
    refs,
    AUTHORIZATION_REF_FIELDS,
    "authority.authorizationRefs",
  );

  return {
    schemaVersion: AUTHORITY_ENVELOPE_VERSION,
    principal: {
      type: normalizeIdentifier(principal.type, "authority.principal.type", {
        maxLength: 64,
      }),
      id: normalizeIdentifier(principal.id, "authority.principal.id"),
    },
    tenantId: normalizeOptionalIdentifier(
      authority.tenantId,
      "authority.tenantId",
    ),
    workspaceId: normalizeOptionalIdentifier(
      authority.workspaceId,
      "authority.workspaceId",
    ),
    requestedCapabilities: normalizeIdentifierList(
      authority.requestedCapabilities,
      "authority.requestedCapabilities",
    ),
    authorizationRefs: {
      decisionId: normalizeOptionalIdentifier(
        refs.decisionId,
        "authority.authorizationRefs.decisionId",
      ),
      policyRevision: normalizeOptionalIdentifier(
        refs.policyRevision,
        "authority.authorizationRefs.policyRevision",
      ),
      grantIds: normalizeIdentifierList(
        refs.grantIds,
        "authority.authorizationRefs.grantIds",
      ),
      approvalIds: normalizeIdentifierList(
        refs.approvalIds,
        "authority.authorizationRefs.approvalIds",
      ),
      delegationIds: normalizeIdentifierList(
        refs.delegationIds,
        "authority.authorizationRefs.delegationIds",
      ),
    },
  };
}

function normalizeJsonValue(value, field, state, depth) {
  if (depth > 64) throw invalidArgument(`${field} exceeds maximum JSON depth`);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidArgument(`${field} contains a non-finite number`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw invalidArgument(`${field} contains a non-JSON value`);
  }
  if (state.seen.has(value)) {
    throw invalidArgument(`${field} contains a cycle`);
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        normalizeJsonValue(entry, `${field}[${index}]`, state, depth + 1),
      );
    }
    assertPlainObject(value, field);
    // A JSON object may legitimately contain an own `__proto__` key. A normal
    // object assignment would interpret that key as a prototype mutation and
    // silently drop it from the canonical bytes.
    const normalized = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeJsonValue(
        value[key],
        `${field}.${key}`,
        state,
        depth + 1,
      );
    }
    return normalized;
  } finally {
    state.seen.delete(value);
  }
}

export function normalizeJson(value, field = "value") {
  const normalized = normalizeJsonValue(value, field, { seen: new Set() }, 0);
  const encoded = JSON.stringify(normalized);
  if (Buffer.byteLength(encoded, "utf8") > MAX_JSON_BYTES) {
    throw invalidArgument(`${field} exceeds ${MAX_JSON_BYTES} encoded bytes`);
  }
  return normalized;
}

export function canonicalJson(value, field = "value") {
  return JSON.stringify(normalizeJson(value, field));
}

export function normalizeEpochMs(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidArgument(
      `${field} must be a non-negative safe-integer epoch ms`,
    );
  }
  return value;
}

export function normalizeMaxAttempts(value = DEFAULT_MAX_ATTEMPTS) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_JOB_ATTEMPTS) {
    throw invalidArgument(
      `maxAttempts must be an integer between 1 and ${MAX_JOB_ATTEMPTS}`,
    );
  }
  return value;
}

export function normalizeHistoryLimit(value = DEFAULT_HISTORY_LIMIT) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidArgument("history limit must be a positive integer");
  }
  return Math.min(value, MAX_HISTORY_LIMIT);
}

/**
 * Stable identity for one logical firing. All adapters must supply the same
 * triggerKey for the same logical schedule. Including jobRevision prevents an
 * edited job from silently inheriting the old definition's idempotency slot.
 */
export function deriveOccurrenceIdentity({
  jobId,
  jobRevision,
  scheduledFor,
  triggerKey,
}) {
  const material = canonicalJson(
    {
      contractVersion: SCHEDULER_SCHEMA_VERSION,
      jobId: normalizeIdentifier(jobId, "jobId"),
      jobRevision:
        Number.isSafeInteger(jobRevision) && jobRevision >= 1
          ? jobRevision
          : (() => {
              throw invalidArgument("jobRevision must be a positive integer");
            })(),
      scheduledFor: normalizeEpochMs(scheduledFor, "scheduledFor"),
      triggerKey: normalizeIdentifier(triggerKey, "triggerKey"),
    },
    "occurrenceIdentity",
  );
  const digest = createHash("sha256")
    .update("chainlesschain.scheduler.occurrence.v1\0", "utf8")
    .update(material, "utf8")
    .digest("hex");
  return Object.freeze({
    occurrenceId: `occ_${digest}`,
    idempotencyKey: `scheduler:v1:${digest}`,
  });
}
