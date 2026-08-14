import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  canonicalMergeReviewJson,
  computeMergeReviewHunkDigest,
  TEAM_MERGE_REVIEW_LIMITS,
} from "./team-merge-review.js";
import executionBroker from "../process-execution-broker/index.js";
import { redactSecrets } from "../secret-scan.js";

const OID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const MAX_BRANCH_CHARS = 255;
const MAX_PATH_CHARS = 4096;
const MAX_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_PATCH_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 4096;
const MAX_HUNKS = 16_384;
const MAX_CANDIDATES = 256;
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
const ALLOWED_GIT_ENVIRONMENT = new Set([
  "GIT_AUTHOR_DATE",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_NAME",
  "GIT_COMMITTER_DATE",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_INDEX_FILE",
]);

const STATUS_NAMES = Object.freeze({
  A: "added",
  C: "copied",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "type_changed",
  U: "unmerged",
  X: "unmerged",
  B: "unmerged",
});

export const _deps = {
  execFileSync: executionBroker.execFileSync.bind(executionBroker),
  gitExecutable: null,
};

let cachedGitExecutable = null;

function isPathWithin(child, root) {
  const relative = path.relative(root, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function validateGitExecutable(value, cwd) {
  if (typeof value !== "string" || !path.isAbsolute(value)) return null;
  let executable;
  try {
    executable = fs.realpathSync.native(value);
    const entry = fs.statSync(executable);
    if (!entry.isFile()) return null;
    if (process.platform !== "win32" && (Number(entry.mode) & 0o111) === 0) {
      return null;
    }
  } catch {
    return null;
  }
  if (isPathWithin(executable, path.resolve(cwd))) return null;
  return executable;
}

function resolveTrustedGitExecutable(cwd) {
  const injected = validateGitExecutable(_deps.gitExecutable, cwd);
  if (_deps.gitExecutable != null) {
    if (!injected) throw new Error("configured Git executable is not trusted");
    return injected;
  }
  const cached = validateGitExecutable(cachedGitExecutable, cwd);
  if (cached) return cached;
  const configured = validateGitExecutable(
    process.env.CHAINLESSCHAIN_GIT_BIN,
    cwd,
  );
  if (process.env.CHAINLESSCHAIN_GIT_BIN != null) {
    if (!configured) {
      throw new Error("CHAINLESSCHAIN_GIT_BIN must be a trusted absolute file");
    }
    cachedGitExecutable = configured;
    return configured;
  }
  const executableName = process.platform === "win32" ? "git.exe" : "git";
  for (const entry of String(process.env.PATH || "").split(path.delimiter)) {
    if (!entry || !path.isAbsolute(entry)) continue;
    const candidate = validateGitExecutable(
      path.join(entry, executableName),
      cwd,
    );
    if (candidate) {
      cachedGitExecutable = candidate;
      return candidate;
    }
  }
  throw new Error(
    "trusted Git executable was not found on an absolute PATH entry",
  );
}

function safeError(value, fallback = "git operation failed") {
  const text = redactSecrets(String(value || "")).trim();
  return (text || fallback).slice(0, 4096);
}

function hardenedGitEnvironment(overrides = {}) {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith("GIT_")) environment[key] = value;
  }
  Object.assign(environment, {
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_EXTERNAL_DIFF: "",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  });
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = key.toUpperCase();
    if (
      normalized.startsWith("GIT_") &&
      !ALLOWED_GIT_ENVIRONMENT.has(normalized)
    ) {
      throw new Error(`unsupported Git environment override: ${key}`);
    }
    environment[key] = value;
  }
  return environment;
}

function git(cwd, args, options = {}) {
  const executable = resolveTrustedGitExecutable(cwd);
  const hardenedArgs = [
    "--no-pager",
    "-c",
    `core.hooksPath=${NULL_DEVICE}`,
    "-c",
    "commit.gpgSign=false",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "diff.external=",
    ...args,
  ];
  const environment = hardenedGitEnvironment(options.env);
  try {
    return _deps.execFileSync(executable, hardenedArgs, {
      cwd,
      encoding: "utf8",
      stdio: [options.input == null ? "ignore" : "pipe", "pipe", "pipe"],
      maxBuffer: MAX_PATCH_BYTES + 1024 * 1024,
      ...(options.input == null ? {} : { input: options.input }),
      env: environment,
      origin: options.origin || "team-merge-review:git",
      policy: "allow",
      scope: "team-merge-review",
    });
  } catch (error) {
    if (options.allowFailure) {
      return {
        failed: true,
        status: Number.isInteger(error?.status) ? error.status : 1,
        stdout: String(error?.stdout || ""),
        stderr: safeError(error?.stderr || error?.message),
      };
    }
    const failure = new Error(safeError(error?.stderr || error?.message));
    failure.code = "TEAM_MERGE_REVIEW_GIT_FAILED";
    failure.cause = error;
    throw failure;
  }
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertOid(value, label) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!OID_RE.test(normalized)) {
    throw new TypeError(`${label} must be an exact Git commit/blob OID`);
  }
  return normalized;
}

