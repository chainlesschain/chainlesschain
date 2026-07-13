/**
 * `cc agenda` — consumer for the agent-scheduled Monitor / Cron / Wakeup
 * entries (gap-analysis 第四阶段 #3). The `schedule` agent tool PERSISTS
 * intent; this command is what actually FIRES it — run it periodically
 * (`cc loop --every 1m -- cc agenda run`, a system cron, or by hand):
 *
 *   cc agenda list [--json]           show all scheduled entries
 *   cc agenda run [--json] [--dry-run]  fire everything due right now
 *   cc agenda cancel <id>             remove one entry
 *   cc agenda prune [--older-than N]  drop finished entries
 *
 * `run` for each due entry:
 *   - wakeup  → spawn `cc agent -p <prompt>`, mark fired
 *   - cron    → spawn `cc agent -p <prompt>`, advance to next fire time
 *   - monitor → check its source (a shell <command>'s output, a <watchFile>'s
 *               content / appearance / modification, or a <watchUrl>'s response
 *               body / 2xx); if it matches stop_when, send the notification and
 *               stop; else re-arm for the next interval
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { AgentScheduleStore } from "../lib/agent-schedule-store.js";
import { sendAgentNotification } from "../lib/agent-notify.js";
import { nextWakeupAt, partitionSchedule } from "../lib/schedule-planner.js";

const BIN_PATH = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);

export function registerAgendaCommand(program) {
  const cmd = program
    .command("agenda")
    .description(
      "Fire agent-scheduled wakeups / crons / monitors (persisted by the `schedule` tool)",
    );

  cmd
    .command("list", { isDefault: true })
    .description("List all scheduled entries")
    .option("--kind <kind>", "Filter by kind (wakeup|cron|monitor)")
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runAgendaList(options);
    });

  cmd
    .command("run")
    .description("Fire every entry that is due now")
    .option("--dry-run", "Show what would fire without running anything")
    .option("--json", "Machine-readable JSON output")
    .action(async (options) => {
      process.exitCode = await runAgendaRun(options);
    });

  cmd
    .command("cancel <id>")
    .description("Remove a scheduled entry by id")
    .option("--json", "Machine-readable JSON output")
    .action((id, options) => {
      process.exitCode = runAgendaCancel(id, options);
    });

  cmd
    .command("prune")
    .description(
      "Remove finished entries (fired / matched / exhausted / expired)",
    )
    .option(
      "--older-than <seconds>",
      "Only prune entries that finished more than N seconds ago",
    )
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runAgendaPrune(options);
    });
}

export function runAgendaList(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const store = _deps.store || new AgentScheduleStore();
  const entries = store.list(options.kind || null);
  // Adaptive next-wakeup (schedule-planner): the earliest future fire time
  // across all schedulable, non-expired entries — what a daemon would sleep
  // until. `now` is injectable for tests.
  const now = _deps.now ? _deps.now() : Date.now();
  const nextAt = nextWakeupAt(entries, { now });
  if (options.json) {
    log(JSON.stringify({ entries, nextWakeupAt: nextAt }, null, 2));
    return 0;
  }
  if (entries.length === 0) {
    log(chalk.gray("\n  No scheduled entries.\n"));
    return 0;
  }
  log("");
  log(chalk.bold("  Agenda:\n"));
  for (const e of entries) {
    const monitorWhat =
      e.source === "file"
        ? `file ${e.watchFile}`
        : e.source === "http"
          ? `url ${e.watchUrl}`
          : `every ${Math.round(e.intervalMs / 1000)}s`;
    const when =
      e.kind === "wakeup"
        ? new Date(e.dueAt).toISOString()
        : e.kind === "cron"
          ? `${e.cron} (next ${new Date(e.nextAt).toISOString()})`
          : `${monitorWhat} (next ${new Date(e.nextAt).toISOString()})`;
    const expiry =
      e.expiresAt != null
        ? chalk.dim(` · expires ${new Date(e.expiresAt).toISOString()}`)
        : "";
    const policy = e.runPolicy
      ? chalk.dim(` · ${describePolicy(e.runPolicy)}`)
      : "";
    log(
      `  ${chalk.cyan(e.kind.padEnd(8))} ${chalk.dim(e.id.slice(0, 8))} ` +
        `${statusBadge(e.status)}  ${e.label || truncate(e.prompt || e.command || e.watchFile || e.watchUrl, 40)}`,
    );
    log(`           ${chalk.dim(when)}${expiry}${policy}`);
  }
  if (nextAt != null) {
    const rel = Math.max(0, Math.round((nextAt - now) / 1000));
    log(
      chalk.gray(
        `\n  next wakeup: ${new Date(nextAt).toISOString()} (in ${rel}s)`,
      ),
    );
  }
  log("");
  return 0;
}

export function runAgendaCancel(id, options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const store = _deps.store || new AgentScheduleStore();
  const removed = store.cancel(id);
  if (options.json) {
    log(JSON.stringify({ cancelled: removed ? removed.id : null }, null, 2));
    return removed ? 0 : 2;
  }
  if (removed) {
    log(chalk.green(`\n  ✓ Cancelled ${removed.kind} ${removed.id}\n`));
    return 0;
  }
  log(chalk.red(`\n  ✖ No entry with id ${id}\n`));
  return 2;
}

/**
 * Remove finished (terminal) entries so the store does not grow without bound.
 * `--older-than <seconds>` keeps entries that finished more recently.
 */
