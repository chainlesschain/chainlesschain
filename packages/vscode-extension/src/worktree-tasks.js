/**
 * Worktree parallel tasks (P1 #9) — pure logic for the Worktree Tasks panel.
 * Enumerates the repo's agent task worktrees (`cc agent --worktree` →
 * cc-agent-*, `cc batch` → batch/*, team isolation → agent/*), sizes their
 * changes, consumes the CLI-authored team merge-review protocol, and builds
 * the argv for discard plus the `cc agent --worktree` terminal command for a
 * NEW isolated task. Git remains read-only here except for the existing,
 * explicitly-confirmed discard path. Merge preview/apply/rollback authority is
 * owned by `cc team merge-review`; the extension only validates and renders
 * its versioned projection and sends stable IDs back to the CLI.
 */

const TASK_BRANCH_RE = /^(cc-agent-|batch\/|agent\/|team\/)/;
const MERGE_REVIEW_SCHEMA = "chainlesschain.team-merge-review/v1";
const MERGE_REVIEW_SCHEMA_VERSION = 1;
const MERGE_REVIEW_OPERATIONS = new Set([
  "preview",
  "show",
  "apply",
  "rollback",
]);
const MERGE_REVIEW_STATES = new Set([
  "planned",
  "prepared",
  "publishing",
  "published",
  "conflicted",
  "rollback_required",
  "rolled_back",
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REVIEW_ID_PATTERN = /^tmr_[a-f0-9]{32}$/;
const FILE_ID_PATTERN = /^tmrf_[a-f0-9]{32}$/;
const HUNK_ID_PATTERN = /^tmrh_[a-f0-9]{32}$/;
const GIT_OID_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const MAX_CANDIDATES = 256;
const MAX_FILES = 4096;
const MAX_HUNKS = 20000;
const MAX_SELECTION_IDS = 100;
const MAX_CONFLICTS = 4096;
const MAX_ACTION_ARGS = 4096;

function isTaskBranch(branch) {
  return TASK_BRANCH_RE.test(String(branch || ""));
}

/** `git worktree list --porcelain`. */
function buildWorktreeListArgs() {
  return ["worktree", "list", "--porcelain"];
}

/** `cc daemon view --json` - bounded supervisor/governance snapshot. */
function buildBackgroundListArgs() {
  return ["daemon", "view", "--json"];
}

/**
 * Parse `git worktree list --porcelain` into rows. The FIRST entry is the
 * main checkout; `isTask` marks agent-task branches. Bare/detached entries
 * are kept (branch "") so the caller can ignore them explicitly.
 */
function parseWorktreeList(text) {
  const rows = [];
  let current = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) rows.push(current);
      current = { path: line.slice(9).trim(), branch: "", head: "" };
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).trim().replace("refs/heads/", "");
    }
  }
  if (current) rows.push(current);
  return rows.map((r, i) => ({
    ...r,
    main: i === 0,
    isTask: isTaskBranch(r.branch),
  }));
}

/** `git status --porcelain` (run inside the worktree) — dirty check. */
function buildStatusArgs() {
  return ["status", "--porcelain"];
}

/** `git rev-list --count <mainHead>..<branch>` — commits the task is ahead. */
function buildAheadArgs(mainHead, branch) {
  return ["rev-list", "--count", `${mainHead}..${branch}`];
}

/** `git diff --shortstat <mainHead>...<branch>` — change footprint. */
function buildShortstatArgs(mainHead, branch) {
  return ["diff", "--shortstat", `${mainHead}...${branch}`];
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireExactKeys(value, required, optional = []) {
  if (!plainObject(value)) throw new Error("invalid merge-review object");
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error("merge-review object has missing or unknown fields");
  }
}

function authorityString(value, max = 512) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    return null;
  }
  return value;
}

function authorityId(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function authorityDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value) ? value : null;
}

