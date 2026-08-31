import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getHomeDir } from "../paths.js";
import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";

export const SKILL_CANDIDATE_SCHEMA = "chainlesschain.skill-candidate/v1";
export const SKILL_CANDIDATE_STATUS = "draft";
export const SKILL_CANDIDATE_CONTENT_TYPE =
  "text/markdown; charset=utf-8; profile=skill";
export const SKILL_CANDIDATE_MAX_CONTENT_BYTES = 1024 * 1024;
export const SKILL_CANDIDATE_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const MAX_SOURCE_EVIDENCE_REFS = 256;
const MAX_REQUESTED_CAPABILITIES = 128;
const MAX_TARGET_RUNTIMES = 64;
const MAX_STORED_CANDIDATES = 100_000;
const MAX_LIST_LIMIT = 10_000;
const DEFAULT_LIST_LIMIT = 1_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CANDIDATE_FILE_PATTERN = /^([a-f0-9]{64})\.json$/u;
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const NAMESPACED_ID_PATTERN =
  /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const EVIDENCE_REF_PATTERN = /^[a-z][a-z0-9+.-]{1,31}:[^\s\\]+$/u;
const CANDIDATE_DIGEST_DOMAIN = "chainlesschain.skill-candidate/v1\0";

const CANDIDATE_KEYS = new Set([
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
  "derivationMode",
  "evalRunId",
  "parentDigest",
  "proposerModel",
  "requestedCapabilities",
  "skillName",
  "sourceEvidenceRefs",
  "targetRuntimes",
  "wikiRevision",
]);

const PROPOSER_MODEL_KEYS = new Set(["model", "provider", "version"]);
const SOURCE_EVIDENCE_KEYS = new Set(["digest", "ref"]);
const DERIVATION_MODES = new Set([
  "wiki",
  "record-replay",
  "manual-import",
]);

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

function isPlainObject(value) {
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

function assertExactKeys(value, allowed, label) {
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    keys.length > allowed.size
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} contains unsupported fields`,
    );
  }
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

function contentDigest(content) {
  return sha256(Buffer.from(content, "utf8"));
}

function candidateDigest(core) {
  return sha256(
    Buffer.concat([
      Buffer.from(CANDIDATE_DIGEST_DOMAIN, "utf8"),
      Buffer.from(canonicalJson(core), "utf8"),
    ]),
  );
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
  return value;
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

function normalizeUniqueStringList(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must be an array with at most ${maximum} entries`,
    );
  }
  const normalized = value.map((entry) => normalizeNamespacedId(entry, label));
  if (new Set(normalized).size !== normalized.length) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `${label} must not contain duplicates`,
    );
  }
  return normalized.sort();
}

function normalizeSourceEvidenceRefs(value) {
  if (!Array.isArray(value) || value.length > MAX_SOURCE_EVIDENCE_REFS) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      `sourceEvidenceRefs must contain at most ${MAX_SOURCE_EVIDENCE_REFS} entries`,
    );
  }
  const normalized = value.map((entry, index) => {
    assertPlainObject(entry, `sourceEvidenceRefs[${index}]`);
    assertExactKeys(
      entry,
      SOURCE_EVIDENCE_KEYS,
      `sourceEvidenceRefs[${index}]`,
    );
    const ref = normalizeBoundedString(
      entry.ref,
      `sourceEvidenceRefs[${index}].ref`,
      2048,
    );
    if (!EVIDENCE_REF_PATTERN.test(ref)) {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        `sourceEvidenceRefs[${index}].ref must be an absolute opaque URI`,
      );
    }
    return {
      digest: normalizeDigest(
        entry.digest,
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
  assertPlainObject(value, "proposerModel");
  assertExactKeys(value, PROPOSER_MODEL_KEYS, "proposerModel");
  if (Reflect.ownKeys(value).length !== PROPOSER_MODEL_KEYS.size) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "proposerModel must include provider, model, and version",
    );
  }
  return {
    provider: normalizeBoundedString(
      value.provider,
      "proposerModel.provider",
      128,
    ),
    model: normalizeBoundedString(value.model, "proposerModel.model", 256),
    version: normalizeBoundedString(
      value.version,
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

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function candidateCore(input) {
  assertPlainObject(input, "candidate input");
  assertExactKeys(input, CREATE_INPUT_KEYS, "candidate input");
  const evalRunId = input.evalRunId ?? null;
  if (evalRunId !== null) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "a draft candidate cannot carry an evalRunId",
    );
  }
  const content = normalizeContent(input.content);
  const sourceEvidenceRefs = normalizeSourceEvidenceRefs(
    input.sourceEvidenceRefs ?? [],
  );
  const derivationMode = normalizeDerivationMode(input.derivationMode);
  const wikiRevision = normalizeNullableReference(
    input.wikiRevision ?? null,
    "wikiRevision",
  );
  const proposerModel = normalizeProposerModel(input.proposerModel ?? null);
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
    skillName: normalizeSkillName(input.skillName),
    parentDigest: normalizeDigest(input.parentDigest ?? null, "parentDigest", {
      nullable: true,
    }),
    contentDigest: contentDigest(content),
    sourceEvidenceRefs,
    derivationMode,
    wikiRevision,
    proposerModel,
    targetRuntimes: normalizeUniqueStringList(
      input.targetRuntimes ?? [],
      "targetRuntimes",
      MAX_TARGET_RUNTIMES,
    ),
    requestedCapabilities: normalizeUniqueStringList(
      input.requestedCapabilities ?? [],
      "requestedCapabilities",
      MAX_REQUESTED_CAPABILITIES,
    ),
    evalRunId,
    contentType: SKILL_CANDIDATE_CONTENT_TYPE,
    content,
  };
}

