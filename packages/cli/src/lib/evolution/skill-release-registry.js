import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import {
  SKILL_CANDIDATE_MIGRATION_RECEIPT_SCHEMA,
  SKILL_CANDIDATE_MIGRATION_RECORD_SCHEMA,
  verifySkillCandidateDraft,
} from "./skill-candidate-registry.js";
import {
  SKILL_MUTATION_OPERATIONS,
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_ROLES,
  SKILL_MUTATION_TARGET_SCOPES,
  digestSkillMutationDependencyLock,
  digestSkillMutationReceiptEnvelope,
  digestSkillMutationTransitionSubject,
  verifySkillMutationConsumptionReceipt,
  verifySkillMutationRequest,
} from "./skill-mutation-authority.js";
import { consumeRegistryTransitionCapability } from "./skill-registry-transition-capability.js";

export const SKILL_RELEASE_SCHEMA = "chainlesschain.skill-release/v4";
export const SKILL_RELEASE_STATE_SCHEMA =
  "chainlesschain.skill-release-state/v3";
export const SKILL_RELEASE_RECEIPT_SCHEMA =
  "chainlesschain.skill-release-transition-receipt/v4";
export const SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA =
  "chainlesschain.skill-release-ledger-projection/v3";
export const SKILL_RELEASE_TENANT_MARKER_SCHEMA =
  "chainlesschain.skill-release-tenant-marker/v1";
export const SKILL_RELEASE_MIGRATION_REQUIRED_CODE =
  "SKILL_RELEASE_MIGRATION_REQUIRED";
export const SKILL_RELEASE_MIGRATION_RECORD_SCHEMA =
  "chainlesschain.skill-release-migration/v1";
export const SKILL_RELEASE_MIGRATION_AUTHORITY_SCHEMA =
  "chainlesschain.skill-release-migration-authority/v1";
export const SKILL_RELEASE_MIGRATION_RECEIPT_SCHEMA =
  "chainlesschain.skill-release-migration-receipt/v1";
export const SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA =
  "chainlesschain.skill-release-state-migration-plan/v1";
export const SKILL_RELEASE_STATE_MIGRATION_AUTHORITY_SCHEMA =
  "chainlesschain.skill-release-state-migration-authority/v1";
export const SKILL_RELEASE_STATE_MIGRATION_RECEIPT_SCHEMA =
  "chainlesschain.skill-release-state-migration-receipt/v1";
export const SKILL_RELEASE_STATE_LEDGER_MIGRATION_SCHEMA =
  "chainlesschain.skill-release-state-ledger-migration/v1";

const JOURNAL_SCHEMA = "chainlesschain.skill-release-journal/v4";
const INTENT_SCHEMA = "chainlesschain.skill-release-transition-intent/v2";
const RELEASE_DOMAIN = `${SKILL_RELEASE_SCHEMA}\0`;
const STATE_DOMAIN = `${SKILL_RELEASE_STATE_SCHEMA}\0`;
const RECEIPT_DOMAIN = `${SKILL_RELEASE_RECEIPT_SCHEMA}\0`;
const JOURNAL_DOMAIN = `${JOURNAL_SCHEMA}\0`;
const INTENT_DOMAIN = `${INTENT_SCHEMA}\0`;
const EMPTY_ACTIVE_DOMAIN = "chainlesschain.skill-active/empty/v1\0";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TOKEN_PATTERN = /^[a-f0-9]{32}$/u;
const LEDGER_EPOCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const TENANT_KEY_PATTERN = /^[a-f0-9]{64}$/u;
const TEMP_PATTERN = /^\.(?:release|state|write)-[A-Za-z0-9._-]+\.tmp$/u;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TENANT_MARKER_BYTES = 4096;
const MAX_CANONICAL_DEPTH = 32;
const MAX_CANONICAL_NODES = 100_000;
const MAX_CANONICAL_ARRAY_ENTRIES = 65_536;
const MAX_CANONICAL_OBJECT_FIELDS = 4096;
const MIN_LEASE_TTL_MS = 25;
const DEFAULT_LEASE_TTL_MS = 30_000;
const TENANT_KEY_DOMAIN = "chainlesschain.skill-release-tenant-key/v1";
const TENANT_MARKER_DIGEST_DOMAIN =
  "chainlesschain.skill-release-tenant-marker/v1\0";
const TENANT_MARKER_COMPONENT = "skill-release-registry";
const TENANT_MARKER_FILE = "_tenant.json";
const LEGACY_RELEASE_SCHEMA = "chainlesschain.skill-release/v3";
const LEGACY_RELEASE_DOMAIN = `${LEGACY_RELEASE_SCHEMA}\0`;
const LEGACY_STATE_SCHEMA = "chainlesschain.skill-release-state/v2";
const LEGACY_STATE_DOMAIN = `${LEGACY_STATE_SCHEMA}\0`;
const LEGACY_JOURNAL_SCHEMA = "chainlesschain.skill-release-journal/v3";
const LEGACY_JOURNAL_DOMAIN = `${LEGACY_JOURNAL_SCHEMA}\0`;
const LEGACY_LOCK_OWNER_SCHEMA = "chainlesschain.skill-release-lock-owner/v1";
const LOCK_OWNER_SCHEMA = "chainlesschain.skill-release-lock-owner/v2";
const RELEASE_MIGRATION_DOMAIN = `${SKILL_RELEASE_MIGRATION_RECORD_SCHEMA}\0`;
const STATE_MIGRATION_PLAN_DOMAIN = `${SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA}\0`;

export const EMPTY_SKILL_ACTIVE_DIGEST = sha256(
  Buffer.from(EMPTY_ACTIVE_DOMAIN, "utf8"),
);

export class SkillReleaseRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillReleaseRegistryError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

export class SkillReleaseSimulatedCrashError extends Error {
  constructor(phase) {
    super(`simulated hard crash at ${phase}`);
    this.name = "SkillReleaseSimulatedCrashError";
    this.phase = phase;
    this.preserveForRecovery = true;
  }
}

function failure(code, message, details = {}) {
  return new SkillReleaseRegistryError(code, message, details);
}

function migrationRequired(message, details = {}) {
  return failure(SKILL_RELEASE_MIGRATION_REQUIRED_CODE, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  value,
  expected,
  label,
  code = "SKILL_RELEASE_INVALID",
) {
  if (value && typeof value === "object" && utilTypes.isProxy(value)) {
    throw failure(code, `${label} must not be a Proxy`);
  }
  if (!isPlainObject(value)) throw failure(code, `${label} must be an object`);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    throw failure(code, `${label} must contain exactly the supported fields`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(code, `${label}.${String(key)} must be an own data field`);
    }
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
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

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function serialize(value) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES) {
    throw failure("SKILL_RELEASE_INVALID", "artifact exceeds its size limit");
  }
  return bytes;
}

function digest(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw failure(
      "SKILL_RELEASE_INVALID",
      `${label} must be a lowercase sha256 digest${nullable ? " or null" : ""}`,
    );
  }
  return value;
}

function skillName(value) {
  if (typeof value !== "string" || !SKILL_NAME_PATTERN.test(value)) {
    throw failure("SKILL_RELEASE_INVALID", "skillName must use kebab-case");
  }
  return value;
}

function safeInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum) {
    throw failure("SKILL_RELEASE_INVALID", `${label} must be a safe integer`);
  }
  return value;
}

function boundedString(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw failure("SKILL_RELEASE_INVALID", `${label} is invalid`);
  }
  return value;
}

function normalizeJson(value, label, depth = 0) {
  if (depth > 20)
    throw failure("SKILL_RELEASE_INVALID", `${label} is too deep`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return boundedString(value, label, 16_384);
  if (typeof value === "number") return safeInteger(value, label);
  if (value && typeof value === "object" && utilTypes.isProxy(value)) {
    throw failure("SKILL_RELEASE_INVALID", `${label} must not be a Proxy`);
  }
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (
      value.length > 2_048 ||
      keys.length !== value.length + 1 ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
      )
    ) {
      throw failure("SKILL_RELEASE_INVALID", `${label} has too many entries`);
    }
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw failure(
          "SKILL_RELEASE_INVALID",
          `${label}[${index}] must be an own data field`,
        );
      }
      output.push(
        normalizeJson(descriptor.value, `${label}[${index}]`, depth + 1),
      );
    }
    return output;
  }
  if (!isPlainObject(value)) {
    throw failure("SKILL_RELEASE_INVALID", `${label} must be canonical JSON`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > 2_048 ||
    keys.some((key) => typeof key !== "string" || !key || key.length > 256)
  ) {
    throw failure("SKILL_RELEASE_INVALID", `${label} has unsafe keys`);
  }
  return Object.fromEntries(
    keys.sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw failure(
          "SKILL_RELEASE_INVALID",
          `${label}.${key} must be an own data field`,
        );
      }
      return [
        key,
        normalizeJson(descriptor.value, `${label}.${key}`, depth + 1),
      ];
    }),
  );
}

function assertBoundedCanonicalPreflight(value, code) {
  const stack = [{ depth: 0, value }];
  let nodes = 0;
  let utf8Bytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_CANONICAL_NODES || current.depth > MAX_CANONICAL_DEPTH) {
      throw failure(code, "artifact exceeds the canonical structure budget");
    }
    const currentValue = current.value;
    if (typeof currentValue === "string") {
      utf8Bytes += Buffer.byteLength(currentValue, "utf8");
    } else if (typeof currentValue === "number") {
      if (!Number.isFinite(currentValue) || Object.is(currentValue, -0)) {
        throw failure(code, "artifact contains a non-canonical number");
      }
    } else if (currentValue !== null && typeof currentValue === "object") {
      if (Array.isArray(currentValue)) {
        if (currentValue.length > MAX_CANONICAL_ARRAY_ENTRIES) {
          throw failure(code, "artifact array exceeds its entry budget");
        }
        for (let index = currentValue.length - 1; index >= 0; index -= 1) {
          stack.push({
            depth: current.depth + 1,
            value: currentValue[index],
          });
        }
      } else {
        const keys = Object.keys(currentValue);
        if (keys.length > MAX_CANONICAL_OBJECT_FIELDS) {
          throw failure(code, "artifact object exceeds its field budget");
        }
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const key = keys[index];
          utf8Bytes += Buffer.byteLength(key, "utf8");
          stack.push({
            depth: current.depth + 1,
            value: currentValue[key],
          });
        }
      }
    }
    if (utf8Bytes > MAX_FILE_BYTES) {
      throw failure(code, "artifact exceeds its canonical UTF-8 budget");
    }
  }
}

function tenantId(value, label = "tenantId") {
  const normalized = boundedString(value, label, 256);
  if (!TENANT_ID_PATTERN.test(normalized)) {
    throw failure("SKILL_RELEASE_INVALID", `${label} is invalid`);
  }
  return normalized;
}

export function deriveSkillReleaseTenantKey(value) {
  const normalized = tenantId(value);
  return crypto
    .createHash("sha256")
    .update(TENANT_KEY_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}

function normalizeReceiptDigests(value) {
  const expected = new Set(SKILL_MUTATION_RECEIPT_KINDS);
  assertExactKeys(value, expected, "receiptDigests");
  return deepFreeze(
    Object.fromEntries(
      SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
        kind,
        digest(value[kind], `receiptDigests.${kind}`),
      ]),
    ),
  );
}

function receiptDigestsFromRequest(request) {
  return deepFreeze(
    Object.fromEntries(
      SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
        kind,
        digestSkillMutationReceiptEnvelope(request.receipts[`${kind}Receipt`]),
      ]),
    ),
  );
}

export function digestDependencyLock(value) {
  const normalized = normalizeJson(value, "dependencyLock");
  if (!isPlainObject(normalized)) {
    throw failure("SKILL_RELEASE_INVALID", "dependencyLock must be an object");
  }
  return digestSkillMutationDependencyLock(normalized);
}

function verifyRequestReceiptBinding(request, receipt) {
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
    if (receipt[field] !== request[field]) {
      throw failure(
        "SKILL_RELEASE_AUTHORITY_INVALID",
        `consumption receipt is not bound to request ${field}`,
      );
    }
  }
  if (
    request.targetScope !== SKILL_MUTATION_TARGET_SCOPES.ACTIVE ||
    receipt.role !== SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER ||
    ![
      SKILL_MUTATION_OPERATIONS.PROMOTE,
      SKILL_MUTATION_OPERATIONS.ROLLBACK,
    ].includes(request.operation)
  ) {
    throw failure(
      "SKILL_RELEASE_AUTHORITY_INVALID",
      "release requires an active promotion-controller receipt",
    );
  }
}

