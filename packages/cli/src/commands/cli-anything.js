/**
 * CLI-Anything commands — discover & register CLI-Anything generated tools
 * chainlesschain cli-anything doctor|scan|register|list|remove
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureCliAnythingTables,
  detectPython,
  detectCliAnything,
  scanPathForTools,
  parseToolHelp,
  registerTool,
  removeTool,
  listTools,
} from "../lib/cli-anything-bridge.js";

export function registerCliAnythingCommand(program) {
  const cliAny = program
    .command("cli-anything")
    .description(
      "CLI-Anything — discover and register Agent-native CLI tools as skills",
    );

  /* ---- doctor ---- */
  cliAny
    .command("doctor")
    .description("Check Python & CLI-Anything environment")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const py = detectPython();
      const clia = py.found ? detectCliAnything() : { installed: false };
      const tools = scanPathForTools();

      const report = {
        python: py,
        cliAnything: clia,
        toolsOnPath: tools.length,
      };

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      logger.log("");
      logger.log(chalk.bold("  CLI-Anything Environment"));
      logger.log("");

      // Python
      if (py.found) {
        logger.log(
          `  ${chalk.green("✓")} Python ${chalk.cyan(py.version)} (${py.command})`,
        );
      } else {
        logger.log(`  ${chalk.red("✗")} Python not found`);
      }

      // CLI-Anything
      if (clia.installed) {
        logger.log(
          `  ${chalk.green("✓")} CLI-Anything ${chalk.cyan(clia.version)}`,
        );
      } else {
        logger.log(`  ${chalk.red("✗")} CLI-Anything not installed`);
        if (py.found) {
          logger.log(
            `    ${chalk.gray(`Install: ${py.command} -m pip install cli-anything`)}`,
          );
        }
      }

      // Tools
      logger.log(
        `  ${tools.length > 0 ? chalk.green("✓") : chalk.yellow("○")} ${tools.length} tool(s) on PATH`,
      );
      for (const t of tools) {
        logger.log(
          `    ${chalk.gray(`cli-anything-${t.name}`)} → ${chalk.gray(t.path)}`,
        );
      }
      logger.log("");
    });

  /* ---- scan ---- */
  cliAny
    .command("scan")
    .description("Scan PATH for cli-anything-* tools")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const tools = scanPathForTools();

      if (opts.json) {
        console.log(JSON.stringify(tools, null, 2));
        return;
      }

      if (tools.length === 0) {
        logger.info("No cli-anything-* tools found on PATH.");
        logger.log(
          chalk.gray(
            "  Use CLI-Anything to generate tools first: /cli-anything <software>",
          ),
        );
        return;
      }

      logger.log("");
      logger.log(chalk.bold(`  Found ${tools.length} tool(s):`));
      logger.log("");
      for (const t of tools) {
        const help = parseToolHelp(t.command);
        logger.log(`  ${chalk.cyan(t.name)}`);
        logger.log(`    Command: ${chalk.gray(t.command)}`);
        logger.log(`    Path:    ${chalk.gray(t.path)}`);
        if (help.description) {
          logger.log(`    Desc:    ${chalk.gray(help.description)}`);
        }
        if (help.subcommands.length > 0) {
          logger.log(
            `    Subs:    ${chalk.gray(help.subcommands.map((s) => s.name).join(", "))}`,
          );
        }
      }
      logger.log("");
    });

  /* ---- register ---- */
  cliAny
    .command("register <name>")
    .description("Register a cli-anything-* tool as a ChainlessChain skill")
    .option("--force", "Overwrite existing registration")
    .option("--json", "Output as JSON")
    .action(async (name, opts) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error(
            "Database not available. Run `chainlesschain setup` first.",
          );
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureCliAnythingTables(db);

        const command = `cli-anything-${name}`;
        const helpData = parseToolHelp(command);

        const result = registerTool(db, name, {
          command,
          helpData,
          force: opts.force,
        });

        await shutdown();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        logger.success(
          `Registered ${chalk.cyan(name)} as skill ${chalk.bold(result.skillName)}`,
        );
        logger.log(`  Skill dir: ${chalk.gray(result.dir)}`);
        if (result.subcommands.length > 0) {
          logger.log(
            `  Subcommands: ${chalk.gray(result.subcommands.map((s) => s.name).join(", "))}`,
          );
        }
        logger.log(
          chalk.gray(
            `  Use in Agent: /skill ${result.skillName} <subcommand> [args]`,
          ),
        );
      } catch (err) {
        logger.error(`Register failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ---- list (default) ---- */
  cliAny
    .command("list", { isDefault: true })
    .description("List registered CLI-Anything tools")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available.");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureCliAnythingTables(db);

        const tools = listTools(db);
        await shutdown();

        if (opts.json) {
          console.log(JSON.stringify(tools, null, 2));
          return;
        }

        if (tools.length === 0) {
          logger.info("No CLI-Anything tools registered.");
          logger.log(
            chalk.gray(
              "  Run `chainlesschain cli-anything scan` to discover tools.",
            ),
          );
          return;
        }

        logger.log("");
        logger.log(chalk.bold(`  ${tools.length} registered tool(s):`));
        logger.log("");
        for (const t of tools) {
          const statusColor =
            t.status === "registered" ? chalk.green : chalk.yellow;
          logger.log(
            `  ${chalk.cyan(t.name)} ${statusColor(`[${t.status}]`)} → ${chalk.gray(t.skill_name)}`,
          );
          if (t.description) {
            logger.log(`    ${chalk.gray(t.description)}`);
          }
        }
        logger.log("");
      } catch (err) {
        logger.error(`List failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ---- remove ---- */
  cliAny
    .command("remove <name>")
    .description("Remove a registered CLI-Anything tool")
    .option("--json", "Output as JSON")
    .action(async (name, opts) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available.");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureCliAnythingTables(db);

        const result = removeTool(db, name);
        await shutdown();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        logger.success(`Removed tool ${chalk.cyan(name)}`);
      } catch (err) {
        logger.error(`Remove failed: ${err.message}`);
        process.exit(1);
      }
    });
}

