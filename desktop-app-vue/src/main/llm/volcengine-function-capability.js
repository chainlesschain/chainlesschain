"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types: utilTypes } = require("node:util");

const AUTHORITY_SCHEMA = "chainlesschain.volcengine-function-authority/v6";
const REQUEST_SCHEMA = "chainlesschain.volcengine-function-request/v6";
const RECEIPT_SCHEMA = "chainlesschain.volcengine-function-receipt/v6";
const REPLAY_RESERVATION_SCHEMA =
  "chainlesschain.volcengine-function-replay-reservation/v1";
const REPLAY_MODE = "cross-process-exclusive-file-fsync";
const REVOCATION_MODE = "cross-process-durable-readback-poll";
const PURPOSE = "model-tool-execution";
const AUDIT_MODE = "authenticated-durable-readback";
const EXECUTOR_TYPE = "capability";
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_FIELDS = 512;
const MAX_POLICY_ARGUMENT_KEYS = 64;
const MAX_EXECUTION_MS = 120_000;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
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
const hosts = new WeakMap();

function governanceError() {
  const error = new Error("Governed Volcengine function execution failed");
  error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  return error;
}

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
    utilTypes.isProxy(value) ||
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

function ownFunction(owner, name, label) {
  const value = ownData(owner, name, label);
  if (typeof value !== "function" || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be a direct function`);
  }
  return value;
}

function boundedIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function directArrayValues(value, label, maxLength) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
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
      const index = Number(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
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
  if (typeof value !== "object" || utilTypes.isProxy(value)) {
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

function normalizeJson(value, label, { maxBytes }) {
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

function digestVolcengineFunctionResult(value) {
  const normalized = normalizeJson(value, "Volcengine function result", {
    maxBytes: MAX_RESULT_BYTES,
  });
  return digest("chainlesschain.volcengine-function-result/v1", normalized);
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

function createVolcengineFunctionExecutionHost(authority, captureAuthority) {
  if (
    typeof captureAuthority !== "function" ||
    utilTypes.isProxy(captureAuthority)
  ) {
    throw new TypeError("Volcengine function authority capture is invalid");
  }
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  exactData(
    captured,
    ["descriptor", "executeFunction"],
    "Volcengine function authority port",
  );
  const descriptor = ownData(
    captured,
    "descriptor",
    "Volcengine function authority descriptor",
  );
  exactData(
    descriptor,
    [
      "schema",
      "authorityId",
      "revocationAuthorityId",
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
  if (
    ownData(descriptor, "schema", "Volcengine function authority schema") !==
      AUTHORITY_SCHEMA ||
    ownData(descriptor, "purpose", "Volcengine function authority purpose") !==
      PURPOSE ||
    ownData(descriptor, "auditMode", "Volcengine function audit mode") !==
      AUDIT_MODE
  ) {
    throw new TypeError("Volcengine function authority descriptor is invalid");
  }
  const allowedFunctions = normalizeAllowedFunctions(
    ownData(
      descriptor,
      "allowedFunctions",
      "Volcengine function authority allowlist",
    ),
  );
  const normalizedDescriptor = Object.freeze({
    schema: AUTHORITY_SCHEMA,
    authorityId: boundedIdentifier(
      ownData(
        descriptor,
        "authorityId",
        "Volcengine function authority identifier",
      ),
      "Volcengine function authority identifier",
    ),
    revocationAuthorityId: boundedIdentifier(
      ownData(
        descriptor,
        "revocationAuthorityId",
        "Volcengine function revocation authority identifier",
      ),
      "Volcengine function revocation authority identifier",
    ),
    tenantId: boundedIdentifier(
      ownData(descriptor, "tenantId", "Volcengine function authority tenant"),
      "Volcengine function authority tenant",
    ),
    handlerArtifactDigest: ownData(
      descriptor,
      "handlerArtifactDigest",
      "Volcengine function authority artifact digest",
    ),
    policyRevision: boundedIdentifier(
      ownData(
        descriptor,
        "policyRevision",
        "Volcengine function authority policy revision",
      ),
      "Volcengine function authority policy revision",
    ),
    replayStoreId: boundedIdentifier(
      ownData(
        descriptor,
        "replayStoreId",
        "Volcengine function replay store identifier",
      ),
      "Volcengine function replay store identifier",
    ),
    replayRetentionMs: ownData(
      descriptor,
      "replayRetentionMs",
      "Volcengine function replay retention",
    ),
    replayMode: ownData(
      descriptor,
      "replayMode",
      "Volcengine function replay mode",
    ),
    revocationMode: ownData(
      descriptor,
      "revocationMode",
      "Volcengine function revocation mode",
    ),
    purpose: PURPOSE,
    allowedFunctions,
    functionPolicies: normalizeFunctionPolicies(
      ownData(
        descriptor,
        "functionPolicies",
        "Volcengine function authority policies",
      ),
      allowedFunctions,
    ),
    auditMode: AUDIT_MODE,
  });
  if (
    !SHA256_DIGEST.test(normalizedDescriptor.handlerArtifactDigest) ||
    !Number.isSafeInteger(normalizedDescriptor.replayRetentionMs) ||
    normalizedDescriptor.replayRetentionMs < 65_000 ||
    normalizedDescriptor.replayRetentionMs > 24 * 60 * 60 * 1000 ||
    normalizedDescriptor.replayMode !== REPLAY_MODE ||
    normalizedDescriptor.revocationMode !== REVOCATION_MODE
  ) {
    throw new TypeError("Volcengine function authority descriptor is invalid");
  }
  const executeFunction = ownFunction(
    captured,
    "executeFunction",
    "Volcengine function execution port",
  );
  const host = Object.freeze({});
  hosts.set(host, {
    descriptor: normalizedDescriptor,
    executeFunction,
    allowedFunctions: new Set(normalizedDescriptor.allowedFunctions),
  });
  return host;
}

function normalizeAuthorization(value, descriptor) {
  exactData(
    value,
    ["actorDid", "operation", "purpose", "senderId", "tenantId"],
    "Volcengine function authorization",
  );
  const actorDid = boundedIdentifier(
    ownData(value, "actorDid", "Volcengine function actor"),
    "Volcengine function actor",
  );
  const tenantId = boundedIdentifier(
    ownData(value, "tenantId", "Volcengine function tenant"),
    "Volcengine function tenant",
  );
  const senderId = ownData(value, "senderId", "Volcengine function sender");
  if (
    ownData(value, "operation", "Volcengine function operation") !==
      "execute-function-calling" ||
    ownData(value, "purpose", "Volcengine function purpose") !== PURPOSE ||
    tenantId !== descriptor.tenantId ||
    !Number.isSafeInteger(senderId) ||
    senderId < 0
  ) {
    throw new TypeError("Volcengine function authorization is invalid");
  }
  return Object.freeze({ actorDid, tenantId, senderId });
}

function validateReceipt(receipt, request, descriptor, resultDigest) {
  const replayReservationCore = Object.freeze({
    schema: REPLAY_RESERVATION_SCHEMA,
    replayStoreId: descriptor.replayStoreId,
    authorityId: descriptor.authorityId,
    tenantId: descriptor.tenantId,
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    policyRevision: descriptor.policyRevision,
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    expiresAt: new Date(
      Date.parse(request.deadlineAt) + descriptor.replayRetentionMs,
    ).toISOString(),
  });
  const replayReservationDigest = digest(
    REPLAY_RESERVATION_SCHEMA,
    replayReservationCore,
  );
  exactData(
    receipt,
    [
      "schema",
      "authorityId",
      "revocationAuthorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "replayStoreId",
      "revocationMode",
      "actorDid",
      "purpose",
      "requestId",
      "senderId",
      "functionName",
      "functionPolicyDigest",
      "replayReservationDigest",
      "deadlineAt",
      "requestDigest",
      "resultDigest",
      "auditMode",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "completedAt",
    ],
    "Volcengine function execution receipt",
  );
  for (const [name, expected] of Object.entries({
    schema: RECEIPT_SCHEMA,
    authorityId: descriptor.authorityId,
    revocationAuthorityId: descriptor.revocationAuthorityId,
    tenantId: descriptor.tenantId,
    handlerArtifactDigest: descriptor.handlerArtifactDigest,
    policyRevision: descriptor.policyRevision,
    replayStoreId: descriptor.replayStoreId,
    revocationMode: descriptor.revocationMode,
    actorDid: request.actorDid,
    purpose: PURPOSE,
    requestId: request.requestId,
    senderId: request.senderId,
    functionName: request.functionName,
    functionPolicyDigest: request.functionPolicyDigest,
    replayReservationDigest,
    deadlineAt: request.deadlineAt,
    requestDigest: request.requestDigest,
    resultDigest,
    auditMode: AUDIT_MODE,
    authenticated: true,
    durable: true,
    readbackVerified: true,
  })) {
    if (
      ownData(receipt, name, `Volcengine function receipt ${name}`) !== expected
    ) {
      throw new TypeError("Volcengine function execution receipt is invalid");
    }
  }
  const completedAt = ownData(
    receipt,
    "completedAt",
    "Volcengine function receipt completion time",
  );
  const auditEventDigest = ownData(
    receipt,
    "auditEventDigest",
    "Volcengine function receipt audit event digest",
  );
  const durabilityReceiptDigest = ownData(
    receipt,
    "durabilityReceiptDigest",
    "Volcengine function receipt durability digest",
  );
  const completedAtMs = Date.parse(completedAt);
  if (
    !SHA256_DIGEST.test(auditEventDigest) ||
    !SHA256_DIGEST.test(durabilityReceiptDigest) ||
    typeof completedAt !== "string" ||
    !Number.isFinite(completedAtMs) ||
    new Date(completedAtMs).toISOString() !== completedAt ||
    completedAtMs < Date.parse(request.requestedAt) ||
    completedAtMs > Date.parse(request.deadlineAt)
  ) {
    throw new TypeError("Volcengine function execution receipt is invalid");
  }
}

function createVolcengineFunctionExecutor(
  host,
  { authorization, executorType } = {},
) {
  const captured = hosts.get(host);
  try {
    if (!captured || executorType !== EXECUTOR_TYPE) {
      throw new TypeError("A branded function capability is required");
    }
    const context = normalizeAuthorization(authorization, captured.descriptor);

    return Object.freeze({
      async execute(functionName, args) {
        try {
          if (
            !BUILTIN_FUNCTION_SET.has(functionName) ||
            !captured.allowedFunctions.has(functionName)
          ) {
            throw new TypeError("Volcengine function is not authorized");
          }
          const policy = functionPolicy(captured.descriptor, functionName);
          if (!policy) {
            throw new TypeError("Volcengine function is not authorized");
          }
          const normalizedArguments = normalizeJson(
            args,
            "Volcengine function arguments",
            { maxBytes: policy.maxArgumentBytes },
          );
          validatePolicyArguments(normalizedArguments, policy);
          const requestedAtMs = Date.now();
          const requestCore = Object.freeze({
            schema: REQUEST_SCHEMA,
            authorityId: captured.descriptor.authorityId,
            revocationAuthorityId: captured.descriptor.revocationAuthorityId,
            tenantId: context.tenantId,
            handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
            policyRevision: captured.descriptor.policyRevision,
            replayStoreId: captured.descriptor.replayStoreId,
            revocationMode: captured.descriptor.revocationMode,
            actorDid: context.actorDid,
            purpose: PURPOSE,
            requestId: randomUUID(),
            senderId: context.senderId,
            executorType: EXECUTOR_TYPE,
            functionName,
            functionPolicyDigest: digestFunctionPolicy(policy),
            arguments: normalizedArguments,
            argumentsDigest: digest(
              "chainlesschain.volcengine-function-arguments/v1",
              normalizedArguments,
            ),
            requestedAt: new Date(requestedAtMs).toISOString(),
            deadlineAt: new Date(
              requestedAtMs + policy.maxExecutionMs,
            ).toISOString(),
          });
          const request = Object.freeze({
            ...requestCore,
            requestDigest: digest(
              "chainlesschain.volcengine-function-request/v6",
              requestCore,
            ),
          });
          const response = await Reflect.apply(
            captured.executeFunction,
            undefined,
            [request],
          );
          exactData(
            response,
            ["toolResult", "receipt"],
            "Volcengine function execution response",
          );
          const toolResult = normalizeJson(
            ownData(
              response,
              "toolResult",
              "Volcengine function execution result",
            ),
            "Volcengine function result",
            { maxBytes: policy.maxResultBytes },
          );
          validateReceipt(
            ownData(
              response,
              "receipt",
              "Volcengine function execution receipt",
            ),
            request,
            captured.descriptor,
            digest("chainlesschain.volcengine-function-result/v1", toolResult),
          );
          return toolResult;
        } catch {
          throw governanceError();
        }
      },
    });
  } catch {
    throw governanceError();
  }
}

module.exports = {
  AUTHORITY_SCHEMA,
  AUDIT_MODE,
  BUILTIN_FUNCTIONS,
  EXECUTOR_TYPE,
  PURPOSE,
  RECEIPT_SCHEMA,
  REQUEST_SCHEMA,
  createVolcengineFunctionExecutionHost,
  createVolcengineFunctionExecutor,
  digestVolcengineFunctionResult,
};