function assertDigest(value, label) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!DIGEST_RE.test(normalized)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return normalized;
}

function assertBranch(value, label = "branch") {
  const branch = String(value || "").trim();
  if (
    !branch ||
    branch.length > MAX_BRANCH_CHARS ||
    branch.startsWith("-") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(
      branch,
    ) ||
    branch.includes("..") ||
    branch.endsWith(".lock") ||
    branch.endsWith(".") ||
    /[\0\r\n]/.test(branch)
  ) {
    throw new TypeError(`${label} is unsafe`);
  }
  return branch;
}

function assertRepoPath(value) {
  const filePath = String(value || "");
  const segments = filePath.replaceAll("\\", "/").split("/");
  if (
    !filePath ||
    filePath.length > MAX_PATH_CHARS ||
    path.isAbsolute(filePath) ||
    segments.includes("..") ||
    /[\0\r\n]/.test(filePath)
  ) {
    throw new TypeError("merge-review file path is unsafe");
  }
  return filePath.replaceAll("\\", "/");
}

function parseCheckAttrZ(value) {
  const fields = String(value || "").split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 3 !== 0) {
    throw new Error("Git returned malformed attribute evidence");
  }
  const rows = [];
  for (let index = 0; index < fields.length; index += 3) {
    rows.push({
      path: assertRepoPath(fields[index]),
      attribute: fields[index + 1],
      value: fields[index + 2],
    });
  }
  return rows;
}

function assertNoActiveWorktreeFilters(repoDir) {
  const tracked = String(git(repoDir, ["ls-files", "-z"]));
  if (!tracked) return;
  const rows = parseCheckAttrZ(
    git(repoDir, ["check-attr", "-z", "--stdin", "filter"], {
      input: tracked,
      origin: "team-merge-review:filter-audit",
    }),
  );
  const active = rows.find(
    (row) => !["unspecified", "unset"].includes(row.value),
  );
  if (active) {
    const error = new Error(
      `merge-review refuses active Git filter '${active.value}' on ${active.path}`,
    );
    error.code = "TEAM_MERGE_REVIEW_GIT_FILTER_UNSAFE";
    throw error;
  }
}

function assertSafeSelectionAttributes(repoDir, filePaths) {
  const paths = [...new Set((filePaths || []).map(assertRepoPath))];
  if (paths.length === 0) return;
  if (
    paths.some((filePath) => path.posix.basename(filePath) === ".gitattributes")
  ) {
    const error = new Error(
      "merge-review requires .gitattributes changes to use a separate trusted workflow",
    );
    error.code = "TEAM_MERGE_REVIEW_GIT_ATTRIBUTES_UNSAFE";
    throw error;
  }
  const rows = parseCheckAttrZ(
    git(
      repoDir,
      ["check-attr", "-z", "filter", "diff", "merge", "--", ...paths],
      { origin: "team-merge-review:attribute-audit" },
    ),
  );
  const active = rows.find((row) => {
    if (row.attribute === "filter") {
      return !["unspecified", "unset"].includes(row.value);
    }
    return !["unspecified", "unset", "set", "text", "binary"].includes(
      row.value,
    );
  });
  if (active) {
    const error = new Error(
      `merge-review refuses executable Git ${active.attribute} driver '${active.value}' on ${active.path}`,
    );
    error.code = "TEAM_MERGE_REVIEW_GIT_DRIVER_UNSAFE";
    throw error;
  }
}

