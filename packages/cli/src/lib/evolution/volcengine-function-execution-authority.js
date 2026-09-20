import { createHash } from "node:crypto";
import { types } from "node:util";

import {
  VOLCENGINE_FUNCTION_REPLAY_MODE,
  VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
  VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_MODE,
  VOLCENGINE_FUNCTION_REVOCATION_SCHEMA,
  captureVolcengineFunctionReplayStore,
} from "./volcengine-function-replay-store.js";

export const VOLCENGINE_FUNCTION_AUTHORITY_SCHEMA =
  "chainlesschain.volcengine-function-authority/v5";
export const VOLCENGINE_FUNCTION_REQUEST_SCHEMA =
  "chainlesschain.volcengine-function-request/v5";
export const VOLCENGINE_FUNCTION_RECEIPT_SCHEMA =
  "chainlesschain.volcengine-function-receipt/v5";
export const VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA =
  "chainlesschain.volcengine-function-audit-evidence/v5";
export const VOLCENGINE_FUNCTION_PURPOSE = "model-tool-execution";
export const VOLCENGINE_FUNCTION_AUDIT_MODE = "authenticated-durable-readback";
export const VOLCENGINE_FUNCTION_EXECUTOR_TYPE = "capability";
export const VOLCENGINE_FUNCTION_REVOCATION_AUTHORITY_SCHEMA =
  "chainlesschain.volcengine-function-revocation-authority/v1";
export const VOLCENGINE_FUNCTION_REVOCATION_REQUEST_SCHEMA =
  "chainlesschain.volcengine-function-revocation-request/v1";
export const VOLCENGINE_FUNCTION_REVOCATION_RESULT_SCHEMA =
  "chainlesschain.volcengine-function-revocation-result/v1";
export const VOLCENGINE_FUNCTION_REVOCATION_PURPOSE =
  "revoke-model-tool-execution";
export const VOLCENGINE_FUNCTION_REVOCATION_APPROVAL_MODE = "operator-signed";

const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_FIELDS = 512;
const MAX_POLICY_ARGUMENT_KEYS = 64;
const MAX_EXECUTION_MS = 120_000;
const MAX_REQUEST_AGE_MS = 60_000;
const MAX_CLOCK_SKEW_MS = 5_000;
const MAX_REPLAY_ENTRIES = 4_096;
const REPLAY_RETENTION_MS = MAX_REQUEST_AGE_MS + MAX_CLOCK_SKEW_MS;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[^\p{Cc}]{1,512}$/u;
const BUILTIN_FUNCTIONS = Object.freeze([
  "create_note",
  "delete_note",
  "get_note",
  "get_system_info",
  "list_files",
  "read_file",
  "search_notes",
  "send_p2p_message",
  "update_note",
]);
const BUILTIN_FUNCTION_SET = new Set(BUILTIN_FUNCTIONS);
const authorities = new WeakMap();
const revocationAuthorities = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function exactData(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !Object.hasOwn(descriptor, "value");
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function ownData(owner, name, label) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} must be plain data`);
  }
  return descriptor.value;
}

function directArrayValues(value, label, maxLength) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length > maxLength
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some((key) => {
      if (key === "length") return false;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)) {
        return true;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const index = Number(key);
      return (
        !Number.isSafeInteger(index) ||
        index >= value.length ||
        !descriptor?.enumerable ||
        !Object.hasOwn(descriptor, "value")
      );
    })
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return Array.from({ length: value.length }, (_unused, index) =>
    ownData(value, String(index), label),
  );
}

function cloneJson(value, label, state, depth) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_RESULT_BYTES || value.includes("\u0000")) {
      throw new TypeError(`${label} contains an invalid string`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} contains an invalid number`);
    }
    return value;
  }
  if (typeof value !== "object" || types.isProxy(value)) {
    throw new TypeError(`${label} is not JSON data`);
  }
  if (depth >= MAX_JSON_DEPTH || state.ancestors.has(value)) {
    throw new TypeError(`${label} is too deep or cyclic`);
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = directArrayValues(value, label, MAX_JSON_FIELDS);
      state.fields += entries.length;
      if (state.fields > MAX_JSON_FIELDS) {
        throw new TypeError(`${label} has too many fields`);
      }
      return Object.freeze(
        entries.map((entry) => cloneJson(entry, label, state, depth + 1)),
      );
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new TypeError(`${label} is not plain JSON data`);
    }
    const keys = Reflect.ownKeys(value);
    state.fields += keys.length;
    if (state.fields > MAX_JSON_FIELDS) {
      throw new TypeError(`${label} has too many fields`);
    }
    const projected = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        key.length < 1 ||
        key.length > 256 ||
        /\p{Cc}/u.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        !descriptor?.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        throw new TypeError(`${label} has unexpected or accessor fields`);
      }
      projected[key] = cloneJson(descriptor.value, label, state, depth + 1);
    }
    return Object.freeze(projected);
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizeJson(value, label, maxBytes) {
  const normalized = cloneJson(
    value,
    label,
    { ancestors: new Set(), fields: 0 },
    0,
  );
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > maxBytes) {
    throw new TypeError(`${label} is too large`);
  }
  return normalized;
}

export function digestVolcengineFunctionResult(value) {
  return digest(
    "chainlesschain.volcengine-function-result/v1",
    normalizeJson(value, "Volcengine function result", MAX_RESULT_BYTES),
  );
}

function normalizeAllowedFunctions(value) {
  const names = directArrayValues(
    value,
    "Volcengine function authority allowlist",
    BUILTIN_FUNCTIONS.length,
  );
  if (
    names.some((name) => !BUILTIN_FUNCTION_SET.has(name)) ||
    new Set(names).size !== names.length ||
    [...names].sort().some((name, index) => name !== names[index])
  ) {
    throw new TypeError("Volcengine function authority allowlist is invalid");
  }
  return Object.freeze([...names]);
}

