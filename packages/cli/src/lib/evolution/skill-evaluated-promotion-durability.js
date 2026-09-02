import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA,
  SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
  SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLVER_SCHEMA,
  buildSkillEvaluatedPromotionReceiptEnvelope,
} from "./skill-evaluated-promotion.js";

export const SKILL_EVALUATED_PROMOTION_DURABILITY_AUTHORITY_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-durability-authority/v1";
export const SKILL_EVALUATED_PROMOTION_DURABILITY_RETAIN_REQUEST_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-durability-retain-request/v1";
export const SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLVE_REQUEST_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-durability-resolve-request/v1";
export const SKILL_EVALUATED_PROMOTION_DURABILITY_RECEIPT_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-durability-receipt/v1";
export const SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLUTION_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-durability-resolution/v1";
export const SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES =
  Object.freeze({
    retain: "skill-evaluated-promotion-durability-retain",
    resolve: "skill-evaluated-promotion-durability-resolve",
  });

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const ADAPTER_OPTION_KEYS = new Set([
  "authority",
  "maximumEvidenceAgeMs",
  "maximumGracePeriodMs",
  "maximumOperationMs",
  "now",
]);
const MAXIMUM_OPERATION_MS = 60_000;
const MAXIMUM_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const MAXIMUM_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5_000;
const NATIVE_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const NATIVE_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const NATIVE_PROMISE = globalThis.Promise;
const NATIVE_PROMISE_RACE = NATIVE_PROMISE.race.bind(NATIVE_PROMISE);
const NATIVE_PROMISE_RESOLVE = NATIVE_PROMISE.resolve.bind(NATIVE_PROMISE);
const AUTHORITY_KEYS = new Set([
  "schema",
  "authorityId",
  "trust",
  "revision",
  "handlerArtifactDigest",
  "attestationTrust",
  "attestationGraceTrusts",
  "retain",
  "resolve",
  "verifyAttestation",
]);
const RESOLVE_REQUEST_KEYS = new Set(["schema", "tenantId", "receiptDigest"]);
const DURABILITY_RECEIPT_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "authorityId",
  "revision",
  "handlerArtifactDigest",
  "tenantId",
  "receiptDigest",
  "persistedAt",
  "persistenceReceiptDigest",
  "attestation",
]);
const DURABILITY_RESOLUTION_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "authorityId",
  "revision",
  "handlerArtifactDigest",
  "tenantId",
  "receiptDigest",
  "matrixReceipt",
  "resolvedAt",
  "resolutionReceiptDigest",
  "attestation",
]);
const TRUST_KEYS = new Set([
  "algorithm",
  "issuer",
  "keyId",
  "trustPolicyDigest",
]);
const ATTESTATION_KEYS = new Set([...TRUST_KEYS, "value"]);
const GRACE_TRUST_KEYS = new Set(["trust", "notAfter"]);
const MAX_GRACE_TRUSTS = 8;
const RETAIN_ATTESTATION_CORE_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "authorityId",
  "revision",
  "handlerArtifactDigest",
  "tenantId",
  "receiptDigest",
  "persistedAt",
  "persistenceReceiptDigest",
]);
const RESOLVE_ATTESTATION_CORE_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "authorityId",
  "revision",
  "handlerArtifactDigest",
  "tenantId",
  "receiptDigest",
  "resolvedAt",
  "resolutionReceiptDigest",
]);

export class SkillEvaluatedPromotionDurabilityError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillEvaluatedPromotionDurabilityError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function failure(code, message, details = {}) {
  return new SkillEvaluatedPromotionDurabilityError(code, message, details);
}

function assertRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `${label} must be a plain object`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
        `${label}.${String(key)} must be an enumerable own data property`,
      );
    }
  }
}

function normalizeId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `${label} is invalid`,
    );
  }
  return value;
}

function normalizeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function normalizeSignature(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 16_384) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `${label} must be a bounded signature`,
    );
  }
  return value;
}

