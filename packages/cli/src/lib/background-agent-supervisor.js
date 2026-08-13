import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getHomeDir } from "./paths.js";
import { withFileLock } from "./with-file-lock.js";
import { deriveSessionState } from "./session-lifecycle.js";
import {
  getSessionPresence,
  SESSION_PRESENCE,
} from "../harness/jsonl-session-store.js";
import {
  finishAgentWorktree,
  validateAgentWorktree,
} from "./agent-worktree.js";
import { rejectPendingBackgroundInteractions } from "./background-interaction-journal.js";
import executionBroker from "./process-execution-broker/index.js";
import {
  agentPrintArgument,
  assertBackgroundArgvDurable,
  stripFirstTurnPromptArgv,
} from "./background-command-argv.js";
import { terminateOwnedProcessTree } from "./process-tree-termination.js";
import { sendAgentNotification } from "./agent-notify.js";
import { withSessionHostRecoveryLease } from "./session-host-lease.js";
import {
  buildNeedsInputNotification,
  claimNeedsInputNotification,
  settleNeedsInputNotification,
} from "./background-needs-input-incident.js";
import {
  assessBackgroundLaunchProfileCompatibility,
  buildArgvFromBackgroundLaunchProfile,
  captureBackgroundLaunchProfile,
  fingerprintBackgroundLaunchProfile,
  normalizeBackgroundLaunchProfile,
  refreshBackgroundLaunchProfileSources,
  stripBackgroundLaunchSecrets,
  verifyBackgroundLaunchProfileSources,
} from "./background-launch-profile.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
export const DEFAULT_HEARTBEAT_STALE_MS = 120000;

/**
 * Pid identity tolerance (Gap 1: OS pid reuse). A pid alone does not identify
 * a process — after the worker dies the OS can hand the same pid to an
 * unrelated process, making `kill(pid, 0)` lie: the session shows "running"
 * until the heartbeat goes stale and, far worse, `stopBackgroundAgent` would
 * `taskkill /T /F` an innocent process tree. The state file records
 * `startedAt` (launcher clock, written just before the spawn), so we compare
 * it against the pid's REAL creation time. Reuse is one-sided: a process
 * that took over the pid can only have been created AFTER the original
 * worker died — i.e. noticeably later than startedAt. Creation at/before
 * startedAt (± tolerance for clock skew and spawn latency) is our process.
 */
export const PID_IDENTITY_TOLERANCE_MS = 60000;

const START_TIME_CACHE_TTL_MS = 10000;
const _startTimeCache = new Map();

function runSupervisorCommand(file, args, options, origin) {
  return _deps.spawnSync(file, args, {
    ...options,
    origin,
    policy: "allow",
    scope: "background-agent",
    shell: false,
  });
}

/** CIM_DATETIME (`20260711120000.500000+480`) → epoch ms, null when unparseable. */
export function parseCimDateToMs(raw) {
  const m =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})$/.exec(
      String(raw || "").trim(),
    );
  if (!m) return null;
  const localAsUtc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    Math.floor(Number(m[7]) / 1000),
  );
  const offsetMinutes = (m[8] === "-" ? -1 : 1) * Number(m[9]);
  return localAsUtc - offsetMinutes * 60000;
}

/**
 * Read a process's creation time (epoch ms) with ONE synchronous probe, or
 * null when it cannot be determined (missing tools, permissions, platform
 * quirks). Callers must treat null as "unknown" and FAIL OPEN to the legacy
 * kill(pid, 0) answer — a broken probe must never declare a live worker dead
 * (nor green-light killing a process we could not identify as ours; see the
 * per-call-site policy).
 */
function defaultReadProcessStartTimeMs(pid) {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 0) return null;
  if (process.platform === "win32") {
    // wmic first (fast, ~100-300ms); PowerShell CIM as fallback (wmic is
    // removed from recent Windows 11 builds).
    try {
      const r = runSupervisorCommand(
        "wmic",
        [
          "process",
          "where",
          `ProcessId=${target}`,
          "get",
          "CreationDate",
          "/value",
        ],
        { windowsHide: true, encoding: "utf8", timeout: 5000 },
        "background-agent:process-start-time",
      );
      if (!r.error && r.status === 0) {
        const m = /CreationDate=([^\r\n]+)/.exec(r.stdout || "");
        const ms = m ? parseCimDateToMs(m[1]) : null;
        if (ms !== null) return ms;
      }
    } catch {
      /* fall through to PowerShell */
    }
    try {
      const script =
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${target}' -ErrorAction SilentlyContinue; ` +
        "if ($p -and $p.CreationDate) { [DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds() }";
      const r = runSupervisorCommand(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, encoding: "utf8", timeout: 10000 },
        "background-agent:process-start-time",
      );
      if (!r.error && r.status === 0) {
        const n = Number(String(r.stdout || "").trim());
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      /* fail open below */
    }
    return null;
  }
  // POSIX: `ps -o lstart=` gives an absolute start timestamp on Linux + macOS
  // (procps and BSD ps both support it; busybox ps does not → null → open).
  try {
    const r = runSupervisorCommand(
      "ps",
      ["-o", "lstart=", "-p", String(target)],
      {
        encoding: "utf8",
        timeout: 5000,
      },
      "background-agent:process-start-time",
    );
    if (!r.error && r.status === 0) {
      const t = Date.parse(String(r.stdout || "").trim());
      if (Number.isFinite(t) && t > 0) return t;
    }
  } catch {
    /* fail open below */
  }
  return null;
}

/**
 * Kill a whole process tree (Gap 2 orphan reclaim). Windows: `taskkill /T`.
 * POSIX: negative-pid group signal (the worker spawns the agent child
 * detached → its own group), falling back to a direct kill.
 */
function defaultKillProcessTree(pid, signal = "SIGKILL") {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 0) return false;
  // Never signal ourselves: no legitimate background-agent record can point at
  // the process performing the reclaim, so a matching pid is a corrupt/stale
  // record — killing it would take down the caller (a `cc` CLI process, or a
  // vitest worker when a test drives this path with a live-looking fixture).
  if (target === process.pid) return false;
  try {
    if (process.platform === "win32") {
      const r = runSupervisorCommand(
        "taskkill",
        ["/PID", String(target), "/T", "/F"],
        {
          windowsHide: true,
          encoding: "utf8",
        },
        "background-agent:process-tree-kill",
      );
      return !r.error && r.status === 0;
    }
    try {
      _deps.kill(-target, signal);
      return true;
    } catch {
      _deps.kill(target, signal);
      return true;
    }
  } catch {
    return false;
  }
}

export const _deps = {
  spawn: executionBroker.spawn.bind(executionBroker),
  spawnSync: executionBroker.spawnSync.bind(executionBroker),
  // Single POSIX signal seam: every kill this module issues goes through here
  // so tests can stub it — a bare `process.kill` is NOT interceptable and a
  // fixture recording a live pid would eat a REAL signal (the shard-2/4
  // "worker-death" CI flake: a stop-flow test recorded pid=process.pid and
  // SIGTERMed its own vitest worker).
  kill: (pid, signal) => process.kill(pid, signal),
  getSessionPresence,
  readProcessStartTimeMs: defaultReadProcessStartTimeMs,
  killProcessTree: defaultKillProcessTree,
  terminateOwnedProcessTree,
};

/**
 * Stop the active turn launched by an attached background session.
 * Windows must terminate the complete descendant tree; a bare ChildProcess
 * kill only reaches the top-level CLI process and can orphan tool children.
 */
export function stopBackgroundAgentChildTree(
  pid,
  { platform = process.platform, signal = "SIGTERM" } = {},
) {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 0 || target === process.pid) {
    const error = new Error("background_agent_child_pid_invalid");
    error.code = "ERR_BACKGROUND_AGENT_CHILD_PID_INVALID";
    throw error;
  }
  if (platform === "win32") {
    const result = runSupervisorCommand(
      "taskkill",
      ["/PID", String(target), "/T", "/F"],
      {
        windowsHide: true,
        encoding: "utf8",
      },
      "background-agent:session-stop-tree",
    );
    if (result?.error || result?.status !== 0) {
      const error = new Error(
        `background_agent_child_tree_stop_failed: ${
          result?.error?.message ||
          result?.stderr ||
          `taskkill exited ${result?.status}`
        }`,
      );
      error.code = "ERR_BACKGROUND_AGENT_CHILD_TREE_STOP_FAILED";
      throw error;
    }
    return true;
  }
  try {
    _deps.kill(-target, signal);
  } catch {
    _deps.kill(target, signal);
  }
  return true;
}