function normalizeArgumentKeys(value, label) {
  const keys = directArrayValues(value, label, MAX_POLICY_ARGUMENT_KEYS);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        key.length < 1 ||
        key.length > 256 ||
        /\p{Cc}/u.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key),
    ) ||
    new Set(keys).size !== keys.length ||
    [...keys].sort().some((key, index) => key !== keys[index])
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return Object.freeze([...keys]);
}

function normalizeFunctionPolicies(value, allowedFunctions) {
  const entries = directArrayValues(
    value,
    "Volcengine function policies",
    BUILTIN_FUNCTIONS.length,
  );
  const policies = entries.map((entry) => {
    exactData(
      entry,
      [
        "functionName",
        "allowedArgumentKeys",
        "maxArgumentBytes",
        "maxResultBytes",
        "maxExecutionMs",
      ],
      "Volcengine function policy",
    );
    const policy = Object.freeze({
      functionName: ownData(
        entry,
        "functionName",
        "Volcengine function policy name",
      ),
      allowedArgumentKeys: normalizeArgumentKeys(
        ownData(
          entry,
          "allowedArgumentKeys",
          "Volcengine function policy argument keys",
        ),
        "Volcengine function policy argument keys",
      ),
      maxArgumentBytes: ownData(
        entry,
        "maxArgumentBytes",
        "Volcengine function policy argument budget",
      ),
      maxResultBytes: ownData(
        entry,
        "maxResultBytes",
        "Volcengine function policy result budget",
      ),
      maxExecutionMs: ownData(
        entry,
        "maxExecutionMs",
        "Volcengine function policy execution deadline",
      ),
    });
    if (
      !BUILTIN_FUNCTION_SET.has(policy.functionName) ||
      !Number.isSafeInteger(policy.maxArgumentBytes) ||
      policy.maxArgumentBytes < 2 ||
      policy.maxArgumentBytes > MAX_ARGUMENT_BYTES ||
      !Number.isSafeInteger(policy.maxResultBytes) ||
      policy.maxResultBytes < 1 ||
      policy.maxResultBytes > MAX_RESULT_BYTES ||
      !Number.isSafeInteger(policy.maxExecutionMs) ||
      policy.maxExecutionMs < 1 ||
      policy.maxExecutionMs > MAX_EXECUTION_MS
    ) {
      throw new TypeError("Volcengine function policy is invalid");
    }
    return policy;
  });
  if (
    policies.length !== allowedFunctions.length ||
    policies.some(
      (policy, index) => policy.functionName !== allowedFunctions[index],
    )
  ) {
    throw new TypeError(
      "Volcengine function policies must exactly cover the allowlist",
    );
  }
  return Object.freeze(policies);
}

function functionPolicy(descriptor, functionName) {
  return descriptor.functionPolicies.find(
    (policy) => policy.functionName === functionName,
  );
}

function digestFunctionPolicy(policy) {
  return digest("chainlesschain.volcengine-function-policy/v1", policy);
}

function validatePolicyArguments(value, policy) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !policy.allowedArgumentKeys.includes(key))
  ) {
    throw new TypeError("Volcengine function arguments violate policy");
  }
}

function normalizeDescriptor(value) {
  exactData(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "replayStoreId",
      "replayRetentionMs",
      "replayMode",
      "revocationMode",
      "purpose",
      "allowedFunctions",
      "functionPolicies",
      "auditMode",
    ],
    "Volcengine function authority descriptor",
  );
  const allowedFunctions = normalizeAllowedFunctions(
    ownData(
      value,
      "allowedFunctions",
      "Volcengine function authority allowlist",
    ),
  );
  const descriptor = Object.freeze({
    schema: ownData(value, "schema", "Volcengine function authority schema"),
    authorityId: ownData(
      value,
      "authorityId",
      "Volcengine function authority identifier",
    ),
    tenantId: ownData(
      value,
      "tenantId",
      "Volcengine function authority tenant",
    ),
    handlerArtifactDigest: ownData(
      value,
      "handlerArtifactDigest",
      "Volcengine function authority artifact digest",
    ),
    policyRevision: ownData(
      value,
      "policyRevision",
      "Volcengine function authority policy revision",
    ),
    replayStoreId: ownData(
      value,
      "replayStoreId",
      "Volcengine function replay store identifier",
    ),
    replayRetentionMs: ownData(
      value,
      "replayRetentionMs",
      "Volcengine function replay retention",
    ),
    replayMode: ownData(value, "replayMode", "Volcengine function replay mode"),
    revocationMode: ownData(
      value,
      "revocationMode",
      "Volcengine function revocation mode",
    ),
    purpose: ownData(value, "purpose", "Volcengine function authority purpose"),
    allowedFunctions,
    functionPolicies: normalizeFunctionPolicies(
      ownData(
        value,
        "functionPolicies",
        "Volcengine function authority policies",
      ),
      allowedFunctions,
    ),
    auditMode: ownData(
      value,
      "auditMode",
      "Volcengine function authority audit mode",
    ),
  });
  if (
    descriptor.schema !== VOLCENGINE_FUNCTION_AUTHORITY_SCHEMA ||
    !ID.test(descriptor.authorityId) ||
    !ID.test(descriptor.tenantId) ||
    !DIGEST.test(descriptor.handlerArtifactDigest) ||
    !ID.test(descriptor.policyRevision) ||
    !ID.test(descriptor.replayStoreId) ||
    !Number.isSafeInteger(descriptor.replayRetentionMs) ||
    descriptor.replayRetentionMs < REPLAY_RETENTION_MS ||
    descriptor.replayRetentionMs > 24 * 60 * 60 * 1000 ||
    descriptor.replayMode !== VOLCENGINE_FUNCTION_REPLAY_MODE ||
    descriptor.revocationMode !== VOLCENGINE_FUNCTION_REVOCATION_MODE ||
    descriptor.purpose !== VOLCENGINE_FUNCTION_PURPOSE ||
    descriptor.auditMode !== VOLCENGINE_FUNCTION_AUDIT_MODE
  ) {
    throw new TypeError("Volcengine function authority descriptor is invalid");
  }
  return descriptor;
}

