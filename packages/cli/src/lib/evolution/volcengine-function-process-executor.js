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

export const VOLCENGINE_FUNCTION_PROCESS_EXECUTOR_SCHEMA =
  "chainlesschain.volcengine-function-process-executor/v1";
export const VOLCENGINE_FUNCTION_PROCESS_OPERATION =
  "volcengine-function-execute";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[^\p{Cc}]{1,256}$/u;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_FIELDS = 2048;
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
        !field?.enumerable ||
        !Object.hasOwn(field, "value")
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function cloneJsonData(value, label, state, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    depth >= MAX_JSON_DEPTH ||
    state.ancestors.has(value)
  ) {
    throw new TypeError(`${label} must be bounded plain JSON data`);
  }
  state.ancestors.add(value);
  try {
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError(`${label} must be bounded plain JSON data`);
    const keys = Reflect.ownKeys(value);
    const dataKeys = array ? keys.filter((key) => key !== "length") : keys;
    state.fields += dataKeys.length;
    if (state.fields > MAX_JSON_FIELDS)
      throw new TypeError(`${label} must be bounded plain JSON data`);
    if (
      dataKeys.some((key, index) => {
        const field = Object.getOwnPropertyDescriptor(value, key);
        return (
          typeof key !== "string" ||
          (array && key !== String(index)) ||
          (!array && ["__proto__", "constructor", "prototype"].includes(key)) ||
          !field?.enumerable ||
          !Object.hasOwn(field, "value")
        );
      })
    ) {
      throw new TypeError(`${label} must be bounded plain JSON data`);
    }
    if (array) {
      return Object.freeze(
        dataKeys.map((key) =>
          cloneJsonData(
            Object.getOwnPropertyDescriptor(value, key).value,
            label,
            state,
            depth + 1,
          ),
        ),
      );
    }
    const clone = {};
    for (const key of dataKeys) {
      clone[key] = cloneJsonData(
        Object.getOwnPropertyDescriptor(value, key).value,
        label,
        state,
        depth + 1,
      );
    }
    return Object.freeze(clone);
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizePayload(value) {
  const normalized = cloneJsonData(value, "Volcengine function request", {
    ancestors: new Set(),
    fields: 0,
  });
  if (
    !normalized ||
    Array.isArray(normalized) ||
    Buffer.byteLength(JSON.stringify(normalized)) > MAX_PAYLOAD_BYTES
  ) {
    throw new TypeError("Volcengine function request is invalid");
  }
  return normalized;
}

function contextSignal(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(
      "Volcengine function process executor requires an abort signal",
    );
  }
  const field = Object.getOwnPropertyDescriptor(value, "signal");
  if (!field?.enumerable || !Object.hasOwn(field, "value"))
    throw new TypeError(
      "Volcengine function process executor requires an abort signal",
    );
  return field.value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value))
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
    throw new TypeError("Volcengine process executor clock is invalid");
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
    value.operation !== VOLCENGINE_FUNCTION_PROCESS_OPERATION
  ) {
    throw new TypeError(
      "Volcengine function process executor requires a process-isolated execution target",
    );
  }
  return Object.freeze({
    target: Object.freeze(structuredClone(value)),
    targetDigest,
    targetAuthorityDigest,
  });
}

function receiptDigest(value) {
  exact(
    value,
    SUPERVISION_RECEIPT_KEYS,
    "Volcengine function supervision receipt",
  );
  return computeEvolutionEvalSignedEvidenceDigest(
    value,
    EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
  );
}

