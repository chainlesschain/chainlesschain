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

const HEARTBEAT_STALE_MS = 120000;

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
    sessions.push({
      id: state.id,
      status: eff.status,
      lostReason: eff.lostReason,
      phase: state.phase || null,
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

/** Status counts + running/interactive totals for the summary cards. */
function summarizeSessions(sessions) {
  const counts = {};
  let interactive = 0;
  for (const s of sessions || []) {
    counts[s.status] = (counts[s.status] || 0) + 1;
    if (s.interactive) interactive++;
  }
  return {
    total: (sessions || []).length,
    running: counts.running || 0,
    interactive,
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
 * consistent as long as the same reader polls). Handles truncation/rotation
 * by restarting from 0.
 */
function readLogDelta(logFile, offset = 0) {
  let text;
  try {
    text = fs.readFileSync(logFile, "utf8");
  } catch {
    return { chunk: "", offset };
  }
  let from = offset;
  if (from > text.length) from = 0;
  return { chunk: text.slice(from), offset: text.length };
}

module.exports = {
  HEARTBEAT_STALE_MS,
  backgroundAgentsDir,
  effectiveStatus,
  listBackgroundSessions,
  summarizeSessions,
  formatElapsed,
  tailLog,
  readLogDelta,
};
