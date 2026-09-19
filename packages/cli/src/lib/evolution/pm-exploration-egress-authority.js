import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

export const PM_EXPLORATION_EGRESS_AUTHORITY_SCHEMA =
  "chainlesschain.pm-exploration-egress-authority/v1";
export const PM_EXPLORATION_MEMORY_RETRIEVAL_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-memory-retrieval-request/v1";
export const PM_EXPLORATION_MODEL_EGRESS_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-model-egress-request/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:[._:@/-][a-z0-9]+)*$/u;
const AUTHORITIES = new WeakMap();

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

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`${label} is outside its allowed range`);
  return value;
}

function copyJson(
  value,
  label,
  context = { bytes: 0, nodes: 0, seen: new WeakSet() },
) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    context.bytes += Buffer.byteLength(JSON.stringify(value));
    if (context.bytes > 1024 * 1024)
      throw new TypeError(`${label} exceeds its byte bound`);
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    context.seen.has(value) ||
    context.nodes >= 20_000
  ) {
    throw new TypeError(`${label} must be bounded acyclic JSON data`);
  }
  context.seen.add(value);
  context.nodes += 1;
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1
    ) {
      throw new TypeError(`${label} must be a dense plain array`);
    }
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index))
        throw new TypeError(`${label} cannot contain holes`);
      result.push(copyJson(value[index], label, context));
    }
    context.seen.delete(value);
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError(`${label} must use the default object prototype`);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !field ||
      !field.enumerable ||
      !("value" in field)
    ) {
      throw new TypeError(`${label} contains a symbol or accessor`);
    }
    context.bytes += Buffer.byteLength(key);
    if (context.bytes > 1024 * 1024)
      throw new TypeError(`${label} exceeds its byte bound`);
    result[key] = copyJson(field.value, label, context);
  }
  context.seen.delete(value);
  return result;
}

function freezeJson(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const entry of Object.values(value)) freezeJson(entry);
  return Object.freeze(value);
}

function authorityKind(value) {
  if (!["memory-retrieval", "model-egress"].includes(value))
    throw new TypeError("PM exploration egress authority kind is invalid");
  return value;
}

function createAuthority(options, kind, handlerKey) {
  exact(
    options,
    [
      "authorityId",
      "revision",
      "handlerArtifactDigest",
      "policyDigest",
      handlerKey,
    ],
    `PM exploration ${kind} authority options`,
  );
  const handler = options[handlerKey];
  if (typeof handler !== "function" || isProxy(handler))
    throw new TypeError(`PM exploration ${kind} handler must be direct`);
  const core = Object.freeze({
    schema: PM_EXPLORATION_EGRESS_AUTHORITY_SCHEMA,
    kind: authorityKind(kind),
    authorityId: identifier(options.authorityId, "egress authorityId"),
    revision: integer(options.revision, "egress authority revision", 1),
    handlerArtifactDigest: digest(
      options.handlerArtifactDigest,
      "egress handlerArtifactDigest",
    ),
    policyDigest: digest(options.policyDigest, "egress policyDigest"),
  });
  const authority = Object.freeze({});
  AUTHORITIES.set(authority, {
    descriptor: Object.freeze({
      ...core,
      authorityDigest: hash(PM_EXPLORATION_EGRESS_AUTHORITY_SCHEMA, core),
    }),
    handler,
  });
  return authority;
}

export function createPmExplorationMemoryRetrievalAuthority(options = {}) {
  return createAuthority(options, "memory-retrieval", "retrieve");
}

export function createPmExplorationModelEgressAuthority(options = {}) {
  return createAuthority(options, "model-egress", "invoke");
}

export function inspectPmExplorationEgressAuthority(value) {
  const binding = AUTHORITIES.get(value);
  if (!binding)
    throw new TypeError(
      "a branded PM exploration egress authority is required",
    );
  return binding.descriptor;
}

function invocationContext(value) {
  exact(
    value,
    [
      "planDigest",
      "environmentDigest",
      "executionManifestDigest",
      "roundId",
      "stage",
      "branchId",
      "taskId",
      "inputMemoryDigest",
    ],
    "PM exploration egress invocation context",
  );
  if (!["broad", "deep"].includes(value.stage))
    throw new TypeError("PM exploration egress stage is invalid");
  if (value.stage === "broad") identifier(value.branchId, "egress branchId");
  else if (value.branchId !== null)
    throw new TypeError("Deep egress context cannot name a branch");
  return Object.freeze({
    planDigest: digest(value.planDigest, "egress planDigest"),
    environmentDigest: digest(
      value.environmentDigest,
      "egress environmentDigest",
    ),
    executionManifestDigest: digest(
      value.executionManifestDigest,
      "egress executionManifestDigest",
    ),
    roundId: identifier(value.roundId, "egress roundId"),
    stage: value.stage,
    branchId: value.branchId,
    taskId: identifier(value.taskId, "egress taskId"),
    inputMemoryDigest: digest(
      value.inputMemoryDigest,
      "egress inputMemoryDigest",
    ),
  });
}