// === Iter25 V2 governance overlay ===
export function registerClibgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "cli-anything");
  if (!parent) return;
  const L = async () => await import("../lib/cli-anything-bridge.js");
  parent
    .command("clibgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.CLIBGOV_PROFILE_MATURITY_V2,
            bridgeLifecycle: m.CLIBGOV_BRIDGE_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("clibgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveClibgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingClibgovBridgesPerProfileV2(),
            idleMs: m.getClibgovProfileIdleMsV2(),
            stuckMs: m.getClibgovBridgeStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("clibgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveClibgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("clibgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingClibgovBridgesPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("clibgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setClibgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("clibgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setClibgovBridgeStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("clibgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--tool <v>", "tool")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerClibgovProfileV2({ id, owner, tool: o.tool }),
          null,
          2,
        ),
      );
    });
  parent
    .command("clibgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateClibgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("clibgov-degrade-v2 <id>")
    .description("Degrade profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).degradeClibgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("clibgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveClibgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("clibgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchClibgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("clibgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getClibgovProfileV2(id), null, 2));
    });
  parent
    .command("clibgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listClibgovProfilesV2(), null, 2));
    });
  parent
    .command("clibgov-create-bridge-v2 <id> <profileId>")
    .description("Create bridge")
    .option("--command <v>", "command")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createClibgovBridgeV2({ id, profileId, command: o.command }),
          null,
          2,
        ),
      );
    });
  parent
    .command("clibgov-bridging-bridge-v2 <id>")
    .description("Mark bridge as bridging")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).bridgingClibgovBridgeV2(id), null, 2),
      );
    });
  parent
    .command("clibgov-complete-bridge-v2 <id>")
    .description("Complete bridge")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeBridgeClibgovV2(id), null, 2),
      );
    });
  parent
    .command("clibgov-fail-bridge-v2 <id> [reason]")
    .description("Fail bridge")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failClibgovBridgeV2(id, reason), null, 2),
      );
    });
  parent
    .command("clibgov-cancel-bridge-v2 <id> [reason]")
    .description("Cancel bridge")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelClibgovBridgeV2(id, reason), null, 2),
      );
    });
  parent
    .command("clibgov-get-bridge-v2 <id>")
    .description("Get bridge")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getClibgovBridgeV2(id), null, 2));
    });
  parent
    .command("clibgov-list-bridges-v2")
    .description("List bridges")
    .action(async () => {
      console.log(JSON.stringify((await L()).listClibgovBridgesV2(), null, 2));
    });
  parent
    .command("clibgov-auto-degrade-idle-v2")
    .description("Auto-degrade idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDegradeIdleClibgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("clibgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck bridges")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckClibgovBridgesV2(), null, 2),
      );
    });
  parent
    .command("clibgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getCliAnythingBridgeGovStatsV2(), null, 2),
      );
    });
}

