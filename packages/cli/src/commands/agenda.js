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
 *   - monitor → check its source (a shell <command>'s output, or a <watchFile>'s
 *               content / appearance); if it matches stop_when, send the
 *               notification and stop; else re-arm for the next interval
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    log(
      `  ${chalk.cyan(e.kind.padEnd(8))} ${chalk.dim(e.id.slice(0, 8))} ` +
        `${statusBadge(e.status)}  ${e.label || truncate(e.prompt || e.command || e.watchFile, 40)}`,
    );
    log(`           ${chalk.dim(when)}${expiry}`);
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
        await spawnAgent(entry.prompt);
        store.markWakeupFired(entry.id);
        actions.push({ id: entry.id, kind: "wakeup", action: "fired" });
      } else if (entry.kind === "cron") {
        await spawnAgent(entry.prompt);
        store.advanceCron(entry.id);
        actions.push({ id: entry.id, kind: "cron", action: "fired" });
      } else if (entry.kind === "monitor") {
        // Two sources: a shell command (match its output) or a watched file
        // (match its content, or — with no stopWhen — fire when it appears).
        let output = "";
        let matched = false;
        if (entry.source === "file") {
          const file = await readWatchedFile(entry.watchFile);
          output = file.content;
          matched = entry.stopWhen
            ? new RegExp(entry.stopWhen).test(file.content)
            : file.exists; // no pattern → the file appearing is the signal
        } else {
          output = await runCommand(entry.command);
          matched = entry.stopWhen
            ? new RegExp(entry.stopWhen).test(output)
            : false;
        }
        if (matched) {
          const what =
            entry.source === "file" ? entry.watchFile : entry.command;
          await notify({
            title: entry.notify?.title || `Monitor matched: ${what}`,
            body: truncate(output, 500),
            level: "success",
          });
        }
        const updated = store.recordMonitorCheck(entry.id, { matched });
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

function defaultSpawnAgent(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN_PATH, "agent", "-p", prompt], {
      stdio: "ignore",
      detached: false,
      env: process.env,
    });
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

/** Read a watched file → { exists, content }. A missing file is not an error. */
function defaultReadWatchedFile(filePath) {
  try {
    return { exists: true, content: readFileSync(filePath, "utf-8") };
  } catch {
    return { exists: false, content: "" };
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
