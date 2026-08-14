/**
 * Canonical, content-minimized contract for reviewing a batch of Agent Team
 * worktree branches before publishing them to the base branch.
 *
 * This module is intentionally pure. Git discovery/application and durable I/O
 * live in sibling adapters. Persisted records contain identities, ranges and
 * digests only; raw patches and file contents never enter the contract.
 */

import { createHash } from "node:crypto";
import { redactSecrets } from "../secret-scan.js";

export const TEAM_MERGE_REVIEW_SCHEMA = "chainlesschain.team-merge-review/v1";
export const TEAM_MERGE_REVIEW_SCHEMA_VERSION = 1;

export const TEAM_MERGE_REVIEW_STATE = Object.freeze({
  PLANNED: "planned",
  PREPARED: "prepared",
  PUBLISHING: "publishing",
  PUBLISHED: "published",
  CONFLICTED: "conflicted",
  ROLLBACK_REQUIRED: "rollback_required",
  ROLLED_BACK: "rolled_back",
});

export const TEAM_MERGE_REVIEW_ERROR = Object.freeze({
  INVALID: "TEAM_MERGE_REVIEW_INVALID",
  STALE: "TEAM_MERGE_REVIEW_STALE",
  TRANSITION: "TEAM_MERGE_REVIEW_TRANSITION_INVALID",
  BINDING: "TEAM_MERGE_REVIEW_BINDING_MISMATCH",
  LIMIT: "TEAM_MERGE_REVIEW_LIMIT",
  SECRET: "TEAM_MERGE_REVIEW_SECRET_REJECTED",
});

export const TEAM_MERGE_REVIEW_LIMITS = Object.freeze({
  candidates: 256,
  files: 4096,
  hunks: 16384,
  selectionIds: 100,
  patchBytes: 512 * 1024,
  fullPatchBytes: 8 * 1024 * 1024,
  totalPatchBytes: 32 * 1024 * 1024,
  keyBytes: 512,
  branchBytes: 4096,
  pathBytes: 4096,
  actorBytes: 256,
  hostBytes: 256,
  reasonBytes: 2048,
  conflicts: 256,
  conflictTypeBytes: 64,
  conflictTextBytes: 2048,
  totalConflictTextBytes: 256 * 1024,
  conflictHunkRefs: 4096,
});

const REVIEW_KEYS = new Set([
  "schema",
  "schemaVersion",
  "reviewId",
  "revision",
  "state",
  "base",
  "candidates",
  "files",
  "decision",
  "conflicts",
  "planDigest",
  "evidenceDigest",
  "settlement",
  "createdAt",
  "updatedAt",
]);
const BASE_KEYS = new Set(["branch", "commitOid"]);
const CANDIDATE_KEYS = new Set(["key", "branch", "commitOid"]);
const FILE_KEYS = new Set([
  "id",
  "candidateKey",
  "path",
  "oldPath",
  "status",
  "oldBlobOid",
  "newBlobOid",
  "binary",
  "patchDigest",
  "hunks",
]);
const HUNK_KEYS = new Set([
  "id",
  "oldStart",
  "oldLines",
  "newStart",
  "newLines",
  "digest",
]);
const DECISION_KEYS = new Set([
  "actor",
  "host",
  "reason",
  "decidedAt",
  "selectedFileIds",
  "selectedHunkIds",
  "digest",
]);
const CONFLICT_KEYS = new Set([
  "candidateKey",
  "path",
  "type",
  "explanation",
  "suggestion",
  "hunkIds",
]);
const SETTLEMENT_KEYS = new Set([
  "preparedOid",
  "publishedOid",
  "rollbackOid",
  "conflictDigest",
  "transitionEvidenceDigest",
]);
const GIT_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REVIEW_ID = /^tmr_[a-f0-9]{32}$/;
const FILE_ID = /^tmrf_[a-f0-9]{32}$/;
const HUNK_ID = /^tmrh_[a-f0-9]{32}$/;
const ID_HEX_LENGTH = 32;
const CONTROL_CHARACTER = /\p{Cc}/u;
const FILE_STATUSES = new Set([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type_changed",
  "unmerged",
]);
const STATES = new Set(Object.values(TEAM_MERGE_REVIEW_STATE));
const TRANSITIONS = new Map([
  ["planned", new Set(["prepared", "conflicted"])],
  ["prepared", new Set(["publishing", "conflicted", "rollback_required"])],
  ["publishing", new Set(["published", "rollback_required"])],
  ["published", new Set(["rollback_required"])],
  ["conflicted", new Set(["rolled_back"])],
  ["rollback_required", new Set(["rolled_back"])],
  ["rolled_back", new Set()],
]);

export class TeamMergeReviewError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "TeamMergeReviewError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined && value !== null) this[key] = value;
    }
  }
}

function fail(code, message, details = {}, cause = null) {
  throw new TeamMergeReviewError(code, message, details, cause);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (descriptor) =>
        descriptor.get || descriptor.set || descriptor.enumerable !== true,
    )
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must not contain symbols or accessors`,
    );
  }
  return value;
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} has unexpected or missing fields`,
    );
  }
}

function assertDenseArray(value, label) {
  if (!Array.isArray(value)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} must be an array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      descriptor.get ||
      descriptor.set ||
      descriptor.enumerable !== true
    ) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        `${label} must be dense and accessor-free`,
      );
    }
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === "length") continue;
    const index = typeof key === "string" ? Number(key) : Number.NaN;
    if (
      typeof key !== "string" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= value.length ||
      String(index) !== key
    ) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        `${label} contains a non-index property`,
      );
    }
  }
  return value;
}

/** Stable JSON encoding used by all plan, decision, evidence and event hashes. */
export function canonicalMergeReviewJson(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        "merge-review evidence contains a non-finite number",
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (!value || typeof value !== "object") {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review evidence must be JSON-compatible",
    );
  }
  if (seen.has(value)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review evidence must not contain cycles",
    );
  }
  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    assertDenseArray(value, "merge-review evidence array");
    encoded = `[${value
      .map((item) => {
        if (item === undefined || typeof item === "function") {
          fail(
            TEAM_MERGE_REVIEW_ERROR.INVALID,
            "merge-review arrays contain an unsupported value",
          );
        }
        return canonicalMergeReviewJson(item, seen);
      })
      .join(",")}]`;
  } else {
    assertPlainObject(value, "merge-review evidence object");
    encoded = `{${Object.keys(value)
      .sort()
      .map((key) => {
        const item = value[key];
        if (item === undefined || typeof item === "function") {
          fail(
            TEAM_MERGE_REVIEW_ERROR.INVALID,
            "merge-review objects contain an unsupported value",
          );
        }
        return `${JSON.stringify(key)}:${canonicalMergeReviewJson(item, seen)}`;
      })
      .join(",")}}`;
  }
  seen.delete(value);
  return encoded;
}

