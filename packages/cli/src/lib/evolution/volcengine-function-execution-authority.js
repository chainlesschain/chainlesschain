import { createHash } from "node:crypto";
import { types } from "node:util";

export const VOLCENGINE_FUNCTION_AUTHORITY_SCHEMA =
  "chainlesschain.volcengine-function-authority/v1";
export const VOLCENGINE_FUNCTION_REQUEST_SCHEMA =
  "chainlesschain.volcengine-function-request/v1";
export const VOLCENGINE_FUNCTION_RECEIPT_SCHEMA =
  "chainlesschain.volcengine-function-receipt/v1";
export const VOLCENGINE_FUNCTION_AUDIT_EVIDENCE_SCHEMA =
  "chainlesschain.volcengine-function-audit-evidence/v1";
export const VOLCENGINE_FUNCTION_PURPOSE = "model-tool-execution";
export const VOLCENGINE_FUNCTION_AUDIT_MODE = "authenticated-durable-readback";
export const VOLCENGINE_FUNCTION_EXECUTOR_TYPE = "capability";

const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_FIELDS = 512;
const MAX_REQUEST_AGE_MS = 60_000;
const MAX_CLOCK_SKEW_MS = 5_000;
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

function normalizeDescriptor(value) {
  exactData(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "purpose",
      "allowedFunctions",
      "auditMode",
    ],
    "Volcengine function authority descriptor",
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
    purpose: ownData(value, "purpose", "Volcengine function authority purpose"),
    allowedFunctions: normalizeAllowedFunctions(
      ownData(
        value,
        "allowedFunctions",
        "Volcengine function authority allowlist",
      ),
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
      "actorDid",
      "purpose",
      "requestId",
      "senderId",
      "executorType",
      "functionName",
      "arguments",
      "argumentsDigest",
      "requestedAt",
      "requestDigest",
    ],
    "Volcengine function request",
  );
  const normalizedArguments = normalizeJson(
    ownData(value, "arguments", "Volcengine function arguments"),
    "Volcengine function arguments",
    MAX_ARGUMENT_BYTES,
  );
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
    functionName: ownData(value, "functionName", "Volcengine function name"),
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
  });
  const requestDigest = ownData(
    value,
    "requestDigest",
    "Volcengine function request digest",
  );
  const requestedAtMs = Date.parse(core.requestedAt);
  if (
    core.schema !== VOLCENGINE_FUNCTION_REQUEST_SCHEMA ||
    core.authorityId !== descriptor.authorityId ||
    core.tenantId !== descriptor.tenantId ||
    core.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    core.policyRevision !== descriptor.policyRevision ||
    !ID.test(core.actorDid) ||
    core.purpose !== VOLCENGINE_FUNCTION_PURPOSE ||
    !ID.test(core.requestId) ||
    !Number.isSafeInteger(core.senderId) ||
    core.senderId < 0 ||
    core.executorType !== VOLCENGINE_FUNCTION_EXECUTOR_TYPE ||
    !descriptor.allowedFunctions.includes(core.functionName) ||
    core.argumentsDigest !==
      digest(
        "chainlesschain.volcengine-function-arguments/v1",
        normalizedArguments,
      ) ||
    !Number.isFinite(requestedAtMs) ||
    requestedAtMs < nowMs - MAX_REQUEST_AGE_MS ||
    requestedAtMs > nowMs + MAX_CLOCK_SKEW_MS ||
    requestDigest !==
      digest("chainlesschain.volcengine-function-request/v1", core)
  ) {
    throw new TypeError("Volcengine function request is invalid");
  }
  return Object.freeze({ ...core, requestDigest, requestedAtMs });
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

export function createVolcengineFunctionExecutionAuthority({
  descriptor,
  execute,
  now = () => Date.now(),
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  if (typeof execute !== "function" || types.isProxy(execute)) {
    throw new TypeError("Volcengine function execution port is invalid");
  }
  if (typeof now !== "function" || types.isProxy(now)) {
    throw new TypeError("Volcengine function authority clock is invalid");
  }
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: normalizedDescriptor,
    execute,
    now,
  });
  return authority;
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
      const request = normalizeRequest(
        value,
        captured.descriptor,
        captured.now(),
      );
      const response = await captured.execute(request);
      exactData(
        response,
        ["toolResult", "auditEvidence"],
        "Volcengine function execution response",
      );
      const toolResult = normalizeJson(
        ownData(response, "toolResult", "Volcengine function execution result"),
        "Volcengine function result",
        MAX_RESULT_BYTES,
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
        request,
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
          actorDid: request.actorDid,
          purpose: VOLCENGINE_FUNCTION_PURPOSE,
          requestId: request.requestId,
          senderId: request.senderId,
          functionName: request.functionName,
          requestDigest: request.requestDigest,
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
