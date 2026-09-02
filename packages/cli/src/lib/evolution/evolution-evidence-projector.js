/**
 * Trusted Raw -> model-visible -> learning projection boundary.
 *
 * Security properties intentionally live in captured ports rather than caller
 * claims. Source provenance is resolved by a trusted verifier, plaintext Raw is
 * handed to an encrypted artifact store, the resulting bundle is attested, and
 * reads require a resolved principal plus an ACL/purpose policy decision.
 * Public SHA-256 values are content identifiers only; they are never treated as
 * authenticity or authorization proofs.
 */

import { createHash, randomBytes } from "node:crypto";

export const EVOLUTION_SOURCE_VERIFICATION_SCHEMA =
  "chainlesschain.evolution-source-verification/v1";
export const EVOLUTION_KEYED_COMMITMENT_SCHEMA =
  "chainlesschain.evolution-keyed-commitment/v1";
export const EVOLUTION_RAW_STORAGE_RECEIPT_SCHEMA =
  "chainlesschain.evolution-raw-storage-receipt/v1";
export const EVOLUTION_RAW_STORAGE_POLICY_SCHEMA =
  "chainlesschain.evolution-raw-storage-policy/v1";
export const EVOLUTION_RAW_RECORD_SCHEMA =
  "chainlesschain.evolution-raw-record/v2";
export const EVOLUTION_MODEL_PROJECTION_SCHEMA =
  "chainlesschain.evolution-model-projection/v2";
export const EVOLUTION_TRUSTED_PROJECTION_SCHEMA =
  "chainlesschain.evolution-trusted-projection/v2";
export const EVOLUTION_PROJECTION_RECEIPT_SCHEMA =
  "chainlesschain.evolution-projection-receipt/v2";
export const EVOLUTION_PROJECTION_ATTESTATION_SCHEMA =
  "chainlesschain.evolution-projection-attestation/v1";
export const EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA =
  "chainlesschain.evolution-projection-attestation-verification/v1";
export const EVOLUTION_PROJECTION_PRINCIPAL_SCHEMA =
  "chainlesschain.evolution-projection-principal/v1";
export const EVOLUTION_PROJECTION_ACCESS_DECISION_SCHEMA =
  "chainlesschain.evolution-projection-access-decision/v1";
export const EVOLUTION_EVIDENCE_STATE_DECISION_SCHEMA =
  "chainlesschain.evolution-evidence-state-decision/v1";

export const EVOLUTION_PROJECTION_INVALID_CODE =
  "CC_EVOLUTION_PROJECTION_INVALID";
export const EVOLUTION_PROJECTION_SOURCE_DENIED_CODE =
  "CC_EVOLUTION_PROJECTION_SOURCE_DENIED";
export const EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE =
  "CC_EVOLUTION_PROJECTION_COMMITMENT_FAILED";
export const EVOLUTION_PROJECTION_STORAGE_FAILED_CODE =
  "CC_EVOLUTION_PROJECTION_STORAGE_FAILED";
export const EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE =
  "CC_EVOLUTION_PROJECTION_ATTESTATION_FAILED";
export const EVOLUTION_PROJECTION_ACCESS_DENIED_CODE =
  "CC_EVOLUTION_PROJECTION_ACCESS_DENIED";
export const EVOLUTION_PROJECTION_QUARANTINED_CODE =
  "CC_EVOLUTION_PROJECTION_QUARANTINED";
export const EVOLUTION_PROJECTION_SECRET_LEAK_CODE =
  "CC_EVOLUTION_PROJECTION_SECRET_LEAK";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMITMENT_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{32,4096}$/u;
const STATE_NONCE_PATTERN = /^[a-f0-9]{32}$/u;
const STATE_DECISION_MAX_TTL_MS = 60_000;
const STATE_CLOCK_SKEW_MS = 5_000;
const SOURCE_KINDS = Object.freeze([
  "user-statement",
  "tool-observation",
  "model-inference",
  "verified-outcome",
]);
const TRUST_LEVELS = Object.freeze(["trusted", "untrusted", "external"]);
const SENSITIVITY_LEVELS = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const SOURCE_SCHEMES = new Set(["rollout", "tool", "outcome", "recording"]);
const SOURCE_COMMITMENT_PURPOSE = "chainlesschain.evolution-source-payload/v1";
const TRUSTED_PAYLOAD_COMMITMENT_PURPOSE =
  "chainlesschain.evolution-trusted-payload/v1";

const INPUT_KEYS = new Set(["sourceEnvelope", "payload"]);
const SOURCE_VERIFICATION_KEYS = new Set([
  "schema",
  "verified",
  "sourceEnvelopeDigest",
  "sourceInputDigest",
  "tenantId",
  "principalId",
  "sourceKind",
  "trust",
  "authenticated",
  "sourceRef",
  "sensitivity",
  "schemaDigest",
  "compilable",
  "trustedPayload",
  "requestNonce",
  "requestedAt",
  "checkedAt",
  "decisionExpiresAt",
  "verifierPolicyDigest",
  "verifierPolicyRevision",
  "schemaPolicyDigest",
  "schemaPolicyRevision",
  "verificationReceiptDigest",
]);
const COMMITMENT_DECISION_KEYS = new Set([
  "schema",
  "committed",
  "tenantId",
  "algorithm",
  "keyId",
  "keyVersion",
  "sourcePurpose",
  "sourceInputDigest",
  "sourceCommitment",
  "trustedPayloadPurpose",
  "trustedPayloadInputDigest",
  "trustedPayloadCommitment",
  "requestNonce",
  "requestedAt",
  "checkedAt",
  "decisionExpiresAt",
  "policyDigest",
  "policyRevision",
  "commitmentReceiptDigest",
]);
const STORAGE_RECEIPT_KEYS = new Set([
  "schema",
  "stored",
  "tenantId",
  "evidenceId",
  "sourceCommitment",
  "commitmentReceiptDigest",
  "sourceVerificationReceiptDigest",
  "storagePolicyReceiptDigest",
  "storagePolicyDigest",
  "storagePolicyRevision",
  "storagePolicyDecisionExpiresAt",
  "requestNonce",
  "requestedAt",
  "storedAt",
  "artifactRef",
  "cipherDigest",
  "keyRef",
  "algorithm",
  "aadDigest",
  "sensitivity",
  "retention",
  "acl",
  "receiptDigest",
]);
const STORAGE_POLICY_KEYS = new Set([
  "schema",
  "allowed",
  "tenantId",
  "principalId",
  "sourceKind",
  "sourceCommitment",
  "commitmentReceiptDigest",
  "sourceVerificationReceiptDigest",
  "sensitivity",
  "retention",
  "acl",
  "requestNonce",
  "requestedAt",
  "checkedAt",
  "decisionExpiresAt",
  "policyDigest",
  "policyRevision",
  "policyReceiptDigest",
]);
const RETENTION_KEYS = new Set(["expiresAt", "deletionClass"]);
const RAW_KEYS = new Set([
  "schema",
  "evidenceId",
  "tenantId",
  "principalId",
  "sourceKind",
  "trust",
  "authenticated",
  "sourceRef",
  "sourceCommitment",
  "commitmentAlgorithm",
  "commitmentKeyId",
  "commitmentKeyVersion",
  "commitmentPolicyDigest",
  "commitmentPolicyRevision",
  "commitmentReceiptDigest",
  "sourceVerificationReceiptDigest",
  "storagePolicyReceiptDigest",
  "storagePolicyDigest",
  "storagePolicyRevision",
  "storagePolicyDecisionExpiresAt",
  "storageRequestNonce",
  "storageRequestedAt",
  "storageStoredAt",
  "schemaDigest",
  "compilable",
  "trustedPayloadCommitment",
  "encryptedRawArtifact",
  "sensitivity",
  "retention",
  "acl",
  "plaintextStored",
  "storageReceiptDigest",
  "rawRecordDigest",
]);
const ENCRYPTED_ARTIFACT_KEYS = new Set([
  "ref",
  "digest",
  "keyRef",
  "algorithm",
  "aadDigest",
]);
const MODEL_KEYS = new Set([
  "schema",
  "evidenceId",
  "tenantId",
  "sourceKind",
  "trustLabel",
  "sourceCommitment",
  "visibility",
  "content",
  "redactionSummary",
  "injectionFindings",
  "truncated",
  "rulesetDigest",
  "projectionDigest",
]);
const TRUSTED_KEYS = new Set([
  "schema",
  "evidenceId",
  "tenantId",
  "sourceKind",
  "sourceCommitment",
  "modelProjectionDigest",
  "trustedPayloadCommitment",
  "trustedInputInjectionCount",
  "trustedInputStructured",
  "status",
  "reasonCodes",
  "content",
  "rulesetDigest",
  "projectionDigest",
]);
const RECEIPT_KEYS = new Set([
  "schema",
  "evidenceId",
  "tenantId",
  "sourceCommitment",
  "commitmentReceiptDigest",
  "sourceVerificationReceiptDigest",
  "storageReceiptDigest",
  "rawRecordDigest",
  "modelProjectionDigest",
  "trustedProjectionDigest",
  "rulesetDigest",
  "redactionSummary",
  "injectionCount",
  "trustedStatus",
  "createdAt",
  "receiptDigest",
]);
const ATTESTATION_KEYS = new Set([
  "schema",
  "algorithm",
  "keyId",
  "issuer",
  "trustPolicyDigest",
  "receiptDigest",
  "tenantId",
  "evidenceId",
  "signature",
  "attestationDigest",
]);
const ATTESTATION_VERIFICATION_KEYS = new Set([
  "schema",
  "verified",
  "attestationDigest",
  "receiptDigest",
  "tenantId",
  "evidenceId",
  "issuer",
  "keyId",
  "trustPolicyDigest",
  "trustPolicyRevision",
  "requestNonce",
  "requestedAt",
  "checkedAt",
  "decisionExpiresAt",
  "verificationReceiptDigest",
]);
const PRINCIPAL_KEYS = new Set([
  "schema",
  "authenticated",
  "principalId",
  "tenantId",
  "principalEnvelopeDigest",
  "action",
  "purpose",
  "roles",
  "expiresAt",
  "requestNonce",
  "requestedAt",
  "checkedAt",
  "decisionExpiresAt",
  "policyDigest",
  "policyRevision",
  "receiptDigest",
]);
const ACCESS_KEYS = new Set([
  "schema",
  "allowed",
  "action",
  "purpose",
  "principalId",
  "principalReceiptDigest",
  "evidenceStateReceiptDigest",
  "evidenceStateRevision",
  "evidenceStateDecisionExpiresAt",
  "principalExpiresAt",
  "principalDecisionExpiresAt",
  "tenantId",
  "evidenceId",
  "sensitivity",
  "projectionReceiptDigest",
  "retentionExpiresAt",
  "requestNonce",
  "requestedAt",
  "checkedAt",
  "decisionExpiresAt",
  "policyDigest",
  "policyRevision",
  "receiptDigest",
]);
const EVIDENCE_STATE_KEYS = new Set([
  "schema",
  "readable",
  "status",
  "tenantId",
  "evidenceId",
  "rawRecordDigest",
  "projectionReceiptDigest",
  "attestationDigest",
  "revision",
  "requestNonce",
  "requestedAt",
  "checkedAt",
  "decisionExpiresAt",
  "tombstoneReceiptDigest",
  "receiptDigest",
]);
const REDACTION_SUMMARY_KEYS = new Set(["total", "byType", "paths"]);
const INJECTION_FINDING_KEYS = new Set(["path", "patternIds"]);

const CONFUSABLE_ASCII_TABLE = Object.freeze({
  Α: "a",
  Β: "b",
  Ε: "e",
  Ζ: "z",
  Η: "h",
  Ι: "i",
  Κ: "k",
  Μ: "m",
  Ν: "n",
  Ο: "o",
  Ρ: "p",
  Τ: "t",
  Υ: "y",
  Χ: "x",
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "i",
  ј: "j",
  ѕ: "s",
  А: "a",
  В: "b",
  Е: "e",
  К: "k",
  М: "m",
  Н: "h",
  О: "o",
  Р: "p",
  С: "c",
  Т: "t",
  Х: "x",
});

const RULESET = Object.freeze({
  schema: "chainlesschain.evolution-projection-rules/v2",
  version: 2,
  maxDepth: 16,
  maxNodes: 4096,
  maxStringChars: 8192,
  maxModelBytes: 256 * 1024,
  unicodePolicy: "nfkc-default-ignorable-mixed-script-v1",
  trustedPayloadPolicy: "structured-ascii-scalars-v1",
  confusableAscii: CONFUSABLE_ASCII_TABLE,
  injectionPatterns: Object.freeze([
    "ignore previous instructions",
    "ignore all previous instructions",
    "ignore prior instructions",
    "disregard previous instructions",
    "disregard all prior directions",
    "reveal the system prompt",
    "show the system prompt",
    "exfiltrate secrets",
    "disable safety",
    "bypass policy",
    "you are now",
    "override developer instructions",
    "override system instructions",
    "treat tool output as trusted",
    "execute commands without approval",
    "send credentials to",
    "grant yourself permission",
    "turn off guardrails",
    "mark this task successful",
    "fabricate test results",
    "忽略之前的指令",
    "忽略之前的所有指令",
    "忽略以前的所有指令",
    "显示系统提示",
    "泄露秘密",
    "绕过安全策略",
    "覆盖开发者指令",
    "覆盖系统指令",
    "未经批准执行命令",
    "发送凭据到",
    "授予自己权限",
    "关闭安全护栏",
    "伪造测试结果",
  ]),
});

const RULESET_DIGEST = `sha256:${createHash("sha256")
  .update(
    `chainlesschain.evolution-projection-rules/v2\0${JSON.stringify(RULESET)}`,
    "utf8",
  )
  .digest("hex")}`;