function normalizeRequest(value, descriptor, nowMs) {
  exactData(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "replayStoreId",
      "revocationMode",
      "actorDid",
      "purpose",
      "requestId",
      "senderId",
      "executorType",
      "functionName",
      "functionPolicyDigest",
      "arguments",
      "argumentsDigest",
      "requestedAt",
      "deadlineAt",
      "requestDigest",
    ],
    "Volcengine function request",
  );
  const requestedFunctionName = ownData(
    value,
    "functionName",
    "Volcengine function name",
  );
  const policy = functionPolicy(descriptor, requestedFunctionName);
  if (!policy) {
    throw new TypeError("Volcengine function request is invalid");
  }
  const normalizedArguments = normalizeJson(
    ownData(value, "arguments", "Volcengine function arguments"),
    "Volcengine function arguments",
    policy.maxArgumentBytes,
  );
  validatePolicyArguments(normalizedArguments, policy);
  const core = Object.freeze({
    schema: ownData(value, "schema", "Volcengine function request schema"),
    authorityId: ownData(
      value,
      "authorityId",
      "Volcengine function request authority",
    ),
    tenantId: ownData(value, "tenantId", "Volcengine function request tenant"),
    handlerArtifactDigest: ownData(
      value,
      "handlerArtifactDigest",
      "Volcengine function request artifact digest",
    ),
    policyRevision: ownData(
      value,
      "policyRevision",
      "Volcengine function request policy revision",
    ),
    replayStoreId: ownData(
      value,
      "replayStoreId",
      "Volcengine function request replay store",
    ),
    revocationMode: ownData(
      value,
      "revocationMode",
      "Volcengine function request revocation mode",
    ),
    actorDid: ownData(value, "actorDid", "Volcengine function request actor"),
    purpose: ownData(value, "purpose", "Volcengine function request purpose"),
    requestId: ownData(
      value,
      "requestId",
      "Volcengine function request identifier",
    ),
    senderId: ownData(value, "senderId", "Volcengine function request sender"),
    executorType: ownData(
      value,
      "executorType",
      "Volcengine function executor type",
    ),
    functionName: requestedFunctionName,
    functionPolicyDigest: ownData(
      value,
      "functionPolicyDigest",
      "Volcengine function policy digest",
    ),
    arguments: normalizedArguments,
    argumentsDigest: ownData(
      value,
      "argumentsDigest",
      "Volcengine function arguments digest",
    ),
    requestedAt: ownData(
      value,
      "requestedAt",
      "Volcengine function request time",
    ),
    deadlineAt: ownData(
      value,
      "deadlineAt",
      "Volcengine function request deadline",
    ),
  });
  const requestDigest = ownData(
    value,
    "requestDigest",
    "Volcengine function request digest",
  );
  const requestedAtMs = Date.parse(core.requestedAt);
  const deadlineAtMs = Date.parse(core.deadlineAt);
  if (
    core.schema !== VOLCENGINE_FUNCTION_REQUEST_SCHEMA ||
    core.authorityId !== descriptor.authorityId ||
    core.tenantId !== descriptor.tenantId ||
    core.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    core.policyRevision !== descriptor.policyRevision ||
    core.replayStoreId !== descriptor.replayStoreId ||
    core.revocationMode !== descriptor.revocationMode ||
    !ID.test(core.actorDid) ||
    core.purpose !== VOLCENGINE_FUNCTION_PURPOSE ||
    !ID.test(core.requestId) ||
    !Number.isSafeInteger(core.senderId) ||
    core.senderId < 0 ||
    core.executorType !== VOLCENGINE_FUNCTION_EXECUTOR_TYPE ||
    !descriptor.allowedFunctions.includes(core.functionName) ||
    core.functionPolicyDigest !== digestFunctionPolicy(policy) ||
    core.argumentsDigest !==
      digest(
        "chainlesschain.volcengine-function-arguments/v1",
        normalizedArguments,
      ) ||
    !Number.isFinite(requestedAtMs) ||
    new Date(requestedAtMs).toISOString() !== core.requestedAt ||
    requestedAtMs < nowMs - MAX_REQUEST_AGE_MS ||
    requestedAtMs > nowMs + MAX_CLOCK_SKEW_MS ||
    !Number.isFinite(deadlineAtMs) ||
    new Date(deadlineAtMs).toISOString() !== core.deadlineAt ||
    deadlineAtMs <= nowMs ||
    deadlineAtMs <= requestedAtMs ||
    deadlineAtMs > requestedAtMs + policy.maxExecutionMs ||
    requestDigest !==
      digest("chainlesschain.volcengine-function-request/v5", core)
  ) {
    throw new TypeError("Volcengine function request is invalid");
  }
  return Object.freeze({
    ...core,
    requestDigest,
    requestedAtMs,
    deadlineAtMs,
  });
}

function createReplayReservation(request, descriptor) {
  const core = Object.freeze({
    schema: VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
    replayStoreId: descriptor.replayStoreId,
    authorityId: descriptor.authorityId,
    tenantId: descriptor.tenantId,
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    policyRevision: descriptor.policyRevision,
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    expiresAt: new Date(
      request.deadlineAtMs + descriptor.replayRetentionMs,
    ).toISOString(),
  });
  return Object.freeze({
    ...core,
    reservationDigest: digest(
      VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
      core,
    ),
  });
}

function validateReplayReservationAck(value, reservation) {
  exactData(
    value,
    ["reservationDigest", "durable", "readbackVerified"],
    "Volcengine function replay reservation acknowledgement",
  );
  if (
    ownData(
      value,
      "reservationDigest",
      "Volcengine function replay acknowledgement digest",
    ) !== reservation.reservationDigest ||
    ownData(
      value,
      "durable",
      "Volcengine function replay acknowledgement durability",
    ) !== true ||
    ownData(
      value,
      "readbackVerified",
      "Volcengine function replay acknowledgement readback",
    ) !== true
  ) {
    throw new TypeError(
      "Volcengine function replay reservation acknowledgement is invalid",
    );
  }
}

