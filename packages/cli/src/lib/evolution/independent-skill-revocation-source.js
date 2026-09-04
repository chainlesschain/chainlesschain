import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA,
  createSkillWikiRevocationReconciliationSource,
} from "./skill-wiki-reconciliation.js";

export const INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA =
  "chainlesschain.independent-skill-revocation-record/v1";
export const INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA =
  "chainlesschain.independent-skill-revocation-verification/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const RECORD_KEYS = new Set([
  "schema",
  "tenantId",
  "streamId",
  "sequence",
  "revocationId",
  "candidateId",
  "skillName",
  "reason",
  "occurredAt",
  "activeStateDigest",
  "evidenceReceiptDigests",
  "attestation",
  "recordDigest",
]);
const ATTESTATION_KEYS = new Set(["algorithm", "keyId", "value"]);
const VERIFICATION_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "streamId",
  "sequence",
  "recordDigest",
  "receiptDigest",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.size ||
    own.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} must contain exactly the supported fields`);
  }
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} is unsafe`);
    }
  }
}

function string(value, label, maximum = 512) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > maximum
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function timestamp(value, label) {
  string(value, label, 64);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function digestIndependentSkillRevocationRecord(value) {
  const core = structuredClone(value);
  delete core.attestation;
  delete core.recordDigest;
  return hash({ domain: INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA, ...core });
}

function normalizeRecord(value, tenantId, streamId) {
  exact(value, RECORD_KEYS, "independent Skill revocation record");
  exact(value.attestation, ATTESTATION_KEYS, "revocation attestation");
  if (
    value.schema !== INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA ||
    value.tenantId !== tenantId ||
    value.streamId !== streamId ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !SKILL_NAME.test(value.skillName ?? "") ||
    value.recordDigest !== digestIndependentSkillRevocationRecord(value)
  ) {
    throw new Error("Independent Skill revocation record is not bound");
  }
  string(value.revocationId, "revocationId", 256);
  string(value.reason, "reason", 1024);
  timestamp(value.occurredAt, "occurredAt");
  digest(value.candidateId, "candidateId");
  digest(value.activeStateDigest, "activeStateDigest");
  string(value.attestation.algorithm, "attestation.algorithm", 64);
  string(value.attestation.keyId, "attestation.keyId", 256);
  string(value.attestation.value, "attestation.value", 4096);
  if (
    !Array.isArray(value.evidenceReceiptDigests) ||
    utilTypes.isProxy(value.evidenceReceiptDigests) ||
    value.evidenceReceiptDigests.length < 1 ||
    value.evidenceReceiptDigests.length > 128 ||
    value.evidenceReceiptDigests.some((entry) => !DIGEST.test(entry)) ||
    new Set(value.evidenceReceiptDigests).size !==
      value.evidenceReceiptDigests.length
  ) {
    throw new Error("Independent Skill revocation evidence is invalid");
  }
  return structuredClone(value);
}

export function createIndependentSkillRevocationSource({
  tenantId,
  streamId,
  ports,
} = {}) {
  string(tenantId, "tenantId", 256);
  string(streamId, "streamId", 256);
  if (
    !ports ||
    typeof ports.readRevocations !== "function" ||
    typeof ports.verifyRevocation !== "function" ||
    utilTypes.isProxy(ports.readRevocations) ||
    utilTypes.isProxy(ports.verifyRevocation)
  ) {
    throw new TypeError(
      "Independent revocation reader and verifier are required",
    );
  }
  const read = ports.readRevocations.bind(ports);
  const verify = ports.verifyRevocation.bind(ports);
  return createSkillWikiRevocationReconciliationSource({
    tenantId,
    streamId,
    async readRevocations() {
      const records = await read({ tenantId, streamId });
      if (
        !Array.isArray(records) ||
        utilTypes.isProxy(records) ||
        records.length > 10_000
      ) {
        throw new Error("Independent revocation ledger is unbounded");
      }
      const projected = [];
      for (const raw of records) {
        const record = normalizeRecord(raw, tenantId, streamId);
        const verification = await verify({
          tenantId,
          streamId,
          sequence: record.sequence,
          recordDigest: record.recordDigest,
          attestation: structuredClone(record.attestation),
        });
        exact(
          verification,
          VERIFICATION_KEYS,
          "independent revocation verification",
        );
        if (
          verification.schema !==
            INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA ||
          verification.authenticated !== true ||
          verification.durable !== true ||
          verification.tenantId !== tenantId ||
          verification.streamId !== streamId ||
          verification.sequence !== record.sequence ||
          verification.recordDigest !== record.recordDigest ||
          !DIGEST.test(verification.receiptDigest ?? "")
        ) {
          throw new Error("Independent revocation verification is not bound");
        }
        projected.push({
          schema: SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA,
          authenticated: true,
          durable: true,
          tenantId,
          streamId,
          sequence: record.sequence,
          revocationId: record.revocationId,
          candidateId: record.candidateId,
          skillName: record.skillName,
          outcome: "revoke",
          reason: record.reason,
          occurredAt: record.occurredAt,
          activeStateDigest: record.activeStateDigest,
          evidenceReceiptDigests: [...record.evidenceReceiptDigests].sort(),
          sourceReceiptDigest: verification.receiptDigest,
        });
      }
      return projected;
    },
  });
}
