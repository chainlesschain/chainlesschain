/**
 * `cc batch` — dynamic worktree batch (gap-analysis 第四阶段 #4). Split a big
 * change into independent UNITS, run each in its own git worktree in parallel,
 * test each, and aggregate diff/test/merge-conflict results.
 *
 *   cc batch --units units.json                 # run declared units
 *   cc batch --units units.json --test "npm test" --concurrency 4 --merge
 *   cc batch --decompose "migrate all foo() calls to bar()" --parts 8
 *       # ask an agent to split the goal into a units.json, then run it
 *   cc batch --decompose "…" --parts 8 --plan-only   # emit units, don't run
 *
 * units.json: { "units": [ { "key": "u1", "prompt": "…", "test": "npm test -w a" } ] }
 *
 * Real isolation comes from worktree-isolator (the same primitive `cc team
 * --worktree` uses); the fan-out + aggregation core lives in lib/agent-batch.js
 * (fully injectable). Branches persist for inspection unless merged.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { execFileSync } from "child_process";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { runBatch } from "../lib/agent-batch.js";
import {
  createWorktree,
  removeWorktree,
  previewWorktreeMerge,
  mergeWorktree,
} from "../harness/worktree-isolator.js";
import { findProjectRoot } from "../lib/project-detector.js";

const BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "bin",
  "chainlesschain.js",
);

const DECOMPOSE_SCHEMA = {
  type: "object",
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          prompt: { type: "string" },
          test: { type: "string" },
        },
        required: ["key", "prompt"],
      },
    },
  },
  required: ["units"],
};

export function registerBatchCommand(program) {
  program
    .command("batch")
    .description(
      "Split a large change into independent units, run each in its own git worktree in parallel, and aggregate results",
    )
    .option(
      "--units <file>",
      "Units JSON file ({ units: [{key, prompt, test?}] })",
    )
    .option(
      "--decompose <goal>",
      "Ask an agent to split this goal into units first (structured output)",
    )
    .option("--parts <n>", "Target number of units for --decompose", "6")
    .option(
      "--plan-only",
      "With --decompose: print the units and exit (no run)",
    )
    .option("--concurrency <n>", "Max worktrees running at once", "4")
    .option("--test <cmd>", "Default test command run in each worktree")
    .option("--merge", "Merge clean, passing branches back to base")
    .option("--model <model>", "Model for agent runs")
    .option("--json", "Machine-readable JSON output")
    .action(async (options) => {
      process.exitCode = await runBatchCommand(options);
    });
}

export async function runBatchCommand(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const errLog = _deps.err || ((m) => logger.error(m));
  const repoDir =
    _deps.repoDir || findProjectRoot(process.cwd()) || process.cwd();

  // 1. Resolve the unit list — from a file, or by decomposing a goal.
  let units;
  try {
    if (options.units) {
      const doc = JSON.parse(fs.readFileSync(options.units, "utf8"));
      units = Array.isArray(doc) ? doc : doc.units;
    } else if (options.decompose) {
      units = await (_deps.decompose || decomposeGoal)(
        options.decompose,
        Number(options.parts) || 6,
        { model: options.model, repoDir },
      );
      if (options.planOnly) {
        log(JSON.stringify({ units }, null, 2));
        return 0;
      }
    } else {
      errLog("Provide --units <file> or --decompose <goal>.");
      return 4;
    }
  } catch (err) {
    errLog(`Failed to resolve units: ${err.message}`);
    return 4;
  }

  // 2. Run the batch with real worktree + agent + git deps.
  const deps = _deps.batchDeps || {
    createWorktree: (key, branch) => createWorktree(repoDir, branch).path,
    removeWorktree: (worktreePath, opts) =>
      removeWorktree(repoDir, worktreePath, opts),
    runAgent:
      _deps.runAgent ||
      ((prompt, cwd) => spawnAgent(prompt, cwd, { model: options.model })),
    runTest: _deps.runTest || runTestCommand,
    diffStat: _deps.diffStat || gitDiffStat,
    commit: _deps.commit || gitCommitAll,
    previewMerge: (branch) => previewWorktreeMerge(repoDir, branch),
    mergeBranch: (branch, message) =>
      mergeWorktree(repoDir, branch, { message }),
    branchFor: (key) => `batch/${sanitize(key)}`,
  };

  const onEvent = options.json ? () => {} : (ev) => log(formatEvent(ev));

  let outcome;
  try {
    outcome = await runBatch(
      {
        units,
        concurrency: options.concurrency,
        test: options.test || null,
        merge: options.merge === true,
        onEvent,
      },
      deps,
    );
  } catch (err) {
    errLog(`Batch failed: ${err.message}`);
    return 1;
  }

  if (options.json) {
    log(JSON.stringify(outcome, null, 2));
  } else {
    log("");
    log(chalk.bold("  Batch summary:"));
    const s = outcome.summary;
    log(
      `  ${s.total} units — ${chalk.green(s.done + " done")}, ` +
        `${chalk.red(s.testFailed + " test-failed")}, ` +
        `${chalk.yellow(s.errored + " errored")}, ${s.noChanges} no-change`,
    );
    if (options.merge) {
      log(
        `  merged ${chalk.green(s.merged)}, conflicts ${chalk.yellow(s.conflicted)}`,
      );
    }
    log("");
  }
  // Non-zero when anything failed so CI can gate on it.
  return outcome.summary.testFailed + outcome.summary.errored > 0 ? 1 : 0;
}

// ─── real effectful deps ───────────────────────────────────────────────────

function sanitize(key) {
  return String(key).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function spawnAgent(prompt, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      BIN,
      "agent",
      "-p",
      prompt,
      "--permission-mode",
      "acceptEdits",
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

function runTestCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      windowsHide: true,
    });
    let err = "";
    child.stderr?.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => reject(new Error(e.message)));
    child.on("close", (code) =>
      code === 0
        ? resolve({ code })
        : reject(new Error(err.trim() || `test exited ${code}`)),
    );
  });
}

/** `git add -A` staged numstat totals for a worktree. */
function gitDiffStat(cwd) {
  try {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    const out = execFileSync("git", ["diff", "--cached", "--numstat"], {
      cwd,
      encoding: "utf8",
    });
    let insertions = 0;
    let deletions = 0;
    let filesChanged = 0;
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [add, del] = trimmed.split("\t");
      filesChanged += 1;
      insertions += add === "-" ? 0 : parseInt(add, 10) || 0;
      deletions += del === "-" ? 0 : parseInt(del, 10) || 0;
    }
    return { filesChanged, insertions, deletions };
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0 };
  }
}

