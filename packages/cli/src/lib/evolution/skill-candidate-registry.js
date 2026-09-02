import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import {
  verifySkillDependencyLock,
  verifySkillRuntimeManifest,
  verifySkillTargetMatrix,
} from "./skill-execution-manifest.js";
import { assertEvolutionContentContainsNoKnownSecrets } from "./evolution-evidence-projector.js";

export const SKILL_CANDIDATE_SCHEMA = "chainlesschain.skill-candidate/v2";
export const SKILL_CANDIDATE_TENANT_MARKER_SCHEMA =
  "chainlesschain.skill-candidate-tenant-marker/v1";
export const SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE =
  "SKILL_CANDIDATE_MIGRATION_REQUIRED";
export const SKILL_CANDIDATE_MIGRATION_RECORD_SCHEMA =
  "chainlesschain.skill-candidate-migration/v1";
export const SKILL_CANDIDATE_MIGRATION_AUTHORITY_SCHEMA =
  "chainlesschain.skill-candidate-migration-authority/v1";
export const SKILL_CANDIDATE_MIGRATION_RECEIPT_SCHEMA =
  "chainlesschain.skill-candidate-migration-receipt/v1";
export const SKILL_CANDIDATE_STORE_MIGRATION_SCHEMA =
  "chainlesschain.skill-candidate-store-migration/v1";
export const SKILL_CANDIDATE_STORE_LIMIT_CODE = "SKILL_CANDIDATE_STORE_LIMIT";
export const SKILL_CANDIDATE_STATUS = "draft";
export const SKILL_CANDIDATE_CONTENT_TYPE =
  "text/markdown; charset=utf-8; profile=skill";
export const SKILL_CANDIDATE_MAX_CONTENT_BYTES = 1024 * 1024;
export const SKILL_CANDIDATE_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA =
  "chainlesschain.skill-candidate-target-matrix-admission-authority/v1";
export const SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_REQUEST_SCHEMA =
  "chainlesschain.skill-candidate-target-matrix-admission-request/v1";
export const SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA =
  "chainlesschain.skill-candidate-target-matrix-admission-resolution/v1";

const MAX_SOURCE_EVIDENCE_REFS = 256;
const MAX_REQUESTED_CAPABILITIES = 128;
const MAX_TARGET_RUNTIMES = 64;
export const SKILL_CANDIDATE_TENANT_SCAN_MAX_ENTRIES = 4_096;
export const SKILL_CANDIDATE_TENANT_SCAN_MAX_BYTES = 16 * 1024 * 1024;
export const SKILL_CANDIDATE_TENANT_SCAN_MAX_NODES = 100_000;
const MAX_TENANT_SCAN_DEPTH = 64;
const MAX_LIST_LIMIT = 10_000;
const DEFAULT_LIST_LIMIT = 1_000;
const MAX_TENANT_MARKER_BYTES = 4096;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TENANT_KEY_PATTERN = /^[a-f0-9]{64}$/u;
const CANDIDATE_FILE_PATTERN = /^([a-f0-9]{64})\.json$/u;
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const NAMESPACED_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const EVIDENCE_REF_PATTERN = /^[a-z][a-z0-9+.-]{1,31}:[^\s\\]+$/u;
const LEGACY_SKILL_CANDIDATE_SCHEMA = "chainlesschain.skill-candidate/v1";
const LEGACY_CANDIDATE_DIGEST_DOMAIN = LEGACY_SKILL_CANDIDATE_SCHEMA;
const CANDIDATE_DIGEST_DOMAIN = "chainlesschain.skill-candidate/v2";
const CANDIDATE_MIGRATION_DOMAIN = SKILL_CANDIDATE_MIGRATION_RECORD_SCHEMA;
const TENANT_KEY_DOMAIN = "chainlesschain.skill-candidate-tenant-key/v1";
const TENANT_MARKER_DIGEST_DOMAIN =
  "chainlesschain.skill-candidate-tenant-marker/v1";
const TENANT_MARKER_COMPONENT = "skill-candidate-registry";
const TENANT_MARKER_FILE = "_tenant.json";

const CANDIDATE_KEYS = new Set([
  "candidateId",
  "content",
  "contentDigest",
  "contentType",
  "dependencyLock",
  "dependencyLockDigest",
  "derivationMode",
  "evalRunId",
  "parentDigest",
  "proposerModel",
  "requestedCapabilities",
  "runtimeManifest",
  "runtimeManifestDigest",
  "schema",
  "skillName",
  "sourceEvidenceRefs",
  "status",
  "targetMatrix",
  "targetMatrixRoot",
  "targetRuntimes",
  "tenantId",
  "wikiRevision",
]);
const LEGACY_CANDIDATE_KEYS = new Set([
  "candidateId",
  "content",
  "contentDigest",
  "contentType",
  "derivationMode",
  "evalRunId",
  "parentDigest",
  "proposerModel",
  "requestedCapabilities",
  "schema",
  "skillName",
  "sourceEvidenceRefs",
  "status",
  "targetRuntimes",
  "wikiRevision",
]);

const CREATE_INPUT_KEYS = new Set([
  "content",
  "dependencyLock",
  "derivationMode",
  "evalRunId",
  "parentDigest",
  "proposerModel",
  "requestedCapabilities",
  "runtimeManifest",
  "skillName",
  "sourceEvidenceRefs",
  "targetMatrix",
  "tenantId",
  "wikiRevision",
]);

const CREATE_REQUIRED_KEYS = new Set([
  "content",
  "dependencyLock",
  "derivationMode",
  "runtimeManifest",
  "skillName",
  "sourceEvidenceRefs",
  "targetMatrix",
  "tenantId",
]);
const TARGET_MATRIX_ADMISSION_KEYS = new Set([
  "expectedEnvironmentBindings",
  "expectedTargetMatrixRoot",
]);
const TARGET_MATRIX_ADMISSION_AUTHORITY_KEYS = new Set([
  "authorityId",
  "handlerArtifactDigest",
  "resolve",
  "revision",
  "schema",
  "trust",
]);
const TARGET_MATRIX_ADMISSION_RESOLUTION_KEYS = new Set([
  "admitted",
  "authorityId",
  "dependencyLockDigest",
  "expectedEnvironmentBindings",
  "expectedTargetMatrixRoot",
  "handlerArtifactDigest",
  "revision",
  "runtimeManifestDigest",
  "schema",
  "skillName",
  "tenantId",
  "trust",
]);
const TENANT_MARKER_KEYS = new Set([
  "component",
  "markerDigest",
  "schema",
  "tenantId",
  "tenantKey",
]);
const REGISTRY_OPTION_KEYS = new Set([
  "fsImpl",
  "randomToken",
  "rootDir",
  "secure",
  "tenantId",
  "targetMatrixAdmissionAuthority",
]);
const LIST_OPTION_KEYS = new Set(["limit"]);
const MIGRATION_EXECUTION_KEYS = new Set([
  "dependencyLock",
  "runtimeManifest",
  "targetMatrix",
]);
const MIGRATION_AUTHORITY_KEYS = new Set([
  "audit",
  "authorityId",
  "handlerArtifactDigest",
  "schema",
  "trust",
]);
const MIGRATION_RECEIPT_KEYS = new Set([
  "authenticated",
  "authorityId",
  "durable",
  "handlerArtifactDigest",
  "migrationDigest",
  "receiptDigest",
  "schema",
  "trust",
]);
const PROPOSER_MODEL_KEYS = new Set(["model", "provider", "version"]);
const SOURCE_EVIDENCE_KEYS = new Set(["digest", "ref"]);
const DERIVATION_MODES = new Set(["wiki", "record-replay", "manual-import"]);

export class SkillCandidateRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillCandidateRegistryError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function registryError(code, message, details = {}) {
  return new SkillCandidateRegistryError(code, message, details);
}

function migrationRequired(message, details = {}) {
  return registryError(
    SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE,
    message,
    details,
  );
}

function tenantScanLimit(message, details = {}) {
  return registryError(SKILL_CANDIDATE_STORE_LIMIT_CODE, message, details);
}

function rejectProxy(value, label) {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    utilTypes.isProxy(value)
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must not be a Proxy`,
    );
  }
}

function isPlainObject(value) {
  rejectProxy(value, "record");
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be a plain object`,
    );
  }
}

function assertDataRecord(
  value,
  allowed,
  label,
  { exact = false, required = new Set() } = {},
) {
  assertPlainObject(value, label);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    keys.length > allowed.size ||
    (exact && keys.length !== allowed.size) ||
    [...required].some((key) => !keys.includes(key))
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      exact || required.size > 0
        ? `${label} must contain exactly the required supported fields`
        : `${label} contains unsupported fields`,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        `${label}.${String(key)} must be an enumerable own data property`,
      );
    }
  }
}

function ownData(value, key, label, fallback) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return fallback;
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label}.${key} must be an enumerable own data property`,
    );
  }
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
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
  const hash = crypto.createHash("sha256");
  hash.update(domain, "utf8");
  hash.update("\0", "utf8");
  updateCanonicalHash(hash, value, { bytes: 0 });
  return `sha256:${hash.digest("hex")}`;
}

function updateCanonicalHash(hash, value, state) {
  const update = (fragment) => {
    const bytes = Buffer.byteLength(fragment, "utf8");
    if (state.bytes > SKILL_CANDIDATE_MAX_ARTIFACT_BYTES - bytes) {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        `candidate artifact exceeds ${SKILL_CANDIDATE_MAX_ARTIFACT_BYTES} bytes`,
      );
    }
    state.bytes += bytes;
    hash?.update(fragment, "utf8");
  };
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        "candidate artifact must be canonical JSON",
      );
    }
    update(serialized);
    return;
  }
  if (Array.isArray(value)) {
    update("[");
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) update(",");
      updateCanonicalHash(hash, value[index], state);
    }
    update("]");
    return;
  }
  const keys = Object.keys(value).sort();
  update("{");
  for (let index = 0; index < keys.length; index += 1) {
    if (index > 0) update(",");
    const key = keys[index];
    update(JSON.stringify(key));
    update(":");
    updateCanonicalHash(hash, value[key], state);
  }
  update("}");
}

function canonicalByteLength(value) {
  const state = { bytes: 0 };
  updateCanonicalHash(null, value, state);
  return state.bytes;
}

function contentDigest(content) {
  return sha256(Buffer.from(content, "utf8"));
}

function candidateDigest(core) {
  return domainDigest(CANDIDATE_DIGEST_DOMAIN, core);
}

function normalizeDigest(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be a lowercase sha256 digest${nullable ? " or null" : ""}`,
    );
  }
  return value;
}