function worktreeIsDirty(repoDir) {
  assertNoActiveWorktreeFilters(repoDir);
  return (
    String(
      git(repoDir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    ).length > 0
  );
}

function resolveRepoRoot(repoDir) {
  const requested = fs.realpathSync.native(path.resolve(repoDir));
  const root = fs.realpathSync.native(
    path.resolve(String(git(repoDir, ["rev-parse", "--show-toplevel"])).trim()),
  );
  if (!isPathWithin(requested, root)) {
    throw new Error("Git repository root does not contain the requested path");
  }
  return root;
}

export function resolveMergeReviewRepositoryRoot(repoDir = process.cwd()) {
  return resolveRepoRoot(repoDir);
}

function resolveCurrentBranch(repoDir) {
  const branch = String(
    git(repoDir, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
  ).trim();
  return assertBranch(branch, "current branch");
}

function resolveBranchOid(repoDir, branch) {
  const safeBranch = assertBranch(branch);
  const oid = String(
    git(repoDir, [
      "show-ref",
      "--verify",
      "--hash",
      `refs/heads/${safeBranch}`,
    ]),
  ).trim();
  return assertOid(oid, `${safeBranch} OID`);
}

function resolveBlobOid(repoDir, commitOid, filePath) {
  const result = git(
    repoDir,
    ["rev-parse", "--verify", `${commitOid}:${filePath}`],
    { allowFailure: true },
  );
  if (typeof result === "object" && result?.failed) return null;
  return assertOid(String(result).trim(), `${filePath} blob OID`);
}

function parseNameStatusZ(value) {
  const fields = String(value || "").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const records = [];
  for (let index = 0; index < fields.length;) {
    const statusCode = fields[index++];
    if (!/^[ACDMRTUXB][0-9]{0,3}$/.test(statusCode || "")) {
      throw new Error("Git returned malformed name-status data");
    }
    const kind = statusCode[0];
    const firstPath = assertRepoPath(fields[index++]);
    let oldPath = firstPath;
    let newPath = firstPath;
    if (kind === "R" || kind === "C") {
      newPath = assertRepoPath(fields[index++]);
    } else if (kind === "D") {
      newPath = null;
    } else if (kind === "A") {
      oldPath = null;
    }
    records.push({
      status: STATUS_NAMES[kind],
      statusCode,
      oldPath,
      newPath,
    });
  }
  if (records.length > MAX_FILES) {
    throw new Error(`merge review exceeds ${MAX_FILES} changed files`);
  }
  return records;
}

function diffArgs(baseOid, candidateOid, record) {
  const paths = [record.oldPath, record.newPath].filter(Boolean);
  return [
    "diff",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    baseOid,
    candidateOid,
    "--",
    ...new Set(paths),
  ];
}

function splitPatchHunks(patchText) {
  const patch = String(patchText || "");
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    throw new Error(`merge-review patch exceeds ${MAX_PATCH_BYTES} bytes`);
  }
  const matcher = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*(?:\n|$)/gm;
  const matches = [...patch.matchAll(matcher)];
  if (matches.length === 0) return { preamble: patch, hunks: [] };
  const preamble = patch.slice(0, matches[0].index);
  const hunks = matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? patch.length;
    const body = patch.slice(start, end);
    return {
      header: match[0].trimEnd(),
      oldStart: Number(match[1]),
      oldLines: match[2] == null ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newLines: match[4] == null ? 1 : Number(match[4]),
      body,
      bodyDigest: digest(body),
    };
  });
  return { preamble, hunks };
}

function supportsHunkSelection(record, preamble) {
  return (
    record.status === "modified" &&
    record.oldPath === record.newPath &&
    !/^(?:old mode|new mode|new file mode|deleted file mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to)\b/mu.test(
      preamble,
    )
  );
}

function inspectCandidateFiles(repoDir, baseOid, candidate, budget) {
  const statusText = git(repoDir, [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
    baseOid,
    candidate.oid,
    "--",
  ]);
  const records = parseNameStatusZ(statusText);
  budget.files += records.length;
  if (budget.files > MAX_FILES) {
    throw new Error(`merge review exceeds ${MAX_FILES} changed files`);
  }
  return records.map((record) => {
    const filePath = record.newPath || record.oldPath;
    const patchText = String(
      git(repoDir, diffArgs(baseOid, candidate.oid, record)),
    );
    const { preamble, hunks } = splitPatchHunks(patchText);
    budget.patchBytes += Buffer.byteLength(patchText, "utf8");
    if (budget.patchBytes > MAX_TOTAL_PATCH_BYTES) {
      throw new Error(
        `merge review exceeds ${MAX_TOTAL_PATCH_BYTES} total patch bytes`,
      );
    }
    const selectableHunks = supportsHunkSelection(record, preamble)
      ? hunks
      : [];
    budget.hunks += selectableHunks.length;
    if (budget.hunks > MAX_HUNKS) {
      throw new Error(`merge review exceeds ${MAX_HUNKS} diff hunks`);
    }
    const baseBlobOid = record.oldPath
      ? resolveBlobOid(repoDir, baseOid, record.oldPath)
      : null;
    const candidateBlobOid = record.newPath
      ? resolveBlobOid(repoDir, candidate.oid, record.newPath)
      : null;
    const binary =
      hunks.length === 0 &&
      (/^GIT binary patch$/m.test(patchText) ||
        /^Binary files .* differ$/m.test(patchText));
    return {
      candidateKey: candidate.key,
      path: filePath,
      oldPath: record.oldPath,
      newPath: record.newPath,
      status: record.status,
      statusCode: record.statusCode,
      binary,
      baseBlobOid,
      candidateBlobOid,
      patchDigest: digest(patchText),
      selected: false,
      hunks: selectableHunks.map((hunk) => ({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        patch: hunk.body,
      })),
      _patch: patchText,
      _preamble: preamble,
      _hunkBodies: null,
    };
  });
}

