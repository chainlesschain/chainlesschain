import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { verifySkillMutationRequest } from "./skill-mutation-authority.js";
import {
  SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
  verifySkillTargetMatrixEvalReceipt,
} from "./skill-target-matrix-eval.js";

export const SKILL_EVALUATED_PROMOTION_RECEIPT_ENVELOPE_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-receipt-envelope/v1";
export const SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-binding/v1";
export const SKILL_EVALUATED_PROMOTION_PROVIDER_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-provider/v1";
export const SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLVER_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-receipt-resolver/v1";
export const SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-receipt-resolution-request/v1";
export const SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA =
  "chainlesschain.skill-evaluated-promotion-receipt-resolution/v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ENVELOPE_KEYS = new Set(["receiptDigest", "schema"]);
const MATRIX_CONTEXT_KEYS = new Set([
  "baselineId",
  "matrixAuthorityRoot",
  "matrixEvalId",
  "planDigest",
]);
const RECEIPT_RESOLVER_KEYS = new Set([
  "schema",
  "authorityId",
  "trust",
  "revision",
  "handlerArtifactDigest",
  "resolve",
]);
const RECEIPT_RESOLUTION_KEYS = new Set([
  "schema",
  "authorityId",
  "trust",
  "revision",
  "handlerArtifactDigest",
  "tenantId",
  "receiptDigest",
  "matrixReceipt",
  "resolvedAt",
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const PROVIDER_OPTION_KEYS = new Set([
  "authorityId",
  "handlerArtifactDigest",
  "receiptResolver",
  "revision",
  "verifier",
]);
const PROVIDER_KEYS = new Set([
  "schema",
  "authorityId",
  "handlerArtifactDigest",
  "revision",
  "verify",
]);
const PROVIDER_INPUT_KEYS = new Set([
  "activeContentDigest",
  "authorization",
  "candidate",
  "matrixContext",
  "state",
]);
const PROVIDER_INSTANCES = new WeakSet();

export class SkillEvaluatedPromotionError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillEvaluatedPromotionError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function failure(code, message, details = {}) {
  return new SkillEvaluatedPromotionError(code, message, details);
}

function assertDataRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      `${label} must be a plain object`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_INVALID",
        `${label}.${String(key)} must be an enumerable own data field`,
      );
    }
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw failure(
        "SKILL_EVALUATED_PROMOTION_INVALID",
        "trusted matrix evidence must contain only own data fields",
      );
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function normalizeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw failure("SKILL_EVALUATED_PROMOTION_INVALID", `${label} is invalid`);
  }
  return value;
}

function normalizeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function resolverDescriptorDigest(descriptor) {
  return `sha256:${createHash("sha256")
    .update(
      `chainlesschain.skill-evaluated-promotion-receipt-resolver-descriptor/v1\0${JSON.stringify(descriptor)}`,
      "utf8",
    )
    .digest("hex")}`;
}

function captureReceiptResolver(value) {
  assertDataRecord(value, RECEIPT_RESOLVER_KEYS, "matrix receipt resolver");
  if (
    value.schema !== SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLVER_SCHEMA ||
    value.trust !== "trusted" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.resolve !== "function" ||
    utilTypes.isProxy(value.resolve)
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "matrix receipt resolver authority is invalid",
    );
  }
  const descriptor = deepFreeze({
    schema: value.schema,
    authorityId: normalizeId(value.authorityId, "resolver authorityId"),
    trust: value.trust,
    revision: value.revision,
    handlerArtifactDigest: normalizeDigest(
      value.handlerArtifactDigest,
      "resolver handlerArtifactDigest",
    ),
  });
  const resolve = value.resolve.bind(value);
  Object.freeze(value);
  return { descriptor, resolve };
}