function gitCommitAll(cwd, message) {
  try {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", message, "--no-verify"], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false; // nothing to commit / commit failed
  }
}

/** Spawn a headless agent that emits a units JSON via --json-schema. */
async function decomposeGoal(goal, parts, opts = {}) {
  const prompt =
    `Split this task into ${parts} INDEPENDENT units that can each be done in a ` +
    `separate git worktree WITHOUT depending on each other's changes. For each ` +
    `unit give a short kebab-case "key", a self-contained "prompt" (the full ` +
    `instruction for an agent working only on that unit), and optionally a "test" ` +
    `shell command to verify it.\n\nTask: ${goal}`;
  return new Promise((resolve, reject) => {
    const args = [
      BIN,
      "agent",
      "-p",
      prompt,
      "--json-schema",
      JSON.stringify(DECOMPOSE_SCHEMA),
      "--permission-mode",
      "plan",
    ];
    if (opts.model) args.push("--model", opts.model);
    const child = spawn(process.execPath, args, {
      cwd: opts.repoDir || process.cwd(),
      env: { ...process.env, CLAUDECODE: "1" },
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d.toString("utf8")));
    child.stderr?.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => reject(new Error(e.message)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `decompose agent exited ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(out.trim());
        resolve(parsed.units);
      } catch (e) {
        reject(new Error(`could not parse decomposition output: ${e.message}`));
      }
    });
  });
}

function formatEvent(ev) {
  switch (ev.type) {
    case "batch:start":
      return chalk.dim(
        `  batch: ${ev.units} units, concurrency ${ev.concurrency}`,
      );
    case "unit:start":
      return chalk.dim(`  ▶ ${ev.key} (${ev.branch})`);
    case "unit:done": {
      const badge =
        ev.status === "done"
          ? chalk.green("✓")
          : ev.status === "test-failed"
            ? chalk.red("✗ test")
            : ev.status === "error"
              ? chalk.red("✗ error")
              : chalk.gray("·");
      return `  ${badge} ${ev.key} (${ev.filesChanged} files)`;
    }
    case "unit:integrated":
      return ev.conflicts
        ? chalk.yellow(`  ⚠ ${ev.key}: ${ev.conflicts} conflict(s)`)
        : chalk.green(`  ↳ ${ev.key}: ${ev.merged ? "merged" : "clean"}`);
    default:
      return "";
  }
}

export const _internal = { decomposeGoal, gitDiffStat, DECOMPOSE_SCHEMA };