const VALUE_PATTERNS = Object.freeze([
  Object.freeze({
    type: "private-key",
    regex:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/giu,
  }),
  Object.freeze({
    type: "credential",
    regex: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/giu,
  }),
  Object.freeze({
    type: "credential",
    regex:
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/giu,
  }),
  Object.freeze({
    type: "credential",
    regex: /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gu,
  }),
  Object.freeze({
    type: "credential",
    regex: /\bAKIA[A-Z0-9]{16}\b/gu,
  }),
  Object.freeze({
    type: "credential",
    regex: /\bAIza[A-Za-z0-9_-]{30,}\b/gu,
  }),
  Object.freeze({
    type: "credential",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  }),
  Object.freeze({
    type: "credential",
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/giu,
  }),
  Object.freeze({
    type: "email",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  }),
  Object.freeze({
    type: "government-id",
    regex: /\b\d{3}-\d{2}-\d{4}\b/gu,
  }),
  Object.freeze({
    type: "government-id",
    regex: /(?<!\d)\d{17}[0-9Xx](?!\d)/gu,
  }),
  Object.freeze({
    type: "payment-card",
    regex: /\b(?:\d[ -]*?){13,19}\b/gu,
  }),
  Object.freeze({
    type: "phone",
    regex: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/gu,
  }),
]);

const REDACTION_TYPES = new Set([
  ...VALUE_PATTERNS.map(({ type }) => type),
  "pii",
  "content-truncation",
]);

export class EvolutionEvidenceProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "EvolutionEvidenceProjectionError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function projectionError(code, message, details = {}) {
  return new EvolutionEvidenceProjectionError(code, message, details);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactRecord(
  value,
  keys,
  label,
  code = EVOLUTION_PROJECTION_INVALID_CODE,
) {
  if (!isPlainRecord(value)) {
    throw projectionError(code, `${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw projectionError(
      code,
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw projectionError(
        code,
        `${label}.${String(key)} must be an enumerable own data property`,
      );
    }
  }
}

function canonicalJson(value, seen = new Set(), depth = 0) {
  if (depth > 32) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "projection value exceeds depth limit",
    );
  }
  let output;
  if (value === null || typeof value === "boolean") {
    output = JSON.stringify(value);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "projection contains a non-finite number",
      );
    }
    output = JSON.stringify(value);
  } else if (typeof value === "string") {
    output = JSON.stringify(value);
  }
  if (output !== undefined) {
    if (Buffer.byteLength(output, "utf8") > 2 * 1024 * 1024) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "projection exceeds the 2 MiB admission limit",
      );
    }
    return output;
  }
  if (!value || typeof value !== "object") {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "projection contains an unsupported value",
    );
  }
  if (seen.has(value)) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "projection must not contain cycles",
    );
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
      ) ||
      value.length !== ownKeys.length - 1
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "projection arrays must be dense own-data arrays",
      );
    }
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw projectionError(
          EVOLUTION_PROJECTION_INVALID_CODE,
          "projection arrays must use enumerable own data entries",
        );
      }
      entries.push(canonicalJson(descriptor.value, seen, depth + 1));
    }
    output = `[${entries.join(",")}]`;
  } else {
    if (!isPlainRecord(value)) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "projection must use plain objects",
      );
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "projection objects must not contain symbol keys",
      );
    }
    const fields = [];
    for (const key of keys.sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw projectionError(
          EVOLUTION_PROJECTION_INVALID_CODE,
          "projection objects must use enumerable own data properties",
        );
      }
      fields.push(
        `${JSON.stringify(key)}:${canonicalJson(descriptor.value, seen, depth + 1)}`,
      );
    }
    output = `{${fields.join(",")}}`;
  }
  seen.delete(value);
  if (Buffer.byteLength(output, "utf8") > 2 * 1024 * 1024) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "projection exceeds the 2 MiB admission limit",
    );
  }
  return output;
}

function digest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function cloneCanonical(value) {
  return JSON.parse(canonicalJson(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertNoKnownSecrets(content) {
  const serialized =
    typeof content === "string" ? content : canonicalJson(content);
  for (const pattern of VALUE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(serialized)) {
      throw projectionError(
        EVOLUTION_PROJECTION_SECRET_LEAK_CODE,
        `projection metadata or content still matches ${pattern.type}`,
      );
    }
  }
}

/**
 * Shared plaintext persistence guard for downstream Wiki/Skill artifacts.
 * Callers receive the same Unicode-aware secret/PII policy used by the
 * model-visible projection boundary instead of maintaining a weaker regex set.
 */
export function assertEvolutionContentContainsNoKnownSecrets(content) {
  if (typeof content !== "string") {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "plaintext persistence content must be a string",
    );
  }
  assertNoKnownSecrets(content);
  const skeleton = confusableSkeleton(content);
  if (skeleton !== content) assertNoKnownSecrets(skeleton);
  return true;
}

/** Return stable rule ids for prompt-injection text without exposing rules. */
export function inspectEvolutionContentInjectionRisks(content) {
  if (typeof content !== "string") {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "prompt-injection inspection content must be a string",
    );
  }
  return Object.freeze(
    injectionMatches(content)
      .map(({ id }) => id)
      .sort(),
  );
}

function normalizeId(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !SAFE_ID_PATTERN.test(value)
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} is invalid`,
    );
  }
  assertNoKnownSecrets(value);
  return value;
}

function normalizeDigest(
  value,
  label,
  code = EVOLUTION_PROJECTION_INVALID_CODE,
) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw projectionError(code, `${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function normalizeCommitment(
  value,
  label,
  code = EVOLUTION_PROJECTION_INVALID_CODE,
) {
  if (typeof value !== "string" || !COMMITMENT_PATTERN.test(value)) {
    throw projectionError(
      code,
      `${label} must be a lowercase HMAC-SHA-256 commitment`,
    );
  }
  return value;
}

function normalizeTimestamp(value, label) {
  if (!(value instanceof Date) && typeof value !== "string") {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} is invalid`,
    );
  }
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} is invalid`,
    );
  }
  return date.toISOString();
}

function hasUriControlOrWhitespace(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function normalizeOpaqueUri(value, { label, schemes, tenantId }) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} is invalid`,
    );
  }
  assertNoKnownSecrets(value);
  if (
    /[?#@\\%\s]/u.test(value) ||
    hasUriControlOrWhitespace(value) ||
    /\/(?:\.{1,2})(?:\/|$)/u.test(value)
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} contains a forbidden URI component`,
    );
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} must be an absolute URI`,
      { cause },
    );
  }
  const scheme = parsed.protocol.slice(0, -1);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch (cause) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} contains invalid encoding`,
      { cause },
    );
  }
  if (
    !schemes.has(scheme) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname !== tenantId ||
    !decodedPath.startsWith("/") ||
    decodedPath
      .split("/")
      .some((segment) => segment === ".." || segment === ".")
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} is outside the tenant-scoped URI policy`,
    );
  }
  return value;
}

function normalizeRetention(value, nowMs) {
  assertExactRecord(value, RETENTION_KEYS, "retention policy");
  if (
    !["standard", "legal-hold", "user-delete"].includes(value.deletionClass)
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "retention deletionClass is invalid",
    );
  }
  const expiresAt = normalizeTimestamp(value.expiresAt, "retention expiresAt");
  const expiry = new Date(expiresAt).getTime();
  if (expiry <= nowMs || expiry - nowMs > 10 * 365 * 24 * 60 * 60 * 1000) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "retention expiry is outside policy bounds",
    );
  }
  return deepFreeze({ expiresAt, deletionClass: value.deletionClass });
}

function normalizeAcl(value, ownerPrincipalId) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 128 ||
    new Set(value).size !== value.length
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw ACL is invalid",
    );
  }
  const acl = value.map((principal, index) =>
    normalizeId(principal, `acl[${index}]`),
  );
  if (!acl.includes(ownerPrincipalId)) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw ACL must include the authenticated source principal",
    );
  }
  return deepFreeze(acl);
}

const DEFAULT_IGNORABLE_PATTERN = /\p{Default_Ignorable_Code_Point}/gu;
const CYRILLIC_OR_GREEK_PATTERN = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const LATIN_PATTERN = /[A-Za-z]/u;
const CONFUSABLE_ASCII = new Map(Object.entries(CONFUSABLE_ASCII_TABLE));

function isSuspiciousControl(code) {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}

function hasSuspiciousControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (isSuspiciousControl(value.charCodeAt(index))) return true;
  }
  return false;
}

function stripSuspiciousControls(value) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (!isSuspiciousControl(value.charCodeAt(index))) output += value[index];
  }
  return output;
}

function unicodeSecurityText(value) {
  return stripSuspiciousControls(
    value.normalize("NFKC").replace(DEFAULT_IGNORABLE_PATTERN, ""),
  );
}

function confusableSkeleton(value) {
  return [...unicodeSecurityText(value)]
    .map((character) => CONFUSABLE_ASCII.get(character) || character)
    .join("");
}

function normalizedInjectionText(value) {
  return unicodeSecurityText(value)
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function compactInjectionText(value) {
  return normalizedInjectionText(value).replace(/[\p{P}\p{S}\s]+/gu, "");
}

const NORMALIZED_INJECTION_PATTERNS = Object.freeze(
  RULESET.injectionPatterns.map((pattern) => ({
    text: normalizedInjectionText(pattern),
    compact: compactInjectionText(pattern),
    id: digest(pattern, "chainlesschain.evolution-injection-pattern/v2"),
  })),
);

const UNICODE_OBFUSCATION_SIGNAL = Object.freeze({
  text: "unicode-obfuscation",
  id: digest(
    "unicode-obfuscation",
    "chainlesschain.evolution-injection-signal/v2",
  ),
});
const MIXED_SCRIPT_SIGNAL = Object.freeze({
  text: "mixed-script-confusable",
  id: digest(
    "mixed-script-confusable",
    "chainlesschain.evolution-injection-signal/v2",
  ),
});
const ALLOWED_INJECTION_PATTERN_IDS = new Set([
  ...NORMALIZED_INJECTION_PATTERNS.map(({ id }) => id),
  UNICODE_OBFUSCATION_SIGNAL.id,
  MIXED_SCRIPT_SIGNAL.id,
]);

function injectionMatches(value) {
  const normalized = normalizedInjectionText(value);
  const skeleton = normalizedInjectionText(confusableSkeleton(value));
  const compact = compactInjectionText(value);
  const compactSkeleton = compactInjectionText(confusableSkeleton(value));
  const matches = NORMALIZED_INJECTION_PATTERNS.filter(
    ({ text, compact: patternCompact }) =>
      normalized.includes(text) ||
      skeleton.includes(text) ||
      compact.includes(patternCompact) ||
      compactSkeleton.includes(patternCompact),
  );
  DEFAULT_IGNORABLE_PATTERN.lastIndex = 0;
  if (DEFAULT_IGNORABLE_PATTERN.test(value) || hasSuspiciousControl(value)) {
    matches.push(UNICODE_OBFUSCATION_SIGNAL);
  }
  if (
    LATIN_PATTERN.test(unicodeSecurityText(value)) &&
    CYRILLIC_OR_GREEK_PATTERN.test(unicodeSecurityText(value))
  ) {
    matches.push(MIXED_SCRIPT_SIGNAL);
  }
  return [...new Map(matches.map((match) => [match.id, match])).values()];
}

function assertNoInjectionText(content) {
  const serialized =
    typeof content === "string" ? content : canonicalJson(content);
  if (injectionMatches(serialized).length > 0) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "projection still contains prompt-injection text",
    );
  }
}

function findingPath(path) {
  return path.length === 0 ? "$" : `$.${path.join(".")}`;
}

function sensitiveKeyType(key) {
  const normalized = confusableSkeleton(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
  if (
    /^(?:password|passwd|pwd|secret|clientsecret|privatekey|authorization|cookie|setcookie)$/u.test(
      normalized,
    )
  ) {
    return normalized === "privatekey" ? "private-key" : "credential";
  }
  if (/^(?:api|access|refresh|session|auth|id)?token$/u.test(normalized))
    return "credential";
  if (/^(?:api|secret|signing|encryption)key$/u.test(normalized))
    return "credential";
  if (/^(?:email|phone|ssn|nationalid|identitynumber)$/u.test(normalized))
    return "pii";
  return null;
}

function sanitizeKey(key, path, findings, injections) {
  const secretTypes = [];
  for (const pattern of VALUE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(key)) secretTypes.push(pattern.type);
  }
  const matched = injectionMatches(key);
  const tooLong = key.length > RULESET.maxStringChars;
  if (secretTypes.length === 0 && matched.length === 0 && !tooLong) return key;
  const safeKey = `[REDACTED_KEY:${digest(
    key,
    "chainlesschain.evolution-redacted-key/v2",
  ).slice(7, 23)}]`;
  const safePath = findingPath([...path, safeKey]);
  for (const type of secretTypes)
    findings.push({ type, path: safePath, count: 1 });
  if (tooLong)
    findings.push({
      type: "content-truncation",
      path: safePath,
      count: 1,
    });
  if (matched.length > 0) {
    injections.push({
      path: safePath,
      patternIds: matched.map(({ id }) => id),
    });
  }
  return safeKey;
}

function sanitizeString(value, path, findings, injections) {
  let output = value;
  for (const pattern of VALUE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let count = 0;
    output = output.replace(pattern.regex, () => {
      count += 1;
      return `[REDACTED:${pattern.type}]`;
    });
    if (count > 0)
      findings.push({ type: pattern.type, path: findingPath(path), count });
  }
  const securityNormalized = unicodeSecurityText(output);
  if (securityNormalized !== output) {
    for (const pattern of VALUE_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(securityNormalized)) {
        findings.push({
          type: pattern.type,
          path: findingPath(path),
          count: 1,
        });
        output = `[REDACTED:${pattern.type}]`;
        break;
      }
    }
  }
  const matched = injectionMatches(output);
  if (matched.length > 0) {
    injections.push({
      path: findingPath(path),
      patternIds: matched.map(({ id }) => id),
    });
    output = "[QUARANTINED:POTENTIAL_PROMPT_INJECTION]";
  }
  if (output.length > RULESET.maxStringChars) {
    findings.push({
      type: "content-truncation",
      path: findingPath(path),
      count: 1,
    });
    output = `${output.slice(0, RULESET.maxStringChars)}[TRUNCATED]`;
  }
  return output;
}