function validateAuditEvidence(
  value,
  request,
  descriptor,
  resultDigest,
  nowMs,
) {
  exactData(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "requestId",
      "requestDigest",
      "functionPolicyDigest",
      "replayReservationDigest",
      "deadlineAt",
      "resultDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "completedAt",
    ],
    "Volcengine function audit evidence",
  );
  const completedAt = ownData(
    value,
    "completedAt",
    "Volcengine function completion time",
  );
  const completedAtMs = Date.parse(completedAt);
  if (
    ownData(value, "schema", "Volcengine function audit schema") !==
      VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA ||
    ownData(value, "authorityId", "Volcengine function audit authority") !==
      descriptor.authorityId ||
    ownData(value, "tenantId", "Volcengine function audit tenant") !==
      descriptor.tenantId ||
    ownData(
      value,
      "handlerArtifactDigest",
      "Volcengine function audit artifact digest",
    ) !== descriptor.handlerArtifactDigest ||
    ownData(
      value,
      "policyRevision",
      "Volcengine function audit policy revision",
    ) !== descriptor.policyRevision ||
    ownData(value, "requestId", "Volcengine function audit request") !==
      request.requestId ||
    ownData(
      value,
      "requestDigest",
      "Volcengine function audit request digest",
    ) !== request.requestDigest ||
    ownData(
      value,
      "functionPolicyDigest",
      "Volcengine function audit policy digest",
    ) !== request.functionPolicyDigest ||
    ownData(
      value,
      "replayReservationDigest",
      "Volcengine function audit replay reservation digest",
    ) !== request.replayReservationDigest ||
    ownData(value, "deadlineAt", "Volcengine function audit deadline") !==
      request.deadlineAt ||
    ownData(
      value,
      "resultDigest",
      "Volcengine function audit result digest",
    ) !== resultDigest ||
    !DIGEST.test(
      ownData(
        value,
        "auditEventDigest",
        "Volcengine function audit event digest",
      ),
    ) ||
    !DIGEST.test(
      ownData(
        value,
        "durabilityReceiptDigest",
        "Volcengine function durability receipt digest",
      ),
    ) ||
    ownData(
      value,
      "authenticated",
      "Volcengine function audit authentication",
    ) !== true ||
    ownData(value, "durable", "Volcengine function audit durability") !==
      true ||
    ownData(value, "readbackVerified", "Volcengine function audit readback") !==
      true ||
    !Number.isFinite(completedAtMs) ||
    new Date(completedAtMs).toISOString() !== completedAt ||
    completedAtMs < request.requestedAtMs ||
    completedAtMs > request.deadlineAtMs ||
    completedAtMs > nowMs + MAX_CLOCK_SKEW_MS
  ) {
    throw new TypeError("Volcengine function audit evidence is invalid");
  }
  return Object.freeze({
    auditEventDigest: value.auditEventDigest,
    durabilityReceiptDigest: value.durabilityReceiptDigest,
    completedAt,
  });
}

function reserveRequest(captured, request, nowMs) {
  for (const [requestId, entry] of captured.requests) {
    if (entry.expiresAtMs < nowMs) captured.requests.delete(requestId);
  }
  if (captured.requests.has(request.requestId)) {
    throw new TypeError("Volcengine function request was replayed");
  }
  if (captured.requests.size >= MAX_REPLAY_ENTRIES) {
    throw new Error("Volcengine function request replay fence is full");
  }
  captured.requests.set(
    request.requestId,
    Object.freeze({
      requestDigest: request.requestDigest,
      expiresAtMs: request.deadlineAtMs + captured.descriptor.replayRetentionMs,
    }),
  );
}

function normalizeRevocationAuthorityDescriptor(value) {
  exactData(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "targetAuthorityId",
      "targetReplayStoreId",
      "targetPolicyRevision",
      "maxGrantTtlMs",
      "approvalMode",
      "auditMode",
    ],
    "Volcengine function revocation authority descriptor",
  );
  const descriptor = Object.freeze({
    schema: ownData(
      value,
      "schema",
      "Volcengine function revocation authority schema",
    ),
    authorityId: ownData(
      value,
      "authorityId",
      "Volcengine function revocation authority identifier",
    ),
    tenantId: ownData(
      value,
      "tenantId",
      "Volcengine function revocation authority tenant",
    ),
    handlerArtifactDigest: ownData(
      value,
      "handlerArtifactDigest",
      "Volcengine function revocation authority artifact digest",
    ),
    policyRevision: ownData(
      value,
      "policyRevision",
      "Volcengine function revocation policy revision",
    ),
    targetAuthorityId: ownData(
      value,
      "targetAuthorityId",
      "Volcengine function revocation target authority",
    ),
    targetReplayStoreId: ownData(
      value,
      "targetReplayStoreId",
      "Volcengine function revocation target replay store",
    ),
    targetPolicyRevision: ownData(
      value,
      "targetPolicyRevision",
      "Volcengine function revocation target policy revision",
    ),
    maxGrantTtlMs: ownData(
      value,
      "maxGrantTtlMs",
      "Volcengine function revocation grant TTL",
    ),
    approvalMode: ownData(
      value,
      "approvalMode",
      "Volcengine function revocation approval mode",
    ),
    auditMode: ownData(
      value,
      "auditMode",
      "Volcengine function revocation audit mode",
    ),
  });
  if (
    descriptor.schema !== VOLCENGINE_FUNCTION_REVOCATION_AUTHORITY_SCHEMA ||
    !ID.test(descriptor.authorityId) ||
    !ID.test(descriptor.tenantId) ||
    !DIGEST.test(descriptor.handlerArtifactDigest) ||
    !ID.test(descriptor.policyRevision) ||
    !ID.test(descriptor.targetAuthorityId) ||
    !ID.test(descriptor.targetReplayStoreId) ||
    !ID.test(descriptor.targetPolicyRevision) ||
    !Number.isSafeInteger(descriptor.maxGrantTtlMs) ||
    descriptor.maxGrantTtlMs < 1 ||
    descriptor.maxGrantTtlMs > 60_000 ||
    descriptor.approvalMode !== VOLCENGINE_FUNCTION_REVOCATION_APPROVAL_MODE ||
    descriptor.auditMode !== VOLCENGINE_FUNCTION_AUDIT_MODE
  ) {
    throw new TypeError(
      "Volcengine function revocation authority descriptor is invalid",
    );
  }
  return descriptor;
}