export function inspectMergeReviewRepository({
  repoDir = process.cwd(),
  baseBranch = null,
  branches,
  keys = null,
} = {}) {
  const root = resolveRepoRoot(repoDir);
  const base = assertBranch(
    baseBranch || resolveCurrentBranch(root),
    "base branch",
  );
  const baseOid = resolveBranchOid(root, base);
  const requested = Array.isArray(branches) ? branches : [];
  if (requested.length === 0 || requested.length > MAX_CANDIDATES) {
    throw new TypeError("at least one candidate branch is required");
  }
  const seen = new Set();
  const seenKeys = new Set();
  const candidates = requested.map((value, index) => {
    const branch = assertBranch(value, `candidate branch ${index + 1}`);
    if (branch === base || seen.has(branch)) {
      throw new TypeError(
        `candidate branch is duplicate or equals base: ${branch}`,
      );
    }
    seen.add(branch);
    const key = String(
      keys?.[index] ||
        `candidate:${digest(branch).slice("sha256:".length, 23)}`,
    ).slice(0, 256);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(key) ||
      seenKeys.has(key)
    ) {
      throw new TypeError(`candidate key is unsafe or duplicate: ${key}`);
    }
    seenKeys.add(key);
    return {
      key,
      branch,
      oid: resolveBranchOid(root, branch),
    };
  });
  const budget = { files: 0, hunks: 0, patchBytes: 0 };
  const files = candidates.flatMap((candidate) =>
    inspectCandidateFiles(root, baseOid, candidate, budget),
  );
  if (files.length === 0) {
    throw new Error(
      "candidate branches have no changes relative to the exact base",
    );
  }
  return {
    repoRoot: root,
    base: { branch: base, oid: baseOid },
    candidates,
    files,
  };
}

function publicFile(file) {
  const record = { ...file };
  delete record._patch;
  delete record._preamble;
  delete record._hunkBodies;
  return {
    ...record,
    hunks: record.hunks.map(({ patch, ...hunk }) => ({
      ...hunk,
      patchDigest: digest(patch),
    })),
  };
}

export function publicInspection(inspection) {
  return {
    repoRoot: inspection.repoRoot,
    base: { ...inspection.base },
    candidates: inspection.candidates.map((candidate) => ({ ...candidate })),
    files: inspection.files.map(publicFile),
  };
}

/** Convert the private Git inspection into the pure core's build input. */
export function mergeReviewInputFromInspection(inspection) {
  if (!inspection?.base || !Array.isArray(inspection.candidates)) {
    throw new TypeError("a merge-review inspection is required");
  }
  return {
    base: {
      branch: inspection.base.branch,
      commitOid: inspection.base.oid,
    },
    candidates: inspection.candidates.map((candidate) => ({
      key: candidate.key,
      branch: candidate.branch,
      commitOid: candidate.oid,
    })),
    files: inspection.files.map((file) => ({
      candidateKey: file.candidateKey,
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      oldBlobOid: file.baseBlobOid,
      newBlobOid: file.candidateBlobOid,
      binary: file.binary,
      patchDigest: file.patchDigest,
      hunks: file.hunks.map((hunk) => ({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        patch: hunk.patch,
      })),
    })),
  };
}

/**
 * Bind core-issued stable IDs back to the private patches used by the staging
 * transaction. This is deliberately exact: any plan drift fails before Git is
 * mutated.
 */
