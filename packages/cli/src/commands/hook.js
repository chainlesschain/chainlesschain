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

  // ===== V2 governance subcommands (hook-manager V2) =====
  hook
    .command("maturities-v2")
    .description("List hook profile maturity states (V2)")
    .action(async () => {
      const m = await import("../lib/hook-manager.js");
      console.log(JSON.stringify(m.HOOK_PROFILE_MATURITY_V2, null, 2));
    });
  hook
    .command("exec-lifecycle-v2")
    .description("List hook exec lifecycle states (V2)")
    .action(async () => {
      const m = await import("../lib/hook-manager.js");
      console.log(JSON.stringify(m.HOOK_EXEC_LIFECYCLE_V2, null, 2));
    });
  hook
    .command("stats-v2")
    .description("Show hook-manager V2 stats")
    .action(async () => {
      const m = await import("../lib/hook-manager.js");
      console.log(JSON.stringify(m.getHookManagerStatsV2(), null, 2));
    });
  hook
    .command("config-v2")
    .description("Show hook-manager V2 config")
    .action(async () => {
      const m = await import("../lib/hook-manager.js");
      console.log(
        JSON.stringify(
          {
            maxActiveHooksPerOwner: m.getMaxActiveHooksPerOwnerV2(),
            maxPendingExecsPerHook: m.getMaxPendingExecsPerHookV2(),
            hookIdleMs: m.getHookIdleMsV2(),
            hookExecStuckMs: m.getHookExecStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  hook
    .command("register-profile-v2 <id> <owner> [event]")
    .action(async (id, owner, event) => {
      const m = await import("../lib/hook-manager.js");
      console.log(
        JSON.stringify(m.registerHookProfileV2({ id, owner, event }), null, 2),
      );
    });
  hook.command("activate-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.activateHookProfileV2(id), null, 2));
  });
  hook.command("disable-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.disableHookProfileV2(id), null, 2));
  });
  hook.command("retire-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.retireHookProfileV2(id), null, 2));
  });
  hook.command("touch-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.touchHookProfileV2(id), null, 2));
  });
  hook.command("get-profile-v2 <id>").action(async (id) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.getHookProfileV2(id), null, 2));
  });
  hook.command("list-profiles-v2").action(async () => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.listHookProfilesV2(), null, 2));
  });
  hook.command("create-exec-v2 <id> <hookId>").action(async (id, hookId) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.createHookExecV2({ id, hookId }), null, 2));
  });
  hook.command("start-exec-v2 <id>").action(async (id) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.startHookExecV2(id), null, 2));
  });
  hook.command("complete-exec-v2 <id>").action(async (id) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.completeHookExecV2(id), null, 2));
  });
  hook.command("fail-exec-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.failHookExecV2(id, reason), null, 2));
  });
  hook.command("cancel-exec-v2 <id> [reason]").action(async (id, reason) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.cancelHookExecV2(id, reason), null, 2));
  });
  hook.command("get-exec-v2 <id>").action(async (id) => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.getHookExecV2(id), null, 2));
  });
  hook.command("list-execs-v2").action(async () => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.listHookExecsV2(), null, 2));
  });
  hook.command("auto-disable-idle-v2").action(async () => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.autoDisableIdleHooksV2(), null, 2));
  });
  hook.command("auto-fail-stuck-v2").action(async () => {
    const m = await import("../lib/hook-manager.js");
    console.log(JSON.stringify(m.autoFailStuckHookExecsV2(), null, 2));
  });
  hook.command("set-max-active-hooks-v2 <n>").action(async (n) => {
    const m = await import("../lib/hook-manager.js");
    m.setMaxActiveHooksPerOwnerV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxActiveHooksPerOwner: m.getMaxActiveHooksPerOwnerV2() },
        null,
        2,
      ),
    );
  });
  hook.command("set-max-pending-execs-v2 <n>").action(async (n) => {
    const m = await import("../lib/hook-manager.js");
    m.setMaxPendingExecsPerHookV2(parseInt(n, 10));
    console.log(
      JSON.stringify(
        { maxPendingExecsPerHook: m.getMaxPendingExecsPerHookV2() },
        null,
        2,
      ),
    );
  });
  hook.command("set-hook-idle-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/hook-manager.js");
    m.setHookIdleMsV2(parseInt(n, 10));
    console.log(JSON.stringify({ hookIdleMs: m.getHookIdleMsV2() }, null, 2));
  });
  hook.command("set-hook-exec-stuck-ms-v2 <n>").action(async (n) => {
    const m = await import("../lib/hook-manager.js");
    m.setHookExecStuckMsV2(parseInt(n, 10));
    console.log(
      JSON.stringify({ hookExecStuckMs: m.getHookExecStuckMsV2() }, null, 2),
    );
  });
  hook.command("reset-state-v2").action(async () => {
    const m = await import("../lib/hook-manager.js");
    m._resetStateHookManagerV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}

// === Iter21 V2 governance overlay ===
export function registerHookgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "hook");
  if (!parent) return;
  const L = async () => await import("../lib/hook-manager.js");
  parent
    .command("hookgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.HOOKGOV_PROFILE_MATURITY_V2,
            triggerLifecycle: m.HOOKGOV_TRIGGER_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("hookgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveHookgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingHookgovTriggersPerProfileV2(),
            idleMs: m.getHookgovProfileIdleMsV2(),
            stuckMs: m.getHookgovTriggerStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("hookgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveHookgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("hookgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingHookgovTriggersPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("hookgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setHookgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("hookgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setHookgovTriggerStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("hookgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--event <v>", "event")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerHookgovProfileV2({ id, owner, event: o.event }),
          null,
          2,
        ),
      );
    });
  parent
    .command("hookgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateHookgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("hookgov-disable-v2 <id>")
    .description("Disable profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).disableHookgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("hookgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveHookgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("hookgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchHookgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("hookgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getHookgovProfileV2(id), null, 2));
    });
  parent
    .command("hookgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listHookgovProfilesV2(), null, 2));
    });
  parent
    .command("hookgov-create-trigger-v2 <id> <profileId>")
    .description("Create trigger")
    .option("--payload <v>", "payload")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createHookgovTriggerV2({ id, profileId, payload: o.payload }),
          null,
          2,
        ),
      );
    });
  parent
    .command("hookgov-firing-trigger-v2 <id>")
    .description("Mark trigger as firing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).firingHookgovTriggerV2(id), null, 2),
      );
    });
  parent
    .command("hookgov-complete-trigger-v2 <id>")
    .description("Complete trigger")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeTriggerHookgovV2(id), null, 2),
      );
    });
  parent
    .command("hookgov-fail-trigger-v2 <id> [reason]")
    .description("Fail trigger")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failHookgovTriggerV2(id, reason), null, 2),
      );
    });
  parent
    .command("hookgov-cancel-trigger-v2 <id> [reason]")
    .description("Cancel trigger")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelHookgovTriggerV2(id, reason), null, 2),
      );
    });
  parent
    .command("hookgov-get-trigger-v2 <id>")
    .description("Get trigger")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getHookgovTriggerV2(id), null, 2));
    });
  parent
    .command("hookgov-list-triggers-v2")
    .description("List triggers")
    .action(async () => {
      console.log(JSON.stringify((await L()).listHookgovTriggersV2(), null, 2));
    });
  parent
    .command("hookgov-auto-disable-idle-v2")
    .description("Auto-disable idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDisableIdleHookgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("hookgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck triggers")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckHookgovTriggersV2(), null, 2),
      );
    });
  parent
    .command("hookgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getHookManagerGovStatsV2(), null, 2),
      );
    });
}