const RELEASE_KEYS = new Set([
  "authorityReceiptDigest",
  "candidate",
  "candidateId",
  "contentDigest",
  "dependencyLock",
  "dependencyLockDigest",
  "mutationRequestDigest",
  "parentDigest",
  "receiptDigests",
  "releaseDigest",
  "runtimeManifest",
  "runtimeManifestDigest",
  "schema",
  "skillName",
  "targetMatrix",
  "targetMatrixRoot",
  "targetRuntimes",
  "tenantId",
  "transitionSubjectDigest",
]);
const LEGACY_RELEASE_KEYS = new Set([
  "authorityReceiptDigest",
  "candidateId",
  "content",
  "contentDigest",
  "dependencyLock",
  "dependencyLockDigest",
  "mutationRequestDigest",
  "parentDigest",
  "receiptDigests",
  "releaseDigest",
  "requestedCapabilities",
  "schema",
  "skillName",
  "targetRuntimes",
  "transitionSubjectDigest",
]);
const RELEASE_MIGRATION_INPUT_KEYS = new Set([
  "candidateMigration",
  "legacyRelease",
]);
const CANDIDATE_MIGRATION_RESULT_KEYS = new Set([
  "candidate",
  "created",
  "migration",
  "receipt",
]);
const CANDIDATE_MIGRATION_RECORD_KEYS = new Set([
  "authorityId",
  "candidateId",
  "contentDigest",
  "dependencyLockDigest",
  "handlerArtifactDigest",
  "legacyArtifactDigest",
  "legacyCandidateId",
  "migrationDigest",
  "runtimeManifestDigest",
  "schema",
  "targetMatrixRoot",
  "tenantId",
  "trust",
]);
const CANDIDATE_MIGRATION_RECEIPT_KEYS = new Set([
  "authenticated",
  "authorityId",
  "durable",
  "handlerArtifactDigest",
  "migrationDigest",
  "receiptDigest",
  "schema",
  "trust",
]);
const RELEASE_MIGRATION_AUTHORITY_KEYS = new Set([
  "audit",
  "authorityId",
  "handlerArtifactDigest",
  "schema",
  "trust",
]);
const RELEASE_MIGRATION_RECEIPT_KEYS = new Set([
  "authenticated",
  "authorityId",
  "durable",
  "handlerArtifactDigest",
  "migrationDigest",
  "receiptDigest",
  "schema",
  "trust",
]);
const RELEASE_MIGRATION_RECORD_KEYS = new Set([
  "authorityId",
  "candidateMigrationDigest",
  "candidateMigrationReceiptDigest",
  "handlerArtifactDigest",
  "legacyCandidateId",
  "legacyReleaseDigest",
  "migrationDigest",
  "releaseDigest",
  "schema",
  "skillName",
  "tenantId",
  "trust",
]);
const RELEASE_MIGRATION_RESULT_KEYS = new Set([
  "created",
  "migration",
  "receipt",
  "release",
]);
const LEGACY_STATE_KEYS = new Set([
  "activeReleaseDigest",
  "authorityReceiptDigest",
  "dependencyLockDigest",
  "fence",
  "lastKnownGoodReleaseDigest",
  "revision",
  "schema",
  "skillName",
  "stateDigest",
  "transactionId",
]);
const LEGACY_JOURNAL_KEYS = new Set([
  "intent",
  "journalDigest",
  "leaseToken",
  "nextState",
  "phase",
  "prepareReceipt",
  "previousState",
  "schema",
  "skillName",
  "stagedFile",
  "transactionId",
]);
const LEGACY_INTENT_KEYS = new Set([
  "authorityReceiptDigest",
  "authorityReceipt",
  "candidateId",
  "dependencyLockDigest",
  "expectedParentDigest",
  "expectedRevision",
  "mutationRequest",
  "intentDigest",
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
const STATE_MIGRATION_PLAN_INPUT_KEYS = new Set([
  "activeReleaseMigration",
  "lastKnownGoodReleaseMigration",
  "legacyState",
]);
const STATE_MIGRATION_PLAN_KEYS = new Set([
  "activeReleaseDigest",
  "activeReleaseMigrationDigest",
  "activeReleaseMigrationReceiptDigest",
  "dependencyLockDigest",
  "lastKnownGoodReleaseDigest",
  "lastKnownGoodReleaseMigrationDigest",
  "lastKnownGoodReleaseMigrationReceiptDigest",
  "legacyActiveReleaseDigest",
  "legacyFence",
  "legacyLastKnownGoodReleaseDigest",
  "legacyRevision",
  "legacyStateDigest",
  "legacyTransactionId",
  "requiresAuthenticatedLedgerMigration",
  "schema",
  "skillName",
  "stateMigrationDigest",
  "tenantId",
]);
const STATE_MIGRATION_AUTHORITY_KEYS = new Set([
  "audit",
  "authorityId",
  "handlerArtifactDigest",
  "schema",
  "trust",
]);
const STATE_MIGRATION_RECEIPT_KEYS = new Set([
  "authenticated",
  "authorityId",
  "durable",
  "handlerArtifactDigest",
  "receiptDigest",
  "schema",
  "stateMigrationDigest",
  "trust",
]);
const BUILD_RELEASE_INPUT_KEYS = new Set([
  "candidate",
  "consumptionReceipt",
  "mutationRequest",
]);

export function buildSkillRelease(input) {
  assertExactKeys(input, BUILD_RELEASE_INPUT_KEYS, "release build input");
  const verifiedCandidate = verifySkillCandidateDraft(input.candidate);
  const request = verifySkillMutationRequest(input.mutationRequest);
  const authorityReceipt = verifySkillMutationConsumptionReceipt(
    input.consumptionReceipt,
  );
  verifyRequestReceiptBinding(request, authorityReceipt);
  if (
    request.operation !== SKILL_MUTATION_OPERATIONS.PROMOTE ||
    authorityReceipt.operation !== SKILL_MUTATION_OPERATIONS.PROMOTE ||
    request.skillName !== verifiedCandidate.skillName ||
    request.tenantId !== verifiedCandidate.tenantId ||
    authorityReceipt.tenantId !== verifiedCandidate.tenantId
  ) {
    throw failure(
      "SKILL_RELEASE_INVALID",
      "release creation requires a promotion request for the tenant-bound candidate Skill",
    );
  }
  const expectedParent =
    request.expectedTargetDigest === EMPTY_SKILL_ACTIVE_DIGEST
      ? null
      : request.expectedTargetDigest;
  if (verifiedCandidate.parentDigest !== expectedParent) {
    throw failure(
      "SKILL_RELEASE_INVALID",
      "candidate parent is not the authorized CAS target",
    );
  }
  const dependencyLockDigest = verifiedCandidate.dependencyLockDigest;
  const transitionSubjectDigest = digestSkillMutationTransitionSubject({
    tenantId: request.tenantId,
    skillName: verifiedCandidate.skillName,
    operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
    candidateId: verifiedCandidate.candidateId,
    rollbackTargetReleaseDigest: null,
    dependencyLockDigest,
    expectedActiveContentDigest: request.expectedTargetDigest,
    expectedActiveRevision: request.expectedTargetRevision,
  });
  if (
    request.transitionSubjectDigest !== transitionSubjectDigest ||
    authorityReceipt.transitionSubjectDigest !== transitionSubjectDigest
  ) {
    throw failure(
      "SKILL_RELEASE_AUTHORITY_INVALID",
      "promotion request is not bound to the candidate and dependency lock",
    );
  }
  const core = {
    authorityReceiptDigest: authorityReceipt.receiptDigest,
    candidate: verifiedCandidate,
    candidateId: verifiedCandidate.candidateId,
    contentDigest: verifiedCandidate.contentDigest,
    dependencyLock: verifiedCandidate.dependencyLock,
    dependencyLockDigest,
    mutationRequestDigest: request.requestDigest,
    parentDigest: verifiedCandidate.parentDigest,
    receiptDigests: receiptDigestsFromRequest(request),
    runtimeManifest: verifiedCandidate.runtimeManifest,
    runtimeManifestDigest: verifiedCandidate.runtimeManifestDigest,
    schema: SKILL_RELEASE_SCHEMA,
    skillName: verifiedCandidate.skillName,
    targetMatrix: verifiedCandidate.targetMatrix,
    targetMatrixRoot: verifiedCandidate.targetMatrixRoot,
    targetRuntimes: [...verifiedCandidate.targetRuntimes],
    tenantId: verifiedCandidate.tenantId,
    transitionSubjectDigest,
  };
  return deepFreeze({
    ...core,
    releaseDigest: domainDigest(RELEASE_DOMAIN, core),
  });
}

/** Verify the exact pre-tenant v3 release before explicit migration. */
export function verifyLegacySkillRelease(value) {
  assertExactKeys(
    value,
    LEGACY_RELEASE_KEYS,
    "legacy release",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  if (
    value.schema !== LEGACY_RELEASE_SCHEMA ||
    typeof value.content !== "string"
  ) {
    throw migrationRequired("legacy release schema or content is invalid");
  }
  const core = {
    authorityReceiptDigest: digest(
      value.authorityReceiptDigest,
      "authorityReceiptDigest",
    ),
    candidateId: digest(value.candidateId, "candidateId"),
    content: value.content,
    contentDigest: digest(value.contentDigest, "contentDigest"),
    dependencyLock: normalizeJson(value.dependencyLock, "dependencyLock"),
    dependencyLockDigest: digest(
      value.dependencyLockDigest,
      "dependencyLockDigest",
    ),
    mutationRequestDigest: digest(
      value.mutationRequestDigest,
      "mutationRequestDigest",
    ),
    parentDigest: digest(value.parentDigest, "parentDigest", {
      nullable: true,
    }),
    receiptDigests: normalizeReceiptDigests(value.receiptDigests),
    requestedCapabilities: normalizeJson(
      value.requestedCapabilities,
      "requestedCapabilities",
    ),
    schema: LEGACY_RELEASE_SCHEMA,
    skillName: skillName(value.skillName),
    targetRuntimes: normalizeJson(value.targetRuntimes, "targetRuntimes"),
    transitionSubjectDigest: digest(
      value.transitionSubjectDigest,
      "transitionSubjectDigest",
    ),
  };
  if (
    !Array.isArray(core.requestedCapabilities) ||
    !Array.isArray(core.targetRuntimes) ||
    sha256(Buffer.from(core.content, "utf8")) !== core.contentDigest ||
    digestDependencyLock(core.dependencyLock) !== core.dependencyLockDigest ||
    digest(value.releaseDigest, "releaseDigest") !==
      domainDigest(LEGACY_RELEASE_DOMAIN, core) ||
    canonicalJson(value) !==
      canonicalJson({ ...core, releaseDigest: value.releaseDigest })
  ) {
    throw migrationRequired("legacy release bytes or digests are invalid", {
      legacyReleaseDigest: value.releaseDigest,
    });
  }
  return deepFreeze({ ...core, releaseDigest: value.releaseDigest });
}

export function buildMigratedSkillRelease(input) {
  assertExactKeys(
    input,
    RELEASE_MIGRATION_INPUT_KEYS,
    "release migration input",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  const legacy = verifyLegacySkillRelease(input.legacyRelease);
  assertExactKeys(
    input.candidateMigration,
    CANDIDATE_MIGRATION_RESULT_KEYS,
    "candidate migration result",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  if (typeof input.candidateMigration.created !== "boolean") {
    throw migrationRequired(
      "candidate migration result created flag is invalid",
    );
  }
  const candidate = verifySkillCandidateDraft(
    input.candidateMigration.candidate,
  );
  const migration = input.candidateMigration.migration;
  const migrationReceipt = input.candidateMigration.receipt;
  assertExactKeys(
    migration,
    CANDIDATE_MIGRATION_RECORD_KEYS,
    "candidate migration record",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  assertExactKeys(
    migrationReceipt,
    CANDIDATE_MIGRATION_RECEIPT_KEYS,
    "candidate migration receipt",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  const migrationCore = { ...migration };
  delete migrationCore.migrationDigest;
  if (
    migration.schema !== SKILL_CANDIDATE_MIGRATION_RECORD_SCHEMA ||
    migration.trust !== "trusted" ||
    migration.migrationDigest !==
      domainDigest(
        `${SKILL_CANDIDATE_MIGRATION_RECORD_SCHEMA}\0`,
        migrationCore,
      ) ||
    migrationReceipt.schema !== SKILL_CANDIDATE_MIGRATION_RECEIPT_SCHEMA ||
    migrationReceipt.authenticated !== true ||
    migrationReceipt.durable !== true ||
    migrationReceipt.trust !== "trusted" ||
    migrationReceipt.migrationDigest !== migration.migrationDigest ||
    migrationReceipt.authorityId !== migration.authorityId ||
    migrationReceipt.handlerArtifactDigest !==
      migration.handlerArtifactDigest ||
    migration.legacyCandidateId !== legacy.candidateId ||
    migration.candidateId !== candidate.candidateId ||
    migration.tenantId !== candidate.tenantId ||
    migration.contentDigest !== candidate.contentDigest ||
    migration.dependencyLockDigest !== candidate.dependencyLockDigest ||
    migration.runtimeManifestDigest !== candidate.runtimeManifestDigest ||
    migration.targetMatrixRoot !== candidate.targetMatrixRoot ||
    legacy.skillName !== candidate.skillName ||
    legacy.parentDigest !== candidate.parentDigest ||
    legacy.contentDigest !== candidate.contentDigest ||
    legacy.content !== candidate.content ||
    legacy.dependencyLockDigest !== candidate.dependencyLock.lockDigest ||
    canonicalJson(legacy.dependencyLock) !==
      canonicalJson(candidate.dependencyLock.lock) ||
    canonicalJson(legacy.requestedCapabilities) !==
      canonicalJson(candidate.requestedCapabilities) ||
    canonicalJson(legacy.targetRuntimes) !==
      canonicalJson(candidate.targetRuntimes)
  ) {
    throw migrationRequired(
      "legacy release is not exactly bound to its audited candidate migration",
      { legacyReleaseDigest: legacy.releaseDigest },
    );
  }
  const core = {
    authorityReceiptDigest: legacy.authorityReceiptDigest,
    candidate,
    candidateId: candidate.candidateId,
    contentDigest: candidate.contentDigest,
    dependencyLock: candidate.dependencyLock,
    dependencyLockDigest: candidate.dependencyLockDigest,
    mutationRequestDigest: legacy.mutationRequestDigest,
    parentDigest: candidate.parentDigest,
    receiptDigests: legacy.receiptDigests,
    runtimeManifest: candidate.runtimeManifest,
    runtimeManifestDigest: candidate.runtimeManifestDigest,
    schema: SKILL_RELEASE_SCHEMA,
    skillName: candidate.skillName,
    targetMatrix: candidate.targetMatrix,
    targetMatrixRoot: candidate.targetMatrixRoot,
    targetRuntimes: candidate.targetRuntimes,
    tenantId: candidate.tenantId,
    transitionSubjectDigest: legacy.transitionSubjectDigest,
  };
  return verifySkillRelease({
    ...core,
    releaseDigest: domainDigest(RELEASE_DOMAIN, core),
  });
}

export function verifySkillReleaseMigrationResult(value) {
  assertExactKeys(
    value,
    RELEASE_MIGRATION_RESULT_KEYS,
    "release migration result",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  if (typeof value.created !== "boolean") {
    throw migrationRequired("release migration created flag is invalid");
  }
  const release = verifySkillRelease(value.release);
  assertExactKeys(
    value.migration,
    RELEASE_MIGRATION_RECORD_KEYS,
    "release migration record",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  const migrationCore = {
    authorityId: boundedString(
      value.migration.authorityId,
      "releaseMigration.authorityId",
      256,
    ),
    candidateMigrationDigest: digest(
      value.migration.candidateMigrationDigest,
      "releaseMigration.candidateMigrationDigest",
    ),
    candidateMigrationReceiptDigest: digest(
      value.migration.candidateMigrationReceiptDigest,
      "releaseMigration.candidateMigrationReceiptDigest",
    ),
    handlerArtifactDigest: digest(
      value.migration.handlerArtifactDigest,
      "releaseMigration.handlerArtifactDigest",
    ),
    legacyCandidateId: digest(
      value.migration.legacyCandidateId,
      "releaseMigration.legacyCandidateId",
    ),
    legacyReleaseDigest: digest(
      value.migration.legacyReleaseDigest,
      "releaseMigration.legacyReleaseDigest",
    ),
    releaseDigest: digest(
      value.migration.releaseDigest,
      "releaseMigration.releaseDigest",
    ),
    schema: value.migration.schema,
    skillName: skillName(value.migration.skillName),
    tenantId: tenantId(value.migration.tenantId),
    trust: value.migration.trust,
  };
  const migration = deepFreeze({
    ...migrationCore,
    migrationDigest: digest(
      value.migration.migrationDigest,
      "releaseMigration.migrationDigest",
    ),
  });
  assertExactKeys(
    value.receipt,
    RELEASE_MIGRATION_RECEIPT_KEYS,
    "release migration receipt",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  const receipt = deepFreeze({
    authenticated: value.receipt.authenticated,
    authorityId: boundedString(
      value.receipt.authorityId,
      "releaseMigrationReceipt.authorityId",
      256,
    ),
    durable: value.receipt.durable,
    handlerArtifactDigest: digest(
      value.receipt.handlerArtifactDigest,
      "releaseMigrationReceipt.handlerArtifactDigest",
    ),
    migrationDigest: digest(
      value.receipt.migrationDigest,
      "releaseMigrationReceipt.migrationDigest",
    ),
    receiptDigest: digest(
      value.receipt.receiptDigest,
      "releaseMigrationReceipt.receiptDigest",
    ),
    schema: value.receipt.schema,
    trust: value.receipt.trust,
  });
  if (
    migration.schema !== SKILL_RELEASE_MIGRATION_RECORD_SCHEMA ||
    migration.trust !== "trusted" ||
    migration.migrationDigest !==
      domainDigest(RELEASE_MIGRATION_DOMAIN, migrationCore) ||
    migration.releaseDigest !== release.releaseDigest ||
    migration.skillName !== release.skillName ||
    migration.tenantId !== release.tenantId ||
    receipt.schema !== SKILL_RELEASE_MIGRATION_RECEIPT_SCHEMA ||
    receipt.authenticated !== true ||
    receipt.durable !== true ||
    receipt.trust !== "trusted" ||
    receipt.authorityId !== migration.authorityId ||
    receipt.handlerArtifactDigest !== migration.handlerArtifactDigest ||
    receipt.migrationDigest !== migration.migrationDigest
  ) {
    throw migrationRequired(
      "release migration result is not exactly bound and durable",
      { legacyReleaseDigest: migration.legacyReleaseDigest },
    );
  }
  return deepFreeze({
    created: value.created,
    migration,
    receipt,
    release,
  });
}

/** Verify the exact pre-tenant v2 active-state pointer. */
export function verifyLegacySkillReleaseState(value) {
  assertExactKeys(
    value,
    LEGACY_STATE_KEYS,
    "legacy release state",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  if (value.schema !== LEGACY_STATE_SCHEMA) {
    throw migrationRequired("legacy release state schema is invalid");
  }
  const core = {
    activeReleaseDigest: digest(
      value.activeReleaseDigest,
      "legacyState.activeReleaseDigest",
    ),
    authorityReceiptDigest: digest(
      value.authorityReceiptDigest,
      "legacyState.authorityReceiptDigest",
    ),
    dependencyLockDigest: digest(
      value.dependencyLockDigest,
      "legacyState.dependencyLockDigest",
    ),
    fence: safeInteger(value.fence, "legacyState.fence", { minimum: 1 }),
    lastKnownGoodReleaseDigest: digest(
      value.lastKnownGoodReleaseDigest,
      "legacyState.lastKnownGoodReleaseDigest",
    ),
    revision: safeInteger(value.revision, "legacyState.revision", {
      minimum: 1,
    }),
    schema: LEGACY_STATE_SCHEMA,
    skillName: skillName(value.skillName),
    transactionId: digest(value.transactionId, "legacyState.transactionId"),
  };
  const state = deepFreeze({
    ...core,
    stateDigest: digest(value.stateDigest, "legacyState.stateDigest"),
  });
  if (
    state.stateDigest !== domainDigest(LEGACY_STATE_DOMAIN, core) ||
    canonicalJson(value) !== canonicalJson(state)
  ) {
    throw migrationRequired(
      "legacy release state bytes or digest are invalid",
      {
        legacyStateDigest: value.stateDigest,
      },
    );
  }
  return state;
}

function verifyLegacySkillReleaseIntent(value) {
  assertExactKeys(
    value,
    LEGACY_INTENT_KEYS,
    "legacy release transition intent",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  const core = { ...value };
  delete core.intentDigest;
  if (
    core.schema !== INTENT_SCHEMA ||
    !["promote", "rollback"].includes(core.operation) ||
    domainDigest(INTENT_DOMAIN, core) !== value.intentDigest
  ) {
    throw migrationRequired("legacy journal intent digest is invalid");
  }
  for (const field of [
    "authorityReceiptDigest",
    "dependencyLockDigest",
    "expectedParentDigest",
    "nextStateDigest",
    "pointerDigest",
    "requestDigest",
    "targetReleaseDigest",
    "transactionId",
    "transitionSubjectDigest",
    "intentDigest",
  ]) {
    digest(value[field], `legacyIntent.${field}`);
  }
  digest(value.previousStateDigest, "legacyIntent.previousStateDigest", {
    nullable: true,
  });
  digest(value.candidateId, "legacyIntent.candidateId", { nullable: true });
  safeInteger(value.expectedRevision, "legacyIntent.expectedRevision");
  skillName(value.skillName);
  boundedString(value.operationId, "legacyIntent.operationId");
  normalizeReceiptDigests(value.receiptDigests);
  const authorityReceipt = verifySkillMutationConsumptionReceipt(
    value.authorityReceipt,
  );
  const mutationRequest = verifySkillMutationRequest(value.mutationRequest);
  if (
    authorityReceipt.receiptDigest !== value.authorityReceiptDigest ||
    authorityReceipt.requestDigest !== value.requestDigest ||
    authorityReceipt.operationId !== value.operationId ||
    authorityReceipt.operation !== value.operation ||
    authorityReceipt.transitionSubjectDigest !==
      value.transitionSubjectDigest ||
    authorityReceipt.skillName !== value.skillName ||
    authorityReceipt.expectedTargetDigest !== value.expectedParentDigest ||
    authorityReceipt.expectedTargetRevision !== value.expectedRevision
  ) {
    throw migrationRequired(
      "legacy journal intent authority bindings are invalid",
    );
  }
  verifyRequestReceiptBinding(mutationRequest, authorityReceipt);
  const expectedTransitionSubjectDigest = digestSkillMutationTransitionSubject({
    tenantId: mutationRequest.tenantId,
    skillName: value.skillName,
    operation: value.operation,
    candidateId: value.candidateId,
    rollbackTargetReleaseDigest:
      value.operation === SKILL_MUTATION_OPERATIONS.ROLLBACK
        ? value.targetReleaseDigest
        : null,
    dependencyLockDigest: value.dependencyLockDigest,
    expectedActiveContentDigest: value.expectedParentDigest,
    expectedActiveRevision: value.expectedRevision,
  });
  if (
    mutationRequest.requestDigest !== value.requestDigest ||
    mutationRequest.operation !== value.operation ||
    mutationRequest.transitionSubjectDigest !== value.transitionSubjectDigest ||
    canonicalJson(receiptDigestsFromRequest(mutationRequest)) !==
      canonicalJson(value.receiptDigests) ||
    value.transitionSubjectDigest !== expectedTransitionSubjectDigest ||
    canonicalJson(value) !==
      canonicalJson({ ...core, intentDigest: value.intentDigest })
  ) {
    throw migrationRequired("legacy journal intent is not exactly bound");
  }
  return deepFreeze({ ...value });
}

/** Verify the exact pre-tenant v3 crash-recovery journal without recovering it. */
export function verifyLegacySkillReleaseJournal(value) {
  assertExactKeys(
    value,
    LEGACY_JOURNAL_KEYS,
    "legacy release journal",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  const core = { ...value };
  delete core.journalDigest;
  if (
    core.schema !== LEGACY_JOURNAL_SCHEMA ||
    !["journaled", "prepared", "pointer-written"].includes(core.phase) ||
    typeof core.leaseToken !== "string" ||
    !TOKEN_PATTERN.test(core.leaseToken) ||
    typeof core.stagedFile !== "string" ||
    !TEMP_PATTERN.test(core.stagedFile) ||
    domainDigest(LEGACY_JOURNAL_DOMAIN, core) !== value.journalDigest
  ) {
    throw migrationRequired("legacy release journal digest is invalid");
  }
  const intent = verifyLegacySkillReleaseIntent(core.intent);
  const nextState = verifyLegacySkillReleaseState(core.nextState);
  const previousState =
    core.previousState === null
      ? null
      : verifyLegacySkillReleaseState(core.previousState);
  if (
    intent.transactionId !== core.transactionId ||
    nextState.transactionId !== core.transactionId ||
    nextState.skillName !== core.skillName ||
    intent.skillName !== core.skillName ||
    nextState.stateDigest !== intent.nextStateDigest ||
    nextState.stateDigest !== intent.pointerDigest ||
    nextState.activeReleaseDigest !== intent.targetReleaseDigest ||
    nextState.authorityReceiptDigest !== intent.authorityReceiptDigest ||
    nextState.dependencyLockDigest !== intent.dependencyLockDigest ||
    nextState.revision !== intent.expectedRevision + 1 ||
    (previousState === null
      ? intent.previousStateDigest !== null || intent.expectedRevision !== 0
      : previousState.skillName !== core.skillName ||
        previousState.stateDigest !== intent.previousStateDigest ||
        previousState.revision !== intent.expectedRevision)
  ) {
    throw migrationRequired(
      "legacy release journal transition bindings are invalid",
    );
  }
  if (core.prepareReceipt !== null) {
    const prepared = verifyLedgerProjection(core.prepareReceipt, {
      authorityReceiptDigest: intent.authorityReceiptDigest,
      intentDigest: intent.intentDigest,
      transactionId: intent.transactionId,
    });
    if (prepared.status !== "prepared") {
      throw migrationRequired(
        "legacy journal prepare receipt has the wrong status",
      );
    }
  } else if (core.phase !== "journaled") {
    throw migrationRequired(
      "legacy prepared journal is missing its projection",
    );
  }
  const journal = deepFreeze({
    ...core,
    intent,
    journalDigest: value.journalDigest,
    nextState,
    previousState,
  });
  if (canonicalJson(journal) !== canonicalJson(value)) {
    throw migrationRequired("legacy release journal is not canonical");
  }
  return journal;
}

/**
 * Build the immutable input for a future authenticated ledger migration.
 * This never writes an active pointer: only a ledger adapter that can retain
 * this exact plan and return an authenticated current projection may do so.
 */
export function buildSkillReleaseStateMigrationPlan(input) {
  assertExactKeys(
    input,
    STATE_MIGRATION_PLAN_INPUT_KEYS,
    "release state migration plan input",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  const legacyState = verifyLegacySkillReleaseState(input.legacyState);
  const active = verifySkillReleaseMigrationResult(
    input.activeReleaseMigration,
  );
  const lastKnownGood = verifySkillReleaseMigrationResult(
    input.lastKnownGoodReleaseMigration,
  );
  if (
    active.migration.legacyReleaseDigest !== legacyState.activeReleaseDigest ||
    lastKnownGood.migration.legacyReleaseDigest !==
      legacyState.lastKnownGoodReleaseDigest ||
    active.release.skillName !== legacyState.skillName ||
    lastKnownGood.release.skillName !== legacyState.skillName ||
    active.release.tenantId !== lastKnownGood.release.tenantId ||
    active.release.authorityReceiptDigest !==
      legacyState.authorityReceiptDigest ||
    active.release.dependencyLock.lockDigest !==
      legacyState.dependencyLockDigest
  ) {
    throw migrationRequired(
      "legacy state is not exactly bound to its migrated releases",
      { legacyStateDigest: legacyState.stateDigest },
    );
  }
  const core = {
    activeReleaseDigest: active.release.releaseDigest,
    activeReleaseMigrationDigest: active.migration.migrationDigest,
    activeReleaseMigrationReceiptDigest: active.receipt.receiptDigest,
    dependencyLockDigest: active.release.dependencyLockDigest,
    lastKnownGoodReleaseDigest: lastKnownGood.release.releaseDigest,
    lastKnownGoodReleaseMigrationDigest:
      lastKnownGood.migration.migrationDigest,
    lastKnownGoodReleaseMigrationReceiptDigest:
      lastKnownGood.receipt.receiptDigest,
    legacyActiveReleaseDigest: legacyState.activeReleaseDigest,
    legacyFence: legacyState.fence,
    legacyLastKnownGoodReleaseDigest: legacyState.lastKnownGoodReleaseDigest,
    legacyRevision: legacyState.revision,
    legacyStateDigest: legacyState.stateDigest,
    legacyTransactionId: legacyState.transactionId,
    requiresAuthenticatedLedgerMigration: true,
    schema: SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA,
    skillName: legacyState.skillName,
    tenantId: active.release.tenantId,
  };
  return deepFreeze({
    ...core,
    stateMigrationDigest: domainDigest(STATE_MIGRATION_PLAN_DOMAIN, core),
  });
}

export function verifySkillReleaseStateMigrationPlan(value) {
  assertExactKeys(
    value,
    STATE_MIGRATION_PLAN_KEYS,
    "release state migration plan",
    SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
  );
  const core = {
    activeReleaseDigest: digest(
      value.activeReleaseDigest,
      "stateMigration.activeReleaseDigest",
    ),
    activeReleaseMigrationDigest: digest(
      value.activeReleaseMigrationDigest,
      "stateMigration.activeReleaseMigrationDigest",
    ),
    activeReleaseMigrationReceiptDigest: digest(
      value.activeReleaseMigrationReceiptDigest,
      "stateMigration.activeReleaseMigrationReceiptDigest",
    ),
    dependencyLockDigest: digest(
      value.dependencyLockDigest,
      "stateMigration.dependencyLockDigest",
    ),
    lastKnownGoodReleaseDigest: digest(
      value.lastKnownGoodReleaseDigest,
      "stateMigration.lastKnownGoodReleaseDigest",
    ),
    lastKnownGoodReleaseMigrationDigest: digest(
      value.lastKnownGoodReleaseMigrationDigest,
      "stateMigration.lastKnownGoodReleaseMigrationDigest",
    ),
    lastKnownGoodReleaseMigrationReceiptDigest: digest(
      value.lastKnownGoodReleaseMigrationReceiptDigest,
      "stateMigration.lastKnownGoodReleaseMigrationReceiptDigest",
    ),
    legacyActiveReleaseDigest: digest(
      value.legacyActiveReleaseDigest,
      "stateMigration.legacyActiveReleaseDigest",
    ),
    legacyFence: safeInteger(value.legacyFence, "stateMigration.legacyFence", {
      minimum: 1,
    }),
    legacyLastKnownGoodReleaseDigest: digest(
      value.legacyLastKnownGoodReleaseDigest,
      "stateMigration.legacyLastKnownGoodReleaseDigest",
    ),
    legacyRevision: safeInteger(
      value.legacyRevision,
      "stateMigration.legacyRevision",
      { minimum: 1 },
    ),
    legacyStateDigest: digest(
      value.legacyStateDigest,
      "stateMigration.legacyStateDigest",
    ),
    legacyTransactionId: digest(
      value.legacyTransactionId,
      "stateMigration.legacyTransactionId",
    ),
    requiresAuthenticatedLedgerMigration:
      value.requiresAuthenticatedLedgerMigration,
    schema: value.schema,
    skillName: skillName(value.skillName),
    tenantId: tenantId(value.tenantId),
  };
  const plan = deepFreeze({
    ...core,
    stateMigrationDigest: digest(
      value.stateMigrationDigest,
      "stateMigration.stateMigrationDigest",
    ),
  });
  if (
    plan.schema !== SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA ||
    plan.requiresAuthenticatedLedgerMigration !== true ||
    plan.stateMigrationDigest !==
      domainDigest(STATE_MIGRATION_PLAN_DOMAIN, core) ||
    canonicalJson(plan) !== canonicalJson(value)
  ) {
    throw migrationRequired("release state migration plan is invalid", {
      stateMigrationDigest: value.stateMigrationDigest,
    });
  }
  return plan;
}

export function verifySkillRelease(value) {
  if (
    value &&
    typeof value === "object" &&
    !utilTypes.isProxy(value) &&
    Object.getOwnPropertyDescriptor(value, "schema")?.value ===
      LEGACY_RELEASE_SCHEMA
  ) {
    throw migrationRequired(
      "legacy SkillRelease v3 requires explicit tenant-scoped migration",
    );
  }
  assertExactKeys(value, RELEASE_KEYS, "release");
  if (value.schema !== SKILL_RELEASE_SCHEMA) {
    throw failure("SKILL_RELEASE_INVALID", "release schema is invalid");
  }
  const candidate = verifySkillCandidateDraft(value.candidate);
  const core = {
    authorityReceiptDigest: digest(
      value.authorityReceiptDigest,
      "authorityReceiptDigest",
    ),
    candidate,
    candidateId: digest(value.candidateId, "candidateId"),
    contentDigest: digest(value.contentDigest, "contentDigest"),
    dependencyLock: normalizeJson(value.dependencyLock, "dependencyLock"),
    dependencyLockDigest: digest(
      value.dependencyLockDigest,
      "dependencyLockDigest",
    ),
    mutationRequestDigest: digest(
      value.mutationRequestDigest,
      "mutationRequestDigest",
    ),
    parentDigest: digest(value.parentDigest, "parentDigest", {
      nullable: true,
    }),
    receiptDigests: normalizeReceiptDigests(value.receiptDigests),
    runtimeManifest: normalizeJson(value.runtimeManifest, "runtimeManifest"),
    runtimeManifestDigest: digest(
      value.runtimeManifestDigest,
      "runtimeManifestDigest",
    ),
    schema: SKILL_RELEASE_SCHEMA,
    skillName: skillName(value.skillName),
    targetMatrix: normalizeJson(value.targetMatrix, "targetMatrix"),
    targetMatrixRoot: digest(value.targetMatrixRoot, "targetMatrixRoot"),
    targetRuntimes: normalizeJson(value.targetRuntimes, "targetRuntimes"),
    tenantId: tenantId(value.tenantId),
    transitionSubjectDigest: digest(
      value.transitionSubjectDigest,
      "transitionSubjectDigest",
    ),
  };
  if (
    !Array.isArray(core.targetRuntimes) ||
    core.tenantId !== candidate.tenantId ||
    core.skillName !== candidate.skillName ||
    core.candidateId !== candidate.candidateId ||
    core.parentDigest !== candidate.parentDigest ||
    core.contentDigest !== candidate.contentDigest ||
    core.dependencyLockDigest !== candidate.dependencyLockDigest ||
    core.runtimeManifestDigest !== candidate.runtimeManifestDigest ||
    core.targetMatrixRoot !== candidate.targetMatrixRoot ||
    canonicalJson(core.dependencyLock) !==
      canonicalJson(candidate.dependencyLock) ||
    canonicalJson(core.runtimeManifest) !==
      canonicalJson(candidate.runtimeManifest) ||
    canonicalJson(core.targetMatrix) !==
      canonicalJson(candidate.targetMatrix) ||
    canonicalJson(core.targetRuntimes) !==
      canonicalJson(candidate.targetRuntimes) ||
    digest(value.releaseDigest, "releaseDigest") !==
      domainDigest(RELEASE_DOMAIN, core)
  ) {
    throw failure(
      "SKILL_RELEASE_INVALID",
      "release digest verification failed",
    );
  }
  return deepFreeze({ ...core, releaseDigest: value.releaseDigest });
}

const STATE_KEYS = new Set([
  "activeReleaseDigest",
  "authorityReceiptDigest",
  "dependencyLockDigest",
  "fence",
  "lastKnownGoodReleaseDigest",
  "revision",
  "schema",
  "skillName",
  "stateDigest",
  "tenantId",
  "transactionId",
]);

function buildState(input) {
  const core = {
    activeReleaseDigest: input.activeReleaseDigest,
    authorityReceiptDigest: input.authorityReceiptDigest,
    dependencyLockDigest: input.dependencyLockDigest,
    fence: input.fence,
    lastKnownGoodReleaseDigest: input.lastKnownGoodReleaseDigest,
    revision: input.revision,
    schema: SKILL_RELEASE_STATE_SCHEMA,
    skillName: input.skillName,
    tenantId: input.tenantId,
    transactionId: input.transactionId,
  };
  return deepFreeze({ ...core, stateDigest: domainDigest(STATE_DOMAIN, core) });
}

function initialState(name, ownerTenantId) {
  return buildState({
    activeReleaseDigest: null,
    authorityReceiptDigest: null,
    dependencyLockDigest: null,
    fence: 0,
    lastKnownGoodReleaseDigest: null,
    revision: 0,
    skillName: name,
    tenantId: ownerTenantId,
    transactionId: null,
  });
}

export function verifySkillReleaseState(value) {
  if (
    value &&
    typeof value === "object" &&
    !utilTypes.isProxy(value) &&
    Object.getOwnPropertyDescriptor(value, "schema")?.value ===
      LEGACY_STATE_SCHEMA
  ) {
    throw migrationRequired(
      "legacy Skill release state requires explicit tenant-scoped migration",
    );
  }
  assertExactKeys(
    value,
    STATE_KEYS,
    "release state",
    "SKILL_RELEASE_STATE_CORRUPT",
  );
  if (value.schema !== SKILL_RELEASE_STATE_SCHEMA) {
    throw failure("SKILL_RELEASE_STATE_CORRUPT", "state schema is invalid");
  }
  const normalized = buildState({
    activeReleaseDigest: digest(
      value.activeReleaseDigest,
      "activeReleaseDigest",
    ),
    authorityReceiptDigest: digest(
      value.authorityReceiptDigest,
      "authorityReceiptDigest",
    ),
    dependencyLockDigest: digest(
      value.dependencyLockDigest,
      "dependencyLockDigest",
    ),
    fence: safeInteger(value.fence, "fence", { minimum: 1 }),
    lastKnownGoodReleaseDigest: digest(
      value.lastKnownGoodReleaseDigest,
      "lastKnownGoodReleaseDigest",
    ),
    revision: safeInteger(value.revision, "revision", { minimum: 1 }),
    skillName: skillName(value.skillName),
    tenantId: tenantId(value.tenantId, "state tenantId"),
    transactionId: digest(value.transactionId, "transactionId"),
  });
  if (normalized.stateDigest !== value.stateDigest) {
    throw failure("SKILL_RELEASE_STATE_CORRUPT", "state digest is invalid");
  }
  return normalized;
}

const PREPARE_PROJECTION_KEYS = new Set([
  "authenticated",
  "authorityReceiptDigest",
  "durable",
  "epoch",
  "headDigest",
  "intentDigest",
  "ledgerId",
  "receiptDigest",
  "schema",
  "sequence",
  "status",
  "transactionId",
]);
const COMMITTED_PROJECTION_KEYS = new Set([
  ...PREPARE_PROJECTION_KEYS,
  "current",
  "pointerDigest",
  "prepareReceiptDigest",
  "revision",
  "skillName",
  "stateDigest",
]);
const ABSENT_PROJECTION_KEYS = new Set([
  "authenticated",
  "durable",
  "schema",
  "status",
  "transactionId",
]);

/*
 * `transactionLedger` is a trusted domain adapter, not a raw JSON ledger.
 * It must authenticate the underlying ledger identity/head/anchor and the
 * authority audit head before returning these projections. `current` must be
 * derived from the verified per-Skill finalize lineage, never copied from an
 * event supplied by the caller.
 */
function verifyLedgerProjection(value, expected) {
  const keys =
    value?.status === "absent"
      ? ABSENT_PROJECTION_KEYS
      : value?.status === "prepared"
        ? PREPARE_PROJECTION_KEYS
        : COMMITTED_PROJECTION_KEYS;
  assertExactKeys(
    value,
    keys,
    "transaction ledger projection",
    "SKILL_RELEASE_LEDGER_INVALID",
  );
  if (
    value.schema !== SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.transactionId !== expected.transactionId ||
    !["absent", "prepared", "committed"].includes(value.status)
  ) {
    throw failure(
      "SKILL_RELEASE_LEDGER_INVALID",
      "transaction ledger projection is not authenticated and bound",
    );
  }
  if (value.status === "absent") return deepFreeze({ ...value });
  if (
    (expected.intentDigest !== undefined &&
      value.intentDigest !== expected.intentDigest) ||
    (expected.authorityReceiptDigest !== undefined &&
      value.authorityReceiptDigest !== expected.authorityReceiptDigest) ||
    typeof value.ledgerId !== "string" ||
    value.ledgerId.length < 1 ||
    typeof value.epoch !== "string" ||
    !LEDGER_EPOCH_PATTERN.test(value.epoch) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1
  ) {
    throw failure(
      "SKILL_RELEASE_LEDGER_INVALID",
      "transaction ledger projection does not match the transition intent",
    );
  }
  for (const field of ["headDigest", "receiptDigest"])
    digest(value[field], field);
  if (value.status === "committed") {
    if (
      value.stateDigest !== expected.stateDigest ||
      value.pointerDigest !== expected.pointerDigest ||
      (expected.skillName !== undefined &&
        value.skillName !== expected.skillName) ||
      (expected.revision !== undefined &&
        value.revision !== expected.revision) ||
      typeof value.current !== "boolean" ||
      (expected.prepareReceiptDigest !== undefined &&
        value.prepareReceiptDigest !== expected.prepareReceiptDigest)
    ) {
      throw failure(
        "SKILL_RELEASE_LEDGER_INVALID",
        "committed projection does not bind the active pointer",
      );
    }
    digest(value.prepareReceiptDigest, "prepareReceiptDigest");
    digest(value.stateDigest, "stateDigest");
    digest(value.pointerDigest, "pointerDigest");
    skillName(value.skillName);
    safeInteger(value.revision, "projection.revision", { minimum: 1 });
  }
  return deepFreeze({ ...value });
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
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

function identity(stat) {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

function realpath(fsImpl, value) {
  const implementation = fsImpl.realpathSync?.native || fsImpl.realpathSync;
  if (typeof implementation !== "function") {
    throw failure("SKILL_RELEASE_STORE_UNSAFE", "realpath is unavailable");
  }
  return path.resolve(implementation(value));
}

function fsyncDirectory(fsImpl, directory) {
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(directory, "r");
    fsImpl.fsyncSync(descriptor);
  } catch (error) {
    if (!(
      process.platform === "win32" &&
      ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)
    )) {
      throw error;
    }
  } finally {
    if (descriptor !== null) fsImpl.closeSync(descriptor);
  }
}

const TENANT_MARKER_KEYS = new Set([
  "component",
  "markerDigest",
  "schema",
  "tenantId",
  "tenantKey",
]);
const REGISTRY_OPTION_KEYS = new Set([
  "crashHook",
  "fsImpl",
  "leaseTtlMs",
  "now",
  "randomToken",
  "rootDir",
  "secure",
  "tenantId",
  "transactionLedger",
]);

function buildTenantMarker(ownerTenantId, tenantKey) {
  const core = {
    schema: SKILL_RELEASE_TENANT_MARKER_SCHEMA,
    component: TENANT_MARKER_COMPONENT,
    tenantId: ownerTenantId,
    tenantKey,
  };
  return deepFreeze({
    ...core,
    markerDigest: domainDigest(TENANT_MARKER_DIGEST_DOMAIN, core),
  });
}

function serializeTenantMarker(marker) {
  const bytes = Buffer.from(`${canonicalJson(marker)}\n`, "utf8");
  if (bytes.length < 1 || bytes.length > MAX_TENANT_MARKER_BYTES) {
    throw failure(
      "SKILL_RELEASE_STORE_UNSAFE",
      "release tenant marker exceeds its size limit",
    );
  }
  return bytes;
}

function verifyTenantMarker(value, expectedTenantId, expectedTenantKey) {
  assertExactKeys(
    value,
    TENANT_MARKER_KEYS,
    "release tenant marker",
    "SKILL_RELEASE_STORE_UNSAFE",
  );
  const normalizedTenantId = tenantId(value.tenantId, "marker tenantId");
  if (
    value.schema !== SKILL_RELEASE_TENANT_MARKER_SCHEMA ||
    value.component !== TENANT_MARKER_COMPONENT ||
    typeof value.tenantKey !== "string" ||
    !TENANT_KEY_PATTERN.test(value.tenantKey)
  ) {
    throw failure(
      "SKILL_RELEASE_STORE_UNSAFE",
      "release tenant marker contract is invalid",
    );
  }
  const normalized = buildTenantMarker(normalizedTenantId, value.tenantKey);
  if (
    value.markerDigest !== normalized.markerDigest ||
    normalizedTenantId !== expectedTenantId ||
    value.tenantKey !== expectedTenantKey ||
    value.tenantKey !== deriveSkillReleaseTenantKey(normalizedTenantId)
  ) {
    throw failure(
      "SKILL_RELEASE_STORE_UNSAFE",
      "release tenant marker belongs to another tenant or root",
    );
  }
  return normalized;
}

function lstatOrNull(fsImpl, target) {
  try {
    return fsImpl.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function readBoundedSingleLinkFile(fsImpl, filePath, maximum, code, label) {
  let descriptor = null;
  try {
    const before = fsImpl.lstatSync(filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      Number(before.nlink) !== 1 ||
      before.size < 1 ||
      before.size > maximum ||
      !samePath(realpath(fsImpl, filePath), filePath)
    ) {
      throw failure(code, `${label} must be a bounded single-link file`);
    }
    descriptor = fsImpl.openSync(
      filePath,
      fsImpl.constants.O_RDONLY | (fsImpl.constants.O_NOFOLLOW || 0),
    );
    const opened = fsImpl.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      Number(opened.nlink) !== 1 ||
      identity(opened) !== identity(before) ||
      opened.size !== before.size
    ) {
      throw failure(code, `${label} changed while opening`);
    }
    const bytes = fsImpl.readFileSync(descriptor);
    const after = fsImpl.fstatSync(descriptor);
    const afterPath = fsImpl.lstatSync(filePath);
    if (
      Number(after.nlink) !== 1 ||
      identity(after) !== identity(opened) ||
      after.size !== opened.size ||
      bytes.length !== opened.size ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      Number(afterPath.nlink) !== 1 ||
      identity(afterPath) !== identity(opened) ||
      !samePath(realpath(fsImpl, filePath), filePath)
    ) {
      throw failure(code, `${label} changed while reading`);
    }
    return { bytes, identity: identity(opened) };
  } finally {
    if (descriptor !== null) fsImpl.closeSync(descriptor);
  }
}

function normalizeRegistryOptions(options) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    utilTypes.isProxy(options) ||
    !isPlainObject(options)
  ) {
    throw failure(
      "SKILL_RELEASE_INVALID",
      "release registry options must be an explicit object",
    );
  }
  const keys = Reflect.ownKeys(options);
  if (
    !Object.hasOwn(options, "tenantId") ||
    keys.some(
      (key) => typeof key !== "string" || !REGISTRY_OPTION_KEYS.has(key),
    )
  ) {
    throw failure(
      "SKILL_RELEASE_INVALID",
      "release registry options must include tenantId and only supported fields",
    );
  }
  const data = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(
        "SKILL_RELEASE_INVALID",
        `release registry options.${String(key)} must be an own data field`,
      );
    }
    data[key] = descriptor.value;
  }
  return {
    crashHook: data.crashHook ?? null,
    fsImpl: data.fsImpl ?? fs,
    leaseTtlMs: data.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
    now: data.now ?? (() => new Date()),
    randomToken:
      data.randomToken ?? (() => crypto.randomBytes(16).toString("hex")),
    rootDir:
      data.rootDir ??
      path.join(getHomeDir(), "evolution", "registry", "releases"),
    secure: data.secure ?? true,
    tenantId: tenantId(data.tenantId),
    transactionLedger: data.transactionLedger,
  };
}

export class SkillReleaseRegistry {
  #fs;

  #directories;

  #boundaries;

  #rootIdentity;

  #markerPath;

  #markerIdentity;

  #secure;

  #randomToken;

  #now;

  #leaseTtlMs;

  #crashHook;

  #ledgerPrepare;

  #ledgerFinalize;

  #ledgerMigrate;

  #ledgerQuery;

  #pins = new WeakMap();

  constructor(options) {
    const {
      crashHook,
      fsImpl,
      leaseTtlMs,
      now,
      randomToken,
      rootDir,
      secure,
      tenantId: ownerTenantId,
      transactionLedger,
    } = normalizeRegistryOptions(options);
    if (
      !transactionLedger ||
      typeof transactionLedger.prepare !== "function" ||
      typeof transactionLedger.finalize !== "function" ||
      typeof transactionLedger.query !== "function"
    ) {
      throw failure(
        "SKILL_RELEASE_LEDGER_REQUIRED",
        "authenticated transactionLedger prepare/finalize/query ports are required",
      );
    }
    if (
      (secure !== true && secure !== false) ||
      !fsImpl ||
      typeof fsImpl !== "object" ||
      utilTypes.isProxy(fsImpl) ||
      typeof randomToken !== "function" ||
      utilTypes.isProxy(randomToken) ||
      typeof now !== "function" ||
      utilTypes.isProxy(now) ||
      !Number.isSafeInteger(leaseTtlMs) ||
      leaseTtlMs < MIN_LEASE_TTL_MS ||
      (crashHook !== null && typeof crashHook !== "function")
    ) {
      throw failure("SKILL_RELEASE_INVALID", "registry options are invalid");
    }

    this.#fs = fsImpl;
    this.#secure = secure;
    this.#randomToken = randomToken;
    this.#now = now;
    this.#leaseTtlMs = leaseTtlMs;
    this.#crashHook = crashHook;
    this.#ledgerPrepare = transactionLedger.prepare.bind(transactionLedger);
    this.#ledgerFinalize = transactionLedger.finalize.bind(transactionLedger);
    this.#ledgerMigrate =
      typeof transactionLedger.migrate === "function"
        ? transactionLedger.migrate.bind(transactionLedger)
        : null;
    this.#ledgerQuery = transactionLedger.query.bind(transactionLedger);
    Object.freeze(transactionLedger);

    this.tenantId = ownerTenantId;
    this.tenantKey = deriveSkillReleaseTenantKey(ownerTenantId);
    const requestedBase = path.resolve(rootDir);
    try {
      const base = this.#initializeDirectory(requestedBase, {
        recursive: true,
      });
      this.baseDir = base.path;
      this.#assertNoLegacyBaseLayout();
      const tenants = this.#initializeDirectory(
        path.join(this.baseDir, "tenants"),
        { parent: base },
      );
      const tenantRoot = this.#initializeDirectory(
        path.join(tenants.path, this.tenantKey),
        { parent: tenants },
      );
      this.rootDir = tenantRoot.path;
      this.#boundaries = deepFreeze({ base, tenantRoot, tenants });
      this.#rootIdentity = tenantRoot.identity;
      this.#markerPath = path.join(this.rootDir, TENANT_MARKER_FILE);
      this.#initializeTenantMarker();
      this.#directories = {};
      for (const name of [
        "artifacts",
        "active",
        "journals",
        "locks",
        "staging",
      ]) {
        const directory = path.join(this.rootDir, name);
        this.#directories[name] = this.#initializeDirectory(directory, {
          parent: tenantRoot,
        });
      }
      this.#directories = deepFreeze(this.#directories);
      this.#assertBoundary();
      this.#assertNoLegacyTenantSchemas();
      this.#recoverAll();
      this.#cleanupDebris();
    } catch (cause) {
      if (cause instanceof SkillReleaseRegistryError) throw cause;
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "registry could not be initialized safely",
        { cause },
      );
    }
    Object.freeze(this);
  }

  #initializeDirectory(
    requestedPath,
    { parent = null, recursive = false } = {},
  ) {
    const before = lstatOrNull(this.#fs, requestedPath);
    if (before && (!before.isDirectory() || before.isSymbolicLink())) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "release registry directory path is unsafe",
      );
    }
    if (!before) {
      this.#fs.mkdirSync(requestedPath, { recursive, mode: 0o700 });
    }
    let stat = this.#fs.lstatSync(requestedPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "release registry directory must be non-symlink",
      );
    }
    const capturedIdentity = identity(stat);
    const canonical = realpath(this.#fs, requestedPath);
    const canonicalStat = this.#fs.lstatSync(canonical);
    const canonicalParent = realpath(this.#fs, path.dirname(requestedPath));
    const expectedCanonical = path.join(
      canonicalParent,
      path.basename(requestedPath),
    );
    if (
      !canonicalStat.isDirectory() ||
      canonicalStat.isSymbolicLink() ||
      identity(canonicalStat) !== capturedIdentity ||
      !samePath(canonical, expectedCanonical) ||
      (parent &&
        (!isContained(parent.path, canonical) ||
          !samePath(path.dirname(canonical), parent.path)))
    ) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "release registry directory escaped its canonical parent",
      );
    }
    if (this.#secure) {
      ensurePrivateDirectory(canonical, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      });
      stat = this.#fs.lstatSync(canonical);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        identity(stat) !== capturedIdentity ||
        !samePath(realpath(this.#fs, canonical), canonical)
      ) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "release registry directory changed during permission hardening",
        );
      }
    }
    return deepFreeze({ path: canonical, identity: capturedIdentity });
  }

  #assertNoLegacyBaseLayout() {
    for (const entry of this.#fs.readdirSync(this.baseDir)) {
      if (entry !== "tenants") {
        throw migrationRequired(
          "legacy unscoped SkillRelease storage requires explicit migration",
          { path: path.join(this.baseDir, entry) },
        );
      }
    }
  }

  #initializeTenantMarker() {
    const existing = lstatOrNull(this.#fs, this.#markerPath);
    if (existing) {
      const verified = this.#readAndVerifyTenantMarker();
      this.#markerIdentity = verified.identity;
      return;
    }
    if (this.#fs.readdirSync(this.rootDir).length !== 0) {
      throw migrationRequired(
        "unmarked or mixed-schema release tenant storage requires explicit migration",
      );
    }
    const marker = buildTenantMarker(this.tenantId, this.tenantKey);
    const bytes = serializeTenantMarker(marker);
    const temporaryPath = path.join(
      this.rootDir,
      `.tenant-${process.pid}-${this.#token("SKILL_RELEASE_STORE_UNSAFE")}.tmp`,
    );
    let descriptor = null;
    let temporaryExists = false;
    try {
      descriptor = this.#fs.openSync(temporaryPath, "wx", 0o600);
      temporaryExists = true;
      this.#fs.writeFileSync(descriptor, bytes);
      this.#fs.fsyncSync(descriptor);
      const written = this.#fs.fstatSync(descriptor);
      if (
        !written.isFile() ||
        Number(written.nlink) !== 1 ||
        written.size !== bytes.length
      ) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "release tenant marker temporary file is unsafe",
        );
      }
      const writtenIdentity = identity(written);
      this.#fs.closeSync(descriptor);
      descriptor = null;
      if (this.#secure) {
        ensurePrivateFile(temporaryPath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      }
      const staged = this.#fs.lstatSync(temporaryPath);
      if (
        !staged.isFile() ||
        staged.isSymbolicLink() ||
        Number(staged.nlink) !== 1 ||
        staged.size !== bytes.length ||
        identity(staged) !== writtenIdentity ||
        !samePath(realpath(this.#fs, temporaryPath), temporaryPath)
      ) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "release tenant marker changed before publication",
        );
      }
      try {
        this.#fs.linkSync(temporaryPath, this.#markerPath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        this.#fs.unlinkSync(temporaryPath);
        temporaryExists = false;
        const verified = this.#readAndVerifyTenantMarker();
        this.#markerIdentity = verified.identity;
        return;
      }
      const linked = this.#fs.lstatSync(this.#markerPath);
      if (
        !linked.isFile() ||
        linked.isSymbolicLink() ||
        Number(linked.nlink) !== 2 ||
        identity(linked) !== writtenIdentity
      ) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "release tenant marker publication was unsafe",
        );
      }
      this.#fs.unlinkSync(temporaryPath);
      temporaryExists = false;
      fsyncDirectory(this.#fs, this.rootDir);
      const verified = this.#readAndVerifyTenantMarker();
      this.#markerIdentity = verified.identity;
    } finally {
      if (descriptor !== null) {
        try {
          this.#fs.closeSync(descriptor);
        } catch {
          // The marker was never published through the authoritative path.
        }
      }
      if (temporaryExists) {
        try {
          this.#fs.unlinkSync(temporaryPath);
        } catch {
          // The next boundary verification will fail closed on linked debris.
        }
      }
    }
  }

  #readAndVerifyTenantMarker() {
    try {
      const stored = readBoundedSingleLinkFile(
        this.#fs,
        this.#markerPath,
        MAX_TENANT_MARKER_BYTES,
        "SKILL_RELEASE_STORE_UNSAFE",
        "release tenant marker",
      );
      const marker = verifyTenantMarker(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes),
        ),
        this.tenantId,
        this.tenantKey,
      );
      if (!serializeTenantMarker(marker).equals(stored.bytes)) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "release tenant marker is not canonical JSON",
        );
      }
      return { identity: stored.identity, marker };
    } catch (cause) {
      if (cause instanceof SkillReleaseRegistryError) throw cause;
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "release tenant marker could not be verified",
        { cause },
      );
    }
  }

  #clock() {
    const value = this.#now();
    const date =
      value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw failure("SKILL_RELEASE_CLOCK_INVALID", "registry clock is invalid");
    }
    return date;
  }

  #token(code = "SKILL_RELEASE_WRITE_FAILED") {
    const value = String(this.#randomToken());
    if (!TOKEN_PATTERN.test(value)) {
      throw failure(code, "random token is invalid");
    }
    return value;
  }

  #assertBoundary() {
    for (const entry of [
      ...Object.values(this.#boundaries),
      ...Object.values(this.#directories),
    ]) {
      const stat = this.#fs.lstatSync(entry.path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        identity(stat) !== entry.identity ||
        !samePath(realpath(this.#fs, entry.path), entry.path) ||
        (this.#directories &&
          Object.values(this.#directories).includes(entry) &&
          (!isContained(this.rootDir, entry.path) ||
            !samePath(path.dirname(entry.path), this.rootDir)))
      ) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "registry directory changed",
        );
      }
    }
    if (
      !samePath(this.#boundaries.base.path, this.baseDir) ||
      !samePath(this.#boundaries.tenantRoot.path, this.rootDir) ||
      identity(this.#fs.lstatSync(this.rootDir)) !== this.#rootIdentity ||
      !samePath(path.dirname(this.#boundaries.tenants.path), this.baseDir) ||
      !samePath(path.dirname(this.rootDir), this.#boundaries.tenants.path) ||
      !isContained(this.baseDir, this.rootDir)
    ) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "release registry directory topology changed",
      );
    }
    const expectedRootEntries = new Set([
      TENANT_MARKER_FILE,
      ...Object.keys(this.#directories),
    ]);
    if (
      this.#fs
        .readdirSync(this.rootDir)
        .some((name) => !expectedRootEntries.has(name))
    ) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "release tenant root contains an unexpected entry",
      );
    }
    const verifiedMarker = this.#readAndVerifyTenantMarker();
    if (
      this.#markerIdentity !== undefined &&
      verifiedMarker.identity !== this.#markerIdentity
    ) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "release tenant marker identity changed",
      );
    }
    for (const entry of [
      ...Object.values(this.#boundaries),
      ...Object.values(this.#directories),
    ]) {
      const stat = this.#fs.lstatSync(entry.path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        identity(stat) !== entry.identity ||
        !samePath(realpath(this.#fs, entry.path), entry.path)
      ) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "release registry boundary changed during marker verification",
        );
      }
    }
  }

  #assertNoLegacyTenantSchemas() {
    const expectedRootEntries = new Set([
      TENANT_MARKER_FILE,
      ...Object.keys(this.#directories),
    ]);
    for (const name of this.#fs.readdirSync(this.rootDir)) {
      if (!expectedRootEntries.has(name)) {
        throw migrationRequired(
          "mixed release tenant layout requires explicit migration",
          { path: path.join(this.rootDir, name) },
        );
      }
    }
    const areas = [
      ["artifacts", LEGACY_RELEASE_SCHEMA],
      ["active", LEGACY_STATE_SCHEMA],
      ["journals", LEGACY_JOURNAL_SCHEMA],
    ];
    for (const [area, legacySchema] of areas) {
      for (const name of this.#fs.readdirSync(this.#directories[area].path)) {
        if (!name.endsWith(".json")) continue;
        const value = this.#readJson(
          this.#path(area, name),
          "SKILL_RELEASE_STORE_UNSAFE",
        );
        if (value?.schema === legacySchema) {
          throw migrationRequired(
            "mixed legacy SkillRelease tenant storage requires explicit migration",
            { path: this.#path(area, name), schema: legacySchema },
          );
        }
      }
    }
  }

  #path(area, fileName) {
    const directory = this.#directories[area]?.path;
    const target = path.resolve(directory, fileName);
    if (!directory || !isContained(directory, target) || target === directory) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "registry path escaped its area",
      );
    }
    return target;
  }

  #releasePath(releaseDigest) {
    return this.#path(
      "artifacts",
      `${digest(releaseDigest, "releaseDigest").slice(7)}.json`,
    );
  }

  #statePath(name) {
    return this.#path("active", `${skillName(name)}.json`);
  }

  #journalPath(name) {
    return this.#path("journals", `${skillName(name)}.json`);
  }

  #leasePath(name) {
    return this.#path("locks", `${skillName(name)}.lock`);
  }

  #recoveryLockPath() {
    return this.#path("locks", ".recovery.lock");
  }

  #exists(filePath) {
    try {
      this.#fs.lstatSync(filePath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  #readBytes(filePath, code) {
    this.#assertBoundary();
    try {
      return readBoundedSingleLinkFile(
        this.#fs,
        filePath,
        MAX_FILE_BYTES,
        code,
        "release registry artifact",
      ).bytes;
    } finally {
      this.#assertBoundary();
    }
  }

  #parseCanonical(bytes, code) {
    let parsed;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch (cause) {
      throw failure(code, "artifact is not UTF-8 JSON", { cause });
    }
    assertBoundedCanonicalPreflight(parsed, code);
    if (!serialize(parsed).equals(bytes)) {
      throw failure(code, "artifact is not canonical JSON");
    }
    return parsed;
  }

  #readJson(filePath, code) {
    return this.#parseCanonical(this.#readBytes(filePath, code), code);
  }

  #writeTemporary(fileName, value) {
    if (!TEMP_PATTERN.test(fileName)) {
      throw failure("SKILL_RELEASE_STORE_UNSAFE", "temporary name is invalid");
    }
    const filePath = this.#path("staging", fileName);
    const bytes = serialize(value);
    let descriptor = null;
    let writtenIdentity = null;
    try {
      this.#assertBoundary();
      descriptor = this.#fs.openSync(filePath, "wx", 0o600);
      this.#fs.writeFileSync(descriptor, bytes);
      this.#fs.fsyncSync(descriptor);
      const written = this.#fs.fstatSync(descriptor);
      if (
        !written.isFile() ||
        Number(written.nlink) !== 1 ||
        written.size !== bytes.length
      ) {
        throw failure(
          "SKILL_RELEASE_WRITE_FAILED",
          "temporary write was incomplete",
        );
      }
      writtenIdentity = identity(written);
    } finally {
      if (descriptor !== null) this.#fs.closeSync(descriptor);
    }
    if (this.#secure) {
      ensurePrivateFile(filePath, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      });
    }
    const staged = this.#fs.lstatSync(filePath);
    if (
      !staged.isFile() ||
      staged.isSymbolicLink() ||
      Number(staged.nlink) !== 1 ||
      identity(staged) !== writtenIdentity ||
      staged.size !== bytes.length ||
      !samePath(realpath(this.#fs, filePath), filePath)
    ) {
      throw failure(
        "SKILL_RELEASE_WRITE_FAILED",
        "temporary artifact changed before publication",
      );
    }
    fsyncDirectory(this.#fs, this.#directories.staging.path);
    this.#assertBoundary();
    return filePath;
  }

  #atomicWrite(area, destination, value) {
    const expectedBytes = serialize(value);
    const name = `.write-${process.pid}-${this.#token()}.tmp`;
    const temporary = this.#writeTemporary(name, value);
    const temporaryStat = this.#fs.lstatSync(temporary);
    this.#fs.renameSync(temporary, destination);
    const destinationDirectory = path.dirname(destination);
    const destinationStat = this.#fs.lstatSync(destinationDirectory);
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "atomic write destination directory is unsafe",
      );
    }
    const published = this.#fs.lstatSync(destination);
    if (
      !published.isFile() ||
      published.isSymbolicLink() ||
      Number(published.nlink) !== 1 ||
      identity(published) !== identity(temporaryStat) ||
      !samePath(realpath(this.#fs, destination), destination) ||
      !isContained(this.#directories[area].path, destination)
    ) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "atomic write destination changed during publication",
      );
    }
    if (
      !this.#readBytes(destination, "SKILL_RELEASE_WRITE_FAILED").equals(
        expectedBytes,
      )
    ) {
      throw failure(
        "SKILL_RELEASE_WRITE_FAILED",
        "atomic write publication did not preserve exact bytes",
      );
    }
    fsyncDirectory(this.#fs, destinationDirectory);
    if (!samePath(destinationDirectory, this.#directories[area].path)) {
      fsyncDirectory(this.#fs, this.#directories[area].path);
    }
    this.#assertBoundary();
  }

  #unlink(filePath, directory) {
    try {
      this.#fs.unlinkSync(filePath);
      fsyncDirectory(this.#fs, directory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  #publishRelease(release) {
    const destination = this.#releasePath(release.releaseDigest);
    const name = `.release-${process.pid}-${this.#token()}.tmp`;
    const temporary = this.#writeTemporary(name, release);
    const bytes = serialize(release);
    const temporaryStat = this.#fs.lstatSync(temporary);
    const temporaryIdentity = identity(temporaryStat);
    try {
      try {
        this.#fs.linkSync(temporary, destination);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = this.readRelease(release.releaseDigest);
        if (!serialize(existing).equals(bytes)) {
          throw failure("SKILL_RELEASE_CONFLICT", "release digest collision");
        }
        return false;
      }
      const linked = this.#fs.lstatSync(destination);
      if (
        !linked.isFile() ||
        linked.isSymbolicLink() ||
        Number(linked.nlink) !== 2 ||
        identity(linked) !== temporaryIdentity
      ) {
        throw failure(
          "SKILL_RELEASE_WRITE_FAILED",
          "release hardlink publication was unsafe",
        );
      }
      fsyncDirectory(this.#fs, this.#directories.artifacts.path);
      this.#unlink(temporary, this.#directories.staging.path);
      const published = this.#fs.lstatSync(destination);
      if (
        !published.isFile() ||
        published.isSymbolicLink() ||
        Number(published.nlink) !== 1 ||
        identity(published) !== temporaryIdentity ||
        !samePath(realpath(this.#fs, destination), destination)
      ) {
        throw failure(
          "SKILL_RELEASE_WRITE_FAILED",
          "published release did not become a single-link artifact",
        );
      }
      if (
        !this.#readBytes(destination, "SKILL_RELEASE_WRITE_FAILED").equals(
          bytes,
        )
      ) {
        throw failure(
          "SKILL_RELEASE_WRITE_FAILED",
          "published release did not preserve exact bytes",
        );
      }
      this.#assertBoundary();
      return true;
    } finally {
      this.#unlink(temporary, this.#directories.staging.path);
    }
  }

  #createRelease(input) {
    const release = buildSkillRelease(input);
    const created = this.#publishRelease(release);
    return deepFreeze({ release, created });
  }

  migrateLegacyRelease(input, migrationAuthority) {
    if (arguments.length !== 2) {
      throw migrationRequired(
        "legacy release migration requires input and a durable audit authority",
      );
    }
    assertExactKeys(
      migrationAuthority,
      RELEASE_MIGRATION_AUTHORITY_KEYS,
      "release migration authority",
      SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
    );
    if (
      migrationAuthority.schema !== SKILL_RELEASE_MIGRATION_AUTHORITY_SCHEMA ||
      migrationAuthority.trust !== "trusted" ||
      typeof migrationAuthority.audit !== "function"
    ) {
      throw migrationRequired(
        "release migration authority is not a trusted synchronous auditor",
      );
    }
    const authorityId = boundedString(
      migrationAuthority.authorityId,
      "migrationAuthority.authorityId",
      256,
    );
    const handlerArtifactDigest = digest(
      migrationAuthority.handlerArtifactDigest,
      "migrationAuthority.handlerArtifactDigest",
    );
    const audit = migrationAuthority.audit;
    const release = buildMigratedSkillRelease(input);
    if (release.tenantId !== this.tenantId) {
      throw migrationRequired("migrated release belongs to another tenant", {
        candidateTenantId: release.tenantId,
        tenantId: this.tenantId,
      });
    }
    const legacy = verifyLegacySkillRelease(input.legacyRelease);
    const created = this.#publishRelease(release);
    const migrationCore = deepFreeze({
      authorityId,
      candidateMigrationDigest:
        input.candidateMigration.migration.migrationDigest,
      candidateMigrationReceiptDigest:
        input.candidateMigration.receipt.receiptDigest,
      handlerArtifactDigest,
      legacyCandidateId: legacy.candidateId,
      legacyReleaseDigest: legacy.releaseDigest,
      releaseDigest: release.releaseDigest,
      schema: SKILL_RELEASE_MIGRATION_RECORD_SCHEMA,
      skillName: release.skillName,
      tenantId: this.tenantId,
      trust: "trusted",
    });
    const migration = deepFreeze({
      ...migrationCore,
      migrationDigest: domainDigest(RELEASE_MIGRATION_DOMAIN, migrationCore),
    });
    let receipt;
    try {
      receipt = audit(migration);
    } catch (cause) {
      throw failure(
        "SKILL_RELEASE_MIGRATION_AUDIT_FAILED",
        "release migration audit failed after inactive release publication",
        {
          cause,
          commitState: "inactive-release-only",
          migrationDigest: migration.migrationDigest,
          releaseDigest: release.releaseDigest,
        },
      );
    }
    if (utilTypes.isPromise(receipt)) {
      throw failure(
        "SKILL_RELEASE_MIGRATION_AUDIT_FAILED",
        "release migration audit authority must be synchronous",
        {
          commitState: "inactive-release-only",
          migrationDigest: migration.migrationDigest,
          releaseDigest: release.releaseDigest,
        },
      );
    }
    assertExactKeys(
      receipt,
      RELEASE_MIGRATION_RECEIPT_KEYS,
      "release migration receipt",
      "SKILL_RELEASE_MIGRATION_AUDIT_FAILED",
    );
    const normalizedReceipt = deepFreeze({
      authenticated: receipt.authenticated,
      authorityId: boundedString(
        receipt.authorityId,
        "migrationReceipt.authorityId",
        256,
      ),
      durable: receipt.durable,
      handlerArtifactDigest: digest(
        receipt.handlerArtifactDigest,
        "migrationReceipt.handlerArtifactDigest",
      ),
      migrationDigest: digest(
        receipt.migrationDigest,
        "migrationReceipt.migrationDigest",
      ),
      receiptDigest: digest(
        receipt.receiptDigest,
        "migrationReceipt.receiptDigest",
      ),
      schema: receipt.schema,
      trust: receipt.trust,
    });
    if (
      normalizedReceipt.schema !== SKILL_RELEASE_MIGRATION_RECEIPT_SCHEMA ||
      normalizedReceipt.authenticated !== true ||
      normalizedReceipt.durable !== true ||
      normalizedReceipt.trust !== "trusted" ||
      normalizedReceipt.authorityId !== authorityId ||
      normalizedReceipt.handlerArtifactDigest !== handlerArtifactDigest ||
      normalizedReceipt.migrationDigest !== migration.migrationDigest
    ) {
      throw failure(
        "SKILL_RELEASE_MIGRATION_AUDIT_FAILED",
        "release migration receipt is not exactly bound and durable",
        {
          commitState: "inactive-release-only",
          migrationDigest: migration.migrationDigest,
          releaseDigest: release.releaseDigest,
        },
      );
    }
    return deepFreeze({
      created,
      migration,
      receipt: normalizedReceipt,
      release,
    });
  }

  migrateLegacyState(planInput, migrationAuthority) {
    if (arguments.length !== 2 || this.#ledgerMigrate === null) {
      throw migrationRequired(
        "legacy state migration requires a plan, durable authority, and authenticated ledger migration port",
      );
    }
    const plan = verifySkillReleaseStateMigrationPlan(planInput);
    if (plan.tenantId !== this.tenantId) {
      throw migrationRequired("state migration plan belongs to another tenant");
    }
    assertExactKeys(
      migrationAuthority,
      STATE_MIGRATION_AUTHORITY_KEYS,
      "state migration authority",
      SKILL_RELEASE_MIGRATION_REQUIRED_CODE,
    );
    if (
      migrationAuthority.schema !==
        SKILL_RELEASE_STATE_MIGRATION_AUTHORITY_SCHEMA ||
      migrationAuthority.trust !== "trusted" ||
      typeof migrationAuthority.audit !== "function"
    ) {
      throw migrationRequired("state migration authority is not trusted");
    }
    const authorityId = boundedString(
      migrationAuthority.authorityId,
      "stateMigrationAuthority.authorityId",
      256,
    );
    const handlerArtifactDigest = digest(
      migrationAuthority.handlerArtifactDigest,
      "stateMigrationAuthority.handlerArtifactDigest",
    );
    const active = this.readRelease(plan.activeReleaseDigest);
    const lastKnownGood = this.readRelease(plan.lastKnownGoodReleaseDigest);
    if (
      active.skillName !== plan.skillName ||
      lastKnownGood.skillName !== plan.skillName ||
      active.tenantId !== this.tenantId ||
      lastKnownGood.tenantId !== this.tenantId ||
      active.dependencyLockDigest !== plan.dependencyLockDigest
    ) {
      throw migrationRequired(
        "state migration plan release bindings are unavailable or changed",
      );
    }
    let rawReceipt;
    try {
      rawReceipt = migrationAuthority.audit(plan);
    } catch (cause) {
      throw failure(
        "SKILL_RELEASE_STATE_MIGRATION_AUDIT_FAILED",
        "state migration audit authority failed before ledger commit",
        { cause, stateMigrationDigest: plan.stateMigrationDigest },
      );
    }
    if (utilTypes.isPromise(rawReceipt)) {
      throw failure(
        "SKILL_RELEASE_STATE_MIGRATION_AUDIT_FAILED",
        "state migration audit authority must be synchronous",
        { stateMigrationDigest: plan.stateMigrationDigest },
      );
    }
    assertExactKeys(
      rawReceipt,
      STATE_MIGRATION_RECEIPT_KEYS,
      "state migration receipt",
      "SKILL_RELEASE_STATE_MIGRATION_AUDIT_FAILED",
    );
    const receipt = deepFreeze({
      authenticated: rawReceipt.authenticated,
      authorityId: boundedString(
        rawReceipt.authorityId,
        "stateMigrationReceipt.authorityId",
        256,
      ),
      durable: rawReceipt.durable,
      handlerArtifactDigest: digest(
        rawReceipt.handlerArtifactDigest,
        "stateMigrationReceipt.handlerArtifactDigest",
      ),
      receiptDigest: digest(
        rawReceipt.receiptDigest,
        "stateMigrationReceipt.receiptDigest",
      ),
      schema: rawReceipt.schema,
      stateMigrationDigest: digest(
        rawReceipt.stateMigrationDigest,
        "stateMigrationReceipt.stateMigrationDigest",
      ),
      trust: rawReceipt.trust,
    });
    if (
      receipt.schema !== SKILL_RELEASE_STATE_MIGRATION_RECEIPT_SCHEMA ||
      receipt.authenticated !== true ||
      receipt.durable !== true ||
      receipt.trust !== "trusted" ||
      receipt.authorityId !== authorityId ||
      receipt.handlerArtifactDigest !== handlerArtifactDigest ||
      receipt.stateMigrationDigest !== plan.stateMigrationDigest
    ) {
      throw failure(
        "SKILL_RELEASE_STATE_MIGRATION_AUDIT_FAILED",
        "state migration receipt is not exactly bound and durable",
        { stateMigrationDigest: plan.stateMigrationDigest },
      );
    }
    const existing = this.readState(plan.skillName);
    if (existing.revision > 0) {
      if (
        existing.transactionId !== plan.stateMigrationDigest ||
        existing.activeReleaseDigest !== plan.activeReleaseDigest ||
        existing.lastKnownGoodReleaseDigest !==
          plan.lastKnownGoodReleaseDigest ||
        existing.dependencyLockDigest !== plan.dependencyLockDigest ||
        existing.revision !== plan.legacyRevision ||
        existing.fence !== plan.legacyFence
      ) {
        throw failure(
          "SKILL_RELEASE_STATE_MIGRATION_CONFLICT",
          "active state is not the exact result of this migration plan",
        );
      }
      return deepFreeze({ created: false, plan, receipt, state: existing });
    }
    const acquired = this.#acquireLease(
      plan.skillName,
      plan.stateMigrationDigest,
      0,
      EMPTY_SKILL_ACTIVE_DIGEST,
    );
    const { heartbeat, lease } = acquired;
    try {
      const state = buildState({
        activeReleaseDigest: plan.activeReleaseDigest,
        authorityReceiptDigest: active.authorityReceiptDigest,
        dependencyLockDigest: plan.dependencyLockDigest,
        fence: plan.legacyFence,
        lastKnownGoodReleaseDigest: plan.lastKnownGoodReleaseDigest,
        revision: plan.legacyRevision,
        skillName: plan.skillName,
        tenantId: this.tenantId,
        transactionId: plan.stateMigrationDigest,
      });
      const request = deepFreeze({
        plan,
        receipt,
        schema: SKILL_RELEASE_STATE_LEDGER_MIGRATION_SCHEMA,
        state,
      });
      let projection;
      try {
        projection = this.#ledgerMigrate(request);
      } catch (cause) {
        throw failure(
          "SKILL_RELEASE_STATE_MIGRATION_LEDGER_FAILED",
          "state migration ledger commit failed closed",
          { cause, stateMigrationDigest: plan.stateMigrationDigest },
        );
      }
      if (utilTypes.isPromise(projection)) {
        throw failure(
          "SKILL_RELEASE_LEDGER_INVALID",
          "state migration ledger port must be synchronous",
        );
      }
      const committed = verifyLedgerProjection(projection, {
        authorityReceiptDigest: state.authorityReceiptDigest,
        intentDigest: plan.stateMigrationDigest,
        pointerDigest: state.stateDigest,
        prepareReceiptDigest: receipt.receiptDigest,
        revision: state.revision,
        skillName: state.skillName,
        stateDigest: state.stateDigest,
        transactionId: state.transactionId,
      });
      if (committed.status !== "committed" || committed.current !== true) {
        throw failure(
          "SKILL_RELEASE_LEDGER_INVALID",
          "state migration did not produce a current committed projection",
        );
      }
      this.#writePointer(
        state,
        `.state-${plan.stateMigrationDigest.slice("sha256:".length)}.tmp`,
      );
      this.#assertFinalizationArtifacts(state, active);
      return deepFreeze({ created: true, plan, receipt, state });
    } finally {
      clearInterval(heartbeat);
      this.#releaseLease(lease);
    }
  }

  readRelease(releaseDigest) {
    const expected = digest(releaseDigest, "releaseDigest");
    let value;
    try {
      value = this.#readJson(
        this.#releasePath(expected),
        "SKILL_RELEASE_CORRUPT",
      );
    } catch (cause) {
      if (cause instanceof SkillReleaseRegistryError) throw cause;
      if (cause?.code === "ENOENT") {
        throw failure("SKILL_RELEASE_NOT_FOUND", "release was not found");
      }
      throw failure("SKILL_RELEASE_CORRUPT", "release could not be read", {
        cause,
      });
    }
    let release;
    try {
      release = verifySkillRelease(value);
    } catch (cause) {
      if (cause?.code === SKILL_RELEASE_MIGRATION_REQUIRED_CODE) throw cause;
      throw failure("SKILL_RELEASE_CORRUPT", "release verification failed", {
        cause,
      });
    }
    if (
      release.releaseDigest !== expected ||
      release.tenantId !== this.tenantId
    ) {
      throw failure("SKILL_RELEASE_CORRUPT", "release path digest differs");
    }
    return release;
  }

  #readStateRaw(name) {
    const normalizedName = skillName(name);
    try {
      const state = verifySkillReleaseState(
        this.#readJson(
          this.#statePath(normalizedName),
          "SKILL_RELEASE_STATE_CORRUPT",
        ),
      );
      if (state.skillName !== normalizedName) {
        throw failure(
          "SKILL_RELEASE_STATE_CORRUPT",
          "state Skill name differs",
        );
      }
      if (state.tenantId !== this.tenantId) {
        throw failure(
          "SKILL_RELEASE_STATE_CORRUPT",
          "state belongs to another tenant",
        );
      }
      return state;
    } catch (error) {
      if (error?.code === "ENOENT") {
        return initialState(normalizedName, this.tenantId);
      }
      throw error;
    }
  }

  #query(transactionId, expected = {}) {
    let projection;
    try {
      projection = this.#ledgerQuery(transactionId);
    } catch (cause) {
      throw failure(
        "SKILL_RELEASE_LEDGER_UNAVAILABLE",
        "transaction ledger query failed closed",
        { cause, transactionId },
      );
    }
    if (projection && typeof projection.then === "function") {
      throw failure(
        "SKILL_RELEASE_LEDGER_INVALID",
        "transaction ledger query must be synchronous for constructor recovery",
      );
    }
    return verifyLedgerProjection(projection, { transactionId, ...expected });
  }

  #verifyCommittedState(state) {
    const projection = this.#query(state.transactionId, {
      authorityReceiptDigest: state.authorityReceiptDigest,
      intentDigest: undefined,
      pointerDigest: state.stateDigest,
      revision: state.revision,
      skillName: state.skillName,
      stateDigest: state.stateDigest,
    });
    if (
      projection.status !== "committed" ||
      projection.authorityReceiptDigest !== state.authorityReceiptDigest ||
      projection.current !== true ||
      projection.stateDigest !== state.stateDigest ||
      projection.pointerDigest !== state.stateDigest
    ) {
      throw failure(
        "SKILL_RELEASE_STATE_UNAUTHENTICATED",
        "active pointer is not finalized by the trusted transaction ledger",
      );
    }
    const active = this.readRelease(state.activeReleaseDigest);
    const lkg = this.readRelease(state.lastKnownGoodReleaseDigest);
    if (
      active.skillName !== state.skillName ||
      lkg.skillName !== state.skillName ||
      active.tenantId !== this.tenantId ||
      lkg.tenantId !== this.tenantId ||
      state.tenantId !== this.tenantId ||
      active.dependencyLockDigest !== state.dependencyLockDigest
    ) {
      throw failure(
        "SKILL_RELEASE_STATE_CORRUPT",
        "state release bindings differ",
      );
    }
    return state;
  }

  readState(name) {
    const state = this.#readStateRaw(name);
    return state.revision === 0 ? state : this.#verifyCommittedState(state);
  }

  readActive(name) {
    const state = this.readState(name);
    return state.revision === 0
      ? null
      : deepFreeze({
          state,
          release: this.readRelease(state.activeReleaseDigest),
        });
  }

  pinActive(name) {
    const active = this.readActive(name);
    if (!active)
      throw failure("SKILL_RELEASE_NOT_ACTIVE", "Skill has no active release");
    const pin = Object.freeze(Object.create(null));
    this.#pins.set(pin, {
      authorityReceiptDigest: active.state.authorityReceiptDigest,
      releaseDigest: active.release.releaseDigest,
      stateDigest: active.state.stateDigest,
      tenantId: this.tenantId,
      transactionId: active.state.transactionId,
    });
    return pin;
  }

  readPinned(pin) {
    const binding =
      pin && typeof pin === "object" ? this.#pins.get(pin) : undefined;
    if (!binding || binding.tenantId !== this.tenantId) {
      throw failure(
        "SKILL_RELEASE_PIN_INVALID",
        "session pin is forged, serialized, or belongs to another registry instance",
      );
    }
    const projection = this.#query(binding.transactionId, {
      authorityReceiptDigest: binding.authorityReceiptDigest,
      pointerDigest: binding.stateDigest,
      stateDigest: binding.stateDigest,
    });
    if (projection.status !== "committed") {
      throw failure(
        "SKILL_RELEASE_PIN_INVALID",
        "pinned activation is not committed",
      );
    }
    return this.readRelease(binding.releaseDigest);
  }

  #owner(kind, token, { skill = null, transactionId = null, fence = 0 } = {}) {
    const clock = this.#clock();
    const expiryMs =
      kind === "recovery"
        ? Math.max(this.#leaseTtlMs, DEFAULT_LEASE_TTL_MS)
        : this.#leaseTtlMs;
    return deepFreeze({
      createdAt: clock.toISOString(),
      expiresAt: new Date(clock.getTime() + expiryMs).toISOString(),
      fence,
      heartbeatAt: clock.toISOString(),
      host: os.hostname(),
      kind,
      pid: process.pid,
      schema: LOCK_OWNER_SCHEMA,
      skillName: skill,
      tenantId: this.tenantId,
      token,
      transactionId,
    });
  }

  #verifyOwner(value) {
    if (
      value &&
      typeof value === "object" &&
      !utilTypes.isProxy(value) &&
      Object.getOwnPropertyDescriptor(value, "schema")?.value ===
        LEGACY_LOCK_OWNER_SCHEMA
    ) {
      throw migrationRequired(
        "legacy release lock owner requires explicit tenant-scoped migration",
      );
    }
    const keys = new Set([
      "createdAt",
      "expiresAt",
      "fence",
      "heartbeatAt",
      "host",
      "kind",
      "pid",
      "schema",
      "skillName",
      "tenantId",
      "token",
      "transactionId",
    ]);
    assertExactKeys(value, keys, "lock owner", "SKILL_RELEASE_LEASE_INVALID");
    if (
      value.schema !== LOCK_OWNER_SCHEMA ||
      !["recovery", "skill"].includes(value.kind) ||
      tenantId(value.tenantId, "owner tenantId") !== this.tenantId ||
      !TOKEN_PATTERN.test(value.token) ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      typeof value.host !== "string" ||
      !Number.isSafeInteger(value.fence) ||
      value.fence < 0
    ) {
      throw failure("SKILL_RELEASE_LEASE_INVALID", "lock owner is invalid");
    }
    for (const field of ["createdAt", "heartbeatAt", "expiresAt"]) {
      const parsed = new Date(value[field]);
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString() !== value[field]
      ) {
        throw failure(
          "SKILL_RELEASE_LEASE_INVALID",
          `owner ${field} is invalid`,
        );
      }
    }
    if (value.kind === "skill") {
      skillName(value.skillName);
      digest(value.transactionId, "owner.transactionId");
      safeInteger(value.fence, "owner.fence", { minimum: 1 });
    } else if (
      value.skillName !== null ||
      value.transactionId !== null ||
      value.fence !== 0
    ) {
      throw failure("SKILL_RELEASE_LEASE_INVALID", "recovery owner is invalid");
    }
    return deepFreeze({ ...value });
  }

  #readOwner(lockPath) {
    return this.#verifyOwner(
      this.#readJson(
        path.join(lockPath, "owner.json"),
        "SKILL_RELEASE_LEASE_INVALID",
      ),
    );
  }

  #ownerExpired(owner) {
    return new Date(owner.expiresAt).getTime() <= this.#clock().getTime();
  }

  #ownerStale(owner) {
    if (this.#ownerExpired(owner)) return true;
    if (owner.host !== os.hostname() || owner.pid === process.pid) return false;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  }

  #createLock(lockPath, owner) {
    this.#fs.mkdirSync(lockPath, { mode: 0o700 });
    let descriptor = null;
    try {
      descriptor = this.#fs.openSync(
        path.join(lockPath, "owner.json"),
        "wx",
        0o600,
      );
      const bytes = serialize(owner);
      this.#fs.writeFileSync(descriptor, bytes);
      this.#fs.fsyncSync(descriptor);
      if (this.#fs.fstatSync(descriptor).size !== bytes.length) {
        throw failure(
          "SKILL_RELEASE_WRITE_FAILED",
          "lock owner write was incomplete",
        );
      }
      this.#fs.closeSync(descriptor);
      descriptor = null;
      fsyncDirectory(this.#fs, lockPath);
      fsyncDirectory(this.#fs, this.#directories.locks.path);
    } catch (error) {
      if (descriptor !== null) this.#fs.closeSync(descriptor);
      this.#fs.rmSync(lockPath, { recursive: true, force: true });
      throw error;
    }
  }

  #removeLock(lockPath, expectedToken = null) {
    let owner;
    try {
      owner = this.#readOwner(lockPath);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (expectedToken !== null && owner.token !== expectedToken) {
      throw failure("SKILL_RELEASE_LEASE_INVALID", "lock ownership changed");
    }
    const tombstone = this.#path(
      "locks",
      `.released-${process.pid}-${owner.token}`,
    );
    try {
      this.#fs.renameSync(lockPath, tombstone);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    fsyncDirectory(this.#fs, this.#directories.locks.path);
    this.#fs.rmSync(tombstone, { recursive: true, force: true });
    fsyncDirectory(this.#fs, this.#directories.locks.path);
  }

  #acquireRecoveryLock() {
    const lockPath = this.#recoveryLockPath();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = this.#token();
      const owner = this.#owner("recovery", token);
      try {
        this.#createLock(lockPath, owner);
        return deepFreeze({ lockPath, token });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = this.#readOwner(lockPath);
        if (!this.#ownerStale(existing)) {
          throw failure(
            "SKILL_RELEASE_RECOVERY_BUSY",
            "another process owns the recovery mutex",
          );
        }
        this.#removeLock(lockPath, existing.token);
      }
    }
    throw failure(
      "SKILL_RELEASE_RECOVERY_BUSY",
      "recovery mutex is unavailable",
    );
  }

  #withRecoveryLock(callback) {
    const lock = this.#acquireRecoveryLock();
    try {
      return callback();
    } finally {
      this.#removeLock(lock.lockPath, lock.token);
    }
  }

  #renewLease(lease) {
    const current = this.#readOwner(lease.lockPath);
    if (
      current.token !== lease.token ||
      current.transactionId !== lease.transactionId ||
      current.fence !== lease.fence
    ) {
      throw failure(
        "SKILL_RELEASE_LEASE_INVALID",
        "lease was fenced by another owner",
      );
    }
    const clock = this.#clock();
    const renewed = deepFreeze({
      ...current,
      expiresAt: new Date(clock.getTime() + this.#leaseTtlMs).toISOString(),
      heartbeatAt: clock.toISOString(),
    });
    this.#atomicWrite(
      "locks",
      path.join(lease.lockPath, "owner.json"),
      renewed,
    );
  }

  #startHeartbeat(lease) {
    const interval = Math.max(10, Math.floor(this.#leaseTtlMs / 3));
    const timer = setInterval(() => {
      try {
        this.#renewLease(lease);
      } catch {
        // The foreground CAS and owner verification remain fail-closed.
      }
    }, interval);
    timer.unref?.();
    return timer;
  }

  #acquireLease(name, transactionId, expectedRevision, expectedParentDigest) {
    const journalPath = this.#journalPath(name);
    if (this.#exists(journalPath)) {
      this.#withRecoveryLock(() => this.#recoverSkill(name));
      if (this.#exists(journalPath)) {
        throw failure(
          "SKILL_RELEASE_LEASE_BUSY",
          "a live transition journal owns this Skill",
        );
      }
    }
    const lockPath = this.#leasePath(name);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const state = this.readState(name);
      const active =
        state.activeReleaseDigest === null
          ? null
          : this.readRelease(state.activeReleaseDigest);
      const actualParent = active?.contentDigest ?? EMPTY_SKILL_ACTIVE_DIGEST;
      if (
        state.revision !== expectedRevision ||
        actualParent !== expectedParentDigest
      ) {
        throw failure(
          "SKILL_RELEASE_CAS_MISMATCH",
          "active parent CAS is stale",
          {
            actualParentDigest: actualParent,
            actualRevision: state.revision,
          },
        );
      }
      const token = this.#token();
      const owner = this.#owner("skill", token, {
        skill: name,
        transactionId,
        fence: state.fence + 1,
      });
      try {
        this.#createLock(lockPath, owner);
        const lease = deepFreeze({
          fence: state.fence + 1,
          lockPath,
          token,
          transactionId,
        });
        return { lease, state, heartbeat: this.#startHeartbeat(lease) };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = this.#readOwner(lockPath);
        if (!this.#ownerStale(existing)) {
          throw failure("SKILL_RELEASE_LEASE_BUSY", "Skill lease is live");
        }
        this.#withRecoveryLock(() => this.#recoverSkill(name));
      }
    }
    throw failure(
      "SKILL_RELEASE_LEASE_BUSY",
      "Skill lease could not be acquired",
    );
  }

  #releaseLease(lease) {
    this.#removeLock(lease.lockPath, lease.token);
  }

  #buildIntent(payload, previousState, nextState) {
    const core = {
      authorityReceipt: payload.authorityReceipt,
      authorityReceiptDigest: payload.authorityReceipt.receiptDigest,
      candidateId: payload.candidate?.candidateId ?? null,
      dependencyLockDigest: payload.dependencyLockDigest,
      expectedParentDigest: payload.expectedParentDigest,
      expectedRevision: payload.expectedRevision,
      nextStateDigest: nextState.stateDigest,
      mutationRequest: payload.mutationRequest,
      operation: payload.operation,
      operationId: payload.operationId,
      pointerDigest: nextState.stateDigest,
      previousStateDigest:
        previousState.revision === 0 ? null : previousState.stateDigest,
      receiptDigests: payload.receiptDigests,
      requestDigest: payload.requestDigest,
      schema: INTENT_SCHEMA,
      skillName: payload.skillName,
      targetReleaseDigest: nextState.activeReleaseDigest,
      transactionId: nextState.transactionId,
      transitionSubjectDigest: payload.transitionSubjectDigest,
    };
    return deepFreeze({
      ...core,
      intentDigest: domainDigest(INTENT_DOMAIN, core),
    });
  }

  #verifyIntent(value) {
    const keys = new Set([
      "authorityReceiptDigest",
      "authorityReceipt",
      "candidateId",
      "dependencyLockDigest",
      "expectedParentDigest",
      "expectedRevision",
      "mutationRequest",
      "intentDigest",
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
    assertExactKeys(
      value,
      keys,
      "transition intent",
      "SKILL_RELEASE_JOURNAL_CORRUPT",
    );
    const core = { ...value };
    delete core.intentDigest;
    if (
      core.schema !== INTENT_SCHEMA ||
      !["promote", "rollback"].includes(core.operation) ||
      domainDigest(INTENT_DOMAIN, core) !== value.intentDigest
    ) {
      throw failure(
        "SKILL_RELEASE_JOURNAL_CORRUPT",
        "intent digest is invalid",
      );
    }
    for (const field of [
      "authorityReceiptDigest",
      "dependencyLockDigest",
      "expectedParentDigest",
      "nextStateDigest",
      "pointerDigest",
      "requestDigest",
      "targetReleaseDigest",
      "transactionId",
      "transitionSubjectDigest",
      "intentDigest",
    ]) {
      digest(value[field], `intent.${field}`);
    }
    digest(value.previousStateDigest, "intent.previousStateDigest", {
      nullable: true,
    });
    digest(value.candidateId, "intent.candidateId", { nullable: true });
    safeInteger(value.expectedRevision, "intent.expectedRevision");
    skillName(value.skillName);
    boundedString(value.operationId, "intent.operationId");
    normalizeReceiptDigests(value.receiptDigests);
    const authorityReceipt = verifySkillMutationConsumptionReceipt(
      value.authorityReceipt,
    );
    const mutationRequest = verifySkillMutationRequest(value.mutationRequest);
    if (
      authorityReceipt.receiptDigest !== value.authorityReceiptDigest ||
      authorityReceipt.tenantId !== this.tenantId ||
      authorityReceipt.requestDigest !== value.requestDigest ||
      authorityReceipt.operationId !== value.operationId ||
      authorityReceipt.operation !== value.operation ||
      authorityReceipt.transitionSubjectDigest !==
        value.transitionSubjectDigest ||
      authorityReceipt.skillName !== value.skillName ||
      authorityReceipt.expectedTargetDigest !== value.expectedParentDigest ||
      authorityReceipt.expectedTargetRevision !== value.expectedRevision
    ) {
      throw failure(
        "SKILL_RELEASE_JOURNAL_CORRUPT",
        "intent authority receipt bindings are invalid",
      );
    }
    verifyRequestReceiptBinding(mutationRequest, authorityReceipt);
    if (
      mutationRequest.requestDigest !== value.requestDigest ||
      mutationRequest.tenantId !== this.tenantId ||
      mutationRequest.operation !== value.operation ||
      mutationRequest.transitionSubjectDigest !==
        value.transitionSubjectDigest ||
      canonicalJson(receiptDigestsFromRequest(mutationRequest)) !==
        canonicalJson(value.receiptDigests)
    ) {
      throw failure(
        "SKILL_RELEASE_JOURNAL_CORRUPT",
        "intent six-receipt bindings are invalid",
      );
    }
    const expectedTransitionSubjectDigest =
      digestSkillMutationTransitionSubject({
        tenantId: mutationRequest.tenantId,
        skillName: value.skillName,
        operation: value.operation,
        candidateId: value.candidateId,
        rollbackTargetReleaseDigest:
          value.operation === SKILL_MUTATION_OPERATIONS.ROLLBACK
            ? value.targetReleaseDigest
            : null,
        dependencyLockDigest: value.dependencyLockDigest,
        expectedActiveContentDigest: value.expectedParentDigest,
        expectedActiveRevision: value.expectedRevision,
      });
    if (value.transitionSubjectDigest !== expectedTransitionSubjectDigest) {
      throw failure(
        "SKILL_RELEASE_JOURNAL_CORRUPT",
        "intent transition subject is not bound to its operation target",
      );
    }
    return deepFreeze({ ...value });
  }

  #journal(value) {
    const core = { ...value };
    delete core.journalDigest;
    return deepFreeze({
      ...core,
      journalDigest: domainDigest(JOURNAL_DOMAIN, core),
    });
  }

  #persistJournal(value) {
    const journal = this.#journal(value);
    this.#atomicWrite(
      "journals",
      this.#journalPath(journal.skillName),
      journal,
    );
    return journal;
  }

  #verifyJournal(value) {
    if (
      value &&
      typeof value === "object" &&
      !utilTypes.isProxy(value) &&
      Object.getOwnPropertyDescriptor(value, "schema")?.value ===
        LEGACY_JOURNAL_SCHEMA
    ) {
      throw migrationRequired(
        "legacy release journal requires explicit tenant-scoped migration",
      );
    }
    const keys = new Set([
      "intent",
      "journalDigest",
      "leaseToken",
      "nextState",
      "phase",
      "prepareReceipt",
      "previousState",
      "schema",
      "skillName",
      "stagedFile",
      "tenantId",
      "transactionId",
    ]);
    assertExactKeys(
      value,
      keys,
      "transition journal",
      "SKILL_RELEASE_JOURNAL_CORRUPT",
    );
    const core = { ...value };
    delete core.journalDigest;
    if (
      core.schema !== JOURNAL_SCHEMA ||
      tenantId(core.tenantId, "journal tenantId") !== this.tenantId ||
      !["journaled", "prepared", "pointer-written"].includes(core.phase) ||
      !TOKEN_PATTERN.test(core.leaseToken) ||
      !TEMP_PATTERN.test(core.stagedFile) ||
      domainDigest(JOURNAL_DOMAIN, core) !== value.journalDigest
    ) {
      throw failure(
        "SKILL_RELEASE_JOURNAL_CORRUPT",
        "journal digest is invalid",
      );
    }
    const intent = this.#verifyIntent(core.intent);
    const nextState = verifySkillReleaseState(core.nextState);
    const previousState =
      core.previousState === null
        ? null
        : verifySkillReleaseState(core.previousState);
    if (
      intent.transactionId !== core.transactionId ||
      nextState.transactionId !== core.transactionId ||
      nextState.skillName !== core.skillName ||
      nextState.tenantId !== this.tenantId ||
      intent.skillName !== core.skillName ||
      nextState.stateDigest !== intent.nextStateDigest ||
      nextState.stateDigest !== intent.pointerDigest ||
      nextState.activeReleaseDigest !== intent.targetReleaseDigest ||
      nextState.authorityReceiptDigest !== intent.authorityReceiptDigest ||
      nextState.dependencyLockDigest !== intent.dependencyLockDigest ||
      nextState.revision !== intent.expectedRevision + 1 ||
      (previousState === null
        ? intent.previousStateDigest !== null || intent.expectedRevision !== 0
        : previousState.skillName !== core.skillName ||
          previousState.tenantId !== this.tenantId ||
          previousState.stateDigest !== intent.previousStateDigest ||
          previousState.revision !== intent.expectedRevision)
    ) {
      throw failure(
        "SKILL_RELEASE_JOURNAL_CORRUPT",
        "journal state transition bindings are invalid",
      );
    }
    if (core.prepareReceipt !== null) {
      verifyLedgerProjection(core.prepareReceipt, {
        authorityReceiptDigest: intent.authorityReceiptDigest,
        intentDigest: intent.intentDigest,
        transactionId: intent.transactionId,
      });
      if (core.prepareReceipt.status !== "prepared") {
        throw failure(
          "SKILL_RELEASE_JOURNAL_CORRUPT",
          "journal prepare receipt has the wrong status",
        );
      }
    } else if (core.phase !== "journaled") {
      throw failure(
        "SKILL_RELEASE_JOURNAL_CORRUPT",
        "prepared journal is missing its projection",
      );
    }
    return deepFreeze({ ...core, journalDigest: value.journalDigest });
  }

  #readJournal(name) {
    return this.#verifyJournal(
      this.#readJson(this.#journalPath(name), "SKILL_RELEASE_JOURNAL_CORRUPT"),
    );
  }

  #prepare(intent) {
    let projection;
    try {
      projection = this.#ledgerPrepare(intent);
    } catch (cause) {
      throw failure(
        "SKILL_RELEASE_LEDGER_PREPARE_FAILED",
        "transaction ledger prepare failed closed",
        { cause, transactionId: intent.transactionId },
      );
    }
    if (projection && typeof projection.then === "function") {
      throw failure(
        "SKILL_RELEASE_LEDGER_INVALID",
        "transaction ledger prepare must be synchronous",
      );
    }
    const verified = verifyLedgerProjection(projection, {
      authorityReceiptDigest: intent.authorityReceiptDigest,
      intentDigest: intent.intentDigest,
      transactionId: intent.transactionId,
    });
    if (verified.status !== "prepared") {
      throw failure(
        "SKILL_RELEASE_LEDGER_INVALID",
        "prepare did not return a prepared projection",
      );
    }
    return verified;
  }

  #finalize(journal, prepareReceipt) {
    const request = deepFreeze({
      authorityReceiptDigest: journal.intent.authorityReceiptDigest,
      expectedPrepareReceiptDigest: prepareReceipt.receiptDigest,
      intentDigest: journal.intent.intentDigest,
      pointerDigest: journal.nextState.stateDigest,
      revision: journal.nextState.revision,
      skillName: journal.nextState.skillName,
      stateDigest: journal.nextState.stateDigest,
      transactionId: journal.transactionId,
    });
    let projection;
    try {
      projection = this.#ledgerFinalize(request);
    } catch (cause) {
      throw failure(
        "SKILL_RELEASE_LEDGER_FINALIZE_FAILED",
        "transaction ledger finalize failed; recovery evidence was retained",
        { cause, transactionId: journal.transactionId },
      );
    }
    if (projection && typeof projection.then === "function") {
      throw failure(
        "SKILL_RELEASE_LEDGER_INVALID",
        "transaction ledger finalize must be synchronous",
      );
    }
    const verified = verifyLedgerProjection(projection, {
      authorityReceiptDigest: journal.intent.authorityReceiptDigest,
      intentDigest: journal.intent.intentDigest,
      pointerDigest: journal.nextState.stateDigest,
      prepareReceiptDigest: prepareReceipt.receiptDigest,
      revision: journal.nextState.revision,
      skillName: journal.nextState.skillName,
      stateDigest: journal.nextState.stateDigest,
      transactionId: journal.transactionId,
    });
    if (verified.status !== "committed") {
      throw failure(
        "SKILL_RELEASE_LEDGER_INVALID",
        "finalize did not return a committed projection",
      );
    }
    return verified;
  }

  #writePointer(state, stagedFile) {
    const stagedPath = this.#path("staging", stagedFile);
    if (!this.#exists(stagedPath)) this.#writeTemporary(stagedFile, state);
    const expectedBytes = serialize(state);
    const stagedBytes = this.#readBytes(
      stagedPath,
      "SKILL_RELEASE_STATE_CORRUPT",
    );
    let verifiedStaged;
    try {
      verifiedStaged = verifySkillReleaseState(
        this.#parseCanonical(stagedBytes, "SKILL_RELEASE_STATE_CORRUPT"),
      );
    } catch (cause) {
      if (cause instanceof SkillReleaseRegistryError) throw cause;
      throw failure(
        "SKILL_RELEASE_STATE_CORRUPT",
        "staged state pointer failed verification",
        { cause },
      );
    }
    if (
      verifiedStaged.tenantId !== this.tenantId ||
      verifiedStaged.stateDigest !== state.stateDigest ||
      !stagedBytes.equals(expectedBytes)
    ) {
      throw failure(
        "SKILL_RELEASE_STATE_CORRUPT",
        "staged state pointer does not exactly match the journal next state",
      );
    }
    const staged = this.#fs.lstatSync(stagedPath);
    if (
      !staged.isFile() ||
      staged.isSymbolicLink() ||
      Number(staged.nlink) !== 1 ||
      !samePath(realpath(this.#fs, stagedPath), stagedPath)
    ) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "staged state pointer is unsafe",
      );
    }
    this.#fs.renameSync(stagedPath, this.#statePath(state.skillName));
    const publishedPath = this.#statePath(state.skillName);
    const published = this.#fs.lstatSync(publishedPath);
    if (
      !published.isFile() ||
      published.isSymbolicLink() ||
      Number(published.nlink) !== 1 ||
      identity(published) !== identity(staged) ||
      !samePath(realpath(this.#fs, publishedPath), publishedPath)
    ) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "active state pointer changed during publication",
      );
    }
    const publishedBytes = this.#readBytes(
      publishedPath,
      "SKILL_RELEASE_STATE_CORRUPT",
    );
    let verifiedPublished;
    try {
      verifiedPublished = verifySkillReleaseState(
        this.#parseCanonical(publishedBytes, "SKILL_RELEASE_STATE_CORRUPT"),
      );
    } catch (cause) {
      if (cause instanceof SkillReleaseRegistryError) throw cause;
      throw failure(
        "SKILL_RELEASE_STATE_CORRUPT",
        "published state pointer failed verification",
        { cause },
      );
    }
    if (
      verifiedPublished.tenantId !== this.tenantId ||
      verifiedPublished.stateDigest !== state.stateDigest ||
      !publishedBytes.equals(expectedBytes)
    ) {
      throw failure(
        "SKILL_RELEASE_STATE_CORRUPT",
        "published state pointer does not exactly match the journal next state",
      );
    }
    fsyncDirectory(this.#fs, this.#directories.active.path);
    this.#assertBoundary();
  }

  #assertFinalizationArtifacts(state, release) {
    try {
      const expectedStateBytes = serialize(state);
      const stateBytes = this.#readBytes(
        this.#statePath(state.skillName),
        "SKILL_RELEASE_STATE_CORRUPT",
      );
      const verifiedState = verifySkillReleaseState(
        this.#parseCanonical(stateBytes, "SKILL_RELEASE_STATE_CORRUPT"),
      );
      if (
        verifiedState.tenantId !== this.tenantId ||
        verifiedState.skillName !== state.skillName ||
        verifiedState.transactionId !== state.transactionId ||
        verifiedState.fence !== state.fence ||
        verifiedState.stateDigest !== state.stateDigest ||
        !stateBytes.equals(expectedStateBytes)
      ) {
        throw failure(
          "SKILL_RELEASE_STATE_CORRUPT",
          "active state pointer is not the exact finalization input",
        );
      }

      const verifiedRelease = this.readRelease(release.releaseDigest);
      if (
        verifiedRelease.tenantId !== this.tenantId ||
        verifiedRelease.skillName !== state.skillName ||
        verifiedRelease.releaseDigest !== release.releaseDigest ||
        !serialize(verifiedRelease).equals(serialize(release))
      ) {
        throw failure(
          "SKILL_RELEASE_CORRUPT",
          "target release is not the exact finalization input",
        );
      }
    } catch (cause) {
      throw failure(
        "SKILL_RELEASE_FINALIZATION_INPUT_INVALID",
        "finalization inputs changed after pointer publication",
        {
          cause,
          preserveForRecovery: true,
          transactionId: state.transactionId,
        },
      );
    }
  }

  #assertJournalFinalizationArtifacts(journal) {
    let release;
    try {
      release = this.readRelease(journal.nextState.activeReleaseDigest);
    } catch (cause) {
      throw failure(
        "SKILL_RELEASE_FINALIZATION_INPUT_INVALID",
        "journal target release is not a valid recovery finalization input",
        {
          cause,
          preserveForRecovery: true,
          transactionId: journal.transactionId,
        },
      );
    }
    this.#assertFinalizationArtifacts(journal.nextState, release);
  }

  #restorePrevious(journal) {
    const current = this.#readStateRaw(journal.skillName);
    const previousDigest = journal.previousState?.stateDigest ?? null;
    if (current.revision === 0 && previousDigest === null) return;
    if (current.stateDigest !== previousDigest) {
      throw failure(
        "SKILL_RELEASE_RECOVERY_CONFLICT",
        "an absent transaction cannot authorize pointer replacement",
      );
    }
    this.#verifyCommittedState(current);
  }

  #ensureNextPointer(journal) {
    const current = this.#readStateRaw(journal.skillName);
    const previousDigest = journal.previousState?.stateDigest ?? null;
    if (current.stateDigest === journal.nextState.stateDigest) return;
    if (
      (current.revision === 0 && previousDigest === null) ||
      current.stateDigest === previousDigest
    ) {
      this.#atomicWrite(
        "active",
        this.#statePath(journal.skillName),
        journal.nextState,
      );
      return;
    }
    throw failure(
      "SKILL_RELEASE_RECOVERY_CONFLICT",
      "recovery CAS found an unrelated active revision",
    );
  }

  #cleanupTransaction(journal, { removeLock = true } = {}) {
    if (removeLock) {
      const lockPath = this.#leasePath(journal.skillName);
      try {
        this.#removeLock(lockPath, journal.leaseToken);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    this.#unlink(
      this.#path("staging", journal.stagedFile),
      this.#directories.staging.path,
    );
    this.#unlink(
      this.#journalPath(journal.skillName),
      this.#directories.journals.path,
    );
  }

  #recoverJournal(journal) {
    const expected = {
      authorityReceiptDigest: journal.intent.authorityReceiptDigest,
      intentDigest: journal.intent.intentDigest,
      pointerDigest: journal.nextState.stateDigest,
      prepareReceiptDigest: journal.prepareReceipt?.receiptDigest,
      revision: journal.nextState.revision,
      skillName: journal.nextState.skillName,
      stateDigest: journal.nextState.stateDigest,
    };
    const projection = this.#query(journal.transactionId, expected);
    if (projection.status === "absent") {
      this.#restorePrevious(journal);
      this.#cleanupTransaction(journal);
      return "aborted";
    }
    if (projection.status === "prepared") {
      const prepareReceipt = verifyLedgerProjection(projection, {
        authorityReceiptDigest: journal.intent.authorityReceiptDigest,
        intentDigest: journal.intent.intentDigest,
        transactionId: journal.transactionId,
      });
      this.#ensureNextPointer(journal);
      this.#assertJournalFinalizationArtifacts(journal);
      this.#finalize(journal, prepareReceipt);
      this.#assertJournalFinalizationArtifacts(journal);
      this.#cleanupTransaction(journal);
      return "committed";
    }
    if (projection.current !== true) {
      throw failure(
        "SKILL_RELEASE_RECOVERY_CONFLICT",
        "committed transaction is no longer the current Skill revision",
      );
    }
    this.#ensureNextPointer(journal);
    this.#assertJournalFinalizationArtifacts(journal);
    this.#cleanupTransaction(journal);
    return "committed";
  }

  #recoverSkill(name, { force = false } = {}) {
    const journalPath = this.#journalPath(name);
    const lockPath = this.#leasePath(name);
    if (!this.#exists(journalPath)) {
      if (this.#exists(lockPath)) {
        const owner = this.#readOwner(lockPath);
        if (force || this.#ownerStale(owner)) {
          this.#removeLock(lockPath, owner.token);
        }
      }
      return;
    }
    const journal = this.#readJournal(name);
    if (this.#exists(lockPath)) {
      const owner = this.#readOwner(lockPath);
      if (
        owner.token !== journal.leaseToken ||
        owner.transactionId !== journal.transactionId
      ) {
        throw failure(
          "SKILL_RELEASE_RECOVERY_CONFLICT",
          "journal and lease owner differ",
        );
      }
      if (!force && !this.#ownerStale(owner)) return;
    }
    this.#recoverJournal(journal);
  }

  #recoverAll() {
    this.#withRecoveryLock(() => {
      const names = this.#fs.readdirSync(this.#directories.journals.path);
      for (const name of names) {
        if (!name.endsWith(".json")) {
          throw failure(
            "SKILL_RELEASE_JOURNAL_CORRUPT",
            "unexpected journal entry",
          );
        }
        const nameWithoutExtension = name.slice(0, -5);
        skillName(nameWithoutExtension);
        this.#recoverSkill(nameWithoutExtension);
      }
      for (const entry of this.#fs.readdirSync(this.#directories.locks.path)) {
        if (entry === ".recovery.lock" || entry.startsWith(".released-"))
          continue;
        if (!entry.endsWith(".lock")) {
          throw failure("SKILL_RELEASE_STORE_UNSAFE", "unexpected lock entry");
        }
        const name = entry.slice(0, -5);
        skillName(name);
        if (!this.#exists(this.#journalPath(name))) this.#recoverSkill(name);
      }
    });
  }

  #cleanupDebris() {
    const referenced = new Set();
    for (const name of this.#fs.readdirSync(this.#directories.journals.path)) {
      if (name.endsWith(".json")) {
        referenced.add(this.#readJournal(name.slice(0, -5)).stagedFile);
      }
    }
    const cutoff = this.#clock().getTime() - this.#leaseTtlMs;
    for (const name of this.#fs.readdirSync(this.#directories.staging.path)) {
      if (!TEMP_PATTERN.test(name)) {
        throw failure("SKILL_RELEASE_STORE_UNSAFE", "unexpected staging entry");
      }
      const filePath = this.#path("staging", name);
      const stat = this.#fs.lstatSync(filePath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        Number(stat.nlink) !== 1 ||
        !samePath(realpath(this.#fs, filePath), filePath)
      ) {
        throw failure("SKILL_RELEASE_STORE_UNSAFE", "staging debris is unsafe");
      }
      if (!referenced.has(name) && stat.mtimeMs <= cutoff) {
        this.#unlink(filePath, this.#directories.staging.path);
      }
    }
    for (const name of this.#fs.readdirSync(this.#directories.locks.path)) {
      if (!name.startsWith(".released-")) continue;
      const tombstone = this.#path("locks", name);
      const stat = this.#fs.lstatSync(tombstone);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !samePath(realpath(this.#fs, tombstone), tombstone) ||
        !samePath(path.dirname(tombstone), this.#directories.locks.path)
      ) {
        throw failure("SKILL_RELEASE_STORE_UNSAFE", "lock tombstone is unsafe");
      }
      if (stat.mtimeMs <= cutoff)
        this.#fs.rmSync(tombstone, { recursive: true });
    }
  }

  #validateTransitionPayload(value) {
    const keys = new Set([
      "authorityReceipt",
      "candidate",
      "dependencyLockDigest",
      "expectedParentDigest",
      "expectedRevision",
      "mutationRequest",
      "operation",
      "operationId",
      "receiptDigests",
      "requestDigest",
      "skillName",
      "targetReleaseDigest",
      "tenantId",
      "transitionSubjectDigest",
    ]);
    assertExactKeys(value, keys, "transition capability payload");
    const authorityReceipt = verifySkillMutationConsumptionReceipt(
      value.authorityReceipt,
    );
    const mutationRequest = verifySkillMutationRequest(value.mutationRequest);
    if (
      authorityReceipt.role !== SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER ||
      authorityReceipt.tenantId !== this.tenantId ||
      authorityReceipt.targetScope !== SKILL_MUTATION_TARGET_SCOPES.ACTIVE ||
      authorityReceipt.skillName !== value.skillName ||
      authorityReceipt.operationId !== value.operationId ||
      authorityReceipt.operation !== value.operation ||
      authorityReceipt.transitionSubjectDigest !==
        value.transitionSubjectDigest ||
      authorityReceipt.requestDigest !== value.requestDigest ||
      authorityReceipt.expectedTargetDigest !== value.expectedParentDigest ||
      authorityReceipt.expectedTargetRevision !== value.expectedRevision
    ) {
      throw failure(
        "SKILL_RELEASE_AUTHORITY_INVALID",
        "transition capability authority receipt bindings differ",
      );
    }
    if (
      ![
        SKILL_MUTATION_OPERATIONS.PROMOTE,
        SKILL_MUTATION_OPERATIONS.ROLLBACK,
      ].includes(value.operation)
    ) {
      throw failure("SKILL_RELEASE_INVALID", "transition operation is invalid");
    }
    verifyRequestReceiptBinding(mutationRequest, authorityReceipt);
    if (
      mutationRequest.requestDigest !== value.requestDigest ||
      mutationRequest.tenantId !== this.tenantId ||
      tenantId(value.tenantId, "transition tenantId") !== this.tenantId ||
      mutationRequest.operation !== value.operation ||
      mutationRequest.transitionSubjectDigest !==
        value.transitionSubjectDigest ||
      canonicalJson(receiptDigestsFromRequest(mutationRequest)) !==
        canonicalJson(value.receiptDigests)
    ) {
      throw failure(
        "SKILL_RELEASE_AUTHORITY_INVALID",
        "transition receipts differ from the consumed mutation request",
      );
    }
    let candidate = null;
    let targetReleaseDigest = null;
    const dependencyLockDigest = digest(
      value.dependencyLockDigest,
      "dependencyLockDigest",
    );
    if (value.operation === "promote") {
      candidate = verifySkillCandidateDraft(value.candidate);
      if (
        candidate.tenantId !== this.tenantId ||
        candidate.skillName !== value.skillName ||
        value.targetReleaseDigest !== null
      ) {
        throw failure(
          "SKILL_RELEASE_INVALID",
          "promotion requires a tenant-bound candidate and no caller target digest",
        );
      }
      if (candidate.dependencyLockDigest !== dependencyLockDigest) {
        throw failure(
          "SKILL_RELEASE_AUTHORITY_INVALID",
          "candidate dependency lock differs from its authorized digest",
        );
      }
    } else {
      if (value.candidate !== null) {
        throw failure(
          "SKILL_RELEASE_INVALID",
          "rollback must not carry candidate release material",
        );
      }
      targetReleaseDigest = digest(
        value.targetReleaseDigest,
        "targetReleaseDigest",
      );
    }
    const expectedTransitionSubjectDigest =
      digestSkillMutationTransitionSubject({
        tenantId: mutationRequest.tenantId,
        skillName: value.skillName,
        operation: value.operation,
        candidateId: candidate?.candidateId ?? null,
        rollbackTargetReleaseDigest: targetReleaseDigest,
        dependencyLockDigest,
        expectedActiveContentDigest: value.expectedParentDigest,
        expectedActiveRevision: value.expectedRevision,
      });
    if (value.transitionSubjectDigest !== expectedTransitionSubjectDigest) {
      throw failure(
        "SKILL_RELEASE_AUTHORITY_INVALID",
        "transition capability subject differs from the exact registry mutation",
      );
    }
    return deepFreeze({
      authorityReceipt,
      candidate,
      dependencyLockDigest,
      expectedParentDigest: digest(
        value.expectedParentDigest,
        "expectedParentDigest",
      ),
      expectedRevision: safeInteger(value.expectedRevision, "expectedRevision"),
      mutationRequest,
      operation: value.operation,
      operationId: boundedString(value.operationId, "operationId"),
      receiptDigests: normalizeReceiptDigests(value.receiptDigests),
      requestDigest: digest(value.requestDigest, "requestDigest"),
      skillName: skillName(value.skillName),
      targetReleaseDigest,
      tenantId: this.tenantId,
      transitionSubjectDigest: digest(
        value.transitionSubjectDigest,
        "transitionSubjectDigest",
      ),
    });
  }

  async #crash(phase, transaction) {
    if (this.#crashHook) await this.#crashHook(phase, deepFreeze(transaction));
  }

  async applyTransition(capability) {
    const payload = this.#validateTransitionPayload(
      consumeRegistryTransitionCapability(capability, this),
    );
    let releaseCreated = false;
    let target;
    if (payload.operation === "promote") {
      const created = this.#createRelease({
        candidate: payload.candidate,
        consumptionReceipt: payload.authorityReceipt,
        mutationRequest: payload.mutationRequest,
      });
      target = created.release;
      releaseCreated = created.created;
    } else {
      target = this.readRelease(payload.targetReleaseDigest);
    }
    if (
      target.skillName !== payload.skillName ||
      target.tenantId !== this.tenantId
    ) {
      throw failure("SKILL_RELEASE_INVALID", "target belongs to another Skill");
    }
    if (target.dependencyLockDigest !== payload.dependencyLockDigest) {
      throw failure(
        "SKILL_RELEASE_AUTHORITY_INVALID",
        "target release dependency lock differs from the authorized transition subject",
      );
    }
    if (
      payload.operation === "promote" &&
      (target.authorityReceiptDigest !==
        payload.authorityReceipt.receiptDigest ||
        target.mutationRequestDigest !== payload.requestDigest ||
        target.transitionSubjectDigest !== payload.transitionSubjectDigest ||
        canonicalJson(target.receiptDigests) !==
          canonicalJson(payload.receiptDigests))
    ) {
      throw failure(
        "SKILL_RELEASE_AUTHORITY_INVALID",
        "release does not carry the consumed authorization evidence",
      );
    }

    const transactionId = domainDigest("chainlesschain.skill-release-tx/v2\0", {
      authorityReceiptDigest: payload.authorityReceipt.receiptDigest,
      operation: payload.operation,
      operationId: payload.operationId,
      requestDigest: payload.requestDigest,
      targetReleaseDigest: target.releaseDigest,
      tenantId: this.tenantId,
      transitionSubjectDigest: payload.transitionSubjectDigest,
    });
    const acquired = this.#acquireLease(
      payload.skillName,
      transactionId,
      payload.expectedRevision,
      payload.expectedParentDigest,
    );
    const { lease, state: previousState, heartbeat } = acquired;
    let journal = null;
    let prepareReceipt = null;
    let finalized = null;
    try {
      await this.#crash("after-lease", {
        fence: lease.fence,
        skillName: payload.skillName,
        tenantId: this.tenantId,
        transactionId,
      });
      if (
        payload.operation === "rollback" &&
        previousState.lastKnownGoodReleaseDigest !== target.releaseDigest
      ) {
        throw failure(
          "SKILL_RELEASE_ROLLBACK_INVALID",
          "rollback target is no longer last-known-good",
        );
      }
      const nextState = buildState({
        activeReleaseDigest: target.releaseDigest,
        authorityReceiptDigest: payload.authorityReceipt.receiptDigest,
        dependencyLockDigest: target.dependencyLockDigest,
        fence: lease.fence,
        lastKnownGoodReleaseDigest:
          payload.operation === "promote"
            ? (previousState.activeReleaseDigest ?? target.releaseDigest)
            : target.releaseDigest,
        revision: previousState.revision + 1,
        skillName: payload.skillName,
        tenantId: this.tenantId,
        transactionId,
      });
      const intent = this.#buildIntent(payload, previousState, nextState);
      journal = this.#persistJournal({
        intent,
        leaseToken: lease.token,
        nextState,
        phase: "journaled",
        prepareReceipt: null,
        previousState: previousState.revision === 0 ? null : previousState,
        schema: JOURNAL_SCHEMA,
        skillName: payload.skillName,
        stagedFile: `.state-${transactionId.slice(7)}.tmp`,
        tenantId: this.tenantId,
        transactionId,
      });
      await this.#crash("after-journal", journal);

      this.#renewLease(lease);
      prepareReceipt = this.#prepare(intent);
      journal = this.#persistJournal({
        ...journal,
        phase: "prepared",
        prepareReceipt,
      });
      await this.#crash("after-prepare", journal);

      this.#renewLease(lease);
      this.#writeTemporary(journal.stagedFile, nextState);
      await this.#crash("after-staging-fsync", journal);
      this.#writePointer(nextState, journal.stagedFile);
      journal = this.#persistJournal({ ...journal, phase: "pointer-written" });
      await this.#crash("after-pointer", journal);

      this.#renewLease(lease);
      this.#assertFinalizationArtifacts(nextState, target);
      finalized = this.#finalize(journal, prepareReceipt);
      this.#assertFinalizationArtifacts(nextState, target);
      await this.#crash("after-finalize", { journal, finalized });
      this.#assertFinalizationArtifacts(nextState, target);

      clearInterval(heartbeat);
      this.#cleanupTransaction(journal);
      const receiptCore = {
        activeReleaseDigest: nextState.activeReleaseDigest,
        authorityReceiptDigest: payload.authorityReceipt.receiptDigest,
        dependencyLockDigest: nextState.dependencyLockDigest,
        fence: nextState.fence,
        finalizeReceiptDigest: finalized.receiptDigest,
        fromReleaseDigest: previousState.activeReleaseDigest,
        intentDigest: intent.intentDigest,
        operation: payload.operation,
        prepareReceiptDigest: prepareReceipt.receiptDigest,
        receiptDigests: payload.receiptDigests,
        requestDigest: payload.requestDigest,
        revision: nextState.revision,
        schema: SKILL_RELEASE_RECEIPT_SCHEMA,
        skillName: payload.skillName,
        stateDigest: nextState.stateDigest,
        tenantId: this.tenantId,
        transactionId,
        transitionSubjectDigest: payload.transitionSubjectDigest,
      };
      return deepFreeze({
        release: target,
        releaseCreated,
        state: nextState,
        receipt: {
          ...receiptCore,
          receiptDigest: domainDigest(RECEIPT_DOMAIN, receiptCore),
        },
      });
    } catch (error) {
      clearInterval(heartbeat);
      if (error?.preserveForRecovery === true) throw error;
      if (journal) {
        try {
          this.#withRecoveryLock(() =>
            this.#recoverJournal(this.#readJournal(payload.skillName)),
          );
        } catch (recoveryError) {
          throw failure(
            "SKILL_RELEASE_COMMIT_UNKNOWN",
            "transition failed and authenticated recovery did not converge",
            { cause: recoveryError, transactionId },
          );
        }
      } else {
        this.#releaseLease(lease);
      }
      if (error instanceof SkillReleaseRegistryError) throw error;
      throw failure("SKILL_RELEASE_WRITE_FAILED", "transition failed", {
        cause: error,
        transactionId,
      });
    }
  }
}

Object.freeze(SkillReleaseRegistry.prototype);