export function bindMergeReviewInspection(inspection, review) {
  const expected = mergeReviewInputFromInspection(inspection);
  if (
    canonicalMergeReviewJson(expected.base) !==
      canonicalMergeReviewJson(review?.base) ||
    canonicalMergeReviewJson(expected.candidates) !==
      canonicalMergeReviewJson(review?.candidates)
  ) {
    throw new Error("merge-review Git inspection no longer binds the review");
  }
  const reviewFiles = new Map(
    review.files.map((file) => [`${file.candidateKey}\0${file.path}`, file]),
  );
  const files = inspection.files.map((file) => {
    const reviewed = reviewFiles.get(`${file.candidateKey}\0${file.path}`);
    if (!reviewed) {
      throw new Error(`merge-review file evidence drifted: ${file.path}`);
    }
    const privateHunks = [...file.hunks].sort(
      (left, right) =>
        left.oldStart - right.oldStart || left.newStart - right.newStart,
    );
    if (privateHunks.length !== reviewed.hunks.length) {
      throw new Error(`merge-review hunk evidence drifted: ${file.path}`);
    }
    const _hunkBodies = {};
    const hunks = reviewed.hunks.map((hunk, index) => {
      const source = privateHunks[index];
      if (
        source.oldStart !== hunk.oldStart ||
        source.oldLines !== hunk.oldLines ||
        source.newStart !== hunk.newStart ||
        source.newLines !== hunk.newLines ||
        computeMergeReviewHunkDigest(source.patch) !== hunk.digest
      ) {
        throw new Error(`merge-review hunk ranges drifted: ${file.path}`);
      }
      _hunkBodies[hunk.id] = source.patch;
      return { ...hunk };
    });
    return {
      ...file,
      id: reviewed.id,
      hunks,
      _hunkBodies,
    };
  });
  if (files.length !== review.files.length) {
    throw new Error("merge-review file set drifted");
  }
  return { ...inspection, files };
}

function validateSelections(inspection, { fileIds = [], hunkIds = [] } = {}) {
  const selectedFileIds = [...new Set(fileIds.map(String))];
  const selectedHunkIds = [...new Set(hunkIds.map(String))];
  if (
    selectedFileIds.length !== fileIds.length ||
    selectedHunkIds.length !== hunkIds.length
  ) {
    throw new TypeError("merge-review selections must not contain duplicates");
  }
  if (
    selectedFileIds.length + selectedHunkIds.length >
    TEAM_MERGE_REVIEW_LIMITS.selectionIds
  ) {
    throw new RangeError(
      `merge-review selection exceeds ${TEAM_MERGE_REVIEW_LIMITS.selectionIds} IDs`,
    );
  }
  const filesById = new Map(inspection.files.map((file) => [file.id, file]));
  const hunksById = new Map();
  for (const file of inspection.files) {
    for (const hunk of file.hunks) hunksById.set(hunk.id, { file, hunk });
  }
  const selected = new Map();
  for (const fileId of selectedFileIds) {
    const file = filesById.get(fileId);
    if (!file) throw new TypeError(`unknown merge-review file id: ${fileId}`);
    selected.set(file.id, { file, wholeFile: true, hunkIds: [] });
  }
  for (const hunkId of selectedHunkIds) {
    const binding = hunksById.get(hunkId);
    if (!binding)
      throw new TypeError(`unknown merge-review hunk id: ${hunkId}`);
    const current = selected.get(binding.file.id);
    if (current?.wholeFile) {
      throw new TypeError(
        `cannot select both a whole file and its hunk: ${binding.file.path}`,
      );
    }
    const entry = current || {
      file: binding.file,
      wholeFile: false,
      hunkIds: [],
    };
    entry.hunkIds.push(hunkId);
    selected.set(binding.file.id, entry);
  }
  if (selected.size === 0) {
    throw new TypeError("at least one file or hunk selection is required");
  }
  for (const entry of selected.values()) {
    if (
      !entry.wholeFile &&
      (entry.file.binary || entry.file.hunks.length === 0)
    ) {
      throw new TypeError(
        `file requires whole-file selection: ${entry.file.path}`,
      );
    }
  }
  return { selected, fileIds: selectedFileIds, hunkIds: selectedHunkIds };
}

function patchForSelection(entry) {
  if (entry.wholeFile) return entry.file._patch;
  const bodies = entry.hunkIds.map((id) => entry.file._hunkBodies[id]);
  if (bodies.some((body) => typeof body !== "string")) {
    throw new Error(
      `selected hunk evidence is unavailable: ${entry.file.path}`,
    );
  }
  return `${entry.file._preamble}${bodies.join("")}`;
}

function collectConflictPaths(repoDir, env) {
  const result = git(
    repoDir,
    [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=U",
      "--no-ext-diff",
      "--no-textconv",
      "-z",
    ],
    { allowFailure: true, env },
  );
  const output = typeof result === "string" ? result : result.stdout || "";
  return output.split("\0").filter(Boolean).map(assertRepoPath);
}

function removeTemporaryIndex(indexPath) {
  if (!indexPath) return;
  for (const target of [indexPath, `${indexPath}.lock`]) {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // A retained result ref preserves recovery authority even if a temporary
      // index cleanup is delayed by a host filesystem lock.
    }
  }
}