/** Cached probe (default impl only — injected probes run uncached for tests). */
function processStartTimeMs(pid, options = {}) {
  if (_deps.readProcessStartTimeMs !== defaultReadProcessStartTimeMs) {
    const raw = _deps.readProcessStartTimeMs(pid);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const key = Number(pid);
  const at = Date.now();
  if (options.fresh === true) {
    const value = defaultReadProcessStartTimeMs(key);
    _startTimeCache.set(key, { at, value });
    return value;
  }
  const hit = _startTimeCache.get(key);
  if (hit && at - hit.at < START_TIME_CACHE_TTL_MS) return hit.value;
  const value = defaultReadProcessStartTimeMs(key);
  _startTimeCache.set(key, { at, value });
  return value;
}

function nowMs(options = {}) {
  return typeof options.now === "number" ? options.now : Date.now();
}

function heartbeatStaleMs(options = {}) {
  const configured =
    options.heartbeatStaleMs ||
    process.env.CC_BACKGROUND_AGENT_HEARTBEAT_STALE_MS;
  const n = Number(configured);
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : DEFAULT_HEARTBEAT_STALE_MS;
}

export function backgroundAgentsDir() {
  const dir =
    process.env.CC_BACKGROUND_AGENTS_DIR ||
    join(getHomeDir(), "background-agents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function createBackgroundAgentId() {
  return `bg-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

function safeId(id) {
  if (!/^bg-[a-zA-Z0-9-]+$/.test(String(id || ""))) {
    throw new Error(`Invalid background agent id: ${id}`);
  }
  return String(id);
}

export function statePath(id) {
  return join(backgroundAgentsDir(), `${safeId(id)}.json`);
}

export function logPath(id) {
  return join(backgroundAgentsDir(), `${safeId(id)}.log`);
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "lost"]);

function readBackgroundAgentStateResult(id) {
  const target = statePath(id);
  if (!existsSync(target)) return { state: null, missing: true, error: null };
  try {
    const state = JSON.parse(readFileSync(target, "utf8"));
    if (!state || typeof state !== "object" || state.id !== id) {
      throw new Error(`State record does not belong to ${id}`);
    }
    return { state, missing: false, error: null };
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      return { state: null, missing: true, error: null };
    }
    const error = new Error(`Corrupt background agent state: ${id}`, { cause });
    error.code = "BACKGROUND_AGENT_STATE_CORRUPT";
    return { state: null, missing: false, error };
  }
}

function mergeBackgroundAgentState(current, requested) {
  let next = requested;
  // Field-aware merge against the freshest on-disk state. The state file has
  // multiple concurrent read-modify-write writers (launcher, worker heartbeat/
  // turn/finalize, rename/pin/stop from other processes) with last-writer-wins
  // semantics — a writer holding a stale snapshot used to clobber a terminal
  // status back to "running" (phantom session, real exit code lost) or roll a
  // fresh rename back to the old title. Two invariants restore convergence:
  //   1. a terminal status wins over a racing "running" snapshot — there is no
  //      legitimate same-id terminal→running transition (resume mints a NEW
  //      id, and the worker's own writeHeartbeat already refuses to resurrect);
  //   2. the newest rename/pin (by renamedAt/pinnedAt) wins regardless of
  //      which writer's snapshot carries it.
  // The read happens immediately before the atomic rename, shrinking the
  // clobber window from "any caller's RMW span" to microseconds; rename/pin
  // additionally verify-and-retry on top of this.
  if (current) {
    const explicitHeartbeatStop =
      current.status === "lost" &&
      current.lostReason === "heartbeat-stale" &&
      requested.status === "stopped" &&
      current.stopRequestedAt &&
      requested.stopRequestedAt === current.stopRequestedAt;
    if (TERMINAL_STATUSES.has(current.status) && !explicitHeartbeatStop) {
      next = {
        ...next,
        status: current.status,
        endedAt: current.endedAt ?? next.endedAt ?? null,
        exitCode: current.exitCode ?? next.exitCode ?? null,
        ...(current.signal !== undefined ? { signal: current.signal } : {}),
        ...(current.error !== undefined ? { error: current.error } : {}),
        ...(current.lostReason !== undefined
          ? { lostReason: current.lostReason }
          : {}),
        ...(current.stoppedByUser !== undefined
          ? { stoppedByUser: current.stoppedByUser }
          : {}),
        // terminal sessions have no live phase or transport endpoint
        phase: null,
        transport: null,
      };
    }
    if (Number(current.renamedAt || 0) > Number(next.renamedAt || 0)) {
      next = { ...next, title: current.title, renamedAt: current.renamedAt };
    }
    if (Number(current.pinnedAt || 0) > Number(next.pinnedAt || 0)) {
      next = { ...next, pinned: current.pinned, pinnedAt: current.pinnedAt };
    }
    // A background worktree is immutable session identity, just like the
    // conversation id. Heartbeat/finalize/rename writers may race with a stale
    // snapshot, but no same-id transition is allowed to move the run back to
    // the main checkout or drop the cleanup metadata.
    if (current.worktreePath) {
      next = {
        ...next,
        cwd: current.worktreePath,
        repoRoot: current.repoRoot,
        worktreePath: current.worktreePath,
        baseSha: current.baseSha,
        branch: current.branch,
      };
    }
    // The launch profile is immutable same-id identity. A heartbeat/finalize
    // writer holding an older snapshot must never drop it and silently turn a
    // profile-aware record back into legacy minimal-resume semantics.
    if (current.launchProfile) {
      next = {
        ...next,
        launchProfile: current.launchProfile,
        configFingerprint: current.configFingerprint,
      };
    }
    // Core same-id identity is immutable even for non-worktree sessions.
    // Stale launcher/phase/finalize writers may update lifecycle fields, but
    // never retarget a conversation, cwd or log record.
    next = {
      ...next,
      ...(current.sessionId ? { sessionId: current.sessionId } : {}),
      ...(current.sessionBootstrapExpected !== undefined
        ? { sessionBootstrapExpected: current.sessionBootstrapExpected }
        : {}),
      ...(current.cwd ? { cwd: current.cwd } : {}),
      ...(current.startedAt !== undefined
        ? { startedAt: current.startedAt }
        : {}),
      ...(current.logFile ? { logFile: current.logFile } : {}),
    };
    // The launch generation is immutable same-id identity. It lets the real
    // worker replace a platform wrapper pid without allowing a stale/different
    // worker to claim this record.
    if (current.workerGeneration) {
      next = { ...next, workerGeneration: current.workerGeneration };
    }
    const claimedWorkerPid = Number(current.workerClaimedPid);
    if (
      current.workerClaimedPid != null &&
      Number.isInteger(claimedWorkerPid) &&
      claimedWorkerPid > 0
    ) {
      next = {
        ...next,
        workerClaimedPid: claimedWorkerPid,
        workerClaimedAt: current.workerClaimedAt,
      };
    }
    // A turn launch uses a durable prepare/resolve record. The prepare must
    // reach disk before native spawn so stop/remove can distinguish "no turn"
    // from "a child may exist but its pid commit failed". Only the owner that
    // knows the matching token/attempt may resolve it; stale snapshots cannot
    // drop an unresolved intent or resurrect an already-resolved one.
    const currentTurnAttempt = Math.max(
      0,
      Number.isInteger(Number(current.turnLaunchAttempt))
        ? Number(current.turnLaunchAttempt)
        : 0,
    );
    const requestedTurnAttempt = Number(next.turnLaunchAttempt);
    const currentTurnIntent = current.turnLaunchIntent;
    const requestedTurnIntent = next.turnLaunchIntent;
    const requestedTurnResolution = next.turnLaunchResolution;
    const resolvesCurrentTurnIntent =
      currentTurnIntent &&
      requestedTurnIntent === null &&
      requestedTurnResolution?.token === currentTurnIntent.token &&
      Number(requestedTurnResolution?.attempt) ===
        Number(currentTurnIntent.attempt) &&
      ["spawned", "not-spawned", "terminated"].includes(
        requestedTurnResolution?.outcome,
      );
    const currentTurnResolution = current.turnLaunchResolution;
    const advancesSpawnedTurnResolution =
      !currentTurnIntent &&
      currentTurnResolution?.outcome === "spawned" &&
      requestedTurnResolution?.outcome === "terminated" &&
      requestedTurnResolution.token === currentTurnResolution.token &&
      Number(requestedTurnResolution.attempt) ===
        Number(currentTurnResolution.attempt);
    const startsNewTurnIntent =
      !currentTurnIntent &&
      requestedTurnIntent &&
      Number.isInteger(Number(requestedTurnIntent.attempt)) &&
      Number(requestedTurnIntent.attempt) > currentTurnAttempt &&
      Number(requestedTurnAttempt) === Number(requestedTurnIntent.attempt);
    if (currentTurnIntent && !resolvesCurrentTurnIntent) {
      next = {
        ...next,
        turnLaunchAttempt: currentTurnAttempt,
        turnLaunchIntent: currentTurnIntent,
        ...(current.turnLaunchResolution !== undefined
          ? { turnLaunchResolution: current.turnLaunchResolution }
          : {}),
      };
    } else if (
      !currentTurnIntent &&
      !startsNewTurnIntent &&
      !advancesSpawnedTurnResolution
    ) {
      next = {
        ...next,
        turnLaunchAttempt: currentTurnAttempt,
        turnLaunchIntent: null,
        ...(current.turnLaunchResolution !== undefined
          ? { turnLaunchResolution: current.turnLaunchResolution }
          : {}),
      };
    } else if (advancesSpawnedTurnResolution) {
      next = {
        ...next,
        turnLaunchAttempt: currentTurnAttempt,
        turnLaunchIntent: null,
      };
    }
    const turnTerminationConfirmed =
      next.turnLaunchFinalizationUncertain === false &&
      next.turnLaunchTermination?.confirmed === true;
    const currentTurnTerminationConfirmed =
      current.turnLaunchFinalizationUncertain === false &&
      current.turnLaunchTermination?.confirmed === true;
    if (currentTurnTerminationConfirmed) {
      // Confirmation is absorbing for this terminal same-id run. A stopper or
      // heartbeat carrying an older snapshot must never restore uncertainty
      // after the owned process tree has been proven gone.
      next = {
        ...next,
        turnLaunchFinalizationUncertain: false,
        turnLaunchIntent: null,
        turnLaunchToken: null,
        turnLaunchError: null,
        turnLaunchTermination: current.turnLaunchTermination,
        ...(current.turnLaunchResolution !== undefined
          ? { turnLaunchResolution: current.turnLaunchResolution }
          : {}),
      };
    } else if (
      current.turnLaunchFinalizationUncertain === true &&
      !turnTerminationConfirmed
    ) {
      next = {
        ...next,
        agentPid: current.agentPid,
        agentStartedAt: current.agentStartedAt,
        turnLaunchFinalizationUncertain: true,
        turnLaunchError: current.turnLaunchError,
        ...(current.turnLaunchToken
          ? { turnLaunchToken: current.turnLaunchToken }
          : {}),
      };
    }
    if (current.stopRequestedAt) {
      next = {
        ...next,
        stopRequestedAt: current.stopRequestedAt,
        ...(current.stopRequestedBy !== undefined
          ? { stopRequestedBy: current.stopRequestedBy }
          : {}),
      };
      if (next.status === "completed" || next.status === "failed") {
        next = {
          ...next,
          status: "stopped",
          stoppedByUser: true,
          endedAt: next.endedAt || Date.now(),
          phase: null,
          transport: null,
        };
      }
    }
  }
  return next;
}

function persistBackgroundAgentState(target, next) {
  // Multiple async state writers can run in one process; a pid-only temporary
  // name lets them overwrite each other's staging file. A unique suffix keeps
  // each atomic replacement independent. Windows scanners/readers can also
  // hold the destination for a few milliseconds, so retry only that bounded
  // transient class rather than surfacing a spurious EPERM background failure.
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, target);
      break;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !new Set(["EPERM", "EACCES", "EBUSY"]).has(error?.code) ||
        attempt >= 5
      ) {
        rmSync(tmp, { force: true });
        throw error;
      }
      sleepSyncMs(5 * (attempt + 1));
    }
  }
  return next;
}

/**
 * Strict cross-process read/mutate/write transaction for one supervisor state.
 * Returning null from `updater` leaves the record untouched. Missing and
 * corrupt records fail closed unless an explicit creator opts into missing.
 */
export function mutateBackgroundAgentState(id, updater, options = {}) {
  const safe = safeId(id);
  const target = statePath(safe);
  return withFileLock(
    target,
    () => {
      const read = readBackgroundAgentStateResult(safe);
      if (read.error) throw read.error;
      if (read.missing && options.createIfMissing !== true) {
        return { applied: false, state: null, previous: null };
      }
      const requested = updater(read.state);
      if (!requested) {
        return { applied: false, state: read.state, previous: read.state };
      }
      const next = mergeBackgroundAgentState(read.state, {
        ...requested,
        id: safe,
      });
      persistBackgroundAgentState(target, next);
      return { applied: true, state: next, previous: read.state };
    },
    {
      failIfUnavailable: true,
      timeoutMs: options.timeoutMs ?? 5_000,
    },
  );
}

export function writeBackgroundAgentState(state, options = {}) {
  return mutateBackgroundAgentState(state.id, () => state, {
    createIfMissing: options.createIfMissing === true,
  }).state;
}

/**
 * Claim and deliver the durable notification for one pending human question.
 *
 * The delivery claim is persisted before any notifier runs. A thrown notifier
 * is therefore recorded as outcome_unknown and is never replayed implicitly;
 * an operator must use force after accepting the possible duplicate. Known
 * failures and an unconfigured notifier remain explicitly retryable.
 */
export async function deliverBackgroundNeedsInputNotification(
  id,
  options = {},
) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  let claim = null;
  const claimed = mutateBackgroundAgentState(id, (current) => {
    claim = claimNeedsInputNotification(current?.needsInputIncident, {
      retry: options.retry === true,
      force: options.force === true,
      now: now(),
    });
    if (!claim.applied) return null;
    return { ...current, needsInputIncident: claim.incident };
  });
  if (!claim?.applied) {
    return {
      applied: false,
      reason: claim?.reason || "incident_not_pending",
      incident: claimed.state?.needsInputIncident || null,
    };
  }

  const notify = options.notify || sendAgentNotification;
  let result = null;
  let deliveryError = null;
  try {
    result = await notify(buildNeedsInputNotification(claim.incident));
  } catch (error) {
    deliveryError = error;
  }

  let settlement = null;
  const settled = mutateBackgroundAgentState(id, (current) => {
    if (current?.needsInputIncident?.incidentId !== claim.incident.incidentId) {
      settlement = {
        applied: false,
        reason: "incident_changed",
        incident: current?.needsInputIncident || null,
      };
      return null;
    }
    settlement = settleNeedsInputNotification(current.needsInputIncident, {
      attempt: claim.attempt,
      result,
      error: deliveryError,
      now: now(),
    });
    if (!settlement.applied) return null;
    return { ...current, needsInputIncident: settlement.incident };
  });

  return {
    applied: true,
    attempt: claim.attempt,
    settlementApplied: settlement?.applied === true,
    reason: settlement?.reason || null,
    incident:
      settled.state?.needsInputIncident ||
      settlement?.incident ||
      claim.incident,
  };
}

/**
 * Atomically claim/refresh a worker heartbeat. The returned `applied` bit is
 * the only authority to start or continue a turn: a terminal, deleted,
 * corrupt, differently-generated or already-owned record is never revived.
 */
export function claimBackgroundAgentHeartbeat(id, heartbeat = {}) {
  const workerPid = Number(heartbeat.workerPid ?? heartbeat.pid);
  const workerGeneration = heartbeat.workerGeneration;
  if (!Number.isInteger(workerPid) || workerPid <= 0) {
    throw new Error(`Invalid background worker pid: ${heartbeat.workerPid}`);
  }
  return mutateBackgroundAgentState(id, (current) => {
    if (!current || current.status !== "running") return null;
    if (current.stopRequestedAt) return null;
    if (
      current.workerGeneration &&
      current.workerGeneration !== workerGeneration
    ) {
      return null;
    }
    const claimedWorkerPid = Number(current.workerClaimedPid);
    if (
      current.workerClaimedPid != null &&
      Number.isInteger(claimedWorkerPid) &&
      claimedWorkerPid > 0 &&
      claimedWorkerPid !== workerPid
    ) {
      return null;
    }
    const currentWorkerPid = Number(current.workerPid ?? current.pid);
    if (
      !current.workerGeneration &&
      Number.isInteger(currentWorkerPid) &&
      currentWorkerPid > 0 &&
      currentWorkerPid !== workerPid &&
      current.launchFinalizationUncertain !== true
    ) {
      return null;
    }
    return {
      ...current,
      ...heartbeat,
      id,
      pid: workerPid,
      workerPid,
      workerClaimedPid:
        current.workerClaimedPid != null &&
        Number.isInteger(claimedWorkerPid) &&
        claimedWorkerPid > 0
          ? claimedWorkerPid
          : workerPid,
      workerClaimedAt: current.workerClaimedAt || Date.now(),
      status: "running",
      heartbeatAt: heartbeat.heartbeatAt ?? Date.now(),
    };
  });
}

function deleteBackgroundAgentState(id, predicate = () => true) {
  const safe = safeId(id);
  const target = statePath(safe);
  return withFileLock(
    target,
    () => {
      const read = readBackgroundAgentStateResult(safe);
      if (read.error) throw read.error;
      if (!read.state) return null;
      if (!predicate(read.state)) {
        const error = new Error(
          `Background agent state changed before removal: ${safe}`,
        );
        error.code = "BACKGROUND_AGENT_REMOVE_CONFLICT";
        throw error;
      }
      rmSync(target, { force: true });
      return read.state;
    },
    { failIfUnavailable: true, timeoutMs: 5_000 },
  );
}

export function readBackgroundAgentState(id) {
  const result = readBackgroundAgentStateResult(safeId(id));
  return result.error ? null : result.state;
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    return false;
  }
}

/**
 * Is the live process at `pid` the SAME process the state file recorded at
 * `expectedStartedAtMs` — or a pid-reusing stranger? (Gap 1.)
 *
 * - dead pid → false (not the same process; it is no process at all)
 * - no anchor (legacy state without startedAt) → true (legacy semantics)
 * - probe failed → true (FAIL OPEN: never declare a live worker dead — and
 *   never kill — on the strength of a broken probe; callers fall back to the
 *   plain kill(pid,0) behavior this system always had)
 * - creation time > startedAt + tolerance → false (a reuser can only be
 *   born after the original died)
 */
export function isSameProcess(pid, expectedStartedAtMs, options = {}) {
  if (!isProcessAlive(pid)) return false;
  const expected = Number(expectedStartedAtMs);
  if (!Number.isFinite(expected) || expected <= 0) return true;
  const actual = processStartTimeMs(pid);
  if (actual === null) return true;
  const tolerance = Number.isFinite(Number(options.toleranceMs))
    ? Number(options.toleranceMs)
    : PID_IDENTITY_TOLERANCE_MS;
  return actual <= expected + tolerance;
}

/**
 * Destructive process identity is deliberately stricter than read-only
 * reconciliation. A signal is authorized only when the persisted positive
 * creation-time anchor can be compared with a successful, fresh OS probe and
 * both timestamps describe the same launch window. Missing evidence never
 * falls back to pid-only liveness.
 */
function inspectDestructiveProcessIdentity(
  pid,
  expectedStartedAtMs,
  options = {},
) {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 0) {
    return { status: "absent", pid: target };
  }
  // A corrupt record must never authorize the daemon-stop process to signal
  // itself. This guard covers every recorded role (including agentPid), not
  // only the primary worker pid checked by the public stop flow.
  if (target === process.pid) {
    return { status: "self", reason: "current-process", pid: target };
  }
  if (!isProcessAlive(target)) return { status: "dead", pid: target };
  const expected = Number(expectedStartedAtMs);
  if (!Number.isFinite(expected) || expected <= 0) {
    return {
      status: "unverifiable",
      reason: "started-at-missing",
      pid: target,
    };
  }
  const actual = processStartTimeMs(target, { fresh: true });
  if (actual === null) {
    return {
      status: "unverifiable",
      reason: "creation-time-probe-failed",
      pid: target,
      expectedStartedAt: expected,
    };
  }
  const tolerance = Number.isFinite(Number(options.toleranceMs))
    ? Number(options.toleranceMs)
    : PID_IDENTITY_TOLERANCE_MS;
  if (Math.abs(actual - expected) > tolerance) {
    return {
      status: "reused",
      pid: target,
      expectedStartedAt: expected,
      actualStartedAt: actual,
    };
  }
  return {
    status: "match",
    pid: target,
    expectedStartedAt: expected,
    actualStartedAt: actual,
  };
}

/**
 * Reap a lost worker's recorded agent child (Gap 2). The worker persists
 * `agentPid` + `agentStartedAt` per turn; when the WORKER dies (crash /
 * pid-reuse detection) nothing used to kill that grandchild — it kept
 * running unsupervised. Kill it, tree-wide, IF we can prove identity:
 *
 * - `agentStartedAt` anchor is REQUIRED — unlike the read-only liveness
 *   probe, this path kills, so a legacy state without the anchor fails
 *   CLOSED (no kill) rather than risking a pid-reused stranger;
 * - with the anchor present, the fresh creation-time probe must also succeed
 *   and match; missing or unverifiable identity evidence fails closed.
 *
 * @returns {boolean} true when a kill was actually issued
 */
export function reclaimOrphanAgentProcess(state) {
  const agentPid = Number(state?.agentPid);
  if (!Number.isInteger(agentPid) || agentPid <= 0) return false;
  if (agentPid === Number(state?.pid)) return false; // never the worker itself
  const anchor = Number(state?.agentStartedAt);
  if (!Number.isFinite(anchor) || anchor <= 0) return false; // fail closed
  if (inspectDestructiveProcessIdentity(agentPid, anchor).status !== "match") {
    return false;
  }
  return _deps.killProcessTree(agentPid, "SIGKILL") === true;
}

export function normalizeBackgroundAgentTitle(title) {
  const value = String(title || "").trim();
  if (!value) throw new Error("Background agent title cannot be empty");
  return value.slice(0, 160);
}

/**
 * The canonical unified lifecycle state (session-lifecycle.js) for a session —
 * folds the supervisor `status` + worker `phase` + `pendingApprovals` into one
 * of the 10 canonical states so every consumer (dashboard, `cc daemon list
 * --json`, an IDE bridge) reasons about a single vocabulary. Pure; call it at a
 * DISPLAY boundary only. It is deliberately NOT baked into
 * effectiveBackgroundAgentState because that function's output is spread back
 * into writeBackgroundAgentState by the rename/pin/stop read-modify-write
 * paths — a derived field there would leak into the on-disk schema.
 */
export function sessionLifecycleState(state) {
  return deriveSessionState(state);
}

/** A display copy of `state` with the derived `lifecycleState` attached. */
function withLifecycleState(state) {
  if (!state) return state;
  return { ...state, lifecycleState: deriveSessionState(state) };
}

function deriveEffectiveBackgroundAgentState(state, options = {}) {
  if (!state) return null;
  if (state.status !== "running") return state;
  const t = nowMs(options);
  const staleAfterMs = heartbeatStaleMs(options);
  const heartbeatAt = Number(state.heartbeatAt);
  const launchBootstrapPending =
    state.launchFinalizationUncertain === true &&
    Number.isFinite(heartbeatAt) &&
    t - heartbeatAt <= staleAfterMs;
  let next = state;
  if (Number.isFinite(heartbeatAt) && t - heartbeatAt > staleAfterMs) {
    next = {
      ...state,
      status: "lost",
      endedAt: state.endedAt || t,
      lostReason: "heartbeat-stale",
    };
  } else if (launchBootstrapPending) {
    // The initial state is intentionally visible before spawn. Until the
    // launcher or worker publishes a concrete pid, a concurrent list/view
    // must not convert that bounded bootstrap window into a terminal `lost`
    // record which the worker can no longer claim. The ordinary heartbeat
    // stale deadline still closes the window above.
  } else if (!isProcessAlive(state.pid)) {
    next = {
      ...state,
      status: "lost",
      endedAt: state.endedAt || t,
      lostReason: "process-exited",
    };
  } else if (!isSameProcess(state.pid, state.startedAt)) {
    // Gap 1: the pid is alive but belongs to a process created well after
    // this session started — the OS reused the worker's pid.
    next = {
      ...state,
      status: "lost",
      endedAt: state.endedAt || t,
      lostReason: "pid-reused",
    };
  }
  return next;
}

function backgroundInteractionFallback(state) {
  const pending = state?.pendingQuestion;
  if (!pending) return null;
  const requestId = pending?.requestId || pending?.intId;
  return {
    requestId: requestId || null,
    binding: pending?.binding,
    payload: {
      kind: "question",
      question: pending?.question || pending?.prompt || "",
      options: pending?.options || null,
      multiSelect: pending?.multiSelect === true,
      timeoutMs: pending?.timeoutMs,
    },
    createdAt: pending?.askedAt,
  };
}

function interactionRecoverySettledForState(state) {
  const recovery = state?.interactionRecovery;
  return Boolean(
    recovery &&
    ["clean", "rejected"].includes(recovery.status) &&
    Number(recovery.turn) === Number(state.turnCount || 0) &&
    String(recovery.workerGeneration || "") ===
      String(state.workerGeneration || ""),
  );
}

function persistTerminalInteractionRecovery(state, patch) {
  const expectedRecovery = state.interactionRecovery || null;
  const expectedPendingRequestId =
    state.pendingQuestion?.requestId || state.pendingQuestion?.intId || null;
  const mutation = mutateBackgroundAgentState(state.id, (current) => {
    if (
      !current ||
      current.status !== state.status ||
      current.lostReason !== state.lostReason ||
      current.endedAt !== state.endedAt ||
      current.workerGeneration !== state.workerGeneration ||
      current.turnCount !== state.turnCount ||
      current.agentPid !== state.agentPid ||
      current.agentStartedAt !== state.agentStartedAt ||
      (current.pendingQuestion?.requestId ||
        current.pendingQuestion?.intId ||
        null) !== expectedPendingRequestId ||
      (current.interactionRecovery?.status || null) !==
        (expectedRecovery?.status || null) ||
      (current.interactionRecovery?.turn ?? null) !==
        (expectedRecovery?.turn ?? null) ||
      (current.interactionRecovery?.workerGeneration || null) !==
        (expectedRecovery?.workerGeneration || null) ||
      (current.interactionRecovery?.recoveredAt ?? null) !==
        (expectedRecovery?.recoveredAt ?? null)
    ) {
      return null;
    }
    return { ...current, ...patch };
  });
  // Never report an uncommitted recovery patch after the CAS loses a race.
  // Callers (notably remove/worktree cleanup) must observe the fresh durable
  // state and retry, rather than acting on a fabricated terminal projection.
  return mutation.state || state;
}

function recoverTerminalBackgroundInteractions(
  state,
  options = {},
  {
    code = "INTERACTION_WORKER_LOST",
    message = "The background worker was lost before the interaction settled",
  } = {},
) {
  if (!state?.sessionId) return state;
  const t = nowMs(options);
  if (recordedBackgroundProcessesAlive(state)) {
    return persistTerminalInteractionRecovery(state, {
      interactionRecovery: {
        status: "failed",
        code: "INTERACTION_RECOVERY_CHILD_STILL_RUNNING",
        message:
          "The agent child is still alive; interaction recovery will retry after it exits",
        recoveredAt: t,
        turn: Number(state.turnCount || 0),
        workerGeneration: state.workerGeneration || null,
      },
    });
  }

  const fallbackRequest = backgroundInteractionFallback(state);
  try {
    const recovery = withSessionHostRecoveryLease(state.sessionId, () =>
      rejectPendingBackgroundInteractions(state.sessionId, state.id, {
        fallbackRequest,
        code,
        message,
      }),
    );
    return persistTerminalInteractionRecovery(state, {
      phase: null,
      pendingQuestion: null,
      interactionRecovery: {
        status: recovery.changed ? "rejected" : "clean",
        requestIds: recovery.rejected.map((record) => record.requestId),
        recoveredAt: t,
        turn: Number(state.turnCount || 0),
        workerGeneration: state.workerGeneration || null,
      },
    });
  } catch (error) {
    return persistTerminalInteractionRecovery(state, {
      interactionRecovery: {
        status: "failed",
        code: error?.code || "INTERACTION_RECOVERY_FAILED",
        message: error?.message || String(error),
        recoveredAt: t,
        turn: Number(state.turnCount || 0),
        workerGeneration: state.workerGeneration || null,
      },
    });
  }
}

export function effectiveBackgroundAgentState(state, options = {}) {
  if (!state) return null;
  if (state.status !== "running") {
    if (
      state.sessionId &&
      !interactionRecoverySettledForState(state) &&
      ["lost", "failed", "stopped", "completed"].includes(state.status)
    ) {
      return recoverTerminalBackgroundInteractions(state, options);
    }
    return state;
  }
  // OS identity probes can take seconds on Windows. Perform them outside the
  // state lock, then use the exact observed identity/heartbeat as a CAS fence
  // inside the short persistence transaction.
  const derived = deriveEffectiveBackgroundAgentState(state, options);
  if (options.persist === false || derived === state) return derived;

  const mutation = mutateBackgroundAgentState(state.id, (current) => {
    if (
      !current ||
      current.status !== "running" ||
      current.heartbeatAt !== state.heartbeatAt ||
      current.pid !== state.pid ||
      current.workerPid !== state.workerPid ||
      current.startedAt !== state.startedAt ||
      current.workerGeneration !== state.workerGeneration ||
      current.launchFinalizationUncertain !==
        state.launchFinalizationUncertain ||
      current.turnLaunchAttempt !== state.turnLaunchAttempt ||
      current.turnLaunchIntent?.token !== state.turnLaunchIntent?.token ||
      current.turnLaunchFinalizationUncertain !==
        state.turnLaunchFinalizationUncertain ||
      current.stopRequestedAt !== state.stopRequestedAt
    ) {
      return null;
    }
    return {
      ...current,
      status: derived.status,
      endedAt: derived.endedAt,
      lostReason: derived.lostReason,
    };
  });
  if (!mutation.applied) return mutation.state;

  const previous = mutation.previous;
  let next = mutation.state;
  // Gap 2: the worker is gone (dead pid or pid-reused stranger) — reap the
  // recorded agent grandchild so a crashed worker never leaves it running
  // unsupervised. A merely-stale heartbeat with a live, verified worker still
  // owns its child, so isSameProcess gates the reclaim.
  const workerGone = !isSameProcess(previous?.pid, previous?.startedAt);
  if (workerGone) {
    try {
      reclaimOrphanAgentProcess(previous);
    } catch {
      /* best-effort */
    }
  }
  if (previous?.sessionId)
    next = recoverTerminalBackgroundInteractions(next, options);
  return next;
}

export function listBackgroundAgents(options = {}) {
  return (
    readdirSync(backgroundAgentsDir())
      .filter((name) => name.endsWith(".json") && !name.includes(".job."))
      .map((name) => readBackgroundAgentState(name.slice(0, -5)))
      .filter(Boolean)
      .map((state) => effectiveBackgroundAgentState(state, options))
      .filter((state) => options.all || state.status === "running")
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      // Display-only enrichment: attach the canonical unified lifecycle state.
      // This is a list feed (never written back to disk), so the derived field
      // cannot leak into the on-disk schema the way it would in the mutate paths.
      .map(withLifecycleState)
  );
}

function sleepSyncMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* fallback busy-wait — only a few ms */
    }
  }
}

export function renameBackgroundAgent(id, title, options = {}) {
  const state = effectiveBackgroundAgentState(readBackgroundAgentState(id), {
    now: options.now,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });
  if (!state) throw new Error(`Background agent not found: ${id}`);
  const normalized = normalizeBackgroundAgentTitle(title);
  const renamedAt = typeof options.now === "number" ? options.now : Date.now();
  const mutation = mutateBackgroundAgentState(id, (current) =>
    current ? { ...current, title: normalized, renamedAt } : null,
  );
  if (!mutation.applied) throw new Error(`Background agent not found: ${id}`);
  return mutation.state;
}

/**
 * Remove a background agent's RECORD (state file + log) — `cc daemon rm`
 * (gap-analysis 2026-07-11 P0 "后台 Agent Supervisor" 补 rm 动词). Terminal
 * sessions (completed/failed/stopped/lost) remove directly; a still-running
 * one is refused unless `force`, which stops it first. The underlying JSONL
 * conversation session is NOT touched — that's `cc session delete`.
 */
export function removeBackgroundAgent(id, options = {}) {
  let state = readBackgroundAgentState(id);
  if (!state) throw new Error(`Background agent not found: ${id}`);
  const explicitlyStoppable =
    state.status === "running" ||
    (state.status === "lost" && state.lostReason === "heartbeat-stale");
  if (!explicitlyStoppable) {
    state = effectiveBackgroundAgentState(state, {
      now: options.now,
      heartbeatStaleMs: options.heartbeatStaleMs,
    });
  }
  if (explicitlyStoppable) {
    if (options.force !== true) {
      throw new Error(
        `${id} is still running — stop it first (cc daemon stop ${id}) or pass --force`,
      );
    }
    const stopped = stopBackgroundAgent(id);
    state = readBackgroundAgentState(id) || stopped;
    if (state.status === "running" || stopped.stopPending === true) {
      const error = new Error(
        `${id} cannot be removed until process termination and interaction recovery complete`,
      );
      error.code = "BACKGROUND_AGENT_REMOVE_RECOVERY_PENDING";
      throw error;
    }
  }
  if (state.sessionId && !interactionRecoverySettledForState(state)) {
    const error = new Error(
      `${id} cannot be removed while interaction recovery is incomplete`,
    );
    error.code = "BACKGROUND_AGENT_REMOVE_RECOVERY_PENDING";
    throw error;
  }
  const worktree = cleanupBackgroundAgentWorktree(state, {
    keepWorktree: options.keepWorktree === true,
  });
  const deleted = deleteBackgroundAgentState(
    id,
    (current) =>
      current.status !== "running" &&
      current.launchFinalizationUncertain !== true &&
      !current.turnLaunchIntent &&
      current.turnLaunchFinalizationUncertain !== true &&
      (!current.sessionId || interactionRecoverySettledForState(current)) &&
      activeWorktreeProcesses(current).length === 0,
  );
  if (!deleted) throw new Error(`Background agent not found: ${id}`);
  if (options.keepLog !== true) {
    rmSync(logPath(id), { force: true });
  }
  return {
    id,
    removed: true,
    status: state.status,
    ...(worktree ? { worktree } : {}),
  };
}

/**
 * Pin/unpin a session for the dashboard (`cc daemon view`) — pinned sessions
 * sort first inside their group. Same read-modify-write + verify-retry dance
 * as rename: the worker's periodic state merges can clobber a write that
 * lands inside its read→write window.
 */
export function setBackgroundAgentPinned(id, pinned, options = {}) {
  const state = effectiveBackgroundAgentState(readBackgroundAgentState(id), {
    now: options.now,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });
  if (!state) throw new Error(`Background agent not found: ${id}`);
  const value = pinned === true;
  const pinnedAt = typeof options.now === "number" ? options.now : Date.now();
  const mutation = mutateBackgroundAgentState(id, (current) =>
    current ? { ...current, pinned: value, pinnedAt } : null,
  );
  if (!mutation.applied) throw new Error(`Background agent not found: ${id}`);
  return mutation.state;
}

/**
 * Build the follow-up argv template for interactive attach turns: the launch
 * argv minus every token that carried the FIRST turn's prompt (positional
 * task words, `-p/--print` and its inline value). The worker appends
 * `["-p", "<follow-up text>"]` per turn, so all remaining flags (model,
 * permission-mode, session id, …) keep applying to later turns.
 *
 * @param {string[]} argv the background child argv (before any piped-prompt
 *        token is appended)
 * @param {object} [opts]
 * @param {string[]} [opts.positionalTokens] raw positional prompt tokens
 * @param {string|null} [opts.printValue] inline `-p <value>` text, when the
 *        prompt came from --print
 * @param {Array<object>} [opts.optionSpecs] captured Commander option grammar
 * @param {string[]} [opts.commandNames] command name and aliases
 */
export function insertArgumentsBeforeOptionTerminator(argv, additions) {
  const out = [...(argv || [])];
  const index = out.indexOf("--");
  out.splice(index === -1 ? out.length : index, 0, ...(additions || []));
  return out;
}

export function buildFollowUpArgv(argv, opts = {}) {
  if (Array.isArray(opts.optionSpecs) && opts.optionSpecs.length > 0) {
    return stripFirstTurnPromptArgv(argv, {
      optionSpecs: opts.optionSpecs,
      commandNames: opts.commandNames,
    });
  }
  // Compatibility fallback for stored/direct callers created before option
  // grammar was persisted by the agent command. New launches always supply
  // optionSpecs and therefore cannot confuse option values with operands.
  const positionalLeft = Array.isArray(opts.positionalTokens)
    ? [...opts.positionalTokens]
    : [];
  const printValue =
    typeof opts.printValue === "string" && opts.printValue.trim()
      ? opts.printValue
      : null;
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--print") {
      if (printValue !== null && argv[i + 1] === printValue) i++;
      continue;
    }
    // equals-form: --print=<value> carries the prompt in the same token
    if (
      printValue !== null &&
      arg.startsWith("--print=") &&
      arg.slice("--print=".length) === printValue
    ) {
      continue;
    }
    if (positionalLeft.length && arg === positionalLeft[0]) {
      positionalLeft.shift();
      continue;
    }
    out.push(arg);
  }
  return out;
}

function canonicalPath(value) {
  const absolute = resolve(String(value || ""));
  try {
    const real = realpathSync.native
      ? realpathSync.native(absolute)
      : realpathSync(absolute);
    return process.platform === "win32" ? real.toLowerCase() : real;
  } catch {
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  }
}

/**
 * Normalize and verify worktree metadata before it enters a background job.
 * The metadata is persisted as top-level state fields for compatibility with
 * status/IDE consumers: repoRoot/worktreePath/baseSha/branch.
 */
export function normalizeBackgroundWorktree(worktree, cwd) {
  if (!worktree) return null;
  const normalized = {
    repoRoot: resolve(String(worktree.repoRoot || "")),
    worktreePath: resolve(String(worktree.worktreePath || worktree.path || "")),
    baseSha: String(worktree.baseSha || ""),
    branch: String(worktree.branch || ""),
  };
  if (
    !normalized.repoRoot ||
    !normalized.worktreePath ||
    !normalized.baseSha ||
    !normalized.branch
  ) {
    throw new Error(
      "Cannot launch background agent: incomplete worktree metadata",
    );
  }
  if (canonicalPath(cwd) !== canonicalPath(normalized.worktreePath)) {
    throw new Error(
      "Cannot launch background agent: cwd does not match the persisted worktree path",
    );
  }
  const validation = validateAgentWorktree({
    ...normalized,
    path: normalized.worktreePath,
  });
  if (!validation.valid) {
    throw new Error(
      `Cannot launch background agent: worktree metadata is not usable (${validation.reason})`,
    );
  }
  return normalized;
}

/**
 * Persist only the bounded, secret-free governance envelope needed by IDE task
 * rows. The supervisor owns `owner`; callers cannot forge it. Prompt text,
 * argv, credentials and tool arguments are deliberately excluded.
 */
export function normalizeBackgroundGovernance(
  governance,
  { id, sessionId } = {},
) {
  const source = governance && typeof governance === "object" ? governance : {};
  const budget =
    source.resourceBudget && typeof source.resourceBudget === "object"
      ? source.resourceBudget
      : {};
  const positive = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const permissionMode = new Set([
    "manual",
    "auto",
    "dontAsk",
    "default",
    "plan",
    "acceptEdits",
    "bypassPermissions",
  ]).has(source.permissionMode)
    ? source.permissionMode
    : "default";
  return {
    version: 1,
    owner: `background:${String(id || "").slice(0, 160)}`,
    sessionId: sessionId ? String(sessionId).slice(0, 256) : null,
    permissionMode,
    resourceBudget: {
      maxTurns: positive(budget.maxTurns),
      maxCostUsd: positive(budget.maxCostUsd),
    },
  };
}

function persistedWorktree(state) {
  if (!state?.worktreePath) return null;
  return {
    repoRoot: state.repoRoot,
    worktreePath: state.worktreePath,
    baseSha: state.baseSha,
    branch: state.branch,
  };
}

/**
 * Continue a finished/crashed run as a NEW background agent on the same
 * conversation. Versioned records rebuild their secret-free launch profile;
 * legacy records retain the old minimal argv behavior. Callers must explicitly
 * opt in before an incompatible profile override can change the run envelope.
 */
function incompatibleLaunchProfileError(id, reasons) {
  const normalized = Array.isArray(reasons) ? reasons.filter(Boolean) : [];
  const error = new Error(
    `Background agent ${id} launch profile is incompatible: ${
      normalized.join(", ") || "unknown profile mismatch"
    }. Refusing to resume without an explicit compatibility override.`,
  );
  error.code = "BACKGROUND_LAUNCH_PROFILE_INCOMPATIBLE";
  error.reasons = normalized;
  return error;
}

export function resumeBackgroundAgent(id, prompt, options = {}) {
  const state = effectiveBackgroundAgentState(readBackgroundAgentState(id), {
    now: options.now,
    heartbeatStaleMs: options.heartbeatStaleMs,
  });
  if (!state) throw new Error(`Background agent not found: ${id}`);
  if (state.status === "running") {
    throw new Error(
      `Background agent ${id} is still running — use cc attach ${id} to send follow-up prompts instead`,
    );
  }
  if (!state.sessionId) {
    throw new Error(`Background agent ${id} has no session id to resume from`);
  }
  const text = String(prompt || "").trim();
  if (!text) throw new Error("resume requires a prompt");
  const worktree = persistedWorktree(state);
  if (
    worktree &&
    options.cwd &&
    canonicalPath(options.cwd) !== canonicalPath(worktree.worktreePath)
  ) {
    throw new Error(
      `Background agent ${id} is bound to worktree "${worktree.worktreePath}" and cannot resume in a different cwd`,
    );
  }
  let launchProfile = null;
  if (state.launchProfile) {
    let persisted;
    try {
      persisted = normalizeBackgroundLaunchProfile(state.launchProfile);
    } catch (error) {
      throw incompatibleLaunchProfileError(id, [
        `invalid-profile:${error.message}`,
      ]);
    }
    const actualFingerprint = fingerprintBackgroundLaunchProfile(persisted);
    const storedFingerprint =
      state.configFingerprint || state.launchProfileFingerprint || null;
    const explicitReplacement =
      options.launchProfileOverride &&
      options.allowIncompatibleProfile === true;
    if (storedFingerprint !== actualFingerprint && !explicitReplacement) {
      throw incompatibleLaunchProfileError(id, [
        storedFingerprint
          ? "profile-fingerprint-mismatch"
          : "profile-fingerprint-missing",
      ]);
    }

    if (options.launchProfileOverride) {
      let proposed;
      try {
        proposed = normalizeBackgroundLaunchProfile(
          options.launchProfileOverride,
        );
      } catch (error) {
        throw incompatibleLaunchProfileError(id, [
          `invalid-profile-override:${error.message}`,
        ]);
      }
      const compatibility = assessBackgroundLaunchProfileCompatibility(
        persisted,
        proposed,
      );
      if (
        !compatibility.compatible &&
        options.allowIncompatibleProfile !== true
      ) {
        throw incompatibleLaunchProfileError(id, compatibility.reasons);
      }
      launchProfile = proposed;
    } else {
      launchProfile = persisted;
    }

    const sourceCheck = verifyBackgroundLaunchProfileSources(launchProfile);
    if (!sourceCheck.valid && options.allowIncompatibleProfile !== true) {
      throw incompatibleLaunchProfileError(id, sourceCheck.issues);
    }
    if (!sourceCheck.valid) {
      launchProfile = refreshBackgroundLaunchProfileSources(launchProfile);
    }
    if (
      launchProfile.credentials.apiKey === "external" &&
      !options.apiKey &&
      !process.env.CC_API_KEY
    ) {
      throw incompatibleLaunchProfileError(id, [
        "external-api-key-unavailable",
      ]);
    }
  } else if (options.launchProfileOverride) {
    // Explicit profiles can migrate legacy records, which have no prior
    // launch envelope to compare against.
    launchProfile = normalizeBackgroundLaunchProfile(
      options.launchProfileOverride,
    );
  }

  const followUpArgv = launchProfile
    ? [
        ...buildArgvFromBackgroundLaunchProfile(launchProfile),
        "--session",
        state.sessionId,
      ]
    : ["agent", "--session", state.sessionId];
  const argv = insertArgumentsBeforeOptionTerminator(followUpArgv, [
    agentPrintArgument(text),
  ]);
  return launchBackgroundAgent({
    argv,
    // Worktree sessions fail closed: never fall back to process.cwd(), which
    // could silently resume a write task in the main checkout.
    cwd: worktree?.worktreePath || options.cwd || state.cwd || process.cwd(),
    sessionId: state.sessionId,
    title: options.title || state.title || text.slice(0, 100),
    cliEntry: options.cliEntry,
    followUpArgv,
    worktree,
    governance: launchProfile
      ? {
          permissionMode: launchProfile.permission.mode,
          resourceBudget: {
            maxTurns: launchProfile.budget.maxTurns,
            maxCostUsd: launchProfile.budget.maxCostUsd,
          },
        }
      : state.governance,
    launchProfile,
    apiKey: options.apiKey,
  });
}

/**
 * Fail fast on an unusable cwd. Without this, process launch surfaces a bad cwd as
 * an ASYNC 'error' event on the detached child — which nothing listened to
 * (uncaught exception with no context) — and the pre-written state/job files
 * stayed behind as a phantom "running" session. Deleted, file-replaced, and
 * unmounted paths all land here with one clear message.
 */
function assertUsableCwd(cwd) {
  let reason = null;
  if (!cwd) {
    reason = "no working directory given";
  } else if (!existsSync(cwd)) {
    reason = "directory does not exist (deleted or unmounted?)";
  } else {
    try {
      if (!statSync(cwd).isDirectory()) reason = "path is not a directory";
    } catch (err) {
      reason = `directory is not accessible (${err.code || err.message})`;
    }
  }
  if (reason) {
    throw new Error(
      `Cannot launch background agent: cwd "${cwd ?? ""}" — ${reason}`,
    );
  }
}

/**
 * A detached worker exists, so the caller must transfer/retain any worktree
 * even though launcher finalization failed. `instanceof` keeps this ownership
 * signal typed instead of trusting a forgeable string/code from user input.
 */
export class BackgroundWorkerStartedError extends Error {
  constructor(error, { id, workerPid } = {}) {
    super(
      `Background worker ${id || "unknown"} started, but launcher finalization failed: ${error?.message || String(error)}`,
      { cause: error },
    );
    this.name = "BackgroundWorkerStartedError";
    this.code = "ERR_BACKGROUND_WORKER_STARTED";
    this.backgroundAgentId = id || null;
    this.workerPid = Number.isInteger(Number(workerPid))
      ? Number(workerPid)
      : null;
  }
}

export function isBackgroundWorkerStartedError(error) {
  return error instanceof BackgroundWorkerStartedError;
}

async function settleUncertainBackgroundLaunch({
  id,
  jobFile,
  spawnedProcess,
  error,
}) {
  let termination;
  try {
    termination = await _deps.terminateOwnedProcessTree(spawnedProcess, {
      treeMode: process.platform === "win32" ? "windows-tree" : "posix-group",
    });
  } catch {
    return;
  }
  if (termination?.confirmed !== true) return;
  try {
    const workerPid = Number(spawnedProcess?.pid);
    const current = readBackgroundAgentState(id);
    if (!current || current.launchFinalizationUncertain !== true) return;
    if (
      Number.isInteger(workerPid) &&
      workerPid > 0 &&
      current.workerPid != null &&
      Number(current.workerPid) !== workerPid
    ) {
      return;
    }
    const terminal = current.status === "running" ? "failed" : current.status;
    writeBackgroundAgentState({
      ...current,
      status: terminal,
      endedAt: current.endedAt || Date.now(),
      exitCode: current.exitCode ?? 1,
      ...(current.status === "running"
        ? {
            error: `background launch failed after spawn: ${
              error?.message || "unknown post-spawn failure"
            }`,
          }
        : {}),
      phase: null,
      transport: null,
      launchFinalizationUncertain: false,
      launchTermination: {
        confirmed: true,
        treeMode: termination.treeMode || null,
        closed: termination.closed === true,
        treeTerminated: termination.treeTerminated === true,
        settledAt: Date.now(),
      },
    });
    // State is the durable cleanup authority; remove the one-shot job only
    // after the terminal/ownership evidence is safely persisted.
    rmSync(jobFile, { force: true });
  } catch {
    // Persistence failure must retain the original uncertainty fence and must
    // never become an unhandled rejection in the launching CLI process.
  }
}

export function launchBackgroundAgent({
  argv,
  cwd,
  sessionId,
  title,
  cliEntry,
  followUpArgv,
  worktree,
  governance,
  launchProfile,
  apiKey,
}) {
  assertBackgroundArgvDurable(argv);
  assertBackgroundArgvDurable(followUpArgv, "background follow-up");
  assertUsableCwd(cwd);
  const sessionPresence = _deps.getSessionPresence(sessionId);
  if (
    ![SESSION_PRESENCE.ABSENT, SESSION_PRESENCE.PRESENT].includes(
      sessionPresence,
    )
  ) {
    const error = new Error(
      `Background session ${sessionId} cannot launch from canonical presence ${sessionPresence}`,
    );
    error.code = "BACKGROUND_SESSION_BOOTSTRAP_EVIDENCE_INVALID";
    error.sessionId = sessionId;
    error.presence = sessionPresence;
    throw error;
  }
  const sessionBootstrapExpected = sessionPresence === SESSION_PRESENCE.ABSENT;
  const worktreeState = normalizeBackgroundWorktree(worktree, cwd);
  const id = createBackgroundAgentId();
  const governanceState = normalizeBackgroundGovernance(governance, {
    id,
    sessionId,
  });
  const initialSecrets = stripBackgroundLaunchSecrets(argv);
  const followUpSecrets = stripBackgroundLaunchSecrets(followUpArgv);
  const forwardedApiKey =
    apiKey || initialSecrets.apiKey || followUpSecrets.apiKey || null;
  const runtimeApiKey = forwardedApiKey || process.env.CC_API_KEY || null;
  let launchProfileState = launchProfile
    ? normalizeBackgroundLaunchProfile(launchProfile)
    : captureBackgroundLaunchProfile({
        argv,
        cwd,
        worktree: worktreeState,
        governance: governanceState,
      });
  if (runtimeApiKey && launchProfileState.credentials.apiKey !== "external") {
    launchProfileState = normalizeBackgroundLaunchProfile({
      ...launchProfileState,
      credentials: { apiKey: "external" },
      omitted: [...launchProfileState.omitted, "apiKey"],
    });
  }
  const configFingerprint =
    fingerprintBackgroundLaunchProfile(launchProfileState);
  const dir = backgroundAgentsDir();
  const workerGeneration = randomBytes(16).toString("hex");
  const jobFile = join(dir, `${id}.job.${process.pid}.json`);
  const worker = fileURLToPath(
    new URL("../workers/background-agent-worker.js", import.meta.url),
  );
  const job = {
    id,
    workerGeneration,
    argv: initialSecrets.argv,
    cwd,
    sessionId,
    sessionBootstrapExpected,
    title: title || "Background agent",
    cliEntry: cliEntry || process.argv[1],
    logFile: logPath(id),
    ...(worktreeState || {}),
    governance: governanceState,
    // Present = interactive attach can start follow-up turns; absent = the
    // transport rejects prompts (log-only session).
    ...(Array.isArray(followUpArgv)
      ? { followUpArgv: followUpSecrets.argv }
      : {}),
  };
  writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
  // Write the initial state BEFORE spawning so the worker's own merges (the
  // transport endpoint lands within its first ~100ms) can never be clobbered
  // by a late launcher write racing the worker.
  const state = {
    id,
    workerGeneration,
    sessionId,
    sessionBootstrapExpected,
    title: job.title,
    cwd,
    pid: null,
    workerPid: null,
    workerClaimedPid: null,
    workerClaimedAt: null,
    turnLaunchAttempt: 0,
    turnLaunchIntent: null,
    turnLaunchResolution: null,
    agentPid: null,
    agentStartedAt: null,
    status: "running",
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    endedAt: null,
    exitCode: null,
    logFile: job.logFile,
    ...(worktreeState || {}),
    governance: governanceState,
    launchProfile: launchProfileState,
    configFingerprint,
    // Cleared only after the launcher (or worker heartbeat) has published a
    // concrete worker identity. Cleanup treats true as an ownership fence.
    launchFinalizationUncertain: true,
  };
  try {
    writeBackgroundAgentState(state, { createIfMissing: true });
  } catch (error) {
    rmSync(jobFile, { force: true });
    rmSync(statePath(id), { force: true });
    throw error;
  }
  let child;
  let workerLogFd;
  let postSpawnError = null;
  try {
    // Preserve loader/bootstrap failures that happen before the worker can
    // open its own append handle. This also gives detached Windows targets
    // concrete inheritable stdout/stderr handles instead of relying on the
    // hosted process' possibly absent standard handles.
    workerLogFd = openSync(job.logFile, "a");
    child = _deps.spawn(process.execPath, [worker, jobFile], {
      cwd,
      detached: true,
      stdio: ["ignore", workerLogFd, workerLogFd],
      windowsHide: true,
      ...(forwardedApiKey
        ? { env: { ...process.env, CC_API_KEY: forwardedApiKey } }
        : {}),
      origin: "background-agent:worker",
      policy: "allow",
      scope: "background-agent",
      shell: false,
    });
  } catch (error) {
    if (error?.spawnedProcess) {
      // The broker can fail a post-spawn sandbox handshake only after native
      // spawn returned. It requests termination, but this synchronous caller
      // cannot prove the close fence has settled; retain state/job/worktree so
      // cleanup never races a process that may still hold cwd.
      const workerPid = Number(error.spawnedProcess.pid);
      try {
        const current = readBackgroundAgentState(id) || state;
        writeBackgroundAgentState({
          ...current,
          pid: Number.isInteger(workerPid) && workerPid > 0 ? workerPid : null,
          workerPid:
            Number.isInteger(workerPid) && workerPid > 0 ? workerPid : null,
          launchFinalizationUncertain: true,
        });
      } catch {
        // The initial state already carries the uncertainty fence. Failure to
        // add a pid must retain that fail-closed marker.
      }
      void settleUncertainBackgroundLaunch({
        id,
        jobFile,
        spawnedProcess: error.spawnedProcess,
        error,
      });
      throw new BackgroundWorkerStartedError(error, {
        id,
        workerPid,
      });
    }
    rmSync(jobFile, { force: true });
    rmSync(statePath(id), { force: true });
    throw error;
  } finally {
    if (Number.isInteger(workerLogFd)) {
      try {
        closeSync(workerLogFd);
      } catch (error) {
        // Once spawn returned a child, even fd-finalization errors are
        // post-transfer: the worker may already be using the worktree.
        if (child) postSpawnError = error;
      }
    }
  }
  let withPid = null;
  try {
    // Async spawn failures (EPERM, cwd raced away between the check and the
    // spawn, …) arrive as an 'error' event on the detached child. Reap them
    // into the state file instead of leaving a phantom "running" session and
    // an uncaught exception.
    if (typeof child.on === "function") {
      child.on("error", (error) => {
        try {
          rmSync(jobFile, { force: true });
          const current = readBackgroundAgentState(id);
          if (current && current.status === "running") {
            writeBackgroundAgentState({
              ...current,
              status: "failed",
              endedAt: Date.now(),
              lostReason: `spawn-error: ${error.code || error.message}`,
              interactionRecovery: current.sessionId
                ? {
                    status: "failed",
                    code: "INTERACTION_WORKER_SPAWN_ERROR",
                    message: error?.message || String(error),
                    recoveredAt: Date.now(),
                  }
                : current.interactionRecovery,
              launchFinalizationUncertain: false,
            });
          }
        } catch {
          /* best-effort */
        }
      });
      child.on("exit", (code, signal) => {
        try {
          rmSync(jobFile, { force: true });
          const current = readBackgroundAgentState(id);
          // A healthy worker persists completed/failed before exiting. If the
          // process (or its platform wrapper) exits while the state still says
          // running, bootstrap or finalization failed and the session must not
          // remain a phantom live task until heartbeat reconciliation.
          if (current && current.status === "running") {
            writeBackgroundAgentState({
              ...current,
              status: "failed",
              endedAt: Date.now(),
              exitCode: Number.isInteger(code) ? code : null,
              signal: signal || null,
              lostReason: `worker-exited-before-finalize: exit=${
                Number.isInteger(code) ? code : "null"
              } signal=${signal || "none"}`,
              interactionRecovery: current.sessionId
                ? {
                    status: "failed",
                    code: "INTERACTION_WORKER_EXITED_BEFORE_FINALIZE",
                    message:
                      "The background worker exited before interaction recovery completed",
                    recoveredAt: Date.now(),
                  }
                : current.interactionRecovery,
              launchFinalizationUncertain: false,
            });
          }
        } catch {
          /* best-effort */
        }
      });
    }
    // Read child.pid before entering the state transaction. A platform wrapper
    // (notably the Windows Job Object adapter) can return from spawn just as the
    // real worker claims the state record. Finalize the wrapper pid against the
    // freshest locked record so a launcher snapshot can never erase a turn the
    // worker already published (agentPid, pendingQuestion, recovery marker,
    // turnCount, ...).
    const spawnedWorkerPid = child.pid;
    const pidFinalization = mutateBackgroundAgentState(id, (current) => {
      if (
        !current ||
        (current.workerGeneration &&
          current.workerGeneration !== workerGeneration)
      ) {
        return null;
      }
      return {
        ...current,
        // Once the real worker has claimed the record its process.pid is the
        // authoritative identity; otherwise initialize both fields from the
        // platform child returned by spawn.
        pid: current.pid ?? spawnedWorkerPid,
        workerPid: current.workerPid ?? spawnedWorkerPid,
        launchFinalizationUncertain: false,
      };
    });
    if (!pidFinalization.applied || !pidFinalization.state) {
      throw new Error(
        `Background worker ${id} lost its launch-generation state before pid finalization`,
      );
    }
    withPid = pidFinalization.state;
    child.unref();
  } catch (error) {
    postSpawnError ||= error;
  }
  if (postSpawnError) {
    throw new BackgroundWorkerStartedError(postSpawnError, {
      id,
      workerPid: child?.pid,
    });
  }
  return withPid;
}

export function readBackgroundAgentLog(id, options = {}) {
  const file = logPath(id);
  if (!existsSync(file)) return "";
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const limit = Math.max(1, Number(options.lines) || 100);
  return lines.slice(-limit).join("\n");
}

function recordedBackgroundProcessIdentities(state) {
  const records = [
    { role: "agent", pid: state?.agentPid, startedAt: state?.agentStartedAt },
    { role: "worker", pid: state?.pid, startedAt: state?.startedAt },
    {
      role: "worker-wrapper",
      pid: state?.workerPid,
      startedAt: state?.startedAt,
    },
  ];
  const seen = new Set();
  return records.filter((record) => {
    const pid = Number(record.pid);
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) return false;
    seen.add(pid);
    record.pid = pid;
    return true;
  });
}

function inspectRecordedBackgroundProcesses(state) {
  return recordedBackgroundProcessIdentities(state).map((record) => ({
    ...record,
    identity: inspectDestructiveProcessIdentity(record.pid, record.startedAt),
  }));
}

function recordedBackgroundProcessesAlive(state) {
  return inspectRecordedBackgroundProcesses(state).some(({ identity }) =>
    ["match", "unverifiable", "self"].includes(identity.status),
  );
}

function signalBackgroundProcessTree(pid, signal = "SIGTERM") {
  const target = Number(pid);
  if (process.platform === "win32") {
    const killed = runSupervisorCommand(
      "taskkill",
      ["/PID", String(target), "/T", "/F"],
      { windowsHide: true, encoding: "utf8" },
      "background-agent:stop-tree",
    );
    if (killed.error || (killed.status !== 0 && isProcessAlive(target))) {
      throw new Error(
        killed.error?.message ||
          killed.stderr ||
          `taskkill exited ${killed.status}`,
      );
    }
    return;
  }
  try {
    _deps.kill(-target, signal);
  } catch {
    _deps.kill(target, signal);
  }
}

function persistStopPending(state, reason, details = {}) {
  const at = Date.now();
  const mutation = mutateBackgroundAgentState(state.id, (current) =>
    current
      ? {
          ...current,
          phase:
            reason === "identity-unverifiable"
              ? "stop_identity_unverifiable"
              : "stop_waiting_for_exit",
          stopPending: true,
          stopPendingReason: reason,
          ...(details.identity
            ? { processIdentityError: details.identity }
            : {}),
          ...(current.sessionId
            ? {
                interactionRecovery: {
                  status: "failed",
                  code:
                    reason === "identity-unverifiable"
                      ? "BACKGROUND_PROCESS_IDENTITY_UNVERIFIABLE"
                      : "INTERACTION_RECOVERY_CHILD_STILL_RUNNING",
                  message:
                    details.message ||
                    "Process termination is still pending; interaction recovery has not started",
                  recoveredAt: at,
                  turn: Number(current.turnCount || 0),
                  workerGeneration: current.workerGeneration || null,
                },
              }
            : {}),
        }
      : null,
  );
  return {
    ...(mutation.state || state),
    stopped: false,
    stopPending: true,
    stopPendingReason: reason,
  };
}

function waitForSignalledProcessesToExit(targets, deadlineMs = 2_000) {
  const deadline = Date.now() + deadlineMs;
  while (targets.some((target) => isProcessAlive(target.pid))) {
    if (Date.now() >= deadline) break;
    sleepSyncMs(10);
  }
  return targets.filter((target) => {
    if (!isProcessAlive(target.pid)) return false;
    const identity = inspectDestructiveProcessIdentity(
      target.pid,
      target.startedAt,
    );
    return ["match", "unverifiable", "self"].includes(identity.status);
  });
}

function recoverStoppedInteractions(state) {
  if (!state?.sessionId) return { state, recovery: null };
  const recovery = withSessionHostRecoveryLease(state.sessionId, () =>
    rejectPendingBackgroundInteractions(state.sessionId, state.id, {
      fallbackRequest: backgroundInteractionFallback(state),
      code: "INTERACTION_STOPPED",
      message:
        "The background agent was stopped before the interaction settled",
    }),
  );
  return {
    state,
    recovery: {
      status: recovery.changed ? "rejected" : "clean",
      requestIds: recovery.rejected.map((record) => record.requestId),
      recoveredAt: Date.now(),
      turn: Number(state.turnCount || 0),
      workerGeneration: state.workerGeneration || null,
    },
  };
}

export function stopBackgroundAgent(id) {
  // Explicit stop starts from the raw durable record. Read-only reconciliation
  // may already have classified a stale heartbeat as `lost`, but a verified
  // live worker still owns a process tree and must remain stoppable.
  let state = readBackgroundAgentState(id);
  if (!state) throw new Error(`Background agent not found: ${id}`);
  const staleHeartbeatOwner =
    state.status === "lost" && state.lostReason === "heartbeat-stale";
  if (state.status !== "running" && !staleHeartbeatOwner) {
    // Gap 2: stopping an already-lost session still reaps a leaked agent
    // child recorded before the worker died (identity-guarded inside).
    if (state.status === "lost") {
      try {
        reclaimOrphanAgentProcess(state);
      } catch {
        /* best-effort */
      }
      if (
        state.sessionId &&
        !["clean", "rejected"].includes(state.interactionRecovery?.status)
      ) {
        state = recoverTerminalBackgroundInteractions(state);
      }
    }
    return { ...state, stopped: false };
  }
  const stopRequestedAt = Date.now();
  const fence = mutateBackgroundAgentState(id, (current) => {
    if (
      !current ||
      (current.status !== "running" &&
        !(
          current.status === "lost" && current.lostReason === "heartbeat-stale"
        ))
    ) {
      return null;
    }
    return {
      ...current,
      stopRequestedAt: current.stopRequestedAt || stopRequestedAt,
      stopRequestedBy: "user",
      phase: "stopping",
      transport: null,
      stopPending: false,
      stopPendingReason: null,
    };
  });
  if (!fence.applied) {
    if (!fence.state) throw new Error(`Background agent not found: ${id}`);
    return { ...fence.state, stopped: false };
  }
  state = fence.state;
  if (state.launchFinalizationUncertain === true || state.turnLaunchIntent) {
    // The worker has durably announced that native spawn is prepared or that
    // post-spawn pid persistence is unresolved. Killing the worker from this
    // snapshot could strand its detached child before ownership is published.
    // The stop fence prevents any new spawn; the live owner must now resolve
    // no-spawn or terminate the exact owned tree and persist confirmation.
    return {
      ...state,
      stopped: false,
      stopPending: true,
      stopPendingReason: state.launchFinalizationUncertain
        ? "launch-finalization"
        : state.turnLaunchIntent
          ? "turn-launch-intent"
          : "turn-launch-finalization",
    };
  }
  // Self-pid guard: a worker record whose pid is the CURRENT process is
  // impossible in legitimate operation (the stopper is never the worker) —
  // it means a corrupt/hand-edited state file. Signalling it would SIGTERM /
  // taskkill-tree the very process (and shell tree) running `cc daemon stop`.
  // Treat as lost, kill nothing.
  if (Number(state.pid) === process.pid) {
    const lost = {
      ...state,
      status: "lost",
      endedAt: Date.now(),
      lostReason: "self-pid-corrupt-record",
    };
    let written = writeBackgroundAgentState(lost) || lost;
    if (written.sessionId) {
      written = recoverTerminalBackgroundInteractions(written);
    }
    return { ...written, stopped: false };
  }
  let postKill = state;
  let workerPidReused = false;
  const signalledPids = new Set();
  // A worker may publish a just-spawned child identity while the stop fence is
  // being observed. Re-read once after the first termination round so that a
  // newly durable, exact-owned agent tree is also terminated before recovery.
  for (let round = 0; round < 2; round++) {
    const inspected = inspectRecordedBackgroundProcesses(postKill);
    const unverifiable = inspected.filter(({ identity }) =>
      ["unverifiable", "self"].includes(identity.status),
    );
    if (unverifiable.length > 0) {
      return persistStopPending(postKill, "identity-unverifiable", {
        identity: unverifiable.map(({ role, pid, identity }) => ({
          role,
          pid,
          reason: identity.reason || identity.status,
        })),
        message:
          "Process identity could not be verified; no destructive signal was issued",
      });
    }
    const primaryWorker =
      inspected.find(({ role }) => role === "worker") ||
      inspected.find(({ role }) => role === "worker-wrapper");
    if (primaryWorker?.identity.status === "reused") workerPidReused = true;
    const targets = inspected.filter(
      ({ pid, identity }) =>
        identity.status === "match" && !signalledPids.has(pid),
    );
    if (targets.length === 0) break;
    try {
      // The child is detached into its own group and therefore gets its own
      // exact-identity signal before the worker tree is terminated.
      for (const target of targets) {
        signalBackgroundProcessTree(target.pid, "SIGTERM");
        signalledPids.add(target.pid);
      }
    } catch (error) {
      try {
        mutateBackgroundAgentState(id, (current) =>
          current
            ? {
                ...current,
                phase: "stop_failed",
                stopPending: true,
                stopPendingReason: "process-termination",
                stopError: error?.message || String(error),
              }
            : null,
        );
      } catch {
        /* the durable stopRequestedAt fence already blocks new turns */
      }
      throw new Error(
        `Failed to stop background agent ${id}: ${error.message}`,
      );
    }
    const stillAlive = waitForSignalledProcessesToExit(targets);
    postKill = readBackgroundAgentState(id) || postKill;
    if (stillAlive.length > 0) {
      return persistStopPending(postKill, "process-exit", {
        message:
          "Process termination is still pending; interaction recovery has not started",
      });
    }
    postKill = readBackgroundAgentState(id) || postKill;
  }

  if (recordedBackgroundProcessesAlive(postKill)) {
    return persistStopPending(postKill, "process-exit");
  }

  if (workerPidReused) {
    const lostMutation = mutateBackgroundAgentState(id, (current) =>
      current
        ? {
            ...current,
            status: "lost",
            endedAt: current.endedAt || Date.now(),
            lostReason: "pid-reused",
            phase: null,
            stopPending: false,
            stopPendingReason: null,
          }
        : null,
    );
    let lost = lostMutation.state || postKill;
    if (lost.sessionId) lost = recoverTerminalBackgroundInteractions(lost);
    return { ...lost, stopped: false };
  }

  let stopRecovery = null;
  try {
    stopRecovery = recoverStoppedInteractions(postKill).recovery;
  } catch (error) {
    const failed = mutateBackgroundAgentState(id, (current) =>
      current
        ? {
            ...current,
            phase: "stop_recovery_failed",
            interactionRecovery: {
              status: "failed",
              code: error?.code || "INTERACTION_RECOVERY_FAILED",
              message: error?.message || String(error),
              recoveredAt: Date.now(),
              turn: Number(current.turnCount || 0),
              workerGeneration: current.workerGeneration || null,
            },
            stopPending: true,
            stopPendingReason: "interaction-recovery",
          }
        : null,
    );
    return {
      ...(failed.state || postKill),
      stopped: false,
      stopPending: true,
      stopPendingReason: "interaction-recovery",
    };
  }

  // Build the terminal write from the freshest record under the lock. In
  // particular, never spread the pre-kill fence snapshot over a worker's
  // concurrently persisted process-tree termination confirmation.
  const terminal = mutateBackgroundAgentState(id, (current) =>
    current
      ? {
          ...current,
          status: "stopped",
          endedAt: current.endedAt || Date.now(),
          stoppedByUser: true,
          lostReason: null,
          phase: null,
          pendingQuestion: null,
          transport: null,
          stopError: null,
          stopPending: false,
          stopPendingReason: null,
          processIdentityError: null,
          ...(stopRecovery ? { interactionRecovery: stopRecovery } : {}),
        }
      : null,
  );
  const written = terminal.state || state;
  return { ...written, stopped: written.status === "stopped" };
}

function activeWorktreeProcesses(state) {
  const active = [];
  if (
    Number.isInteger(Number(state?.pid)) &&
    Number(state.pid) > 0 &&
    isSameProcess(state.pid, state.startedAt)
  ) {
    active.push("worker");
  }
  if (
    Number.isInteger(Number(state?.agentPid)) &&
    Number(state.agentPid) > 0 &&
    isSameProcess(state.agentPid, state.agentStartedAt)
  ) {
    active.push("agent");
  }
  return active;
}

/**
 * Explicit background-record cleanup owns the worktree teardown. Normal
 * completion, kill, lost-worker reconciliation, attach and resume all retain
 * it so a later resume continues in the exact same isolated checkout.
 */
export function cleanupBackgroundAgentWorktree(state, options = {}) {
  const worktree = persistedWorktree(state);
  if (!worktree) return null;
  if (options.keepWorktree === true) {
    return {
      removed: false,
      kept: true,
      reason: "kept by explicit request",
      path: worktree.worktreePath,
    };
  }

  const blockers = [];
  if (state?.launchFinalizationUncertain === true) {
    blockers.push("background launch finalization is uncertain");
  }
  if (state?.turnLaunchFinalizationUncertain === true) {
    blockers.push("background turn launch finalization is uncertain");
  }
  if (state?.turnLaunchIntent) {
    blockers.push("background turn launch intent is unresolved");
  }
  const active = activeWorktreeProcesses(state);
  if (active.length) blockers.push(`active ${active.join("+")} process`);
  if (Number(state?.pendingApprovals || 0) > 0) {
    blockers.push("pending approval");
  }
  if (state?.pendingQuestion) blockers.push("pending user input");
  if (
    Number(state?.uncertainSideEffects || 0) > 0 ||
    state?.phase === "uncertain_side_effect" ||
    state?.phase === "uncertain-side-effect"
  ) {
    blockers.push("unfinished or uncertain side effect");
  }
  if (blockers.length) {
    throw new Error(
      `Refusing to clean background worktree "${worktree.worktreePath}": ${blockers.join(", ")}`,
    );
  }

  if (!existsSync(worktree.worktreePath)) {
    return {
      removed: false,
      kept: false,
      reason: "worktree path already missing",
      path: worktree.worktreePath,
    };
  }

  const result = finishAgentWorktree({
    ...worktree,
    path: worktree.worktreePath,
  });
  if (!result.removed) {
    throw new Error(
      `Refusing to remove background agent record while its worktree is kept (${result.reason}). ` +
        "Resolve or preserve the work first, or pass --keep-worktree to remove only the record.",
    );
  }
  return { ...result, path: worktree.worktreePath };
}

export function openBackgroundLogFile(id) {
  const fd = openSync(logPath(id), "a", 0o600);
  return { fd, close: () => closeSync(fd) };
}

export function removeJobFile(file) {
  rmSync(file, { force: true });
}
