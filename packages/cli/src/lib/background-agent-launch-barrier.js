/**
 * Read-only startup barrier shared by the detached background worker and its
 * keeper. The launcher publishes both exact child PIDs in one state
 * transaction before clearing `launchFinalizationUncertain`. Until then the
 * children must not contend for the same state lock.
 */

export const BACKGROUND_AGENT_LAUNCH_BARRIER_TIMEOUT_MS = 30_000;

const DEFAULT_POLL_MS = 25;
const PID_FIELDS = new Set(["workerPid", "keeperPid"]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForBackgroundAgentLaunchBarrier(options = {}) {
  const id = String(options.id || "").trim();
  const workerGeneration = String(options.workerGeneration || "").trim();
  const expectedPid = Number(options.expectedPid);
  const pidField = String(options.pidField || "");
  const readState = options.readState;
  const readyWhen = options.readyWhen;
  const now = options.now || Date.now;
  const sleep = options.sleep || delay;
  const timeoutMs = Math.max(
    1,
    Number(options.timeoutMs) || BACKGROUND_AGENT_LAUNCH_BARRIER_TIMEOUT_MS,
  );
  const pollMs = Math.max(1, Number(options.pollMs) || DEFAULT_POLL_MS);

  if (!id) {
    throw new TypeError("background launch barrier id is required");
  }
  if (!PID_FIELDS.has(pidField)) {
    throw new TypeError("background launch barrier pid field is invalid");
  }
  if (!Number.isSafeInteger(expectedPid) || expectedPid <= 0) {
    throw new TypeError("background launch barrier pid is invalid");
  }
  if (typeof readState !== "function") {
    throw new TypeError("background launch barrier state reader is required");
  }
  if (readyWhen !== undefined && typeof readyWhen !== "function") {
    throw new TypeError("background launch barrier readiness check is invalid");
  }

  const deadline = now() + timeoutMs;
  for (;;) {
    const state = readState(id);
    if (!state || state.status !== "running") {
      return Object.freeze({ status: "terminal", state: state || null });
    }
    // Jobs written before generation fencing are allowed to observe an
    // already-terminal record above, but can never enter a running record.
    if (!workerGeneration || state.workerGeneration !== workerGeneration) {
      return Object.freeze({ status: "terminal", state });
    }
    if (state.launchFinalizationUncertain !== true) {
      if (Number(state[pidField]) !== expectedPid) {
        return Object.freeze({ status: "identity-mismatch", state });
      }
      if (!readyWhen || readyWhen(state)) {
        return Object.freeze({ status: "ready", state });
      }
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      return Object.freeze({ status: "timeout", state });
    }
    await sleep(Math.min(pollMs, remaining));
  }
}