function assertBaseReady(repoRoot, expected) {
  const currentBranch = resolveCurrentBranch(repoRoot);
  const currentOid = resolveBranchOid(repoRoot, expected.branch);
  if (currentBranch !== expected.branch || currentOid !== expected.oid) {
    const error = new Error("base branch or OID changed after merge review");
    error.code = "TEAM_MERGE_REVIEW_BASE_STALE";
    throw error;
  }
  if (worktreeIsDirty(repoRoot)) {
    const error = new Error(
      "base worktree must be clean before reviewed publish",
    );
    error.code = "TEAM_MERGE_REVIEW_BASE_DIRTY";
    throw error;
  }
}

export function readMergeReviewBaseState({
  repoDir = process.cwd(),
  branch,
} = {}) {
  const root = resolveRepoRoot(repoDir);
  const safeBranch = assertBranch(branch, "base branch");
  const currentBranch = resolveCurrentBranch(root);
  const oid = resolveBranchOid(root, safeBranch);
  const dirty = worktreeIsDirty(root);
  return { repoRoot: root, branch: safeBranch, currentBranch, oid, dirty };
}

export function prepareMergeReviewTransaction({
  inspection,
  fileIds = [],
  hunkIds = [],
  reviewId,
  stateDir,
  actor = "cli-operator",
  reason = "reviewed multi-agent merge",
  decidedAt = null,
} = {}) {
  if (!inspection?.repoRoot || !inspection?.base || !inspection?.candidates) {
    throw new TypeError("a verified merge-review inspection is required");
  }
  const selections = validateSelections(inspection, { fileIds, hunkIds });
  const root = resolveRepoRoot(inspection.repoRoot);
  if (root !== path.resolve(inspection.repoRoot)) {
    throw new Error("merge-review repository root changed");
  }
  if (resolveBranchOid(root, inspection.base.branch) !== inspection.base.oid) {
    throw new Error("base OID changed before merge-review preparation");
  }
  for (const candidate of inspection.candidates) {
    if (resolveBranchOid(root, candidate.branch) !== candidate.oid) {
      throw new Error(`candidate branch changed: ${candidate.branch}`);
    }
  }
  assertSafeSelectionAttributes(
    root,
    [...selections.selected.values()].map((entry) => entry.file.path),
  );
  const safeReviewId = String(reviewId || "");
  if (!/^tmr_[a-f0-9]{32}$/.test(safeReviewId)) {
    throw new TypeError("reviewId is invalid");
  }
  const stagingRoot = path.resolve(stateDir || os.tmpdir(), "staging");
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const indexPath = path.join(
    stagingRoot,
    `${safeReviewId}-${process.pid}-${randomUUID()}.index`,
  );
  const indexEnv = { GIT_INDEX_FILE: indexPath };
  git(root, ["read-tree", inspection.base.oid], {
    env: indexEnv,
    origin: "team-merge-review:prepare-index",
  });
  try {
    const conflicts = [];
    for (const candidate of inspection.candidates) {
      const entries = [...selections.selected.values()].filter(
        (entry) => entry.file.candidateKey === candidate.key,
      );
      for (const entry of entries) {
        const patchText = patchForSelection(entry);
        const result = git(
          root,
          ["apply", "--cached", "--3way", "--whitespace=nowarn", "-"],
          {
            input: patchText,
            env: indexEnv,
            allowFailure: true,
            origin: "team-merge-review:apply-selection",
          },
        );
        if (typeof result === "object" && result.failed) {
          const paths = collectConflictPaths(root, indexEnv);
          conflicts.push({
            candidateKey: candidate.key,
            path: entry.file.path,
            type: paths.length > 0 ? "content_conflict" : "patch_rejected",
            explanation: safeError(
              result.stderr,
              "selected change could not be applied",
            ),
            suggestion:
              "Refresh the review against the latest exact branch OIDs and inspect overlapping hunks.",
            hunkIds: [...entry.hunkIds],
            relatedPaths: paths,
          });
          break;
        }
      }
      if (conflicts.length > 0) break;
    }
    if (conflicts.length > 0) {
      return {
        success: false,
        state: "conflicted",
        conflicts,
        selection: {
          fileIds: selections.fileIds,
          hunkIds: selections.hunkIds,
        },
      };
    }
    const treeStatus = git(
      root,
      [
        "diff",
        "--cached",
        "--name-only",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        inspection.base.oid,
        "--",
      ],
      { env: indexEnv },
    );
    if (!String(treeStatus).replaceAll("\0", "")) {
      throw new Error("reviewed selection produced no staged changes");
    }
    const identity = {
      GIT_AUTHOR_NAME: "ChainlessChain Merge Review",
      GIT_AUTHOR_EMAIL: "merge-review@chainlesschain.local",
      GIT_COMMITTER_NAME: "ChainlessChain Merge Review",
      GIT_COMMITTER_EMAIL: "merge-review@chainlesschain.local",
      ...(decidedAt
        ? {
            GIT_AUTHOR_DATE: new Date(decidedAt).toISOString(),
            GIT_COMMITTER_DATE: new Date(decidedAt).toISOString(),
          }
        : {}),
    };
    const treeOid = assertOid(
      String(
        git(root, ["write-tree"], { env: { ...identity, ...indexEnv } }),
      ).trim(),
      "reviewed result tree OID",
    );
    const resultOid = assertOid(
      String(
        git(root, ["commit-tree", treeOid, "-p", inspection.base.oid], {
          env: identity,
          input:
            `Merge reviewed agent work (${safeReviewId})\n\n` +
            `Actor: ${String(actor).slice(0, 256)}\n` +
            `Reason: ${String(reason).slice(0, 1024)}\n`,
          origin: "team-merge-review:commit-tree",
        }),
      ).trim(),
      "reviewed result OID",
    );
    const parentOid = assertOid(
      String(git(root, ["rev-parse", `${resultOid}^`])).trim(),
      "reviewed result parent OID",
    );
    if (parentOid !== inspection.base.oid) {
      throw new Error(
        "reviewed result is not a direct child of the exact base",
      );
    }
    const resultRef = `refs/chainlesschain/merge-review/${safeReviewId}/result`;
    const existingRef = git(root, ["rev-parse", "--verify", resultRef], {
      allowFailure: true,
      origin: "team-merge-review:retain-result-check",
    });
    if (typeof existingRef === "string") {
      if (assertOid(existingRef.trim(), "retained result OID") !== resultOid) {
        throw new Error(
          "merge-review retained result ref changed unexpectedly",
        );
      }
    } else {
      git(
        root,
        ["update-ref", resultRef, resultOid, "0".repeat(resultOid.length)],
        {
          origin: "team-merge-review:retain-result",
        },
      );
    }
    return {
      success: true,
      state: "prepared",
      resultOid,
      resultRef,
      selection: {
        fileIds: selections.fileIds,
        hunkIds: selections.hunkIds,
      },
    };
  } finally {
    removeTemporaryIndex(indexPath);
  }
}

