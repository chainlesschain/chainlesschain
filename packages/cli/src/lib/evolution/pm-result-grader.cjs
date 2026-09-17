/**
 * Read-only PM outcome checks. These local observations are NOT signed Eval
 * Gate receipts. The host must stop the Actor before grading and keep expected
 * values and the grader outside the Actor's writable/retrievable scope.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isProxy } = require("node:util/types");

const MAX_BYTES = 1024 * 1024;
const BASELINES = new WeakMap();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function record(value) {
  if (!value || typeof value !== "object" || isProxy(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every((key) => {
    const prop = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && prop.enumerable && "value" in prop;
  });
}

function exact(value, keys) {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function relativeFile(value) {
  if (
    !nonempty(value) ||
    value.length > 512 ||
    /[\\:<>"|?*]/u.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part.trim() !== part ||
          part.endsWith(".") ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  ) {
    throw new TypeError("artifact path must be a confined relative file path");
  }
  return value;
}

function normalizePmExpectation(value) {
  if (!record(value)) throw new TypeError("PM expectation must be plain data");
  if (value.kind === "file-export") {
    if (
      !exact(value, ["kind", "relativePath", "sha256"]) ||
      typeof value.sha256 !== "string" ||
      !DIGEST.test(value.sha256)
    )
      throw new TypeError("file-export requires relativePath and sha256");
    return Object.freeze({
      kind: value.kind,
      relativePath: relativeFile(value.relativePath),
      sha256: value.sha256,
    });
  }
  if (
    value.kind !== "project-state" ||
    !exact(value, ["kind", "id", "name", "status"]) ||
    ![value.id, value.name, value.status].every(nonempty)
  ) {
    throw new TypeError("project-state requires exact id, name and status");
  }
  return Object.freeze({ ...value });
}

function outcome(
  executionSucceeded,
  artifactCheckPassed,
  reason,
  artifactDigest = null,
) {
  return Object.freeze({
    schema: "chainlesschain.pm-local-outcome/v1",
    executionSucceeded: executionSucceeded === true,
    artifactCheckPassed,
    pass: executionSucceeded === true && artifactCheckPassed,
    reason:
      artifactCheckPassed && executionSucceeded !== true
        ? "execution-failed"
        : reason,
    artifactDigest,
    authenticated: false,
    qualifiesForPromotion: false,
  });
}

function confinedTarget(root, relative) {
  let target = root;
  const parts = relativeFile(relative).split("/");
  for (let i = 0; i < parts.length; i++) {
    target = path.join(target, parts[i]);
    try {
      const stat = fs.lstatSync(target);
      if (
        stat.isSymbolicLink() ||
        (i < parts.length - 1 && !stat.isDirectory())
      )
        throw new Error("artifact path contains a link or non-directory");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return target;
}

/** Call before execution, in a fresh host-owned workspace. No files are written. */
function capturePmExportBaseline(artifactRoot, relativePath) {
  if (!nonempty(artifactRoot) || !path.isAbsolute(artifactRoot))
    throw new TypeError("artifactRoot must be absolute");
  const rootStat = fs.lstatSync(artifactRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new TypeError("artifactRoot must be a real directory");
  const root = fs.realpathSync(artifactRoot);
  const target = confinedTarget(root, relativePath);
  try {
    fs.lstatSync(target);
    throw new Error("export target already exists; reset the workspace first");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const handle = Object.freeze({});
  BASELINES.set(handle, { root, rootStat, relativePath });
  return handle;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Reads at most MAX_BYTES + 1; directories, links, stale and oversized files fail. */
function gradePmExportFile({ baseline, expected, executionSucceeded }) {
  const expectation = normalizePmExpectation(expected);
  if (expectation.kind !== "file-export")
    throw new TypeError("file-export expected");
  const captured = BASELINES.get(baseline);
  if (!captured)
    throw new TypeError("a fresh host-captured export baseline is required");
  BASELINES.delete(baseline);
  if (captured.relativePath !== expectation.relativePath)
    throw new TypeError("export path differs from its baseline");
  let descriptor;
  try {
    const rootStat = fs.lstatSync(captured.root);
    if (
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      !sameFile(rootStat, captured.rootStat)
    )
      throw new Error("workspace changed");
    const target = confinedTarget(captured.root, captured.relativePath);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error("invalid artifact");
    const actualPath = fs.realpathSync(target);
    if (actualPath !== target) throw new Error("artifact path changed");
    descriptor = fs.openSync(
      target,
      fs.constants.O_RDONLY |
        (fs.constants.O_NOFOLLOW || 0) |
        (fs.constants.O_NONBLOCK || 0),
    );
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || !sameFile(stat, opened) || opened.size > MAX_BYTES)
      throw new Error("artifact changed");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(
        descriptor,
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (read === 0) break;
      length += read;
    }
    const after = fs.fstatSync(descriptor);
    if (
      length > MAX_BYTES ||
      after.size !== length ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs
    )
      throw new Error("artifact unstable or oversized");
    const finalStat = fs.lstatSync(
      confinedTarget(captured.root, captured.relativePath),
    );
    if (!sameFile(after, finalStat) || !finalStat.isFile())
      throw new Error("artifact replaced");
    const artifactDigest = sha256(bytes.subarray(0, length));
    const pass = artifactDigest === expectation.sha256;
    return outcome(
      executionSucceeded,
      pass,
      pass ? "matched" : "content-mismatch",
      artifactDigest,
    );
  } catch {
    // Do not leak workspace paths, private expected content or OS error strings.
    return outcome(executionSucceeded, false, "artifact-unavailable-or-unsafe");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

/** actual must be read by the trusted host, never from the Actor's self-report. */
function gradePmProjectState({ actual, expected, executionSucceeded }) {
  const expectation = normalizePmExpectation(expected);
  if (expectation.kind !== "project-state")
    throw new TypeError("project-state expected");
  const pass =
    record(actual) &&
    actual.success !== false &&
    ["id", "name", "status"].every((key) => actual[key] === expectation[key]);
  return outcome(
    executionSucceeded,
    pass,
    pass ? "matched" : "project-state-mismatch",
  );
}

function gradePmBoardExport({ actual, expected, executionSucceeded }) {
  if (
    !exact(expected, ["boardId", "taskIds", "sprintIds"]) ||
    !nonempty(expected.boardId)
  )
    throw new TypeError(
      "board expectation requires boardId, taskIds and sprintIds",
    );
  for (const ids of [expected.taskIds, expected.sprintIds]) {
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every(nonempty) ||
      new Set(ids).size !== ids.length
    )
      throw new TypeError("expected board IDs must be nonempty and unique");
  }
  const matches = (rows, ids) =>
    Array.isArray(rows) &&
    rows.length === ids.length &&
    rows.every(record) &&
    new Set(rows.map((row) => row.id)).size === ids.length &&
    ids.every((id) => rows.some((row) => row.id === id));
  const pass =
    record(actual) &&
    actual.success !== false &&
    record(actual.board) &&
    actual.board.id === expected.boardId &&
    matches(actual.tasks, expected.taskIds) &&
    matches(actual.sprints, expected.sprintIds);
  return outcome(
    executionSucceeded,
    pass,
    pass ? "matched" : "board-content-mismatch",
  );
}

module.exports = {
  capturePmExportBaseline,
  gradePmExportFile,
  gradePmProjectState,
  gradePmBoardExport,
  normalizePmExpectation,
};