function validateReceipt({ receipt, request, binding, value, status }) {
  const digestValue = receiptDigest(receipt);
  const { attestation, ...core } = receipt;
  const requestedAt = Date.parse(request.requestedAt);
  const deadlineAt = Date.parse(request.deadlineAt);
  const completedAt = Date.parse(receipt.completedAt);
  const completed = status === "completed";
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
    !Number.isFinite(requestedAt) ||
    !Number.isFinite(deadlineAt) ||
    !Number.isFinite(completedAt) ||
    completedAt < requestedAt ||
    completedAt > deadlineAt ||
    receipt.status !== status ||
    receipt.isolation !== "process" ||
    receipt.hardDeadlineEnforced !== true ||
    receipt.lateSideEffectsPrevented !== true ||
    receipt.invocationCount !== 1 ||
    receipt.capabilityRevoked !== true ||
    receipt.resultDigest !==
      (completed ? computeEvolutionEvalSupervisedResultDigest(value) : null) ||
    (completed
      ? !DIGEST.test(receipt.targetInvocationDigest ?? "")
      : receipt.targetInvocationDigest !== null) ||
    !DIGEST.test(receipt.revocationDigest ?? "") ||
    receipt.revocationMode !==
      (completed ? "completed-release" : "hard-terminate") ||
    receipt.wasActive !== !completed ||
    receipt.activeInvocationTerminated !== !completed ||
    receipt.terminatedAt !== (completed ? null : request.deadlineAt) ||
    receipt.supervisorRevision !==
      binding.supervisor.authorityDescriptor.handlerRevision
  ) {
    throw new Error(
      "Volcengine function process supervision receipt is invalid",
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
    throw new Error(
      "Volcengine function process supervision attestation was rejected",
    );
  return digestValue;
}

function invocationCapability(binding, supervisionRequest, invocation) {
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
    async revoke({ mode, requestedAt = null }) {
      if (revocation !== null) return revocation;
      revocation = binding.supervisor
        .revokeTarget({
          requestDigest: supervisionRequest.requestDigest,
          capabilityDigest: supervisionRequest.capabilityDigest,
          targetDigest: binding.targetDigest,
          invocationId: supervisionRequest.invocationId,
          mode,
          requestedAt:
            requestedAt ??
            (mode === "hard-terminate"
              ? supervisionRequest.deadlineAt
              : timestamp(binding.now).iso),
          deadlineAt: supervisionRequest.deadlineAt,
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

export function createVolcengineFunctionProcessExecutor(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "Volcengine function process executor options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  exact(
    options,
    ["supervisor", "target", ...(hasNow ? ["now"] : [])],
    "Volcengine function process executor options",
  );
  if (!isEvolutionEvalProcessSupervisor(options.supervisor))
    throw new TypeError("a branded evolution process supervisor is required");
  const now = hasNow ? options.now : Date.now;
  if (typeof now !== "function" || isProxy(now))
    throw new TypeError(
      "Volcengine function process executor clock must be a direct function",
    );
  const supervisorDescriptor = options.supervisor.authorityDescriptor;
  if (!supervisorDescriptor || typeof supervisorDescriptor !== "object")
    throw new TypeError("process supervisor authority descriptor is required");
  if (!options.supervisor.childEvidenceStoreDescriptor)
    throw new TypeError(
      "Volcengine function process executor requires a durable child evidence store",
    );
  const captured = targetBinding(options.target);
  const descriptor = Object.freeze({
    schema: VOLCENGINE_FUNCTION_PROCESS_EXECUTOR_SCHEMA,
    mode: "process",
    targetDigest: captured.targetDigest,
    targetAuthorityDigest: captured.targetAuthorityDigest,
    handlerId: identifier(captured.target.handlerId, "process handlerId"),
    handlerRevision: identifier(
      captured.target.handlerRevision,
      "process handlerRevision",
    ),
    operation: captured.target.operation,
    handlerArtifactDigest: digest(
      captured.target.handlerArtifactDigest,
      "process handlerArtifactDigest",
    ),
    supervisorAuthorityDigest: hash(
      "chainlesschain.volcengine-function-process-supervisor-authority/v1",
      {
        authorityDescriptor: supervisorDescriptor,
        childEvidenceStoreDescriptor:
          options.supervisor.childEvidenceStoreDescriptor ?? null,
      },
    ),
  });
  const execute = async (request, context) =>
    invokeVolcengineFunctionProcessExecutor(execute, request, context);
  Object.freeze(execute);
  EXECUTORS.set(execute, {
    ...captured,
    descriptor,
    now,
    supervisor: options.supervisor,
  });
  return execute;
}

export function inspectVolcengineFunctionProcessExecutor(value) {
  const binding = EXECUTORS.get(value);
  if (!binding)
    throw new TypeError(
      "a branded Volcengine function process executor is required",
    );
  return binding.descriptor;
}

export async function invokeVolcengineFunctionProcessExecutor(
  executor,
  request,
  context,
) {
  const binding = EXECUTORS.get(executor);
  if (!binding)
    throw new TypeError(
      "a branded Volcengine function process executor is required",
    );
  const signal = contextSignal(context);
  if (!(signal instanceof AbortSignal))
    throw new TypeError(
      "Volcengine function process executor requires an abort signal",
    );
  if (signal.aborted)
    throw signal.reason ?? new Error("function execution was aborted");
  const payload = normalizePayload(request);
  const current = timestamp(binding.now);
  const deadlineAt = Date.parse(payload.deadlineAt);
  if (
    !Number.isFinite(deadlineAt) ||
    new Date(deadlineAt).toISOString() !== payload.deadlineAt ||
    deadlineAt <= current.milliseconds
  ) {
    throw new TypeError("Volcengine function process deadline is invalid");
  }
  const payloadDigest = hash(
    "chainlesschain.evolution-eval-supervision-payload/v1",
    payload,
  );
  const invocationNonce = `function-supervision-${randomBytes(16).toString("hex")}`;
  const invocationId = `function-invocation-${randomBytes(16).toString("hex")}`;
  const capabilityNonce = `function-capability-${randomBytes(16).toString("hex")}`;
  const capabilityDigest = hash(
    "chainlesschain.evolution-eval-invocation-capability/v1",
    {
      capabilityNonce,
      invocationNonce,
      invocationId,
      functionRequestDigest: digest(
        payload.requestDigest,
        "function requestDigest",
      ),
      payloadDigest,
      targetDigest: binding.targetDigest,
      deadlineAt: payload.deadlineAt,
    },
  );
  const supervisionRequest = Object.freeze({
    schema: "chainlesschain.evolution-eval-supervision-request/v3",
    operation: binding.target.operation,
    invocationNonce,
    invocationId,
    capabilityDigest,
    requestedAt: current.iso,
    deadlineAt: payload.deadlineAt,
    payloadDigest,
    targetDigest: binding.targetDigest,
    targetHandlerId: binding.target.handlerId,
    targetRevision: binding.target.handlerRevision,
    targetAuthorityDigest: binding.targetAuthorityDigest,
    requestDigest: payload.requestDigest,
  });
  const invocation = Object.freeze({
    schema: "chainlesschain.evolution-eval-target-invocation-request/v2",
    requestDigest: payload.requestDigest,
    capabilityDigest,
    invocationId,
    deadlineAt: payload.deadlineAt,
    payload,
    payloadDigest,
    target: binding.target,
    targetDigest: binding.targetDigest,
  });
  const capability = invocationCapability(
    binding,
    supervisionRequest,
    invocation,
  );
  let abortRevocation = null;
  const abort = () => {
    abortRevocation ??= capability.revoke({
      mode: "hard-terminate",
      requestedAt: timestamp(binding.now).iso,
    });
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    let response;
    try {
      response = await binding.supervisor.run(supervisionRequest, capability);
    } catch (cause) {
      if (signal.aborted)
        throw signal.reason ?? new Error("function execution was aborted");
      throw cause;
    }
    if (signal.aborted)
      throw signal.reason ?? new Error("function execution was aborted");
    if (response.receipt.status === "terminated") {
      validateReceipt({
        receipt: response.receipt,
        request: supervisionRequest,
        binding,
        value: null,
        status: "terminated",
      });
      const error = new Error(
        "Volcengine function process execution deadline exceeded",
      );
      error.code = "CC_VOLCENGINE_FUNCTION_DEADLINE_EXCEEDED";
      throw error;
    }
    validateReceipt({
      receipt: response.receipt,
      request: supervisionRequest,
      binding,
      value: response.value,
      status: "completed",
    });
    return response.value;
  } finally {
    signal.removeEventListener("abort", abort);
    if (abortRevocation !== null) await abortRevocation.catch(() => {});
  }
}
