/**
 * Strict domain adapters that retain Skill release and mutation evidence in
 * one caller-owned EvolutionLedger. This module never constructs or reopens a
 * ledger and never projects release evidence into the legacy proposal schema.
 */

import crypto from "node:crypto";
import { types as utilTypes } from "node:util";
import {
  EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES,
  EVOLUTION_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
  EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  EvolutionArtifactPorts,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_REF_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_MAX_EVENTS,
  EVOLUTION_LEDGER_QUERY_SCHEMA,
  EvolutionLedger,
} from "./evolution-ledger.js";
import {
  SKILL_MUTATION_NONCE_ACK_SCHEMA,
  SKILL_MUTATION_OPERATIONS,
  SKILL_MUTATION_ROLES,
  SKILL_MUTATION_TARGET_SCOPES,
  verifySkillMutationAuditEvent,
  verifySkillMutationConsumptionReceipt,
  verifySkillMutationNonceClaim,
  verifySkillMutationRequest,
} from "./skill-mutation-authority.js";
import { SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA } from "./skill-release-registry.js";

export const EVOLUTION_LEDGER_PORTS_INVALID_CODE =
  "CC_EVOLUTION_LEDGER_PORTS_INVALID";
export const EVOLUTION_LEDGER_PORTS_COLLISION_CODE =
  "CC_EVOLUTION_LEDGER_PORTS_COLLISION";
export const EVOLUTION_LEDGER_PORTS_CORRUPT_CODE =
  "CC_EVOLUTION_LEDGER_PORTS_CORRUPT";
export const EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE =
  "CC_EVOLUTION_LEDGER_PORTS_UNAVAILABLE";
export const EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA =
  "chainlesschain.evolution-artifact-durability-binding/v1";
export const EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA =
  "chainlesschain.evolution-artifact-durability-retain-request/v1";
export const EVOLUTION_ARTIFACT_DURABILITY_RESOLVE_REQUEST_SCHEMA =
  "chainlesschain.evolution-artifact-durability-resolve-request/v1";
export const EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA =
  "chainlesschain.evolution-artifact-durability-receipt/v1";
export const EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA =
  "chainlesschain.evolution-artifact-durability-resolution/v1";

const RELEASE_INTENT_SCHEMA =
  "chainlesschain.skill-release-transition-intent/v2";
const RELEASE_INTENT_DOMAIN = `${RELEASE_INTENT_SCHEMA}\0`;
const RELEASE_FINALIZATION_DOMAIN =
  "chainlesschain.evolution-release-finalization/v1\0";
const PROJECTION_PREPARE_RECEIPT_DOMAIN =
  "chainlesschain.evolution-ledger-release-prepare-projection/v1\0";
const PROJECTION_FINALIZE_RECEIPT_DOMAIN =
  "chainlesschain.evolution-ledger-release-finalize-projection/v1\0";
const EVENT_ID_DOMAINS = Object.freeze({
  audit: "chainlesschain.evolution-ledger-event-id/mutation.audit/v1\0",
  finalize: "chainlesschain.evolution-ledger-event-id/release.finalize/v1\0",
  nonce: "chainlesschain.evolution-ledger-event-id/mutation.nonce/v1\0",
  prepare: "chainlesschain.evolution-ledger-event-id/release.prepare/v1\0",
});
const EVENT_PREFIXES = Object.freeze({
  audit: "mutation.audit",
  finalize: "release.finalize",
  nonce: "mutation.nonce",
  prepare: "release.prepare",
});
const EVENT_TYPES = Object.freeze({
  audit: "skill.mutation.audit",
  finalize: "skill.release.finalize",
  nonce: "skill.mutation.nonce",
  prepare: "skill.release.prepare",
});
const ARTIFACT_TYPES = Object.freeze({
  audit: "skill-mutation-audit",
  finalize: "skill-release-finalization",
  nonce: "skill-mutation-nonce-claim",
  prepare: "skill-release-transition-intent",
});
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const MAX_CANONICAL_DEPTH = 32;
const MAX_CANONICAL_NODES = 100_000;
const MAX_ARRAY_ENTRIES = 65_536;
const MAX_OBJECT_FIELDS = 4096;
const MAX_KEY_CHARS = 512;
const MAX_STRING_CHARS = EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES;
const MAX_FINALIZE_RETRIES = 8;

const FACTORY_OPTION_KEYS = new Set([
  "artifactDurabilityAuthority",
  "artifactPorts",
  "artifactTenantId",
  "audience",
  "ledger",
  "purpose",
]);
const FACTORY_REQUIRED_KEYS = new Set([
  "artifactDurabilityAuthority",
  "artifactPorts",
  "artifactTenantId",
  "ledger",
]);
const DURABLE_RESOLVER_OPTION_KEYS = new Set([
  "artifactDurabilityAuthority",
  "artifactPorts",
  "artifactTenantId",
  "purpose",
]);
const ARTIFACT_REF_KEYS = new Set(["digest", "ref", "schema"]);
const ARTIFACT_PUT_RESULT_KEYS = new Set([
  "digest",
  "envelope",
  "receipt",
  "ref",
]);
const ARTIFACT_RECORD_KEYS = new Set([
  "audience",
  "purpose",
  "retention",
  "schema",
  "tenantId",
  "type",
  "value",
]);
const LEDGER_RESOLUTION_KEYS = new Set([
  "authenticated",
  "bytes",
  "digest",
  "found",
  "receiptDigest",
  "ref",
  "schema",
]);
const DURABILITY_AUTHORITY_KEYS = new Set(["id", "resolve", "retain"]);
const DURABILITY_RECEIPT_KEYS = new Set([
  "artifactTenantId",
  "authenticated",
  "authorityId",
  "digest",
  "durable",
  "purpose",
  "receiptDigest",
  "ref",
  "retention",
  "schema",
  "type",
]);
const DURABILITY_RESOLVE_REQUEST_KEYS = new Set([
  "artifactTenantId",
  "digest",
  "purpose",
  "ref",
  "retention",
  "schema",
]);
const DURABILITY_RESOLUTION_KEYS = new Set([
  ...DURABILITY_RECEIPT_KEYS,
  "bytes",
]);
const LEDGER_ARTIFACT_REQUEST_KEYS = new Set([
  "epoch",
  "ledgerId",
  "ref",
  "tenantId",
]);
const DURABLE_ARTIFACT_TYPE_SET = new Set(Object.values(ARTIFACT_TYPES));
const QUERY_RESULT_KEYS = new Set([
  "anchor",
  "authenticated",
  "authority",
  "durable",
  "event",
  "receipt",
  "schema",
]);
const INTENT_KEYS = new Set([
  "authorityReceipt",
  "authorityReceiptDigest",
  "candidateId",
  "dependencyLockDigest",
  "expectedParentDigest",
  "expectedRevision",
  "intentDigest",
  "mutationRequest",
  "nextStateDigest",
  "operation",
  "operationId",
  "pointerDigest",
  "previousStateDigest",
  "receiptDigests",
  "requestDigest",
  "schema",
  "skillName",
  "targetReleaseDigest",
  "transactionId",
  "transitionSubjectDigest",
]);
const FINALIZE_KEYS = new Set([
  "authorityReceiptDigest",
  "expectedPrepareReceiptDigest",
  "intentDigest",
  "pointerDigest",
  "revision",
  "skillName",
  "stateDigest",
  "transactionId",
]);
const RECEIPT_DIGEST_KEYS = new Set([
  "actor",
  "candidate",
  "eval",
  "parent",
  "policy",
  "target",
]);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
).get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
).get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
).get;
const bufferToString = Function.prototype.call.bind(Buffer.prototype.toString);

export class EvolutionLedgerPortsError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "EvolutionLedgerPortsError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function portsError(code, message, details = {}) {
  return new EvolutionLedgerPortsError(code, message, details);
}

function rejectProxy(value, label, code = EVOLUTION_LEDGER_PORTS_INVALID_CODE) {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    utilTypes.isProxy(value)
  ) {
    throw portsError(code, `${label} must not be a Proxy`);
  }
}

function isPlainRecord(value, label, code) {
  if (!value || typeof value !== "object") return false;
  rejectProxy(value, label, code);
  if (Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  rejectProxy(prototype, `${label} prototype`, code);
  return prototype === Object.prototype || prototype === null;
}

function ownData(value, key, label, code) {
  rejectProxy(value, label, code);
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw portsError(code, `${label}.${String(key)} could not be inspected`, {
      cause,
    });
  }
  if (
    !descriptor ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true
  ) {
    throw portsError(
      code,
      `${label}.${String(key)} must be an enumerable own data property`,
    );
  }
  return descriptor.value;
}

function assertExactRecord(
  value,
  allowed,
  required,
  label,
  code = EVOLUTION_LEDGER_PORTS_INVALID_CODE,
) {
  if (!isPlainRecord(value, label, code)) {
    throw portsError(code, `${label} must be a plain object`);
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw portsError(code, `${label} keys could not be inspected`, { cause });
  }
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    [...required].some((key) => !keys.includes(key))
  ) {
    throw portsError(code, `${label} contains missing or unsupported fields`);
  }
  for (const key of keys) ownData(value, key, label, code);
}

