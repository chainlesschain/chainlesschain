/**
 * Independent, fail-closed evaluation gate for Skill candidates.
 *
 * The public builders below only canonicalize suite and policy documents. They
 * do not make either document authoritative. `EvolutionEvalGate` accepts only
 * opaque references at run time and resolves them through constructor-captured
 * trusted ports. Every result used by the gate is request-bound and signed.
 */

import { createHash, randomBytes } from "node:crypto";
import { isProxy } from "node:util/types";

export const EVOLUTION_EVAL_TASK_SCHEMA =
  "chainlesschain.evolution-eval-task/v1";
export const EVOLUTION_EVAL_SUITE_SCHEMA =
  "chainlesschain.evolution-eval-suite/v1";
export const EVOLUTION_EVAL_POLICY_SCHEMA =
  "chainlesschain.evolution-eval-policy/v2";
export const EVOLUTION_EVAL_RECEIPT_SCHEMA =
  "chainlesschain.evolution-eval-receipt/v4";
export const EVOLUTION_EVAL_SUITE_AUTHORITY_SCHEMA =
  "chainlesschain.evolution-eval-suite-authority-receipt/v1";
export const EVOLUTION_EVAL_ENVIRONMENT_SCHEMA =
  "chainlesschain.evolution-eval-environment-receipt/v1";
export const EVOLUTION_EVAL_ARTIFACT_SCHEMA =
  "chainlesschain.evolution-eval-artifact-resolution-receipt/v1";
export const EVOLUTION_EVAL_PROVENANCE_SCHEMA =
  "chainlesschain.evolution-eval-provenance-binding-receipt/v1";
export const EVOLUTION_EVAL_SUBJECT_SCHEMA =
  "chainlesschain.evolution-eval-subject-handle-receipt/v1";
export const EVOLUTION_EVAL_REPLAY_SCHEMA =
  "chainlesschain.evolution-eval-handle-reservation-receipt/v1";
export const EVOLUTION_EVAL_SUPERVISION_SCHEMA =
  "chainlesschain.evolution-eval-deadline-enforcement-receipt/v3";
export const EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA =
  "chainlesschain.evolution-eval-isolated-target/v2";
export const EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA =
  "chainlesschain.evolution-eval-authority-descriptor/v1";
/**
 * Authority roots commit configuration supplied by a trusted composition
 * boundary. They are not local proofs that JavaScript callable bytes match a
 * declared handlerArtifactDigest. Production must use an attested loader that
 * binds each descriptor to the loaded callable; requests and plugins must not
 * construct Gate/Verifier authority ports.
 */
export const EVOLUTION_EVAL_AUTHORITY_ROOT_SEMANTICS = Object.freeze({
  kind: "trusted-composition-configuration-commitment",
  callableBinding: "attested-loader-required",
  requestConstructedAuthorities: "forbidden",
});
export const EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA =
  "chainlesschain.evolution-eval-target-invocation/v2";
export const EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA =
  "chainlesschain.evolution-eval-target-revocation/v2";
export const EVOLUTION_EVAL_EXECUTION_SCHEMA =
  "chainlesschain.evolution-eval-execution-receipt/v1";
export const EVOLUTION_EVAL_GRADE_SCHEMA =
  "chainlesschain.evolution-eval-grade-receipt/v1";
export const EVOLUTION_EVAL_SAFETY_SCHEMA =
  "chainlesschain.evolution-eval-safety-receipt/v1";

export const EVOLUTION_EVAL_INVALID_CODE = "CC_EVOLUTION_EVAL_INVALID";
export const EVOLUTION_EVAL_LEAKAGE_CODE = "CC_EVOLUTION_EVAL_LEAKAGE";
export const EVOLUTION_EVAL_AUTHORITY_FAILED_CODE =
  "CC_EVOLUTION_EVAL_AUTHORITY_FAILED";
export const EVOLUTION_EVAL_EXECUTION_FAILED_CODE =
  "CC_EVOLUTION_EVAL_EXECUTION_FAILED";
export const EVOLUTION_EVAL_GRADER_FAILED_CODE =
  "CC_EVOLUTION_EVAL_GRADER_FAILED";
export const EVOLUTION_EVAL_SAFETY_FAILED_CODE =
  "CC_EVOLUTION_EVAL_SAFETY_FAILED";
export const EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE_CODE =
  "CC_EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE";
export const EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE =
  "CC_EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED";

export const EVOLUTION_EVAL_ATTESTATION_PURPOSES = Object.freeze({
  suite: "chainlesschain.evolution-eval.suite-authority/v1",
  environment: "chainlesschain.evolution-eval.environment/v1",
  artifact: "chainlesschain.evolution-eval.artifact/v1",
  provenance: "chainlesschain.evolution-eval.provenance/v1",
  subject: "chainlesschain.evolution-eval.subject/v1",
  replay: "chainlesschain.evolution-eval.handle-replay/v1",
  supervisor: "chainlesschain.evolution-eval.deadline-supervisor/v3",
  targetInvocation:
    "chainlesschain.evolution-eval.target-invocation-evidence/v1",
  targetRevocation:
    "chainlesschain.evolution-eval.target-revocation-evidence/v1",
  execution: "chainlesschain.evolution-eval.execution/v1",
  grade: "chainlesschain.evolution-eval.grade/v1",
  safety: "chainlesschain.evolution-eval.safety/v1",
  receipt: "chainlesschain.evolution-eval.receipt/v3",
  clock: "chainlesschain.evolution-eval.trusted-clock/v1",
});

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TASK_BINDING_NONCE_PATTERN = /^task-binding-[a-f0-9]{48,128}$/u;
const SAFE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9._~+/=:-]{16,8192}$/u;
const SPLITS = Object.freeze(["training", "validation", "test"]);
const TASK_TYPES = Object.freeze(["code", "file", "retrieval", "ui"]);
const HANDLE_RESERVATION_KINDS = Object.freeze(["task", "artifact", "subject"]);
const SUPERVISOR_ISOLATIONS = Object.freeze([
  "worker",
  "process",
  "sandbox",
  "hsm-deadline-authority",
]);
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ARRAY_LENGTH = 100_000;
const MAX_OBJECT_KEYS = 10_000;
const MAX_CANONICAL_NODES = 100_000;
const CLOCK_SKEW_MS = 5_000;
const SUPERVISOR_COMPLETION_CLOCK_SKEW_MS = 1_000;
// A compliant supervisor normally begins hard termination exactly at the
// signed deadline. Give only its response proof and the already-active target
// promise a fixed, implementation-level convergence window; completed work is
// still rejected against the original monotonic deadline below.
const LOCAL_SUPERVISION_SETTLEMENT_GRACE_MS = 2_500;
const NATIVE_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const NATIVE_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const NATIVE_MONOTONIC_NOW = globalThis.performance.now.bind(
  globalThis.performance,
);

const TASK_INPUT_KEYS = new Set([
  "id",
  "split",
  "groupKeys",
  "taskType",
  "publicInput",
  "graderId",
  "privateExpected",
]);
const TASK_KEYS = new Set(["schema", ...TASK_INPUT_KEYS, "taskDigest"]);
const SUITE_INPUT_KEYS = new Set(["suiteId", "datasetVersion", "tasks"]);
const SUITE_KEYS = new Set([
  "schema",
  "suiteId",
  "datasetVersion",
  "tasks",
  "suiteDigest",
]);
const POLICY_INPUT_KEYS = new Set([
  "policyId",
  "minTrainingTasks",
  "minValidationTasks",
  "minTestTasks",
  "seeds",
  "minimumAbsoluteImprovement",
  "minimumEfficiencyImprovement",
  "confidenceZ",
  "maxAverageTokens",
  "maxAverageLatencyMs",
  "maxAverageToolCalls",
  "maxTotalTokens",
  "maxTotalLatencyMs",
  "maxTotalToolCalls",
  "maxTotalCostMicrounits",
  "maxExecutions",
  "maxWallClockMs",
  "portReceiptTtlMs",
  "receiptTtlMs",
]);
const POLICY_KEYS = new Set(["schema", ...POLICY_INPUT_KEYS, "policyDigest"]);
const TRUST_KEYS = new Set([
  "algorithm",
  "issuer",
  "keyId",
  "trustPolicyDigest",
]);
const ATTESTATION_KEYS = new Set([...TRUST_KEYS, "value"]);
const AUTHORITY_POLICY_KEYS = new Set(["trust", "revision"]);
const AUTHORITY_POLICY_PURPOSES = Object.freeze([
  "suite",
  "environment",
  "artifact",
  "provenance",
  "subject",
  "execution",
  "safety",
  "replay",
  "supervisor",
  "invocationEvidence",
  "revocationEvidence",
  "clock",
]);
const AUTHORITY_POLICIES_KEYS = new Set(AUTHORITY_POLICY_PURPOSES);
const AUTHORITY_DESCRIPTOR_KEYS = new Set([
  "schema",
  "handlerId",
  "handlerRevision",
  "operation",
  "handlerArtifactDigest",
  "authority",
]);
const ISOLATED_TARGET_KEYS = new Set([
  "schema",
  "handlerId",
  "handlerRevision",
  "operation",
  "isolation",
  "handlerArtifactDigest",
  "authority",
]);
const RUN_REQUEST_KEYS = new Set([
  "suiteRef",
  "candidateId",
  "baselineId",
  "targetEnvironmentRef",
  "evaluationContext",
]);
const RUN_EVALUATION_CONTEXT_KEYS = new Set([
  "planDigest",
  "targetMatrixRoot",
  "cellId",
  "runtimeId",
]);
const EVALUATION_CONTEXT_KEYS = new Set([
  "planDigest",
  "tenantId",
  "targetMatrixRoot",
  "cellId",
  "runtimeId",
  "targetEnvironmentRef",
  "environmentDigest",
  "candidateId",
  "baselineId",
  "suiteDigest",
  "policyDigest",
  "evaluationAuthorityRoot",
]);
const EXPECTED_RECEIPT_KEYS = new Set([
  "runId",
  "runNonce",
  "suiteDigest",
  "policyDigest",
  "evaluationAuthorityRoot",
  "targetEnvironmentRef",
  "evaluationContextDigest",
  "candidateId",
  "baselineId",
  "environmentDigest",
  "tenantId",
  "provenanceAudience",
  "trainerAuthority",
  "trainerRevision",
]);
const SUITE_RESPONSE_KEYS = new Set(["suite", "taskBindings", "receipt"]);
const EXECUTION_PROJECTION_KEYS = new Set(["taskType", "publicInput"]);
const TASK_BINDING_CORE_KEYS = new Set([
  "taskDigest",
  "opaqueTaskHandle",
  "executionProjection",
  "runId",
  "runNonce",
  "bindingNonce",
  "singleRun",
  "unlinkable",
  "splitBlind",
]);
const TASK_BINDING_KEYS = new Set([
  ...TASK_BINDING_CORE_KEYS,
  "randomnessCommitment",
]);
const ENVIRONMENT_RESPONSE_KEYS = new Set(["environment", "receipt"]);
const ARTIFACT_RESPONSE_KEYS = new Set(["receipt"]);
const SUITE_AUTHORITY_KEYS = new Set([
  "schema",
  "requestNonce",
  "requestedAt",
  "expiresAt",
  "runId",
  "runNonce",
  "suiteRef",
  "suiteDigest",
  "taskBindingsDigest",
  "policyDigest",
  "authorityRevision",
  "attestation",
]);
const ENVIRONMENT_RECEIPT_KEYS = new Set([
  "schema",
  "requestNonce",
  "requestedAt",
  "expiresAt",
  "runId",
  "runNonce",
  "targetEnvironmentRef",
  "environmentDigest",
  "policyDigest",
  "resolverRevision",
  "attestation",
]);
const ARTIFACT_RECEIPT_KEYS = new Set([
  "schema",
  "requestNonce",
  "requestedAt",
  "expiresAt",
  "runId",
  "runNonce",
  "role",
  "artifactId",
  "artifactDigest",
  "immutable",
  "suiteAuthorityDigest",
  "trainingPartitionDigest",
  "holdoutIsolated",
  "provenanceReceiptDigest",
  "opaqueArtifactCapability",
  "capabilitySingleRun",
  "capabilityUnlinkable",
  "environmentDigest",
  "policyDigest",
  "resolverRevision",
  "attestation",
]);
const PROVENANCE_RECEIPT_KEYS = new Set([
  "schema",
  "requestDigest",
  "requestNonce",
  "requestedAt",
  "expiresAt",
  "runId",
  "runNonce",
  "role",
  "artifactDigest",
  "suiteAuthorityDigest",
  "trainingPartitionDigest",
  "provenanceReceiptDigest",
  "holdoutIsolated",
  "trainerAuthority",
  "trainerRevision",
  "revocationStatus",
  "tenantId",
  "audience",
  "policyDigest",
  "verifierRevision",
  "attestation",
]);
const SUBJECT_RECEIPT_KEYS = new Set([
  "schema",
  "requestDigest",
  "requestNonce",
  "requestedAt",
  "expiresAt",
  "runId",
  "runNonce",
  "opaqueSubjectHandle",
  "opaqueArtifactCapability",
  "singleUse",
  "unlinkable",
  "environmentDigest",
  "policyDigest",
  "brokerRevision",
  "attestation",
]);
const REPLAY_REQUEST_CORE_KEYS = new Set([
  "schema",
  "runId",
  "runNonce",
  "requestNonce",
  "requestedAt",
  "deadlineAt",
  "kind",
  "handles",
  "bindingNonces",
  "policyDigest",
]);
const HANDLE_RESERVATION_SET_KEYS = new Set(["handles", "bindingNonces"]);
const REPLAY_REQUEST_KEYS = new Set([
  ...REPLAY_REQUEST_CORE_KEYS,
  "requestDigest",
]);
const REPLAY_RECEIPT_KEYS = new Set([
  "schema",
  "requestDigest",
  "requestNonce",
  "requestedAt",
  "expiresAt",
  "runId",
  "runNonce",
  "kind",
  "handlesDigest",
  "durable",
  "globallyUnique",
  "reservationId",
  "authorityRevision",
  "attestation",
]);
const SUPERVISION_REQUEST_CORE_KEYS = new Set([
  "schema",
  "operation",
  "invocationNonce",
  "invocationId",
  "capabilityDigest",
  "requestedAt",
  "deadlineAt",
  "payloadDigest",
  "targetDigest",
  "targetHandlerId",
  "targetRevision",
  "targetAuthorityDigest",
]);
const SUPERVISION_REQUEST_KEYS = new Set([
  ...SUPERVISION_REQUEST_CORE_KEYS,
  "requestDigest",
]);
const SUPERVISION_RESPONSE_KEYS = new Set(["value", "receipt"]);
const SUPERVISION_RECEIPT_KEYS = new Set([
  "schema",
  "requestDigest",
  "invocationNonce",
  "invocationId",
  "capabilityDigest",
  "operation",
  "requestedAt",
  "deadlineAt",
  "payloadDigest",
  "targetDigest",
  "targetHandlerId",
  "targetRevision",
  "targetAuthorityDigest",
  "completedAt",
  "status",
  "isolation",
  "hardDeadlineEnforced",
  "lateSideEffectsPrevented",
  "invocationCount",
  "capabilityRevoked",
  "resultDigest",
  "targetInvocationDigest",
  "revocationDigest",
  "revocationMode",
  "wasActive",
  "activeInvocationTerminated",
  "terminatedAt",
  "supervisorRevision",
  "attestation",
]);
const TARGET_INVOCATION_REQUEST_KEYS = new Set([
  "schema",
  "requestDigest",
  "capabilityDigest",
  "invocationId",
  "deadlineAt",
  "payload",
  "payloadDigest",
  "target",
  "targetDigest",
]);
const TARGET_INVOCATION_EVIDENCE_KEYS = new Set([
  "schema",
  "requestDigest",
  "capabilityDigest",
  "targetDigest",
  "handlerArtifactDigest",
  "targetHandlerId",
  "targetRevision",
  "targetAuthorityDigest",
  "operation",
  "invocationId",
  "invokedAt",
  "completedAt",
  "resultDigest",
  "authorityRevision",
  "attestation",
]);
const TARGET_INVOCATION_RESPONSE_KEYS = new Set(["value", "evidence"]);
const TARGET_REVOCATION_REQUEST_KEYS = new Set([
  "schema",
  "requestDigest",
  "capabilityDigest",
  "invocationId",
  "mode",
  "requestedAt",
  "deadlineAt",
  "targetDigest",
]);
const TARGET_REVOCATION_RECEIPT_KEYS = new Set([
  "schema",
  "requestDigest",
  "capabilityDigest",
  "targetDigest",
  "invocationId",
  "mode",
  "requestedAt",
  "revoked",
  "wasActive",
  "activeInvocationTerminated",
  "revokedAt",
  "terminatedAt",
  "authorityRevision",
  "attestation",
]);
const CAPABILITY_REVOCATION_KEYS = new Set(["mode"]);
const CAPABILITY_REVOCATION_MODES = Object.freeze([
  "completed-release",
  "hard-terminate",
]);
const HARD_BUDGET_KEYS = new Set([
  "executions",
  "tokens",
  "latencyMs",
  "toolCalls",
  "costMicrounits",
]);
const EXECUTION_REQUEST_CORE_KEYS = new Set([
  "schema",
  "runId",
  "runNonce",
  "requestNonce",
  "requestedAt",
  "deadlineAt",
  "taskHandle",
  "opaqueSubjectHandle",
  "executionProjection",
  "remainingHardBudget",
  "seed",
  "policyDigest",
  "environmentDigest",
]);
const EXECUTION_REQUEST_KEYS = new Set([
  ...EXECUTION_REQUEST_CORE_KEYS,
  "requestDigest",
]);
const EXECUTION_RECEIPT_KEYS = new Set([
  "schema",
  "requestDigest",
  "requestNonce",
  "runId",
  "taskHandle",
  "opaqueSubjectHandle",
  "executionProjection",
  "policyDigest",
  "environmentDigest",
  "status",
  "artifact",
  "outputArtifactDigest",
  "metrics",
  "enforcedLimits",
  "sandboxInstanceId",
  "sandboxFresh",
  "issuedAt",
  "expiresAt",
  "executorRevision",
  "attestation",
]);
const EXECUTION_METRIC_KEYS = new Set([
  "tokens",
  "latencyMs",
  "toolCalls",
  "costMicrounits",
  "errors",
]);
const GRADE_REQUEST_CORE_KEYS = new Set([
  "schema",
  "runId",
  "runNonce",
  "requestNonce",
  "requestedAt",
  "deadlineAt",
  "taskDigest",
  "taskType",
  "graderId",
  "privateExpected",
  "artifact",
  "outputArtifactDigest",
  "executionDigest",
  "seed",
  "suiteDigest",
  "policyDigest",
  "environmentDigest",
]);
const GRADE_REQUEST_KEYS = new Set([
  ...GRADE_REQUEST_CORE_KEYS,
  "requestDigest",
]);
const GRADE_RECEIPT_KEYS = new Set([
  "schema",
  "requestDigest",
  "requestNonce",
  "runId",
  "taskDigest",
  "executionDigest",
  "pass",
  "qualityScore",
  "detail",
  "graderRevision",
  "issuedAt",
  "expiresAt",
  "attestation",
]);
const SAFETY_REQUEST_CORE_KEYS = new Set([
  "schema",
  "runId",
  "runNonce",
  "requestNonce",
  "requestedAt",
  "deadlineAt",
  "taskDigest",
  "artifact",
  "outputArtifactDigest",
  "executionDigest",
  "sandboxInstanceId",
  "suiteDigest",
  "policyDigest",
  "environmentDigest",
]);
const SAFETY_REQUEST_KEYS = new Set([
  ...SAFETY_REQUEST_CORE_KEYS,
  "requestDigest",
]);
const SAFETY_RECEIPT_KEYS = new Set([
  "schema",
  "requestDigest",
  "requestNonce",
  "runId",
  "taskDigest",
  "executionDigest",
  "safe",
  "securityViolations",
  "permissionViolations",
  "capabilityDelta",
  "permissionDelta",
  "sandboxReceiptDigest",
  "safetyRevision",
  "issuedAt",
  "expiresAt",
  "attestation",
]);
const INTERVAL_KEYS = new Set(["lower", "upper"]);
const PAIRED_INTERVAL_KEYS = new Set(["taskCount", "mean", "lower", "upper"]);
const VARIANT_SUMMARY_KEYS = new Set([
  "taskCount",
  "seedCount",
  "sampleCount",
  "passCount",
  "passRate",
  "qualityScore",
  "confidenceInterval",
  "errorRate",
  "averageTokens",
  "averageLatencyMs",
  "averageToolCalls",
  "totalTokens",
  "totalLatencyMs",
  "totalToolCalls",
  "totalCostMicrounits",
  "securityViolations",
  "permissionViolations",
  "resultDigest",
]);
const COMPARISON_KEYS = new Set([
  "baseline",
  "candidate",
  "pairedPassDelta",
  "pairedQualityDelta",
  "absoluteImprovement",
  "tokenReduction",
  "latencyReduction",
  "toolCallReduction",
]);
const USAGE_KEYS = new Set([
  "executionCount",
  "totalTokens",
  "totalLatencyMs",
  "totalToolCalls",
  "totalCostMicrounits",
]);
const RECEIPT_KEYS = new Set([
  "schema",
  "runId",
  "runNonce",
  "suiteDigest",
  "policyDigest",
  "evaluationAuthorityRoot",
  "targetEnvironmentRef",
  "evaluationContextDigest",
  "candidateId",
  "baselineId",
  "environmentDigest",
  "suiteAuthorityDigest",
  "environmentAuthorityDigest",
  "candidateResolutionDigest",
  "baselineResolutionDigest",
  "trainingPartitionDigest",
  "candidateProvenanceReceiptDigest",
  "baselineProvenanceReceiptDigest",
  "candidateProvenanceBindingDigest",
  "baselineProvenanceBindingDigest",
  "taskHandleReservationDigest",
  "artifactCapabilityReservationDigest",
  "tenantId",
  "provenanceAudience",
  "trainerAuthority",
  "trainerRevision",
  "confidenceZ",
  "decision",
  "reasonCodes",
  "splitCounts",
  "validation",
  "test",
  "usage",
  "evidenceRoot",
  "issuedAt",
  "expiresAt",
  "receiptDigest",
  "attestation",
]);
const SPLIT_COUNT_KEYS = new Set(SPLITS);

const GATE_INSTANCES = new WeakSet();
const RECEIPT_VERIFIER_INSTANCES = new WeakSet();
const IMMUTABLE_ISOLATED_TARGET_BINDINGS = new WeakMap();

export class EvolutionEvalGateError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "EvolutionEvalGateError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

class EvaluationBudgetExceeded extends Error {
  constructor(usage) {
    super("evaluation exceeded a preregistered total budget");
    this.usage = usage;
  }
}

function evalError(code, message, details = {}) {
  return new EvolutionEvalGateError(code, message, details);
}

function isPlainRecord(value) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertEnumerableOwnKeyBudget(value, maximum, label) {
  const ownEnumerableKeys = Object.keys(value);
  if (ownEnumerableKeys.length > maximum) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} exceeds the enumerable key budget`,
    );
  }
}

function assertExactRecord(value, keys, label) {
  if (!isPlainRecord(value)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} must be a plain object`,
    );
  }
  assertEnumerableOwnKeyBudget(value, keys.size, label);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        `${label}.${String(key)} must be an enumerable own data property`,
      );
    }
  }
}

function addPreflightBytes(state, byteCount) {
  state.bytes += byteCount;
  if (state.bytes > MAX_JSON_BYTES) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON exceeds the 1 MiB preflight budget",
    );
  }
}