export function publishPreparedMergeReview({ inspection, prepared } = {}) {
  if (!prepared?.success || prepared.state !== "prepared") {
    throw new TypeError("a prepared merge-review result is required");
  }
  const root = resolveRepoRoot(inspection.repoRoot);
  assertBaseReady(root, inspection.base);
  const resultOid = assertOid(prepared.resultOid, "prepared result OID");
  const parentOid = assertOid(
    String(git(root, ["rev-parse", `${resultOid}^`])).trim(),
    "prepared result parent OID",
  );
  if (parentOid !== inspection.base.oid) {
    throw new Error(
      "prepared result no longer descends directly from the base",
    );
  }
  const mergeResult = git(root, ["merge", "--ff-only", resultOid], {
    allowFailure: true,
    origin: "team-merge-review:publish",
  });
  const finalState = readMergeReviewBaseState({
    repoDir: root,
    branch: inspection.base.branch,
  });
  if (
    finalState.currentBranch === inspection.base.branch &&
    finalState.oid === resultOid &&
    finalState.dirty === false
  ) {
    return {
      success: true,
      state: "published",
      baseOid: inspection.base.oid,
      resultOid,
      ambiguous: typeof mergeResult === "object" && mergeResult.failed,
    };
  }
  const error = new Error(
    typeof mergeResult === "object"
      ? safeError(mergeResult.stderr, "reviewed publish failed")
      : "reviewed publish did not advance the exact base",
  );
  error.code =
    finalState.oid === inspection.base.oid
      ? "TEAM_MERGE_REVIEW_PUBLISH_FAILED"
      : "TEAM_MERGE_REVIEW_PUBLISH_AMBIGUOUS";
  error.details = {
    expectedBaseOid: inspection.base.oid,
    currentOid: finalState.oid,
    resultOid,
  };
  throw error;
}