function normalizeTrust(value, label) {
  assertRecord(value, TRUST_KEYS, label);
  return deepFreeze({
    algorithm: normalizeId(value.algorithm, `${label}.algorithm`),
    issuer: normalizeId(value.issuer, `${label}.issuer`),
    keyId: normalizeId(value.keyId, `${label}.keyId`),
    trustPolicyDigest: normalizeDigest(
      value.trustPolicyDigest,
      `${label}.trustPolicyDigest`,
    ),
  });
}

function normalizeAttestation(value, label) {
  assertRecord(value, ATTESTATION_KEYS, label);
  return deepFreeze({
    algorithm: normalizeId(value.algorithm, `${label}.algorithm`),
    issuer: normalizeId(value.issuer, `${label}.issuer`),
    keyId: normalizeId(value.keyId, `${label}.keyId`),
    trustPolicyDigest: normalizeDigest(
      value.trustPolicyDigest,
      `${label}.trustPolicyDigest`,
    ),
    value: normalizeSignature(value.value, `${label}.value`),
  });
}

function sameTrust(left, right) {
  for (const key of TRUST_KEYS) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function normalizeGraceTrusts(value, activeTrust) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > MAX_GRACE_TRUSTS
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `attestationGraceTrusts must be a standard array with at most ${MAX_GRACE_TRUSTS} entries`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      "attestationGraceTrusts must be dense and contain only indexes",
    );
  }
  const seenKeyIds = new Set([activeTrust.keyId]);
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const entryDescriptor = Object.getOwnPropertyDescriptor(
      value,
      String(index),
    );
    if (
      !entryDescriptor ||
      !("value" in entryDescriptor) ||
      !entryDescriptor.enumerable
    ) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
        `attestationGraceTrusts[${index}] must be an enumerable own data property`,
      );
    }
    const entry = entryDescriptor.value;
    assertRecord(entry, GRACE_TRUST_KEYS, `attestationGraceTrusts[${index}]`);
    const trust = normalizeTrust(
      entry.trust,
      `attestationGraceTrusts[${index}].trust`,
    );
    if (seenKeyIds.has(trust.keyId)) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
        "attestation active and grace keyId values must be globally unique",
      );
    }
    seenKeyIds.add(trust.keyId);
    normalized.push(
      deepFreeze({
        trust,
        notAfter: normalizeTime(
          entry.notAfter,
          `attestationGraceTrusts[${index}].notAfter`,
        ),
      }),
    );
  }
  return deepFreeze(normalized);
}

function normalizeTime(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `${label} must be a canonical ISO timestamp`,
    );
  }
  return value;
}

function normalizeMaximumOperationMs(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAXIMUM_OPERATION_MS
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `maximumOperationMs must be an integer from 1 through ${MAXIMUM_OPERATION_MS}`,
    );
  }
  return value;
}

function normalizeMaximumEvidenceAgeMs(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAXIMUM_EVIDENCE_AGE_MS
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `maximumEvidenceAgeMs must be an integer from 1 through ${MAXIMUM_EVIDENCE_AGE_MS}`,
    );
  }
  return value;
}

function normalizeMaximumGracePeriodMs(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAXIMUM_GRACE_PERIOD_MS
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      `maximumGracePeriodMs must be an integer from 1 through ${MAXIMUM_GRACE_PERIOD_MS}`,
    );
  }
  return value;
}

function captureClock(value) {
  if (typeof value !== "function" || utilTypes.isProxy(value)) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      "now must be a trusted clock function",
    );
  }
  return Object.freeze(() => normalizeTime(value(), "trusted clock result"));
}

function assertFreshEvidence(value, trustedNow, maximumEvidenceAgeMs, label) {
  const evidenceMs = Date.parse(value);
  const nowMs = Date.parse(trustedNow);
  if (
    evidenceMs > nowMs + CLOCK_SKEW_MS ||
    nowMs - evidenceMs > maximumEvidenceAgeMs
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_STALE",
      `${label} is outside the accepted evidence window`,
    );
  }
}