function preflightCanonicalValue(value, state, depth = 0) {
  if (depth > 32) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON exceeds depth limit",
    );
  }
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON exceeds the canonical node budget",
    );
  }
  if (value === null || typeof value === "boolean") {
    addPreflightBytes(state, 5);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation JSON contains a non-finite number",
      );
    }
    addPreflightBytes(state, String(value).length);
    return;
  }
  if (typeof value === "string") {
    addPreflightBytes(state, Buffer.byteLength(value, "utf8") + 2);
    return;
  }
  if (!value || typeof value !== "object") {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON contains an unsupported value",
    );
  }
  if (isProxy(value)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON must not contain Proxy values",
    );
  }
  if (state.seen.has(value)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON must not contain cycles",
    );
  }
  state.seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation arrays must use the standard Array prototype",
      );
    }
    if (value.length > MAX_ARRAY_LENGTH) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation array is too large",
      );
    }
    assertEnumerableOwnKeyBudget(value, value.length, "evaluation array");
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation arrays must be dense data-property arrays",
      );
    }
    addPreflightBytes(state, value.length + 2);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw evalError(
          EVOLUTION_EVAL_INVALID_CODE,
          "evaluation arrays must contain enumerable own data properties",
        );
      }
      preflightCanonicalValue(descriptor.value, state, depth + 1);
    }
  } else {
    if (!isPlainRecord(value)) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation JSON must use plain objects",
      );
    }
    assertEnumerableOwnKeyBudget(value, MAX_OBJECT_KEYS, "evaluation object");
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_OBJECT_KEYS) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation object exceeds the key budget",
      );
    }
    if (keys.some((key) => typeof key !== "string")) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation JSON must not use symbol keys",
      );
    }
    addPreflightBytes(state, keys.length + 2);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw evalError(
          EVOLUTION_EVAL_INVALID_CODE,
          "evaluation JSON fields must be enumerable own data properties",
        );
      }
      addPreflightBytes(state, Buffer.byteLength(key, "utf8") + 3);
      preflightCanonicalValue(descriptor.value, state, depth + 1);
    }
  }
  state.seen.delete(value);
}

function canonicalNode(value, seen, depth) {
  if (depth > 32) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON exceeds depth limit",
    );
  }
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation JSON contains a non-finite number",
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (!value || typeof value !== "object") {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON contains an unsupported value",
    );
  }
  if (seen.has(value)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON must not contain cycles",
    );
  }
  seen.add(value);
  let serialized;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation array is too large",
      );
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) =>
        key === "length"
          ? false
          : typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key),
      ) ||
      ownKeys.length !== value.length + 1
    ) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation arrays must be dense data-property arrays",
      );
    }
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw evalError(
          EVOLUTION_EVAL_INVALID_CODE,
          "evaluation arrays must contain enumerable own data properties",
        );
      }
      entries.push(canonicalNode(descriptor.value, seen, depth + 1));
    }
    serialized = `[${entries.join(",")}]`;
  } else {
    if (!isPlainRecord(value)) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation JSON must use plain objects",
      );
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "evaluation JSON must not use symbol keys",
      );
    }
    const fields = keys.sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw evalError(
          EVOLUTION_EVAL_INVALID_CODE,
          "evaluation JSON fields must be enumerable own data properties",
        );
      }
      return `${JSON.stringify(key)}:${canonicalNode(descriptor.value, seen, depth + 1)}`;
    });
    serialized = `{${fields.join(",")}}`;
  }
  seen.delete(value);
  return serialized;
}

function preflightCanonicalStructure(value) {
  preflightCanonicalValue(value, {
    bytes: 0,
    nodes: 0,
    seen: new Set(),
  });
}

function canonicalJson(value) {
  preflightCanonicalStructure(value);
  const serialized = canonicalNode(value, new Set(), 0);
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation JSON exceeds the 1 MiB limit",
    );
  }
  return serialized;
}

function digest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

export function buildEvolutionEvalAttestationDigest(value, purpose) {
  if (
    typeof purpose !== "string" ||
    purpose.length < 1 ||
    purpose.length > 256 ||
    !/^[a-z0-9][a-z0-9./:-]+$/u.test(purpose)
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "attestation purpose is invalid",
    );
  }
  return digest(value, `chainlesschain.evolution-eval-attestation/${purpose}`);
}

export function computeEvolutionEvalSignedEvidenceDigest(record, purpose) {
  if (
    purpose !== EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation &&
    purpose !== EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "signed evidence purpose is invalid",
    );
  }
  return digest(cloneCanonical(record), `${purpose}/signed-record`);
}

export function computeEvolutionEvalEnvironmentDigest(environment) {
  return digest(
    cloneCanonical(environment),
    "chainlesschain.evolution-eval-environment/v2",
  );
}

export function computeEvolutionEvalOutputArtifactDigest(artifact) {
  return digest(
    cloneCanonical(artifact),
    "chainlesschain.evolution-eval-output-artifact/v1",
  );
}

export function computeEvolutionEvalTaskBindingsDigest(taskBindings) {
  return digest(
    cloneCanonical(taskBindings),
    "chainlesschain.evolution-eval-task-bindings/v1",
  );
}

export function computeEvolutionEvalTaskBindingRandomnessCommitment(
  bindingCore,
) {
  preflightCanonicalStructure(bindingCore);
  assertExactRecord(
    bindingCore,
    TASK_BINDING_CORE_KEYS,
    "suite task binding commitment core",
  );
  return digest(
    cloneCanonical(bindingCore),
    "chainlesschain.evolution-eval-task-binding-randomness/v1",
  );
}

export function computeEvolutionEvalHandleReservationSetDigest(value) {
  preflightCanonicalStructure(value);
  assertExactRecord(
    value,
    HANDLE_RESERVATION_SET_KEYS,
    "handle reservation set",
  );
  return digest(
    cloneCanonical(value),
    "chainlesschain.evolution-eval-handle-reservation-set/v1",
  );
}

function computeTrainingPartitionDigest(suite) {
  return digest(
    {
      suiteDigest: suite.suiteDigest,
      datasetVersion: suite.datasetVersion,
      taskDigests: suite.tasks
        .filter((task) => task.split === "training")
        .map((task) => task.taskDigest),
    },
    "chainlesschain.evolution-eval-training-partition/v1",
  );
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

function cloneCanonical(value) {
  return JSON.parse(canonicalJson(value));
}

function normalizeId(value, label, maximum = 160) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !SAFE_ID_PATTERN.test(value)
  ) {
    throw evalError(EVOLUTION_EVAL_INVALID_CODE, `${label} is invalid`);
  }
  return value;
}

function normalizeBoundedString(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw evalError(EVOLUTION_EVAL_INVALID_CODE, `${label} is invalid`);
  }
  return value;
}

function normalizeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function normalizeInteger(
  value,
  label,
  { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} must be an integer in range`,
    );
  }
  return value;
}

function normalizeFinite(
  value,
  label,
  { minimum = -Infinity, maximum = Infinity } = {},
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} must be a finite number in range`,
    );
  }
  return value;
}

function normalizeRatio(value, label, range = {}) {
  return normalizeFinite(value, label, {
    minimum: range.minimum ?? 0,
    maximum: range.maximum ?? 1,
  });
}

function normalizeTimestamp(value, label = "evaluation timestamp") {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw evalError(EVOLUTION_EVAL_INVALID_CODE, `${label} is invalid`);
  }
  const normalized = date.toISOString();
  if (typeof value === "string" && value !== normalized) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} must be canonical ISO-8601`,
    );
  }
  return normalized;
}

function readClock(clock) {
  let value;
  try {
    value = clock();
  } catch (cause) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      "trusted clock failed",
      { cause },
    );
  }
  const timestamp = normalizeTimestamp(value, "trusted clock value");
  return { timestamp, milliseconds: new Date(timestamp).getTime() };
}

function randomIdentifier(prefix) {
  return `${prefix}-${randomBytes(24).toString("hex")}`;
}

function normalizeExecutionProjection(value, label) {
  preflightCanonicalStructure(value);
  assertExactRecord(value, EXECUTION_PROJECTION_KEYS, label);
  if (!TASK_TYPES.includes(value.taskType)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label}.taskType is invalid`,
    );
  }
  return deepFreeze({
    taskType: value.taskType,
    publicInput: deepFreeze(cloneCanonical(value.publicInput)),
  });
}

function executionProjectionDigest(value) {
  return digest(value, "chainlesschain.evolution-eval-execution-projection/v1");
}

function taskCore(input) {
  preflightCanonicalStructure(input);
  assertExactRecord(input, TASK_INPUT_KEYS, "evaluation task input");
  if (!SPLITS.includes(input.split)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation task split is invalid",
    );
  }
  if (!TASK_TYPES.includes(input.taskType)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation task type is invalid",
    );
  }
  if (
    !Array.isArray(input.groupKeys) ||
    input.groupKeys.length !== 4 ||
    new Set(input.groupKeys).size !== 4
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation task must contain four unique group keys",
    );
  }
  const groupKeys = input.groupKeys.map((value, index) =>
    normalizeId(value, `groupKeys[${index}]`, 256),
  );
  return {
    schema: EVOLUTION_EVAL_TASK_SCHEMA,
    id: normalizeId(input.id, "task id"),
    split: input.split,
    groupKeys,
    taskType: input.taskType,
    publicInput: cloneCanonical(input.publicInput),
    graderId: normalizeId(input.graderId, "graderId"),
    privateExpected: cloneCanonical(input.privateExpected),
  };
}

export function buildEvolutionEvalTask(input) {
  const core = taskCore(input);
  return deepFreeze({
    ...core,
    taskDigest: digest(core, "chainlesschain.evolution-eval-task/v1"),
  });
}

export function verifyEvolutionEvalTask(value) {
  preflightCanonicalStructure(value);
  assertExactRecord(value, TASK_KEYS, "evaluation task");
  if (value.schema !== EVOLUTION_EVAL_TASK_SCHEMA) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation task schema is invalid",
    );
  }
  const normalized = buildEvolutionEvalTask({
    id: value.id,
    split: value.split,
    groupKeys: value.groupKeys,
    taskType: value.taskType,
    publicInput: value.publicInput,
    graderId: value.graderId,
    privateExpected: value.privateExpected,
  });
  if (normalized.taskDigest !== value.taskDigest) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation task digest verification failed",
    );
  }
  return normalized;
}

function assertPartitionIsolation(tasks) {
  const ids = new Set();
  const groupOwners = new Map();
  const publicInputOwners = new Map();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw evalError(
        EVOLUTION_EVAL_LEAKAGE_CODE,
        `duplicate evaluation task id: ${task.id}`,
      );
    }
    ids.add(task.id);
    for (const groupKey of task.groupKeys) {
      const prior = groupOwners.get(groupKey);
      if (prior && prior !== task.split) {
        throw evalError(
          EVOLUTION_EVAL_LEAKAGE_CODE,
          `group key ${groupKey} crosses ${prior}/${task.split} partitions`,
        );
      }
      groupOwners.set(groupKey, task.split);
    }
    const publicDigest = digest(
      task.publicInput,
      "chainlesschain.evolution-eval-public-input/v1",
    );
    const priorSplit = publicInputOwners.get(publicDigest);
    if (priorSplit && priorSplit !== task.split) {
      throw evalError(
        EVOLUTION_EVAL_LEAKAGE_CODE,
        "identical public input crosses evaluation partitions",
      );
    }
    publicInputOwners.set(publicDigest, task.split);
  }
}

export function buildEvolutionEvalSuite(input) {
  preflightCanonicalStructure(input);
  assertExactRecord(input, SUITE_INPUT_KEYS, "evaluation suite input");
  if (
    !Array.isArray(input.tasks) ||
    input.tasks.length === 0 ||
    input.tasks.length > 10_000
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation suite tasks are invalid",
    );
  }
  const tasks = input.tasks.map((task) =>
    task?.schema === EVOLUTION_EVAL_TASK_SCHEMA
      ? verifyEvolutionEvalTask(task)
      : buildEvolutionEvalTask(task),
  );
  assertPartitionIsolation(tasks);
  const core = {
    schema: EVOLUTION_EVAL_SUITE_SCHEMA,
    suiteId: normalizeId(input.suiteId, "suiteId"),
    datasetVersion: normalizeId(input.datasetVersion, "datasetVersion"),
    tasks,
  };
  return deepFreeze({
    ...core,
    suiteDigest: digest(core, "chainlesschain.evolution-eval-suite/v1"),
  });
}

export function verifyEvolutionEvalSuite(value) {
  preflightCanonicalStructure(value);
  assertExactRecord(value, SUITE_KEYS, "evaluation suite");
  if (value.schema !== EVOLUTION_EVAL_SUITE_SCHEMA) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation suite schema is invalid",
    );
  }
  const normalized = buildEvolutionEvalSuite({
    suiteId: value.suiteId,
    datasetVersion: value.datasetVersion,
    tasks: value.tasks,
  });
  if (normalized.suiteDigest !== value.suiteDigest) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation suite digest verification failed",
    );
  }
  return normalized;
}

export function buildEvolutionEvalPolicy(input) {
  preflightCanonicalStructure(input);
  assertExactRecord(input, POLICY_INPUT_KEYS, "evaluation policy input");
  if (
    !Array.isArray(input.seeds) ||
    input.seeds.length < 3 ||
    input.seeds.length > 32
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation policy requires 3-32 seeds",
    );
  }
  const seeds = input.seeds.map((seed, index) =>
    normalizeInteger(seed, `seeds[${index}]`, {
      minimum: 0,
      maximum: 0x7fffffff,
    }),
  );
  if (new Set(seeds).size !== seeds.length) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation policy seeds must be unique",
    );
  }
  const core = {
    schema: EVOLUTION_EVAL_POLICY_SCHEMA,
    policyId: normalizeId(input.policyId, "policyId"),
    minTrainingTasks: normalizeInteger(
      input.minTrainingTasks,
      "minTrainingTasks",
      {
        minimum: 30,
        maximum: 100_000,
      },
    ),
    minValidationTasks: normalizeInteger(
      input.minValidationTasks,
      "minValidationTasks",
      {
        minimum: 20,
        maximum: 100_000,
      },
    ),
    minTestTasks: normalizeInteger(input.minTestTasks, "minTestTasks", {
      minimum: 20,
      maximum: 100_000,
    }),
    seeds,
    minimumAbsoluteImprovement: normalizeRatio(
      input.minimumAbsoluteImprovement,
      "minimumAbsoluteImprovement",
      { minimum: 0.05 },
    ),
    minimumEfficiencyImprovement: normalizeRatio(
      input.minimumEfficiencyImprovement,
      "minimumEfficiencyImprovement",
      { minimum: 0.1 },
    ),
    confidenceZ: normalizeFinite(input.confidenceZ, "confidenceZ", {
      minimum: 1.64,
      maximum: 4,
    }),
    maxAverageTokens: normalizeInteger(
      input.maxAverageTokens,
      "maxAverageTokens",
      {
        minimum: 1,
      },
    ),
    maxAverageLatencyMs: normalizeInteger(
      input.maxAverageLatencyMs,
      "maxAverageLatencyMs",
      { minimum: 1 },
    ),
    maxAverageToolCalls: normalizeInteger(
      input.maxAverageToolCalls,
      "maxAverageToolCalls",
    ),
    maxTotalTokens: normalizeInteger(input.maxTotalTokens, "maxTotalTokens", {
      minimum: 1,
    }),
    maxTotalLatencyMs: normalizeInteger(
      input.maxTotalLatencyMs,
      "maxTotalLatencyMs",
      { minimum: 1 },
    ),
    maxTotalToolCalls: normalizeInteger(
      input.maxTotalToolCalls,
      "maxTotalToolCalls",
    ),
    maxTotalCostMicrounits: normalizeInteger(
      input.maxTotalCostMicrounits,
      "maxTotalCostMicrounits",
    ),
    maxExecutions: normalizeInteger(input.maxExecutions, "maxExecutions", {
      minimum: 1,
      maximum: 1_000_000,
    }),
    maxWallClockMs: normalizeInteger(input.maxWallClockMs, "maxWallClockMs", {
      minimum: 100,
      maximum: 3_600_000,
    }),
    portReceiptTtlMs: normalizeInteger(
      input.portReceiptTtlMs,
      "portReceiptTtlMs",
      { minimum: 1_000, maximum: 3_600_000 },
    ),
    receiptTtlMs: normalizeInteger(input.receiptTtlMs, "receiptTtlMs", {
      minimum: 1_000,
      maximum: 600_000,
    }),
  };
  if (core.portReceiptTtlMs < core.maxWallClockMs) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "portReceiptTtlMs must cover the complete evaluation deadline",
    );
  }
  return deepFreeze({
    ...core,
    policyDigest: digest(core, "chainlesschain.evolution-eval-policy/v2"),
  });
}

export function verifyEvolutionEvalPolicy(value) {
  preflightCanonicalStructure(value);
  assertExactRecord(value, POLICY_KEYS, "evaluation policy");
  if (value.schema !== EVOLUTION_EVAL_POLICY_SCHEMA) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation policy schema is invalid",
    );
  }
  const input = Object.fromEntries(
    [...POLICY_INPUT_KEYS].map((key) => [key, value[key]]),
  );
  const normalized = buildEvolutionEvalPolicy(input);
  if (normalized.policyDigest !== value.policyDigest) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation policy digest verification failed",
    );
  }
  return normalized;
}

function normalizeTrust(value, label = "receipt trust") {
  assertExactRecord(value, TRUST_KEYS, label);
  return deepFreeze({
    algorithm: normalizeBoundedString(
      value.algorithm,
      `${label}.algorithm`,
      64,
    ),
    issuer: normalizeBoundedString(value.issuer, `${label}.issuer`, 256),
    keyId: normalizeBoundedString(value.keyId, `${label}.keyId`, 256),
    trustPolicyDigest: normalizeDigest(
      value.trustPolicyDigest,
      `${label}.trustPolicyDigest`,
    ),
  });
}

function normalizeAttestation(value, label = "attestation") {
  assertExactRecord(value, ATTESTATION_KEYS, label);
  const trust = normalizeTrust(
    {
      algorithm: value.algorithm,
      issuer: value.issuer,
      keyId: value.keyId,
      trustPolicyDigest: value.trustPolicyDigest,
    },
    label,
  );
  if (typeof value.value !== "string" || !SIGNATURE_PATTERN.test(value.value)) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label}.value is invalid`,
    );
  }
  return deepFreeze({ ...trust, value: value.value });
}

function sameTrust(attestation, trust) {
  return [...TRUST_KEYS].every((key) => attestation[key] === trust[key]);
}

function samePrincipalKeyIdentity(left, right) {
  return (
    left.algorithm === right.algorithm &&
    left.issuer === right.issuer &&
    left.keyId === right.keyId
  );
}

function computeTrustPrincipalKeyFingerprint(trust) {
  return digest(
    {
      algorithm: trust.algorithm,
      issuer: trust.issuer,
      keyId: trust.keyId,
    },
    "chainlesschain.evolution-eval-trust-principal-key/v1",
  );
}

function normalizeAuthorityPolicy(value, label) {
  assertExactRecord(value, AUTHORITY_POLICY_KEYS, label);
  return deepFreeze({
    trust: normalizeTrust(value.trust, `${label}.trust`),
    revision: normalizeId(value.revision, `${label}.revision`, 256),
  });
}

function normalizeAuthorityDescriptor(
  value,
  label,
  { expectedPolicy, expectedOperation },
) {
  preflightCanonicalStructure(value);
  assertExactRecord(value, AUTHORITY_DESCRIPTOR_KEYS, label);
  if (value.schema !== EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA) {
    throw evalError(EVOLUTION_EVAL_INVALID_CODE, `${label} schema is invalid`);
  }
  const normalized = deepFreeze({
    schema: EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
    handlerId: normalizeId(value.handlerId, `${label}.handlerId`, 256),
    handlerRevision: normalizeId(
      value.handlerRevision,
      `${label}.handlerRevision`,
      256,
    ),
    operation: normalizeId(value.operation, `${label}.operation`, 256),
    handlerArtifactDigest: normalizeDigest(
      value.handlerArtifactDigest,
      `${label}.handlerArtifactDigest`,
    ),
    authority: normalizeTrust(value.authority, `${label}.authority`),
  });
  if (
    normalized.operation !== expectedOperation ||
    !sameTrust(normalized.authority, expectedPolicy.trust) ||
    normalized.handlerRevision !== expectedPolicy.revision
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} operation, authority, or revision differs from its captured purpose policy`,
    );
  }
  return normalized;
}

function authorityDescriptorDigest(value) {
  return digest(value, "chainlesschain.evolution-eval-authority-descriptor/v1");
}

function captureAuthorityDescriptor(
  port,
  label,
  expectedPolicy,
  expectedOperation,
) {
  // This captures trusted composition metadata without claiming that local
  // JavaScript can derive or attest the executable callable's byte identity.
  return normalizeAuthorityDescriptor(
    ownDataField(port, "authorityDescriptor", label),
    `${label}.authorityDescriptor`,
    { expectedPolicy, expectedOperation },
  );
}

function validateUniqueSensitiveCallables(entries, label) {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      if (entries[leftIndex].callable === entries[rightIndex].callable) {
        throw evalError(
          EVOLUTION_EVAL_INVALID_CODE,
          `${label} verifier callable identity must not alias ${entries[leftIndex].label} and ${entries[rightIndex].label} raw callables`,
        );
      }
    }
  }
}

// No resolver/storage sharing is implicitly trusted. The only sanctioned
// alias is the exact trust pair that signs and verifies the same final receipt.
const GLOBAL_AUTHORITY_PRINCIPAL_ALIAS_WHITELIST = new Set([
  "receiptSigner\0receiptVerifier",
]);

function authorityAliasPair(leftRole, rightRole) {
  return leftRole < rightRole
    ? `${leftRole}\0${rightRole}`
    : `${rightRole}\0${leftRole}`;
}

function validateGlobalAuthorityPrincipalMatrix(entries, label) {
  const byFingerprint = new Map();
  for (const entry of entries) {
    const fingerprint = computeTrustPrincipalKeyFingerprint(entry.trust);
    const existing = byFingerprint.get(fingerprint) || [];
    for (const prior of existing) {
      const pair = authorityAliasPair(prior.role, entry.role);
      const explicitlyAllowed =
        GLOBAL_AUTHORITY_PRINCIPAL_ALIAS_WHITELIST.has(pair) &&
        sameTrust(prior.trust, entry.trust);
      if (!explicitlyAllowed) {
        throw evalError(
          EVOLUTION_EVAL_INVALID_CODE,
          `${label} aliases ${prior.label} and ${entry.label} by principal/key identity`,
        );
      }
    }
    existing.push(entry);
    byFingerprint.set(fingerprint, existing);
  }
}

function normalizeAuthorityPolicies(value) {
  assertExactRecord(
    value,
    AUTHORITY_POLICIES_KEYS,
    "evaluation authority policies",
  );
  return deepFreeze(
    Object.fromEntries(
      AUTHORITY_POLICY_PURPOSES.map((purpose) => [
        purpose,
        normalizeAuthorityPolicy(
          value[purpose],
          `authorityPolicies.${purpose}`,
        ),
      ]),
    ),
  );
}

function normalizeRunEvaluationContext(value) {
  preflightCanonicalStructure(value);
  assertExactRecord(
    value,
    RUN_EVALUATION_CONTEXT_KEYS,
    "evaluation run context",
  );
  return deepFreeze({
    planDigest: normalizeDigest(
      value.planDigest,
      "evaluationContext.planDigest",
    ),
    targetMatrixRoot: normalizeDigest(
      value.targetMatrixRoot,
      "evaluationContext.targetMatrixRoot",
    ),
    cellId: normalizeId(value.cellId, "evaluationContext.cellId", 256),
    runtimeId: normalizeId(value.runtimeId, "evaluationContext.runtimeId", 256),
  });
}

