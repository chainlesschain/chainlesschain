import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
  EvolutionEvalGate,
  EvolutionEvalReceiptVerifier,
  computeEvolutionEvalContextDigest,
  runEvolutionEvalGate,
  verifyEvolutionEvalReceipt,
} from "./evolution-eval-gate.js";
import { isEvolutionEvalChildEvidenceStore } from "./evolution-eval-child-evidence-ledger-adapter.js";
import {
  verifySkillDependencyLock,
  verifySkillRuntimeManifest,
  verifySkillTargetMatrix,
} from "./skill-execution-manifest.js";

export const SKILL_TARGET_MATRIX_EVAL_PLAN_SCHEMA =
  "chainlesschain.skill-target-matrix-eval-plan/v2";
export const SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA =
  "chainlesschain.skill-target-matrix-eval-receipt/v2";
export const SKILL_TARGET_MATRIX_EVAL_PLAN_RESOLUTION_SCHEMA =
  "chainlesschain.skill-target-matrix-eval-plan-resolution/v1";
export const SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA =
  "chainlesschain.skill-target-matrix-eval-reservation/v1";
export const SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA =
  "chainlesschain.skill-target-matrix-eval-finalization/v1";

export const SKILL_TARGET_MATRIX_EVAL_INVALID_CODE =
  "CC_SKILL_TARGET_MATRIX_EVAL_INVALID";
export const SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE =
  "CC_SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED";
export const SKILL_TARGET_MATRIX_EVAL_REPLAYED_CODE =
  "CC_SKILL_TARGET_MATRIX_EVAL_REPLAYED";
export const SKILL_TARGET_MATRIX_EVAL_DEADLINE_CODE =
  "CC_SKILL_TARGET_MATRIX_EVAL_DEADLINE";

/**
 * This module commits trusted composition metadata and performs an all-cell
 * conjunction with a preregistered family-wise confidence correction. It is
 * not a proof of JavaScript callable bytes or a production grader deployment.
 */
export const SKILL_TARGET_MATRIX_EVAL_FOUNDATION_SEMANTICS = Object.freeze({
  kind: "trusted-composition-configuration-commitment",
  decision: "all-cells-conjunction",
  cellSettlement:
    "trusted-composition-bound-total-settlement-window-before-root-deadline",
  crossCellStatistics: "bonferroni-two-sided-family-wise-confidence",
  requiresAttestedLoader: true,
  residuals: Object.freeze([
    "cross-platform sandbox deployment",
    "production PKI and durable plan authority",
    "versioned target corpus and operating-system matrix",
  ]),
});

const PLAN_SIGNATURE_PURPOSE = "skill-target-matrix-eval-plan";
const RESERVATION_SIGNATURE_PURPOSE = "skill-target-matrix-eval-reservation";
const FINALIZATION_SIGNATURE_PURPOSE = "skill-target-matrix-eval-finalization";
const RECEIPT_SIGNATURE_PURPOSE = "skill-target-matrix-eval-receipt";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const PLAN_REF_PATTERN = /^[a-z][a-z0-9+.-]{1,31}:[^\s\\]{1,1024}$/u;
const MAX_CELLS = 64;
const MAX_REASON_CODES = 8;
const MAX_CANONICAL_DEPTH = 32;
const MAX_CANONICAL_NODES = 100_000;
const MAX_CANONICAL_BYTES = 16 * 1024 * 1024;
const MAX_STRING_CHARS = 1_048_576;
const MAX_SIGNATURE_CHARS = 16_384;
const MAX_PLAN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RECEIPT_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5_000;

const NATIVE_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const NATIVE_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const NATIVE_PROMISE = globalThis.Promise;
const NATIVE_PROMISE_RACE = NATIVE_PROMISE.race.bind(NATIVE_PROMISE);
const NATIVE_PROMISE_THEN = NATIVE_PROMISE.prototype.then;
const NATIVE_MONOTONIC_NOW = globalThis.performance.now.bind(
  globalThis.performance,
);

const PLAN_INPUT_KEYS = new Set([
  "matrixEvalId",
  "nonce",
  "tenantId",
  "skillName",
  "candidateId",
  "candidateContentDigest",
  "baselineId",
  "baselineReleaseDigest",
  "expectedActiveContentDigest",
  "expectedActiveRevision",
  "dependencyLockDigest",
  "runtimeManifestDigest",
  "targetMatrixRoot",
  "matrixAuthorityRoot",
  "maxTotalWallClockMs",
  "aggregateReceiptTtlMs",
  "familywiseErrorRate",
  "comparisonCorrection",
  "issuedAt",
  "expiresAt",
  "cells",
]);
const PLAN_KEYS = new Set(["schema", ...PLAN_INPUT_KEYS, "planDigest"]);
const PLAN_CELL_KEYS = new Set([
  "cellId",
  "invocationId",
  "invocationNonce",
  "runtimeId",
  "targetEnvironmentRef",
  "environmentDigest",
  "suiteRef",
  "suiteDigest",
  "policyDigest",
  "evaluationAuthorityRoot",
  "provenanceAudience",
  "trainerAuthority",
  "trainerRevision",
  "maximumCellSettlementMs",
]);
const PLAN_REF_KEYS = new Set(["ref", "digest"]);
const TRUST_KEYS = new Set([
  "algorithm",
  "issuer",
  "keyId",
  "trustPolicyDigest",
]);
const ATTESTATION_KEYS = new Set([...TRUST_KEYS, "value"]);
const POLICY_KEYS = new Set(["trust", "revision"]);
const AUTHORITY_DESCRIPTOR_KEYS = new Set([
  "schema",
  "handlerId",
  "handlerRevision",
  "operation",
  "handlerArtifactDigest",
  "authority",
]);
const PLAN_RESOLVER_KEYS = new Set(["resolve", "authorityDescriptor"]);
const VERIFY_PORT_KEYS = new Set(["verify", "authorityDescriptor"]);
const SIGN_PORT_KEYS = new Set(["sign", "authorityDescriptor"]);
const CLOCK_PORT_KEYS = new Set(["now", "authorityDescriptor"]);
const SUPERVISOR_PORT_KEYS = new Set(["run", "authorityDescriptor"]);
const CHILD_RECEIPT_STORE_DESCRIPTOR_KEYS = new Set([
  "tenantId",
  "streamId",
  "authorityId",
  "revision",
  "handlerArtifactDigest",
]);
const RESERVATION_PORT_KEYS = new Set([
  "reserve",
  "finalize",
  "reservationDescriptor",
  "finalizationDescriptor",
]);
const AGGREGATOR_OPTION_KEYS = new Set([
  "tenantId",
  "dependencyLock",
  "runtimeManifest",
  "targetMatrix",
  "expectedEnvironmentBindings",
  "expectedTargetMatrixRoot",
  "cellRuntimes",
  "planResolver",
  "planResolverPolicy",
  "planTrust",
  "evidenceVerifier",
  "evidenceVerifierPolicy",
  "reservationAuthority",
  "reservationPolicy",
  "matrixSupervisor",
  "supervisorPolicy",
  "matrixReceiptSigner",
  "matrixReceiptVerifier",
  "matrixReceiptTrust",
  "clock",
  "clockPolicy",
  "maximumMatrixWallClockMs",
  "childReceiptStore",
]);
const CELL_RUNTIME_KEYS = new Set([
  "gate",
  "receiptVerifier",
  "suiteRef",
  "suiteDigest",
  "policyDigest",
  "evaluationAuthorityRoot",
  "provenanceAudience",
  "trainerAuthority",
  "trainerRevision",
  "maximumCellSettlementMs",
  "gateDescriptor",
  "receiptVerifierDescriptor",
]);
const PLAN_RESOLUTION_KEYS = new Set([
  "schema",
  "requestDigest",
  "planRef",
  "plan",
  "planAttestation",
  "resolverRevision",
  "resolvedAt",
]);
const RESERVATION_KEYS = new Set([
  "schema",
  "tenantId",
  "matrixEvalId",
  "planDigest",
  "planNonce",
  "matrixAuthorityRoot",
  "requestDigest",
  "reservationId",
  "reservedAt",
  "expiresAt",
  "authorityRevision",
  "attestation",
  "receiptDigest",
]);
const FINALIZATION_KEYS = new Set([
  "schema",
  "tenantId",
  "matrixEvalId",
  "planDigest",
  "reservationId",
  "reservationReceiptDigest",
  "decisionCommitmentDigest",
  "requestDigest",
  "finalizedAt",
  "authorityRevision",
  "attestation",
  "receiptDigest",
]);
const CELL_RESULT_KEYS = new Set([
  ...PLAN_CELL_KEYS,
  "runId",
  "runNonce",
  "evaluationContextDigest",
  "childReceiptDigest",
  "childFullDigest",
  "confidenceZ",
  "decision",
  "reasonCodes",
  "issuedAt",
  "expiresAt",
]);
const RECEIPT_KEYS = new Set([
  "schema",
  "matrixEvalId",
  "nonce",
  "tenantId",
  "skillName",
  "candidateId",
  "candidateContentDigest",
  "baselineId",
  "baselineReleaseDigest",
  "expectedActiveContentDigest",
  "expectedActiveRevision",
  "dependencyLockDigest",
  "runtimeManifestDigest",
  "targetMatrixRoot",
  "matrixAuthorityRoot",
  "planDigest",
  "planIssuedAt",
  "planExpiresAt",
  "aggregateReceiptTtlMs",
  "familywiseErrorRate",
  "comparisonCorrection",
  "planAuthentication",
  "reservation",
  "finalization",
  "cellCount",
  "cellResults",
  "childReceiptRoot",
  "decisionCommitmentDigest",
  "decision",
  "reasonCodes",
  "issuedAt",
  "expiresAt",
  "receiptDigest",
  "attestation",
]);
const PLAN_AUTH_KEYS = new Set([
  "planRef",
  "resolverDescriptorDigest",
  "verifierDescriptorDigest",
  "planAttestation",
  "verifiedAt",
  "evidenceDigest",
]);
const EXPECTED_RECEIPT_KEYS = new Set([
  "matrixEvalId",
  "tenantId",
  "skillName",
  "candidateId",
  "candidateContentDigest",
  "baselineId",
  "baselineReleaseDigest",
  "expectedActiveContentDigest",
  "expectedActiveRevision",
  "dependencyLockDigest",
  "runtimeManifestDigest",
  "targetMatrixRoot",
  "matrixAuthorityRoot",
  "planDigest",
  "decision",
]);
const RECEIPT_VERIFIER_OPTION_KEYS = new Set([
  "matrixReceiptVerifier",
  "matrixReceiptSignerDescriptor",
  "matrixReceiptTrust",
  "matrixSupervisor",
  "supervisorPolicy",
  "clock",
  "clockPolicy",
  "maximumReceiptTtlMs",
  "maximumVerificationMs",
]);
const AUTHORITY_ROOT_INPUT_KEYS = new Set([
  "planResolverDescriptor",
  "evidenceVerifierDescriptor",
  "reservationDescriptor",
  "finalizationDescriptor",
  "supervisorDescriptor",
  "matrixSignerDescriptor",
  "matrixVerifierDescriptor",
  "clockDescriptor",
  "planTrust",
  "matrixReceiptTrust",
  "cellAuthorities",
  "childReceiptStoreDescriptor",
]);
const CELL_AUTHORITY_KEYS = new Set([
  "cellId",
  "gateDescriptor",
  "receiptVerifierDescriptor",
  "policyDigest",
  "evaluationAuthorityRoot",
  "maximumCellSettlementMs",
]);

const AGGREGATOR_INSTANCES = new WeakSet();
const RECEIPT_VERIFIER_INSTANCES = new WeakSet();

export class SkillTargetMatrixEvalError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillTargetMatrixEvalError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function matrixError(code, message, details = {}) {
  return new SkillTargetMatrixEvalError(code, message, details);
}

function rejectProxy(value, label) {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    utilTypes.isProxy(value)
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must not be a Proxy`,
    );
  }
}

function assertExactRecord(value, keys, label) {
  rejectProxy(value, label);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be a plain object`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be a plain object`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `${label}.${String(key)} must be an enumerable own data property`,
      );
    }
  }
}

function ownData(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label}.${key} must be an enumerable own data property`,
    );
  }
  return descriptor.value;
}

function assertDenseStandardArray(value, label, { minimum = 0, maximum }) {
  rejectProxy(value, label);
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be a standard array`,
    );
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} length is invalid`,
    );
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== length + 1 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be dense and contain no extra fields`,
    );
  }
  const output = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `${label}[${index}] must be an enumerable own data property`,
      );
    }
    output.push(descriptor.value);
  }
  return output;
}

function normalizeId(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !SAFE_ID_PATTERN.test(value)
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} is invalid`,
    );
  }
  return value;
}

function normalizeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function normalizeNullableDigest(value, label) {
  return value === null ? null : normalizeDigest(value, label);
}

function normalizeInteger(value, label, { minimum = 0, maximum } = {}) {
  const upper = maximum ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < minimum || value > upper) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be an integer in range`,
    );
  }
  return value;
}

function normalizeFinite(value, label, { minimum, maximum } = {}) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum) ||
    (maximum !== undefined && value > maximum)
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be a finite number in range`,
    );
  }
  return value;
}

// Peter J. Acklam's rational approximation. The returned quantile is used
// only to verify a preregistered confidence bound, never to manufacture one
// after observing evaluation outcomes.
function standardNormalQuantile(probability) {
  const p = normalizeFinite(probability, "normal quantile probability", {
    minimum: Number.EPSILON,
    maximum: 1 - Number.EPSILON,
  });
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
  ];
  const low = 0.02425;
  const high = 1 - low;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > high) return -standardNormalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function requiredFamilywiseConfidenceZ(familywiseErrorRate, cellCount) {
  const comparisonCount = cellCount * 2;
  return standardNormalQuantile(
    1 - familywiseErrorRate / (2 * comparisonCount),
  );
}