export function runAgendaPrune(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const store = _deps.store || new AgentScheduleStore();
  const now = _deps.now ? _deps.now() : Date.now();

  let before = Infinity;
  if (options.olderThan != null) {
    const secs = Number(options.olderThan);
    if (!Number.isFinite(secs) || secs < 0) {
      log(chalk.red(`\n  ✖ invalid --older-than: ${options.olderThan}\n`));
      return 2;
    }
    before = now - secs * 1000;
  }

  const removed = store.pruneTerminal({ before });
  if (options.json) {
    log(
      JSON.stringify(
        {
          pruned: removed.map((e) => ({
            id: e.id,
            kind: e.kind,
            status: e.status,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (removed.length === 0) {
    log(chalk.gray("\n  No finished entries to prune.\n"));
    return 0;
  }
  log(
    chalk.green(
      `\n  ✓ Pruned ${removed.length} finished entr${removed.length === 1 ? "y" : "ies"}\n`,
    ),
  );
  return 0;
}

/**
 * Fire due entries. Returns 0 unless a monitor command / agent spawn failed in
 * a way worth signalling; JSON summary lists every action taken.
 */
export async function runAgendaRun(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const store = _deps.store || new AgentScheduleStore();
  const spawnAgent = _deps.spawnAgent || defaultSpawnAgent;
  const runCommand = _deps.runCommand || defaultRunCommand;
  const readWatchedFile = _deps.readWatchedFile || defaultReadWatchedFile;
  const fetchUrl = _deps.fetchUrl || defaultFetchUrl;
  const notify = _deps.notify || sendAgentNotification;
  const now = _deps.now ? _deps.now() : Date.now();
  // Retire expired entries BEFORE firing due ones — an expired task never gets
  // a final fire (schedule-planner semantics). Dry-run inspects without mutating.
  const retired = options.dryRun
    ? partitionSchedule(store.list(), { now }).expired
    : store.retireExpired(now);
  const due = store.due(null, now);
  const actions = [];

  for (const entry of due) {
    if (options.dryRun) {
      actions.push({ id: entry.id, kind: entry.kind, action: "would-fire" });
      continue;
    }
    try {
      if (entry.kind === "wakeup") {
        await spawnAgent(entry.prompt, entry.runPolicy);
        store.markWakeupFired(entry.id);
        actions.push({ id: entry.id, kind: "wakeup", action: "fired" });
      } else if (entry.kind === "cron") {
        await spawnAgent(entry.prompt, entry.runPolicy);
        store.advanceCron(entry.id);
        actions.push({ id: entry.id, kind: "cron", action: "fired" });
      } else if (entry.kind === "monitor") {
        // Three sources: a shell command (match its output), a watched file
        // (match its content, or — with no stopWhen — fire when it appears),
        // or an HTTP endpoint (match its response body, or fire on 2xx).
        let output = "";
        let matched = false;
        let mtimeMs = null;
        if (entry.source === "file") {
          const file = await readWatchedFile(entry.watchFile);
          output = file.content;
          mtimeMs = file.mtimeMs ?? null;
          if (entry.watchChange) {
            // Fire once the file's mtime advances past the baseline recorded on
            // the first check. The first check only establishes the baseline.
            matched =
              entry.lastMtimeMs != null &&
              mtimeMs != null &&
              mtimeMs > entry.lastMtimeMs;
          } else {
            matched = entry.stopWhen
              ? new RegExp(entry.stopWhen).test(file.content)
              : file.exists; // no pattern → the file appearing is the signal
          }
        } else if (entry.source === "http") {
          const res = await fetchUrl(entry.watchUrl);
          output = res.body;
          matched = entry.stopWhen
            ? new RegExp(entry.stopWhen).test(res.body)
            : res.ok; // no pattern → a 2xx response is the signal
        } else {
          output = await runCommand(entry.command);
          matched = entry.stopWhen
            ? new RegExp(entry.stopWhen).test(output)
            : false;
        }
        if (matched) {
          const what =
            entry.source === "file"
              ? entry.watchFile
              : entry.source === "http"
                ? entry.watchUrl
                : entry.command;
          await notify({
            title: entry.notify?.title || `Monitor matched: ${what}`,
            body: truncate(output, 500),
            level: "success",
          });
        }
        const updated = store.recordMonitorCheck(entry.id, {
          matched,
          mtimeMs,
        });
        actions.push({
          id: entry.id,
          kind: "monitor",
          action: matched ? "matched" : "checked",
          status: updated?.status,
        });
      }
    } catch (err) {
      actions.push({
        id: entry.id,
        kind: entry.kind,
        action: "error",
        error: err.message,
      });
    }
  }

  const retiredSummary = retired.map((e) => ({ id: e.id, kind: e.kind }));
  if (options.json) {
    log(
      JSON.stringify(
        { due: due.length, retired: retiredSummary, actions },
        null,
        2,
      ),
    );
  } else if (actions.length === 0 && retired.length === 0) {
    log(chalk.gray("  Nothing due.\n"));
  } else {
    for (const e of retired) {
      log(
        chalk.gray(
          `  ${e.kind} ${e.id.slice(0, 8)}: ${options.dryRun ? "would-expire" : "expired"}`,
        ),
      );
    }
    for (const a of actions) {
      const colour = a.action === "error" ? chalk.red : chalk.green;
      log(colour(`  ${a.kind} ${a.id.slice(0, 8)}: ${a.action}`));
    }
  }
  return actions.some((a) => a.action === "error") ? 1 : 0;
}

// ─── default effectful deps (overridable in tests) ─────────────────────────

/**
 * Build the `cc agent` argv for a scheduled prompt, appending the entry's
 * per-task run policy as real `cc agent` flags. A missing / empty policy adds
 * nothing, so an unpolicied task spawns exactly `cc agent -p <prompt>` as
 * before (byte-identical). Exported for unit tests.
 */
export function buildAgentArgs(prompt, policy = null) {
  const args = ["agent", "-p", prompt];
  if (policy && typeof policy === "object") {
    if (
      typeof policy.permissionMode === "string" &&
      policy.permissionMode.length > 0
    ) {
      args.push("--permission-mode", policy.permissionMode);
    }
    if (policy.worktree === true) args.push("--worktree");
    if (Number.isFinite(policy.maxTurns) && policy.maxTurns > 0) {
      args.push("--max-turns", String(policy.maxTurns));
    }
    if (
      typeof policy.goalCondition === "string" &&
      policy.goalCondition.length > 0
    ) {
      args.push("--goal-condition", policy.goalCondition);
      if (Number.isFinite(policy.maxOuterTurns) && policy.maxOuterTurns > 0) {
        args.push("--max-outer-turns", String(policy.maxOuterTurns));
      }
      if (Number.isFinite(policy.goalMaxTokens) && policy.goalMaxTokens > 0) {
        args.push("--goal-max-tokens", String(policy.goalMaxTokens));
      }
      if (Number.isFinite(policy.goalMaxCost) && policy.goalMaxCost > 0) {
        args.push("--goal-max-cost", String(policy.goalMaxCost));
      }
      if (Number.isFinite(policy.goalMaxTime) && policy.goalMaxTime > 0) {
        args.push("--goal-max-time", String(policy.goalMaxTime));
      }
    }
  }
  return args;
}

function defaultSpawnAgent(prompt, policy = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [BIN_PATH, ...buildAgentArgs(prompt, policy)],
      {
        stdio: "ignore",
        detached: false,
        env: process.env,
      },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 || code == null
        ? resolve(code)
        : reject(new Error(`cc agent exited with code ${code}`)),
    );
  });
}

function defaultRunCommand(command) {
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });
  } catch (err) {
    // A non-zero exit still yields output we want to match against.
    return (err.stdout || "") + (err.stderr || "");
  }
}

/**
 * Read a watched file → { exists, content, mtimeMs }. A missing file is not an
 * error. mtimeMs feeds watchChange monitors (fire when the file is modified).
 */
function defaultReadWatchedFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    let mtimeMs = null;
    try {
      mtimeMs = statSync(filePath).mtimeMs;
    } catch {
      /* content read but stat failed — treat mtime as unknown */
    }
    return { exists: true, content, mtimeMs };
  } catch {
    return { exists: false, content: "", mtimeMs: null };
  }
}

/**
 * GET a watched URL → { ok, status, body }. Any failure (network, timeout,
 * non-2xx) is not an error here — it just yields ok:false so the monitor
 * re-arms and tries again next interval.
 */
async function defaultFetchUrl(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: "" };
  }
}

function statusBadge(status) {
  switch (status) {
    case "pending":
    case "active":
      return chalk.green(status);
    case "fired":
    case "matched":
      return chalk.cyan(status);
    case "exhausted":
      return chalk.yellow(status);
    case "expired":
      return chalk.gray(status);
    default:
      return status;
  }
}

function truncate(text, n) {
  const s = String(text || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Compact human summary of a scheduled entry's per-task run policy. */
function describePolicy(policy) {
  const parts = [];
  if (policy.permissionMode) parts.push(policy.permissionMode);
  if (policy.worktree === true) parts.push("worktree");
  if (Number.isFinite(policy.maxTurns)) parts.push(`≤${policy.maxTurns} turns`);
  if (policy.goalCondition) parts.push(`goal: ${policy.goalCondition}`);
  return parts.join(", ");
}