function normalizeEvaluationContext(value) {
  preflightCanonicalStructure(value);
  assertExactRecord(value, EVALUATION_CONTEXT_KEYS, "evaluation context");
  return deepFreeze({
    planDigest: normalizeDigest(value.planDigest, "context.planDigest"),
    tenantId: normalizeId(value.tenantId, "context.tenantId", 256),
    targetMatrixRoot: normalizeDigest(
      value.targetMatrixRoot,
      "context.targetMatrixRoot",
    ),
    cellId: normalizeId(value.cellId, "context.cellId", 256),
    runtimeId: normalizeId(value.runtimeId, "context.runtimeId", 256),
    targetEnvironmentRef: normalizeId(
      value.targetEnvironmentRef,
      "context.targetEnvironmentRef",
      256,
    ),
    environmentDigest: normalizeDigest(
      value.environmentDigest,
      "context.environmentDigest",
    ),
    candidateId: normalizeDigest(value.candidateId, "context.candidateId"),
    baselineId: normalizeDigest(value.baselineId, "context.baselineId"),
    suiteDigest: normalizeDigest(value.suiteDigest, "context.suiteDigest"),
    policyDigest: normalizeDigest(value.policyDigest, "context.policyDigest"),
    evaluationAuthorityRoot: normalizeDigest(
      value.evaluationAuthorityRoot,
      "context.evaluationAuthorityRoot",
    ),
  });
}

export function computeEvolutionEvalContextDigest(value) {
  return digest(
    normalizeEvaluationContext(value),
    "chainlesschain.evolution-eval-context/v1",
  );
}

function ownDataField(value, key, label) {
  if (!isPlainRecord(value)) {
    throw evalError(EVOLUTION_EVAL_INVALID_CODE, `${label} must be an object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label}.${key} must be an enumerable own data property`,
    );
  }
  return descriptor.value;
}

function readCallableMethod(port, method, label) {
  const callable = ownDataField(port, method, label);
  if (typeof callable !== "function" || isProxy(callable)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label}.${method} must be a non-Proxy function`,
    );
  }
  return callable;
}

function captureCallable(port, callable) {
  const captured = Function.prototype.bind.call(callable, port);
  return Object.freeze((...args) => Reflect.apply(captured, undefined, args));
}

function validateIndependentEvidenceAuthorities({
  deadlineSupervisor,
  supervisorPolicy,
  invocationEvidenceVerifier,
  invocationEvidencePolicy,
  revocationEvidenceVerifier,
  revocationEvidencePolicy,
  label,
}) {
  if (
    invocationEvidenceVerifier === deadlineSupervisor ||
    revocationEvidenceVerifier === deadlineSupervisor ||
    invocationEvidenceVerifier === revocationEvidenceVerifier
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} must be independent in principal/key identity, verifier callable, and revision`,
    );
  }
  const supervisorDescriptor = captureAuthorityDescriptor(
    deadlineSupervisor,
    "deadlineSupervisor",
    supervisorPolicy,
    "deadline-supervision",
  );
  const invocationEvidenceDescriptor = captureAuthorityDescriptor(
    invocationEvidenceVerifier,
    "invocationEvidenceVerifier",
    invocationEvidencePolicy,
    "target-invocation-evidence-verify",
  );
  const revocationEvidenceDescriptor = captureAuthorityDescriptor(
    revocationEvidenceVerifier,
    "revocationEvidenceVerifier",
    revocationEvidencePolicy,
    "target-revocation-evidence-verify",
  );
  const supervisorRun = readCallableMethod(
    deadlineSupervisor,
    "run",
    "deadlineSupervisor",
  );
  const supervisorInvokeTarget = readCallableMethod(
    deadlineSupervisor,
    "invokeTarget",
    "deadlineSupervisor",
  );
  const supervisorRevokeTarget = readCallableMethod(
    deadlineSupervisor,
    "revokeTarget",
    "deadlineSupervisor",
  );
  const supervisorVerifyEnforcement = readCallableMethod(
    deadlineSupervisor,
    "verifyEnforcement",
    "deadlineSupervisor",
  );
  const invocationEvidenceVerify = readCallableMethod(
    invocationEvidenceVerifier,
    "verify",
    "invocationEvidenceVerifier",
  );
  const revocationEvidenceVerify = readCallableMethod(
    revocationEvidenceVerifier,
    "verify",
    "revocationEvidenceVerifier",
  );
  validateUniqueSensitiveCallables(
    [
      { label: "deadlineSupervisor.run", callable: supervisorRun },
      {
        label: "deadlineSupervisor.invokeTarget",
        callable: supervisorInvokeTarget,
      },
      {
        label: "deadlineSupervisor.revokeTarget",
        callable: supervisorRevokeTarget,
      },
      {
        label: "deadlineSupervisor.verifyEnforcement",
        callable: supervisorVerifyEnforcement,
      },
      {
        label: "invocationEvidenceVerifier.verify",
        callable: invocationEvidenceVerify,
      },
      {
        label: "revocationEvidenceVerifier.verify",
        callable: revocationEvidenceVerify,
      },
    ],
    label,
  );
  if (
    samePrincipalKeyIdentity(
      invocationEvidencePolicy.trust,
      supervisorPolicy.trust,
    ) ||
    samePrincipalKeyIdentity(
      revocationEvidencePolicy.trust,
      supervisorPolicy.trust,
    ) ||
    samePrincipalKeyIdentity(
      invocationEvidencePolicy.trust,
      revocationEvidencePolicy.trust,
    ) ||
    invocationEvidencePolicy.revision === supervisorPolicy.revision ||
    revocationEvidencePolicy.revision === supervisorPolicy.revision ||
    invocationEvidencePolicy.revision === revocationEvidencePolicy.revision
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} must be independent in principal/key identity, verifier callable, and revision`,
    );
  }
  return Object.freeze({
    supervisorRun,
    supervisorInvokeTarget,
    supervisorRevokeTarget,
    supervisorVerifyEnforcement,
    invocationEvidenceVerify,
    revocationEvidenceVerify,
    supervisorDescriptor,
    invocationEvidenceDescriptor,
    revocationEvidenceDescriptor,
  });
}

function captureTrustedClock(clock, clockPolicy, label) {
  const descriptor = captureAuthorityDescriptor(
    clock,
    label,
    clockPolicy,
    "trusted-time-read",
  );
  const rawNow = readCallableMethod(clock, "now", label);
  return Object.freeze({
    descriptor,
    rawNow,
    now: captureCallable(clock, rawNow),
  });
}

function normalizeIsolatedTarget(value, label, { requireHsm = false } = {}) {
  assertExactRecord(value, ISOLATED_TARGET_KEYS, label);
  if (value.schema !== EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA) {
    throw evalError(EVOLUTION_EVAL_INVALID_CODE, `${label} schema is invalid`);
  }
  const isolation = normalizeId(value.isolation, `${label}.isolation`, 64);
  if (
    !SUPERVISOR_ISOLATIONS.includes(isolation) ||
    (requireHsm && isolation !== "hsm-deadline-authority")
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} does not declare a supported hard-termination boundary`,
    );
  }
  return deepFreeze({
    schema: EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
    handlerId: normalizeId(value.handlerId, `${label}.handlerId`, 256),
    handlerRevision: normalizeId(
      value.handlerRevision,
      `${label}.handlerRevision`,
      256,
    ),
    operation: normalizeId(value.operation, `${label}.operation`, 256),
    isolation,
    handlerArtifactDigest: normalizeDigest(
      value.handlerArtifactDigest,
      `${label}.handlerArtifactDigest`,
    ),
    authority: normalizeTrust(value.authority, `${label}.authority`),
  });
}

function captureIsolatedTarget(
  port,
  method,
  label,
  { requireHsm = false, expectedPolicy = null } = {},
) {
  const target = ownDataField(port, method, label);
  if (typeof target === "function") {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label}.${method} must be a declarative isolated target; executable closure ports are forbidden`,
    );
  }
  const binding = getImmutableIsolatedTargetBinding(
    target,
    `${label}.${method}`,
    { requireHsm },
  );
  const normalized = binding.target;
  if (
    expectedPolicy !== null &&
    (!sameTrust(normalized.authority, expectedPolicy.trust) ||
      normalized.handlerRevision !== expectedPolicy.revision)
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label}.${method} authority or revision differs from its captured purpose policy`,
    );
  }
  return normalized;
}

function createIsolatedTargetBinding(target) {
  const targetDigest = digest(
    target,
    "chainlesschain.evolution-eval-isolated-target/v2",
  );
  const targetAuthorityDigest = digest(
    {
      handlerId: target.handlerId,
      handlerRevision: target.handlerRevision,
      operation: target.operation,
      handlerArtifactDigest: target.handlerArtifactDigest,
      authority: target.authority,
    },
    "chainlesschain.evolution-eval-target-authority/v2",
  );
  return Object.freeze({ target, targetDigest, targetAuthorityDigest });
}

function getImmutableIsolatedTargetBinding(
  value,
  label = "isolated target",
  options = {},
) {
  const cached = IMMUTABLE_ISOLATED_TARGET_BINDINGS.get(value);
  if (cached) {
    if (
      options.requireHsm === true &&
      cached.target.isolation !== "hsm-deadline-authority"
    ) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        `${label} does not declare a supported hard-termination boundary`,
      );
    }
    return cached;
  }
  const target = normalizeIsolatedTarget(value, label, options);
  const binding = createIsolatedTargetBinding(target);
  IMMUTABLE_ISOLATED_TARGET_BINDINGS.set(target, binding);
  if (Object.isFrozen(value) && Object.isFrozen(value.authority)) {
    IMMUTABLE_ISOLATED_TARGET_BINDINGS.set(value, binding);
  }
  return binding;
}

export function computeEvolutionEvalIsolatedTargetDigest(value) {
  return getImmutableIsolatedTargetBinding(value).targetDigest;
}

export function computeEvolutionEvalTargetAuthorityDigest(value) {
  return getImmutableIsolatedTargetBinding(value).targetAuthorityDigest;
}

function evaluationAuthorityTargetBinding({
  target,
  trust,
  revision,
  purpose,
}) {
  const binding = getImmutableIsolatedTargetBinding(target);
  return {
    purpose,
    targetDigest: binding.targetDigest,
    targetAuthorityDigest: binding.targetAuthorityDigest,
    trust,
    revision,
  };
}

function computeEvaluationAuthorityRoot({
  authorityPolicies,
  graderAuthorityPolicies,
  targets,
  graders,
  receiptTrust,
  receiptSigner,
  attestationVerifier,
  supervisionDescriptors,
  clockDescriptor,
}) {
  const portPurposes = [
    "suite",
    "environment",
    "artifact",
    "provenance",
    "subject",
    "replay",
    "execution",
    "safety",
  ];
  const ports = Object.fromEntries(
    portPurposes.map((purpose) => [
      purpose,
      evaluationAuthorityTargetBinding({
        target: targets[purpose],
        trust: authorityPolicies[purpose].trust,
        revision: authorityPolicies[purpose].revision,
        purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES[purpose],
      }),
    ]),
  );
  const graderBindings = [...graders.entries()]
    .sort(([leftId], [rightId]) =>
      leftId < rightId ? -1 : leftId > rightId ? 1 : 0,
    )
    .map(([graderId, target]) => {
      const policy = graderAuthorityPolicies.get(graderId);
      return {
        graderId,
        ...evaluationAuthorityTargetBinding({
          target,
          trust: policy.trust,
          revision: policy.revision,
          purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.grade,
        }),
      };
    });
  return digest(
    {
      schema: "chainlesschain.evolution-eval-authority-config/v2",
      semantics: EVOLUTION_EVAL_AUTHORITY_ROOT_SEMANTICS,
      ports,
      graders: graderBindings,
      supervision: {
        supervisor: {
          purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
          trust: authorityPolicies.supervisor.trust,
          revision: authorityPolicies.supervisor.revision,
          descriptor: supervisionDescriptors.supervisor,
          descriptorDigest: authorityDescriptorDigest(
            supervisionDescriptors.supervisor,
          ),
        },
        invocationEvidence: {
          purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation,
          trust: authorityPolicies.invocationEvidence.trust,
          revision: authorityPolicies.invocationEvidence.revision,
          descriptor: supervisionDescriptors.invocationEvidence,
          descriptorDigest: authorityDescriptorDigest(
            supervisionDescriptors.invocationEvidence,
          ),
        },
        revocationEvidence: {
          purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation,
          trust: authorityPolicies.revocationEvidence.trust,
          revision: authorityPolicies.revocationEvidence.revision,
          descriptor: supervisionDescriptors.revocationEvidence,
          descriptorDigest: authorityDescriptorDigest(
            supervisionDescriptors.revocationEvidence,
          ),
        },
        clock: {
          purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.clock,
          trust: authorityPolicies.clock.trust,
          revision: authorityPolicies.clock.revision,
          descriptor: clockDescriptor,
          descriptorDigest: authorityDescriptorDigest(clockDescriptor),
        },
      },
      receipt: {
        purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt,
        trust: receiptTrust,
        signer: evaluationAuthorityTargetBinding({
          target: receiptSigner,
          trust: receiptSigner.authority,
          revision: receiptSigner.handlerRevision,
          purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt,
        }),
        verifier: evaluationAuthorityTargetBinding({
          target: attestationVerifier,
          trust: attestationVerifier.authority,
          revision: attestationVerifier.handlerRevision,
          purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt,
        }),
      },
    },
    "chainlesschain.evolution-eval-authority-root/v2",
  );
}

export function computeEvolutionEvalSupervisedResultDigest(value) {
  return digest(
    cloneCanonical(value),
    "chainlesschain.evolution-eval-supervised-result/v1",
  );
}

class RunTypedNamespaceRegistry {
  #entries = new Map();

  register(namespace, value, label) {
    const normalizedNamespace = normalizeId(
      namespace,
      "typed digest namespace",
      256,
    );
    const normalizedValue = normalizeDigest(value, label);
    const existing = this.#entries.get(normalizedValue);
    if (existing && existing.namespace !== normalizedNamespace) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        `${label} collides with ${existing.label} across typed digest namespaces`,
        {
          digest: normalizedValue,
          actualNamespace: normalizedNamespace,
          existingNamespace: existing.namespace,
        },
      );
    }
    if (!existing) {
      this.#entries.set(
        normalizedValue,
        Object.freeze({ namespace: normalizedNamespace, label }),
      );
    }
    return normalizedValue;
  }

  registerMany(namespace, values, label) {
    for (let index = 0; index < values.length; index += 1) {
      this.register(namespace, values[index], `${label}[${index}]`);
    }
  }
}

function verifySynchronousEvidence({
  record,
  keys,
  schema,
  purpose,
  verifier,
  expectedPolicy,
  label,
}) {
  assertExactRecord(record, keys, label);
  if (record.schema !== schema) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} schema is invalid`,
    );
  }
  const attestation = normalizeAttestation(
    record.attestation,
    `${label}.attestation`,
  );
  if (
    !sameTrust(attestation, expectedPolicy.trust) ||
    normalizeId(record.authorityRevision, `${label}.authorityRevision`, 256) !==
      expectedPolicy.revision
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} authority or revision is invalid`,
    );
  }
  const core = cloneCanonical(record);
  delete core.attestation;
  const payloadDigest = buildEvolutionEvalAttestationDigest(core, purpose);
  let verified;
  try {
    verified = verifier(deepFreeze({ purpose, payloadDigest, attestation }));
  } catch (cause) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} verifier failed`,
      { cause },
    );
  }
  if (verified !== true || (verified && typeof verified.then === "function")) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} signature was rejected`,
    );
  }
  return deepFreeze({
    core,
    recordDigest: computeEvolutionEvalSignedEvidenceDigest(record, purpose),
  });
}

async function verifyAttestedCore({
  record,
  keys,
  schema,
  purpose,
  verifyAttestation,
  clock,
  deadlineAt,
  expectedTrust,
  expectedRevision,
  revisionField,
  supervision,
  monotonicDeadlineMs,
  label,
}) {
  assertExactRecord(record, keys, label);
  if (record.schema !== schema) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} schema is invalid`,
    );
  }
  const attestation = normalizeAttestation(
    record.attestation,
    `${label}.attestation`,
  );
  if (!sameTrust(attestation, expectedTrust)) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} issuer, key, or trust policy is invalid`,
    );
  }
  const core = cloneCanonical(record);
  delete core.attestation;
  if (
    normalizeId(core[revisionField], `${label}.${revisionField}`, 256) !==
    expectedRevision
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} authority revision is invalid`,
    );
  }
  const payloadDigest = buildEvolutionEvalAttestationDigest(core, purpose);
  const verified = await invokeAtDeadline(
    verifyAttestation,
    deepFreeze({ purpose, payloadDigest, attestation }),
    deadlineAt,
    clock,
    EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
    `${label} attestation verifier`,
    supervision,
    monotonicDeadlineMs,
  );
  if (verified !== true) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} attestation was rejected`,
    );
  }
  return {
    core: deepFreeze(core),
    attestation,
    recordDigest: digest(core, `${purpose}/record`),
  };
}

function assertFreshBinding({
  core,
  expectedNonce,
  expectedRequestedAt,
  expectedDeadlineMs,
  maximumTtlMs,
  nowMs,
  label,
}) {
  if (
    core.requestNonce !== expectedNonce ||
    core.requestedAt !== expectedRequestedAt
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} is not bound to this request`,
    );
  }
  const requestedAt = normalizeTimestamp(
    core.requestedAt,
    `${label}.requestedAt`,
  );
  const expiresAt = normalizeTimestamp(core.expiresAt, `${label}.expiresAt`);
  const requestedMs = new Date(requestedAt).getTime();
  const expiresMs = new Date(expiresAt).getTime();
  if (
    expiresMs <= nowMs ||
    expiresMs < expectedDeadlineMs ||
    expiresMs > requestedMs + maximumTtlMs ||
    requestedMs > nowMs + CLOCK_SKEW_MS
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} freshness window is invalid`,
    );
  }
  return expiresMs;
}