function assertBoundedGraceWindows(
  descriptor,
  trustedNow,
  maximumGracePeriodMs,
) {
  const nowMs = Date.parse(trustedNow);
  for (const grace of descriptor.attestationGraceTrusts) {
    if (Date.parse(grace.notAfter) - nowMs > maximumGracePeriodMs) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
        "attestation grace trust exceeds maximumGracePeriodMs",
      );
    }
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  if (utilTypes.isProxy(value)) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      "durability evidence must not contain proxies",
    );
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
        "durability evidence must contain only data properties",
      );
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function receiptIdentity(matrixReceipt) {
  const envelope = JSON.parse(
    buildSkillEvaluatedPromotionReceiptEnvelope(matrixReceipt),
  );
  const tenantId = normalizeId(
    Object.getOwnPropertyDescriptor(matrixReceipt, "tenantId")?.value,
    "matrix receipt tenantId",
  );
  return { tenantId, receiptDigest: envelope.receiptDigest };
}

function captureAuthority(value) {
  assertRecord(value, AUTHORITY_KEYS, "durability authority");
  if (
    value.schema !== SKILL_EVALUATED_PROMOTION_DURABILITY_AUTHORITY_SCHEMA ||
    value.trust !== "trusted" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.retain !== "function" ||
    typeof value.resolve !== "function" ||
    typeof value.verifyAttestation !== "function" ||
    utilTypes.isProxy(value.retain) ||
    utilTypes.isProxy(value.resolve) ||
    utilTypes.isProxy(value.verifyAttestation)
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      "durability authority descriptor is invalid",
    );
  }
  const attestationTrust = normalizeTrust(
    value.attestationTrust,
    "authority attestationTrust",
  );
  const descriptor = deepFreeze({
    authorityId: normalizeId(value.authorityId, "authorityId"),
    trust: value.trust,
    revision: value.revision,
    handlerArtifactDigest: normalizeDigest(
      value.handlerArtifactDigest,
      "handlerArtifactDigest",
    ),
    attestationTrust,
    attestationGraceTrusts: normalizeGraceTrusts(
      value.attestationGraceTrusts,
      attestationTrust,
    ),
  });
  const retain = value.retain.bind(value);
  const resolve = value.resolve.bind(value);
  const verifyAttestation = value.verifyAttestation.bind(value);
  Object.freeze(value);
  return { descriptor, retain, resolve, verifyAttestation };
}

function attestationCore(value, keys, label) {
  const core = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
        `${label}.${key} must be an own data property`,
      );
    }
    core[key] = descriptor.value;
  }
  return core;
}

export function computeSkillEvaluatedPromotionDurabilityAttestationDigest(
  value,
) {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      "durability attestation payload must be a plain object",
    );
  }
  const schema = Object.getOwnPropertyDescriptor(value, "schema")?.value;
  const keys =
    schema === SKILL_EVALUATED_PROMOTION_DURABILITY_RECEIPT_SCHEMA
      ? RETAIN_ATTESTATION_CORE_KEYS
      : schema === SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLUTION_SCHEMA
        ? RESOLVE_ATTESTATION_CORE_KEYS
        : null;
  if (keys === null) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
      "durability attestation payload schema is invalid",
    );
  }
  const purpose =
    schema === SKILL_EVALUATED_PROMOTION_DURABILITY_RECEIPT_SCHEMA
      ? SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES.retain
      : SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES.resolve;
  return `sha256:${createHash("sha256")
    .update(
      `chainlesschain.skill-evaluated-promotion-durability-attestation/v1\0${purpose}\0${JSON.stringify(attestationCore(value, keys, "attestation payload"))}`,
      "utf8",
    )
    .digest("hex")}`;
}