function assertAllExactRecord(
  value,
  keys,
  label,
  code = EVOLUTION_LEDGER_PORTS_INVALID_CODE,
) {
  assertExactRecord(value, keys, keys, label, code);
}

function readDenseDataArray(
  value,
  label,
  maximum = MAX_ARRAY_ENTRIES,
  code = EVOLUTION_LEDGER_PORTS_INVALID_CODE,
) {
  rejectProxy(value, label, code);
  if (!Array.isArray(value)) {
    throw portsError(code, `${label} must be an array`);
  }
  const prototype = Object.getPrototypeOf(value);
  rejectProxy(prototype, `${label} prototype`, code);
  if (prototype !== Array.prototype && prototype !== null) {
    throw portsError(code, `${label} must use a safe array prototype`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length =
    lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : null;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    throw portsError(code, `${label} exceeds its bounded length`);
  }
  const allowed = new Set(["length"]);
  for (let index = 0; index < length; index += 1) {
    allowed.add(String(index));
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== length + 1 ||
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    throw portsError(code, `${label} must be dense and contain only indexes`);
  }
  const entries = new Array(length);
  for (let index = 0; index < length; index += 1) {
    entries[index] = ownData(value, String(index), label, code);
  }
  return entries;
}

function appendCanonical(state, fragment) {
  state.byteLength += Buffer.byteLength(fragment, "utf8");
  if (state.byteLength > state.maximumBytes) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      "canonical JSON exceeds its byte limit",
    );
  }
  state.fragments.push(fragment);
}

function canonicalWalk(value, state, depth) {
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      "canonical JSON exceeds its node or depth limit",
    );
  }
  if (value === null || typeof value === "boolean") {
    appendCanonical(state, JSON.stringify(value));
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        "canonical JSON numbers must be finite and not negative zero",
      );
    }
    appendCanonical(state, JSON.stringify(value));
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_CHARS) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        "canonical JSON string exceeds its character limit",
      );
    }
    appendCanonical(state, JSON.stringify(value));
    return;
  }
  if (!value || typeof value !== "object") {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      "canonical JSON contains an unsupported value",
    );
  }
  rejectProxy(value, "canonical JSON value");
  if (state.seen.has(value)) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      "canonical JSON must not contain cycles",
    );
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = readDenseDataArray(value, "canonical JSON array");
      appendCanonical(state, "[");
      for (let index = 0; index < entries.length; index += 1) {
        if (index > 0) appendCanonical(state, ",");
        canonicalWalk(entries[index], state, depth + 1);
      }
      appendCanonical(state, "]");
      return;
    }
    if (!isPlainRecord(value, "canonical JSON object")) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        "canonical JSON objects must use Object or null prototypes",
      );
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > MAX_OBJECT_FIELDS ||
      keys.some((key) => typeof key !== "string" || key.length > MAX_KEY_CHARS)
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        "canonical JSON object keys exceed their limits",
      );
    }
    keys.sort(compareStrings);
    appendCanonical(state, "{");
    for (let index = 0; index < keys.length; index += 1) {
      if (index > 0) appendCanonical(state, ",");
      const key = keys[index];
      appendCanonical(state, JSON.stringify(key));
      appendCanonical(state, ":");
      canonicalWalk(
        ownData(
          value,
          key,
          "canonical JSON object",
          EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        ),
        state,
        depth + 1,
      );
    }
    appendCanonical(state, "}");
  } finally {
    state.seen.delete(value);
  }
}

function canonicalJson(value) {
  const state = {
    byteLength: 0,
    fragments: [],
    maximumBytes: EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES,
    nodes: 0,
    seen: new Set(),
  };
  canonicalWalk(value, state, 0);
  return state.fragments.join("");
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  rejectProxy(value, "value being frozen");
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        "value being frozen must contain only data properties",
      );
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function frozenCanonicalClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function domainDigest(domain, value) {
  return sha256(
    Buffer.concat([
      Buffer.from(domain, "utf8"),
      Buffer.from(canonicalJson(value), "utf8"),
    ]),
  );
}

function digest(value, label, code = EVOLUTION_LEDGER_PORTS_INVALID_CODE) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw portsError(code, `${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function nullableDigest(value, label) {
  return value === null ? null : digest(value, label);
}

function identifier(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      `${label} must be a bounded identifier`,
    );
  }
  return value;
}

function nullableEventIdentifier(value) {
  return typeof value === "string" &&
    value.length <= 160 &&
    IDENTIFIER_PATTERN.test(value)
    ? value
    : null;
}

function skillName(value, label = "skillName") {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !SKILL_NAME_PATTERN.test(value)
  ) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      `${label} must use kebab-case`,
    );
  }
  return value;
}

function nullableEventSkillName(value) {
  return typeof value === "string" &&
    value.length <= 128 &&
    SKILL_NAME_PATTERN.test(value)
    ? value
    : null;
}

function revision(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      `${label} must be a bounded safe integer`,
    );
  }
  return value;
}

function assertSame(
  left,
  right,
  label,
  code = EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
) {
  if (left !== right) {
    throw portsError(code, `${label} binding differs`);
  }
}

function refsEqual(left, right) {
  return (
    left.schema === right.schema &&
    left.ref === right.ref &&
    left.digest === right.digest
  );
}

function normalizeArtifactRef(value, label, code) {
  assertAllExactRecord(value, ARTIFACT_REF_KEYS, label, code);
  if (value.schema !== EVOLUTION_ARTIFACT_REF_SCHEMA) {
    throw portsError(code, `${label} schema is invalid`);
  }
  return deepFreeze({
    digest: digest(value.digest, `${label}.digest`, code),
    ref: identifier(value.ref, `${label}.ref`, 2048),
    schema: EVOLUTION_ARTIFACT_REF_SCHEMA,
  });
}

function requireStableInstance(value, prototype, label) {
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} instance is required`);
  }
  rejectProxy(value, label);
  let cursor = Object.getPrototypeOf(value);
  while (cursor !== null) {
    rejectProxy(cursor, `${label} prototype chain`);
    if (cursor === prototype) return value;
    cursor = Object.getPrototypeOf(cursor);
  }
  throw new TypeError(`${label} instance is required`);
}

function captureDurabilityAuthority(value) {
  assertAllExactRecord(
    value,
    DURABILITY_AUTHORITY_KEYS,
    "artifactDurabilityAuthority",
  );
  const id = identifier(
    ownData(
      value,
      "id",
      "artifactDurabilityAuthority",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
    "artifactDurabilityAuthority.id",
  );
  const retain = ownData(
    value,
    "retain",
    "artifactDurabilityAuthority",
    EVOLUTION_LEDGER_PORTS_INVALID_CODE,
  );
  const resolve = ownData(
    value,
    "resolve",
    "artifactDurabilityAuthority",
    EVOLUTION_LEDGER_PORTS_INVALID_CODE,
  );
  rejectProxy(retain, "artifactDurabilityAuthority.retain");
  rejectProxy(resolve, "artifactDurabilityAuthority.resolve");
  if (typeof retain !== "function" || typeof resolve !== "function") {
    throw new TypeError(
      "artifactDurabilityAuthority requires synchronous retain and resolve methods",
    );
  }
  return Object.freeze({
    id,
    retain: Object.freeze((request) => Reflect.apply(retain, value, [request])),
    resolve: Object.freeze((request) =>
      Reflect.apply(resolve, value, [request]),
    ),
  });
}

function deterministicEventId(kind, identity) {
  const digestValue = domainDigest(EVENT_ID_DOMAINS[kind], identity);
  return `${EVENT_PREFIXES[kind]}:${digestValue.slice("sha256:".length)}`;
}

function copyBytes(value) {
  rejectProxy(
    value,
    "artifact resolution bytes",
    EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
  );
  if (!value || typeof value !== "object") {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      "artifact resolution bytes are invalid",
    );
  }
  const prototype = Object.getPrototypeOf(value);
  const safeBuffer = prototype === Buffer.prototype && Buffer.isBuffer(value);
  const safeUint8 =
    prototype === Uint8Array.prototype && utilTypes.isUint8Array(value);
  if (!safeBuffer && !safeUint8) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      "artifact resolution bytes must use a safe byte-array prototype",
    );
  }
  try {
    const arrayBuffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
    const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
    const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []);
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < 1 ||
      byteLength > EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES ||
      !Number.isSafeInteger(byteOffset) ||
      byteOffset < 0
    ) {
      throw new TypeError("artifact byte view bounds are invalid");
    }
    return Buffer.from(Buffer.from(arrayBuffer, byteOffset, byteLength));
  } catch (cause) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      "artifact bytes could not be copied safely",
      { cause },
    );
  }
}

function isCommitUnknown(error) {
  return error?.code === "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN";
}

function isEventConflict(error) {
  return error?.code === "CC_EVOLUTION_LEDGER_EVENT_CONFLICT";
}