function assertIssuedReceiptWindow(core, request, nowMs, maximumTtlMs, label) {
  const issuedAt = normalizeTimestamp(core.issuedAt, `${label}.issuedAt`);
  const expiresAt = normalizeTimestamp(core.expiresAt, `${label}.expiresAt`);
  const issuedMs = new Date(issuedAt).getTime();
  const expiresMs = new Date(expiresAt).getTime();
  const requestedMs = new Date(request.requestedAt).getTime();
  const deadlineMs = new Date(request.deadlineAt).getTime();
  if (
    issuedMs < requestedMs - CLOCK_SKEW_MS ||
    issuedMs > nowMs + CLOCK_SKEW_MS ||
    expiresMs <= issuedMs ||
    expiresMs <= nowMs ||
    expiresMs < deadlineMs ||
    expiresMs > requestedMs + maximumTtlMs
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} freshness window is invalid`,
    );
  }
}

function countSplits(tasks) {
  return Object.fromEntries(
    SPLITS.map((split) => [
      split,
      tasks.filter((task) => task.split === split).length,
    ]),
  );
}

function wilsonInterval(successes, total, z) {
  if (total === 0) return { lower: 0, upper: 1 };
  const rate = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (rate + z2 / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((rate * (1 - rate) + z2 / (4 * total)) / total)) /
    denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

function meanInterval(values, z, { minimum = -1, maximum = 1 } = {}) {
  if (values.length === 0)
    return { taskCount: 0, mean: 0, lower: minimum, upper: maximum };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (values.length - 1)
      : 0;
  const margin = z * Math.sqrt(variance / values.length);
  return {
    taskCount: values.length,
    mean,
    lower: Math.max(minimum, mean - margin),
    upper: Math.min(maximum, mean + margin),
  };
}

function safeReduction(baseline, candidate) {
  if (baseline === 0) return candidate === 0 ? 0 : -1;
  return (baseline - candidate) / baseline;
}

function groupByTask(results, selector) {
  const groups = new Map();
  for (const result of results) {
    const values = groups.get(result.taskDigest) || [];
    values.push(selector(result));
    groups.set(result.taskDigest, values);
  }
  return new Map(
    [...groups].map(([taskDigest, values]) => [
      taskDigest,
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ]),
  );
}

function variantSummary(results, confidenceZ, seedCount) {
  const sampleCount = results.length;
  const passCount = results.filter((result) => result.pass).length;
  const taskPass = [
    ...groupByTask(results, (result) => (result.pass ? 1 : 0)).values(),
  ];
  const total = (field) =>
    results.reduce((sum, result) => sum + result.metrics[field], 0);
  const violations = (field) =>
    results.reduce((sum, result) => sum + result[field], 0);
  const qualityScore = sampleCount
    ? results.reduce((sum, result) => sum + result.qualityScore, 0) /
      sampleCount
    : 0;
  return deepFreeze({
    taskCount: taskPass.length,
    seedCount,
    sampleCount,
    passCount,
    passRate: sampleCount ? passCount / sampleCount : 0,
    qualityScore,
    confidenceInterval: wilsonInterval(
      taskPass.filter((value) => value === 1).length,
      taskPass.length,
      confidenceZ,
    ),
    errorRate: sampleCount ? total("errors") / sampleCount : 0,
    averageTokens: sampleCount ? total("tokens") / sampleCount : 0,
    averageLatencyMs: sampleCount ? total("latencyMs") / sampleCount : 0,
    averageToolCalls: sampleCount ? total("toolCalls") / sampleCount : 0,
    totalTokens: total("tokens"),
    totalLatencyMs: total("latencyMs"),
    totalToolCalls: total("toolCalls"),
    totalCostMicrounits: total("costMicrounits"),
    securityViolations: violations("securityViolations"),
    permissionViolations: violations("permissionViolations"),
    resultDigest: digest(results, "chainlesschain.evolution-eval-results/v2"),
  });
}

function pairedDeltas(results, selector) {
  const baseline = groupByTask(results.baseline, selector);
  const candidate = groupByTask(results.candidate, selector);
  if (
    baseline.size !== candidate.size ||
    [...baseline.keys()].some((taskDigest) => !candidate.has(taskDigest))
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "paired evaluation results lost a task-level pair",
    );
  }
  return [...baseline].map(
    ([taskDigest, value]) => candidate.get(taskDigest) - value,
  );
}

function comparisonSummary(results, confidenceZ, seedCount) {
  const baseline = variantSummary(results.baseline, confidenceZ, seedCount);
  const candidate = variantSummary(results.candidate, confidenceZ, seedCount);
  const pairedPassDelta = meanInterval(
    pairedDeltas(results, (result) => (result.pass ? 1 : 0)),
    confidenceZ,
  );
  const pairedQualityDelta = meanInterval(
    pairedDeltas(results, (result) => result.qualityScore),
    confidenceZ,
  );
  return deepFreeze({
    baseline,
    candidate,
    pairedPassDelta,
    pairedQualityDelta,
    absoluteImprovement: pairedPassDelta.mean,
    tokenReduction: safeReduction(
      baseline.averageTokens,
      candidate.averageTokens,
    ),
    latencyReduction: safeReduction(
      baseline.averageLatencyMs,
      candidate.averageLatencyMs,
    ),
    toolCallReduction: safeReduction(
      baseline.averageToolCalls,
      candidate.averageToolCalls,
    ),
  });
}

function decideSplit(summary, policy) {
  const { baseline, candidate } = summary;
  if (candidate.securityViolations > 0 || candidate.permissionViolations > 0) {
    return { accepted: false, reason: "safety-hard-gate" };
  }
  if (
    candidate.averageTokens > policy.maxAverageTokens ||
    candidate.averageLatencyMs > policy.maxAverageLatencyMs ||
    candidate.averageToolCalls > policy.maxAverageToolCalls
  ) {
    return { accepted: false, reason: "budget-regression" };
  }
  if (candidate.errorRate > baseline.errorRate) {
    return { accepted: false, reason: "error-rate-regression" };
  }
  const qualityImproved =
    summary.pairedPassDelta.lower >= policy.minimumAbsoluteImprovement &&
    summary.pairedQualityDelta.lower >= 0;
  const efficiencyImproved =
    summary.pairedPassDelta.lower >= 0 &&
    summary.pairedQualityDelta.lower >= 0 &&
    (summary.tokenReduction >= policy.minimumEfficiencyImprovement ||
      summary.latencyReduction >= policy.minimumEfficiencyImprovement ||
      summary.toolCallReduction >= policy.minimumEfficiencyImprovement);
  if (qualityImproved) return { accepted: true, reason: "quality-improvement" };
  if (efficiencyImproved)
    return { accepted: true, reason: "efficiency-improvement" };
  return { accepted: false, reason: "improvement-threshold-not-met" };
}

function makeUsage() {
  return {
    executionCount: 0,
    totalTokens: 0,
    totalLatencyMs: 0,
    totalToolCalls: 0,
    totalCostMicrounits: 0,
  };
}

function remainingHardBudget(usage, policy) {
  return deepFreeze({
    executions: policy.maxExecutions - usage.executionCount,
    tokens: policy.maxTotalTokens - usage.totalTokens,
    latencyMs: policy.maxTotalLatencyMs - usage.totalLatencyMs,
    toolCalls: policy.maxTotalToolCalls - usage.totalToolCalls,
    costMicrounits: policy.maxTotalCostMicrounits - usage.totalCostMicrounits,
  });
}

function consumeUsage(usage, metrics, policy) {
  usage.executionCount += 1;
  usage.totalTokens += metrics.tokens;
  usage.totalLatencyMs += metrics.latencyMs;
  usage.totalToolCalls += metrics.toolCalls;
  usage.totalCostMicrounits += metrics.costMicrounits;
  if (
    usage.executionCount > policy.maxExecutions ||
    usage.totalTokens > policy.maxTotalTokens ||
    usage.totalLatencyMs > policy.maxTotalLatencyMs ||
    usage.totalToolCalls > policy.maxTotalToolCalls ||
    usage.totalCostMicrounits > policy.maxTotalCostMicrounits
  ) {
    throw new EvaluationBudgetExceeded(deepFreeze({ ...usage }));
  }
}

async function awaitWithinLocalDeadline(
  operation,
  localDeadlineMs,
  makeTimeoutError,
) {
  const pending = Promise.resolve(operation);
  // The caller must regain control even if the trusted lower layer never
  // settles. Absorb a later rejection after the watchdog has already won.
  pending.catch(() => {});
  const remainingMs = Math.ceil(localDeadlineMs - NATIVE_MONOTONIC_NOW());
  if (remainingMs <= 0) throw makeTimeoutError();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = NATIVE_SET_TIMEOUT(() => reject(makeTimeoutError()), remainingMs);
    timer?.unref?.();
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) NATIVE_CLEAR_TIMEOUT(timer);
  }
}

async function invokeAtDeadline(
  isolatedTarget,
  payload,
  deadlineAt,
  clock,
  failureCode,
  label,
  supervision,
  monotonicDeadlineMs,
) {
  const targetBinding = getImmutableIsolatedTargetBinding(
    isolatedTarget,
    `${label} isolated target`,
  );
  const target = targetBinding.target;
  const normalizedDeadline = normalizeTimestamp(
    deadlineAt,
    `${label} deadline`,
  );
  const deadlineMs = new Date(normalizedDeadline).getTime();
  const current = readClock(clock);
  if (deadlineMs - current.milliseconds <= 0) {
    throw evalError(
      failureCode,
      `${label} deadline was exhausted before invocation`,
    );
  }
  if (!Number.isFinite(monotonicDeadlineMs)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} monotonic deadline is required`,
    );
  }
  // The signed clock anchor can shorten an operation, but never reset the
  // one-shot monotonic budget captured by the enclosing run/verification.
  const localDeadlineMs = Math.min(
    monotonicDeadlineMs,
    NATIVE_MONOTONIC_NOW() + (deadlineMs - current.milliseconds),
  );
  if (NATIVE_MONOTONIC_NOW() >= localDeadlineMs) {
    throw evalError(
      failureCode,
      `${label} local wall-clock budget is exhausted`,
    );
  }
  const localSettlementDeadlineMs =
    localDeadlineMs + LOCAL_SUPERVISION_SETTLEMENT_GRACE_MS;
  const normalizedPayload = deepFreeze(cloneCanonical(payload));
  const payloadDigest = digest(
    normalizedPayload,
    "chainlesschain.evolution-eval-supervision-payload/v1",
  );
  const targetDigest = targetBinding.targetDigest;
  const targetAuthorityDigest = targetBinding.targetAuthorityDigest;
  const invocationNonce = randomIdentifier("supervision");
  const invocationId = randomIdentifier("target-invocation");
  const capabilityNonce = randomIdentifier("invocation-capability");
  const capabilityDigest = digest(
    {
      capabilityNonce,
      invocationNonce,
      invocationId,
      payloadDigest,
      targetDigest,
      deadlineAt: normalizedDeadline,
    },
    "chainlesschain.evolution-eval-invocation-capability/v1",
  );
  const requestCore = {
    schema: "chainlesschain.evolution-eval-supervision-request/v3",
    operation: target.operation,
    invocationNonce,
    invocationId,
    capabilityDigest,
    requestedAt: current.timestamp,
    deadlineAt: normalizedDeadline,
    payloadDigest,
    targetDigest,
    targetHandlerId: target.handlerId,
    targetRevision: target.handlerRevision,
    targetAuthorityDigest,
  };
  const request = makeRequest(
    requestCore,
    SUPERVISION_REQUEST_CORE_KEYS,
    requestCore.schema,
    "chainlesschain.evolution-eval-supervision/v3",
  );
  assertExactRecord(
    request,
    SUPERVISION_REQUEST_KEYS,
    "deadline supervision request",
  );
  const targetInvocationRequest = deepFreeze({
    schema: "chainlesschain.evolution-eval-target-invocation-request/v2",
    requestDigest: request.requestDigest,
    capabilityDigest,
    invocationId,
    deadlineAt: normalizedDeadline,
    payload: normalizedPayload,
    payloadDigest,
    target,
    targetDigest,
  });
  assertExactRecord(
    targetInvocationRequest,
    TARGET_INVOCATION_REQUEST_KEYS,
    `${label} target invocation request`,
  );
  const state = {
    accepting: true,
    invokeAttempts: 0,
    revokeAttempts: 0,
    invoked: false,
    phase: "idle",
    invocationPromise: null,
    invocationSettled: false,
    rawInvocationSucceeded: false,
    rawInvocationRejected: false,
    pendingSucceededAfterTermination: false,
    terminationLocked: false,
    invocationCompleted: false,
    revoked: false,
    revocationInProgress: false,
    invocationStartedAtMs: null,
    invokedAtMs: null,
    completedAtMs: null,
    revocationRequestedAtMs: null,
    revokedAtMs: null,
    terminatedAtMs: null,
    revocationMode: null,
    wasActive: null,
    activeInvocationTerminated: null,
    resultDigest: null,
    targetInvocationDigest: null,
    revocationDigest: null,
  };

  const validateRevocation = (value, revocationRequest) => {
    const verified = verifySynchronousEvidence({
      record: value,
      keys: TARGET_REVOCATION_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation,
      verifier: supervision.revocationEvidence.verify,
      expectedPolicy: supervision.revocationEvidence.policy,
      label: `${label} target revocation receipt`,
    });
    const core = verified.core;
    const revokedAt = normalizeTimestamp(
      core.revokedAt,
      `${label} target revocation receipt revokedAt`,
    );
    const revokedAtMs = new Date(revokedAt).getTime();
    const checkedAt = readClock(clock);
    let terminatedAtMs = null;
    if (core.terminatedAt !== null) {
      const terminatedAt = normalizeTimestamp(
        core.terminatedAt,
        `${label} target revocation receipt terminatedAt`,
      );
      terminatedAtMs = new Date(terminatedAt).getTime();
    }
    if (
      core.requestDigest !== request.requestDigest ||
      core.capabilityDigest !== capabilityDigest ||
      core.targetDigest !== targetDigest ||
      core.invocationId !== invocationId ||
      core.mode !== revocationRequest.mode ||
      core.requestedAt !== revocationRequest.requestedAt ||
      core.revoked !== true ||
      typeof core.wasActive !== "boolean" ||
      typeof core.activeInvocationTerminated !== "boolean" ||
      revokedAtMs < state.revocationRequestedAtMs ||
      revokedAtMs > deadlineMs ||
      revokedAtMs > checkedAt.milliseconds + CLOCK_SKEW_MS ||
      (revocationRequest.mode === "completed-release" &&
        (state.phase !== "completed" ||
          core.wasActive !== false ||
          core.activeInvocationTerminated !== false ||
          core.terminatedAt !== null ||
          state.completedAtMs === null ||
          revokedAtMs < state.completedAtMs)) ||
      (revocationRequest.mode === "hard-terminate" &&
        (core.wasActive !== true ||
          core.activeInvocationTerminated !== true ||
          terminatedAtMs === null ||
          terminatedAtMs < revokedAtMs ||
          terminatedAtMs > deadlineMs ||
          terminatedAtMs > checkedAt.milliseconds + CLOCK_SKEW_MS))
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        `${label} target revocation was not exact and fail-closed`,
      );
    }
    return deepFreeze({
      revocationDigest: verified.recordDigest,
      revokedAtMs,
      terminatedAtMs,
      wasActive: core.wasActive,
      activeInvocationTerminated: core.activeInvocationTerminated,
    });
  };

  const performRevocation = async (mode) => {
    if (!CAPABILITY_REVOCATION_MODES.includes(mode)) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        `${label} invocation capability revocation mode is invalid`,
      );
    }
    if (
      state.revocationInProgress ||
      (mode === "completed-release" &&
        (!state.invocationCompleted || state.phase !== "completed")) ||
      (mode === "hard-terminate" &&
        (!state.invoked ||
          state.invocationSettled ||
          state.phase !== "invoking" ||
          state.invocationPromise === null))
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        `${label} target cannot be revoked in its current local state`,
      );
    }
    state.revocationInProgress = true;
    if (mode === "hard-terminate") {
      state.terminationLocked = true;
      state.phase = "terminating";
    }
    const revocationRequested = readClock(clock);
    state.revocationRequestedAtMs = revocationRequested.milliseconds;
    const targetRevocationRequest = deepFreeze({
      schema: "chainlesschain.evolution-eval-target-revocation-request/v2",
      requestDigest: request.requestDigest,
      capabilityDigest,
      invocationId,
      mode,
      requestedAt: revocationRequested.timestamp,
      deadlineAt: normalizedDeadline,
      targetDigest,
    });
    assertExactRecord(
      targetRevocationRequest,
      TARGET_REVOCATION_REQUEST_KEYS,
      `${label} target revocation request`,
    );
    const revocation = await awaitWithinLocalDeadline(
      supervision.revokeTarget(targetRevocationRequest),
      localSettlementDeadlineMs,
      () =>
        evalError(
          mode === "hard-terminate"
            ? EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE
            : EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE_CODE,
          mode === "hard-terminate"
            ? `${label} target revocation authority did not settle by the preregistered deadline`
            : `${label} supervisor did not release the completed capability by the preregistered deadline`,
        ),
    );
    const validated = validateRevocation(revocation, targetRevocationRequest);
    state.revoked = true;
    state.revocationMode = mode;
    state.revocationDigest = validated.revocationDigest;
    state.revokedAtMs = validated.revokedAtMs;
    state.terminatedAtMs = validated.terminatedAtMs;
    state.wasActive = validated.wasActive;
    state.activeInvocationTerminated = validated.activeInvocationTerminated;
    if (mode === "hard-terminate") {
      try {
        await awaitWithinLocalDeadline(
          state.invocationPromise,
          localSettlementDeadlineMs,
          () =>
            evalError(
              EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE,
              `${label} target settlement was not confirmed by the preregistered deadline`,
            ),
        );
      } catch (cause) {
        if (
          cause instanceof EvolutionEvalGateError &&
          cause.code === EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE
        ) {
          state.accepting = false;
          throw cause;
        }
        // A hard-terminated target must settle by rejecting. The exact state is
        // checked below after the local invocation promise has converged.
      }
      if (!state.invocationSettled) {
        state.accepting = false;
        throw evalError(
          EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE,
          `${label} target settlement was not confirmed by the preregistered deadline`,
        );
      }
      if (
        !state.rawInvocationRejected ||
        state.rawInvocationSucceeded ||
        state.pendingSucceededAfterTermination
      ) {
        throw evalError(
          EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
          `${label} pending invocation succeeded or did not settle after hard revocation`,
        );
      }
      state.phase = "terminated";
    } else {
      state.phase = "released";
    }
    state.accepting = false;
    state.revocationInProgress = false;
    return deepFreeze({
      revocationDigest: state.revocationDigest,
      revocationMode: state.revocationMode,
      wasActive: state.wasActive,
      activeInvocationTerminated: state.activeInvocationTerminated,
      terminatedAt:
        state.terminatedAtMs === null
          ? null
          : new Date(state.terminatedAtMs).toISOString(),
    });
  };

  const capability = Object.freeze({
    invoke: Object.freeze(async (context) => {
      state.invokeAttempts += 1;
      if (!state.accepting || state.invokeAttempts !== 1 || state.revoked) {
        throw evalError(
          EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
          `${label} invocation capability was replayed or invoked after revocation`,
        );
      }
      state.invoked = true;
      state.phase = "invoking";
      state.invocationStartedAtMs = readClock(clock).milliseconds;
      const invocationPromise = Promise.resolve()
        .then(() => supervision.invokeTarget(targetInvocationRequest, context))
        .then(
          (targetResponse) => {
            state.rawInvocationSucceeded = true;
            assertExactRecord(
              targetResponse,
              TARGET_INVOCATION_RESPONSE_KEYS,
              `${label} target invocation response`,
            );
            const normalizedValue = deepFreeze(
              cloneCanonical(targetResponse.value),
            );
            const resultDigest =
              computeEvolutionEvalSupervisedResultDigest(normalizedValue);
            const verified = verifySynchronousEvidence({
              record: targetResponse.evidence,
              keys: TARGET_INVOCATION_EVIDENCE_KEYS,
              schema: EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
              purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation,
              verifier: supervision.invocationEvidence.verify,
              expectedPolicy: supervision.invocationEvidence.policy,
              label: `${label} target invocation evidence`,
            });
            const evidence = verified.core;
            const invokedAt = normalizeTimestamp(
              evidence.invokedAt,
              `${label} target invocation invokedAt`,
            );
            const completedAt = normalizeTimestamp(
              evidence.completedAt,
              `${label} target invocation completedAt`,
            );
            const invokedAtMs = new Date(invokedAt).getTime();
            const completedAtMs = new Date(completedAt).getTime();
            const observedAt = readClock(clock);
            if (
              evidence.requestDigest !== request.requestDigest ||
              evidence.capabilityDigest !== capabilityDigest ||
              evidence.targetDigest !== targetDigest ||
              evidence.handlerArtifactDigest !== target.handlerArtifactDigest ||
              evidence.targetHandlerId !== target.handlerId ||
              evidence.targetRevision !== target.handlerRevision ||
              evidence.targetAuthorityDigest !== targetAuthorityDigest ||
              evidence.operation !== target.operation ||
              evidence.invocationId !== invocationId ||
              evidence.resultDigest !== resultDigest ||
              invokedAtMs < state.invocationStartedAtMs ||
              completedAtMs < invokedAtMs ||
              completedAtMs >= deadlineMs ||
              completedAtMs > observedAt.milliseconds + CLOCK_SKEW_MS
            ) {
              throw evalError(
                EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
                `${label} independently attested target identity, timeline, or result is invalid`,
              );
            }
            if (state.terminationLocked) {
              state.pendingSucceededAfterTermination = true;
              throw evalError(
                EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
                `${label} target succeeded after hard revocation was locked`,
              );
            }
            state.invocationCompleted = true;
            state.phase = "completed";
            state.invokedAtMs = invokedAtMs;
            state.completedAtMs = completedAtMs;
            state.resultDigest = resultDigest;
            state.targetInvocationDigest = verified.recordDigest;
            return deepFreeze({
              value: normalizedValue,
              resultDigest,
              targetInvocationDigest: verified.recordDigest,
            });
          },
          (cause) => {
            state.rawInvocationRejected = true;
            if (!state.terminationLocked) state.phase = "rejected";
            throw evalError(failureCode, `${label} isolated target failed`, {
              cause,
            });
          },
        )
        .finally(() => {
          state.invocationSettled = true;
        });
      state.invocationPromise = invocationPromise;
      return invocationPromise;
    }),
    revoke: Object.freeze(async (control) => {
      state.revokeAttempts += 1;
      if (!state.accepting || state.revokeAttempts !== 1 || state.revoked) {
        throw evalError(
          EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
          `${label} invocation capability revocation was replayed or late`,
        );
      }
      assertExactRecord(
        control,
        CAPABILITY_REVOCATION_KEYS,
        `${label} invocation capability revocation control`,
      );
      return performRevocation(control.mode);
    }),
  });

  const forceRevoke = async () => {
    state.accepting = false;
    if (state.revoked || state.revocationInProgress) return;
    if (state.invocationCompleted && state.phase === "completed") {
      await performRevocation("completed-release");
    } else if (
      state.invoked &&
      !state.invocationSettled &&
      state.phase === "invoking"
    ) {
      await performRevocation("hard-terminate");
    }
  };
  let response;
  try {
    response = await awaitWithinLocalDeadline(
      supervision.run(request, capability),
      localSettlementDeadlineMs,
      () =>
        state.terminationLocked && !state.invocationSettled
          ? evalError(
              EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE,
              `${label} target settlement was not confirmed by the preregistered deadline`,
            )
          : evalError(
              EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE_CODE,
              `${label} deadline supervisor did not settle by the preregistered deadline`,
            ),
    );
  } catch (cause) {
    state.accepting = false;
    try {
      await forceRevoke();
    } catch (revokeCause) {
      if (
        revokeCause instanceof EvolutionEvalGateError &&
        (revokeCause.code ===
          EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE ||
          revokeCause.code === EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE_CODE)
      ) {
        throw revokeCause;
      }
      throw evalError(
        failureCode,
        `${label} supervisor failed and target revocation did not converge`,
        { cause: revokeCause },
      );
    }
    if (cause instanceof EvolutionEvalGateError) throw cause;
    throw evalError(failureCode, `${label} supervisor failed`, { cause });
  }
  state.accepting = false;
  if (!state.revoked) {
    await forceRevoke();
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} supervisor returned before revoking the one-shot capability`,
    );
  }
  assertExactRecord(response, SUPERVISION_RESPONSE_KEYS, `${label} response`);
  assertExactRecord(
    response.receipt,
    SUPERVISION_RECEIPT_KEYS,
    `${label} deadline enforcement receipt`,
  );
  if (response.receipt.schema !== EVOLUTION_EVAL_SUPERVISION_SCHEMA) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} deadline enforcement schema is invalid`,
    );
  }
  const attestation = normalizeAttestation(
    response.receipt.attestation,
    `${label} deadline enforcement attestation`,
  );
  if (!sameTrust(attestation, supervision.policy.trust)) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} deadline supervisor identity is invalid`,
    );
  }
  const receiptCore = cloneCanonical(response.receipt);
  delete receiptCore.attestation;
  const completedAt = normalizeTimestamp(
    receiptCore.completedAt,
    `${label} deadline enforcement completedAt`,
  );
  const completedAtMs = new Date(completedAt).getTime();
  const requestedAtMs = new Date(request.requestedAt).getTime();
  if (
    receiptCore.requestDigest !== request.requestDigest ||
    receiptCore.invocationNonce !== request.invocationNonce ||
    receiptCore.invocationId !== invocationId ||
    receiptCore.capabilityDigest !== capabilityDigest ||
    receiptCore.operation !== request.operation ||
    receiptCore.requestedAt !== request.requestedAt ||
    receiptCore.deadlineAt !== request.deadlineAt ||
    receiptCore.payloadDigest !== payloadDigest ||
    receiptCore.targetDigest !== targetDigest ||
    receiptCore.targetHandlerId !== target.handlerId ||
    receiptCore.targetRevision !== target.handlerRevision ||
    receiptCore.targetAuthorityDigest !== targetAuthorityDigest ||
    !["completed", "terminated"].includes(receiptCore.status) ||
    receiptCore.isolation !== target.isolation ||
    receiptCore.hardDeadlineEnforced !== true ||
    receiptCore.lateSideEffectsPrevented !== true ||
    receiptCore.invocationCount !== 1 ||
    receiptCore.capabilityRevoked !== true ||
    state.invokeAttempts !== 1 ||
    state.revokeAttempts !== 1 ||
    state.invoked !== true ||
    state.revoked !== true ||
    receiptCore.revocationDigest !== state.revocationDigest ||
    receiptCore.revocationMode !== state.revocationMode ||
    receiptCore.wasActive !== state.wasActive ||
    receiptCore.activeInvocationTerminated !==
      state.activeInvocationTerminated ||
    (receiptCore.terminatedAt === null
      ? state.terminatedAtMs !== null
      : new Date(
          normalizeTimestamp(
            receiptCore.terminatedAt,
            `${label} deadline enforcement terminatedAt`,
          ),
        ).getTime() !== state.terminatedAtMs) ||
    receiptCore.supervisorRevision !== supervision.policy.revision ||
    completedAtMs < requestedAtMs ||
    completedAtMs > deadlineMs ||
    state.revokedAtMs === null ||
    completedAtMs < state.revokedAtMs
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} deadline enforcement evidence is invalid`,
    );
  }
  const enforcementDigest = buildEvolutionEvalAttestationDigest(
    receiptCore,
    EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
  );
  let enforcementVerified;
  try {
    enforcementVerified = supervision.verifyEnforcement(
      deepFreeze({
        purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
        payloadDigest: enforcementDigest,
        attestation,
      }),
    );
  } catch (cause) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} deadline enforcement verifier failed`,
      { cause },
    );
  }
  if (
    enforcementVerified !== true ||
    (enforcementVerified && typeof enforcementVerified.then === "function")
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} deadline enforcement signature was rejected`,
    );
  }
  const enforcementVerifiedAt = readClock(clock);
  if (
    completedAtMs >
    enforcementVerifiedAt.milliseconds + SUPERVISOR_COMPLETION_CLOCK_SKEW_MS
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} deadline enforcement completedAt exceeds trusted clock skew`,
    );
  }
  if (receiptCore.status === "terminated") {
    if (
      response.value !== null ||
      receiptCore.resultDigest !== null ||
      receiptCore.targetInvocationDigest !== null ||
      state.invocationCompleted ||
      state.resultDigest !== null ||
      state.targetInvocationDigest !== null ||
      state.phase !== "terminated" ||
      state.revocationMode !== "hard-terminate" ||
      state.wasActive !== true ||
      state.activeInvocationTerminated !== true ||
      state.terminatedAtMs === null ||
      completedAtMs < state.terminatedAtMs ||
      !state.invocationSettled ||
      !state.rawInvocationRejected ||
      state.rawInvocationSucceeded
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        `${label} terminated supervision returned a value`,
      );
    }
    throw evalError(failureCode, `${label} was hard-terminated at deadline`);
  }
  assertExactRecord(
    response,
    SUPERVISION_RESPONSE_KEYS,
    `${label} completed response`,
  );
  const normalizedResponseValue = deepFreeze(cloneCanonical(response.value));
  const responseResultDigest = computeEvolutionEvalSupervisedResultDigest(
    normalizedResponseValue,
  );
  if (
    !state.invocationCompleted ||
    state.phase !== "released" ||
    state.revocationMode !== "completed-release" ||
    state.wasActive !== false ||
    state.activeInvocationTerminated !== false ||
    state.terminatedAtMs !== null ||
    state.invokedAtMs === null ||
    state.completedAtMs === null ||
    state.invokedAtMs > state.completedAtMs ||
    state.completedAtMs > state.revokedAtMs ||
    completedAtMs >= deadlineMs ||
    receiptCore.resultDigest !== state.resultDigest ||
    receiptCore.targetInvocationDigest !== state.targetInvocationDigest ||
    responseResultDigest !== state.resultDigest
  ) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `${label} supervisor swapped or failed to bind the actual target result`,
    );
  }
  const returnedAt = readClock(clock);
  if (
    returnedAt.milliseconds >= deadlineMs ||
    NATIVE_MONOTONIC_NOW() >= localDeadlineMs
  ) {
    throw evalError(failureCode, `${label} completed after its deadline`);
  }
  return normalizedResponseValue;
}

async function invokeBeforeDeadline(
  fn,
  request,
  clock,
  failureCode,
  label,
  supervision,
  monotonicDeadlineMs,
) {
  return invokeAtDeadline(
    fn,
    request,
    request.deadlineAt,
    clock,
    failureCode,
    label,
    supervision,
    monotonicDeadlineMs,
  );
}

function makeRequest(core, keys, schema, domain) {
  assertExactRecord(core, keys, `${domain} request core`);
  if (core.schema !== schema) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${domain} request schema is invalid`,
    );
  }
  return deepFreeze({
    ...core,
    requestDigest: digest(core, `${domain}/request`),
  });
}

