import { executionBroker } from "./process-execution-broker/index.js";

export const PROCESS_TREE_CLEANUP_MAX_MS = 2_000;
export const PROCESS_TREE_GRACE_MAX_MS = 500;
const TREE_MODES = new Set(["sandbox", "posix-group", "windows-tree"]);

function boundedMilliseconds(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(parsed)));
}

function validChildPid(child) {
  const pid = Number(child?.pid);
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid ? pid : null;
}

function childHasClosed(child, observedClose) {
  return (
    observedClose() ||
    (child?.exitCode !== null && child?.exitCode !== undefined) ||
    (child?.signalCode !== null && child?.signalCode !== undefined)
  );
}

function posixGroupIsGone(pid, kill) {
  try {
    kill(-pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function requestDirectSignal(child, signal) {
  try {
    return child?.kill?.(signal) !== false;
  } catch {
    return false;
  }
}

function requestPosixGroupSignal(child, pid, signal, kill) {
  try {
    kill(-pid, signal);
    return { requested: true, treeRequested: true };
  } catch {
    return {
      requested: requestDirectSignal(child, signal),
      treeRequested: false,
    };
  }
}

function requestWindowsTreeSignal(child, pid, force, spawnSync, timeoutMs) {
  try {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    const result = spawnSync("taskkill", args, {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: Math.max(1, timeoutMs),
      origin: "process-tree:taskkill",
      policy: "allow",
      scope: "process-tree",
    });
    if (!result?.error && result?.status === 0) {
      return { requested: true, treeRequested: true };
    }
  } catch {
    // Fall through to the hard-phase fallback below.
  }
  // Never kill only the Windows root during the soft phase: doing so can
  // orphan its descendants and make the later `/T /F` walk impossible.
  if (!force) return { requested: false, treeRequested: false };
  return {
    requested: requestDirectSignal(child, "SIGKILL"),
    treeRequested: false,
  };
}

/**
 * Retire one Broker-owned child tree inside a host-capped deadline.
 *
 * `treeMode` describes the ownership established at spawn time:
 * - `sandbox`: a PID namespace / Windows Job close fence owns descendants;
 * - `posix-group`: the child is the leader of a detached process group;
 * - `windows-tree`: taskkill walks the live root's descendant tree.
 *
 * The function never throws and never treats a direct-child fallback as proof
 * that descendants are gone. Callers can preserve their primary error while
 * attaching the structured result, or fail closed on an unconfirmed explicit
 * disconnect.
 */
export async function terminateOwnedProcessTree(child, options = {}) {
  const platform = options.platform || process.platform;
  const cleanupTimeoutMs = boundedMilliseconds(
    options.cleanupTimeoutMs,
    PROCESS_TREE_CLEANUP_MAX_MS,
    PROCESS_TREE_CLEANUP_MAX_MS,
  );
  const graceMs = Math.min(
    cleanupTimeoutMs,
    boundedMilliseconds(options.graceMs, 250, PROCESS_TREE_GRACE_MAX_MS),
  );
  const now = options.now || Date.now;
  const sleep =
    options.sleep ||
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const kill = options.kill || process.kill.bind(process);
  const spawnSync =
    options.spawnSync || executionBroker.spawnSync.bind(executionBroker);
  const pid = validChildPid(child);
  const inferredTreeMode =
    options.treeMode ||
    (options.sandboxManagedTree === true
      ? "sandbox"
      : platform === "win32"
        ? "windows-tree"
        : "posix-group");
  const treeMode = TREE_MODES.has(inferredTreeMode)
    ? inferredTreeMode
    : platform === "win32"
      ? "windows-tree"
      : "posix-group";
  const startedAt = now();
  const deadline = startedAt + cleanupTimeoutMs;
  let closeObserved = options.alreadyClosed === true;
  let softRequested = false;
  let hardRequested = false;
  let treeRequested = false;
  let escalated = false;

  const onClose = () => {
    closeObserved = true;
  };
  child?.once?.("close", onClose);

  const remaining = () => Math.max(0, deadline - now());
  const closed = () => childHasClosed(child, () => closeObserved);
  const treeGone = () => {
    if (!pid) return false;
    if (treeMode === "sandbox") return closed();
    if (treeMode === "posix-group") return posixGroupIsGone(pid, kill);
    return treeRequested;
  };
  const confirmed = () => closed() && treeGone();
  const waitForConfirmation = async (maximumMs) => {
    const phaseDeadline = Math.min(deadline, now() + Math.max(0, maximumMs));
    while (!confirmed() && now() < phaseDeadline) {
      await sleep(Math.max(1, Math.min(10, phaseDeadline - now())));
    }
    return confirmed();
  };
  const request = (force) => {
    if (!pid) {
      return {
        requested: requestDirectSignal(child, force ? "SIGKILL" : "SIGTERM"),
        treeRequested: false,
      };
    }
    if (treeMode === "sandbox") {
      return {
        requested: requestDirectSignal(child, force ? "SIGKILL" : "SIGTERM"),
        treeRequested: true,
      };
    }
    if (treeMode === "windows-tree") {
      return requestWindowsTreeSignal(
        child,
        pid,
        force,
        spawnSync,
        remaining(),
      );
    }
    return requestPosixGroupSignal(
      child,
      pid,
      force ? "SIGKILL" : "SIGTERM",
      kill,
    );
  };

  try {
    if (!pid) {
      // Test doubles and partial spawn failures have no verifiable tree
      // identity. Preserve legacy best-effort direct-child cleanup without
      // upgrading it to a whole-tree claim.
      const attempt = request(true);
      hardRequested = attempt.requested;
      return {
        pid: null,
        treeMode,
        verifiable: false,
        softRequested,
        hardRequested,
        treeRequested: false,
        escalated: true,
        closed: closed(),
        treeTerminated: false,
        confirmed: false,
        deadlineExceeded: false,
        elapsedMs: Math.max(0, now() - startedAt),
      };
    }

    // A managed sandbox close fence already proves its namespace/job is empty.
    // A closed unmanaged POSIX root does not: descendants in the owned group
    // must still be signalled and probed.
    if (treeMode === "sandbox" && closed()) {
      treeRequested = true;
    } else if (!closed()) {
      try {
        child?.stdin?.end?.();
      } catch {
        // EOF is only an additional graceful hint; SIGTERM remains authoritative.
      }
      const attempt = request(false);
      softRequested = attempt.requested;
      treeRequested ||= attempt.treeRequested;
      await waitForConfirmation(graceMs);
    }

    if (!confirmed()) {
      escalated = true;
      const attempt = request(true);
      hardRequested = attempt.requested;
      treeRequested ||= attempt.treeRequested;
      if (remaining() > 0) await waitForConfirmation(remaining());
    }

    const didConfirm = confirmed();
    return {
      pid,
      treeMode,
      verifiable: true,
      softRequested,
      hardRequested,
      treeRequested,
      escalated,
      closed: closed(),
      treeTerminated: treeGone(),
      confirmed: didConfirm,
      deadlineExceeded: !didConfirm && remaining() === 0,
      elapsedMs: Math.max(0, now() - startedAt),
    };
  } finally {
    child?.removeListener?.("close", onClose);
  }
}
