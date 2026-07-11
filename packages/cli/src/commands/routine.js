/**
 * `cc routine` — named scheduled/triggered agent tasks with run history
 * (gap-2026-07-11 P1#8; Claude-Code Routines parity, self-hosted).
 *
 *   cc routine create "nightly report" --prompt "..." --cron "0 3 * * *"
 *   cc routine create "deploy watch" --prompt "..." --github acme/app --events PushEvent
 *   cc routine create "one shot" --prompt "..." --at 2026-07-12T09:00:00Z
 *   cc routine create "ci hook" --prompt "..." --webhook
 *   cc routine list · enable/disable · trigger <id> · run · runs [id] · logs <runId> · remove <id>
 *
 * `cc routine run` is the driver (fire due cron/once + poll github) — run it
 * periodically (`cc loop --every 1m -- cc routine run`, system cron, or an
 * agenda wakeup), exactly like `cc agenda run`.
 */

import { spawn, execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { logger } from "../lib/logger.js";

const BIN_PATH = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);

async function loadStore() {
  const { RoutineStore } = await import("../lib/routine-store.js");
  return new RoutineStore();
}

/** Production runner: `cc agent -p <prompt> --output-format json`. */
function defaultRunAgent({ prompt }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [BIN_PATH, "agent", "-p", prompt, "--output-format", "json"],
      { windowsHide: true },
    );
    let out = "";
    let err = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", (error) =>
      resolve({ exitCode: -1, output: `spawn error: ${error.message}` }),
    );
    child.on("close", (code) => {
      let usage = null;
      let costUsd;
      let resultText = "";
      try {
        // result envelope is the last JSON line on stdout
        const lines = out.split("\n").filter((l) => l.trim());
        const envelope = JSON.parse(lines[lines.length - 1]);
        usage = envelope.usage || null;
        costUsd = Number(envelope.total_cost_usd ?? envelope.costUsd);
        resultText = envelope.result || "";
      } catch {
        /* non-JSON output still recorded verbatim */
      }
      resolve({
        exitCode: code ?? -1,
        output: resultText || out || err,
        usage,
        costUsd: Number.isFinite(costUsd) ? costUsd : undefined,
      });
    });
  });
}

/** Production github events fetch via gh CLI. */
function defaultFetchEvents(repo) {
  return new Promise((resolve) => {
    execFile(
      "gh",
      ["api", `repos/${repo}/events`, "--paginate=false"],
      { encoding: "utf8", timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          const rows = JSON.parse(stdout);
          resolve(
            (Array.isArray(rows) ? rows : []).map((r) => ({
              id: r.id,
              type: r.type,
            })),
          );
        } catch {
          resolve([]);
        }
      },
    );
  });
}

function describeTrigger(routine) {
  const t = routine.trigger || {};
  if (t.kind === "cron") return `cron ${t.cron}`;
  if (t.kind === "once") return `once ${new Date(t.at).toISOString()}`;
  if (t.kind === "github")
    return `github ${t.repo}${t.events?.length ? ` (${t.events.join(",")})` : ""}`;
  return "webhook (cc routine trigger)";
}

