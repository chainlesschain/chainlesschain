/**
 * Hook management commands
 * chainlesschain hook list|add|remove|run|stats|events
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  HookPriority,
  HookType,
  HookEvents,
  registerHook,
  unregisterHook,
  listHooks,
  executeHooks,
  getHookStats,
} from "../lib/hook-manager.js";
import {
  SESSION_HOOK_EVENTS,
  fireSessionHook,
  fireUserPromptSubmit,
  fireAssistantResponse,
} from "../lib/session-hooks.js";

export function registerHookCommand(program) {
  const hook = program.command("hook").description("Lifecycle hook management");

  // hook list
  hook
    .command("list", { isDefault: true })
    .description("List all registered hooks")
    .option("--event <name>", "Filter by event name")
    .option("--enabled", "Show only enabled hooks")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const hooks = listHooks(db, {
          event: options.event,
          enabledOnly: options.enabled,
        });

        if (options.json) {
          console.log(
            JSON.stringify(
              hooks.map((h) => ({
                id: h.id,
                event: h.event,
                name: h.name,
                type: h.type,
                priority: h.priority,
                enabled: h.enabled === 1,
                matcher: h.matcher,
                description: h.description,
              })),
              null,
              2,
            ),
          );
        } else if (hooks.length === 0) {
          logger.info(
            'No hooks registered. Add one with "chainlesschain hook add <event> <name>"',
          );
        } else {
          logger.log(chalk.bold(`Hooks (${hooks.length}):\n`));
          for (const h of hooks) {
            const status = h.enabled
              ? chalk.green("enabled")
              : chalk.gray("disabled");
            const pLabel = Object.entries(HookPriority).find(
              ([, v]) => v === h.priority,
            );
            const priorityStr = pLabel ? pLabel[0] : String(h.priority);
            logger.log(
              `  ${chalk.cyan(h.name)} [${h.event}] priority=${priorityStr} type=${h.type} [${status}]`,
            );
            if (h.description) logger.log(`    ${chalk.gray(h.description)}`);
            if (h.matcher)
              logger.log(`    matcher: ${chalk.yellow(h.matcher)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hook add
  hook
    .command("add")
    .description("Register a new hook")
    .argument("<event>", "Event name (e.g. PreIPCCall, PostToolUse)")
    .argument("<name>", "Hook name")
    .option("--type <type>", "Hook type (sync, async, command, script)", "sync")
    .option(
      "--priority <n>",
      "Priority (0=system, 100=high, 500=normal, 900=low, 1000=monitor)",
      "500",
    )
    .option(
      "--command <cmd>",
      "Shell command to execute (for command/script type)",
    )
    .option(
      "--matcher <pattern>",
      "Matcher pattern (wildcards, pipe-separated, or /regex/)",
    )
    .option("--description <desc>", "Hook description")
    .action(async (event, name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const result = registerHook(db, {
          event,
          name,
          type: options.type,
          priority: parseInt(options.priority, 10),
          handler: options.command || null,
          matcher: options.matcher || null,
          description: options.description || null,
        });

        logger.success(
          `Hook registered: ${result.name} [${result.event}] (id: ${result.id})`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hook remove
  hook
    .command("remove")
    .description("Remove a hook by ID")
    .argument("<id>", "Hook ID")
    .action(async (id) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = unregisterHook(db, id);

        if (ok) {
          logger.success(`Hook removed: ${id}`);
        } else {
          logger.error(`Hook not found: ${id}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hook run
  hook
    .command("run")
    .description("Manually trigger hooks for an event")
    .argument("<event>", "Event name to trigger")
    .option("--context <json>", "JSON context to pass to hooks", "{}")
    .action(async (event, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        let context = {};
        try {
          context = JSON.parse(options.context);
        } catch (_err) {
          logger.warn("Invalid JSON context, using empty object");
        }

        logger.info(`Triggering hooks for event: ${event}`);
        const results = await executeHooks(db, event, context);

        if (results.length === 0) {
          logger.info("No hooks matched this event");
        } else {
          for (const r of results) {
            const icon = r.success ? chalk.green("OK") : chalk.red("FAIL");
            logger.log(`  [${icon}] ${r.hookName} (${r.executionTime}ms)`);
            if (r.error) logger.log(`    ${chalk.red(r.error)}`);
            if (r.result) logger.log(`    ${chalk.gray(r.result)}`);
          }
          logger.info(`Executed ${results.length} hook(s)`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hook fire — session-aware trigger that honors rewrite/abort/suppress
  // directives (vs. `hook run` which just dumps raw results).
  hook
    .command("fire")
    .description(
      "Fire a session-level hook (SessionStart/UserPromptSubmit/AssistantResponse/SessionEnd) and honor stdout JSON directives",
    )
    .argument("<event>", `One of: ${SESSION_HOOK_EVENTS.join(", ")}`)
    .option(
      "--prompt <text>",
      "Prompt text (UserPromptSubmit only) — used as input to rewrite/abort",
    )
    .option(
      "--response <text>",
      "Response text (AssistantResponse only) — used as input to rewrite/suppress",
    )
    .option("--context <json>", "Extra JSON context", "{}")
    .option("--json", "Emit machine-readable JSON output")
    .action(async (event, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        let extra = {};
        try {
          extra = JSON.parse(options.context);
        } catch (_e) {
          logger.warn("Invalid JSON --context, using empty object");
        }

        let out;
        if (event === HookEvents.UserPromptSubmit) {
          out = await fireUserPromptSubmit(db, options.prompt || "", extra);
        } else if (event === HookEvents.AssistantResponse) {
          out = await fireAssistantResponse(db, options.response || "", extra);
        } else {
          const results = await fireSessionHook(db, event, extra);
          out = { results };
        }

        if (options.json) {
          logger.log(JSON.stringify(out, null, 2));
        } else if (event === HookEvents.UserPromptSubmit) {
          if (out.abort) {
            logger.log(chalk.yellow(`[abort] ${out.reason || "no reason"}`));
          } else {
            logger.log(chalk.cyan("prompt:"), out.prompt);
          }
          logger.log(chalk.gray(`(${out.results.length} hook(s) fired)`));
        } else if (event === HookEvents.AssistantResponse) {
          if (out.suppress) {
            logger.log(chalk.yellow(`[suppress] ${out.reason || "no reason"}`));
          } else {
            logger.log(chalk.cyan("response:"), out.response);
          }
          logger.log(chalk.gray(`(${out.results.length} hook(s) fired)`));
        } else {
          logger.log(chalk.gray(`(${out.results.length} hook(s) fired)`));
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hook stats
  hook
    .command("stats")
    .description("Show hook execution statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const stats = getHookStats(db);

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else if (stats.length === 0) {
          logger.info("No hooks registered");
        } else {
          logger.log(chalk.bold("Hook Statistics:\n"));
          for (const s of stats) {
            logger.log(`  ${chalk.cyan(s.name)} [${s.event}]`);
            logger.log(
              `    executions: ${s.executionCount}  errors: ${s.errorCount}  avg: ${s.avgExecutionTime}ms`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hook events
  hook
    .command("events")
    .description("List all valid hook event types")
    .action(() => {
      const events = Object.values(HookEvents);
      logger.log(chalk.bold(`Hook Events (${events.length}):\n`));
      for (const ev of events) {
        logger.log(`  ${chalk.cyan(ev)}`);
      }
    });
}