function normalizeBoundedString(value, label, maxLength) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    value.trim() !== value ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 0x20 || codePoint === 0x7f;
    })
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be a non-empty bounded string without control characters`,
    );
  }
  return value;
}

function normalizeSkillName(value) {
  const name = normalizeBoundedString(value, "skillName", 128);
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "skillName must use kebab-case",
    );
  }
  return name;
}

function normalizeTenantId(value, label = "tenantId") {
  const tenantId = normalizeBoundedString(value, label, 256);
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be a canonical tenant identifier`,
    );
  }
  return tenantId;
}

function normalizeContent(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "content must be non-empty Skill Markdown without NUL bytes",
    );
  }
  const size = Buffer.byteLength(value, "utf8");
  if (size > SKILL_CANDIDATE_MAX_CONTENT_BYTES) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `content exceeds ${SKILL_CANDIDATE_MAX_CONTENT_BYTES} bytes`,
    );
  }
  assertCandidatePlaintextSafe(value, "content");
  return value;
}

function assertCandidatePlaintextSafe(value, label) {
  try {
    assertEvolutionContentContainsNoKnownSecrets(value);
  } catch (cause) {
    throw registryError(
      "SKILL_CANDIDATE_SECRET_LEAK",
      `candidate ${label} contains secret or PII plaintext`,
      { cause },
    );
  }
}

function normalizeNamespacedId(value, label) {
  const normalized = normalizeBoundedString(value, label, 128);
  if (!NAMESPACED_ID_PATTERN.test(normalized)) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be a lowercase namespaced identifier`,
    );
  }
  return normalized;
}

function normalizeStandardArray(value, label, maximum) {
  rejectProxy(value, label);
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be a standard array with at most ${maximum} entries`,
    );
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be a dense bounded standard array`,
    );
  }
  const entries = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        `${label}[${index}] must be an enumerable own data property`,
      );
    }
    entries.push(descriptor.value);
  }
  return entries;
}

function normalizeUniqueStringList(value, label, maximum) {
  const normalized = normalizeStandardArray(value, label, maximum).map(
    (entry) => normalizeNamespacedId(entry, label),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must not contain duplicates`,
    );
  }
  return normalized.sort();
}

function normalizeSourceEvidenceRefs(value) {
  const entries = normalizeStandardArray(
    value,
    "sourceEvidenceRefs",
    MAX_SOURCE_EVIDENCE_REFS,
  );
  const normalized = entries.map((entry, index) => {
    assertDataRecord(
      entry,
      SOURCE_EVIDENCE_KEYS,
      `sourceEvidenceRefs[${index}]`,
      { exact: true },
    );
    const ref = normalizeBoundedString(
      ownData(entry, "ref", `sourceEvidenceRefs[${index}]`),
      `sourceEvidenceRefs[${index}].ref`,
      2048,
    );
    if (!EVIDENCE_REF_PATTERN.test(ref)) {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        `sourceEvidenceRefs[${index}].ref must be an absolute opaque URI`,
      );
    }
    assertCandidatePlaintextSafe(ref, `sourceEvidenceRefs[${index}].ref`);
    return {
      digest: normalizeDigest(
        ownData(entry, "digest", `sourceEvidenceRefs[${index}]`),
        `sourceEvidenceRefs[${index}].digest`,
      ),
      ref,
    };
  });
  const keys = normalized.map((entry) => `${entry.ref}\0${entry.digest}`);
  if (new Set(keys).size !== keys.length) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "sourceEvidenceRefs must not contain duplicates",
    );
  }
  return normalized.sort(
    (left, right) =>
      compareStrings(left.ref, right.ref) ||
      compareStrings(left.digest, right.digest),
  );
}

function normalizeNullableReference(value, label) {
  if (value == null) return null;
  const normalized = normalizeBoundedString(value, label, 512);
  if (/\s|\\/u.test(normalized)) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be an opaque identifier, not a filesystem path`,
    );
  }
  return normalized;
}

function normalizeProposerModel(value) {
  if (value == null) return null;
  assertDataRecord(value, PROPOSER_MODEL_KEYS, "proposerModel", {
    exact: true,
  });
  return {
    provider: normalizeBoundedString(
      ownData(value, "provider", "proposerModel"),
      "proposerModel.provider",
      128,
    ),
    model: normalizeBoundedString(
      ownData(value, "model", "proposerModel"),
      "proposerModel.model",
      256,
    ),
    version: normalizeBoundedString(
      ownData(value, "version", "proposerModel"),
      "proposerModel.version",
      128,
    ),
  };
}

function normalizeDerivationMode(value) {
  if (!DERIVATION_MODES.has(value)) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "derivationMode must be wiki, record-replay, or manual-import",
    );
  }
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.isFrozen(value) ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function chargeTenantScanNodes(root, budget, filePath) {
  let current = root;
  let depth = 0;
  const frames = [];
  while (true) {
    budget.nodes += 1;
    if (budget.nodes > SKILL_CANDIDATE_TENANT_SCAN_MAX_NODES) {
      throw tenantScanLimit(
        "candidate tenant scan exceeded its aggregate node budget",
        { path: filePath },
      );
    }
    if (depth > MAX_TENANT_SCAN_DEPTH) {
      throw tenantScanLimit(
        "candidate tenant scan exceeded its aggregate structure depth budget",
        { path: filePath },
      );
    }

    if (current !== null && typeof current === "object") {
      const keys = Array.isArray(current) ? null : Object.keys(current);
      const length = keys === null ? current.length : keys.length;
      if (length > SKILL_CANDIDATE_TENANT_SCAN_MAX_NODES - budget.nodes) {
        throw tenantScanLimit(
          "candidate tenant scan exceeded its aggregate node budget",
          { path: filePath },
        );
      }
      if (length > 0) {
        frames.push({ collection: current, depth, index: 1, keys });
        current = keys === null ? current[0] : current[keys[0]];
        depth += 1;
        continue;
      }
    }

    let advanced = false;
    while (frames.length > 0) {
      const frame = frames.at(-1);
      const length =
        frame.keys === null ? frame.collection.length : frame.keys.length;
      if (frame.index < length) {
        const key = frame.keys === null ? frame.index : frame.keys[frame.index];
        frame.index += 1;
        current = frame.collection[key];
        depth = frame.depth + 1;
        advanced = true;
        break;
      }
      frames.pop();
    }
    if (!advanced) return;
  }
}

function normalizeAdmissionContext(value) {
  assertDataRecord(
    value,
    TARGET_MATRIX_ADMISSION_KEYS,
    "target matrix admission context",
    { exact: true },
  );
  return {
    expectedEnvironmentBindings: ownData(
      value,
      "expectedEnvironmentBindings",
      "target matrix admission context",
    ),
    expectedTargetMatrixRoot: ownData(
      value,
      "expectedTargetMatrixRoot",
      "target matrix admission context",
    ),
  };
}

function normalizeAdmissionRevision(value, label) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 1) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be a positive safe integer`,
    );
  }
  return value;
}

function normalizeTargetMatrixAdmissionAuthority(value) {
  assertDataRecord(
    value,
    TARGET_MATRIX_ADMISSION_AUTHORITY_KEYS,
    "target matrix admission authority",
    { exact: true },
  );
  const schema = ownData(value, "schema", "target matrix admission authority");
  const trust = ownData(value, "trust", "target matrix admission authority");
  const resolver = ownData(
    value,
    "resolve",
    "target matrix admission authority",
  );
  rejectProxy(resolver, "target matrix admission authority.resolve");
  if (
    schema !== SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA ||
    trust !== "trusted" ||
    typeof resolver !== "function"
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "target matrix admission authority descriptor is invalid",
    );
  }
  const descriptor = deepFreeze({
    schema,
    authorityId: normalizeNamespacedId(
      ownData(value, "authorityId", "target matrix admission authority"),
      "target matrix admission authority.authorityId",
    ),
    trust,
    revision: normalizeAdmissionRevision(
      ownData(value, "revision", "target matrix admission authority"),
      "target matrix admission authority.revision",
    ),
    handlerArtifactDigest: normalizeDigest(
      ownData(
        value,
        "handlerArtifactDigest",
        "target matrix admission authority",
      ),
      "target matrix admission authority.handlerArtifactDigest",
    ),
  });
  const resolve = (request) => Reflect.apply(resolver, value, [request]);
  Object.freeze(value);
  return { descriptor, resolve };
}

function buildTargetMatrixAdmissionRequest(input) {
  assertDataRecord(input, CREATE_INPUT_KEYS, "candidate input", {
    required: CREATE_REQUIRED_KEYS,
  });
  const ownerTenantId = normalizeTenantId(
    ownData(input, "tenantId", "candidate input"),
  );
  const name = normalizeSkillName(
    ownData(input, "skillName", "candidate input"),
  );
  let dependencyLock;
  let runtimeManifest;
  try {
    dependencyLock = verifySkillDependencyLock(
      ownData(input, "dependencyLock", "candidate input"),
    );
    runtimeManifest = verifySkillRuntimeManifest(
      ownData(input, "runtimeManifest", "candidate input"),
    );
  } catch (cause) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate execution artifacts failed pre-admission verification",
      { cause },
    );
  }
  const targetMatrix = ownData(input, "targetMatrix", "candidate input");
  assertPlainObject(targetMatrix, "candidate input.targetMatrix");
  return {
    request: deepFreeze({
      schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_REQUEST_SCHEMA,
      tenantId: ownerTenantId,
      skillName: name,
      dependencyLockDigest: dependencyLock.dependencyLockDigest,
      runtimeManifestDigest: runtimeManifest.runtimeManifestDigest,
      proposedTargetMatrixRoot: normalizeDigest(
        ownData(targetMatrix, "targetMatrixRoot", "candidate target matrix"),
        "candidate targetMatrixRoot",
      ),
    }),
    dependencyLock,
    runtimeManifest,
    targetMatrix,
  };
}