function isHeadConflict(error) {
  return error?.code === "CC_EVOLUTION_LEDGER_HEAD_CONFLICT";
}

function assertSynchronous(value, label) {
  rejectProxy(value, label, EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE);
  if (utilTypes.isPromise(value)) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
      `${label} must be synchronous`,
    );
  }
  return value;
}

function durabilityResolveRequest({
  artifactTenantId,
  digest: digestValue,
  purpose,
  ref,
}) {
  return deepFreeze({
    artifactTenantId,
    digest: digestValue,
    purpose,
    ref,
    retention: "ledger",
    schema: EVOLUTION_ARTIFACT_DURABILITY_RESOLVE_REQUEST_SCHEMA,
  });
}

function resolveDurableArtifact(authority, request, expectedType = null) {
  assertAllExactRecord(
    request,
    DURABILITY_RESOLVE_REQUEST_KEYS,
    "artifact durability resolve request",
    EVOLUTION_LEDGER_PORTS_INVALID_CODE,
  );
  let result;
  try {
    result = assertSynchronous(
      authority.resolve(request),
      "artifact durability resolve result",
    );
  } catch (cause) {
    if (cause instanceof EvolutionLedgerPortsError) throw cause;
    throw portsError(
      EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
      "artifact durability authority could not resolve canonical bytes",
      { cause, ref: request.ref },
    );
  }
  assertAllExactRecord(
    result,
    DURABILITY_RESOLUTION_KEYS,
    "artifact durability resolution",
    EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
  );
  if (
    result.schema !== EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA ||
    result.authenticated !== true ||
    result.durable !== true ||
    result.authorityId !== authority.id ||
    result.artifactTenantId !== request.artifactTenantId ||
    result.digest !== request.digest ||
    result.purpose !== request.purpose ||
    result.ref !== request.ref ||
    result.retention !== request.retention ||
    (expectedType !== null && result.type !== expectedType)
  ) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
      "artifact durability resolution is not authenticated and exactly bound",
      { ref: request.ref },
    );
  }
  digest(
    result.receiptDigest,
    "artifact durability resolution receiptDigest",
    EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
  );
  const bytes = copyBytes(result.bytes);
  if (sha256(bytes) !== request.digest) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
      "artifact durability resolution bytes differ from the bound digest",
      { ref: request.ref },
    );
  }
  return { bytes, result };
}

function normalizeReceiptDigests(value) {
  assertAllExactRecord(value, RECEIPT_DIGEST_KEYS, "intent receiptDigests");
  const result = {};
  for (const key of [...RECEIPT_DIGEST_KEYS].sort(compareStrings)) {
    result[key] = digest(value[key], `receiptDigests.${key}`);
  }
  return deepFreeze(result);
}

function verifyReceiptRequestBinding(receipt, request) {
  for (const field of [
    "tenantId",
    "audience",
    "operationId",
    "operation",
    "transitionSubjectDigest",
    "skillName",
    "targetScope",
    "expectedTargetDigest",
    "expectedTargetRevision",
    "expiresAt",
    "nonce",
    "requestDigest",
  ]) {
    assertSame(
      receipt[field],
      request[field],
      `consumption receipt ${field}`,
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    );
  }
  if (
    receipt.role !== SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER ||
    request.targetScope !== SKILL_MUTATION_TARGET_SCOPES.ACTIVE ||
    ![
      SKILL_MUTATION_OPERATIONS.PROMOTE,
      SKILL_MUTATION_OPERATIONS.ROLLBACK,
    ].includes(request.operation)
  ) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      "release intent requires a consumed active promotion-controller request",
    );
  }
}

function normalizeIntent(input) {
  const value = frozenCanonicalClone(input);
  assertAllExactRecord(value, INTENT_KEYS, "release prepare intent");
  if (value.schema !== RELEASE_INTENT_SCHEMA) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      "release intent schema is unsupported",
    );
  }
  const receipt = verifySkillMutationConsumptionReceipt(value.authorityReceipt);
  const request = verifySkillMutationRequest(value.mutationRequest);
  verifyReceiptRequestBinding(receipt, request);
  const core = { ...value };
  delete core.intentDigest;
  const expectedIntentDigest = domainDigest(RELEASE_INTENT_DOMAIN, core);
  const normalized = {
    ...value,
    authorityReceiptDigest: digest(
      value.authorityReceiptDigest,
      "intent authorityReceiptDigest",
    ),
    candidateId: nullableDigest(value.candidateId, "intent candidateId"),
    dependencyLockDigest: digest(
      value.dependencyLockDigest,
      "intent dependencyLockDigest",
    ),
    expectedParentDigest: digest(
      value.expectedParentDigest,
      "intent expectedParentDigest",
    ),
    expectedRevision: revision(
      value.expectedRevision,
      "intent expectedRevision",
    ),
    intentDigest: digest(value.intentDigest, "intent intentDigest"),
    nextStateDigest: digest(value.nextStateDigest, "intent nextStateDigest"),
    operationId: identifier(value.operationId, "intent operationId"),
    pointerDigest: digest(value.pointerDigest, "intent pointerDigest"),
    previousStateDigest: nullableDigest(
      value.previousStateDigest,
      "intent previousStateDigest",
    ),
    receiptDigests: normalizeReceiptDigests(value.receiptDigests),
    requestDigest: digest(value.requestDigest, "intent requestDigest"),
    skillName: skillName(value.skillName),
    targetReleaseDigest: digest(
      value.targetReleaseDigest,
      "intent targetReleaseDigest",
    ),
    transactionId: digest(value.transactionId, "intent transactionId"),
    transitionSubjectDigest: digest(
      value.transitionSubjectDigest,
      "intent transitionSubjectDigest",
    ),
  };
  if (
    ![
      SKILL_MUTATION_OPERATIONS.PROMOTE,
      SKILL_MUTATION_OPERATIONS.ROLLBACK,
    ].includes(value.operation) ||
    value.intentDigest !== expectedIntentDigest ||
    value.authorityReceiptDigest !== receipt.receiptDigest ||
    value.requestDigest !== request.requestDigest ||
    value.operation !== request.operation ||
    value.operationId !== request.operationId ||
    value.skillName !== request.skillName ||
    value.transitionSubjectDigest !== request.transitionSubjectDigest ||
    value.expectedParentDigest !== request.expectedTargetDigest ||
    value.expectedRevision !== request.expectedTargetRevision ||
    value.nextStateDigest !== value.pointerDigest ||
    (value.expectedRevision === 0) !== (value.previousStateDigest === null) ||
    (value.operation === SKILL_MUTATION_OPERATIONS.PROMOTE &&
      value.candidateId === null) ||
    (value.operation === SKILL_MUTATION_OPERATIONS.ROLLBACK &&
      value.candidateId !== null)
  ) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      "release intent digest or authority bindings are invalid",
    );
  }
  return deepFreeze(normalized);
}

function normalizeFinalize(input) {
  const value = frozenCanonicalClone(input);
  assertAllExactRecord(value, FINALIZE_KEYS, "release finalize request");
  const normalized = deepFreeze({
    authorityReceiptDigest: digest(
      value.authorityReceiptDigest,
      "finalize authorityReceiptDigest",
    ),
    expectedPrepareReceiptDigest: digest(
      value.expectedPrepareReceiptDigest,
      "finalize expectedPrepareReceiptDigest",
    ),
    intentDigest: digest(value.intentDigest, "finalize intentDigest"),
    pointerDigest: digest(value.pointerDigest, "finalize pointerDigest"),
    revision: revision(value.revision, "finalize revision", { minimum: 1 }),
    skillName: skillName(value.skillName),
    stateDigest: digest(value.stateDigest, "finalize stateDigest"),
    transactionId: digest(value.transactionId, "finalize transactionId"),
  });
  if (normalized.pointerDigest !== normalized.stateDigest) {
    throw portsError(
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
      "finalize pointerDigest must equal stateDigest",
    );
  }
  return normalized;
}

function logicalFinalizeDigest(value) {
  return domainDigest(RELEASE_FINALIZATION_DOMAIN, value);
}

function nonceKey(claim) {
  return deepFreeze({
    audience: claim.audience,
    nonce: claim.nonce,
    tenantId: claim.tenantId,
  });
}

function projectionReceiptDigest(kind, projection) {
  const core = { ...projection };
  delete core.current;
  delete core.receiptDigest;
  return domainDigest(
    kind === "prepare"
      ? PROJECTION_PREPARE_RECEIPT_DOMAIN
      : PROJECTION_FINALIZE_RECEIPT_DOMAIN,
    core,
  );
}

class EvolutionLedgerDomainPorts {
  #appendDomainEvent;
  #artifactPut;
  #artifactResolve;
  #artifactTenantId;
  #audience;
  #durabilityAuthority;
  #durabilityAuthorityId;
  #durabilityRetain;
  #ledgerQuery;
  #ledgerRead;
  #ledgerVerifyReceipt;
  #purpose;