export function digestMergeReview(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalMergeReviewJson(value), "utf8")
    .digest("hex")}`;
}

function normalizeDigest(
  value,
  label,
  { nullable = false, strict = false } = {},
) {
  if (nullable && value === null) return null;
  if (!strict && nullable && value == null) return null;
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} must be a sha256 digest`);
  }
  return value;
}

function normalizeOid(value, label, { nullable = false, strict = false } = {}) {
  if (nullable && value === null) return null;
  if (strict && typeof value !== "string") {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} must be a Git object id`);
  }
  if (!strict && nullable && value == null) return null;
  const oid = String(value || "").toLowerCase();
  if (!GIT_OID.test(oid) || (strict && oid !== value)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} must be a Git object id`);
  }
  return oid;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function boundedIdentity(value, label, maxBytes) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    CONTROL_CHARACTER.test(value) ||
    byteLength(value) > maxBytes
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must be a stable 1..${maxBytes} byte string`,
    );
  }
  if (redactSecrets(value) !== value) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.SECRET,
      `${label} resembles secret material and cannot enter merge-review evidence`,
    );
  }
  return value;
}

function boundedDecisionText(value, label, maxBytes, { strict = false } = {}) {
  if (typeof value !== "string") {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} must be a string`);
  }
  const secretRedacted = redactSecrets(value);
  if (strict && secretRedacted !== value) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.SECRET,
      `${label} contains secret material in persisted evidence`,
    );
  }
  const redacted = secretRedacted.replace(/\p{Cc}/gu, " ").trim();
  if (strict && redacted !== value) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} is not in canonical persisted form`,
    );
  }
  if (!redacted || byteLength(redacted) > maxBytes) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must be a non-empty string of at most ${maxBytes} bytes`,
    );
  }
  return redacted;
}

function normalizeBranch(value, label) {
  const branch = boundedIdentity(
    value,
    label,
    TEAM_MERGE_REVIEW_LIMITS.branchBytes,
  );
  if (
    branch === "@" ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    /[\s~^:?*[\]\\]/u.test(branch) ||
    branch
      .split("/")
      .some(
        (part) =>
          !part ||
          part.startsWith(".") ||
          part.startsWith("-") ||
          part.endsWith(".") ||
          part.endsWith(".lock"),
      )
  ) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} is not a safe Git ref`);
  }
  return branch;
}

function normalizePath(value, label = "file.path", { strict = false } = {}) {
  const filePath = boundedIdentity(
    value,
    label,
    TEAM_MERGE_REVIEW_LIMITS.pathBytes,
  ).replace(/\\/g, "/");
  if (
    (strict && filePath !== value) ||
    filePath.startsWith("/") ||
    /^[a-z]:\//iu.test(filePath) ||
    filePath.endsWith("/") ||
    filePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must be a repository-relative path`,
    );
  }
  return filePath;
}

function timestamp(value, label, { strict = false } = {}) {
  if (strict && typeof value !== "string") {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must be a timestamp string`,
    );
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} must be a valid timestamp`);
  }
  const normalized = date.toISOString();
  if (strict && normalized !== value) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must be a canonical ISO timestamp`,
    );
  }
  return normalized;
}

function nonNegativeInteger(value, label, { strict = false } = {}) {
  if (strict && typeof value !== "number") {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must be a non-negative integer`,
    );
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must be a non-negative integer`,
    );
  }
  return number;
}

function normalizeBase(value, { strict = false } = {}) {
  if (strict) assertExactKeys(value, BASE_KEYS, "merge-review base");
  else assertPlainObject(value, "merge-review base");
  return {
    branch: normalizeBranch(value.branch, "base.branch"),
    commitOid: normalizeOid(value.commitOid, "base.commitOid", { strict }),
  };
}

function normalizeCandidates(values, { strict = false } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review requires at least one candidate",
    );
  }
  assertDenseArray(values, "merge-review candidates");
  if (values.length > TEAM_MERGE_REVIEW_LIMITS.candidates) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.LIMIT,
      `merge-review cannot exceed ${TEAM_MERGE_REVIEW_LIMITS.candidates} candidates`,
    );
  }
  const keys = new Set();
  const branches = new Set();
  return values.map((value, index) => {
    if (strict) {
      assertExactKeys(value, CANDIDATE_KEYS, `candidate[${index}]`);
    } else {
      assertPlainObject(value, `candidate[${index}]`);
    }
    const candidate = {
      key: boundedIdentity(
        value.key,
        `candidate[${index}].key`,
        TEAM_MERGE_REVIEW_LIMITS.keyBytes,
      ),
      branch: normalizeBranch(value.branch, `candidate[${index}].branch`),
      commitOid: normalizeOid(
        value.commitOid,
        `candidate[${index}].commitOid`,
        {
          strict,
        },
      ),
    };
    if (keys.has(candidate.key) || branches.has(candidate.branch)) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        "merge-review candidate keys and branches must be unique",
      );
    }
    keys.add(candidate.key);
    branches.add(candidate.branch);
    return candidate;
  });
}

export function computeMergeReviewHunkDigest(patch) {
  if (typeof patch !== "string" || patch.length === 0) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "full hunk text is required to compute its digest",
    );
  }
  if (byteLength(patch) > TEAM_MERGE_REVIEW_LIMITS.patchBytes) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.LIMIT,
      `one hunk cannot exceed ${TEAM_MERGE_REVIEW_LIMITS.patchBytes} bytes`,
    );
  }
  return digestMergeReview("cc-team-merge-review-full-hunk-v1", patch);
}

export function computeMergeReviewPatchDigest(patch) {
  if (typeof patch !== "string" || patch.length === 0) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "full file patch is required to compute its digest",
    );
  }
  if (byteLength(patch) > TEAM_MERGE_REVIEW_LIMITS.fullPatchBytes) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.LIMIT,
      `one file patch cannot exceed ${TEAM_MERGE_REVIEW_LIMITS.fullPatchBytes} bytes`,
    );
  }
  return `sha256:${createHash("sha256").update(patch, "utf8").digest("hex")}`;
}

function hunkBinding(base, candidate, file, hunk) {
  return {
    baseOid: base.commitOid,
    candidateKey: candidate.key,
    candidateOid: candidate.commitOid,
    path: file.path,
    oldPath: file.oldPath,
    oldBlobOid: file.oldBlobOid,
    newBlobOid: file.newBlobOid,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    digest: hunk.digest,
  };
}

export function computeMergeReviewHunkId(base, candidate, file, hunk) {
  const digest = digestMergeReview(
    "cc-team-merge-review-hunk-id-v1",
    hunkBinding(base, candidate, file, hunk),
  );
  return `tmrh_${digest.slice("sha256:".length, "sha256:".length + ID_HEX_LENGTH)}`;
}

function assertChangedHunk(hunk, label) {
  if (hunk.oldLines === 0 && hunk.newLines === 0) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} must describe at least one changed line`,
    );
  }
}

