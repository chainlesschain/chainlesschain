import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import { withFileLock } from "../with-file-lock.js";

export const EVOLUTION_LEDGER_EVENT_SCHEMA =
  "chainlesschain.evolution-event/v2";
export const EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA =
  "chainlesschain.evolution-domain-event/v1";
export const EVOLUTION_LEDGER_IDENTITY_SCHEMA =
  "chainlesschain.evolution-ledger-identity/v1";
export const EVOLUTION_LEDGER_ANCHOR_SCHEMA =
  "chainlesschain.evolution-ledger-head-anchor/v1";
export const EVOLUTION_LEDGER_RECEIPT_SCHEMA =
  "chainlesschain.evolution-ledger-receipt/v2";
export const EVOLUTION_LEDGER_VERIFICATION_SCHEMA =
  "chainlesschain.evolution-ledger-verification/v2";
export const EVOLUTION_LEDGER_QUERY_SCHEMA =
  "chainlesschain.evolution-ledger-query-result/v1";
export const EVOLUTION_LEDGER_WITNESS_SCHEMA =
  "chainlesschain.evolution-ledger-witness/v1";
export const EVOLUTION_LEDGER_WITNESS_ANCESTRY_SCHEMA =
  "chainlesschain.evolution-ledger-witness-ancestry/v1";
export const EVOLUTION_LEDGER_STORE_MARKER_SCHEMA =
  "chainlesschain.evolution-ledger-store-marker/v1";
export const EVOLUTION_ARTIFACT_REF_SCHEMA =
  "chainlesschain.content-addressed-artifact-ref/v1";
export const EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA =
  "chainlesschain.artifact-resolution/v1";
export const EVOLUTION_LEDGER_MAX_EVENT_BYTES = 1024 * 1024;
export const EVOLUTION_LEDGER_MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const EVOLUTION_LEDGER_MAX_EVENTS = 250_000;

const IDENTITY_DOMAIN = "chainlesschain.evolution-ledger-identity/v1\0";
const EVENT_DOMAIN = "chainlesschain.evolution-event/v2\0";
const DOMAIN_EVENT_DOMAIN = "chainlesschain.evolution-domain-event/v1\0";
const SEGMENT_DOMAIN = "chainlesschain.evolution-segment/v1\0";
const ANCHOR_DOMAIN = "chainlesschain.evolution-ledger-head-anchor/v1\0";
const RECEIPT_DOMAIN = "chainlesschain.evolution-ledger-receipt/v2\0";
const WITNESS_DOMAIN = "chainlesschain.evolution-ledger-witness/v1\0";
const WITNESS_ANCESTRY_DOMAIN =
  "chainlesschain.evolution-ledger-witness-ancestry/v1\0";
const STORE_MARKER_DOMAIN = "chainlesschain.evolution-ledger-store-marker/v1\0";
const STORE_MARKER_ENTRY_DOMAIN =
  "chainlesschain.evolution-ledger-store-marker-entry/v1\0";
const STORE_BINDING_DOMAIN = "chainlesschain.evolution-store-binding/v1\0";
const WITNESS_PAYLOAD_DOMAIN = "chainlesschain.evolution-witness-payload/v1\0";
const DISCARD_ACCUMULATOR_DOMAIN =
  "chainlesschain.evolution-witness-discard-accumulator/v1\0";
const ARTIFACT_VALIDATION_DOMAIN =
  "chainlesschain.evolution-artifact-validation/v1\0";
const IDENTITY_FILE_NAME = "identity-v1.json";
const STORE_MARKER_FILE_NAME = "store-marker-v1.json";
const HEAD_FILE_NAME = "head-v1.json";
const SEGMENT_DIRECTORY_NAME = "segments-v1";
const ANCHOR_DIRECTORY_NAME = "head-anchors-v1";
const LOCK_TARGET_NAME = "ledger-v2";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const LOWER_IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const URI_PATTERN = /^[a-z][a-z0-9+.-]{1,31}:[^\s\\]+$/u;
const SIGNATURE_ALGORITHM_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}$/u;
const SIGNATURE_VALUE_PATTERN = /^[A-Za-z0-9_-]{22,8192}$/u;
const RANDOM_TOKEN_PATTERN = /^[A-Za-z0-9-]{16,128}$/u;
const SEGMENT_FILE_PATTERN = /^(\d{12})-([a-f0-9]{64})\.json$/u;
const ANCHOR_FILE_PATTERN = /^(\d{12})-([a-f0-9]{64})\.json$/u;
const STAGE_FILE_PATTERN = /^\.stage-(.+)\.([A-Za-z0-9-]{16,128})\.tmp$/u;
const HEAD_STAGE_FILE_PATTERN =
  /^\.replace-head-v1\.json\.([A-Za-z0-9-]{16,128})\.tmp$/u;
const MAX_SOURCE_REFS = 256;
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

const DERIVATION_MODES = new Set([
  "wiki",
  "record-replay",
  "manual-import",
  "legacy-migration",
  "system",
]);
const DECISIONS = new Set([
  "proposed",
  "prepared",
  "accepted",
  "rejected",
  "validated",
  "committed",
  "promoted",
  "rolled-back",
  "quarantined",
  "revoked",
  "failed",
]);
const REVOCATION_STATES = new Set(["not-revoked", "revoked", "tombstoned"]);
const DURABILITY_MECHANISMS = new Set([
  "authenticated-witness-cas",
  "directory-fsync",
  "verified-existing",
]);
const EMPTY_DISCARD_ACCUMULATOR_DIGEST = domainDigest(
  DISCARD_ACCUMULATOR_DOMAIN,
  [],
);

const ARTIFACT_REF_KEYS = new Set(["digest", "ref", "schema"]);
const RESOLUTION_KEYS = new Set([
  "authenticated",
  "bytes",
  "digest",
  "found",
  "receiptDigest",
  "ref",
  "schema",
]);
const TRUST_KEYS = new Set(["algorithm", "keyId", "trustPolicyDigest"]);
const SIGNATURE_KEYS = new Set([
  "algorithm",
  "keyId",
  "trustPolicyDigest",
  "value",
]);
const WITNESS_PORT_KEYS = new Set([
  "compareAndSwap",
  "id",
  "initialize",
  "proveAncestry",
  "read",
]);
const APPEND_INPUT_KEYS = new Set([
  "actorRef",
  "candidateRef",
  "decision",
  "derivationMode",
  "diffRef",
  "evalRef",
  "eventId",
  "parentRef",
  "policyRef",
  "reason",
  "revocationState",
  "runId",
  "skillName",
  "sourceRefs",
  "targetRef",
  "tenantId",
  "timestamp",
  "type",
]);
const DOMAIN_APPEND_INPUT_KEYS = new Set([
  "artifactTenantId",
  "correlationId",
  "decision",
  "eventId",
  "reason",
  "skillName",
  "sourceRefs",
  "subjectRef",
  "tenantId",
  "timestamp",
  "type",
]);
const APPEND_OPTION_KEYS = new Set(["expectedHeadDigest", "expectedSequence"]);
const EVENT_CORE_KEYS = new Set([
  ...APPEND_INPUT_KEYS,
  "algorithm",
  "artifactValidationDigest",
  "epoch",
  "identityDigest",
  "keyId",
  "ledgerId",
  "prevDigest",
  "schema",
  "sequence",
  "trustPolicyDigest",
  "witnessAlgorithm",
  "witnessId",
  "witnessKeyId",
  "witnessTrustPolicyDigest",
]);
const EVENT_RECORD_KEYS = new Set([
  ...EVENT_CORE_KEYS,
  "eventDigest",
  "signature",
]);
const DOMAIN_EVENT_CORE_KEYS = new Set([
  ...DOMAIN_APPEND_INPUT_KEYS,
  "algorithm",
  "artifactValidationDigest",
  "epoch",
  "identityDigest",
  "keyId",
  "ledgerId",
  "prevDigest",
  "schema",
  "sequence",
  "trustPolicyDigest",
  "witnessAlgorithm",
  "witnessId",
  "witnessKeyId",
  "witnessTrustPolicyDigest",
]);
const DOMAIN_EVENT_RECORD_KEYS = new Set([
  ...DOMAIN_EVENT_CORE_KEYS,
  "eventDigest",
  "signature",
]);
const IDENTITY_CORE_KEYS = new Set([
  "algorithm",
  "createdAt",
  "epoch",
  "keyId",
  "ledgerId",
  "schema",
  "storeBindingDigest",
  "storeMarkerDigest",
  "storeMarkerEntryDigest",
  "storeMarkerId",
  "trustPolicyDigest",
  "witnessAlgorithm",
  "witnessId",
  "witnessKeyId",
  "witnessTrustPolicyDigest",
]);
const IDENTITY_RECORD_KEYS = new Set([
  ...IDENTITY_CORE_KEYS,
  "identityDigest",
  "signature",
]);
const ANCHOR_CORE_KEYS = new Set([
  "algorithm",
  "committedAt",
  "epoch",
  "headDigest",
  "identityDigest",
  "keyId",
  "ledgerId",
  "previousAnchorDigest",
  "schema",
  "segmentDigest",
  "sequence",
  "trustPolicyDigest",
  "witnessAlgorithm",
  "witnessId",
  "witnessKeyId",
  "witnessTrustPolicyDigest",
]);
const ANCHOR_RECORD_KEYS = new Set([
  ...ANCHOR_CORE_KEYS,
  "anchorDigest",
  "signature",
]);
const RECEIPT_CORE_KEYS = new Set([
  "algorithm",
  "anchorDigest",
  "authenticated",
  "committed",
  "committedAt",
  "durabilityMechanism",
  "durable",
  "epoch",
  "eventDigest",
  "eventId",
  "headDigest",
  "headSignature",
  "identityDigest",
  "issuedAt",
  "keyId",
  "ledgerId",
  "persisted",
  "schema",
  "segmentDigest",
  "sequence",
  "trustPolicyDigest",
  "witnessAlgorithm",
  "witnessCheckpoint",
  "witnessDigest",
  "witnessId",
  "witnessKeyId",
  "witnessTrustPolicyDigest",
]);
const RECEIPT_RECORD_KEYS = new Set([
  ...RECEIPT_CORE_KEYS,
  "receiptDigest",
  "signature",
]);
const WITNESS_CORE_KEYS = new Set([
  "algorithm",
  "anchorDigest",
  "authenticated",
  "durable",
  "discardAccumulatorDigest",
  "epoch",
  "headDigest",
  "identityDigest",
  "keyId",
  "ledgerId",
  "generation",
  "payloadDigest",
  "previousWitnessDigest",
  "schema",
  "segmentDigest",
  "sequence",
  "status",
  "storeMarkerDigest",
  "storeMarkerEntryDigest",
  "storeMarkerId",
  "trustPolicyDigest",
  "witnessId",
]);
const WITNESS_RECORD_KEYS = new Set([
  ...WITNESS_CORE_KEYS,
  "signature",
  "witnessDigest",
]);
const WITNESS_ANCESTRY_CORE_KEYS = new Set([
  "algorithm",
  "ancestorDigest",
  "ancestorGeneration",
  "authenticated",
  "descendantDigest",
  "descendantGeneration",
  "durable",
  "epoch",
  "included",
  "keyId",
  "ledgerId",
  "schema",
  "trustPolicyDigest",
  "witnessId",
]);
const WITNESS_ANCESTRY_RECORD_KEYS = new Set([
  ...WITNESS_ANCESTRY_CORE_KEYS,
  "proofDigest",
  "signature",
]);
const STORE_MARKER_CORE_KEYS = new Set([
  "algorithm",
  "createdAt",
  "epoch",
  "keyId",
  "ledgerId",
  "schema",
  "storeBindingDigest",
  "storeMarkerId",
  "trustPolicyDigest",
  "witnessAlgorithm",
  "witnessId",
  "witnessKeyId",
  "witnessTrustPolicyDigest",
]);
const STORE_MARKER_RECORD_KEYS = new Set([
  ...STORE_MARKER_CORE_KEYS,
  "signature",
  "storeMarkerDigest",
]);
const QUERY_SELECTOR_KEYS = new Set(["eventDigest", "eventId", "sequence"]);
const QUERY_OPTION_KEYS = new Set(["issueReceipt"]);
const VERIFY_RECEIPT_OPTION_KEYS = new Set(["requireCurrentHead"]);

const REQUIRED_FS_METHODS = Object.freeze([
  "closeSync",
  "fstatSync",
  "fsyncSync",
  "linkSync",
  "lstatSync",
  "mkdirSync",
  "openSync",
  "readFileSync",
  "readdirSync",
  "realpathSync",
  "renameSync",
  "rmSync",
  "statSync",
  "unlinkSync",
  "writeFileSync",
]);

export class EvolutionLedgerError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "EvolutionLedgerError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function ledgerError(code, message, details = {}) {
  return new EvolutionLedgerError(code, message, details);
}

function isPlainObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainDataObject(value, label) {
  if (!isPlainObject(value)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must be a plain object`,
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor || !("value" in descriptor)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
        `${label} must contain only own data properties`,
      );
    }
  }
}

function safeOwnDataValue(value, key) {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)) {
    return null;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function isUnsafeAsyncResult(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  if (utilTypes.isProxy(value) || utilTypes.isPromise(value)) return true;
  const descriptor = Object.getOwnPropertyDescriptor(value, "then");
  return Boolean(
    descriptor &&
    (!("value" in descriptor) || typeof descriptor.value === "function"),
  );
}

function assertExactKeys(value, keys, label, { optional = [] } = {}) {
  assertPlainDataObject(value, label);
  const optionalKeys = new Set(optional);
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== "string" || !keys.has(key)) ||
    [...keys].some(
      (key) => !optionalKeys.has(key) && !Object.hasOwn(value, key),
    )
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} has missing or unsupported fields`,
    );
  }
}

function readDenseDataArray(value, label, maximum) {
  if (
    !value ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value)
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must be an array`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Array.prototype && prototype !== null) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must use a safe array prototype`,
    );
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length =
    lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : null;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximum
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} exceeds its maximum length of ${maximum}`,
    );
  }
  const allowed = new Set(["length"]);
  for (let index = 0; index < length; index += 1) {
    allowed.add(String(index));
  }
  const actualKeys = Reflect.ownKeys(value);
  for (const key of actualKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !allowed.has(key) ||
      !descriptor ||
      !("value" in descriptor)
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
        `${label} must be a dense array with only data entries`,
      );
    }
  }
  const entries = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
        `${label} must not contain sparse or accessor entries`,
      );
    }
    entries[index] = descriptor.value;
  }
  return entries;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (utilTypes.isProxy(value)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "canonical JSON must not contain proxies",
    );
  }
  if (Array.isArray(value)) {
    const entries = readDenseDataArray(
      value,
      "canonical JSON array",
      EVOLUTION_LEDGER_MAX_EVENTS,
    );
    const encoded = new Array(entries.length);
    for (let index = 0; index < entries.length; index += 1) {
      encoded[index] = canonicalJson(entries[index]);
    }
    return `[${encoded.join(",")}]`;
  }
  assertPlainDataObject(value, "canonical JSON object");
  const keys = Reflect.ownKeys(value).sort(compareStrings);
  const encoded = new Array(keys.length);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    encoded[index] =
      `${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`;
  }
  return `{${encoded.join(",")}}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(clone(value));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function copyResolvedBytes(value) {
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
      "artifact bytes must be a non-proxy Buffer or Uint8Array",
    );
  }
  const prototype = Object.getPrototypeOf(value);
  const safeBuffer = prototype === Buffer.prototype && Buffer.isBuffer(value);
  const safeUint8Array =
    prototype === Uint8Array.prototype && utilTypes.isUint8Array(value);
  if (!safeBuffer && !safeUint8Array) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
      "artifact bytes must use a safe Buffer or Uint8Array prototype",
    );
  }
  try {
    const arrayBuffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
    const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
    const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []);
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > EVOLUTION_LEDGER_MAX_ARTIFACT_BYTES ||
      !Number.isSafeInteger(byteOffset) ||
      byteOffset < 0
    ) {
      throw new TypeError("artifact byte view bounds are invalid");
    }
    return Buffer.from(Buffer.from(arrayBuffer, byteOffset, byteLength));
  } catch (cause) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
      "artifact bytes could not be safely copied",
      { cause },
    );
  }
}

