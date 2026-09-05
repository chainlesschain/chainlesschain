/**
 * Tenant-bound durable artifact/envelope adapter for the evolution plane.
 *
 * ArtifactStore ids are deliberately treated only as short, local locators.
 * Authority comes from the signed envelope, its recordDigest, exact lineage,
 * and a fresh readback of the canonical bytes. ArtifactStore does not fsync its
 * parent directory, so receipts below claim persisted/read-back integrity, not
 * power-loss durability, WORM storage, or durable CAS.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { ArtifactStore } from "../artifact-store.js";
import {
  EVOLUTION_ARTIFACT_REF_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
} from "./evolution-ledger.js";

export const EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA =
  "chainlesschain.evolution-durable-artifact-record/v1";
export const EVOLUTION_ARTIFACT_ENVELOPE_CORE_SCHEMA =
  "chainlesschain.evolution-artifact-envelope-core/v1";
export const EVOLUTION_ARTIFACT_ENVELOPE_SCHEMA =
  "chainlesschain.evolution-artifact-envelope/v1";
export const EVOLUTION_ARTIFACT_LINEAGE_SCHEMA =
  "chainlesschain.evolution-artifact-lineage/v1";
export const EVOLUTION_ARTIFACT_AUTHORITY_REQUEST_SCHEMA =
  "chainlesschain.evolution-artifact-authority-request/v1";
export const EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA =
  "chainlesschain.evolution-artifact-authority-decision/v1";
export const EVOLUTION_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA =
  "chainlesschain.evolution-artifact-persistence-receipt/v1";
export const EVOLUTION_ARTIFACT_RESOLVED_SCHEMA =
  "chainlesschain.evolution-artifact-resolved/v1";
export const EVOLUTION_ARTIFACT_RESOLUTION_RECEIPT_SCHEMA =
  "chainlesschain.evolution-artifact-resolution-receipt/v1";

export const EVOLUTION_ARTIFACT_INVALID_CODE = "CC_EVOLUTION_ARTIFACT_INVALID";
export const EVOLUTION_ARTIFACT_TYPE_DENIED_CODE =
  "CC_EVOLUTION_ARTIFACT_TYPE_DENIED";
export const EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE =
  "CC_EVOLUTION_ARTIFACT_AUTHORITY_DENIED";
export const EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE =
  "CC_EVOLUTION_ARTIFACT_SIGNATURE_INVALID";
export const EVOLUTION_ARTIFACT_EXPIRED_CODE = "CC_EVOLUTION_ARTIFACT_EXPIRED";
export const EVOLUTION_ARTIFACT_NOT_FOUND_CODE =
  "CC_EVOLUTION_ARTIFACT_NOT_FOUND";
export const EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE =
  "CC_EVOLUTION_ARTIFACT_INTEGRITY_FAILED";
export const EVOLUTION_ARTIFACT_STORE_FAILED_CODE =
  "CC_EVOLUTION_ARTIFACT_STORE_FAILED";

export const EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES = 1024 * 1024;
export const EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES = 4096;
export const EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES = 10_000;
export const EVOLUTION_ARTIFACT_MAX_INDEX_BYTES = 64 * 1024 * 1024;
export const EVOLUTION_ARTIFACT_DEFAULT_TTL_MS = 15 * 60 * 1000;
export const EVOLUTION_ARTIFACT_MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const EVOLUTION_ARTIFACT_RETENTIONS = Object.freeze(["ttl", "ledger"]);
export const EVOLUTION_ARTIFACT_LEDGER_RETENTION_TYPES = Object.freeze([
  "controlled-skill-pilot-state",
  "skill-release-transition-intent",
  "skill-release-finalization",
  "skill-release-state-migration",
  "skill-mutation-audit",
  "skill-mutation-nonce-claim",
  "skill-promotion-review-decision",
  "skill-promotion-review-packet",
  "skill-registry-transition-attempt",
  "skill-registry-transition-request",
  "skill-registry-transition-settlement",
  "skill-retrieval-revocation-state",
  "evolution-run-event",
  "evolution-eval-child-evidence",
  "evolution-raw-deletion-receipt",
  "evolution-raw-deletion-tombstone",
  "evolution-release-train-checkpoint",
  "evolution-release-train-stage-output",
  "evolvable-artifact-candidate",
  "evolvable-artifact-transition",
  "evolution-workbench-metrics-receipt-retention",
  "evolution-workbench-metrics-snapshot",
  "governed-knowledge-sync-record",
  "governed-knowledge-merge-operation",
  "governed-knowledge-dependency-operation",
  "governed-knowledge-trust-record",
  "governed-skill-marketplace-state",
  "structured-memory-authority-receipt",
  "structured-memory-event",
  "structured-memory-snapshot",
  "wiki-maintenance-request",
  "wiki-maintenance-settlement",
  "wiki-revision",
  "wiki-skill-proposal",
  "wikiskill-benchmark-envelope-manifest",
  "wikiskill-benchmark-execution-manifest",
  "wikiskill-benchmark-plan",
  "wikiskill-benchmark-report-chunk",
]);
export const EVOLUTION_ARTIFACT_LEDGER_RETENTION_PURPOSES = Object.freeze([
  "evolution-ledger",
  "skill-mutation",
  "skill-release-transition",
]);

/**
 * A finite product allow-list. Deployments may pass a narrower constructor
 * allow-list, but may not widen it with arbitrary caller-provided strings.
 */
export const EVOLUTION_ARTIFACT_TYPES = Object.freeze([
  "actor",
  "candidate",
  "candidate-diff",
  "controlled-skill-pilot-state",
  "diff",
  "eval",
  "eval-policy",
  "eval-receipt",
  "eval-suite",
  "evaluation",
  "evaluation-result",
  "evolution-run-event",
  "evolution-eval-child-evidence",
  "evolution-raw-deletion-receipt",
  "evolution-raw-deletion-tombstone",
  "evolution-release-train-checkpoint",
  "evolution-release-train-stage-output",
  "evolvable-artifact-candidate",
  "evolvable-artifact-transition",
  "evolution-workbench-metrics-receipt-retention",
  "evolution-workbench-metrics-snapshot",
  "governed-knowledge-sync-record",
  "governed-knowledge-merge-operation",
  "governed-knowledge-dependency-operation",
  "governed-knowledge-trust-record",
  "governed-skill-marketplace-state",
  "evidence",
  "model-projection",
  "policy",
  "projection",
  "promotion-receipt",
  "receipt",
  "recording",
  "release-receipt",
  "runtime",
  "skill-candidate",
  "skill-mutation-audit",
  "skill-mutation-nonce-claim",
  "skill-promotion-review-decision",
  "skill-promotion-review-packet",
  "skill-registry-transition-attempt",
  "skill-registry-transition-request",
  "skill-registry-transition-settlement",
  "skill-retrieval-revocation-state",
  "skill-release-finalization",
  "skill-release-state-migration",
  "structured-memory-authority-receipt",
  "structured-memory-event",
  "structured-memory-snapshot",
  "wiki-maintenance-request",
  "wiki-maintenance-settlement",
  "wiki-revision",
  "wiki-skill-proposal",
  "wikiskill-benchmark-envelope-manifest",
  "wikiskill-benchmark-execution-manifest",
  "wikiskill-benchmark-plan",
  "wikiskill-benchmark-report-chunk",
  "skill-release-transition-intent",
  "source",
  "source-evidence",
  "target",
  "trusted-projection",
  "witness",
]);

const ENVELOPE_SIGNATURE_DOMAIN =
  "chainlesschain.evolution-artifact-envelope/v1\0";
const AUTHORITY_RECEIPT_DOMAIN =
  "chainlesschain.evolution-artifact-authority-decision/v1\0";
const PERSISTENCE_RECEIPT_DOMAIN =
  "chainlesschain.evolution-artifact-persistence-receipt/v1\0";
const RESOLUTION_RECEIPT_DOMAIN =
  "chainlesschain.evolution-artifact-resolution-receipt/v1\0";
