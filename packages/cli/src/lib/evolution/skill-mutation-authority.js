/**
 * Fail-closed, in-process authority for Skill candidate and active mutations.
 *
 * The authority deliberately does not accept a caller-selected role and does
 * not return a serializable bearer token. Identity/role resolution and
 * receipt authenticity are delegated to injected trusted ports. A successful
 * authorization returns an empty opaque object whose authority exists only in
 * this instance's WeakMap and which can be consumed exactly once. The returned
 * consumption receipt is content-addressed audit evidence, not a standalone
 * bearer credential; cross-process consumers must verify its audit head through
 * the trusted ledger rather than trusting its public digest alone.
 */

import { createHash } from "node:crypto";

export const SKILL_MUTATION_REQUEST_SCHEMA =
  "chainlesschain.skill-mutation-request/v2";
export const SKILL_MUTATION_CONSUME_SCHEMA =
  "chainlesschain.skill-mutation-consume/v1";
export const SKILL_MUTATION_PRINCIPAL_SCHEMA =
  "chainlesschain.skill-mutation-principal/v1";
export const SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA =
  "chainlesschain.skill-mutation-receipt-verification/v1";
export const SKILL_MUTATION_RECEIPT_BINDING_SCHEMA =
  "chainlesschain.skill-mutation-receipt-binding/v1";
export const SKILL_MUTATION_AUDIT_SCHEMA =
  "chainlesschain.skill-mutation-audit/v2";
export const SKILL_MUTATION_NONCE_CLAIM_SCHEMA =
  "chainlesschain.skill-mutation-nonce-claim/v1";
export const SKILL_MUTATION_NONCE_ACK_SCHEMA =
  "chainlesschain.skill-mutation-nonce-ack/v1";
export const SKILL_MUTATION_CONSUMPTION_RECEIPT_SCHEMA =
  "chainlesschain.skill-mutation-consumption-receipt/v1";

export const SKILL_MUTATION_REQUEST_INVALID_CODE =
  "CC_SKILL_MUTATION_REQUEST_INVALID";
export const SKILL_MUTATION_PRINCIPAL_INVALID_CODE =
  "CC_SKILL_MUTATION_PRINCIPAL_INVALID";
export const SKILL_MUTATION_RECEIPT_INVALID_CODE =
  "CC_SKILL_MUTATION_RECEIPT_INVALID";
export const SKILL_MUTATION_SCOPE_DENIED_CODE =
  "CC_SKILL_MUTATION_SCOPE_DENIED";
export const SKILL_MUTATION_REQUEST_EXPIRED_CODE =
  "CC_SKILL_MUTATION_REQUEST_EXPIRED";
export const SKILL_MUTATION_NONCE_REUSED_CODE =
  "CC_SKILL_MUTATION_NONCE_REUSED";
export const SKILL_MUTATION_NONCE_STORE_FAILED_CODE =
  "CC_SKILL_MUTATION_NONCE_STORE_FAILED";
export const SKILL_MUTATION_CAPABILITY_INVALID_CODE =
  "CC_SKILL_MUTATION_CAPABILITY_INVALID";
export const SKILL_MUTATION_CAPABILITY_REPLAYED_CODE =
  "CC_SKILL_MUTATION_CAPABILITY_REPLAYED";
export const SKILL_MUTATION_CAPABILITY_CONTEXT_MISMATCH_CODE =
  "CC_SKILL_MUTATION_CAPABILITY_CONTEXT_MISMATCH";
export const SKILL_MUTATION_CAPABILITY_EXPIRED_CODE =
  "CC_SKILL_MUTATION_CAPABILITY_EXPIRED";
export const SKILL_MUTATION_AUDIT_FAILED_CODE =
  "CC_SKILL_MUTATION_AUDIT_FAILED";

export const SKILL_MUTATION_ROLES = Object.freeze({
  PROMOTION_CONTROLLER: "promotion-controller",
  CANDIDATE_WRITER: "candidate-writer",
  PROPOSER: "proposer",
  LEARNING: "learning",
  SYNC: "sync",
  MANUAL_IMPORT: "manual-import",
});

export const SKILL_MUTATION_TARGET_SCOPES = Object.freeze({
  CANDIDATE: "candidate",
  ACTIVE: "active",
});

export const SKILL_MUTATION_RECEIPT_KINDS = Object.freeze([
  "candidate",
  "eval",
  "policy",
  "actor",
  "parent",
  "target",
]);

