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
import { stripVTControlCharacters } from "node:util";
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

  goal
    .command("catalog")
    .description(
      "Read a bounded page of standalone goal metadata for selection",
    )
    .option(
      "--after <cursor>",
      "Continue from the previous page in the same store",
    )
    .option("--limit <n>", "Candidates per page (1–20)", "20")
    .option(
      "--connection <file>",
      "Read the single goal in a temporary desktop connection",
    )
    .option("--json", "Output the metadata page as JSON")
    .action(async (options) => {
      try {
        const { readCliGoalCatalog } = await import(
          "../lib/cli-goal-catalog.js"
        );
        const readCatalog =
          options.connection !== undefined
            ? (await import("../lib/project-goal-connection.js"))
                .readProjectGoalCatalog
            : readCliGoalCatalog;
        const result = await readCatalog({
          connection: options.connection,
          after: options.after,
          limit: Number(options.limit),
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        for (const entry of result.entries)
          logger.log(
            stripVTControlCharacters(
              `${entry.id}  ${entry.status}  ${entry.title}`,
            ),
          );
        logger.log(
          `Scanned ${result.scannedCount}; skipped ${result.skippedCount} invalid sources; ${result.invalidNameCount} invalid names in directory.`,
        );
        if (result.nextCursor)
          logger.log(`Next page: cc goal catalog --after ${result.nextCursor}`);
      } catch (err) {
        fail("catalog", err);
      }
    });

  goal
    .command("panels <id>")
    .description("Read authorized extension panels for a standalone CLI goal")
    .option("--plugin <name>", "Select one installed plugin")
    .option(
      "--connection <file>",
      "Read through a temporary, explicitly authorized desktop connection",
    )
    .option(
      "--expected-store <storeId>",
      "Require the store selected from goal catalog",
    )
    .option(
      "--scope <scope>",
      "Select its user, project or local install scope",
    )
    .option("--json", "Output the read-only panel snapshot as JSON")
    .action(async (id, options) => {
      try {
        const { readCliGoalExtensionPanels } = await import(
          "../lib/plugin-runtime/cli-goal-extension-host.js"
        );
        const result = await readCliGoalExtensionPanels(id, {
          plugin: options.plugin,
          scope: options.scope,
          expectedStore: options.expectedStore,
          connection: options.connection,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        logger.log(
          `Goal panel snapshot: ${result.goalRef.id} (revision ${result.goalRef.revision})`,
        );
        for (const panel of result.panels) {
          logger.log(
            stripVTControlCharacters(
              `\n${panel.plugin.name} [${panel.plugin.scope}]\n${panel.text}`,
            ),
          );
        }
        if (!result.panels.length)
          logger.log("No authorized goal panels are available.");
        for (const entry of result.dropped)
          logger.log(
            stripVTControlCharacters(
              `  ${entry.name || "plugins"}: ${entry.reason}`,
            ),
          );
      } catch (err) {
        fail("panels", err);
      }
    });

  goal
    .command("draft-request <id>")
    .description(
      "Export an untrusted description request for explicit desktop adoption",
    )
    .requiredOption(
      "--connection <file>",
      "Read one explicitly connected desktop goal",
    )
    .requiredOption("--plugin <name>", "Select the installed proposal plugin")
    .requiredOption(
      "--scope <scope>",
      "Select its user, project or local scope",
    )
    .requiredOption(
      "--source <proposalId>",
      "Exact native risk proposal ID copied from the desktop",
    )
    .requiredOption(
      "--request-id <id>",
      "Stable request identity; reuse the same file for retry",
    )
    .requiredOption("--title <text>", "Request title")
    .requiredOption(
      "--description-file <file>",
      "UTF-8 proposed description, at most 8192 bytes",
    )
    .requiredOption(
      "--out <file>",
      "New request file; never overwrites an existing file",
    )
    .option(
      "--expected-store <storeId>",
      "Require the selected project goal store",
    )
    .option("--json", "Output the export result; no native draft is created")
    .action(async (id, options) => {
      try {
        const { exportCliGoalDraftRequest } = await import(
          "../lib/plugin-runtime/cli-goal-draft-request.js"
        );
        const result = await exportCliGoalDraftRequest(id, options);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else
          logger.log(
            stripVTControlCharacters(
              `Request exported: ${result.file}\nNo native draft has been saved. Import this file in the desktop and review the full text. Request: ${result.requestId}`,
            ),
          );
      } catch (error) {
        fail("draft-request", error);
      }
    });

  goal
    .command("draft-access")
    .description(
      "Export a plugin label for separate native pending-draft authorization",
    )
    .requiredOption(
      "--plugin <name>",
      "Select an installed, trusted proposal plugin",
    )
    .requiredOption(
      "--scope <scope>",
      "Its user, project or local installation scope",
    )
    .requiredOption(
      "--out <file>",
      "New access request file; contains no native authority",
    )
    .option("--json", "Output the access export result as JSON")
    .action(async (options) => {
      const captured = {
        ...options,
        cwd: process.cwd(),
        env: { ...process.env },
      };
      try {
        const { exportCliGoalDraftAccess } = await import(
          "../lib/plugin-runtime/cli-goal-drafts.js"
        );
        const result = await exportCliGoalDraftAccess(captured);
        if (captured.json) console.log(JSON.stringify(result, null, 2));
        else
          logger.log(
            stripVTControlCharacters(
              `Access request exported: ${result.file}\nOpen it in the desktop for separate native authorization; this file grants no permission.`,
            ),
          );
      } catch (error) {
        fail("draft-access", error);
      }
    });

  for (const [name, description] of [
    [
      "draft-sources",
      "Read current source IDs under a v3 pending-draft connection",
    ],
    [
      "draft-send",
      "Save one pending suggestion with a durable submission reference",
    ],
    ["draft-receipt", "Reconcile a recorded submission without resending it"],
  ]) {
    const command = goal
      .command(`${name} <id>`)
      .description(description)
      .requiredOption(
        "--connection <file>",
        "Separately authorized v3 desktop pending-draft connection",
      )
      .requiredOption(
        "--plugin <name>",
        "Select the exact installed proposal plugin",
      )
      .requiredOption(
        "--scope <scope>",
        "Its user, project or local installation scope",
      )
      .option(
        "--expected-store <storeId>",
        "Require the selected project goal store",
      )
      .option("--json", "Output the bounded result as JSON");
    if (name === "draft-sources")
      command.option(
        "--after <cursor>",
        "Continue after a returned source cursor",
      );
    else
      command.requiredOption(
        "--record <file>",
        "Durable no-credential submission reference; an existing reference is only queried",
      );
    if (name === "draft-send")
      command
        .requiredOption(
          "--source <proposalId>",
          "Exact source ID returned by draft-sources",
        )
        .requiredOption(
          "--request-id <id>",
          "Stable request identity; preserve it when querying an unknown result",
        )
        .requiredOption("--title <text>", "Pending suggestion title")
        .requiredOption(
          "--description-file <file>",
          "UTF-8 proposed description, at most 8192 bytes",
        );
    command.action(async (id, options) => {
      const captured = {
        ...options,
        cwd: process.cwd(),
        env: { ...process.env },
      };
      try {
        const host = await import("../lib/plugin-runtime/cli-goal-drafts.js");
        const run =
          name === "draft-sources"
            ? host.readCliGoalDraftSources
            : name === "draft-send"
              ? host.sendCliGoalDraft
              : host.readCliGoalDraftReceipt;
        const result = await run(id, captured);
        if (captured.json) console.log(JSON.stringify(result, null, 2));
        else if (name === "draft-sources") {
          for (const source of result.sources.entries)
            logger.log(
              stripVTControlCharacters(
                `${source.id}  task ${source.sourceTaskId}  review ${source.reviewId}`,
              ),
            );
          logger.log(
            `Scanned ${result.sources.scannedCount}; unavailable ${result.sources.unavailableCount}.`,
          );
          if (result.sources.nextCursor)
            logger.log(`Next cursor: ${result.sources.nextCursor}`);
        } else
          logger.log(
            stripVTControlCharacters(
              result.state === "saved"
                ? `Pending suggestion saved: ${result.proposalId}\nTask modification still requires native preview and confirmation. Reference: ${result.record}`
                : `${result.state === "unknown" ? "Submission result unknown" : "No matching submission existed at query time"}. No automatic resend was performed.\nQuery the same reference with draft-receipt: ${result.record}`,
            ),
          );
      } catch (error) {
        fail(name, error);
      }
    });
  }

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