async function resolveMatrixReceipt(resolver, tenantId, receiptDigest) {
  const captured = captureReceiptResolver(resolver);
  const request = deepFreeze({
    schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA,
    tenantId,
    receiptDigest,
  });
  let resolution;
  try {
    resolution = await captured.resolve(request);
  } catch (cause) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_RESOLUTION_FAILED",
      "matrix receipt resolver failed closed",
      { cause },
    );
  }
  assertDataRecord(
    resolution,
    RECEIPT_RESOLUTION_KEYS,
    "matrix receipt resolution",
  );
  const receipt = Object.getOwnPropertyDescriptor(
    resolution,
    "matrixReceipt",
  )?.value;
  const resolvedAt = resolution.resolvedAt;
  if (
    resolution.schema !== SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA ||
    resolution.authorityId !== captured.descriptor.authorityId ||
    resolution.trust !== captured.descriptor.trust ||
    resolution.revision !== captured.descriptor.revision ||
    resolution.handlerArtifactDigest !==
      captured.descriptor.handlerArtifactDigest ||
    resolution.tenantId !== tenantId ||
    resolution.receiptDigest !== receiptDigest ||
    !receipt ||
    typeof receipt !== "object" ||
    utilTypes.isProxy(receipt) ||
    Object.getOwnPropertyDescriptor(receipt, "receiptDigest")?.value !==
      receiptDigest ||
    typeof resolvedAt !== "string" ||
    !Number.isFinite(Date.parse(resolvedAt)) ||
    new Date(resolvedAt).toISOString() !== resolvedAt
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_RESOLUTION_REJECTED",
      "matrix receipt resolution is not exactly bound to its trusted authority and digest",
    );
  }
  return {
    receipt,
    resolution: deepFreeze({
      authorityId: captured.descriptor.authorityId,
      resolverDescriptorDigest: resolverDescriptorDigest(captured.descriptor),
      resolverRevision: captured.descriptor.revision,
      resolvedAt,
    }),
  };
}

export function buildSkillEvaluatedPromotionReceiptEnvelope(receipt) {
  if (receipt && typeof receipt === "object" && utilTypes.isProxy(receipt)) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "matrix receipt must be a plain object",
    );
  }
  assertDataRecord(
    receipt,
    new Set(Reflect.ownKeys(receipt).filter((key) => typeof key === "string")),
    "matrix receipt",
  );
  const schema = Object.getOwnPropertyDescriptor(receipt, "schema")?.value;
  const receiptDigest = Object.getOwnPropertyDescriptor(
    receipt,
    "receiptDigest",
  )?.value;
  if (
    schema !== SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA ||
    typeof receiptDigest !== "string" ||
    !DIGEST_PATTERN.test(receiptDigest)
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "matrix receipt envelope requires a typed receipt and lowercase SHA-256 digest",
    );
  }
  return JSON.stringify({
    schema: SKILL_EVALUATED_PROMOTION_RECEIPT_ENVELOPE_SCHEMA,
    receiptDigest,
  });
}

export function parseSkillEvaluatedPromotionReceiptEnvelope(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "evalReceipt must be a bounded matrix receipt envelope",
    );
  }
  let envelope;
  try {
    envelope = JSON.parse(value);
  } catch (cause) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "evalReceipt is not a matrix receipt envelope",
      { cause },
    );
  }
  assertDataRecord(envelope, ENVELOPE_KEYS, "matrix receipt envelope");
  if (
    envelope.schema !== SKILL_EVALUATED_PROMOTION_RECEIPT_ENVELOPE_SCHEMA ||
    !DIGEST_PATTERN.test(envelope.receiptDigest)
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "evalReceipt envelope is not bound to its typed matrix receipt",
    );
  }
  if (
    JSON.stringify({
      schema: SKILL_EVALUATED_PROMOTION_RECEIPT_ENVELOPE_SCHEMA,
      receiptDigest: envelope.receiptDigest,
    }) !== value
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "evalReceipt envelope must use the canonical encoding",
    );
  }
  return deepFreeze(envelope);
}