function selectAttestationTrust(descriptor, attestation, trustedNow, label) {
  if (sameTrust(attestation, descriptor.attestationTrust)) {
    return descriptor.attestationTrust;
  }
  const trustedNowMs = Date.parse(trustedNow);
  for (const grace of descriptor.attestationGraceTrusts) {
    if (sameTrust(attestation, grace.trust)) {
      if (trustedNowMs <= Date.parse(grace.notAfter) + CLOCK_SKEW_MS) {
        return grace.trust;
      }
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_STALE",
        `${label} uses an expired grace key`,
      );
    }
  }
  throw failure(
    "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
    `${label} does not match an active or grace trust identity`,
  );
}

async function verifyAuthorityAttestation(
  captured,
  result,
  purpose,
  trustedNow,
  label,
) {
  const attestation = normalizeAttestation(
    result.attestation,
    `${label} attestation`,
  );
  const selectedTrust = selectAttestationTrust(
    captured.descriptor,
    attestation,
    trustedNow,
    label,
  );
  const payloadDigest =
    computeSkillEvaluatedPromotionDurabilityAttestationDigest(result);
  let verified;
  try {
    verified = await captured.verifyAttestation(
      deepFreeze({
        purpose,
        payloadDigest,
        attestation,
        selectedTrust,
      }),
    );
  } catch (cause) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_UNAVAILABLE",
      `${label} attestation verifier failed`,
      { cause },
    );
  }
  if (verified !== true) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
      `${label} attestation is invalid`,
    );
  }
}

async function runAuthorityOperation(
  operation,
  request,
  maximumOperationMs,
  label,
) {
  const controller = new AbortController();
  let timer;
  const timeout = new NATIVE_PROMISE((_, reject) => {
    timer = NATIVE_SET_TIMEOUT(() => {
      controller.abort(
        failure(
          "SKILL_EVALUATED_PROMOTION_DURABILITY_TIMEOUT",
          `${label} exceeded its bounded deadline`,
        ),
      );
      reject(controller.signal.reason);
    }, maximumOperationMs);
  });
  try {
    return await NATIVE_PROMISE_RACE([
      NATIVE_PROMISE_RESOLVE(
        operation(request, Object.freeze({ signal: controller.signal })),
      ),
      timeout,
    ]);
  } finally {
    NATIVE_CLEAR_TIMEOUT(timer);
  }
}

function assertAuthorityBinding(result, authority, identity, label) {
  if (
    result.authenticated !== true ||
    result.durable !== true ||
    result.authorityId !== authority.authorityId ||
    result.revision !== authority.revision ||
    result.handlerArtifactDigest !== authority.handlerArtifactDigest ||
    result.tenantId !== identity.tenantId ||
    result.receiptDigest !== identity.receiptDigest
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
      `${label} is not authenticated, durable, and exactly bound`,
    );
  }
}