function domainDigest(domain, value) {
  return sha256(
    Buffer.concat([
      Buffer.from(domain, "utf8"),
      Buffer.from(canonicalJson(value), "utf8"),
    ]),
  );
}

function signedMessage(domain, core) {
  return Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from(canonicalJson(core), "utf8"),
  ]);
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function boundedString(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 0x20 || codePoint === 0x7f;
    })
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must be a non-empty bounded string without control characters`,
    );
  }
  return value;
}

function identifier(value, label) {
  const normalized = boundedString(value, label, 160);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} is not a valid identifier`,
    );
  }
  return normalized;
}

function lowerIdentifier(value, label) {
  const normalized = boundedString(value, label, 160);
  if (!LOWER_IDENTIFIER_PATTERN.test(normalized)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must be a lowercase namespaced identifier`,
    );
  }
  return normalized;
}

function digest(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must be a lowercase sha256 digest${nullable ? " or null" : ""}`,
    );
  }
  return value;
}

function safeSequence(value, label, { allowZero = false } = {}) {
  if (
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > EVOLUTION_LEDGER_MAX_EVENTS
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must be a ${allowZero ? "non-negative" : "positive"} bounded safe integer`,
    );
  }
  return value;
}

function safeCounter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must be a non-negative safe integer`,
    );
  }
  return value;
}

function canonicalTimestamp(value, label) {
  const normalized = boundedString(value, label, 64);
  let canonical;
  try {
    canonical = new Date(normalized).toISOString();
  } catch {
    canonical = null;
  }
  if (canonical !== normalized) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} must be a canonical ISO-8601 timestamp`,
    );
  }
  return normalized;
}

function clockTimestamp(clock) {
  try {
    return new Date(clock()).toISOString();
  } catch (cause) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_CLOCK_FAILED",
      "evolution ledger clock did not return a valid instant",
      { cause, commitState: "not-committed" },
    );
  }
}

function normalizeTrust(value) {
  assertExactKeys(value, TRUST_KEYS, "trust");
  const algorithm = boundedString(value.algorithm, "trust.algorithm", 64);
  if (!SIGNATURE_ALGORITHM_PATTERN.test(algorithm)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_TRUST_INVALID",
      "trust.algorithm is invalid",
    );
  }
  const keyId = boundedString(value.keyId, "trust.keyId", 256);
  if (!URI_PATTERN.test(keyId)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_TRUST_INVALID",
      "trust.keyId must be an absolute opaque key URI",
    );
  }
  return deepFreeze({
    algorithm,
    keyId,
    trustPolicyDigest: digest(
      value.trustPolicyDigest,
      "trust.trustPolicyDigest",
    ),
  });
}

function normalizeSignature(value, trust) {
  assertExactKeys(value, SIGNATURE_KEYS, "signature");
  const normalized = {
    algorithm: boundedString(value.algorithm, "signature.algorithm", 64),
    keyId: boundedString(value.keyId, "signature.keyId", 256),
    trustPolicyDigest: digest(
      value.trustPolicyDigest,
      "signature.trustPolicyDigest",
    ),
    value: boundedString(value.value, "signature.value", 8192),
  };
  if (
    normalized.algorithm !== trust.algorithm ||
    normalized.keyId !== trust.keyId ||
    normalized.trustPolicyDigest !== trust.trustPolicyDigest ||
    !SIGNATURE_ALGORITHM_PATTERN.test(normalized.algorithm) ||
    !URI_PATTERN.test(normalized.keyId) ||
    !SIGNATURE_VALUE_PATTERN.test(normalized.value)
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SIGNATURE_INVALID",
      "signature header is not bound to the configured trust policy",
    );
  }
  return normalized;
}

function normalizeArtifactRef(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  assertExactKeys(value, ARTIFACT_REF_KEYS, label);
  if (value.schema !== EVOLUTION_ARTIFACT_REF_SCHEMA) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label}.schema is unsupported`,
    );
  }
  const ref = boundedString(value.ref, `${label}.ref`, 2048);
  if (!URI_PATTERN.test(ref)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label}.ref must be an absolute opaque URI without backslashes`,
    );
  }
  return {
    digest: digest(value.digest, `${label}.digest`),
    ref,
    schema: EVOLUTION_ARTIFACT_REF_SCHEMA,
  };
}

function normalizeSourceRefs(
  value,
  { minimum = 1, uniqueByDigest = false, uniqueByRef = false } = {},
) {
  const entries = readDenseDataArray(value, "sourceRefs", MAX_SOURCE_REFS);
  if (entries.length < minimum) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `sourceRefs must contain at least ${minimum} artifact reference${minimum === 1 ? "" : "s"}`,
    );
  }
  const refs = new Array(entries.length);
  for (let index = 0; index < entries.length; index += 1) {
    refs[index] = normalizeArtifactRef(entries[index], `sourceRefs[${index}]`);
  }
  refs.sort(
    (left, right) =>
      compareStrings(left.ref, right.ref) ||
      compareStrings(left.digest, right.digest),
  );
  const identities = new Array(refs.length);
  const locators = new Array(refs.length);
  const digests = new Array(refs.length);
  for (let index = 0; index < refs.length; index += 1) {
    identities[index] = `${refs[index].ref}\0${refs[index].digest}`;
    locators[index] = refs[index].ref;
    digests[index] = refs[index].digest;
  }
  if (
    new Set(identities).size !== identities.length ||
    (uniqueByRef && new Set(locators).size !== locators.length) ||
    (uniqueByDigest && new Set(digests).size !== digests.length)
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "sourceRefs must not contain duplicates",
    );
  }
  return refs;
}

function normalizeSkillName(value) {
  const normalized = boundedString(value, "skillName", 128);
  if (!SKILL_NAME_PATTERN.test(normalized)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "skillName must use kebab-case",
    );
  }
  return normalized;
}

function normalizeNullableIdentifier(value, label) {
  return value === null ? null : identifier(value, label);
}

function normalizeNullableSkillName(value) {
  return value === null ? null : normalizeSkillName(value);
}

function normalizeEnum(value, label, allowed) {
  const normalized = boundedString(value, label, 32);
  if (!allowed.has(normalized)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} is unsupported`,
    );
  }
  return normalized;
}

function normalizeAppendInput(value, generatedTimestamp) {
  assertExactKeys(value, APPEND_INPUT_KEYS, "event input", {
    optional: ["timestamp"],
  });
  return {
    actorRef: normalizeArtifactRef(value.actorRef, "actorRef"),
    candidateRef: normalizeArtifactRef(value.candidateRef, "candidateRef"),
    decision: normalizeEnum(value.decision, "decision", DECISIONS),
    derivationMode: normalizeEnum(
      value.derivationMode,
      "derivationMode",
      DERIVATION_MODES,
    ),
    diffRef: normalizeArtifactRef(value.diffRef, "diffRef"),
    evalRef: normalizeArtifactRef(value.evalRef, "evalRef"),
    eventId: identifier(value.eventId, "eventId"),
    parentRef: normalizeArtifactRef(value.parentRef, "parentRef", {
      nullable: true,
    }),
    policyRef: normalizeArtifactRef(value.policyRef, "policyRef"),
    reason: boundedString(value.reason, "reason", 4096),
    revocationState: normalizeEnum(
      value.revocationState,
      "revocationState",
      REVOCATION_STATES,
    ),
    runId: identifier(value.runId, "runId"),
    skillName: normalizeSkillName(value.skillName),
    sourceRefs: normalizeSourceRefs(value.sourceRefs),
    targetRef: normalizeArtifactRef(value.targetRef, "targetRef"),
    tenantId: identifier(value.tenantId, "tenantId"),
    timestamp: canonicalTimestamp(
      Object.hasOwn(value, "timestamp") ? value.timestamp : generatedTimestamp,
      "timestamp",
    ),
    type: lowerIdentifier(value.type, "type"),
  };
}

function normalizeDomainAppendInput(value, generatedTimestamp) {
  assertExactKeys(value, DOMAIN_APPEND_INPUT_KEYS, "domain event input", {
    optional: ["timestamp"],
  });
  const subjectRef = normalizeArtifactRef(value.subjectRef, "subjectRef");
  const sourceRefs = normalizeSourceRefs(value.sourceRefs, {
    minimum: 0,
    uniqueByDigest: true,
    uniqueByRef: true,
  });
  if (
    sourceRefs.some(
      (sourceRef) =>
        sourceRef.ref === subjectRef.ref ||
        sourceRef.digest === subjectRef.digest,
    )
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "subjectRef must not be aliased by ref or digest in sourceRefs",
    );
  }
  return {
    artifactTenantId: identifier(value.artifactTenantId, "artifactTenantId"),
    correlationId: normalizeNullableIdentifier(
      value.correlationId,
      "correlationId",
    ),
    decision: normalizeEnum(value.decision, "decision", DECISIONS),
    eventId: identifier(value.eventId, "eventId"),
    reason: boundedString(value.reason, "reason", 4096),
    skillName: normalizeNullableSkillName(value.skillName),
    sourceRefs,
    subjectRef,
    tenantId: normalizeNullableIdentifier(value.tenantId, "tenantId"),
    timestamp: canonicalTimestamp(
      Object.hasOwn(value, "timestamp") ? value.timestamp : generatedTimestamp,
      "timestamp",
    ),
    type: lowerIdentifier(value.type, "type"),
  };
}

function normalizeAppendOptions(value) {
  assertExactKeys(value, APPEND_OPTION_KEYS, "append options", {
    optional: [...APPEND_OPTION_KEYS],
  });
  const expectedSequence = Object.hasOwn(value, "expectedSequence")
    ? value.expectedSequence
    : undefined;
  if (
    expectedSequence !== undefined &&
    (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0)
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "expectedSequence must be a non-negative safe integer",
    );
  }
  const expectedHeadDigest = Object.hasOwn(value, "expectedHeadDigest")
    ? digest(value.expectedHeadDigest, "expectedHeadDigest", { nullable: true })
    : undefined;
  return { expectedHeadDigest, expectedSequence };
}

function normalizeQuerySelector(value) {
  assertExactKeys(value, QUERY_SELECTOR_KEYS, "query selector", {
    optional: [...QUERY_SELECTOR_KEYS],
  });
  const selector = {
    eventDigest: Object.hasOwn(value, "eventDigest")
      ? digest(value.eventDigest, "eventDigest")
      : undefined,
    eventId: Object.hasOwn(value, "eventId")
      ? identifier(value.eventId, "eventId")
      : undefined,
    sequence: Object.hasOwn(value, "sequence")
      ? safeSequence(value.sequence, "sequence")
      : undefined,
  };
  if (Object.values(selector).every((entry) => entry === undefined)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "query selector requires eventId, eventDigest, or sequence",
    );
  }
  return selector;
}

function normalizeEventCore(value) {
  assertExactKeys(value, EVENT_CORE_KEYS, "event core");
  if (value.schema !== EVOLUTION_LEDGER_EVENT_SCHEMA) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "event schema is unsupported",
    );
  }
  const normalizedInput = normalizeAppendInput(
    Object.fromEntries([...APPEND_INPUT_KEYS].map((key) => [key, value[key]])),
    value.timestamp,
  );
  return {
    ...normalizedInput,
    algorithm: boundedString(value.algorithm, "algorithm", 64),
    artifactValidationDigest: digest(
      value.artifactValidationDigest,
      "artifactValidationDigest",
    ),
    epoch: identifier(value.epoch, "epoch"),
    identityDigest: digest(value.identityDigest, "identityDigest"),
    keyId: boundedString(value.keyId, "keyId", 256),
    ledgerId: identifier(value.ledgerId, "ledgerId"),
    prevDigest: digest(value.prevDigest, "prevDigest", { nullable: true }),
    schema: EVOLUTION_LEDGER_EVENT_SCHEMA,
    sequence: safeSequence(value.sequence, "sequence"),
    trustPolicyDigest: digest(value.trustPolicyDigest, "trustPolicyDigest"),
    witnessAlgorithm: boundedString(
      value.witnessAlgorithm,
      "witnessAlgorithm",
      64,
    ),
    witnessId: identifier(value.witnessId, "witnessId"),
    witnessKeyId: boundedString(value.witnessKeyId, "witnessKeyId", 256),
    witnessTrustPolicyDigest: digest(
      value.witnessTrustPolicyDigest,
      "witnessTrustPolicyDigest",
    ),
  };
}

function normalizeDomainEventCore(value) {
  assertExactKeys(value, DOMAIN_EVENT_CORE_KEYS, "domain event core");
  if (value.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "domain event schema is unsupported",
    );
  }
  const normalizedInput = normalizeDomainAppendInput(
    Object.fromEntries(
      [...DOMAIN_APPEND_INPUT_KEYS].map((key) => [key, value[key]]),
    ),
    value.timestamp,
  );
  return {
    ...normalizedInput,
    algorithm: boundedString(value.algorithm, "algorithm", 64),
    artifactValidationDigest: digest(
      value.artifactValidationDigest,
      "artifactValidationDigest",
    ),
    epoch: identifier(value.epoch, "epoch"),
    identityDigest: digest(value.identityDigest, "identityDigest"),
    keyId: boundedString(value.keyId, "keyId", 256),
    ledgerId: identifier(value.ledgerId, "ledgerId"),
    prevDigest: digest(value.prevDigest, "prevDigest", { nullable: true }),
    schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
    sequence: safeSequence(value.sequence, "sequence"),
    trustPolicyDigest: digest(value.trustPolicyDigest, "trustPolicyDigest"),
    witnessAlgorithm: boundedString(
      value.witnessAlgorithm,
      "witnessAlgorithm",
      64,
    ),
    witnessId: identifier(value.witnessId, "witnessId"),
    witnessKeyId: boundedString(value.witnessKeyId, "witnessKeyId", 256),
    witnessTrustPolicyDigest: digest(
      value.witnessTrustPolicyDigest,
      "witnessTrustPolicyDigest",
    ),
  };
}