export function registerRoutineCommand(program) {
  const routine = program
    .command("routine")
    .description(
      "Named scheduled/triggered agent tasks with run history (cron/once/webhook/github)",
    );

  routine
    .command("create <name>")
    .description(
      "Create a routine (exactly one of --cron/--at/--webhook/--github)",
    )
    .requiredOption("--prompt <text>", "Agent prompt to run")
    .option("--cron <expr>", "5-field cron schedule (driver-fired)")
    .option("--at <time>", "One-off ISO time / epoch ms (driver-fired)")
    .option("--webhook", "Fire externally via `cc routine trigger <id>`")
    .option(
      "--github <repo>",
      "Fire on new GitHub events for owner/name (driver-polled via gh)",
    )
    .option(
      "--events <list>",
      "GitHub event types filter (e.g. PushEvent,PullRequestEvent)",
    )
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const picked = [
          options.cron && "cron",
          options.at && "once",
          options.webhook && "webhook",
          options.github && "github",
        ].filter(Boolean);
        if (picked.length !== 1) {
          throw new Error(
            "pick exactly one trigger: --cron <expr> | --at <time> | --webhook | --github <repo>",
          );
        }
        const trigger =
          picked[0] === "cron"
            ? { kind: "cron", cron: options.cron }
            : picked[0] === "once"
              ? { kind: "once", at: options.at }
              : picked[0] === "github"
                ? {
                    kind: "github",
                    repo: options.github,
                    events: options.events
                      ? options.events.split(",").map((s) => s.trim())
                      : [],
                  }
                : { kind: "webhook" };
        const store = await loadStore();
        const created = store.create({ name, prompt: options.prompt, trigger });
        if (options.json) return console.log(JSON.stringify(created, null, 2));
        logger.success(
          `Created routine ${created.id} (${describeTrigger(created)})`,
        );
        if (trigger.kind === "webhook") {
          logger.log(
            chalk.gray(`  fire it with: cc routine trigger ${created.id}`),
          );
        } else {
          logger.log(chalk.gray("  driver: run `cc routine run` periodically"));
        }
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  routine
    .command("list", { isDefault: true })
    .description("List routines with run/cost summaries")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const store = await loadStore();
        const routines = store.list().map((r) => ({
          ...r,
          summary: store.summarize(r.id),
        }));
        if (options.json) return console.log(JSON.stringify(routines, null, 2));
        if (routines.length === 0) {
          logger.log(
            chalk.gray("No routines. Create one with `cc routine create`."),
          );
          return;
        }
        for (const r of routines) {
          const state = r.enabled ? chalk.green("on ") : chalk.gray("off");
          const s = r.summary;
          const cost = s.costUsd ? `  $${s.costUsd.toFixed(4)}` : "";
          logger.log(
            `${state} ${r.id}  ${chalk.bold(r.name)}  ${chalk.gray(describeTrigger(r))}`,
          );
          logger.log(
            chalk.gray(
              `      runs ${s.totalRuns} (${s.ok} ok, ${s.failed} failed${s.running ? `, ${s.running} running` : ""})${cost}`,
            ),
          );
        }
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  routine
    .command("enable <id>")
    .description("Enable a routine")
    .action(async (id) => {
      try {
        const store = await loadStore();
        const r = store.setEnabled(id, true);
        logger.success(`Enabled ${r.id} (${r.name})`);
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  routine
    .command("disable <id>")
    .description("Disable a routine (kept, never fires)")
    .action(async (id) => {
      try {
        const store = await loadStore();
        const r = store.setEnabled(id, false);
        logger.success(`Disabled ${r.id} (${r.name})`);
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  routine
    .command("remove <id>")
    .description("Delete a routine (run history is kept)")
    .action(async (id) => {
      try {
        const store = await loadStore();
        const r = store.remove(id);
        logger.success(`Removed ${r.id} (${r.name})`);
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  routine
    .command("trigger <id>")
    .description("Fire a routine NOW (the webhook/API entry point)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const store = await loadStore();
        const r = store.get(id);
        if (!r) throw new Error(`routine not found: ${id}`);
        const { fireRoutine } = await import("../lib/routine-store.js");
        const runId = await fireRoutine(store, r, defaultRunAgent, {
          trigger: "manual",
        });
        const run = store.listRuns({ routineId: r.id, limit: 1 })[0];
        if (options.json) return console.log(JSON.stringify(run, null, 2));
        logger.success(`Fired ${r.id} → ${runId} (${run?.status})`);
        logger.log(chalk.gray(`  log: cc routine logs ${runId}`));
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  routine
    .command("run")
    .description("Driver: fire due cron/once routines and poll github triggers")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const store = await loadStore();
        const { fireRoutine, pollGithubRoutine } =
          await import("../lib/routine-store.js");
        const fired = [];
        for (const r of store.due()) {
          fired.push({
            routine: r.id,
            runId: await fireRoutine(store, r, defaultRunAgent, {
              trigger: r.trigger.kind,
            }),
          });
        }
        for (const r of store.githubRoutines()) {
          const runs = await pollGithubRoutine(store, r, {
            fetchEvents: defaultFetchEvents,
            runAgent: defaultRunAgent,
          });
          for (const runId of runs) fired.push({ routine: r.id, runId });
        }
        if (options.json)
          return console.log(JSON.stringify({ fired }, null, 2));
        if (fired.length === 0) {
          logger.log(chalk.gray("Nothing due."));
        } else {
          for (const f of fired) logger.log(`fired ${f.routine} → ${f.runId}`);
        }
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  routine
    .command("runs [id]")
    .description("Run history (all routines, or one)")
    .option("-n, --limit <n>", "Max rows", "20")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const store = await loadStore();
        const routineId = id ? (store.get(id)?.id ?? id) : null;
        const runs = store.listRuns({
          routineId,
          limit: Math.max(1, Number(options.limit) || 20),
        });
        if (options.json) return console.log(JSON.stringify(runs, null, 2));
        if (runs.length === 0) return logger.log(chalk.gray("No runs."));
        for (const run of runs) {
          const color =
            run.status === "ok"
              ? chalk.green
              : run.status === "running"
                ? chalk.cyan
                : chalk.red;
          const cost = Number.isFinite(run.costUsd)
            ? `  $${run.costUsd.toFixed(4)}`
            : "";
          logger.log(
            `${color((run.status || "?").padEnd(8))} ${run.runId}  ${run.routineId}  ${new Date(run.startedAt).toISOString()}${cost}`,
          );
          if (run.summary) logger.log(chalk.gray(`  ${run.summary}`));
        }
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });

  routine
    .command("logs <runId>")
    .description("Print a run's full agent output")
    .action(async (runId) => {
      try {
        const store = await loadStore();
        const file = store.logFile(runId);
        if (!existsSync(file)) throw new Error(`no log for run: ${runId}`);
        process.stdout.write(readFileSync(file, "utf-8"));
      } catch (err) {
        logger.error(err.message);
        process.exitCode = 1;
      }
    });
}