const ARTIFACT_REF_PREFIX = "cc-evolution-artifact:";
const MAX_CANONICAL_DEPTH = 32;
const MAX_CANONICAL_NODES = 100_000;
const MAX_ARRAY_ENTRIES = 65_536;
const MAX_OBJECT_FIELDS = 4096;
const MAX_KEY_CHARS = 512;
const MAX_STRING_CHARS = EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES;
const MAX_AUTHORITY_DECISION_TTL_MS = 60_000;
const MAX_INDEX_ENTRY_BYTES = 16 * 1024;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// ArtifactStore requires housekeeping TTL metadata. This deliberately distant
// operational horizon is neither embedded in the signed ledger envelope nor
// returned as an authority promise. Removal at any time still fails closed.
const LEDGER_HOUSEKEEPING_TTL_DAYS = 1_000_000;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ALGORITHM_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}$/u;
const KEY_ID_PATTERN = /^[a-z][a-z0-9+.-]{1,31}:[^\s\\]{1,254}$/u;
const SIGNATURE_VALUE_PATTERN = /^[A-Za-z0-9_-]{32,2048}$/u;
const ARTIFACT_ID_PATTERN = /^art_[a-z0-9-]{1,32}_[a-f0-9]{8}$/u;
const INDEX_ENTRY_KEYS = new Set([
  "createdAt",
  "expiresAt",
  "file",
  "id",
  "immutable",
  "kind",
  "lineage",
  "mime",
  "recordDigest",
  "sessionId",
  "sha256",
  "size",
  "sourcePath",
  "title",
]);
const LINEAGE_KEYS = new Set([
  "audience",
  "envelope",
  "envelopeDigest",
  "purpose",
  "recordDigest",
  "retention",
  "schema",
  "tenantId",
  "type",
]);
const RECORD_KEYS = new Set([
  "audience",
  "purpose",
  "retention",
  "schema",
  "tenantId",
  "type",
  "value",
]);
const ENVELOPE_KEYS = new Set(["core", "schema", "signature"]);
const ENVELOPE_CORE_KEYS = new Set([
  "algorithm",
  "audience",
  "authorityReceiptDigest",
  "digest",
  "expiresAt",
  "issuedAt",
  "keyId",
  "policyDigest",
  "policyRevision",
  "purpose",
  "recordDigest",
  "retention",
  "revocationRevision",
  "schema",
  "tenantId",
  "type",
]);
const SIGNATURE_KEYS = new Set(["algorithm", "keyId", "value"]);
const PUT_CONTEXT_KEYS = new Set(["audience", "purpose", "retention", "ttlMs"]);
const RESOLVE_OPTION_KEYS = new Set([
  "expectedDigest",
  "expectedType",
  "purpose",
  "tenantId",
]);
const AUTHORITY_DECISION_KEYS = new Set([
  "action",
  "algorithm",
  "allowed",
  "audience",
  "checkedAt",
  "decisionExpiresAt",
  "digest",
  "keyId",
  "policyDigest",
  "policyRevision",
  "issuedAt",
  "issuedPolicyDigest",
  "issuedPolicyRevision",
  "issuedPolicyTrusted",
  "receiptDigest",
  "requestedAt",
  "retention",
  "revocationRevision",
  "revoked",
  "schema",
  "tenantId",
  "type",
  "purpose",
]);
const PUBLISH_RESULT_KEYS = new Set(["entry", "published"]);
const INTEGRITY_RESULT_KEYS = new Set([
  "actualSha256",
  "expectedSha256",
  "ok",
  "reason",
]);
const ARTIFACT_REF_KEYS = new Set(["digest", "ref", "schema"]);
const LEDGER_REQUEST_KEYS = new Set(["epoch", "ledgerId", "ref", "tenantId"]);
const CONSTRUCTOR_OPTION_KEYS = new Set([
  "allowedTypes",
  "artifactStore",
  "audience",
  "currentAuthorityResolver",
  "envelopeSigner",
  "envelopeVerifier",
  "now",
  "tenantId",
]);
const CONSTRUCTOR_REQUIRED_KEYS = new Set([
  "artifactStore",
  "audience",
  "currentAuthorityResolver",
  "envelopeSigner",
  "envelopeVerifier",
  "tenantId",
]);
const LEDGER_RESOLVER_OPTION_KEYS = new Set(["purpose"]);
const EVOLUTION_LEDGER_ARTIFACT_RESOLVERS = new WeakSet();
const isProxy = Object.freeze(utilTypes.isProxy.bind(utilTypes));
const isDate = Object.freeze(utilTypes.isDate.bind(utilTypes));
const dateGetTime = Object.freeze(
  Function.prototype.call.bind(Date.prototype.getTime),
);
const RETENTION_SET = new Set(EVOLUTION_ARTIFACT_RETENTIONS);
const LEDGER_RETENTION_PURPOSES_BY_TYPE = new Map([
  ["controlled-skill-pilot-state", new Set(["evolution-ledger"])],
  [
    "skill-release-transition-intent",
    new Set(["evolution-ledger", "skill-release-transition"]),
  ],
  [
    "skill-release-finalization",
    new Set(["evolution-ledger", "skill-release-transition"]),
  ],
  ["skill-release-state-migration", new Set(["evolution-ledger"])],
  ["skill-mutation-audit", new Set(["evolution-ledger", "skill-mutation"])],
  [
    "skill-mutation-nonce-claim",
    new Set(["evolution-ledger", "skill-mutation"]),
  ],
  ["skill-promotion-review-decision", new Set(["evolution-ledger"])],
  ["skill-promotion-review-packet", new Set(["evolution-ledger"])],
  ["skill-registry-transition-attempt", new Set(["evolution-ledger"])],
  ["skill-registry-transition-request", new Set(["evolution-ledger"])],
  ["skill-registry-transition-settlement", new Set(["evolution-ledger"])],
  ["skill-retrieval-revocation-state", new Set(["evolution-ledger"])],
  ["evolution-run-event", new Set(["evolution-ledger"])],
  ["evolution-eval-child-evidence", new Set(["evolution-ledger"])],
  ["evolution-raw-deletion-receipt", new Set(["evolution-ledger"])],
  ["evolution-raw-deletion-tombstone", new Set(["evolution-ledger"])],
  ["evolution-release-train-checkpoint", new Set(["evolution-ledger"])],
  ["evolution-release-train-stage-output", new Set(["evolution-ledger"])],
  ["evolvable-artifact-candidate", new Set(["evolution-ledger"])],
  ["evolvable-artifact-transition", new Set(["evolution-ledger"])],
  [
    "evolution-workbench-metrics-receipt-retention",
    new Set(["evolution-ledger"]),
  ],
  ["evolution-workbench-metrics-snapshot", new Set(["evolution-ledger"])],
  ["governed-knowledge-sync-record", new Set(["evolution-ledger"])],
  ["governed-knowledge-merge-operation", new Set(["evolution-ledger"])],
  ["governed-knowledge-dependency-operation", new Set(["evolution-ledger"])],
  ["governed-knowledge-trust-record", new Set(["evolution-ledger"])],
  ["governed-skill-marketplace-state", new Set(["evolution-ledger"])],
  ["wiki-revision", new Set(["evolution-ledger"])],
  ["wiki-skill-proposal", new Set(["evolution-ledger"])],
  ["wikiskill-benchmark-envelope-manifest", new Set(["evolution-ledger"])],
  ["wikiskill-benchmark-execution-manifest", new Set(["evolution-ledger"])],
  ["wikiskill-benchmark-plan", new Set(["evolution-ledger"])],
  ["wikiskill-benchmark-report-chunk", new Set(["evolution-ledger"])],
  ["structured-memory-authority-receipt", new Set(["evolution-ledger"])],
  ["structured-memory-event", new Set(["evolution-ledger"])],
  ["structured-memory-snapshot", new Set(["evolution-ledger"])],
  ["wiki-maintenance-request", new Set(["evolution-ledger"])],
  ["wiki-maintenance-settlement", new Set(["evolution-ledger"])],
]);

export class EvolutionArtifactPortError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "EvolutionArtifactPortError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function isEvolutionArtifactPortError(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  let cursor = value;
  try {
    while (cursor) {
      if (isProxy(cursor)) return false;
      if (cursor === EvolutionArtifactPortError.prototype) return true;
      cursor = Object.getPrototypeOf(cursor);
    }
  } catch {
    return false;
  }
  return false;
}

function hasStablePrototype(value, expectedPrototype, label) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  let cursor = value;
  while (cursor) {
    rejectProxy(cursor, `${label} prototype chain`);
    if (cursor === expectedPrototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}

function artifactError(code, message, details = {}) {
  return new EvolutionArtifactPortError(code, message, details);
}

function rejectProxy(value, label, code = EVOLUTION_ARTIFACT_INVALID_CODE) {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    isProxy(value)
  ) {
    throw artifactError(
      code,
      `${label} must not be a Proxy; provide stable own-data JSON values`,
    );
  }
}

function isPlainRecord(
  value,
  label = "value",
  code = EVOLUTION_ARTIFACT_INVALID_CODE,
) {
  if (!value || typeof value !== "object") return false;
  rejectProxy(value, label, code);
  if (Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownData(
  value,
  key,
  label,
  { enumerable = true, code = EVOLUTION_ARTIFACT_INVALID_CODE } = {},
) {
  rejectProxy(value, label, code);
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw artifactError(
      code,
      `${label}.${String(key)} descriptor could not be inspected`,
      { cause },
    );
  }
  if (
    !descriptor ||
    !("value" in descriptor) ||
    (enumerable && descriptor.enumerable !== true)
  ) {
    throw artifactError(
      code,
      `${label}.${String(key)} must be an enumerable own data property`,
    );
  }
  return descriptor.value;
}

function assertExactRecord(
  value,
  keys,
  label,
  code = EVOLUTION_ARTIFACT_INVALID_CODE,
) {
  if (!isPlainRecord(value, label, code)) {
    throw artifactError(code, `${label} must be a plain object`);
  }
  let ownKeys;
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch (cause) {
    throw artifactError(code, `${label} keys could not be inspected`, {
      cause,
    });
  }
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw artifactError(
      code,
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of ownKeys) ownData(value, key, label, { code });
}

function assertOptionalExactRecord(
  value,
  keys,
  required,
  label,
  code = EVOLUTION_ARTIFACT_INVALID_CODE,
) {
  if (!isPlainRecord(value, label, code)) {
    throw artifactError(code, `${label} must be a plain object`);
  }
  let ownKeys;
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch (cause) {
    throw artifactError(code, `${label} keys could not be inspected`, {
      cause,
    });
  }
  if (
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key)) ||
    [...required].some((key) => !ownKeys.includes(key))
  ) {
    throw artifactError(
      code,
      `${label} contains missing or unsupported fields`,
    );
  }
  for (const key of ownKeys) ownData(value, key, label, { code });
}

function assertDenseDataArray(value, label, maximum) {
  rejectProxy(value, label);
  if (!Array.isArray(value) || value.length > maximum) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      `${label} must be a bounded array`,
    );
  }
  const allowed = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  let ownKeys;
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch (cause) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      `${label} keys could not be inspected`,
      { cause },
    );
  }
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      `${label} must be dense and contain only indexed entries`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    ownData(value, String(index), label);
  }
}

function appendCanonical(state, fragment) {
  state.byteLength += Buffer.byteLength(fragment, "utf8");
  if (state.byteLength > state.maximumBytes) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      `canonical JSON exceeds ${state.maximumBytes} bytes`,
    );
  }
  state.fragments.push(fragment);
}

function canonicalWalk(value, state, depth) {
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "canonical JSON exceeds its node or depth limit",
    );
  }
  if (value === null || typeof value === "boolean") {
    appendCanonical(state, JSON.stringify(value));
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INVALID_CODE,
        "canonical JSON numbers must be finite and must not be negative zero",
      );
    }
    appendCanonical(state, JSON.stringify(value));
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_CHARS) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INVALID_CODE,
        "canonical JSON string exceeds its character limit",
      );
    }
    appendCanonical(state, JSON.stringify(value));
    return;
  }
  if (!value || typeof value !== "object") {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "canonical JSON contains an unsupported value",
    );
  }
  rejectProxy(value, "canonical JSON value");
  if (state.seen.has(value)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "canonical JSON must not contain cycles",
    );
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      assertDenseDataArray(value, "canonical JSON array", MAX_ARRAY_ENTRIES);
      appendCanonical(state, "[");
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) appendCanonical(state, ",");
        canonicalWalk(
          ownData(value, String(index), "canonical JSON array"),
          state,
          depth + 1,
        );
      }
      appendCanonical(state, "]");
      return;
    }
    if (!isPlainRecord(value, "canonical JSON object")) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INVALID_CODE,
        "canonical JSON objects must use Object or null prototypes",
      );
    }
    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch (cause) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INVALID_CODE,
        "canonical JSON object keys could not be inspected",
        { cause },
      );
    }
    if (
      keys.length > MAX_OBJECT_FIELDS ||
      keys.some((key) => typeof key !== "string" || key.length > MAX_KEY_CHARS)
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INVALID_CODE,
        "canonical JSON object keys exceed their limits",
      );
    }
    keys.sort();
    appendCanonical(state, "{");
    for (const [index, key] of keys.entries()) {
      if (index > 0) appendCanonical(state, ",");
      appendCanonical(state, JSON.stringify(key));
      appendCanonical(state, ":");
      canonicalWalk(
        ownData(value, key, "canonical JSON object"),
        state,
        depth + 1,
      );
    }
    appendCanonical(state, "}");
  } finally {
    state.seen.delete(value);
  }
}