function normalizeMetrics(value) {
  assertExactRecord(value, EXECUTION_METRIC_KEYS, "execution metrics");
  return deepFreeze({
    tokens: normalizeInteger(value.tokens, "execution tokens"),
    latencyMs: normalizeInteger(value.latencyMs, "execution latencyMs"),
    toolCalls: normalizeInteger(value.toolCalls, "execution toolCalls"),
    costMicrounits: normalizeInteger(
      value.costMicrounits,
      "execution costMicrounits",
    ),
    errors: normalizeInteger(value.errors, "execution errors"),
  });
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value) || value.length > 100) {
    throw evalError(EVOLUTION_EVAL_INVALID_CODE, `${label} is invalid`);
  }
  return value.map((entry, index) =>
    normalizeBoundedString(entry, `${label}[${index}]`, 256),
  );
}

function receiptEvidenceCore(core) {
  return {
    policyDigest: core.policyDigest,
    evaluationAuthorityRoot: core.evaluationAuthorityRoot,
    targetEnvironmentRef: core.targetEnvironmentRef,
    evaluationContextDigest: core.evaluationContextDigest,
    suiteAuthorityDigest: core.suiteAuthorityDigest,
    environmentAuthorityDigest: core.environmentAuthorityDigest,
    candidateResolutionDigest: core.candidateResolutionDigest,
    baselineResolutionDigest: core.baselineResolutionDigest,
    trainingPartitionDigest: core.trainingPartitionDigest,
    candidateProvenanceReceiptDigest: core.candidateProvenanceReceiptDigest,
    baselineProvenanceReceiptDigest: core.baselineProvenanceReceiptDigest,
    candidateProvenanceBindingDigest: core.candidateProvenanceBindingDigest,
    baselineProvenanceBindingDigest: core.baselineProvenanceBindingDigest,
    taskHandleReservationDigest: core.taskHandleReservationDigest,
    artifactCapabilityReservationDigest:
      core.artifactCapabilityReservationDigest,
    tenantId: core.tenantId,
    provenanceAudience: core.provenanceAudience,
    trainerAuthority: core.trainerAuthority,
    trainerRevision: core.trainerRevision,
    confidenceZ: core.confidenceZ,
    validationResultDigest: core.validation
      ? digest(core.validation, "chainlesschain.evolution-eval-comparison/v2")
      : null,
    testResultDigest: core.test
      ? digest(core.test, "chainlesschain.evolution-eval-comparison/v2")
      : null,
    usage: core.usage,
  };
}

export function computeEvolutionEvalReceiptDigest(receiptCore) {
  const core = cloneCanonical(receiptCore);
  delete core.receiptDigest;
  delete core.attestation;
  return digest(core, "chainlesschain.evolution-eval-receipt/v4");
}

async function signFinalReceipt({
  core,
  signAttestation,
  verifyAttestation,
  receiptTrust,
  clock,
  deadlineAt,
  supervision,
  monotonicDeadlineMs,
}) {
  const receiptDigest = computeEvolutionEvalReceiptDigest(core);
  const rawAttestation = await invokeAtDeadline(
    signAttestation,
    deepFreeze({
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt,
      payloadDigest: receiptDigest,
    }),
    deadlineAt,
    clock,
    EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
    "eval receipt signer",
    supervision,
    monotonicDeadlineMs,
  );
  const attestation = normalizeAttestation(
    rawAttestation,
    "eval receipt attestation",
  );
  if (!sameTrust(attestation, receiptTrust)) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      "eval receipt signer is not bound to the configured receipt trust",
    );
  }
  const verified = await invokeAtDeadline(
    verifyAttestation,
    deepFreeze({
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt,
      payloadDigest: receiptDigest,
      attestation,
    }),
    deadlineAt,
    clock,
    EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
    "eval receipt signature verifier",
    supervision,
    monotonicDeadlineMs,
  );
  if (verified !== true) {
    throw evalError(
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      "eval receipt signature rejected",
    );
  }
  return deepFreeze({ ...core, receiptDigest, attestation });
}

/**
 * Trusted composition root. Only an attested application loader may construct
 * this class and bind authority descriptors to actual ports; untrusted request
 * or plugin code may only receive the narrow run API around an existing Gate.
 */
export class EvolutionEvalGate {
  #policy;
  #resolveSuite;
  #resolveEnvironment;
  #resolveArtifact;
  #verifyProvenance;
  #issueSubjectHandle;
  #reserveHandles;
  #execute;
  #graders;
  #graderAuthorityPolicies;
  #evaluateSafety;
  #signAttestation;
  #verifyAttestation;
  #receiptTrust;
  #tenantId;
  #provenanceAudience;
  #trainerAuthority;
  #trainerRevision;
  #evaluationAuthorityRoot;
  #observedTaskHandles;
  #observedTaskBindingNonces;
  #authorityPolicies;
  #supervision;
  #clock;

