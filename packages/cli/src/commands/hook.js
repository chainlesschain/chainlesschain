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
    .description("List registered hooks (DB) + .claude/settings.json hooks")
    .option("--event <name>", "Filter by event name")
    .option("--enabled", "Show only enabled hooks")
    .option("--settings <file>", "Also merge an explicit settings file")
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

        // .claude/settings.json `hooks` block (Claude-Code parity, decision-
        // capable; distinct from the DB registry above which is observe-only).
        const { loadHooks } = await import("../lib/settings-hooks.cjs");
        const { hooks: settingsHooks, files: settingsFiles } = loadHooks({
          cwd: process.cwd(),
          settingsFile: options.settings,
        });

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                hooks: hooks.map((h) => ({
                  id: h.id,
                  event: h.event,
                  name: h.name,
                  type: h.type,
                  priority: h.priority,
                  enabled: h.enabled === 1,
                  matcher: h.matcher,
                  description: h.description,
                })),
                settingsHooks,
                settingsFiles,
              },
              null,
              2,
            ),
          );
        } else {
          if (hooks.length === 0) {
            logger.info(
              'No DB hooks. Add one with "chainlesschain hook add <event> <name>"',
            );
          } else {
            logger.log(chalk.bold(`DB hooks (${hooks.length}):\n`));
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
          const events = Object.keys(settingsHooks);
          if (events.length > 0) {
            const n = events.reduce((a, e) => a + settingsHooks[e].length, 0);
            logger.log(chalk.bold(`\n.claude/settings.json hooks (${n}):`));
            for (const ev of events) {
              if (options.event && ev !== options.event) continue;
              for (const g of settingsHooks[ev]) {
                for (const h of g.hooks) {
                  logger.log(
                    `  ${chalk.cyan(ev)} matcher=${chalk.yellow(g.matcher || "*")}  ${chalk.gray(h.command)}`,
                  );
                }
              }
            }
            logger.log(chalk.dim(`  sources: ${settingsFiles.join(", ")}`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hook test — dry-run .claude/settings.json hooks for an event + tool
  hook
    .command("test <event> <tool> [args...]")
    .description(
      'Show which settings.json hooks fire for an event+tool (e.g. hook test PreToolUse run_shell "git push"); --run executes them',
    )
    .option("--settings <file>", "Also merge an explicit settings file")
    .option("--run", "Actually execute the matched hooks and show decisions")
    .option("--json", "Output as JSON")
    .action(async (event, tool, args, options) => {
      try {
        const { loadHooks, collectHooks } =
          await import("../lib/settings-hooks.cjs");
        const { hooks } = loadHooks({
          cwd: process.cwd(),
          settingsFile: options.settings,
        });
        const matched = collectHooks(hooks, event, tool);
        const toolInput =
          args && args.length ? { command: args.join(" "), args } : {};
        const payload = {
          hook_event_name: event,
          tool_name: tool,
          tool_input: toolInput,
          cwd: process.cwd(),
          session_id: "test",
        };

        if (!options.run) {
          if (options.json) {
            console.log(
              JSON.stringify({ event, tool, matched, payload }, null, 2),
            );
          } else if (matched.length === 0) {
            logger.log(
              chalk.gray(`no settings.json hooks match ${event} / ${tool}`),
            );
          } else {
            logger.log(
              chalk.bold(
                `${matched.length} hook(s) would fire for ${event} / ${tool}:`,
              ),
            );
            for (const h of matched) logger.log(`  ${chalk.gray(h.command)}`);
            logger.log(chalk.dim("  (use --run to execute and see decisions)"));
          }
          return;
        }

        const { runHooks } = await import("../lib/hook-runner.js");
        const outcome = runHooks(matched, payload, {
          cwd: process.cwd(),
          event,
        });
        if (options.json) {
          console.log(JSON.stringify(outcome, null, 2));
          return;
        }
        const color =
          outcome.decision === "block"
            ? chalk.red
            : outcome.decision === "ask"
              ? chalk.yellow
              : chalk.green;
        logger.log(`decision: ${color.bold(outcome.decision)}`);
        if (outcome.reason) logger.log(`reason:   ${outcome.reason}`);
        if (outcome.hook) logger.log(`from:     ${chalk.gray(outcome.hook)}`);
        for (const r of outcome.results) {
          logger.log(
            `  ${chalk.gray(r.command)} → ${r.decision}` +
              (r.exitCode != null ? ` (exit ${r.exitCode})` : ""),
          );
        }
      } catch (err) {
        logger.error(`hook test failed: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // hook replay — replay a recorded hook delivery by event id (P2 event bus).
  // Dry-run by default; --run executes observe-only hooks. A DECISION hook can
  // re-gate control flow, so its replay is refused without an explicit sandbox
  // (and, since a real sandbox executor is not yet available, is never executed
  // — only its dry-run plan is shown).
  hook
    .command("replay <event-id>")
    .description(
      "Replay a recorded hook delivery (needs CC_HOOK_EVENT_LOG); dry-run by default, --run executes observe-only hooks",
    )
    .option("--run", "Execute the replayed hooks (observe-only events only)")
    .option(
      "--sandbox",
      "Assert an explicit sandbox for a decision-hook replay",
    )
    .option("--file <path>", "Read from a specific hook event log file")
    .option("--json", "Output as JSON")
    .action(async (eventId, options) => {
      try {
        const { findHookEvent } = await import("../lib/hook-event-log.cjs");
        const { planHookReplay } = await import("../lib/hook-event-bus.cjs");
        const envelope = findHookEvent(eventId, { filePath: options.file });
        if (!envelope) {
          logger.error(
            `hook event "${eventId}" not found` +
              (options.file
                ? ""
                : " (enable recording with CC_HOOK_EVENT_LOG=1)"),
          );
          process.exitCode = 1;
          return;
        }
        const plan = planHookReplay(envelope, {
          sandbox: Boolean(options.sandbox),
        });
        if (!plan.ok) {
          if (options.json) {
            console.log(JSON.stringify(plan, null, 2));
          } else {
            logger.error(`cannot replay: ${plan.reason}`);
          }
          process.exitCode = 1;
          return;
        }
        // Decision events re-gate flow; a real sandbox executor is still owed,
        // so we never EXECUTE them — the dry-run plan is shown instead.
        if (options.run && plan.requiresSandbox) {
          const note =
            "decision-hook execution needs a real sandbox executor (not yet available); showing dry-run plan";
          if (options.json) {
            console.log(
              JSON.stringify({ ...plan, executed: false, note }, null, 2),
            );
          } else {
            logger.warn(`${note}:`);
            logger.log(JSON.stringify(plan.payload, null, 2));
          }
          return;
        }
        if (!options.run) {
          if (options.json) {
            console.log(JSON.stringify({ ...plan, executed: false }, null, 2));
          } else {
            logger.log(
              chalk.bold(
                `replay (dry-run) of ${plan.event_type} [${plan.event_id}]`,
              ),
            );
            if (plan.requiresSandbox)
              logger.log(chalk.dim("  (decision event — sandboxed)"));
            logger.log(JSON.stringify(plan.payload, null, 2));
            logger.log(
              chalk.dim("  (use --run to execute observe-only hooks)"),
            );
          }
          return;
        }
        // observe-only + --run: re-collect and execute the matching hooks.
        const { loadHooks, collectHooks } =
          await import("../lib/settings-hooks.cjs");
        const { runHooks } = await import("../lib/hook-runner.js");
        const { hooks } = loadHooks({ cwd: process.cwd() });
        const matched = collectHooks(
          hooks,
          plan.event_type,
          plan.payload.tool_name || "",
        );
        const outcome = runHooks(matched, plan.payload, {
          cwd: process.cwd(),
          event: plan.event_type,
        });
        if (options.json) {
          console.log(
            JSON.stringify({ ...plan, executed: true, outcome }, null, 2),
          );
        } else {
          logger.log(
            chalk.bold(
              `replayed ${plan.event_type} [${plan.event_id}] → ${outcome.results.length} hook(s)`,
            ),
          );
          for (const r of outcome.results) {
            logger.log(
              `  ${chalk.gray(r.command)} → ${r.decision}` +
                (r.exitCode != null ? ` (exit ${r.exitCode})` : ""),
            );
          }
        }
      } catch (err) {
        logger.error(`hook replay failed: ${err.message}`);
        process.exitCode = 1;
      }
    });

  // hook events-log — list / verify the recorded hook delivery log.
  hook
    .command("events-log")
    .description(
      "List or verify the recorded hook delivery log (CC_HOOK_EVENT_LOG)",
    )
    .option("--limit <n>", "Max entries to show", "20")
    .option("--verify", "Verify the hash chain instead of listing")
    .option("--file <path>", "Read from a specific hook event log file")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const { listHookEvents, verifyHookEventChain, hookEventLogPath } =
          await import("../lib/hook-event-log.cjs");
        if (options.verify) {
          const result = verifyHookEventChain({ filePath: options.file });
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else if (result.ok) {
            logger.success(
              `hook event log chain OK (${result.length} record(s))`,
            );
          } else {
            logger.error(
              `hook event log chain BROKEN at #${result.brokenAt}: ${result.reason}`,
            );
            process.exitCode = 1;
          }
          return;
        }
        const events = listHookEvents({
          limit: parseInt(options.limit, 10) || 20,
          filePath: options.file,
        });
        const logPath = options.file || hookEventLogPath();
        if (options.json) {
          console.log(JSON.stringify({ events, path: logPath }, null, 2));
          return;
        }
        if (events.length === 0) {
          logger.info(
            `No recorded hook events (enable with CC_HOOK_EVENT_LOG=1). Log: ${logPath}`,
          );
          return;
        }
        logger.log(chalk.bold(`Recorded hook events (${events.length}):\n`));
        for (const e of events) {
          logger.log(
            `  ${chalk.cyan(e.event_id)} ${chalk.yellow(e.event_type)}` +
              (e.session_id ? ` session=${e.session_id}` : ""),
          );
        }
      } catch (err) {
        logger.error(`hook events-log failed: ${err.message}`);
        process.exitCode = 1;
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
