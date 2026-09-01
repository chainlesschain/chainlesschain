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

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ENVELOPE_KEYS = new Set(["receiptDigest", "schema"]);
const MATRIX_CONTEXT_KEYS = new Set([
  "baselineId",
  "matrixAuthorityRoot",
  "matrixEvalId",
  "planDigest",
]);

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
  matrixReceipt,
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
      matrixReceipt,
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
  });
}