  constructor({
    policy,
    suiteVerifier,
    artifactResolver,
    provenanceVerifier,
    artifactExecutionBroker,
    handleReplayAuthority,
    executor,
    graders,
    graderAuthorityPolicies,
    safetyGate,
    attestationSigner,
    attestationVerifier,
    receiptTrust,
    tenantId,
    provenanceAudience,
    expectedTrainerAuthority,
    expectedTrainerRevision,
    authorityPolicies,
    deadlineSupervisor,
    invocationEvidenceVerifier,
    revocationEvidenceVerifier,
    clock,
  }) {
    this.#policy = verifyEvolutionEvalPolicy(policy);
    this.#authorityPolicies = normalizeAuthorityPolicies(authorityPolicies);
    const supervisorPolicy = this.#authorityPolicies.supervisor;
    const invocationEvidencePolicy = this.#authorityPolicies.invocationEvidence;
    const revocationEvidencePolicy = this.#authorityPolicies.revocationEvidence;
    const evidenceVerifierCallables = validateIndependentEvidenceAuthorities({
      deadlineSupervisor,
      supervisorPolicy,
      invocationEvidenceVerifier,
      invocationEvidencePolicy,
      revocationEvidenceVerifier,
      revocationEvidencePolicy,
      label: "invocation, revocation, and supervisor evidence authorities",
    });
    const capturedClock = captureTrustedClock(
      clock,
      this.#authorityPolicies.clock,
      "trustedClock",
    );
    validateUniqueSensitiveCallables(
      [
        {
          label: "deadlineSupervisor.run",
          callable: evidenceVerifierCallables.supervisorRun,
        },
        {
          label: "deadlineSupervisor.invokeTarget",
          callable: evidenceVerifierCallables.supervisorInvokeTarget,
        },
        {
          label: "deadlineSupervisor.revokeTarget",
          callable: evidenceVerifierCallables.supervisorRevokeTarget,
        },
        {
          label: "deadlineSupervisor.verifyEnforcement",
          callable: evidenceVerifierCallables.supervisorVerifyEnforcement,
        },
        {
          label: "invocationEvidenceVerifier.verify",
          callable: evidenceVerifierCallables.invocationEvidenceVerify,
        },
        {
          label: "revocationEvidenceVerifier.verify",
          callable: evidenceVerifierCallables.revocationEvidenceVerify,
        },
        { label: "trustedClock.now", callable: capturedClock.rawNow },
      ],
      "evaluation authority sensitive callables",
    );
    this.#supervision = Object.freeze({
      run: captureCallable(
        deadlineSupervisor,
        evidenceVerifierCallables.supervisorRun,
      ),
      invokeTarget: captureCallable(
        deadlineSupervisor,
        evidenceVerifierCallables.supervisorInvokeTarget,
      ),
      revokeTarget: captureCallable(
        deadlineSupervisor,
        evidenceVerifierCallables.supervisorRevokeTarget,
      ),
      verifyEnforcement: captureCallable(
        deadlineSupervisor,
        evidenceVerifierCallables.supervisorVerifyEnforcement,
      ),
      invocationEvidence: Object.freeze({
        verify: captureCallable(
          invocationEvidenceVerifier,
          evidenceVerifierCallables.invocationEvidenceVerify,
        ),
        policy: invocationEvidencePolicy,
      }),
      revocationEvidence: Object.freeze({
        verify: captureCallable(
          revocationEvidenceVerifier,
          evidenceVerifierCallables.revocationEvidenceVerify,
        ),
        policy: revocationEvidencePolicy,
      }),
      policy: supervisorPolicy,
      descriptors: Object.freeze({
        supervisor: evidenceVerifierCallables.supervisorDescriptor,
        invocationEvidence:
          evidenceVerifierCallables.invocationEvidenceDescriptor,
        revocationEvidence:
          evidenceVerifierCallables.revocationEvidenceDescriptor,
      }),
    });
    this.#clock = capturedClock.now;
    readClock(this.#clock);
    this.#resolveSuite = captureIsolatedTarget(
      suiteVerifier,
      "resolveSuite",
      "suiteVerifier",
      { expectedPolicy: this.#authorityPolicies.suite },
    );
    this.#resolveEnvironment = captureIsolatedTarget(
      artifactResolver,
      "resolveEnvironment",
      "artifactResolver",
      { expectedPolicy: this.#authorityPolicies.environment },
    );
    this.#resolveArtifact = captureIsolatedTarget(
      artifactResolver,
      "resolveArtifact",
      "artifactResolver",
      { expectedPolicy: this.#authorityPolicies.artifact },
    );
    this.#verifyProvenance = captureIsolatedTarget(
      provenanceVerifier,
      "verifyProvenance",
      "provenanceVerifier",
      { expectedPolicy: this.#authorityPolicies.provenance },
    );
    this.#issueSubjectHandle = captureIsolatedTarget(
      artifactExecutionBroker,
      "issueSubjectHandle",
      "artifactExecutionBroker",
      { expectedPolicy: this.#authorityPolicies.subject },
    );
    this.#reserveHandles = captureIsolatedTarget(
      handleReplayAuthority,
      "reserve",
      "handleReplayAuthority",
      { expectedPolicy: this.#authorityPolicies.replay },
    );
    this.#execute = captureIsolatedTarget(executor, "execute", "executor", {
      expectedPolicy: this.#authorityPolicies.execution,
    });
    if (!(graders instanceof Map) || graders.size === 0) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "trusted grader registry is required",
      );
    }
    this.#graders = new Map();
    if (!(graderAuthorityPolicies instanceof Map)) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "trusted grader authority policy registry is required",
      );
    }
    this.#graderAuthorityPolicies = new Map();
    for (const [graderId, grader] of graders) {
      const normalizedId = normalizeId(graderId, "grader registry id");
      if (!graderAuthorityPolicies.has(graderId)) {
        throw evalError(
          EVOLUTION_EVAL_INVALID_CODE,
          `grader authority policy is unavailable: ${normalizedId}`,
        );
      }
      this.#graderAuthorityPolicies.set(
        normalizedId,
        normalizeAuthorityPolicy(
          graderAuthorityPolicies.get(graderId),
          `graderAuthorityPolicies.${normalizedId}`,
        ),
      );
      this.#graders.set(
        normalizedId,
        captureIsolatedTarget(grader, "grade", `grader ${normalizedId}`, {
          expectedPolicy: this.#graderAuthorityPolicies.get(normalizedId),
        }),
      );
    }
    if (
      graderAuthorityPolicies.size !== this.#graderAuthorityPolicies.size ||
      [...graderAuthorityPolicies.keys()].some(
        (graderId) => !this.#graderAuthorityPolicies.has(graderId),
      )
    ) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "grader authority policies must exactly match the grader registry",
      );
    }
    this.#evaluateSafety = captureIsolatedTarget(
      safetyGate,
      "evaluate",
      "safetyGate",
      { expectedPolicy: this.#authorityPolicies.safety },
    );
    this.#receiptTrust = normalizeTrust(receiptTrust);
    this.#signAttestation = captureIsolatedTarget(
      attestationSigner,
      "sign",
      "attestationSigner",
      { requireHsm: true },
    );
    if (!sameTrust(this.#signAttestation.authority, this.#receiptTrust)) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "attestationSigner target authority differs from receiptTrust",
      );
    }
    this.#verifyAttestation = captureIsolatedTarget(
      attestationVerifier,
      "verify",
      "attestationVerifier",
      { requireHsm: true },
    );
    // Final verification is deliberately declarative: there is no in-process
    // verifier callable that can alias a supervision/evidence/clock closure.
    // Its target and handler-artifact digests are committed below instead.
    if (
      sameTrust(
        this.#verifyAttestation.authority,
        this.#authorityPolicies.supervisor.trust,
      )
    ) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "attestation verifier authority must be independent from the deadline supervisor",
      );
    }
    validateGlobalAuthorityPrincipalMatrix(
      [
        ...[
          ["suite", this.#resolveSuite],
          ["environment", this.#resolveEnvironment],
          ["artifact", this.#resolveArtifact],
          ["provenance", this.#verifyProvenance],
          ["subject", this.#issueSubjectHandle],
          ["replay", this.#reserveHandles],
          ["execution", this.#execute],
          ["safety", this.#evaluateSafety],
        ].map(([role, target]) => ({
          role,
          label: role,
          trust: target.authority,
        })),
        ...[...this.#graders.entries()].map(([graderId, target]) => ({
          role: `grader:${graderId}`,
          label: `grader ${graderId}`,
          trust: target.authority,
        })),
        {
          role: "supervisor",
          label: "deadline supervisor",
          trust: supervisorPolicy.trust,
        },
        {
          role: "invocationEvidence",
          label: "invocation evidence verifier",
          trust: invocationEvidencePolicy.trust,
        },
        {
          role: "revocationEvidence",
          label: "revocation evidence verifier",
          trust: revocationEvidencePolicy.trust,
        },
        {
          role: "clock",
          label: "trusted clock",
          trust: this.#authorityPolicies.clock.trust,
        },
        {
          role: "receiptSigner",
          label: "receipt signer",
          trust: this.#signAttestation.authority,
        },
        {
          role: "receiptVerifier",
          label: "receipt signature verifier",
          trust: this.#verifyAttestation.authority,
        },
      ],
      "evaluation authority matrix",
    );
    this.#evaluationAuthorityRoot = computeEvaluationAuthorityRoot({
      authorityPolicies: this.#authorityPolicies,
      graderAuthorityPolicies: this.#graderAuthorityPolicies,
      targets: {
        suite: this.#resolveSuite,
        environment: this.#resolveEnvironment,
        artifact: this.#resolveArtifact,
        provenance: this.#verifyProvenance,
        subject: this.#issueSubjectHandle,
        replay: this.#reserveHandles,
        execution: this.#execute,
        safety: this.#evaluateSafety,
      },
      graders: this.#graders,
      receiptTrust: this.#receiptTrust,
      receiptSigner: this.#signAttestation,
      attestationVerifier: this.#verifyAttestation,
      supervisionDescriptors: this.#supervision.descriptors,
      clockDescriptor: capturedClock.descriptor,
    });
    this.#tenantId = normalizeId(tenantId, "tenantId", 256);
    this.#provenanceAudience = normalizeId(
      provenanceAudience,
      "provenanceAudience",
      256,
    );
    this.#trainerAuthority = normalizeId(
      expectedTrainerAuthority,
      "expectedTrainerAuthority",
      256,
    );
    this.#trainerRevision = normalizeId(
      expectedTrainerRevision,
      "expectedTrainerRevision",
      256,
    );
    this.#observedTaskHandles = new Set();
    this.#observedTaskBindingNonces = new Set();
    GATE_INSTANCES.add(this);
    Object.freeze(this);
  }

  async #reserveOpaqueHandles({
    runId,
    runNonce,
    deadlineAt,
    deadlineMs,
    kind,
    handles,
    bindingNonces = [],
    runLocalDeadlineMs,
  }) {
    if (!HANDLE_RESERVATION_KINDS.includes(kind)) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "handle reservation kind is invalid",
      );
    }
    if (
      !Array.isArray(handles) ||
      handles.length < 1 ||
      handles.length > 10_000 ||
      !Array.isArray(bindingNonces) ||
      bindingNonces.length > 10_000
    ) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "handle reservation input is invalid",
      );
    }
    const normalizedHandles = handles.map((handle, index) =>
      normalizeDigest(handle, `reservation handles[${index}]`),
    );
    const normalizedNonces = bindingNonces.map((nonce, index) =>
      normalizeId(nonce, `reservation bindingNonces[${index}]`, 256),
    );
    if (
      new Set(normalizedHandles).size !== normalizedHandles.length ||
      new Set(normalizedNonces).size !== normalizedNonces.length
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "handle reservation contains a duplicate",
      );
    }
    const requestCore = {
      schema: "chainlesschain.evolution-eval-handle-reservation-request/v1",
      runId,
      runNonce,
      requestNonce: randomIdentifier("handle-reservation"),
      requestedAt: readClock(this.#clock).timestamp,
      deadlineAt,
      kind,
      handles: normalizedHandles,
      bindingNonces: normalizedNonces,
      policyDigest: this.#policy.policyDigest,
    };
    const request = makeRequest(
      requestCore,
      REPLAY_REQUEST_CORE_KEYS,
      requestCore.schema,
      "chainlesschain.evolution-eval-handle-reservation/v1",
    );
    assertExactRecord(
      request,
      REPLAY_REQUEST_KEYS,
      "handle reservation request",
    );
    const response = await invokeBeforeDeadline(
      this.#reserveHandles,
      request,
      this.#clock,
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      `durable ${kind} handle reservation`,
      this.#supervision,
      runLocalDeadlineMs,
    );
    const verified = await verifyAttestedCore({
      record: response,
      keys: REPLAY_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_REPLAY_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.replay,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt,
      expectedTrust: this.#authorityPolicies.replay.trust,
      expectedRevision: this.#authorityPolicies.replay.revision,
      revisionField: "authorityRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: runLocalDeadlineMs,
      label: `${kind} handle reservation receipt`,
    });
    const now = readClock(this.#clock);
    assertFreshBinding({
      core: verified.core,
      expectedNonce: request.requestNonce,
      expectedRequestedAt: request.requestedAt,
      expectedDeadlineMs: deadlineMs,
      maximumTtlMs: this.#policy.portReceiptTtlMs,
      nowMs: now.milliseconds,
      label: `${kind} handle reservation receipt`,
    });
    const handlesDigest = computeEvolutionEvalHandleReservationSetDigest({
      handles: normalizedHandles,
      bindingNonces: normalizedNonces,
    });
    if (
      verified.core.requestDigest !== request.requestDigest ||
      verified.core.runId !== runId ||
      verified.core.runNonce !== runNonce ||
      verified.core.kind !== kind ||
      verified.core.handlesDigest !== handlesDigest ||
      verified.core.durable !== true ||
      verified.core.globallyUnique !== true
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "durable handle reservation binding is invalid",
      );
    }
    normalizeId(verified.core.reservationId, "handle reservationId", 256);
    return {
      receiptDigest: verified.recordDigest,
      expiresAt: verified.core.expiresAt,
    };
  }

  async #verifySuiteResponse(
    response,
    request,
    deadlineMs,
    namespaces,
    runLocalDeadlineMs,
  ) {
    preflightCanonicalStructure(response);
    assertExactRecord(
      response,
      SUITE_RESPONSE_KEYS,
      "suite authority response",
    );
    const suite = verifyEvolutionEvalSuite(response.suite);
    if (
      !Array.isArray(response.taskBindings) ||
      response.taskBindings.length !== suite.tasks.length
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "suite authority must issue exactly one opaque handle per task",
      );
    }
    const taskBindings = response.taskBindings.map((binding, index) => {
      assertExactRecord(
        binding,
        TASK_BINDING_KEYS,
        `suite task binding[${index}]`,
      );
      const bindingCore = {
        taskDigest: normalizeDigest(
          binding.taskDigest,
          `suite task binding[${index}].taskDigest`,
        ),
        opaqueTaskHandle: normalizeDigest(
          binding.opaqueTaskHandle,
          `suite task binding[${index}].opaqueTaskHandle`,
        ),
        executionProjection: normalizeExecutionProjection(
          binding.executionProjection,
          `suite task binding[${index}].executionProjection`,
        ),
        runId: normalizeId(
          binding.runId,
          `suite task binding[${index}].runId`,
          256,
        ),
        runNonce: normalizeId(
          binding.runNonce,
          `suite task binding[${index}].runNonce`,
          256,
        ),
        bindingNonce: normalizeId(
          binding.bindingNonce,
          `suite task binding[${index}].bindingNonce`,
          256,
        ),
        singleRun: binding.singleRun,
        unlinkable: binding.unlinkable,
        splitBlind: binding.splitBlind,
      };
      const randomnessCommitment = normalizeDigest(
        binding.randomnessCommitment,
        `suite task binding[${index}].randomnessCommitment`,
      );
      if (
        bindingCore.runId !== request.runId ||
        bindingCore.runNonce !== request.runNonce ||
        !TASK_BINDING_NONCE_PATTERN.test(bindingCore.bindingNonce) ||
        bindingCore.singleRun !== true ||
        bindingCore.unlinkable !== true ||
        bindingCore.splitBlind !== true ||
        randomnessCommitment !==
          computeEvolutionEvalTaskBindingRandomnessCommitment(bindingCore)
      ) {
        throw evalError(
          EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
          "suite authority task binding is not fresh, single-run, and split-blind",
        );
      }
      return deepFreeze({ ...bindingCore, randomnessCommitment });
    });
    const taskDigests = new Set(
      taskBindings.map((binding) => binding.taskDigest),
    );
    const opaqueTaskHandles = new Set(
      taskBindings.map((binding) => binding.opaqueTaskHandle),
    );
    const bindingNonces = new Set(
      taskBindings.map((binding) => binding.bindingNonce),
    );
    const suiteTasksByDigest = new Map(
      suite.tasks.map((task) => [task.taskDigest, task]),
    );
    if (
      taskDigests.size !== suite.tasks.length ||
      opaqueTaskHandles.size !== suite.tasks.length ||
      bindingNonces.size !== suite.tasks.length ||
      suite.tasks.some((task) => !taskDigests.has(task.taskDigest)) ||
      taskBindings.some(
        (binding) =>
          binding.opaqueTaskHandle === binding.taskDigest ||
          binding.opaqueTaskHandle === binding.randomnessCommitment ||
          binding.opaqueTaskHandle ===
            executionProjectionDigest(binding.executionProjection) ||
          executionProjectionDigest(binding.executionProjection) !==
            executionProjectionDigest({
              taskType: suiteTasksByDigest.get(binding.taskDigest)?.taskType,
              publicInput: suiteTasksByDigest.get(binding.taskDigest)
                ?.publicInput,
            }),
      )
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "suite authority task bindings are incomplete or ambiguous",
      );
    }
    const verified = await verifyAttestedCore({
      record: response.receipt,
      keys: SUITE_AUTHORITY_KEYS,
      schema: EVOLUTION_EVAL_SUITE_AUTHORITY_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.suite,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt: request.deadlineAt,
      expectedTrust: this.#authorityPolicies.suite.trust,
      expectedRevision: this.#authorityPolicies.suite.revision,
      revisionField: "authorityRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: runLocalDeadlineMs,
      label: "suite authority receipt",
    });
    const now = readClock(this.#clock);
    assertFreshBinding({
      core: verified.core,
      expectedNonce: request.requestNonce,
      expectedRequestedAt: request.requestedAt,
      expectedDeadlineMs: deadlineMs,
      maximumTtlMs: this.#policy.portReceiptTtlMs,
      nowMs: now.milliseconds,
      label: "suite authority receipt",
    });
    if (
      verified.core.runId !== request.runId ||
      verified.core.runNonce !== request.runNonce ||
      verified.core.suiteRef !== request.suiteRef ||
      verified.core.suiteDigest !== suite.suiteDigest ||
      verified.core.taskBindingsDigest !==
        computeEvolutionEvalTaskBindingsDigest(taskBindings) ||
      verified.core.policyDigest !== this.#policy.policyDigest
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "suite authority receipt binding is invalid",
      );
    }
    normalizeId(
      verified.core.authorityRevision,
      "suite authority revision",
      256,
    );
    namespaces.register("suite.identity", suite.suiteDigest, "suiteDigest");
    namespaces.register(
      "receipt.suite-authority",
      verified.recordDigest,
      "suiteAuthorityDigest",
    );
    for (const binding of taskBindings) {
      namespaces.register("task.identity", binding.taskDigest, "taskDigest");
      namespaces.register(
        "task.execution-projection",
        executionProjectionDigest(binding.executionProjection),
        "executionProjectionDigest",
      );
      namespaces.register(
        "task.randomness-commitment",
        binding.randomnessCommitment,
        "taskBindingRandomnessCommitment",
      );
      namespaces.register(
        "handle.task",
        binding.opaqueTaskHandle,
        "opaqueTaskHandle",
      );
    }
    const handleReservation = await this.#reserveOpaqueHandles({
      runId: request.runId,
      runNonce: request.runNonce,
      deadlineAt: request.deadlineAt,
      deadlineMs,
      kind: "task",
      handles: taskBindings.map((binding) => binding.opaqueTaskHandle),
      bindingNonces: taskBindings.map((binding) => binding.bindingNonce),
      runLocalDeadlineMs,
    });
    if (
      taskBindings.some(
        (binding) =>
          this.#observedTaskHandles.has(binding.opaqueTaskHandle) ||
          this.#observedTaskBindingNonces.has(binding.bindingNonce),
      )
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "suite authority reused a supposedly single-run task binding",
      );
    }
    for (const binding of taskBindings) {
      this.#observedTaskHandles.add(binding.opaqueTaskHandle);
      this.#observedTaskBindingNonces.add(binding.bindingNonce);
    }
    return {
      suite,
      taskHandles: new Map(
        taskBindings.map((binding) => [
          binding.taskDigest,
          deepFreeze({
            opaqueTaskHandle: binding.opaqueTaskHandle,
            executionProjection: binding.executionProjection,
            executionProjectionDigest: executionProjectionDigest(
              binding.executionProjection,
            ),
            randomnessCommitment: binding.randomnessCommitment,
          }),
        ]),
      ),
      receiptDigest: verified.recordDigest,
      expiresAt: verified.core.expiresAt,
      handleReservationDigest: handleReservation.receiptDigest,
      handleReservationExpiresAt: handleReservation.expiresAt,
    };
  }

  async #verifyEnvironmentResponse(
    response,
    request,
    deadlineMs,
    runLocalDeadlineMs,
  ) {
    assertExactRecord(
      response,
      ENVIRONMENT_RESPONSE_KEYS,
      "environment resolver response",
    );
    const environment = deepFreeze(cloneCanonical(response.environment));
    const environmentDigest =
      computeEvolutionEvalEnvironmentDigest(environment);
    const verified = await verifyAttestedCore({
      record: response.receipt,
      keys: ENVIRONMENT_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_ENVIRONMENT_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.environment,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt: request.deadlineAt,
      expectedTrust: this.#authorityPolicies.environment.trust,
      expectedRevision: this.#authorityPolicies.environment.revision,
      revisionField: "resolverRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: runLocalDeadlineMs,
      label: "environment resolver receipt",
    });
    const now = readClock(this.#clock);
    assertFreshBinding({
      core: verified.core,
      expectedNonce: request.requestNonce,
      expectedRequestedAt: request.requestedAt,
      expectedDeadlineMs: deadlineMs,
      maximumTtlMs: this.#policy.portReceiptTtlMs,
      nowMs: now.milliseconds,
      label: "environment resolver receipt",
    });
    if (
      verified.core.runId !== request.runId ||
      verified.core.runNonce !== request.runNonce ||
      verified.core.targetEnvironmentRef !== request.targetEnvironmentRef ||
      verified.core.environmentDigest !== environmentDigest ||
      verified.core.policyDigest !== this.#policy.policyDigest
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "environment resolver receipt binding is invalid",
      );
    }
    normalizeId(
      verified.core.resolverRevision,
      "environment resolver revision",
      256,
    );
    return {
      environment,
      environmentDigest,
      receiptDigest: verified.recordDigest,
      expiresAt: verified.core.expiresAt,
    };
  }

  async #verifyArtifactResponse(
    response,
    request,
    deadlineMs,
    runLocalDeadlineMs,
  ) {
    assertExactRecord(
      response,
      ARTIFACT_RESPONSE_KEYS,
      "artifact resolver response",
    );
    const verified = await verifyAttestedCore({
      record: response.receipt,
      keys: ARTIFACT_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_ARTIFACT_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.artifact,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt: request.deadlineAt,
      expectedTrust: this.#authorityPolicies.artifact.trust,
      expectedRevision: this.#authorityPolicies.artifact.revision,
      revisionField: "resolverRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: runLocalDeadlineMs,
      label: "artifact resolution receipt",
    });
    const now = readClock(this.#clock);
    assertFreshBinding({
      core: verified.core,
      expectedNonce: request.requestNonce,
      expectedRequestedAt: request.requestedAt,
      expectedDeadlineMs: deadlineMs,
      maximumTtlMs: this.#policy.portReceiptTtlMs,
      nowMs: now.milliseconds,
      label: "artifact resolution receipt",
    });
    if (
      verified.core.runId !== request.runId ||
      verified.core.runNonce !== request.runNonce ||
      verified.core.role !== request.role ||
      verified.core.artifactId !== request.artifactId ||
      verified.core.artifactDigest !== request.artifactId ||
      verified.core.immutable !== true ||
      verified.core.suiteAuthorityDigest !== request.suiteAuthorityDigest ||
      verified.core.trainingPartitionDigest !==
        request.trainingPartitionDigest ||
      verified.core.holdoutIsolated !== true ||
      verified.core.environmentDigest !== request.environmentDigest ||
      verified.core.policyDigest !== this.#policy.policyDigest
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "artifact resolution receipt binding is invalid",
      );
    }
    normalizeId(
      verified.core.resolverRevision,
      "artifact resolver revision",
      256,
    );
    normalizeDigest(
      verified.core.provenanceReceiptDigest,
      "artifact provenanceReceiptDigest",
    );
    const opaqueArtifactCapability = normalizeDigest(
      verified.core.opaqueArtifactCapability,
      "artifact opaqueArtifactCapability",
    );
    if (
      verified.core.capabilitySingleRun !== true ||
      verified.core.capabilityUnlinkable !== true ||
      opaqueArtifactCapability === request.artifactId
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "artifact resolver returned a linkable execution capability",
      );
    }
    return {
      receiptDigest: verified.recordDigest,
      provenanceReceiptDigest: verified.core.provenanceReceiptDigest,
      opaqueArtifactCapability,
      expiresAt: verified.core.expiresAt,
    };
  }

  async #verifyArtifactProvenance({
    runId,
    runNonce,
    deadlineAt,
    deadlineMs,
    role,
    artifactDigest,
    suiteAuthorityDigest,
    trainingPartitionDigest,
    provenanceReceiptDigest,
    runLocalDeadlineMs,
  }) {
    const requestCore = {
      schema: "chainlesschain.evolution-eval-provenance-request/v1",
      requestNonce: randomIdentifier("provenance"),
      requestedAt: readClock(this.#clock).timestamp,
      deadlineAt,
      runId,
      runNonce,
      role,
      artifactDigest,
      suiteAuthorityDigest,
      trainingPartitionDigest,
      provenanceReceiptDigest,
      tenantId: this.#tenantId,
      audience: this.#provenanceAudience,
      expectedTrainerAuthority: this.#trainerAuthority,
      expectedTrainerRevision: this.#trainerRevision,
      policyDigest: this.#policy.policyDigest,
    };
    const request = deepFreeze({
      ...requestCore,
      requestDigest: digest(
        requestCore,
        "chainlesschain.evolution-eval-provenance/request/v1",
      ),
    });
    const response = await invokeBeforeDeadline(
      this.#verifyProvenance,
      request,
      this.#clock,
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      "provenance authority",
      this.#supervision,
      runLocalDeadlineMs,
    );
    const verified = await verifyAttestedCore({
      record: response,
      keys: PROVENANCE_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_PROVENANCE_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.provenance,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt: request.deadlineAt,
      expectedTrust: this.#authorityPolicies.provenance.trust,
      expectedRevision: this.#authorityPolicies.provenance.revision,
      revisionField: "verifierRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: runLocalDeadlineMs,
      label: "provenance binding receipt",
    });
    const now = readClock(this.#clock);
    assertFreshBinding({
      core: verified.core,
      expectedNonce: request.requestNonce,
      expectedRequestedAt: request.requestedAt,
      expectedDeadlineMs: deadlineMs,
      maximumTtlMs: this.#policy.portReceiptTtlMs,
      nowMs: now.milliseconds,
      label: "provenance binding receipt",
    });
    const core = verified.core;
    if (
      core.requestDigest !== request.requestDigest ||
      core.runId !== runId ||
      core.runNonce !== runNonce ||
      core.role !== role ||
      core.artifactDigest !== artifactDigest ||
      core.suiteAuthorityDigest !== suiteAuthorityDigest ||
      core.trainingPartitionDigest !== trainingPartitionDigest ||
      core.provenanceReceiptDigest !== provenanceReceiptDigest ||
      core.holdoutIsolated !== true ||
      core.revocationStatus !== "current" ||
      core.tenantId !== this.#tenantId ||
      core.audience !== this.#provenanceAudience ||
      core.trainerAuthority !== this.#trainerAuthority ||
      core.trainerRevision !== this.#trainerRevision ||
      core.policyDigest !== this.#policy.policyDigest
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "provenance binding is stale, revoked, or not bound to this artifact and training partition",
      );
    }
    normalizeId(core.trainerAuthority, "trainerAuthority", 256);
    normalizeId(core.trainerRevision, "trainerRevision", 256);
    normalizeId(core.verifierRevision, "provenance verifierRevision", 256);
    return {
      bindingDigest: verified.recordDigest,
      trainerAuthority: core.trainerAuthority,
      trainerRevision: core.trainerRevision,
      expiresAt: core.expiresAt,
    };
  }

  async #issueBlindedSubject({
    run,
    opaqueArtifactCapability,
    opaqueSubjectHandles,
  }) {
    const requestCore = {
      schema: "chainlesschain.evolution-eval-subject-request/v1",
      requestNonce: randomIdentifier("subject"),
      requestedAt: readClock(this.#clock).timestamp,
      deadlineAt: run.deadlineAt,
      runId: run.runId,
      runNonce: run.runNonce,
      opaqueArtifactCapability,
      environmentDigest: run.environmentDigest,
      policyDigest: this.#policy.policyDigest,
    };
    const request = deepFreeze({
      ...requestCore,
      requestDigest: digest(
        requestCore,
        "chainlesschain.evolution-eval-subject/request/v1",
      ),
    });
    const response = await invokeBeforeDeadline(
      this.#issueSubjectHandle,
      request,
      this.#clock,
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      "artifact execution broker",
      this.#supervision,
      run.runLocalDeadlineMs,
    );
    const verified = await verifyAttestedCore({
      record: response,
      keys: SUBJECT_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_SUBJECT_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.subject,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt: request.deadlineAt,
      expectedTrust: this.#authorityPolicies.subject.trust,
      expectedRevision: this.#authorityPolicies.subject.revision,
      revisionField: "brokerRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: run.runLocalDeadlineMs,
      label: "subject handle receipt",
    });
    const now = readClock(this.#clock);
    assertFreshBinding({
      core: verified.core,
      expectedNonce: request.requestNonce,
      expectedRequestedAt: request.requestedAt,
      expectedDeadlineMs: run.deadlineMs,
      maximumTtlMs: this.#policy.portReceiptTtlMs,
      nowMs: now.milliseconds,
      label: "subject handle receipt",
    });
    const core = verified.core;
    const opaqueSubjectHandle = normalizeDigest(
      core.opaqueSubjectHandle,
      "opaqueSubjectHandle",
    );
    run.namespaces.register(
      "handle.subject",
      opaqueSubjectHandle,
      "opaqueSubjectHandle",
    );
    if (
      core.requestDigest !== request.requestDigest ||
      core.runId !== run.runId ||
      core.runNonce !== run.runNonce ||
      core.opaqueArtifactCapability !== opaqueArtifactCapability ||
      core.environmentDigest !== run.environmentDigest ||
      core.policyDigest !== this.#policy.policyDigest ||
      core.singleUse !== true ||
      core.unlinkable !== true ||
      opaqueSubjectHandle === opaqueArtifactCapability ||
      opaqueSubjectHandle === run.candidateId ||
      opaqueSubjectHandle === run.baselineId ||
      opaqueSubjectHandles.has(opaqueSubjectHandle) ||
      run.suite.tasks.some(
        (task) =>
          task.taskDigest === opaqueSubjectHandle ||
          executionProjectionDigest({
            taskType: task.taskType,
            publicInput: task.publicInput,
          }) === opaqueSubjectHandle,
      ) ||
      [...run.taskHandles.values()].some(
        (binding) => binding.opaqueTaskHandle === opaqueSubjectHandle,
      )
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "artifact execution broker returned a linkable or replayed subject handle",
      );
    }
    const handleReservation = await this.#reserveOpaqueHandles({
      runId: run.runId,
      runNonce: run.runNonce,
      deadlineAt: run.deadlineAt,
      deadlineMs: run.deadlineMs,
      kind: "subject",
      handles: [opaqueSubjectHandle],
      bindingNonces: [request.requestNonce],
      runLocalDeadlineMs: run.runLocalDeadlineMs,
    });
    normalizeId(core.brokerRevision, "artifact brokerRevision", 256);
    opaqueSubjectHandles.add(opaqueSubjectHandle);
    run.namespaces.register(
      "receipt.subject-binding",
      verified.recordDigest,
      "subjectBindingDigest",
    );
    run.namespaces.register(
      "receipt.subject-handle-reservation",
      handleReservation.receiptDigest,
      "subjectReservationDigest",
    );
    return {
      opaqueSubjectHandle,
      bindingDigest: verified.recordDigest,
      reservationDigest: handleReservation.receiptDigest,
    };
  }

  async #executeOne({
    run,
    task,
    seed,
    role,
    usage,
    sandboxInstances,
    opaqueSubjectHandles,
  }) {
    const hardBudget = remainingHardBudget(usage, this.#policy);
    if (
      hardBudget.executions <= 0 ||
      hardBudget.tokens <= 0 ||
      hardBudget.latencyMs <= 0
    ) {
      throw new EvaluationBudgetExceeded(deepFreeze({ ...usage }));
    }
    const artifact = run.artifacts[role];
    const subject = await this.#issueBlindedSubject({
      run,
      opaqueArtifactCapability: artifact.opaqueArtifactCapability,
      opaqueSubjectHandles,
    });
    const taskBinding = run.taskHandles.get(task.taskDigest);
    const requestCore = {
      schema: "chainlesschain.evolution-eval-execution-request/v1",
      runId: run.runId,
      runNonce: run.runNonce,
      requestNonce: randomIdentifier("exec"),
      requestedAt: readClock(this.#clock).timestamp,
      deadlineAt: run.deadlineAt,
      taskHandle: taskBinding.opaqueTaskHandle,
      opaqueSubjectHandle: subject.opaqueSubjectHandle,
      executionProjection: taskBinding.executionProjection,
      remainingHardBudget: hardBudget,
      seed,
      policyDigest: this.#policy.policyDigest,
      environmentDigest: run.environmentDigest,
    };
    const request = makeRequest(
      requestCore,
      EXECUTION_REQUEST_CORE_KEYS,
      requestCore.schema,
      "chainlesschain.evolution-eval-execution/v1",
    );
    assertExactRecord(request, EXECUTION_REQUEST_KEYS, "execution request");
    const raw = await invokeBeforeDeadline(
      this.#execute,
      request,
      this.#clock,
      EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
      "trusted evaluation executor",
      this.#supervision,
      run.runLocalDeadlineMs,
    );
    const verified = await verifyAttestedCore({
      record: raw,
      keys: EXECUTION_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_EXECUTION_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.execution,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt: request.deadlineAt,
      expectedTrust: this.#authorityPolicies.execution.trust,
      expectedRevision: this.#authorityPolicies.execution.revision,
      revisionField: "executorRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: run.runLocalDeadlineMs,
      label: "execution receipt",
    });
    const core = verified.core;
    const now = readClock(this.#clock);
    assertIssuedReceiptWindow(
      core,
      request,
      now.milliseconds,
      this.#policy.portReceiptTtlMs,
      "execution receipt",
    );
    if (
      core.requestDigest !== request.requestDigest ||
      core.requestNonce !== request.requestNonce ||
      core.runId !== run.runId ||
      core.taskHandle !== request.taskHandle ||
      core.opaqueSubjectHandle !== subject.opaqueSubjectHandle ||
      executionProjectionDigest(
        normalizeExecutionProjection(
          core.executionProjection,
          "execution receipt executionProjection",
        ),
      ) !== executionProjectionDigest(taskBinding.executionProjection) ||
      core.policyDigest !== this.#policy.policyDigest ||
      core.environmentDigest !== run.environmentDigest ||
      core.status !== "completed" ||
      core.sandboxFresh !== true
    ) {
      throw evalError(
        EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
        "execution receipt is not completely bound to its request",
      );
    }
    assertExactRecord(
      core.enforcedLimits,
      HARD_BUDGET_KEYS,
      "execution enforcedLimits",
    );
    for (const key of HARD_BUDGET_KEYS) {
      normalizeInteger(
        core.enforcedLimits[key],
        `execution enforcedLimits.${key}`,
      );
      if (core.enforcedLimits[key] !== hardBudget[key]) {
        throw evalError(
          EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
          "executor did not enforce the exact remaining hard budget",
        );
      }
    }
    const outputArtifact = deepFreeze(cloneCanonical(core.artifact));
    const outputArtifactDigest =
      computeEvolutionEvalOutputArtifactDigest(outputArtifact);
    if (core.outputArtifactDigest !== outputArtifactDigest) {
      throw evalError(
        EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
        "execution output artifact digest is invalid",
      );
    }
    const sandboxInstanceId = normalizeId(
      core.sandboxInstanceId,
      "sandboxInstanceId",
      256,
    );
    if (sandboxInstances.has(sandboxInstanceId)) {
      throw evalError(
        EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
        "executor reused a sandbox instance across blinded runs",
      );
    }
    sandboxInstances.add(sandboxInstanceId);
    normalizeId(core.executorRevision, "executorRevision", 256);
    const metrics = normalizeMetrics(core.metrics);
    for (const key of HARD_BUDGET_KEYS) {
      const consumed = key === "executions" ? 1 : metrics[key];
      if (consumed > hardBudget[key]) {
        throw evalError(
          EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
          "executor exceeded an attested hard budget",
        );
      }
    }
    consumeUsage(usage, metrics, this.#policy);
    run.namespaces.register(
      "artifact.output",
      outputArtifactDigest,
      "outputArtifactDigest",
    );
    run.namespaces.register(
      "receipt.execution",
      verified.recordDigest,
      "executionDigest",
    );
    return {
      artifact: outputArtifact,
      outputArtifactDigest,
      metrics,
      sandboxInstanceId,
      subjectBindingDigest: subject.bindingDigest,
      subjectReservationDigest: subject.reservationDigest,
      executionDigest: verified.recordDigest,
    };
  }

  async #gradeOne({ run, task, seed, execution }) {
    const grader = this.#graders.get(task.graderId);
    if (!grader) {
      throw evalError(
        EVOLUTION_EVAL_GRADER_FAILED_CODE,
        `trusted grader is unavailable: ${task.graderId}`,
      );
    }
    const requestCore = {
      schema: "chainlesschain.evolution-eval-grade-request/v1",
      runId: run.runId,
      runNonce: run.runNonce,
      requestNonce: randomIdentifier("grade"),
      requestedAt: readClock(this.#clock).timestamp,
      deadlineAt: run.deadlineAt,
      taskDigest: task.taskDigest,
      taskType: task.taskType,
      graderId: task.graderId,
      privateExpected: cloneCanonical(task.privateExpected),
      artifact: execution.artifact,
      outputArtifactDigest: execution.outputArtifactDigest,
      executionDigest: execution.executionDigest,
      seed,
      suiteDigest: run.suite.suiteDigest,
      policyDigest: this.#policy.policyDigest,
      environmentDigest: run.environmentDigest,
    };
    const request = makeRequest(
      requestCore,
      GRADE_REQUEST_CORE_KEYS,
      requestCore.schema,
      "chainlesschain.evolution-eval-grade/v1",
    );
    assertExactRecord(request, GRADE_REQUEST_KEYS, "grade request");
    const raw = await invokeBeforeDeadline(
      grader,
      request,
      this.#clock,
      EVOLUTION_EVAL_GRADER_FAILED_CODE,
      `trusted grader ${task.graderId}`,
      this.#supervision,
      run.runLocalDeadlineMs,
    );
    const verified = await verifyAttestedCore({
      record: raw,
      keys: GRADE_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_GRADE_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.grade,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt: request.deadlineAt,
      expectedTrust: this.#graderAuthorityPolicies.get(task.graderId).trust,
      expectedRevision: this.#graderAuthorityPolicies.get(task.graderId)
        .revision,
      revisionField: "graderRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: run.runLocalDeadlineMs,
      label: "grader receipt",
    });
    const core = verified.core;
    const now = readClock(this.#clock);
    assertIssuedReceiptWindow(
      core,
      request,
      now.milliseconds,
      this.#policy.portReceiptTtlMs,
      "grader receipt",
    );
    if (
      core.requestDigest !== request.requestDigest ||
      core.requestNonce !== request.requestNonce ||
      core.runId !== run.runId ||
      core.taskDigest !== task.taskDigest ||
      core.executionDigest !== execution.executionDigest ||
      typeof core.pass !== "boolean"
    ) {
      throw evalError(
        EVOLUTION_EVAL_GRADER_FAILED_CODE,
        "grader receipt is not completely bound to its request",
      );
    }
    normalizeId(core.graderRevision, "graderRevision", 256);
    run.namespaces.register(
      "receipt.grade",
      verified.recordDigest,
      "gradeDigest",
    );
    return {
      pass: core.pass,
      qualityScore: normalizeRatio(core.qualityScore, "grader qualityScore"),
      detail:
        core.detail === ""
          ? ""
          : normalizeBoundedString(core.detail, "grader detail", 1024),
      gradeDigest: verified.recordDigest,
    };
  }

  async #safetyOne({ run, task, execution }) {
    const requestCore = {
      schema: "chainlesschain.evolution-eval-safety-request/v1",
      runId: run.runId,
      runNonce: run.runNonce,
      requestNonce: randomIdentifier("safety"),
      requestedAt: readClock(this.#clock).timestamp,
      deadlineAt: run.deadlineAt,
      taskDigest: task.taskDigest,
      artifact: execution.artifact,
      outputArtifactDigest: execution.outputArtifactDigest,
      executionDigest: execution.executionDigest,
      sandboxInstanceId: execution.sandboxInstanceId,
      suiteDigest: run.suite.suiteDigest,
      policyDigest: this.#policy.policyDigest,
      environmentDigest: run.environmentDigest,
    };
    const request = makeRequest(
      requestCore,
      SAFETY_REQUEST_CORE_KEYS,
      requestCore.schema,
      "chainlesschain.evolution-eval-safety/v1",
    );
    assertExactRecord(request, SAFETY_REQUEST_KEYS, "safety request");
    const raw = await invokeBeforeDeadline(
      this.#evaluateSafety,
      request,
      this.#clock,
      EVOLUTION_EVAL_SAFETY_FAILED_CODE,
      "independent safety gate",
      this.#supervision,
      run.runLocalDeadlineMs,
    );
    const verified = await verifyAttestedCore({
      record: raw,
      keys: SAFETY_RECEIPT_KEYS,
      schema: EVOLUTION_EVAL_SAFETY_SCHEMA,
      purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.safety,
      verifyAttestation: this.#verifyAttestation,
      clock: this.#clock,
      deadlineAt: request.deadlineAt,
      expectedTrust: this.#authorityPolicies.safety.trust,
      expectedRevision: this.#authorityPolicies.safety.revision,
      revisionField: "safetyRevision",
      supervision: this.#supervision,
      monotonicDeadlineMs: run.runLocalDeadlineMs,
      label: "safety receipt",
    });
    const core = verified.core;
    const now = readClock(this.#clock);
    assertIssuedReceiptWindow(
      core,
      request,
      now.milliseconds,
      this.#policy.portReceiptTtlMs,
      "safety receipt",
    );
    if (
      core.requestDigest !== request.requestDigest ||
      core.requestNonce !== request.requestNonce ||
      core.runId !== run.runId ||
      core.taskDigest !== task.taskDigest ||
      core.executionDigest !== execution.executionDigest ||
      typeof core.safe !== "boolean"
    ) {
      throw evalError(
        EVOLUTION_EVAL_SAFETY_FAILED_CODE,
        "safety receipt is not completely bound to its request",
      );
    }
    const securityViolations = normalizeStringArray(
      core.securityViolations,
      "securityViolations",
    );
    const permissionViolations = normalizeStringArray(
      core.permissionViolations,
      "permissionViolations",
    );
    const capabilityDelta = normalizeStringArray(
      core.capabilityDelta,
      "capabilityDelta",
    );
    const permissionDelta = normalizeStringArray(
      core.permissionDelta,
      "permissionDelta",
    );
    run.namespaces.register(
      "receipt.safety",
      verified.recordDigest,
      "safetyDigest",
    );
    const derivedSafe =
      securityViolations.length === 0 &&
      permissionViolations.length === 0 &&
      capabilityDelta.length === 0 &&
      permissionDelta.length === 0;
    if (core.safe !== derivedSafe) {
      throw evalError(
        EVOLUTION_EVAL_SAFETY_FAILED_CODE,
        "safety receipt contradicts its hard-gate evidence",
      );
    }
    normalizeDigest(core.sandboxReceiptDigest, "sandboxReceiptDigest");
    if (core.sandboxReceiptDigest !== execution.executionDigest) {
      throw evalError(
        EVOLUTION_EVAL_SAFETY_FAILED_CODE,
        "safety receipt is not bound to the executed sandbox receipt",
      );
    }
    normalizeId(core.safetyRevision, "safetyRevision", 256);
    return {
      safe: core.safe,
      securityViolations: securityViolations.length + capabilityDelta.length,
      permissionViolations:
        permissionViolations.length + permissionDelta.length,
      safetyDigest: verified.recordDigest,
    };
  }

  async #evaluateBlindedWorkPlan(run, usage, sandboxInstances) {
    const workPlan = [];
    for (const task of run.suite.tasks) {
      if (task.split !== "validation" && task.split !== "test") continue;
      for (const seed of this.#policy.seeds) {
        for (const role of ["baseline", "candidate"]) {
          workPlan.push({
            task,
            seed,
            role,
            sortKey: digest(
              {
                secret: run.workPlanSecret,
                taskDigest: task.taskDigest,
                seed,
                role,
              },
              "chainlesschain.evolution-eval-blinded-work-order/v1",
            ),
          });
        }
      }
    }
    workPlan.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    const results = {
      validation: { baseline: [], candidate: [] },
      test: { baseline: [], candidate: [] },
    };
    const opaqueSubjectHandles = new Set();
    for (const job of workPlan) {
      const execution = await this.#executeOne({
        run,
        task: job.task,
        seed: job.seed,
        role: job.role,
        usage,
        sandboxInstances,
        opaqueSubjectHandles,
      });
      const [grade, safety] = await Promise.all([
        this.#gradeOne({
          run,
          task: job.task,
          seed: job.seed,
          execution,
        }),
        this.#safetyOne({ run, task: job.task, execution }),
      ]);
      results[job.task.split][job.role].push({
        taskDigest: job.task.taskDigest,
        seed: job.seed,
        pass: grade.pass,
        qualityScore: grade.qualityScore,
        securityViolations: safety.securityViolations,
        permissionViolations: safety.permissionViolations,
        outputArtifactDigest: execution.outputArtifactDigest,
        subjectBindingDigest: execution.subjectBindingDigest,
        subjectReservationDigest: execution.subjectReservationDigest,
        executionDigest: execution.executionDigest,
        gradeDigest: grade.gradeDigest,
        safetyDigest: safety.safetyDigest,
        metrics: execution.metrics,
      });
    }
    return deepFreeze({
      validation: comparisonSummary(
        results.validation,
        this.#policy.confidenceZ,
        this.#policy.seeds.length,
      ),
      test: comparisonSummary(
        results.test,
        this.#policy.confidenceZ,
        this.#policy.seeds.length,
      ),
    });
  }

  async #buildReceipt(run, outcome) {
    const completed = readClock(this.#clock);
    if (
      completed.milliseconds >= run.deadlineMs ||
      NATIVE_MONOTONIC_NOW() >= run.runLocalDeadlineMs
    ) {
      throw evalError(
        EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
        "evaluation completed after its preregistered wall-clock deadline",
      );
    }
    for (const expiresAt of run.portExpiries) {
      if (new Date(expiresAt).getTime() <= completed.milliseconds) {
        throw evalError(
          EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
          "a trusted resolution expired before evaluation completion",
        );
      }
    }
    const core = {
      schema: EVOLUTION_EVAL_RECEIPT_SCHEMA,
      runId: run.runId,
      runNonce: run.runNonce,
      suiteDigest: run.suite.suiteDigest,
      policyDigest: this.#policy.policyDigest,
      evaluationAuthorityRoot: this.#evaluationAuthorityRoot,
      targetEnvironmentRef: run.targetEnvironmentRef,
      evaluationContextDigest: run.evaluationContextDigest,
      candidateId: run.candidateId,
      baselineId: run.baselineId,
      environmentDigest: run.environmentDigest,
      suiteAuthorityDigest: run.suiteAuthorityDigest,
      environmentAuthorityDigest: run.environmentAuthorityDigest,
      candidateResolutionDigest: run.candidateResolutionDigest,
      baselineResolutionDigest: run.baselineResolutionDigest,
      trainingPartitionDigest: run.trainingPartitionDigest,
      candidateProvenanceReceiptDigest: run.candidateProvenanceReceiptDigest,
      baselineProvenanceReceiptDigest: run.baselineProvenanceReceiptDigest,
      candidateProvenanceBindingDigest: run.candidateProvenanceBindingDigest,
      baselineProvenanceBindingDigest: run.baselineProvenanceBindingDigest,
      taskHandleReservationDigest: run.taskHandleReservationDigest,
      artifactCapabilityReservationDigest:
        run.artifactCapabilityReservationDigest,
      tenantId: run.tenantId,
      provenanceAudience: run.provenanceAudience,
      trainerAuthority: run.trainerAuthority,
      trainerRevision: run.trainerRevision,
      confidenceZ: this.#policy.confidenceZ,
      decision: outcome.decision,
      reasonCodes: outcome.reasonCodes,
      splitCounts: run.splitCounts,
      validation: outcome.validation,
      test: outcome.test,
      usage: deepFreeze({ ...outcome.usage }),
      evidenceRoot: "",
      issuedAt: completed.timestamp,
      expiresAt: new Date(
        completed.milliseconds + this.#policy.receiptTtlMs,
      ).toISOString(),
    };
    core.evidenceRoot = digest(
      receiptEvidenceCore(core),
      "chainlesschain.evolution-eval-evidence-root/v4",
    );
    for (const split of ["validation", "test"]) {
      if (core[split] === null) continue;
      run.namespaces.register(
        "result.summary",
        core[split].baseline.resultDigest,
        `${split}.baseline.resultDigest`,
      );
      run.namespaces.register(
        "result.summary",
        core[split].candidate.resultDigest,
        `${split}.candidate.resultDigest`,
      );
    }
    run.namespaces.register(
      "receipt.evidence-root",
      core.evidenceRoot,
      "evidenceRoot",
    );
    const signedReceipt = await signFinalReceipt({
      core: deepFreeze(core),
      signAttestation: this.#signAttestation,
      verifyAttestation: this.#verifyAttestation,
      receiptTrust: this.#receiptTrust,
      clock: this.#clock,
      deadlineAt: run.deadlineAt,
      supervision: this.#supervision,
      monotonicDeadlineMs: run.runLocalDeadlineMs,
    });
    const signedAt = readClock(this.#clock);
    const issuedMs = new Date(signedReceipt.issuedAt).getTime();
    const receiptExpiresMs = new Date(signedReceipt.expiresAt).getTime();
    if (
      signedAt.milliseconds >= run.deadlineMs ||
      NATIVE_MONOTONIC_NOW() >= run.runLocalDeadlineMs ||
      issuedMs > signedAt.milliseconds ||
      receiptExpiresMs <= signedAt.milliseconds
    ) {
      throw evalError(
        EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
        "evaluation receipt signing crossed its deadline or validity window",
      );
    }
    for (const expiresAt of run.portExpiries) {
      if (new Date(expiresAt).getTime() <= signedAt.milliseconds) {
        throw evalError(
          EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
          "a trusted resolution expired while signing the evaluation receipt",
        );
      }
    }
    run.namespaces.register(
      "receipt.eval-final",
      signedReceipt.receiptDigest,
      "receiptDigest",
    );
    return signedReceipt;
  }

  async run(request) {
    const runLocalDeadlineMs =
      NATIVE_MONOTONIC_NOW() + this.#policy.maxWallClockMs;
    assertExactRecord(request, RUN_REQUEST_KEYS, "evaluation run request");
    const suiteRef = normalizeId(request.suiteRef, "suiteRef", 256);
    const candidateId = normalizeDigest(request.candidateId, "candidateId");
    const baselineId = normalizeDigest(request.baselineId, "baselineId");
    const targetEnvironmentRef = normalizeId(
      request.targetEnvironmentRef,
      "targetEnvironmentRef",
      256,
    );
    const evaluationContext = normalizeRunEvaluationContext(
      request.evaluationContext,
    );
    if (candidateId === baselineId) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "candidate and baseline must differ",
      );
    }
    const namespaces = new RunTypedNamespaceRegistry();
    namespaces.register("artifact.identity", candidateId, "candidateId");
    namespaces.register("artifact.identity", baselineId, "baselineId");
    namespaces.register(
      "policy.identity",
      this.#policy.policyDigest,
      "policyDigest",
    );
    const isolatedTargets = [
      this.#resolveSuite,
      this.#resolveEnvironment,
      this.#resolveArtifact,
      this.#verifyProvenance,
      this.#issueSubjectHandle,
      this.#reserveHandles,
      this.#execute,
      ...this.#graders.values(),
      this.#evaluateSafety,
      this.#signAttestation,
      this.#verifyAttestation,
    ];
    for (const target of isolatedTargets) {
      namespaces.register(
        "handler.target",
        computeEvolutionEvalIsolatedTargetDigest(target),
        `handler target ${target.handlerId}`,
      );
      namespaces.register(
        "handler.authority",
        computeEvolutionEvalTargetAuthorityDigest(target),
        `handler authority ${target.handlerId}`,
      );
      namespaces.register(
        "authority.trust-policy",
        target.authority.trustPolicyDigest,
        `handler trust policy ${target.handlerId}`,
      );
    }
    namespaces.register(
      "authority.supervisor-trust-policy",
      this.#authorityPolicies.supervisor.trust.trustPolicyDigest,
      "supervisor trust policy",
    );
    namespaces.register(
      "authority.invocation-evidence-trust-policy",
      this.#authorityPolicies.invocationEvidence.trust.trustPolicyDigest,
      "invocation evidence trust policy",
    );
    namespaces.register(
      "authority.revocation-evidence-trust-policy",
      this.#authorityPolicies.revocationEvidence.trust.trustPolicyDigest,
      "revocation evidence trust policy",
    );
    namespaces.register(
      "authority.supervisor-principal-key",
      computeTrustPrincipalKeyFingerprint(
        this.#authorityPolicies.supervisor.trust,
      ),
      "supervisor principal/key fingerprint",
    );
    namespaces.register(
      "authority.invocation-evidence-principal-key",
      computeTrustPrincipalKeyFingerprint(
        this.#authorityPolicies.invocationEvidence.trust,
      ),
      "invocation evidence principal/key fingerprint",
    );
    namespaces.register(
      "authority.revocation-evidence-principal-key",
      computeTrustPrincipalKeyFingerprint(
        this.#authorityPolicies.revocationEvidence.trust,
      ),
      "revocation evidence principal/key fingerprint",
    );
    namespaces.register(
      "authority.evaluation-root",
      this.#evaluationAuthorityRoot,
      "evaluationAuthorityRoot",
    );
    const started = readClock(this.#clock);
    const runId = randomIdentifier("eval");
    const runNonce = randomIdentifier("nonce");
    const deadlineMs = started.milliseconds + this.#policy.maxWallClockMs;
    const deadlineAt = new Date(deadlineMs).toISOString();

    const suiteRequest = deepFreeze({
      runId,
      runNonce,
      suiteRef,
      policyDigest: this.#policy.policyDigest,
      requestNonce: randomIdentifier("suite"),
      requestedAt: started.timestamp,
      deadlineAt,
    });
    const suiteResponse = await invokeBeforeDeadline(
      this.#resolveSuite,
      suiteRequest,
      this.#clock,
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      "suite authority resolution",
      this.#supervision,
      runLocalDeadlineMs,
    );
    const trustedSuite = await this.#verifySuiteResponse(
      suiteResponse,
      suiteRequest,
      deadlineMs,
      namespaces,
      runLocalDeadlineMs,
    );
    namespaces.register(
      "suite.identity",
      trustedSuite.suite.suiteDigest,
      "suiteDigest",
    );
    namespaces.register(
      "receipt.suite-authority",
      trustedSuite.receiptDigest,
      "suiteAuthorityDigest",
    );
    namespaces.register(
      "receipt.task-handle-reservation",
      trustedSuite.handleReservationDigest,
      "taskHandleReservationDigest",
    );
    for (const task of trustedSuite.suite.tasks) {
      const binding = trustedSuite.taskHandles.get(task.taskDigest);
      namespaces.register("task.identity", task.taskDigest, "taskDigest");
      namespaces.register(
        "task.execution-projection",
        binding.executionProjectionDigest,
        "executionProjectionDigest",
      );
      namespaces.register(
        "task.randomness-commitment",
        binding.randomnessCommitment,
        "taskBindingRandomnessCommitment",
      );
      namespaces.register(
        "handle.task",
        binding.opaqueTaskHandle,
        "opaqueTaskHandle",
      );
    }
    if (
      [...trustedSuite.taskHandles.values()].some(
        (binding) =>
          binding.opaqueTaskHandle === candidateId ||
          binding.opaqueTaskHandle === baselineId,
      )
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "suite authority encoded an artifact identity as a task handle",
      );
    }

    const environmentRequest = deepFreeze({
      runId,
      runNonce,
      targetEnvironmentRef,
      policyDigest: this.#policy.policyDigest,
      requestNonce: randomIdentifier("environment"),
      requestedAt: readClock(this.#clock).timestamp,
      deadlineAt,
    });
    const environmentResponse = await invokeBeforeDeadline(
      this.#resolveEnvironment,
      environmentRequest,
      this.#clock,
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      "environment authority resolution",
      this.#supervision,
      runLocalDeadlineMs,
    );
    const trustedEnvironment = await this.#verifyEnvironmentResponse(
      environmentResponse,
      environmentRequest,
      deadlineMs,
      runLocalDeadlineMs,
    );
    namespaces.register(
      "environment.identity",
      trustedEnvironment.environmentDigest,
      "environmentDigest",
    );
    namespaces.register(
      "receipt.environment-authority",
      trustedEnvironment.receiptDigest,
      "environmentAuthorityDigest",
    );
    const evaluationContextDigest = computeEvolutionEvalContextDigest({
      planDigest: evaluationContext.planDigest,
      tenantId: this.#tenantId,
      targetMatrixRoot: evaluationContext.targetMatrixRoot,
      cellId: evaluationContext.cellId,
      runtimeId: evaluationContext.runtimeId,
      targetEnvironmentRef,
      environmentDigest: trustedEnvironment.environmentDigest,
      candidateId,
      baselineId,
      suiteDigest: trustedSuite.suite.suiteDigest,
      policyDigest: this.#policy.policyDigest,
      evaluationAuthorityRoot: this.#evaluationAuthorityRoot,
    });
    namespaces.register(
      "context.evaluation",
      evaluationContextDigest,
      "evaluationContextDigest",
    );
    const trainingPartitionDigest = computeTrainingPartitionDigest(
      trustedSuite.suite,
    );
    namespaces.register(
      "partition.training",
      trainingPartitionDigest,
      "trainingPartitionDigest",
    );

    const resolveArtifact = async (role, artifactId) => {
      const artifactRequest = deepFreeze({
        runId,
        runNonce,
        role,
        artifactId,
        suiteAuthorityDigest: trustedSuite.receiptDigest,
        trainingPartitionDigest,
        environmentDigest: trustedEnvironment.environmentDigest,
        policyDigest: this.#policy.policyDigest,
        requestNonce: randomIdentifier(`artifact-${role}`),
        requestedAt: readClock(this.#clock).timestamp,
        deadlineAt,
      });
      const response = await invokeBeforeDeadline(
        this.#resolveArtifact,
        artifactRequest,
        this.#clock,
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        `artifact resolution for ${role}`,
        this.#supervision,
        runLocalDeadlineMs,
      );
      const resolution = await this.#verifyArtifactResponse(
        response,
        artifactRequest,
        deadlineMs,
        runLocalDeadlineMs,
      );
      const provenance = await this.#verifyArtifactProvenance({
        runId,
        runNonce,
        deadlineAt,
        deadlineMs,
        role,
        artifactDigest: artifactId,
        suiteAuthorityDigest: trustedSuite.receiptDigest,
        trainingPartitionDigest,
        provenanceReceiptDigest: resolution.provenanceReceiptDigest,
        runLocalDeadlineMs,
      });
      namespaces.register(
        "receipt.artifact-resolution",
        resolution.receiptDigest,
        `${role}ResolutionDigest`,
      );
      namespaces.register(
        "receipt.provenance-source",
        resolution.provenanceReceiptDigest,
        `${role}ProvenanceReceiptDigest`,
      );
      namespaces.register(
        "handle.artifact",
        resolution.opaqueArtifactCapability,
        `${role}OpaqueArtifactCapability`,
      );
      namespaces.register(
        "receipt.provenance-binding",
        provenance.bindingDigest,
        `${role}ProvenanceBindingDigest`,
      );
      return { resolution, provenance };
    };
    const candidateArtifact = await resolveArtifact("candidate", candidateId);
    const baselineArtifact = await resolveArtifact("baseline", baselineId);
    const artifactCapabilities = [
      candidateArtifact.resolution.opaqueArtifactCapability,
      baselineArtifact.resolution.opaqueArtifactCapability,
    ];
    if (
      new Set(artifactCapabilities).size !== artifactCapabilities.length ||
      artifactCapabilities.some(
        (capability) =>
          capability === candidateId ||
          capability === baselineId ||
          capability === trustedSuite.receiptDigest ||
          capability === trustedEnvironment.environmentDigest ||
          trustedSuite.suite.tasks.some(
            (task) =>
              task.taskDigest === capability ||
              executionProjectionDigest({
                taskType: task.taskType,
                publicInput: task.publicInput,
              }) === capability,
          ) ||
          [...trustedSuite.taskHandles.values()].some(
            (binding) => binding.opaqueTaskHandle === capability,
          ),
      )
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "artifact resolver returned a stable or cross-domain capability",
      );
    }
    const artifactCapabilityReservation = await this.#reserveOpaqueHandles({
      runId,
      runNonce,
      deadlineAt,
      deadlineMs,
      kind: "artifact",
      handles: artifactCapabilities,
      runLocalDeadlineMs,
    });
    namespaces.register(
      "receipt.artifact-capability-reservation",
      artifactCapabilityReservation.receiptDigest,
      "artifactCapabilityReservationDigest",
    );

    const splitCounts = deepFreeze(countSplits(trustedSuite.suite.tasks));
    const run = {
      runId,
      runNonce,
      deadlineAt,
      deadlineMs,
      runLocalDeadlineMs,
      workPlanSecret: randomIdentifier("work-plan-secret"),
      namespaces,
      suite: trustedSuite.suite,
      taskHandles: trustedSuite.taskHandles,
      candidateId,
      baselineId,
      environment: trustedEnvironment.environment,
      environmentDigest: trustedEnvironment.environmentDigest,
      targetEnvironmentRef,
      evaluationContextDigest,
      suiteAuthorityDigest: trustedSuite.receiptDigest,
      environmentAuthorityDigest: trustedEnvironment.receiptDigest,
      candidateResolutionDigest: candidateArtifact.resolution.receiptDigest,
      baselineResolutionDigest: baselineArtifact.resolution.receiptDigest,
      trainingPartitionDigest,
      candidateProvenanceReceiptDigest:
        candidateArtifact.resolution.provenanceReceiptDigest,
      baselineProvenanceReceiptDigest:
        baselineArtifact.resolution.provenanceReceiptDigest,
      candidateProvenanceBindingDigest:
        candidateArtifact.provenance.bindingDigest,
      baselineProvenanceBindingDigest:
        baselineArtifact.provenance.bindingDigest,
      taskHandleReservationDigest: trustedSuite.handleReservationDigest,
      artifactCapabilityReservationDigest:
        artifactCapabilityReservation.receiptDigest,
      tenantId: this.#tenantId,
      provenanceAudience: this.#provenanceAudience,
      trainerAuthority: this.#trainerAuthority,
      trainerRevision: this.#trainerRevision,
      artifacts: {
        candidate: {
          opaqueArtifactCapability:
            candidateArtifact.resolution.opaqueArtifactCapability,
        },
        baseline: {
          opaqueArtifactCapability:
            baselineArtifact.resolution.opaqueArtifactCapability,
        },
      },
      splitCounts,
      portExpiries: [
        trustedSuite.expiresAt,
        trustedSuite.handleReservationExpiresAt,
        trustedEnvironment.expiresAt,
        candidateArtifact.resolution.expiresAt,
        baselineArtifact.resolution.expiresAt,
        candidateArtifact.provenance.expiresAt,
        baselineArtifact.provenance.expiresAt,
        artifactCapabilityReservation.expiresAt,
      ],
    };
    const usage = makeUsage();
    const insufficient = [
      ["training", this.#policy.minTrainingTasks],
      ["validation", this.#policy.minValidationTasks],
      ["test", this.#policy.minTestTasks],
    ].filter(([split, minimum]) => splitCounts[split] < minimum);
    if (insufficient.length > 0) {
      return this.#buildReceipt(run, {
        decision: "needs-more-evidence",
        reasonCodes: insufficient.map(([split]) => `insufficient-${split}`),
        validation: null,
        test: null,
        usage,
      });
    }
    const plannedExecutions =
      (splitCounts.validation + splitCounts.test) *
      this.#policy.seeds.length *
      2;
    if (plannedExecutions > this.#policy.maxExecutions) {
      return this.#buildReceipt(run, {
        decision: "rejected",
        reasonCodes: ["execution-budget-insufficient"],
        validation: null,
        test: null,
        usage,
      });
    }

    const sandboxInstances = new Set();
    try {
      const evaluated = await this.#evaluateBlindedWorkPlan(
        run,
        usage,
        sandboxInstances,
      );
      const { validation, test } = evaluated;
      const validationDecision = decideSplit(validation, this.#policy);
      if (!validationDecision.accepted) {
        return this.#buildReceipt(run, {
          decision: "rejected",
          reasonCodes: [`validation-${validationDecision.reason}`],
          validation,
          test,
          usage,
        });
      }
      const testDecision = decideSplit(test, this.#policy);
      if (!testDecision.accepted) {
        return this.#buildReceipt(run, {
          decision: "rejected",
          reasonCodes: [`test-${testDecision.reason}`],
          validation,
          test,
          usage,
        });
      }
      return this.#buildReceipt(run, {
        decision: "accepted",
        reasonCodes: [
          `validation-${validationDecision.reason}`,
          `test-${testDecision.reason}`,
        ],
        validation,
        test,
        usage,
      });
    } catch (cause) {
      if (cause instanceof EvaluationBudgetExceeded) {
        return this.#buildReceipt(run, {
          decision: "rejected",
          reasonCodes: ["total-budget-exceeded"],
          validation: null,
          test: null,
          usage: cause.usage,
        });
      }
      throw cause;
    }
  }
}