function assertRevocationTargetBinding(target, descriptor) {
  if (
    target.authorityId !== descriptor.targetAuthorityId ||
    target.tenantId !== descriptor.tenantId ||
    target.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    target.policyRevision !== descriptor.targetPolicyRevision ||
    target.replayStoreId !== descriptor.targetReplayStoreId
  ) {
    throw new TypeError(
      "Volcengine function revocation target does not match authority",
    );
  }
}

function normalizeRevocationRequest(value, descriptor, nowMs) {
  exactData(
    value,
    [
      "schema",
      "requestId",
      "actorDid",
      "tenantId",
      "purpose",
      "reasonDigest",
      "authorization",
      "requestedAt",
    ],
    "Volcengine function revocation request",
  );
  const authorization = normalizeJson(
    ownData(
      value,
      "authorization",
      "Volcengine function revocation authorization",
    ),
    "Volcengine function revocation authorization",
    16 * 1024,
  );
  const requestedAt = ownData(
    value,
    "requestedAt",
    "Volcengine function revocation request time",
  );
  const requestedAtMs = Date.parse(requestedAt);
  const core = Object.freeze({
    schema: ownData(
      value,
      "schema",
      "Volcengine function revocation request schema",
    ),
    authorityId: descriptor.authorityId,
    tenantId: ownData(
      value,
      "tenantId",
      "Volcengine function revocation request tenant",
    ),
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    policyRevision: descriptor.policyRevision,
    targetAuthorityId: descriptor.targetAuthorityId,
    targetReplayStoreId: descriptor.targetReplayStoreId,
    targetPolicyRevision: descriptor.targetPolicyRevision,
    actorDid: ownData(
      value,
      "actorDid",
      "Volcengine function revocation actor",
    ),
    purpose: ownData(
      value,
      "purpose",
      "Volcengine function revocation purpose",
    ),
    requestId: ownData(
      value,
      "requestId",
      "Volcengine function revocation request identifier",
    ),
    reasonDigest: ownData(
      value,
      "reasonDigest",
      "Volcengine function revocation reason digest",
    ),
    authorizationDigest: digest(
      "chainlesschain.volcengine-function-revocation-authorization/v1",
      authorization,
    ),
    requestedAt,
  });
  if (
    core.schema !== VOLCENGINE_FUNCTION_REVOCATION_REQUEST_SCHEMA ||
    core.tenantId !== descriptor.tenantId ||
    !ID.test(core.actorDid) ||
    core.purpose !== VOLCENGINE_FUNCTION_REVOCATION_PURPOSE ||
    !ID.test(core.requestId) ||
    !DIGEST.test(core.reasonDigest) ||
    !Number.isFinite(requestedAtMs) ||
    new Date(requestedAtMs).toISOString() !== core.requestedAt ||
    requestedAtMs < nowMs - MAX_REQUEST_AGE_MS ||
    requestedAtMs > nowMs + MAX_CLOCK_SKEW_MS
  ) {
    throw new TypeError("Volcengine function revocation request is invalid");
  }
  return Object.freeze({
    ...core,
    requestDigest: digest(VOLCENGINE_FUNCTION_REVOCATION_REQUEST_SCHEMA, core),
    authorization,
  });
}

function normalizeRevocationDecision(value, request, descriptor, nowMs) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Volcengine function revocation decision is invalid");
  }
  const decision = ownData(
    value,
    "decision",
    "Volcengine function revocation decision",
  );
  if (decision === "deny") {
    exactData(value, ["decision"], "Volcengine function revocation denial");
    return Object.freeze({ decision });
  }
  exactData(
    value,
    [
      "decision",
      "requestDigest",
      "authorizationEvidenceDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "authorizedAt",
      "validUntil",
    ],
    "Volcengine function revocation decision",
  );
  const validUntil = ownData(
    value,
    "validUntil",
    "Volcengine function revocation decision expiry",
  );
  const authorizedAt = ownData(
    value,
    "authorizedAt",
    "Volcengine function revocation authorization time",
  );
  const authorizedAtMs = Date.parse(authorizedAt);
  const validUntilMs = Date.parse(validUntil);
  const normalized = Object.freeze({
    decision,
    requestDigest: ownData(
      value,
      "requestDigest",
      "Volcengine function revocation decision request digest",
    ),
    authorizationEvidenceDigest: ownData(
      value,
      "authorizationEvidenceDigest",
      "Volcengine function revocation authorization evidence digest",
    ),
    auditEventDigest: ownData(
      value,
      "auditEventDigest",
      "Volcengine function revocation audit event digest",
    ),
    durabilityReceiptDigest: ownData(
      value,
      "durabilityReceiptDigest",
      "Volcengine function revocation durability receipt digest",
    ),
    authenticated: ownData(
      value,
      "authenticated",
      "Volcengine function revocation authentication status",
    ),
    durable: ownData(
      value,
      "durable",
      "Volcengine function revocation durability status",
    ),
    readbackVerified: ownData(
      value,
      "readbackVerified",
      "Volcengine function revocation readback status",
    ),
    authorizedAt,
    authorizedAtMs,
    validUntil,
    validUntilMs,
  });
  if (
    normalized.decision !== "allow" ||
    normalized.requestDigest !== request.requestDigest ||
    !DIGEST.test(normalized.authorizationEvidenceDigest) ||
    !DIGEST.test(normalized.auditEventDigest) ||
    !DIGEST.test(normalized.durabilityReceiptDigest) ||
    normalized.authenticated !== true ||
    normalized.durable !== true ||
    normalized.readbackVerified !== true ||
    !Number.isFinite(authorizedAtMs) ||
    new Date(authorizedAtMs).toISOString() !== authorizedAt ||
    authorizedAtMs < Date.parse(request.requestedAt) ||
    authorizedAtMs > nowMs + MAX_CLOCK_SKEW_MS ||
    !Number.isFinite(validUntilMs) ||
    new Date(validUntilMs).toISOString() !== validUntil ||
    validUntilMs <= authorizedAtMs ||
    validUntilMs > authorizedAtMs + descriptor.maxGrantTtlMs
  ) {
    throw new TypeError("Volcengine function revocation decision is invalid");
  }
  return normalized;
}

