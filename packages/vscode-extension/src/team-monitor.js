/**
 * Read-only "cc team" monitor — parse the `cc team run --state <file>` JSON
 * snapshot and summarize it for an in-IDE view (Phase-4 Agent-Team parity;
 * the CLI runs the team, the IDE watches). The snapshot is written atomically
 * after every task settles, so re-reading it on change gives a live picture
 * of the task graph: who holds which lease, what's done, what's blocked.
 *
 * Pure logic (no `vscode`) → unit-testable; the webview glue + fs.watch live
 * in extension.js.
 *
 * State file shape (team.js persist(), version 2):
 *   { version, registry: { registry: {...}, tasks: { tasks: [task…] } },
 *     mailbox, budget, members }
 * where each task is { id, title, status, metadata: { key, dependsOn,
 * lease: { holder, expiresAt }, attempts } }.
 */

const TEAM_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "blocked",
];

/**
 * Parse a state-file snapshot (string or object) into a normalized, flat task
 * list plus budget/members. Tolerant: returns { ok:false, error } on garbage
 * or an unexpected shape so the caller can render a hint instead of throwing.
 */
function parseTeamState(input) {
  let snap = input;
  if (typeof input === "string") {
    try {
      snap = JSON.parse(input);
    } catch {
      return { ok: false, error: "not JSON — is this a cc team --state file?" };
    }
  }
  if (!snap || typeof snap !== "object") {
    return { ok: false, error: "empty or non-object state" };
  }
  const rawTasks = snap.registry?.tasks?.tasks;
  if (!Array.isArray(rawTasks)) {
    return {
      ok: false,
      error:
        "no task graph in this file — pass the path you gave `cc team run --state`.",
    };
  }
  const tasks = rawTasks.map((t) => {
    const md = (t && t.metadata) || {};
    const lease = md.lease || null;
    return {
      id: String(t?.id || ""),
      title: String(t?.title || t?.id || "(untitled)"),
      status: String(t?.status || "pending"),
      key: md.key != null ? String(md.key) : null,
      dependsOn: Array.isArray(md.dependsOn) ? md.dependsOn.map(String) : [],
      holder: lease && lease.holder ? String(lease.holder) : null,
      leaseExpiresAt:
        lease && Number.isFinite(Number(lease.expiresAt))
          ? Number(lease.expiresAt)
          : null,
      attempts: Number(md.attempts) || 0,
    };
  });
  return {
    ok: true,
    version: Number(snap.version) || 1,
    tasks,
    members: Array.isArray(snap.members) ? snap.members : [],
    budget: snap.budget && typeof snap.budget === "object" ? snap.budget : null,
  };
}

/**
 * Roll a parsed state up into counts + progress. `now` (default Date.now)
 * decides whether a lease is still live (a holder past its expiry crashed —
 * shown as stale, not active). Returns counts keyed by the status vocabulary
 * plus `active` (in_progress with a live lease), `stale` (held but expired),
 * `total`, and `donePct`.
 */
function summarizeTeam(state, { now = Date.now() } = {}) {
  const counts = Object.fromEntries(TEAM_STATUSES.map((s) => [s, 0]));
  let active = 0;
  let stale = 0;
  const tasks = (state && state.tasks) || [];
  for (const t of tasks) {
    if (t.status in counts) counts[t.status] += 1;
    if (t.status === "in_progress" && t.holder) {
      if (t.leaseExpiresAt != null && t.leaseExpiresAt <= now) stale += 1;
      else active += 1;
    }
  }
  const total = tasks.length;
  const donePct = total ? Math.round((counts.completed / total) * 100) : 0;
  return { counts, active, stale, total, donePct };
}

module.exports = { parseTeamState, summarizeTeam, TEAM_STATUSES };