  constructor({
    artifactDurabilityAuthority,
    artifactPorts,
    artifactTenantId,
    audience,
    ledger,
    purpose,
  }) {
    this.#artifactTenantId = identifier(artifactTenantId, "artifactTenantId");
    this.#audience =
      audience === undefined ? null : identifier(audience, "audience");
    this.#purpose = identifier(purpose, "purpose");
    this.#durabilityAuthority = artifactDurabilityAuthority;
    this.#durabilityAuthorityId = artifactDurabilityAuthority.id;
    this.#durabilityRetain = artifactDurabilityAuthority.retain;
    this.#appendDomainEvent = Object.freeze(
      EvolutionLedger.prototype.appendDomainEvent.bind(ledger),
    );
    this.#ledgerQuery = Object.freeze(
      EvolutionLedger.prototype.query.bind(ledger),
    );
    this.#ledgerRead = Object.freeze(
      EvolutionLedger.prototype.read.bind(ledger),
    );
    this.#ledgerVerifyReceipt = Object.freeze(
      EvolutionLedger.prototype.verifyReceipt.bind(ledger),
    );
    this.#artifactPut = Object.freeze(
      EvolutionArtifactPorts.prototype.putCanonical.bind(artifactPorts),
    );
    this.#artifactResolve =
      EvolutionArtifactPorts.prototype.createEvolutionLedgerArtifactResolver.call(
        artifactPorts,
        Object.freeze({ purpose: this.#purpose }),
      );
    Object.freeze(this);
  }

  #assertAudience(value, label, { nullable = false } = {}) {
    if (value === null && nullable) return null;
    const normalized = identifier(value, label);
    if (this.#audience !== null && normalized !== this.#audience) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        `${label} differs from the captured audience`,
      );
    }
    return normalized;
  }

  #durabilityBinding(ref, type) {
    return deepFreeze({
      artifactTenantId: this.#artifactTenantId,
      digest: ref.digest,
      purpose: this.#purpose,
      ref: ref.ref,
      retention: "ledger",
      schema: EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
      type,
    });
  }

  #validateDurabilityReceipt(receipt, binding, label) {
    assertAllExactRecord(
      receipt,
      DURABILITY_RECEIPT_KEYS,
      label,
      EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
    );
    if (
      receipt.schema !== EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA ||
      receipt.authenticated !== true ||
      receipt.durable !== true ||
      receipt.authorityId !== this.#durabilityAuthorityId
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        `${label} is not authenticated durable evidence`,
      );
    }
    for (const field of [
      "artifactTenantId",
      "digest",
      "purpose",
      "ref",
      "retention",
      "type",
    ]) {
      assertSame(
        receipt[field],
        binding[field],
        `${label} ${field}`,
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
      );
    }
    digest(
      receipt.receiptDigest,
      `${label} receiptDigest`,
      EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
    );
    return receipt;
  }

  #retainDurably(binding, bytes) {
    let receipt;
    try {
      receipt = assertSynchronous(
        this.#durabilityRetain(
          Object.freeze({
            binding,
            bytes: Buffer.from(bytes),
            schema: EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA,
          }),
        ),
        "artifact durability retain result",
      );
    } catch (cause) {
      if (cause instanceof EvolutionLedgerPortsError) throw cause;
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        "artifact durability authority failed to retain canonical bytes",
        { cause },
      );
    }
    return this.#validateDurabilityReceipt(
      receipt,
      binding,
      "artifact durability retain receipt",
    );
  }

  #resolveDurably(ref, type) {
    return resolveDurableArtifact(
      this.#durabilityAuthority,
      durabilityResolveRequest({
        artifactTenantId: this.#artifactTenantId,
        digest: ref.digest,
        purpose: this.#purpose,
        ref: ref.ref,
      }),
      type,
    );
  }

  #putSubject(type, value, logicalDigest, audience) {
    const context = {
      purpose: this.#purpose,
      retention: "ledger",
      ...(audience === null || audience === undefined ? {} : { audience }),
    };
    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = assertSynchronous(
          this.#artifactPut(type, value, deepFreeze(context)),
          "EvolutionArtifactPorts.putCanonical result",
        );
        break;
      } catch (error) {
        if (
          attempt === 0 &&
          error?.code === EVOLUTION_ARTIFACT_STORE_FAILED_CODE
        ) {
          continue;
        }
        throw error;
      }
    }
    assertAllExactRecord(
      result,
      ARTIFACT_PUT_RESULT_KEYS,
      "artifact put result",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    const ref = normalizeArtifactRef(
      result.ref,
      "artifact put result ref",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    assertSame(
      result.digest,
      ref.digest,
      "artifact put digest",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    if (logicalDigest === ref.digest) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "logical payload digest must remain distinct from artifact record digest",
      );
    }
    if (typeof result.envelope !== "string") {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "artifact put result envelope is invalid",
      );
    }
    const receipt = result.receipt;
    if (
      !isPlainRecord(
        receipt,
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      )
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "artifact persistence receipt is invalid",
      );
    }
    if (
      ownData(
        receipt,
        "schema",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== EVOLUTION_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA ||
      ownData(
        receipt,
        "tenantId",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== this.#artifactTenantId ||
      ownData(
        receipt,
        "type",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== type ||
      ownData(
        receipt,
        "retention",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== "ledger" ||
      ownData(
        receipt,
        "purpose",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== this.#purpose
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "artifact persistence receipt is not bound to this adapter",
      );
    }
    const receiptAudience = ownData(
      receipt,
      "audience",
      "artifact persistence receipt",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    if (
      typeof receiptAudience !== "string" ||
      (this.#audience !== null && receiptAudience !== this.#audience) ||
      (audience !== null &&
        audience !== undefined &&
        receiptAudience !== audience) ||
      ownData(
        receipt,
        "digest",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== ref.digest ||
      ownData(
        receipt,
        "ref",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== ref.ref ||
      ownData(
        receipt,
        "persisted",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== true ||
      ownData(
        receipt,
        "readbackVerified",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== true ||
      ownData(
        receipt,
        "integrityVerified",
        "artifact persistence receipt",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      ) !== true
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "artifact persistence receipt does not bind its exact readback",
      );
    }
    const durableRecord = deepFreeze({
      audience: receiptAudience,
      purpose: this.#purpose,
      retention: "ledger",
      schema: EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
      tenantId: this.#artifactTenantId,
      type,
      value,
    });
    const durableBytes = Buffer.from(canonicalJson(durableRecord), "utf8");
    if (sha256(durableBytes) !== ref.digest) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "artifact persistence ref does not identify the exact canonical record",
      );
    }
    this.#retainDurably(this.#durabilityBinding(ref, type), durableBytes);
    return ref;
  }

  #resolveSubject(event, expectedType, expectedAudience = null) {
    const ref = normalizeArtifactRef(
      event.subjectRef,
      "domain event subjectRef",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    const durable = this.#resolveDurably(ref, expectedType);
    let resolution = null;
    try {
      resolution = assertSynchronous(
        this.#artifactResolve(
          deepFreeze({
            epoch: event.epoch,
            ledgerId: event.ledgerId,
            ref,
            tenantId: this.#artifactTenantId,
          }),
        ),
        "artifact resolver result",
      );
    } catch {
      // A removed/corrupt local cache is recoverable only through the trusted
      // durability authority's exact canonical-byte replica above.
    }
    if (resolution !== null) {
      assertAllExactRecord(
        resolution,
        LEDGER_RESOLUTION_KEYS,
        "artifact resolver result",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      );
      if (
        resolution.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
        resolution.authenticated !== true ||
        resolution.found !== true ||
        resolution.ref !== ref.ref ||
        resolution.digest !== ref.digest
      ) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
          "artifact resolver result is not authenticated and exactly bound",
        );
      }
      digest(
        resolution.receiptDigest,
        "artifact resolution receiptDigest",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      );
      const localBytes = copyBytes(resolution.bytes);
      if (
        sha256(localBytes) !== ref.digest ||
        !localBytes.equals(durable.bytes)
      ) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
          "local artifact bytes differ from the authoritative durable replica",
        );
      }
    }
    const bytes = durable.bytes;
    let record;
    const json = bufferToString(bytes, "utf8");
    try {
      record = JSON.parse(json);
    } catch (cause) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "artifact record is not canonical JSON",
        { cause },
      );
    }
    assertAllExactRecord(
      record,
      ARTIFACT_RECORD_KEYS,
      "artifact record",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    if (
      canonicalJson(record) !== json ||
      record.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      record.tenantId !== this.#artifactTenantId ||
      record.type !== expectedType ||
      record.retention !== "ledger" ||
      record.purpose !== this.#purpose ||
      (expectedAudience !== null && record.audience !== expectedAudience) ||
      (this.#audience !== null && record.audience !== this.#audience)
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "artifact record is not bound to the expected tenant, audience, type, retention, and purpose",
      );
    }
    return deepFreeze(record);
  }

  #queryEvent(eventId) {
    let result;
    try {
      result = assertSynchronous(
        this.#ledgerQuery(
          Object.freeze({ eventId }),
          Object.freeze({ issueReceipt: false }),
        ),
        "EvolutionLedger.query result",
      );
    } catch (cause) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        "EvolutionLedger query failed closed",
        { cause, eventId },
      );
    }
    if (result === null) return null;
    assertAllExactRecord(
      result,
      QUERY_RESULT_KEYS,
      "EvolutionLedger query result",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    if (
      result.schema !== EVOLUTION_LEDGER_QUERY_SCHEMA ||
      result.authenticated !== true ||
      result.durable !== true ||
      result.receipt !== null ||
      result.event.eventId !== eventId
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "EvolutionLedger query result is not authenticated and exactly bound",
      );
    }
    return result;
  }

  #verifiedAppend(input, options = {}) {
    const receipt = assertSynchronous(
      this.#appendDomainEvent(deepFreeze(input), deepFreeze(options)),
      "EvolutionLedger append receipt",
    );
    const verification = assertSynchronous(
      this.#ledgerVerifyReceipt(receipt),
      "EvolutionLedger receipt verification",
    );
    if (
      verification.valid !== true ||
      verification.authenticated !== true ||
      verification.durable !== true ||
      verification.event.eventId !== input.eventId
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "EvolutionLedger append receipt is not durably bound",
      );
    }
    this.#assertEvidenceAnchor(verification, input.eventId);
    return verification;
  }

  #assertEvidenceAnchor(evidence, eventId = null) {
    const event = evidence?.event;
    const anchor = evidence?.anchor;
    const authority = evidence?.authority;
    if (
      evidence?.authenticated !== true ||
      evidence?.durable !== true ||
      !event ||
      !anchor ||
      !authority ||
      authority.authenticated !== true ||
      authority.durable !== true ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 1 ||
      anchor.sequence !== event.sequence ||
      anchor.headDigest !== event.eventDigest ||
      anchor.ledgerId !== event.ledgerId ||
      anchor.epoch !== event.epoch ||
      anchor.identityDigest !== event.identityDigest ||
      authority.ledgerId !== event.ledgerId ||
      authority.epoch !== event.epoch ||
      authority.identityDigest !== event.identityDigest ||
      !Number.isSafeInteger(authority.sequence) ||
      authority.sequence < event.sequence ||
      (eventId !== null && event.eventId !== eventId)
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "EvolutionLedger evidence anchor is not exactly bound to its event",
      );
    }
    return event;
  }

  #events() {
    let events;
    try {
      events = assertSynchronous(
        this.#ledgerRead(
          Object.freeze({
            afterSequence: 0,
            limit: EVOLUTION_LEDGER_MAX_EVENTS,
          }),
        ),
        "EvolutionLedger.read result",
      );
    } catch (cause) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        "EvolutionLedger bounded read failed closed",
        { cause },
      );
    }
    if (!Array.isArray(events) || events.length > EVOLUTION_LEDGER_MAX_EVENTS) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "EvolutionLedger returned an invalid bounded event snapshot",
      );
    }
    return events;
  }

  #indexSnapshot(events, subjects = new Map()) {
    const byEventId = new Map();
    const bySequence = new Map();
    for (const event of events) {
      if (
        byEventId.has(event.eventId) ||
        bySequence.has(event.sequence) ||
        event.sequence !== bySequence.size + 1
      ) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
          "EvolutionLedger returned a non-unique or discontinuous authenticated event snapshot",
        );
      }
      byEventId.set(event.eventId, event);
      bySequence.set(event.sequence, event);
    }
    return {
      byEventId,
      bySequence,
      events,
      subjects,
    };
  }

  #snapshot() {
    return this.#indexSnapshot(this.#events());
  }

  #snapshotWithVerifiedEvent(snapshot, verification) {
    const event = this.#assertEvidenceAnchor(verification);
    const authority = verification.authority;
    const previous = snapshot.events.at(-1) || null;
    const expectedSequence = (previous?.sequence ?? 0) + 1;
    if (
      event.sequence > expectedSequence ||
      authority.sequence > event.sequence
    ) {
      // Another writer committed between the authenticated read and this
      // verification. A complete reread is required because events are absent.
      return null;
    }
    if (
      event.sequence !== expectedSequence ||
      event.prevDigest !== (previous?.eventDigest ?? null) ||
      authority.sequence !== event.sequence ||
      authority.headDigest !== event.eventDigest ||
      authority.anchorDigest !== verification.anchor.anchorDigest ||
      snapshot.byEventId.has(event.eventId) ||
      snapshot.bySequence.has(event.sequence)
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "verified append event is not the exact continuation of its authenticated snapshot",
      );
    }
    return this.#indexSnapshot(
      [...snapshot.events, event],
      new Map(snapshot.subjects),
    );
  }

  #snapshotSubject(snapshot, event, expectedType, expectedAudience = null) {
    const ref = normalizeArtifactRef(
      event.subjectRef,
      "domain event subjectRef",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    const cacheKey = `${expectedType}\0${expectedAudience ?? ""}\0${ref.ref}\0${ref.digest}`;
    let record = snapshot.subjects.get(cacheKey);
    if (!record) {
      record = this.#resolveSubject(event, expectedType, expectedAudience);
      snapshot.subjects.set(cacheKey, record);
    }
    return record;
  }

  #assertDomainEvent(event, kind, eventId, logicalDigest) {
    if (
      event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
      event.eventId !== eventId ||
      event.type !== EVENT_TYPES[kind] ||
      event.reason !== logicalDigest ||
      event.artifactTenantId !== this.#artifactTenantId ||
      event.subjectRef.digest === logicalDigest
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_COLLISION_CODE,
        `deterministic ${kind} event id is bound to another subject`,
        { eventId },
      );
    }
    const sourceRefs = readDenseDataArray(
      event.sourceRefs,
      `${kind} event sourceRefs`,
      2,
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    for (const [index, ref] of sourceRefs.entries()) {
      normalizeArtifactRef(
        ref,
        `${kind} event sourceRefs[${index}]`,
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      );
    }
    return sourceRefs;
  }

  #auditFromEvent(
    event,
    expectedAuditDigest = null,
    record = this.#resolveSubject(event, ARTIFACT_TYPES.audit),
  ) {
    const audit = verifySkillMutationAuditEvent(record.value);
    const eventId = deterministicEventId("audit", {
      auditDigest: audit.auditDigest,
    });
    const sourceRefs = this.#assertDomainEvent(
      event,
      "audit",
      eventId,
      audit.auditDigest,
    );
    if (
      sourceRefs.length !== 0 ||
      event.decision !==
        (audit.decision === "allow" ? "accepted" : "rejected") ||
      event.correlationId !== nullableEventIdentifier(audit.operationId) ||
      event.tenantId !== nullableEventIdentifier(audit.tenantId) ||
      event.skillName !== nullableEventSkillName(audit.skillName) ||
      event.timestamp !== audit.occurredAt ||
      (expectedAuditDigest !== null &&
        audit.auditDigest !== expectedAuditDigest)
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "mutation audit ledger event differs from its exact subject",
      );
    }
    return { audit, event, record };
  }

  #assertConsumptionAudit(resolved, receipt) {
    const audit = resolved.audit;
    if (
      audit.phase !== "consume" ||
      audit.decision !== "allow" ||
      audit.code !== "CC_SKILL_MUTATION_CONSUMED" ||
      resolved.event.eventDigest !== receipt.headDigest ||
      resolved.event.sequence !== receipt.sequence ||
      resolved.record.audience !== receipt.audience
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "consumption receipt is not bound to a consume-allow audit head",
      );
    }
    for (const field of [
      "tenantId",
      "audience",
      "operationId",
      "operation",
      "transitionSubjectDigest",
      "skillName",
      "targetScope",
      "expectedTargetDigest",
      "expectedTargetRevision",
      "expiresAt",
      "nonce",
      "principalId",
      "role",
      "requestDigest",
    ]) {
      assertSame(
        audit[field],
        receipt[field],
        `consume audit ${field}`,
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      );
    }
    return resolved;
  }

  #auditFromSnapshot(snapshot, receipt) {
    const event = snapshot.bySequence.get(receipt.sequence);
    if (!event) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "consumption receipt audit sequence is absent from the authenticated snapshot",
      );
    }
    const record = this.#snapshotSubject(snapshot, event, ARTIFACT_TYPES.audit);
    // EvolutionLedger.read authenticates the complete persisted chain before
    // returning it, so the indexed event digest is the signed head at this
    // exact receipt sequence.
    return this.#assertConsumptionAudit(
      this.#auditFromEvent(event, receipt.auditDigest, record),
      receipt,
    );
  }

  #prepareFromEvent(event, record, consumeAudit, expected = null) {
    const intent = normalizeIntent(record.value);
    const eventId = deterministicEventId("prepare", {
      transactionId: intent.transactionId,
    });
    const sourceRefs = this.#assertDomainEvent(
      event,
      "prepare",
      eventId,
      intent.intentDigest,
    );
    if (
      sourceRefs.length !== 1 ||
      !refsEqual(sourceRefs[0], consumeAudit.event.subjectRef) ||
      event.decision !== "prepared" ||
      event.correlationId !== intent.transactionId ||
      event.tenantId !== intent.mutationRequest.tenantId ||
      event.skillName !== intent.skillName ||
      record.audience !== intent.mutationRequest.audience
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "release prepare event differs from its intent or authority audit",
      );
    }
    if (
      expected !== null &&
      (expected.transactionId !== intent.transactionId ||
        (expected.intentDigest !== undefined &&
          expected.intentDigest !== intent.intentDigest) ||
        (expected.authorityReceiptDigest !== undefined &&
          expected.authorityReceiptDigest !== intent.authorityReceiptDigest))
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_COLLISION_CODE,
        "release prepare event collides with another transaction subject",
      );
    }
    return { consumeAudit, event, intent, record };
  }

  #prepareFromSnapshot(snapshot, event, expected = null) {
    const record = this.#snapshotSubject(
      snapshot,
      event,
      ARTIFACT_TYPES.prepare,
    );
    const intent = normalizeIntent(record.value);
    return this.#prepareFromEvent(
      event,
      record,
      this.#auditFromSnapshot(snapshot, intent.authorityReceipt),
      expected,
    );
  }

  #prepareProjection(prepared) {
    const core = {
      authenticated: true,
      authorityReceiptDigest: prepared.intent.authorityReceiptDigest,
      durable: true,
      epoch: prepared.event.epoch,
      headDigest: prepared.event.eventDigest,
      intentDigest: prepared.intent.intentDigest,
      ledgerId: prepared.event.ledgerId,
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      sequence: prepared.event.sequence,
      status: "prepared",
      transactionId: prepared.intent.transactionId,
    };
    return deepFreeze({
      ...core,
      receiptDigest: projectionReceiptDigest("prepare", core),
    });
  }

  #finalizeFromEvent(snapshot, event, prepareCache = new Map()) {
    const record = this.#snapshotSubject(
      snapshot,
      event,
      ARTIFACT_TYPES.finalize,
    );
    const finalization = normalizeFinalize(record.value);
    const logicalDigest = logicalFinalizeDigest(finalization);
    const eventId = deterministicEventId("finalize", {
      transactionId: finalization.transactionId,
    });
    const sourceRefs = this.#assertDomainEvent(
      event,
      "finalize",
      eventId,
      logicalDigest,
    );
    const prepareEventId = deterministicEventId("prepare", {
      transactionId: finalization.transactionId,
    });
    const prepareEvent = snapshot.byEventId.get(prepareEventId);
    if (!prepareEvent) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "release finalize event has no verified prepare event",
      );
    }
    let prepared = prepareCache.get(prepareEventId);
    if (!prepared) {
      prepared = this.#prepareFromSnapshot(snapshot, prepareEvent, {
        transactionId: finalization.transactionId,
      });
      prepareCache.set(prepareEventId, prepared);
    }
    const prepareProjection = this.#prepareProjection(prepared);
    if (
      sourceRefs.length !== 1 ||
      !refsEqual(sourceRefs[0], prepared.event.subjectRef) ||
      event.decision !== "committed" ||
      event.correlationId !== finalization.transactionId ||
      event.tenantId !== prepared.intent.mutationRequest.tenantId ||
      event.skillName !== finalization.skillName ||
      record.audience !== prepared.intent.mutationRequest.audience ||
      finalization.intentDigest !== prepared.intent.intentDigest ||
      finalization.authorityReceiptDigest !==
        prepared.intent.authorityReceiptDigest ||
      finalization.expectedPrepareReceiptDigest !==
        prepareProjection.receiptDigest ||
      finalization.skillName !== prepared.intent.skillName ||
      finalization.revision !== prepared.intent.expectedRevision + 1 ||
      finalization.stateDigest !== prepared.intent.nextStateDigest ||
      finalization.pointerDigest !== prepared.intent.pointerDigest
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "release finalize event is not exactly bound to its prepare lineage",
      );
    }
    return {
      event,
      finalization,
      logicalDigest,
      prepared,
      prepareProjection,
      record,
      tenantId: prepared.intent.mutationRequest.tenantId,
    };
  }

  #lineages(snapshot, prepareCache = new Map()) {
    const groups = new Map();
    const byTransaction = new Map();
    for (const event of snapshot.events) {
      if (
        event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
        event.type !== EVENT_TYPES.finalize
      ) {
        continue;
      }
      const finalized = this.#finalizeFromEvent(snapshot, event, prepareCache);
      if (byTransaction.has(finalized.finalization.transactionId)) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
          "release finalize transaction appears more than once",
        );
      }
      byTransaction.set(finalized.finalization.transactionId, finalized);
      const groupKey = `${finalized.tenantId}\0${finalized.finalization.skillName}`;
      const group = groups.get(groupKey) || [];
      group.push(finalized);
      groups.set(groupKey, group);
    }
    for (const group of groups.values()) {
      group.sort(
        (left, right) =>
          left.finalization.revision - right.finalization.revision ||
          left.event.sequence - right.event.sequence,
      );
      let previous = null;
      for (let index = 0; index < group.length; index += 1) {
        const entry = group[index];
        if (
          entry.finalization.revision !== index + 1 ||
          entry.prepared.intent.expectedRevision !== index ||
          entry.prepared.intent.previousStateDigest !==
            (previous?.finalization.stateDigest ?? null) ||
          (previous !== null && entry.event.sequence <= previous.event.sequence)
        ) {
          throw portsError(
            EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
            "release finalize lineage contains a revision fork or gap",
          );
        }
        previous = entry;
      }
    }
    return { byTransaction, groups };
  }

  #committedProjection(finalized, lineages) {
    const groupKey = `${finalized.tenantId}\0${finalized.finalization.skillName}`;
    const group = lineages.groups.get(groupKey);
    const current = group?.at(-1) === finalized;
    const core = {
      authenticated: true,
      authorityReceiptDigest: finalized.finalization.authorityReceiptDigest,
      durable: true,
      epoch: finalized.event.epoch,
      headDigest: finalized.event.eventDigest,
      intentDigest: finalized.finalization.intentDigest,
      ledgerId: finalized.event.ledgerId,
      pointerDigest: finalized.finalization.pointerDigest,
      prepareReceiptDigest: finalized.finalization.expectedPrepareReceiptDigest,
      revision: finalized.finalization.revision,
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      sequence: finalized.event.sequence,
      skillName: finalized.finalization.skillName,
      stateDigest: finalized.finalization.stateDigest,
      status: "committed",
      transactionId: finalized.finalization.transactionId,
    };
    return deepFreeze({
      ...core,
      current,
      receiptDigest: projectionReceiptDigest("finalize", core),
    });
  }

  #finalizeState(snapshot, finalization, logicalDigest) {
    const prepareEventId = deterministicEventId("prepare", {
      transactionId: finalization.transactionId,
    });
    const prepareEvent = snapshot.byEventId.get(prepareEventId);
    if (!prepareEvent) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        "release finalize requires a verified prepare event",
      );
    }
    const prepared = this.#prepareFromSnapshot(snapshot, prepareEvent, {
      authorityReceiptDigest: finalization.authorityReceiptDigest,
      intentDigest: finalization.intentDigest,
      transactionId: finalization.transactionId,
    });
    const prepareProjection = this.#prepareProjection(prepared);
    if (
      finalization.expectedPrepareReceiptDigest !==
        prepareProjection.receiptDigest ||
      finalization.skillName !== prepared.intent.skillName ||
      finalization.revision !== prepared.intent.expectedRevision + 1 ||
      finalization.stateDigest !== prepared.intent.nextStateDigest ||
      finalization.pointerDigest !== prepared.intent.pointerDigest
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        "release finalize request differs from its verified prepare event",
      );
    }
    const lineages = this.#lineages(
      snapshot,
      new Map([[prepareEventId, prepared]]),
    );
    const existing = lineages.byTransaction.get(finalization.transactionId);
    if (existing) {
      if (existing.logicalDigest !== logicalDigest) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_COLLISION_CODE,
          "release finalize event id is bound to another subject",
        );
      }
      return { existing, lineages, prepared };
    }
    const groupKey = `${prepared.intent.mutationRequest.tenantId}\0${finalization.skillName}`;
    const current = lineages.groups.get(groupKey)?.at(-1) || null;
    if (
      finalization.revision !== (current?.finalization.revision ?? 0) + 1 ||
      prepared.intent.previousStateDigest !==
        (current?.finalization.stateDigest ?? null)
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "release finalize would create a revision fork or gap",
      );
    }
    return { existing: null, lineages, prepared };
  }

  prepare(input) {
    const intent = normalizeIntent(input);
    this.#assertAudience(intent.mutationRequest.audience, "intent audience");
    const eventId = deterministicEventId("prepare", {
      transactionId: intent.transactionId,
    });
    const snapshot = this.#snapshot();
    const existing = snapshot.byEventId.get(eventId);
    if (existing) {
      return this.#prepareProjection(
        this.#prepareFromSnapshot(snapshot, existing, {
          authorityReceiptDigest: intent.authorityReceiptDigest,
          intentDigest: intent.intentDigest,
          transactionId: intent.transactionId,
        }),
      );
    }
    const audit = this.#auditFromSnapshot(snapshot, intent.authorityReceipt);
    const subjectRef = this.#putSubject(
      ARTIFACT_TYPES.prepare,
      intent,
      intent.intentDigest,
      intent.mutationRequest.audience,
    );
    const eventInput = {
      artifactTenantId: this.#artifactTenantId,
      correlationId: intent.transactionId,
      decision: "prepared",
      eventId,
      reason: intent.intentDigest,
      skillName: intent.skillName,
      sourceRefs: [audit.event.subjectRef],
      subjectRef,
      tenantId: intent.mutationRequest.tenantId,
      type: EVENT_TYPES.prepare,
    };
    let persistedSnapshot;
    try {
      const verification = this.#verifiedAppend(eventInput);
      persistedSnapshot =
        this.#snapshotWithVerifiedEvent(snapshot, verification) ||
        this.#snapshot();
    } catch (cause) {
      if (!isCommitUnknown(cause) && !isEventConflict(cause)) throw cause;
      persistedSnapshot = this.#snapshot();
    }
    const persisted = persistedSnapshot.byEventId.get(eventId);
    if (!persisted) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        "release prepare append did not converge to a queryable event",
      );
    }
    return this.#prepareProjection(
      this.#prepareFromSnapshot(persistedSnapshot, persisted, {
        authorityReceiptDigest: intent.authorityReceiptDigest,
        intentDigest: intent.intentDigest,
        transactionId: intent.transactionId,
      }),
    );
  }

  finalize(input) {
    const finalization = normalizeFinalize(input);
    const logicalDigest = logicalFinalizeDigest(finalization);
    const eventId = deterministicEventId("finalize", {
      transactionId: finalization.transactionId,
    });
    let snapshot = this.#snapshot();
    let state = this.#finalizeState(snapshot, finalization, logicalDigest);
    if (state.existing) {
      return this.#committedProjection(state.existing, state.lineages);
    }
    const subjectRef = this.#putSubject(
      ARTIFACT_TYPES.finalize,
      finalization,
      logicalDigest,
      state.prepared.intent.mutationRequest.audience,
    );
    for (let attempt = 0; attempt < MAX_FINALIZE_RETRIES; attempt += 1) {
      const previous = snapshot.events.at(-1) || null;
      const eventInput = {
        artifactTenantId: this.#artifactTenantId,
        correlationId: finalization.transactionId,
        decision: "committed",
        eventId,
        reason: logicalDigest,
        skillName: finalization.skillName,
        sourceRefs: [state.prepared.event.subjectRef],
        subjectRef,
        tenantId: state.prepared.intent.mutationRequest.tenantId,
        type: EVENT_TYPES.finalize,
      };
      try {
        this.#verifiedAppend(eventInput, {
          expectedHeadDigest: previous?.eventDigest ?? null,
          expectedSequence: previous?.sequence ?? 0,
        });
      } catch (cause) {
        if (isHeadConflict(cause)) {
          snapshot = this.#snapshot();
          state = this.#finalizeState(snapshot, finalization, logicalDigest);
          if (state.existing) {
            return this.#committedProjection(state.existing, state.lineages);
          }
          continue;
        }
        if (!isCommitUnknown(cause) && !isEventConflict(cause)) throw cause;
      }
      const recoveredSnapshot = this.#snapshot();
      const recoveredState = this.#finalizeState(
        recoveredSnapshot,
        finalization,
        logicalDigest,
      );
      if (!recoveredState.existing) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_COLLISION_CODE,
          "release finalize append did not converge to its exact subject",
        );
      }
      return this.#committedProjection(
        recoveredState.existing,
        recoveredState.lineages,
      );
    }
    throw portsError(
      EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
      "release finalize could not acquire a stable ledger head",
    );
  }

  query(transactionIdValue) {
    const transactionId = digest(transactionIdValue, "transactionId");
    const prepareEventId = deterministicEventId("prepare", { transactionId });
    const finalizeEventId = deterministicEventId("finalize", { transactionId });
    const snapshot = this.#snapshot();
    const prepareEvent = snapshot.byEventId.get(prepareEventId);
    const finalizeEvent = snapshot.byEventId.get(finalizeEventId);
    if (!prepareEvent) {
      if (finalizeEvent) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
          "release transaction has finalize evidence without prepare evidence",
        );
      }
      return deepFreeze({
        authenticated: true,
        durable: true,
        schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
        status: "absent",
        transactionId,
      });
    }
    const prepared = this.#prepareFromSnapshot(snapshot, prepareEvent, {
      transactionId,
    });
    if (!finalizeEvent) return this.#prepareProjection(prepared);
    const lineages = this.#lineages(
      snapshot,
      new Map([[prepareEventId, prepared]]),
    );
    const finalized = lineages.byTransaction.get(transactionId);
    if (!finalized || finalized.event !== finalizeEvent) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "release finalize query differs from verified lineage",
      );
    }
    return this.#committedProjection(finalized, lineages);
  }

  appendAudit(input) {
    const value = frozenCanonicalClone(input);
    const audit = verifySkillMutationAuditEvent(value);
    if (audit.audience !== null) {
      this.#assertAudience(audit.audience, "audit audience");
    }
    const eventId = deterministicEventId("audit", {
      auditDigest: audit.auditDigest,
    });
    const existing = this.#queryEvent(eventId);
    if (existing)
      return this.#auditAcknowledgement(existing, audit.auditDigest);
    const subjectRef = this.#putSubject(
      ARTIFACT_TYPES.audit,
      audit,
      audit.auditDigest,
      audit.audience,
    );
    const eventInput = {
      artifactTenantId: this.#artifactTenantId,
      correlationId: nullableEventIdentifier(audit.operationId),
      decision: audit.decision === "allow" ? "accepted" : "rejected",
      eventId,
      reason: audit.auditDigest,
      skillName: nullableEventSkillName(audit.skillName),
      sourceRefs: [],
      subjectRef,
      tenantId: nullableEventIdentifier(audit.tenantId),
      timestamp: audit.occurredAt,
      type: EVENT_TYPES.audit,
    };
    let verification = null;
    try {
      verification = this.#verifiedAppend(eventInput);
    } catch (cause) {
      if (!isCommitUnknown(cause) && !isEventConflict(cause)) throw cause;
    }
    if (verification) {
      return this.#auditAcknowledgement(verification, audit.auditDigest);
    }
    const persisted = this.#queryEvent(eventId);
    if (!persisted) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        "mutation audit append did not converge to a queryable event",
      );
    }
    return this.#auditAcknowledgement(persisted, audit.auditDigest);
  }

  #auditAcknowledgement(evidence, auditDigest) {
    const event = this.#assertEvidenceAnchor(evidence);
    const resolved = this.#auditFromEvent(event, auditDigest);
    return deepFreeze({
      auditDigest,
      headDigest: evidence.anchor.headDigest,
      persisted: true,
      sequence: resolved.event.sequence,
    });
  }

  #nonceFromEvidence(evidence) {
    const event = this.#assertEvidenceAnchor(evidence);
    const record = this.#resolveSubject(event, ARTIFACT_TYPES.nonce);
    const claim = verifySkillMutationNonceClaim(record.value);
    const key = nonceKey(claim);
    const eventId = deterministicEventId("nonce", key);
    const sourceRefs = this.#assertDomainEvent(
      event,
      "nonce",
      eventId,
      claim.claimDigest,
    );
    if (
      sourceRefs.length !== 0 ||
      event.decision !== "committed" ||
      event.correlationId !== claim.operationId ||
      event.tenantId !== claim.tenantId ||
      event.skillName !== null ||
      event.timestamp !== claim.claimedAt ||
      record.audience !== claim.audience
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "mutation nonce event differs from its exact claim subject",
      );
    }
    return { claim, event, evidence, key, record };
  }

  claimNonce(input) {
    const value = frozenCanonicalClone(input);
    const claim = verifySkillMutationNonceClaim(value);
    this.#assertAudience(claim.audience, "nonce audience");
    if (!NONCE_PATTERN.test(claim.nonce)) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        "nonce claim nonce is invalid",
      );
    }
    const key = nonceKey(claim);
    const eventId = deterministicEventId("nonce", key);
    const existing = this.#queryEvent(eventId);
    if (existing) {
      const winner = this.#nonceFromEvidence(existing);
      return this.#nonceAcknowledgement(claim, winner, false);
    }
    const subjectRef = this.#putSubject(
      ARTIFACT_TYPES.nonce,
      claim,
      claim.claimDigest,
      claim.audience,
    );
    const eventInput = {
      artifactTenantId: this.#artifactTenantId,
      correlationId: claim.operationId,
      decision: "committed",
      eventId,
      reason: claim.claimDigest,
      skillName: null,
      sourceRefs: [],
      subjectRef,
      tenantId: claim.tenantId,
      timestamp: claim.claimedAt,
      type: EVENT_TYPES.nonce,
    };
    let verification = null;
    let appendFailure = null;
    try {
      verification = this.#verifiedAppend(eventInput);
    } catch (cause) {
      if (!isCommitUnknown(cause) && !isEventConflict(cause)) throw cause;
      appendFailure = cause;
    }
    if (verification) {
      const winner = this.#nonceFromEvidence(verification);
      if (winner.claim.claimDigest !== claim.claimDigest) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_COLLISION_CODE,
          "mutation nonce winner differs after a successful append",
        );
      }
      return this.#nonceAcknowledgement(claim, winner, true);
    }
    const persisted = this.#queryEvent(eventId);
    if (!persisted) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        "mutation nonce commit outcome remains unknown",
        { cause: appendFailure },
      );
    }
    const winner = this.#nonceFromEvidence(persisted);
    if (isCommitUnknown(appendFailure)) {
      if (winner.claim.claimDigest !== claim.claimDigest) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_COLLISION_CODE,
          "commit-unknown nonce append did not publish its exact subject",
          { cause: appendFailure },
        );
      }
      return this.#nonceAcknowledgement(claim, winner, true);
    }
    return this.#nonceAcknowledgement(claim, winner, false);
  }

  #nonceAcknowledgement(claim, winner, claimed) {
    for (const field of ["tenantId", "audience", "nonce"]) {
      assertSame(
        winner.claim[field],
        claim[field],
        `nonce winner ${field}`,
        EVOLUTION_LEDGER_PORTS_COLLISION_CODE,
      );
    }
    return deepFreeze({
      claimDigest: claim.claimDigest,
      claimed,
      expiresAt: claim.expiresAt,
      headDigest: winner.evidence.anchor.headDigest,
      persisted: true,
      schema: SKILL_MUTATION_NONCE_ACK_SCHEMA,
      sequence: winner.event.sequence,
    });
  }
}