function verifyTargetMatrixAdmissionResolution(
  value,
  authorityDescriptor,
  request,
  artifacts,
) {
  if (value === false || value === null || value === undefined) {
    throw registryError(
      "SKILL_CANDIDATE_ADMISSION_REJECTED",
      "target matrix admission authority did not synchronously admit the candidate",
    );
  }
  assertDataRecord(
    value,
    TARGET_MATRIX_ADMISSION_RESOLUTION_KEYS,
    "target matrix admission resolution",
    { exact: true },
  );
  const expectedEnvironmentBindings = ownData(
    value,
    "expectedEnvironmentBindings",
    "target matrix admission resolution",
  );
  const proposedCells = ownData(
    artifacts.targetMatrix,
    "cells",
    "candidate target matrix",
  );
  const resolvedCells = normalizeStandardArray(
    expectedEnvironmentBindings,
    "target matrix admission resolution.expectedEnvironmentBindings",
    MAX_TARGET_RUNTIMES,
  );
  const candidateCells = normalizeStandardArray(
    proposedCells,
    "candidate target matrix.cells",
    MAX_TARGET_RUNTIMES,
  );
  if (
    value === artifacts.targetMatrix ||
    expectedEnvironmentBindings === proposedCells ||
    resolvedCells.some((cell) => candidateCells.includes(cell)) ||
    ownData(value, "admitted", "target matrix admission resolution") !== true ||
    ownData(value, "schema", "target matrix admission resolution") !==
      SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA ||
    ownData(value, "authorityId", "target matrix admission resolution") !==
      authorityDescriptor.authorityId ||
    ownData(value, "trust", "target matrix admission resolution") !==
      authorityDescriptor.trust ||
    ownData(value, "revision", "target matrix admission resolution") !==
      authorityDescriptor.revision ||
    ownData(
      value,
      "handlerArtifactDigest",
      "target matrix admission resolution",
    ) !== authorityDescriptor.handlerArtifactDigest ||
    ownData(value, "tenantId", "target matrix admission resolution") !==
      request.tenantId ||
    ownData(value, "skillName", "target matrix admission resolution") !==
      request.skillName ||
    ownData(
      value,
      "dependencyLockDigest",
      "target matrix admission resolution",
    ) !== request.dependencyLockDigest ||
    ownData(
      value,
      "runtimeManifestDigest",
      "target matrix admission resolution",
    ) !== request.runtimeManifestDigest ||
    ownData(
      value,
      "expectedTargetMatrixRoot",
      "target matrix admission resolution",
    ) !== request.proposedTargetMatrixRoot
  ) {
    throw registryError(
      "SKILL_CANDIDATE_ADMISSION_REJECTED",
      "target matrix admission resolution is not exactly bound to its authority and request",
    );
  }
  let verifiedTargetMatrix;
  try {
    verifiedTargetMatrix = verifySkillTargetMatrix(artifacts.targetMatrix, {
      dependencyLock: artifacts.dependencyLock,
      expectedEnvironmentBindings,
      expectedTargetMatrixRoot: request.proposedTargetMatrixRoot,
      runtimeManifest: artifacts.runtimeManifest,
    });
  } catch (cause) {
    throw registryError(
      "SKILL_CANDIDATE_ADMISSION_REJECTED",
      "target matrix admission resolution failed exact matrix verification",
      { cause },
    );
  }
  return deepFreeze({
    expectedEnvironmentBindings: verifiedTargetMatrix.cells.map((cell) => ({
      ...cell,
    })),
    expectedTargetMatrixRoot: verifiedTargetMatrix.targetMatrixRoot,
  });
}

function verifyExecutionArtifacts(input, tenantId, admissionContext) {
  let dependencyLock;
  let runtimeManifest;
  let targetMatrix;
  try {
    dependencyLock = verifySkillDependencyLock(
      ownData(input, "dependencyLock", "candidate input"),
    );
    runtimeManifest = verifySkillRuntimeManifest(
      ownData(input, "runtimeManifest", "candidate input"),
    );
    targetMatrix = verifySkillTargetMatrix(
      ownData(input, "targetMatrix", "candidate input"),
      {
        dependencyLock,
        expectedEnvironmentBindings:
          admissionContext.expectedEnvironmentBindings,
        expectedTargetMatrixRoot: admissionContext.expectedTargetMatrixRoot,
        runtimeManifest,
      },
    );
  } catch (cause) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate execution artifacts failed verification",
      { cause },
    );
  }
  if (
    dependencyLock.tenantId !== tenantId ||
    runtimeManifest.tenantId !== tenantId ||
    targetMatrix.tenantId !== tenantId
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate and execution artifacts must belong to the same tenant",
    );
  }
  return { dependencyLock, runtimeManifest, targetMatrix };
}

function candidateCore(input, verificationContext) {
  assertDataRecord(input, CREATE_INPUT_KEYS, "candidate input", {
    required: CREATE_REQUIRED_KEYS,
  });
  const admissionContext = normalizeAdmissionContext(verificationContext);
  const tenantId = normalizeTenantId(
    ownData(input, "tenantId", "candidate input"),
  );
  const { dependencyLock, runtimeManifest, targetMatrix } =
    verifyExecutionArtifacts(input, tenantId, admissionContext);
  const evalRunId =
    ownData(input, "evalRunId", "candidate input", null) ?? null;
  if (evalRunId !== null) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "a draft candidate cannot carry an evalRunId",
    );
  }
  const content = normalizeContent(
    ownData(input, "content", "candidate input"),
  );
  const sourceEvidenceRefs = normalizeSourceEvidenceRefs(
    ownData(input, "sourceEvidenceRefs", "candidate input", []),
  );
  const derivationMode = normalizeDerivationMode(
    ownData(input, "derivationMode", "candidate input"),
  );
  const wikiRevision = normalizeNullableReference(
    ownData(input, "wikiRevision", "candidate input", null) ?? null,
    "wikiRevision",
  );
  const proposerModel = normalizeProposerModel(
    ownData(input, "proposerModel", "candidate input", null) ?? null,
  );
  if (sourceEvidenceRefs.length === 0) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "a draft candidate must reference at least one digest-bound source evidence artifact",
    );
  }
  if (
    derivationMode === "wiki" &&
    (wikiRevision === null || proposerModel === null)
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "a wiki-derived draft requires wikiRevision and proposerModel",
    );
  }
  if (derivationMode !== "wiki" && wikiRevision !== null) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "record-replay and manual-import drafts must not claim a wikiRevision",
    );
  }
  return {
    schema: SKILL_CANDIDATE_SCHEMA,
    status: SKILL_CANDIDATE_STATUS,
    tenantId,
    skillName: normalizeSkillName(
      ownData(input, "skillName", "candidate input"),
    ),
    parentDigest: normalizeDigest(
      ownData(input, "parentDigest", "candidate input", null) ?? null,
      "parentDigest",
      { nullable: true },
    ),
    contentDigest: contentDigest(content),
    sourceEvidenceRefs,
    derivationMode,
    wikiRevision,
    proposerModel,
    dependencyLock,
    dependencyLockDigest: dependencyLock.dependencyLockDigest,
    runtimeManifest,
    runtimeManifestDigest: runtimeManifest.runtimeManifestDigest,
    targetMatrix,
    targetMatrixRoot: targetMatrix.targetMatrixRoot,
    targetRuntimes: normalizeUniqueStringList(
      [...targetMatrix.targetRuntimes],
      "targetRuntimes",
      MAX_TARGET_RUNTIMES,
    ),
    requestedCapabilities: normalizeUniqueStringList(
      ownData(input, "requestedCapabilities", "candidate input", []),
      "requestedCapabilities",
      MAX_REQUESTED_CAPABILITIES,
    ),
    evalRunId,
    contentType: SKILL_CANDIDATE_CONTENT_TYPE,
    content,
  };
}

/** Verify the exact historical v1 draft before any tenant-scoped migration. */
export function verifyLegacySkillCandidateDraft(candidate) {
  assertDataRecord(candidate, LEGACY_CANDIDATE_KEYS, "legacy candidate", {
    exact: true,
  });
  if (
    ownData(candidate, "schema", "legacy candidate") !==
      LEGACY_SKILL_CANDIDATE_SCHEMA ||
    ownData(candidate, "status", "legacy candidate") !==
      SKILL_CANDIDATE_STATUS ||
    ownData(candidate, "contentType", "legacy candidate") !==
      SKILL_CANDIDATE_CONTENT_TYPE
  ) {
    throw migrationRequired(
      "legacy candidate schema, status, or content type is invalid",
    );
  }
  const evalRunId = ownData(candidate, "evalRunId", "legacy candidate");
  if (evalRunId !== null) {
    throw migrationRequired("legacy draft candidate cannot carry evalRunId");
  }
  const content = normalizeContent(
    ownData(candidate, "content", "legacy candidate"),
  );
  const sourceEvidenceRefs = normalizeSourceEvidenceRefs(
    ownData(candidate, "sourceEvidenceRefs", "legacy candidate"),
  );
  const derivationMode = normalizeDerivationMode(
    ownData(candidate, "derivationMode", "legacy candidate"),
  );
  const wikiRevision = normalizeNullableReference(
    ownData(candidate, "wikiRevision", "legacy candidate"),
    "wikiRevision",
  );
  const proposerModel = normalizeProposerModel(
    ownData(candidate, "proposerModel", "legacy candidate"),
  );
  if (sourceEvidenceRefs.length === 0) {
    throw migrationRequired("legacy candidate has no source evidence");
  }
  if (
    derivationMode === "wiki" &&
    (wikiRevision === null || proposerModel === null)
  ) {
    throw migrationRequired(
      "legacy wiki candidate is missing its revision or proposer",
    );
  }
  if (derivationMode !== "wiki" && wikiRevision !== null) {
    throw migrationRequired("legacy non-wiki candidate claims a wiki revision");
  }
  const core = {
    schema: LEGACY_SKILL_CANDIDATE_SCHEMA,
    status: SKILL_CANDIDATE_STATUS,
    skillName: normalizeSkillName(
      ownData(candidate, "skillName", "legacy candidate"),
    ),
    parentDigest: normalizeDigest(
      ownData(candidate, "parentDigest", "legacy candidate"),
      "parentDigest",
      { nullable: true },
    ),
    contentDigest: contentDigest(content),
    sourceEvidenceRefs,
    derivationMode,
    wikiRevision,
    proposerModel,
    targetRuntimes: normalizeUniqueStringList(
      ownData(candidate, "targetRuntimes", "legacy candidate"),
      "targetRuntimes",
      MAX_TARGET_RUNTIMES,
    ),
    requestedCapabilities: normalizeUniqueStringList(
      ownData(candidate, "requestedCapabilities", "legacy candidate"),
      "requestedCapabilities",
      MAX_REQUESTED_CAPABILITIES,
    ),
    evalRunId: null,
    contentType: SKILL_CANDIDATE_CONTENT_TYPE,
    content,
  };
  const normalized = deepFreeze({
    candidateId: domainDigest(LEGACY_CANDIDATE_DIGEST_DOMAIN, core),
    ...core,
  });
  if (
    ownData(candidate, "candidateId", "legacy candidate") !==
      normalized.candidateId ||
    ownData(candidate, "contentDigest", "legacy candidate") !==
      normalized.contentDigest ||
    canonicalJson(candidate) !== canonicalJson(normalized)
  ) {
    throw migrationRequired(
      "legacy candidate bytes or digests are not canonical",
      {
        legacyCandidateId: ownData(
          candidate,
          "candidateId",
          "legacy candidate",
        ),
      },
    );
  }
  return normalized;
}

