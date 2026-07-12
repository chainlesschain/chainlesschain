/**
 * Runtime Checkup evaluators for `cc doctor` (P2 "Doctor").
 *
 * `cc doctor` today checks install/config/service health. The gap upgrades it to
 * a RUNTIME checkup over live state: stale sessions/worktrees/agenda, orphaned
 * background processes, slow or circuit-broken hooks, dead plugins/LSP servers,
 * and verbose / code-derivable instruction files.
 *
 * This is the PURE evaluation core. The command layer collects a runtime
 * SNAPSHOT (from session store, worktree list, agenda store, process table,
 * hook/plugin stats) and a `now`, and this returns categorized findings. No I/O,
 * no clock, no process access here → deterministic + unit-testable.
 */

const DAY = 24 * 60 * 60 * 1000;

export const CHECKUP_SEVERITY = Object.freeze({
  info: 1,
  warn: 2,
  error: 3,
});

function sev(level) {
  return CHECKUP_SEVERITY[level] || CHECKUP_SEVERITY.info;
}

/** Default thresholds; every one is overridable per-call. */
export const DEFAULT_CHECKUP_THRESHOLDS = Object.freeze({
  staleSessionMs: 30 * DAY,
  staleWorktreeMs: 7 * DAY,
  agendaMissedGraceMs: 60 * 60 * 1000, // due but never fired for >1h → missed
  agendaFiredRetireMs: 30 * DAY, // long-fired entry left lying around
  slowHookMs: 5000,
  hookFailureThreshold: 3,
  instructionsMaxBytes: 12 * 1024,
  instructionsDerivableRatio: 0.6, // ≥60% derivable from code → prune candidate
});

function finding(id, category, level, message, remediation, extra = {}) {
  return {
    id,
    category,
    severity: level,
    severityRank: sev(level),
    message,
    remediation,
    ...extra,
  };
}

/** Sessions untouched past the stale threshold. */
export function checkStaleSessions(sessions = [], now, t) {
  const out = [];
  for (const s of sessions) {
    const last = Number(s?.lastActiveAt);
    if (!Number.isFinite(last)) continue;
    const age = now - last;
    if (age > t.staleSessionMs) {
      out.push(
        finding(
          "stale-session",
          "sessions",
          "warn",
          `Session ${s.id} idle ${Math.floor(age / DAY)}d`,
          "cc session prune",
          { ref: s.id, ageMs: age },
        ),
      );
    }
  }
  return out;
}

/** Worktrees that are merged, or simply old and untouched. */
export function checkStaleWorktrees(worktrees = [], now, t) {
  const out = [];
  for (const w of worktrees) {
    const created = Number(w?.createdAt);
    if (!Number.isFinite(created)) continue;
    const age = now - created;
    if (w?.merged) {
      out.push(
        finding(
          "merged-worktree",
          "worktrees",
          "warn",
          `Worktree ${w.path} is merged and can be removed`,
          "cc team worktree rm / git worktree remove",
          { ref: w.path, merged: true },
        ),
      );
    } else if (age > t.staleWorktreeMs) {
      out.push(
        finding(
          "stale-worktree",
          "worktrees",
          "info",
          `Worktree ${w.path} unused ${Math.floor(age / DAY)}d`,
          "review and remove if abandoned",
          { ref: w.path, ageMs: age },
        ),
      );
    }
  }
  return out;
}

/** Agenda entries that missed their fire window, or long-fired leftovers. */
export function checkAgenda(agenda = [], now, t) {
  const out = [];
  for (const a of agenda) {
    const dueAt = Number(a?.dueAt);
    const firedAt = Number(a?.firedAt);
    if (Number.isFinite(dueAt) && !Number.isFinite(firedAt)) {
      if (now - dueAt > t.agendaMissedGraceMs) {
        out.push(
          finding(
            "agenda-missed",
            "agenda",
            "error",
            `Agenda ${a.id} was due but never fired`,
            "cc agenda list / re-arm or remove",
            { ref: a.id, dueAt },
          ),
        );
      }
    } else if (
      Number.isFinite(firedAt) &&
      now - firedAt > t.agendaFiredRetireMs &&
      !a?.recurring
    ) {
      out.push(
        finding(
          "agenda-retire",
          "agenda",
          "info",
          `Agenda ${a.id} fired ${Math.floor((now - firedAt) / DAY)}d ago and can be retired`,
          "cc agenda prune",
          { ref: a.id, firedAt },
        ),
      );
    }
  }
  return out;
}

/**
 * Background processes whose recorded parent is gone (orphans), or that outlived
 * the session that spawned them.
 */
export function checkOrphanProcesses(processes = [], activeSessionIds = []) {
  const active = new Set(activeSessionIds.map(String));
  const out = [];
  for (const p of processes) {
    if (!p?.alive) continue;
    const parentDead = p.parentAlive === false;
    const sessionGone = p.sessionId != null && !active.has(String(p.sessionId));
    if (parentDead || sessionGone) {
      out.push(
        finding(
          "orphan-process",
          "processes",
          "error",
          `Background process pid=${p.pid}${p.kind ? ` (${p.kind})` : ""} orphaned`,
          "terminate stray process; check background-shell cleanup",
          { ref: p.pid, reason: parentDead ? "parent-dead" : "session-gone" },
        ),
      );
    }
  }
  return out;
}