function verifyInterval(value, label, { minimum = 0, maximum = 1 } = {}) {
  assertExactRecord(value, INTERVAL_KEYS, label);
  const lower = normalizeFinite(value.lower, `${label}.lower`, {
    minimum,
    maximum,
  });
  const upper = normalizeFinite(value.upper, `${label}.upper`, {
    minimum,
    maximum,
  });
  if (lower > upper) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} ordering is invalid`,
    );
  }
}

function verifyPairedInterval(value, label) {
  assertExactRecord(value, PAIRED_INTERVAL_KEYS, label);
  normalizeInteger(value.taskCount, `${label}.taskCount`, { minimum: 1 });
  const mean = normalizeFinite(value.mean, `${label}.mean`, {
    minimum: -1,
    maximum: 1,
  });
  const lower = normalizeFinite(value.lower, `${label}.lower`, {
    minimum: -1,
    maximum: 1,
  });
  const upper = normalizeFinite(value.upper, `${label}.upper`, {
    minimum: -1,
    maximum: 1,
  });
  if (lower > mean || mean > upper) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} bounds are inconsistent`,
    );
  }
}

function verifyVariantSummary(value, label) {
  assertExactRecord(value, VARIANT_SUMMARY_KEYS, label);
  const taskCount = normalizeInteger(value.taskCount, `${label}.taskCount`, {
    minimum: 1,
  });
  const seedCount = normalizeInteger(value.seedCount, `${label}.seedCount`, {
    minimum: 1,
  });
  const sampleCount = normalizeInteger(
    value.sampleCount,
    `${label}.sampleCount`,
    {
      minimum: 1,
    },
  );
  const passCount = normalizeInteger(value.passCount, `${label}.passCount`);
  if (sampleCount !== taskCount * seedCount || passCount > sampleCount) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} sample counts are inconsistent`,
    );
  }
  normalizeRatio(value.passRate, `${label}.passRate`);
  normalizeRatio(value.qualityScore, `${label}.qualityScore`);
  if (Math.abs(value.passRate - passCount / sampleCount) > Number.EPSILON * 8) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label}.passRate is inconsistent`,
    );
  }
  verifyInterval(value.confidenceInterval, `${label}.confidenceInterval`);
  for (const key of [
    "errorRate",
    "averageTokens",
    "averageLatencyMs",
    "averageToolCalls",
  ]) {
    normalizeFinite(value[key], `${label}.${key}`, { minimum: 0 });
  }
  for (const key of [
    "totalTokens",
    "totalLatencyMs",
    "totalToolCalls",
    "totalCostMicrounits",
    "securityViolations",
    "permissionViolations",
  ]) {
    normalizeInteger(value[key], `${label}.${key}`);
  }
  if (
    Math.abs(value.averageTokens - value.totalTokens / sampleCount) >
      Number.EPSILON * 64 ||
    Math.abs(value.averageLatencyMs - value.totalLatencyMs / sampleCount) >
      Number.EPSILON * 64 ||
    Math.abs(value.averageToolCalls - value.totalToolCalls / sampleCount) >
      Number.EPSILON * 64
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} averages are inconsistent`,
    );
  }
  normalizeDigest(value.resultDigest, `${label}.resultDigest`);
}

function verifyComparison(value, label) {
  assertExactRecord(value, COMPARISON_KEYS, label);
  verifyVariantSummary(value.baseline, `${label}.baseline`);
  verifyVariantSummary(value.candidate, `${label}.candidate`);
  if (
    value.baseline.taskCount !== value.candidate.taskCount ||
    value.baseline.seedCount !== value.candidate.seedCount
  ) {
    throw evalError(EVOLUTION_EVAL_INVALID_CODE, `${label} is not paired`);
  }
  verifyPairedInterval(value.pairedPassDelta, `${label}.pairedPassDelta`);
  verifyPairedInterval(value.pairedQualityDelta, `${label}.pairedQualityDelta`);
  if (
    value.pairedPassDelta.taskCount !== value.baseline.taskCount ||
    value.pairedQualityDelta.taskCount !== value.baseline.taskCount
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} paired task counts are invalid`,
    );
  }
  for (const key of [
    "absoluteImprovement",
    "tokenReduction",
    "latencyReduction",
    "toolCallReduction",
  ]) {
    normalizeFinite(value[key], `${label}.${key}`, { minimum: -1, maximum: 1 });
  }
  if (
    Math.abs(value.absoluteImprovement - value.pairedPassDelta.mean) >
      Number.EPSILON * 8 ||
    Math.abs(
      value.tokenReduction -
        safeReduction(
          value.baseline.averageTokens,
          value.candidate.averageTokens,
        ),
    ) >
      Number.EPSILON * 64 ||
    Math.abs(
      value.latencyReduction -
        safeReduction(
          value.baseline.averageLatencyMs,
          value.candidate.averageLatencyMs,
        ),
    ) >
      Number.EPSILON * 64 ||
    Math.abs(
      value.toolCallReduction -
        safeReduction(
          value.baseline.averageToolCalls,
          value.candidate.averageToolCalls,
        ),
    ) >
      Number.EPSILON * 64
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      `${label} derived values are inconsistent`,
    );
  }
}

