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
import {
  createEvolutionEvalProcessRuntimeBroker,
  isEvolutionEvalProcessSupervisor,
} from "./evolution-eval-process-supervisor.js";

export const PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA =
  "chainlesschain.pm-exploration-runner-isolation/v1";
export const PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA_V2 =
  "chainlesschain.pm-exploration-runner-isolation/v2";
export const PM_EXPLORATION_RUNNER_EGRESS_EVIDENCE_SCHEMA =
  "chainlesschain.pm-exploration-runner-egress-evidence/v1";

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
    throw new TypeError("process runner clock is invalid");
  return Object.freeze({
    milliseconds,
    iso: new Date(milliseconds).toISOString(),
  });
}

function targetBinding(value) {
  const targetDigest = computeEvolutionEvalIsolatedTargetDigest(value);
  const targetAuthorityDigest =
    computeEvolutionEvalTargetAuthorityDigest(value);
  if (
    value.schema !== EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA ||
    value.isolation !== "process" ||
    value.operation !== "pm-exploration-run"
  ) {
    throw new TypeError(
      "PM exploration process runner requires a process-isolated run target",
    );
  }
  return Object.freeze({
    target: Object.freeze(structuredClone(value)),
    targetDigest,
    targetAuthorityDigest,
  });
}

function receiptDigest(value) {
  exact(value, SUPERVISION_RECEIPT_KEYS, "PM runner supervision receipt");
  return computeEvolutionEvalSignedEvidenceDigest(
    value,
    EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
  );
}

function validateReceipt({ receipt, request, binding, value }) {
  const digestValue = receiptDigest(receipt);
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
    throw new Error("PM runner process supervision receipt is invalid");
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
    throw new Error("PM runner process supervision attestation was rejected");
  return digestValue;
}

function capability(binding, request, invocation, runtimeBroker) {
  let revocation = null;
  return Object.freeze({
    async invoke() {
      const result = await binding.supervisor.invokeTarget(
        invocation,
        runtimeBroker,
      );
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

export function createPmExplorationProcessRunnerExecutor(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration process runner options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  const hasEgressBrokered = Reflect.ownKeys(options).includes("egressBrokered");
  exact(
    options,
    [
      "supervisor",
      "target",
      "maxWallClockMs",
      ...(hasNow ? ["now"] : []),
      ...(hasEgressBrokered ? ["egressBrokered"] : []),
    ],
    "PM exploration process runner options",
  );
  if (!isEvolutionEvalProcessSupervisor(options.supervisor))
    throw new TypeError("a branded evolution process supervisor is required");
  if (
    !Number.isSafeInteger(options.maxWallClockMs) ||
    options.maxWallClockMs < 1 ||
    options.maxWallClockMs > 600_000
  ) {
    throw new TypeError("process runner maxWallClockMs is out of bounds");
  }
  const now = hasNow ? options.now : Date.now;
  if (typeof now !== "function" || isProxy(now))
    throw new TypeError("process runner clock must be a direct function");
  const supervisorDescriptor = options.supervisor.authorityDescriptor;
  if (!supervisorDescriptor || typeof supervisorDescriptor !== "object")
    throw new TypeError("process supervisor authority descriptor is required");
  const captured = targetBinding(options.target);
  const egressBrokered = hasEgressBrokered ? options.egressBrokered : false;
  if (typeof egressBrokered !== "boolean")
    throw new TypeError("process runner egressBrokered must be a boolean");
  const descriptor = Object.freeze({
    schema: egressBrokered
      ? PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA_V2
      : PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA,
    mode: "process",
    brokerMode: egressBrokered
      ? "parent-budgeted-tools-memory-model"
      : "parent-budgeted-tools",
    targetDigest: captured.targetDigest,
    targetAuthorityDigest: captured.targetAuthorityDigest,
    handlerId: identifier(
      captured.target.handlerId,
      "process runner handlerId",
    ),
    handlerRevision: identifier(
      captured.target.handlerRevision,
      "process runner handlerRevision",
    ),
    operation: captured.target.operation,
    handlerArtifactDigest: digest(
      captured.target.handlerArtifactDigest,
      "process runner handlerArtifactDigest",
    ),
    supervisorAuthorityDigest: hash(
      "chainlesschain.pm-exploration-runner-supervisor-authority/v1",
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
    egressBrokered,
    maxWallClockMs: options.maxWallClockMs,
    now,
    supervisor: options.supervisor,
  });
  return executor;
}

export function inspectPmExplorationProcessRunnerExecutor(value) {
  const binding = EXECUTORS.get(value);
  if (!binding)
    throw new TypeError("a branded PM exploration process runner is required");
  return binding.descriptor;
}

export async function invokePmExplorationProcessRunner(
  executorValue,
  request,
  runtime,
) {
  const binding = EXECUTORS.get(executorValue);
  if (!binding)
    throw new TypeError("a branded PM exploration process runner is required");
  if (!(runtime?.signal instanceof AbortSignal))
    throw new TypeError("process runner requires a budget abort signal");
  if (runtime.signal.aborted)
    throw runtime.signal.reason ?? new Error("process runner was aborted");
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
  const egressEvents = [];
  let egressSequence = 0;
  const invokeEgress = async (kind, input, invoke) => {
    egressSequence += 1;
    const sequence = egressSequence;
    const value = await invoke(input);
    egressEvents.push(
      Object.freeze({
        sequence,
        kind,
        requestDigest: hash(
          `${PM_EXPLORATION_RUNNER_EGRESS_EVIDENCE_SCHEMA}/request`,
          input,
        ),
        resultDigest: hash(
          `${PM_EXPLORATION_RUNNER_EGRESS_EVIDENCE_SCHEMA}/result`,
          value,
        ),
      }),
    );
    return value;
  };
  const runtimeBroker = createEvolutionEvalProcessRuntimeBroker({
    recordTokens: async (count) => runtime.recordTokens(count),
    invokeTool: async (toolId, input) => runtime.invokeTool(toolId, input),
    ...(binding.egressBrokered
      ? {
          retrieveMemory: async (input) =>
            invokeEgress("memory-retrieval", input, (request) =>
              runtime.retrieveMemory(request),
            ),
          invokeModel: async (input) =>
            invokeEgress("model-egress", input, (request) =>
              runtime.invokeModel(request),
            ),
        }
      : {}),
  });
  const invocationCapability = capability(
    binding,
    supervisionRequest,
    invocation,
    runtimeBroker,
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
      throw runtime.signal.reason ?? new Error("process runner was aborted");
    const supervisionReceiptDigest = validateReceipt({
      receipt: response.receipt,
      request: supervisionRequest,
      binding,
      value: response.value,
    });
    const value = response.value;
    const egressEvidenceDigest = binding.egressBrokered
      ? hash(PM_EXPLORATION_RUNNER_EGRESS_EVIDENCE_SCHEMA, {
          requestDigest: request.requestDigest,
          events: [...egressEvents].sort(
            (left, right) => left.sequence - right.sequence,
          ),
        })
      : null;
    return Object.freeze({
      value,
      supervisionReceiptDigest,
      ...(binding.egressBrokered ? { egressEvidenceDigest } : {}),
    });
  } finally {
    runtime.signal.removeEventListener("abort", abort);
    if (abortRevocation !== null) await abortRevocation.catch(() => {});
  }
}
