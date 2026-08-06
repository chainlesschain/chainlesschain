import { performance } from "node:perf_hooks";

const HOST_CLEANUP_DEADLINE_MS = 10_000;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function projectedErrorCode(error) {
  if (!error) return null;
  return typeof error.code === "string" && SAFE_ERROR_CODE.test(error.code)
    ? error.code
    : "CC_CLEANUP_STEP_FAILED";
}

export function normalizeCleanupDeadlineMs(value) {
  return Number.isFinite(value) &&
    value > 0 &&
    value <= HOST_CLEANUP_DEADLINE_MS
    ? Math.max(1, Math.floor(value))
    : HOST_CLEANUP_DEADLINE_MS;
}

export function cleanupDeadlineError(report) {
  const error = new Error(
    `CLI cleanup exceeded the host deadline of ${report.timeoutMs} ms`,
  );
  error.code = "CC_CLEANUP_DEADLINE_EXCEEDED";
  error.isCleanupDeadlineFailure = true;
  error.timeoutMs = report.timeoutMs;
  error.timedOutSteps = report.steps
    .filter((step) => step.status === "timeout")
    .map((step) => step.name);
  error.cleanupReport = report;
  return error;
}

/**
 * One host-owned absolute deadline shared by a cleanup sequence. Operations
 * are invoked in order. If an operation consumes the remaining budget, later
 * disposers are still invoked (and observed) but are not awaited, so one
 * uncooperative adapter cannot prevent exhaustive teardown from starting.
 */
export function createCleanupDeadline(
  { timeoutMs, label = "cli-cleanup" } = {},
  deps = {},
) {
  // A wall-clock adjustment must never extend teardown past the host ceiling.
  const now = deps.now || (() => performance.now());
  const setTimer = deps.setTimeout || setTimeout;
  const clearTimer = deps.clearTimeout || clearTimeout;
  const normalizedTimeoutMs = normalizeCleanupDeadlineMs(timeoutMs);
  let startedAt = null;
  let deadlineAt = null;
  const steps = [];

  const ensureStarted = () => {
    if (startedAt !== null) return;
    startedAt = now();
    deadlineAt = startedAt + normalizedTimeoutMs;
  };

  const record = (name, status, stepStartedAt, error = null) => {
    steps.push(
      Object.freeze({
        name,
        status,
        durationMs: Math.max(0, now() - stepStartedAt),
        errorCode: projectedErrorCode(error),
      }),
    );
  };

  return {
    async run(name, operation) {
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError("cleanup step name is required");
      }
      if (typeof operation !== "function") {
        record(name, "skipped", now());
        return { status: "skipped" };
      }
      ensureStarted();
      const stepStartedAt = now();
      let promise;
      try {
        promise = Promise.resolve(operation());
      } catch (error) {
        record(name, "error", stepStartedAt, error);
        return { status: "error", error };
      }
      // Always observe a late rejection after a timeout.
      promise.catch(() => {});
      const remainingMs = Math.max(0, deadlineAt - now());
      if (remainingMs === 0) {
        record(name, "timeout", stepStartedAt);
        return { status: "timeout" };
      }

      let timer = null;
      const timeout = new Promise((resolve) => {
        timer = setTimer(() => resolve({ timeout: true }), remainingMs);
      });
      const settled = await Promise.race([
        promise.then(
          (value) => ({ value }),
          (error) => ({ error }),
        ),
        timeout,
      ]);
      if (timer !== null) clearTimer(timer);
      if (settled?.timeout) {
        record(name, "timeout", stepStartedAt);
        return { status: "timeout" };
      }
      if (settled?.error) {
        record(name, "error", stepStartedAt, settled.error);
        return { status: "error", error: settled.error };
      }
      record(name, "completed", stepStartedAt);
      return { status: "completed", value: settled.value };
    },
    report() {
      const finishedAt = now();
      const timedOut = steps.some((step) => step.status === "timeout");
      return Object.freeze({
        label,
        timeoutMs: normalizedTimeoutMs,
        startedAt,
        finishedAt,
        elapsedMs: startedAt === null ? 0 : Math.max(0, finishedAt - startedAt),
        timedOut,
        completed: !timedOut,
        steps: Object.freeze([...steps]),
      });
    },
  };
}

export const MAX_CLI_CLEANUP_DEADLINE_MS = HOST_CLEANUP_DEADLINE_MS;