const MAX_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const ROLE_VALUES = new Set(Object.values(SKILL_MUTATION_ROLES));
const TARGET_VALUES = new Set(Object.values(SKILL_MUTATION_TARGET_SCOPES));
const CANDIDATE_ROLES = new Set([
  SKILL_MUTATION_ROLES.CANDIDATE_WRITER,
  SKILL_MUTATION_ROLES.PROPOSER,
  SKILL_MUTATION_ROLES.LEARNING,
  SKILL_MUTATION_ROLES.SYNC,
  SKILL_MUTATION_ROLES.MANUAL_IMPORT,
]);
const RECEIPT_KEYS = new Set(
  SKILL_MUTATION_RECEIPT_KINDS.map((kind) => `${kind}Receipt`),
);
const BINDING_KEYS = new Set(SKILL_MUTATION_RECEIPT_KINDS);
const REQUEST_INPUT_KEYS = new Set([
  "tenantId",
  "audience",
  "operationId",
  "skillName",
  "targetScope",
  "expectedTargetDigest",
  "expectedTargetRevision",
  "expiresAt",
  "nonce",
  "receipts",
]);
const REQUEST_KEYS = new Set([
  "schema",
  ...REQUEST_INPUT_KEYS,
  "requestDigest",
]);
const REQUEST_CONTEXT_KEYS = new Set([
  "tenantId",
  "audience",
  "operationId",
  "skillName",
  "targetScope",
  "expectedTargetDigest",
  "expectedTargetRevision",
  "expiresAt",
  "nonce",
  "requestDigest",
]);
const CONSUME_INPUT_KEYS = new Set([
  "tenantId",
  "audience",
  "operationId",
  "skillName",
  "targetScope",
  "expectedTargetDigest",
  "expectedTargetRevision",
  "expiresAt",
  "nonce",
]);
const CONSUME_KEYS = new Set(["schema", ...CONSUME_INPUT_KEYS]);
const PRINCIPAL_KEYS = new Set([
  "schema",
  "authenticated",
  "principalId",
  "role",
  "tenantId",
  "audience",
  "operationId",
  "requestDigest",
  "expiresAt",
]);
const VERIFICATION_KEYS = new Set(["schema", "verified", "bindings"]);
const RECEIPT_BINDING_KEYS = new Set([
  "schema",
  "kind",
  "receiptDigest",
  "principalId",
  "role",
  ...REQUEST_CONTEXT_KEYS,
]);
const AUDIT_KEYS = new Set([
  "schema",
  "phase",
  "decision",
  "code",
  "tenantId",
  "audience",
  "operationId",
  "skillName",
  "targetScope",
  "expectedTargetDigest",
  "expectedTargetRevision",
  "expiresAt",
  "nonce",
  "principalId",
  "role",
  "requestDigest",
  "occurredAt",
  "auditDigest",
]);
const AUDIT_ACK_KEYS = new Set([
  "persisted",
  "auditDigest",
  "headDigest",
  "sequence",
]);
const NONCE_CLAIM_KEYS = new Set([
  "schema",
  "tenantId",
  "audience",
  "operationId",
  "nonce",
  "requestDigest",
  "expiresAt",
  "claimedAt",
  "claimDigest",
]);
const NONCE_ACK_KEYS = new Set([
  "schema",
  "persisted",
  "claimed",
  "claimDigest",
  "expiresAt",
  "headDigest",
  "sequence",
]);
const CONSUMPTION_RECEIPT_KEYS = new Set([
  "schema",
  "consumed",
  "tenantId",
  "audience",
  "operationId",
  "skillName",
  "targetScope",
  "expectedTargetDigest",
  "expectedTargetRevision",
  "expiresAt",
  "nonce",
  "principalId",
  "role",
  "requestDigest",
  "contextDigest",
  "occurredAt",
  "auditDigest",
  "headDigest",
  "sequence",
  "receiptDigest",
]);
const AUDIT_PHASES = new Set(["authorize", "consume"]);
const AUDIT_DECISIONS = new Set(["allow", "deny"]);
const AUDIT_CODES = new Set([
  "CC_SKILL_MUTATION_AUTHORIZED",
  "CC_SKILL_MUTATION_CONSUMED",
  SKILL_MUTATION_REQUEST_INVALID_CODE,
  SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
  SKILL_MUTATION_RECEIPT_INVALID_CODE,
  SKILL_MUTATION_SCOPE_DENIED_CODE,
  SKILL_MUTATION_REQUEST_EXPIRED_CODE,
  SKILL_MUTATION_NONCE_REUSED_CODE,
  SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
  SKILL_MUTATION_CAPABILITY_INVALID_CODE,
  SKILL_MUTATION_CAPABILITY_REPLAYED_CODE,
  SKILL_MUTATION_CAPABILITY_CONTEXT_MISMATCH_CODE,
  SKILL_MUTATION_CAPABILITY_EXPIRED_CODE,
]);
const AUTHORIZE_DENIAL_CODES = new Set([
  SKILL_MUTATION_REQUEST_INVALID_CODE,
  SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
  SKILL_MUTATION_RECEIPT_INVALID_CODE,
  SKILL_MUTATION_SCOPE_DENIED_CODE,
  SKILL_MUTATION_REQUEST_EXPIRED_CODE,
  SKILL_MUTATION_NONCE_REUSED_CODE,
  SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
]);
const CONSUME_DENIAL_CODES = new Set([
  SKILL_MUTATION_REQUEST_INVALID_CODE,
  SKILL_MUTATION_CAPABILITY_INVALID_CODE,
  SKILL_MUTATION_CAPABILITY_REPLAYED_CODE,
  SKILL_MUTATION_CAPABILITY_CONTEXT_MISMATCH_CODE,
  SKILL_MUTATION_CAPABILITY_EXPIRED_CODE,
]);

