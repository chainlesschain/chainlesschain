/**
 * Background-agents panel core — list the `cc agent --bg` supervisor sessions
 * straight from the state directory (`~/.chainlesschain/background-agents/`),
 * apply the same stale-heartbeat / dead-pid display correction the CLI's
 * `cc daemon status` performs (display-only: nothing is persisted from the
 * IDE), summarize, and tail logs. Session mutations (stop / rename / resume)
 * go through the CLI's `--json` commands; interactive attach goes through the
 * vendored agent-sdk pipe client — neither lives here.
 *
 * Pure Node (no `vscode`) → unit-testable; the webview glue lives in
 * ui/background-agents-view.js.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { isBlockingPhase } = require("./phase-attention");

const HEARTBEAT_STALE_MS = 120000;

// Pid identity (Gap 1: OS pid reuse — mirrors the CLI supervisor). A pid
// alone does not identify a process: after the worker dies the OS can hand
// the same pid to an unrelated process, so kill(pid, 0) alone would show a
// long-dead session as "running". Reuse is one-sided — a process that took
// over the pid can only have been created AFTER startedAt — so compare the
// pid's real creation time against the state file's startedAt.
const PID_IDENTITY_TOLERANCE_MS = 60000;
// The probe behind this cache is a SYNCHRONOUS wmic/powershell spawn
// (100-500ms on Windows) that blocks the extension host, and the Background
// Agents view polls the list every 3s — so the TTL directly sets how often
// the host stalls per running session. A process's creation time never
// changes while it lives; the only staleness risk is pid reuse (needs the
// worker to die first), which the display tolerates for one TTL window.
const START_TIME_CACHE_TTL_MS = 60000;
const LOG_TRUNCATION_NOTICE =
  "--- log truncated/rotated, resuming from tail ---";
const TRUNCATION_RESUME_TAIL_BYTES = 4096;

const startTimeCache = new Map();

function backgroundAgentsDir() {
  return path.join(os.homedir(), ".chainlesschain", "background-agents");
}

function isProcessAlive(pid, deps = {}) {
  const kill = deps.kill || process.kill.bind(process);
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** CIM_DATETIME (`20260711120000.500000+480`) → epoch ms, null when unparseable. */
function parseCimDateToMs(raw) {
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
 * One synchronous probe for a process's creation time (epoch ms); null when
 * it cannot be determined — callers FAIL OPEN to the plain kill(pid,0)
 * answer (this module is display-only, it never kills anything).
 */
function readProcessStartTimeMs(pid) {
  const target = Number(pid);
  if (!Number.isInteger(target) || target <= 0) return null;
  if (process.platform === "win32") {
    try {
      const r = spawnSync(
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
      );
      if (!r.error && r.status === 0) {
        const m = /CreationDate=([^\r\n]+)/.exec(r.stdout || "");
        const ms = m ? parseCimDateToMs(m[1]) : null;
        if (ms !== null) return ms;
      }
    } catch (_err) {
      /* fall through to PowerShell */
    }
    try {
      const script =
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${target}' -ErrorAction SilentlyContinue; ` +
        "if ($p -and $p.CreationDate) { [DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds() }";
      const r = spawnSync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, encoding: "utf8", timeout: 10000 },
      );
      if (!r.error && r.status === 0) {
        const n = Number(String(r.stdout || "").trim());
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch (_err) {
      /* fail open below */
    }
    return null;
  }
  try {
    const r = spawnSync("ps", ["-o", "lstart=", "-p", String(target)], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (!r.error && r.status === 0) {
      const t = Date.parse(String(r.stdout || "").trim());
      if (Number.isFinite(t) && t > 0) return t;
    }
  } catch (_err) {
    /* fail open below */
  }
  return null;
}

/** Cached probe (default impl only — an injected deps probe runs uncached). */
function processStartTimeMs(pid, deps = {}) {
  if (typeof deps.readProcessStartTimeMs === "function") {
    const raw = deps.readProcessStartTimeMs(Number(pid));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const key = Number(pid);
  const at = Date.now();
  const hit = startTimeCache.get(key);
  if (hit && at - hit.at < START_TIME_CACHE_TTL_MS) return hit.value;
  const value = readProcessStartTimeMs(key);
  startTimeCache.set(key, { at, value });
  return value;
}

/**
 * Same-process check for a recorded pid. Fail-open rules match the CLI
 * supervisor: dead pid → false; no startedAt anchor → true (legacy states);
 * probe failure → true (never flip a live session to lost on a broken
 * probe); creation later than startedAt + tolerance → false (pid reused).
 */
function isSameProcess(pid, expectedStartedAtMs, deps = {}) {
  if (!isProcessAlive(pid, deps)) return false;
  const expected = Number(expectedStartedAtMs);
  if (!Number.isFinite(expected) || expected <= 0) return true;
  const actual = processStartTimeMs(pid, deps);
  if (actual === null) return true;
  return actual <= expected + PID_IDENTITY_TOLERANCE_MS;
}

/**
 * Display-only status correction, mirroring the CLI supervisor's
 * effectiveBackgroundAgentState: a "running" session whose heartbeat went
 * stale or whose worker pid is gone is SHOWN as lost — but the IDE never
 * writes the correction back (that's the CLI's job on its next touch).
 */
function effectiveStatus(state, { now = Date.now(), deps } = {}) {
  if (!state || state.status !== "running") {
    return {
      status: state?.status || "?",
      lostReason: state?.lostReason || null,
    };
  }
  if (
    Number.isFinite(Number(state.heartbeatAt)) &&
    now - Number(state.heartbeatAt) > HEARTBEAT_STALE_MS
  ) {
    return { status: "lost", lostReason: "heartbeat-stale" };
  }
  if (!isProcessAlive(state.pid, deps)) {
    return { status: "lost", lostReason: "process-exited" };
  }
  if (!isSameProcess(state.pid, state.startedAt, deps)) {
    // Gap 1: alive pid, but created well after this session started — the
    // OS reused the worker's pid for an unrelated process.
    return { status: "lost", lostReason: "pid-reused" };
  }
  return { status: "running", lostReason: null };
}

/**
 * List sessions from the state dir, newest first. Tolerant: unreadable or
 * malformed state files are skipped; a missing dir yields [].
 *
 * @returns {Array<{id,status,lostReason,phase,turnCount,title,cwd,sessionId,
 *   startedAt,endedAt,heartbeatAt,exitCode,logFile,interactive}>}
 */
function listBackgroundSessions({
  dir = backgroundAgentsDir(),
  now = Date.now(),
  deps,
} = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const sessions = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes(".job.")) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (!state || typeof state.id !== "string") continue;
    const eff = effectiveStatus(state, { now, deps });
    const pendingApprovals = Number.isFinite(Number(state.pendingApprovals))
      ? Number(state.pendingApprovals)
      : 0;
    const pendingQuestion =
      state.pendingQuestion && typeof state.pendingQuestion === "object"
        ? {
            question:
              typeof state.pendingQuestion.question === "string"
                ? state.pendingQuestion.question
                : "",
            options: Array.isArray(state.pendingQuestion.options)
              ? state.pendingQuestion.options.filter(
                  (o) => typeof o === "string",
                )
              : [],
          }
        : null;
    sessions.push({
      id: state.id,
      status: eff.status,
      lostReason: eff.lostReason,
      phase: state.phase || null,
      pendingApprovals,
      // Blocked-on-human, computed once so every consumer (summary, sort,
      // badges, resume gating) classifies identically — no re-derived copies.
      attention:
        eff.status === "running" &&
        needsAttention(state.phase, pendingApprovals),
      pendingQuestion,
      uncertainSideEffects: Number.isFinite(Number(state.uncertainSideEffects))
        ? Number(state.uncertainSideEffects)
        : 0,
      turnCount: Number.isFinite(Number(state.turnCount))
        ? Number(state.turnCount)
        : null,
      title: typeof state.title === "string" ? state.title : "",
      cwd: state.cwd || "",
      sessionId: state.sessionId || null,
      startedAt: Number(state.startedAt) || null,
      endedAt: Number(state.endedAt) || null,
      heartbeatAt: Number(state.heartbeatAt) || null,
      exitCode: Number.isFinite(Number(state.exitCode))
        ? Number(state.exitCode)
        : null,
      logFile: state.logFile || path.join(dir, `${state.id}.log`),
      interactive: eff.status === "running" && Boolean(state.transport?.pipe),
    });
  }
  sessions.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return sessions;
}

/**
 * A session that is blocked on the human: the supervisor's phase reporter
 * writes `phase:"waiting_permission"` + `pendingApprovals` when the worker
 * parks on an approval, `needs_input` for a question block, and
 * `uncertain_side_effect` when a resumed turn must confirm irreversible ops.
 * Without this the session reads as "running fine" while it silently waits.
 * Delegates to the shared predicate so every surface classifies alike.
 */
function needsAttention(phase, pendingApprovals) {
  return isBlockingPhase(phase, pendingApprovals);
}

/** Status counts + running/interactive totals for the summary cards. */
function summarizeSessions(sessions) {
  const counts = {};
  let interactive = 0;
  let waiting = 0;
  for (const s of sessions || []) {
    counts[s.status] = (counts[s.status] || 0) + 1;
    if (s.interactive) interactive++;
    if (s.status === "running" && needsAttention(s.phase, s.pendingApprovals))
      waiting++;
  }
  return {
    total: (sessions || []).length,
    running: counts.running || 0,
    interactive,
    waiting,
    counts,
  };
}

/** Compact elapsed string ("42s" / "3m 12s" / "1h 4m"). */
function formatElapsed(session, now = Date.now()) {
  const end =
    Number.isFinite(Number(session?.endedAt)) && session.endedAt !== null
      ? Number(session.endedAt)
      : now;
  const start =
    Number.isFinite(Number(session?.startedAt)) && session.startedAt !== null
      ? Number(session.startedAt)
      : end;
  const ms = Math.max(0, end - start);
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Last N lines of a session log ("" when unreadable/missing). */
function tailLog(logFile, lines = 120) {
  let text;
  try {
    text = fs.readFileSync(logFile, "utf8");
  } catch {
    return "";
  }
  const parts = text.split(/\r?\n/);
  const limit = Math.max(1, Number(lines) || 120);
  return parts.slice(-limit).join("\n");
}

/**
 * Read the log delta past `offset` (byte-oriented on the decoded string —
 * consistent as long as the same reader polls). Truncation/rotation (Gap 3):
 * instead of restarting from 0 — which replayed the ENTIRE new file into the
 * webview — emit an explicit marker and resume from the current tail.
 */
function readLogDelta(logFile, offset = 0) {
  let text;
  try {
    text = fs.readFileSync(logFile, "utf8");
  } catch {
    return { chunk: "", offset };
  }
  const from = offset;
  if (from > text.length) {
    const start = Math.max(0, text.length - TRUNCATION_RESUME_TAIL_BYTES);
    return {
      chunk: `\n${LOG_TRUNCATION_NOTICE}\n${text.slice(start)}`,
      offset: text.length,
      truncated: true,
    };
  }
  return { chunk: text.slice(from), offset: text.length };
}

module.exports = {
  HEARTBEAT_STALE_MS,
  LOG_TRUNCATION_NOTICE,
  PID_IDENTITY_TOLERANCE_MS,
  backgroundAgentsDir,
  effectiveStatus,
  isSameProcess,
  listBackgroundSessions,
  needsAttention,
  summarizeSessions,
  formatElapsed,
  tailLog,
  readLogDelta,
};