export async function verifySkillEvaluatedPromotionBinding({
  verifier,
  receiptResolver,
  matrixContext,
  authorization,
  candidate,
  state,
  activeContentDigest,
} = {}) {
  assertDataRecord(
    authorization,
    new Set(["capability", "request"]),
    "authorization",
  );
  const request = verifySkillMutationRequest(authorization.request);
  const envelope = parseSkillEvaluatedPromotionReceiptEnvelope(
    request.receipts.evalReceipt,
  );
  assertDataRecord(matrixContext, MATRIX_CONTEXT_KEYS, "matrix context");
  if (!candidate || !state || typeof activeContentDigest !== "string") {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "candidate, active state, and active content digest are required",
    );
  }
  const resolved = await resolveMatrixReceipt(
    receiptResolver,
    request.tenantId,
    envelope.receiptDigest,
  );
  const expected = {
    matrixEvalId: matrixContext.matrixEvalId,
    tenantId: request.tenantId,
    skillName: request.skillName,
    candidateId: candidate.candidateId,
    candidateContentDigest: candidate.contentDigest,
    baselineId: matrixContext.baselineId,
    baselineReleaseDigest: state.activeReleaseDigest,
    expectedActiveContentDigest: activeContentDigest,
    expectedActiveRevision: state.revision,
    dependencyLockDigest: candidate.dependencyLockDigest,
    runtimeManifestDigest: candidate.runtimeManifestDigest,
    targetMatrixRoot: candidate.targetMatrixRoot,
    matrixAuthorityRoot: matrixContext.matrixAuthorityRoot,
    planDigest: matrixContext.planDigest,
    decision: "accepted",
  };
  let verified;
  try {
    verified = await verifySkillTargetMatrixEvalReceipt(
      verifier,
      resolved.receipt,
      expected,
    );
  } catch (cause) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_REJECTED",
      "matrix evaluation receipt did not authorize this exact promotion",
      { cause },
    );
  }
  if (verified.receiptDigest !== envelope.receiptDigest) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_REJECTED",
      "evalReceipt envelope does not identify the verified matrix receipt",
    );
  }
  return deepFreeze({
    schema: SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA,
    tenantId: verified.tenantId,
    skillName: verified.skillName,
    candidateId: verified.candidateId,
    candidateContentDigest: verified.candidateContentDigest,
    expectedActiveContentDigest: verified.expectedActiveContentDigest,
    expectedActiveRevision: verified.expectedActiveRevision,
    matrixEvalId: verified.matrixEvalId,
    matrixReceiptDigest: verified.receiptDigest,
    decisionCommitmentDigest: verified.decisionCommitmentDigest,
    expiresAt: verified.expiresAt,
    receiptResolution: resolved.resolution,
  });
}

export function createSkillEvaluatedPromotionProvider(options = {}) {
  assertDataRecord(
    options,
    PROVIDER_OPTION_KEYS,
    "evaluated promotion provider options",
  );
  const capturedResolver = captureReceiptResolver(options.receiptResolver);
  const authorityId = normalizeId(options.authorityId, "provider authorityId");
  const handlerArtifactDigest = normalizeDigest(
    options.handlerArtifactDigest,
    "provider handlerArtifactDigest",
  );
  if (
    !Number.isSafeInteger(options.revision) ||
    options.revision < 1 ||
    !options.verifier ||
    typeof options.verifier !== "object" ||
    utilTypes.isProxy(options.verifier)
  ) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_INVALID",
      "evaluated promotion provider revision or verifier is invalid",
    );
  }
  const receiptResolver = Object.freeze({
    ...capturedResolver.descriptor,
    resolve: capturedResolver.resolve,
  });
  const verifier = options.verifier;
  Object.freeze(verifier);
  const provider = {
    schema: SKILL_EVALUATED_PROMOTION_PROVIDER_SCHEMA,
    authorityId,
    handlerArtifactDigest,
    revision: options.revision,
    async verify(input = {}) {
      assertDataRecord(
        input,
        PROVIDER_INPUT_KEYS,
        "evaluated promotion provider input",
      );
      return verifySkillEvaluatedPromotionBinding({
        ...input,
        receiptResolver,
        verifier,
      });
    },
  };
  PROVIDER_INSTANCES.add(provider);
  return Object.freeze(provider);
}

export function captureSkillEvaluatedPromotionProvider(value) {
  if (!value || !PROVIDER_INSTANCES.has(value)) {
    throw failure(
      "SKILL_EVALUATED_PROMOTION_PROVIDER_REQUIRED",
      "a branded evaluated promotion provider is required",
    );
  }
  assertDataRecord(value, PROVIDER_KEYS, "evaluated promotion provider");
  return Object.freeze({
    schema: value.schema,
    authorityId: value.authorityId,
    handlerArtifactDigest: value.handlerArtifactDigest,
    revision: value.revision,
    verify: value.verify.bind(value),
  });
}