/** Hooks that run slow or have tripped their circuit breaker. */
export function checkHooks(hooks = [], t) {
  const out = [];
  for (const h of hooks) {
    if (h?.circuitOpen) {
      out.push(
        finding(
          "hook-circuit-open",
          "hooks",
          "error",
          `Hook ${h.id} circuit is open after ${h.failures ?? "?"} failures`,
          "fix the hook or disable it in settings",
          { ref: h.id, failures: h.failures },
        ),
      );
      continue;
    }
    if (Number(h?.failures) >= t.hookFailureThreshold) {
      out.push(
        finding(
          "hook-failing",
          "hooks",
          "warn",
          `Hook ${h.id} failed ${h.failures} times`,
          "inspect hook logs",
          { ref: h.id, failures: h.failures },
        ),
      );
    }
    if (Number(h?.avgMs) > t.slowHookMs) {
      out.push(
        finding(
          "hook-slow",
          "hooks",
          "warn",
          `Hook ${h.id} averages ${Math.round(h.avgMs)}ms`,
          "make the hook async or faster",
          { ref: h.id, avgMs: h.avgMs },
        ),
      );
    }
  }
  return out;
}

/** Plugins / LSP servers reported unhealthy or dead. */
export function checkPluginsAndLsp(plugins = []) {
  const out = [];
  for (const p of plugins) {
    if (p?.healthy === false) {
      const isLsp = p.kind === "lsp" || p.lsp === true;
      out.push(
        finding(
          isLsp ? "lsp-dead" : "plugin-dead",
          isLsp ? "lsp" : "plugins",
          "warn",
          `${isLsp ? "LSP server" : "Plugin"} ${p.id} is unavailable`,
          isLsp ? "cc code-intel / restart server" : "cc plugin validate",
          { ref: p.id },
        ),
      );
    }
  }
  return out;
}

/** Instruction files (cc.md / AGENTS.md) that are oversized or code-derivable. */
export function checkInstructionFiles(files = [], t) {
  const out = [];
  for (const f of files) {
    const bytes = Number(f?.bytes);
    if (Number.isFinite(bytes) && bytes > t.instructionsMaxBytes) {
      out.push(
        finding(
          "instructions-verbose",
          "instructions",
          "info",
          `${f.path} is ${(bytes / 1024).toFixed(1)}KB — consider trimming`,
          "move detail into referenced docs",
          { ref: f.path, bytes },
        ),
      );
    }
    const ratio = Number(f?.derivableRatio);
    if (Number.isFinite(ratio) && ratio >= t.instructionsDerivableRatio) {
      out.push(
        finding(
          "instructions-derivable",
          "instructions",
          "info",
          `${f.path} is ~${Math.round(ratio * 100)}% derivable from code`,
          "delete code-derivable prose; keep only non-obvious guidance",
          { ref: f.path, derivableRatio: ratio },
        ),
      );
    }
  }
  return out;
}

/**
 * Run every checkup against a runtime snapshot. Returns findings sorted most
 * severe first, plus a rollup. Any missing snapshot section is simply skipped —
 * partial snapshots produce partial (never crashing) results.
 *
 * @param {object} snapshot { sessions, worktrees, agenda, processes,
 *   activeSessionIds, hooks, plugins, instructionFiles, now }
 * @param {object} [opts] { thresholds }
 */
export function runRuntimeCheckup(snapshot = {}, { thresholds = {} } = {}) {
  const t = { ...DEFAULT_CHECKUP_THRESHOLDS, ...thresholds };
  const now = Number.isFinite(Number(snapshot.now))
    ? Number(snapshot.now)
    : null;
  const findings = [];
  if (now != null) {
    findings.push(...checkStaleSessions(snapshot.sessions, now, t));
    findings.push(...checkStaleWorktrees(snapshot.worktrees, now, t));
    findings.push(...checkAgenda(snapshot.agenda, now, t));
  }
  findings.push(
    ...checkOrphanProcesses(snapshot.processes, snapshot.activeSessionIds),
  );
  findings.push(...checkHooks(snapshot.hooks, t));
  findings.push(...checkPluginsAndLsp(snapshot.plugins));
  findings.push(...checkInstructionFiles(snapshot.instructionFiles, t));

  findings.sort(
    (a, b) =>
      b.severityRank - a.severityRank ||
      String(a.category).localeCompare(String(b.category)),
  );

  const byCategory = {};
  const bySeverity = { error: 0, warn: 0, info: 0 };
  for (const f of findings) {
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }
  return {
    findings,
    summary: { total: findings.length, byCategory, bySeverity },
    ok: bySeverity.error === 0,
  };
}
