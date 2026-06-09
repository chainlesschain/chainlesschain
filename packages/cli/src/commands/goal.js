/**
 * cc goal — cross-session persistent goals / OKRs.
 *
 *   cc goal set <objective> [--title <t>] [--kr <text>...]   create a goal
 *   cc goal list [--status active] [--json]                  list goals
 *   cc goal show <id> [--json]                               show one goal
 *   cc goal kr add <id> <text> [--target <n>]                add a key result
 *   cc goal kr set <id> <krId> [--current <n>] [--done]      update a key result
 *   cc goal progress <id> [--pct <n>] [--note <text>]        record progress
 *   cc goal link <id> [sessionId]  /  unlink <id> [sessionId]
 *   cc goal pause|resume|close|abandon|rm <id>               lifecycle
 *   cc goal active [--session <id>] [--json]                 the bound goal
 *
 * A goal is a long-lived objective the agent advances toward across sessions —
 * distinct from `cc session` (short context), `cc memory` (facts),
 * `cc planmode` (one run's plan) and `cc workflow` (execution state). When a
 * goal is active it is injected into the agent loop each turn (goal-context.js).
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

const STATUS_COLOR = {
  active: chalk.green,
  paused: chalk.yellow,
  done: chalk.cyan,
  abandoned: chalk.gray,
};

function fmtStatus(s) {
  return (STATUS_COLOR[s] || chalk.white)(s);
}

function printGoal(g, { verbose } = {}) {
  logger.log(
    `${chalk.bold(g.id)}  ${fmtStatus(g.status)}  ${chalk.gray(`${g.progress}%`)}`,
  );
  logger.log(`  ${g.objective}`);
  if (g.title && g.title !== g.objective) {
    logger.log(chalk.gray(`  title: ${g.title}`));
  }
  const open = (g.keyResults || []).filter((k) => !k.done).length;
  const total = (g.keyResults || []).length;
  if (total > 0) {
    logger.log(chalk.gray(`  key results: ${total - open}/${total} done`));
    if (verbose) {
      for (const kr of g.keyResults) {
        const mark = kr.done ? chalk.green("✓") : chalk.gray("○");
        const target = kr.target != null ? ` [${kr.current}/${kr.target}]` : "";
        logger.log(`    ${mark} ${chalk.dim(kr.id)}  ${kr.text}${target}`);
      }
    }
  }
  if (verbose) {
    if (g.linkedSessions?.length) {
      logger.log(chalk.gray(`  sessions: ${g.linkedSessions.join(", ")}`));
    }
    if (g.notes?.length) {
      logger.log(chalk.gray(`  notes:`));
      for (const n of g.notes.slice(-5)) {
        logger.log(
          chalk.gray(`    [${n.at.slice(0, 16)}] (${n.by}) ${n.text}`),
        );
      }
    }
    logger.log(
      chalk.gray(`  created: ${g.createdAt}  updated: ${g.updatedAt}`),
    );
  }
}

function fail(action, err) {
  logger.error(chalk.red(`goal ${action} failed: ${err.message}`));
  process.exitCode = 1;
}

export function registerGoalCommand(program) {
  const goal = program
    .command("goal")
    .description("Cross-session persistent goals / OKRs");

  // ── set (create) ──────────────────────────────────────────────────────
  goal
    .command("set <objective>")
    .alias("add")
    .description("Create a goal with an objective (and optional key results)")
    .option("--title <title>", "Short title (defaults to the objective)")
    .option(
      "--kr <text>",
      "Key result (repeatable)",
      (v, acc) => (acc.push(v), acc),
      [],
    )
    .option("--json", "Output as JSON")
    .action(async (objective, options) => {
      try {
        const { createGoal } = await import("../lib/goal-store.js");
        const g = createGoal({
          objective,
          title: options.title,
          keyResults: options.kr || [],
        });
        if (options.json) {
          console.log(JSON.stringify(g, null, 2));
          return;
        }
        logger.log(chalk.green(`✓ goal ${chalk.bold(g.id)} created`));
        printGoal(g, { verbose: true });
        logger.log(
          chalk.gray(
            `  bind to a run with: cc agent --goal ${g.id}   (or it auto-binds when it is the only active goal)`,
          ),
        );
      } catch (err) {
        fail("set", err);
      }
    });

  // ── list ──────────────────────────────────────────────────────────────
  goal
    .command("list")
    .alias("ls")
    .description("List goals (newest first)")
    .option("--status <status>", "Filter: active|paused|done|abandoned")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { listGoals } = await import("../lib/goal-store.js");
        const all = listGoals({ status: options.status });
        if (options.json) {
          console.log(JSON.stringify(all, null, 2));
          return;
        }
        if (all.length === 0) {
          logger.log(
            chalk.gray("No goals. Create one: cc goal set <objective>"),
          );
          return;
        }
        for (const g of all) {
          const open = (g.keyResults || []).filter((k) => !k.done).length;
          const total = (g.keyResults || []).length;
          const krInfo = total
            ? chalk.gray(`  ${total - open}/${total} KR`)
            : "";
          // Soft drift hint: active goal with no progress recorded in 14+ days.
          const stale = isStale(g);
          logger.log(
            `${chalk.cyan(g.id.padEnd(24))} ${fmtStatus(g.status).padEnd(18)} ${chalk.gray(`${String(g.progress).padStart(3)}%`)}${krInfo}` +
              (stale ? chalk.yellow("  ⚠ stale") : "") +
              `\n  ${chalk.gray(truncate(g.objective, 80))}`,
          );
        }
      } catch (err) {
        fail("list", err);
      }
    });

  // ── show ──────────────────────────────────────────────────────────────
  goal
    .command("show <id>")
    .description("Show a goal in full")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { getGoal } = await import("../lib/goal-store.js");
        const g = getGoal(id);
        if (!g) {
          logger.error(chalk.red(`no such goal: ${id}`));
          process.exitCode = 1;
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(g, null, 2));
          return;
        }
        printGoal(g, { verbose: true });
      } catch (err) {
        fail("show", err);
      }
    });

  // ── kr (key results) ──────────────────────────────────────────────────
  const kr = goal.command("kr").description("Manage key results");

  kr.command("add <id> <text>")
    .description("Add a key result to a goal")
    .option("--target <n>", "Numeric target for this key result")
    .option("--json", "Output as JSON")
    .action(async (id, text, options) => {
      try {
        const { addKeyResult } = await import("../lib/goal-store.js");
        const g = addKeyResult(id, text, {
          target: options.target != null ? Number(options.target) : null,
        });
        if (options.json) return void console.log(JSON.stringify(g, null, 2));
        logger.log(chalk.green(`✓ key result added to ${id}`));
        printGoal(g, { verbose: true });
      } catch (err) {
        fail("kr add", err);
      }
    });

  kr.command("set <id> <krId>")
    .description("Update a key result's current value and/or mark it done")
    .option("--current <n>", "Set the current value")
    .option("--done", "Mark this key result done")
    .option("--json", "Output as JSON")
    .action(async (id, krId, options) => {
      try {
        const { setKeyResult } = await import("../lib/goal-store.js");
        const g = setKeyResult(id, krId, {
          current: options.current != null ? Number(options.current) : null,
          done: options.done ? true : null,
        });
        if (options.json) return void console.log(JSON.stringify(g, null, 2));
        logger.log(chalk.green(`✓ key result ${krId} updated`));
        printGoal(g, { verbose: true });
      } catch (err) {
        fail("kr set", err);
      }
    });

  // ── progress ──────────────────────────────────────────────────────────
  goal
    .command("progress <id>")
    .description("Record progress: set a percentage and/or append a note")
    .option("--pct <n>", "Progress percentage (0–100)")
    .option("--note <text>", "Progress note")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { recordProgress } = await import("../lib/goal-store.js");
        if (options.pct == null && !options.note) {
          logger.error(
            chalk.red(
              "nothing to record — pass --pct <n> and/or --note <text>",
            ),
          );
          process.exitCode = 1;
          return;
        }
        const g = recordProgress(id, {
          pct: options.pct,
          note: options.note,
          by: "user",
        });
        if (options.json) return void console.log(JSON.stringify(g, null, 2));
        logger.log(
          chalk.green(`✓ progress recorded for ${id} (${g.progress}%)`),
        );
      } catch (err) {
        fail("progress", err);
      }
    });

  // ── link / unlink ─────────────────────────────────────────────────────
  goal
    .command("link <id> [sessionId]")
    .description("Attach a session to a goal (defaults to the latest session)")
    .option("--json", "Output as JSON")
    .action(async (id, sessionId, options) => {
      try {
        const { linkSession } = await import("../lib/goal-store.js");
        const sid = sessionId || (await latestSessionId());
        if (!sid) {
          logger.error(
            chalk.red("no session id given and none could be inferred"),
          );
          process.exitCode = 1;
          return;
        }
        const g = linkSession(id, sid);
        if (options.json) return void console.log(JSON.stringify(g, null, 2));
        logger.log(chalk.green(`✓ linked session ${sid} to ${id}`));
      } catch (err) {
        fail("link", err);
      }
    });

  goal
    .command("unlink <id> [sessionId]")
    .description("Detach a session from a goal")
    .option("--json", "Output as JSON")
    .action(async (id, sessionId, options) => {
      try {
        const { unlinkSession } = await import("../lib/goal-store.js");
        const sid = sessionId || (await latestSessionId());
        const g = unlinkSession(id, sid);
        if (options.json) return void console.log(JSON.stringify(g, null, 2));
        logger.log(chalk.green(`✓ unlinked session ${sid} from ${id}`));
      } catch (err) {
        fail("unlink", err);
      }
    });

  // ── lifecycle ─────────────────────────────────────────────────────────
  const lifecycle = [
    ["pause", "paused", "paused"],
    ["resume", "active", "resumed"],
    ["close", "done", "closed (done)"],
    ["abandon", "abandoned", "abandoned"],
  ];
  for (const [cmd, status, verb] of lifecycle) {
    goal
      .command(`${cmd} <id>`)
      .description(`Mark a goal ${verb}`)
      .option("--json", "Output as JSON")
      .action(async (id, options) => {
        try {
          const { setStatus } = await import("../lib/goal-store.js");
          const g = setStatus(id, status);
          if (options.json) return void console.log(JSON.stringify(g, null, 2));
          logger.log(chalk.green(`✓ goal ${id} ${verb}`));
        } catch (err) {
          fail(cmd, err);
        }
      });
  }

  goal
    .command("rm <id>")
    .alias("delete")
    .description("Delete a goal")
    .option("--force", "Skip confirmation")
    .action(async (id, options) => {
      try {
        const { deleteGoal } = await import("../lib/goal-store.js");
        if (!options.force && process.stdin.isTTY) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete goal ${id}?`,
            default: false,
          }).catch(() => false);
          if (!ok) {
            logger.log(chalk.gray("Aborted."));
            return;
          }
        }
        const existed = deleteGoal(id);
        if (!existed) {
          logger.error(chalk.red(`no such goal: ${id}`));
          process.exitCode = 1;
          return;
        }
        logger.log(chalk.green(`✓ deleted ${id}`));
      } catch (err) {
        fail("rm", err);
      }
    });

  // ── active (what's bound to a run) ────────────────────────────────────
  goal
    .command("active")
    .description("Show the goal that would bind to a run (resolution order)")
    .option("--session <id>", "Resolve as if this session were running")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { resolveActiveGoal } = await import("../lib/goal-store.js");
        const g = resolveActiveGoal({ sessionId: options.session });
        if (options.json) {
          console.log(JSON.stringify(g || null, null, 2));
          return;
        }
        if (!g) {
          logger.log(
            chalk.gray(
              "No goal would auto-bind (0 active goals, or several active and none linked — pass --goal <id> explicitly).",
            ),
          );
          return;
        }
        logger.log(chalk.bold("Bound goal:"));
        printGoal(g, { verbose: true });
      } catch (err) {
        fail("active", err);
      }
    });
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Active goal with no progress recorded in 14+ days = soft drift hint. */
function isStale(g) {
  if (g.status !== "active") return false;
  const last = g.drift?.lastProgressAt || g.createdAt;
  if (!last) return false;
  const ageMs = Date.now() - new Date(last).getTime();
  return ageMs > 14 * 24 * 60 * 60 * 1000;
}

/** Best-effort: the most recent session id, for `link` without an explicit id. */
async function latestSessionId() {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { sessionPath } = await import("../harness/jsonl-session-store.js");
    // sessionPath("x") → <home>/sessions/x.jsonl — derive the dir from it.
    const dir = path.dirname(sessionPath("x"));
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        id: f.slice(0, -6),
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.id || null;
  } catch {
    return null;
  }
}