function normalizeIdentityCore(value) {
  assertExactKeys(value, IDENTITY_CORE_KEYS, "identity core");
  if (value.schema !== EVOLUTION_LEDGER_IDENTITY_SCHEMA) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "identity schema is unsupported",
    );
  }
  return {
    algorithm: boundedString(value.algorithm, "algorithm", 64),
    createdAt: canonicalTimestamp(value.createdAt, "createdAt"),
    epoch: identifier(value.epoch, "epoch"),
    keyId: boundedString(value.keyId, "keyId", 256),
    ledgerId: identifier(value.ledgerId, "ledgerId"),
    schema: EVOLUTION_LEDGER_IDENTITY_SCHEMA,
    storeBindingDigest: digest(value.storeBindingDigest, "storeBindingDigest"),
    storeMarkerDigest: digest(value.storeMarkerDigest, "storeMarkerDigest"),
    storeMarkerEntryDigest: digest(
      value.storeMarkerEntryDigest,
      "storeMarkerEntryDigest",
    ),
    storeMarkerId: identifier(value.storeMarkerId, "storeMarkerId"),
    trustPolicyDigest: digest(value.trustPolicyDigest, "trustPolicyDigest"),
    witnessAlgorithm: boundedString(
      value.witnessAlgorithm,
      "witnessAlgorithm",
      64,
    ),
    witnessId: identifier(value.witnessId, "witnessId"),
    witnessKeyId: boundedString(value.witnessKeyId, "witnessKeyId", 256),
    witnessTrustPolicyDigest: digest(
      value.witnessTrustPolicyDigest,
      "witnessTrustPolicyDigest",
    ),
  };
}

function normalizeStoreMarkerCore(value) {
  assertExactKeys(value, STORE_MARKER_CORE_KEYS, "store marker core");
  if (value.schema !== EVOLUTION_LEDGER_STORE_MARKER_SCHEMA) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "store marker schema is unsupported",
    );
  }
  return {
    algorithm: boundedString(value.algorithm, "algorithm", 64),
    createdAt: canonicalTimestamp(value.createdAt, "createdAt"),
    epoch: identifier(value.epoch, "epoch"),
    keyId: boundedString(value.keyId, "keyId", 256),
    ledgerId: identifier(value.ledgerId, "ledgerId"),
    schema: EVOLUTION_LEDGER_STORE_MARKER_SCHEMA,
    storeBindingDigest: digest(value.storeBindingDigest, "storeBindingDigest"),
    storeMarkerId: identifier(value.storeMarkerId, "storeMarkerId"),
    trustPolicyDigest: digest(value.trustPolicyDigest, "trustPolicyDigest"),
    witnessAlgorithm: boundedString(
      value.witnessAlgorithm,
      "witnessAlgorithm",
      64,
    ),
    witnessId: identifier(value.witnessId, "witnessId"),
    witnessKeyId: boundedString(value.witnessKeyId, "witnessKeyId", 256),
    witnessTrustPolicyDigest: digest(
      value.witnessTrustPolicyDigest,
      "witnessTrustPolicyDigest",
    ),
  };
}

function normalizeAnchorCore(value) {
  assertExactKeys(value, ANCHOR_CORE_KEYS, "anchor core");
  if (value.schema !== EVOLUTION_LEDGER_ANCHOR_SCHEMA) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "anchor schema is unsupported",
    );
  }
  return {
    algorithm: boundedString(value.algorithm, "algorithm", 64),
    committedAt: canonicalTimestamp(value.committedAt, "committedAt"),
    epoch: identifier(value.epoch, "epoch"),
    headDigest: digest(value.headDigest, "headDigest", { nullable: true }),
    identityDigest: digest(value.identityDigest, "identityDigest"),
    keyId: boundedString(value.keyId, "keyId", 256),
    ledgerId: identifier(value.ledgerId, "ledgerId"),
    previousAnchorDigest: digest(
      value.previousAnchorDigest,
      "previousAnchorDigest",
      { nullable: true },
    ),
    schema: EVOLUTION_LEDGER_ANCHOR_SCHEMA,
    segmentDigest: digest(value.segmentDigest, "segmentDigest", {
      nullable: true,
    }),
    sequence: safeSequence(value.sequence, "sequence", { allowZero: true }),
    trustPolicyDigest: digest(value.trustPolicyDigest, "trustPolicyDigest"),
    witnessAlgorithm: boundedString(
      value.witnessAlgorithm,
      "witnessAlgorithm",
      64,
    ),
    witnessId: identifier(value.witnessId, "witnessId"),
    witnessKeyId: boundedString(value.witnessKeyId, "witnessKeyId", 256),
    witnessTrustPolicyDigest: digest(
      value.witnessTrustPolicyDigest,
      "witnessTrustPolicyDigest",
    ),
  };
}

function normalizeReceiptCore(value, trust, witnessTrust) {
  assertExactKeys(value, RECEIPT_CORE_KEYS, "receipt core");
  if (value.schema !== EVOLUTION_LEDGER_RECEIPT_SCHEMA) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "receipt schema is unsupported",
    );
  }
  const durabilityMechanism = boundedString(
    value.durabilityMechanism,
    "durabilityMechanism",
    64,
  );
  if (!DURABILITY_MECHANISMS.has(durabilityMechanism)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "receipt durability mechanism is unsupported",
    );
  }
  if (
    value.authenticated !== true ||
    value.committed !== true ||
    value.durable !== true ||
    value.persisted !== true
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      "receipt must assert authenticated, committed, durable persistence",
    );
  }
  return {
    algorithm: boundedString(value.algorithm, "algorithm", 64),
    anchorDigest: digest(value.anchorDigest, "anchorDigest"),
    authenticated: true,
    committed: true,
    committedAt: canonicalTimestamp(value.committedAt, "committedAt"),
    durabilityMechanism,
    durable: true,
    epoch: identifier(value.epoch, "epoch"),
    eventDigest: digest(value.eventDigest, "eventDigest"),
    eventId: identifier(value.eventId, "eventId"),
    headDigest: digest(value.headDigest, "headDigest"),
    headSignature: normalizeSignature(value.headSignature, trust),
    identityDigest: digest(value.identityDigest, "identityDigest"),
    issuedAt: canonicalTimestamp(value.issuedAt, "issuedAt"),
    keyId: boundedString(value.keyId, "keyId", 256),
    ledgerId: identifier(value.ledgerId, "ledgerId"),
    persisted: true,
    schema: EVOLUTION_LEDGER_RECEIPT_SCHEMA,
    segmentDigest: digest(value.segmentDigest, "segmentDigest"),
    sequence: safeSequence(value.sequence, "sequence"),
    trustPolicyDigest: digest(value.trustPolicyDigest, "trustPolicyDigest"),
    witnessAlgorithm: boundedString(
      value.witnessAlgorithm,
      "witnessAlgorithm",
      64,
    ),
    witnessCheckpoint: normalizeWitnessRecordShape(
      value.witnessCheckpoint,
      witnessTrust,
    ),
    witnessDigest: digest(value.witnessDigest, "witnessDigest"),
    witnessId: identifier(value.witnessId, "witnessId"),
    witnessKeyId: boundedString(value.witnessKeyId, "witnessKeyId", 256),
    witnessTrustPolicyDigest: digest(
      value.witnessTrustPolicyDigest,
      "witnessTrustPolicyDigest",
    ),
  };
}

function normalizeWitnessCore(value) {
  assertExactKeys(value, WITNESS_CORE_KEYS, "witness core");
  if (value.schema !== EVOLUTION_LEDGER_WITNESS_SCHEMA) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
      "witness schema is unsupported",
    );
  }
  if (
    value.authenticated !== true ||
    value.durable !== true ||
    !["absent", "committed"].includes(value.status)
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
      "witness must return authenticated durable state",
    );
  }
  const absent = value.status === "absent";
  const nullableIdentifier = (entry, label) =>
    entry == null ? null : identifier(entry, label);
  const sequence = absent
    ? value.sequence === null
      ? null
      : NaN
    : safeSequence(value.sequence, "witness.sequence", { allowZero: true });
  const core = {
    algorithm: boundedString(value.algorithm, "witness.algorithm", 64),
    anchorDigest: digest(value.anchorDigest, "witness.anchorDigest", {
      nullable: absent,
    }),
    authenticated: true,
    durable: true,
    discardAccumulatorDigest: digest(
      value.discardAccumulatorDigest,
      "witness.discardAccumulatorDigest",
    ),
    epoch: nullableIdentifier(value.epoch, "witness.epoch"),
    headDigest: digest(value.headDigest, "witness.headDigest", {
      nullable: absent || value.sequence === 0,
    }),
    identityDigest: digest(value.identityDigest, "witness.identityDigest", {
      nullable: absent,
    }),
    keyId: boundedString(value.keyId, "witness.keyId", 256),
    ledgerId: nullableIdentifier(value.ledgerId, "witness.ledgerId"),
    generation: safeCounter(value.generation, "witness.generation"),
    payloadDigest: digest(value.payloadDigest, "witness.payloadDigest", {
      nullable: absent,
    }),
    previousWitnessDigest: digest(
      value.previousWitnessDigest,
      "witness.previousWitnessDigest",
      { nullable: absent },
    ),
    schema: EVOLUTION_LEDGER_WITNESS_SCHEMA,
    segmentDigest: digest(value.segmentDigest, "witness.segmentDigest", {
      nullable: absent || value.sequence === 0,
    }),
    sequence,
    status: value.status,
    storeMarkerDigest: digest(
      value.storeMarkerDigest,
      "witness.storeMarkerDigest",
      { nullable: absent },
    ),
    storeMarkerEntryDigest: digest(
      value.storeMarkerEntryDigest,
      "witness.storeMarkerEntryDigest",
      { nullable: absent },
    ),
    storeMarkerId: nullableIdentifier(
      value.storeMarkerId,
      "witness.storeMarkerId",
    ),
    trustPolicyDigest: digest(
      value.trustPolicyDigest,
      "witness.trustPolicyDigest",
    ),
    witnessId: identifier(value.witnessId, "witness.witnessId"),
  };
  if (
    (absent &&
      [
        core.anchorDigest,
        core.epoch,
        core.headDigest,
        core.identityDigest,
        core.ledgerId,
        core.payloadDigest,
        core.segmentDigest,
        core.sequence,
        core.storeMarkerDigest,
        core.storeMarkerEntryDigest,
        core.storeMarkerId,
      ].some((entry) => entry !== null)) ||
    (absent &&
      (core.generation !== 0 ||
        core.previousWitnessDigest !== null ||
        core.discardAccumulatorDigest !== EMPTY_DISCARD_ACCUMULATOR_DIGEST)) ||
    (!absent &&
      [
        core.anchorDigest,
        core.epoch,
        core.identityDigest,
        core.ledgerId,
        core.payloadDigest,
        core.storeMarkerDigest,
        core.storeMarkerEntryDigest,
        core.storeMarkerId,
      ].some((entry) => entry === null)) ||
    (!absent && (core.generation < 1 || core.previousWitnessDigest === null)) ||
    (!absent &&
      core.sequence === 0 &&
      (core.headDigest !== null || core.segmentDigest !== null)) ||
    (!absent &&
      core.sequence > 0 &&
      (core.headDigest === null || core.segmentDigest === null))
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
      "witness state fields are inconsistent",
    );
  }
  return core;
}

function normalizeWitnessRecordShape(value, witnessTrust) {
  assertExactKeys(value, WITNESS_RECORD_KEYS, "witness record");
  const core = normalizeWitnessCore(
    Object.fromEntries([...WITNESS_CORE_KEYS].map((key) => [key, value[key]])),
  );
  return {
    ...core,
    signature: normalizeSignature(value.signature, witnessTrust),
    witnessDigest: digest(value.witnessDigest, "witnessDigest"),
  };
}

function normalizeWitnessAncestryCore(value) {
  assertExactKeys(value, WITNESS_ANCESTRY_CORE_KEYS, "witness ancestry core");
  if (
    value.schema !== EVOLUTION_LEDGER_WITNESS_ANCESTRY_SCHEMA ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.included !== true
  ) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
      "witness ancestry proof must be authenticated, durable, and included",
    );
  }
  return {
    algorithm: boundedString(value.algorithm, "witness proof.algorithm", 64),
    ancestorDigest: digest(
      value.ancestorDigest,
      "witness proof.ancestorDigest",
    ),
    ancestorGeneration: safeCounter(
      value.ancestorGeneration,
      "witness proof.ancestorGeneration",
    ),
    authenticated: true,
    descendantDigest: digest(
      value.descendantDigest,
      "witness proof.descendantDigest",
    ),
    descendantGeneration: safeCounter(
      value.descendantGeneration,
      "witness proof.descendantGeneration",
    ),
    durable: true,
    epoch: identifier(value.epoch, "witness proof.epoch"),
    included: true,
    keyId: boundedString(value.keyId, "witness proof.keyId", 256),
    ledgerId: identifier(value.ledgerId, "witness proof.ledgerId"),
    schema: EVOLUTION_LEDGER_WITNESS_ANCESTRY_SCHEMA,
    trustPolicyDigest: digest(
      value.trustPolicyDigest,
      "witness proof.trustPolicyDigest",
    ),
    witnessId: identifier(value.witnessId, "witness proof.witnessId"),
  };
}

function serializeRecord(record, maximum, label) {
  const bytes = Buffer.from(`${canonicalJson(record)}\n`, "utf8");
  if (bytes.length < 2 || bytes.length > maximum) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
      `${label} exceeds its bounded canonical representation`,
    );
  }
  return bytes;
}

function entryIdentity(stat) {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

function fileFingerprint(stat) {
  return [
    entryIdentity(stat),
    String(stat.size),
    String(stat.nlink),
    String(stat.mode),
    String(stat.mtimeMs),
    String(stat.ctimeMs),
    String(stat.birthtimeMs),
  ].join(":");
}

function storeMarkerEntryDigest(storeMarkerFile) {
  return domainDigest(STORE_MARKER_ENTRY_DOMAIN, {
    contentDigest: storeMarkerFile.contentDigest,
    fingerprint: storeMarkerFile.fingerprint,
  });
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isContained(root, candidate) {
  const relation = path.relative(root, candidate);
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relation))
  );
}

function pathsOverlap(left, right) {
  return isContained(left, right) || isContained(right, left);
}

function captureWitness(value) {
  // This is the non-rollback trust boundary. Implementations must keep a
  // stable id, make initialize create-only/ever-initialized, perform a durable
  // monotonic CAS, and retain the canonical identity/anchor/event payloads
  // supplied by this ledger. A compareAndSwap carrying `discard` is an atomic,
  // irreversible fence: that orphan digest can never later become committed.
  // Every response is still signature-verified here.
  assertExactKeys(value, WITNESS_PORT_KEYS, "witness");
  const id = identifier(value.id, "witness.id");
  const captured = { id };
  for (const method of [
    "read",
    "initialize",
    "compareAndSwap",
    "proveAncestry",
  ]) {
    if (typeof value[method] !== "function") {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_REQUIRED",
        `witness.${method} must be a synchronous trusted port`,
      );
    }
    const implementation = value[method];
    captured[method] = Object.freeze((...args) =>
      Reflect.apply(implementation, undefined, args),
    );
  }
  return Object.freeze(captured);
}

function captureFs(fsImpl) {
  if (!fsImpl || typeof fsImpl !== "object") {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
      "fsImpl must be a filesystem object",
    );
  }
  const captured = {};
  for (const method of REQUIRED_FS_METHODS) {
    if (typeof fsImpl[method] !== "function") {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
        `fsImpl is missing ${method}`,
      );
    }
    const implementation =
      method === "realpathSync" &&
      typeof fsImpl.realpathSync.native === "function"
        ? fsImpl.realpathSync.native
        : fsImpl[method];
    captured[method] = Object.freeze((...args) =>
      Reflect.apply(implementation, undefined, args),
    );
  }
  if (!fsImpl.constants || typeof fsImpl.constants !== "object") {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
      "fsImpl.constants is unavailable",
    );
  }
  captured.constants = Object.freeze({ ...fsImpl.constants });
  return Object.freeze(captured);
}

function realpath(fsPort, value) {
  try {
    return path.resolve(fsPort.realpathSync(value));
  } catch (cause) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
      `path could not be resolved: ${value}`,
      { cause },
    );
  }
}

