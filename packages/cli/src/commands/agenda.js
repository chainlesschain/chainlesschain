/**
 * `cc agenda` — consumer for the agent-scheduled Monitor / Cron / Wakeup
 * entries (gap-analysis 第四阶段 #3). The `schedule` agent tool PERSISTS
 * intent; this command is what actually FIRES it — run it periodically
 * (`cc loop --every 1m -- cc agenda run`, a system cron, or by hand):
 *
 *   cc agenda list [--json]           show all scheduled entries
 *   cc agenda run [--json] [--dry-run]  fire everything due right now
 *   cc agenda cancel <id>             remove one entry
 *
 * `run` for each due entry:
 *   - wakeup  → spawn `cc agent -p <prompt>`, mark fired
 *   - cron    → spawn `cc agent -p <prompt>`, advance to next fire time
 *   - monitor → run <command>; if output matches stop_when, send the
 *               notification and stop; else re-arm for the next interval
 */

import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { AgentScheduleStore } from "../lib/agent-schedule-store.js";
import { sendAgentNotification } from "../lib/agent-notify.js";

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
}

export function runAgendaList(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const store = _deps.store || new AgentScheduleStore();
  const entries = store.list(options.kind || null);
  if (options.json) {
    log(JSON.stringify({ entries }, null, 2));
    return 0;
  }
  if (entries.length === 0) {
    log(chalk.gray("\n  No scheduled entries.\n"));
    return 0;
  }
  log("");
  log(chalk.bold("  Agenda:\n"));
  for (const e of entries) {
    const when =
      e.kind === "wakeup"
        ? new Date(e.dueAt).toISOString()
        : e.kind === "cron"
          ? `${e.cron} (next ${new Date(e.nextAt).toISOString()})`
          : `every ${Math.round(e.intervalMs / 1000)}s (next ${new Date(e.nextAt).toISOString()})`;
    log(
      `  ${chalk.cyan(e.kind.padEnd(8))} ${chalk.dim(e.id.slice(0, 8))} ` +
        `${statusBadge(e.status)}  ${e.label || truncate(e.prompt || e.command, 40)}`,
    );
    log(`           ${chalk.dim(when)}`);
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
 * Fire due entries. Returns 0 unless a monitor command / agent spawn failed in
 * a way worth signalling; JSON summary lists every action taken.
 */
export async function runAgendaRun(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const store = _deps.store || new AgentScheduleStore();
  const spawnAgent = _deps.spawnAgent || defaultSpawnAgent;
  const runCommand = _deps.runCommand || defaultRunCommand;
  const notify = _deps.notify || sendAgentNotification;
  const due = store.due(null, _deps.now ? _deps.now() : null);
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
        const output = await runCommand(entry.command);
        const matched = entry.stopWhen
          ? new RegExp(entry.stopWhen).test(output)
          : false;
        if (matched) {
          await notify({
            title: entry.notify?.title || `Monitor matched: ${entry.command}`,
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

  if (options.json) {
    log(JSON.stringify({ due: due.length, actions }, null, 2));
  } else if (actions.length === 0) {
    log(chalk.gray("  Nothing due.\n"));
  } else {
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
    default:
      return status;
  }
}

function truncate(text, n) {
  const s = String(text || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}