function runtimeContext(value, label) {
  exact(value, ["signal", "remainingTokens"], label);
  if (!(value.signal instanceof AbortSignal))
    throw new TypeError(`${label}.signal must be an AbortSignal`);
  return Object.freeze({
    signal: value.signal,
    remainingTokens: integer(value.remainingTokens, `${label}.remainingTokens`),
  });
}

export async function retrievePmExplorationMemory(
  authorityValue,
  contextInput,
  requestInput,
  runtimeInput,
) {
  const binding = AUTHORITIES.get(authorityValue);
  if (!binding || binding.descriptor.kind !== "memory-retrieval")
    throw new TypeError(
      "a branded PM exploration memory retrieval authority is required",
    );
  const context = invocationContext(contextInput);
  exact(
    requestInput,
    ["memoryDigest", "query"],
    "PM exploration memory retrieval request",
  );
  const memoryDigest = digest(
    requestInput.memoryDigest,
    "memory retrieval memoryDigest",
  );
  if (memoryDigest !== context.inputMemoryDigest)
    throw new Error(
      "PM exploration memory retrieval escaped its round snapshot",
    );
  const requestCore = freezeJson({
    schema: PM_EXPLORATION_MEMORY_RETRIEVAL_REQUEST_SCHEMA,
    authorityDigest: binding.descriptor.authorityDigest,
    ...context,
    memoryDigest,
    query: copyJson(requestInput.query, "memory retrieval query"),
  });
  const request = Object.freeze({
    ...requestCore,
    requestDigest: hash(
      PM_EXPLORATION_MEMORY_RETRIEVAL_REQUEST_SCHEMA,
      requestCore,
    ),
  });
  const runtime = runtimeContext(runtimeInput, "memory retrieval runtime");
  const output = await binding.handler(request, runtime);
  if (runtime.signal.aborted)
    throw runtime.signal.reason ?? new Error("memory retrieval was aborted");
  return freezeJson(copyJson(output, "memory retrieval output"));
}

export async function invokePmExplorationModelEgress(
  authorityValue,
  contextInput,
  requestInput,
  runtimeInput,
) {
  const binding = AUTHORITIES.get(authorityValue);
  if (!binding || binding.descriptor.kind !== "model-egress")
    throw new TypeError(
      "a branded PM exploration model egress authority is required",
    );
  const context = invocationContext(contextInput);
  exact(
    requestInput,
    ["purpose", "input", "maxOutputTokens"],
    "PM exploration model egress request",
  );
  const runtime = runtimeContext(runtimeInput, "model egress runtime");
  const maxOutputTokens = integer(
    requestInput.maxOutputTokens,
    "model egress maxOutputTokens",
    1,
    1_000_000,
  );
  if (maxOutputTokens > runtime.remainingTokens)
    throw new Error(
      "PM exploration model request exceeds its remaining budget",
    );
  const requestCore = freezeJson({
    schema: PM_EXPLORATION_MODEL_EGRESS_REQUEST_SCHEMA,
    authorityDigest: binding.descriptor.authorityDigest,
    ...context,
    purpose: identifier(requestInput.purpose, "model egress purpose"),
    input: copyJson(requestInput.input, "model egress input"),
    maxOutputTokens,
    remainingTokens: runtime.remainingTokens,
  });
  const request = Object.freeze({
    ...requestCore,
    requestDigest: hash(
      PM_EXPLORATION_MODEL_EGRESS_REQUEST_SCHEMA,
      requestCore,
    ),
  });
  const result = await binding.handler(request, runtime);
  if (runtime.signal.aborted)
    throw runtime.signal.reason ?? new Error("model egress was aborted");
  exact(result, ["output", "usage"], "PM exploration model egress result");
  exact(
    result.usage,
    ["inputTokens", "outputTokens"],
    "PM exploration model egress usage",
  );
  const inputTokens = integer(
    result.usage.inputTokens,
    "model egress inputTokens",
  );
  const outputTokens = integer(
    result.usage.outputTokens,
    "model egress outputTokens",
  );
  if (
    !Number.isSafeInteger(inputTokens + outputTokens) ||
    inputTokens + outputTokens > runtime.remainingTokens ||
    outputTokens > maxOutputTokens
  ) {
    throw new Error("PM exploration model usage exceeds its authorized budget");
  }
  return freezeJson({
    output: copyJson(result.output, "model egress output"),
    usage: {
      inputTokens,
      outputTokens,
    },
  });
}