function syncDirectory(fsPort, directory) {
  let descriptor = null;
  try {
    descriptor = fsPort.openSync(directory, "r");
    fsPort.fsyncSync(descriptor);
    return "directory-fsync";
  } catch (cause) {
    if (
      process.platform === "win32" &&
      ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(cause?.code)
    ) {
      return "windows-file-fsync";
    }
    throw cause;
  } finally {
    if (descriptor !== null) fsPort.closeSync(descriptor);
  }
}

function randomToken(random) {
  let token;
  try {
    token = String(random());
  } catch (cause) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_RANDOM_FAILED",
      "evolution ledger random source failed",
      { cause, commitState: "not-committed" },
    );
  }
  if (!RANDOM_TOKEN_PATTERN.test(token)) {
    throw ledgerError(
      "CC_EVOLUTION_LEDGER_RANDOM_FAILED",
      "evolution ledger random token must contain 16-128 safe characters",
      { commitState: "not-committed" },
    );
  }
  return token;
}

function sequenceName(sequence) {
  return String(sequence).padStart(12, "0");
}

function segmentFileName(sequence, segmentDigest) {
  return `${sequenceName(sequence)}-${segmentDigest.slice("sha256:".length)}.json`;
}

function anchorFileName(sequence, anchorDigest) {
  return `${sequenceName(sequence)}-${anchorDigest.slice("sha256:".length)}.json`;
}

function defaultRootDir() {
  return path.join(getHomeDir(), "evolution", "ledger", "events");
}

function defaultAuthorityRoot(rootDir) {
  return path.join(
    path.dirname(path.resolve(rootDir)),
    `${path.basename(path.resolve(rootDir))}-authority`,
  );
}

export class EvolutionLedger {
  #artifactResolver;
  #boundaries;
  #clock;
  #crashHook;
  #fs;
  #lock;
  #lockClock;
  #lockTimeoutMs;
  #paths;
  #random;
  #secure;
  #sign;
  #stateCache;
  #storeBindingDigest;
  #trust;
  #verifySignature;
  #verifyWitnessSignature;
  #witness;
  #witnessTrust;