function revokedError() {
  const error = new Error(
    "Volcengine function execution authority was revoked",
  );
  error.code = "CC_VOLCENGINE_FUNCTION_AUTHORITY_REVOKED";
  return error;
}

function revocationStatusError(cause) {
  const error = new Error(
    "Volcengine function authority revocation status is unavailable",
    { cause },
  );
  error.code = "CC_VOLCENGINE_FUNCTION_REVOCATION_STATUS_UNAVAILABLE";
  return error;
}

function markAuthorityRevoked(captured) {
  if (captured.revoked) return false;
  captured.revoked = true;
  for (const controller of captured.activeExecutions) {
    controller.abort(revokedError());
  }
  return true;
}

function synchronizeDurableRevocation(captured) {
  let revocation;
  try {
    revocation = Reflect.apply(captured.readRevocation, undefined, []);
  } catch (cause) {
    throw revocationStatusError(cause);
  }
  if (revocation === null) return false;
  exactData(
    revocation,
    [
      "schema",
      "replayStoreId",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "revocationId",
      "reasonDigest",
      "authorizationEvidenceDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "revokedAt",
      "revocationDigest",
    ],
    "Volcengine function authority revocation record",
  );
  if (
    revocation.schema !== VOLCENGINE_FUNCTION_REVOCATION_SCHEMA ||
    revocation.replayStoreId !== captured.descriptor.replayStoreId ||
    revocation.authorityId !== captured.descriptor.authorityId ||
    revocation.tenantId !== captured.descriptor.tenantId ||
    revocation.handlerArtifactDigest !==
      captured.descriptor.handlerArtifactDigest ||
    revocation.policyRevision !== captured.descriptor.policyRevision ||
    !DIGEST.test(revocation.revocationDigest)
  ) {
    throw revocationStatusError();
  }
  markAuthorityRevoked(captured);
  return true;
}

function assertAuthorityActive(captured) {
  if (captured.revoked) throw revokedError();
}

async function executeWithinDeadline(captured, request) {
  assertAuthorityActive(captured);
  const controller = new AbortController();
  const deadlineError = new Error(
    "Volcengine function execution deadline exceeded",
  );
  deadlineError.code = "CC_VOLCENGINE_FUNCTION_DEADLINE_EXCEEDED";
  const remainingMs = request.deadlineAtMs - captured.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    controller.abort(deadlineError);
    throw deadlineError;
  }
  captured.activeExecutions.add(controller);
  try {
    synchronizeDurableRevocation(captured);
    assertAuthorityActive(captured);
  } catch (cause) {
    captured.activeExecutions.delete(controller);
    if (!controller.signal.aborted) controller.abort(cause);
    throw cause;
  }
  let timer;
  let revocationPoll;
  let rejectCancellation;
  const cancellation = new Promise((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const onAbort = () => rejectCancellation(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => controller.abort(deadlineError), remainingMs);
  revocationPoll = setInterval(() => {
    try {
      synchronizeDurableRevocation(captured);
    } catch (cause) {
      if (!controller.signal.aborted) {
        controller.abort(cause);
      }
    }
  }, 50);
  const context = Object.freeze({
    signal: controller.signal,
    deadlineAt: request.deadlineAt,
    functionPolicyDigest: request.functionPolicyDigest,
    replayReservationDigest: request.replayReservationDigest,
  });
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => captured.execute(request, context)),
      cancellation,
    ]);
    synchronizeDurableRevocation(captured);
    assertAuthorityActive(captured);
    return response;
  } finally {
    clearTimeout(timer);
    clearInterval(revocationPoll);
    controller.signal.removeEventListener("abort", onAbort);
    captured.activeExecutions.delete(controller);
  }
}

export function createVolcengineFunctionExecutionAuthority({
  descriptor,
  execute,
  replayStore,
  now = () => Date.now(),
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  if (typeof execute !== "function" || types.isProxy(execute)) {
    throw new TypeError("Volcengine function execution port is invalid");
  }
  if (typeof now !== "function" || types.isProxy(now)) {
    throw new TypeError("Volcengine function authority clock is invalid");
  }
  const replayPort = captureVolcengineFunctionReplayStore(replayStore);
  exactData(
    replayPort,
    ["descriptor", "readRevocation", "revoke", "reserve"],
    "Volcengine function replay store port",
  );
  const replayDescriptor = ownData(
    replayPort,
    "descriptor",
    "Volcengine function replay store descriptor",
  );
  exactData(
    replayDescriptor,
    [
      "schema",
      "replayStoreId",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "retentionMs",
      "mode",
      "revocationMode",
    ],
    "Volcengine function replay store descriptor",
  );
  if (
    replayDescriptor.schema !== VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA ||
    replayDescriptor.replayStoreId !== normalizedDescriptor.replayStoreId ||
    replayDescriptor.authorityId !== normalizedDescriptor.authorityId ||
    replayDescriptor.tenantId !== normalizedDescriptor.tenantId ||
    replayDescriptor.handlerArtifactDigest !==
      normalizedDescriptor.handlerArtifactDigest ||
    replayDescriptor.policyRevision !== normalizedDescriptor.policyRevision ||
    replayDescriptor.retentionMs !== normalizedDescriptor.replayRetentionMs ||
    replayDescriptor.mode !== normalizedDescriptor.replayMode ||
    replayDescriptor.revocationMode !== normalizedDescriptor.revocationMode
  ) {
    throw new TypeError(
      "Volcengine function replay store binding does not match authority",
    );
  }
  const reserveReplay = ownData(
    replayPort,
    "reserve",
    "Volcengine function replay reservation port",
  );
  if (typeof reserveReplay !== "function" || types.isProxy(reserveReplay)) {
    throw new TypeError(
      "Volcengine function replay reservation port is invalid",
    );
  }
  const readRevocation = ownData(
    replayPort,
    "readRevocation",
    "Volcengine function revocation reader",
  );
  const persistRevocation = ownData(
    replayPort,
    "revoke",
    "Volcengine function durable revocation writer",
  );
  if (
    typeof readRevocation !== "function" ||
    types.isProxy(readRevocation) ||
    typeof persistRevocation !== "function" ||
    types.isProxy(persistRevocation)
  ) {
    throw new TypeError("Volcengine function revocation store port is invalid");
  }
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: normalizedDescriptor,
    execute,
    now,
    reserveReplay,
    readRevocation,
    persistRevocation,
    requests: new Map(),
    revoked: false,
    activeExecutions: new Set(),
  });
  return authority;
}