export function createSkillEvaluatedPromotionDurabilityAdapter(options = {}) {
  assertRecord(options, ADAPTER_OPTION_KEYS, "durability adapter options");
  const captured = captureAuthority(options.authority);
  const maximumEvidenceAgeMs = normalizeMaximumEvidenceAgeMs(
    options.maximumEvidenceAgeMs,
  );
  const maximumGracePeriodMs = normalizeMaximumGracePeriodMs(
    options.maximumGracePeriodMs,
  );
  const maximumOperationMs = normalizeMaximumOperationMs(
    options.maximumOperationMs,
  );
  const now = captureClock(options.now);
  assertBoundedGraceWindows(captured.descriptor, now(), maximumGracePeriodMs);
  const retain = async (matrixReceipt) => {
    const identity = receiptIdentity(matrixReceipt);
    const request = deepFreeze({
      schema: SKILL_EVALUATED_PROMOTION_DURABILITY_RETAIN_REQUEST_SCHEMA,
      ...identity,
      matrixReceipt,
    });
    let result;
    try {
      result = await runAuthorityOperation(
        captured.retain,
        request,
        maximumOperationMs,
        "durability retain",
      );
    } catch (cause) {
      if (cause instanceof SkillEvaluatedPromotionDurabilityError) throw cause;
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_UNAVAILABLE",
        "durability authority failed to retain the matrix receipt",
        { cause },
      );
    }
    assertRecord(result, DURABILITY_RECEIPT_KEYS, "durability receipt");
    if (result.schema !== SKILL_EVALUATED_PROMOTION_DURABILITY_RECEIPT_SCHEMA) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
        "durability receipt schema is invalid",
      );
    }
    assertAuthorityBinding(result, captured.descriptor, identity, "receipt");
    const persistedAt = normalizeTime(result.persistedAt, "persistedAt");
    const trustedNow = now();
    assertFreshEvidence(
      persistedAt,
      trustedNow,
      maximumEvidenceAgeMs,
      "durability receipt",
    );
    normalizeDigest(
      result.persistenceReceiptDigest,
      "persistenceReceiptDigest",
    );
    await verifyAuthorityAttestation(
      captured,
      result,
      SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES.retain,
      trustedNow,
      "durability receipt",
    );
    return deepFreeze({ ...result });
  };
  const resolverDescriptor = {
    authorityId: captured.descriptor.authorityId,
    trust: captured.descriptor.trust,
    revision: captured.descriptor.revision,
    handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
  };
  const resolver = {
    schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLVER_SCHEMA,
    ...resolverDescriptor,
    async resolve(input) {
      assertRecord(input, RESOLVE_REQUEST_KEYS, "receipt resolver request");
      if (
        input.schema !==
        SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA
      ) {
        throw failure(
          "SKILL_EVALUATED_PROMOTION_DURABILITY_INVALID",
          "receipt resolver request schema is invalid",
        );
      }
      const identity = {
        tenantId: normalizeId(input.tenantId, "resolver tenantId"),
        receiptDigest: normalizeDigest(
          input.receiptDigest,
          "resolver receiptDigest",
        ),
      };
      const request = deepFreeze({
        schema: SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLVE_REQUEST_SCHEMA,
        ...identity,
      });
      let result;
      try {
        result = await runAuthorityOperation(
          captured.resolve,
          request,
          maximumOperationMs,
          "durability resolve",
        );
      } catch (cause) {
        if (cause instanceof SkillEvaluatedPromotionDurabilityError)
          throw cause;
        throw failure(
          "SKILL_EVALUATED_PROMOTION_DURABILITY_UNAVAILABLE",
          "durability authority failed to resolve the matrix receipt",
          { cause },
        );
      }
      assertRecord(result, DURABILITY_RESOLUTION_KEYS, "durability resolution");
      if (
        result.schema !== SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLUTION_SCHEMA
      ) {
        throw failure(
          "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
          "durability resolution schema is invalid",
        );
      }
      assertAuthorityBinding(
        result,
        captured.descriptor,
        identity,
        "resolution",
      );
      const resolvedIdentity = receiptIdentity(result.matrixReceipt);
      if (
        resolvedIdentity.tenantId !== identity.tenantId ||
        resolvedIdentity.receiptDigest !== identity.receiptDigest
      ) {
        throw failure(
          "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
          "resolved matrix receipt differs from the durable lookup subject",
        );
      }
      const resolvedAt = normalizeTime(result.resolvedAt, "resolvedAt");
      const trustedNow = now();
      assertFreshEvidence(
        resolvedAt,
        trustedNow,
        maximumEvidenceAgeMs,
        "durability resolution",
      );
      normalizeDigest(
        result.resolutionReceiptDigest,
        "resolutionReceiptDigest",
      );
      await verifyAuthorityAttestation(
        captured,
        result,
        SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES.resolve,
        trustedNow,
        "durability resolution",
      );
      return deepFreeze({
        schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
        ...resolverDescriptor,
        tenantId: identity.tenantId,
        receiptDigest: identity.receiptDigest,
        matrixReceipt: result.matrixReceipt,
        resolvedAt: result.resolvedAt,
      });
    },
  };
  return Object.freeze({
    retain: Object.freeze(retain),
    resolver: Object.freeze(resolver),
  });
}
