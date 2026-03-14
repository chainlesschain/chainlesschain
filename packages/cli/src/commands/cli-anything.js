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
