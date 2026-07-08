/**
 * `cc team` — run a declared task graph across N cooperating teammates with
 * exclusive leases + dependency ordering (Phase 4, Agent Team).
 *
 * A task file is JSON:
 *   { "tasks": [ { "key": "build", "title": "...", "dependsOn": [],
 *                  "command": "npm run build" | "prompt": "fix the bug in x" } ] }
 *
 *   cc team plan  --tasks graph.json        # topological wave preview (no run)
 *   cc team run   --tasks graph.json        # dry-run: validate + schedule, no exec
 *   cc team run   --tasks graph.json --exec # run each task's shell `command`
 *   cc team run   --tasks graph.json --agent# hand each task's `prompt` to cc agent
 *
 * The lease/DAG guarantees (no double-processing, deps-before-dependents, crash
 * reclaim) come from TaskLeaseRegistry; TeamRunner drives the N teammates.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { TaskLeaseRegistry } from "../lib/agent-team/task-lease.js";
import { TeamRunner } from "../lib/agent-team/team-runner.js";
import { TeamWorktreeCoordinator } from "../lib/agent-team/team-worktree.js";
import { TeamBudget } from "../lib/agent-team/team-budget.js";
import { TeamMailbox } from "../lib/agent-team/team-mailbox.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");

/** Load + validate a task-graph file into a registry (throws on bad input). */
export function loadRegistry(file, { ttlMs } = {}) {
  const abs = path.resolve(process.cwd(), file);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    throw new Error(`cannot read task file ${abs}: ${err.message}`);
  }
  const tasks = Array.isArray(doc) ? doc : doc.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("task file must have a non-empty `tasks` array");
  }
  // Reject unknown dependency keys up front: a typo'd dependsOn ("biuld") makes
  // a task permanently unclaimable — the run silently exits 1 and `plan` drops
  // it from the waves with no diagnosis.
  const keys = new Set(tasks.map((t) => t.key));
  for (const t of tasks) {
    for (const d of t.dependsOn || t.deps || []) {
      if (!keys.has(d)) {
        throw new Error(
          `task "${t.key}" depends on unknown task "${d}" (typo in dependsOn?)`,
        );
      }
    }
  }
  const reg = new TaskLeaseRegistry({ defaultTtlMs: ttlMs });
  for (const t of tasks) {
    const r = reg.addTask({
      key: t.key,
      title: t.title || t.key,
      dependsOn: t.dependsOn || t.deps || [],
      priority: t.priority,
      metadata: { command: t.command || null, prompt: t.prompt || null },
    });
    if (!r.ok) {
      throw new Error(
        `task "${t.key || "(unnamed)"}" rejected: ${r.reason}` +
          (r.cycle ? ` [${r.cycle.join(" → ")}]` : ""),
      );
    }
  }
  return reg;
}

/** Topological wave schedule (each wave = tasks whose deps are all in prior waves). */
function planWaves(reg) {
  const done = new Set();
  const waves = [];
  const all = reg.list();
  let remaining = all.map((t) => t.key);
  let guard = all.length + 1;
  while (remaining.length > 0 && guard-- > 0) {
    const wave = remaining.filter((k) => {
      const t = reg.getTask(k);
      return t.dependsOn.every((d) => done.has(d));
    });
    if (wave.length === 0) break; // unreachable if the graph is a DAG
    waves.push(wave);
    wave.forEach((k) => done.add(k));
    remaining = remaining.filter((k) => !wave.includes(k));
  }
  return waves;
}

/** Real executor: run a task's shell `command`, success = exit 0. */
function makeShellRunTask(logger) {
  return function runTask({ task }) {
    const command = task.metadata?.command || task?.command;
    if (!command) {
      throw new Error(`task "${task.key}" has no \`command\` to --exec`);
    }
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: process.cwd(),
        shell: true,
        env: process.env,
      });
      let err = "";
      child.stderr?.on("data", (d) => (err += d.toString("utf8")));
      child.on("error", (e) => reject(new Error(e.message)));
      child.on("close", (code) => {
        if (code === 0) resolve({ code });
        else reject(new Error(err.trim() || `command exited ${code}`));
      });
    });
  };
}

/** Spawn a headless `cc agent -p` for one prompt in `cwd`; resolve on exit 0. */
function spawnAgent(prompt, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      BIN,
      "agent",
      "-p",
      prompt,
      "--permission-mode",
      opts.permissionMode || "acceptEdits",
      "--output-format",
      "text",
    ];
    if (opts.model) args.push("--model", opts.model);
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, CLAUDECODE: "1" },
      windowsHide: true,
    });
    let err = "";
    child.stderr?.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => reject(new Error(e.message)));
    child.on("close", (code) =>
      code === 0
        ? resolve({ code })
        : reject(new Error(err.trim() || `agent exited ${code}`)),
    );
  });
}