function authorityRevision(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function authorityOid(value) {
  return typeof value === "string" && GIT_OID_PATTERN.test(value)
    ? value
    : null;
}

function authorityTimestamp(value) {
  const timestamp = authorityString(value, 64);
  return timestamp &&
    ISO_TIMESTAMP_PATTERN.test(timestamp) &&
    Number.isFinite(Date.parse(timestamp))
    ? timestamp
    : null;
}

function readOidRecord(value, requiredKeys, label) {
  if (!plainObject(value)) throw new Error(`invalid ${label}`);
  const hasOid = hasOwn(value, "oid");
  const hasCommitOid = hasOwn(value, "commitOid");
  if (hasOid === hasCommitOid) throw new Error(`invalid ${label} oid fields`);
  requireExactKeys(value, [...requiredKeys, hasOid ? "oid" : "commitOid"]);
  const oid = authorityOid(hasOid ? value.oid : value.commitOid);
  if (!oid) throw new Error(`invalid ${label} oid`);
  return oid;
}

function optionalAuthorityString(value, max = 512) {
  if (value == null) return null;
  return authorityString(value, max);
}

function requiredAuthorityString(value, label, max = 512) {
  const normalized = authorityString(value, max);
  if (!normalized) throw new Error(`invalid ${label}`);
  return normalized;
}

function requiredAuthorityId(value, label, pattern) {
  const normalized = authorityId(value, pattern);
  if (!normalized) throw new Error(`invalid ${label}`);
  return normalized;
}

function requiredAuthorityDigest(value, label) {
  const normalized = authorityDigest(value);
  if (!normalized) throw new Error(`invalid ${label}`);
  return normalized;
}

function requiredAuthorityRevision(value) {
  const normalized = authorityRevision(value);
  if (normalized == null) throw new Error("invalid merge-review revision");
  return normalized;
}

function optionalArg(args, flag, value, label, max = 512) {
  if (value == null) return;
  args.push(flag, requiredAuthorityString(value, label, max));
}

function uniqueIds(values, pattern, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new Error(`invalid ${label}`);
  }
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const id = requiredAuthorityId(value, label, pattern);
    if (seen.has(id)) throw new Error(`duplicate ${label}`);
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** CLI-authoritative merge-review preview; branches are stable branch names. */
function buildMergeReviewPreviewArgs({
  branches,
  branch,
  base,
  stateDir,
  actor,
  reason,
} = {}) {
  const requested = Array.isArray(branches)
    ? branches
    : branch == null
      ? []
      : [branch];
  if (requested.length === 0 || requested.length > MAX_CANDIDATES) {
    throw new Error("at least one bounded merge-review branch is required");
  }
  const seen = new Set();
  const args = ["team", "merge-review", "preview"];
  for (const value of requested) {
    const name = requiredAuthorityString(value, "merge-review branch", 512);
    if (seen.has(name)) throw new Error("duplicate merge-review branch");
    seen.add(name);
    args.push("--branch", name);
  }
  optionalArg(args, "--base", base, "merge-review base branch", 512);
  optionalArg(
    args,
    "--state-dir",
    stateDir,
    "merge-review state directory",
    4096,
  );
  optionalArg(args, "--actor", actor, "merge-review actor", 160);
  optionalArg(args, "--reason", reason, "merge-review reason", 500);
  args.push("--json");
  return args;
}

function buildMergeReviewShowArgs(reviewId, { stateDir } = {}) {
  const args = [
    "team",
    "merge-review",
    "show",
    requiredAuthorityId(reviewId, "merge-review id", REVIEW_ID_PATTERN),
  ];
  optionalArg(
    args,
    "--state-dir",
    stateDir,
    "merge-review state directory",
    4096,
  );
  args.push("--json");
  return args;
}

function buildMergeReviewApplyArgs({
  reviewId,
  revision,
  planDigest,
  fileIds = [],
  hunkIds = [],
  stateDir,
  actor,
  reason,
} = {}) {
  const files = uniqueIds(fileIds, FILE_ID_PATTERN, "merge-review file id");
  const hunks = uniqueIds(hunkIds, HUNK_ID_PATTERN, "merge-review hunk id");
  if (files.length + hunks.length === 0) {
    throw new Error("at least one selected file or hunk id is required");
  }
  if (files.length + hunks.length > MAX_SELECTION_IDS) {
    throw new Error(`at most ${MAX_SELECTION_IDS} selected IDs are allowed`);
  }
  const args = [
    "team",
    "merge-review",
    "apply",
    requiredAuthorityId(reviewId, "merge-review id", REVIEW_ID_PATTERN),
    "--revision",
    String(requiredAuthorityRevision(revision)),
    "--plan-digest",
    requiredAuthorityDigest(planDigest, "merge-review plan digest"),
  ];
  optionalArg(
    args,
    "--state-dir",
    stateDir,
    "merge-review state directory",
    4096,
  );
  for (const id of files) args.push("--file-id", id);
  for (const id of hunks) args.push("--hunk-id", id);
  optionalArg(args, "--actor", actor, "merge-review actor", 160);
  optionalArg(args, "--reason", reason, "merge-review reason", 500);
  args.push("--json");
  return args;
}

function buildMergeReviewRollbackArgs({
  reviewId,
  revision,
  evidenceDigest,
  stateDir,
} = {}) {
  const id = requiredAuthorityId(
    reviewId,
    "merge-review id",
    REVIEW_ID_PATTERN,
  );
  const args = [
    "team",
    "merge-review",
    "rollback",
    id,
    "--revision",
    String(requiredAuthorityRevision(revision)),
    "--evidence-digest",
    requiredAuthorityDigest(evidenceDigest, "merge-review evidence digest"),
    "--confirm",
    id,
  ];
  optionalArg(
    args,
    "--state-dir",
    stateDir,
    "merge-review state directory",
    4096,
  );
  args.push("--json");
  return args;
}

/** Discard step 1: `git worktree remove --force <path>`. */
function buildWorktreeRemoveArgs(path) {
  return ["worktree", "remove", "--force", String(path)];
}

/** Discard step 2: `git branch -D <branch>`. */
function buildBranchDeleteArgs(branch) {
  return ["branch", "-D", String(branch)];
}

function invalidMergeReview(error) {
  return { ok: false, error: String(error || "invalid merge-review payload") };
}

function parseDecision(value) {
  if (value == null) return null;
  requireExactKeys(value, ["actor", "reason", "host", "decidedAt"]);
  const actor = requiredAuthorityString(value.actor, "decision actor", 160);
  const reason = requiredAuthorityString(value.reason, "decision reason", 500);
  const host = requiredAuthorityString(value.host, "decision host", 256);
  const decidedAt = authorityTimestamp(value.decidedAt);
  if (!decidedAt) throw new Error("invalid decision timestamp");
  return { actor, reason, host, decidedAt };
}

function parseMergeReviewAction(value, reviewId) {
  requireExactKeys(value, ["id", "enabled", "argv", "reason"]);
  const id = requiredAuthorityString(value.id, "merge-review action id", 32);
  if (!MERGE_REVIEW_OPERATIONS.has(id)) {
    throw new Error("unknown merge-review action");
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error("invalid merge-review action enabled flag");
  }
  if (!Array.isArray(value.argv) || value.argv.length > 256) {
    throw new Error("invalid merge-review action argv");
  }
  const argv = value.argv.map((arg) =>
    requiredAuthorityString(arg, "merge-review action argv", MAX_ACTION_ARGS),
  );
  if (argv.length === 0) {
    if (value.enabled)
      throw new Error("enabled merge-review action has no argv");
  } else {
    if (
      argv.length < 3 ||
      argv[0] !== "team" ||
      argv[1] !== "merge-review" ||
      argv[2] !== id ||
      ((id === "show" || id === "apply" || id === "rollback") &&
        argv[3] !== reviewId)
    ) {
      throw new Error("merge-review action argv crosses its declared boundary");
    }
  }
  const reason = optionalAuthorityString(value.reason, 500);
  if (!(value.reason === null || reason)) {
    throw new Error("invalid merge-review action reason");
  }
  return { id, enabled: value.enabled, argv, reason };
}

/**
 * Strictly parse the CLI-owned `chainlesschain.team-merge-review/v1`
 * projection. Unknown schema/version/state/operation, duplicate stable IDs,
 * dangling selections, malformed digests and arbitrary action argv all fail
 * closed. No patch bytes or raw git command are accepted by this boundary.
 */
function parseMergeReview(input, { expectedOperation } = {}) {
  let payload = input;
  if (typeof input === "string") {
    try {
      payload = JSON.parse(input);
    } catch {
      return invalidMergeReview("merge-review output is not JSON");
    }
  }
  try {
    if (!plainObject(payload))
      throw new Error("merge-review output is not an object");
    if (
      payload.schema !== MERGE_REVIEW_SCHEMA ||
      payload.schemaVersion !== MERGE_REVIEW_SCHEMA_VERSION
    ) {
      throw new Error("unsupported merge-review schema or schemaVersion");
    }
    const operation = requiredAuthorityString(
      payload.operation,
      "merge-review operation",
      32,
    );
    if (
      !MERGE_REVIEW_OPERATIONS.has(operation) ||
      (expectedOperation && operation !== expectedOperation)
    ) {
      throw new Error("unexpected merge-review operation");
    }
    if (hasOwn(payload, "error")) {
      requireExactKeys(payload, [
        "schema",
        "schemaVersion",
        "operation",
        "error",
      ]);
      requireExactKeys(payload.error, ["code", "message"]);
      const code = requiredAuthorityString(
        payload.error.code,
        "merge-review error code",
        128,
      );
      const message = requiredAuthorityString(
        payload.error.message,
        "merge-review error message",
        4096,
      );
      return invalidMergeReview(`${code}: ${message}`);
    }
    requireExactKeys(payload, [
      "schema",
      "schemaVersion",
      "operation",
      "review",
      "actions",
    ]);
    if (!plainObject(payload.review))
      throw new Error("missing merge-review record");
    const source = payload.review;
    requireExactKeys(source, [
      "reviewId",
      "revision",
      "state",
      "base",
      "candidates",
      "files",
      "selection",
      "conflicts",
      "decision",
      "planDigest",
      "evidenceDigest",
      "createdAt",
      "updatedAt",
      "details",
    ]);
    const reviewId = requiredAuthorityId(
      source.reviewId,
      "merge-review id",
      REVIEW_ID_PATTERN,
    );
    const revision = requiredAuthorityRevision(source.revision);
    const state = requiredAuthorityString(
      source.state,
      "merge-review state",
      32,
    );
    if (!MERGE_REVIEW_STATES.has(state))
      throw new Error("unknown merge-review state");
    if (!plainObject(source.base)) throw new Error("invalid merge-review base");
    const base = {
      branch: requiredAuthorityString(
        source.base.branch,
        "merge-review base branch",
        512,
      ),
      oid: readOidRecord(source.base, ["branch"], "merge-review base"),
    };

    if (
      !Array.isArray(source.candidates) ||
      source.candidates.length === 0 ||
      source.candidates.length > MAX_CANDIDATES
    ) {
      throw new Error("invalid merge-review candidates");
    }
    const candidateKeys = new Set();
    const candidates = source.candidates.map((candidate) => {
      if (!plainObject(candidate))
        throw new Error("invalid merge-review candidate");
      const key = requiredAuthorityString(candidate.key, "candidate key", 256);
      if (candidateKeys.has(key))
        throw new Error("duplicate merge-review candidate key");
      candidateKeys.add(key);
      const oid = readOidRecord(
        candidate,
        ["key", "branch"],
        "merge-review candidate",
      );
      return {
        key,
        branch: requiredAuthorityString(
          candidate.branch,
          "candidate branch",
          512,
        ),
        oid,
      };
    });

    if (!Array.isArray(source.files) || source.files.length > MAX_FILES) {
      throw new Error("invalid merge-review files");
    }
    const fileIds = new Set();
    const hunkIds = new Set();
    let hunkCount = 0;
    const files = source.files.map((file) => {
      requireExactKeys(file, [
        "id",
        "candidateKey",
        "path",
        "status",
        "binary",
        "selected",
        "hunks",
      ]);
      const id = requiredAuthorityId(
        file.id,
        "merge-review file id",
        FILE_ID_PATTERN,
      );
      if (fileIds.has(id)) throw new Error("duplicate merge-review file id");
      fileIds.add(id);
      const candidateKey = requiredAuthorityString(
        file.candidateKey,
        "merge-review file candidate key",
        256,
      );
      if (!candidateKeys.has(candidateKey)) {
        throw new Error("merge-review file references an unknown candidate");
      }
      if (
        typeof file.binary !== "boolean" ||
        typeof file.selected !== "boolean"
      ) {
        throw new Error("invalid merge-review file flags");
      }
      if (!Array.isArray(file.hunks))
        throw new Error("invalid merge-review hunks");
      hunkCount += file.hunks.length;
      if (hunkCount > MAX_HUNKS) throw new Error("too many merge-review hunks");
      const hunks = file.hunks.map((hunk) => {
        requireExactKeys(hunk, [
          "id",
          "header",
          "oldStart",
          "oldLines",
          "newStart",
          "newLines",
          "selected",
        ]);
        const hunkId = requiredAuthorityId(
          hunk.id,
          "merge-review hunk id",
          HUNK_ID_PATTERN,
        );
        if (hunkIds.has(hunkId))
          throw new Error("duplicate merge-review hunk id");
        hunkIds.add(hunkId);
        for (const key of ["oldStart", "oldLines", "newStart", "newLines"]) {
          if (!Number.isSafeInteger(hunk[key]) || hunk[key] < 0) {
            throw new Error("invalid merge-review hunk range");
          }
        }
        if (typeof hunk.selected !== "boolean") {
          throw new Error("invalid merge-review hunk selected flag");
        }
        return {
          id: hunkId,
          header: requiredAuthorityString(
            hunk.header,
            "merge-review hunk header",
            1000,
          ),
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines,
          selected: hunk.selected,
        };
      });
      if (file.binary && hunks.length > 0) {
        throw new Error("binary merge-review file exposes selectable hunks");
      }
      return {
        id,
        candidateKey,
        path: requiredAuthorityString(
          file.path,
          "merge-review file path",
          4096,
        ),
        status: requiredAuthorityString(
          file.status,
          "merge-review file status",
          64,
        ),
        binary: file.binary,
        selected: file.selected,
        hunks,
      };
    });

    requireExactKeys(source.selection, ["fileIds", "hunkIds"]);
    const selectedFileIds = uniqueIds(
      source.selection.fileIds,
      FILE_ID_PATTERN,
      "selected merge-review file id",
    );
    const selectedHunkIds = uniqueIds(
      source.selection.hunkIds,
      HUNK_ID_PATTERN,
      "selected merge-review hunk id",
    );
    if (selectedFileIds.length + selectedHunkIds.length > MAX_SELECTION_IDS) {
      throw new Error("merge-review selection exceeds the v1 ID limit");
    }
    if (selectedFileIds.some((id) => !fileIds.has(id))) {
      throw new Error("merge-review selection references an unknown file");
    }
    if (selectedHunkIds.some((id) => !hunkIds.has(id))) {
      throw new Error("merge-review selection references an unknown hunk");
    }
    const selectedFileSet = new Set(selectedFileIds);
    const selectedHunkSet = new Set(selectedHunkIds);
    for (const file of files) {
      if (file.selected !== selectedFileSet.has(file.id)) {
        throw new Error(
          "merge-review file selection projection is inconsistent",
        );
      }
      for (const hunk of file.hunks) {
        if (hunk.selected !== selectedHunkSet.has(hunk.id)) {
          throw new Error(
            "merge-review hunk selection projection is inconsistent",
          );
        }
        if (file.selected && hunk.selected) {
          throw new Error(
            "merge-review selection redundantly selects a file and its hunk",
          );
        }
      }
    }

    if (
      !Array.isArray(source.conflicts) ||
      source.conflicts.length > MAX_CONFLICTS
    ) {
      throw new Error("invalid merge-review conflicts");
    }
    const conflicts = source.conflicts.map((conflict) => {
      requireExactKeys(conflict, [
        "candidateKey",
        "path",
        "type",
        "explanation",
        "suggestion",
        "hunkIds",
      ]);
      const candidateKey = requiredAuthorityString(
        conflict.candidateKey,
        "conflict candidate key",
        256,
      );
      if (!candidateKeys.has(candidateKey)) {
        throw new Error(
          "merge-review conflict references an unknown candidate",
        );
      }
      const ids = uniqueIds(
        conflict.hunkIds,
        HUNK_ID_PATTERN,
        "conflict hunk id",
      );
      if (ids.some((id) => !hunkIds.has(id))) {
        throw new Error("merge-review conflict references an unknown hunk");
      }
      const suggestion = optionalAuthorityString(conflict.suggestion, 4096);
      if (conflict.suggestion != null && !suggestion) {
        throw new Error("invalid merge-review conflict suggestion");
      }
      return {
        candidateKey,
        path: requiredAuthorityString(conflict.path, "conflict path", 4096),
        type: requiredAuthorityString(conflict.type, "conflict type", 64),
        explanation: requiredAuthorityString(
          conflict.explanation,
          "conflict explanation",
          4096,
        ),
        suggestion,
        hunkIds: ids,
      };
    });

    const planDigest = requiredAuthorityDigest(
      source.planDigest,
      "merge-review plan digest",
    );
    const evidenceDigest = requiredAuthorityDigest(
      source.evidenceDigest,
      "merge-review evidence digest",
    );
    const createdAt = authorityTimestamp(source.createdAt);
    const updatedAt = authorityTimestamp(source.updatedAt);
    if (
      !createdAt ||
      !updatedAt ||
      Date.parse(updatedAt) < Date.parse(createdAt)
    ) {
      throw new Error("invalid merge-review timestamps");
    }
    if (
      !plainObject(source.details) ||
      Object.keys(source.details).length > 0
    ) {
      throw new Error("unknown merge-review details");
    }
    if (!Array.isArray(payload.actions) || payload.actions.length > 16) {
      throw new Error("invalid merge-review actions");
    }
    const actionIds = new Set();
    const actions = payload.actions.map((action) => {
      const parsed = parseMergeReviewAction(action, reviewId);
      if (actionIds.has(parsed.id))
        throw new Error("duplicate merge-review action");
      actionIds.add(parsed.id);
      return parsed;
    });
    return {
      ok: true,
      schema: MERGE_REVIEW_SCHEMA,
      schemaVersion: MERGE_REVIEW_SCHEMA_VERSION,
      operation,
      review: {
        reviewId,
        revision,
        state,
        base,
        candidates,
        files,
        selection: { fileIds: selectedFileIds, hunkIds: selectedHunkIds },
        conflicts,
        decision: parseDecision(source.decision),
        planDigest,
        evidenceDigest,
        createdAt,
        updatedAt,
      },
      actions,
    };
  } catch (error) {
    return invalidMergeReview(error.message);
  }
}

/** Verify a user selection contains only stable IDs from this exact review. */
function validateMergeReviewSelection(review, fileIds, hunkIds) {
  try {
    if (!review || !Array.isArray(review.files)) {
      throw new Error("merge-review authority is unavailable");
    }
    const knownHunkCount = review.files.reduce(
      (count, file) =>
        count + (Array.isArray(file.hunks) ? file.hunks.length : 0),
      0,
    );
    if (
      !Array.isArray(fileIds) ||
      !Array.isArray(hunkIds) ||
      fileIds.length > review.files.length ||
      hunkIds.length > knownHunkCount ||
      fileIds.length + hunkIds.length > MAX_SELECTION_IDS
    ) {
      throw new Error("merge-review selection is malformed or too large");
    }
    const files = uniqueIds(fileIds, FILE_ID_PATTERN, "merge-review file id");
    const hunks = uniqueIds(hunkIds, HUNK_ID_PATTERN, "merge-review hunk id");
    if (files.length + hunks.length === 0) {
      throw new Error("select at least one file or hunk");
    }
    const knownFiles = new Set(review.files.map((file) => file.id));
    const hunkOwners = new Map();
    for (const file of review.files) {
      for (const hunk of file.hunks || []) hunkOwners.set(hunk.id, file.id);
    }
    if (files.some((id) => !knownFiles.has(id))) {
      throw new Error("selected file no longer belongs to this review");
    }
    if (hunks.some((id) => !hunkOwners.has(id))) {
      throw new Error("selected hunk no longer belongs to this review");
    }
    const selectedFiles = new Set(files);
    if (hunks.some((id) => selectedFiles.has(hunkOwners.get(id)))) {
      throw new Error("select a whole file or its hunks, not both");
    }
    return { ok: true, fileIds: files, hunkIds: hunks };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** Use a CLI-issued action argv only when it exactly matches the expected pins. */
function selectMergeReviewActionArgs(parsed, actionId, expectedArgs) {
  if (!parsed?.ok || !Array.isArray(expectedArgs)) return null;
  const action = parsed.actions.find((candidate) => candidate.id === actionId);
  if (
    !action?.enabled ||
    action.argv.length !== expectedArgs.length ||
    action.argv.some((arg, index) => arg !== expectedArgs[index])
  ) {
    return null;
  }
  return [...action.argv];
}

/** "3 files changed, 40 insertions(+), 2 deletions(-)" → compact "+40 −2 (3 files)". */
function summarizeShortstat(text) {
  const s = String(text || "").trim();
  if (!s) return "no diff";
  const files = /(\d+) files? changed/.exec(s);
  const ins = /(\d+) insertions?\(\+\)/.exec(s);
  const del = /(\d+) deletions?\(-\)/.exec(s);
  return (
    `+${ins ? ins[1] : 0} −${del ? del[1] : 0}` +
    (files ? ` (${files[1]} file${files[1] === "1" ? "" : "s"})` : "")
  );
}

function boundedString(value, max = 256) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\p{Cc}/gu, "").trim();
  return clean ? clean.slice(0, max) : null;
}

function normalizedPath(value) {
  const path = boundedString(value, 4096);
  if (!path) return "";
  const slash = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(slash) ? slash.toLowerCase() : slash;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Parse `cc daemon view --json`, retaining only the secret-free fields a task
 * row needs. Background sessions and read-only team/batch managedTasks share
 * the projection, but keep distinct ids so the UI never implies that a
 * short-lived collaboration unit can be independently attached/stopped.
 * Prompts, argv, logs, transport tokens and side-effect metadata never cross
 * this boundary.
 */
function parseBackgroundTaskGovernance(text) {
  let data;
  try {
    data = JSON.parse(String(text || ""));
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const candidates = [
    ...(Array.isArray(data.sessions)
      ? data.sessions.slice(0, 1000).map((value) => ({
          value,
          kind: "background",
        }))
      : []),
    ...(Array.isArray(data.managedTasks)
      ? data.managedTasks.slice(0, 1000).map((value) => ({
          value,
          kind: "managed",
        }))
      : []),
  ];
  const rows = [];
  for (const candidate of candidates.slice(0, 2000)) {
    const session = candidate.value;
    if (!session || typeof session !== "object") continue;
    const backgroundId =
      candidate.kind === "background" ? boundedString(session.id, 160) : null;
    const managedTaskId =
      candidate.kind === "managed"
        ? boundedString(session.managedTaskId, 512)
        : null;
    const branch = boundedString(session.branch, 512);
    const worktreePath = boundedString(
      session.worktreePath || session.cwd,
      4096,
    );
    if ((!backgroundId && !managedTaskId) || (!branch && !worktreePath)) {
      continue;
    }
    const governance =
      session.governance && typeof session.governance === "object"
        ? session.governance
        : {};
    const budget =
      governance.resourceBudget && typeof governance.resourceBudget === "object"
        ? governance.resourceBudget
        : {};
    const effects =
      session.sideEffects && typeof session.sideEffects === "object"
        ? session.sideEffects
        : {};
    const managementStatus =
      boundedString(session.lifecycleState || session.status, 64) || "unknown";
    rows.push({
      ...(backgroundId ? { backgroundId } : {}),
      ...(managedTaskId
        ? {
            managedTaskId,
            runId: boundedString(session.runId, 160),
            runKind: boundedString(session.runKind, 32),
          }
        : {}),
      branch,
      worktreePath,
      owner:
        boundedString(governance.owner, 512) ||
        (backgroundId ? `background:${backgroundId}` : managedTaskId),
      sessionId:
        boundedString(governance.sessionId || session.sessionId, 256) || null,
      ...(backgroundId
        ? { backgroundStatus: managementStatus }
        : { managementStatus }),
      permissionMode: boundedString(governance.permissionMode, 64) || "default",
      resourceBudget: {
        maxTurns: positiveNumber(budget.maxTurns),
        maxCostUsd: positiveNumber(budget.maxCostUsd),
        ...(managedTaskId
          ? {
              maxTasks: positiveNumber(budget.maxTasks),
              maxTokens: positiveNumber(budget.maxTokens),
              maxWallMs: positiveNumber(budget.maxWallMs),
            }
          : {}),
      },
      sideEffects: {
        total: nonNegativeInteger(effects.total),
        unsettled: nonNegativeInteger(effects.unsettled),
        unknown: nonNegativeInteger(effects.unknown),
      },
    });
  }
  return rows;
}

/**
 * Join supervisor governance onto worktree rows. Branch identity wins; path is
 * the fallback for legacy records. A task without a supervisor stays visibly
 * unmanaged instead of receiving guessed policy.
 */
function attachTaskGovernance(tasks, text) {
  const governance = parseBackgroundTaskGovernance(text);
  return (Array.isArray(tasks) ? tasks : []).map((task) => {
    const branch = boundedString(task?.branch, 512);
    const path = normalizedPath(task?.path);
    const match =
      governance.find((row) => branch && row.branch === branch) ||
      governance.find(
        (row) => path && normalizedPath(row.worktreePath) === path,
      );
    if (!match) return { ...task };
    const visible = { ...match };
    delete visible.branch;
    delete visible.worktreePath;
    return { ...task, ...visible };
  });
}

/**
 * The terminal command for a NEW isolated task. The background supervisor owns
 * lifecycle, permission-mode, resource-budget and side-effect metadata while
 * the worktree provides filesystem isolation. Quotes in task text are stripped
 * rather than escaped across cmd, PowerShell and POSIX shells.
 */
function buildNewTaskCommand(task, { command = "cc", windows = false } = {}) {
  const clean = String(task || "")
    .replace(/["'`\\]/g, " ")
    .trim();
  return windows
    ? `${command} agent --bg --worktree -p "${clean}"`
    : `${command} agent --bg --worktree -p '${clean}'`;
}

module.exports = {
  MERGE_REVIEW_SCHEMA,
  MERGE_REVIEW_SCHEMA_VERSION,
  attachTaskGovernance,
  buildAheadArgs,
  buildBackgroundListArgs,
  buildBranchDeleteArgs,
  buildMergeReviewApplyArgs,
  buildMergeReviewPreviewArgs,
  buildMergeReviewRollbackArgs,
  buildMergeReviewShowArgs,
  buildNewTaskCommand,
  buildShortstatArgs,
  buildStatusArgs,
  buildWorktreeListArgs,
  buildWorktreeRemoveArgs,
  isTaskBranch,
  parseBackgroundTaskGovernance,
  parseMergeReview,
  parseWorktreeList,
  selectMergeReviewActionArgs,
  summarizeShortstat,
  validateMergeReviewSelection,
};