function sanitizePayload(payload) {
  const findings = [];
  const injections = [];
  let nodes = 0;
  let truncated = false;
  const visit = (value, path, depth) => {
    nodes += 1;
    if (nodes > RULESET.maxNodes || depth > RULESET.maxDepth) {
      truncated = true;
      findings.push({
        type: "content-truncation",
        path: findingPath(path),
        count: 1,
      });
      return "[TRUNCATED:CONTENT_BUDGET]";
    }
    if (typeof value === "string")
      return sanitizeString(value, path, findings, injections);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw projectionError(
          EVOLUTION_PROJECTION_INVALID_CODE,
          "Raw payload contains a non-finite number",
        );
      }
      return value;
    }
    if (Array.isArray(value)) {
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        if (nodes >= RULESET.maxNodes) {
          truncated = true;
          findings.push({
            type: "content-truncation",
            path: findingPath(path),
            count: 1,
          });
          output.push("[TRUNCATED:CONTENT_BUDGET]");
          break;
        }
        output.push(visit(value[index], [...path, String(index)], depth + 1));
      }
      return output;
    }
    if (!isPlainRecord(value)) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "Raw payload must contain JSON-compatible plain objects",
      );
    }
    // A null-prototype builder plus descriptor writes keeps attacker-controlled
    // JSON keys such as `__proto__` as inert data. Ordinary assignment to `{}`
    // would invoke Object.prototype's legacy setter and silently change or drop
    // projected content before the receipt is attested.
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (nodes >= RULESET.maxNodes) {
        truncated = true;
        findings.push({
          type: "content-truncation",
          path: findingPath(path),
          count: 1,
        });
        break;
      }
      const safeKey = sanitizeKey(key, path, findings, injections);
      if (Object.hasOwn(output, safeKey)) {
        throw projectionError(
          EVOLUTION_PROJECTION_INVALID_CODE,
          "redaction produced a key collision",
        );
      }
      const keyType = sensitiveKeyType(key);
      let projectedValue;
      if (keyType) {
        nodes += 1;
        projectedValue = `[REDACTED:${keyType}]`;
        findings.push({
          type: keyType,
          path: findingPath([...path, safeKey]),
          count: 1,
        });
      } else {
        projectedValue = visit(value[key], [...path, safeKey], depth + 1);
      }
      Object.defineProperty(output, safeKey, {
        value: projectedValue,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return output;
  };
  let content = visit(payload, [], 0);
  if (
    Buffer.byteLength(canonicalJson(content), "utf8") > RULESET.maxModelBytes
  ) {
    truncated = true;
    content = {
      notice: "[TRUNCATED:MODEL_CONTENT_BUDGET]",
      sourceContentDigest: digest(
        content,
        "chainlesschain.evolution-redacted-content/v2",
      ),
    };
    findings.push({ type: "content-truncation", path: "$", count: 1 });
  }
  const byType = {};
  const paths = new Set();
  for (const finding of findings) {
    byType[finding.type] = (byType[finding.type] || 0) + finding.count;
    paths.add(finding.path);
  }
  const redactionSummary = {
    total: Object.values(byType).reduce((sum, count) => sum + count, 0),
    byType,
    paths: [...paths].sort(),
  };
  assertNoKnownSecrets(content);
  return deepFreeze({
    content,
    redactionSummary,
    injectionFindings: injections,
    truncated,
  });
}

function isStructuredTrustedPayload(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (depth > 8 || budget.nodes > 1024) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    return (
      value.length >= 1 &&
      value.length <= 256 &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value) &&
      injectionMatches(value).length === 0
    );
  }
  if (Array.isArray(value)) {
    return (
      value.length <= 256 &&
      value.every((entry) =>
        isStructuredTrustedPayload(entry, depth + 1, budget),
      )
    );
  }
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length <= 256 &&
    keys.every(
      (key) =>
        /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(key) &&
        sensitiveKeyType(key) === null &&
        injectionMatches(key).length === 0 &&
        isStructuredTrustedPayload(value[key], depth + 1, budget),
    )
  );
}

function trustedReasons(
  source,
  modelProjection,
  trustedSanitized,
  trustedInputStructured,
) {
  const reasons = [];
  if (source.trust !== "trusted") reasons.push("source-not-trusted");
  if (!source.authenticated) reasons.push("source-not-authenticated");
  if (!["tool-observation", "verified-outcome"].includes(source.sourceKind)) {
    reasons.push(`source-kind-${source.sourceKind}-not-compilable`);
  }
  if (!source.compilable || source.trustedPayload === null)
    reasons.push("schema-not-compilable");
  if (source.compilable && !trustedInputStructured) {
    reasons.push("trusted-payload-not-structured");
  }
  if (
    modelProjection.injectionFindings.length > 0 ||
    trustedSanitized?.injectionFindings.length > 0
  ) {
    reasons.push("prompt-injection-detected");
  }
  if (source.sensitivity === "confidential")
    reasons.push("confidential-evidence");
  if (source.sensitivity === "restricted") reasons.push("restricted-evidence");
  return [...new Set(reasons)].sort();
}

function validateSourceVerification(
  value,
  expected,
  requestClock,
  responseClock,
) {
  assertExactRecord(
    value,
    SOURCE_VERIFICATION_KEYS,
    "source verification",
    EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
  );
  const requestedAt = normalizeTimestamp(
    value.requestedAt,
    "source verification requestedAt",
  );
  const checkedAt = normalizeTimestamp(
    value.checkedAt,
    "source verification checkedAt",
  );
  const decisionExpiresAt = normalizeTimestamp(
    value.decisionExpiresAt,
    "source verification decisionExpiresAt",
  );
  const requestedAtMs = new Date(requestedAt).getTime();
  const checkedAtMs = new Date(checkedAt).getTime();
  const decisionExpiresAtMs = new Date(decisionExpiresAt).getTime();
  const verificationCore = { ...value };
  delete verificationCore.verificationReceiptDigest;
  const failures = [
    [value.schema === EVOLUTION_SOURCE_VERIFICATION_SCHEMA, "schema"],
    [value.verified === true, "verified"],
    [
      value.sourceEnvelopeDigest === expected.sourceEnvelopeDigest,
      "source-envelope",
    ],
    [
      value.sourceInputDigest === expected.sourceInputDigest,
      "source-input-digest",
    ],
    [SOURCE_KINDS.includes(value.sourceKind), "source-kind"],
    [TRUST_LEVELS.includes(value.trust), "trust"],
    [typeof value.authenticated === "boolean", "authenticated"],
    [SENSITIVITY_LEVELS.includes(value.sensitivity), "sensitivity"],
    [typeof value.compilable === "boolean", "compilable"],
    [
      STATE_NONCE_PATTERN.test(value.requestNonce) &&
        value.requestNonce === expected.requestNonce,
      "request-nonce",
    ],
    [
      requestedAt === value.requestedAt &&
        value.requestedAt === requestClock.iso,
      "requested-at",
    ],
    [checkedAt === value.checkedAt, "checked-at-canonical"],
    [decisionExpiresAt === value.decisionExpiresAt, "expiry-canonical"],
    [
      checkedAtMs >= requestedAtMs - STATE_CLOCK_SKEW_MS,
      "checked-before-request",
    ],
    [
      checkedAtMs <= responseClock.milliseconds + STATE_CLOCK_SKEW_MS,
      "checked-at-future",
    ],
    [decisionExpiresAtMs > responseClock.milliseconds, "decision-expired"],
    [decisionExpiresAtMs > checkedAtMs, "expiry-before-check"],
    [
      decisionExpiresAtMs - checkedAtMs <= STATE_DECISION_MAX_TTL_MS,
      "decision-too-long",
    ],
    [
      Number.isSafeInteger(value.verifierPolicyRevision) &&
        value.verifierPolicyRevision >= 1,
      "verifier-policy-revision",
    ],
    [DIGEST_PATTERN.test(value.verifierPolicyDigest), "verifier-policy-digest"],
    [
      Number.isSafeInteger(value.schemaPolicyRevision) &&
        value.schemaPolicyRevision >= 1,
      "schema-policy-revision",
    ],
    [DIGEST_PATTERN.test(value.schemaPolicyDigest), "schema-policy-digest"],
    [
      value.verificationReceiptDigest ===
        digest(
          verificationCore,
          "chainlesschain.evolution-source-verification/v1",
        ),
      "receipt-digest",
    ],
  ]
    .filter(([passed]) => !passed)
    .map(([, label]) => label);
  if (failures.length > 0) {
    throw projectionError(
      EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
      "source verifier returned an invalid or unbound decision",
      { failures },
    );
  }
  const tenantId = normalizeId(value.tenantId, "source tenantId");
  const principalId = normalizeId(value.principalId, "source principalId");
  const sourceRef = normalizeOpaqueUri(value.sourceRef, {
    label: "sourceRef",
    schemes: SOURCE_SCHEMES,
    tenantId,
  });
  normalizeDigest(
    value.verificationReceiptDigest,
    "source verification receipt",
    EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
  );
  normalizeDigest(
    value.verifierPolicyDigest,
    "source verifier policy digest",
    EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
  );
  normalizeDigest(
    value.schemaPolicyDigest,
    "source schema policy digest",
    EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
  );
  if (value.compilable) {
    if (
      value.trustedPayload === null ||
      value.schemaDigest === null ||
      !value.authenticated ||
      value.trust !== "trusted" ||
      !["tool-observation", "verified-outcome"].includes(value.sourceKind)
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
        "compilable source lacks trusted schema provenance",
      );
    }
    normalizeDigest(
      value.schemaDigest,
      "source schemaDigest",
      EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
    );
    cloneCanonical(value.trustedPayload);
  } else if (value.trustedPayload !== null || value.schemaDigest !== null) {
    throw projectionError(
      EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
      "non-compilable source must not return trusted payload data",
    );
  }
  return deepFreeze({
    ...cloneCanonical(value),
    tenantId,
    principalId,
    sourceRef,
    requestedAtMs,
    checkedAtMs,
    decisionExpiresAtMs,
  });
}

function validateCommitmentDecision(
  value,
  expected,
  requestClock,
  responseClock,
) {
  assertExactRecord(
    value,
    COMMITMENT_DECISION_KEYS,
    "keyed commitment decision",
    EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
  );
  let requestedAt;
  let checkedAt;
  let decisionExpiresAt;
  try {
    requestedAt = normalizeTimestamp(
      value.requestedAt,
      "keyed commitment requestedAt",
    );
    checkedAt = normalizeTimestamp(
      value.checkedAt,
      "keyed commitment checkedAt",
    );
    decisionExpiresAt = normalizeTimestamp(
      value.decisionExpiresAt,
      "keyed commitment decisionExpiresAt",
    );
  } catch (cause) {
    throw projectionError(
      EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
      "keyed commitment decision contains an invalid timestamp",
      { cause },
    );
  }
  const requestedAtMs = new Date(requestedAt).getTime();
  const checkedAtMs = new Date(checkedAt).getTime();
  const decisionExpiresAtMs = new Date(decisionExpiresAt).getTime();
  const decisionCore = { ...value };
  delete decisionCore.commitmentReceiptDigest;
  const expectsTrustedPayload = expected.trustedPayloadInputDigest !== null;
  const failures = [
    [value.schema === EVOLUTION_KEYED_COMMITMENT_SCHEMA, "schema"],
    [value.committed === true, "committed"],
    [value.tenantId === expected.tenantId, "tenant"],
    [value.algorithm === "hmac-sha256", "algorithm"],
    [
      Number.isSafeInteger(value.keyVersion) && value.keyVersion >= 1,
      "key-version",
    ],
    [value.sourcePurpose === SOURCE_COMMITMENT_PURPOSE, "source-purpose"],
    [
      value.sourceInputDigest === expected.sourceInputDigest,
      "source-input-digest",
    ],
    [COMMITMENT_PATTERN.test(value.sourceCommitment), "source-commitment"],
    [
      value.trustedPayloadPurpose === TRUSTED_PAYLOAD_COMMITMENT_PURPOSE,
      "trusted-payload-purpose",
    ],
    [
      value.trustedPayloadInputDigest === expected.trustedPayloadInputDigest,
      "trusted-payload-input-digest",
    ],
    [
      expectsTrustedPayload
        ? COMMITMENT_PATTERN.test(value.trustedPayloadCommitment)
        : value.trustedPayloadCommitment === null,
      "trusted-payload-commitment",
    ],
    [
      STATE_NONCE_PATTERN.test(value.requestNonce) &&
        value.requestNonce === expected.requestNonce,
      "request-nonce",
    ],
    [
      requestedAt === value.requestedAt &&
        value.requestedAt === requestClock.iso,
      "requested-at",
    ],
    [checkedAt === value.checkedAt, "checked-at-canonical"],
    [decisionExpiresAt === value.decisionExpiresAt, "expiry-canonical"],
    [
      checkedAtMs >= requestedAtMs - STATE_CLOCK_SKEW_MS,
      "checked-before-request",
    ],
    [
      checkedAtMs <= responseClock.milliseconds + STATE_CLOCK_SKEW_MS,
      "checked-at-future",
    ],
    [decisionExpiresAtMs > responseClock.milliseconds, "decision-expired"],
    [decisionExpiresAtMs > checkedAtMs, "expiry-before-check"],
    [
      decisionExpiresAtMs - checkedAtMs <= STATE_DECISION_MAX_TTL_MS,
      "decision-too-long",
    ],
    [
      Number.isSafeInteger(value.policyRevision) && value.policyRevision >= 1,
      "policy-revision",
    ],
    [DIGEST_PATTERN.test(value.policyDigest), "policy-digest"],
    [
      value.commitmentReceiptDigest ===
        digest(decisionCore, "chainlesschain.evolution-keyed-commitment/v1"),
      "receipt-digest",
    ],
  ]
    .filter(([passed]) => !passed)
    .map(([, label]) => label);
  if (failures.length > 0) {
    throw projectionError(
      EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
      "keyed commitment port returned an invalid or unbound decision",
      { failures },
    );
  }
  let keyId;
  try {
    keyId = normalizeOpaqueUri(value.keyId, {
      label: "keyed commitment keyId",
      schemes: new Set(["kms"]),
      tenantId: expected.tenantId,
    });
    normalizeDigest(
      value.policyDigest,
      "keyed commitment policy digest",
      EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
    );
    normalizeDigest(
      value.commitmentReceiptDigest,
      "keyed commitment receipt digest",
      EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
    );
    normalizeCommitment(
      value.sourceCommitment,
      "source commitment",
      EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
    );
    if (expectsTrustedPayload) {
      normalizeCommitment(
        value.trustedPayloadCommitment,
        "trusted payload commitment",
        EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
      );
    }
  } catch (cause) {
    if (cause?.code === EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE) {
      throw cause;
    }
    throw projectionError(
      EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
      "keyed commitment decision contains invalid key metadata",
      { cause },
    );
  }
  return deepFreeze({
    ...cloneCanonical(value),
    keyId,
    requestedAtMs,
    checkedAtMs,
    decisionExpiresAtMs,
  });
}

