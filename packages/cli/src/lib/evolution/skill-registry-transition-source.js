import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { SKILL_MUTATION_RECEIPT_KINDS } from "./skill-mutation-authority.js";

export const SKILL_REGISTRY_TRANSITION_SOURCE_SCHEMA =
  "chainlesschain.skill-registry-transition-source/v1";
export const SKILL_REGISTRY_TRANSITION_SOURCE_REQUEST_SCHEMA =
  "chainlesschain.skill-registry-transition-source-request/v1";
export const SKILL_REGISTRY_CANDIDATE_CREATED_RESOLUTION_SCHEMA =
  "chainlesschain.skill-registry-candidate-created-resolution/v1";
export const SKILL_REGISTRY_EVAL_COMPLETED_RESOLUTION_SCHEMA =
  "chainlesschain.skill-registry-eval-completed-resolution/v1";
export const SKILL_REGISTRY_HUMAN_TASK_SETTLED_RESOLUTION_SCHEMA =
  "chainlesschain.skill-registry-human-task-settled-resolution/v1";
export const SKILL_REGISTRY_TRANSITION_SOURCE_INVALID_CODE =
  "CC_SKILL_REGISTRY_TRANSITION_SOURCE_INVALID";

const SOURCES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const VERIFY_KEYS = new Set([
  "candidateCreatedRef",
  "evalCompletedRef",
  "humanTaskSettledRef",
]);
const RESOLUTION_REQUEST_KEYS = new Set(["schema", "tenantId", "ref"]);
const CANDIDATE_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "ref",
  "candidateId",
  "skillName",
  "candidateReceipt",
  "actorReceipt",
  "parentReceipt",
  "targetReceipt",
  "effectiveAt",
  "receiptDigest",
]);
const EVAL_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "ref",
  "candidateId",
  "skillName",
  "matrixContext",
  "evalReceipt",
  "effectiveAt",
  "receiptDigest",
]);
const HUMAN_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "ref",
  "candidateId",
  "skillName",
  "policyReceipt",
  "effectiveAt",
  "receiptDigest",
]);
const MATRIX_KEYS = new Set([
  "baselineId",
  "matrixAuthorityRoot",
  "matrixEvalId",
  "planDigest",
]);

function failure(message, options) {
  const error = new Error(message, options);
  error.code = SKILL_REGISTRY_TRANSITION_SOURCE_INVALID_CODE;
  return error;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function assertExactRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw failure(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw failure(`${label} must contain exactly the supported fields`);
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(`${label}.${String(key)} must be a data field`);
    }
  }
}

function requiredString(value, label, maximum = 512) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > maximum
  ) {
    throw failure(`${label} is invalid`);
  }
  return value;
}

function requiredDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw failure(`${label} must be sha256-bound`);
  }
  return value;
}

function timestamp(value, label) {
  requiredString(value, label, 64);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw failure(`${label} must be a canonical timestamp`);
  }
  return value;
}

function normalizeInput(input) {
  assertExactRecord(input, VERIFY_KEYS, "transition source input");
  return deepFreeze({
    candidateCreatedRef: requiredString(
      input.candidateCreatedRef,
      "candidateCreatedRef",
    ),
    evalCompletedRef: requiredString(
      input.evalCompletedRef,
      "evalCompletedRef",
    ),
    humanTaskSettledRef: requiredString(
      input.humanTaskSettledRef,
      "humanTaskSettledRef",
    ),
  });
}

function normalizeMatrixContext(value) {
  assertExactRecord(value, MATRIX_KEYS, "matrixContext");
  return deepFreeze({
    baselineId: requiredString(value.baselineId, "matrixContext.baselineId"),
    matrixAuthorityRoot: requiredDigest(
      value.matrixAuthorityRoot,
      "matrixContext.matrixAuthorityRoot",
    ),
    matrixEvalId: requiredString(
      value.matrixEvalId,
      "matrixContext.matrixEvalId",
    ),
    planDigest: requiredDigest(value.planDigest, "matrixContext.planDigest"),
  });
}

function captureResolver(owner, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner.resolve !== "function" ||
    utilTypes.isProxy(owner.resolve)
  ) {
    throw new TypeError(`${label}.resolve is required`);
  }
  const resolve = owner.resolve.bind(owner);
  Object.freeze(owner);
  return resolve;
}

async function resolveEvent(resolve, tenantId, ref, schema, keys, label) {
  const request = deepFreeze({
    schema: SKILL_REGISTRY_TRANSITION_SOURCE_REQUEST_SCHEMA,
    tenantId,
    ref,
  });
  assertExactRecord(request, RESOLUTION_REQUEST_KEYS, `${label} request`);
  let result;
  try {
    result = await resolve(request);
  } catch (cause) {
    throw failure(`${label} resolver failed closed`, { cause });
  }
  assertExactRecord(result, keys, `${label} resolution`);
  if (
    result.schema !== schema ||
    result.authenticated !== true ||
    result.durable !== true ||
    result.tenantId !== tenantId ||
    result.ref !== ref ||
    !DIGEST.test(result.candidateId ?? "") ||
    !SKILL_NAME.test(result.skillName ?? "") ||
    !DIGEST.test(result.receiptDigest ?? "")
  ) {
    throw failure(`${label} resolution is not durably bound`);
  }
  timestamp(result.effectiveAt, `${label}.effectiveAt`);
  return result;
}

