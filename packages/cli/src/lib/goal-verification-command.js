import { createHash, randomUUID } from "node:crypto";
import executionBroker from "./process-execution-broker/index.js";
import { terminateOwnedProcessTree } from "./process-tree-termination.js";
import { redactSecrets } from "./secret-scan.js";

const MAX_OUTPUT_BYTES = 128 * 1024;
const RESULT_PREFIX = "CC_GOAL_CHECK_RESULT ";
export const GOAL_CHECK_RESULT_SCHEMA = "chainlesschain.goal-check-result/v1";

function checkReceipt(stdout, check, invocationId) {
  const lines = stdout
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(RESULT_PREFIX));
  if (lines.length !== 1 || lines[0].length > 16 * 1024) return null;
  try {
    const receipt = JSON.parse(lines[0].slice(RESULT_PREFIX.length));
    if (
      !receipt ||
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      Object.keys(receipt).some(
        (key) =>
          !["schema", "checkId", "invocationId", "requirements"].includes(key),
      ) ||
      receipt.schema !== GOAL_CHECK_RESULT_SCHEMA ||
      receipt.checkId !== check.id ||
      receipt.invocationId !== invocationId ||
      !Array.isArray(receipt.requirements) ||
      receipt.requirements.length !== check.requirements.length
    )
      return null;
    const ids = new Set();
    for (const entry of receipt.requirements) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        Object.keys(entry).some((key) => !["id", "passed"].includes(key)) ||
        !check.requirements.includes(entry.id) ||
        ids.has(entry.id) ||
        entry.passed !== true
      )
        return null;
      ids.add(entry.id);
    }
    return receipt;
  } catch {
    return null;
  }
}
export function goalVerificationError(message, reason = "error") {
  return Object.assign(new Error(message), {
    code: "CC_GOAL_VERIFICATION_FAILED",
    goalVerificationFailure: true,
    subtype: "error_goal_verification",
    endReason: reason,
  });
}

export function checkGoalVerificationCancellation(signal) {
  if (signal?.aborted)
    throw goalVerificationError("Goal verification was cancelled", "cancelled");
}

function outputEvidence(bytes, truncated) {
  const text = bytes.toString("utf8");
  const preview =
    text.length <= 4000
      ? text
      : `${text.slice(0, 1980)}\n[... truncated ...]\n${text.slice(-1980)}`;
  return {
    bytes: bytes.length,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    truncated,
    preview: redactSecrets(preview),
  };
}

/** Execute a user-selected, frozen acceptance command, never model tool text.
 * Use argv without a shell and wait for the actual close / cleanup fence.
 */
export async function runGoalVerificationCommand(
  check,
  { cwd, signal, timeoutMs } = {},
) {
  checkGoalVerificationCancellation(signal);
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const invocationId = randomUUID();
    let child, timer, stopping, stopReason, spawnError;
    let closed = false,
      settled = false,
      exitCode = null,
      exitSignal = null;
    const streams = {
      stdout: { chunks: [], size: 0, truncated: false },
      stderr: { chunks: [], size: 0, truncated: false },
    };
    const finish = (cleanup) => {
      if (settled || (stopping && cleanup === undefined)) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (cleanup && !cleanup.confirmed) {
        const error = goalVerificationError(
          "Goal checker process cleanup is unconfirmed; reconcile it before continuing",
        );
        error.cleanup = cleanup;
        error.verification = {
          checkId: check.id,
          status: "cleanup-unconfirmed",
          manualReviewRequired: true,
          cleanup,
        };
        reject(error);
        return;
      }
      if (signal?.aborted || stopReason === "cancelled") {
        reject(
          goalVerificationError("Goal verification was cancelled", "cancelled"),
        );
        return;
      }
      const stdout = Buffer.concat(streams.stdout.chunks);
      const receipt = checkReceipt(stdout, check, invocationId);
      resolve({
        id: check.id,
        invocationId,
        command: { executable: check.executable, args: check.args },
        exitCode: closed && !spawnError ? exitCode : null,
        signal: exitSignal,
        status:
          stopReason ||
          (spawnError
            ? "spawn-failed"
            : exitCode === 0 && !exitSignal
              ? receipt
                ? "passed"
                : "receipt-invalid"
              : "failed"),
        receipt,
        durationMs: Date.now() - startedAt,
        stdout: outputEvidence(stdout, streams.stdout.truncated),
        stderr: outputEvidence(
          Buffer.concat(streams.stderr.chunks),
          streams.stderr.truncated,
        ),
        ...(cleanup ? { cleanup } : {}),
      });
    };
    const stop = (reason) => {
      if (settled || stopping) return;
      stopReason = reason;
      stopping = Promise.resolve().then(() =>
        terminateOwnedProcessTree(child, { alreadyClosed: closed }),
      );
      stopping.then(finish, () => finish({ confirmed: false }));
    };
    const onAbort = () => stop("cancelled");
    try {
      // Acceptance programs do not inherit provider credentials or Node preload
      // hooks. They can read the explicitly selected workspace as ordinary tests.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(path|systemroot|windir|temp|tmp|home|userprofile|lang|lc_all)$/i.test(
            key,
          ),
        ),
      );
      env.CC_GOAL_CHECK_ID = check.id;
      env.CC_GOAL_CHECK_INVOCATION = invocationId;
      child = executionBroker.spawn(
        check.executable === "node" ? process.execPath : check.executable,
        check.args,
        {
          cwd,
          env,
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          origin: "headless-goal:verification",
          scope: "headless-goal",
          policy: "allow",
        },
      );
      for (const name of ["stdout", "stderr"])
        child[name]?.on("data", (chunk) => {
          const bytes = Buffer.from(chunk),
            stream = streams[name];
          const remaining = MAX_OUTPUT_BYTES - stream.size;
          if (remaining > 0) {
            const kept = bytes.subarray(0, remaining);
            stream.chunks.push(kept);
            stream.size += kept.length;
          }
          if (bytes.length > remaining) {
            stream.truncated = true;
            stop("output-limit");
          }
        });
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, childSignal) => {
        closed = true;
        exitCode = code;
        exitSignal = childSignal;
        finish();
      });
      timer = setTimeout(() => stop("timed-out"), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    } catch (error) {
      spawnError = error;
      if (child?.pid) stop("spawn-failed");
      else finish();
    }
  });
}