/**
 * Build the resolver that must be captured by the one EvolutionLedger used by
 * these ports. Ledger-retained domain subjects always resolve from the trusted
 * durable replica; the local ArtifactPorts copy is an optional cross-check and
 * cache. Other artifact classes continue to use the local resolver.
 */
export function createEvolutionLedgerDurableArtifactResolver(options = {}) {
  assertAllExactRecord(
    options,
    DURABLE_RESOLVER_OPTION_KEYS,
    "durable ledger artifact resolver options",
  );
  const artifactPorts = requireStableInstance(
    ownData(
      options,
      "artifactPorts",
      "durable ledger artifact resolver options",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
    EvolutionArtifactPorts.prototype,
    "EvolutionArtifactPorts",
  );
  const authority = captureDurabilityAuthority(
    ownData(
      options,
      "artifactDurabilityAuthority",
      "durable ledger artifact resolver options",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
  );
  const artifactTenantId = identifier(
    ownData(
      options,
      "artifactTenantId",
      "durable ledger artifact resolver options",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
    "artifactTenantId",
  );
  const purpose = identifier(
    ownData(
      options,
      "purpose",
      "durable ledger artifact resolver options",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
    "purpose",
  );
  const localResolve =
    EvolutionArtifactPorts.prototype.createEvolutionLedgerArtifactResolver.call(
      artifactPorts,
      Object.freeze({ purpose }),
    );

  const resolve = (input) => {
    assertAllExactRecord(
      input,
      LEDGER_ARTIFACT_REQUEST_KEYS,
      "EvolutionLedger artifact request",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    );
    assertSame(
      input.tenantId,
      artifactTenantId,
      "EvolutionLedger artifact tenantId",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    );
    identifier(input.ledgerId, "EvolutionLedger ledgerId");
    identifier(input.epoch, "EvolutionLedger epoch");
    const ref = normalizeArtifactRef(
      input.ref,
      "EvolutionLedger artifact ref",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    );
    let durable = null;
    let durableError = null;
    try {
      durable = resolveDurableArtifact(
        authority,
        durabilityResolveRequest({
          artifactTenantId,
          digest: ref.digest,
          purpose,
          ref: ref.ref,
        }),
      );
    } catch (cause) {
      durableError = cause;
    }

    let local = null;
    try {
      local = assertSynchronous(
        localResolve(input),
        "local EvolutionLedger artifact resolution",
      );
    } catch {
      // Local ArtifactPorts is a cache for retained subjects. Its absence is
      // recoverable only when the authoritative replica above is valid.
    }
    let localBytes = null;
    if (local !== null) {
      assertAllExactRecord(
        local,
        LEDGER_RESOLUTION_KEYS,
        "local EvolutionLedger artifact resolution",
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
      );
      if (
        local.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
        local.authenticated !== true ||
        local.found !== true ||
        local.ref !== ref.ref ||
        local.digest !== ref.digest
      ) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
          "local EvolutionLedger artifact resolution is not exactly bound",
        );
      }
      localBytes = copyBytes(local.bytes);
      if (sha256(localBytes) !== ref.digest) {
        throw portsError(
          EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
          "local EvolutionLedger artifact bytes differ from their digest",
        );
      }
    }

    const selectedBytes = durable?.bytes || localBytes;
    if (!selectedBytes) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        "artifact is absent from both local and authoritative durable stores",
        { cause: durableError, ref: ref.ref },
      );
    }
    let record;
    const json = bufferToString(selectedBytes, "utf8");
    try {
      record = JSON.parse(json);
    } catch (cause) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "resolved artifact is not canonical JSON",
        { cause },
      );
    }
    assertAllExactRecord(
      record,
      ARTIFACT_RECORD_KEYS,
      "resolved durable artifact record",
      EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
    );
    const retainedSubject =
      record.schema === EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA &&
      record.tenantId === artifactTenantId &&
      record.purpose === purpose &&
      record.retention === "ledger" &&
      DURABLE_ARTIFACT_TYPE_SET.has(record.type);
    if (
      canonicalJson(record) !== json ||
      (durable !== null && durable.result.type !== record.type) ||
      (retainedSubject && durable === null)
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_UNAVAILABLE_CODE,
        "ledger-retained subject lacks an exact authoritative replica",
        { cause: durableError, ref: ref.ref },
      );
    }
    if (
      durable !== null &&
      localBytes !== null &&
      !localBytes.equals(durable.bytes)
    ) {
      throw portsError(
        EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        "local artifact differs from the authoritative durable replica",
      );
    }
    return Object.freeze({
      authenticated: true,
      bytes: Buffer.from(selectedBytes),
      digest: ref.digest,
      found: true,
      receiptDigest:
        durable?.result.receiptDigest ||
        digest(
          local.receiptDigest,
          "local artifact resolution receiptDigest",
          EVOLUTION_LEDGER_PORTS_CORRUPT_CODE,
        ),
      ref: ref.ref,
      schema: EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
    });
  };
  return Object.freeze(resolve);
}