export function createSkillRegistryTransitionSource({
  tenantId: tenantInput,
  candidateCreatedResolver,
  evalCompletedResolver,
  humanTaskSettledResolver,
} = {}) {
  const tenantId = requiredString(tenantInput, "tenantId", 256);
  const resolveCandidate = captureResolver(
    candidateCreatedResolver,
    "candidateCreatedResolver",
  );
  const resolveEval = captureResolver(
    evalCompletedResolver,
    "evalCompletedResolver",
  );
  const resolveHuman = captureResolver(
    humanTaskSettledResolver,
    "humanTaskSettledResolver",
  );
  const source = {
    schema: SKILL_REGISTRY_TRANSITION_SOURCE_SCHEMA,
    tenantId,
    async verify(input) {
      const refs = normalizeInput(input);
      const [candidate, evaluation, human] = await Promise.all([
        resolveEvent(
          resolveCandidate,
          tenantId,
          refs.candidateCreatedRef,
          SKILL_REGISTRY_CANDIDATE_CREATED_RESOLUTION_SCHEMA,
          CANDIDATE_KEYS,
          "CandidateCreated",
        ),
        resolveEvent(
          resolveEval,
          tenantId,
          refs.evalCompletedRef,
          SKILL_REGISTRY_EVAL_COMPLETED_RESOLUTION_SCHEMA,
          EVAL_KEYS,
          "EvalCompleted",
        ),
        resolveEvent(
          resolveHuman,
          tenantId,
          refs.humanTaskSettledRef,
          SKILL_REGISTRY_HUMAN_TASK_SETTLED_RESOLUTION_SCHEMA,
          HUMAN_KEYS,
          "HumanTaskSettled",
        ),
      ]);
      if (
        evaluation.candidateId !== candidate.candidateId ||
        human.candidateId !== candidate.candidateId ||
        evaluation.skillName !== candidate.skillName ||
        human.skillName !== candidate.skillName ||
        Date.parse(candidate.effectiveAt) >
          Date.parse(evaluation.effectiveAt) ||
        Date.parse(evaluation.effectiveAt) > Date.parse(human.effectiveAt)
      ) {
        throw failure(
          "CandidateCreated/EvalCompleted/HumanTaskSettled bindings or order differ",
        );
      }
      const matrixContext = normalizeMatrixContext(evaluation.matrixContext);
      const receipts = deepFreeze({
        candidateReceipt: requiredString(
          candidate.candidateReceipt,
          "candidateReceipt",
          4096,
        ),
        evalReceipt: requiredString(
          evaluation.evalReceipt,
          "evalReceipt",
          4096,
        ),
        policyReceipt: requiredString(
          human.policyReceipt,
          "policyReceipt",
          4096,
        ),
        actorReceipt: requiredString(
          candidate.actorReceipt,
          "actorReceipt",
          4096,
        ),
        parentReceipt: requiredString(
          candidate.parentReceipt,
          "parentReceipt",
          4096,
        ),
        targetReceipt: requiredString(
          candidate.targetReceipt,
          "targetReceipt",
          4096,
        ),
      });
      if (
        Reflect.ownKeys(receipts).length !== SKILL_MUTATION_RECEIPT_KINDS.length
      ) {
        throw failure("transition source receipt set is incomplete");
      }
      const sourceReceiptDigest = hash({
        schema: SKILL_REGISTRY_TRANSITION_SOURCE_SCHEMA,
        tenantId,
        candidateId: candidate.candidateId,
        skillName: candidate.skillName,
        refs,
        candidateReceiptDigest: candidate.receiptDigest,
        evalReceiptDigest: evaluation.receiptDigest,
        humanTaskReceiptDigest: human.receiptDigest,
        matrixContext,
        receipts,
      });
      return deepFreeze({
        authenticated: true,
        durable: true,
        tenantId,
        candidateId: candidate.candidateId,
        skillName: candidate.skillName,
        ...refs,
        matrixContext,
        receipts,
        effectiveAt: human.effectiveAt,
        sourceReceiptDigest,
      });
    },
  };
  SOURCES.add(source);
  return Object.freeze(source);
}

export function captureSkillRegistryTransitionSource(value) {
  if (!value || !SOURCES.has(value)) {
    throw new TypeError(
      "a branded Skill Registry transition source is required",
    );
  }
  return value;
}