function normalizeHunkInput(value, context, index) {
  assertPlainObject(value, `hunk[${index}]`);
  const hunk = {
    oldStart: nonNegativeInteger(value.oldStart, `hunk[${index}].oldStart`),
    oldLines: nonNegativeInteger(value.oldLines, `hunk[${index}].oldLines`),
    newStart: nonNegativeInteger(value.newStart, `hunk[${index}].newStart`),
    newLines: nonNegativeInteger(value.newLines, `hunk[${index}].newLines`),
    digest:
      typeof value.patch === "string"
        ? computeMergeReviewHunkDigest(value.patch)
        : normalizeDigest(value.digest, `hunk[${index}].digest`),
  };
  assertChangedHunk(hunk, `hunk[${index}]`);
  hunk.id = computeMergeReviewHunkId(
    context.base,
    context.candidate,
    context.file,
    hunk,
  );
  return hunk;
}

function validateHunk(value, context, index) {
  assertExactKeys(value, HUNK_KEYS, `hunk[${index}]`);
  const hunk = {
    id: value.id,
    oldStart: nonNegativeInteger(value.oldStart, `hunk[${index}].oldStart`, {
      strict: true,
    }),
    oldLines: nonNegativeInteger(value.oldLines, `hunk[${index}].oldLines`, {
      strict: true,
    }),
    newStart: nonNegativeInteger(value.newStart, `hunk[${index}].newStart`, {
      strict: true,
    }),
    newLines: nonNegativeInteger(value.newLines, `hunk[${index}].newLines`, {
      strict: true,
    }),
    digest: normalizeDigest(value.digest, `hunk[${index}].digest`),
  };
  if (typeof hunk.id !== "string" || !HUNK_ID.test(hunk.id)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `hunk[${index}].id is invalid`);
  }
  assertChangedHunk(hunk, `hunk[${index}]`);
  const expected = computeMergeReviewHunkId(
    context.base,
    context.candidate,
    context.file,
    hunk,
  );
  if (hunk.id !== expected) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      `hunk[${index}] no longer binds its exact blobs, ranges and digest`,
    );
  }
  return hunk;
}

function compareHunks(left, right) {
  return (
    left.oldStart - right.oldStart ||
    left.newStart - right.newStart ||
    left.id.localeCompare(right.id)
  );
}

function fileBinding(base, candidate, file) {
  return {
    baseOid: base.commitOid,
    candidateKey: candidate.key,
    candidateBranch: candidate.branch,
    candidateOid: candidate.commitOid,
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    oldBlobOid: file.oldBlobOid,
    newBlobOid: file.newBlobOid,
    binary: file.binary,
    patchDigest: file.patchDigest,
    hunks: file.hunks.map((hunk) => ({ id: hunk.id, digest: hunk.digest })),
  };
}

export function computeMergeReviewFileId(base, candidate, file) {
  const digest = digestMergeReview(
    "cc-team-merge-review-file-id-v1",
    fileBinding(base, candidate, file),
  );
  return `tmrf_${digest.slice("sha256:".length, "sha256:".length + ID_HEX_LENGTH)}`;
}