function normalizeTimestamp(value, label) {
  if (typeof value !== "string" || value.length > 64) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be canonical ISO-8601`,
    );
  }
  const milliseconds = new Date(value).getTime();
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} must be canonical ISO-8601`,
    );
  }
  return { timestamp: value, milliseconds };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function canonicalClone(value, label = "canonical value") {
  const state = {
    nodes: 0,
    bytes: 0,
    ancestors: new WeakSet(),
  };
  const addBytes = (fragment) => {
    const bytes = Buffer.byteLength(fragment, "utf8");
    if (state.bytes > MAX_CANONICAL_BYTES - bytes) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `${label} exceeds the canonical byte limit`,
      );
    }
    state.bytes += bytes;
  };
  const visit = (current, path, depth) => {
    state.nodes += 1;
    if (state.nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `${label} exceeds the canonical structure limit`,
      );
    }
    if (current === null || typeof current !== "object") {
      if (
        typeof current === "function" ||
        typeof current === "symbol" ||
        typeof current === "bigint" ||
        current === undefined ||
        (typeof current === "number" && !Number.isFinite(current))
      ) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
          `${path} is not canonical JSON`,
        );
      }
      if (typeof current === "string" && current.length > MAX_STRING_CHARS) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
          `${path} exceeds the string limit`,
        );
      }
      const serialized = JSON.stringify(current);
      addBytes(serialized);
      return current;
    }
    rejectProxy(current, path);
    if (state.ancestors.has(current)) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `${path} must not be cyclic`,
      );
    }
    state.ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const items = assertDenseStandardArray(current, path, {
          minimum: 0,
          maximum: MAX_CANONICAL_NODES,
        });
        addBytes("[");
        const output = [];
        for (let index = 0; index < items.length; index += 1) {
          if (index > 0) addBytes(",");
          output.push(visit(items[index], `${path}[${index}]`, depth + 1));
        }
        addBytes("]");
        return output;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
          `${path} must contain only plain objects`,
        );
      }
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
          `${path} contains unsafe keys`,
        );
      }
      keys.sort();
      addBytes("{");
      const output = Object.create(null);
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) addBytes(",");
        const key = keys[index];
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw matrixError(
            SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
            `${path}.${key} must be an enumerable own data property`,
          );
        }
        addBytes(JSON.stringify(key));
        addBytes(":");
        Object.defineProperty(output, key, {
          value: visit(descriptor.value, `${path}.${key}`, depth + 1),
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      addBytes("}");
      return output;
    } finally {
      state.ancestors.delete(current);
    }
  };
  return deepFreeze(visit(value, label, 0));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      items.push(
        canonicalJson(ownData(value, String(index), "canonical array")),
      );
    }
    return `[${items.join(",")}]`;
  }
  const keys = Reflect.ownKeys(value).sort();
  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(ownData(value, key, "canonical object"))}`,
    )
    .join(",")}}`;
}

function domainDigest(domain, value, label = "digest input") {
  const snapshot = canonicalClone(value, label);
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(snapshot), "utf8")
    .digest("hex")}`;
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizeTrust(value, label) {
  assertExactRecord(value, TRUST_KEYS, label);
  return deepFreeze({
    algorithm: normalizeId(value.algorithm, `${label}.algorithm`, 64),
    issuer: normalizeId(value.issuer, `${label}.issuer`),
    keyId: normalizeId(value.keyId, `${label}.keyId`),
    trustPolicyDigest: normalizeDigest(
      value.trustPolicyDigest,
      `${label}.trustPolicyDigest`,
    ),
  });
}

function normalizeAttestation(value, label) {
  assertExactRecord(value, ATTESTATION_KEYS, label);
  const trust = normalizeTrust(
    Object.fromEntries([...TRUST_KEYS].map((key) => [key, value[key]])),
    label,
  );
  if (
    typeof value.value !== "string" ||
    value.value.length < 1 ||
    value.value.length > MAX_SIGNATURE_CHARS
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label}.value is invalid`,
    );
  }
  return deepFreeze({ ...trust, value: value.value });
}

function sameTrust(left, right) {
  return [...TRUST_KEYS].every((key) => left[key] === right[key]);
}

function principalFingerprint(trust) {
  return `${trust.algorithm}\0${trust.issuer}\0${trust.keyId}`;
}

function normalizePolicy(value, label) {
  assertExactRecord(value, POLICY_KEYS, label);
  return deepFreeze({
    trust: normalizeTrust(value.trust, `${label}.trust`),
    revision: normalizeId(value.revision, `${label}.revision`),
  });
}

function normalizeDescriptor(value, label, expected = {}) {
  assertExactRecord(value, AUTHORITY_DESCRIPTOR_KEYS, label);
  if (value.schema !== EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label}.schema is invalid`,
    );
  }
  const normalized = deepFreeze({
    schema: EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
    handlerId: normalizeId(value.handlerId, `${label}.handlerId`),
    handlerRevision: normalizeId(
      value.handlerRevision,
      `${label}.handlerRevision`,
    ),
    operation: normalizeId(value.operation, `${label}.operation`),
    handlerArtifactDigest: normalizeDigest(
      value.handlerArtifactDigest,
      `${label}.handlerArtifactDigest`,
    ),
    authority: normalizeTrust(value.authority, `${label}.authority`),
  });
  if (
    (expected.operation && normalized.operation !== expected.operation) ||
    (expected.policy &&
      (!sameTrust(normalized.authority, expected.policy.trust) ||
        normalized.handlerRevision !== expected.policy.revision))
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} differs from its exact operation or authority policy`,
    );
  }
  return normalized;
}