/** Real executor: hand a task's `prompt` to a headless `cc agent -p` in cwd. */
function makeAgentRunTask(opts = {}) {
  return function runTask({ task }) {
    const prompt = task.metadata?.prompt || task?.prompt;
    if (!prompt) {
      throw new Error(`task "${task.key}" has no \`prompt\` to --agent`);
    }
    return spawnAgent(prompt, process.cwd(), opts);
  };
}

export function registerTeamCommand(program, { logger } = {}) {
  const log = logger || console;
  const team = program
    .command("team")
    .description(
      "Run a declared task graph across N teammates (exclusive leases + dependency DAG)",
    );

  team
    .command("plan")
    .description("Show the topological wave schedule for a task graph (no run)")
    .requiredOption("--tasks <file>", "Task-graph JSON file")
    .option("--json", "Output the plan as JSON")
    .action((options) => {
      let reg;
      try {
        reg = loadRegistry(options.tasks);
      } catch (err) {
        (log.error || console.error)(err.message);
        process.exitCode = 1;
        return;
      }
      const waves = planWaves(reg);
      if (options.json) {
        console.log(
          JSON.stringify({ waves, total: reg.list().length }, null, 2),
        );
        return;
      }
      (log.log || console.log)(
        `Task graph: ${reg.list().length} task(s), ${waves.length} wave(s)`,
      );
      waves.forEach((w, i) => {
        (log.log || console.log)(`  wave ${i + 1}: ${w.join(", ")}`);
      });
    });

  team
    .command("run")
    .description("Run a task graph with N cooperating teammates")
    .requiredOption("--tasks <file>", "Task-graph JSON file")
    .option("--teammates <n>", "Number of concurrent teammates", "2")
    .option("--ttl <seconds>", "Lease TTL per task", "60")
    .option("--exec", "Execute each task's shell `command` (real)")
    .option(
      "--agent",
      "Hand each task's `prompt` to a headless cc agent (real)",
    )
    .option("--model <model>", "Model for --agent runs")
    .option(
      "--worktree",
      "Run each task's `command` in its own git worktree (parallel isolation)",
    )
    .option(
      "--merge",
      "With --worktree: merge each clean branch back to base (conflicts reported, not forced)",
    )
    .option("--max-tasks <n>", "Budget: total task executions across the team")
    .option("--max-tokens <n>", "Budget: total LLM tokens across the team")
    .option(
      "--max-usd <n>",
      "Budget: total estimated USD spend across the team",
    )
    .option(
      "--max-wall <seconds>",
      "Budget: wall-clock seconds for the whole run",
    )
    .option(
      "--state <file>",
      "Persist team progress to a file (for --resume after a crash)",
    )
    .option(
      "--resume",
      "Restore progress from --state (completed tasks stay done; stale leases freed)",
    )
    .option("--json", "Emit the event stream as JSON lines")
    .option(
      "--otlp <file>",
      "Write OTLP/JSON spans (one team.task span per execution, tagged workflow.run_id / workflow.name) to a file",
    )
    .action(async (options) => {
      const ttlMs = Math.max(1, Number(options.ttl) || 60) * 1000;
      let reg;
      let mailbox = new TeamMailbox();
      let budget = new TeamBudget({
        maxTasks: options.maxTasks,
        maxTokens: options.maxTokens,
        maxUsd: options.maxUsd,
        maxWallMs: options.maxWall
          ? Math.max(1, Number(options.maxWall)) * 1000
          : null,
      });
      let priorMembers = [];
      try {
        // Resume from a prior (possibly crashed) run's state: completed tasks
        // stay COMPLETED, and any lease left dangling by a crash is reclaimed so
        // its task is re-run — the team-session-recovery acceptance path. The
        // mailbox + budget are restored too so messages/spend stay consistent.
        if (options.resume && options.state && fs.existsSync(options.state)) {
          const snap = JSON.parse(fs.readFileSync(options.state, "utf8"));
          const isV2 = snap && snap.version >= 2 && snap.registry;
          reg = TaskLeaseRegistry.restore(isV2 ? snap.registry : snap);
          if (isV2) {
            if (snap.mailbox) mailbox = TeamMailbox.restore(snap.mailbox);
            if (snap.budget)
              budget = TeamBudget.restore(snap.budget, {
                // CLI flags on the resume invocation override the prior caps;
                // omitted flags keep them (never silently drop a safety cap).
                overrides: {
                  maxTasks: options.maxTasks,
                  maxTokens: options.maxTokens,
                  maxUsd: options.maxUsd,
                  maxWallMs: options.maxWall
                    ? Math.max(1, Number(options.maxWall)) * 1000
                    : undefined,
                },
              });
            priorMembers = Array.isArray(snap.members) ? snap.members : [];
          }
          // A teammate whose lease is still dangling here crashed last run — its
          // task is about to be reclaimed, so report it LOST before the sweep.
          const lostHolders = new Set();
          for (const t of reg.list()) {
            if (t.lease && t.lease.holder) lostHolders.add(t.lease.holder);
          }
          // Reclaim ALL dangling leases, not just expired ones: every holder in
          // the persisted snapshot is from the now-dead prior process, so a lease
          // still inside its TTL (a crash seconds after acquiring) must be
          // reclaimed too — reclaimExpired() would skip it and strand the task,
          // yet we already reported its holder LOST above.
          const freed = reg.reclaimAll();
          for (const h of lostHolders) {
            if (options.json)
              console.log(JSON.stringify({ type: "teammate:lost", holder: h }));
            else (log.info || console.log)(`  ⚠ teammate ${h} lost (crashed)`);
          }
          const s = reg.stats();
          (log.info || console.log)(
            `Resumed: ${s.completed}/${s.total} already done` +
              (freed.length
                ? `, ${freed.length} stale lease(s) reclaimed`
                : ""),
          );
        } else {
          reg = loadRegistry(options.tasks, { ttlMs });
        }
      } catch (err) {
        (log.error || console.error)(err.message);
        process.exitCode = 1;
        return;
      }

      // Persist a snapshot after each task settles so a crash mid-run is
      // resumable (persist-after-run alone would lose everything on a crash).
      // v2 bundles registry + mailbox + budget + member lifecycle so a resume
      // keeps the whole team state consistent, not just the task graph.
      let runnerRef = null;
      const persist = () => {
        if (!options.state) return;
        try {
          // Atomic write (tmp + rename): a crash mid-write must not truncate
          // the ONLY resume file — a torn snapshot makes --resume throw and
          // loses all progress.
          const tmp = `${options.state}.tmp`;
          fs.writeFileSync(
            tmp,
            JSON.stringify(
              {
                version: 2,
                registry: reg.snapshot(),
                mailbox: mailbox.snapshot(),
                budget: budget.snapshot(),
                members: runnerRef ? runnerRef.members() : priorMembers,
              },
              null,
              2,
            ),
            "utf8",
          );
          fs.renameSync(tmp, options.state);
        } catch (e) {
          (log.error || console.error)(`  state write failed: ${e.message}`);
        }
      };

      // Pick the executor. Default is a dry-run (validate + schedule, no side
      // effects) so `cc team run` is safe to explore, mirroring `cc eval --dry-run`.
      let runTask;
      let coord = null;
      if (options.worktree) {
        coord = new TeamWorktreeCoordinator(process.cwd());
        if (!coord.isGitRepo()) {
          (log.error || console.error)(
            "--worktree requires a git repository (run inside one)",
          );
          process.exitCode = 1;
          return;
        }
        if (options.agent) {
          // --agent --worktree: each teammate drives an agent turn (its `prompt`)
          // inside its OWN git worktree, so parallel edits never fight over the
          // working tree, then integrate/merge the branches like --exec --worktree.
          runTask = coord.makeRunTask({
            runInWorktree: async ({ key, task, cwd }) => {
              const prompt = task.metadata?.prompt || task?.prompt;
              if (!prompt) {
                throw new Error(`task "${key}" has no \`prompt\` to --agent`);
              }
              await spawnAgent(prompt, cwd, { model: options.model });
            },
          });
        } else {
          runTask = coord.makeRunTask();
        }
      } else if (options.exec) {
        // --exec runs each task's `command` verbatim through a shell. A shared
        // or downloaded plan file is untrusted input — surface that before we
        // start executing it, so it's not silently treated as safe.
        log.warn(
          "⚠ --exec executes each task's shell `command` from the plan file. Only run plans you trust.",
        );
        runTask = makeShellRunTask(log);
      } else if (options.agent)
        runTask = makeAgentRunTask({ model: options.model });
      else runTask = async () => ({ dryRun: true });

      // Optional workflow tracing (Claude-Code 2.1.202 parity): every task
      // execution becomes a `team.task` span tagged with workflow.run_id +
      // workflow.name so a collector can reassemble the run as one workflow.
      let recorder = null;
      if (options.otlp) {
        const { TelemetryRecorder } =
          await import("../lib/telemetry/span-recorder.js");
        recorder = new TelemetryRecorder({
          defaultAttributes: {
            "workflow.run_id": `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            "workflow.name": path.basename(options.tasks),
          },
        });
      }

      const teammates = Math.max(1, Number(options.teammates) || 2);
      const runner = new TeamRunner(reg, {
        teammates,
        ttlMs,
        runTask,
        budget,
        mailbox,
        recorder,
        onEvent: (e) => {
          if (options.json) console.log(JSON.stringify(e));
          else if (e.type === "task:claimed")
            (log.info || console.log)(`  → ${e.key} [${e.holder}]`);
          else if (e.type === "task:completed")
            (log.info || console.log)(`  ✔ ${e.key}`);
          else if (e.type === "task:failed")
            (log.info || console.log)(
              `  ✗ ${e.key}${e.retry ? " (will retry)" : " (gave up)"}: ${e.error}`,
            );
          else if (e.type === "run:budget-exhausted")
            (log.info || console.log)(
              `  ⛔ budget reached (${e.reason || `max-tasks ${e.maxTasks}`}) — no new tasks claimed`,
            );
          if (e.type === "task:completed" || e.type === "task:failed")
            persist();
        },
      });
      runner.seedMembers(priorMembers);
      runnerRef = runner;

      const summary = await runner.run();
      persist();

      if (recorder && options.otlp) {
        try {
          fs.writeFileSync(
            options.otlp,
            JSON.stringify(recorder.toOtlp(), null, 2),
            "utf8",
          );
          if (!options.json)
            (log.info || console.log)(`  OTLP spans → ${options.otlp}`);
        } catch (e) {
          (log.error || console.error)(`  otlp write failed: ${e.message}`);
        }
      }

      // Worktree integration: sequentially preview (and optionally merge) each
      // committed branch back to base, then remove the worktrees. Conflicts are
      // reported, never force-merged.
      let integration = null;
      if (coord) {
        integration = coord.integrate({ merge: options.merge === true });
        coord.cleanupAll();
        if (!options.json) {
          (log.log || console.log)("\nWorktree integration:");
          for (const r of integration) {
            if (!r.committed)
              (log.info || console.log)(`  · ${r.key}: no changes`);
            else if (r.error)
              (log.info || console.log)(
                `  ✗ ${r.key} [${r.branch}]: ${r.error}`,
              );
            else if (!r.clean)
              (log.info || console.log)(
                `  ⚠ ${r.key} [${r.branch}]: conflicts in ${r.conflicts.length} file(s) — not merged`,
              );
            else
              (log.info || console.log)(
                `  ${r.merged ? "✔ merged" : "✔ clean"} ${r.key} [${r.branch}]`,
              );
          }
        }
      }

      if (options.json && integration)
        console.log(JSON.stringify({ integration }));
      if (!options.json) {
        const s = summary.stats;
        (log.log || console.log)(
          `\nTeam run: ${s.completed}/${s.total} completed` +
            (s.cancelled ? `, ${s.cancelled} cancelled` : "") +
            ` (${teammates} teammates, ${summary.executions} executions, peak ${summary.maxConcurrent} concurrent)`,
        );
        if (budget.enabled()) {
          const b = budget.status();
          const parts = [`${b.tasks} task(s)`, `${b.tokens} token(s)`];
          if (b.maxUsd != null) parts.push(`$${b.spentUsd.toFixed(4)}`);
          (log.log || console.log)(
            `Budget: ${parts.join(", ")}` +
              (summary.budgetStopped
                ? ` — stopped early (${summary.budgetReason})`
                : ""),
          );
        }
        if (mailbox.size() > 0)
          (log.log || console.log)(
            `Messages: ${mailbox.size()} exchanged between teammates`,
          );
      } else {
        console.log(
          JSON.stringify({
            summary: {
              done: summary.done,
              executions: summary.executions,
              budgetStopped: summary.budgetStopped,
              budgetReason: summary.budgetReason,
              budget: budget.status(),
              members: summary.members,
              messages: mailbox.size(),
            },
          }),
        );
      }
      // Non-zero exit when the graph didn't fully complete — usable as a gate.
      if (!summary.done) process.exitCode = 1;
    });

  return program;
}
