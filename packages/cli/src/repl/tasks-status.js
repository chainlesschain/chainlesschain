/**
 * Pure renderer for the `/tasks` REPL command — a user-facing view of the
 * agent's background shell tasks (the ones it starts with
 * run_shell { run_in_background: true }). The data comes from agent-core's
 * listBackgroundShellTasks(); this module only formats it, so it stays
 * deterministic and unit-testable (inject `now` for stable elapsed time).
 *
 * Background shells are otherwise only visible to the agent (via its
 * check_shell tool) — this surfaces them to the human, the way Claude Code's
 * background-tasks view does. Sub-agents live under a separate registry and
 * are shown by `/sub-agents`.
 */

/** Coerce an ISO-string or epoch-ms timestamp to epoch ms, or null. */
function toMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Human-friendly elapsed duration. */
function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

/** A short status badge for one task. */
export function taskStatusLabel(t) {
  switch (t?.status) {
    case "running":
      return "● running";
    case "exited":
      return `✓ exited${t.exitCode != null ? ` (${t.exitCode})` : ""}`;
    case "failed":
      return `✗ failed${t.exitCode != null ? ` (${t.exitCode})` : ""}`;
    case "error":
      return "✗ error";
    default:
      return t?.status || "?";
  }
}

/**
 * Render the background-shell task list as a plain-text block.
 * @param {Array} tasks  from listBackgroundShellTasks()
 * @param {object} opts  { now?: epoch-ms } — defaults to Date.now()
 */
export function formatBackgroundTasks(tasks, { now = Date.now() } = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0) {
    return (
      "No background shell tasks.\n" +
      "  (The agent starts these with run_shell run_in_background:true; " +
      "sub-agents are under /sub-agents.)"
    );
  }
  const running = list.filter((t) => t?.status === "running").length;
  const lines = [
    `Background shell tasks (${list.length}, ${running} running):`,
  ];
  for (const t of list) {
    const started = toMs(t.startedAt);
    const ended = toMs(t.endedAt);
    const elapsed =
      started != null ? fmtElapsed((ended ?? now) - started) : "?";
    const cmd = String(t.command || "")
      .replace(/\s+/g, " ")
      .trim();
    const cmdShort = cmd.length > 70 ? cmd.slice(0, 70) + "…" : cmd;
    lines.push(`  ${taskStatusLabel(t)}  ${t.id}  ${elapsed}  ${cmdShort}`);
  }
  lines.push("Manage: /tasks kill <id> · /tasks kill-all");
  return lines.join("\n");
}