function validateStorageReceipt(value, expected, requestClock, responseClock) {
  assertExactRecord(
    value,
    STORAGE_RECEIPT_KEYS,
    "Raw storage receipt",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  const requestedAt = normalizeTimestamp(
    value.requestedAt,
    "Raw storage requestedAt",
  );
  const storedAt = normalizeTimestamp(value.storedAt, "Raw storage storedAt");
  const policyExpiresAt = normalizeTimestamp(
    value.storagePolicyDecisionExpiresAt,
    "Raw storage policy decisionExpiresAt",
  );
  const requestedAtMs = new Date(requestedAt).getTime();
  const storedAtMs = new Date(storedAt).getTime();
  const policyExpiresAtMs = new Date(policyExpiresAt).getTime();
  const core = { ...value };
  delete core.receiptDigest;
  if (
    value.schema !== EVOLUTION_RAW_STORAGE_RECEIPT_SCHEMA ||
    value.stored !== true ||
    value.tenantId !== expected.tenantId ||
    value.evidenceId !== expected.evidenceId ||
    value.sourceCommitment !== expected.sourceCommitment ||
    value.commitmentReceiptDigest !== expected.commitmentReceiptDigest ||
    value.sourceVerificationReceiptDigest !==
      expected.sourceVerificationReceiptDigest ||
    value.storagePolicyReceiptDigest !== expected.storagePolicyReceiptDigest ||
    value.storagePolicyDigest !== expected.storagePolicyDigest ||
    value.storagePolicyRevision !== expected.storagePolicyRevision ||
    value.storagePolicyDecisionExpiresAt !==
      expected.storagePolicyDecisionExpiresAt ||
    !STATE_NONCE_PATTERN.test(value.requestNonce) ||
    value.requestNonce !== expected.requestNonce ||
    requestedAt !== value.requestedAt ||
    requestedAt !== requestClock.iso ||
    storedAt !== value.storedAt ||
    policyExpiresAt !== value.storagePolicyDecisionExpiresAt ||
    storedAtMs < requestedAtMs - STATE_CLOCK_SKEW_MS ||
    storedAtMs > responseClock.milliseconds + STATE_CLOCK_SKEW_MS ||
    storedAtMs >= policyExpiresAtMs ||
    responseClock.milliseconds >= policyExpiresAtMs ||
    value.sensitivity !== expected.sensitivity ||
    value.algorithm !== "aes-256-gcm" ||
    value.aadDigest !==
      digest(expected.aad, "chainlesschain.evolution-raw-storage-aad/v1") ||
    normalizeDigest(
      value.receiptDigest,
      "storage receipt digest",
      EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
    ) !== digest(core, "chainlesschain.evolution-raw-storage-receipt/v1")
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
      "Raw storage receipt is invalid or unbound",
    );
  }
  normalizeCommitment(
    value.sourceCommitment,
    "storage source commitment",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  normalizeDigest(
    value.commitmentReceiptDigest,
    "storage commitment receipt digest",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  normalizeDigest(
    value.cipherDigest,
    "cipher digest",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  normalizeDigest(
    value.aadDigest,
    "AAD digest",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  normalizeDigest(
    value.storagePolicyDigest,
    "storage policy digest",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  if (
    !Number.isSafeInteger(value.storagePolicyRevision) ||
    value.storagePolicyRevision < 1
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
      "storage policy revision is invalid",
    );
  }
  const artifactRef = normalizeOpaqueUri(value.artifactRef, {
    label: "Raw artifact ref",
    schemes: new Set(["artifact"]),
    tenantId: expected.tenantId,
  });
  const keyRef = normalizeOpaqueUri(value.keyRef, {
    label: "Raw key ref",
    schemes: new Set(["kms"]),
    tenantId: expected.tenantId,
  });
  const retention = normalizeRetention(
    value.retention,
    responseClock.milliseconds,
  );
  const acl = normalizeAcl(value.acl, expected.principalId);
  if (
    canonicalJson(retention) !== canonicalJson(expected.retention) ||
    canonicalJson(acl) !== canonicalJson(expected.acl)
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
      "Raw storage receipt changed the trusted retention or ACL policy",
    );
  }
  return deepFreeze({
    ...cloneCanonical(value),
    artifactRef,
    keyRef,
    retention,
    acl,
    requestedAtMs,
    storedAtMs,
    policyExpiresAtMs,
  });
}

function validateStoragePolicy(value, expected, requestClock, responseClock) {
  assertExactRecord(
    value,
    STORAGE_POLICY_KEYS,
    "Raw storage policy",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  const requestedAt = normalizeTimestamp(
    value.requestedAt,
    "storage policy requestedAt",
  );
  const checkedAt = normalizeTimestamp(
    value.checkedAt,
    "storage policy checkedAt",
  );
  const decisionExpiresAt = normalizeTimestamp(
    value.decisionExpiresAt,
    "storage policy decisionExpiresAt",
  );
  const requestedAtMs = new Date(requestedAt).getTime();
  const checkedAtMs = new Date(checkedAt).getTime();
  const decisionExpiresAtMs = new Date(decisionExpiresAt).getTime();
  const policyCore = { ...value };
  delete policyCore.policyReceiptDigest;
  const failures = [
    [value.schema === EVOLUTION_RAW_STORAGE_POLICY_SCHEMA, "schema"],
    [value.allowed === true, "allowed"],
    [value.tenantId === expected.tenantId, "tenant"],
    [value.principalId === expected.principalId, "principal"],
    [value.sourceKind === expected.sourceKind, "source-kind"],
    [value.sourceCommitment === expected.sourceCommitment, "source-commitment"],
    [
      value.commitmentReceiptDigest === expected.commitmentReceiptDigest,
      "commitment-receipt",
    ],
    [
      value.sourceVerificationReceiptDigest ===
        expected.sourceVerificationReceiptDigest,
      "source-verification",
    ],
    [value.sensitivity === expected.sensitivity, "sensitivity"],
    [
      STATE_NONCE_PATTERN.test(value.requestNonce) &&
        value.requestNonce === expected.requestNonce,
      "request-nonce",
    ],
    [
      requestedAt === value.requestedAt &&
        value.requestedAt === requestClock.iso,
      "requested-at",
    ],
    [checkedAt === value.checkedAt, "checked-at-canonical"],
    [decisionExpiresAt === value.decisionExpiresAt, "expiry-canonical"],
    [
      checkedAtMs >= requestedAtMs - STATE_CLOCK_SKEW_MS,
      "checked-before-request",
    ],
    [
      checkedAtMs <= responseClock.milliseconds + STATE_CLOCK_SKEW_MS,
      "checked-at-future",
    ],
    [decisionExpiresAtMs > responseClock.milliseconds, "decision-expired"],
    [decisionExpiresAtMs > checkedAtMs, "expiry-before-check"],
    [
      decisionExpiresAtMs - checkedAtMs <= STATE_DECISION_MAX_TTL_MS,
      "decision-too-long",
    ],
    [
      Number.isSafeInteger(value.policyRevision) && value.policyRevision >= 1,
      "policy-revision",
    ],
    [DIGEST_PATTERN.test(value.policyDigest), "policy-digest"],
    [
      value.policyReceiptDigest ===
        digest(policyCore, "chainlesschain.evolution-raw-storage-policy/v1"),
      "receipt-digest",
    ],
  ]
    .filter(([passed]) => !passed)
    .map(([, label]) => label);
  if (failures.length > 0) {
    throw projectionError(
      EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
      "Raw storage policy denied or returned an unbound decision",
      { failures },
    );
  }
  normalizeDigest(
    value.policyReceiptDigest,
    "Raw storage policy receipt",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  normalizeDigest(
    value.policyDigest,
    "Raw storage policy digest",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  normalizeCommitment(
    value.sourceCommitment,
    "Raw storage policy source commitment",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  normalizeDigest(
    value.commitmentReceiptDigest,
    "Raw storage policy commitment receipt",
    EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
  );
  return deepFreeze({
    ...cloneCanonical(value),
    retention: normalizeRetention(value.retention, responseClock.milliseconds),
    acl: normalizeAcl(value.acl, expected.principalId),
    requestedAtMs,
    checkedAtMs,
    decisionExpiresAtMs,
  });
}

function buildRawRecord(source, commitment, evidenceId, storage) {
  const core = {
    schema: EVOLUTION_RAW_RECORD_SCHEMA,
    evidenceId,
    tenantId: source.tenantId,
    principalId: source.principalId,
    sourceKind: source.sourceKind,
    trust: source.trust,
    authenticated: source.authenticated,
    sourceRef: source.sourceRef,
    sourceCommitment: commitment.sourceCommitment,
    commitmentAlgorithm: commitment.algorithm,
    commitmentKeyId: commitment.keyId,
    commitmentKeyVersion: commitment.keyVersion,
    commitmentPolicyDigest: commitment.policyDigest,
    commitmentPolicyRevision: commitment.policyRevision,
    commitmentReceiptDigest: commitment.commitmentReceiptDigest,
    sourceVerificationReceiptDigest: source.verificationReceiptDigest,
    storagePolicyReceiptDigest: storage.storagePolicyReceiptDigest,
    storagePolicyDigest: storage.storagePolicyDigest,
    storagePolicyRevision: storage.storagePolicyRevision,
    storagePolicyDecisionExpiresAt: storage.storagePolicyDecisionExpiresAt,
    storageRequestNonce: storage.requestNonce,
    storageRequestedAt: storage.requestedAt,
    storageStoredAt: storage.storedAt,
    schemaDigest: source.schemaDigest,
    compilable: source.compilable,
    trustedPayloadCommitment: commitment.trustedPayloadCommitment,
    encryptedRawArtifact: {
      ref: storage.artifactRef,
      digest: storage.cipherDigest,
      keyRef: storage.keyRef,
      algorithm: storage.algorithm,
      aadDigest: storage.aadDigest,
    },
    sensitivity: source.sensitivity,
    retention: storage.retention,
    acl: storage.acl,
    plaintextStored: false,
    storageReceiptDigest: storage.receiptDigest,
  };
  return deepFreeze({
    ...core,
    rawRecordDigest: digest(core, "chainlesschain.evolution-raw-record/v2"),
  });
}

function buildModelProjection(raw, sanitized) {
  const opaque = ["confidential", "restricted"].includes(raw.sensitivity);
  const core = {
    schema: EVOLUTION_MODEL_PROJECTION_SCHEMA,
    evidenceId: raw.evidenceId,
    tenantId: raw.tenantId,
    sourceKind: raw.sourceKind,
    trustLabel: raw.trust,
    sourceCommitment: raw.sourceCommitment,
    visibility: opaque ? "opaque" : "model-visible",
    content: opaque ? null : sanitized.content,
    redactionSummary: opaque
      ? { total: 0, byType: {}, paths: [] }
      : sanitized.redactionSummary,
    injectionFindings: opaque ? [] : sanitized.injectionFindings,
    truncated: opaque ? false : sanitized.truncated,
    rulesetDigest: RULESET_DIGEST,
  };
  return deepFreeze({
    ...core,
    projectionDigest: digest(
      core,
      "chainlesschain.evolution-model-projection/v2",
    ),
  });
}

function buildTrustedProjection(
  raw,
  source,
  model,
  trustedSanitized,
  trustedInputStructured,
) {
  const reasonCodes = trustedReasons(
    source,
    model,
    trustedSanitized,
    trustedInputStructured,
  );
  const status = reasonCodes.length === 0 ? "trusted" : "quarantined";
  const core = {
    schema: EVOLUTION_TRUSTED_PROJECTION_SCHEMA,
    evidenceId: raw.evidenceId,
    tenantId: raw.tenantId,
    sourceKind: raw.sourceKind,
    sourceCommitment: raw.sourceCommitment,
    modelProjectionDigest: model.projectionDigest,
    trustedPayloadCommitment: raw.trustedPayloadCommitment,
    trustedInputInjectionCount: trustedSanitized?.injectionFindings.length || 0,
    trustedInputStructured,
    status,
    reasonCodes,
    content: status === "trusted" ? trustedSanitized.content : null,
    rulesetDigest: RULESET_DIGEST,
  };
  return deepFreeze({
    ...core,
    projectionDigest: digest(
      core,
      "chainlesschain.evolution-trusted-projection/v2",
    ),
  });
}

function buildReceipt(raw, model, trusted, createdAt) {
  const core = {
    schema: EVOLUTION_PROJECTION_RECEIPT_SCHEMA,
    evidenceId: raw.evidenceId,
    tenantId: raw.tenantId,
    sourceCommitment: raw.sourceCommitment,
    commitmentReceiptDigest: raw.commitmentReceiptDigest,
    sourceVerificationReceiptDigest: raw.sourceVerificationReceiptDigest,
    storageReceiptDigest: raw.storageReceiptDigest,
    rawRecordDigest: raw.rawRecordDigest,
    modelProjectionDigest: model.projectionDigest,
    trustedProjectionDigest: trusted.projectionDigest,
    rulesetDigest: RULESET_DIGEST,
    redactionSummary: model.redactionSummary,
    injectionCount: model.injectionFindings.length,
    trustedStatus: trusted.status,
    createdAt,
  };
  return deepFreeze({
    ...core,
    receiptDigest: digest(
      core,
      "chainlesschain.evolution-projection-receipt/v2",
    ),
  });
}

function validateAttestation(value, receipt) {
  assertExactRecord(
    value,
    ATTESTATION_KEYS,
    "projection attestation",
    EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
  );
  const core = { ...value };
  delete core.attestationDigest;
  if (
    value.schema !== EVOLUTION_PROJECTION_ATTESTATION_SCHEMA ||
    value.receiptDigest !== receipt.receiptDigest ||
    value.tenantId !== receipt.tenantId ||
    value.evidenceId !== receipt.evidenceId ||
    !["ed25519", "hsm-ed25519"].includes(value.algorithm) ||
    typeof value.signature !== "string" ||
    !SIGNATURE_PATTERN.test(value.signature) ||
    normalizeDigest(
      value.trustPolicyDigest,
      "attestation trust policy",
      EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
    ) !== value.trustPolicyDigest ||
    normalizeDigest(
      value.attestationDigest,
      "attestation digest",
      EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
    ) !== digest(core, "chainlesschain.evolution-projection-attestation/v1")
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
      "projection attestation is invalid or unbound",
    );
  }
  normalizeId(value.keyId, "attestation keyId");
  normalizeId(value.issuer, "attestation issuer");
  return deepFreeze(cloneCanonical(value));
}

function validateEvidenceStateDecision(value, expected, now) {
  assertExactRecord(
    value,
    EVIDENCE_STATE_KEYS,
    "evidence state decision",
    EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
  );
  const checkedAt = normalizeTimestamp(value.checkedAt, "state checkedAt");
  const requestedAt = normalizeTimestamp(
    value.requestedAt,
    "state requestedAt",
  );
  const decisionExpiresAt = normalizeTimestamp(
    value.decisionExpiresAt,
    "state decisionExpiresAt",
  );
  const checkedAtMs = new Date(checkedAt).getTime();
  const requestedAtMs = new Date(requestedAt).getTime();
  const decisionExpiresAtMs = new Date(decisionExpiresAt).getTime();
  const stateCore = { ...value };
  delete stateCore.receiptDigest;
  const failures = [
    [value.schema === EVOLUTION_EVIDENCE_STATE_DECISION_SCHEMA, "schema"],
    [value.tenantId === expected.tenantId, "tenant"],
    [value.evidenceId === expected.evidenceId, "evidence"],
    [value.rawRecordDigest === expected.rawRecordDigest, "raw-record"],
    [
      value.projectionReceiptDigest === expected.projectionReceiptDigest,
      "projection-receipt",
    ],
    [value.attestationDigest === expected.attestationDigest, "attestation"],
    [Number.isSafeInteger(value.revision) && value.revision >= 1, "revision"],
    [
      STATE_NONCE_PATTERN.test(value.requestNonce) &&
        value.requestNonce === expected.requestNonce,
      "request-nonce",
    ],
    [
      requestedAt === value.requestedAt &&
        value.requestedAt === expected.requestedAt,
      "requested-at",
    ],
    [checkedAt === value.checkedAt, "checked-at-canonical"],
    [decisionExpiresAt === value.decisionExpiresAt, "expiry-canonical"],
    [
      checkedAtMs >= requestedAtMs - STATE_CLOCK_SKEW_MS,
      "checked-before-request",
    ],
    [
      checkedAtMs <= now.milliseconds + STATE_CLOCK_SKEW_MS,
      "checked-at-future",
    ],
    [
      now.milliseconds - checkedAtMs <= STATE_DECISION_MAX_TTL_MS,
      "checked-at-stale",
    ],
    [decisionExpiresAtMs > now.milliseconds, "decision-expired"],
    [decisionExpiresAtMs > checkedAtMs, "expiry-before-check"],
    [
      decisionExpiresAtMs - checkedAtMs <= STATE_DECISION_MAX_TTL_MS,
      "decision-too-long",
    ],
    [
      decisionExpiresAtMs <= expected.retentionExpiresAtMs,
      "retention-boundary",
    ],
    [
      ["active", "deleted", "revoked", "expired"].includes(value.status),
      "status",
    ],
    [typeof value.readable === "boolean", "readable"],
    [
      value.receiptDigest ===
        digest(
          stateCore,
          "chainlesschain.evolution-evidence-state-decision/v1",
        ),
      "receipt-digest",
    ],
  ]
    .filter(([passed]) => !passed)
    .map(([, label]) => label);
  if (failures.length > 0) {
    throw projectionError(
      EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
      "evidence state decision is invalid, stale, or unbound",
      { failures },
    );
  }
  normalizeDigest(
    value.receiptDigest,
    "evidence state receipt",
    EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
  );
  if (value.status === "active") {
    if (value.readable !== true || value.tombstoneReceiptDigest !== null) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "active evidence state is internally inconsistent",
      );
    }
  } else {
    if (value.readable !== false) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "inactive evidence state cannot be readable",
      );
    }
    normalizeDigest(
      value.tombstoneReceiptDigest,
      "evidence tombstone receipt",
      EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
    );
  }
  return deepFreeze({
    ...cloneCanonical(value),
    requestedAtMs,
    checkedAtMs,
    decisionExpiresAtMs,
  });
}

function validatePrincipalDecision(
  value,
  expected,
  requestClock,
  responseClock,
) {
  assertExactRecord(
    value,
    PRINCIPAL_KEYS,
    "projection principal",
    EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
  );
  const requestedAt = normalizeTimestamp(
    value.requestedAt,
    "principal requestedAt",
  );
  const checkedAt = normalizeTimestamp(value.checkedAt, "principal checkedAt");
  const decisionExpiresAt = normalizeTimestamp(
    value.decisionExpiresAt,
    "principal decisionExpiresAt",
  );
  const expiresAt = normalizeTimestamp(value.expiresAt, "principal expiresAt");
  const requestedAtMs = new Date(requestedAt).getTime();
  const checkedAtMs = new Date(checkedAt).getTime();
  const decisionExpiresAtMs = new Date(decisionExpiresAt).getTime();
  const expiresAtMs = new Date(expiresAt).getTime();
  const core = { ...value };
  delete core.receiptDigest;
  const rolesValid =
    Array.isArray(value.roles) &&
    value.roles.length <= 32 &&
    new Set(value.roles).size === value.roles.length &&
    value.roles.every(
      (role) => typeof role === "string" && SAFE_ID_PATTERN.test(role),
    );
  const failures = [
    [value.schema === EVOLUTION_PROJECTION_PRINCIPAL_SCHEMA, "schema"],
    [value.authenticated === true, "authenticated"],
    [value.tenantId === expected.tenantId, "tenant"],
    [
      value.principalEnvelopeDigest === expected.principalEnvelopeDigest,
      "principal-envelope",
    ],
    [value.action === expected.action, "action"],
    [value.purpose === expected.purpose, "purpose"],
    [rolesValid, "roles"],
    [expiresAt === value.expiresAt, "principal-expiry-canonical"],
    [expiresAtMs > responseClock.milliseconds, "principal-expired"],
    [
      STATE_NONCE_PATTERN.test(value.requestNonce) &&
        value.requestNonce === expected.requestNonce,
      "request-nonce",
    ],
    [
      requestedAt === value.requestedAt &&
        value.requestedAt === requestClock.iso,
      "requested-at",
    ],
    [checkedAt === value.checkedAt, "checked-at-canonical"],
    [decisionExpiresAt === value.decisionExpiresAt, "expiry-canonical"],
    [
      checkedAtMs >= requestedAtMs - STATE_CLOCK_SKEW_MS,
      "checked-before-request",
    ],
    [
      checkedAtMs <= responseClock.milliseconds + STATE_CLOCK_SKEW_MS,
      "checked-at-future",
    ],
    [decisionExpiresAtMs > responseClock.milliseconds, "decision-expired"],
    [decisionExpiresAtMs > checkedAtMs, "expiry-before-check"],
    [decisionExpiresAtMs <= expiresAtMs, "principal-expiry-boundary"],
    [
      decisionExpiresAtMs - checkedAtMs <= STATE_DECISION_MAX_TTL_MS,
      "decision-too-long",
    ],
    [
      Number.isSafeInteger(value.policyRevision) && value.policyRevision >= 1,
      "policy-revision",
    ],
    [DIGEST_PATTERN.test(value.policyDigest), "policy-digest"],
    [
      value.receiptDigest ===
        digest(core, "chainlesschain.evolution-projection-principal/v1"),
      "receipt-digest",
    ],
  ]
    .filter(([passed]) => !passed)
    .map(([, label]) => label);
  if (failures.length > 0) {
    throw projectionError(
      EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
      "projection principal is invalid, stale, or unbound",
      { failures },
    );
  }
  normalizeId(value.principalId, "projection principalId");
  normalizeDigest(
    value.policyDigest,
    "principal policy digest",
    EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
  );
  normalizeDigest(
    value.receiptDigest,
    "principal receipt",
    EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
  );
  return deepFreeze({
    ...cloneCanonical(value),
    requestedAtMs,
    checkedAtMs,
    decisionExpiresAtMs,
    expiresAtMs,
  });
}

function validateAccessDecision(value, expected, requestClock, responseClock) {
  assertExactRecord(
    value,
    ACCESS_KEYS,
    "projection access decision",
    EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
  );
  const requestedAt = normalizeTimestamp(
    value.requestedAt,
    "access requestedAt",
  );
  const checkedAt = normalizeTimestamp(value.checkedAt, "access checkedAt");
  const decisionExpiresAt = normalizeTimestamp(
    value.decisionExpiresAt,
    "access decisionExpiresAt",
  );
  const requestedAtMs = new Date(requestedAt).getTime();
  const checkedAtMs = new Date(checkedAt).getTime();
  const decisionExpiresAtMs = new Date(decisionExpiresAt).getTime();
  const core = { ...value };
  delete core.receiptDigest;
  const failures = [
    [value.schema === EVOLUTION_PROJECTION_ACCESS_DECISION_SCHEMA, "schema"],
    [value.allowed === true, "allowed"],
    [value.action === expected.action, "action"],
    [value.purpose === expected.purpose, "purpose"],
    [value.principalId === expected.principalId, "principal"],
    [
      value.principalReceiptDigest === expected.principalReceiptDigest,
      "principal-receipt",
    ],
    [
      value.evidenceStateReceiptDigest === expected.evidenceStateReceiptDigest,
      "evidence-state-receipt",
    ],
    [
      value.evidenceStateRevision === expected.evidenceStateRevision,
      "evidence-state-revision",
    ],
    [
      value.evidenceStateDecisionExpiresAt ===
        expected.evidenceStateDecisionExpiresAt,
      "evidence-state-expiry",
    ],
    [
      value.principalExpiresAt === expected.principalExpiresAt,
      "principal-expiry",
    ],
    [
      value.principalDecisionExpiresAt === expected.principalDecisionExpiresAt,
      "principal-decision-expiry",
    ],
    [value.tenantId === expected.tenantId, "tenant"],
    [value.evidenceId === expected.evidenceId, "evidence"],
    [value.sensitivity === expected.sensitivity, "sensitivity"],
    [
      value.projectionReceiptDigest === expected.projectionReceiptDigest,
      "projection-receipt",
    ],
    [value.retentionExpiresAt === expected.retentionExpiresAt, "retention"],
    [
      STATE_NONCE_PATTERN.test(value.requestNonce) &&
        value.requestNonce === expected.requestNonce,
      "request-nonce",
    ],
    [
      requestedAt === value.requestedAt &&
        value.requestedAt === requestClock.iso,
      "requested-at",
    ],
    [checkedAt === value.checkedAt, "checked-at-canonical"],
    [decisionExpiresAt === value.decisionExpiresAt, "expiry-canonical"],
    [
      checkedAtMs >= requestedAtMs - STATE_CLOCK_SKEW_MS,
      "checked-before-request",
    ],
    [
      checkedAtMs <= responseClock.milliseconds + STATE_CLOCK_SKEW_MS,
      "checked-at-future",
    ],
    [decisionExpiresAtMs > responseClock.milliseconds, "decision-expired"],
    [decisionExpiresAtMs > checkedAtMs, "expiry-before-check"],
    [
      decisionExpiresAtMs - checkedAtMs <= STATE_DECISION_MAX_TTL_MS,
      "decision-too-long",
    ],
    [
      decisionExpiresAtMs <= expected.principalExpiresAtMs,
      "principal-expiry-boundary",
    ],
    [
      decisionExpiresAtMs <= expected.principalDecisionExpiresAtMs,
      "principal-decision-boundary",
    ],
    [
      decisionExpiresAtMs <= expected.evidenceStateDecisionExpiresAtMs,
      "state-decision-boundary",
    ],
    [
      decisionExpiresAtMs <= expected.retentionExpiresAtMs,
      "retention-boundary",
    ],
    [
      Number.isSafeInteger(value.policyRevision) && value.policyRevision >= 1,
      "policy-revision",
    ],
    [DIGEST_PATTERN.test(value.policyDigest), "policy-digest"],
    [
      value.receiptDigest ===
        digest(core, "chainlesschain.evolution-projection-access-decision/v1"),
      "receipt-digest",
    ],
  ]
    .filter(([passed]) => !passed)
    .map(([, label]) => label);
  if (failures.length > 0) {
    throw projectionError(
      EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
      "projection access decision is denied, stale, or unbound",
      { failures },
    );
  }
  normalizeDigest(
    value.policyDigest,
    "access policy digest",
    EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
  );
  normalizeDigest(
    value.receiptDigest,
    "access receipt",
    EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
  );
  return deepFreeze({
    ...cloneCanonical(value),
    requestedAtMs,
    checkedAtMs,
    decisionExpiresAtMs,
  });
}

function verifyDigestRecord(value, keys, schema, field, domain, label) {
  assertExactRecord(value, keys, label);
  if (value.schema !== schema) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} schema is invalid`,
    );
  }
  const core = { ...value };
  delete core[field];
  if (
    normalizeDigest(value[field], `${label} ${field}`) !== digest(core, domain)
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      `${label} digest verification failed`,
    );
  }
}

function validateRedactionSummary(value) {
  assertExactRecord(value, REDACTION_SUMMARY_KEYS, "redaction summary");
  if (!isPlainRecord(value.byType) || !Array.isArray(value.paths)) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "redaction summary is invalid",
    );
  }
  let total = 0;
  for (const [type, count] of Object.entries(value.byType)) {
    if (
      !REDACTION_TYPES.has(type) ||
      !Number.isSafeInteger(count) ||
      count < 1
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "redaction count is invalid",
      );
    }
    total += count;
  }
  if (!Number.isSafeInteger(value.total) || value.total !== total) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "redaction total is invalid",
    );
  }
  if (
    new Set(value.paths).size !== value.paths.length ||
    value.paths.some(
      (path) => typeof path !== "string" || !path.startsWith("$"),
    )
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "redaction paths are invalid",
    );
  }
  assertNoKnownSecrets(value.paths);
  for (const path of value.paths) assertNoInjectionText(path);
  if (canonicalJson(value.paths) !== canonicalJson([...value.paths].sort())) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "redaction paths must be canonical",
    );
  }
}

function validateRawMetadata(raw, receipt) {
  const createdAt = normalizeTimestamp(receipt.createdAt, "receipt createdAt");
  if (createdAt !== receipt.createdAt) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "receipt createdAt must be canonical UTC",
    );
  }
  const createdAtMs = new Date(createdAt).getTime();
  normalizeId(raw.evidenceId, "Raw evidenceId");
  normalizeId(raw.tenantId, "Raw tenantId");
  normalizeId(raw.principalId, "Raw principalId");
  normalizeOpaqueUri(raw.sourceRef, {
    label: "Raw sourceRef",
    schemes: SOURCE_SCHEMES,
    tenantId: raw.tenantId,
  });
  normalizeCommitment(raw.sourceCommitment, "Raw sourceCommitment");
  for (const [label, value] of [
    ["Raw commitmentReceiptDigest", raw.commitmentReceiptDigest],
    ["Raw commitmentPolicyDigest", raw.commitmentPolicyDigest],
    [
      "Raw sourceVerificationReceiptDigest",
      raw.sourceVerificationReceiptDigest,
    ],
    ["Raw storagePolicyReceiptDigest", raw.storagePolicyReceiptDigest],
    ["Raw storagePolicyDigest", raw.storagePolicyDigest],
    ["Raw storageReceiptDigest", raw.storageReceiptDigest],
  ]) {
    normalizeDigest(value, label);
  }
  if (raw.commitmentAlgorithm !== "hmac-sha256") {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw commitment algorithm is invalid",
    );
  }
  normalizeOpaqueUri(raw.commitmentKeyId, {
    label: "Raw commitment keyId",
    schemes: new Set(["kms"]),
    tenantId: raw.tenantId,
  });
  if (
    !Number.isSafeInteger(raw.commitmentKeyVersion) ||
    raw.commitmentKeyVersion < 1 ||
    !Number.isSafeInteger(raw.commitmentPolicyRevision) ||
    raw.commitmentPolicyRevision < 1
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw commitment key or policy revision is invalid",
    );
  }
  if (
    !SOURCE_KINDS.includes(raw.sourceKind) ||
    !TRUST_LEVELS.includes(raw.trust) ||
    typeof raw.authenticated !== "boolean" ||
    typeof raw.compilable !== "boolean" ||
    !SENSITIVITY_LEVELS.includes(raw.sensitivity) ||
    raw.plaintextStored !== false
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw provenance metadata is invalid",
    );
  }
  if (raw.compilable) {
    normalizeDigest(raw.schemaDigest, "Raw schemaDigest");
    normalizeCommitment(
      raw.trustedPayloadCommitment,
      "Raw trustedPayloadCommitment",
    );
    if (
      raw.trust !== "trusted" ||
      !raw.authenticated ||
      !["tool-observation", "verified-outcome"].includes(raw.sourceKind)
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "compilable Raw provenance is not trusted",
      );
    }
  } else if (
    raw.schemaDigest !== null ||
    raw.trustedPayloadCommitment !== null
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "non-compilable Raw must not carry trusted payload metadata",
    );
  }
  assertExactRecord(
    raw.encryptedRawArtifact,
    ENCRYPTED_ARTIFACT_KEYS,
    "encrypted Raw artifact",
  );
  const artifact = raw.encryptedRawArtifact;
  if (artifact.algorithm !== "aes-256-gcm") {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "encrypted Raw artifact algorithm is invalid",
    );
  }
  normalizeOpaqueUri(artifact.ref, {
    label: "encrypted Raw artifact ref",
    schemes: new Set(["artifact"]),
    tenantId: raw.tenantId,
  });
  normalizeOpaqueUri(artifact.keyRef, {
    label: "encrypted Raw key ref",
    schemes: new Set(["kms"]),
    tenantId: raw.tenantId,
  });
  normalizeDigest(artifact.digest, "encrypted Raw digest");
  normalizeDigest(artifact.aadDigest, "encrypted Raw AAD digest");
  const expectedAad = {
    tenantId: raw.tenantId,
    evidenceId: raw.evidenceId,
    sourceCommitment: raw.sourceCommitment,
    commitmentReceiptDigest: raw.commitmentReceiptDigest,
    sourceVerificationReceiptDigest: raw.sourceVerificationReceiptDigest,
    storagePolicyReceiptDigest: raw.storagePolicyReceiptDigest,
    storagePolicyDigest: raw.storagePolicyDigest,
    storagePolicyRevision: raw.storagePolicyRevision,
    storagePolicyDecisionExpiresAt: raw.storagePolicyDecisionExpiresAt,
    requestNonce: raw.storageRequestNonce,
    requestedAt: raw.storageRequestedAt,
  };
  if (
    artifact.aadDigest !==
    digest(expectedAad, "chainlesschain.evolution-raw-storage-aad/v1")
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "encrypted Raw AAD is not bound to the evidence context",
    );
  }
  if (
    !Number.isSafeInteger(raw.storagePolicyRevision) ||
    raw.storagePolicyRevision < 1
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw storage policy revision is invalid",
    );
  }
  if (!STATE_NONCE_PATTERN.test(raw.storageRequestNonce)) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw storage request nonce is invalid",
    );
  }
  normalizeTimestamp(raw.storageRequestedAt, "Raw storage requestedAt");
  normalizeTimestamp(raw.storageStoredAt, "Raw storage storedAt");
  normalizeTimestamp(
    raw.storagePolicyDecisionExpiresAt,
    "Raw storage policy decisionExpiresAt",
  );
  const retention = normalizeRetention(raw.retention, createdAtMs);
  const acl = normalizeAcl(raw.acl, raw.principalId);
  if (
    canonicalJson(retention) !== canonicalJson(raw.retention) ||
    canonicalJson(acl) !== canonicalJson(raw.acl)
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw retention or ACL is non-canonical",
    );
  }
  const storageCore = {
    schema: EVOLUTION_RAW_STORAGE_RECEIPT_SCHEMA,
    stored: true,
    tenantId: raw.tenantId,
    evidenceId: raw.evidenceId,
    sourceCommitment: raw.sourceCommitment,
    commitmentReceiptDigest: raw.commitmentReceiptDigest,
    sourceVerificationReceiptDigest: raw.sourceVerificationReceiptDigest,
    storagePolicyReceiptDigest: raw.storagePolicyReceiptDigest,
    storagePolicyDigest: raw.storagePolicyDigest,
    storagePolicyRevision: raw.storagePolicyRevision,
    storagePolicyDecisionExpiresAt: raw.storagePolicyDecisionExpiresAt,
    requestNonce: raw.storageRequestNonce,
    requestedAt: raw.storageRequestedAt,
    storedAt: raw.storageStoredAt,
    artifactRef: artifact.ref,
    cipherDigest: artifact.digest,
    keyRef: artifact.keyRef,
    algorithm: artifact.algorithm,
    aadDigest: artifact.aadDigest,
    sensitivity: raw.sensitivity,
    retention: raw.retention,
    acl: raw.acl,
  };
  if (
    digest(storageCore, "chainlesschain.evolution-raw-storage-receipt/v1") !==
    raw.storageReceiptDigest
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "Raw storage receipt lineage is invalid",
    );
  }
}

function validateBundleIntegrity(bundle) {
  assertExactRecord(
    bundle,
    new Set([
      "rawRecord",
      "modelProjection",
      "trustedProjection",
      "receipt",
      "attestation",
    ]),
    "evidence projection bundle",
  );
  const {
    rawRecord: raw,
    modelProjection: model,
    trustedProjection: trusted,
    receipt,
  } = bundle;
  verifyDigestRecord(
    raw,
    RAW_KEYS,
    EVOLUTION_RAW_RECORD_SCHEMA,
    "rawRecordDigest",
    "chainlesschain.evolution-raw-record/v2",
    "Raw record",
  );
  verifyDigestRecord(
    model,
    MODEL_KEYS,
    EVOLUTION_MODEL_PROJECTION_SCHEMA,
    "projectionDigest",
    "chainlesschain.evolution-model-projection/v2",
    "model projection",
  );
  verifyDigestRecord(
    trusted,
    TRUSTED_KEYS,
    EVOLUTION_TRUSTED_PROJECTION_SCHEMA,
    "projectionDigest",
    "chainlesschain.evolution-trusted-projection/v2",
    "trusted projection",
  );
  verifyDigestRecord(
    receipt,
    RECEIPT_KEYS,
    EVOLUTION_PROJECTION_RECEIPT_SCHEMA,
    "receiptDigest",
    "chainlesschain.evolution-projection-receipt/v2",
    "projection receipt",
  );
  validateRawMetadata(raw, receipt);
  validateRedactionSummary(model.redactionSummary);
  if (
    !Array.isArray(model.injectionFindings) ||
    model.injectionFindings.length > RULESET.maxNodes * 2
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "injection findings are invalid",
    );
  }
  for (const finding of model.injectionFindings) {
    assertExactRecord(finding, INJECTION_FINDING_KEYS, "injection finding");
    if (
      typeof finding.path !== "string" ||
      !Array.isArray(finding.patternIds) ||
      finding.patternIds.length < 1 ||
      new Set(finding.patternIds).size !== finding.patternIds.length ||
      finding.patternIds.some(
        (item) =>
          !DIGEST_PATTERN.test(item) ||
          !ALLOWED_INJECTION_PATTERN_IDS.has(item),
      )
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "injection finding is invalid",
      );
    }
    assertNoKnownSecrets(finding.path);
    assertNoInjectionText(finding.path);
  }
  if (
    !Number.isSafeInteger(trusted.trustedInputInjectionCount) ||
    trusted.trustedInputInjectionCount < 0 ||
    trusted.trustedInputInjectionCount > RULESET.maxNodes * 2
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "trusted input injection count is invalid",
    );
  }
  if (typeof trusted.trustedInputStructured !== "boolean") {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "trusted input structure decision is invalid",
    );
  }
  const expectedReasons = trustedReasons(
    {
      trust: raw.trust,
      authenticated: raw.authenticated,
      sourceKind: raw.sourceKind,
      compilable: raw.compilable,
      trustedPayload: raw.trustedPayloadCommitment === null ? null : {},
      sensitivity: raw.sensitivity,
    },
    model,
    {
      injectionFindings: Array.from({
        length: trusted.trustedInputInjectionCount,
      }),
    },
    trusted.trustedInputStructured,
  );
  const expectedStatus =
    expectedReasons.length === 0 ? "trusted" : "quarantined";
  if (
    model.evidenceId !== raw.evidenceId ||
    trusted.evidenceId !== raw.evidenceId ||
    receipt.evidenceId !== raw.evidenceId ||
    model.tenantId !== raw.tenantId ||
    trusted.tenantId !== raw.tenantId ||
    receipt.tenantId !== raw.tenantId ||
    model.sourceCommitment !== raw.sourceCommitment ||
    trusted.sourceCommitment !== raw.sourceCommitment ||
    receipt.sourceCommitment !== raw.sourceCommitment ||
    model.sourceKind !== raw.sourceKind ||
    trusted.sourceKind !== raw.sourceKind ||
    model.trustLabel !== raw.trust ||
    model.visibility !==
      (["confidential", "restricted"].includes(raw.sensitivity)
        ? "opaque"
        : "model-visible") ||
    typeof model.truncated !== "boolean" ||
    trusted.modelProjectionDigest !== model.projectionDigest ||
    trusted.trustedPayloadCommitment !== raw.trustedPayloadCommitment ||
    receipt.commitmentReceiptDigest !== raw.commitmentReceiptDigest ||
    receipt.rawRecordDigest !== raw.rawRecordDigest ||
    receipt.sourceVerificationReceiptDigest !==
      raw.sourceVerificationReceiptDigest ||
    receipt.storageReceiptDigest !== raw.storageReceiptDigest ||
    receipt.modelProjectionDigest !== model.projectionDigest ||
    receipt.trustedProjectionDigest !== trusted.projectionDigest ||
    receipt.injectionCount !== model.injectionFindings.length ||
    canonicalJson(receipt.redactionSummary) !==
      canonicalJson(model.redactionSummary) ||
    receipt.trustedStatus !== trusted.status ||
    model.rulesetDigest !== RULESET_DIGEST ||
    trusted.rulesetDigest !== RULESET_DIGEST ||
    receipt.rulesetDigest !== RULESET_DIGEST ||
    trusted.status !== expectedStatus ||
    canonicalJson(trusted.reasonCodes) !== canonicalJson(expectedReasons) ||
    (trusted.status === "quarantined" && trusted.content !== null) ||
    (trusted.status === "trusted" && trusted.content === null) ||
    (trusted.status === "trusted" &&
      !isStructuredTrustedPayload(trusted.content)) ||
    (["confidential", "restricted"].includes(raw.sensitivity) &&
      (model.visibility !== "opaque" ||
        model.content !== null ||
        model.redactionSummary.total !== 0 ||
        Object.keys(model.redactionSummary.byType).length !== 0 ||
        model.redactionSummary.paths.length !== 0 ||
        model.injectionFindings.length !== 0 ||
        model.truncated !== false))
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "projection lineage or policy verification failed",
    );
  }
  if (
    !Number.isSafeInteger(receipt.injectionCount) ||
    receipt.injectionCount < 0 ||
    Buffer.byteLength(canonicalJson(model.content), "utf8") >
      RULESET.maxModelBytes
  ) {
    throw projectionError(
      EVOLUTION_PROJECTION_INVALID_CODE,
      "projection budget metadata is invalid",
    );
  }
  if (model.content !== null) {
    assertNoKnownSecrets(model.content);
    assertNoInjectionText(model.content);
  }
  if (trusted.content !== null) {
    assertNoKnownSecrets(trusted.content);
    assertNoInjectionText(trusted.content);
  }
  const attestation = validateAttestation(bundle.attestation, receipt);
  return deepFreeze({
    rawRecord: raw,
    modelProjection: model,
    trustedProjection: trusted,
    receipt,
    attestation,
  });
}

function capturePort(port, method, label) {
  const implementation = port?.[method];
  if (typeof implementation !== "function") {
    throw new TypeError(
      `evolution evidence boundary requires ${label}.${method}`,
    );
  }
  return implementation.bind(port);
}

async function verifyAttestedBundle(verifyAttestation, bundle, clock) {
  const verified = validateBundleIntegrity(bundle);
  const requestClock = clock();
  const verificationRequest = deepFreeze({
    receiptDigest: verified.receipt.receiptDigest,
    tenantId: verified.receipt.tenantId,
    evidenceId: verified.receipt.evidenceId,
    attestationDigest: verified.attestation.attestationDigest,
    issuer: verified.attestation.issuer,
    keyId: verified.attestation.keyId,
    trustPolicyDigest: verified.attestation.trustPolicyDigest,
    requestNonce: randomBytes(16).toString("hex"),
    requestedAt: requestClock.iso,
  });
  let decision;
  try {
    decision = await verifyAttestation(
      verified.attestation,
      verificationRequest,
    );
  } catch (cause) {
    throw projectionError(
      EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
      "projection attestation verification failed",
      { cause },
    );
  }
  const responseClock = clock();
  if (responseClock.milliseconds < requestClock.milliseconds) {
    throw projectionError(
      EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
      "projection clock moved backwards during attestation verification",
    );
  }
  assertExactRecord(
    decision,
    ATTESTATION_VERIFICATION_KEYS,
    "attestation verification",
    EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
  );
  for (const field of [
    "attestationDigest",
    "receiptDigest",
    "tenantId",
    "evidenceId",
    "issuer",
    "keyId",
    "trustPolicyDigest",
  ]) {
    if (decision[field] !== verified.attestation[field]) {
      throw projectionError(
        EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
        `attestation verification is not bound to ${field}`,
      );
    }
  }
  const requestedAt = normalizeTimestamp(
    decision.requestedAt,
    "attestation verification requestedAt",
  );
  const checkedAt = normalizeTimestamp(
    decision.checkedAt,
    "attestation verification checkedAt",
  );
  const decisionExpiresAt = normalizeTimestamp(
    decision.decisionExpiresAt,
    "attestation verification decisionExpiresAt",
  );
  const requestedAtMs = new Date(requestedAt).getTime();
  const checkedAtMs = new Date(checkedAt).getTime();
  const decisionExpiresAtMs = new Date(decisionExpiresAt).getTime();
  const decisionCore = { ...decision };
  delete decisionCore.verificationReceiptDigest;
  const failures = [
    [
      decision.schema === EVOLUTION_PROJECTION_ATTESTATION_VERIFICATION_SCHEMA,
      "schema",
    ],
    [decision.verified === true, "verified"],
    [
      decision.requestNonce === verificationRequest.requestNonce &&
        STATE_NONCE_PATTERN.test(decision.requestNonce),
      "request-nonce",
    ],
    [
      requestedAt === decision.requestedAt && requestedAt === requestClock.iso,
      "requested-at",
    ],
    [checkedAt === decision.checkedAt, "checked-at-canonical"],
    [decisionExpiresAt === decision.decisionExpiresAt, "expiry-canonical"],
    [
      checkedAtMs >= requestedAtMs - STATE_CLOCK_SKEW_MS,
      "checked-before-request",
    ],
    [
      checkedAtMs <= responseClock.milliseconds + STATE_CLOCK_SKEW_MS,
      "checked-at-future",
    ],
    [decisionExpiresAtMs > responseClock.milliseconds, "decision-expired"],
    [decisionExpiresAtMs > checkedAtMs, "expiry-before-check"],
    [
      decisionExpiresAtMs - checkedAtMs <= STATE_DECISION_MAX_TTL_MS,
      "decision-too-long",
    ],
    [
      Number.isSafeInteger(decision.trustPolicyRevision) &&
        decision.trustPolicyRevision >= 1,
      "trust-policy-revision",
    ],
    [
      decision.verificationReceiptDigest ===
        digest(
          decisionCore,
          "chainlesschain.evolution-attestation-verification/v1",
        ),
      "receipt-digest",
    ],
  ]
    .filter(([passed]) => !passed)
    .map(([, label]) => label);
  if (failures.length > 0) {
    throw projectionError(
      EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
      "attestation verifier denied the bundle or returned a stale decision",
      { failures },
    );
  }
  normalizeDigest(
    decision.verificationReceiptDigest,
    "attestation verification receipt",
    EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
  );
  // The digest binds the captured verifier port's decision; authenticity and
  // current key revocation status remain responsibilities of that trusted port.
  return deepFreeze({
    bundle: verified,
    responseClock,
    decisionExpiresAtMs,
  });
}

export class EvolutionEvidenceProjector {
  #verifySource;
  #commitEvidence;
  #resolveStoragePolicy;
  #storeRaw;
  #signAttestation;
  #verifyAttestation;
  #idGenerator;
  #now;

  constructor({
    sourceVerifier,
    keyedCommitter,
    storagePolicy,
    rawStore,
    attestationSigner,
    attestationVerifier,
    idGenerator,
    now = () => new Date(),
  } = {}) {
    this.#verifySource = capturePort(
      sourceVerifier,
      "verify",
      "sourceVerifier",
    );
    this.#commitEvidence = capturePort(
      keyedCommitter,
      "commit",
      "keyedCommitter",
    );
    this.#resolveStoragePolicy = capturePort(
      storagePolicy,
      "resolve",
      "storagePolicy",
    );
    this.#storeRaw = capturePort(rawStore, "putEncrypted", "rawStore");
    this.#signAttestation = capturePort(
      attestationSigner,
      "sign",
      "attestationSigner",
    );
    this.#verifyAttestation = capturePort(
      attestationVerifier,
      "verify",
      "attestationVerifier",
    );
    if (typeof idGenerator !== "function") {
      throw new TypeError("EvolutionEvidenceProjector requires idGenerator");
    }
    if (typeof now !== "function") {
      throw new TypeError("EvolutionEvidenceProjector now must be a function");
    }
    this.#idGenerator = idGenerator;
    this.#now = now;
    Object.freeze(this);
  }

  #clock() {
    const iso = normalizeTimestamp(this.#now(), "projection clock");
    return { iso, milliseconds: new Date(iso).getTime() };
  }

  async project(input) {
    assertExactRecord(input, INPUT_KEYS, "evidence projection input");
    if (
      typeof input.sourceEnvelope !== "string" ||
      input.sourceEnvelope.length < 1 ||
      input.sourceEnvelope.length > 8192
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_INVALID_CODE,
        "sourceEnvelope is invalid",
      );
    }
    const payload = cloneCanonical(input.payload);
    const sourceInputDigest = digest(
      payload,
      "chainlesschain.evolution-raw-plaintext/v2",
    );
    const sourceEnvelopeDigest = digest(
      input.sourceEnvelope,
      "chainlesschain.evolution-source-envelope/v1",
    );
    const sourceClock = this.#clock();
    const sourceRequest = deepFreeze({
      sourceEnvelope: input.sourceEnvelope,
      sourceEnvelopeDigest,
      sourceInputDigest,
      payload,
      requestNonce: randomBytes(16).toString("hex"),
      requestedAt: sourceClock.iso,
    });
    let sourceDecision;
    try {
      sourceDecision = await this.#verifySource(sourceRequest);
    } catch (cause) {
      throw projectionError(
        EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
        "trusted source verification failed",
        { cause },
      );
    }
    const sourceResponseClock = this.#clock();
    if (sourceResponseClock.milliseconds < sourceClock.milliseconds) {
      throw projectionError(
        EVOLUTION_PROJECTION_SOURCE_DENIED_CODE,
        "projection clock moved backwards during source verification",
      );
    }
    const source = validateSourceVerification(
      sourceDecision,
      {
        sourceEnvelopeDigest,
        sourceInputDigest,
        requestNonce: sourceRequest.requestNonce,
      },
      sourceClock,
      sourceResponseClock,
    );
    const trustedPayloadInputDigest = source.compilable
      ? digest(
          source.trustedPayload,
          "chainlesschain.evolution-trusted-source-payload/v1",
        )
      : null;
    const commitmentClock = this.#clock();
    const commitmentRequest = deepFreeze({
      tenantId: source.tenantId,
      sourcePurpose: SOURCE_COMMITMENT_PURPOSE,
      sourceInputDigest,
      trustedPayloadPurpose: TRUSTED_PAYLOAD_COMMITMENT_PURPOSE,
      trustedPayloadInputDigest,
      requestNonce: randomBytes(16).toString("hex"),
      requestedAt: commitmentClock.iso,
    });
    let commitmentValue;
    try {
      commitmentValue = await this.#commitEvidence(commitmentRequest);
    } catch (cause) {
      throw projectionError(
        EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
        "tenant-scoped keyed commitment failed",
        { cause },
      );
    }
    const commitmentResponseClock = this.#clock();
    if (commitmentResponseClock.milliseconds < commitmentClock.milliseconds) {
      throw projectionError(
        EVOLUTION_PROJECTION_COMMITMENT_FAILED_CODE,
        "projection clock moved backwards during keyed commitment",
      );
    }
    const commitment = validateCommitmentDecision(
      commitmentValue,
      {
        tenantId: source.tenantId,
        sourceInputDigest,
        trustedPayloadInputDigest,
        requestNonce: commitmentRequest.requestNonce,
      },
      commitmentClock,
      commitmentResponseClock,
    );
    const evidenceId = normalizeId(
      await this.#idGenerator({ tenantId: source.tenantId }),
      "generated evidenceId",
    );
    const clock = this.#clock();
    const storagePolicyRequest = deepFreeze({
      tenantId: source.tenantId,
      principalId: source.principalId,
      sourceKind: source.sourceKind,
      sensitivity: source.sensitivity,
      sourceCommitment: commitment.sourceCommitment,
      commitmentReceiptDigest: commitment.commitmentReceiptDigest,
      sourceVerificationReceiptDigest: source.verificationReceiptDigest,
      requestNonce: randomBytes(16).toString("hex"),
      requestedAt: clock.iso,
    });
    let storagePolicyValue;
    try {
      storagePolicyValue =
        await this.#resolveStoragePolicy(storagePolicyRequest);
    } catch (cause) {
      throw projectionError(
        EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
        "trusted Raw storage policy resolution failed",
        { cause },
      );
    }
    const storagePolicyResponseClock = this.#clock();
    if (storagePolicyResponseClock.milliseconds < clock.milliseconds) {
      throw projectionError(
        EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
        "projection clock moved backwards during storage policy resolution",
      );
    }
    const storagePolicyDecision = validateStoragePolicy(
      storagePolicyValue,
      {
        tenantId: source.tenantId,
        principalId: source.principalId,
        sourceKind: source.sourceKind,
        sourceCommitment: commitment.sourceCommitment,
        commitmentReceiptDigest: commitment.commitmentReceiptDigest,
        sourceVerificationReceiptDigest: source.verificationReceiptDigest,
        sensitivity: source.sensitivity,
        requestNonce: storagePolicyRequest.requestNonce,
      },
      clock,
      storagePolicyResponseClock,
    );
    const storageClock = this.#clock();
    if (
      storageClock.milliseconds < storagePolicyResponseClock.milliseconds ||
      storageClock.milliseconds >= source.decisionExpiresAtMs ||
      storageClock.milliseconds >= commitment.decisionExpiresAtMs ||
      storageClock.milliseconds >= storagePolicyDecision.decisionExpiresAtMs
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
        "projection authority expired before Raw storage",
      );
    }
    const storageRequestNonce = randomBytes(16).toString("hex");
    const aad = deepFreeze({
      tenantId: source.tenantId,
      evidenceId,
      sourceCommitment: commitment.sourceCommitment,
      commitmentReceiptDigest: commitment.commitmentReceiptDigest,
      sourceVerificationReceiptDigest: source.verificationReceiptDigest,
      storagePolicyReceiptDigest: storagePolicyDecision.policyReceiptDigest,
      storagePolicyDigest: storagePolicyDecision.policyDigest,
      storagePolicyRevision: storagePolicyDecision.policyRevision,
      storagePolicyDecisionExpiresAt: storagePolicyDecision.decisionExpiresAt,
      requestNonce: storageRequestNonce,
      requestedAt: storageClock.iso,
    });
    let storageValue;
    try {
      storageValue = await this.#storeRaw(
        deepFreeze({
          tenantId: source.tenantId,
          principalId: source.principalId,
          evidenceId,
          sourceCommitment: commitment.sourceCommitment,
          commitmentReceiptDigest: commitment.commitmentReceiptDigest,
          sourceVerificationReceiptDigest: source.verificationReceiptDigest,
          storagePolicyReceiptDigest: storagePolicyDecision.policyReceiptDigest,
          storagePolicyDigest: storagePolicyDecision.policyDigest,
          storagePolicyRevision: storagePolicyDecision.policyRevision,
          storagePolicyDecisionExpiresAt:
            storagePolicyDecision.decisionExpiresAt,
          requestNonce: storageRequestNonce,
          requestedAt: storageClock.iso,
          sensitivity: source.sensitivity,
          retention: storagePolicyDecision.retention,
          acl: storagePolicyDecision.acl,
          aad,
          payload,
        }),
      );
    } catch (cause) {
      throw projectionError(
        EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
        "encrypted Raw storage failed",
        { cause },
      );
    }
    const storageResponseClock = this.#clock();
    if (
      storageResponseClock.milliseconds < storageClock.milliseconds ||
      storageResponseClock.milliseconds >= source.decisionExpiresAtMs ||
      storageResponseClock.milliseconds >= commitment.decisionExpiresAtMs ||
      storageResponseClock.milliseconds >=
        storagePolicyDecision.decisionExpiresAtMs
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
        "projection authority expired during Raw storage",
      );
    }
    const storage = validateStorageReceipt(
      storageValue,
      {
        tenantId: source.tenantId,
        principalId: source.principalId,
        evidenceId,
        sourceCommitment: commitment.sourceCommitment,
        commitmentReceiptDigest: commitment.commitmentReceiptDigest,
        sourceVerificationReceiptDigest: source.verificationReceiptDigest,
        storagePolicyReceiptDigest: storagePolicyDecision.policyReceiptDigest,
        storagePolicyDigest: storagePolicyDecision.policyDigest,
        storagePolicyRevision: storagePolicyDecision.policyRevision,
        storagePolicyDecisionExpiresAt: storagePolicyDecision.decisionExpiresAt,
        requestNonce: storageRequestNonce,
        sensitivity: source.sensitivity,
        retention: storagePolicyDecision.retention,
        acl: storagePolicyDecision.acl,
        aad,
      },
      storageClock,
      storageResponseClock,
    );
    const rawRecord = buildRawRecord(source, commitment, evidenceId, storage);
    const sanitized = ["confidential", "restricted"].includes(
      source.sensitivity,
    )
      ? deepFreeze({
          content: null,
          redactionSummary: { total: 0, byType: {}, paths: [] },
          injectionFindings: [],
          truncated: false,
        })
      : sanitizePayload(payload);
    const modelProjection = buildModelProjection(rawRecord, sanitized);
    const trustedSanitized = source.compilable
      ? sanitizePayload(source.trustedPayload)
      : null;
    const trustedInputStructured =
      source.compilable && isStructuredTrustedPayload(source.trustedPayload);
    const trustedProjection = buildTrustedProjection(
      rawRecord,
      source,
      modelProjection,
      trustedSanitized,
      trustedInputStructured,
    );
    const projectionClock = this.#clock();
    if (
      projectionClock.milliseconds < storageResponseClock.milliseconds ||
      projectionClock.milliseconds >= source.decisionExpiresAtMs ||
      projectionClock.milliseconds >= commitment.decisionExpiresAtMs ||
      projectionClock.milliseconds >=
        storagePolicyDecision.decisionExpiresAtMs ||
      projectionClock.milliseconds >=
        new Date(storage.retention.expiresAt).getTime()
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_STORAGE_FAILED_CODE,
        "projection authority expired before attestation",
      );
    }
    const receipt = buildReceipt(
      rawRecord,
      modelProjection,
      trustedProjection,
      projectionClock.iso,
    );
    let attestationValue;
    try {
      attestationValue = await this.#signAttestation(
        deepFreeze({
          receiptDigest: receipt.receiptDigest,
          tenantId: receipt.tenantId,
          evidenceId: receipt.evidenceId,
        }),
      );
    } catch (cause) {
      throw projectionError(
        EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
        "projection attestation signing failed",
        { cause },
      );
    }
    const attestation = validateAttestation(attestationValue, receipt);
    // A signer response is not trusted merely because its public fields and
    // content digest are self-consistent. Verify it against the captured trust
    // root before publishing a bundle or claiming projection success.
    const verification = await verifyAttestedBundle(
      this.#verifyAttestation,
      deepFreeze({
        rawRecord,
        modelProjection,
        trustedProjection,
        receipt,
        attestation,
      }),
      () => this.#clock(),
    );
    const completionClock = this.#clock();
    if (
      completionClock.milliseconds < verification.responseClock.milliseconds ||
      completionClock.milliseconds >= verification.decisionExpiresAtMs ||
      completionClock.milliseconds >= source.decisionExpiresAtMs ||
      completionClock.milliseconds >= commitment.decisionExpiresAtMs ||
      completionClock.milliseconds >=
        storagePolicyDecision.decisionExpiresAtMs ||
      completionClock.milliseconds >=
        new Date(storage.retention.expiresAt).getTime()
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
        "attestation verification expired before projection publication",
      );
    }
    return verification.bundle;
  }
}

/**
 * Read-only verifier for services that must authenticate serialized projection
 * bundles but must never receive source, Raw-store, or signing authority.
 */
export class EvolutionEvidenceBundleVerifier {
  #verifyAttestation;
  #now;

  constructor({ attestationVerifier, now = () => new Date() } = {}) {
    this.#verifyAttestation = capturePort(
      attestationVerifier,
      "verify",
      "attestationVerifier",
    );
    if (typeof now !== "function") {
      throw new TypeError(
        "EvolutionEvidenceBundleVerifier now must be a function",
      );
    }
    this.#now = now;
    Object.freeze(this);
  }

  #clock() {
    const iso = normalizeTimestamp(this.#now(), "bundle verifier clock");
    return { iso, milliseconds: new Date(iso).getTime() };
  }

  async verify(bundle) {
    const verification = await verifyAttestedBundle(
      this.#verifyAttestation,
      bundle,
      () => this.#clock(),
    );
    const completionClock = this.#clock();
    if (
      completionClock.milliseconds < verification.responseClock.milliseconds ||
      completionClock.milliseconds >= verification.decisionExpiresAtMs
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
        "attestation verification expired before result publication",
      );
    }
    const verified = verification.bundle;
    return deepFreeze({
      verified: true,
      evidenceId: verified.receipt.evidenceId,
      tenantId: verified.receipt.tenantId,
      receiptDigest: verified.receipt.receiptDigest,
      attestationDigest: verified.attestation.attestationDigest,
      trustedStatus: verified.trustedProjection.status,
    });
  }
}

/**
 * Read authority is intentionally separate from projection/signing authority.
 * Every read authenticates the immutable bundle, resolves the current caller,
 * checks ACL/retention, and obtains a short-lived policy decision.
 */
export class EvolutionEvidenceReader {
  #verifyAttestation;
  #resolveEvidenceState;
  #resolvePrincipal;
  #authorizeAccess;
  #now;

  constructor({
    attestationVerifier,
    evidenceState,
    principalResolver,
    accessPolicy,
    now = () => new Date(),
  } = {}) {
    this.#verifyAttestation = capturePort(
      attestationVerifier,
      "verify",
      "attestationVerifier",
    );
    this.#resolveEvidenceState = capturePort(
      evidenceState,
      "resolve",
      "evidenceState",
    );
    this.#resolvePrincipal = capturePort(
      principalResolver,
      "resolve",
      "principalResolver",
    );
    this.#authorizeAccess = capturePort(
      accessPolicy,
      "authorize",
      "accessPolicy",
    );
    if (typeof now !== "function") {
      throw new TypeError("EvolutionEvidenceReader now must be a function");
    }
    this.#now = now;
    Object.freeze(this);
  }

  #clock() {
    const iso = normalizeTimestamp(this.#now(), "projection reader clock");
    return { iso, milliseconds: new Date(iso).getTime() };
  }

  async #read(bundle, principalEnvelope, purpose, action) {
    if (
      typeof principalEnvelope !== "string" ||
      principalEnvelope.length < 1 ||
      principalEnvelope.length > 8192
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection principal envelope is invalid",
      );
    }
    const attestationVerification = await verifyAttestedBundle(
      this.#verifyAttestation,
      bundle,
      () => this.#clock(),
    );
    const verified = attestationVerification.bundle;
    if (
      typeof purpose !== "string" ||
      purpose.length < 1 ||
      purpose.length > 128 ||
      !SAFE_ID_PATTERN.test(purpose)
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection read purpose is invalid",
      );
    }
    const stateClock = this.#clock();
    if (
      stateClock.milliseconds <
        attestationVerification.responseClock.milliseconds ||
      stateClock.milliseconds >= attestationVerification.decisionExpiresAtMs
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_ATTESTATION_FAILED_CODE,
        "attestation verification expired before read authorization",
      );
    }
    const stateRequest = deepFreeze({
      tenantId: verified.rawRecord.tenantId,
      evidenceId: verified.rawRecord.evidenceId,
      rawRecordDigest: verified.rawRecord.rawRecordDigest,
      projectionReceiptDigest: verified.receipt.receiptDigest,
      attestationDigest: verified.attestation.attestationDigest,
      action,
      purpose,
      requestNonce: randomBytes(16).toString("hex"),
      requestedAt: stateClock.iso,
    });
    let stateValue;
    try {
      stateValue = await this.#resolveEvidenceState(stateRequest);
    } catch (cause) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "current evidence state resolution failed",
        { cause },
      );
    }
    const stateResponseClock = this.#clock();
    if (stateResponseClock.milliseconds < stateClock.milliseconds) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection reader clock moved backwards during state resolution",
      );
    }
    const state = validateEvidenceStateDecision(
      stateValue,
      {
        tenantId: verified.rawRecord.tenantId,
        evidenceId: verified.rawRecord.evidenceId,
        rawRecordDigest: verified.rawRecord.rawRecordDigest,
        projectionReceiptDigest: verified.receipt.receiptDigest,
        attestationDigest: verified.attestation.attestationDigest,
        requestNonce: stateRequest.requestNonce,
        requestedAt: stateRequest.requestedAt,
        retentionExpiresAtMs: new Date(
          verified.rawRecord.retention.expiresAt,
        ).getTime(),
      },
      stateResponseClock,
    );
    if (state.status !== "active" || !state.readable) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "evidence has been deleted, revoked, or expired",
        {
          evidenceStatus: state.status,
          tombstoneReceiptDigest: state.tombstoneReceiptDigest,
        },
      );
    }
    const principalClock = this.#clock();
    const principalRequest = deepFreeze({
      principalEnvelope,
      principalEnvelopeDigest: digest(
        principalEnvelope,
        "chainlesschain.evolution-principal-envelope/v1",
      ),
      tenantId: verified.rawRecord.tenantId,
      purpose,
      action,
      requestNonce: randomBytes(16).toString("hex"),
      requestedAt: principalClock.iso,
    });
    let principalValue;
    try {
      principalValue = await this.#resolvePrincipal(principalRequest);
    } catch (cause) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection principal resolution failed",
        { cause },
      );
    }
    const principalResponseClock = this.#clock();
    if (principalResponseClock.milliseconds < principalClock.milliseconds) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection reader clock moved backwards during principal resolution",
      );
    }
    const principal = validatePrincipalDecision(
      principalValue,
      {
        tenantId: verified.rawRecord.tenantId,
        principalEnvelopeDigest: principalRequest.principalEnvelopeDigest,
        action,
        purpose,
        requestNonce: principalRequest.requestNonce,
      },
      principalClock,
      principalResponseClock,
    );
    const principalId = principal.principalId;
    if (!verified.rawRecord.acl.includes(principalId)) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection ACL denies the principal",
      );
    }
    if (
      new Date(verified.rawRecord.retention.expiresAt).getTime() <=
      principalResponseClock.milliseconds
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection retention has expired",
      );
    }
    const retentionExpiresAtMs = new Date(
      verified.rawRecord.retention.expiresAt,
    ).getTime();
    const accessClock = this.#clock();
    if (accessClock.milliseconds < principalResponseClock.milliseconds) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection reader clock moved backwards before access authorization",
      );
    }
    const accessRequest = deepFreeze({
      action,
      purpose,
      principal: cloneCanonical(principalValue),
      evidenceStateReceiptDigest: state.receiptDigest,
      evidenceStateRevision: state.revision,
      evidenceStateDecisionExpiresAt: state.decisionExpiresAt,
      tenantId: verified.rawRecord.tenantId,
      evidenceId: verified.rawRecord.evidenceId,
      sensitivity: verified.rawRecord.sensitivity,
      principalExpiresAt: principal.expiresAt,
      principalDecisionExpiresAt: principal.decisionExpiresAt,
      retentionExpiresAt: verified.rawRecord.retention.expiresAt,
      projectionReceiptDigest: verified.receipt.receiptDigest,
      requestNonce: randomBytes(16).toString("hex"),
      requestedAt: accessClock.iso,
    });
    let accessValue;
    try {
      accessValue = await this.#authorizeAccess(accessRequest);
    } catch (cause) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection access policy failed",
        { cause },
      );
    }
    const accessResponseClock = this.#clock();
    if (accessResponseClock.milliseconds < accessClock.milliseconds) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection reader clock moved backwards during access authorization",
      );
    }
    const access = validateAccessDecision(
      accessValue,
      {
        action,
        purpose,
        principalId,
        principalReceiptDigest: principal.receiptDigest,
        evidenceStateReceiptDigest: state.receiptDigest,
        evidenceStateRevision: state.revision,
        evidenceStateDecisionExpiresAt: state.decisionExpiresAt,
        principalExpiresAt: principal.expiresAt,
        principalDecisionExpiresAt: principal.decisionExpiresAt,
        tenantId: verified.rawRecord.tenantId,
        evidenceId: verified.rawRecord.evidenceId,
        sensitivity: verified.rawRecord.sensitivity,
        projectionReceiptDigest: verified.receipt.receiptDigest,
        retentionExpiresAt: verified.rawRecord.retention.expiresAt,
        requestNonce: accessRequest.requestNonce,
        principalExpiresAtMs: principal.expiresAtMs,
        principalDecisionExpiresAtMs: principal.decisionExpiresAtMs,
        evidenceStateDecisionExpiresAtMs: state.decisionExpiresAtMs,
        retentionExpiresAtMs,
      },
      accessClock,
      accessResponseClock,
    );
    const completionClock = this.#clock();
    if (
      completionClock.milliseconds < principalResponseClock.milliseconds ||
      completionClock.milliseconds < stateClock.milliseconds ||
      completionClock.milliseconds < stateResponseClock.milliseconds ||
      completionClock.milliseconds < accessClock.milliseconds ||
      completionClock.milliseconds < accessResponseClock.milliseconds ||
      completionClock.milliseconds >=
        attestationVerification.decisionExpiresAtMs ||
      completionClock.milliseconds >= state.decisionExpiresAtMs ||
      completionClock.milliseconds >= access.decisionExpiresAtMs ||
      completionClock.milliseconds >= principal.expiresAtMs ||
      completionClock.milliseconds >= principal.decisionExpiresAtMs ||
      completionClock.milliseconds >= retentionExpiresAtMs
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_ACCESS_DENIED_CODE,
        "projection authorization expired before content release",
      );
    }
    if (
      action === "read-trusted" &&
      verified.trustedProjection.status !== "trusted"
    ) {
      throw projectionError(
        EVOLUTION_PROJECTION_QUARANTINED_CODE,
        "evidence is quarantined from the trusted learning plane",
        { reasonCodes: verified.trustedProjection.reasonCodes },
      );
    }
    return action === "read-trusted"
      ? verified.trustedProjection
      : verified.modelProjection;
  }

  readModelVisible(bundle, principalEnvelope, purpose) {
    return this.#read(bundle, principalEnvelope, purpose, "read-model-visible");
  }

  readTrusted(bundle, principalEnvelope, purpose) {
    return this.#read(bundle, principalEnvelope, purpose, "read-trusted");
  }
}

Object.freeze(EvolutionEvidenceProjector.prototype);
Object.freeze(EvolutionEvidenceBundleVerifier.prototype);
Object.freeze(EvolutionEvidenceReader.prototype);

export const EVOLUTION_PROJECTION_RULESET_DIGEST = RULESET_DIGEST;
