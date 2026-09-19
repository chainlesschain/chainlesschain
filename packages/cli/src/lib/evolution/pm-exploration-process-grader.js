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

export const PM_EXPLORATION_GRADER_ISOLATION_SCHEMA =
  "chainlesschain.pm-exploration-grader-isolation/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const EXECUTORS = new WeakMap();
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
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || value.length > 256 || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function timestamp(now, label) {
  const value = Number(now());
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} clock is invalid`);
  return Object.freeze({
    milliseconds: value,
    iso: new Date(value).toISOString(),
  });
}

function cloneTarget(value) {
  const targetDigest = computeEvolutionEvalIsolatedTargetDigest(value);
  const targetAuthorityDigest =
    computeEvolutionEvalTargetAuthorityDigest(value);
  if (
    value.schema !== EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA ||
    value.isolation !== "process" ||
    value.operation !== "pm-exploration-grade"
  ) {
    throw new TypeError(
      "PM exploration process grader requires a process-isolated grade target",
    );
  }
  return Object.freeze({
    target: Object.freeze(structuredClone(value)),
    targetDigest,
    targetAuthorityDigest,
  });
}

function supervisionReceiptDigest(value) {
  exact(value, SUPERVISION_RECEIPT_KEYS, "PM grader supervision receipt");
  return computeEvolutionEvalSignedEvidenceDigest(
    value,
    EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
  );
}

function validateCompletedReceipt({
  receipt,
  request,
  target,
  targetDigest,
  targetAuthorityDigest,
  value,
  supervisor,
}) {
  const receiptDigest = supervisionReceiptDigest(receipt);
  const { attestation, ...core } = receipt;
  const completedAt = Date.parse(receipt.completedAt);
  if (
    receipt.schema !== EVOLUTION_EVAL_SUPERVISION_SCHEMA ||
    receipt.requestDigest !== request.requestDigest ||
    receipt.invocationNonce !== request.invocationNonce ||
    receipt.invocationId !== request.invocationId ||
    receipt.capabilityDigest !== request.capabilityDigest ||
    receipt.operation !== target.operation ||
    receipt.requestedAt !== request.requestedAt ||
    receipt.deadlineAt !== request.deadlineAt ||
    receipt.payloadDigest !== request.payloadDigest ||
    receipt.targetDigest !== targetDigest ||
    receipt.targetHandlerId !== target.handlerId ||
    receipt.targetRevision !== target.handlerRevision ||
    receipt.targetAuthorityDigest !== targetAuthorityDigest ||
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
      supervisor.authorityDescriptor.handlerRevision
  ) {
    throw new Error("PM grader process supervision receipt is invalid");
  }
  const verified = supervisor.verifyEnforcement({
    purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
    payloadDigest: buildEvolutionEvalAttestationDigest(
      core,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
    ),
    attestation,
  });
  if (verified !== true || (verified && typeof verified.then === "function"))
    throw new Error("PM grader process supervision attestation was rejected");
  return receiptDigest;
}

function invocationCapability({
  supervisor,
  request,
  invocation,
  targetDigest,
}) {
  let revocation = null;
  return Object.freeze({
    async invoke() {
      const result = await supervisor.invokeTarget(invocation);
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
      const requestedAt =
        mode === "hard-terminate"
          ? request.deadlineAt
          : new Date().toISOString();
      revocation = supervisor
        .revokeTarget({
          requestDigest: request.requestDigest,
          capabilityDigest: request.capabilityDigest,
          targetDigest,
          invocationId: request.invocationId,
          mode,
          requestedAt,
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

export function createPmExplorationProcessGraderExecutor(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration process grader options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  exact(
    options,
    hasNow
      ? ["supervisor", "target", "maxWallClockMs", "now"]
      : ["supervisor", "target", "maxWallClockMs"],
    "PM exploration process grader options",
  );
  if (!isEvolutionEvalProcessSupervisor(options.supervisor))
    throw new TypeError("a branded evolution process supervisor is required");
  if (
    !Number.isSafeInteger(options.maxWallClockMs) ||
    options.maxWallClockMs < 1 ||
    options.maxWallClockMs > 600_000
  ) {
    throw new TypeError("process grader maxWallClockMs is out of bounds");
  }
  const now = hasNow ? options.now : Date.now;
  if (typeof now !== "function" || isProxy(now))
    throw new TypeError("process grader clock must be a direct function");
  const supervisorDescriptor = options.supervisor.authorityDescriptor;
  if (!supervisorDescriptor || typeof supervisorDescriptor !== "object")
    throw new TypeError("process supervisor authority descriptor is required");
  const binding = cloneTarget(options.target);
  const descriptor = Object.freeze({
    schema: PM_EXPLORATION_GRADER_ISOLATION_SCHEMA,
    mode: "process",
    targetDigest: binding.targetDigest,
    targetAuthorityDigest: binding.targetAuthorityDigest,
    handlerId: identifier(binding.target.handlerId, "process grader handlerId"),
    handlerRevision: identifier(
      binding.target.handlerRevision,
      "process grader handlerRevision",
    ),
    operation: binding.target.operation,
    handlerArtifactDigest: digest(
      binding.target.handlerArtifactDigest,
      "process grader handlerArtifactDigest",
    ),
    supervisorAuthorityDigest: hash(
      "chainlesschain.pm-exploration-grader-supervisor-authority/v1",
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
    descriptor,
    maxWallClockMs: options.maxWallClockMs,
    now,
    supervisor: options.supervisor,
    target: binding.target,
    targetAuthorityDigest: binding.targetAuthorityDigest,
    targetDigest: binding.targetDigest,
  });
  return executor;
}

export function inspectPmExplorationProcessGraderExecutor(value) {
  const binding = EXECUTORS.get(value);
  if (!binding)
    throw new TypeError("a branded PM exploration process grader is required");
  return binding.descriptor;
}

export async function invokePmExplorationProcessGrader(
  executorValue,
  request,
  runtime,
) {
  const binding = EXECUTORS.get(executorValue);
  if (!binding)
    throw new TypeError("a branded PM exploration process grader is required");
  if (!(runtime?.signal instanceof AbortSignal))
    throw new TypeError("process grader requires a budget abort signal");
  if (runtime.signal.aborted)
    throw runtime.signal.reason ?? new Error("process grader was aborted");
  const current = timestamp(binding.now, "process grader");
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
  const capability = invocationCapability({
    supervisor: binding.supervisor,
    request: supervisionRequest,
    invocation,
    targetDigest: binding.targetDigest,
  });
  let abortRevocation = null;
  const abort = () => {
    abortRevocation ??= capability.revoke({ mode: "hard-terminate" });
  };
  runtime.signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await binding.supervisor.run(
      supervisionRequest,
      capability,
    );
    if (runtime.signal.aborted)
      throw runtime.signal.reason ?? new Error("process grader was aborted");
    const receiptDigest = validateCompletedReceipt({
      receipt: response.receipt,
      request: supervisionRequest,
      target: binding.target,
      targetDigest: binding.targetDigest,
      targetAuthorityDigest: binding.targetAuthorityDigest,
      value: response.value,
      supervisor: binding.supervisor,
    });
    exact(
      response.value,
      ["decision", "scoreBasisPoints", "resultDigest"],
      "PM process grader result",
    );
    return Object.freeze({
      decision: response.value.decision,
      scoreBasisPoints: response.value.scoreBasisPoints,
      resultDigest: hash("chainlesschain.pm-exploration-process-grade/v1", {
        requestDigest: request.requestDigest,
        targetResultDigest: digest(
          response.value.resultDigest,
          "process grader resultDigest",
        ),
        supervisionReceiptDigest: receiptDigest,
        targetDigest: binding.targetDigest,
      }),
    });
  } finally {
    runtime.signal.removeEventListener("abort", abort);
    if (abortRevocation !== null) await abortRevocation.catch(() => {});
  }
}
