/**
 * Instinct learning commands
 * chainlesschain instinct show|reset|categories
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  getInstincts,
  getStrongInstincts,
  resetInstincts,
  deleteInstinct,
  decayInstincts,
  generateInstinctPrompt,
  INSTINCT_CATEGORIES,
} from "../lib/instinct-manager.js";

export function registerInstinctCommand(program) {
  const instinct = program
    .command("instinct")
    .description("Instinct learning — learned user preferences");

  // instinct show
  instinct
    .command("show", { isDefault: true })
    .description("Show learned instincts")
    .option("--category <cat>", "Filter by category")
    .option("-n, --limit <n>", "Max entries", "30")
    .option("--strong", "Show only high-confidence instincts (>= 70%)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const instincts = options.strong
          ? getStrongInstincts(db)
          : getInstincts(db, {
              category: options.category,
              limit: parseInt(options.limit) || 30,
            });

        if (options.json) {
          console.log(JSON.stringify(instincts, null, 2));
        } else if (instincts.length === 0) {
          logger.info(
            "No instincts learned yet. Use the agent to build up preferences.",
          );
        } else {
          logger.log(chalk.bold(`Learned Instincts (${instincts.length}):\n`));
          for (const inst of instincts) {
            const pct = (inst.confidence * 100).toFixed(0);
            const bar =
              "█".repeat(Math.round(inst.confidence * 10)) +
              "░".repeat(10 - Math.round(inst.confidence * 10));
            logger.log(
              `  ${chalk.gray(inst.id.slice(0, 8))}  ${chalk.cyan(inst.category.padEnd(18))} ${bar} ${pct}%`,
            );
            logger.log(`    ${chalk.white(inst.pattern)}`);
            logger.log(
              `    ${chalk.gray(`seen ${inst.occurrences}x | last: ${inst.last_seen || "unknown"}`)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // instinct categories
  instinct
    .command("categories")
    .description("List instinct categories")
    .action(async () => {
      logger.log(chalk.bold("Instinct Categories:\n"));
      for (const [key, value] of Object.entries(INSTINCT_CATEGORIES)) {
        logger.log(`  ${chalk.cyan(value.padEnd(20))} ${chalk.gray(key)}`);
      }
    });

  // instinct prompt
  instinct
    .command("prompt")
    .description("Generate a system prompt from learned instincts")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const prompt = generateInstinctPrompt(db);

        if (options.json) {
          console.log(JSON.stringify({ prompt }, null, 2));
        } else if (!prompt) {
          logger.info("No strong instincts yet. Keep using the agent!");
        } else {
          logger.log(prompt);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // instinct delete
  instinct
    .command("delete")
    .description("Delete an instinct by ID")
    .argument("<id>", "Instinct ID (or prefix)")
    .action(async (id) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = deleteInstinct(db, id);
        if (ok) {
          logger.success("Instinct deleted");
        } else {
          logger.error(`Instinct not found: ${id}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // instinct reset
  instinct
    .command("reset")
    .description("Reset all learned instincts")
    .option("--force", "Skip confirmation")
    .action(async (options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Reset all learned instincts? This cannot be undone.",
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const count = resetInstincts(db);
        logger.success(`Reset ${count} instincts`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // instinct decay
  instinct
    .command("decay")
    .description("Decay old instincts (reduce confidence of unused patterns)")
    .option("--days <n>", "Days threshold", "30")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const decayed = decayInstincts(db, parseInt(options.days) || 30);
        logger.success(`Decayed ${decayed} old instincts`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