/** Build the only artifact shape accepted by the candidate registry. */
export function buildSkillCandidateDraft(input) {
  const core = candidateCore(input);
  return deepFreeze({
    candidateId: candidateDigest(core),
    ...core,
  });
}

/** Recompute every derived field and reject non-canonical candidate objects. */
export function verifySkillCandidateDraft(candidate) {
  assertPlainObject(candidate, "candidate artifact");
  assertExactKeys(candidate, CANDIDATE_KEYS, "candidate artifact");
  if (Reflect.ownKeys(candidate).length !== CANDIDATE_KEYS.size) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate artifact is missing required fields",
    );
  }
  if (
    candidate.schema !== SKILL_CANDIDATE_SCHEMA ||
    candidate.status !== SKILL_CANDIDATE_STATUS ||
    candidate.contentType !== SKILL_CANDIDATE_CONTENT_TYPE
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate artifact schema, status, or content type is invalid",
    );
  }
  const normalized = buildSkillCandidateDraft({
    skillName: candidate.skillName,
    parentDigest: candidate.parentDigest,
    sourceEvidenceRefs: candidate.sourceEvidenceRefs,
    derivationMode: candidate.derivationMode,
    wikiRevision: candidate.wikiRevision,
    proposerModel: candidate.proposerModel,
    targetRuntimes: candidate.targetRuntimes,
    requestedCapabilities: candidate.requestedCapabilities,
    evalRunId: candidate.evalRunId,
    content: candidate.content,
  });
  if (
    candidate.contentDigest !== normalized.contentDigest ||
    candidate.candidateId !== normalized.candidateId
  ) {
    throw registryError(
      "SKILL_CANDIDATE_INVALID",
      "candidate artifact digest verification failed",
    );
  }
  return normalized;
}