export function revokeVolcengineFunctionExecutionAuthority(value) {
  const captured = authorities.get(value);
  if (!captured) {
    throw new TypeError(
      "A branded Volcengine function execution authority is required",
    );
  }
  return markAuthorityRevoked(captured);
}

async function persistVolcengineFunctionExecutionAuthorityRevocation(
  value,
  evidence,
) {
  const captured = authorities.get(value);
  if (!captured) {
    throw new TypeError(
      "A branded Volcengine function execution authority is required",
    );
  }
  exactData(
    evidence,
    [
      "revocationId",
      "reasonDigest",
      "authorizationEvidenceDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "revokedAt",
    ],
    "Volcengine function revocation evidence",
  );
  const core = Object.freeze({
    schema: VOLCENGINE_FUNCTION_REVOCATION_SCHEMA,
    replayStoreId: captured.descriptor.replayStoreId,
    authorityId: captured.descriptor.authorityId,
    tenantId: captured.descriptor.tenantId,
    handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
    policyRevision: captured.descriptor.policyRevision,
    revocationId: ownData(
      evidence,
      "revocationId",
      "Volcengine function revocation identifier",
    ),
    reasonDigest: ownData(
      evidence,
      "reasonDigest",
      "Volcengine function revocation reason digest",
    ),
    authorizationEvidenceDigest: ownData(
      evidence,
      "authorizationEvidenceDigest",
      "Volcengine function revocation authorization evidence digest",
    ),
    auditEventDigest: ownData(
      evidence,
      "auditEventDigest",
      "Volcengine function revocation audit event digest",
    ),
    durabilityReceiptDigest: ownData(
      evidence,
      "durabilityReceiptDigest",
      "Volcengine function revocation durability receipt digest",
    ),
    revokedAt: ownData(
      evidence,
      "revokedAt",
      "Volcengine function revocation time",
    ),
  });
  const revokedAtMs = Date.parse(core.revokedAt);
  const nowMs = captured.now();
  if (
    !ID.test(core.revocationId) ||
    !DIGEST.test(core.reasonDigest) ||
    !DIGEST.test(core.authorizationEvidenceDigest) ||
    !DIGEST.test(core.auditEventDigest) ||
    !DIGEST.test(core.durabilityReceiptDigest) ||
    !Number.isFinite(revokedAtMs) ||
    new Date(revokedAtMs).toISOString() !== core.revokedAt ||
    !Number.isFinite(nowMs) ||
    revokedAtMs > nowMs + MAX_CLOCK_SKEW_MS
  ) {
    throw new TypeError("Volcengine function revocation evidence is invalid");
  }
  const revocation = Object.freeze({
    ...core,
    revocationDigest: digest(VOLCENGINE_FUNCTION_REVOCATION_SCHEMA, core),
  });
  markAuthorityRevoked(captured);
  const acknowledgement = await Reflect.apply(
    captured.persistRevocation,
    undefined,
    [revocation],
  );
  exactData(
    acknowledgement,
    ["revocationDigest", "durable", "readbackVerified"],
    "Volcengine function revocation acknowledgement",
  );
  if (
    acknowledgement.revocationDigest !== revocation.revocationDigest ||
    acknowledgement.durable !== true ||
    acknowledgement.readbackVerified !== true
  ) {
    throw new TypeError(
      "Volcengine function revocation acknowledgement is invalid",
    );
  }
  return Object.freeze({
    revoked: true,
    revocationDigest: revocation.revocationDigest,
    durable: true,
    readbackVerified: true,
  });
}

export function createVolcengineFunctionRevocationAuthority(options) {
  exactData(
    options,
    ["descriptor", "authorize", "now"],
    "Volcengine function revocation authority",
  );
  const descriptor = normalizeRevocationAuthorityDescriptor(
    ownData(
      options,
      "descriptor",
      "Volcengine function revocation authority descriptor",
    ),
  );
  const authorize = ownData(
    options,
    "authorize",
    "Volcengine function revocation authorization port",
  );
  const now = ownData(
    options,
    "now",
    "Volcengine function revocation authority clock",
  );
  if (typeof authorize !== "function" || types.isProxy(authorize)) {
    throw new TypeError(
      "Volcengine function revocation authorization port is invalid",
    );
  }
  if (typeof now !== "function" || types.isProxy(now)) {
    throw new TypeError("Volcengine function revocation clock is invalid");
  }
  const authority = Object.freeze({});
  revocationAuthorities.set(authority, { descriptor, authorize, now });
  return authority;
}