// === Iter26 V2 governance overlay ===
export function registerCtxenggovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "cli-anything");
  if (!parent) return;
  const L = async () => await import("../lib/cli-context-engineering.js");
  parent
    .command("ctxenggov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.CTXENGGOV_PROFILE_MATURITY_V2,
            buildLifecycle: m.CTXENGGOV_BUILD_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ctxenggov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveCtxenggovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingCtxenggovBuildsPerProfileV2(),
            idleMs: m.getCtxenggovProfileIdleMsV2(),
            stuckMs: m.getCtxenggovBuildStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ctxenggov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveCtxenggovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ctxenggov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingCtxenggovBuildsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ctxenggov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setCtxenggovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ctxenggov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setCtxenggovBuildStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ctxenggov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--scope <v>", "scope")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerCtxenggovProfileV2({ id, owner, scope: o.scope }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ctxenggov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateCtxenggovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ctxenggov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleCtxenggovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ctxenggov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveCtxenggovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ctxenggov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchCtxenggovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ctxenggov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getCtxenggovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ctxenggov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listCtxenggovProfilesV2(), null, 2),
      );
    });
  parent
    .command("ctxenggov-create-build-v2 <id> <profileId>")
    .description("Create build")
    .option("--prompt <v>", "prompt")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createCtxenggovBuildV2({ id, profileId, prompt: o.prompt }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ctxenggov-building-build-v2 <id>")
    .description("Mark build as building")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).buildingCtxenggovBuildV2(id), null, 2),
      );
    });
  parent
    .command("ctxenggov-complete-build-v2 <id>")
    .description("Complete build")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeBuildCtxenggovV2(id), null, 2),
      );
    });
  parent
    .command("ctxenggov-fail-build-v2 <id> [reason]")
    .description("Fail build")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failCtxenggovBuildV2(id, reason), null, 2),
      );
    });
  parent
    .command("ctxenggov-cancel-build-v2 <id> [reason]")
    .description("Cancel build")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelCtxenggovBuildV2(id, reason), null, 2),
      );
    });
  parent
    .command("ctxenggov-get-build-v2 <id>")
    .description("Get build")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCtxenggovBuildV2(id), null, 2));
    });
  parent
    .command("ctxenggov-list-builds-v2")
    .description("List builds")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCtxenggovBuildsV2(), null, 2));
    });
  parent
    .command("ctxenggov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleCtxenggovProfilesV2(), null, 2),
      );
    });
  parent
    .command("ctxenggov-auto-fail-stuck-v2")
    .description("Auto-fail stuck builds")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckCtxenggovBuildsV2(), null, 2),
      );
    });
  parent
    .command("ctxenggov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).getCliContextEngineeringGovStatsV2(),
          null,
          2,
        ),
      );
    });
}
