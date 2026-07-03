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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");

/** Load + validate a task-graph file into a registry (throws on bad input). */
function loadRegistry(file, { ttlMs } = {}) {
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

/** Real executor: hand a task's `prompt` to a headless `cc agent -p`. */
function makeAgentRunTask(opts = {}) {
  return function runTask({ task }) {
    const prompt = task.metadata?.prompt || task?.prompt;
    if (!prompt) {
      throw new Error(`task "${task.key}" has no \`prompt\` to --agent`);
    }
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
        cwd: process.cwd(),
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
    .option("--json", "Emit the event stream as JSON lines")
    .action(async (options) => {
      const ttlMs = Math.max(1, Number(options.ttl) || 60) * 1000;
      let reg;
      try {
        reg = loadRegistry(options.tasks, { ttlMs });
      } catch (err) {
        (log.error || console.error)(err.message);
        process.exitCode = 1;
        return;
      }
      // Pick the executor. Default is a dry-run (validate + schedule, no side
      // effects) so `cc team run` is safe to explore, mirroring `cc eval --dry-run`.
      let runTask;
      if (options.exec) runTask = makeShellRunTask(log);
      else if (options.agent)
        runTask = makeAgentRunTask({ model: options.model });
      else runTask = async () => ({ dryRun: true });

      const teammates = Math.max(1, Number(options.teammates) || 2);
      const runner = new TeamRunner(reg, {
        teammates,
        ttlMs,
        runTask,
        onEvent: options.json
          ? (e) => console.log(JSON.stringify(e))
          : (e) => {
              if (e.type === "task:claimed")
                (log.info || console.log)(`  → ${e.key} [${e.holder}]`);
              else if (e.type === "task:completed")
                (log.info || console.log)(`  ✔ ${e.key}`);
              else if (e.type === "task:failed")
                (log.info || console.log)(
                  `  ✗ ${e.key}${e.retry ? " (will retry)" : " (gave up)"}: ${e.error}`,
                );
            },
      });

      const summary = await runner.run();
      if (!options.json) {
        const s = summary.stats;
        (log.log || console.log)(
          `\nTeam run: ${s.completed}/${s.total} completed` +
            (s.cancelled ? `, ${s.cancelled} cancelled` : "") +
            ` (${teammates} teammates, ${summary.executions} executions, peak ${summary.maxConcurrent} concurrent)`,
        );
      }
      // Non-zero exit when the graph didn't fully complete — usable as a gate.
      if (!summary.done) process.exitCode = 1;
    });

  return program;
}