export class SkillMutationAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillMutationAuthorityError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function authorityError(code, message, details = {}) {
  return new SkillMutationAuthorityError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactDataRecord(
  value,
  expectedKeys,
  label,
  code = SKILL_MUTATION_REQUEST_INVALID_CODE,
) {
  if (!isPlainObject(value)) {
    throw authorityError(code, `${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw authorityError(
      code,
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw authorityError(
        code,
        `${label}.${String(key)} must be an enumerable own data property`,
      );
    }
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function canonicalDigest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function normalizeBoundedString(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    [...value].some((character) => {
      const point = character.codePointAt(0);
      return point < 0x20 || point === 0x7f;
    })
  ) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      `${label} must be a non-empty bounded string without control characters`,
    );
  }
  return value;
}

function normalizeIdentifier(value, label) {
  const normalized = normalizeBoundedString(value, label);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      `${label} is not a valid identifier`,
    );
  }
  return normalized;
}

function normalizeSkillName(value) {
  const normalized = normalizeBoundedString(value, "skillName", 128);
  if (!SKILL_NAME_PATTERN.test(normalized)) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      "skillName must use kebab-case",
    );
  }
  return normalized;
}

function normalizeDigest(
  value,
  label,
  code = SKILL_MUTATION_REQUEST_INVALID_CODE,
) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw authorityError(code, `${label} must be a lowercase sha256 digest`);
  }
  return value;
}

function normalizeRevision(
  value,
  label,
  code = SKILL_MUTATION_REQUEST_INVALID_CODE,
) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw authorityError(code, `${label} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeIsoTimestamp(
  value,
  label,
  code = SKILL_MUTATION_REQUEST_INVALID_CODE,
) {
  if (typeof value !== "string") {
    throw authorityError(code, `${label} must be an ISO timestamp`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw authorityError(code, `${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function normalizeNonce(value) {
  if (typeof value !== "string" || !NONCE_PATTERN.test(value)) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      "nonce must contain 16-128 URL-safe characters",
    );
  }
  return value;
}

function normalizeTargetScope(value) {
  if (!TARGET_VALUES.has(value)) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      "targetScope must be candidate or active",
    );
  }
  return value;
}

function requiredReceiptKinds(targetScope) {
  return targetScope === SKILL_MUTATION_TARGET_SCOPES.ACTIVE
    ? new Set(SKILL_MUTATION_RECEIPT_KINDS)
    : new Set(["actor", "target"]);
}

function normalizeReceiptEnvelopes(value, targetScope) {
  assertExactDataRecord(value, RECEIPT_KEYS, "mutation receipt envelopes");
  const required = requiredReceiptKinds(targetScope);
  const normalized = {};
  for (const kind of SKILL_MUTATION_RECEIPT_KINDS) {
    const key = `${kind}Receipt`;
    const envelope = value[key];
    if (required.has(kind)) {
      normalized[key] = normalizeBoundedString(
        envelope,
        `${kind} receipt envelope`,
        4096,
      );
    } else if (envelope === null) {
      normalized[key] = null;
    } else {
      throw authorityError(
        SKILL_MUTATION_REQUEST_INVALID_CODE,
        `candidate mutation must not carry a ${kind} receipt envelope`,
      );
    }
  }
  return deepFreeze(normalized);
}

function requestCore(input) {
  assertExactDataRecord(input, REQUEST_INPUT_KEYS, "mutation request input");
  const targetScope = normalizeTargetScope(input.targetScope);
  return {
    schema: SKILL_MUTATION_REQUEST_SCHEMA,
    tenantId: normalizeIdentifier(input.tenantId, "tenantId"),
    audience: normalizeIdentifier(input.audience, "audience"),
    operationId: normalizeIdentifier(input.operationId, "operationId"),
    skillName: normalizeSkillName(input.skillName),
    targetScope,
    expectedTargetDigest: normalizeDigest(
      input.expectedTargetDigest,
      "expectedTargetDigest",
    ),
    expectedTargetRevision: normalizeRevision(
      input.expectedTargetRevision,
      "expectedTargetRevision",
    ),
    expiresAt: normalizeIsoTimestamp(input.expiresAt, "expiresAt"),
    nonce: normalizeNonce(input.nonce),
    receipts: normalizeReceiptEnvelopes(input.receipts, targetScope),
  };
}

export function buildSkillMutationRequest(input) {
  const core = requestCore(input);
  return deepFreeze({
    ...core,
    requestDigest: canonicalDigest(
      core,
      "chainlesschain.skill-mutation-request/v2",
    ),
  });
}

export function verifySkillMutationRequest(value) {
  assertExactDataRecord(value, REQUEST_KEYS, "mutation request");
  if (value.schema !== SKILL_MUTATION_REQUEST_SCHEMA) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      "mutation request schema is invalid",
    );
  }
  const normalized = buildSkillMutationRequest({
    tenantId: value.tenantId,
    audience: value.audience,
    operationId: value.operationId,
    skillName: value.skillName,
    targetScope: value.targetScope,
    expectedTargetDigest: value.expectedTargetDigest,
    expectedTargetRevision: value.expectedTargetRevision,
    expiresAt: value.expiresAt,
    nonce: value.nonce,
    receipts: value.receipts,
  });
  if (normalized.requestDigest !== value.requestDigest) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      "mutation request digest verification failed",
    );
  }
  return normalized;
}

function consumeCore(input) {
  assertExactDataRecord(input, CONSUME_INPUT_KEYS, "mutation consume input");
  return {
    schema: SKILL_MUTATION_CONSUME_SCHEMA,
    tenantId: normalizeIdentifier(input.tenantId, "tenantId"),
    audience: normalizeIdentifier(input.audience, "audience"),
    operationId: normalizeIdentifier(input.operationId, "operationId"),
    skillName: normalizeSkillName(input.skillName),
    targetScope: normalizeTargetScope(input.targetScope),
    expectedTargetDigest: normalizeDigest(
      input.expectedTargetDigest,
      "expectedTargetDigest",
    ),
    expectedTargetRevision: normalizeRevision(
      input.expectedTargetRevision,
      "expectedTargetRevision",
    ),
    expiresAt: normalizeIsoTimestamp(input.expiresAt, "expiresAt"),
    nonce: normalizeNonce(input.nonce),
  };
}

export function buildSkillMutationConsumeContext(input) {
  return deepFreeze(consumeCore(input));
}

function verifyConsumeContext(value) {
  assertExactDataRecord(value, CONSUME_KEYS, "mutation consume context");
  if (value.schema !== SKILL_MUTATION_CONSUME_SCHEMA) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      "mutation consume context schema is invalid",
    );
  }
  return buildSkillMutationConsumeContext({
    tenantId: value.tenantId,
    audience: value.audience,
    operationId: value.operationId,
    skillName: value.skillName,
    targetScope: value.targetScope,
    expectedTargetDigest: value.expectedTargetDigest,
    expectedTargetRevision: value.expectedTargetRevision,
    expiresAt: value.expiresAt,
    nonce: value.nonce,
  });
}

function requestContext(request) {
  return deepFreeze({
    tenantId: request.tenantId,
    audience: request.audience,
    operationId: request.operationId,
    skillName: request.skillName,
    targetScope: request.targetScope,
    expectedTargetDigest: request.expectedTargetDigest,
    expectedTargetRevision: request.expectedTargetRevision,
    expiresAt: request.expiresAt,
    nonce: request.nonce,
    requestDigest: request.requestDigest,
  });
}

function buildNonceClaim(request, claimedAt) {
  const core = {
    schema: SKILL_MUTATION_NONCE_CLAIM_SCHEMA,
    tenantId: request.tenantId,
    audience: request.audience,
    operationId: request.operationId,
    nonce: request.nonce,
    requestDigest: request.requestDigest,
    expiresAt: request.expiresAt,
    claimedAt,
  };
  return deepFreeze({
    ...core,
    claimDigest: canonicalDigest(
      core,
      "chainlesschain.skill-mutation-nonce-claim/v1",
    ),
  });
}

export function verifySkillMutationNonceClaim(value) {
  assertExactDataRecord(
    value,
    NONCE_CLAIM_KEYS,
    "mutation nonce claim",
    SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
  );
  const core = { ...value };
  delete core.claimDigest;
  if (
    core.schema !== SKILL_MUTATION_NONCE_CLAIM_SCHEMA ||
    normalizeIdentifier(core.tenantId, "nonce claim tenantId") !==
      core.tenantId ||
    normalizeIdentifier(core.audience, "nonce claim audience") !==
      core.audience ||
    normalizeIdentifier(core.operationId, "nonce claim operationId") !==
      core.operationId ||
    normalizeNonce(core.nonce) !== core.nonce ||
    normalizeDigest(
      core.requestDigest,
      "nonce claim requestDigest",
      SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
    ) !== core.requestDigest ||
    normalizeIsoTimestamp(
      core.expiresAt,
      "nonce claim expiresAt",
      SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
    ) !== core.expiresAt ||
    normalizeIsoTimestamp(
      core.claimedAt,
      "nonce claim claimedAt",
      SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
    ) !== core.claimedAt ||
    normalizeDigest(
      value.claimDigest,
      "nonce claim digest",
      SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
    ) !== canonicalDigest(core, "chainlesschain.skill-mutation-nonce-claim/v1")
  ) {
    throw authorityError(
      SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
      "mutation nonce claim is invalid",
    );
  }
  return deepFreeze({ ...core, claimDigest: value.claimDigest });
}

function normalizePrincipal(value, context) {
  assertExactDataRecord(
    value,
    PRINCIPAL_KEYS,
    "resolved mutation principal",
    SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
  );
  if (
    value.schema !== SKILL_MUTATION_PRINCIPAL_SCHEMA ||
    value.authenticated !== true ||
    !ROLE_VALUES.has(value.role)
  ) {
    throw authorityError(
      SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
      "resolved mutation principal is not authenticated or has an invalid role",
    );
  }
  let normalized;
  try {
    normalized = {
      schema: SKILL_MUTATION_PRINCIPAL_SCHEMA,
      authenticated: true,
      principalId: normalizeIdentifier(value.principalId, "principalId"),
      role: value.role,
      tenantId: normalizeIdentifier(value.tenantId, "principal tenantId"),
      audience: normalizeIdentifier(value.audience, "principal audience"),
      operationId: normalizeIdentifier(
        value.operationId,
        "principal operationId",
      ),
      requestDigest: normalizeDigest(
        value.requestDigest,
        "principal requestDigest",
        SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
      ),
      expiresAt: normalizeIsoTimestamp(
        value.expiresAt,
        "principal expiresAt",
        SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
      ),
    };
  } catch (cause) {
    throw authorityError(
      SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
      "resolved mutation principal contains invalid claims",
      { cause },
    );
  }
  for (const field of [
    "tenantId",
    "audience",
    "operationId",
    "requestDigest",
    "expiresAt",
  ]) {
    if (normalized[field] !== context[field]) {
      throw authorityError(
        SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
        `resolved principal is not bound to request ${field}`,
      );
    }
  }
  return deepFreeze(normalized);
}

function roleCanMutateTarget(role, targetScope) {
  return (
    (targetScope === SKILL_MUTATION_TARGET_SCOPES.CANDIDATE &&
      CANDIDATE_ROLES.has(role)) ||
    (targetScope === SKILL_MUTATION_TARGET_SCOPES.ACTIVE &&
      role === SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER)
  );
}

export function digestSkillMutationReceiptEnvelope(envelope) {
  const normalized = normalizeBoundedString(envelope, "receipt envelope", 4096);
  return canonicalDigest(
    normalized,
    "chainlesschain.skill-mutation-receipt-envelope/v1",
  );
}

function validateReceiptBinding(value, kind, request, principal, envelope) {
  assertExactDataRecord(
    value,
    RECEIPT_BINDING_KEYS,
    `${kind} receipt binding`,
    SKILL_MUTATION_RECEIPT_INVALID_CODE,
  );
  if (
    value.schema !== SKILL_MUTATION_RECEIPT_BINDING_SCHEMA ||
    value.kind !== kind ||
    value.receiptDigest !== digestSkillMutationReceiptEnvelope(envelope) ||
    value.principalId !== principal.principalId ||
    value.role !== principal.role
  ) {
    throw authorityError(
      SKILL_MUTATION_RECEIPT_INVALID_CODE,
      `${kind} receipt is not authenticated for the resolved principal`,
    );
  }
  const context = requestContext(request);
  for (const key of REQUEST_CONTEXT_KEYS) {
    if (value[key] !== context[key]) {
      throw authorityError(
        SKILL_MUTATION_RECEIPT_INVALID_CODE,
        `${kind} receipt is not bound to request ${key}`,
      );
    }
  }
  normalizeDigest(
    value.receiptDigest,
    `${kind} receipt digest`,
    SKILL_MUTATION_RECEIPT_INVALID_CODE,
  );
}

function normalizeReceiptVerification(value, request, principal) {
  assertExactDataRecord(
    value,
    VERIFICATION_KEYS,
    "receipt verification",
    SKILL_MUTATION_RECEIPT_INVALID_CODE,
  );
  if (
    value.schema !== SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA ||
    value.verified !== true
  ) {
    throw authorityError(
      SKILL_MUTATION_RECEIPT_INVALID_CODE,
      "receipt verifier did not return a verified result",
    );
  }
  assertExactDataRecord(
    value.bindings,
    BINDING_KEYS,
    "receipt verification bindings",
    SKILL_MUTATION_RECEIPT_INVALID_CODE,
  );
  const required = requiredReceiptKinds(request.targetScope);
  for (const kind of SKILL_MUTATION_RECEIPT_KINDS) {
    const envelope = request.receipts[`${kind}Receipt`];
    const binding = value.bindings[kind];
    if (!required.has(kind)) {
      if (binding !== null) {
        throw authorityError(
          SKILL_MUTATION_RECEIPT_INVALID_CODE,
          `unused ${kind} receipt binding must be null`,
        );
      }
      continue;
    }
    validateReceiptBinding(binding, kind, request, principal, envelope);
  }
}

function safeOwnValue(value, key) {
  try {
    if (!value || typeof value !== "object") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : null;
  } catch {
    return null;
  }
}

function safeAuditContext(value) {
  const revision = safeOwnValue(value, "expectedTargetRevision");
  const ownString = (key, maximum) => {
    const candidate = safeOwnValue(value, key);
    return typeof candidate === "string" ? candidate.slice(0, maximum) : null;
  };
  const digest = ownString("expectedTargetDigest", 71);
  const requestDigest = ownString("requestDigest", 71);
  return {
    tenantId: ownString("tenantId", 256),
    audience: ownString("audience", 256),
    operationId: ownString("operationId", 256),
    skillName: ownString("skillName", 128),
    targetScope: TARGET_VALUES.has(safeOwnValue(value, "targetScope"))
      ? safeOwnValue(value, "targetScope")
      : null,
    expectedTargetDigest: digest && DIGEST_PATTERN.test(digest) ? digest : null,
    expectedTargetRevision:
      Number.isSafeInteger(revision) && revision >= 0 ? revision : null,
    expiresAt: ownString("expiresAt", 64),
    nonce: ownString("nonce", 128),
    requestDigest:
      requestDigest && DIGEST_PATTERN.test(requestDigest)
        ? requestDigest
        : null,
  };
}

function buildAuditEvent({
  phase,
  decision,
  code,
  context,
  principal,
  occurredAt,
}) {
  const core = {
    schema: SKILL_MUTATION_AUDIT_SCHEMA,
    phase,
    decision,
    code,
    tenantId: context.tenantId,
    audience: context.audience,
    operationId: context.operationId,
    skillName: context.skillName,
    targetScope: context.targetScope,
    expectedTargetDigest: context.expectedTargetDigest,
    expectedTargetRevision: context.expectedTargetRevision,
    expiresAt: context.expiresAt,
    nonce: context.nonce,
    principalId: principal?.principalId || null,
    role: principal?.role || null,
    requestDigest: context.requestDigest,
    occurredAt,
  };
  return deepFreeze({
    ...core,
    auditDigest: canonicalDigest(
      core,
      "chainlesschain.skill-mutation-audit/v2",
    ),
  });
}

export function verifySkillMutationAuditEvent(value) {
  assertExactDataRecord(value, AUDIT_KEYS, "mutation audit event");
  const core = { ...value };
  delete core.auditDigest;
  const expectedAllowCode =
    core.phase === "authorize"
      ? "CC_SKILL_MUTATION_AUTHORIZED"
      : "CC_SKILL_MUTATION_CONSUMED";
  const denialCodes =
    core.phase === "authorize" ? AUTHORIZE_DENIAL_CODES : CONSUME_DENIAL_CODES;
  if (
    core.schema !== SKILL_MUTATION_AUDIT_SCHEMA ||
    !AUDIT_PHASES.has(core.phase) ||
    !AUDIT_DECISIONS.has(core.decision) ||
    !AUDIT_CODES.has(core.code) ||
    (core.decision === "allow" && core.code !== expectedAllowCode) ||
    (core.decision === "deny" && !denialCodes.has(core.code)) ||
    (core.role !== null && !ROLE_VALUES.has(core.role)) ||
    (core.principalId !== null && typeof core.principalId !== "string") ||
    (core.requestDigest !== null && !DIGEST_PATTERN.test(core.requestDigest)) ||
    normalizeIsoTimestamp(
      core.occurredAt,
      "audit occurredAt",
      SKILL_MUTATION_REQUEST_INVALID_CODE,
    ) !== core.occurredAt ||
    canonicalDigest(core, "chainlesschain.skill-mutation-audit/v2") !==
      value.auditDigest
  ) {
    throw authorityError(
      SKILL_MUTATION_REQUEST_INVALID_CODE,
      "mutation audit event is invalid",
    );
  }
  if (core.decision === "allow") {
    try {
      normalizeIdentifier(core.tenantId, "audit tenantId");
      normalizeIdentifier(core.audience, "audit audience");
      normalizeIdentifier(core.operationId, "audit operationId");
      normalizeSkillName(core.skillName);
      normalizeTargetScope(core.targetScope);
      normalizeDigest(core.expectedTargetDigest, "audit target digest");
      normalizeRevision(core.expectedTargetRevision, "audit target revision");
      normalizeIsoTimestamp(core.expiresAt, "audit expiresAt");
      normalizeNonce(core.nonce);
      normalizeIdentifier(core.principalId, "audit principalId");
      normalizeDigest(core.requestDigest, "audit requestDigest");
      if (!roleCanMutateTarget(core.role, core.targetScope)) {
        throw authorityError(
          SKILL_MUTATION_REQUEST_INVALID_CODE,
          "audit role cannot mutate target scope",
        );
      }
    } catch (cause) {
      throw authorityError(
        SKILL_MUTATION_REQUEST_INVALID_CODE,
        "allow audit event must contain a complete authorized context",
        { cause },
      );
    }
  }
  return deepFreeze({ ...core, auditDigest: value.auditDigest });
}

function buildConsumptionReceipt(context, principal, clock, audit) {
  const contextDigest = canonicalDigest(
    context,
    "chainlesschain.skill-mutation-consume-context/v1",
  );
  const core = {
    schema: SKILL_MUTATION_CONSUMPTION_RECEIPT_SCHEMA,
    consumed: true,
    tenantId: context.tenantId,
    audience: context.audience,
    operationId: context.operationId,
    skillName: context.skillName,
    targetScope: context.targetScope,
    expectedTargetDigest: context.expectedTargetDigest,
    expectedTargetRevision: context.expectedTargetRevision,
    expiresAt: context.expiresAt,
    nonce: context.nonce,
    principalId: principal.principalId,
    role: principal.role,
    requestDigest: context.requestDigest,
    contextDigest,
    occurredAt: clock.iso,
    auditDigest: audit.event.auditDigest,
    headDigest: audit.acknowledgement.headDigest,
    sequence: audit.acknowledgement.sequence,
  };
  return deepFreeze({
    ...core,
    receiptDigest: canonicalDigest(
      core,
      "chainlesschain.skill-mutation-consumption-receipt/v1",
    ),
  });
}

export function verifySkillMutationConsumptionReceipt(value) {
  assertExactDataRecord(
    value,
    CONSUMPTION_RECEIPT_KEYS,
    "mutation consumption receipt",
    SKILL_MUTATION_CAPABILITY_INVALID_CODE,
  );
  const core = { ...value };
  delete core.receiptDigest;
  try {
    if (
      core.schema !== SKILL_MUTATION_CONSUMPTION_RECEIPT_SCHEMA ||
      core.consumed !== true ||
      normalizeIdentifier(core.tenantId, "receipt tenantId") !==
        core.tenantId ||
      normalizeIdentifier(core.audience, "receipt audience") !==
        core.audience ||
      normalizeIdentifier(core.operationId, "receipt operationId") !==
        core.operationId ||
      normalizeSkillName(core.skillName) !== core.skillName ||
      normalizeTargetScope(core.targetScope) !== core.targetScope ||
      normalizeDigest(core.expectedTargetDigest, "receipt target digest") !==
        core.expectedTargetDigest ||
      normalizeRevision(core.expectedTargetRevision, "receipt revision") !==
        core.expectedTargetRevision ||
      normalizeIsoTimestamp(core.expiresAt, "receipt expiresAt") !==
        core.expiresAt ||
      normalizeNonce(core.nonce) !== core.nonce ||
      normalizeIdentifier(core.principalId, "receipt principalId") !==
        core.principalId ||
      !ROLE_VALUES.has(core.role) ||
      !roleCanMutateTarget(core.role, core.targetScope) ||
      normalizeDigest(core.requestDigest, "receipt requestDigest") !==
        core.requestDigest ||
      normalizeDigest(core.contextDigest, "receipt contextDigest") !==
        core.contextDigest ||
      normalizeIsoTimestamp(core.occurredAt, "receipt occurredAt") !==
        core.occurredAt ||
      normalizeDigest(core.auditDigest, "receipt auditDigest") !==
        core.auditDigest ||
      normalizeDigest(core.headDigest, "receipt headDigest") !==
        core.headDigest ||
      normalizeRevision(core.sequence, "receipt sequence") !== core.sequence ||
      core.sequence < 1 ||
      normalizeDigest(value.receiptDigest, "receiptDigest") !==
        canonicalDigest(
          core,
          "chainlesschain.skill-mutation-consumption-receipt/v1",
        )
    ) {
      throw authorityError(
        SKILL_MUTATION_CAPABILITY_INVALID_CODE,
        "mutation consumption receipt is invalid",
      );
    }
    const context = {
      tenantId: core.tenantId,
      audience: core.audience,
      operationId: core.operationId,
      skillName: core.skillName,
      targetScope: core.targetScope,
      expectedTargetDigest: core.expectedTargetDigest,
      expectedTargetRevision: core.expectedTargetRevision,
      expiresAt: core.expiresAt,
      nonce: core.nonce,
      requestDigest: core.requestDigest,
    };
    if (
      canonicalDigest(
        context,
        "chainlesschain.skill-mutation-consume-context/v1",
      ) !== core.contextDigest
    ) {
      throw authorityError(
        SKILL_MUTATION_CAPABILITY_INVALID_CODE,
        "mutation consumption receipt context digest is invalid",
      );
    }
  } catch (cause) {
    if (
      cause instanceof SkillMutationAuthorityError &&
      cause.code === SKILL_MUTATION_CAPABILITY_INVALID_CODE
    ) {
      throw cause;
    }
    throw authorityError(
      SKILL_MUTATION_CAPABILITY_INVALID_CODE,
      "mutation consumption receipt is invalid",
      { cause },
    );
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeDenial(error, fallbackCode, fallbackMessage) {
  return error instanceof SkillMutationAuthorityError
    ? error
    : authorityError(fallbackCode, fallbackMessage, { cause: error });
}

function contextsMatch(request, consume) {
  for (const key of CONSUME_INPUT_KEYS) {
    if (request[key] !== consume[key]) return false;
  }
  return true;
}

export class SkillMutationAuthority {
  #capabilities = new WeakMap();

  #principalResolver;

  #receiptVerifier;

  #auditSink;

  #nonceStore;

  #now;

  constructor({
    principalResolver,
    receiptVerifier,
    auditSink,
    nonceStore,
    now,
  } = {}) {
    if (!principalResolver || typeof principalResolver.resolve !== "function") {
      throw new TypeError(
        "SkillMutationAuthority requires a trusted principalResolver.resolve port",
      );
    }
    if (!receiptVerifier || typeof receiptVerifier.verify !== "function") {
      throw new TypeError(
        "SkillMutationAuthority requires a trusted receiptVerifier.verify port",
      );
    }
    if (!auditSink || typeof auditSink.append !== "function") {
      throw new TypeError(
        "SkillMutationAuthority requires a durable auditSink.append port",
      );
    }
    if (!nonceStore || typeof nonceStore.claim !== "function") {
      throw new TypeError(
        "SkillMutationAuthority requires a durable nonceStore.claim port",
      );
    }
    if (now !== undefined && typeof now !== "function") {
      throw new TypeError("SkillMutationAuthority now must be a function");
    }
    this.#principalResolver = principalResolver.resolve.bind(principalResolver);
    this.#receiptVerifier = receiptVerifier.verify.bind(receiptVerifier);
    this.#auditSink = auditSink.append.bind(auditSink);
    this.#nonceStore = nonceStore.claim.bind(nonceStore);
    this.#now = now || (() => new Date());
    Object.freeze(this);
  }

  #clock() {
    const value = this.#now();
    const date =
      value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw authorityError(
        SKILL_MUTATION_AUDIT_FAILED_CODE,
        "Skill mutation authority clock returned an invalid timestamp",
      );
    }
    return { milliseconds: date.getTime(), iso: date.toISOString() };
  }

  async #appendAudit(event) {
    const verifiedEvent = verifySkillMutationAuditEvent(event);
    let acknowledgement;
    try {
      acknowledgement = await this.#auditSink(verifiedEvent);
      assertExactDataRecord(
        acknowledgement,
        AUDIT_ACK_KEYS,
        "mutation audit acknowledgement",
        SKILL_MUTATION_AUDIT_FAILED_CODE,
      );
      if (
        acknowledgement.persisted !== true ||
        acknowledgement.auditDigest !== verifiedEvent.auditDigest ||
        !DIGEST_PATTERN.test(acknowledgement.headDigest || "") ||
        !Number.isSafeInteger(acknowledgement.sequence) ||
        acknowledgement.sequence < 1
      ) {
        throw authorityError(
          SKILL_MUTATION_AUDIT_FAILED_CODE,
          "mutation audit acknowledgement is not durable or bound to the event",
        );
      }
    } catch (cause) {
      if (
        cause instanceof SkillMutationAuthorityError &&
        cause.code === SKILL_MUTATION_AUDIT_FAILED_CODE
      ) {
        throw cause;
      }
      throw authorityError(
        SKILL_MUTATION_AUDIT_FAILED_CODE,
        "Skill mutation audit append failed; authority is denied",
        { cause, auditDigest: verifiedEvent.auditDigest },
      );
    }
    return deepFreeze({ ...acknowledgement });
  }

  async #audit({ phase, decision, code, context, principal, clock }) {
    const event = buildAuditEvent({
      phase,
      decision,
      code,
      context,
      principal,
      occurredAt: clock.iso,
    });
    const acknowledgement = await this.#appendAudit(event);
    return { event, acknowledgement };
  }

  async #claimNonce(request, clock) {
    const claim = buildNonceClaim(request, clock.iso);
    let acknowledgement;
    try {
      acknowledgement = await this.#nonceStore(claim);
      assertExactDataRecord(
        acknowledgement,
        NONCE_ACK_KEYS,
        "mutation nonce acknowledgement",
        SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
      );
      if (
        acknowledgement.schema !== SKILL_MUTATION_NONCE_ACK_SCHEMA ||
        acknowledgement.persisted !== true ||
        typeof acknowledgement.claimed !== "boolean" ||
        acknowledgement.claimDigest !== claim.claimDigest ||
        acknowledgement.expiresAt !== claim.expiresAt ||
        !DIGEST_PATTERN.test(acknowledgement.headDigest || "") ||
        !Number.isSafeInteger(acknowledgement.sequence) ||
        acknowledgement.sequence < 1
      ) {
        throw authorityError(
          SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
          "mutation nonce acknowledgement is not durable or bound to the claim",
        );
      }
    } catch (cause) {
      if (
        cause instanceof SkillMutationAuthorityError &&
        cause.code === SKILL_MUTATION_NONCE_STORE_FAILED_CODE
      ) {
        throw cause;
      }
      throw authorityError(
        SKILL_MUTATION_NONCE_STORE_FAILED_CODE,
        "Skill mutation nonce claim failed; authority is denied",
        { cause, claimDigest: claim.claimDigest },
      );
    }
    if (!acknowledgement.claimed) {
      throw authorityError(
        SKILL_MUTATION_NONCE_REUSED_CODE,
        "Skill mutation request nonce has already been durably claimed",
      );
    }
    return deepFreeze({ ...acknowledgement });
  }

  async authorize(value) {
    let request = null;
    let context = safeAuditContext(value);
    let principal = null;
    let clock;
    try {
      clock = this.#clock();
      request = verifySkillMutationRequest(value);
      context = requestContext(request);
      const expiry = new Date(request.expiresAt).getTime();
      if (expiry <= clock.milliseconds) {
        throw authorityError(
          SKILL_MUTATION_REQUEST_EXPIRED_CODE,
          "Skill mutation request has expired",
        );
      }
      if (expiry - clock.milliseconds > MAX_AUTHORIZATION_TTL_MS) {
        throw authorityError(
          SKILL_MUTATION_REQUEST_INVALID_CODE,
          "Skill mutation request expiry exceeds the maximum authority TTL",
        );
      }

      let resolved;
      try {
        resolved = await this.#principalResolver(
          deepFreeze({ request: context }),
        );
      } catch (cause) {
        throw authorityError(
          SKILL_MUTATION_PRINCIPAL_INVALID_CODE,
          "Skill mutation principal resolution failed",
          { cause },
        );
      }
      principal = normalizePrincipal(resolved, context);
      if (!roleCanMutateTarget(principal.role, request.targetScope)) {
        throw authorityError(
          SKILL_MUTATION_SCOPE_DENIED_CODE,
          `${principal.role} cannot mutate the ${request.targetScope} Skill scope`,
          { role: principal.role, targetScope: request.targetScope },
        );
      }

      let verifiedReceipts;
      try {
        verifiedReceipts = await this.#receiptVerifier(
          deepFreeze({
            receipts: request.receipts,
            request: context,
            principal,
          }),
        );
      } catch (cause) {
        throw authorityError(
          SKILL_MUTATION_RECEIPT_INVALID_CODE,
          "Skill mutation receipt verification failed",
          { cause },
        );
      }
      normalizeReceiptVerification(verifiedReceipts, request, principal);

      clock = this.#clock();
      if (expiry <= clock.milliseconds) {
        throw authorityError(
          SKILL_MUTATION_REQUEST_EXPIRED_CODE,
          "Skill mutation request expired during verification",
        );
      }
      await this.#claimNonce(request, clock);

      await this.#audit({
        phase: "authorize",
        decision: "allow",
        code: "CC_SKILL_MUTATION_AUTHORIZED",
        context,
        principal,
        clock,
      });
      clock = this.#clock();
      if (expiry <= clock.milliseconds) {
        throw authorityError(
          SKILL_MUTATION_REQUEST_EXPIRED_CODE,
          "Skill mutation request expired before capability issuance",
        );
      }

      const capability = Object.freeze(Object.create(null));
      this.#capabilities.set(capability, {
        status: "issued",
        request,
        principal,
      });
      return capability;
    } catch (error) {
      if (
        error instanceof SkillMutationAuthorityError &&
        error.code === SKILL_MUTATION_AUDIT_FAILED_CODE
      ) {
        throw error;
      }
      const denial = normalizeDenial(
        error,
        SKILL_MUTATION_REQUEST_INVALID_CODE,
        "Skill mutation authorization failed",
      );
      clock ||= this.#clock();
      await this.#audit({
        phase: "authorize",
        decision: "deny",
        code: AUDIT_CODES.has(denial.code)
          ? denial.code
          : SKILL_MUTATION_REQUEST_INVALID_CODE,
        context,
        principal,
        clock,
      });
      throw denial;
    }
  }

  async consume(capability, value) {
    let consume = null;
    let context = safeAuditContext(value);
    let state = null;
    let principal = null;
    let clock = this.#clock();
    try {
      consume = verifyConsumeContext(value);
      context = { ...consume, requestDigest: null };
      delete context.schema;
      state =
        capability && typeof capability === "object"
          ? this.#capabilities.get(capability)
          : null;
      if (!state) {
        throw authorityError(
          SKILL_MUTATION_CAPABILITY_INVALID_CODE,
          "Skill mutation capability is forged or belongs to another authority instance",
        );
      }
      principal = state.principal;
      context.requestDigest = state.request.requestDigest;
      if (state.status !== "issued") {
        throw authorityError(
          SKILL_MUTATION_CAPABILITY_REPLAYED_CODE,
          "Skill mutation capability has already been consumed",
        );
      }
      if (!contextsMatch(state.request, consume)) {
        throw authorityError(
          SKILL_MUTATION_CAPABILITY_CONTEXT_MISMATCH_CODE,
          "Skill mutation capability does not match the requested tenant, audience, operation, Skill, or CAS target",
        );
      }
      if (new Date(state.request.expiresAt).getTime() <= clock.milliseconds) {
        state.status = "expired";
        throw authorityError(
          SKILL_MUTATION_CAPABILITY_EXPIRED_CODE,
          "Skill mutation capability has expired",
        );
      }

      state.status = "consuming";
      const audit = await this.#audit({
        phase: "consume",
        decision: "allow",
        code: "CC_SKILL_MUTATION_CONSUMED",
        context,
        principal,
        clock,
      });
      clock = this.#clock();
      if (new Date(state.request.expiresAt).getTime() <= clock.milliseconds) {
        state.status = "expired";
        throw authorityError(
          SKILL_MUTATION_CAPABILITY_EXPIRED_CODE,
          "Skill mutation capability expired before durable consumption completed",
        );
      }
      const receipt = buildConsumptionReceipt(context, principal, clock, audit);
      state.status = "consumed";
      return receipt;
    } catch (error) {
      if (
        error instanceof SkillMutationAuthorityError &&
        error.code === SKILL_MUTATION_AUDIT_FAILED_CODE
      ) {
        throw error;
      }
      const denial = normalizeDenial(
        error,
        SKILL_MUTATION_CAPABILITY_INVALID_CODE,
        "Skill mutation capability consumption failed",
      );
      await this.#audit({
        phase: "consume",
        decision: "deny",
        code: AUDIT_CODES.has(denial.code)
          ? denial.code
          : SKILL_MUTATION_CAPABILITY_INVALID_CODE,
        context,
        principal,
        clock,
      });
      throw denial;
    }
  }
}

Object.freeze(SkillMutationAuthority.prototype);