function serializeCandidate(candidate) {
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

/**
 * Immutable, candidate-only Skill artifact storage.
 *
 * This class deliberately has no active pointer or promotion API. A later
 * promotion controller can consume verified drafts through read().
 */
export class SkillCandidateRegistry {
  constructor({
    rootDir = path.join(
      getHomeDir(),
      "evolution",
      "registry",
      "candidates",
    ),
    secure = true,
    fsImpl = fs,
    randomToken = () => crypto.randomBytes(16).toString("hex"),
  } = {}) {
    this._fs = fsImpl;
    this._secure = secure !== false;
    this._randomToken = randomToken;
    const requestedRoot = path.resolve(rootDir);
    try {
      if (this._secure) {
        ensurePrivateDirectory(requestedRoot, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
      } else {
        this._fs.mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
      }
      const requestedStat = this._fs.lstatSync(requestedRoot);
      if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate registry root must be a regular, non-symlink directory",
        );
      }
      this.rootDir = realpath(this._fs, requestedRoot);
      const canonicalStat = this._fs.lstatSync(this.rootDir);
      if (!canonicalStat.isDirectory() || canonicalStat.isSymbolicLink()) {
        throw registryError(
          "SKILL_CANDIDATE_STORE_UNSAFE",
          "candidate registry root resolved to an unsafe entry",
        );
      }
      this._rootIdentity = entryIdentity(canonicalStat);
      this._assertBoundary();
    } catch (error) {
      if (error instanceof SkillCandidateRegistryError) throw error;
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry root could not be initialized safely",
        { cause: error },
      );
    }
  }

  _assertBoundary() {
    let stat;
    let canonical;
    try {
      stat = this._fs.lstatSync(this.rootDir);
      canonical = realpath(this._fs, this.rootDir);
    } catch (error) {
      if (error instanceof SkillCandidateRegistryError) throw error;
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry root is unavailable",
        { cause: error },
      );
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      entryIdentity(stat) !== this._rootIdentity ||
      !samePath(canonical, this.rootDir)
    ) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry root changed or became unsafe",
      );
    }
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
    let descriptor = null;
    try {
      const before = this._fs.lstatSync(filePath);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size <= 0 ||
        before.size > SKILL_CANDIDATE_MAX_ARTIFACT_BYTES
      ) {
        throw registryError(
          "SKILL_CANDIDATE_CORRUPT",
          "candidate artifact must be a bounded regular, non-symlink file",
        );
      }
      descriptor = this._fs.openSync(
        filePath,
        this._fs.constants.O_RDONLY |
          (this._fs.constants.O_NOFOLLOW || 0),
      );
      const opened = this._fs.fstatSync(descriptor);
      if (
        !opened.isFile() ||
        entryIdentity(opened) !== entryIdentity(before) ||
        opened.size !== before.size
      ) {
        throw registryError(
          "SKILL_CANDIDATE_CORRUPT",
          "candidate artifact changed while it was opened",
        );
      }
      const bytes = this._fs.readFileSync(descriptor);
      const after = this._fs.fstatSync(descriptor);
      if (
        entryIdentity(after) !== entryIdentity(opened) ||
        after.size !== opened.size ||
        bytes.length !== opened.size
      ) {
        throw registryError(
          "SKILL_CANDIDATE_CORRUPT",
          "candidate artifact changed while it was read",
        );
      }
      return bytes;
    } finally {
      if (descriptor !== null) this._fs.closeSync(descriptor);
      this._assertBoundary();
    }
  }

  create(input) {
    const candidate = buildSkillCandidateDraft(input);
    const bytes = serializeCandidate(candidate);
    const filePath = this._candidatePath(candidate.candidateId);
    const token = String(this._randomToken());
    if (!/^[a-f0-9]{32}$/u.test(token)) {
      throw registryError(
        "SKILL_CANDIDATE_WRITE_FAILED",
        "candidate registry random token is invalid",
        { candidateId: candidate.candidateId, commitState: "not-committed" },
      );
    }
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
      if (!written.isFile() || written.size !== bytes.length) {
        throw registryError(
          "SKILL_CANDIDATE_WRITE_FAILED",
          "candidate temporary artifact was not written completely",
          { candidateId: candidate.candidateId, commitState: "not-committed" },
        );
      }
      this._fs.closeSync(descriptor);
      descriptor = null;
      if (this._secure) {
        ensurePrivateFile(temporaryPath, {
          applyWindowsAcl: true,
          failIfUnavailable: true,
        });
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
      this._fs.unlinkSync(temporaryPath);
      temporaryExists = false;
      fsyncDirectory(this._fs, this.rootDir);
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
      throw registryError(
        "SKILL_CANDIDATE_CORRUPT",
        "candidate artifact failed schema or digest verification",
        { candidateId: normalizedId, cause: error },
      );
    }
    if (
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

  list({ limit = DEFAULT_LIST_LIMIT } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw registryError(
        "SKILL_CANDIDATE_INVALID",
        `limit must be an integer from 1 to ${MAX_LIST_LIMIT}`,
      );
    }
    this._assertBoundary();
    let entries;
    try {
      entries = this._fs.readdirSync(this.rootDir, { withFileTypes: true });
    } catch (error) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        "candidate registry could not be listed safely",
        { cause: error },
      );
    }
    const names = entries
      .map((entry) => entry.name)
      .filter((name) => CANDIDATE_FILE_PATTERN.test(name))
      .sort();
    if (names.length > MAX_STORED_CANDIDATES) {
      throw registryError(
        "SKILL_CANDIDATE_STORE_UNSAFE",
        `candidate registry contains more than ${MAX_STORED_CANDIDATES} artifacts`,
      );
    }
    const candidates = names.slice(0, limit).map((name) => {
      const match = CANDIDATE_FILE_PATTERN.exec(name);
      return this.read(`sha256:${match[1]}`);
    });
    this._assertBoundary();
    return Object.freeze(candidates);
  }
}
