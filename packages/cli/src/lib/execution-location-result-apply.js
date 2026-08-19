import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_TRANSACTION_COVERAGE } from "./process-execution-broker/workspace-transaction.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

const MAX_GIT_OUTPUT_BYTES = 16 * 1024;
const MAX_APPLY_OUTPUT_BYTES = 1024 * 1024;
const PROCESS_TREE_BOUNDARY = "process-tree";

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationResultApply"), "utf8")
    .digest("hex")}`;
}

function bytesLength(value) {
  if (value == null) return 0;
  return Buffer.isBuffer(value)
    ? value.byteLength
    : Buffer.byteLength(String(value), "utf8");
}

function runGit(broker, args, options = {}) {
  if (!broker || typeof broker.spawnSync !== "function") {
    throw new TypeError("result apply requires ProcessExecutionBroker");
  }
  const result = broker.spawnSync("git", args, {
    cwd: options.cwd,
    shell: false,
    detached: false,
    policy: "allow",
    origin: options.origin || "session:result-apply",
    scope: "session",
    encoding: "buffer",
    maxBuffer: options.maxBuffer || MAX_APPLY_OUTPUT_BYTES,
    ...(options.input ? { input: options.input } : {}),
    ...(options.requiredBoundaries
      ? { requiredBoundaries: options.requiredBoundaries }
      : {}),
  });
  return Object.freeze({
    exitCode: Number.isInteger(result?.status) ? result.status : null,
    signal: typeof result?.signal === "string" ? result.signal : null,
    stdoutBytes: bytesLength(result?.stdout),
    stderrBytes: bytesLength(result?.stderr),
    errorCode: result?.error?.code ? String(result.error.code) : null,
    stdout: result?.stdout,
  });
}

function strictGitText(result, label, maxBytes) {
  if (result.exitCode !== 0 || result.errorCode !== null) {
    throw new Error(`${label} failed`);
  }
  const bytes = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout || "");
  if (bytes.byteLength <= 0 || bytes.byteLength > maxBytes) {
    throw new Error(`${label} output is invalid`);
  }
  return bytes.toString("utf8").trim();
}

function canonicalDirectory(value) {
  const requested = path.resolve(value);
  const resolved = (fs.realpathSync.native || fs.realpathSync)(requested);
  const entry = fs.lstatSync(resolved);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("result apply workspace root is invalid");
  }
  return path.resolve(resolved);
}

function samePath(left, right, platform = process.platform) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function verifyExecutionLocationResultApplySourceGit(
  sessionAuthority,
  options = {},
) {
  const broker = options.broker;
  const expectedRoot = sessionAuthority?.binding?.source?.git?.root;
  const expectedCommit = String(
    sessionAuthority?.binding?.source?.git?.commit || "",
  ).toLowerCase();
  if (
    typeof expectedRoot !== "string" ||
    expectedRoot.length === 0 ||
    !/^[a-f0-9]{40,64}$/u.test(expectedCommit)
  ) {
    throw new Error(
      "session has no exact source Git identity for result apply",
    );
  }
  const requestedRoot = canonicalDirectory(
    options.workspaceRoot || expectedRoot,
  );
  const liveRootText = strictGitText(
    runGit(broker, ["rev-parse", "--show-toplevel"], {
      cwd: requestedRoot,
      origin: "session:result-apply-git-root",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    }),
    "result apply Git root readback",
    MAX_GIT_OUTPUT_BYTES,
  );
  const liveRoot = canonicalDirectory(liveRootText);
  const canonicalExpectedRoot = canonicalDirectory(expectedRoot);
  const liveCommit = strictGitText(
    runGit(broker, ["rev-parse", "--verify", "HEAD"], {
      cwd: liveRoot,
      origin: "session:result-apply-git-head",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    }),
    "result apply Git HEAD readback",
    128,
  ).toLowerCase();
  if (
    !samePath(requestedRoot, liveRoot, options.platform) ||
    !samePath(canonicalExpectedRoot, liveRoot, options.platform) ||
    liveCommit !== expectedCommit
  ) {
    throw new Error("live source Git identity changed before result apply");
  }
  return Object.freeze({
    workspaceRoot: liveRoot,
    sourceGit: Object.freeze({
      rootDigest: digest(
        "chainlesschain.execution-location.result-apply-git-root.v1\0",
        { canonicalRoot: liveRoot },
      ),
      commit: liveCommit,
    }),
  });
}

function transactionId(sessionId, applyId) {
  return `result-apply-${createHash("sha256")
    .update(String(sessionId), "utf8")
    .update("\0", "utf8")
    .update(String(applyId), "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function preparedTransaction(transaction) {
  const state = transaction.snapshot();
  return Object.freeze({
    id: transaction.id,
    checkpointId: transaction.checkpointId,
    checkpointDigest: state.checkpoint?.digest,
    coverage: state.requestedCoverage || WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    externalSideEffects: false,
  });
}

export function terminalExecutionLocationResultApplyTransaction(stateInput) {
  const state = stateInput?.snapshot ? stateInput.snapshot() : stateInput;
  const evidence = state?.evidence;
  if (
    !state ||
    !evidence ||
    !["committed", "rolled_back"].includes(state.state) ||
    !["committed", "rolled_back"].includes(evidence.outcome)
  ) {
    throw new Error("result apply workspace transaction is not terminal");
  }
  return Object.freeze({
    id: state.id,
    checkpointId: state.checkpointId,
    checkpointDigest: evidence.checkpointDigest,
    evidenceDigest: evidence.evidenceDigest,
    writeManifestDigest: evidence.writeManifestDigest,
    coverage: evidence.coverage,
    fileCoverage: evidence.fileCoverage,
    externalSideEffects: evidence.externalSideEffects,
    uncoveredPaths: Object.freeze(
      [...(evidence.uncoveredPaths || [])].sort((left, right) =>
        left.localeCompare(right),
      ),
    ),
  });
}

function rollbackResult(
  transaction,
  stage,
  processResult,
  reason,
  error = null,
) {
  const evidence = transaction.rollback({ reason });
  return Object.freeze({
    ok: false,
    outcome: "rolled_back",
    stage,
    transaction: terminalExecutionLocationResultApplyTransaction({
      ...transaction.snapshot(),
      evidence,
    }),
    process: processResult
      ? Object.freeze({
          exitCode: processResult.exitCode,
          signal: processResult.signal,
          stdoutBytes: processResult.stdoutBytes,
          stderrBytes: processResult.stderrBytes,
          errorCode: processResult.errorCode,
        })
      : null,
    error,
  });
}

export function executeControlledExecutionLocationResultApply(input = {}) {
  const broker = input.broker;
  if (
    !broker ||
    typeof broker.beginWorkspaceTransaction !== "function" ||
    typeof broker.spawnSync !== "function"
  ) {
    throw new TypeError("result apply requires ProcessExecutionBroker");
  }
  const diffBytes = Buffer.isBuffer(input.diffBytes)
    ? Buffer.from(input.diffBytes)
    : Buffer.from(input.diffBytes || "");
  const transaction = broker.beginWorkspaceTransaction({
    id: transactionId(input.sessionId, input.applyId),
    workspaceRoot: input.workspaceRoot,
    runId: `session-result-apply-${input.applyId}`,
    taskKey: `result-apply:${input.applyId}`,
    coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
    externalSideEffects: false,
    writerIsolation: "exclusive-workspace",
    exclusions: [".git"],
    ...(input.stateDir ? { stateDir: path.resolve(input.stateDir) } : {}),
  });
  const prepared = preparedTransaction(transaction);
  try {
    input.onPrepared?.(prepared);
  } catch (error) {
    return rollbackResult(
      transaction,
      "reservation",
      null,
      "result apply reservation failed before process execution",
      error,
    );
  }

  let checked;
  try {
    checked = runGit(
      broker,
      ["apply", "--check", "--whitespace=error-all", "-"],
      {
        cwd: input.workspaceRoot,
        input: diffBytes,
        requiredBoundaries: [PROCESS_TREE_BOUNDARY],
      },
    );
  } catch (error) {
    return rollbackResult(
      transaction,
      "check",
      null,
      "git apply check could not complete",
      error,
    );
  }
  if (checked.exitCode !== 0 || checked.errorCode !== null) {
    return rollbackResult(
      transaction,
      "check",
      checked,
      "git apply check rejected the reviewed diff",
    );
  }

  let applied;
  try {
    applied = runGit(broker, ["apply", "--whitespace=error-all", "-"], {
      cwd: input.workspaceRoot,
      input: diffBytes,
      requiredBoundaries: [PROCESS_TREE_BOUNDARY],
    });
  } catch (error) {
    return rollbackResult(
      transaction,
      "apply",
      null,
      "git apply could not complete",
      error,
    );
  }
  if (applied.exitCode !== 0 || applied.errorCode !== null) {
    return rollbackResult(
      transaction,
      "apply",
      applied,
      "git apply rejected the reviewed diff",
    );
  }

  try {
    const evidence = transaction.accept();
    return Object.freeze({
      ok: true,
      outcome: "applied",
      stage: "complete",
      transaction: terminalExecutionLocationResultApplyTransaction({
        ...transaction.snapshot(),
        evidence,
      }),
      process: Object.freeze({
        exitCode: applied.exitCode,
        signal: applied.signal,
        stdoutBytes: checked.stdoutBytes + applied.stdoutBytes,
        stderrBytes: checked.stderrBytes + applied.stderrBytes,
        errorCode: null,
      }),
      error: null,
    });
  } catch (error) {
    return rollbackResult(
      transaction,
      "commit",
      applied,
      "result apply transaction commit failed",
      error,
    );
  }
}