function validateBlobState(file, label) {
  if (file.status === "added" && (file.oldBlobOid || !file.newBlobOid)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} added files require only newBlobOid`,
    );
  }
  if (file.status === "deleted" && (!file.oldBlobOid || file.newBlobOid)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} deleted files require only oldBlobOid`,
    );
  }
  if (
    !["added", "deleted"].includes(file.status) &&
    (!file.oldBlobOid || !file.newBlobOid)
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} requires both oldBlobOid and newBlobOid`,
    );
  }
  if (file.binary && file.hunks.length > 0) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} binary files support file-level selection only`,
    );
  }
  if (file.status === "added" && file.oldPath !== null) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} added files require null oldPath`,
    );
  }
  if (
    ["renamed", "copied"].includes(file.status) &&
    (!file.oldPath || file.oldPath === file.path)
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} ${file.status} files require a distinct oldPath`,
    );
  }
  if (
    !["added", "renamed", "copied"].includes(file.status) &&
    file.oldPath !== file.path
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${label} ${file.status} files require oldPath to equal path`,
    );
  }
}

function normalizeFileInput(value, base, candidatesByKey, index) {
  assertPlainObject(value, `file[${index}]`);
  const candidateKey = boundedIdentity(
    value.candidateKey,
    `file[${index}].candidateKey`,
    TEAM_MERGE_REVIEW_LIMITS.keyBytes,
  );
  const candidate = candidatesByKey.get(candidateKey);
  if (!candidate) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      `file[${index}] refers to an unknown candidate`,
    );
  }
  const status = String(value.status || "");
  if (!FILE_STATUSES.has(status)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `file[${index}].status is invalid`);
  }
  const file = {
    candidateKey,
    path: normalizePath(value.path, `file[${index}].path`),
    oldPath:
      value.oldPath == null
        ? null
        : normalizePath(value.oldPath, `file[${index}].oldPath`),
    status,
    oldBlobOid: normalizeOid(value.oldBlobOid, `file[${index}].oldBlobOid`, {
      nullable: true,
    }),
    newBlobOid: normalizeOid(value.newBlobOid, `file[${index}].newBlobOid`, {
      nullable: true,
    }),
    binary: value.binary === true,
    patchDigest: normalizeDigest(
      value.patchDigest,
      `file[${index}].patchDigest`,
    ),
    hunks: [],
  };
  if (!Array.isArray(value.hunks)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `file[${index}].hunks must be an array`,
    );
  }
  assertDenseArray(value.hunks, `file[${index}].hunks`);
  file.hunks = value.hunks
    .map((hunk, hunkIndex) =>
      normalizeHunkInput(hunk, { base, candidate, file }, hunkIndex),
    )
    .sort(compareHunks);
  validateBlobState(file, `file[${index}]`);
  file.id = computeMergeReviewFileId(base, candidate, file);
  return file;
}

function validateFile(value, base, candidatesByKey, index) {
  assertExactKeys(value, FILE_KEYS, `file[${index}]`);
  const candidateKey = boundedIdentity(
    value.candidateKey,
    `file[${index}].candidateKey`,
    TEAM_MERGE_REVIEW_LIMITS.keyBytes,
  );
  const candidate = candidatesByKey.get(candidateKey);
  if (!candidate) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      `file[${index}] refers to an unknown candidate`,
    );
  }
  const status = value.status;
  if (typeof status !== "string" || !FILE_STATUSES.has(status)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `file[${index}].status is invalid`);
  }
  const file = {
    id: value.id,
    candidateKey,
    path: normalizePath(value.path, `file[${index}].path`, { strict: true }),
    oldPath:
      value.oldPath === null
        ? null
        : normalizePath(value.oldPath, `file[${index}].oldPath`, {
            strict: true,
          }),
    status,
    oldBlobOid: normalizeOid(value.oldBlobOid, `file[${index}].oldBlobOid`, {
      nullable: true,
      strict: true,
    }),
    newBlobOid: normalizeOid(value.newBlobOid, `file[${index}].newBlobOid`, {
      nullable: true,
      strict: true,
    }),
    binary: value.binary,
    patchDigest: normalizeDigest(
      value.patchDigest,
      `file[${index}].patchDigest`,
    ),
    hunks: [],
  };
  if (
    typeof file.id !== "string" ||
    !FILE_ID.test(file.id) ||
    typeof file.binary !== "boolean" ||
    !Array.isArray(value.hunks)
  ) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `file[${index}] identity is invalid`);
  }
  assertDenseArray(value.hunks, `file[${index}].hunks`);
  file.hunks = value.hunks.map((hunk, hunkIndex) =>
    validateHunk(hunk, { base, candidate, file }, hunkIndex),
  );
  if (
    file.hunks.some(
      (hunk, hunkIndex) =>
        hunkIndex > 0 && compareHunks(file.hunks[hunkIndex - 1], hunk) >= 0,
    )
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `file[${index}] hunks are not in stable order`,
    );
  }
  validateBlobState(file, `file[${index}]`);
  const expected = computeMergeReviewFileId(base, candidate, file);
  if (file.id !== expected) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      `file[${index}] no longer binds its exact candidate, blobs and hunks`,
    );
  }
  return file;
}

function compareFiles(candidateOrder, left, right) {
  return (
    candidateOrder.get(left.candidateKey) -
      candidateOrder.get(right.candidateKey) ||
    left.path.localeCompare(right.path) ||
    left.id.localeCompare(right.id)
  );
}

function normalizeFiles(values, base, candidates, { strict = false } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review requires at least one changed file",
    );
  }
  assertDenseArray(values, "merge-review files");
  if (values.length > TEAM_MERGE_REVIEW_LIMITS.files) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.LIMIT,
      `merge-review cannot exceed ${TEAM_MERGE_REVIEW_LIMITS.files} files`,
    );
  }
  let hunkCount = 0;
  let totalPatchBytes = 0;
  values.forEach((value, fileIndex) => {
    assertPlainObject(value, `file[${fileIndex}]`);
    if (!Array.isArray(value.hunks)) return;
    hunkCount += value.hunks.length;
    if (hunkCount > TEAM_MERGE_REVIEW_LIMITS.hunks) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.LIMIT,
        `merge-review cannot exceed ${TEAM_MERGE_REVIEW_LIMITS.hunks} hunks`,
      );
    }
    value.hunks.forEach((hunk, hunkIndex) => {
      assertPlainObject(hunk, `file[${fileIndex}].hunk[${hunkIndex}]`);
      if (typeof hunk.patch !== "string") return;
      totalPatchBytes += byteLength(hunk.patch);
      if (totalPatchBytes > TEAM_MERGE_REVIEW_LIMITS.totalPatchBytes) {
        fail(
          TEAM_MERGE_REVIEW_ERROR.LIMIT,
          `merge-review patches cannot exceed ${TEAM_MERGE_REVIEW_LIMITS.totalPatchBytes} total bytes`,
        );
      }
    });
  });
  const candidatesByKey = new Map(
    candidates.map((candidate) => [candidate.key, candidate]),
  );
  const candidateOrder = new Map(
    candidates.map((candidate, index) => [candidate.key, index]),
  );
  const files = values.map((value, index) =>
    strict
      ? validateFile(value, base, candidatesByKey, index)
      : normalizeFileInput(value, base, candidatesByKey, index),
  );
  const seenPaths = new Set();
  const seenIds = new Set();
  const seenHunks = new Set();
  for (const file of files) {
    const pathBinding = `${file.candidateKey}\0${file.path}`;
    if (seenPaths.has(pathBinding) || seenIds.has(file.id)) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        "merge-review contains duplicate file identities",
      );
    }
    seenPaths.add(pathBinding);
    seenIds.add(file.id);
    for (const hunk of file.hunks) {
      if (seenHunks.has(hunk.id)) {
        fail(
          TEAM_MERGE_REVIEW_ERROR.INVALID,
          "merge-review contains duplicate hunk identities",
        );
      }
      seenHunks.add(hunk.id);
    }
  }
  if (strict) {
    if (
      files.some(
        (file, index) =>
          index > 0 &&
          compareFiles(candidateOrder, files[index - 1], file) >= 0,
      )
    ) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        "merge-review files are not in stable candidate/path order",
      );
    }
    return files;
  }
  return files.sort((left, right) => compareFiles(candidateOrder, left, right));
}

function planMaterial(review) {
  return {
    schema: TEAM_MERGE_REVIEW_SCHEMA,
    schemaVersion: TEAM_MERGE_REVIEW_SCHEMA_VERSION,
    base: review.base,
    candidates: review.candidates,
    files: review.files,
  };
}

export function computeMergeReviewPlanDigest(review) {
  return digestMergeReview(
    "cc-team-merge-review-plan-v1",
    planMaterial(review),
  );
}

export function computeMergeReviewId(planDigest, createdAt) {
  const digest = digestMergeReview("cc-team-merge-review-id-v1", {
    planDigest: normalizeDigest(planDigest, "planDigest"),
    createdAt: timestamp(createdAt, "createdAt"),
  });
  return `tmr_${digest.slice(
    "sha256:".length,
    "sha256:".length + ID_HEX_LENGTH,
  )}`;
}

function decisionMaterial(planDigest, decision) {
  return {
    planDigest,
    actor: decision.actor,
    host: decision.host,
    reason: decision.reason,
    decidedAt: decision.decidedAt,
    selectedFileIds: decision.selectedFileIds,
    selectedHunkIds: decision.selectedHunkIds,
  };
}

export function computeMergeReviewDecisionDigest(planDigest, decision) {
  return digestMergeReview(
    "cc-team-merge-review-decision-v1",
    decisionMaterial(planDigest, decision),
  );
}

function selectionOrder(review) {
  const fileOrder = new Map();
  const hunkOrder = new Map();
  let hunkIndex = 0;
  review.files.forEach((file, index) => {
    fileOrder.set(file.id, index);
    for (const hunk of file.hunks) hunkOrder.set(hunk.id, hunkIndex++);
  });
  return { fileOrder, hunkOrder };
}

function normalizeSelectionIds(values, label, pattern, order) {
  assertDenseArray(values, label);
  const seen = new Set();
  const normalized = values.map((value) => {
    if (
      typeof value !== "string" ||
      !pattern.test(value) ||
      !order.has(value)
    ) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.BINDING,
        `${label} contains an ID outside the exact review plan`,
      );
    }
    if (seen.has(value)) {
      fail(TEAM_MERGE_REVIEW_ERROR.INVALID, `${label} contains a duplicate ID`);
    }
    seen.add(value);
    return value;
  });
  normalized.sort((left, right) => order.get(left) - order.get(right));
  return normalized;
}

function normalizeDecision(
  value,
  review,
  { strict = false, decidedAt = undefined } = {},
) {
  if (value == null) return null;
  if (strict) assertExactKeys(value, DECISION_KEYS, "merge-review decision");
  else assertPlainObject(value, "merge-review decision");
  const { fileOrder, hunkOrder } = selectionOrder(review);
  const selectedFileIds = normalizeSelectionIds(
    value.selectedFileIds || [],
    "decision.selectedFileIds",
    FILE_ID,
    fileOrder,
  );
  const selectedHunkIds = normalizeSelectionIds(
    value.selectedHunkIds || [],
    "decision.selectedHunkIds",
    HUNK_ID,
    hunkOrder,
  );
  if (
    strict &&
    (canonicalMergeReviewJson(value.selectedFileIds) !==
      canonicalMergeReviewJson(selectedFileIds) ||
      canonicalMergeReviewJson(value.selectedHunkIds) !==
        canonicalMergeReviewJson(selectedHunkIds))
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review decision selections are not in stable plan order",
    );
  }
  if (selectedFileIds.length + selectedHunkIds.length === 0) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review decision must select at least one file or hunk",
    );
  }
  if (
    selectedFileIds.length + selectedHunkIds.length >
    TEAM_MERGE_REVIEW_LIMITS.selectionIds
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.LIMIT,
      `merge-review decision exceeds ${TEAM_MERGE_REVIEW_LIMITS.selectionIds} selected IDs`,
    );
  }
  const wholeFiles = new Set(selectedFileIds);
  for (const file of review.files) {
    if (
      wholeFiles.has(file.id) &&
      file.hunks.some((hunk) => selectedHunkIds.includes(hunk.id))
    ) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        `decision selects both whole file and hunk for ${file.path}`,
      );
    }
  }
  const decision = {
    actor: boundedDecisionText(
      value.actor,
      "decision.actor",
      TEAM_MERGE_REVIEW_LIMITS.actorBytes,
      { strict },
    ),
    host: boundedIdentity(
      value.host,
      "decision.host",
      TEAM_MERGE_REVIEW_LIMITS.hostBytes,
    ),
    reason: boundedDecisionText(
      value.reason,
      "decision.reason",
      TEAM_MERGE_REVIEW_LIMITS.reasonBytes,
      { strict },
    ),
    decidedAt: timestamp(
      strict ? value.decidedAt : (decidedAt ?? value.decidedAt),
      "decision.decidedAt",
      { strict },
    ),
    selectedFileIds,
    selectedHunkIds,
  };
  decision.digest = computeMergeReviewDecisionDigest(
    review.planDigest,
    decision,
  );
  if (strict && decision.digest !== value.digest) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      "merge-review decision digest does not bind the current plan and selection",
    );
  }
  return decision;
}

export function computeMergeReviewConflictsDigest(conflicts) {
  return digestMergeReview("cc-team-merge-review-conflicts-v1", conflicts);
}

function compareConflicts(fileOrder, left, right) {
  return (
    fileOrder.get(`${left.candidateKey}\0${left.path}`) -
      fileOrder.get(`${right.candidateKey}\0${right.path}`) ||
    left.type.localeCompare(right.type) ||
    left.hunkIds.join("\0").localeCompare(right.hunkIds.join("\0"))
  );
}

function normalizeConflicts(values, review, { strict = false } = {}) {
  assertDenseArray(values, "merge-review conflicts");
  if (values.length > TEAM_MERGE_REVIEW_LIMITS.conflicts) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.LIMIT,
      `merge-review cannot exceed ${TEAM_MERGE_REVIEW_LIMITS.conflicts} conflicts`,
    );
  }
  const candidates = new Set(
    review.candidates.map((candidate) => candidate.key),
  );
  const files = new Map(
    review.files.map((file) => [`${file.candidateKey}\0${file.path}`, file]),
  );
  const fileOrder = new Map(
    review.files.map((file, index) => [
      `${file.candidateKey}\0${file.path}`,
      index,
    ]),
  );
  const selectedFiles = new Set(review.decision?.selectedFileIds || []);
  const selectedHunks = new Set(review.decision?.selectedHunkIds || []);
  let totalTextBytes = 0;
  let totalHunkRefs = 0;
  const seen = new Set();
  const conflicts = values.map((value, index) => {
    if (strict) assertExactKeys(value, CONFLICT_KEYS, `conflict[${index}]`);
    else assertPlainObject(value, `conflict[${index}]`);
    const candidateKey = boundedIdentity(
      value.candidateKey,
      `conflict[${index}].candidateKey`,
      TEAM_MERGE_REVIEW_LIMITS.keyBytes,
    );
    if (!candidates.has(candidateKey)) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.BINDING,
        `conflict[${index}] refers to an unknown candidate`,
      );
    }
    const conflictPath = normalizePath(value.path, `conflict[${index}].path`, {
      strict,
    });
    const file = files.get(`${candidateKey}\0${conflictPath}`);
    if (!file) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.BINDING,
        `conflict[${index}] refers to a file outside the exact review plan`,
      );
    }
    const type = boundedIdentity(
      value.type,
      `conflict[${index}].type`,
      TEAM_MERGE_REVIEW_LIMITS.conflictTypeBytes,
    );
    if (!/^[a-z][a-z0-9_-]*$/u.test(type)) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        `conflict[${index}].type is not a stable identifier`,
      );
    }
    const explanation = boundedDecisionText(
      value.explanation,
      `conflict[${index}].explanation`,
      TEAM_MERGE_REVIEW_LIMITS.conflictTextBytes,
      { strict },
    );
    const suggestion = boundedDecisionText(
      value.suggestion,
      `conflict[${index}].suggestion`,
      TEAM_MERGE_REVIEW_LIMITS.conflictTextBytes,
      { strict },
    );
    totalTextBytes += byteLength(explanation) + byteLength(suggestion);
    if (totalTextBytes > TEAM_MERGE_REVIEW_LIMITS.totalConflictTextBytes) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.LIMIT,
        "merge-review conflict text exceeds its total byte budget",
      );
    }
    const hunkOrder = new Map(
      file.hunks.map((hunk, hunkIndex) => [hunk.id, hunkIndex]),
    );
    const hunkIds = normalizeSelectionIds(
      value.hunkIds,
      `conflict[${index}].hunkIds`,
      HUNK_ID,
      hunkOrder,
    );
    if (
      strict &&
      canonicalMergeReviewJson(value.hunkIds) !==
        canonicalMergeReviewJson(hunkIds)
    ) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        `conflict[${index}].hunkIds are not in stable file order`,
      );
    }
    totalHunkRefs += hunkIds.length;
    if (totalHunkRefs > TEAM_MERGE_REVIEW_LIMITS.conflictHunkRefs) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.LIMIT,
        "merge-review conflicts exceed their hunk-reference budget",
      );
    }
    if (
      (hunkIds.length === 0 && !selectedFiles.has(file.id)) ||
      hunkIds.some((hunkId) => !selectedHunks.has(hunkId))
    ) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.BINDING,
        `conflict[${index}] is outside the persisted selection decision`,
      );
    }
    const identity = `${candidateKey}\0${conflictPath}\0${type}\0${hunkIds.join("\0")}`;
    if (seen.has(identity)) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.INVALID,
        "merge-review contains duplicate conflict identities",
      );
    }
    seen.add(identity);
    return {
      candidateKey,
      path: conflictPath,
      type,
      explanation,
      suggestion,
      hunkIds,
    };
  });
  conflicts.sort((left, right) => compareConflicts(fileOrder, left, right));
  if (
    strict &&
    canonicalMergeReviewJson(values) !== canonicalMergeReviewJson(conflicts)
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review conflicts are not in stable plan order",
    );
  }
  return conflicts;
}

/** Normalize readable conflict evidence against an already persisted decision. */
export function canonicalizeMergeReviewConflicts(reviewValue, conflicts) {
  const review = validateMergeReview(reviewValue);
  return normalizeConflicts(conflicts, review);
}

function emptySettlement() {
  return {
    preparedOid: null,
    publishedOid: null,
    rollbackOid: null,
    conflictDigest: null,
    transitionEvidenceDigest: null,
  };
}

function normalizeSettlement(value, state, { strict = false } = {}) {
  if (strict) {
    assertExactKeys(value, SETTLEMENT_KEYS, "merge-review settlement");
  } else {
    assertPlainObject(value, "merge-review settlement");
  }
  const settlement = {
    preparedOid: normalizeOid(value.preparedOid, "settlement.preparedOid", {
      nullable: true,
      strict,
    }),
    publishedOid: normalizeOid(value.publishedOid, "settlement.publishedOid", {
      nullable: true,
      strict,
    }),
    rollbackOid: normalizeOid(value.rollbackOid, "settlement.rollbackOid", {
      nullable: true,
      strict,
    }),
    conflictDigest: normalizeDigest(
      value.conflictDigest,
      "settlement.conflictDigest",
      { nullable: true, strict },
    ),
    transitionEvidenceDigest: normalizeDigest(
      value.transitionEvidenceDigest,
      "settlement.transitionEvidenceDigest",
      { nullable: true, strict },
    ),
  };
  if (
    state === "planned" &&
    canonicalMergeReviewJson(settlement) !==
      canonicalMergeReviewJson(emptySettlement())
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "planned merge-review cannot carry settlement evidence",
    );
  }
  if (state !== "rolled_back" && settlement.rollbackOid) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${state} merge-review cannot carry rollbackOid`,
    );
  }
  if (
    settlement.publishedOid &&
    !["published", "rollback_required", "rolled_back"].includes(state)
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${state} merge-review cannot carry publishedOid`,
    );
  }
  if (
    settlement.conflictDigest &&
    !["conflicted", "rolled_back"].includes(state)
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${state} merge-review cannot carry conflictDigest`,
    );
  }
  if (settlement.conflictDigest && settlement.publishedOid) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review cannot be both conflicted and published",
    );
  }
  if (
    settlement.publishedOid &&
    settlement.preparedOid &&
    settlement.publishedOid !== settlement.preparedOid
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      "publishedOid must be the exact preparedOid",
    );
  }
  if (
    ["prepared", "publishing", "published"].includes(state) &&
    !settlement.preparedOid
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${state} merge-review requires preparedOid`,
    );
  }
  if (state === "published" && !settlement.publishedOid) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "published merge-review requires publishedOid",
    );
  }
  if (state === "conflicted" && !settlement.conflictDigest) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "conflicted merge-review requires conflictDigest",
    );
  }
  if (state === "rolled_back" && !settlement.rollbackOid) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "rolled_back merge-review requires rollbackOid",
    );
  }
  if (
    ["rollback_required", "rolled_back"].includes(state) &&
    !settlement.conflictDigest &&
    !settlement.preparedOid
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${state} merge-review requires prepared or conflict evidence`,
    );
  }
  if (state !== "planned" && !settlement.transitionEvidenceDigest) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${state} merge-review requires transition evidence`,
    );
  }
  return settlement;
}

function reviewEvidenceMaterial(review) {
  const material = { ...review };
  delete material.evidenceDigest;
  return material;
}

export function computeMergeReviewEvidenceDigest(review) {
  return digestMergeReview(
    "cc-team-merge-review-evidence-v1",
    reviewEvidenceMaterial(review),
  );
}

function finalizeEvidence(review) {
  review.evidenceDigest = computeMergeReviewEvidenceDigest(review);
  return review;
}

/** Build a canonical planned review. Candidate array order is merge order. */
export function buildMergeReview(input = {}) {
  assertPlainObject(input, "merge-review input");
  if (Object.hasOwn(input, "decision")) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "persist merge-review selections with applyMergeReviewDecision",
    );
  }
  const base = normalizeBase(input.base);
  const candidates = normalizeCandidates(input.candidates);
  const files = normalizeFiles(input.files, base, candidates);
  const createdAt = timestamp(input.createdAt || new Date(), "createdAt");
  const review = {
    schema: TEAM_MERGE_REVIEW_SCHEMA,
    schemaVersion: TEAM_MERGE_REVIEW_SCHEMA_VERSION,
    reviewId: "",
    revision: 0,
    state: TEAM_MERGE_REVIEW_STATE.PLANNED,
    base,
    candidates,
    files,
    decision: null,
    conflicts: [],
    planDigest: "",
    evidenceDigest: "",
    settlement: emptySettlement(),
    createdAt,
    updatedAt: createdAt,
  };
  review.planDigest = computeMergeReviewPlanDigest(review);
  review.reviewId = computeMergeReviewId(review.planDigest, review.createdAt);
  return finalizeEvidence(review);
}

/** Strictly validate and detach a persisted/public review record. */
export function validateMergeReview(value) {
  assertExactKeys(value, REVIEW_KEYS, "merge-review record");
  if (
    value.schema !== TEAM_MERGE_REVIEW_SCHEMA ||
    value.schemaVersion !== TEAM_MERGE_REVIEW_SCHEMA_VERSION
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "unsupported merge-review schema/version pair",
    );
  }
  if (typeof value.reviewId !== "string" || !REVIEW_ID.test(value.reviewId)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, "merge-review reviewId is invalid");
  }
  const revision = nonNegativeInteger(value.revision, "revision", {
    strict: true,
  });
  const state = value.state;
  if (typeof state !== "string" || !STATES.has(state)) {
    fail(TEAM_MERGE_REVIEW_ERROR.INVALID, "merge-review state is invalid");
  }
  const base = normalizeBase(value.base, { strict: true });
  const candidates = normalizeCandidates(value.candidates, { strict: true });
  const files = normalizeFiles(value.files, base, candidates, { strict: true });
  const createdAt = timestamp(value.createdAt, "createdAt", { strict: true });
  const updatedAt = timestamp(value.updatedAt, "updatedAt", { strict: true });
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review updatedAt precedes createdAt",
    );
  }
  const review = {
    schema: TEAM_MERGE_REVIEW_SCHEMA,
    schemaVersion: TEAM_MERGE_REVIEW_SCHEMA_VERSION,
    reviewId: value.reviewId,
    revision,
    state,
    base,
    candidates,
    files,
    decision: null,
    conflicts: [],
    planDigest: normalizeDigest(value.planDigest, "planDigest"),
    evidenceDigest: normalizeDigest(value.evidenceDigest, "evidenceDigest"),
    settlement: normalizeSettlement(value.settlement, state, { strict: true }),
    createdAt,
    updatedAt,
  };
  const expectedPlan = computeMergeReviewPlanDigest(review);
  if (review.planDigest !== expectedPlan) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      "merge-review plan digest does not bind its exact inputs",
    );
  }
  const expectedId = computeMergeReviewId(expectedPlan, review.createdAt);
  if (review.reviewId !== expectedId) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      "merge-review reviewId does not bind its plan",
    );
  }
  review.decision = normalizeDecision(value.decision, review, { strict: true });
  review.conflicts = normalizeConflicts(value.conflicts, review, {
    strict: true,
  });
  if (
    review.decision &&
    (Date.parse(review.decision.decidedAt) < Date.parse(createdAt) ||
      Date.parse(review.decision.decidedAt) > Date.parse(updatedAt) ||
      (state === "planned" && review.decision.decidedAt !== updatedAt))
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review decision timestamp is outside its revision history",
    );
  }
  if (
    state === "planned" &&
    ((!review.decision && revision !== 0) ||
      (review.decision && revision !== 1))
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "planned merge-review revision does not match its decision state",
    );
  }
  if (
    ["prepared", "publishing", "published", "conflicted"].includes(state) &&
    !review.decision
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `${state} merge-review requires a selection decision`,
    );
  }
  if (review.settlement.preparedOid && !review.decision) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "prepared merge-review evidence requires a selection decision",
    );
  }
  if (
    (state === "conflicted" && review.conflicts.length === 0) ||
    (review.conflicts.length > 0 &&
      !["conflicted", "rolled_back"].includes(state)) ||
    (review.conflicts.length > 0 && !review.decision)
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review conflict evidence does not match its state/decision",
    );
  }
  const expectedConflictDigest =
    review.conflicts.length > 0
      ? computeMergeReviewConflictsDigest(review.conflicts)
      : null;
  if (review.settlement.conflictDigest !== expectedConflictDigest) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      "merge-review conflictDigest does not bind its canonical conflicts",
    );
  }
  const expectedEvidence = computeMergeReviewEvidenceDigest(review);
  if (review.evidenceDigest !== expectedEvidence) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      "merge-review evidence digest does not bind its current revision",
    );
  }
  return review;
}

function requireRevision(review, expectedRevision) {
  const expected = nonNegativeInteger(expectedRevision, "expectedRevision");
  if (review.revision !== expected) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.STALE,
      `merge-review revision ${expected} is stale; current revision is ${review.revision}`,
      {
        reviewId: review.reviewId,
        expectedRevision: expected,
        revision: review.revision,
      },
    );
  }
}

/** Persist the human selection before any staging mutation begins. */
export function applyMergeReviewDecision(value, request = {}) {
  const review = validateMergeReview(value);
  requireRevision(review, request.expectedRevision);
  if (review.state !== TEAM_MERGE_REVIEW_STATE.PLANNED) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.TRANSITION,
      `cannot decide a merge-review in state ${review.state}`,
    );
  }
  if (review.decision) {
    const decision = normalizeDecision(request, review, {
      decidedAt: review.decision.decidedAt,
    });
    if (review.decision.digest === decision.digest) return review;
    fail(
      TEAM_MERGE_REVIEW_ERROR.TRANSITION,
      "merge-review already has a different immutable decision",
    );
  }
  const updatedAt = timestamp(request.at || new Date(), "decision.at");
  if (Date.parse(updatedAt) < Date.parse(review.updatedAt)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review decision timestamp moves backwards",
    );
  }
  const decision = normalizeDecision(request, review, { decidedAt: updatedAt });
  return finalizeEvidence({
    ...review,
    revision: review.revision + 1,
    decision,
    updatedAt,
  });
}

function transitionSettlement(review, to, request) {
  const next = { ...review.settlement };
  const assignments = [
    ["preparedOid", "prepared", normalizeOid],
    ["publishedOid", "published", normalizeOid],
    ["rollbackOid", "rolled_back", normalizeOid],
    ["conflictDigest", "conflicted", normalizeDigest],
  ];
  for (const [field, targetState, normalize] of assignments) {
    if (request[field] === undefined) continue;
    if (to !== targetState) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.TRANSITION,
        `${field} may only be recorded while entering ${targetState}`,
      );
    }
    const value = normalize(request[field], field, { nullable: true });
    if (next[field] !== null && next[field] !== value) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.TRANSITION,
        `${field} is immutable once recorded`,
      );
    }
    next[field] = value;
  }
  next.transitionEvidenceDigest = normalizeDigest(
    request.transitionEvidenceDigest,
    "transitionEvidenceDigest",
  );
  return normalizeSettlement(next, to);
}

/** Advance one exact-CAS state transition and bind its settlement evidence. */
export function transitionMergeReview(value, request = {}) {
  const review = validateMergeReview(value);
  requireRevision(review, request.expectedRevision);
  const to = String(request.to || "");
  if (!STATES.has(to) || !TRANSITIONS.get(review.state)?.has(to)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.TRANSITION,
      `illegal merge-review transition ${review.state} -> ${to || "(empty)"}`,
    );
  }
  if (
    ["prepared", "publishing", "published", "conflicted"].includes(to) &&
    !review.decision
  ) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.TRANSITION,
      `merge-review must persist a decision before ${to}`,
    );
  }
  let conflicts = review.conflicts;
  if (to === "conflicted") {
    if (!Object.hasOwn(request, "conflicts")) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.TRANSITION,
        "entering conflicted requires durable conflict evidence",
      );
    }
    conflicts = normalizeConflicts(request.conflicts, review);
    if (conflicts.length === 0) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.TRANSITION,
        "entering conflicted requires at least one conflict",
      );
    }
  } else if (Object.hasOwn(request, "conflicts")) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.TRANSITION,
      "conflicts may only be recorded while entering conflicted",
    );
  }
  const updatedAt = timestamp(request.at || new Date(), "transition.at");
  if (Date.parse(updatedAt) < Date.parse(review.updatedAt)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      "merge-review transition timestamp moves backwards",
    );
  }
  const settlement = transitionSettlement(review, to, request);
  const expectedConflictDigest =
    conflicts.length > 0 ? computeMergeReviewConflictsDigest(conflicts) : null;
  if (settlement.conflictDigest !== expectedConflictDigest) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      "conflictDigest must match the canonical durable conflicts",
    );
  }
  return finalizeEvidence({
    ...review,
    revision: review.revision + 1,
    state: to,
    conflicts,
    settlement,
    updatedAt,
  });
}

/** Verify that a replayed store event is the sole legal successor. */
export function assertMergeReviewSuccessor(previousValue, nextValue, type) {
  const previous = validateMergeReview(previousValue);
  const next = validateMergeReview(nextValue);
  let expected;
  if (type === "review.decided") {
    if (!next.decision) {
      fail(
        TEAM_MERGE_REVIEW_ERROR.TRANSITION,
        "invalid merge-review decision successor",
      );
    }
    expected = applyMergeReviewDecision(previous, {
      expectedRevision: previous.revision,
      actor: next.decision.actor,
      host: next.decision.host,
      reason: next.decision.reason,
      selectedFileIds: next.decision.selectedFileIds,
      selectedHunkIds: next.decision.selectedHunkIds,
      at: next.updatedAt,
    });
  } else if (type === "review.transitioned") {
    const request = {
      expectedRevision: previous.revision,
      to: next.state,
      at: next.updatedAt,
      transitionEvidenceDigest: next.settlement.transitionEvidenceDigest,
    };
    const targetField = {
      prepared: "preparedOid",
      published: "publishedOid",
      conflicted: "conflictDigest",
      rolled_back: "rollbackOid",
    }[next.state];
    if (targetField) {
      request[targetField] = next.settlement[targetField];
    }
    if (next.state === "conflicted") request.conflicts = next.conflicts;
    expected = transitionMergeReview(previous, request);
  } else {
    fail(
      TEAM_MERGE_REVIEW_ERROR.INVALID,
      `unsupported merge-review successor event ${String(type)}`,
    );
  }
  if (canonicalMergeReviewJson(expected) !== canonicalMergeReviewJson(next)) {
    fail(
      TEAM_MERGE_REVIEW_ERROR.BINDING,
      "merge-review successor is not the exact legal CAS result",
    );
  }
  return next;
}