function canonicalJson(
  value,
  maximumBytes = EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES,
) {
  const state = {
    byteLength: 0,
    fragments: [],
    maximumBytes,
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
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function frozenCanonicalClone(value) {
  return deepFreeze(JSON.parse(canonicalJson(value)));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function domainDigest(domain, value) {
  return sha256(Buffer.from(`${domain}${canonicalJson(value)}`, "utf8"));
}

function normalizeDigest(value, label, code = EVOLUTION_ARTIFACT_INVALID_CODE) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw artifactError(code, `${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function normalizeSafeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      `${label} must be a bounded identifier`,
    );
  }
  return value;
}

function normalizeType(value, allowedTypes) {
  if (
    typeof value !== "string" ||
    !TYPE_PATTERN.test(value) ||
    !allowedTypes.has(value)
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_TYPE_DENIED_CODE,
      "evolution artifact type is not in the captured allow-list",
      { type: typeof value === "string" ? value.slice(0, 128) : null },
    );
  }
  return value;
}

function normalizeRetention(
  value,
  label,
  code = EVOLUTION_ARTIFACT_INVALID_CODE,
) {
  if (typeof value !== "string" || !RETENTION_SET.has(value)) {
    throw artifactError(
      code,
      `${label} must be one of the supported retention classes`,
    );
  }
  return value;
}

function assertLedgerRetentionAdmission(type, purpose) {
  const purposes = LEDGER_RETENTION_PURPOSES_BY_TYPE.get(type);
  if (!purposes || !purposes.has(purpose)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
      "ledger retention is denied for this artifact type and purpose",
      { purpose, type },
    );
  }
}

function ledgerHousekeepingTtlDays(issuedAtMs) {
  const duration = LEDGER_HOUSEKEEPING_TTL_DAYS * MILLISECONDS_PER_DAY;
  if (
    !Number.isFinite(issuedAtMs) ||
    issuedAtMs > MAX_DATE_MILLISECONDS - duration
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
      "ledger artifact issuance instant cannot be represented by ArtifactStore housekeeping metadata",
    );
  }
  return LEDGER_HOUSEKEEPING_TTL_DAYS;
}

function addCanonicalTimestamp(baseMs, durationMs, label) {
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0 ||
    baseMs > MAX_DATE_MILLISECONDS - durationMs
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      `${label} exceeds the portable JavaScript Date range`,
    );
  }
  return new Date(baseMs + durationMs).toISOString();
}

function normalizeTimestamp(
  value,
  label,
  code = EVOLUTION_ARTIFACT_INVALID_CODE,
) {
  if (typeof value !== "string" || value.length > 64) {
    throw artifactError(code, `${label} must be a canonical timestamp`);
  }
  let canonical;
  try {
    canonical = new Date(value).toISOString();
  } catch {
    canonical = null;
  }
  if (canonical !== value) {
    throw artifactError(code, `${label} must be a canonical timestamp`);
  }
  return value;
}

function normalizeNullableTimestamp(value, label) {
  return value === null
    ? null
    : normalizeTimestamp(
        value,
        label,
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
      );
}

function normalizeClockValue(value) {
  rejectProxy(value, "evolution artifact clock value");
  if (
    !isDate(value) &&
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact clock must return Date, number, or string",
    );
  }
  const date = isDate(value) ? new Date(dateGetTime(value)) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact clock returned an invalid instant",
    );
  }
  return { iso: date.toISOString(), milliseconds: date.getTime() };
}

function normalizeRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw artifactError(
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
      `${label} must be a non-negative safe integer`,
    );
  }
  return value;
}

function normalizeNullableRevision(value, label) {
  return value === null ? null : normalizeRevision(value, label);
}

function normalizeNullableDigest(value, label) {
  return value === null
    ? null
    : normalizeDigest(value, label, EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
}

function normalizeAlgorithm(value, label) {
  if (typeof value !== "string" || !ALGORITHM_PATTERN.test(value)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
      `${label} is invalid`,
    );
  }
  return value;
}

function normalizeKeyId(value, label) {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
      `${label} must be an opaque absolute key URI`,
    );
  }
  return value;
}

function captureMethod(port, method, label) {
  if (!port || (typeof port !== "object" && typeof port !== "function")) {
    throw new TypeError(`EvolutionArtifactPorts requires ${label}.${method}`);
  }
  rejectProxy(port, label);
  let cursor = port;
  while (cursor) {
    rejectProxy(cursor, `${label} prototype`);
    const descriptor = Object.getOwnPropertyDescriptor(cursor, method);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new TypeError(
          `EvolutionArtifactPorts requires ${label}.${method} as a data method`,
        );
      }
      return Object.freeze(descriptor.value.bind(port));
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  throw new TypeError(`EvolutionArtifactPorts requires ${label}.${method}`);
}

function captureArtifactStore(store) {
  rejectProxy(store, "artifactStore");
  if (!hasStablePrototype(store, ArtifactStore.prototype, "artifactStore")) {
    throw new TypeError(
      "EvolutionArtifactPorts requires the repository ArtifactStore implementation",
    );
  }
  const dir = ownData(store, "dir", "artifactStore", { enumerable: false });
  if (typeof dir !== "string" || dir.length < 1) {
    throw new TypeError("EvolutionArtifactPorts artifactStore.dir is invalid");
  }
  const resolvedDir = path.resolve(dir);
  const layout = establishStoreLayout(resolvedDir);
  const captured = Object.freeze({
    dir: resolvedDir,
    get: captureMethod(store, "get", "artifactStore"),
    layout,
    list: captureMethod(store, "list", "artifactStore"),
    publishDataOnce: captureMethod(store, "publishDataOnce", "artifactStore"),
    storedPath: captureMethod(store, "storedPath", "artifactStore"),
    verifyIntegrity: captureMethod(store, "verifyIntegrity", "artifactStore"),
  });
  // ArtifactStore methods consult public instance fields such as `dir` on
  // every call. Freeze the trusted instance after capturing its methods so a
  // later collaborator cannot redirect a bound get/list/integrity call to a
  // different store root.
  Object.freeze(store);
  return captured;
}

function rejectPromise(value, label, code) {
  rejectProxy(value, label, code);
  if (value && (typeof value === "object" || typeof value === "function")) {
    let cursor = value;
    while (cursor) {
      rejectProxy(cursor, `${label} prototype`, code);
      const descriptor = Object.getOwnPropertyDescriptor(cursor, "then");
      if (descriptor) {
        if (
          !("value" in descriptor) ||
          typeof descriptor.value === "function"
        ) {
          throw artifactError(code, `${label} must be synchronous`);
        }
        break;
      }
      cursor = Object.getPrototypeOf(cursor);
    }
  }
  return value;
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function physicalIdentity(stat) {
  return Object.freeze({
    birthtimeMs: Number(stat.birthtimeMs),
    dev: String(stat.dev),
    ino: String(stat.ino),
  });
}

function samePhysicalIdentity(stat, expected) {
  return (
    String(stat.dev) === expected.dev &&
    String(stat.ino) === expected.ino &&
    Number(stat.birthtimeMs) === expected.birthtimeMs
  );
}

function assertDirectory(stat, label) {
  if (
    !stat ||
    typeof stat.isDirectory !== "function" ||
    !stat.isDirectory() ||
    (typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink())
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      `${label} must be a physical, non-symlink directory`,
    );
  }
}

function assertExistingPathComponentsArePhysical(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const relative = resolved.slice(parsed.root.length);
  let cursor = parsed.root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (cause) {
      if (cause?.code === "ENOENT") break;
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        `artifact store path component could not be inspected: ${cursor}`,
        { cause },
      );
    }
    assertDirectory(stat, `artifact store path component ${cursor}`);
  }
}

function inspectPhysicalDirectory(directory, label) {
  let stat;
  let realPath;
  try {
    stat = fs.lstatSync(directory);
    assertDirectory(stat, label);
    realPath = fs.realpathSync(directory);
  } catch (cause) {
    if (isEvolutionArtifactPortError(cause)) throw cause;
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      `${label} could not be physically resolved`,
      { cause },
    );
  }
  if (!samePath(realPath, directory)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      `${label} or one of its ancestors is a symlink or replaced path`,
    );
  }
  return Object.freeze({
    identity: physicalIdentity(stat),
    realPath: path.resolve(realPath),
  });
}

function inspectPhysicalIndex(indexPath, rootRealPath) {
  let pathStat;
  let realPath;
  let descriptor = null;
  try {
    pathStat = fs.lstatSync(indexPath);
    assertRegularSingleLink(pathStat, "ArtifactStore index");
    realPath = fs.realpathSync(indexPath);
    if (
      !samePath(realPath, indexPath) ||
      !isContained(rootRealPath, realPath)
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index path is not physically contained in its root",
      );
    }
    descriptor = fs.openSync(
      indexPath,
      fs.constants.O_RDONLY | Number(fs.constants.O_NOFOLLOW || 0),
    );
    const descriptorStat = fs.fstatSync(descriptor);
    assertRegularSingleLink(descriptorStat, "ArtifactStore index descriptor");
    if (!sameFileIdentity(pathStat, descriptorStat)) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index pathname and descriptor identities differ",
      );
    }
  } catch (cause) {
    if (isEvolutionArtifactPortError(cause)) throw cause;
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "ArtifactStore index could not be physically captured",
      { cause },
    );
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  return Object.freeze({
    identity: physicalIdentity(pathStat),
    realPath: path.resolve(realPath),
  });
}

function establishStoreLayout(directory) {
  const rootDir = path.resolve(directory);
  const filesDir = path.join(rootDir, "files");
  const indexPath = path.join(rootDir, "index.jsonl");
  assertExistingPathComponentsArePhysical(rootDir);
  try {
    fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    assertExistingPathComponentsArePhysical(rootDir);
    fs.mkdirSync(filesDir, { mode: 0o700 });
  } catch (cause) {
    if (cause?.code !== "EEXIST") {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore root could not be initialized safely",
        { cause },
      );
    }
  }
  const root = inspectPhysicalDirectory(rootDir, "ArtifactStore root");
  const files = inspectPhysicalDirectory(filesDir, "ArtifactStore files root");
  if (!isContained(root.realPath, files.realPath)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "ArtifactStore files root escapes the captured store root",
    );
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      indexPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        Number(fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.fsyncSync(descriptor);
  } catch (cause) {
    if (cause?.code !== "EEXIST") {
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore index could not be initialized safely",
        { cause },
      );
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  const index = inspectPhysicalIndex(indexPath, root.realPath);
  return Object.freeze({
    filesDir,
    filesIdentity: files.identity,
    filesRealPath: files.realPath,
    indexIdentity: index.identity,
    indexPath,
    indexRealPath: index.realPath,
    rootDir,
    rootIdentity: root.identity,
    rootRealPath: root.realPath,
  });
}

function attestCapturedDirectory(directory, realPath, identity, label) {
  const inspected = inspectPhysicalDirectory(directory, label);
  if (
    !samePath(inspected.realPath, realPath) ||
    inspected.identity.dev !== identity.dev ||
    inspected.identity.ino !== identity.ino ||
    inspected.identity.birthtimeMs !== identity.birthtimeMs
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      `${label} physical identity changed`,
    );
  }
}

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function assertRegularSingleLink(stat, label) {
  if (
    !stat ||
    typeof stat.isFile !== "function" ||
    !stat.isFile() ||
    (typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) ||
    (Number.isFinite(Number(stat.nlink)) && Number(stat.nlink) !== 1)
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      `${label} must be a regular, non-symlink, single-link file`,
    );
  }
}

function attestStoreDirectories(layout) {
  attestCapturedDirectory(
    layout.rootDir,
    layout.rootRealPath,
    layout.rootIdentity,
    "ArtifactStore root",
  );
  attestCapturedDirectory(
    layout.filesDir,
    layout.filesRealPath,
    layout.filesIdentity,
    "ArtifactStore files root",
  );
  if (!isContained(layout.rootRealPath, layout.filesRealPath)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "captured ArtifactStore files root escapes its store root",
    );
  }
}

function indexEntriesFingerprint(entries, label) {
  assertDenseDataArray(entries, label, EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES);
  const hash = crypto.createHash("sha256");
  hash.update(`${entries.length}\0`, "utf8");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = ownData(entries, String(index), label);
    rejectProxy(entry, `${label}[${index}]`);
    const canonical = canonicalJson(entry, MAX_INDEX_ENTRY_BYTES);
    hash.update(`${Buffer.byteLength(canonical, "utf8")}:`, "utf8");
    hash.update(canonical, "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

function parseTrustedIndexBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "ArtifactStore index snapshot is not a Buffer",
    );
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "ArtifactStore index is not exact UTF-8",
    );
  }
  if (text === "") {
    return Object.freeze({
      entries: Object.freeze([]),
      entriesFingerprint: indexEntriesFingerprint(
        [],
        "trusted ArtifactStore index entries",
      ),
    });
  }
  if (!text.endsWith("\n")) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "ArtifactStore index must end at a complete JSONL record",
    );
  }
  const lines = text.slice(0, -1).split("\n");
  if (
    lines.length > EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES ||
    lines.some(
      (line) =>
        line.length < 2 ||
        Buffer.byteLength(line, "utf8") > MAX_INDEX_ENTRY_BYTES,
    )
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
      "ArtifactStore index exceeds its trusted snapshot limits",
    );
  }
  const entries = [];
  for (const [index, line] of lines.entries()) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (cause) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        `ArtifactStore index row ${index} is not JSON`,
        { cause },
      );
    }
    if (
      !isPlainRecord(
        entry,
        `ArtifactStore index row ${index}`,
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      ) ||
      JSON.stringify(entry) !== line
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        `ArtifactStore index row ${index} is not exact single-record JSON`,
      );
    }
    const id = ownData(entry, "id", `ArtifactStore index row ${index}`);
    if (typeof id !== "string" || id.length < 1 || id.length > 256) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        `ArtifactStore index row ${index} has an invalid id`,
      );
    }
    entries.push(entry);
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    entriesFingerprint: indexEntriesFingerprint(
      entries,
      "trusted ArtifactStore index entries",
    ),
  });
}

function readTrustedIndexSnapshot(layout) {
  attestStoreDirectories(layout);
  let beforePathStat;
  let beforeDescriptorStat;
  let afterDescriptorStat;
  let descriptor = null;
  let bytes;
  let indexRealPath;
  try {
    beforePathStat = fs.lstatSync(layout.indexPath);
    assertRegularSingleLink(beforePathStat, "ArtifactStore index");
    if (!samePhysicalIdentity(beforePathStat, layout.indexIdentity)) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index physical identity changed",
      );
    }
    indexRealPath = fs.realpathSync(layout.indexPath);
    if (
      !samePath(indexRealPath, layout.indexRealPath) ||
      !samePath(indexRealPath, layout.indexPath) ||
      !isContained(layout.rootRealPath, indexRealPath)
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index realpath changed or escaped its root",
      );
    }
    descriptor = fs.openSync(
      layout.indexPath,
      fs.constants.O_RDONLY | Number(fs.constants.O_NOFOLLOW || 0),
    );
    beforeDescriptorStat = fs.fstatSync(descriptor);
    assertRegularSingleLink(
      beforeDescriptorStat,
      "ArtifactStore index descriptor",
    );
    if (
      !sameFileIdentity(beforePathStat, beforeDescriptorStat) ||
      beforeDescriptorStat.size > EVOLUTION_ARTIFACT_MAX_INDEX_BYTES
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index descriptor is replaced or oversized",
      );
    }
    bytes = fs.readFileSync(descriptor);
    afterDescriptorStat = fs.fstatSync(descriptor);
    if (
      !sameFileIdentity(beforeDescriptorStat, afterDescriptorStat) ||
      bytes.length !== beforeDescriptorStat.size
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index changed while its descriptor was read",
      );
    }
  } catch (cause) {
    if (isEvolutionArtifactPortError(cause)) throw cause;
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "ArtifactStore index could not be read from a trusted descriptor",
      { cause },
    );
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
  let afterPathStat;
  try {
    afterPathStat = fs.lstatSync(layout.indexPath);
    assertRegularSingleLink(afterPathStat, "ArtifactStore index");
    if (
      !sameFileIdentity(beforePathStat, afterPathStat) ||
      !samePhysicalIdentity(afterPathStat, layout.indexIdentity) ||
      !samePath(fs.realpathSync(layout.indexPath), indexRealPath)
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index pathname changed during descriptor read",
      );
    }
  } catch (cause) {
    if (isEvolutionArtifactPortError(cause)) throw cause;
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "ArtifactStore index could not be re-attested after descriptor read",
      { cause },
    );
  }
  attestStoreDirectories(layout);
  const parsed = parseTrustedIndexBytes(bytes);
  return Object.freeze({
    bytesDigest: sha256(bytes),
    entries: parsed.entries,
    entriesFingerprint: parsed.entriesFingerprint,
  });
}

function validateIntegrityResult(value, expectedHex) {
  assertExactRecord(
    value,
    INTEGRITY_RESULT_KEYS,
    "artifact integrity result",
    EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
  );
  if (
    ownData(value, "ok", "artifact integrity result") !== true ||
    ownData(value, "reason", "artifact integrity result") !== "ok" ||
    ownData(value, "expectedSha256", "artifact integrity result") !==
      expectedHex ||
    ownData(value, "actualSha256", "artifact integrity result") !== expectedHex
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "ArtifactStore integrity verification failed",
    );
  }
}

function parseCanonicalEnvelope(envelope) {
  if (
    typeof envelope !== "string" ||
    Buffer.byteLength(envelope, "utf8") >
      EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES ||
    envelope.length < 2
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact envelope is missing or oversized",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(envelope);
  } catch (cause) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact envelope is not JSON",
      { cause },
    );
  }
  let canonical;
  try {
    canonical = canonicalJson(parsed, EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES);
  } catch (cause) {
    if (isEvolutionArtifactPortError(cause)) throw cause;
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact envelope is not canonical JSON",
      { cause },
    );
  }
  if (canonical !== envelope) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact envelope must use exact canonical JSON bytes",
    );
  }
  assertExactRecord(parsed, ENVELOPE_KEYS, "artifact envelope");
  if (
    ownData(parsed, "schema", "artifact envelope") !==
    EVOLUTION_ARTIFACT_ENVELOPE_SCHEMA
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact envelope schema is unsupported",
    );
  }
  const core = ownData(parsed, "core", "artifact envelope");
  const signature = ownData(parsed, "signature", "artifact envelope");
  assertExactRecord(core, ENVELOPE_CORE_KEYS, "artifact envelope core");
  assertExactRecord(signature, SIGNATURE_KEYS, "artifact envelope signature");
  return {
    parsed,
    core,
    signature,
    envelopeDigest: sha256(Buffer.from(envelope, "utf8")),
  };
}

function validateEnvelopeCore(core, signature, allowedTypes) {
  if (
    ownData(core, "schema", "artifact envelope core") !==
    EVOLUTION_ARTIFACT_ENVELOPE_CORE_SCHEMA
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact envelope core schema is unsupported",
    );
  }
  const retention = normalizeRetention(
    ownData(core, "retention", "artifact envelope core"),
    "artifact envelope retention",
  );
  const rawExpiresAt = ownData(core, "expiresAt", "artifact envelope core");
  if (retention === "ledger" && rawExpiresAt !== null) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "ledger-retained artifact envelopes must not carry an expiresAt authority",
    );
  }
  const normalized = {
    algorithm: normalizeAlgorithm(
      ownData(core, "algorithm", "artifact envelope core"),
      "artifact envelope algorithm",
    ),
    audience: normalizeSafeId(
      ownData(core, "audience", "artifact envelope core"),
      "artifact envelope audience",
    ),
    authorityReceiptDigest: normalizeDigest(
      ownData(core, "authorityReceiptDigest", "artifact envelope core"),
      "artifact envelope authorityReceiptDigest",
    ),
    digest: normalizeDigest(
      ownData(core, "digest", "artifact envelope core"),
      "artifact envelope digest",
    ),
    expiresAt:
      retention === "ledger"
        ? null
        : normalizeTimestamp(rawExpiresAt, "artifact envelope expiresAt"),
    issuedAt: normalizeTimestamp(
      ownData(core, "issuedAt", "artifact envelope core"),
      "artifact envelope issuedAt",
    ),
    keyId: normalizeKeyId(
      ownData(core, "keyId", "artifact envelope core"),
      "artifact envelope keyId",
    ),
    policyDigest: normalizeDigest(
      ownData(core, "policyDigest", "artifact envelope core"),
      "artifact envelope policyDigest",
    ),
    policyRevision: normalizeRevision(
      ownData(core, "policyRevision", "artifact envelope core"),
      "artifact envelope policyRevision",
    ),
    purpose: normalizeSafeId(
      ownData(core, "purpose", "artifact envelope core"),
      "artifact envelope purpose",
    ),
    recordDigest: normalizeDigest(
      ownData(core, "recordDigest", "artifact envelope core"),
      "artifact envelope recordDigest",
    ),
    retention,
    revocationRevision: normalizeRevision(
      ownData(core, "revocationRevision", "artifact envelope core"),
      "artifact envelope revocationRevision",
    ),
    schema: EVOLUTION_ARTIFACT_ENVELOPE_CORE_SCHEMA,
    tenantId: normalizeSafeId(
      ownData(core, "tenantId", "artifact envelope core"),
      "artifact envelope tenantId",
    ),
    type: normalizeType(
      ownData(core, "type", "artifact envelope core"),
      allowedTypes,
    ),
  };
  if (normalized.digest !== normalized.recordDigest) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      "artifact envelope digest and recordDigest must match exactly",
    );
  }
  if (retention === "ledger") {
    assertLedgerRetentionAdmission(normalized.type, normalized.purpose);
  }
  const issuedAtMs = new Date(normalized.issuedAt).getTime();
  const expiresAtMs =
    normalized.expiresAt === null
      ? null
      : new Date(normalized.expiresAt).getTime();
  if (
    retention === "ttl" &&
    (expiresAtMs <= issuedAtMs ||
      expiresAtMs - issuedAtMs > EVOLUTION_ARTIFACT_MAX_TTL_MS)
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_EXPIRED_CODE,
      "artifact envelope TTL is invalid or exceeds the maximum",
    );
  }
  const signatureAlgorithm = normalizeAlgorithm(
    ownData(signature, "algorithm", "artifact envelope signature"),
    "artifact envelope signature algorithm",
  );
  const signatureKeyId = normalizeKeyId(
    ownData(signature, "keyId", "artifact envelope signature"),
    "artifact envelope signature keyId",
  );
  const signatureValue = ownData(
    signature,
    "value",
    "artifact envelope signature",
  );
  if (
    signatureAlgorithm !== normalized.algorithm ||
    signatureKeyId !== normalized.keyId ||
    typeof signatureValue !== "string" ||
    !SIGNATURE_VALUE_PATTERN.test(signatureValue)
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
      "artifact envelope signature header is not bound to its core",
    );
  }
  return deepFreeze({
    ...normalized,
    issuedAtMs,
    expiresAtMs,
    signature: {
      algorithm: signatureAlgorithm,
      keyId: signatureKeyId,
      value: signatureValue,
    },
  });
}

function normalizePutContext(value, audience, type) {
  const context = value === undefined ? {} : value;
  assertOptionalExactRecord(
    context,
    PUT_CONTEXT_KEYS,
    new Set(["purpose"]),
    "artifact put context",
  );
  const suppliedAudience = Object.hasOwn(context, "audience")
    ? ownData(context, "audience", "artifact put context")
    : audience;
  if (normalizeSafeId(suppliedAudience, "artifact audience") !== audience) {
    throw artifactError(
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
      "artifact audience does not match the captured audience",
    );
  }
  const purpose = normalizeSafeId(
    ownData(context, "purpose", "artifact put context"),
    "artifact purpose",
  );
  const retention = Object.hasOwn(context, "retention")
    ? normalizeRetention(
        ownData(context, "retention", "artifact put context"),
        "artifact retention",
      )
    : "ttl";
  const hasTtl = Object.hasOwn(context, "ttlMs");
  if (retention === "ledger") {
    if (hasTtl) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INVALID_CODE,
        "ledger retention must not be combined with caller-controlled ttlMs",
      );
    }
    assertLedgerRetentionAdmission(type, purpose);
    return Object.freeze({ audience, purpose, retention, ttlMs: null });
  }
  const ttlMs = hasTtl
    ? ownData(context, "ttlMs", "artifact put context")
    : EVOLUTION_ARTIFACT_DEFAULT_TTL_MS;
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > EVOLUTION_ARTIFACT_MAX_TTL_MS
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      `artifact ttlMs must be between 1 and ${EVOLUTION_ARTIFACT_MAX_TTL_MS}`,
    );
  }
  return Object.freeze({ audience, purpose, retention, ttlMs });
}

function normalizeResolveOptions(value, tenantId, audience, allowedTypes) {
  assertExactRecord(value, RESOLVE_OPTION_KEYS, "artifact resolve options");
  const requestedTenant = normalizeSafeId(
    ownData(value, "tenantId", "artifact resolve options"),
    "artifact resolve tenantId",
  );
  if (requestedTenant !== tenantId) {
    throw artifactError(
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
      "cross-tenant artifact resolution is denied",
    );
  }
  return Object.freeze({
    audience,
    expectedDigest: normalizeDigest(
      ownData(value, "expectedDigest", "artifact resolve options"),
      "artifact expectedDigest",
    ),
    expectedType: normalizeType(
      ownData(value, "expectedType", "artifact resolve options"),
      allowedTypes,
    ),
    purpose: normalizeSafeId(
      ownData(value, "purpose", "artifact resolve options"),
      "artifact resolve purpose",
    ),
    tenantId,
  });
}

function normalizeSignature(value, authority) {
  assertExactRecord(
    value,
    SIGNATURE_KEYS,
    "artifact signer response",
    EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
  );
  const signature = {
    algorithm: normalizeAlgorithm(
      ownData(value, "algorithm", "artifact signer response"),
      "artifact signer algorithm",
    ),
    keyId: normalizeKeyId(
      ownData(value, "keyId", "artifact signer response"),
      "artifact signer keyId",
    ),
    value: ownData(value, "value", "artifact signer response"),
  };
  if (
    signature.algorithm !== authority.algorithm ||
    signature.keyId !== authority.keyId ||
    typeof signature.value !== "string" ||
    !SIGNATURE_VALUE_PATTERN.test(signature.value)
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
      "artifact signer response is not bound to current authority",
    );
  }
  return deepFreeze(signature);
}

function normalizeArtifactRef(value) {
  assertExactRecord(value, ARTIFACT_REF_KEYS, "evolution artifact ref");
  if (
    ownData(value, "schema", "evolution artifact ref") !==
    EVOLUTION_ARTIFACT_REF_SCHEMA
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact ref schema is unsupported",
    );
  }
  const digest = normalizeDigest(
    ownData(value, "digest", "evolution artifact ref"),
    "evolution artifact ref digest",
  );
  const ref = ownData(value, "ref", "evolution artifact ref");
  if (
    typeof ref !== "string" ||
    ref.length > 2048 ||
    !ref.startsWith(ARTIFACT_REF_PREFIX)
  ) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact ref is not a supported short locator",
    );
  }
  const artifactId = ref.slice(ARTIFACT_REF_PREFIX.length);
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw artifactError(
      EVOLUTION_ARTIFACT_INVALID_CODE,
      "evolution artifact ref contains an invalid ArtifactStore id",
    );
  }
  return Object.freeze({ digest, ref, artifactId });
}

function buildArtifactRef(artifactId, digest) {
  return deepFreeze({
    digest,
    ref: `${ARTIFACT_REF_PREFIX}${artifactId}`,
    schema: EVOLUTION_ARTIFACT_REF_SCHEMA,
  });
}

function validateAllowedTypes(value) {
  assertDenseDataArray(value, "allowedTypes", EVOLUTION_ARTIFACT_TYPES.length);
  if (value.length < 1) {
    throw new TypeError(
      "EvolutionArtifactPorts allowedTypes must not be empty",
    );
  }
  const productTypes = new Set(EVOLUTION_ARTIFACT_TYPES);
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const type = ownData(value, String(index), "allowedTypes");
    if (
      typeof type !== "string" ||
      !TYPE_PATTERN.test(type) ||
      !productTypes.has(type)
    ) {
      throw new TypeError(
        "EvolutionArtifactPorts allowedTypes may only narrow the product allow-list",
      );
    }
    normalized.push(type);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(
      "EvolutionArtifactPorts allowedTypes contains duplicates",
    );
  }
  return new Set(normalized);
}

export class EvolutionArtifactPorts {
  #tenantId;
  #audience;
  #allowedTypes;
  #store;
  #signEnvelope;
  #verifyEnvelope;
  #resolveCurrentAuthority;
  #now;

  constructor(options = {}) {
    assertOptionalExactRecord(
      options,
      CONSTRUCTOR_OPTION_KEYS,
      CONSTRUCTOR_REQUIRED_KEYS,
      "EvolutionArtifactPorts constructor options",
    );
    const tenantId = ownData(
      options,
      "tenantId",
      "EvolutionArtifactPorts constructor options",
    );
    const audience = ownData(
      options,
      "audience",
      "EvolutionArtifactPorts constructor options",
    );
    const artifactStore = ownData(
      options,
      "artifactStore",
      "EvolutionArtifactPorts constructor options",
    );
    const envelopeSigner = ownData(
      options,
      "envelopeSigner",
      "EvolutionArtifactPorts constructor options",
    );
    const envelopeVerifier = ownData(
      options,
      "envelopeVerifier",
      "EvolutionArtifactPorts constructor options",
    );
    const currentAuthorityResolver = ownData(
      options,
      "currentAuthorityResolver",
      "EvolutionArtifactPorts constructor options",
    );
    const allowedTypes = Object.hasOwn(options, "allowedTypes")
      ? ownData(
          options,
          "allowedTypes",
          "EvolutionArtifactPorts constructor options",
        )
      : EVOLUTION_ARTIFACT_TYPES;
    const now = Object.hasOwn(options, "now")
      ? ownData(options, "now", "EvolutionArtifactPorts constructor options")
      : Date.now;
    this.#tenantId = normalizeSafeId(tenantId, "tenantId");
    this.#audience = normalizeSafeId(audience, "audience");
    this.#allowedTypes = validateAllowedTypes(allowedTypes);
    this.#store = captureArtifactStore(artifactStore);
    this.#signEnvelope = captureMethod(
      envelopeSigner,
      "sign",
      "envelopeSigner",
    );
    this.#verifyEnvelope = captureMethod(
      envelopeVerifier,
      "verify",
      "envelopeVerifier",
    );
    this.#resolveCurrentAuthority = captureMethod(
      currentAuthorityResolver,
      "resolve",
      "currentAuthorityResolver",
    );
    rejectProxy(now, "EvolutionArtifactPorts clock");
    if (typeof now !== "function") {
      throw new TypeError("EvolutionArtifactPorts now must be a function");
    }
    this.#now = Object.freeze((...args) => now(...args));
    Object.freeze(this);
  }

  #clock() {
    return normalizeClockValue(this.#now());
  }

  #boundedIndexEntries() {
    const trustedBefore = readTrustedIndexSnapshot(this.#store.layout);
    let entries;
    try {
      entries = rejectPromise(
        this.#store.list(),
        "ArtifactStore.list",
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
      );
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore index could not be read",
        { cause },
      );
    }
    rejectProxy(
      entries,
      "ArtifactStore.list result",
      EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
    );
    if (!Array.isArray(entries)) {
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore.list did not return an array",
      );
    }
    // ArtifactStore currently materializes its whole JSONL index before this
    // adapter can enforce a limit. Reject immediately after return; this is an
    // explicit scalability boundary, not a claim of bounded store-side query.
    if (entries.length > EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES) {
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        `ArtifactStore index exceeds the adapter limit of ${EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES}`,
      );
    }
    assertDenseDataArray(
      entries,
      "ArtifactStore index entries",
      EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES,
    );
    let storeFingerprint;
    try {
      storeFingerprint = indexEntriesFingerprint(
        entries,
        "ArtifactStore.list entries",
      );
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore.list entries could not be canonicalized",
        { cause },
      );
    }
    const trustedAfter = readTrustedIndexSnapshot(this.#store.layout);
    if (
      trustedBefore.bytesDigest !== trustedAfter.bytesDigest ||
      trustedBefore.entriesFingerprint !== trustedAfter.entriesFingerprint ||
      storeFingerprint !== trustedAfter.entriesFingerprint
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore.list is not exactly bound to one trusted index snapshot",
      );
    }
    return entries;
  }

  #entriesByDataField(entries, field, expected) {
    const matches = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = ownData(
        entries,
        String(index),
        "ArtifactStore index entries",
      );
      if (!entry || typeof entry !== "object") continue;
      rejectProxy(
        entry,
        `ArtifactStore index entry ${index}`,
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
      );
      if (Array.isArray(entry)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(entry, field);
      if (!descriptor) continue;
      if (!("value" in descriptor) || descriptor.enumerable !== true) {
        throw artifactError(
          EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
          `ArtifactStore index ${field} must be an enumerable data property`,
        );
      }
      if (descriptor.value === expected) matches.push(entry);
    }
    return matches;
  }

  #loadCurrentEntryById(artifactId) {
    const listed = this.#entriesByDataField(
      this.#boundedIndexEntries(),
      "id",
      artifactId,
    );
    if (listed.length === 0) {
      throw artifactError(
        EVOLUTION_ARTIFACT_NOT_FOUND_CODE,
        "evolution artifact index entry was removed or expired",
        { artifactId },
      );
    }
    if (listed.length !== 1) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "evolution artifact id has duplicate index rows",
        { artifactId },
      );
    }
    let current;
    try {
      current = rejectPromise(
        this.#store.get(artifactId),
        "ArtifactStore.get",
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
      );
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore entry could not be re-read",
        { cause, artifactId },
      );
    }
    if (!current) {
      throw artifactError(
        EVOLUTION_ARTIFACT_NOT_FOUND_CODE,
        "evolution artifact index entry disappeared during readback",
        { artifactId },
      );
    }
    const listedCanonical = canonicalJson(listed[0]);
    const currentCanonical = canonicalJson(current);
    if (listedCanonical !== currentCanonical) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index generation changed during readback",
        { artifactId },
      );
    }
    const afterGet = this.#entriesByDataField(
      this.#boundedIndexEntries(),
      "id",
      artifactId,
    );
    if (
      afterGet.length !== 1 ||
      canonicalJson(afterGet[0]) !== currentCanonical
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore.get is not bound to the trusted index snapshot",
        { artifactId },
      );
    }
    return current;
  }

  #assertEntryStable(artifactId, original) {
    const current = this.#loadCurrentEntryById(artifactId);
    if (canonicalJson(current) !== canonicalJson(original)) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index entry was replaced during readback",
        { artifactId },
      );
    }
  }

  #assertUniqueRecordDigest(recordDigest, artifactId) {
    const matches = this.#entriesByDataField(
      this.#boundedIndexEntries(),
      "recordDigest",
      recordDigest,
    );
    if (matches.length !== 1) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "recordDigest must have exactly one ArtifactStore index row",
      );
    }
    rejectProxy(
      matches[0],
      "ArtifactStore recordDigest match",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const matchedId = Object.getOwnPropertyDescriptor(matches[0], "id");
    if (
      !matchedId ||
      !("value" in matchedId) ||
      matchedId.enumerable !== true ||
      matchedId.value !== artifactId
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "recordDigest index authority does not match the requested locator",
      );
    }
  }

  #validateLineage(value, envelope, core, envelopeDigest) {
    assertExactRecord(
      value,
      LINEAGE_KEYS,
      "artifact lineage",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const expected = {
      audience: core.audience,
      envelope,
      envelopeDigest,
      purpose: core.purpose,
      recordDigest: core.recordDigest,
      retention: core.retention,
      schema: EVOLUTION_ARTIFACT_LINEAGE_SCHEMA,
      tenantId: core.tenantId,
      type: core.type,
    };
    if (canonicalJson(value) !== canonicalJson(expected)) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "artifact lineage is not exactly bound to the signed envelope",
      );
    }
    return deepFreeze(expected);
  }

  #validateIndexEntry(entry, envelope, core, envelopeDigest) {
    assertExactRecord(
      entry,
      INDEX_ENTRY_KEYS,
      "ArtifactStore index entry",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const id = ownData(entry, "id", "ArtifactStore index entry");
    if (!ARTIFACT_ID_PATTERN.test(id || "")) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore id is invalid",
      );
    }
    const file = ownData(entry, "file", "ArtifactStore index entry");
    const size = ownData(entry, "size", "ArtifactStore index entry");
    const createdAt = normalizeTimestamp(
      ownData(entry, "createdAt", "ArtifactStore index entry"),
      "ArtifactStore createdAt",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const expiresAt = normalizeTimestamp(
      ownData(entry, "expiresAt", "ArtifactStore index entry"),
      "ArtifactStore expiresAt",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const createdAtMs = new Date(createdAt).getTime();
    const storeExpiresAtMs = new Date(expiresAt).getTime();
    const storeRetentionIsAdmissible =
      core.retention === "ledger"
        ? storeExpiresAtMs - createdAtMs ===
          LEDGER_HOUSEKEEPING_TTL_DAYS * MILLISECONDS_PER_DAY
        : storeExpiresAtMs >= core.expiresAtMs;
    if (
      file !== `${id}.json` ||
      path.basename(file) !== file ||
      ownData(entry, "title", "ArtifactStore index entry") !==
        `Evolution ${core.type} artifact` ||
      ownData(entry, "kind", "ArtifactStore index entry") !== "data" ||
      ownData(entry, "mime", "ArtifactStore index entry") !==
        "application/json" ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES ||
      ownData(entry, "sha256", "ArtifactStore index entry") !==
        core.recordDigest.slice("sha256:".length) ||
      ownData(entry, "sourcePath", "ArtifactStore index entry") !== null ||
      ownData(entry, "sessionId", "ArtifactStore index entry") !== null ||
      ownData(entry, "immutable", "ArtifactStore index entry") !== true ||
      ownData(entry, "recordDigest", "ArtifactStore index entry") !==
        core.recordDigest ||
      storeExpiresAtMs <= createdAtMs ||
      createdAtMs < core.issuedAtMs ||
      !storeRetentionIsAdmissible
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore index entry is not exactly admissible for this envelope",
        { artifactId: id },
      );
    }
    const lineage = this.#validateLineage(
      ownData(entry, "lineage", "ArtifactStore index entry"),
      envelope,
      core,
      envelopeDigest,
    );
    return Object.freeze({ createdAt, expiresAt, file, id, lineage, size });
  }

  #readStoredBytes(entry, normalizedEntry, expectedDigest) {
    attestStoreDirectories(this.#store.layout);
    const expectedHex = expectedDigest.slice("sha256:".length);
    let storedPath;
    try {
      storedPath = this.#store.storedPath(entry);
    } catch (cause) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore stored path could not be resolved",
        { cause },
      );
    }
    if (typeof storedPath !== "string") {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore stored path is unavailable",
      );
    }
    const filesRoot = this.#store.layout.filesDir;
    const expectedPath = path.resolve(filesRoot, normalizedEntry.file);
    const resolvedStoredPath = path.resolve(storedPath);
    if (
      !samePath(expectedPath, resolvedStoredPath) ||
      !isContained(filesRoot, resolvedStoredPath)
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore stored path escapes the captured files root",
      );
    }

    let integrityBefore;
    try {
      integrityBefore = this.#store.verifyIntegrity(entry);
    } catch (cause) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore integrity verification threw",
        { cause },
      );
    }
    validateIntegrityResult(integrityBefore, expectedHex);

    let rootRealPath;
    let beforePathStat;
    let targetRealPath;
    let descriptor = null;
    let beforeDescriptorStat;
    let afterDescriptorStat;
    let bytes;
    try {
      rootRealPath = fs.realpathSync(filesRoot);
      if (!samePath(rootRealPath, this.#store.layout.filesRealPath)) {
        throw artifactError(
          EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
          "ArtifactStore files root physical identity changed before byte read",
        );
      }
      beforePathStat = fs.lstatSync(resolvedStoredPath);
      assertRegularSingleLink(beforePathStat, "stored artifact path");
      targetRealPath = fs.realpathSync(resolvedStoredPath);
      if (!isContained(rootRealPath, targetRealPath)) {
        throw artifactError(
          EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
          "stored artifact realpath escapes the captured files root",
        );
      }
      descriptor = fs.openSync(
        resolvedStoredPath,
        fs.constants.O_RDONLY | Number(fs.constants.O_NOFOLLOW || 0),
      );
      beforeDescriptorStat = fs.fstatSync(descriptor);
      assertRegularSingleLink(
        beforeDescriptorStat,
        "stored artifact descriptor",
      );
      if (!sameFileIdentity(beforePathStat, beforeDescriptorStat)) {
        throw artifactError(
          EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
          "stored artifact pathname and descriptor identities differ",
        );
      }
      bytes = fs.readFileSync(descriptor);
      afterDescriptorStat = fs.fstatSync(descriptor);
      if (!sameFileIdentity(beforeDescriptorStat, afterDescriptorStat)) {
        throw artifactError(
          EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
          "stored artifact changed while it was read",
        );
      }
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "stored artifact could not be opened safely",
        { cause },
      );
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
    let afterPathStat;
    try {
      afterPathStat = fs.lstatSync(resolvedStoredPath);
      assertRegularSingleLink(afterPathStat, "stored artifact path");
      if (!sameFileIdentity(beforePathStat, afterPathStat)) {
        throw artifactError(
          EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
          "stored artifact pathname changed during readback",
        );
      }
      const afterRealPath = fs.realpathSync(resolvedStoredPath);
      if (!samePath(targetRealPath, afterRealPath)) {
        throw artifactError(
          EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
          "stored artifact realpath changed during readback",
        );
      }
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "stored artifact could not be re-attested",
        { cause },
      );
    }
    if (
      bytes.length !== normalizedEntry.size ||
      sha256(bytes) !== expectedDigest
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "stored artifact bytes do not match the signed recordDigest",
      );
    }
    let integrityAfter;
    try {
      integrityAfter = this.#store.verifyIntegrity(entry);
    } catch (cause) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore post-read integrity verification threw",
        { cause },
      );
    }
    validateIntegrityResult(integrityAfter, expectedHex);
    attestStoreDirectories(this.#store.layout);
    return bytes;
  }

  #parseRecordBytes(bytes, core) {
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "artifact bytes are not exact UTF-8",
      );
    }
    let record;
    try {
      record = JSON.parse(text);
    } catch (cause) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "artifact bytes are not JSON",
        { cause },
      );
    }
    if (canonicalJson(record) !== text) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "artifact bytes are not exact canonical JSON",
      );
    }
    assertExactRecord(
      record,
      RECORD_KEYS,
      "durable evolution artifact record",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    if (
      ownData(record, "schema", "durable evolution artifact record") !==
        EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      ownData(record, "tenantId", "durable evolution artifact record") !==
        core.tenantId ||
      ownData(record, "audience", "durable evolution artifact record") !==
        core.audience ||
      ownData(record, "purpose", "durable evolution artifact record") !==
        core.purpose ||
      ownData(record, "retention", "durable evolution artifact record") !==
        core.retention ||
      ownData(record, "type", "durable evolution artifact record") !== core.type
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "artifact record context does not match the signed envelope",
      );
    }
    return deepFreeze(record);
  }

  #authorityRequest({
    action,
    digest,
    type,
    purpose,
    retention,
    keyId,
    issuedAt,
    issuedPolicyDigest,
    issuedPolicyRevision,
    clock,
  }) {
    return deepFreeze({
      action,
      audience: this.#audience,
      digest,
      issuedAt,
      issuedPolicyDigest,
      issuedPolicyRevision,
      keyId,
      purpose,
      requestedAt: clock.iso,
      retention,
      schema: EVOLUTION_ARTIFACT_AUTHORITY_REQUEST_SCHEMA,
      tenantId: this.#tenantId,
      type,
    });
  }

  #currentAuthority({
    action,
    digest,
    type,
    purpose,
    retention,
    keyId = null,
    issuedAt = null,
    issuedPolicyDigest = null,
    issuedPolicyRevision = null,
  }) {
    const requestClock = this.#clock();
    const request = this.#authorityRequest({
      action,
      digest,
      type,
      purpose,
      retention,
      keyId,
      issuedAt,
      issuedPolicyDigest,
      issuedPolicyRevision,
      clock: requestClock,
    });
    let value;
    try {
      value = rejectPromise(
        this.#resolveCurrentAuthority(request),
        "currentAuthorityResolver.resolve",
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
      );
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
        "current artifact authority could not be resolved",
        { cause },
      );
    }
    const responseClock = this.#clock();
    if (responseClock.milliseconds < requestClock.milliseconds) {
      throw artifactError(
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
        "artifact authority clock moved backwards",
      );
    }
    assertExactRecord(
      value,
      AUTHORITY_DECISION_KEYS,
      "current artifact authority decision",
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
    );
    const decisionCore = { ...value };
    delete decisionCore.receiptDigest;
    const checkedAt = normalizeTimestamp(
      ownData(value, "checkedAt", "current artifact authority decision"),
      "authority checkedAt",
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
    );
    const decisionExpiresAt = normalizeTimestamp(
      ownData(
        value,
        "decisionExpiresAt",
        "current artifact authority decision",
      ),
      "authority decisionExpiresAt",
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
    );
    const requestedAt = normalizeTimestamp(
      ownData(value, "requestedAt", "current artifact authority decision"),
      "authority requestedAt",
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
    );
    const checkedAtMs = new Date(checkedAt).getTime();
    const decisionExpiresAtMs = new Date(decisionExpiresAt).getTime();
    const receiptDigest = normalizeDigest(
      ownData(value, "receiptDigest", "current artifact authority decision"),
      "authority receiptDigest",
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
    );
    const normalized = {
      action: ownData(value, "action", "current artifact authority decision"),
      algorithm: normalizeAlgorithm(
        ownData(value, "algorithm", "current artifact authority decision"),
        "authority algorithm",
      ),
      allowed: ownData(value, "allowed", "current artifact authority decision"),
      audience: ownData(
        value,
        "audience",
        "current artifact authority decision",
      ),
      checkedAt,
      decisionExpiresAt,
      decisionExpiresAtMs,
      digest: ownData(value, "digest", "current artifact authority decision"),
      issuedAt: normalizeNullableTimestamp(
        ownData(value, "issuedAt", "current artifact authority decision"),
        "authority issuedAt",
      ),
      issuedPolicyDigest: normalizeNullableDigest(
        ownData(
          value,
          "issuedPolicyDigest",
          "current artifact authority decision",
        ),
        "authority issuedPolicyDigest",
      ),
      issuedPolicyRevision: normalizeNullableRevision(
        ownData(
          value,
          "issuedPolicyRevision",
          "current artifact authority decision",
        ),
        "authority issuedPolicyRevision",
      ),
      issuedPolicyTrusted: ownData(
        value,
        "issuedPolicyTrusted",
        "current artifact authority decision",
      ),
      keyId: normalizeKeyId(
        ownData(value, "keyId", "current artifact authority decision"),
        "authority keyId",
      ),
      policyDigest: normalizeDigest(
        ownData(value, "policyDigest", "current artifact authority decision"),
        "authority policyDigest",
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
      ),
      policyRevision: normalizeRevision(
        ownData(value, "policyRevision", "current artifact authority decision"),
        "authority policyRevision",
      ),
      purpose: ownData(value, "purpose", "current artifact authority decision"),
      receiptDigest,
      requestedAt,
      retention: normalizeRetention(
        ownData(value, "retention", "current artifact authority decision"),
        "authority retention",
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
      ),
      revocationRevision: normalizeRevision(
        ownData(
          value,
          "revocationRevision",
          "current artifact authority decision",
        ),
        "authority revocationRevision",
      ),
      revoked: ownData(value, "revoked", "current artifact authority decision"),
      tenantId: ownData(
        value,
        "tenantId",
        "current artifact authority decision",
      ),
      type: ownData(value, "type", "current artifact authority decision"),
    };
    if (
      ownData(value, "schema", "current artifact authority decision") !==
        EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA ||
      normalized.action !== action ||
      normalized.allowed !== true ||
      normalized.revoked !== false ||
      normalized.tenantId !== this.#tenantId ||
      normalized.audience !== this.#audience ||
      normalized.purpose !== purpose ||
      normalized.type !== type ||
      normalized.digest !== digest ||
      normalized.retention !== retention ||
      normalized.issuedAt !== issuedAt ||
      normalized.issuedPolicyDigest !== issuedPolicyDigest ||
      normalized.issuedPolicyRevision !== issuedPolicyRevision ||
      normalized.issuedPolicyTrusted !== true ||
      normalized.requestedAt !== request.requestedAt ||
      (keyId !== null && normalized.keyId !== keyId) ||
      checkedAtMs < requestClock.milliseconds ||
      checkedAtMs > responseClock.milliseconds ||
      decisionExpiresAtMs <= responseClock.milliseconds ||
      decisionExpiresAtMs - requestClock.milliseconds >
        MAX_AUTHORITY_DECISION_TTL_MS ||
      receiptDigest !== domainDigest(AUTHORITY_RECEIPT_DOMAIN, decisionCore)
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
        "current artifact authority denied or returned an unbound decision",
      );
    }
    return deepFreeze(normalized);
  }

  #sign(core, authority) {
    const coreJson = canonicalJson(core, EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES);
    const message = `${ENVELOPE_SIGNATURE_DOMAIN}${coreJson}`;
    const request = deepFreeze({
      algorithm: authority.algorithm,
      audience: core.audience,
      digest: core.digest,
      keyId: authority.keyId,
      message,
      messageDigest: sha256(Buffer.from(message, "utf8")),
      purpose: core.purpose,
      retention: core.retention,
      tenantId: core.tenantId,
      type: core.type,
    });
    let value;
    try {
      value = rejectPromise(
        this.#signEnvelope(request),
        "envelopeSigner.sign",
        EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
      );
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
        "evolution artifact envelope signing failed",
        { cause },
      );
    }
    return normalizeSignature(value, authority);
  }

  #verifySignature(envelope, parsed, normalizedCore) {
    const coreJson = canonicalJson(
      parsed.core,
      EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES,
    );
    const message = `${ENVELOPE_SIGNATURE_DOMAIN}${coreJson}`;
    const request = deepFreeze({
      algorithm: normalizedCore.algorithm,
      audience: normalizedCore.audience,
      digest: normalizedCore.digest,
      envelope,
      envelopeDigest: sha256(Buffer.from(envelope, "utf8")),
      keyId: normalizedCore.keyId,
      message,
      messageDigest: sha256(Buffer.from(message, "utf8")),
      purpose: normalizedCore.purpose,
      retention: normalizedCore.retention,
      signature: normalizedCore.signature,
      tenantId: normalizedCore.tenantId,
      type: normalizedCore.type,
    });
    let verified;
    try {
      verified = rejectPromise(
        this.#verifyEnvelope(request),
        "envelopeVerifier.verify",
        EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
      );
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
        "evolution artifact envelope verification failed",
        { cause },
      );
    }
    if (verified !== true) {
      throw artifactError(
        EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
        "evolution artifact envelope signature is invalid",
      );
    }
  }

  #authenticateEnvelope(envelope, options) {
    const parsed = parseCanonicalEnvelope(envelope);
    const core = validateEnvelopeCore(
      parsed.core,
      parsed.signature,
      this.#allowedTypes,
    );
    if (
      core.tenantId !== options.tenantId ||
      core.audience !== options.audience ||
      core.purpose !== options.purpose ||
      core.type !== options.expectedType ||
      core.digest !== options.expectedDigest
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
        "artifact envelope is not bound to the requested tenant, audience, purpose, type, and digest",
      );
    }
    this.#verifySignature(envelope, parsed.parsed, core);
    const verificationClock = this.#clock();
    if (
      verificationClock.milliseconds < core.issuedAtMs ||
      (core.expiresAtMs !== null &&
        verificationClock.milliseconds >= core.expiresAtMs)
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_EXPIRED_CODE,
        "evolution artifact envelope is not currently valid",
      );
    }
    const authority = this.#currentAuthority({
      action: "resolve",
      digest: core.digest,
      type: core.type,
      purpose: core.purpose,
      retention: core.retention,
      keyId: core.keyId,
      issuedAt: core.issuedAt,
      issuedPolicyDigest: core.policyDigest,
      issuedPolicyRevision: core.policyRevision,
    });
    const currentPolicyIsAdmissible =
      core.retention === "ledger"
        ? authority.issuedAt === core.issuedAt &&
          authority.issuedPolicyDigest === core.policyDigest &&
          authority.issuedPolicyRevision === core.policyRevision &&
          authority.issuedPolicyTrusted === true &&
          authority.policyRevision >= core.policyRevision
        : authority.policyDigest === core.policyDigest &&
          authority.policyRevision === core.policyRevision;
    if (
      authority.algorithm !== core.algorithm ||
      authority.keyId !== core.keyId ||
      !currentPolicyIsAdmissible ||
      authority.revocationRevision < core.revocationRevision
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
        "artifact envelope is stale under current policy or revocation authority",
      );
    }
    const completionClock = this.#clock();
    if (
      completionClock.milliseconds < verificationClock.milliseconds ||
      (core.expiresAtMs !== null &&
        completionClock.milliseconds >= core.expiresAtMs) ||
      completionClock.milliseconds >= authority.decisionExpiresAtMs
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_EXPIRED_CODE,
        "artifact authority expired before envelope authentication completed",
      );
    }
    return Object.freeze({
      authority,
      core,
      envelopeDigest: parsed.envelopeDigest,
      parsed: parsed.parsed,
      resolvedAt: completionClock.iso,
    });
  }

  #resolveAuthenticatedEntry(
    envelope,
    options,
    artifactId,
    preauthenticated = null,
  ) {
    const authentication =
      preauthenticated || this.#authenticateEnvelope(envelope, options);
    this.#assertUniqueRecordDigest(
      authentication.core.recordDigest,
      artifactId,
    );
    const entry = this.#loadCurrentEntryById(artifactId);
    const normalizedEntry = this.#validateIndexEntry(
      entry,
      envelope,
      authentication.core,
      authentication.envelopeDigest,
    );
    if (normalizedEntry.id !== artifactId) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "ArtifactStore entry id does not match the requested locator",
      );
    }
    const bytes = this.#readStoredBytes(
      entry,
      normalizedEntry,
      authentication.core.recordDigest,
    );
    const record = this.#parseRecordBytes(bytes, authentication.core);
    this.#assertEntryStable(artifactId, entry);
    this.#assertUniqueRecordDigest(
      authentication.core.recordDigest,
      artifactId,
    );
    const releaseClock = this.#clock();
    if (
      releaseClock.milliseconds <
        new Date(authentication.resolvedAt).getTime() ||
      (authentication.core.expiresAtMs !== null &&
        releaseClock.milliseconds >= authentication.core.expiresAtMs) ||
      releaseClock.milliseconds >= authentication.authority.decisionExpiresAtMs
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_EXPIRED_CODE,
        "artifact authority expired before canonical bytes could be released",
      );
    }
    const artifactRef = buildArtifactRef(
      artifactId,
      authentication.core.digest,
    );
    const receiptCore = {
      authenticated: true,
      audience: authentication.core.audience,
      currentAuthorityReceiptDigest: authentication.authority.receiptDigest,
      digest: authentication.core.digest,
      envelopeDigest: authentication.envelopeDigest,
      policyDigest: authentication.core.policyDigest,
      policyRevision: authentication.core.policyRevision,
      purpose: authentication.core.purpose,
      recordDigest: authentication.core.recordDigest,
      retention: authentication.core.retention,
      ref: artifactRef.ref,
      resolvedAt: releaseClock.iso,
      revocationRevision: authentication.authority.revocationRevision,
      schema: EVOLUTION_ARTIFACT_RESOLUTION_RECEIPT_SCHEMA,
      tenantId: authentication.core.tenantId,
      type: authentication.core.type,
    };
    const receipt = deepFreeze({
      ...receiptCore,
      receiptDigest: domainDigest(RESOLUTION_RECEIPT_DOMAIN, receiptCore),
    });
    return {
      artifactRef,
      authentication,
      bytes,
      receipt,
      record,
    };
  }

  #findUniqueEntryIdByRecordDigest(recordDigest) {
    const matches = this.#entriesByDataField(
      this.#boundedIndexEntries(),
      "recordDigest",
      recordDigest,
    );
    if (matches.length === 0) {
      throw artifactError(
        EVOLUTION_ARTIFACT_NOT_FOUND_CODE,
        "evolution artifact was removed, expired, or never persisted",
      );
    }
    if (matches.length !== 1) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "recordDigest has duplicate ArtifactStore index rows",
      );
    }
    assertExactRecord(
      matches[0],
      INDEX_ENTRY_KEYS,
      "ArtifactStore index entry",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const artifactId = ownData(matches[0], "id", "ArtifactStore index entry");
    if (!ARTIFACT_ID_PATTERN.test(artifactId || "")) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "recordDigest index row has an invalid ArtifactStore id",
      );
    }
    return artifactId;
  }

  putCanonical(type, value, context) {
    const normalizedType = normalizeType(type, this.#allowedTypes);
    const normalizedContext = normalizePutContext(
      context,
      this.#audience,
      normalizedType,
    );
    const valueClone = frozenCanonicalClone(value);
    const record = deepFreeze({
      audience: this.#audience,
      purpose: normalizedContext.purpose,
      retention: normalizedContext.retention,
      schema: EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
      tenantId: this.#tenantId,
      type: normalizedType,
      value: valueClone,
    });
    const recordJson = canonicalJson(record);
    const recordBytes = Buffer.from(recordJson, "utf8");
    const recordDigest = sha256(recordBytes);
    readTrustedIndexSnapshot(this.#store.layout);
    const issuanceClock = this.#clock();
    const expiresAt =
      normalizedContext.retention === "ledger"
        ? null
        : addCanonicalTimestamp(
            issuanceClock.milliseconds,
            normalizedContext.ttlMs,
            "artifact expiresAt",
          );
    const storeTtlDays =
      normalizedContext.retention === "ledger"
        ? ledgerHousekeepingTtlDays(issuanceClock.milliseconds)
        : Math.max(
            1,
            Math.ceil(normalizedContext.ttlMs / MILLISECONDS_PER_DAY),
          );
    const authority = this.#currentAuthority({
      action: "publish",
      digest: recordDigest,
      type: normalizedType,
      purpose: normalizedContext.purpose,
      retention: normalizedContext.retention,
    });
    const core = deepFreeze({
      algorithm: authority.algorithm,
      audience: this.#audience,
      authorityReceiptDigest: authority.receiptDigest,
      digest: recordDigest,
      expiresAt,
      issuedAt: issuanceClock.iso,
      keyId: authority.keyId,
      policyDigest: authority.policyDigest,
      policyRevision: authority.policyRevision,
      purpose: normalizedContext.purpose,
      recordDigest,
      retention: normalizedContext.retention,
      revocationRevision: authority.revocationRevision,
      schema: EVOLUTION_ARTIFACT_ENVELOPE_CORE_SCHEMA,
      tenantId: this.#tenantId,
      type: normalizedType,
    });
    const signature = this.#sign(core, authority);
    const signingClock = this.#clock();
    if (
      signingClock.milliseconds < issuanceClock.milliseconds ||
      signingClock.milliseconds >= authority.decisionExpiresAtMs ||
      (expiresAt !== null &&
        signingClock.milliseconds >= new Date(expiresAt).getTime())
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_EXPIRED_CODE,
        "artifact publish authority expired before envelope signing completed",
      );
    }
    const envelope = canonicalJson(
      {
        core,
        schema: EVOLUTION_ARTIFACT_ENVELOPE_SCHEMA,
        signature,
      },
      EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES,
    );
    if (
      Buffer.byteLength(envelope, "utf8") >
      EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
        "signed evolution artifact envelope exceeds 4096 bytes",
      );
    }
    const envelopeDigest = sha256(Buffer.from(envelope, "utf8"));
    const lineage = deepFreeze({
      audience: this.#audience,
      envelope,
      envelopeDigest,
      purpose: normalizedContext.purpose,
      recordDigest,
      retention: normalizedContext.retention,
      schema: EVOLUTION_ARTIFACT_LINEAGE_SCHEMA,
      tenantId: this.#tenantId,
      type: normalizedType,
    });
    // Validate the captured physical store/index generation immediately before
    // granting ArtifactStore the append. Post-publication readback re-attests
    // it and cross-checks the repository API against a descriptor snapshot.
    readTrustedIndexSnapshot(this.#store.layout);
    let publication;
    try {
      publication = rejectPromise(
        this.#store.publishDataOnce({
          data: recordBytes,
          fileName: `${recordDigest.slice("sha256:".length)}.json`,
          title: `Evolution ${normalizedType} artifact`,
          kind: "data",
          mime: "application/json",
          sessionId: null,
          ttlDays: storeTtlDays,
          immutable: true,
          recordDigest,
          lineage,
        }),
        "ArtifactStore.publishDataOnce",
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
      );
    } catch (cause) {
      if (isEvolutionArtifactPortError(cause)) throw cause;
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "canonical evolution artifact could not be persisted",
        { cause, recordDigest },
      );
    }
    assertExactRecord(
      publication,
      PUBLISH_RESULT_KEYS,
      "ArtifactStore publication result",
      EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
    );
    const published = ownData(
      publication,
      "published",
      "ArtifactStore publication result",
    );
    if (typeof published !== "boolean") {
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore publication result is invalid",
      );
    }
    const publishedEntry = ownData(
      publication,
      "entry",
      "ArtifactStore publication result",
    );
    if (!publishedEntry || typeof publishedEntry !== "object") {
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore publication did not return an entry",
      );
    }
    const artifactId = ownData(
      publishedEntry,
      "id",
      "ArtifactStore publication entry",
    );
    if (!ARTIFACT_ID_PATTERN.test(artifactId || "")) {
      throw artifactError(
        EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
        "ArtifactStore publication returned an invalid id",
      );
    }

    // A response-loss retry may find the prior immutable row. In that case its
    // exact signed envelope is authoritative and must be returned, rather than
    // replacing lineage with a newly issued envelope.
    const currentEntry = this.#loadCurrentEntryById(artifactId);
    assertExactRecord(
      currentEntry,
      INDEX_ENTRY_KEYS,
      "ArtifactStore index entry",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const currentLineage = ownData(
      currentEntry,
      "lineage",
      "ArtifactStore index entry",
    );
    assertExactRecord(
      currentLineage,
      LINEAGE_KEYS,
      "artifact lineage",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const returnedEnvelope = ownData(
      currentLineage,
      "envelope",
      "artifact lineage",
    );
    if (published && returnedEnvelope !== envelope) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "published artifact lineage does not contain the exact returned envelope",
      );
    }
    const resolved = this.#resolveAuthenticatedEntry(
      returnedEnvelope,
      Object.freeze({
        audience: this.#audience,
        expectedDigest: recordDigest,
        expectedType: normalizedType,
        purpose: normalizedContext.purpose,
        tenantId: this.#tenantId,
      }),
      artifactId,
    );
    if (
      canonicalJson(resolved.record) !== recordJson ||
      resolved.authentication.envelopeDigest !==
        ownData(currentLineage, "envelopeDigest", "artifact lineage")
    ) {
      throw artifactError(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        "canonical artifact readback does not match the requested value and lineage",
      );
    }
    const receiptCore = {
      audience: this.#audience,
      createdAt: ownData(
        currentEntry,
        "createdAt",
        "ArtifactStore index entry",
      ),
      digest: recordDigest,
      envelopeDigest: resolved.authentication.envelopeDigest,
      expiresAt: resolved.authentication.core.expiresAt,
      immutable: true,
      integrityVerified: true,
      persisted: true,
      published,
      purpose: normalizedContext.purpose,
      readbackVerified: true,
      recordDigest,
      retention: resolved.authentication.core.retention,
      ref: resolved.artifactRef.ref,
      schema: EVOLUTION_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
      ...(resolved.authentication.core.retention === "ttl"
        ? {
            storeExpiresAt: ownData(
              currentEntry,
              "expiresAt",
              "ArtifactStore index entry",
            ),
          }
        : {}),
      tenantId: this.#tenantId,
      type: normalizedType,
    };
    const receipt = deepFreeze({
      ...receiptCore,
      receiptDigest: domainDigest(PERSISTENCE_RECEIPT_DOMAIN, receiptCore),
    });
    return deepFreeze({
      digest: recordDigest,
      envelope: returnedEnvelope,
      receipt,
      ref: resolved.artifactRef,
    });
  }

  /**
   * Resolve a standalone signed envelope. This management interface must scan
   * the current ArtifactStore index and rejects above a hard admission limit;
   * production ledger reads should use the short-ref resolver below.
   */
  resolve(envelope, options) {
    const normalizedOptions = normalizeResolveOptions(
      options,
      this.#tenantId,
      this.#audience,
      this.#allowedTypes,
    );
    readTrustedIndexSnapshot(this.#store.layout);
    const authentication = this.#authenticateEnvelope(
      envelope,
      normalizedOptions,
    );
    const recordDigest = authentication.core.recordDigest;
    const artifactId = this.#findUniqueEntryIdByRecordDigest(recordDigest);
    const resolved = this.#resolveAuthenticatedEntry(
      envelope,
      normalizedOptions,
      artifactId,
      authentication,
    );
    return deepFreeze({
      authenticated: true,
      digest: resolved.authentication.core.digest,
      envelopeDigest: resolved.authentication.envelopeDigest,
      receipt: resolved.receipt,
      ref: resolved.artifactRef,
      schema: EVOLUTION_ARTIFACT_RESOLVED_SCHEMA,
      tenantId: this.#tenantId,
      type: resolved.authentication.core.type,
      retention: resolved.authentication.core.retention,
      value: resolved.record.value,
    });
  }

  #resolveLedgerRequest(request, purpose) {
    assertExactRecord(
      request,
      LEDGER_REQUEST_KEYS,
      "evolution ledger artifact request",
    );
    const tenantId = normalizeSafeId(
      ownData(request, "tenantId", "evolution ledger artifact request"),
      "evolution ledger tenantId",
    );
    if (tenantId !== this.#tenantId) {
      throw artifactError(
        EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
        "cross-tenant evolution ledger artifact resolution is denied",
      );
    }
    const ledgerId = normalizeSafeId(
      ownData(request, "ledgerId", "evolution ledger artifact request"),
      "evolution ledger ledgerId",
    );
    const epoch = normalizeSafeId(
      ownData(request, "epoch", "evolution ledger artifact request"),
      "evolution ledger epoch",
    );
    const artifactRef = normalizeArtifactRef(
      ownData(request, "ref", "evolution ledger artifact request"),
    );
    const entry = this.#loadCurrentEntryById(artifactRef.artifactId);
    assertExactRecord(
      entry,
      INDEX_ENTRY_KEYS,
      "ArtifactStore index entry",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const lineage = ownData(entry, "lineage", "ArtifactStore index entry");
    assertExactRecord(
      lineage,
      LINEAGE_KEYS,
      "artifact lineage",
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const envelope = ownData(lineage, "envelope", "artifact lineage");
    const parsed = parseCanonicalEnvelope(envelope);
    const expectedType = normalizeType(
      ownData(parsed.core, "type", "artifact envelope core"),
      this.#allowedTypes,
    );
    const options = Object.freeze({
      audience: this.#audience,
      expectedDigest: artifactRef.digest,
      expectedType,
      purpose,
      tenantId: this.#tenantId,
    });
    const authentication = this.#authenticateEnvelope(envelope, options);
    const resolved = this.#resolveAuthenticatedEntry(
      envelope,
      options,
      artifactRef.artifactId,
      authentication,
    );
    const ledgerReceiptCore = {
      artifactReceiptDigest: resolved.receipt.receiptDigest,
      digest: artifactRef.digest,
      epoch,
      ledgerId,
      ref: artifactRef.ref,
      tenantId,
    };
    const receiptDigest = domainDigest(
      "chainlesschain.evolution-ledger-artifact-resolution/v1\0",
      ledgerReceiptCore,
    );
    return Object.freeze({
      authenticated: true,
      bytes: Buffer.from(resolved.bytes),
      digest: artifactRef.digest,
      found: true,
      receiptDigest,
      ref: artifactRef.ref,
      schema: EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
    });
  }

  /** Return a frozen read-only function; it exposes no put/signing authority. */
  createEvolutionLedgerArtifactResolver(options = {}) {
    assertOptionalExactRecord(
      options,
      LEDGER_RESOLVER_OPTION_KEYS,
      LEDGER_RESOLVER_OPTION_KEYS,
      "evolution ledger resolver options",
    );
    const purpose = ownData(
      options,
      "purpose",
      "evolution ledger resolver options",
    );
    const normalizedPurpose = normalizeSafeId(
      purpose,
      "evolution ledger artifact purpose",
    );
    const resolveReadOnly = (request) =>
      this.#resolveLedgerRequest(request, normalizedPurpose);
    EVOLUTION_LEDGER_ARTIFACT_RESOLVERS.add(resolveReadOnly);
    return Object.freeze(resolveReadOnly);
  }
}

export function createEvolutionLedgerArtifactResolver(ports, options) {
  rejectProxy(ports, "EvolutionArtifactPorts instance");
  if (
    !hasStablePrototype(
      ports,
      EvolutionArtifactPorts.prototype,
      "EvolutionArtifactPorts instance",
    )
  ) {
    throw new TypeError(
      "createEvolutionLedgerArtifactResolver requires EvolutionArtifactPorts",
    );
  }
  return ports.createEvolutionLedgerArtifactResolver(options);
}

export function isEvolutionLedgerArtifactResolver(value) {
  return (
    typeof value === "function" &&
    EVOLUTION_LEDGER_ARTIFACT_RESOLVERS.has(value)
  );
}

Object.freeze(EvolutionArtifactPorts.prototype);