/** Build the only artifact shape accepted by the candidate registry. */
export function buildSkillCandidateDraft(input, verificationContext) {
  const core = candidateCore(input, verificationContext);
  const candidate = deepFreeze({
    candidateId: candidateDigest(core),
    ...core,
  });
  serializeCandidate(candidate);
  return candidate;
}

/** Recompute every derived field and reject non-canonical candidate objects. */
export function verifySkillCandidateDraft(candidate, verificationContext) {
  assertPlainObject(candidate, "candidate artifact");
  const schema = ownData(candidate, "schema", "candidate artifact");
  if (schema === LEGACY_SKILL_CANDIDATE_SCHEMA) {
    throw migrationRequired(
      "legacy SkillCandidate v1 requires explicit tenant-scoped migration",
    );
  }
  assertDataRecord(candidate, CANDIDATE_KEYS, "candidate artifact", {
    exact: true,
  });
  if (
    schema !== SKILL_CANDIDATE_SCHEMA ||
    ownData(candidate, "status", "candidate artifact") !==
      SKILL_CANDIDATE_STATUS ||
    ownData(candidate, "contentType", "candidate artifact") !==
      SKILL_CANDIDATE_CONTENT_TYPE
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate artifact schema, status, or content type is invalid",
    );
  }
  const targetMatrix = ownData(candidate, "targetMatrix", "candidate artifact");
  assertPlainObject(targetMatrix, "candidate artifact.targetMatrix");
  const admissionContext =
    verificationContext === undefined
      ? {
          expectedEnvironmentBindings: ownData(
            targetMatrix,
            "cells",
            "candidate artifact.targetMatrix",
          ),
          expectedTargetMatrixRoot: ownData(
            targetMatrix,
            "targetMatrixRoot",
            "candidate artifact.targetMatrix",
          ),
        }
      : verificationContext;
  const normalized = buildSkillCandidateDraft(
    {
      tenantId: ownData(candidate, "tenantId", "candidate artifact"),
      skillName: ownData(candidate, "skillName", "candidate artifact"),
      parentDigest: ownData(candidate, "parentDigest", "candidate artifact"),
      sourceEvidenceRefs: ownData(
        candidate,
        "sourceEvidenceRefs",
        "candidate artifact",
      ),
      derivationMode: ownData(
        candidate,
        "derivationMode",
        "candidate artifact",
      ),
      wikiRevision: ownData(candidate, "wikiRevision", "candidate artifact"),
      proposerModel: ownData(candidate, "proposerModel", "candidate artifact"),
      requestedCapabilities: ownData(
        candidate,
        "requestedCapabilities",
        "candidate artifact",
      ),
      evalRunId: ownData(candidate, "evalRunId", "candidate artifact"),
      content: ownData(candidate, "content", "candidate artifact"),
      dependencyLock: ownData(
        candidate,
        "dependencyLock",
        "candidate artifact",
      ),
      runtimeManifest: ownData(
        candidate,
        "runtimeManifest",
        "candidate artifact",
      ),
      targetMatrix,
    },
    admissionContext,
  );
  normalizeCandidateId(ownData(candidate, "candidateId", "candidate artifact"));
  normalizeDigest(
    ownData(candidate, "contentDigest", "candidate artifact"),
    "contentDigest",
  );
  normalizeDigest(
    ownData(candidate, "dependencyLockDigest", "candidate artifact"),
    "dependencyLockDigest",
  );
  normalizeDigest(
    ownData(candidate, "runtimeManifestDigest", "candidate artifact"),
    "runtimeManifestDigest",
  );
  normalizeDigest(
    ownData(candidate, "targetMatrixRoot", "candidate artifact"),
    "targetMatrixRoot",
  );
  normalizeUniqueStringList(
    ownData(candidate, "targetRuntimes", "candidate artifact"),
    "targetRuntimes",
    MAX_TARGET_RUNTIMES,
  );
  if (
    ownData(candidate, "candidateId", "candidate artifact") !==
      normalized.candidateId ||
    !serializeCandidate(candidate).equals(serializeCandidate(normalized))
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate artifact digest verification failed",
    );
  }
  return normalized;
}

function serializeCandidate(candidate) {
  const canonicalBytes = canonicalByteLength(candidate);
  if (canonicalBytes >= SKILL_CANDIDATE_MAX_ARTIFACT_BYTES) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `candidate artifact exceeds ${SKILL_CANDIDATE_MAX_ARTIFACT_BYTES} bytes`,
    );
  }
  const bytes = Buffer.from(`${canonicalJson(candidate)}\n`, "utf8");
  if (bytes.length > SKILL_CANDIDATE_MAX_ARTIFACT_BYTES) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `candidate artifact exceeds ${SKILL_CANDIDATE_MAX_ARTIFACT_BYTES} bytes`,
    );
  }
  return bytes;
}

function normalizeCandidateId(value) {
  return normalizeDigest(value, "candidateId");
}

function entryIdentity(stat) {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

function realpath(fsImpl, value) {
  const implementation = fsImpl.realpathSync?.native || fsImpl.realpathSync;
  if (typeof implementation !== "function") {
    throw registryError(
      "SKILL_CANDIDATE_STORE_UNSAFE",
      "filesystem realpath support is unavailable",
    );
  }
  return path.resolve(implementation(value));
}

function samePath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
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

function fsyncDirectory(fsImpl, directory) {
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(directory, "r");
    fsImpl.fsyncSync(descriptor);
    return true;
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)
    ) {
      return false;
    }
    throw error;
  } finally {
    if (descriptor !== null) fsImpl.closeSync(descriptor);
  }
}

export function deriveSkillCandidateTenantKey(tenantId) {
  const normalized = normalizeTenantId(tenantId);
  return crypto
    .createHash("sha256")
    .update(TENANT_KEY_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}

function buildTenantMarker(tenantId, tenantKey) {
  const core = {
    schema: SKILL_CANDIDATE_TENANT_MARKER_SCHEMA,
    component: TENANT_MARKER_COMPONENT,
    tenantId,
    tenantKey,
  };
  return deepFreeze({
    ...core,
    markerDigest: domainDigest(TENANT_MARKER_DIGEST_DOMAIN, core),
  });
}

function serializeTenantMarker(marker) {
  const bytes = Buffer.from(`${canonicalJson(marker)}\n`, "utf8");
  if (bytes.length <= 1 || bytes.length > MAX_TENANT_MARKER_BYTES) {
    throw registryError(
      "SKILL_CANDIDATE_STORE_UNSAFE",
      "candidate tenant marker exceeds its byte budget",
    );
  }
  return bytes;
}

function verifyTenantMarker(value, expectedTenantId, expectedTenantKey) {
  try {
    assertDataRecord(value, TENANT_MARKER_KEYS, "candidate tenant marker", {
      exact: true,
    });
    const schema = ownData(value, "schema", "candidate tenant marker");
    const component = ownData(value, "component", "candidate tenant marker");
    const tenantId = normalizeTenantId(
      ownData(value, "tenantId", "candidate tenant marker"),
      "candidate tenant marker tenantId",
    );
    const tenantKey = ownData(value, "tenantKey", "candidate tenant marker");
    if (
      schema !== SKILL_CANDIDATE_TENANT_MARKER_SCHEMA ||
      component !== TENANT_MARKER_COMPONENT ||
      typeof tenantKey !== "string" ||
      !TENANT_KEY_PATTERN.test(tenantKey)
    ) {
      throw new Error("marker contract mismatch");
    }
    const normalized = buildTenantMarker(tenantId, tenantKey);
    if (
      ownData(value, "markerDigest", "candidate tenant marker") !==
        normalized.markerDigest ||
      tenantId !== expectedTenantId ||
      tenantKey !== expectedTenantKey ||
      tenantKey !== deriveSkillCandidateTenantKey(tenantId)
    ) {
      throw new Error("marker binding mismatch");
    }
    return normalized;
  } catch (cause) {
    if (
      cause instanceof SkillCandidateRegistryError &&
      cause.code === "SKILL_CANDIDATE_STORE_UNSAFE"
    ) {
      throw cause;
    }
    throw registryError(
      "SKILL_CANDIDATE_STORE_UNSAFE",
      "candidate tenant marker is invalid or belongs to another tenant",
      { cause },
    );
  }
}

function lstatOrNull(fsImpl, target) {
  try {
    return fsImpl.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeRegistryOptions(options) {
  assertDataRecord(
    options,
    REGISTRY_OPTION_KEYS,
    "candidate registry options",
    {
      required: new Set(["targetMatrixAdmissionAuthority", "tenantId"]),
    },
  );
  const tenantId = normalizeTenantId(
    ownData(options, "tenantId", "candidate registry options"),
  );
  const rootDir = ownData(
    options,
    "rootDir",
    "candidate registry options",
    path.join(getHomeDir(), "evolution", "registry", "candidates"),
  );
  if (typeof rootDir !== "string" || rootDir.length < 1) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate registry rootDir must be a non-empty path string",
    );
  }
  const secure = ownData(options, "secure", "candidate registry options", true);
  const fsImpl = ownData(options, "fsImpl", "candidate registry options", fs);
  const randomToken = ownData(
    options,
    "randomToken",
    "candidate registry options",
    () => crypto.randomBytes(16).toString("hex"),
  );
  const targetMatrixAdmissionAuthority =
    normalizeTargetMatrixAdmissionAuthority(
      ownData(
        options,
        "targetMatrixAdmissionAuthority",
        "candidate registry options",
      ),
    );
  rejectProxy(fsImpl, "candidate registry fsImpl");
  rejectProxy(randomToken, "candidate registry randomToken");
  if (
    (secure !== true && secure !== false) ||
    !fsImpl ||
    typeof fsImpl !== "object" ||
    typeof randomToken !== "function"
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate registry options are invalid",
    );
  }
  return {
    fsImpl,
    randomToken,
    rootDir,
    secure,
    targetMatrixAdmissionAuthority,
    tenantId,
  };
}

