import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory } from "../secure-fs.js";
import { verifySkillCandidateDraft } from "./skill-candidate-registry.js";
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
import { consumeRegistryTransitionCapability } from "./skill-promotion-controller.js";

export const SKILL_RELEASE_SCHEMA = "chainlesschain.skill-release/v3";
export const SKILL_RELEASE_STATE_SCHEMA =
  "chainlesschain.skill-release-state/v2";
export const SKILL_RELEASE_RECEIPT_SCHEMA =
  "chainlesschain.skill-release-transition-receipt/v3";
export const SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA =
  "chainlesschain.skill-release-ledger-projection/v1";

const JOURNAL_SCHEMA = "chainlesschain.skill-release-journal/v3";
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
const TEMP_PATTERN = /^\.(?:release|state|write)-[A-Za-z0-9._-]+\.tmp$/u;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MIN_LEASE_TTL_MS = 25;
const DEFAULT_LEASE_TTL_MS = 30_000;

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
  if (!Number.isSafeInteger(value) || value < minimum) {
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
  if (Array.isArray(value)) {
    if (value.length > 2_048) {
      throw failure("SKILL_RELEASE_INVALID", `${label} has too many entries`);
    }
    return value.map((entry, index) =>
      normalizeJson(entry, `${label}[${index}]`, depth + 1),
    );
  }
  if (!isPlainObject(value)) {
    throw failure("SKILL_RELEASE_INVALID", `${label} must be canonical JSON`);
  }
  const keys = Object.keys(value).sort();
  if (keys.length > 2_048 || keys.some((key) => !key || key.length > 256)) {
    throw failure("SKILL_RELEASE_INVALID", `${label} has unsafe keys`);
  }
  return Object.fromEntries(
    keys.map((key) => [
      key,
      normalizeJson(value[key], `${label}.${key}`, depth + 1),
    ]),
  );
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

export function buildSkillRelease({
  candidate,
  dependencyLock,
  mutationRequest,
  consumptionReceipt,
}) {
  const verifiedCandidate = verifySkillCandidateDraft(candidate);
  const request = verifySkillMutationRequest(mutationRequest);
  const authorityReceipt =
    verifySkillMutationConsumptionReceipt(consumptionReceipt);
  verifyRequestReceiptBinding(request, authorityReceipt);
  if (
    request.operation !== SKILL_MUTATION_OPERATIONS.PROMOTE ||
    authorityReceipt.operation !== SKILL_MUTATION_OPERATIONS.PROMOTE ||
    request.skillName !== verifiedCandidate.skillName
  ) {
    throw failure(
      "SKILL_RELEASE_INVALID",
      "release creation requires a promotion request for the candidate Skill",
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
  const normalizedLock = normalizeJson(dependencyLock, "dependencyLock");
  if (!isPlainObject(normalizedLock)) {
    throw failure("SKILL_RELEASE_INVALID", "dependencyLock must be an object");
  }
  const dependencyLockDigest = digestDependencyLock(normalizedLock);
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
    candidateId: verifiedCandidate.candidateId,
    content: verifiedCandidate.content,
    contentDigest: verifiedCandidate.contentDigest,
    dependencyLock: normalizedLock,
    dependencyLockDigest,
    mutationRequestDigest: request.requestDigest,
    parentDigest: verifiedCandidate.parentDigest,
    receiptDigests: receiptDigestsFromRequest(request),
    requestedCapabilities: [...verifiedCandidate.requestedCapabilities],
    schema: SKILL_RELEASE_SCHEMA,
    skillName: verifiedCandidate.skillName,
    targetRuntimes: [...verifiedCandidate.targetRuntimes],
    transitionSubjectDigest,
  };
  return deepFreeze({
    ...core,
    releaseDigest: domainDigest(RELEASE_DOMAIN, core),
  });
}

export function verifySkillRelease(value) {
  assertExactKeys(value, RELEASE_KEYS, "release");
  if (
    value.schema !== SKILL_RELEASE_SCHEMA ||
    typeof value.content !== "string"
  ) {
    throw failure(
      "SKILL_RELEASE_INVALID",
      "release schema or content is invalid",
    );
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
    schema: SKILL_RELEASE_SCHEMA,
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
    transactionId: input.transactionId,
  };
  return deepFreeze({ ...core, stateDigest: domainDigest(STATE_DOMAIN, core) });
}

function initialState(name) {
  return buildState({
    activeReleaseDigest: null,
    authorityReceiptDigest: null,
    dependencyLockDigest: null,
    fence: 0,
    lastKnownGoodReleaseDigest: null,
    revision: 0,
    skillName: name,
    transactionId: null,
  });
}

function verifyState(value) {
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
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
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

export class SkillReleaseRegistry {
  #fs;

  #directories;

  #rootIdentity;

  #randomToken;

  #now;

  #leaseTtlMs;

  #crashHook;

  #ledgerPrepare;

  #ledgerFinalize;

  #ledgerQuery;

  #pins = new WeakMap();

  constructor({
    rootDir = path.join(getHomeDir(), "evolution", "registry", "releases"),
    secure = true,
    fsImpl = fs,
    randomToken = () => crypto.randomBytes(16).toString("hex"),
    now = () => new Date(),
    leaseTtlMs = DEFAULT_LEASE_TTL_MS,
    crashHook = null,
    transactionLedger,
  } = {}) {
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
      typeof randomToken !== "function" ||
      typeof now !== "function" ||
      !Number.isSafeInteger(leaseTtlMs) ||
      leaseTtlMs < MIN_LEASE_TTL_MS ||
      (crashHook !== null && typeof crashHook !== "function")
    ) {
      throw failure("SKILL_RELEASE_INVALID", "registry options are invalid");
    }

    this.#fs = fsImpl;
    this.#randomToken = randomToken;
    this.#now = now;
    this.#leaseTtlMs = leaseTtlMs;
    this.#crashHook = crashHook;
    this.#ledgerPrepare = transactionLedger.prepare.bind(transactionLedger);
    this.#ledgerFinalize = transactionLedger.finalize.bind(transactionLedger);
    this.#ledgerQuery = transactionLedger.query.bind(transactionLedger);
    Object.freeze(transactionLedger);

    const requestedRoot = path.resolve(rootDir);
    try {
      if (secure !== false) {
        ensurePrivateDirectory(requestedRoot, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      } else {
        this.#fs.mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
      }
      const rootStat = this.#fs.lstatSync(requestedRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "registry root must be a non-symlink directory",
        );
      }
      this.rootDir = realpath(this.#fs, requestedRoot);
      this.#directories = {};
      for (const name of [
        "artifacts",
        "active",
        "journals",
        "locks",
        "staging",
      ]) {
        const directory = path.join(this.rootDir, name);
        this.#fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const stat = this.#fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw failure(
            "SKILL_RELEASE_STORE_UNSAFE",
            `${name} directory is unsafe`,
          );
        }
        this.#directories[name] = deepFreeze({
          path: realpath(this.#fs, directory),
          identity: identity(stat),
        });
      }
      this.#directories = deepFreeze(this.#directories);
      this.#rootIdentity = identity(this.#fs.lstatSync(this.rootDir));
      this.#assertBoundary();
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

  #clock() {
    const value = this.#now();
    const date =
      value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw failure("SKILL_RELEASE_CLOCK_INVALID", "registry clock is invalid");
    }
    return date;
  }

  #token() {
    const value = String(this.#randomToken());
    if (!TOKEN_PATTERN.test(value)) {
      throw failure("SKILL_RELEASE_WRITE_FAILED", "random token is invalid");
    }
    return value;
  }

  #assertBoundary() {
    const rootStat = this.#fs.lstatSync(this.rootDir);
    if (
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      identity(rootStat) !== this.#rootIdentity ||
      !samePath(realpath(this.#fs, this.rootDir), this.rootDir)
    ) {
      throw failure("SKILL_RELEASE_STORE_UNSAFE", "registry root changed");
    }
    for (const entry of Object.values(this.#directories)) {
      const stat = this.#fs.lstatSync(entry.path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        identity(stat) !== entry.identity ||
        !samePath(realpath(this.#fs, entry.path), entry.path) ||
        !isContained(this.rootDir, entry.path)
      ) {
        throw failure(
          "SKILL_RELEASE_STORE_UNSAFE",
          "registry directory changed",
        );
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
    let descriptor = null;
    try {
      const before = this.#fs.lstatSync(filePath);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size < 1 ||
        before.size > MAX_FILE_BYTES
      ) {
        throw failure(code, "artifact must be a bounded non-symlink file");
      }
      descriptor = this.#fs.openSync(
        filePath,
        this.#fs.constants.O_RDONLY | (this.#fs.constants.O_NOFOLLOW || 0),
      );
      const opened = this.#fs.fstatSync(descriptor);
      if (!opened.isFile() || identity(opened) !== identity(before)) {
        throw failure(code, "artifact changed while opening");
      }
      const bytes = this.#fs.readFileSync(descriptor);
      const after = this.#fs.fstatSync(descriptor);
      if (
        identity(after) !== identity(opened) ||
        after.size !== opened.size ||
        bytes.length !== opened.size
      ) {
        throw failure(code, "artifact changed while reading");
      }
      return bytes;
    } finally {
      if (descriptor !== null) this.#fs.closeSync(descriptor);
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
    try {
      descriptor = this.#fs.openSync(filePath, "wx", 0o600);
      this.#fs.writeFileSync(descriptor, bytes);
      this.#fs.fsyncSync(descriptor);
      if (this.#fs.fstatSync(descriptor).size !== bytes.length) {
        throw failure(
          "SKILL_RELEASE_WRITE_FAILED",
          "temporary write was incomplete",
        );
      }
    } finally {
      if (descriptor !== null) this.#fs.closeSync(descriptor);
    }
    fsyncDirectory(this.#fs, this.#directories.staging.path);
    return filePath;
  }

  #atomicWrite(area, destination, value) {
    const name = `.write-${process.pid}-${this.#token()}.tmp`;
    const temporary = this.#writeTemporary(name, value);
    this.#fs.renameSync(temporary, destination);
    const destinationDirectory = path.dirname(destination);
    const destinationStat = this.#fs.lstatSync(destinationDirectory);
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw failure(
        "SKILL_RELEASE_STORE_UNSAFE",
        "atomic write destination directory is unsafe",
      );
    }
    fsyncDirectory(this.#fs, destinationDirectory);
    if (!samePath(destinationDirectory, this.#directories[area].path)) {
      fsyncDirectory(this.#fs, this.#directories[area].path);
    }
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
      fsyncDirectory(this.#fs, this.#directories.artifacts.path);
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
      throw failure("SKILL_RELEASE_CORRUPT", "release verification failed", {
        cause,
      });
    }
    if (release.releaseDigest !== expected) {
      throw failure("SKILL_RELEASE_CORRUPT", "release path digest differs");
    }
    return release;
  }

  #readStateRaw(name) {
    const normalizedName = skillName(name);
    try {
      const state = verifyState(
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
      return state;
    } catch (error) {
      if (error?.code === "ENOENT") return initialState(normalizedName);
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
      transactionId: active.state.transactionId,
    });
    return pin;
  }

  readPinned(pin) {
    const binding =
      pin && typeof pin === "object" ? this.#pins.get(pin) : undefined;
    if (!binding) {
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
      schema: "chainlesschain.skill-release-lock-owner/v1",
      skillName: skill,
      token,
      transactionId,
    });
  }

  #verifyOwner(value) {
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
      "token",
      "transactionId",
    ]);
    assertExactKeys(value, keys, "lock owner", "SKILL_RELEASE_LEASE_INVALID");
    if (
      value.schema !== "chainlesschain.skill-release-lock-owner/v1" ||
      !["recovery", "skill"].includes(value.kind) ||
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
    const nextState = verifyState(core.nextState);
    const previousState =
      core.previousState === null ? null : verifyState(core.previousState);
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
    this.#fs.renameSync(stagedPath, this.#statePath(state.skillName));
    fsyncDirectory(this.#fs, this.#directories.active.path);
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
      this.#finalize(journal, prepareReceipt);
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
      if (!stat.isFile() || stat.isSymbolicLink()) {
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
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
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
      "dependencyLock",
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
      "transitionSubjectDigest",
    ]);
    assertExactKeys(value, keys, "transition capability payload");
    const authorityReceipt = verifySkillMutationConsumptionReceipt(
      value.authorityReceipt,
    );
    const mutationRequest = verifySkillMutationRequest(value.mutationRequest);
    if (
      authorityReceipt.role !== SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER ||
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
    let dependencyLock = null;
    let targetReleaseDigest = null;
    const dependencyLockDigest = digest(
      value.dependencyLockDigest,
      "dependencyLockDigest",
    );
    if (value.operation === "promote") {
      candidate = verifySkillCandidateDraft(value.candidate);
      dependencyLock = normalizeJson(value.dependencyLock, "dependencyLock");
      if (
        !isPlainObject(dependencyLock) ||
        value.targetReleaseDigest !== null
      ) {
        throw failure(
          "SKILL_RELEASE_INVALID",
          "promotion requires candidate/dependency lock and no caller target digest",
        );
      }
      if (digestDependencyLock(dependencyLock) !== dependencyLockDigest) {
        throw failure(
          "SKILL_RELEASE_AUTHORITY_INVALID",
          "promotion dependency lock differs from its authorized digest",
        );
      }
    } else {
      if (value.candidate !== null || value.dependencyLock !== null) {
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
      dependencyLock,
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
        dependencyLock: payload.dependencyLock,
        mutationRequest: payload.mutationRequest,
      });
      target = created.release;
      releaseCreated = created.created;
    } else {
      target = this.readRelease(payload.targetReleaseDigest);
    }
    if (target.skillName !== payload.skillName) {
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

    const transactionId = domainDigest("chainlesschain.skill-release-tx/v1\0", {
      authorityReceiptDigest: payload.authorityReceipt.receiptDigest,
      operation: payload.operation,
      operationId: payload.operationId,
      requestDigest: payload.requestDigest,
      targetReleaseDigest: target.releaseDigest,
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
      finalized = this.#finalize(journal, prepareReceipt);
      await this.#crash("after-finalize", { journal, finalized });

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