export function captureVolcengineFunctionRevocationAuthority(value) {
  const captured = revocationAuthorities.get(value);
  if (!captured) {
    throw new TypeError(
      "A branded Volcengine function revocation authority is required",
    );
  }
  return Object.freeze({
    descriptor: captured.descriptor,
    revokeAuthority: async (targetAuthority, value) => {
      const target = authorities.get(targetAuthority);
      if (!target) {
        throw new TypeError(
          "A branded Volcengine function execution authority is required",
        );
      }
      assertRevocationTargetBinding(target.descriptor, captured.descriptor);
      const nowMs = captured.now();
      if (!Number.isFinite(nowMs)) {
        throw new TypeError("Volcengine function revocation clock is invalid");
      }
      const request = normalizeRevocationRequest(
        value,
        captured.descriptor,
        nowMs,
      );
      const decision = normalizeRevocationDecision(
        await Reflect.apply(captured.authorize, undefined, [request]),
        request,
        captured.descriptor,
        nowMs,
      );
      if (decision.decision === "deny") {
        const error = new Error("Volcengine function revocation was denied");
        error.code = "CC_VOLCENGINE_FUNCTION_REVOCATION_DENIED";
        throw error;
      }
      const revokedAtMs = captured.now();
      if (
        !Number.isFinite(revokedAtMs) ||
        revokedAtMs >= decision.validUntilMs
      ) {
        const error = new Error(
          "Volcengine function revocation grant expired before execution",
        );
        error.code = "CC_VOLCENGINE_FUNCTION_REVOCATION_GRANT_EXPIRED";
        throw error;
      }
      const revokedAt = decision.authorizedAt;
      const acknowledgement =
        await persistVolcengineFunctionExecutionAuthorityRevocation(
          targetAuthority,
          Object.freeze({
            revocationId: request.requestId,
            reasonDigest: request.reasonDigest,
            authorizationEvidenceDigest: decision.authorizationEvidenceDigest,
            auditEventDigest: decision.auditEventDigest,
            durabilityReceiptDigest: decision.durabilityReceiptDigest,
            revokedAt,
          }),
        );
      const resultCore = Object.freeze({
        schema: VOLCENGINE_FUNCTION_REVOCATION_RESULT_SCHEMA,
        authorityId: captured.descriptor.authorityId,
        tenantId: captured.descriptor.tenantId,
        handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
        policyRevision: captured.descriptor.policyRevision,
        targetAuthorityId: captured.descriptor.targetAuthorityId,
        targetReplayStoreId: captured.descriptor.targetReplayStoreId,
        targetPolicyRevision: captured.descriptor.targetPolicyRevision,
        requestId: request.requestId,
        requestDigest: request.requestDigest,
        revocationDigest: acknowledgement.revocationDigest,
        authorizationEvidenceDigest: decision.authorizationEvidenceDigest,
        auditEventDigest: decision.auditEventDigest,
        durabilityReceiptDigest: decision.durabilityReceiptDigest,
        revokedAt,
        status: "revoked",
        authenticated: true,
        durable: acknowledgement.durable,
        readbackVerified: acknowledgement.readbackVerified,
      });
      return Object.freeze({
        ...resultCore,
        resultDigest: digest(
          VOLCENGINE_FUNCTION_REVOCATION_RESULT_SCHEMA,
          resultCore,
        ),
      });
    },
  });
}

export function captureVolcengineFunctionExecutionAuthority(value) {
  const captured = authorities.get(value);
  if (!captured) {
    throw new TypeError(
      "A branded Volcengine function execution authority is required",
    );
  }
  return Object.freeze({
    descriptor: captured.descriptor,
    executeFunction: async (value) => {
      assertAuthorityActive(captured);
      synchronizeDurableRevocation(captured);
      assertAuthorityActive(captured);
      const nowMs = captured.now();
      if (!Number.isFinite(nowMs)) {
        throw new TypeError("Volcengine function authority clock is invalid");
      }
      const request = normalizeRequest(value, captured.descriptor, nowMs);
      reserveRequest(captured, request, nowMs);
      const reservation = createReplayReservation(request, captured.descriptor);
      const reservationAck = await Reflect.apply(
        captured.reserveReplay,
        undefined,
        [reservation],
      );
      validateReplayReservationAck(reservationAck, reservation);
      const executionRequest = Object.freeze({
        ...request,
        replayReservationDigest: reservation.reservationDigest,
      });
      const response = await executeWithinDeadline(captured, executionRequest);
      exactData(
        response,
        ["toolResult", "auditEvidence"],
        "Volcengine function execution response",
      );
      const policy = functionPolicy(captured.descriptor, request.functionName);
      const toolResult = normalizeJson(
        ownData(response, "toolResult", "Volcengine function execution result"),
        "Volcengine function result",
        policy.maxResultBytes,
      );
      const resultDigest = digest(
        "chainlesschain.volcengine-function-result/v1",
        toolResult,
      );
      const audit = validateAuditEvidence(
        ownData(
          response,
          "auditEvidence",
          "Volcengine function audit evidence",
        ),
        executionRequest,
        captured.descriptor,
        resultDigest,
        captured.now(),
      );
      return Object.freeze({
        toolResult,
        receipt: Object.freeze({
          schema: VOLCENGINE_FUNCTION_RECEIPT_SCHEMA,
          authorityId: captured.descriptor.authorityId,
          tenantId: captured.descriptor.tenantId,
          handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
          policyRevision: captured.descriptor.policyRevision,
          replayStoreId: captured.descriptor.replayStoreId,
          revocationMode: captured.descriptor.revocationMode,
          actorDid: request.actorDid,
          purpose: VOLCENGINE_FUNCTION_PURPOSE,
          requestId: executionRequest.requestId,
          senderId: executionRequest.senderId,
          functionName: executionRequest.functionName,
          functionPolicyDigest: executionRequest.functionPolicyDigest,
          replayReservationDigest: executionRequest.replayReservationDigest,
          deadlineAt: executionRequest.deadlineAt,
          requestDigest: executionRequest.requestDigest,
          resultDigest,
          auditMode: VOLCENGINE_FUNCTION_AUDIT_MODE,
          auditEventDigest: audit.auditEventDigest,
          durabilityReceiptDigest: audit.durabilityReceiptDigest,
          authenticated: true,
          durable: true,
          readbackVerified: true,
          completedAt: audit.completedAt,
        }),
      });
    },
  });
}