function normalizeChildReceiptStoreDescriptor(value, label) {
  assertExactRecord(value, CHILD_RECEIPT_STORE_DESCRIPTOR_KEYS, label);
  return deepFreeze({
    tenantId: normalizeId(value.tenantId, `${label}.tenantId`),
    streamId: normalizeId(value.streamId, `${label}.streamId`),
    authorityId: normalizeId(value.authorityId, `${label}.authorityId`),
    revision: normalizeInteger(value.revision, `${label}.revision`, {
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    handlerArtifactDigest: normalizeDigest(
      value.handlerArtifactDigest,
      `${label}.handlerArtifactDigest`,
    ),
  });
}

function descriptorDigest(value) {
  return domainDigest(
    "chainlesschain.skill-target-matrix-eval-authority-descriptor/v1",
    value,
    "authority descriptor",
  );
}

function readOwnCallable(port, key, label) {
  const callable = ownData(port, key, label);
  if (typeof callable !== "function") {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label}.${key} must be callable`,
    );
  }
  return callable;
}

function capturePort(port, keys, method, label, descriptorKey, expected) {
  assertExactRecord(port, keys, label);
  const raw = readOwnCallable(port, method, label);
  const descriptor = normalizeDescriptor(
    ownData(port, descriptorKey, label),
    `${label}.${descriptorKey}`,
    expected,
  );
  const callable = (...args) => Reflect.apply(raw, port, args);
  Object.freeze(callable);
  Object.freeze(port);
  return Object.freeze({ callable, raw, descriptor });
}

function ensureUniqueCallables(entries) {
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (entries[left].raw === entries[right].raw) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
          `${entries[left].role} and ${entries[right].role} must not share a raw callable`,
        );
      }
    }
  }
}

function validatePrincipalMatrix(entries) {
  const priorByFingerprint = new Map();
  for (const entry of entries) {
    const fingerprint = principalFingerprint(entry.trust);
    const prior = priorByFingerprint.get(fingerprint) ?? [];
    for (const existing of prior) {
      const allowedAggregatePair =
        new Set([existing.role, entry.role]).size === 2 &&
        [existing.role, entry.role].includes("matrixSigner") &&
        [existing.role, entry.role].includes("matrixVerifier") &&
        sameTrust(existing.trust, entry.trust);
      if (!allowedAggregatePair) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
          `${existing.role} and ${entry.role} must not share a principal/key identity`,
        );
      }
    }
    prior.push(entry);
    priorByFingerprint.set(fingerprint, prior);
  }
}

function normalizeReasonCodes(value, label) {
  const items = assertDenseStandardArray(value, label, {
    minimum: 1,
    maximum: MAX_REASON_CODES,
  });
  return deepFreeze(
    items.map((item, index) => normalizeId(item, `${label}[${index}]`)),
  );
}

function normalizeDecision(value, label = "matrix decision") {
  if (!["accepted", "rejected", "needs-more-evidence"].includes(value)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      `${label} is invalid`,
    );
  }
  return value;
}

function normalizePlanCell(value, label) {
  assertExactRecord(value, PLAN_CELL_KEYS, label);
  return deepFreeze({
    cellId: normalizeId(value.cellId, `${label}.cellId`),
    invocationId: normalizeId(value.invocationId, `${label}.invocationId`),
    invocationNonce: normalizeId(
      value.invocationNonce,
      `${label}.invocationNonce`,
    ),
    runtimeId: normalizeId(value.runtimeId, `${label}.runtimeId`),
    targetEnvironmentRef: normalizeId(
      value.targetEnvironmentRef,
      `${label}.targetEnvironmentRef`,
    ),
    environmentDigest: normalizeDigest(
      value.environmentDigest,
      `${label}.environmentDigest`,
    ),
    suiteRef: normalizeId(value.suiteRef, `${label}.suiteRef`),
    suiteDigest: normalizeDigest(value.suiteDigest, `${label}.suiteDigest`),
    policyDigest: normalizeDigest(value.policyDigest, `${label}.policyDigest`),
    evaluationAuthorityRoot: normalizeDigest(
      value.evaluationAuthorityRoot,
      `${label}.evaluationAuthorityRoot`,
    ),
    provenanceAudience: normalizeId(
      value.provenanceAudience,
      `${label}.provenanceAudience`,
    ),
    trainerAuthority: normalizeId(
      value.trainerAuthority,
      `${label}.trainerAuthority`,
    ),
    trainerRevision: normalizeId(
      value.trainerRevision,
      `${label}.trainerRevision`,
    ),
    maximumCellSettlementMs: normalizeInteger(
      value.maximumCellSettlementMs,
      `${label}.maximumCellSettlementMs`,
      { minimum: 100, maximum: 600_000 },
    ),
  });
}

function normalizePlanCells(value) {
  const cells = assertDenseStandardArray(
    value,
    "matrix evaluation plan cells",
    {
      minimum: 1,
      maximum: MAX_CELLS,
    },
  ).map((cell, index) =>
    normalizePlanCell(cell, `matrix evaluation plan cells[${index}]`),
  );
  const unique = (key) => {
    const values = cells.map((cell) => cell[key]);
    if (new Set(values).size !== values.length) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `matrix evaluation plan ${key} values must be unique`,
      );
    }
  };
  unique("cellId");
  unique("invocationId");
  unique("invocationNonce");
  cells.sort((left, right) =>
    left.cellId < right.cellId ? -1 : left.cellId > right.cellId ? 1 : 0,
  );
  return deepFreeze(cells);
}

function planCore(input) {
  assertExactRecord(input, PLAN_INPUT_KEYS, "matrix evaluation plan input");
  const issued = normalizeTimestamp(input.issuedAt, "plan.issuedAt");
  const expires = normalizeTimestamp(input.expiresAt, "plan.expiresAt");
  if (
    expires.milliseconds <= issued.milliseconds ||
    expires.milliseconds - issued.milliseconds > MAX_PLAN_TTL_MS
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix evaluation plan validity window is invalid",
    );
  }
  return deepFreeze({
    schema: SKILL_TARGET_MATRIX_EVAL_PLAN_SCHEMA,
    matrixEvalId: normalizeId(input.matrixEvalId, "plan.matrixEvalId"),
    nonce: normalizeId(input.nonce, "plan.nonce"),
    tenantId: normalizeId(input.tenantId, "plan.tenantId"),
    skillName: normalizeId(input.skillName, "plan.skillName", 128),
    candidateId: normalizeDigest(input.candidateId, "plan.candidateId"),
    candidateContentDigest: normalizeDigest(
      input.candidateContentDigest,
      "plan.candidateContentDigest",
    ),
    baselineId: normalizeDigest(input.baselineId, "plan.baselineId"),
    baselineReleaseDigest: normalizeNullableDigest(
      input.baselineReleaseDigest,
      "plan.baselineReleaseDigest",
    ),
    expectedActiveContentDigest: normalizeDigest(
      input.expectedActiveContentDigest,
      "plan.expectedActiveContentDigest",
    ),
    expectedActiveRevision: normalizeInteger(
      input.expectedActiveRevision,
      "plan.expectedActiveRevision",
    ),
    dependencyLockDigest: normalizeDigest(
      input.dependencyLockDigest,
      "plan.dependencyLockDigest",
    ),
    runtimeManifestDigest: normalizeDigest(
      input.runtimeManifestDigest,
      "plan.runtimeManifestDigest",
    ),
    targetMatrixRoot: normalizeDigest(
      input.targetMatrixRoot,
      "plan.targetMatrixRoot",
    ),
    matrixAuthorityRoot: normalizeDigest(
      input.matrixAuthorityRoot,
      "plan.matrixAuthorityRoot",
    ),
    maxTotalWallClockMs: normalizeInteger(
      input.maxTotalWallClockMs,
      "plan.maxTotalWallClockMs",
      { minimum: 100, maximum: 3_600_000 },
    ),
    aggregateReceiptTtlMs: normalizeInteger(
      input.aggregateReceiptTtlMs,
      "plan.aggregateReceiptTtlMs",
      { minimum: 1_000, maximum: MAX_RECEIPT_TTL_MS },
    ),
    familywiseErrorRate: normalizeFinite(
      input.familywiseErrorRate,
      "plan.familywiseErrorRate",
      { minimum: 0.001, maximum: 0.1 },
    ),
    comparisonCorrection:
      input.comparisonCorrection === "bonferroni-two-sided"
        ? input.comparisonCorrection
        : (() => {
            throw matrixError(
              SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
              "plan.comparisonCorrection is invalid",
            );
          })(),
    issuedAt: issued.timestamp,
    expiresAt: expires.timestamp,
    cells: normalizePlanCells(input.cells),
  });
}

export function buildSkillTargetMatrixEvalPlan(input) {
  const core = planCore(input);
  return deepFreeze({
    ...core,
    planDigest: domainDigest(
      SKILL_TARGET_MATRIX_EVAL_PLAN_SCHEMA,
      core,
      "matrix evaluation plan",
    ),
  });
}

export function verifySkillTargetMatrixEvalPlan(value) {
  const snapshot = canonicalClone(value, "matrix evaluation plan");
  assertExactRecord(snapshot, PLAN_KEYS, "matrix evaluation plan");
  if (snapshot.schema !== SKILL_TARGET_MATRIX_EVAL_PLAN_SCHEMA) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix evaluation plan schema is invalid",
    );
  }
  const rebuilt = buildSkillTargetMatrixEvalPlan(
    Object.fromEntries([...PLAN_INPUT_KEYS].map((key) => [key, snapshot[key]])),
  );
  if (!sameCanonical(snapshot, rebuilt)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix evaluation plan digest or canonical form is invalid",
    );
  }
  return rebuilt;
}

function normalizePlanRef(value) {
  assertExactRecord(value, PLAN_REF_KEYS, "matrix evaluation planRef");
  if (typeof value.ref !== "string" || !PLAN_REF_PATTERN.test(value.ref)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix evaluation planRef.ref is invalid",
    );
  }
  return deepFreeze({
    ref: value.ref,
    digest: normalizeDigest(value.digest, "matrix evaluation planRef.digest"),
  });
}

function normalizeClockResult(value, label) {
  rejectProxy(value, label);
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
        `${label} returned an invalid Date`,
      );
    }
    return {
      timestamp: new Date(milliseconds).toISOString(),
      milliseconds,
    };
  }
  return normalizeTimestamp(value, label);
}

function remainingMilliseconds(deadlineMs) {
  return Math.max(0, Math.ceil(deadlineMs - NATIVE_MONOTONIC_NOW()));
}

function assertRootDeadline(deadlineMs, label) {
  if (NATIVE_MONOTONIC_NOW() >= deadlineMs) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_DEADLINE_CODE,
      `${label} exceeded the matrix root monotonic deadline`,
    );
  }
}

function nativePromiseOrValue(value, label) {
  if (!value || typeof value !== "object") return { promise: null, value };
  rejectProxy(value, `${label} result`);
  if (
    !(value instanceof NATIVE_PROMISE) ||
    Object.getPrototypeOf(value) !== NATIVE_PROMISE.prototype ||
    Reflect.ownKeys(value).length !== 0
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      `${label} returned an untrusted thenable or object in place of a Promise`,
    );
  }
  return { promise: value, value: undefined };
}

async function awaitRootBounded(value, deadlineMs, label, controller) {
  const normalized = nativePromiseOrValue(value, label);
  if (!normalized.promise) {
    assertRootDeadline(deadlineMs, label);
    return normalized.value;
  }
  const remaining = remainingMilliseconds(deadlineMs);
  if (remaining <= 0) {
    controller?.abort();
    assertRootDeadline(deadlineMs, label);
  }
  let timer;
  const timeout = new NATIVE_PROMISE((_, reject) => {
    timer = NATIVE_SET_TIMEOUT(() => {
      controller?.abort();
      reject(
        matrixError(
          SKILL_TARGET_MATRIX_EVAL_DEADLINE_CODE,
          `${label} did not settle before the matrix root deadline`,
        ),
      );
    }, remaining);
    timer?.unref?.();
  });
  try {
    const result = await NATIVE_PROMISE_RACE([normalized.promise, timeout]);
    assertRootDeadline(deadlineMs, label);
    return result;
  } finally {
    if (timer) NATIVE_CLEAR_TIMEOUT(timer);
  }
}

function randomId(prefix) {
  return `${prefix}-${randomBytes(24).toString("hex")}`;
}

async function invokeSupervised(
  supervision,
  label,
  payload,
  operation,
  deadlineMs,
  wallDeadlineAt,
) {
  assertRootDeadline(deadlineMs, label);
  const payloadSnapshot = canonicalClone(payload, `${label} payload`);
  const request = deepFreeze({
    operationId: randomId("matrix-operation"),
    label: normalizeId(label, "supervised operation label"),
    payloadDigest: domainDigest(
      "chainlesschain.skill-target-matrix-eval-supervision-payload/v1",
      payloadSnapshot,
      `${label} payload`,
    ),
    requestedAt: supervision.clock().timestamp,
    deadlineAt: wallDeadlineAt,
  });
  let accepting = true;
  let invocationCount = 0;
  let settled = false;
  let settledSnapshot;
  const controller = new AbortController();
  const capability = Object.freeze({
    invoke: Object.freeze(() => {
      if (!accepting || invocationCount !== 0) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
          `${label} supervisor invocation was missing, replayed, or late`,
        );
      }
      invocationCount += 1;
      let result;
      try {
        result = operation(controller.signal);
      } catch (cause) {
        settled = true;
        throw cause;
      }
      const normalized = nativePromiseOrValue(result, `${label} operation`);
      if (!normalized.promise) {
        settledSnapshot = canonicalClone(
          normalized.value,
          `${label} operation result`,
        );
        settled = true;
        return settledSnapshot;
      }
      return Reflect.apply(NATIVE_PROMISE_THEN, normalized.promise, [
        (value) => {
          settledSnapshot = canonicalClone(value, `${label} operation result`);
          settled = true;
          return settledSnapshot;
        },
      ]);
    }),
  });
  let proofAccepted = false;
  try {
    const response = await awaitRootBounded(
      supervision.run(request, capability),
      deadlineMs,
      `${label} supervisor`,
      controller,
    );
    accepting = false;
    const responseSnapshot = canonicalClone(response, `${label} response`);
    assertExactRecord(
      responseSnapshot,
      new Set(["operationId", "completed", "valueDigest", "value"]),
      `${label} supervisor response`,
    );
    if (
      invocationCount !== 1 ||
      !settled ||
      responseSnapshot.operationId !== request.operationId ||
      responseSnapshot.completed !== true
    ) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
        `${label} supervisor did not prove one-shot completion`,
      );
    }
    const actualDigest = domainDigest(
      "chainlesschain.skill-target-matrix-eval-supervised-result/v1",
      settledSnapshot,
      `${label} settled result`,
    );
    if (
      responseSnapshot.valueDigest !== actualDigest ||
      !sameCanonical(responseSnapshot.value, settledSnapshot)
    ) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
        `${label} supervisor swapped the operation result`,
      );
    }
    assertRootDeadline(deadlineMs, label);
    proofAccepted = true;
    return settledSnapshot;
  } finally {
    accepting = false;
    if (!proofAccepted) controller.abort();
  }
}

function signaturePayload(purpose, payloadDigest, attestation) {
  return deepFreeze({ purpose, payloadDigest, attestation });
}

async function verifySignature(
  composition,
  purpose,
  payloadDigest,
  attestation,
  expectedTrust,
  deadlineMs,
  wallDeadlineAt,
  label,
) {
  const normalized = normalizeAttestation(attestation, `${label} attestation`);
  if (!sameTrust(normalized, expectedTrust)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      `${label} signature trust is invalid`,
    );
  }
  const verified = await invokeSupervised(
    composition.supervision,
    `${label}-verify`,
    { purpose, payloadDigest, attestation: normalized },
    (signal) =>
      composition.evidenceVerifier.callable(
        signaturePayload(purpose, payloadDigest, normalized),
        Object.freeze({ signal }),
      ),
    deadlineMs,
    wallDeadlineAt,
  );
  if (verified !== true) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      `${label} signature was rejected`,
    );
  }
  return normalized;
}

function normalizeCellAuthorities(value) {
  const entries = assertDenseStandardArray(value, "matrix cell authorities", {
    minimum: 1,
    maximum: MAX_CELLS,
  }).map((entry, index) => {
    const label = `matrix cell authorities[${index}]`;
    assertExactRecord(entry, CELL_AUTHORITY_KEYS, label);
    return deepFreeze({
      cellId: normalizeId(entry.cellId, `${label}.cellId`),
      gateDescriptor: normalizeDescriptor(
        entry.gateDescriptor,
        `${label}.gateDescriptor`,
      ),
      receiptVerifierDescriptor: normalizeDescriptor(
        entry.receiptVerifierDescriptor,
        `${label}.receiptVerifierDescriptor`,
      ),
      policyDigest: normalizeDigest(
        entry.policyDigest,
        `${label}.policyDigest`,
      ),
      evaluationAuthorityRoot: normalizeDigest(
        entry.evaluationAuthorityRoot,
        `${label}.evaluationAuthorityRoot`,
      ),
      maximumCellSettlementMs: normalizeInteger(
        entry.maximumCellSettlementMs,
        `${label}.maximumCellSettlementMs`,
        { minimum: 100, maximum: 600_000 },
      ),
    });
  });
  if (new Set(entries.map((entry) => entry.cellId)).size !== entries.length) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix cell authority cellId values must be unique",
    );
  }
  entries.sort((left, right) =>
    left.cellId < right.cellId ? -1 : left.cellId > right.cellId ? 1 : 0,
  );
  return deepFreeze(entries);
}

export function computeSkillTargetMatrixEvalAuthorityRoot(input) {
  assertExactRecord(
    input,
    AUTHORITY_ROOT_INPUT_KEYS,
    "matrix authority root input",
  );
  const normalized = deepFreeze({
    semantics: SKILL_TARGET_MATRIX_EVAL_FOUNDATION_SEMANTICS,
    planResolverDescriptor: normalizeDescriptor(
      input.planResolverDescriptor,
      "matrix authority root planResolverDescriptor",
    ),
    evidenceVerifierDescriptor: normalizeDescriptor(
      input.evidenceVerifierDescriptor,
      "matrix authority root evidenceVerifierDescriptor",
    ),
    reservationDescriptor: normalizeDescriptor(
      input.reservationDescriptor,
      "matrix authority root reservationDescriptor",
    ),
    finalizationDescriptor: normalizeDescriptor(
      input.finalizationDescriptor,
      "matrix authority root finalizationDescriptor",
    ),
    supervisorDescriptor: normalizeDescriptor(
      input.supervisorDescriptor,
      "matrix authority root supervisorDescriptor",
    ),
    matrixSignerDescriptor: normalizeDescriptor(
      input.matrixSignerDescriptor,
      "matrix authority root matrixSignerDescriptor",
    ),
    matrixVerifierDescriptor: normalizeDescriptor(
      input.matrixVerifierDescriptor,
      "matrix authority root matrixVerifierDescriptor",
    ),
    clockDescriptor: normalizeDescriptor(
      input.clockDescriptor,
      "matrix authority root clockDescriptor",
    ),
    planTrust: normalizeTrust(
      input.planTrust,
      "matrix authority root planTrust",
    ),
    matrixReceiptTrust: normalizeTrust(
      input.matrixReceiptTrust,
      "matrix authority root matrixReceiptTrust",
    ),
    childReceiptStoreDescriptor: normalizeChildReceiptStoreDescriptor(
      input.childReceiptStoreDescriptor,
      "matrix authority root childReceiptStoreDescriptor",
    ),
    cellAuthorities: normalizeCellAuthorities(input.cellAuthorities),
  });
  return domainDigest(
    "chainlesschain.skill-target-matrix-eval-authority-root/v2",
    normalized,
    "matrix authority root",
  );
}

function captureComposition(options) {
  const planResolverPolicy = normalizePolicy(
    options.planResolverPolicy,
    "planResolverPolicy",
  );
  const evidenceVerifierPolicy = normalizePolicy(
    options.evidenceVerifierPolicy,
    "evidenceVerifierPolicy",
  );
  const reservationPolicy = normalizePolicy(
    options.reservationPolicy,
    "reservationPolicy",
  );
  const supervisorPolicy = normalizePolicy(
    options.supervisorPolicy,
    "supervisorPolicy",
  );
  const clockPolicy = normalizePolicy(options.clockPolicy, "clockPolicy");
  const planResolver = capturePort(
    options.planResolver,
    PLAN_RESOLVER_KEYS,
    "resolve",
    "planResolver",
    "authorityDescriptor",
    { operation: "matrix-plan-resolve", policy: planResolverPolicy },
  );
  const evidenceVerifier = capturePort(
    options.evidenceVerifier,
    VERIFY_PORT_KEYS,
    "verify",
    "evidenceVerifier",
    "authorityDescriptor",
    { operation: "matrix-evidence-verify", policy: evidenceVerifierPolicy },
  );
  assertExactRecord(
    options.reservationAuthority,
    RESERVATION_PORT_KEYS,
    "reservationAuthority",
  );
  const reserveRaw = readOwnCallable(
    options.reservationAuthority,
    "reserve",
    "reservationAuthority",
  );
  const finalizeRaw = readOwnCallable(
    options.reservationAuthority,
    "finalize",
    "reservationAuthority",
  );
  const reservationDescriptor = normalizeDescriptor(
    ownData(
      options.reservationAuthority,
      "reservationDescriptor",
      "reservationAuthority",
    ),
    "reservationAuthority.reservationDescriptor",
    { operation: "matrix-plan-reserve", policy: reservationPolicy },
  );
  const finalizationDescriptor = normalizeDescriptor(
    ownData(
      options.reservationAuthority,
      "finalizationDescriptor",
      "reservationAuthority",
    ),
    "reservationAuthority.finalizationDescriptor",
    { operation: "matrix-plan-finalize", policy: reservationPolicy },
  );
  const reserve = (...args) =>
    Reflect.apply(reserveRaw, options.reservationAuthority, args);
  const finalize = (...args) =>
    Reflect.apply(finalizeRaw, options.reservationAuthority, args);
  Object.freeze(reserve);
  Object.freeze(finalize);
  Object.freeze(options.reservationAuthority);
  const supervisor = capturePort(
    options.matrixSupervisor,
    SUPERVISOR_PORT_KEYS,
    "run",
    "matrixSupervisor",
    "authorityDescriptor",
    { operation: "matrix-operation-supervise", policy: supervisorPolicy },
  );
  const signer = capturePort(
    options.matrixReceiptSigner,
    SIGN_PORT_KEYS,
    "sign",
    "matrixReceiptSigner",
    "authorityDescriptor",
    { operation: "matrix-receipt-sign" },
  );
  const verifier = capturePort(
    options.matrixReceiptVerifier,
    VERIFY_PORT_KEYS,
    "verify",
    "matrixReceiptVerifier",
    "authorityDescriptor",
    { operation: "matrix-receipt-verify" },
  );
  const receiptTrust = normalizeTrust(
    options.matrixReceiptTrust,
    "matrixReceiptTrust",
  );
  if (
    !sameTrust(signer.descriptor.authority, receiptTrust) ||
    !sameTrust(verifier.descriptor.authority, receiptTrust)
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix signer and verifier must be the exact receipt trust pair",
    );
  }
  const clockPort = capturePort(
    options.clock,
    CLOCK_PORT_KEYS,
    "now",
    "trustedClock",
    "authorityDescriptor",
    { operation: "trusted-time-read", policy: clockPolicy },
  );
  const clock = () => clockPort.callable();
  const supervisionClock = () => normalizeClockResult(clock(), "trusted clock");
  Object.freeze(clock);
  Object.freeze(supervisionClock);
  if (!isEvolutionEvalChildEvidenceStore(options.childReceiptStore)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "childReceiptStore must be a branded durable evidence store",
    );
  }
  const childReceiptRetainRaw = options.childReceiptStore.retain;
  const childReceiptResolveRaw = options.childReceiptStore.resolve;
  if (
    typeof childReceiptRetainRaw !== "function" ||
    typeof childReceiptResolveRaw !== "function"
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "childReceiptStore retain/resolve ports are required",
    );
  }
  const childReceiptStoreDescriptor = normalizeChildReceiptStoreDescriptor(
    options.childReceiptStore.descriptor,
    "childReceiptStore.descriptor",
  );
  const childReceiptStore = Object.freeze({
    descriptor: childReceiptStoreDescriptor,
    retain: (...args) =>
      Reflect.apply(childReceiptRetainRaw, options.childReceiptStore, args),
    resolve: (...args) =>
      Reflect.apply(childReceiptResolveRaw, options.childReceiptStore, args),
  });
  ensureUniqueCallables([
    { role: "planResolver.resolve", raw: planResolver.raw },
    { role: "evidenceVerifier.verify", raw: evidenceVerifier.raw },
    { role: "reservationAuthority.reserve", raw: reserveRaw },
    { role: "reservationAuthority.finalize", raw: finalizeRaw },
    { role: "matrixSupervisor.run", raw: supervisor.raw },
    { role: "matrixReceiptSigner.sign", raw: signer.raw },
    { role: "matrixReceiptVerifier.verify", raw: verifier.raw },
    { role: "trustedClock.now", raw: clockPort.raw },
    { role: "childReceiptStore.retain", raw: childReceiptRetainRaw },
    { role: "childReceiptStore.resolve", raw: childReceiptResolveRaw },
  ]);
  return Object.freeze({
    planResolver,
    planResolverPolicy,
    planTrust: normalizeTrust(options.planTrust, "planTrust"),
    evidenceVerifier,
    evidenceVerifierPolicy,
    reservation: Object.freeze({
      reserve,
      finalize,
      reserveRaw,
      finalizeRaw,
      reservationDescriptor,
      finalizationDescriptor,
      policy: reservationPolicy,
    }),
    supervision: Object.freeze({
      run: supervisor.callable,
      descriptor: supervisor.descriptor,
      policy: supervisorPolicy,
      clock: supervisionClock,
    }),
    signer,
    verifier,
    receiptTrust,
    clock,
    clockDescriptor: clockPort.descriptor,
    clockPolicy,
    childReceiptStore,
  });
}

function captureCellRuntimes(value) {
  rejectProxy(value, "cellRuntimes");
  if (
    !(value instanceof Map) ||
    Object.getPrototypeOf(value) !== Map.prototype
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "cellRuntimes must be a standard Map",
    );
  }
  if (value.size < 1 || value.size > MAX_CELLS) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "cellRuntimes size is invalid",
    );
  }
  const captured = new Map();
  const authorities = [];
  for (const [rawCellId, rawConfig] of Map.prototype.entries.call(value)) {
    const cellId = normalizeId(rawCellId, "cellRuntimes cellId");
    const label = `cellRuntimes.${cellId}`;
    assertExactRecord(rawConfig, CELL_RUNTIME_KEYS, label);
    const gate = ownData(rawConfig, "gate", label);
    const receiptVerifier = ownData(rawConfig, "receiptVerifier", label);
    rejectProxy(gate, `${label}.gate`);
    rejectProxy(receiptVerifier, `${label}.receiptVerifier`);
    if (!(gate instanceof EvolutionEvalGate)) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `${label}.gate must be a branded EvolutionEvalGate`,
      );
    }
    if (!(receiptVerifier instanceof EvolutionEvalReceiptVerifier)) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `${label}.receiptVerifier must be a branded EvolutionEvalReceiptVerifier`,
      );
    }
    const gateDescriptor = normalizeDescriptor(
      ownData(rawConfig, "gateDescriptor", label),
      `${label}.gateDescriptor`,
      { operation: "cell-eval-run" },
    );
    const receiptVerifierDescriptor = normalizeDescriptor(
      ownData(rawConfig, "receiptVerifierDescriptor", label),
      `${label}.receiptVerifierDescriptor`,
      { operation: "cell-eval-receipt-verify" },
    );
    const config = Object.freeze({
      gate,
      receiptVerifier,
      suiteRef: normalizeId(rawConfig.suiteRef, `${label}.suiteRef`),
      suiteDigest: normalizeDigest(
        rawConfig.suiteDigest,
        `${label}.suiteDigest`,
      ),
      policyDigest: normalizeDigest(
        rawConfig.policyDigest,
        `${label}.policyDigest`,
      ),
      evaluationAuthorityRoot: normalizeDigest(
        rawConfig.evaluationAuthorityRoot,
        `${label}.evaluationAuthorityRoot`,
      ),
      provenanceAudience: normalizeId(
        rawConfig.provenanceAudience,
        `${label}.provenanceAudience`,
      ),
      trainerAuthority: normalizeId(
        rawConfig.trainerAuthority,
        `${label}.trainerAuthority`,
      ),
      trainerRevision: normalizeId(
        rawConfig.trainerRevision,
        `${label}.trainerRevision`,
      ),
      maximumCellSettlementMs: normalizeInteger(
        rawConfig.maximumCellSettlementMs,
        `${label}.maximumCellSettlementMs`,
        { minimum: 100, maximum: 600_000 },
      ),
      gateDescriptor,
      receiptVerifierDescriptor,
    });
    if (captured.has(cellId)) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `duplicate cell runtime: ${cellId}`,
      );
    }
    captured.set(cellId, config);
    authorities.push({
      cellId,
      gateDescriptor,
      receiptVerifierDescriptor,
      policyDigest: config.policyDigest,
      evaluationAuthorityRoot: config.evaluationAuthorityRoot,
      maximumCellSettlementMs: config.maximumCellSettlementMs,
    });
  }
  return Object.freeze({ runtimes: captured, authorities });
}

function assertPlanMatchesComposition(plan, state) {
  if (
    plan.tenantId !== state.tenantId ||
    plan.dependencyLockDigest !== state.dependencyLock.dependencyLockDigest ||
    plan.runtimeManifestDigest !==
      state.runtimeManifest.runtimeManifestDigest ||
    plan.targetMatrixRoot !== state.targetMatrix.targetMatrixRoot ||
    plan.matrixAuthorityRoot !== state.matrixAuthorityRoot ||
    plan.maxTotalWallClockMs > state.maximumMatrixWallClockMs ||
    plan.cells.length !== state.targetMatrix.cells.length
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "signed matrix plan differs from the captured tenant, manifests, matrix, authority root, or budget",
    );
  }
  for (let index = 0; index < plan.cells.length; index += 1) {
    const planCell = plan.cells[index];
    const matrixCell = state.targetMatrix.cells[index];
    const runtime = state.cellRuntimes.get(planCell.cellId);
    if (
      !runtime ||
      planCell.cellId !== matrixCell.cellId ||
      planCell.runtimeId !== matrixCell.runtimeId ||
      planCell.targetEnvironmentRef !== matrixCell.targetEnvironmentRef ||
      planCell.environmentDigest !== matrixCell.environmentDigest ||
      planCell.suiteRef !== runtime.suiteRef ||
      planCell.suiteDigest !== runtime.suiteDigest ||
      planCell.policyDigest !== runtime.policyDigest ||
      planCell.evaluationAuthorityRoot !== runtime.evaluationAuthorityRoot ||
      planCell.provenanceAudience !== runtime.provenanceAudience ||
      planCell.trainerAuthority !== runtime.trainerAuthority ||
      planCell.trainerRevision !== runtime.trainerRevision ||
      planCell.maximumCellSettlementMs !== runtime.maximumCellSettlementMs
    ) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
        `signed matrix plan cell differs from captured composition: ${planCell.cellId}`,
      );
    }
  }
}

function reservationCore(snapshot) {
  return deepFreeze(
    Object.fromEntries(
      [...RESERVATION_KEYS]
        .filter((key) => key !== "attestation" && key !== "receiptDigest")
        .map((key) => [key, snapshot[key]]),
    ),
  );
}

function finalizationCore(snapshot) {
  return deepFreeze(
    Object.fromEntries(
      [...FINALIZATION_KEYS]
        .filter((key) => key !== "attestation" && key !== "receiptDigest")
        .map((key) => [key, snapshot[key]]),
    ),
  );
}

function validateReservationStructure(value, expected) {
  const snapshot = canonicalClone(value, "matrix reservation receipt");
  assertExactRecord(snapshot, RESERVATION_KEYS, "matrix reservation receipt");
  const core = reservationCore(snapshot);
  const receiptDigest = domainDigest(
    SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA,
    core,
    "matrix reservation receipt core",
  );
  if (
    snapshot.schema !== SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA ||
    snapshot.receiptDigest !== receiptDigest ||
    snapshot.tenantId !== expected.plan.tenantId ||
    snapshot.matrixEvalId !== expected.plan.matrixEvalId ||
    snapshot.planDigest !== expected.plan.planDigest ||
    snapshot.planNonce !== expected.plan.nonce ||
    snapshot.matrixAuthorityRoot !== expected.plan.matrixAuthorityRoot ||
    snapshot.requestDigest !== expected.requestDigest ||
    snapshot.expiresAt !== expected.plan.expiresAt ||
    snapshot.authorityRevision !== expected.policy.revision
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "matrix reservation receipt is not exactly bound",
    );
  }
  normalizeId(snapshot.reservationId, "reservation.reservationId");
  const reserved = normalizeTimestamp(
    snapshot.reservedAt,
    "reservation.reservedAt",
  );
  const expires = normalizeTimestamp(
    snapshot.expiresAt,
    "reservation.expiresAt",
  );
  if (
    reserved.milliseconds < expected.requestedMs - CLOCK_SKEW_MS ||
    reserved.milliseconds > expected.nowMs + CLOCK_SKEW_MS ||
    expires.milliseconds <= expected.nowMs
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "matrix reservation receipt freshness is invalid",
    );
  }
  return deepFreeze({
    snapshot,
    receiptDigest,
    attestation: normalizeAttestation(
      snapshot.attestation,
      "matrix reservation attestation",
    ),
  });
}

function validateFinalizationStructure(value, expected) {
  const snapshot = canonicalClone(value, "matrix finalization receipt");
  assertExactRecord(snapshot, FINALIZATION_KEYS, "matrix finalization receipt");
  const core = finalizationCore(snapshot);
  const receiptDigest = domainDigest(
    SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA,
    core,
    "matrix finalization receipt core",
  );
  if (
    snapshot.schema !== SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA ||
    snapshot.receiptDigest !== receiptDigest ||
    snapshot.tenantId !== expected.plan.tenantId ||
    snapshot.matrixEvalId !== expected.plan.matrixEvalId ||
    snapshot.planDigest !== expected.plan.planDigest ||
    snapshot.reservationId !== expected.reservation.reservationId ||
    snapshot.reservationReceiptDigest !== expected.reservation.receiptDigest ||
    snapshot.decisionCommitmentDigest !== expected.decisionCommitmentDigest ||
    snapshot.requestDigest !== expected.requestDigest ||
    snapshot.authorityRevision !== expected.policy.revision
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "matrix finalization receipt is not exactly bound",
    );
  }
  const finalized = normalizeTimestamp(
    snapshot.finalizedAt,
    "finalization.finalizedAt",
  );
  if (
    finalized.milliseconds < expected.requestedMs - CLOCK_SKEW_MS ||
    finalized.milliseconds > expected.nowMs + CLOCK_SKEW_MS
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "matrix finalization receipt freshness is invalid",
    );
  }
  return deepFreeze({
    snapshot,
    receiptDigest,
    attestation: normalizeAttestation(
      snapshot.attestation,
      "matrix finalization attestation",
    ),
  });
}

function readTrustedClock(clock) {
  try {
    const value = clock();
    rejectProxy(value, "trusted matrix clock result");
    return normalizeClockResult(value, "trusted matrix clock result");
  } catch (cause) {
    if (cause instanceof SkillTargetMatrixEvalError) throw cause;
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "trusted matrix clock failed",
      { cause },
    );
  }
}

function buildRequest(domain, fields, label) {
  const core = canonicalClone(fields, `${label} core`);
  return deepFreeze({
    ...core,
    requestDigest: domainDigest(domain, core, `${label} core`),
  });
}

function normalizePlanAuthentication(value) {
  assertExactRecord(value, PLAN_AUTH_KEYS, "matrix plan authentication");
  const core = deepFreeze({
    planRef: normalizePlanRef(value.planRef),
    resolverDescriptorDigest: normalizeDigest(
      value.resolverDescriptorDigest,
      "matrix plan authentication resolverDescriptorDigest",
    ),
    verifierDescriptorDigest: normalizeDigest(
      value.verifierDescriptorDigest,
      "matrix plan authentication verifierDescriptorDigest",
    ),
    planAttestation: normalizeAttestation(
      value.planAttestation,
      "matrix plan authentication planAttestation",
    ),
    verifiedAt: normalizeTimestamp(
      value.verifiedAt,
      "matrix plan authentication verifiedAt",
    ).timestamp,
  });
  const evidenceDigest = domainDigest(
    "chainlesschain.skill-target-matrix-eval-plan-authentication/v1",
    core,
    "matrix plan authentication",
  );
  if (value.evidenceDigest !== evidenceDigest) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "matrix plan authentication digest is invalid",
    );
  }
  return deepFreeze({ ...core, evidenceDigest });
}

async function resolveAndAuthenticatePlan(
  state,
  planRef,
  deadlineMs,
  wallDeadlineAt,
) {
  const requested = readTrustedClock(state.composition.clock);
  const request = buildRequest(
    "chainlesschain.skill-target-matrix-eval-plan-resolution-request/v1",
    {
      schema:
        "chainlesschain.skill-target-matrix-eval-plan-resolution-request/v1",
      tenantId: state.tenantId,
      planRef,
      requestNonce: randomId("matrix-plan-resolve"),
      requestedAt: requested.timestamp,
      deadlineAt: wallDeadlineAt,
    },
    "matrix plan resolution request",
  );
  const rawResolution = await invokeSupervised(
    state.composition.supervision,
    "matrix-plan-resolve",
    request,
    (signal) =>
      state.composition.planResolver.callable(
        request,
        Object.freeze({ signal }),
      ),
    deadlineMs,
    wallDeadlineAt,
  );
  const resolution = canonicalClone(rawResolution, "matrix plan resolution");
  assertExactRecord(resolution, PLAN_RESOLUTION_KEYS, "matrix plan resolution");
  const plan = verifySkillTargetMatrixEvalPlan(resolution.plan);
  const normalizedResolvedRef = normalizePlanRef(resolution.planRef);
  const resolvedAt = normalizeTimestamp(
    resolution.resolvedAt,
    "matrix plan resolution resolvedAt",
  );
  const checked = readTrustedClock(state.composition.clock);
  if (
    resolution.schema !== SKILL_TARGET_MATRIX_EVAL_PLAN_RESOLUTION_SCHEMA ||
    resolution.requestDigest !== request.requestDigest ||
    resolution.resolverRevision !==
      state.composition.planResolverPolicy.revision ||
    !sameCanonical(normalizedResolvedRef, planRef) ||
    normalizedResolvedRef.digest !== plan.planDigest ||
    resolvedAt.milliseconds < requested.milliseconds - CLOCK_SKEW_MS ||
    resolvedAt.milliseconds > checked.milliseconds + CLOCK_SKEW_MS
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "resolved matrix plan is not exactly bound to its trusted request",
    );
  }
  const attestation = await verifySignature(
    state.composition,
    PLAN_SIGNATURE_PURPOSE,
    plan.planDigest,
    resolution.planAttestation,
    state.composition.planTrust,
    deadlineMs,
    wallDeadlineAt,
    "matrix-plan",
  );
  const verified = readTrustedClock(state.composition.clock);
  const issued = normalizeTimestamp(plan.issuedAt, "plan.issuedAt");
  const expires = normalizeTimestamp(plan.expiresAt, "plan.expiresAt");
  if (
    issued.milliseconds > verified.milliseconds + CLOCK_SKEW_MS ||
    expires.milliseconds <= verified.milliseconds
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "resolved matrix plan is not fresh",
    );
  }
  const authCore = deepFreeze({
    planRef,
    resolverDescriptorDigest: descriptorDigest(
      state.composition.planResolver.descriptor,
    ),
    verifierDescriptorDigest: descriptorDigest(
      state.composition.evidenceVerifier.descriptor,
    ),
    planAttestation: attestation,
    verifiedAt: verified.timestamp,
  });
  const authentication = deepFreeze({
    ...authCore,
    evidenceDigest: domainDigest(
      "chainlesschain.skill-target-matrix-eval-plan-authentication/v1",
      authCore,
      "matrix plan authentication",
    ),
  });
  return Object.freeze({ plan, authentication });
}

async function reservePlan(state, plan, deadlineMs, wallDeadlineAt) {
  const requested = readTrustedClock(state.composition.clock);
  const request = buildRequest(
    "chainlesschain.skill-target-matrix-eval-reservation-request/v1",
    {
      schema: "chainlesschain.skill-target-matrix-eval-reservation-request/v1",
      tenantId: plan.tenantId,
      matrixEvalId: plan.matrixEvalId,
      planDigest: plan.planDigest,
      planNonce: plan.nonce,
      matrixAuthorityRoot: plan.matrixAuthorityRoot,
      requestNonce: randomId("matrix-plan-reserve"),
      requestedAt: requested.timestamp,
      deadlineAt: wallDeadlineAt,
    },
    "matrix plan reservation request",
  );
  const rawReceipt = await invokeSupervised(
    state.composition.supervision,
    "matrix-plan-reserve",
    request,
    (signal) =>
      state.composition.reservation.reserve(request, Object.freeze({ signal })),
    deadlineMs,
    wallDeadlineAt,
  );
  const checked = readTrustedClock(state.composition.clock);
  const validated = validateReservationStructure(rawReceipt, {
    plan,
    requestDigest: request.requestDigest,
    policy: state.composition.reservation.policy,
    requestedMs: requested.milliseconds,
    nowMs: checked.milliseconds,
  });
  await verifySignature(
    state.composition,
    RESERVATION_SIGNATURE_PURPOSE,
    validated.receiptDigest,
    validated.attestation,
    state.composition.reservation.policy.trust,
    deadlineMs,
    wallDeadlineAt,
    "matrix-plan-reservation",
  );
  const returned = readTrustedClock(state.composition.clock);
  if (returned.milliseconds >= new Date(plan.expiresAt).getTime()) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "matrix plan expired while its durable reservation was verified",
    );
  }
  return validated.snapshot;
}

function deriveMatrixDecision(cellResults, statisticalPlan) {
  let decision = "accepted";
  let reasonCodes = ["MATRIX_ALL_CELLS_ACCEPTED"];
  if (cellResults.some((cell) => cell.decision === "rejected")) {
    decision = "rejected";
    reasonCodes = ["MATRIX_CELL_REJECTED"];
  } else if (
    cellResults.some((cell) => cell.decision === "needs-more-evidence")
  ) {
    decision = "needs-more-evidence";
    reasonCodes = ["MATRIX_CELL_NEEDS_MORE_EVIDENCE"];
  } else if (
    cellResults.some(
      (cell) =>
        cell.confidenceZ + Number.EPSILON <
        requiredFamilywiseConfidenceZ(
          statisticalPlan.familywiseErrorRate,
          cellResults.length,
        ),
    )
  ) {
    decision = "needs-more-evidence";
    reasonCodes = ["MATRIX_FAMILYWISE_CONFIDENCE_INSUFFICIENT"];
  }
  return deepFreeze({ decision, reasonCodes: deepFreeze(reasonCodes) });
}

function matrixDecisionCommitment(input) {
  return deepFreeze({
    matrixEvalId: input.plan.matrixEvalId,
    nonce: input.plan.nonce,
    tenantId: input.plan.tenantId,
    skillName: input.plan.skillName,
    candidateId: input.plan.candidateId,
    candidateContentDigest: input.plan.candidateContentDigest,
    baselineId: input.plan.baselineId,
    baselineReleaseDigest: input.plan.baselineReleaseDigest,
    expectedActiveContentDigest: input.plan.expectedActiveContentDigest,
    expectedActiveRevision: input.plan.expectedActiveRevision,
    dependencyLockDigest: input.plan.dependencyLockDigest,
    runtimeManifestDigest: input.plan.runtimeManifestDigest,
    targetMatrixRoot: input.plan.targetMatrixRoot,
    matrixAuthorityRoot: input.plan.matrixAuthorityRoot,
    planDigest: input.plan.planDigest,
    familywiseErrorRate: input.plan.familywiseErrorRate,
    comparisonCorrection: input.plan.comparisonCorrection,
    planAuthenticationDigest: input.planAuthentication.evidenceDigest,
    reservationReceiptDigest: input.reservation.receiptDigest,
    cellCount: input.cellResults.length,
    cellResults: input.cellResults,
    childReceiptRoot: input.childReceiptRoot,
    decision: input.decision,
    reasonCodes: input.reasonCodes,
  });
}

async function finalizePlan(
  state,
  plan,
  reservation,
  decisionCommitmentDigest,
  deadlineMs,
  wallDeadlineAt,
) {
  const requested = readTrustedClock(state.composition.clock);
  const request = buildRequest(
    "chainlesschain.skill-target-matrix-eval-finalization-request/v1",
    {
      schema: "chainlesschain.skill-target-matrix-eval-finalization-request/v1",
      tenantId: plan.tenantId,
      matrixEvalId: plan.matrixEvalId,
      planDigest: plan.planDigest,
      reservationId: reservation.reservationId,
      reservationReceiptDigest: reservation.receiptDigest,
      decisionCommitmentDigest,
      requestNonce: randomId("matrix-plan-finalize"),
      requestedAt: requested.timestamp,
      deadlineAt: wallDeadlineAt,
    },
    "matrix plan finalization request",
  );
  const rawReceipt = await invokeSupervised(
    state.composition.supervision,
    "matrix-plan-finalize",
    request,
    (signal) =>
      state.composition.reservation.finalize(
        request,
        Object.freeze({ signal }),
      ),
    deadlineMs,
    wallDeadlineAt,
  );
  const checked = readTrustedClock(state.composition.clock);
  const validated = validateFinalizationStructure(rawReceipt, {
    plan,
    reservation,
    decisionCommitmentDigest,
    requestDigest: request.requestDigest,
    policy: state.composition.reservation.policy,
    requestedMs: requested.milliseconds,
    nowMs: checked.milliseconds,
  });
  await verifySignature(
    state.composition,
    FINALIZATION_SIGNATURE_PURPOSE,
    validated.receiptDigest,
    validated.attestation,
    state.composition.reservation.policy.trust,
    deadlineMs,
    wallDeadlineAt,
    "matrix-plan-finalization",
  );
  return validated.snapshot;
}

function normalizeStandaloneReservation(value) {
  const snapshot = canonicalClone(value, "matrix reservation receipt");
  assertExactRecord(snapshot, RESERVATION_KEYS, "matrix reservation receipt");
  if (snapshot.schema !== SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix reservation receipt schema is invalid",
    );
  }
  const core = reservationCore(snapshot);
  const receiptDigest = domainDigest(
    SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA,
    core,
    "matrix reservation receipt core",
  );
  if (snapshot.receiptDigest !== receiptDigest) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix reservation receipt digest is invalid",
    );
  }
  normalizeId(snapshot.tenantId, "reservation.tenantId");
  normalizeId(snapshot.matrixEvalId, "reservation.matrixEvalId");
  normalizeDigest(snapshot.planDigest, "reservation.planDigest");
  normalizeId(snapshot.planNonce, "reservation.planNonce");
  normalizeDigest(
    snapshot.matrixAuthorityRoot,
    "reservation.matrixAuthorityRoot",
  );
  normalizeDigest(snapshot.requestDigest, "reservation.requestDigest");
  normalizeId(snapshot.reservationId, "reservation.reservationId");
  normalizeTimestamp(snapshot.reservedAt, "reservation.reservedAt");
  normalizeTimestamp(snapshot.expiresAt, "reservation.expiresAt");
  normalizeId(snapshot.authorityRevision, "reservation.authorityRevision");
  normalizeAttestation(snapshot.attestation, "reservation.attestation");
  return snapshot;
}

function normalizeStandaloneFinalization(value) {
  const snapshot = canonicalClone(value, "matrix finalization receipt");
  assertExactRecord(snapshot, FINALIZATION_KEYS, "matrix finalization receipt");
  if (snapshot.schema !== SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix finalization receipt schema is invalid",
    );
  }
  const core = finalizationCore(snapshot);
  const receiptDigest = domainDigest(
    SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA,
    core,
    "matrix finalization receipt core",
  );
  if (snapshot.receiptDigest !== receiptDigest) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix finalization receipt digest is invalid",
    );
  }
  normalizeId(snapshot.tenantId, "finalization.tenantId");
  normalizeId(snapshot.matrixEvalId, "finalization.matrixEvalId");
  normalizeDigest(snapshot.planDigest, "finalization.planDigest");
  normalizeId(snapshot.reservationId, "finalization.reservationId");
  normalizeDigest(
    snapshot.reservationReceiptDigest,
    "finalization.reservationReceiptDigest",
  );
  normalizeDigest(
    snapshot.decisionCommitmentDigest,
    "finalization.decisionCommitmentDigest",
  );
  normalizeDigest(snapshot.requestDigest, "finalization.requestDigest");
  normalizeTimestamp(snapshot.finalizedAt, "finalization.finalizedAt");
  normalizeId(snapshot.authorityRevision, "finalization.authorityRevision");
  normalizeAttestation(snapshot.attestation, "finalization.attestation");
  return snapshot;
}

function normalizeCellResult(value, label) {
  assertExactRecord(value, CELL_RESULT_KEYS, label);
  const planCell = normalizePlanCell(
    Object.fromEntries([...PLAN_CELL_KEYS].map((key) => [key, value[key]])),
    label,
  );
  return deepFreeze({
    ...planCell,
    runId: normalizeId(value.runId, `${label}.runId`),
    runNonce: normalizeId(value.runNonce, `${label}.runNonce`),
    evaluationContextDigest: normalizeDigest(
      value.evaluationContextDigest,
      `${label}.evaluationContextDigest`,
    ),
    childReceiptDigest: normalizeDigest(
      value.childReceiptDigest,
      `${label}.childReceiptDigest`,
    ),
    childFullDigest: normalizeDigest(
      value.childFullDigest,
      `${label}.childFullDigest`,
    ),
    confidenceZ: normalizeFinite(value.confidenceZ, `${label}.confidenceZ`, {
      minimum: 1.64,
      maximum: 4,
    }),
    decision: normalizeDecision(value.decision, `${label}.decision`),
    reasonCodes: normalizeReasonCodes(
      value.reasonCodes,
      `${label}.reasonCodes`,
    ),
    issuedAt: normalizeTimestamp(value.issuedAt, `${label}.issuedAt`).timestamp,
    expiresAt: normalizeTimestamp(value.expiresAt, `${label}.expiresAt`)
      .timestamp,
  });
}

function normalizeCellResults(value) {
  const results = assertDenseStandardArray(value, "matrix cell results", {
    minimum: 1,
    maximum: MAX_CELLS,
  }).map((entry, index) =>
    normalizeCellResult(entry, `matrix cell results[${index}]`),
  );
  for (const key of [
    "cellId",
    "invocationId",
    "invocationNonce",
    "runId",
    "runNonce",
    "evaluationContextDigest",
    "childReceiptDigest",
    "childFullDigest",
  ]) {
    if (new Set(results.map((entry) => entry[key])).size !== results.length) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        `matrix cell result ${key} values must be unique`,
      );
    }
  }
  const ordered = [...results].sort((left, right) =>
    left.cellId < right.cellId ? -1 : left.cellId > right.cellId ? 1 : 0,
  );
  if (!sameCanonical(results, ordered)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix cell results are not in canonical cell order",
    );
  }
  return deepFreeze(ordered);
}

function childReceiptRoot(cellResults) {
  return domainDigest(
    "chainlesschain.skill-target-matrix-eval-child-receipt-root/v1",
    cellResults.map((cell) =>
      deepFreeze({
        cellId: cell.cellId,
        childFullDigest: cell.childFullDigest,
      }),
    ),
    "matrix child receipt root",
  );
}

function receiptCore(receipt) {
  return deepFreeze(
    Object.fromEntries(
      [...RECEIPT_KEYS]
        .filter((key) => key !== "receiptDigest" && key !== "attestation")
        .map((key) => [key, receipt[key]]),
    ),
  );
}

function normalizeExpectedReceipt(value) {
  const snapshot = canonicalClone(value, "expected matrix receipt context");
  assertExactRecord(
    snapshot,
    EXPECTED_RECEIPT_KEYS,
    "expected matrix receipt context",
  );
  return deepFreeze({
    matrixEvalId: normalizeId(snapshot.matrixEvalId, "expected.matrixEvalId"),
    tenantId: normalizeId(snapshot.tenantId, "expected.tenantId"),
    skillName: normalizeId(snapshot.skillName, "expected.skillName", 128),
    candidateId: normalizeDigest(snapshot.candidateId, "expected.candidateId"),
    candidateContentDigest: normalizeDigest(
      snapshot.candidateContentDigest,
      "expected.candidateContentDigest",
    ),
    baselineId: normalizeDigest(snapshot.baselineId, "expected.baselineId"),
    baselineReleaseDigest: normalizeNullableDigest(
      snapshot.baselineReleaseDigest,
      "expected.baselineReleaseDigest",
    ),
    expectedActiveContentDigest: normalizeDigest(
      snapshot.expectedActiveContentDigest,
      "expected.expectedActiveContentDigest",
    ),
    expectedActiveRevision: normalizeInteger(
      snapshot.expectedActiveRevision,
      "expected.expectedActiveRevision",
    ),
    dependencyLockDigest: normalizeDigest(
      snapshot.dependencyLockDigest,
      "expected.dependencyLockDigest",
    ),
    runtimeManifestDigest: normalizeDigest(
      snapshot.runtimeManifestDigest,
      "expected.runtimeManifestDigest",
    ),
    targetMatrixRoot: normalizeDigest(
      snapshot.targetMatrixRoot,
      "expected.targetMatrixRoot",
    ),
    matrixAuthorityRoot: normalizeDigest(
      snapshot.matrixAuthorityRoot,
      "expected.matrixAuthorityRoot",
    ),
    planDigest: normalizeDigest(snapshot.planDigest, "expected.planDigest"),
    decision: normalizeDecision(snapshot.decision, "expected.decision"),
  });
}

function verifyMatrixReceiptStructure(
  value,
  receiptTrust,
  maximumReceiptTtlMs,
) {
  const snapshot = canonicalClone(value, "matrix evaluation receipt");
  assertExactRecord(snapshot, RECEIPT_KEYS, "matrix evaluation receipt");
  if (snapshot.schema !== SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix evaluation receipt schema is invalid",
    );
  }
  const planAuthentication = normalizePlanAuthentication(
    snapshot.planAuthentication,
  );
  const reservation = normalizeStandaloneReservation(snapshot.reservation);
  const finalization = normalizeStandaloneFinalization(snapshot.finalization);
  const cellResults = normalizeCellResults(snapshot.cellResults);
  const decision = deriveMatrixDecision(cellResults, snapshot);
  const normalized = deepFreeze({
    schema: SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
    matrixEvalId: normalizeId(snapshot.matrixEvalId, "receipt.matrixEvalId"),
    nonce: normalizeId(snapshot.nonce, "receipt.nonce"),
    tenantId: normalizeId(snapshot.tenantId, "receipt.tenantId"),
    skillName: normalizeId(snapshot.skillName, "receipt.skillName", 128),
    candidateId: normalizeDigest(snapshot.candidateId, "receipt.candidateId"),
    candidateContentDigest: normalizeDigest(
      snapshot.candidateContentDigest,
      "receipt.candidateContentDigest",
    ),
    baselineId: normalizeDigest(snapshot.baselineId, "receipt.baselineId"),
    baselineReleaseDigest: normalizeNullableDigest(
      snapshot.baselineReleaseDigest,
      "receipt.baselineReleaseDigest",
    ),
    expectedActiveContentDigest: normalizeDigest(
      snapshot.expectedActiveContentDigest,
      "receipt.expectedActiveContentDigest",
    ),
    expectedActiveRevision: normalizeInteger(
      snapshot.expectedActiveRevision,
      "receipt.expectedActiveRevision",
    ),
    dependencyLockDigest: normalizeDigest(
      snapshot.dependencyLockDigest,
      "receipt.dependencyLockDigest",
    ),
    runtimeManifestDigest: normalizeDigest(
      snapshot.runtimeManifestDigest,
      "receipt.runtimeManifestDigest",
    ),
    targetMatrixRoot: normalizeDigest(
      snapshot.targetMatrixRoot,
      "receipt.targetMatrixRoot",
    ),
    matrixAuthorityRoot: normalizeDigest(
      snapshot.matrixAuthorityRoot,
      "receipt.matrixAuthorityRoot",
    ),
    planDigest: normalizeDigest(snapshot.planDigest, "receipt.planDigest"),
    planIssuedAt: normalizeTimestamp(
      snapshot.planIssuedAt,
      "receipt.planIssuedAt",
    ).timestamp,
    planExpiresAt: normalizeTimestamp(
      snapshot.planExpiresAt,
      "receipt.planExpiresAt",
    ).timestamp,
    aggregateReceiptTtlMs: normalizeInteger(
      snapshot.aggregateReceiptTtlMs,
      "receipt.aggregateReceiptTtlMs",
      { minimum: 1_000, maximum: MAX_RECEIPT_TTL_MS },
    ),
    familywiseErrorRate: normalizeFinite(
      snapshot.familywiseErrorRate,
      "receipt.familywiseErrorRate",
      { minimum: 0.001, maximum: 0.1 },
    ),
    comparisonCorrection:
      snapshot.comparisonCorrection === "bonferroni-two-sided"
        ? snapshot.comparisonCorrection
        : (() => {
            throw matrixError(
              SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
              "receipt.comparisonCorrection is invalid",
            );
          })(),
    planAuthentication,
    reservation,
    finalization,
    cellCount: normalizeInteger(snapshot.cellCount, "receipt.cellCount", {
      minimum: 1,
      maximum: MAX_CELLS,
    }),
    cellResults,
    childReceiptRoot: normalizeDigest(
      snapshot.childReceiptRoot,
      "receipt.childReceiptRoot",
    ),
    decisionCommitmentDigest: normalizeDigest(
      snapshot.decisionCommitmentDigest,
      "receipt.decisionCommitmentDigest",
    ),
    decision: normalizeDecision(snapshot.decision, "receipt.decision"),
    reasonCodes: normalizeReasonCodes(
      snapshot.reasonCodes,
      "receipt.reasonCodes",
    ),
    issuedAt: normalizeTimestamp(snapshot.issuedAt, "receipt.issuedAt")
      .timestamp,
    expiresAt: normalizeTimestamp(snapshot.expiresAt, "receipt.expiresAt")
      .timestamp,
    receiptDigest: normalizeDigest(
      snapshot.receiptDigest,
      "receipt.receiptDigest",
    ),
    attestation: normalizeAttestation(
      snapshot.attestation,
      "receipt.attestation",
    ),
  });
  const planShape = normalized;
  const expectedRoot = childReceiptRoot(cellResults);
  const expectedCommitment = matrixDecisionCommitment({
    plan: planShape,
    planAuthentication,
    reservation,
    cellResults,
    childReceiptRoot: expectedRoot,
    decision: decision.decision,
    reasonCodes: decision.reasonCodes,
  });
  const expectedCommitmentDigest = domainDigest(
    "chainlesschain.skill-target-matrix-eval-decision-commitment/v2",
    expectedCommitment,
    "matrix decision commitment",
  );
  const expectedReceiptDigest = domainDigest(
    SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
    receiptCore(normalized),
    "matrix evaluation receipt core",
  );
  const issuedMs = new Date(normalized.issuedAt).getTime();
  const expiresMs = new Date(normalized.expiresAt).getTime();
  const planIssuedMs = new Date(normalized.planIssuedAt).getTime();
  const planExpiresMs = new Date(normalized.planExpiresAt).getTime();
  const planVerifiedMs = new Date(
    normalized.planAuthentication.verifiedAt,
  ).getTime();
  const reservedMs = new Date(normalized.reservation.reservedAt).getTime();
  const finalizedMs = new Date(normalized.finalization.finalizedAt).getTime();
  const childIssuedTimes = cellResults.map((cell) =>
    new Date(cell.issuedAt).getTime(),
  );
  const latestChildIssuedMs = Math.max(...childIssuedTimes);
  const childTimelineInvalid = cellResults.some((cell, index) => {
    const childIssuedMs = childIssuedTimes[index];
    const childExpiresAtMs = new Date(cell.expiresAt).getTime();
    return (
      childExpiresAtMs <= childIssuedMs ||
      childIssuedMs < planIssuedMs - CLOCK_SKEW_MS ||
      childIssuedMs < reservedMs - CLOCK_SKEW_MS ||
      childIssuedMs > issuedMs + CLOCK_SKEW_MS ||
      childIssuedMs >= planExpiresMs
    );
  });
  const childExpiresMs = Math.min(
    ...cellResults.map((cell) => new Date(cell.expiresAt).getTime()),
  );
  const exactExpiresMs = Math.min(
    planExpiresMs,
    childExpiresMs,
    issuedMs + normalized.aggregateReceiptTtlMs,
  );
  if (
    normalized.cellCount !== cellResults.length ||
    normalized.childReceiptRoot !== expectedRoot ||
    normalized.decision !== decision.decision ||
    !sameCanonical(normalized.reasonCodes, decision.reasonCodes) ||
    normalized.decisionCommitmentDigest !== expectedCommitmentDigest ||
    normalized.finalization.decisionCommitmentDigest !==
      expectedCommitmentDigest ||
    normalized.reservation.tenantId !== normalized.tenantId ||
    normalized.reservation.matrixEvalId !== normalized.matrixEvalId ||
    normalized.reservation.planDigest !== normalized.planDigest ||
    normalized.reservation.planNonce !== normalized.nonce ||
    normalized.reservation.matrixAuthorityRoot !==
      normalized.matrixAuthorityRoot ||
    normalized.reservation.expiresAt !== normalized.planExpiresAt ||
    normalized.finalization.tenantId !== normalized.tenantId ||
    normalized.finalization.matrixEvalId !== normalized.matrixEvalId ||
    normalized.finalization.planDigest !== normalized.planDigest ||
    normalized.finalization.reservationId !==
      normalized.reservation.reservationId ||
    normalized.finalization.reservationReceiptDigest !==
      normalized.reservation.receiptDigest ||
    normalized.planAuthentication.planRef.digest !== normalized.planDigest ||
    normalized.receiptDigest !== expectedReceiptDigest ||
    !sameTrust(normalized.attestation, receiptTrust) ||
    expiresMs !== exactExpiresMs ||
    expiresMs <= issuedMs ||
    expiresMs - issuedMs > maximumReceiptTtlMs ||
    planExpiresMs <= planIssuedMs ||
    planExpiresMs - planIssuedMs > MAX_PLAN_TTL_MS ||
    issuedMs < planIssuedMs - CLOCK_SKEW_MS ||
    issuedMs >= planExpiresMs ||
    planVerifiedMs < planIssuedMs - CLOCK_SKEW_MS ||
    planVerifiedMs > issuedMs + CLOCK_SKEW_MS ||
    planVerifiedMs >= planExpiresMs ||
    reservedMs < planIssuedMs - CLOCK_SKEW_MS ||
    reservedMs < planVerifiedMs - CLOCK_SKEW_MS ||
    reservedMs > finalizedMs + CLOCK_SKEW_MS ||
    reservedMs > issuedMs + CLOCK_SKEW_MS ||
    finalizedMs < reservedMs - CLOCK_SKEW_MS ||
    finalizedMs < latestChildIssuedMs - CLOCK_SKEW_MS ||
    finalizedMs > issuedMs + CLOCK_SKEW_MS ||
    finalizedMs >= planExpiresMs ||
    childTimelineInvalid
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "matrix evaluation receipt binding, decision, expiry, or signature trust is invalid",
    );
  }
  return normalized;
}

async function verifyReceiptSignature(
  composition,
  receiptDigest,
  attestation,
  deadlineMs,
  wallDeadlineAt,
  label,
) {
  const verified = await invokeSupervised(
    composition.supervision,
    label,
    { purpose: RECEIPT_SIGNATURE_PURPOSE, receiptDigest, attestation },
    (signal) =>
      composition.verifier.callable(
        signaturePayload(RECEIPT_SIGNATURE_PURPOSE, receiptDigest, attestation),
        Object.freeze({ signal }),
      ),
    deadlineMs,
    wallDeadlineAt,
  );
  if (verified !== true) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      "matrix evaluation receipt signature was rejected",
    );
  }
}

async function retainAndResolveChildReceipt(
  composition,
  tenantId,
  planCell,
  receipt,
  deadlineMs,
  wallDeadlineAt,
) {
  const receiptDigest = normalizeDigest(
    receipt.receiptDigest,
    `matrix cell ${planCell.cellId} receiptDigest`,
  );
  const acknowledgement = await invokeSupervised(
    composition.supervision,
    `cell-receipt-retain-${planCell.cellId}`,
    { tenantId, cellId: planCell.cellId, receiptDigest },
    () =>
      composition.childReceiptStore.retain({
        kind: "gate-receipt",
        evidence: receipt,
        receiptDigest,
      }),
    deadlineMs,
    wallDeadlineAt,
  );
  if (
    acknowledgement?.authenticated !== true ||
    acknowledgement.durable !== true ||
    acknowledgement.kind !== "gate-receipt" ||
    acknowledgement.receiptDigest !== receiptDigest
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      `matrix cell ${planCell.cellId} receipt was not durably retained`,
    );
  }
  const storeDescriptor = composition.childReceiptStore.descriptor;
  const resolution = await invokeSupervised(
    composition.supervision,
    `cell-receipt-resolve-${planCell.cellId}`,
    { tenantId, cellId: planCell.cellId, receiptDigest },
    () =>
      composition.childReceiptStore.resolve({
        tenantId,
        kind: "gate-receipt",
        receiptDigest,
      }),
    deadlineMs,
    wallDeadlineAt,
  );
  if (
    resolution?.authenticated !== true ||
    resolution.durable !== true ||
    resolution.authorityId !== storeDescriptor.authorityId ||
    resolution.revision !== storeDescriptor.revision ||
    resolution.handlerArtifactDigest !==
      storeDescriptor.handlerArtifactDigest ||
    resolution.tenantId !== tenantId ||
    resolution.streamId !== storeDescriptor.streamId ||
    resolution.kind !== "gate-receipt" ||
    resolution.receiptDigest !== receiptDigest ||
    !sameCanonical(resolution.evidence, receipt)
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
      `matrix cell ${planCell.cellId} durable receipt readback was substituted`,
    );
  }
  return canonicalClone(
    resolution.evidence,
    `matrix cell ${planCell.cellId} durable child receipt`,
  );
}

function compositionPrincipalEntries(composition, cellAuthorities) {
  const entries = [
    { role: "planSigner", trust: composition.planTrust },
    {
      role: "planResolver",
      trust: composition.planResolver.descriptor.authority,
    },
    {
      role: "evidenceVerifier",
      trust: composition.evidenceVerifier.descriptor.authority,
    },
    {
      role: "reservationAuthority",
      trust: composition.reservation.reservationDescriptor.authority,
    },
    {
      role: "matrixSupervisor",
      trust: composition.supervision.descriptor.authority,
    },
    { role: "matrixSigner", trust: composition.signer.descriptor.authority },
    {
      role: "matrixVerifier",
      trust: composition.verifier.descriptor.authority,
    },
    { role: "trustedClock", trust: composition.clockDescriptor.authority },
  ];
  for (const cell of cellAuthorities) {
    entries.push(
      { role: `cellGate:${cell.cellId}`, trust: cell.gateDescriptor.authority },
      {
        role: `cellReceiptVerifier:${cell.cellId}`,
        trust: cell.receiptVerifierDescriptor.authority,
      },
    );
  }
  return entries;
}

export class SkillTargetMatrixEvalAggregator {
  #state;
  #used = false;

  constructor(options) {
    assertExactRecord(
      options,
      AGGREGATOR_OPTION_KEYS,
      "matrix aggregator options",
    );
    const tenantId = normalizeId(
      options.tenantId,
      "matrix aggregator tenantId",
    );
    const dependencyLock = verifySkillDependencyLock(options.dependencyLock);
    const runtimeManifest = verifySkillRuntimeManifest(options.runtimeManifest);
    const targetMatrix = verifySkillTargetMatrix(options.targetMatrix, {
      dependencyLock,
      runtimeManifest,
      expectedEnvironmentBindings: options.expectedEnvironmentBindings,
      expectedTargetMatrixRoot: options.expectedTargetMatrixRoot,
    });
    if (
      dependencyLock.tenantId !== tenantId ||
      runtimeManifest.tenantId !== tenantId ||
      targetMatrix.tenantId !== tenantId
    ) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        "matrix composition artifacts must belong to the captured tenant",
      );
    }
    const cells = captureCellRuntimes(options.cellRuntimes);
    const matrixCellIds = targetMatrix.cells.map((cell) => cell.cellId);
    const runtimeCellIds = [...cells.runtimes.keys()].sort();
    if (!sameCanonical(matrixCellIds, runtimeCellIds)) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        "cellRuntimes must exactly cover the canonical target matrix",
      );
    }
    const composition = captureComposition(options);
    if (composition.childReceiptStore.descriptor.tenantId !== tenantId) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
        "childReceiptStore belongs to another tenant",
      );
    }
    validatePrincipalMatrix(
      compositionPrincipalEntries(composition, cells.authorities),
    );
    const matrixAuthorityRoot = computeSkillTargetMatrixEvalAuthorityRoot({
      planResolverDescriptor: composition.planResolver.descriptor,
      evidenceVerifierDescriptor: composition.evidenceVerifier.descriptor,
      reservationDescriptor: composition.reservation.reservationDescriptor,
      finalizationDescriptor: composition.reservation.finalizationDescriptor,
      supervisorDescriptor: composition.supervision.descriptor,
      matrixSignerDescriptor: composition.signer.descriptor,
      matrixVerifierDescriptor: composition.verifier.descriptor,
      clockDescriptor: composition.clockDescriptor,
      planTrust: composition.planTrust,
      matrixReceiptTrust: composition.receiptTrust,
      childReceiptStoreDescriptor: composition.childReceiptStore.descriptor,
      cellAuthorities: cells.authorities,
    });
    const maximumMatrixWallClockMs = normalizeInteger(
      options.maximumMatrixWallClockMs,
      "maximumMatrixWallClockMs",
      { minimum: 100, maximum: 3_600_000 },
    );
    readTrustedClock(composition.clock);
    this.#state = Object.freeze({
      tenantId,
      dependencyLock,
      runtimeManifest,
      targetMatrix,
      cellRuntimes: cells.runtimes,
      composition,
      matrixAuthorityRoot,
      maximumMatrixWallClockMs,
    });
    AGGREGATOR_INSTANCES.add(this);
    Object.freeze(this);
  }

  async evaluate(planRefInput) {
    if (this.#used) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_REPLAYED_CODE,
        "matrix aggregator instances are one-shot",
      );
    }
    this.#used = true;
    const entryMonotonicMs = NATIVE_MONOTONIC_NOW();
    const state = this.#state;
    const planRef = normalizePlanRef(
      canonicalClone(planRefInput, "matrix evaluation planRef"),
    );
    const entryClock = readTrustedClock(state.composition.clock);
    const configuredDeadlineMs =
      entryMonotonicMs + state.maximumMatrixWallClockMs;
    const configuredWallDeadlineMs =
      entryClock.milliseconds + state.maximumMatrixWallClockMs;
    const configuredWallDeadlineAt = new Date(
      configuredWallDeadlineMs,
    ).toISOString();
    const resolved = await resolveAndAuthenticatePlan(
      state,
      planRef,
      configuredDeadlineMs,
      configuredWallDeadlineAt,
    );
    const plan = resolved.plan;
    assertPlanMatchesComposition(plan, state);
    const planExpiresMs = new Date(plan.expiresAt).getTime();
    const deadlineMs = Math.min(
      configuredDeadlineMs,
      entryMonotonicMs + plan.maxTotalWallClockMs,
      entryMonotonicMs + (planExpiresMs - entryClock.milliseconds),
    );
    const wallDeadlineAt = new Date(
      Math.min(
        configuredWallDeadlineMs,
        entryClock.milliseconds + plan.maxTotalWallClockMs,
        planExpiresMs,
      ),
    ).toISOString();
    assertRootDeadline(deadlineMs, "matrix evaluation plan resolution");
    const reservation = await reservePlan(
      state,
      plan,
      deadlineMs,
      wallDeadlineAt,
    );
    const cellResults = [];
    for (const planCell of plan.cells) {
      assertRootDeadline(deadlineMs, `matrix cell ${planCell.cellId}`);
      // This authority-root and signed-plan commitment is the trusted
      // composition's bound for the branded Gate's complete API settlement,
      // including its own hard-deadline termination grace. An attested loader
      // must bind it to the captured policyDigest and actual Gate instance.
      if (
        remainingMilliseconds(deadlineMs) <= planCell.maximumCellSettlementMs
      ) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_DEADLINE_CODE,
          `matrix cell ${planCell.cellId} cannot start without its preregistered settlement window`,
        );
      }
      const runtime = state.cellRuntimes.get(planCell.cellId);
      const gateRequest = deepFreeze({
        suiteRef: planCell.suiteRef,
        candidateId: plan.candidateId,
        baselineId: plan.baselineId,
        targetEnvironmentRef: planCell.targetEnvironmentRef,
        evaluationContext: deepFreeze({
          planDigest: plan.planDigest,
          targetMatrixRoot: plan.targetMatrixRoot,
          cellId: planCell.cellId,
          runtimeId: planCell.runtimeId,
        }),
      });
      // The preregistered invocation identity is the signed plan cell plus the
      // durable reservation. Gate-generated runId/runNonce are only exact
      // child-verifier parameters read from this captured Promise result; they
      // are not treated as an independent replay boundary.
      const childFromGate = await invokeSupervised(
        state.composition.supervision,
        `cell-gate-${planCell.cellId}`,
        {
          invocationId: planCell.invocationId,
          invocationNonce: planCell.invocationNonce,
          gateRequest,
        },
        () => runEvolutionEvalGate(runtime.gate, gateRequest),
        deadlineMs,
        wallDeadlineAt,
      );
      const expectedContextDigest = computeEvolutionEvalContextDigest({
        planDigest: plan.planDigest,
        tenantId: plan.tenantId,
        targetMatrixRoot: plan.targetMatrixRoot,
        cellId: planCell.cellId,
        runtimeId: planCell.runtimeId,
        targetEnvironmentRef: planCell.targetEnvironmentRef,
        environmentDigest: planCell.environmentDigest,
        candidateId: plan.candidateId,
        baselineId: plan.baselineId,
        suiteDigest: planCell.suiteDigest,
        policyDigest: planCell.policyDigest,
        evaluationAuthorityRoot: planCell.evaluationAuthorityRoot,
      });
      const expectedChild = deepFreeze({
        runId: normalizeId(childFromGate.runId, "child receipt runId"),
        runNonce: normalizeId(childFromGate.runNonce, "child receipt runNonce"),
        suiteDigest: planCell.suiteDigest,
        policyDigest: planCell.policyDigest,
        evaluationAuthorityRoot: planCell.evaluationAuthorityRoot,
        targetEnvironmentRef: planCell.targetEnvironmentRef,
        evaluationContextDigest: expectedContextDigest,
        candidateId: plan.candidateId,
        baselineId: plan.baselineId,
        environmentDigest: planCell.environmentDigest,
        tenantId: plan.tenantId,
        provenanceAudience: planCell.provenanceAudience,
        trainerAuthority: planCell.trainerAuthority,
        trainerRevision: planCell.trainerRevision,
      });
      const verifiedChild = await invokeSupervised(
        state.composition.supervision,
        `cell-receipt-verify-${planCell.cellId}`,
        {
          invocationId: planCell.invocationId,
          invocationNonce: planCell.invocationNonce,
          childFullDigest: domainDigest(
            "chainlesschain.skill-target-matrix-eval-child-receipt/v1",
            childFromGate,
            `matrix cell ${planCell.cellId} child receipt`,
          ),
          expectedChild,
        },
        () =>
          verifyEvolutionEvalReceipt(
            runtime.receiptVerifier,
            childFromGate,
            expectedChild,
          ),
        deadlineMs,
        wallDeadlineAt,
      );
      const verifiedSnapshot = canonicalClone(
        verifiedChild,
        `matrix cell ${planCell.cellId} verified receipt`,
      );
      if (
        verifiedSnapshot.runId !== expectedChild.runId ||
        verifiedSnapshot.runNonce !== expectedChild.runNonce ||
        verifiedSnapshot.evaluationContextDigest !== expectedContextDigest ||
        verifiedSnapshot.receiptDigest !== childFromGate.receiptDigest
      ) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
          `matrix cell verifier returned a different receipt: ${planCell.cellId}`,
        );
      }
      const durableChild = await retainAndResolveChildReceipt(
        state.composition,
        plan.tenantId,
        planCell,
        verifiedSnapshot,
        deadlineMs,
        wallDeadlineAt,
      );
      const issuedAt = normalizeTimestamp(
        durableChild.issuedAt,
        `matrix cell ${planCell.cellId} issuedAt`,
      ).timestamp;
      const expiresAt = normalizeTimestamp(
        durableChild.expiresAt,
        `matrix cell ${planCell.cellId} expiresAt`,
      ).timestamp;
      cellResults.push(
        deepFreeze({
          ...planCell,
          runId: expectedChild.runId,
          runNonce: expectedChild.runNonce,
          evaluationContextDigest: expectedContextDigest,
          childReceiptDigest: normalizeDigest(
            durableChild.receiptDigest,
            `matrix cell ${planCell.cellId} receiptDigest`,
          ),
          childFullDigest: domainDigest(
            "chainlesschain.skill-target-matrix-eval-child-receipt/v1",
            durableChild,
            `matrix cell ${planCell.cellId} verified full receipt`,
          ),
          confidenceZ: normalizeFinite(
            durableChild.confidenceZ,
            `matrix cell ${planCell.cellId} confidenceZ`,
            { minimum: 1.64, maximum: 4 },
          ),
          decision: normalizeDecision(
            durableChild.decision,
            `matrix cell ${planCell.cellId} decision`,
          ),
          reasonCodes: normalizeReasonCodes(
            durableChild.reasonCodes,
            `matrix cell ${planCell.cellId} reasonCodes`,
          ),
          issuedAt,
          expiresAt,
        }),
      );
    }
    const normalizedCells = normalizeCellResults(cellResults);
    const root = childReceiptRoot(normalizedCells);
    const derived = deriveMatrixDecision(normalizedCells, plan);
    const commitment = matrixDecisionCommitment({
      plan,
      planAuthentication: resolved.authentication,
      reservation,
      cellResults: normalizedCells,
      childReceiptRoot: root,
      decision: derived.decision,
      reasonCodes: derived.reasonCodes,
    });
    const decisionCommitmentDigest = domainDigest(
      "chainlesschain.skill-target-matrix-eval-decision-commitment/v2",
      commitment,
      "matrix decision commitment",
    );
    const finalization = await finalizePlan(
      state,
      plan,
      reservation,
      decisionCommitmentDigest,
      deadlineMs,
      wallDeadlineAt,
    );
    const issued = readTrustedClock(state.composition.clock);
    const childExpiresMs = Math.min(
      ...normalizedCells.map((cell) => new Date(cell.expiresAt).getTime()),
    );
    const expiresMs = Math.min(
      planExpiresMs,
      childExpiresMs,
      issued.milliseconds + plan.aggregateReceiptTtlMs,
    );
    if (expiresMs <= issued.milliseconds) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
        "matrix receipt inputs expired before aggregation completed",
      );
    }
    const core = deepFreeze({
      schema: SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
      matrixEvalId: plan.matrixEvalId,
      nonce: plan.nonce,
      tenantId: plan.tenantId,
      skillName: plan.skillName,
      candidateId: plan.candidateId,
      candidateContentDigest: plan.candidateContentDigest,
      baselineId: plan.baselineId,
      baselineReleaseDigest: plan.baselineReleaseDigest,
      expectedActiveContentDigest: plan.expectedActiveContentDigest,
      expectedActiveRevision: plan.expectedActiveRevision,
      dependencyLockDigest: plan.dependencyLockDigest,
      runtimeManifestDigest: plan.runtimeManifestDigest,
      targetMatrixRoot: plan.targetMatrixRoot,
      matrixAuthorityRoot: plan.matrixAuthorityRoot,
      planDigest: plan.planDigest,
      planIssuedAt: plan.issuedAt,
      planExpiresAt: plan.expiresAt,
      aggregateReceiptTtlMs: plan.aggregateReceiptTtlMs,
      familywiseErrorRate: plan.familywiseErrorRate,
      comparisonCorrection: plan.comparisonCorrection,
      planAuthentication: resolved.authentication,
      reservation,
      finalization,
      cellCount: normalizedCells.length,
      cellResults: normalizedCells,
      childReceiptRoot: root,
      decisionCommitmentDigest,
      decision: derived.decision,
      reasonCodes: derived.reasonCodes,
      issuedAt: issued.timestamp,
      expiresAt: new Date(expiresMs).toISOString(),
    });
    const receiptDigest = domainDigest(
      SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
      core,
      "matrix evaluation receipt core",
    );
    const rawAttestation = await invokeSupervised(
      state.composition.supervision,
      "matrix-receipt-sign",
      { purpose: RECEIPT_SIGNATURE_PURPOSE, receiptDigest },
      (signal) =>
        state.composition.signer.callable(
          deepFreeze({
            purpose: RECEIPT_SIGNATURE_PURPOSE,
            payloadDigest: receiptDigest,
          }),
          Object.freeze({ signal }),
        ),
      deadlineMs,
      wallDeadlineAt,
    );
    const attestation = normalizeAttestation(
      rawAttestation,
      "matrix receipt signer attestation",
    );
    if (!sameTrust(attestation, state.composition.receiptTrust)) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
        "matrix receipt signer used an unexpected trust identity",
      );
    }
    const receipt = verifyMatrixReceiptStructure(
      deepFreeze({ ...core, receiptDigest, attestation }),
      state.composition.receiptTrust,
      MAX_RECEIPT_TTL_MS,
    );
    await verifyReceiptSignature(
      state.composition,
      receipt.receiptDigest,
      receipt.attestation,
      deadlineMs,
      wallDeadlineAt,
      "matrix-receipt-post-sign-verify",
    );
    const returned = readTrustedClock(state.composition.clock);
    if (
      returned.milliseconds >= expiresMs ||
      NATIVE_MONOTONIC_NOW() >= deadlineMs
    ) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_DEADLINE_CODE,
        "matrix receipt expired before its verified snapshot could be returned",
      );
    }
    return receipt;
  }
}

function captureReceiptVerificationComposition(options) {
  const receiptTrust = normalizeTrust(
    options.matrixReceiptTrust,
    "matrixReceiptTrust",
  );
  const signerDescriptor = normalizeDescriptor(
    options.matrixReceiptSignerDescriptor,
    "matrixReceiptSignerDescriptor",
    { operation: "matrix-receipt-sign" },
  );
  const verifier = capturePort(
    options.matrixReceiptVerifier,
    VERIFY_PORT_KEYS,
    "verify",
    "matrixReceiptVerifier",
    "authorityDescriptor",
    { operation: "matrix-receipt-verify" },
  );
  if (
    !sameTrust(signerDescriptor.authority, receiptTrust) ||
    !sameTrust(verifier.descriptor.authority, receiptTrust)
  ) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "matrix receipt signer descriptor and verifier must be the exact trust pair",
    );
  }
  const supervisorPolicy = normalizePolicy(
    options.supervisorPolicy,
    "supervisorPolicy",
  );
  const supervisor = capturePort(
    options.matrixSupervisor,
    SUPERVISOR_PORT_KEYS,
    "run",
    "matrixSupervisor",
    "authorityDescriptor",
    { operation: "matrix-operation-supervise", policy: supervisorPolicy },
  );
  const clockPolicy = normalizePolicy(options.clockPolicy, "clockPolicy");
  const clockPort = capturePort(
    options.clock,
    CLOCK_PORT_KEYS,
    "now",
    "trustedClock",
    "authorityDescriptor",
    { operation: "trusted-time-read", policy: clockPolicy },
  );
  const clock = () => clockPort.callable();
  const supervisionClock = () => normalizeClockResult(clock(), "trusted clock");
  Object.freeze(clock);
  Object.freeze(supervisionClock);
  ensureUniqueCallables([
    { role: "matrixReceiptVerifier.verify", raw: verifier.raw },
    { role: "matrixSupervisor.run", raw: supervisor.raw },
    { role: "trustedClock.now", raw: clockPort.raw },
  ]);
  validatePrincipalMatrix([
    { role: "matrixSigner", trust: signerDescriptor.authority },
    { role: "matrixVerifier", trust: verifier.descriptor.authority },
    { role: "matrixSupervisor", trust: supervisor.descriptor.authority },
    { role: "trustedClock", trust: clockPort.descriptor.authority },
  ]);
  const supervision = Object.freeze({
    run: supervisor.callable,
    descriptor: supervisor.descriptor,
    policy: supervisorPolicy,
    clock: supervisionClock,
  });
  return Object.freeze({
    signerDescriptor,
    verifier,
    receiptTrust,
    clock,
    clockDescriptor: clockPort.descriptor,
    supervision,
  });
}

export class SkillTargetMatrixEvalReceiptVerifier {
  #state;

  constructor(options) {
    assertExactRecord(
      options,
      RECEIPT_VERIFIER_OPTION_KEYS,
      "matrix receipt verifier options",
    );
    const composition = captureReceiptVerificationComposition(options);
    const maximumReceiptTtlMs = normalizeInteger(
      options.maximumReceiptTtlMs,
      "maximumReceiptTtlMs",
      { minimum: 1_000, maximum: MAX_RECEIPT_TTL_MS },
    );
    const maximumVerificationMs = normalizeInteger(
      options.maximumVerificationMs,
      "maximumVerificationMs",
      { minimum: 100, maximum: 60_000 },
    );
    readTrustedClock(composition.clock);
    this.#state = Object.freeze({
      composition,
      maximumReceiptTtlMs,
      maximumVerificationMs,
    });
    RECEIPT_VERIFIER_INSTANCES.add(this);
    Object.freeze(this);
  }

  async verify(value, expected) {
    const entryMonotonicMs = NATIVE_MONOTONIC_NOW();
    const entryClock = readTrustedClock(this.#state.composition.clock);
    const maximumDeadlineMs =
      entryMonotonicMs + this.#state.maximumVerificationMs;
    // Both attacker-controlled graphs are uniquely snapshotted before the
    // first await; no later decision reads the caller's mutable objects.
    const receiptInput = canonicalClone(value, "matrix evaluation receipt");
    const normalizedExpected = normalizeExpectedReceipt(expected);
    const receipt = verifyMatrixReceiptStructure(
      receiptInput,
      this.#state.composition.receiptTrust,
      this.#state.maximumReceiptTtlMs,
    );
    for (const [key, expectedValue] of Object.entries(normalizedExpected)) {
      if (receipt[key] !== expectedValue) {
        throw matrixError(
          SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
          `matrix evaluation receipt differs from expected ${key}`,
        );
      }
    }
    const now = readTrustedClock(this.#state.composition.clock);
    const issuedMs = new Date(receipt.issuedAt).getTime();
    const expiresMs = new Date(receipt.expiresAt).getTime();
    const deadlineMs = Math.min(
      maximumDeadlineMs,
      entryMonotonicMs + (expiresMs - entryClock.milliseconds),
    );
    if (
      issuedMs > now.milliseconds + CLOCK_SKEW_MS ||
      expiresMs <= now.milliseconds
    ) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_AUTHORITY_FAILED_CODE,
        "matrix evaluation receipt is stale or future-dated",
      );
    }
    const wallDeadlineAt = new Date(
      Math.min(
        expiresMs,
        entryClock.milliseconds + this.#state.maximumVerificationMs,
      ),
    ).toISOString();
    assertRootDeadline(deadlineMs, "matrix receipt verification");
    await verifyReceiptSignature(
      this.#state.composition,
      receipt.receiptDigest,
      receipt.attestation,
      deadlineMs,
      wallDeadlineAt,
      "matrix-receipt-external-verify",
    );
    const returned = readTrustedClock(this.#state.composition.clock);
    if (
      returned.milliseconds >= expiresMs ||
      NATIVE_MONOTONIC_NOW() >= deadlineMs
    ) {
      throw matrixError(
        SKILL_TARGET_MATRIX_EVAL_DEADLINE_CODE,
        "matrix receipt expired during verification",
      );
    }
    return receipt;
  }
}

Object.freeze(SkillTargetMatrixEvalAggregator.prototype);
Object.freeze(SkillTargetMatrixEvalReceiptVerifier.prototype);

export async function evaluateSkillTargetMatrix(aggregator, planRef) {
  if (!AGGREGATOR_INSTANCES.has(aggregator)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "evaluateSkillTargetMatrix requires a branded trusted aggregator",
    );
  }
  return SkillTargetMatrixEvalAggregator.prototype.evaluate.call(
    aggregator,
    planRef,
  );
}

export async function verifySkillTargetMatrixEvalReceipt(
  verifier,
  value,
  expected,
) {
  if (!RECEIPT_VERIFIER_INSTANCES.has(verifier)) {
    throw matrixError(
      SKILL_TARGET_MATRIX_EVAL_INVALID_CODE,
      "verifySkillTargetMatrixEvalReceipt requires a branded read-only verifier",
    );
  }
  return SkillTargetMatrixEvalReceiptVerifier.prototype.verify.call(
    verifier,
    value,
    expected,
  );
}