export function rollbackPublishedMergeReview({
  repoDir,
  base,
  resultOid,
  reviewId,
  decidedAt,
  actor = "cli-operator",
  reason = "controlled merge-review rollback",
  evidenceDigest,
  expectedEvidenceDigest,
} = {}) {
  assertDigest(evidenceDigest, "rollback evidence digest");
  if (
    evidenceDigest !==
    assertDigest(expectedEvidenceDigest, "expected evidence digest")
  ) {
    throw new Error("rollback evidence digest is stale");
  }
  const root = resolveRepoRoot(repoDir);
  const expectedBase = {
    branch: assertBranch(base?.branch, "rollback base branch"),
    oid: assertOid(base?.oid, "rollback base OID"),
  };
  const publishedOid = assertOid(resultOid, "published result OID");
  const safeReviewId = String(reviewId || "");
  if (!/^tmr_[a-f0-9]{32}$/u.test(safeReviewId)) {
    throw new TypeError("reviewId is invalid");
  }
  const rollbackAt = new Date(decidedAt);
  if (!Number.isFinite(rollbackAt.getTime())) {
    throw new TypeError("rollback decidedAt is invalid");
  }
  const resultParent = assertOid(
    String(git(root, ["rev-parse", `${publishedOid}^`])).trim(),
    "published result parent OID",
  );
  if (resultParent !== expectedBase.oid) {
    const error = new Error(
      "controlled rollback refused because the published result is not bound to the exact base",
    );
    error.code = "TEAM_MERGE_REVIEW_ROLLBACK_STALE";
    throw error;
  }
  const baseTree = assertOid(
    String(git(root, ["rev-parse", `${expectedBase.oid}^{tree}`])).trim(),
    "rollback base tree OID",
  );
  const identity = {
    GIT_AUTHOR_NAME: "ChainlessChain Merge Review",
    GIT_AUTHOR_EMAIL: "merge-review@chainlesschain.local",
    GIT_COMMITTER_NAME: "ChainlessChain Merge Review",
    GIT_COMMITTER_EMAIL: "merge-review@chainlesschain.local",
    GIT_AUTHOR_DATE: rollbackAt.toISOString(),
    GIT_COMMITTER_DATE: rollbackAt.toISOString(),
  };
  const rollbackOid = assertOid(
    String(
      git(root, ["commit-tree", baseTree, "-p", publishedOid], {
        env: identity,
        input:
          `Rollback reviewed agent work (${safeReviewId})\n\n` +
          `Actor: ${String(actor).slice(0, 256)}\n` +
          `Reason: ${String(reason).slice(0, 1024)}\n`,
        origin: "team-merge-review:rollback-commit-tree",
      }),
    ).trim(),
    "rollback result OID",
  );
  const rollbackRef = `refs/chainlesschain/merge-review/${safeReviewId}/rollback`;
  const existingRef = git(root, ["rev-parse", "--verify", rollbackRef], {
    allowFailure: true,
    origin: "team-merge-review:retain-rollback-check",
  });
  if (typeof existingRef === "string") {
    if (
      assertOid(existingRef.trim(), "retained rollback OID") !== rollbackOid
    ) {
      throw new Error(
        "merge-review retained rollback ref changed unexpectedly",
      );
    }
  } else {
    git(
      root,
      ["update-ref", rollbackRef, rollbackOid, "0".repeat(rollbackOid.length)],
      { origin: "team-merge-review:retain-rollback" },
    );
  }
  const before = readMergeReviewBaseState({
    repoDir: root,
    branch: expectedBase.branch,
  });
  if (
    before.currentBranch !== expectedBase.branch ||
    ![publishedOid, rollbackOid].includes(before.oid)
  ) {
    const error = new Error(
      "controlled rollback refused because the base branch advanced or changed",
    );
    error.code = "TEAM_MERGE_REVIEW_ROLLBACK_STALE";
    throw error;
  }
  if (before.dirty) {
    const error = new Error(
      "controlled rollback requires a clean base worktree",
    );
    error.code = "TEAM_MERGE_REVIEW_ROLLBACK_DIRTY";
    throw error;
  }
  const rollbackResult = git(root, ["merge", "--ff-only", rollbackOid], {
    allowFailure: true,
    origin: "team-merge-review:rollback",
  });
  const finalState = readMergeReviewBaseState({
    repoDir: root,
    branch: expectedBase.branch,
  });
  if (
    finalState.currentBranch !== expectedBase.branch ||
    finalState.oid !== rollbackOid ||
    finalState.dirty
  ) {
    const error = new Error(
      typeof rollbackResult === "object"
        ? safeError(rollbackResult.stderr, "controlled rollback failed")
        : "controlled rollback did not publish the exact clean rollback commit",
    );
    error.code = "TEAM_MERGE_REVIEW_ROLLBACK_FAILED";
    throw error;
  }
  return {
    success: true,
    state: "rolled_back",
    baseOid: expectedBase.oid,
    resultOid: publishedOid,
    rollbackOid,
    rollbackRef,
  };
}