/**
 * Immutable, candidate-only Skill artifact storage.
 *
 * This class deliberately has no active pointer or promotion API. A later
 * promotion controller can consume verified drafts through read().
 */
export class SkillCandidateRegistry {
  constructor(options) {
    const {
      fsImpl,
      randomToken,
      rootDir,
      secure,
      targetMatrixAdmissionAuthority,
      tenantId,
    } = normalizeRegistryOptions(options);
    this._fs = fsImpl;
    this._secure = secure;
    this._randomToken = randomToken;
    this._resolveTargetMatrixAdmission = targetMatrixAdmissionAuthority.resolve;
    this.targetMatrixAdmissionAuthority =
      targetMatrixAdmissionAuthority.descriptor;
    this.tenantId = tenantId;
    this.tenantKey = deriveSkillCandidateTenantKey(tenantId);
    const requestedBase = path.resolve(rootDir);
    try {
      const base = this._initializeDirectory(requestedBase, {
        recursive: true,
      });
      this.baseDir = base.path;
      this._assertNoLegacyBaseLayout();
      const tenants = this._initializeDirectory(
        path.join(this.baseDir, "tenants"),
        { parent: base },
      );
      const tenantRoot = this._initializeDirectory(
        path.join(tenants.path, this.tenantKey),
        { parent: tenants },
      );
      this.rootDir = tenantRoot.path;
      this._directories = deepFreeze({ base, tenantRoot, tenants });
      this._assertDirectories();
      this._markerPath = path.join(this.rootDir, TENANT_MARKER_FILE);
      this._initializeTenantMarker();
      this._assertBoundary();
      this._assertNoMixedTenantArtifacts();
    } catch (error) {
      if (error instanceof SkillCandidateRegistryError) throw error;
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry root could not be initialized safely",
        { cause: error },
      );
    }
    Object.freeze(this);
  }

  _initializeDirectory(
    requestedPath,
    { parent = null, recursive = false } = {},
  ) {
    const before = lstatOrNull(this._fs, requestedPath);
    if (before && (!before.isDirectory() || before.isSymbolicLink())) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry directory path is unsafe",
      );
    }
    if (!before) {
      this._fs.mkdirSync(requestedPath, { recursive, mode: 0o700 });
    }
    let stat = this._fs.lstatSync(requestedPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry directory must be non-symlink",
      );
    }
    const capturedIdentity = entryIdentity(stat);
    const canonical = realpath(this._fs, requestedPath);
    const canonicalStat = this._fs.lstatSync(canonical);
    const canonicalParent = realpath(this._fs, path.dirname(requestedPath));
    const expectedCanonical = path.join(
      canonicalParent,
      path.basename(requestedPath),
    );
    if (
      !canonicalStat.isDirectory() ||
      canonicalStat.isSymbolicLink() ||
      entryIdentity(canonicalStat) !== capturedIdentity ||
      !samePath(canonical, expectedCanonical) ||
      (parent &&
        (!isContained(parent.path, canonical) ||
          !samePath(path.dirname(canonical), parent.path)))
    ) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry directory escaped its canonical parent",
      );
    }
    if (this._secure) {
      ensurePrivateDirectory(canonical, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      });
      stat = this._fs.lstatSync(canonical);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        entryIdentity(stat) !== capturedIdentity ||
        !samePath(realpath(this._fs, canonical), canonical)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate registry directory changed during permission hardening",
        );
      }
    }
    return deepFreeze({ path: canonical, identity: capturedIdentity });
  }

  _assertNoLegacyBaseLayout() {
    const legacyName = this._readDirectoryEntryNamesBounded(
      this.baseDir,
      "candidate registry base",
    ).find(
      (name) =>
        CANDIDATE_FILE_PATTERN.test(name) ||
        name === TENANT_MARKER_FILE ||
        name.startsWith(".candidate-"),
    );
    if (legacyName) {
      throw migrationRequired(
        "legacy unscoped SkillCandidate storage requires explicit migration",
        { path: path.join(this.baseDir, legacyName) },
      );
    }
  }

  _readDirectoryEntryNamesBounded(directory, label) {
    if (typeof this._fs.opendirSync !== "function") {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        `${label} requires bounded synchronous directory enumeration`,
      );
    }
    let handle = null;
    let enumerationError = null;
    const names = [];
    try {
      handle = this._fs.opendirSync(directory);
      if (
        !handle ||
        typeof handle.readSync !== "function" ||
        typeof handle.closeSync !== "function"
      ) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          `${label} returned an unsafe directory handle`,
        );
      }
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        if (!entry || typeof entry.name !== "string" || entry.name.length < 1) {
          throw registryError(
            "SKILL_CANDIDATE_STORE_UNSAFE",
            `${label} returned an invalid directory entry`,
          );
        }
        if (names.length >= SKILL_CANDIDATE_TENANT_SCAN_MAX_ENTRIES) {
          throw tenantScanLimit(
            `${label} contains more than ${SKILL_CANDIDATE_TENANT_SCAN_MAX_ENTRIES} entries`,
          );
        }
        names.push(entry.name);
      }
    } catch (cause) {
      enumerationError =
        cause instanceof SkillCandidateRegistryError
          ? cause
          : registryError(
              "SKILL_CANDIDATE_STORE_UNSAFE",
              `${label} could not be enumerated safely`,
              { cause },
            );
    }
    if (handle !== null && typeof handle.closeSync === "function") {
      try {
        handle.closeSync();
      } catch (cause) {
        enumerationError = registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          `${label} directory handle could not be closed safely`,
          { cause, enumerationError },
        );
      }
    }
    if (enumerationError !== null) throw enumerationError;
    return names;
  }

  _assertDirectories() {
    try {
      for (const entry of Object.values(this._directories)) {
        const stat = this._fs.lstatSync(entry.path);
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          entryIdentity(stat) !== entry.identity ||
          !samePath(realpath(this._fs, entry.path), entry.path)
        ) {
          throw registryError(
            "SKILL_CANDIDATE_STORE_UNSAFE",
            "candidate registry directory changed or became unsafe",
          );
        }
      }
      if (
        !samePath(path.dirname(this._directories.tenants.path), this.baseDir) ||
        !samePath(path.dirname(this.rootDir), this._directories.tenants.path) ||
        !isContained(this.baseDir, this.rootDir)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate registry directory topology changed",
        );
      }
    } catch (error) {
      if (error instanceof SkillCandidateRegistryError) throw error;
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry directory boundary is unavailable",
        { cause: error },
      );
    }
  }

  _token(code) {
    const token = String(this._randomToken());
    if (!/^[a-f0-9]{32}$/u.test(token)) {
      throw registryError(code, "candidate registry random token is invalid");
    }
    return token;
  }

  _initializeTenantMarker() {
    const existing = lstatOrNull(this._fs, this._markerPath);
    if (existing) {
      const verified = this._readAndVerifyTenantMarker();
      this._markerIdentity = verified.identity;
      return;
    }
    const entries = this._readDirectoryEntryNamesBounded(
      this.rootDir,
      "candidate tenant root",
    );
    if (entries.length !== 0) {
      throw migrationRequired(
        "unmarked or mixed-schema tenant candidate storage requires explicit migration",
      );
    }
    const marker = buildTenantMarker(this.tenantId, this.tenantKey);
    const bytes = serializeTenantMarker(marker);
    const temporaryPath = path.join(
      this.rootDir,
      `.tenant-${process.pid}-${this._token("SKILL_CANDIDATE_STORE_UNSAFE")}.tmp`,
    );
    let descriptor = null;
    let temporaryExists = false;
    try {
      descriptor = this._fs.openSync(temporaryPath, "wx", 0o600);
      temporaryExists = true;
      this._fs.writeFileSync(descriptor, bytes);
      this._fs.fsyncSync(descriptor);
      const written = this._fs.fstatSync(descriptor);
      if (
        !written.isFile() ||
        Number(written.nlink) !== 1 ||
        written.size !== bytes.length
      ) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate tenant marker temporary file is unsafe",
        );
      }
      const writtenIdentity = entryIdentity(written);
      this._fs.closeSync(descriptor);
      descriptor = null;
      if (this._secure) {
        ensurePrivateFile(temporaryPath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      }
      const staged = this._fs.lstatSync(temporaryPath);
      if (
        !staged.isFile() ||
        staged.isSymbolicLink() ||
        Number(staged.nlink) !== 1 ||
        staged.size !== bytes.length ||
        entryIdentity(staged) !== writtenIdentity ||
        !samePath(realpath(this._fs, temporaryPath), temporaryPath)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate tenant marker changed before publication",
        );
      }
      try {
        this._fs.linkSync(temporaryPath, this._markerPath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        this._fs.unlinkSync(temporaryPath);
        temporaryExists = false;
        const verified = this._readAndVerifyTenantMarker();
        this._markerIdentity = verified.identity;
        return;
      }
      const linked = this._fs.lstatSync(this._markerPath);
      if (
        !linked.isFile() ||
        linked.isSymbolicLink() ||
        Number(linked.nlink) !== 2 ||
        entryIdentity(linked) !== writtenIdentity
      ) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate tenant marker publication was unsafe",
        );
      }
      this._fs.unlinkSync(temporaryPath);
      temporaryExists = false;
      fsyncDirectory(this._fs, this.rootDir);
      const verified = this._readAndVerifyTenantMarker();
      this._markerIdentity = verified.identity;
    } finally {
      if (descriptor !== null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // The marker was not published through the authoritative path yet.
        }
      }
      if (temporaryExists) {
        try {
          this._fs.unlinkSync(temporaryPath);
        } catch {
          // Fail closed on the next open if a hard-linked marker remains.
        }
      }
    }
  }

  _readBoundedRegularFile(filePath, maximum, code, label) {
    let descriptor = null;
    try {
      const before = this._fs.lstatSync(filePath);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        Number(before.nlink) !== 1 ||
        before.size <= 0 ||
        before.size > maximum ||
        !samePath(realpath(this._fs, filePath), filePath)
      ) {
        throw registryError(
          code,
          `${label} must be a bounded single-link regular file`,
        );
      }
      descriptor = this._fs.openSync(
        filePath,
        this._fs.constants.O_RDONLY | (this._fs.constants.O_NOFOLLOW || 0),
      );
      const opened = this._fs.fstatSync(descriptor);
      if (
        !opened.isFile() ||
        Number(opened.nlink) !== 1 ||
        entryIdentity(opened) !== entryIdentity(before) ||
        opened.size !== before.size
      ) {
        throw registryError(code, `${label} changed while it was opened`);
      }
      const bytes = this._fs.readFileSync(descriptor);
      const after = this._fs.fstatSync(descriptor);
      const afterPath = this._fs.lstatSync(filePath);
      if (
        Number(after.nlink) !== 1 ||
        entryIdentity(after) !== entryIdentity(opened) ||
        after.size !== opened.size ||
        bytes.length !== opened.size ||
        !afterPath.isFile() ||
        afterPath.isSymbolicLink() ||
        Number(afterPath.nlink) !== 1 ||
        entryIdentity(afterPath) !== entryIdentity(opened) ||
        !samePath(realpath(this._fs, filePath), filePath)
      ) {
        throw registryError(code, `${label} changed while it was read`);
      }
      return { bytes, identity: entryIdentity(opened) };
    } finally {
      if (descriptor !== null) this._fs.closeSync(descriptor);
    }
  }

  _readAndVerifyTenantMarker() {
    let stored;
    try {
      stored = this._readBoundedRegularFile(
        this._markerPath,
        MAX_TENANT_MARKER_BYTES,
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate tenant marker",
      );
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        stored.bytes,
      );
      const marker = verifyTenantMarker(
        JSON.parse(text),
        this.tenantId,
        this.tenantKey,
      );
      if (!serializeTenantMarker(marker).equals(stored.bytes)) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate tenant marker serialization is not canonical",
        );
      }
      return { identity: stored.identity, marker };
    } catch (error) {
      if (error instanceof SkillCandidateRegistryError) throw error;
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate tenant marker could not be verified",
        { cause: error },
      );
    }
  }

  _assertBoundary() {
    this._assertDirectories();
    const verified = this._readAndVerifyTenantMarker();
    if (
      this._markerIdentity !== undefined &&
      verified.identity !== this._markerIdentity
    ) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate tenant marker identity changed",
      );
    }
    this._assertDirectories();
  }

  _assertNoMixedTenantArtifacts() {
    this._assertBoundary();
    const names = this._readDirectoryEntryNamesBounded(
      this.rootDir,
      "candidate tenant scan",
    );
    const budget = { bytes: 0, nodes: 0 };
    for (const name of names) {
      if (name === TENANT_MARKER_FILE) continue;
      if (name.startsWith(".candidate-")) {
        throw migrationRequired(
          "legacy or interrupted candidate temporary storage requires explicit migration",
          { path: path.join(this.rootDir, name) },
        );
      }
      const match = CANDIDATE_FILE_PATTERN.exec(name);
      if (!match) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate tenant root contains an unexpected entry",
          { path: path.join(this.rootDir, name) },
        );
      }
      const filePath = path.join(this.rootDir, name);
      let bytes;
      let parsed;
      try {
        bytes = this._readBoundedRegularFile(
          filePath,
          SKILL_CANDIDATE_MAX_ARTIFACT_BYTES,
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "stored candidate artifact",
        ).bytes;
        budget.bytes += bytes.length;
        if (budget.bytes > SKILL_CANDIDATE_TENANT_SCAN_MAX_BYTES) {
          throw tenantScanLimit(
            "candidate tenant scan exceeded its aggregate byte budget",
            { path: filePath },
          );
        }
        parsed = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch (cause) {
        if (cause instanceof SkillCandidateRegistryError) throw cause;
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "stored candidate artifact is not bounded UTF-8 JSON",
          { path: filePath, cause },
        );
      }
      chargeTenantScanNodes(parsed, budget, filePath);
      const schema =
        parsed && typeof parsed === "object"
          ? Object.getOwnPropertyDescriptor(parsed, "schema")?.value
          : undefined;
      if (schema === LEGACY_SKILL_CANDIDATE_SCHEMA) {
        throw migrationRequired(
          "legacy Candidate v1 requires explicit tenant-scoped migration",
          { path: filePath, schema },
        );
      }
      if (schema !== SKILL_CANDIDATE_SCHEMA) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "stored candidate artifact has a missing or unknown schema",
          { path: filePath, schema },
        );
      }
      let candidate;
      try {
        candidate = verifySkillCandidateDraft(parsed);
      } catch (cause) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "stored Candidate v2 artifact is corrupt",
          { path: filePath, cause },
        );
      }
      if (
        candidate.tenantId !== this.tenantId ||
        candidate.candidateId.slice("sha256:".length) !== match[1] ||
        !serializeCandidate(candidate).equals(bytes)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "stored Candidate v2 artifact does not match its tenant, filename, or bytes",
          { path: filePath },
        );
      }
    }
    this._assertBoundary();
    return names;
  }

  _candidatePath(candidateId) {
    const normalizedId = normalizeCandidateId(candidateId);
    const filePath = path.resolve(
      this.rootDir,
      `${normalizedId.slice("sha256:".length)}.json`,
    );
    if (!isContained(this.rootDir, filePath) || filePath === this.rootDir) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate path escaped the registry root",
      );
    }
    return filePath;
  }

  _readBytes(filePath) {
    this._assertBoundary();
    try {
      return this._readBoundedRegularFile(
        filePath,
        SKILL_CANDIDATE_MAX_ARTIFACT_BYTES,
        "SKILL_CANDIDATE_CORRUPT",
        "candidate artifact",
      ).bytes;
    } finally {
      this._assertBoundary();
    }
  }

  _resolveAdmissionContext(input) {
    const artifacts = buildTargetMatrixAdmissionRequest(input);
    if (artifacts.request.tenantId !== this.tenantId) {
      throw registryError(
        "SKILL_CANDIDATE_TENANT_MISMATCH",
        "candidate admission request does not match the registry tenant",
      );
    }
    let resolution;
    try {
      resolution = this._resolveTargetMatrixAdmission(artifacts.request);
    } catch (cause) {
      throw registryError(
        "SKILL_CANDIDATE_ADMISSION_REJECTED",
        "target matrix admission authority rejected the candidate",
        { cause },
      );
    }
    return verifyTargetMatrixAdmissionResolution(
      resolution,
      this.targetMatrixAdmissionAuthority,
      artifacts.request,
      artifacts,
    );
  }

  migrateLegacy(legacyCandidate, executionArtifacts, migrationAuthority) {
    if (arguments.length !== 3) {
      throw migrationRequired(
        "legacy migration requires candidate, execution artifacts, and a durable audit authority",
      );
    }
    const legacy = verifyLegacySkillCandidateDraft(legacyCandidate);
    assertDataRecord(
      executionArtifacts,
      MIGRATION_EXECUTION_KEYS,
      "candidate migration execution artifacts",
      { exact: true },
    );
    assertDataRecord(
      migrationAuthority,
      MIGRATION_AUTHORITY_KEYS,
      "candidate migration authority",
      { exact: true },
    );
    if (
      ownData(migrationAuthority, "schema", "candidate migration authority") !==
        SKILL_CANDIDATE_MIGRATION_AUTHORITY_SCHEMA ||
      ownData(migrationAuthority, "trust", "candidate migration authority") !==
        "trusted"
    ) {
      throw migrationRequired(
        "candidate migration authority is not trusted or has an unsupported schema",
      );
    }
    const authorityId = normalizeNamespacedId(
      ownData(
        migrationAuthority,
        "authorityId",
        "candidate migration authority",
      ),
      "migrationAuthority.authorityId",
    );
    const handlerArtifactDigest = normalizeDigest(
      ownData(
        migrationAuthority,
        "handlerArtifactDigest",
        "candidate migration authority",
      ),
      "migrationAuthority.handlerArtifactDigest",
    );
    const audit = ownData(
      migrationAuthority,
      "audit",
      "candidate migration authority",
    );
    if (typeof audit !== "function") {
      throw migrationRequired(
        "candidate migration audit port must be a function",
      );
    }

    const dependencyLock = ownData(
      executionArtifacts,
      "dependencyLock",
      "candidate migration execution artifacts",
    );
    const runtimeManifest = ownData(
      executionArtifacts,
      "runtimeManifest",
      "candidate migration execution artifacts",
    );
    const targetMatrix = ownData(
      executionArtifacts,
      "targetMatrix",
      "candidate migration execution artifacts",
    );
    assertPlainObject(targetMatrix, "candidate migration targetMatrix");
    const targetRuntimes = normalizeUniqueStringList(
      ownData(
        targetMatrix,
        "targetRuntimes",
        "candidate migration targetMatrix",
      ),
      "targetMatrix.targetRuntimes",
      MAX_TARGET_RUNTIMES,
    );
    if (
      canonicalJson(targetRuntimes) !== canonicalJson(legacy.targetRuntimes)
    ) {
      throw migrationRequired(
        "candidate migration target matrix changes the legacy runtime scope",
        { legacyCandidateId: legacy.candidateId },
      );
    }

    const publication = this.create({
      tenantId: this.tenantId,
      skillName: legacy.skillName,
      parentDigest: legacy.parentDigest,
      sourceEvidenceRefs: legacy.sourceEvidenceRefs,
      derivationMode: legacy.derivationMode,
      wikiRevision: legacy.wikiRevision,
      proposerModel: legacy.proposerModel,
      requestedCapabilities: legacy.requestedCapabilities,
      evalRunId: null,
      content: legacy.content,
      dependencyLock,
      runtimeManifest,
      targetMatrix,
    });
    const candidate = publication.candidate;
    const migrationCore = deepFreeze({
      authorityId,
      candidateId: candidate.candidateId,
      contentDigest: candidate.contentDigest,
      dependencyLockDigest: candidate.dependencyLockDigest,
      handlerArtifactDigest,
      legacyArtifactDigest: sha256(
        Buffer.from(`${canonicalJson(legacy)}\n`, "utf8"),
      ),
      legacyCandidateId: legacy.candidateId,
      runtimeManifestDigest: candidate.runtimeManifestDigest,
      schema: SKILL_CANDIDATE_MIGRATION_RECORD_SCHEMA,
      targetMatrixRoot: candidate.targetMatrixRoot,
      tenantId: this.tenantId,
      trust: "trusted",
    });
    const missingBindings = Object.entries(migrationCore)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key);
    if (missingBindings.length > 0) {
      throw migrationRequired(
        "candidate migration could not derive a complete audit binding",
        { legacyCandidateId: legacy.candidateId, missingBindings },
      );
    }
    const migration = deepFreeze({
      ...migrationCore,
      migrationDigest: domainDigest(CANDIDATE_MIGRATION_DOMAIN, migrationCore),
    });
    let receipt;
    try {
      receipt = audit(migration);
    } catch (cause) {
      throw registryError(
        "SKILL_CANDIDATE_MIGRATION_AUDIT_FAILED",
        "candidate migration audit authority failed after draft publication",
        {
          candidateId: candidate.candidateId,
          cause,
          commitState: "candidate-only",
          migrationDigest: migration.migrationDigest,
        },
      );
    }
    if (utilTypes.isPromise(receipt)) {
      throw registryError(
        "SKILL_CANDIDATE_MIGRATION_AUDIT_FAILED",
        "candidate migration audit authority must be synchronous",
        {
          candidateId: candidate.candidateId,
          commitState: "candidate-only",
          migrationDigest: migration.migrationDigest,
        },
      );
    }
    assertDataRecord(
      receipt,
      MIGRATION_RECEIPT_KEYS,
      "candidate migration receipt",
      { exact: true },
    );
    const normalizedReceipt = deepFreeze({
      authenticated: ownData(
        receipt,
        "authenticated",
        "candidate migration receipt",
      ),
      authorityId: normalizeNamespacedId(
        ownData(receipt, "authorityId", "candidate migration receipt"),
        "migrationReceipt.authorityId",
      ),
      durable: ownData(receipt, "durable", "candidate migration receipt"),
      handlerArtifactDigest: normalizeDigest(
        ownData(
          receipt,
          "handlerArtifactDigest",
          "candidate migration receipt",
        ),
        "migrationReceipt.handlerArtifactDigest",
      ),
      migrationDigest: normalizeDigest(
        ownData(receipt, "migrationDigest", "candidate migration receipt"),
        "migrationReceipt.migrationDigest",
      ),
      receiptDigest: normalizeDigest(
        ownData(receipt, "receiptDigest", "candidate migration receipt"),
        "migrationReceipt.receiptDigest",
      ),
      schema: ownData(receipt, "schema", "candidate migration receipt"),
      trust: ownData(receipt, "trust", "candidate migration receipt"),
    });
    if (
      normalizedReceipt.schema !== SKILL_CANDIDATE_MIGRATION_RECEIPT_SCHEMA ||
      normalizedReceipt.authenticated !== true ||
      normalizedReceipt.durable !== true ||
      normalizedReceipt.trust !== "trusted" ||
      normalizedReceipt.authorityId !== authorityId ||
      normalizedReceipt.handlerArtifactDigest !== handlerArtifactDigest ||
      normalizedReceipt.migrationDigest !== migration.migrationDigest
    ) {
      throw registryError(
        "SKILL_CANDIDATE_MIGRATION_AUDIT_FAILED",
        "candidate migration receipt is not exactly bound and durable",
        {
          candidateId: candidate.candidateId,
          commitState: "candidate-only",
          migrationDigest: migration.migrationDigest,
        },
      );
    }
    return deepFreeze({
      candidate,
      created: publication.created,
      migration,
      receipt: normalizedReceipt,
    });
  }

  migrateLegacyStore(
    sourceRootDir,
    resolveExecutionArtifacts,
    migrationAuthority,
  ) {
    if (
      arguments.length !== 3 ||
      typeof resolveExecutionArtifacts !== "function"
    ) {
      throw migrationRequired(
        "legacy store migration requires one source root, one execution resolver, and one audit authority",
      );
    }
    assertDataRecord(
      migrationAuthority,
      MIGRATION_AUTHORITY_KEYS,
      "candidate migration authority",
      { exact: true },
    );
    const capturedMigrationAuthority = Object.freeze(
      Object.fromEntries(
        [...MIGRATION_AUTHORITY_KEYS].map((key) => [
          key,
          ownData(migrationAuthority, key, "candidate migration authority"),
        ]),
      ),
    );
    const requestedSource = path.resolve(
      normalizeBoundedString(
        sourceRootDir,
        "legacy candidate source root",
        32_768,
      ),
    );
    let sourceRoot;
    let sourceIdentity;
    try {
      const stat = this._fs.lstatSync(requestedSource);
      sourceRoot = realpath(this._fs, requestedSource);
      const canonicalStat = this._fs.lstatSync(sourceRoot);
      const canonicalParent = realpath(this._fs, path.dirname(requestedSource));
      const expectedCanonical = path.join(
        canonicalParent,
        path.basename(requestedSource),
      );
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        !canonicalStat.isDirectory() ||
        canonicalStat.isSymbolicLink() ||
        entryIdentity(canonicalStat) !== entryIdentity(stat) ||
        !samePath(sourceRoot, expectedCanonical) ||
        !samePath(realpath(this._fs, sourceRoot), sourceRoot) ||
        isContained(sourceRoot, this.baseDir) ||
        isContained(this.baseDir, sourceRoot)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
          "legacy source must be a canonical directory independent from the tenant registry",
        );
      }
      sourceIdentity = entryIdentity(stat);
    } catch (cause) {
      if (cause instanceof SkillCandidateRegistryError) throw cause;
      throw registryError(
        "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
        "legacy candidate source root is unavailable or unsafe",
        { cause },
      );
    }
    const assertSourceBoundary = () => {
      const stat = this._fs.lstatSync(sourceRoot);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        entryIdentity(stat) !== sourceIdentity ||
        !samePath(realpath(this._fs, sourceRoot), sourceRoot)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
          "legacy candidate source root changed during migration",
        );
      }
    };

    this._assertBoundary();
    assertSourceBoundary();
    const names = this._readDirectoryEntryNamesBounded(
      sourceRoot,
      "legacy candidate source",
    ).sort(compareStrings);
    const sources = [];
    let totalBytes = 0;
    for (const name of names) {
      assertSourceBoundary();
      const match = CANDIDATE_FILE_PATTERN.exec(name);
      if (!match) {
        throw migrationRequired(
          "legacy candidate source contains a non-candidate entry",
          { path: path.join(sourceRoot, name) },
        );
      }
      const sourcePath = path.resolve(sourceRoot, name);
      if (
        !isContained(sourceRoot, sourcePath) ||
        !samePath(path.dirname(sourcePath), sourceRoot)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
          "legacy candidate source path escaped its root",
        );
      }
      const stored = this._readBoundedRegularFile(
        sourcePath,
        SKILL_CANDIDATE_MAX_ARTIFACT_BYTES,
        "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
        "legacy candidate artifact",
      );
      totalBytes += stored.bytes.length;
      if (totalBytes > SKILL_CANDIDATE_TENANT_SCAN_MAX_BYTES) {
        throw tenantScanLimit(
          "legacy candidate migration exceeded its aggregate byte budget",
          { path: sourcePath },
        );
      }
      let parsed;
      try {
        parsed = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes),
        );
      } catch (cause) {
        throw registryError(
          "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
          "legacy candidate is not bounded UTF-8 JSON",
          { cause, path: sourcePath },
        );
      }
      const legacy = verifyLegacySkillCandidateDraft(parsed);
      const canonicalBytes = Buffer.from(`${canonicalJson(legacy)}\n`, "utf8");
      if (
        legacy.candidateId.slice("sha256:".length) !== match[1] ||
        !stored.bytes.equals(canonicalBytes)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
          "legacy candidate filename or bytes are not content-addressed and canonical",
          { path: sourcePath },
        );
      }
      sources.push(
        Object.freeze({
          bytesDigest: sha256(stored.bytes),
          identity: stored.identity,
          legacy,
          name,
          sourcePath,
        }),
      );
      assertSourceBoundary();
    }

    const entries = [];
    let createdCount = 0;
    for (const source of sources) {
      assertSourceBoundary();
      let executionArtifacts;
      try {
        executionArtifacts = resolveExecutionArtifacts(
          deepFreeze({
            legacyCandidateId: source.legacy.candidateId,
            schema: SKILL_CANDIDATE_STORE_MIGRATION_SCHEMA,
            skillName: source.legacy.skillName,
            targetRuntimes: source.legacy.targetRuntimes,
            tenantId: this.tenantId,
          }),
        );
      } catch (cause) {
        throw registryError(
          "SKILL_CANDIDATE_MIGRATION_EXECUTION_UNAVAILABLE",
          "legacy candidate execution artifacts could not be resolved",
          {
            cause,
            legacyCandidateId: source.legacy.candidateId,
            migratedCount: entries.length,
          },
        );
      }
      if (utilTypes.isPromise(executionArtifacts)) {
        throw registryError(
          "SKILL_CANDIDATE_MIGRATION_EXECUTION_UNAVAILABLE",
          "legacy candidate execution resolver must be synchronous",
          {
            legacyCandidateId: source.legacy.candidateId,
            migratedCount: entries.length,
          },
        );
      }
      const migrated = this.migrateLegacy(
        source.legacy,
        executionArtifacts,
        capturedMigrationAuthority,
      );
      if (migrated.created) createdCount += 1;
      entries.push(
        deepFreeze({
          candidateId: migrated.candidate.candidateId,
          legacyArtifactDigest: migrated.migration.legacyArtifactDigest,
          legacyCandidateId: source.legacy.candidateId,
          migrationDigest: migrated.migration.migrationDigest,
          receiptDigest: migrated.receipt.receiptDigest,
        }),
      );
    }

    for (const source of sources) {
      assertSourceBoundary();
      const current = this._readBoundedRegularFile(
        source.sourcePath,
        SKILL_CANDIDATE_MAX_ARTIFACT_BYTES,
        "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
        "legacy candidate artifact",
      );
      if (
        current.identity !== source.identity ||
        sha256(current.bytes) !== source.bytesDigest
      ) {
        throw registryError(
          "SKILL_CANDIDATE_MIGRATION_SOURCE_UNSAFE",
          "legacy candidate source changed before migration completion",
          {
            legacyCandidateId: source.legacy.candidateId,
            migratedCount: entries.length,
          },
        );
      }
    }
    this._assertBoundary();
    assertSourceBoundary();
    const core = deepFreeze({
      entries,
      migratedCount: entries.length,
      schema: SKILL_CANDIDATE_STORE_MIGRATION_SCHEMA,
      sourceArtifactCount: sources.length,
      tenantId: this.tenantId,
    });
    return deepFreeze({
      ...core,
      createdCount,
      migrationDigest: domainDigest(
        SKILL_CANDIDATE_STORE_MIGRATION_SCHEMA,
        core,
      ),
    });
  }

  create(input) {
    if (arguments.length !== 1) {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        "candidate create accepts only input; admission context is registry-owned",
      );
    }
    this._assertNoMixedTenantArtifacts();
    const verificationContext = this._resolveAdmissionContext(input);
    const candidate = buildSkillCandidateDraft(input, verificationContext);
    if (candidate.tenantId !== this.tenantId) {
      throw registryError(
        "SKILL_CANDIDATE_TENANT_MISMATCH",
        "candidate tenant does not match the registry tenant",
        { candidateTenantId: candidate.tenantId, tenantId: this.tenantId },
      );
    }
    const bytes = serializeCandidate(candidate);
    const filePath = this._candidatePath(candidate.candidateId);
    const token = this._token("SKILL_CANDIDATE_WRITE_FAILED");
    this._assertNoMixedTenantArtifacts();
    const temporaryPath = path.resolve(
      this.rootDir,
      `.candidate-${process.pid}-${token}.tmp`,
    );
    if (!isContained(this.rootDir, temporaryPath)) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate temporary path escaped the registry root",
      );
    }

    let descriptor = null;
    let published = false;
    let observedExisting = false;
    let temporaryExists = false;
    try {
      this._assertBoundary();
      descriptor = this._fs.openSync(temporaryPath, "wx", 0o600);
      temporaryExists = true;
      this._fs.writeFileSync(descriptor, bytes);
      this._fs.fsyncSync(descriptor);
      const written = this._fs.fstatSync(descriptor);
      if (
        !written.isFile() ||
        Number(written.nlink) !== 1 ||
        written.size !== bytes.length
      ) {
        throw registryError(
          "SKILL_CANDIDATE_WRITE_FAILED",
          "candidate temporary artifact was not written completely",
          { candidateId: candidate.candidateId, commitState: "not-committed" },
        );
      }
      const writtenIdentity = entryIdentity(written);
      this._fs.closeSync(descriptor);
      descriptor = null;
      if (this._secure) {
        ensurePrivateFile(temporaryPath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      }
      const staged = this._fs.lstatSync(temporaryPath);
      if (
        !staged.isFile() ||
        staged.isSymbolicLink() ||
        Number(staged.nlink) !== 1 ||
        staged.size !== bytes.length ||
        entryIdentity(staged) !== writtenIdentity ||
        !samePath(realpath(this._fs, temporaryPath), temporaryPath)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_WRITE_FAILED",
          "candidate temporary artifact changed before publication",
          { candidateId: candidate.candidateId, commitState: "not-committed" },
        );
      }
      this._assertBoundary();
      try {
        this._fs.linkSync(temporaryPath, filePath);
        published = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        let existing;
        try {
          existing = this.read(candidate.candidateId);
        } catch (readError) {
          throw registryError(
            "SKILL_CANDIDATE_CONFLICT",
            "candidate digest path already exists but is not the same verified artifact",
            { candidateId: candidate.candidateId, cause: readError },
          );
        }
        if (!serializeCandidate(existing).equals(bytes)) {
          throw registryError(
            "SKILL_CANDIDATE_CONFLICT",
            "candidate digest collision or immutable artifact conflict",
            { candidateId: candidate.candidateId },
          );
        }
        observedExisting = true;
        fsyncDirectory(this._fs, this.rootDir);
        this._assertBoundary();
        return Object.freeze({ candidate: existing, created: false });
      }
      const linked = this._fs.lstatSync(filePath);
      if (
        !linked.isFile() ||
        linked.isSymbolicLink() ||
        Number(linked.nlink) !== 2 ||
        linked.size !== bytes.length ||
        entryIdentity(linked) !== writtenIdentity ||
        !samePath(realpath(this._fs, filePath), filePath)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_COMMIT_UNKNOWN",
          "published candidate artifact has an unsafe identity",
          { candidateId: candidate.candidateId, commitState: "unknown" },
        );
      }
      this._fs.unlinkSync(temporaryPath);
      temporaryExists = false;
      const finalized = this._fs.lstatSync(filePath);
      if (
        !finalized.isFile() ||
        finalized.isSymbolicLink() ||
        Number(finalized.nlink) !== 1 ||
        finalized.size !== bytes.length ||
        entryIdentity(finalized) !== writtenIdentity
      ) {
        throw registryError(
          "SKILL_CANDIDATE_COMMIT_UNKNOWN",
          "candidate artifact did not finalize as a single-link file",
          { candidateId: candidate.candidateId, commitState: "unknown" },
        );
      }
      fsyncDirectory(this._fs, this.rootDir);
      let stored;
      let verified;
      try {
        stored = this._readBoundedRegularFile(
          filePath,
          SKILL_CANDIDATE_MAX_ARTIFACT_BYTES,
          "SKILL_CANDIDATE_COMMIT_UNKNOWN",
          "published candidate artifact",
        );
        verified = verifySkillCandidateDraft(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes),
          ),
        );
      } catch (cause) {
        throw registryError(
          "SKILL_CANDIDATE_COMMIT_UNKNOWN",
          "published candidate artifact failed descriptor-safe verification",
          {
            candidateId: candidate.candidateId,
            commitState: "unknown",
            cause,
          },
        );
      }
      if (
        stored.identity !== writtenIdentity ||
        verified.tenantId !== this.tenantId ||
        verified.candidateId !== candidate.candidateId ||
        !stored.bytes.equals(bytes) ||
        !serializeCandidate(verified).equals(bytes)
      ) {
        throw registryError(
          "SKILL_CANDIDATE_COMMIT_UNKNOWN",
          "published candidate artifact does not exactly match the admitted candidate",
          { candidateId: candidate.candidateId, commitState: "unknown" },
        );
      }
      this._assertBoundary();
      return Object.freeze({ candidate, created: true });
    } catch (error) {
      const mayBeCommitted = published || observedExisting;
      if (error instanceof SkillCandidateRegistryError && !mayBeCommitted) {
        throw error;
      }
      throw registryError(
        mayBeCommitted
          ? "SKILL_CANDIDATE_COMMIT_UNKNOWN"
          : "SKILL_CANDIDATE_WRITE_FAILED",
        mayBeCommitted
          ? "candidate may have been published, but durability could not be confirmed"
          : "candidate artifact could not be published",
        {
          candidateId: candidate.candidateId,
          commitState: mayBeCommitted ? "unknown" : "not-committed",
          cause: error,
        },
      );
    } finally {
      if (descriptor !== null) {
        try {
          this._fs.closeSync(descriptor);
        } catch {
          // The authoritative path is still absent until the hard-link CAS.
        }
      }
      if (temporaryExists) {
        try {
          this._fs.unlinkSync(temporaryPath);
        } catch {
          // Hidden temporary files are never candidate artifacts or list entries.
        }
      }
    }
  }

  read(candidateId) {
    const normalizedId = normalizeCandidateId(candidateId);
    const filePath = this._candidatePath(normalizedId);
    let bytes;
    try {
      bytes = this._readBytes(filePath);
    } catch (error) {
      if (error instanceof SkillCandidateRegistryError) throw error;
      if (error?.code === "ENOENT") {
        throw registryError(
          "SKILL_CANDIDATE_NOT_FOUND",
          "candidate artifact was not found",
          { candidateId: normalizedId },
        );
      }
      throw registryError(
        "SKILL_CANDIDATE_CORRUPT",
        "candidate artifact could not be read safely",
        { candidateId: normalizedId, cause: error },
      );
    }

    let parsed;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch (error) {
      throw registryError(
        "SKILL_CANDIDATE_CORRUPT",
        "candidate artifact is not canonical UTF-8 JSON",
        { candidateId: normalizedId, cause: error },
      );
    }

    let candidate;
    try {
      candidate = verifySkillCandidateDraft(parsed);
    } catch (error) {
      if (error?.code === SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE) throw error;
      throw registryError(
        "SKILL_CANDIDATE_CORRUPT",
        "candidate artifact failed schema or digest verification",
        { candidateId: normalizedId, cause: error },
      );
    }
    if (
      candidate.tenantId !== this.tenantId ||
      candidate.candidateId !== normalizedId ||
      !serializeCandidate(candidate).equals(bytes)
    ) {
      throw registryError(
        "SKILL_CANDIDATE_CORRUPT",
        "candidate filename or serialization does not match its digest",
        { candidateId: normalizedId },
      );
    }
    return candidate;
  }

  list(options = {}) {
    assertDataRecord(options, LIST_OPTION_KEYS, "candidate list options");
    const limit = ownData(
      options,
      "limit",
      "candidate list options",
      DEFAULT_LIST_LIMIT,
    );
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        `limit must be an integer from 1 to ${MAX_LIST_LIMIT}`,
      );
    }
    const names = this._assertNoMixedTenantArtifacts()
      .filter((name) => CANDIDATE_FILE_PATTERN.test(name))
      .sort();
    const candidates = names.slice(0, limit).map((name) => {
      const match = CANDIDATE_FILE_PATTERN.exec(name);
      return this.read(`sha256:${match[1]}`);
    });
    this._assertBoundary();
    return Object.freeze(candidates);
  }
}