  constructor({
    rootDir = defaultRootDir(),
    authorityRootDir = defaultAuthorityRoot(rootDir),
    secure = true,
    fsImpl = fs,
    clock = Date.now,
    lockClock = Date.now,
    random = () => crypto.randomBytes(16).toString("hex"),
    trust,
    sign,
    verifySignature,
    verifyWitnessSignature,
    artifactResolver,
    witness,
    witnessTrust,
    lock = withFileLock,
    lockTimeoutMs = 10_000,
    crashHook = null,
  } = {}) {
    if (
      typeof sign !== "function" ||
      typeof verifySignature !== "function" ||
      typeof verifyWitnessSignature !== "function" ||
      typeof artifactResolver !== "function" ||
      !witness
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_TRUST_PORT_REQUIRED",
        "sign, verifySignature, verifyWitnessSignature, artifactResolver, and witness ports are mandatory",
      );
    }
    if (
      typeof clock !== "function" ||
      typeof lockClock !== "function" ||
      typeof random !== "function" ||
      typeof lock !== "function" ||
      (crashHook != null && typeof crashHook !== "function")
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
        "clock, lockClock, random, lock, and crashHook must be functions",
      );
    }
    if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
        "lockTimeoutMs must be a positive safe integer",
      );
    }

    this.#fs = captureFs(fsImpl);
    this.#trust = normalizeTrust(trust);
    this.#witnessTrust = normalizeTrust(witnessTrust);
    this.#witness = captureWitness(witness);
    this.#clock = Object.freeze((...args) => clock(...args));
    this.#lockClock = Object.freeze((...args) => lockClock(...args));
    this.#random = Object.freeze((...args) => random(...args));
    this.#sign = Object.freeze((...args) => sign(...args));
    this.#verifySignature = Object.freeze((...args) =>
      verifySignature(...args),
    );
    this.#verifyWitnessSignature = Object.freeze((...args) =>
      verifyWitnessSignature(...args),
    );
    this.#artifactResolver = Object.freeze((...args) =>
      artifactResolver(...args),
    );
    this.#lock = Object.freeze((...args) => lock(...args));
    this.#crashHook =
      crashHook == null ? null : Object.freeze((...args) => crashHook(...args));
    this.#lockTimeoutMs = lockTimeoutMs;
    this.#secure = secure !== false;
    this.#stateCache = null;

    const requestedRoot = path.resolve(rootDir);
    const requestedAuthorityRoot = path.resolve(authorityRootDir);
    if (pathsOverlap(requestedRoot, requestedAuthorityRoot)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
        "event and authority roots must be independent, non-overlapping paths",
      );
    }
    const requestedPaths = {
      rootDir: requestedRoot,
      authorityRootDir: requestedAuthorityRoot,
      segmentDir: path.join(requestedRoot, SEGMENT_DIRECTORY_NAME),
      anchorDir: path.join(requestedAuthorityRoot, ANCHOR_DIRECTORY_NAME),
    };

    try {
      for (const directory of [
        requestedPaths.rootDir,
        requestedPaths.authorityRootDir,
        requestedPaths.segmentDir,
        requestedPaths.anchorDir,
      ]) {
        if (this.#secure) {
          ensurePrivateDirectory(directory, {
            applyWindowsAcl: true,
            failIfUnavailable: true,
          });
        } else {
          this.#fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        }
      }

      const canonicalPaths = {
        rootDir: realpath(this.#fs, requestedPaths.rootDir),
        authorityRootDir: realpath(this.#fs, requestedPaths.authorityRootDir),
        segmentDir: realpath(this.#fs, requestedPaths.segmentDir),
        anchorDir: realpath(this.#fs, requestedPaths.anchorDir),
      };
      if (
        pathsOverlap(canonicalPaths.rootDir, canonicalPaths.authorityRootDir) ||
        !isContained(canonicalPaths.rootDir, canonicalPaths.segmentDir) ||
        !isContained(canonicalPaths.authorityRootDir, canonicalPaths.anchorDir)
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          "canonical ledger paths crossed their security boundaries",
        );
      }
      this.#paths = deepFreeze({
        ...canonicalPaths,
        identityPath: path.join(
          canonicalPaths.authorityRootDir,
          IDENTITY_FILE_NAME,
        ),
        headPath: path.join(canonicalPaths.authorityRootDir, HEAD_FILE_NAME),
        lockPath: path.join(canonicalPaths.authorityRootDir, LOCK_TARGET_NAME),
        storeMarkerPath: path.join(
          canonicalPaths.rootDir,
          STORE_MARKER_FILE_NAME,
        ),
      });
      this.#boundaries = deepFreeze(
        [
          this.#paths.rootDir,
          this.#paths.authorityRootDir,
          this.#paths.segmentDir,
          this.#paths.anchorDir,
        ].map((directory) => {
          const stat = this.#fs.lstatSync(directory);
          if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw ledgerError(
              "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
              `ledger boundary is not a regular directory: ${directory}`,
            );
          }
          return { directory, identity: entryIdentity(stat) };
        }),
      );
      this.#storeBindingDigest = domainDigest(
        STORE_BINDING_DOMAIN,
        this.#boundaries,
      );
      this.#assertBoundaries();
      this.#withLock(() => this.#loadState({ allowInitialize: true }));
    } catch (cause) {
      if (cause instanceof EvolutionLedgerError) throw cause;
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
        "evolution ledger could not initialize its trusted stores",
        { cause },
      );
    }

    Object.freeze(this);
  }

  get rootDir() {
    return this.#paths.rootDir;
  }

  get authorityRootDir() {
    return this.#paths.authorityRootDir;
  }

  get segmentDir() {
    return this.#paths.segmentDir;
  }

  get anchorDir() {
    return this.#paths.anchorDir;
  }

  get identityPath() {
    return this.#paths.identityPath;
  }

  get headPath() {
    return this.#paths.headPath;
  }

  get storeMarkerPath() {
    return this.#paths.storeMarkerPath;
  }

  #assertBoundaries() {
    for (const boundary of this.#boundaries) {
      let stat;
      let canonical;
      try {
        stat = this.#fs.lstatSync(boundary.directory);
        canonical = realpath(this.#fs, boundary.directory);
      } catch (cause) {
        if (cause instanceof EvolutionLedgerError) throw cause;
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          `ledger boundary is unavailable: ${boundary.directory}`,
          { cause },
        );
      }
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        entryIdentity(stat) !== boundary.identity ||
        !samePath(canonical, boundary.directory)
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          `ledger boundary changed or became unsafe: ${boundary.directory}`,
        );
      }
    }
  }

  #withLock(callback) {
    const token = randomToken(this.#random);
    let callbackError = null;
    try {
      return this.#lock(
        this.#paths.lockPath,
        (...args) => {
          try {
            return callback(...args);
          } catch (cause) {
            callbackError = cause;
            throw cause;
          }
        },
        {
          _fs: this.#fs,
          _now: this.#lockClock,
          _ownerToken: () => token,
          failIfUnavailable: true,
          timeoutMs: this.#lockTimeoutMs,
        },
      );
    } catch (cause) {
      if (callbackError === cause) throw cause;
      if (cause instanceof EvolutionLedgerError) throw cause;
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_LOCK_UNAVAILABLE",
        "evolution ledger lock fence is unavailable",
        { cause, commitState: "not-committed" },
      );
    }
  }

  #invokeCrashHook(phase, context) {
    if (!this.#crashHook) return;
    const result = this.#crashHook(phase, frozenClone(context));
    if (isUnsafeAsyncResult(result)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CRASH_HOOK_INVALID",
        "crashHook must be synchronous",
      );
    }
  }

  #signRecord(domain, core, digestField, purpose) {
    const message = signedMessage(domain, core);
    const recordDigest = sha256(message);
    let signature;
    try {
      const output = this.#sign({
        digest: recordDigest,
        message: Buffer.from(message),
        purpose,
        trust: this.#trust,
      });
      if (isUnsafeAsyncResult(output)) {
        throw new TypeError("signing port returned a Promise");
      }
      signature = normalizeSignature(output, this.#trust);
    } catch (cause) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SIGNING_FAILED",
        `evolution ledger ${purpose} signing failed`,
        { cause, commitState: "not-committed" },
      );
    }
    this.#verifyMessage({
      digest: recordDigest,
      message,
      purpose,
      signature,
    });
    return deepFreeze({ ...core, [digestField]: recordDigest, signature });
  }

  #verifyMessage({ digest: recordDigest, message, purpose, signature }) {
    let valid;
    try {
      valid = this.#verifySignature({
        digest: recordDigest,
        message: Buffer.from(message),
        purpose,
        signature: frozenClone(signature),
        trust: this.#trust,
      });
    } catch (cause) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SIGNATURE_INVALID",
        `${purpose} signature verification failed`,
        { cause },
      );
    }
    if (isUnsafeAsyncResult(valid)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SIGNATURE_INVALID",
        "verification port must be synchronous",
      );
    }
    if (valid !== true) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SIGNATURE_INVALID",
        `${purpose} signature was rejected by the configured trust policy`,
      );
    }
  }

  #verifyWitnessMessage({ digest: recordDigest, message, purpose, signature }) {
    let valid;
    try {
      valid = this.#verifyWitnessSignature({
        digest: recordDigest,
        message: Buffer.from(message),
        purpose,
        signature: frozenClone(signature),
        trust: this.#witnessTrust,
      });
    } catch (cause) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
        `${purpose} signature verification failed`,
        { cause },
      );
    }
    if (isUnsafeAsyncResult(valid)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
        "witness verification port must be synchronous",
      );
    }
    if (valid !== true) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
        `${purpose} signature was rejected by the witness trust policy`,
      );
    }
  }

  #assertTrustBinding(record, identity = null) {
    if (
      record.algorithm !== this.#trust.algorithm ||
      record.keyId !== this.#trust.keyId ||
      record.trustPolicyDigest !== this.#trust.trustPolicyDigest ||
      record.witnessId !== this.#witness.id ||
      record.witnessAlgorithm !== this.#witnessTrust.algorithm ||
      record.witnessKeyId !== this.#witnessTrust.keyId ||
      record.witnessTrustPolicyDigest !==
        this.#witnessTrust.trustPolicyDigest ||
      (identity &&
        (record.ledgerId !== identity.ledgerId ||
          record.epoch !== identity.epoch ||
          record.identityDigest !== identity.identityDigest))
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_TRUST_MISMATCH",
        "signed record is not bound to the configured ledger identity and trust policy",
      );
    }
  }

  #assertWitnessTrustBinding(record) {
    if (
      record.algorithm !== this.#witnessTrust.algorithm ||
      record.keyId !== this.#witnessTrust.keyId ||
      record.trustPolicyDigest !== this.#witnessTrust.trustPolicyDigest ||
      record.witnessId !== this.#witness.id
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
        "witness record is not bound to the configured independent witness trust root",
      );
    }
  }

  #verifyIdentity(record) {
    assertExactKeys(record, IDENTITY_RECORD_KEYS, "identity record");
    const core = normalizeIdentityCore(
      Object.fromEntries(
        [...IDENTITY_CORE_KEYS].map((key) => [key, record[key]]),
      ),
    );
    this.#assertTrustBinding(core);
    if (core.storeBindingDigest !== this.#storeBindingDigest) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "signed ledger identity does not match the current store incarnation",
      );
    }
    const identityDigest = digest(record.identityDigest, "identityDigest");
    const signature = normalizeSignature(record.signature, this.#trust);
    const message = signedMessage(IDENTITY_DOMAIN, core);
    if (identityDigest !== sha256(message)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "ledger identity digest does not match its signed core",
      );
    }
    this.#verifyMessage({
      digest: identityDigest,
      message,
      purpose: "identity",
      signature,
    });
    return deepFreeze({ ...core, identityDigest, signature });
  }

  #verifyStoreMarker(record, identity = null) {
    assertExactKeys(record, STORE_MARKER_RECORD_KEYS, "store marker record");
    const core = normalizeStoreMarkerCore(
      Object.fromEntries(
        [...STORE_MARKER_CORE_KEYS].map((key) => [key, record[key]]),
      ),
    );
    this.#assertTrustBinding(core);
    const storeMarkerDigest = digest(
      record.storeMarkerDigest,
      "storeMarkerDigest",
    );
    const signature = normalizeSignature(record.signature, this.#trust);
    const message = signedMessage(STORE_MARKER_DOMAIN, core);
    if (
      storeMarkerDigest !== sha256(message) ||
      core.storeBindingDigest !== this.#storeBindingDigest ||
      (identity &&
        (core.ledgerId !== identity.ledgerId ||
          core.epoch !== identity.epoch ||
          core.createdAt !== identity.createdAt ||
          core.storeBindingDigest !== identity.storeBindingDigest ||
          core.storeMarkerId !== identity.storeMarkerId ||
          storeMarkerDigest !== identity.storeMarkerDigest))
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "store incarnation marker is not bound to the signed ledger identity",
      );
    }
    this.#verifyMessage({
      digest: storeMarkerDigest,
      message,
      purpose: "store-marker",
      signature,
    });
    return deepFreeze({ ...core, signature, storeMarkerDigest });
  }

  #verifyEvent(record, previous, identity) {
    assertPlainDataObject(record, "event record");
    const schema = Object.getOwnPropertyDescriptor(record, "schema")?.value;
    const domainEvent = schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA;
    const recordKeys = domainEvent
      ? DOMAIN_EVENT_RECORD_KEYS
      : EVENT_RECORD_KEYS;
    const coreKeys = domainEvent ? DOMAIN_EVENT_CORE_KEYS : EVENT_CORE_KEYS;
    const signatureDomain = domainEvent ? DOMAIN_EVENT_DOMAIN : EVENT_DOMAIN;
    assertExactKeys(record, recordKeys, "event record");
    const coreValue = Object.fromEntries(
      [...coreKeys].map((key) => [key, record[key]]),
    );
    const core = domainEvent
      ? normalizeDomainEventCore(coreValue)
      : normalizeEventCore(coreValue);
    this.#assertTrustBinding(core, identity);
    const eventDigest = digest(record.eventDigest, "eventDigest");
    const signature = normalizeSignature(record.signature, this.#trust);
    const message = signedMessage(signatureDomain, core);
    if (
      core.sequence !== (previous?.sequence || 0) + 1 ||
      core.prevDigest !== (previous?.eventDigest || null) ||
      eventDigest !== sha256(message)
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        `event chain failed at sequence ${core.sequence}`,
        { sequence: core.sequence },
      );
    }
    this.#verifyMessage({
      digest: eventDigest,
      message,
      purpose: domainEvent ? "domain-event" : "event",
      signature,
    });
    return deepFreeze({ ...core, eventDigest, signature });
  }

  #verifyAnchor(record, previous, identity, { standalone = false } = {}) {
    assertExactKeys(record, ANCHOR_RECORD_KEYS, "anchor record");
    const core = normalizeAnchorCore(
      Object.fromEntries(
        [...ANCHOR_CORE_KEYS].map((key) => [key, record[key]]),
      ),
    );
    this.#assertTrustBinding(core, identity);
    const anchorDigest = digest(record.anchorDigest, "anchorDigest");
    const signature = normalizeSignature(record.signature, this.#trust);
    const message = signedMessage(ANCHOR_DOMAIN, core);
    if (
      (!standalone &&
        core.sequence !== (previous ? previous.sequence + 1 : 0)) ||
      (!standalone &&
        core.previousAnchorDigest !== (previous?.anchorDigest || null)) ||
      anchorDigest !== sha256(message) ||
      (core.sequence === 0 &&
        (core.headDigest !== null || core.segmentDigest !== null)) ||
      (core.sequence > 0 &&
        (core.headDigest === null || core.segmentDigest === null))
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        `head anchor chain failed at sequence ${core.sequence}`,
        { sequence: core.sequence },
      );
    }
    this.#verifyMessage({
      digest: anchorDigest,
      message,
      purpose: "anchor",
      signature,
    });
    return deepFreeze({ ...core, anchorDigest, signature });
  }

  #verifyReceiptRecord(record) {
    assertExactKeys(record, RECEIPT_RECORD_KEYS, "receipt record");
    const core = normalizeReceiptCore(
      Object.fromEntries(
        [...RECEIPT_CORE_KEYS].map((key) => [key, record[key]]),
      ),
      this.#trust,
      this.#witnessTrust,
    );
    this.#assertTrustBinding(core);
    const receiptDigest = digest(record.receiptDigest, "receiptDigest");
    const signature = normalizeSignature(record.signature, this.#trust);
    const message = signedMessage(RECEIPT_DOMAIN, core);
    if (receiptDigest !== sha256(message)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
        "receipt digest does not match its signed core",
      );
    }
    try {
      this.#verifyMessage({
        digest: receiptDigest,
        message,
        purpose: "receipt",
        signature,
      });
      const witnessCheckpoint = this.#verifyWitnessRecord(
        core.witnessCheckpoint,
      );
      if (
        witnessCheckpoint.status !== "committed" ||
        witnessCheckpoint.witnessDigest !== core.witnessDigest
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
          "receipt witness checkpoint is inconsistent",
        );
      }
    } catch (cause) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
        "receipt signature is invalid",
        { cause },
      );
    }
    return deepFreeze({ ...core, receiptDigest, signature });
  }

  #verifyWitnessRecord(record) {
    try {
      const normalized = normalizeWitnessRecordShape(
        record,
        this.#witnessTrust,
      );
      const core = Object.fromEntries(
        [...WITNESS_CORE_KEYS].map((key) => [key, normalized[key]]),
      );
      this.#assertWitnessTrustBinding(core);
      const witnessDigest = normalized.witnessDigest;
      const signature = normalized.signature;
      const message = signedMessage(WITNESS_DOMAIN, core);
      if (witnessDigest !== sha256(message)) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
          "witness digest does not match its signed state",
        );
      }
      this.#verifyWitnessMessage({
        digest: witnessDigest,
        message,
        purpose: "witness",
        signature,
      });
      return deepFreeze({ ...core, signature, witnessDigest });
    } catch (cause) {
      if (cause?.code === "CC_EVOLUTION_LEDGER_WITNESS_INVALID") throw cause;
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
        "witness returned an invalid authenticated state",
        { cause },
      );
    }
  }

  #verifyWitnessAncestryRecord(record) {
    try {
      assertExactKeys(
        record,
        WITNESS_ANCESTRY_RECORD_KEYS,
        "witness ancestry record",
      );
      const core = normalizeWitnessAncestryCore(
        Object.fromEntries(
          [...WITNESS_ANCESTRY_CORE_KEYS].map((key) => [key, record[key]]),
        ),
      );
      this.#assertWitnessTrustBinding(core);
      const proofDigest = digest(record.proofDigest, "witness proofDigest");
      const signature = normalizeSignature(
        record.signature,
        this.#witnessTrust,
      );
      const message = signedMessage(WITNESS_ANCESTRY_DOMAIN, core);
      if (proofDigest !== sha256(message)) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
          "witness ancestry digest does not match its signed proof",
        );
      }
      this.#verifyWitnessMessage({
        digest: proofDigest,
        message,
        purpose: "witness-ancestry",
        signature,
      });
      return deepFreeze({ ...core, proofDigest, signature });
    } catch (cause) {
      if (cause?.code === "CC_EVOLUTION_LEDGER_WITNESS_INVALID") throw cause;
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
        "witness returned an invalid ancestry proof",
        { cause },
      );
    }
  }

  #callWitness(method, payload) {
    let output;
    try {
      output = this.#witness[method](frozenClone(payload));
    } catch (cause) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_UNAVAILABLE",
        `witness ${method} failed closed`,
        { cause },
      );
    }
    if (isUnsafeAsyncResult(output)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_UNAVAILABLE",
        "witness ports must be synchronous",
      );
    }
    return this.#verifyWitnessRecord(output);
  }

  #callWitnessAncestry(payload) {
    let output;
    try {
      output = this.#witness.proveAncestry(frozenClone(payload));
    } catch (cause) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_UNAVAILABLE",
        "witness ancestry proof failed closed",
        { cause },
      );
    }
    if (isUnsafeAsyncResult(output)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_UNAVAILABLE",
        "witness ancestry port must be synchronous",
      );
    }
    return this.#verifyWitnessAncestryRecord(output);
  }

  #proveWitnessAncestry(ancestor, descendant) {
    const proof = this.#callWitnessAncestry({
      ancestor,
      descendant,
      ledgerTrust: this.#trust,
      witnessId: this.#witness.id,
      witnessTrust: this.#witnessTrust,
    });
    if (
      proof.ancestorDigest !== ancestor.witnessDigest ||
      proof.ancestorGeneration !== ancestor.generation ||
      proof.descendantDigest !== descendant.witnessDigest ||
      proof.descendantGeneration !== descendant.generation ||
      proof.ledgerId !== ancestor.ledgerId ||
      proof.ledgerId !== descendant.ledgerId ||
      proof.epoch !== ancestor.epoch ||
      proof.epoch !== descendant.epoch
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_INVALID",
        "witness ancestry proof is not bound to both checkpoints",
      );
    }
    return proof;
  }

  #readWitness() {
    return this.#callWitness("read", {
      ledgerTrust: this.#trust,
      witnessTrust: this.#witnessTrust,
      witnessId: this.#witness.id,
    });
  }

  #witnessSnapshot(identity, storeMarker, anchor, event = null) {
    return deepFreeze({
      algorithm: this.#witnessTrust.algorithm,
      anchorDigest: anchor.anchorDigest,
      epoch: identity.epoch,
      headDigest: anchor.headDigest,
      identityDigest: identity.identityDigest,
      keyId: this.#witnessTrust.keyId,
      ledgerId: identity.ledgerId,
      payloadDigest: domainDigest(WITNESS_PAYLOAD_DOMAIN, {
        anchor,
        event,
        identity,
        storeMarker,
      }),
      segmentDigest: anchor.segmentDigest,
      sequence: anchor.sequence,
      storeMarkerDigest: identity.storeMarkerDigest,
      storeMarkerEntryDigest: identity.storeMarkerEntryDigest,
      storeMarkerId: identity.storeMarkerId,
      trustPolicyDigest: this.#witnessTrust.trustPolicyDigest,
      witnessId: this.#witness.id,
    });
  }

  #discardAccumulator(previous, discard) {
    return domainDigest(DISCARD_ACCUMULATOR_DOMAIN, {
      discard,
      previousDiscardAccumulatorDigest: previous.discardAccumulatorDigest,
      previousWitnessDigest: previous.witnessDigest,
    });
  }

  #assertWitnessSnapshot(witness, identity, storeMarker, anchor, event = null) {
    const snapshot = this.#witnessSnapshot(
      identity,
      storeMarker,
      anchor,
      event,
    );
    for (const [key, value] of Object.entries(snapshot)) {
      if (witness[key] !== value) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
          `witness does not match the authenticated local ${key}`,
        );
      }
    }
  }

  #assertWitnessTransition(previous, next, { discard = null } = {}) {
    const expectedAccumulator = discard
      ? this.#discardAccumulator(previous, discard)
      : previous.discardAccumulatorDigest;
    if (
      next.generation !== previous.generation + 1 ||
      next.previousWitnessDigest !== previous.witnessDigest ||
      next.discardAccumulatorDigest !== expectedAccumulator
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
        "witness did not persist the required monotonic transition",
      );
    }
  }

  #confirmWitnessPersistence(expected) {
    const observed = this.#readWitness();
    if (observed.witnessDigest !== expected.witnessDigest) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
        "witness CAS response was not durably observable",
      );
    }
    return observed;
  }

  #initializeWitness(previous, identity, storeMarker, genesis) {
    const snapshot = this.#witnessSnapshot(identity, storeMarker, genesis);
    const witness = this.#callWitness("initialize", {
      anchor: genesis,
      expected: previous,
      identity,
      ledgerTrust: this.#trust,
      operationId: identity.identityDigest,
      snapshot,
      storeMarker,
      witnessTrust: this.#witnessTrust,
      witnessId: this.#witness.id,
    });
    if (witness.status !== "committed") {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
        "witness did not commit the ledger bootstrap",
      );
    }
    this.#assertWitnessTransition(previous, witness);
    this.#assertWitnessSnapshot(witness, identity, storeMarker, genesis);
    return this.#confirmWitnessPersistence(witness);
  }

  #advanceWitness(previous, identity, storeMarker, anchor, event) {
    const next = this.#witnessSnapshot(identity, storeMarker, anchor, event);
    const witness = this.#callWitness("compareAndSwap", {
      anchor,
      expected: previous,
      event,
      ledgerTrust: this.#trust,
      next,
      operationId: event.eventDigest,
      storeMarker,
      witnessTrust: this.#witnessTrust,
      witnessId: this.#witness.id,
    });
    if (witness.status !== "committed") {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
        "witness did not commit the next ledger head",
      );
    }
    this.#assertWitnessTransition(previous, witness);
    this.#assertWitnessSnapshot(witness, identity, storeMarker, anchor, event);
    return this.#confirmWitnessPersistence(witness);
  }

  #fenceUnwitnessedTail(
    witness,
    identity,
    storeMarker,
    currentAnchor,
    currentEvent,
    orphanAnchor,
  ) {
    this.#requireDirectoryDurability([
      this.#paths.segmentDir,
      this.#paths.anchorDir,
    ]);
    const discard = {
      anchorDigest: orphanAnchor.anchorDigest,
      headDigest: orphanAnchor.headDigest,
      segmentDigest: orphanAnchor.segmentDigest,
      sequence: orphanAnchor.sequence,
    };
    const confirmed = this.#callWitness("compareAndSwap", {
      discard,
      expected: witness,
      ledgerTrust: this.#trust,
      next: this.#witnessSnapshot(
        identity,
        storeMarker,
        currentAnchor,
        currentEvent,
      ),
      operationId: `discard:${orphanAnchor.anchorDigest}`,
      storeMarker,
      witnessTrust: this.#witnessTrust,
      witnessId: this.#witness.id,
    });
    if (confirmed.status !== "committed") {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
        "witness changed before the unwitnessed tail was fenced",
      );
    }
    this.#assertWitnessTransition(witness, confirmed, { discard });
    this.#assertWitnessSnapshot(
      confirmed,
      identity,
      storeMarker,
      currentAnchor,
      currentEvent,
    );
    return this.#confirmWitnessPersistence(confirmed);
  }

  #readCanonicalFile(filePath, maximum, label, { allowMissing = false } = {}) {
    this.#assertBoundaries();
    let before;
    try {
      before = this.#fs.lstatSync(filePath);
    } catch (cause) {
      if (allowMissing && cause?.code === "ENOENT") return null;
      throw ledgerError(
        cause?.code === "ENOENT"
          ? "CC_EVOLUTION_LEDGER_CORRUPT"
          : "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
        `${label} is missing or inaccessible`,
        { cause },
      );
    }
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size < 2 ||
      before.size > maximum ||
      !samePath(realpath(this.#fs, filePath), filePath)
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        `${label} must be a bounded, single-link, non-symlink file`,
      );
    }
    let descriptor = null;
    try {
      descriptor = this.#fs.openSync(
        filePath,
        this.#fs.constants.O_RDONLY | (this.#fs.constants.O_NOFOLLOW || 0),
      );
      const opened = this.#fs.fstatSync(descriptor);
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        entryIdentity(opened) !== entryIdentity(before) ||
        opened.size !== before.size
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `${label} changed while it was opened`,
        );
      }
      const bytes = this.#fs.readFileSync(descriptor);
      const after = this.#fs.fstatSync(descriptor);
      if (
        after.nlink !== 1 ||
        entryIdentity(after) !== entryIdentity(opened) ||
        after.size !== opened.size ||
        bytes.length !== opened.size
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `${label} changed while it was read`,
        );
      }
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (cause) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `${label} is not valid UTF-8`,
          { cause },
        );
      }
      if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `${label} is truncated or not a single canonical record`,
        );
      }
      let record;
      try {
        record = JSON.parse(text.slice(0, -1));
      } catch (cause) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `${label} contains invalid JSON`,
          { cause },
        );
      }
      if (`${canonicalJson(record)}\n` !== text) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `${label} bytes are not canonical`,
        );
      }
      return {
        bytes,
        contentDigest: sha256(bytes),
        fingerprint: fileFingerprint(after),
        record,
      };
    } finally {
      if (descriptor !== null) this.#fs.closeSync(descriptor);
      this.#assertBoundaries();
    }
  }

  #writeImmutable(filePath, bytes, label, onPublished = null) {
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(
      directory,
      `.stage-${path.basename(filePath)}.${randomToken(this.#random)}.tmp`,
    );
    if (!isContained(directory, temporaryPath)) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
        `${label} staging path escaped its directory`,
      );
    }
    let descriptor = null;
    let temporaryExists = false;
    let published = false;
    try {
      this.#assertBoundaries();
      descriptor = this.#fs.openSync(temporaryPath, "wx", 0o600);
      temporaryExists = true;
      this.#fs.writeFileSync(descriptor, bytes);
      this.#fs.fsyncSync(descriptor);
      const staged = this.#fs.fstatSync(descriptor);
      if (
        !staged.isFile() ||
        staged.nlink !== 1 ||
        staged.size !== bytes.length
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_WRITE_FAILED",
          `${label} was not staged completely`,
        );
      }
      this.#fs.closeSync(descriptor);
      descriptor = null;
      if (this.#secure) {
        ensurePrivateFile(temporaryPath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      }
      this.#fs.linkSync(temporaryPath, filePath);
      published = true;
      if (onPublished) onPublished(temporaryPath);
      this.#fs.unlinkSync(temporaryPath);
      temporaryExists = false;
      if (this.#secure) {
        ensurePrivateFile(filePath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      }
      const finalStat = this.#fs.lstatSync(filePath);
      if (
        !finalStat.isFile() ||
        finalStat.isSymbolicLink() ||
        finalStat.nlink !== 1 ||
        finalStat.size !== bytes.length
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_WRITE_FAILED",
          `${label} publication did not produce a single-link artifact`,
        );
      }
      descriptor = this.#fs.openSync(
        filePath,
        this.#fs.constants.O_RDWR | (this.#fs.constants.O_NOFOLLOW || 0),
      );
      this.#fs.fsyncSync(descriptor);
      this.#fs.closeSync(descriptor);
      descriptor = null;
      return syncDirectory(this.#fs, directory);
    } catch (cause) {
      if (cause instanceof EvolutionLedgerError) throw cause;
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WRITE_FAILED",
        `${label} immutable publication failed`,
        { cause, published },
      );
    } finally {
      if (descriptor !== null) {
        try {
          this.#fs.closeSync(descriptor);
        } catch {
          // Preserve the persistence error.
        }
      }
      if (temporaryExists && !published) {
        try {
          this.#fs.unlinkSync(temporaryPath);
        } catch {
          // Unpublished staging debris is recovered under the next lock.
        }
      }
    }
  }

  #replaceHead(bytes) {
    const temporaryPath = path.join(
      this.#paths.authorityRootDir,
      `.replace-${HEAD_FILE_NAME}.${randomToken(this.#random)}.tmp`,
    );
    let descriptor = null;
    let renamed = false;
    try {
      descriptor = this.#fs.openSync(temporaryPath, "wx", 0o600);
      this.#fs.writeFileSync(descriptor, bytes);
      this.#fs.fsyncSync(descriptor);
      const staged = this.#fs.fstatSync(descriptor);
      if (
        !staged.isFile() ||
        staged.nlink !== 1 ||
        staged.size !== bytes.length
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_WRITE_FAILED",
          "HEAD anchor was not staged completely",
        );
      }
      this.#fs.closeSync(descriptor);
      descriptor = null;
      if (this.#secure) {
        ensurePrivateFile(temporaryPath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      }
      this.#fs.renameSync(temporaryPath, this.#paths.headPath);
      renamed = true;
      if (this.#secure) {
        ensurePrivateFile(this.#paths.headPath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      }
      const headStat = this.#fs.lstatSync(this.#paths.headPath);
      if (
        !headStat.isFile() ||
        headStat.isSymbolicLink() ||
        headStat.nlink !== 1 ||
        headStat.size !== bytes.length
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_WRITE_FAILED",
          "HEAD replacement did not produce a single-link artifact",
        );
      }
      descriptor = this.#fs.openSync(
        this.#paths.headPath,
        this.#fs.constants.O_RDWR | (this.#fs.constants.O_NOFOLLOW || 0),
      );
      this.#fs.fsyncSync(descriptor);
      this.#fs.closeSync(descriptor);
      descriptor = null;
      return syncDirectory(this.#fs, this.#paths.authorityRootDir);
    } catch (cause) {
      if (cause instanceof EvolutionLedgerError) throw cause;
      throw ledgerError(
        renamed
          ? "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN"
          : "CC_EVOLUTION_LEDGER_WRITE_FAILED",
        renamed
          ? "HEAD replacement may be durable"
          : "HEAD replacement failed before publication",
        { cause, commitState: renamed ? "unknown" : "not-committed" },
      );
    } finally {
      if (descriptor !== null) {
        try {
          this.#fs.closeSync(descriptor);
        } catch {
          // Preserve the persistence error.
        }
      }
      if (!renamed) {
        try {
          this.#fs.unlinkSync(temporaryPath);
        } catch {
          // A uniquely named HEAD staging file is recovered on reopen.
        }
      }
    }
  }

  #requireDirectoryDurability(directories) {
    for (const directory of directories) {
      let mechanism;
      try {
        mechanism = syncDirectory(this.#fs, directory);
      } catch (cause) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_DURABILITY_UNAVAILABLE",
          `directory durability is unavailable for ${directory}`,
          { cause, commitState: "not-committed" },
        );
      }
      if (mechanism !== "directory-fsync") {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_DURABILITY_UNAVAILABLE",
          "the platform cannot durably publish ledger objects before witness CAS",
          { commitState: "not-committed", mechanism },
        );
      }
    }
  }

  #cleanupDirectoryDebris(directory, targetPattern) {
    let changed = false;
    const entries = this.#fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const match = STAGE_FILE_PATTERN.exec(entry.name);
      if (!entry.name.startsWith(".stage-")) continue;
      if (!match) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          `malformed staging artifact: ${entry.name}`,
        );
      }
      const targetName = match[1];
      if (!targetPattern.test(targetName)) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          `unrecognized staging artifact: ${entry.name}`,
        );
      }
      const temporaryPath = path.join(directory, entry.name);
      const targetPath = path.join(directory, targetName);
      const temporaryStat = this.#fs.lstatSync(temporaryPath);
      if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink()) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          `staging artifact is unsafe: ${entry.name}`,
        );
      }
      let targetStat = null;
      try {
        targetStat = this.#fs.lstatSync(targetPath);
      } catch (cause) {
        if (cause?.code !== "ENOENT") throw cause;
      }
      if (
        targetStat &&
        (!targetStat.isFile() ||
          targetStat.isSymbolicLink() ||
          entryIdentity(targetStat) !== entryIdentity(temporaryStat))
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          `staging artifact conflicts with its authoritative path: ${entry.name}`,
        );
      }
      this.#fs.unlinkSync(temporaryPath);
      changed = true;
      if (targetStat) {
        const recovered = this.#fs.lstatSync(targetPath);
        if (recovered.nlink !== 1) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
            `hard-link debris could not be removed: ${entry.name}`,
          );
        }
      }
    }
    if (changed) syncDirectory(this.#fs, directory);
  }

  #cleanupDebris() {
    this.#cleanupDirectoryDebris(this.#paths.segmentDir, SEGMENT_FILE_PATTERN);
    this.#cleanupDirectoryDebris(this.#paths.anchorDir, ANCHOR_FILE_PATTERN);
    this.#cleanupDirectoryDebris(
      this.#paths.authorityRootDir,
      new RegExp(`^${IDENTITY_FILE_NAME.replace(".", "\\.")}$`, "u"),
    );
    this.#cleanupDirectoryDebris(
      this.#paths.rootDir,
      new RegExp(`^${STORE_MARKER_FILE_NAME.replace(".", "\\.")}$`, "u"),
    );
    let changed = false;
    for (const entry of this.#fs.readdirSync(this.#paths.authorityRootDir, {
      withFileTypes: true,
    })) {
      if (!entry.name.startsWith(".replace-")) continue;
      if (!HEAD_STAGE_FILE_PATTERN.test(entry.name)) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          `malformed HEAD staging artifact: ${entry.name}`,
        );
      }
      const filePath = path.join(this.#paths.authorityRootDir, entry.name);
      const stat = this.#fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          "HEAD staging debris is unsafe",
        );
      }
      this.#fs.unlinkSync(filePath);
      changed = true;
    }
    if (changed) syncDirectory(this.#fs, this.#paths.authorityRootDir);
  }

  #listFiles(directory, pattern, label) {
    const output = [];
    for (const entry of this.#fs.readdirSync(directory, {
      withFileTypes: true,
    })) {
      if (entry.name.startsWith(".stage-")) continue;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !pattern.test(entry.name)
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_STORE_UNSAFE",
          `${label} contains an unrecognized entry: ${entry.name}`,
        );
      }
      output.push(entry.name);
    }
    return output.sort();
  }

  #buildStoreMarker({ createdAt, epoch, ledgerId, storeMarkerId }) {
    const core = normalizeStoreMarkerCore({
      algorithm: this.#trust.algorithm,
      createdAt,
      epoch,
      keyId: this.#trust.keyId,
      ledgerId,
      schema: EVOLUTION_LEDGER_STORE_MARKER_SCHEMA,
      storeBindingDigest: this.#storeBindingDigest,
      storeMarkerId,
      trustPolicyDigest: this.#trust.trustPolicyDigest,
      witnessAlgorithm: this.#witnessTrust.algorithm,
      witnessId: this.#witness.id,
      witnessKeyId: this.#witnessTrust.keyId,
      witnessTrustPolicyDigest: this.#witnessTrust.trustPolicyDigest,
    });
    return this.#signRecord(
      STORE_MARKER_DOMAIN,
      core,
      "storeMarkerDigest",
      "store-marker",
    );
  }

  #buildNewStoreMarker() {
    const createdAt = clockTimestamp(this.#clock);
    const epoch = `epoch-${randomToken(this.#random)}`;
    const ledgerId = `ledger-${randomToken(this.#random)}`;
    const storeMarkerId = `marker-${randomToken(this.#random)}`;
    return this.#buildStoreMarker({
      createdAt,
      epoch,
      ledgerId,
      storeMarkerId,
    });
  }

  #buildIdentity(storeMarker, storeMarkerFile) {
    const core = normalizeIdentityCore({
      algorithm: this.#trust.algorithm,
      createdAt: storeMarker.createdAt,
      epoch: storeMarker.epoch,
      keyId: this.#trust.keyId,
      ledgerId: storeMarker.ledgerId,
      schema: EVOLUTION_LEDGER_IDENTITY_SCHEMA,
      storeBindingDigest: this.#storeBindingDigest,
      storeMarkerDigest: storeMarker.storeMarkerDigest,
      storeMarkerEntryDigest: storeMarkerEntryDigest(storeMarkerFile),
      storeMarkerId: storeMarker.storeMarkerId,
      trustPolicyDigest: this.#trust.trustPolicyDigest,
      witnessAlgorithm: this.#witnessTrust.algorithm,
      witnessId: this.#witness.id,
      witnessKeyId: this.#witnessTrust.keyId,
      witnessTrustPolicyDigest: this.#witnessTrust.trustPolicyDigest,
    });
    return this.#signRecord(
      IDENTITY_DOMAIN,
      core,
      "identityDigest",
      "identity",
    );
  }

  #buildAnchor(identity, previous, event = null, segmentDigest = null) {
    const core = normalizeAnchorCore({
      algorithm: this.#trust.algorithm,
      committedAt: event ? clockTimestamp(this.#clock) : identity.createdAt,
      epoch: identity.epoch,
      headDigest: event?.eventDigest || null,
      identityDigest: identity.identityDigest,
      keyId: this.#trust.keyId,
      ledgerId: identity.ledgerId,
      previousAnchorDigest: previous?.anchorDigest || null,
      schema: EVOLUTION_LEDGER_ANCHOR_SCHEMA,
      segmentDigest,
      sequence: event?.sequence || 0,
      trustPolicyDigest: this.#trust.trustPolicyDigest,
      witnessAlgorithm: this.#witnessTrust.algorithm,
      witnessId: this.#witness.id,
      witnessKeyId: this.#witnessTrust.keyId,
      witnessTrustPolicyDigest: this.#witnessTrust.trustPolicyDigest,
    });
    return this.#signRecord(ANCHOR_DOMAIN, core, "anchorDigest", "anchor");
  }

  #initializeEmptyLedger() {
    const storeMarker = this.#buildNewStoreMarker();
    this.#writeImmutable(
      this.#paths.storeMarkerPath,
      serializeRecord(storeMarker, 64 * 1024, "store marker"),
      "store incarnation marker",
    );
    const storeMarkerFile = this.#readCanonicalFile(
      this.#paths.storeMarkerPath,
      64 * 1024,
      "store incarnation marker",
    );
    this.#verifyStoreMarker(storeMarkerFile.record);
    const identity = this.#buildIdentity(storeMarker, storeMarkerFile);
    const identityBytes = serializeRecord(identity, 64 * 1024, "identity");
    this.#writeImmutable(
      this.#paths.identityPath,
      identityBytes,
      "ledger identity",
    );
    const genesis = this.#buildAnchor(identity, null);
    const genesisPath = path.join(
      this.#paths.anchorDir,
      anchorFileName(0, genesis.anchorDigest),
    );
    const genesisBytes = serializeRecord(genesis, 64 * 1024, "genesis anchor");
    this.#writeImmutable(genesisPath, genesisBytes, "genesis anchor");
    this.#replaceHead(genesisBytes);
  }

  #recoverUnwitnessedBootstrap(identity, anchorNames, segmentNames, headFile) {
    if (segmentNames.length !== 0 || headFile || anchorNames.length > 1) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "unwitnessed bootstrap contains non-recoverable local material",
      );
    }
    const genesis = this.#buildAnchor(identity, null);
    const expectedName = anchorFileName(0, genesis.anchorDigest);
    let genesisRecord = genesis;
    if (anchorNames.length === 0) {
      const bytes = serializeRecord(genesis, 64 * 1024, "genesis anchor");
      this.#writeImmutable(
        path.join(this.#paths.anchorDir, expectedName),
        bytes,
        "recovered bootstrap genesis anchor",
      );
    } else {
      if (anchorNames[0] !== expectedName) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          "unwitnessed bootstrap genesis filename is inconsistent",
        );
      }
      const persisted = this.#readCanonicalFile(
        path.join(this.#paths.anchorDir, expectedName),
        64 * 1024,
        "bootstrap genesis anchor",
      );
      genesisRecord = this.#verifyAnchor(persisted.record, null, identity);
    }
    this.#replaceHead(
      serializeRecord(genesisRecord, 64 * 1024, "genesis anchor"),
    );
  }

  #matchesCachedFile(filePath, expected) {
    let descriptor = null;
    try {
      const before = this.#fs.lstatSync(filePath);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        fileFingerprint(before) !== expected.fingerprint ||
        !samePath(realpath(this.#fs, filePath), filePath)
      ) {
        return false;
      }
      descriptor = this.#fs.openSync(
        filePath,
        this.#fs.constants.O_RDONLY | (this.#fs.constants.O_NOFOLLOW || 0),
      );
      const opened = this.#fs.fstatSync(descriptor);
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        entryIdentity(opened) !== entryIdentity(before) ||
        opened.size !== before.size
      ) {
        return false;
      }
      const bytes = this.#fs.readFileSync(descriptor);
      const after = this.#fs.fstatSync(descriptor);
      return (
        after.nlink === 1 &&
        entryIdentity(after) === entryIdentity(opened) &&
        fileFingerprint(after) === expected.fingerprint &&
        bytes.length === opened.size &&
        sha256(bytes) === expected.contentDigest
      );
    } catch {
      return false;
    } finally {
      if (descriptor !== null) this.#fs.closeSync(descriptor);
    }
  }

  #cachedPrefix(identity, anchorNames, segmentNames, incremental) {
    const cached = incremental ? this.#stateCache : null;
    if (
      !cached ||
      cached.state.identity.identityDigest !== identity.identityDigest ||
      cached.anchorNames.length > anchorNames.length ||
      cached.segmentNames.length > segmentNames.length ||
      cached.anchorNames.some((name, index) => name !== anchorNames[index]) ||
      cached.segmentNames.some((name, index) => name !== segmentNames[index])
    ) {
      return null;
    }
    for (const name of cached.anchorNames) {
      if (
        !this.#matchesCachedFile(
          path.join(this.#paths.anchorDir, name),
          cached.anchorFingerprints[name],
        )
      ) {
        return null;
      }
    }
    for (const name of cached.segmentNames) {
      if (
        !this.#matchesCachedFile(
          path.join(this.#paths.segmentDir, name),
          cached.segmentFingerprints[name],
        )
      ) {
        return null;
      }
    }
    return cached;
  }

  #rememberState(
    state,
    anchorNames,
    segmentNames,
    anchorFingerprints,
    segmentFingerprints,
  ) {
    this.#stateCache = Object.freeze({
      anchorFingerprints: Object.freeze({ ...anchorFingerprints }),
      anchorNames: Object.freeze([...anchorNames]),
      segmentFingerprints: Object.freeze({ ...segmentFingerprints }),
      segmentNames: Object.freeze([...segmentNames]),
      state,
    });
    return state;
  }

  #loadState({ allowInitialize = false, incremental = false } = {}) {
    this.#assertBoundaries();
    this.#cleanupDebris();
    let witnessed = this.#readWitness();

    const identityFile = this.#readCanonicalFile(
      this.#paths.identityPath,
      64 * 1024,
      "ledger identity",
      { allowMissing: true },
    );
    let storeMarkerFile = this.#readCanonicalFile(
      this.#paths.storeMarkerPath,
      64 * 1024,
      "store incarnation marker",
      { allowMissing: true },
    );
    let anchorNames = this.#listFiles(
      this.#paths.anchorDir,
      ANCHOR_FILE_PATTERN,
      "anchor directory",
    );
    let segmentNames = this.#listFiles(
      this.#paths.segmentDir,
      SEGMENT_FILE_PATTERN,
      "segment directory",
    );
    let headFile = this.#readCanonicalFile(
      this.#paths.headPath,
      64 * 1024,
      "ledger HEAD",
      { allowMissing: true },
    );

    if (!identityFile) {
      if (
        witnessed.status !== "absent" ||
        anchorNames.length ||
        segmentNames.length ||
        headFile
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          "ledger identity is missing from an initialized or non-empty authority",
        );
      }
      if (!allowInitialize) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          "ledger identity is missing after initialization",
        );
      }
      if (storeMarkerFile) {
        const storeMarker = this.#verifyStoreMarker(storeMarkerFile.record);
        const identity = this.#buildIdentity(storeMarker, storeMarkerFile);
        this.#writeImmutable(
          this.#paths.identityPath,
          serializeRecord(identity, 64 * 1024, "identity"),
          "recovered ledger identity",
        );
        return this.#loadState({
          allowInitialize: false,
          incremental: false,
        });
      }
      this.#initializeEmptyLedger();
      return this.#loadState({ allowInitialize: false, incremental: false });
    }

    const identity = this.#verifyIdentity(identityFile.record);
    if (!storeMarkerFile) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "initialized ledger is missing its signed store incarnation marker",
      );
    }
    const storeMarker = this.#verifyStoreMarker(
      storeMarkerFile.record,
      identity,
    );
    if (
      identity.storeMarkerEntryDigest !==
      storeMarkerEntryDigest(storeMarkerFile)
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "store incarnation marker file instance was replaced or replayed",
      );
    }
    if (anchorNames.length === 0 || !headFile) {
      if (witnessed.status === "absent") {
        this.#recoverUnwitnessedBootstrap(
          identity,
          anchorNames,
          segmentNames,
          headFile,
        );
        return this.#loadState({
          allowInitialize: false,
          incremental: false,
        });
      }
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "initialized ledger is missing its immutable genesis or authenticated HEAD",
      );
    }

    if (anchorNames.length > EVOLUTION_LEDGER_MAX_EVENTS + 1) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CAPACITY_EXCEEDED",
        "anchor chain exceeds ledger capacity",
      );
    }

    const cached = this.#cachedPrefix(
      identity,
      anchorNames,
      segmentNames,
      incremental,
    );
    const anchors = cached ? [...cached.state.anchors] : [];
    const events = cached ? [...cached.state.events] : [];
    const anchorFingerprints = cached ? { ...cached.anchorFingerprints } : {};
    const segmentFingerprints = cached ? { ...cached.segmentFingerprints } : {};
    const expectedSegments = new Set();
    const eventIds = new Set(events.map((event) => event.eventId));
    for (let index = 0; index < anchorNames.length; index += 1) {
      const name = anchorNames[index];
      const match = ANCHOR_FILE_PATTERN.exec(name);
      const fileSequence = Number(match[1]);
      if (fileSequence !== index) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `anchor prefix is missing or reordered at sequence ${index}`,
        );
      }
      if (index < anchors.length) {
        if (index > 0) {
          expectedSegments.add(
            segmentFileName(index, anchors[index].segmentDigest),
          );
        }
        continue;
      }
      const anchorFile = this.#readCanonicalFile(
        path.join(this.#paths.anchorDir, name),
        64 * 1024,
        `anchor ${index}`,
      );
      const anchor = this.#verifyAnchor(
        anchorFile.record,
        anchors.at(-1),
        identity,
      );
      if (name !== anchorFileName(anchor.sequence, anchor.anchorDigest)) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `anchor filename is not content-addressed at sequence ${index}`,
        );
      }
      anchorFingerprints[name] = Object.freeze({
        contentDigest: anchorFile.contentDigest,
        fingerprint: anchorFile.fingerprint,
      });
      anchors.push(anchor);
      if (index === 0) continue;

      const segmentName = segmentFileName(index, anchor.segmentDigest);
      expectedSegments.add(segmentName);
      const segmentFile = this.#readCanonicalFile(
        path.join(this.#paths.segmentDir, segmentName),
        EVOLUTION_LEDGER_MAX_EVENT_BYTES,
        `event segment ${index}`,
      );
      const event = this.#verifyEvent(
        segmentFile.record,
        events.at(-1),
        identity,
      );
      const segmentDigest = domainDigest(SEGMENT_DOMAIN, event);
      if (
        event.sequence !== index ||
        anchor.headDigest !== event.eventDigest ||
        anchor.segmentDigest !== segmentDigest ||
        segmentName !== segmentFileName(event.sequence, segmentDigest) ||
        eventIds.has(event.eventId)
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `event/anchor binding failed at sequence ${index}`,
        );
      }
      segmentFingerprints[segmentName] = Object.freeze({
        contentDigest: segmentFile.contentDigest,
        fingerprint: segmentFile.fingerprint,
      });
      eventIds.add(event.eventId);
      events.push(event);
    }

    let removedOrphan = false;
    for (const name of segmentNames) {
      if (expectedSegments.has(name)) continue;
      const match = SEGMENT_FILE_PATTERN.exec(name);
      const sequence = Number(match[1]);
      if (sequence !== events.length + 1) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          `unanchored segment is not a recoverable tail: ${name}`,
        );
      }
      const filePath = path.join(this.#paths.segmentDir, name);
      const segmentFile = this.#readCanonicalFile(
        filePath,
        EVOLUTION_LEDGER_MAX_EVENT_BYTES,
        "unanchored tail segment",
      );
      const event = this.#verifyEvent(
        segmentFile.record,
        events.at(-1),
        identity,
      );
      const segmentDigest = domainDigest(SEGMENT_DOMAIN, event);
      if (name !== segmentFileName(sequence, segmentDigest)) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          "unanchored tail segment is not content-addressed",
        );
      }
      this.#fs.unlinkSync(filePath);
      removedOrphan = true;
    }
    if (removedOrphan) syncDirectory(this.#fs, this.#paths.segmentDir);

    const head = this.#verifyAnchor(headFile.record, null, identity, {
      standalone: true,
    });
    const matchingHead = anchors.find(
      (anchor) => anchor.anchorDigest === head.anchorDigest,
    );
    if (!matchingHead || matchingHead.sequence !== head.sequence) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "HEAD is not one of the authenticated immutable anchors",
      );
    }
    let maximumAnchor = anchors.at(-1);
    if (head.sequence > maximumAnchor.sequence) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "HEAD points beyond the immutable anchor chain",
      );
    }
    let authoritativeHead = head;
    if (witnessed.status === "absent") {
      if (
        anchors.length !== 1 ||
        events.length !== 0 ||
        head.sequence !== 0 ||
        maximumAnchor.sequence !== 0
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
          "an absent witness cannot bootstrap a previously used ledger",
        );
      }
      this.#requireDirectoryDurability([
        this.#paths.rootDir,
        this.#paths.segmentDir,
        this.#paths.authorityRootDir,
        this.#paths.anchorDir,
      ]);
      witnessed = this.#initializeWitness(
        witnessed,
        identity,
        storeMarker,
        maximumAnchor,
      );
    } else {
      if (witnessed.sequence > maximumAnchor.sequence) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          "authenticated witness is ahead of the local immutable prefix",
        );
      }
      const witnessedAnchor = anchors[witnessed.sequence];
      if (!witnessedAnchor) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_CORRUPT",
          "authenticated witness does not have a local immutable anchor",
        );
      }
      const witnessedEvent =
        witnessed.sequence === 0 ? null : events[witnessed.sequence - 1];
      this.#assertWitnessSnapshot(
        witnessed,
        identity,
        storeMarker,
        witnessedAnchor,
        witnessedEvent,
      );
      if (witnessed.sequence < maximumAnchor.sequence) {
        if (
          head.anchorDigest !== witnessed.anchorDigest ||
          maximumAnchor.sequence !== witnessed.sequence + 1
        ) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_CORRUPT",
            "local immutable tail diverges from the authenticated witness",
          );
        }
        witnessed = this.#fenceUnwitnessedTail(
          witnessed,
          identity,
          storeMarker,
          witnessedAnchor,
          witnessedEvent,
          maximumAnchor,
        );
        const orphanAnchorName = anchorNames.at(-1);
        const orphanSegmentName = segmentFileName(
          maximumAnchor.sequence,
          maximumAnchor.segmentDigest,
        );
        this.#fs.unlinkSync(path.join(this.#paths.anchorDir, orphanAnchorName));
        syncDirectory(this.#fs, this.#paths.anchorDir);
        this.#fs.unlinkSync(
          path.join(this.#paths.segmentDir, orphanSegmentName),
        );
        syncDirectory(this.#fs, this.#paths.segmentDir);
        anchorNames.pop();
        anchors.pop();
        events.pop();
        expectedSegments.delete(orphanSegmentName);
        delete anchorFingerprints[orphanAnchorName];
        delete segmentFingerprints[orphanSegmentName];
        maximumAnchor = anchors.at(-1);
      }
    }
    if (witnessed.sequence !== maximumAnchor.sequence) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WITNESS_CONFLICT",
        "local immutable head is not committed by the authenticated witness",
      );
    }
    const maximumEvent =
      maximumAnchor.sequence === 0 ? null : events[maximumAnchor.sequence - 1];
    this.#assertWitnessSnapshot(
      witnessed,
      identity,
      storeMarker,
      maximumAnchor,
      maximumEvent,
    );
    if (head.sequence < maximumAnchor.sequence) {
      const bytes = serializeRecord(maximumAnchor, 64 * 1024, "head anchor");
      this.#replaceHead(bytes);
      authoritativeHead = maximumAnchor;
    } else if (head.anchorDigest !== maximumAnchor.anchorDigest) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_CORRUPT",
        "HEAD digest diverges from the authenticated witness",
      );
    }

    const verifiedState = deepFreeze({
      anchors,
      events,
      head: authoritativeHead,
      identity,
      storeMarker,
      witness: witnessed,
    });
    return this.#rememberState(
      verifiedState,
      anchorNames,
      [...expectedSegments].sort(),
      anchorFingerprints,
      segmentFingerprints,
    );
  }

  #artifactRefs(input) {
    const refs = Object.hasOwn(input, "subjectRef")
      ? [input.subjectRef, ...input.sourceRefs]
      : [
          ...input.sourceRefs,
          input.parentRef,
          input.candidateRef,
          input.diffRef,
          input.evalRef,
          input.policyRef,
          input.actorRef,
          input.targetRef,
        ].filter(Boolean);
    const byRef = new Map();
    for (const ref of refs) {
      const existing = byRef.get(ref.ref);
      if (existing && existing.digest !== ref.digest) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
          `artifact ref is bound to conflicting digests: ${ref.ref}`,
        );
      }
      byRef.set(ref.ref, ref);
    }
    return [...byRef.values()].sort((left, right) =>
      compareStrings(left.ref, right.ref),
    );
  }

  #resolveArtifacts(input, identity) {
    const validations = [];
    const artifactTenantId = Object.hasOwn(input, "artifactTenantId")
      ? input.artifactTenantId
      : input.tenantId;
    for (const ref of this.#artifactRefs(input)) {
      let resolution;
      try {
        resolution = this.#artifactResolver({
          epoch: identity.epoch,
          ledgerId: identity.ledgerId,
          ref: frozenClone(ref),
          tenantId: artifactTenantId,
        });
      } catch (cause) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_ARTIFACT_UNAVAILABLE",
          `artifact resolver failed for ${ref.ref}`,
          { cause, ref: ref.ref },
        );
      }
      try {
        assertExactKeys(resolution, RESOLUTION_KEYS, "artifact resolution");
        if (
          resolution.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
          resolution.found !== true ||
          resolution.authenticated !== true ||
          resolution.ref !== ref.ref ||
          resolution.digest !== ref.digest
        ) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
            `artifact resolution is not authenticated and exactly bound: ${ref.ref}`,
          );
        }
        const bytes = copyResolvedBytes(resolution.bytes);
        if (sha256(bytes) !== ref.digest) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
            `artifact bytes do not match their digest: ${ref.ref}`,
          );
        }
        validations.push({
          byteLength: bytes.length,
          digest: ref.digest,
          receiptDigest: digest(
            resolution.receiptDigest,
            "artifact resolution receiptDigest",
          ),
          ref: ref.ref,
        });
      } catch (cause) {
        if (cause?.code === "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID") {
          throw cause;
        }
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_ARTIFACT_INVALID",
          `artifact resolution failed strict validation: ${ref.ref}`,
          { cause },
        );
      }
    }
    return domainDigest(ARTIFACT_VALIDATION_DOMAIN, validations);
  }

  #buildEvent(input, previous, identity, artifactValidationDigest) {
    const core = normalizeEventCore({
      ...input,
      algorithm: this.#trust.algorithm,
      artifactValidationDigest,
      epoch: identity.epoch,
      identityDigest: identity.identityDigest,
      keyId: this.#trust.keyId,
      ledgerId: identity.ledgerId,
      prevDigest: previous?.eventDigest || null,
      schema: EVOLUTION_LEDGER_EVENT_SCHEMA,
      sequence: (previous?.sequence || 0) + 1,
      trustPolicyDigest: this.#trust.trustPolicyDigest,
      witnessAlgorithm: this.#witnessTrust.algorithm,
      witnessId: this.#witness.id,
      witnessKeyId: this.#witnessTrust.keyId,
      witnessTrustPolicyDigest: this.#witnessTrust.trustPolicyDigest,
    });
    return this.#signRecord(EVENT_DOMAIN, core, "eventDigest", "event");
  }

  #buildDomainEvent(input, previous, identity, artifactValidationDigest) {
    const core = normalizeDomainEventCore({
      ...input,
      algorithm: this.#trust.algorithm,
      artifactValidationDigest,
      epoch: identity.epoch,
      identityDigest: identity.identityDigest,
      keyId: this.#trust.keyId,
      ledgerId: identity.ledgerId,
      prevDigest: previous?.eventDigest || null,
      schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
      sequence: (previous?.sequence || 0) + 1,
      trustPolicyDigest: this.#trust.trustPolicyDigest,
      witnessAlgorithm: this.#witnessTrust.algorithm,
      witnessId: this.#witness.id,
      witnessKeyId: this.#witnessTrust.keyId,
      witnessTrustPolicyDigest: this.#witnessTrust.trustPolicyDigest,
    });
    return this.#signRecord(
      DOMAIN_EVENT_DOMAIN,
      core,
      "eventDigest",
      "domain-event",
    );
  }

  #issueReceipt(state, event, anchor, durabilityMechanism) {
    const core = normalizeReceiptCore(
      {
        algorithm: this.#trust.algorithm,
        anchorDigest: anchor.anchorDigest,
        authenticated: true,
        committed: true,
        committedAt: anchor.committedAt,
        durabilityMechanism,
        durable: true,
        epoch: state.identity.epoch,
        eventDigest: event.eventDigest,
        eventId: event.eventId,
        headDigest: anchor.headDigest,
        headSignature: anchor.signature,
        identityDigest: state.identity.identityDigest,
        issuedAt: clockTimestamp(this.#clock),
        keyId: this.#trust.keyId,
        ledgerId: state.identity.ledgerId,
        persisted: true,
        schema: EVOLUTION_LEDGER_RECEIPT_SCHEMA,
        segmentDigest: anchor.segmentDigest,
        sequence: event.sequence,
        trustPolicyDigest: this.#trust.trustPolicyDigest,
        witnessAlgorithm: this.#witnessTrust.algorithm,
        witnessCheckpoint: state.witness,
        witnessDigest: state.witness.witnessDigest,
        witnessId: this.#witness.id,
        witnessKeyId: this.#witnessTrust.keyId,
        witnessTrustPolicyDigest: this.#witnessTrust.trustPolicyDigest,
      },
      this.#trust,
      this.#witnessTrust,
    );
    return this.#signRecord(RECEIPT_DOMAIN, core, "receiptDigest", "receipt");
  }

  append(input, options = {}) {
    return this.#appendEvent(input, options, false);
  }

  appendDomainEvent(input, options = {}) {
    return this.#appendEvent(input, options, true);
  }

  #appendEvent(input, options, domainEvent) {
    const safeOptions = normalizeAppendOptions(options);
    const state = {
      event: null,
      receipt: null,
      witnessAttempted: false,
      witnessPublished: false,
    };
    try {
      return this.#withLock(() => {
        const current = this.#loadState({
          allowInitialize: false,
          incremental: true,
        });
        const previous = current.events.at(-1) || null;
        if (
          safeOptions.expectedSequence !== undefined &&
          safeOptions.expectedSequence !== (previous?.sequence || 0)
        ) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_HEAD_CONFLICT",
            "ledger sequence changed before append",
            {
              actualSequence: previous?.sequence || 0,
              expectedSequence: safeOptions.expectedSequence,
            },
          );
        }
        if (
          safeOptions.expectedHeadDigest !== undefined &&
          safeOptions.expectedHeadDigest !== (previous?.eventDigest || null)
        ) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_HEAD_CONFLICT",
            "ledger head digest changed before append",
            {
              actualHeadDigest: previous?.eventDigest || null,
              expectedHeadDigest: safeOptions.expectedHeadDigest,
            },
          );
        }
        const generatedTimestamp = clockTimestamp(this.#clock);
        const normalized = domainEvent
          ? normalizeDomainAppendInput(input, generatedTimestamp)
          : normalizeAppendInput(input, generatedTimestamp);
        if (
          current.events.some((event) => event.eventId === normalized.eventId)
        ) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_EVENT_CONFLICT",
            `eventId already exists: ${normalized.eventId}`,
          );
        }
        if (current.events.length >= EVOLUTION_LEDGER_MAX_EVENTS) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_CAPACITY_EXCEEDED",
            "evolution ledger capacity is exhausted",
          );
        }
        const artifactValidationDigest = this.#resolveArtifacts(
          normalized,
          current.identity,
        );
        const event = domainEvent
          ? this.#buildDomainEvent(
              normalized,
              previous,
              current.identity,
              artifactValidationDigest,
            )
          : this.#buildEvent(
              normalized,
              previous,
              current.identity,
              artifactValidationDigest,
            );
        state.event = event;
        const segmentDigest = domainDigest(SEGMENT_DOMAIN, event);
        const segmentPath = path.join(
          this.#paths.segmentDir,
          segmentFileName(event.sequence, segmentDigest),
        );
        const eventBytes = serializeRecord(
          event,
          EVOLUTION_LEDGER_MAX_EVENT_BYTES,
          "event segment",
        );
        this.#writeImmutable(
          segmentPath,
          eventBytes,
          "event segment",
          (temporaryPath) => {
            this.#invokeCrashHook("after-segment-link", {
              eventDigest: event.eventDigest,
              temporaryPath: path.basename(temporaryPath),
            });
          },
        );
        this.#invokeCrashHook("after-segment", {
          eventDigest: event.eventDigest,
          segmentDigest,
        });

        const anchor = this.#buildAnchor(
          current.identity,
          current.anchors.at(-1),
          event,
          segmentDigest,
        );
        const anchorPath = path.join(
          this.#paths.anchorDir,
          anchorFileName(anchor.sequence, anchor.anchorDigest),
        );
        const anchorBytes = serializeRecord(anchor, 64 * 1024, "head anchor");
        this.#writeImmutable(
          anchorPath,
          anchorBytes,
          "head anchor",
          (temporaryPath) => {
            this.#invokeCrashHook("after-anchor-link", {
              anchorDigest: anchor.anchorDigest,
              temporaryPath: path.basename(temporaryPath),
            });
          },
        );
        this.#invokeCrashHook("after-anchor", {
          anchorDigest: anchor.anchorDigest,
          eventDigest: event.eventDigest,
        });
        this.#requireDirectoryDurability([
          this.#paths.segmentDir,
          this.#paths.anchorDir,
        ]);
        state.witnessAttempted = true;
        const witnessed = this.#advanceWitness(
          current.witness,
          current.identity,
          current.storeMarker,
          anchor,
          event,
        );
        state.witnessPublished = true;
        this.#invokeCrashHook("after-witness", {
          anchorDigest: anchor.anchorDigest,
          eventDigest: event.eventDigest,
          witnessDigest: witnessed.witnessDigest,
        });
        this.#replaceHead(anchorBytes);
        this.#invokeCrashHook("after-head", {
          anchorDigest: anchor.anchorDigest,
          eventDigest: event.eventDigest,
        });

        const persisted = this.#loadState({
          allowInitialize: false,
          incremental: true,
        });
        const persistedEvent = persisted.events.at(-1);
        const persistedAnchor = persisted.anchors.at(-1);
        if (
          persistedEvent?.eventDigest !== event.eventDigest ||
          persistedAnchor?.anchorDigest !== anchor.anchorDigest ||
          persisted.head.anchorDigest !== anchor.anchorDigest
        ) {
          throw ledgerError(
            "CC_EVOLUTION_LEDGER_WRITE_FAILED",
            "event was not recovered under the authenticated HEAD",
          );
        }
        state.receipt = this.#issueReceipt(
          persisted,
          persistedEvent,
          persistedAnchor,
          "authenticated-witness-cas",
        );
        return state.receipt;
      });
    } catch (cause) {
      if (state.witnessAttempted || state.receipt) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN",
          "an authenticated anchor may be committed; reopen and query by eventId",
          {
            cause,
            commitState: "unknown",
            eventDigest: state.event?.eventDigest || null,
            eventId: state.event?.eventId || safeOwnDataValue(input, "eventId"),
            witnessPublished: state.witnessPublished,
          },
        );
      }
      if (cause instanceof EvolutionLedgerError) {
        if (!cause.commitState) cause.commitState = "not-committed";
        throw cause;
      }
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_WRITE_FAILED",
        "evolution event failed before an authenticated anchor was published",
        {
          cause,
          commitState: "not-committed",
          eventId: safeOwnDataValue(input, "eventId"),
        },
      );
    }
  }

  #queryState(state, selector) {
    return (
      state.events.find(
        (event) =>
          (selector.eventId === undefined ||
            event.eventId === selector.eventId) &&
          (selector.eventDigest === undefined ||
            event.eventDigest === selector.eventDigest) &&
          (selector.sequence === undefined ||
            event.sequence === selector.sequence),
      ) || null
    );
  }

  query(selector, options = {}) {
    const safeSelector = normalizeQuerySelector(selector);
    assertExactKeys(options, QUERY_OPTION_KEYS, "query options", {
      optional: [...QUERY_OPTION_KEYS],
    });
    const issueReceipt = options.issueReceipt !== false;
    return this.#withLock(() => {
      const state = this.#loadState({ allowInitialize: false });
      const event = this.#queryState(state, safeSelector);
      if (!event) return null;
      const anchor = state.anchors[event.sequence];
      const receipt = issueReceipt
        ? this.#issueReceipt(state, event, anchor, "verified-existing")
        : null;
      return deepFreeze({
        anchor,
        authenticated: true,
        authority: this.#authorityProjection(state),
        durable: true,
        event,
        receipt,
        schema: EVOLUTION_LEDGER_QUERY_SCHEMA,
      });
    });
  }

  findByEventId(eventId) {
    return this.query({ eventId }, { issueReceipt: false })?.event || null;
  }

  recoverReceipt(selector) {
    return this.query(selector, { issueReceipt: true })?.receipt || null;
  }

  verifyReceipt(receipt, options = {}) {
    assertExactKeys(options, VERIFY_RECEIPT_OPTION_KEYS, "receipt options", {
      optional: [...VERIFY_RECEIPT_OPTION_KEYS],
    });
    const requireCurrentHead = options.requireCurrentHead === true;
    let verifiedReceipt;
    try {
      verifiedReceipt = this.#verifyReceiptRecord(receipt);
    } catch (cause) {
      if (cause?.code === "CC_EVOLUTION_LEDGER_RECEIPT_INVALID") throw cause;
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
        "receipt failed strict schema, trust, digest, or signature validation",
        { cause },
      );
    }
    return this.#withLock(() => {
      const state = this.#loadState({ allowInitialize: false });
      const event = this.#queryState(state, {
        eventDigest: verifiedReceipt.eventDigest,
        eventId: verifiedReceipt.eventId,
        sequence: verifiedReceipt.sequence,
      });
      const anchor = state.anchors[verifiedReceipt.sequence];
      const witnessCheckpoint = verifiedReceipt.witnessCheckpoint;
      const witnessAnchor = state.anchors[witnessCheckpoint.sequence];
      const witnessEvent =
        witnessCheckpoint.sequence === 0
          ? null
          : state.events[witnessCheckpoint.sequence - 1];
      let witnessSnapshotValid = false;
      let witnessAncestryValid = false;
      try {
        if (witnessAnchor) {
          this.#assertWitnessSnapshot(
            witnessCheckpoint,
            state.identity,
            state.storeMarker,
            witnessAnchor,
            witnessEvent,
          );
          witnessSnapshotValid = true;
        }
        if (witnessCheckpoint.witnessDigest === state.witness.witnessDigest) {
          witnessAncestryValid = true;
        } else if (witnessCheckpoint.generation < state.witness.generation) {
          this.#proveWitnessAncestry(witnessCheckpoint, state.witness);
          witnessAncestryValid = true;
        }
      } catch {
        witnessSnapshotValid = false;
        witnessAncestryValid = false;
      }
      if (
        !event ||
        !anchor ||
        !witnessSnapshotValid ||
        !witnessAncestryValid ||
        verifiedReceipt.ledgerId !== state.identity.ledgerId ||
        verifiedReceipt.epoch !== state.identity.epoch ||
        verifiedReceipt.identityDigest !== state.identity.identityDigest ||
        verifiedReceipt.anchorDigest !== anchor.anchorDigest ||
        verifiedReceipt.headDigest !== anchor.headDigest ||
        verifiedReceipt.segmentDigest !== anchor.segmentDigest ||
        witnessCheckpoint.witnessDigest !== verifiedReceipt.witnessDigest ||
        witnessCheckpoint.sequence < verifiedReceipt.sequence ||
        canonicalJson(verifiedReceipt.headSignature) !==
          canonicalJson(anchor.signature) ||
        (requireCurrentHead &&
          verifiedReceipt.anchorDigest !== state.head.anchorDigest)
      ) {
        throw ledgerError(
          "CC_EVOLUTION_LEDGER_RECEIPT_INVALID",
          "receipt is not bound to the authenticated ledger event and head",
        );
      }
      return deepFreeze({
        anchor,
        authenticated: true,
        authority: this.#authorityProjection(state),
        durable: true,
        event,
        receipt: verifiedReceipt,
        valid: true,
      });
    });
  }

  read({ afterSequence = 0, limit = 10_000 } = {}) {
    if (
      !Number.isSafeInteger(afterSequence) ||
      afterSequence < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > EVOLUTION_LEDGER_MAX_EVENTS
    ) {
      throw ledgerError(
        "CC_EVOLUTION_LEDGER_SCHEMA_INVALID",
        "read bounds are invalid",
      );
    }
    return this.#withLock(() => {
      const state = this.#loadState({ allowInitialize: false });
      return deepFreeze(
        state.events
          .filter((event) => event.sequence > afterSequence)
          .slice(0, limit),
      );
    });
  }

  #authorityProjection(state) {
    return deepFreeze({
      algorithm: this.#trust.algorithm,
      anchorDigest: state.head.anchorDigest,
      authenticated: true,
      durable: true,
      epoch: state.identity.epoch,
      eventCount: state.events.length,
      headDigest: state.head.headDigest,
      headSignature: state.head.signature,
      identityDigest: state.identity.identityDigest,
      identitySignature: state.identity.signature,
      keyId: this.#trust.keyId,
      ledgerId: state.identity.ledgerId,
      schema: EVOLUTION_LEDGER_VERIFICATION_SCHEMA,
      sequence: state.head.sequence,
      status: "verified",
      storeMarkerDigest: state.identity.storeMarkerDigest,
      storeMarkerEntryDigest: state.identity.storeMarkerEntryDigest,
      storeMarkerId: state.identity.storeMarkerId,
      trustPolicyDigest: this.#trust.trustPolicyDigest,
      verifiedAt: clockTimestamp(this.#clock),
      witnessDiscardAccumulatorDigest: state.witness.discardAccumulatorDigest,
      witnessDigest: state.witness.witnessDigest,
      witnessGeneration: state.witness.generation,
      witnessId: this.#witness.id,
    });
  }

  verify() {
    return this.#withLock(() =>
      this.#authorityProjection(this.#loadState({ allowInitialize: false })),
    );
  }

  getAuthority() {
    return this.verify();
  }
}

Object.freeze(EvolutionLedger.prototype);
Object.freeze(EvolutionLedger);
