import { createHash, randomBytes } from "node:crypto";
import { isProxy } from "node:util/types";

import {
  buildEvolutionEvalAttestationDigest,
  computeEvolutionEvalIsolatedTargetDigest,
  computeEvolutionEvalSignedEvidenceDigest,
  computeEvolutionEvalSupervisedResultDigest,
  computeEvolutionEvalTargetAuthorityDigest,
  EVOLUTION_EVAL_ATTESTATION_PURPOSES,
  EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
  EVOLUTION_EVAL_SUPERVISION_SCHEMA,
} from "./evolution-eval-gate.js";
import { isEvolutionEvalProcessSupervisor } from "./evolution-eval-process-supervisor.js";

export const PM_EXPLORATION_MERGER_ISOLATION_SCHEMA =
  "chainlesschain.pm-exploration-merger-isolation/v1";
export const PM_EXPLORATION_EVALUATOR_ISOLATION_SCHEMA =
  "chainlesschain.pm-exploration-evaluator-isolation/v1";
export const PM_EXPLORATION_CURRICULUM_ISOLATION_SCHEMA =
  "chainlesschain.pm-exploration-curriculum-isolation/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const EXECUTORS = new WeakMap();
const CONFIG = Object.freeze({
  merge: Object.freeze({
    operation: "pm-exploration-merge",
    schema: PM_EXPLORATION_MERGER_ISOLATION_SCHEMA,
  }),
  evaluate: Object.freeze({
    operation: "pm-exploration-evaluate",
    schema: PM_EXPLORATION_EVALUATOR_ISOLATION_SCHEMA,
  }),
  curriculum: Object.freeze({
    operation: "pm-exploration-select-task",
    schema: PM_EXPLORATION_CURRICULUM_ISOLATION_SCHEMA,
  }),
});
const SUPERVISION_RECEIPT_KEYS = Object.freeze([
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

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const field = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !field ||
        !field.enumerable ||
        !("value" in field)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || value.length > 256 || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function timestamp(now) {
  const milliseconds = Number(now());
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
    throw new TypeError("process reviewer clock is invalid");
  return Object.freeze({
    milliseconds,
    iso: new Date(milliseconds).toISOString(),
  });
}

function targetBinding(value, config) {
  const targetDigest = computeEvolutionEvalIsolatedTargetDigest(value);
  const targetAuthorityDigest =
    computeEvolutionEvalTargetAuthorityDigest(value);
  if (
    value.schema !== EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA ||
    value.isolation !== "process" ||
    value.operation !== config.operation
  ) {
    throw new TypeError(
      `PM exploration process reviewer requires a ${config.operation} target`,
    );
  }
  return Object.freeze({
    target: Object.freeze(structuredClone(value)),
    targetDigest,
    targetAuthorityDigest,
  });
}

function supervisionReceiptDigest(value, kind) {
  exact(value, SUPERVISION_RECEIPT_KEYS, `PM ${kind} supervision receipt`);
  return computeEvolutionEvalSignedEvidenceDigest(
    value,
    EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
  );
}

function validateReceipt({ receipt, request, binding, value }) {
  const evidenceDigest = supervisionReceiptDigest(receipt, binding.kind);
  const { attestation, ...core } = receipt;
  const completedAt = Date.parse(receipt.completedAt);
  if (
    receipt.schema !== EVOLUTION_EVAL_SUPERVISION_SCHEMA ||
    receipt.requestDigest !== request.requestDigest ||
    receipt.invocationNonce !== request.invocationNonce ||
    receipt.invocationId !== request.invocationId ||
    receipt.capabilityDigest !== request.capabilityDigest ||
    receipt.operation !== binding.target.operation ||
    receipt.requestedAt !== request.requestedAt ||
    receipt.deadlineAt !== request.deadlineAt ||
    receipt.payloadDigest !== request.payloadDigest ||
    receipt.targetDigest !== binding.targetDigest ||
    receipt.targetHandlerId !== binding.target.handlerId ||
    receipt.targetRevision !== binding.target.handlerRevision ||
    receipt.targetAuthorityDigest !== binding.targetAuthorityDigest ||
    !Number.isFinite(completedAt) ||
    completedAt < Date.parse(request.requestedAt) ||
    completedAt > Date.parse(request.deadlineAt) ||
    receipt.status !== "completed" ||
    receipt.isolation !== "process" ||
    receipt.hardDeadlineEnforced !== true ||
    receipt.lateSideEffectsPrevented !== true ||
    receipt.invocationCount !== 1 ||
    receipt.capabilityRevoked !== true ||
    receipt.resultDigest !==
      computeEvolutionEvalSupervisedResultDigest(value) ||
    !DIGEST.test(receipt.targetInvocationDigest ?? "") ||
    !DIGEST.test(receipt.revocationDigest ?? "") ||
    receipt.revocationMode !== "completed-release" ||
    receipt.wasActive !== false ||
    receipt.activeInvocationTerminated !== false ||
    receipt.terminatedAt !== null ||
    receipt.supervisorRevision !==
      binding.supervisor.authorityDescriptor.handlerRevision
  ) {
    throw new Error(
      `PM ${binding.kind} process supervision receipt is invalid`,
    );
  }
  const verified = binding.supervisor.verifyEnforcement({
    purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
    payloadDigest: buildEvolutionEvalAttestationDigest(
      core,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
    ),
    attestation,
  });
  if (verified !== true || (verified && typeof verified.then === "function"))
    throw new Error(`PM ${binding.kind} supervision attestation was rejected`);
  return evidenceDigest;
}

function capability(binding, request, invocation) {
  let revocation = null;
  return Object.freeze({
    async invoke() {
      const result = await binding.supervisor.invokeTarget(invocation);
      return Object.freeze({
        value: result.value,
        resultDigest: computeEvolutionEvalSupervisedResultDigest(result.value),
        targetInvocationDigest: computeEvolutionEvalSignedEvidenceDigest(
          result.evidence,
          EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation,
        ),
      });
    },
    async revoke({ mode }) {
      if (revocation !== null) return revocation;
      revocation = binding.supervisor
        .revokeTarget({
          requestDigest: request.requestDigest,
          capabilityDigest: request.capabilityDigest,
          targetDigest: binding.targetDigest,
          invocationId: request.invocationId,
          mode,
          requestedAt:
            mode === "hard-terminate"
              ? request.deadlineAt
              : new Date().toISOString(),
          deadlineAt: request.deadlineAt,
        })
        .then((receipt) =>
          Object.freeze({
            revocationDigest: computeEvolutionEvalSignedEvidenceDigest(
              receipt,
              EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation,
            ),
            revocationMode: mode,
            wasActive: receipt.wasActive,
            activeInvocationTerminated: receipt.activeInvocationTerminated,
            terminatedAt: receipt.terminatedAt,
          }),
        );
      return revocation;
    },
  });
}

export function createPmExplorationProcessReviewerExecutor(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration process reviewer options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  exact(
    options,
    hasNow
      ? ["kind", "supervisor", "target", "maxWallClockMs", "now"]
      : ["kind", "supervisor", "target", "maxWallClockMs"],
    "PM exploration process reviewer options",
  );
  const config = CONFIG[options.kind];
  if (!config)
    throw new TypeError(
      "process reviewer kind must be merge, evaluate, or curriculum",
    );
  if (!isEvolutionEvalProcessSupervisor(options.supervisor))
    throw new TypeError("a branded evolution process supervisor is required");
  if (
    !Number.isSafeInteger(options.maxWallClockMs) ||
    options.maxWallClockMs < 1 ||
    options.maxWallClockMs > 600_000
  ) {
    throw new TypeError("process reviewer maxWallClockMs is out of bounds");
  }
  const now = hasNow ? options.now : Date.now;
  if (typeof now !== "function" || isProxy(now))
    throw new TypeError("process reviewer clock must be a direct function");
  const supervisorDescriptor = options.supervisor.authorityDescriptor;
  if (!supervisorDescriptor || typeof supervisorDescriptor !== "object")
    throw new TypeError("process supervisor authority descriptor is required");
  const captured = targetBinding(options.target, config);
  const descriptor = Object.freeze({
    schema: config.schema,
    mode: "process",
    targetDigest: captured.targetDigest,
    targetAuthorityDigest: captured.targetAuthorityDigest,
    handlerId: identifier(
      captured.target.handlerId,
      `process ${options.kind} handlerId`,
    ),
    handlerRevision: identifier(
      captured.target.handlerRevision,
      `process ${options.kind} handlerRevision`,
    ),
    operation: captured.target.operation,
    handlerArtifactDigest: digest(
      captured.target.handlerArtifactDigest,
      `process ${options.kind} handlerArtifactDigest`,
    ),
    supervisorAuthorityDigest: hash(
      `chainlesschain.pm-exploration-${options.kind}-supervisor-authority/v1`,
      {
        authorityDescriptor: supervisorDescriptor,
        childEvidenceStoreDescriptor:
          options.supervisor.childEvidenceStoreDescriptor ?? null,
      },
    ),
    maxWallClockMs: options.maxWallClockMs,
  });
  const executor = Object.freeze({});
  EXECUTORS.set(executor, {
    ...captured,
    descriptor,
    kind: options.kind,
    maxWallClockMs: options.maxWallClockMs,
    now,
    supervisor: options.supervisor,
  });
  return executor;
}

export function inspectPmExplorationProcessReviewerExecutor(value) {
  const binding = EXECUTORS.get(value);
  if (!binding)
    throw new TypeError(
      "a branded PM exploration process reviewer is required",
    );
  return binding.descriptor;
}

export async function invokePmExplorationProcessReviewer(
  executorValue,
  request,
  runtime,
) {
  const binding = EXECUTORS.get(executorValue);
  if (!binding)
    throw new TypeError(
      "a branded PM exploration process reviewer is required",
    );
  if (!(runtime?.signal instanceof AbortSignal))
    throw new TypeError("process reviewer requires a budget abort signal");
  if (runtime.signal.aborted)
    throw runtime.signal.reason ?? new Error("process reviewer was aborted");
  const current = timestamp(binding.now);
  const deadlineAt = new Date(
    current.milliseconds + binding.maxWallClockMs,
  ).toISOString();
  const payloadDigest = hash(
    "chainlesschain.evolution-eval-supervision-payload/v1",
    request,
  );
  const invocationNonce = `supervision-${randomBytes(16).toString("hex")}`;
  const invocationId = `target-invocation-${randomBytes(16).toString("hex")}`;
  const capabilityNonce = `invocation-capability-${randomBytes(16).toString("hex")}`;
  const capabilityDigest = hash(
    "chainlesschain.evolution-eval-invocation-capability/v1",
    {
      capabilityNonce,
      invocationNonce,
      invocationId,
      payloadDigest,
      targetDigest: binding.targetDigest,
      deadlineAt,
    },
  );
  const requestCore = Object.freeze({
    schema: "chainlesschain.evolution-eval-supervision-request/v3",
    operation: binding.target.operation,
    invocationNonce,
    invocationId,
    capabilityDigest,
    requestedAt: current.iso,
    deadlineAt,
    payloadDigest,
    targetDigest: binding.targetDigest,
    targetHandlerId: binding.target.handlerId,
    targetRevision: binding.target.handlerRevision,
    targetAuthorityDigest: binding.targetAuthorityDigest,
  });
  const supervisionRequest = Object.freeze({
    ...requestCore,
    requestDigest: hash(
      "chainlesschain.evolution-eval-supervision/v3/request",
      requestCore,
    ),
  });
  const invocation = Object.freeze({
    schema: "chainlesschain.evolution-eval-target-invocation-request/v2",
    requestDigest: supervisionRequest.requestDigest,
    capabilityDigest,
    invocationId,
    deadlineAt,
    payload: request,
    payloadDigest,
    target: binding.target,
    targetDigest: binding.targetDigest,
  });
  const invocationCapability = capability(
    binding,
    supervisionRequest,
    invocation,
  );
  let abortRevocation = null;
  const abort = () => {
    abortRevocation ??= invocationCapability.revoke({ mode: "hard-terminate" });
  };
  runtime.signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await binding.supervisor.run(
      supervisionRequest,
      invocationCapability,
    );
    if (runtime.signal.aborted)
      throw runtime.signal.reason ?? new Error("process reviewer was aborted");
    return Object.freeze({
      value: response.value,
      supervisionReceiptDigest: validateReceipt({
        receipt: response.receipt,
        request: supervisionRequest,
        binding,
        value: response.value,
      }),
    });
  } finally {
    runtime.signal.removeEventListener("abort", abort);
    if (abortRevocation !== null) await abortRevocation.catch(() => {});
  }
}