export function createEvolutionLedgerPorts(options = {}) {
  assertExactRecord(
    options,
    FACTORY_OPTION_KEYS,
    FACTORY_REQUIRED_KEYS,
    "evolution ledger ports options",
  );
  const ledger = requireStableInstance(
    ownData(
      options,
      "ledger",
      "evolution ledger ports options",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
    EvolutionLedger.prototype,
    "EvolutionLedger",
  );
  const artifactPorts = requireStableInstance(
    ownData(
      options,
      "artifactPorts",
      "evolution ledger ports options",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
    EvolutionArtifactPorts.prototype,
    "EvolutionArtifactPorts",
  );
  const artifactDurabilityAuthority = captureDurabilityAuthority(
    ownData(
      options,
      "artifactDurabilityAuthority",
      "evolution ledger ports options",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
  );
  const adapter = new EvolutionLedgerDomainPorts({
    artifactDurabilityAuthority,
    artifactPorts,
    artifactTenantId: ownData(
      options,
      "artifactTenantId",
      "evolution ledger ports options",
      EVOLUTION_LEDGER_PORTS_INVALID_CODE,
    ),
    audience: Object.hasOwn(options, "audience")
      ? ownData(
          options,
          "audience",
          "evolution ledger ports options",
          EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        )
      : undefined,
    ledger,
    purpose: Object.hasOwn(options, "purpose")
      ? ownData(
          options,
          "purpose",
          "evolution ledger ports options",
          EVOLUTION_LEDGER_PORTS_INVALID_CODE,
        )
      : "evolution-ledger",
  });
  const prepare = Object.freeze((input) => adapter.prepare(input));
  const finalize = Object.freeze((input) => adapter.finalize(input));
  const query = Object.freeze((transactionId) => adapter.query(transactionId));
  const append = Object.freeze((event) => adapter.appendAudit(event));
  const claim = Object.freeze((nonce) => adapter.claimNonce(nonce));
  return Object.freeze({
    auditSink: Object.freeze({ append }),
    nonceStore: Object.freeze({ claim }),
    transactionLedger: Object.freeze({ finalize, prepare, query }),
  });
}

Object.freeze(EvolutionLedgerPortsError.prototype);
Object.freeze(EvolutionLedgerPortsError);