function verifyUsage(value) {
  assertExactRecord(value, USAGE_KEYS, "evaluation usage");
  for (const key of USAGE_KEYS) normalizeInteger(value[key], `usage.${key}`);
}

function verifyReceiptStructure(value) {
  preflightCanonicalStructure(value);
  assertExactRecord(value, RECEIPT_KEYS, "evaluation receipt");
  if (value.schema !== EVOLUTION_EVAL_RECEIPT_SCHEMA) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation receipt schema is invalid",
    );
  }
  normalizeId(value.runId, "runId", 256);
  normalizeId(value.runNonce, "runNonce", 256);
  for (const key of [
    "suiteDigest",
    "policyDigest",
    "evaluationAuthorityRoot",
    "evaluationContextDigest",
    "candidateId",
    "baselineId",
    "environmentDigest",
    "suiteAuthorityDigest",
    "environmentAuthorityDigest",
    "candidateResolutionDigest",
    "baselineResolutionDigest",
    "trainingPartitionDigest",
    "candidateProvenanceReceiptDigest",
    "baselineProvenanceReceiptDigest",
    "candidateProvenanceBindingDigest",
    "baselineProvenanceBindingDigest",
    "taskHandleReservationDigest",
    "artifactCapabilityReservationDigest",
    "evidenceRoot",
    "receiptDigest",
  ]) {
    normalizeDigest(value[key], key);
  }
  normalizeId(value.targetEnvironmentRef, "receipt.targetEnvironmentRef", 256);
  normalizeId(value.tenantId, "receipt.tenantId", 256);
  normalizeId(value.provenanceAudience, "receipt.provenanceAudience", 256);
  normalizeId(value.trainerAuthority, "receipt.trainerAuthority", 256);
  normalizeId(value.trainerRevision, "receipt.trainerRevision", 256);
  normalizeFinite(value.confidenceZ, "receipt.confidenceZ", {
    minimum: 1.64,
    maximum: 4,
  });
  if (
    !["accepted", "rejected", "needs-more-evidence"].includes(value.decision)
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation receipt decision is invalid",
    );
  }
  if (
    !Array.isArray(value.reasonCodes) ||
    value.reasonCodes.length < 1 ||
    value.reasonCodes.length > 8 ||
    value.reasonCodes.some(
      (code) => typeof code !== "string" || !SAFE_ID_PATTERN.test(code),
    )
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation receipt reasonCodes are invalid",
    );
  }
  assertExactRecord(
    value.splitCounts,
    SPLIT_COUNT_KEYS,
    "evaluation split counts",
  );
  for (const split of SPLITS)
    normalizeInteger(value.splitCounts[split], `${split} count`);
  if (value.validation !== null)
    verifyComparison(value.validation, "validation comparison");
  if (value.test !== null) verifyComparison(value.test, "test comparison");
  verifyUsage(value.usage);
  if (value.decision === "accepted") {
    if (!value.validation || !value.test) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "accepted evaluation receipt requires validation and hidden test evidence",
      );
    }
    if (
      value.validation.candidate.securityViolations > 0 ||
      value.validation.candidate.permissionViolations > 0 ||
      value.test.candidate.securityViolations > 0 ||
      value.test.candidate.permissionViolations > 0
    ) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "accepted evaluation receipt contradicts its safety evidence",
      );
    }
  }
  if (
    value.decision === "needs-more-evidence" &&
    (value.validation !== null ||
      value.test !== null ||
      value.usage.executionCount !== 0)
  ) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "incomplete evaluation receipt must not contain execution evidence",
    );
  }
  const expectedEvidenceRoot = digest(
    receiptEvidenceCore(value),
    "chainlesschain.evolution-eval-evidence-root/v4",
  );
  if (value.evidenceRoot !== expectedEvidenceRoot) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation evidence root is invalid",
    );
  }
  const expectedReceiptDigest = computeEvolutionEvalReceiptDigest(value);
  if (value.receiptDigest !== expectedReceiptDigest) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "evaluation receipt digest is invalid",
    );
  }
  return normalizeAttestation(
    value.attestation,
    "evaluation receipt attestation",
  );
}

/**
 * Trusted receipt-verification composition root with the same descriptor to
 * callable binding requirement as EvolutionEvalGate.
 */
export class EvolutionEvalReceiptVerifier {
  #verifyAttestation;
  #receiptTrust;
  #clock;
  #maximumReceiptTtlMs;
  #maximumClockSkewMs;
  #maximumVerificationMs;
  #supervision;

  constructor({
    attestationVerifier,
    receiptTrust,
    clock,
    clockPolicy,
    maximumReceiptTtlMs = 600_000,
    maximumClockSkewMs = CLOCK_SKEW_MS,
    maximumVerificationMs = 30_000,
    deadlineSupervisor,
    supervisorPolicy,
    invocationEvidenceVerifier,
    invocationEvidencePolicy,
    revocationEvidenceVerifier,
    revocationEvidencePolicy,
  }) {
    const normalizedSupervisorPolicy = normalizeAuthorityPolicy(
      supervisorPolicy,
      "receiptVerifier.supervisorPolicy",
    );
    const normalizedInvocationEvidencePolicy = normalizeAuthorityPolicy(
      invocationEvidencePolicy,
      "receiptVerifier.invocationEvidencePolicy",
    );
    const normalizedRevocationEvidencePolicy = normalizeAuthorityPolicy(
      revocationEvidencePolicy,
      "receiptVerifier.revocationEvidencePolicy",
    );
    const normalizedClockPolicy = normalizeAuthorityPolicy(
      clockPolicy,
      "receiptVerifier.clockPolicy",
    );
    const evidenceVerifierCallables = validateIndependentEvidenceAuthorities({
      deadlineSupervisor,
      supervisorPolicy: normalizedSupervisorPolicy,
      invocationEvidenceVerifier,
      invocationEvidencePolicy: normalizedInvocationEvidencePolicy,
      revocationEvidenceVerifier,
      revocationEvidencePolicy: normalizedRevocationEvidencePolicy,
      label: "receipt verifier evidence authorities",
    });
    const capturedClock = captureTrustedClock(
      clock,
      normalizedClockPolicy,
      "receiptVerifier.trustedClock",
    );
    validateUniqueSensitiveCallables(
      [
        {
          label: "deadlineSupervisor.run",
          callable: evidenceVerifierCallables.supervisorRun,
        },
        {
          label: "deadlineSupervisor.invokeTarget",
          callable: evidenceVerifierCallables.supervisorInvokeTarget,
        },
        {
          label: "deadlineSupervisor.revokeTarget",
          callable: evidenceVerifierCallables.supervisorRevokeTarget,
        },
        {
          label: "deadlineSupervisor.verifyEnforcement",
          callable: evidenceVerifierCallables.supervisorVerifyEnforcement,
        },
        {
          label: "invocationEvidenceVerifier.verify",
          callable: evidenceVerifierCallables.invocationEvidenceVerify,
        },
        {
          label: "revocationEvidenceVerifier.verify",
          callable: evidenceVerifierCallables.revocationEvidenceVerify,
        },
        {
          label: "receiptVerifier.trustedClock.now",
          callable: capturedClock.rawNow,
        },
      ],
      "receipt verifier sensitive callables",
    );
    this.#verifyAttestation = captureIsolatedTarget(
      attestationVerifier,
      "verify",
      "attestationVerifier",
      { requireHsm: true },
    );
    // This remains a declarative HSM target, not an executable verifier
    // closure; its handler identity is therefore enforced by target digests.
    this.#receiptTrust = normalizeTrust(receiptTrust);
    if (
      sameTrust(
        this.#verifyAttestation.authority,
        normalizedSupervisorPolicy.trust,
      )
    ) {
      throw evalError(
        EVOLUTION_EVAL_INVALID_CODE,
        "receipt verifier authority must be independent from the deadline supervisor",
      );
    }
    this.#supervision = Object.freeze({
      run: captureCallable(
        deadlineSupervisor,
        evidenceVerifierCallables.supervisorRun,
      ),
      invokeTarget: captureCallable(
        deadlineSupervisor,
        evidenceVerifierCallables.supervisorInvokeTarget,
      ),
      revokeTarget: captureCallable(
        deadlineSupervisor,
        evidenceVerifierCallables.supervisorRevokeTarget,
      ),
      verifyEnforcement: captureCallable(
        deadlineSupervisor,
        evidenceVerifierCallables.supervisorVerifyEnforcement,
      ),
      invocationEvidence: Object.freeze({
        verify: captureCallable(
          invocationEvidenceVerifier,
          evidenceVerifierCallables.invocationEvidenceVerify,
        ),
        policy: normalizedInvocationEvidencePolicy,
      }),
      revocationEvidence: Object.freeze({
        verify: captureCallable(
          revocationEvidenceVerifier,
          evidenceVerifierCallables.revocationEvidenceVerify,
        ),
        policy: normalizedRevocationEvidencePolicy,
      }),
      policy: normalizedSupervisorPolicy,
      descriptors: Object.freeze({
        supervisor: evidenceVerifierCallables.supervisorDescriptor,
        invocationEvidence:
          evidenceVerifierCallables.invocationEvidenceDescriptor,
        revocationEvidence:
          evidenceVerifierCallables.revocationEvidenceDescriptor,
      }),
    });
    this.#clock = capturedClock.now;
    validateGlobalAuthorityPrincipalMatrix(
      [
        {
          role: "receiptSigner",
          label: "receipt signer",
          trust: this.#receiptTrust,
        },
        {
          role: "receiptVerifier",
          label: "receipt signature verifier",
          trust: this.#verifyAttestation.authority,
        },
        {
          role: "supervisor",
          label: "deadline supervisor",
          trust: normalizedSupervisorPolicy.trust,
        },
        {
          role: "invocationEvidence",
          label: "invocation evidence verifier",
          trust: normalizedInvocationEvidencePolicy.trust,
        },
        {
          role: "revocationEvidence",
          label: "revocation evidence verifier",
          trust: normalizedRevocationEvidencePolicy.trust,
        },
        {
          role: "clock",
          label: "trusted clock",
          trust: normalizedClockPolicy.trust,
        },
      ],
      "receipt verifier authority matrix",
    );
    this.#maximumReceiptTtlMs = normalizeInteger(
      maximumReceiptTtlMs,
      "maximumReceiptTtlMs",
      { minimum: 1_000, maximum: 600_000 },
    );
    this.#maximumClockSkewMs = normalizeInteger(
      maximumClockSkewMs,
      "maximumClockSkewMs",
      { maximum: 60_000 },
    );
    this.#maximumVerificationMs = normalizeInteger(
      maximumVerificationMs,
      "maximumVerificationMs",
      { minimum: 100, maximum: 60_000 },
    );
    readClock(this.#clock);
    RECEIPT_VERIFIER_INSTANCES.add(this);
    Object.freeze(this);
  }

  async verify(value, expected) {
    const verificationLocalDeadlineMs =
      NATIVE_MONOTONIC_NOW() + this.#maximumVerificationMs;
    // Snapshot both attacker-controlled graphs before the first await. Every
    // subsequent structural, contextual, freshness, signature, and return
    // decision is made from these single bounded canonical snapshots.
    const receiptSnapshot = deepFreeze(cloneCanonical(value));
    const expectedSnapshot = deepFreeze(cloneCanonical(expected));
    assertExactRecord(
      expectedSnapshot,
      EXPECTED_RECEIPT_KEYS,
      "expected receipt context",
    );
    const normalizedExpected = {
      runId: normalizeId(expectedSnapshot.runId, "expected.runId", 256),
      runNonce: normalizeId(
        expectedSnapshot.runNonce,
        "expected.runNonce",
        256,
      ),
      suiteDigest: normalizeDigest(
        expectedSnapshot.suiteDigest,
        "expected.suiteDigest",
      ),
      policyDigest: normalizeDigest(
        expectedSnapshot.policyDigest,
        "expected.policyDigest",
      ),
      evaluationAuthorityRoot: normalizeDigest(
        expectedSnapshot.evaluationAuthorityRoot,
        "expected.evaluationAuthorityRoot",
      ),
      targetEnvironmentRef: normalizeId(
        expectedSnapshot.targetEnvironmentRef,
        "expected.targetEnvironmentRef",
        256,
      ),
      evaluationContextDigest: normalizeDigest(
        expectedSnapshot.evaluationContextDigest,
        "expected.evaluationContextDigest",
      ),
      candidateId: normalizeDigest(
        expectedSnapshot.candidateId,
        "expected.candidateId",
      ),
      baselineId: normalizeDigest(
        expectedSnapshot.baselineId,
        "expected.baselineId",
      ),
      environmentDigest: normalizeDigest(
        expectedSnapshot.environmentDigest,
        "expected.environmentDigest",
      ),
      tenantId: normalizeId(
        expectedSnapshot.tenantId,
        "expected.tenantId",
        256,
      ),
      provenanceAudience: normalizeId(
        expectedSnapshot.provenanceAudience,
        "expected.provenanceAudience",
        256,
      ),
      trainerAuthority: normalizeId(
        expectedSnapshot.trainerAuthority,
        "expected.trainerAuthority",
        256,
      ),
      trainerRevision: normalizeId(
        expectedSnapshot.trainerRevision,
        "expected.trainerRevision",
        256,
      ),
    };
    const attestation = verifyReceiptStructure(receiptSnapshot);
    for (const [key, expectedValue] of Object.entries(normalizedExpected)) {
      if (receiptSnapshot[key] !== expectedValue) {
        throw evalError(
          EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
          `evaluation receipt does not match expected ${key}`,
        );
      }
    }
    if (!sameTrust(attestation, this.#receiptTrust)) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "evaluation receipt issuer, key, or trust policy is invalid",
      );
    }
    const issuedAt = normalizeTimestamp(
      receiptSnapshot.issuedAt,
      "receipt.issuedAt",
    );
    const expiresAt = normalizeTimestamp(
      receiptSnapshot.expiresAt,
      "receipt.expiresAt",
    );
    const issuedMs = new Date(issuedAt).getTime();
    const expiresMs = new Date(expiresAt).getTime();
    const now = readClock(this.#clock);
    if (
      expiresMs <= issuedMs ||
      expiresMs - issuedMs > this.#maximumReceiptTtlMs ||
      issuedMs > now.milliseconds + this.#maximumClockSkewMs ||
      expiresMs <= now.milliseconds
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "evaluation receipt is stale or has an invalid validity window",
      );
    }
    const verificationDeadlineMs = Math.min(
      expiresMs,
      now.milliseconds + this.#maximumVerificationMs,
    );
    const verified = await invokeAtDeadline(
      this.#verifyAttestation,
      deepFreeze({
        purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt,
        payloadDigest: receiptSnapshot.receiptDigest,
        attestation,
      }),
      new Date(verificationDeadlineMs).toISOString(),
      this.#clock,
      EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
      "evaluation receipt signature verifier",
      this.#supervision,
      verificationLocalDeadlineMs,
    );
    if (verified !== true) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "evaluation receipt signature was rejected",
      );
    }
    const verifiedAt = readClock(this.#clock);
    if (
      verifiedAt.milliseconds >= expiresMs ||
      verifiedAt.milliseconds >= verificationDeadlineMs ||
      NATIVE_MONOTONIC_NOW() >= verificationLocalDeadlineMs
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "evaluation receipt expired while its signature was being verified",
      );
    }
    const returnedAt = readClock(this.#clock);
    if (
      returnedAt.milliseconds >= expiresMs ||
      returnedAt.milliseconds >= verificationDeadlineMs ||
      NATIVE_MONOTONIC_NOW() >= verificationLocalDeadlineMs
    ) {
      throw evalError(
        EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
        "evaluation receipt expired before its frozen snapshot could be returned",
      );
    }
    return receiptSnapshot;
  }
}

// The exported classes are composition roots. Freezing their prototypes keeps
// a later-loaded plugin from replacing `run` or `verify` after trusted ports
// have been captured.
Object.freeze(EvolutionEvalGate.prototype);
Object.freeze(EvolutionEvalReceiptVerifier.prototype);

export async function runEvolutionEvalGate(gate, request) {
  if (!GATE_INSTANCES.has(gate)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "runEvolutionEvalGate requires a trusted EvolutionEvalGate instance",
    );
  }
  return EvolutionEvalGate.prototype.run.call(gate, request);
}

export async function verifyEvolutionEvalReceipt(verifier, value, expected) {
  if (!RECEIPT_VERIFIER_INSTANCES.has(verifier)) {
    throw evalError(
      EVOLUTION_EVAL_INVALID_CODE,
      "verifyEvolutionEvalReceipt requires a trusted read-only verifier instance",
    );
  }
  return EvolutionEvalReceiptVerifier.prototype.verify.call(
    verifier,
    value,
    expected,
  );
}
