/**
 * Hierarchical Memory 2.0 commands
 * chainlesschain hmemory store|recall|consolidate|search|stats|share|prune
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  storeMemory,
  recallMemory,
  consolidateMemory,
  searchEpisodic,
  searchSemantic,
  getMemoryStats,
  shareMemory,
  pruneMemory,
} from "../lib/hierarchical-memory.js";

export function registerHmemoryCommand(program) {
  const hmemory = program
    .command("hmemory")
    .description("Hierarchical Memory 2.0 — four-layer memory system");

  // hmemory store <content>
  hmemory
    .command("store")
    .description("Store a memory at the appropriate layer")
    .argument("<content>", "Memory content")
    .option("--importance <n>", "Importance 0.0-1.0", "0.5")
    .option("--type <type>", "Memory type (episodic|semantic)", "episodic")
    .option("--core", "Force store as core memory (importance=1.0)")
    .option("--json", "Output as JSON")
    .action(async (content, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const importance = options.core
          ? 1.0
          : parseFloat(options.importance) || 0.5;
        const entry = storeMemory(db, content, {
          importance,
          type: options.type,
        });

        if (options.json) {
          console.log(JSON.stringify(entry, null, 2));
        } else {
          logger.success(
            `Memory stored: ${chalk.gray(entry.id.slice(0, 16))} → ${chalk.cyan(entry.layer)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory recall <query>
  hmemory
    .command("recall")
    .description("Recall memories with forgetting curve")
    .argument("<query>", "Search query")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const results = recallMemory(db, query, {
          limit: parseInt(options.limit) || 20,
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          logger.info(`No memories matching "${query}" above recall threshold`);
        } else {
          logger.log(chalk.bold(`Recalled ${results.length} memories:\n`));
          for (const r of results) {
            const retention = (r.retention * 100).toFixed(0);
            logger.log(
              `  ${chalk.gray(r.id.slice(0, 16))} [${chalk.cyan(r.layer)}] retention=${chalk.yellow(retention + "%")}`,
            );
            logger.log(
              `    ${chalk.white(r.content.substring(0, 120).replace(/\n/g, " "))}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory consolidate
  hmemory
    .command("consolidate")
    .description("Promote and forget memories across layers")
    .action(async () => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Consolidating memories...").start();
        const result = consolidateMemory(db);
        spinner.succeed(
          `Consolidation complete: ${chalk.green(result.promoted)} promoted, ${chalk.red(result.forgotten)} forgotten`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory search <query>
  hmemory
    .command("search")
    .description("Search memories by type")
    .argument("<query>", "Search query")
    .option("--type <type>", "Memory type (episodic|semantic)", "episodic")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const searchFn =
          options.type === "semantic" ? searchSemantic : searchEpisodic;
        const results = searchFn(db, query, {
          limit: parseInt(options.limit) || 20,
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 0) {
          logger.info(`No ${options.type} memories matching "${query}"`);
        } else {
          logger.log(
            chalk.bold(`${options.type} search (${results.length} results):\n`),
          );
          for (const r of results) {
            logger.log(
              `  ${chalk.gray(r.id.slice(0, 16))} [${chalk.cyan(r.layer)}] importance=${chalk.yellow(r.importance)}`,
            );
            logger.log(
              `    ${chalk.white(r.content.substring(0, 120).replace(/\n/g, " "))}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory stats
  hmemory
    .command("stats")
    .description("Show memory statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const stats = getMemoryStats(db);

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(chalk.bold("Hierarchical Memory Stats:\n"));
          logger.log(`  Working:    ${chalk.yellow(stats.working)}`);
          logger.log(`  Short-term: ${chalk.yellow(stats.shortTerm)}`);
          logger.log(`  Long-term:  ${chalk.yellow(stats.longTerm)}`);
          logger.log(`  Core:       ${chalk.yellow(stats.core)}`);
          logger.log(`  Shared:     ${chalk.yellow(stats.shared)}`);
          logger.log(
            `  ${chalk.bold("Total:")}      ${chalk.green(stats.total)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory share <id> <agent-id>
  hmemory
    .command("share")
    .description("Share a memory with another agent")
    .argument("<id>", "Memory ID")
    .argument("<agent-id>", "Target agent ID")
    .option("--privacy <level>", "Privacy level (full|filtered)", "filtered")
    .option("--json", "Output as JSON")
    .action(async (id, agentId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = shareMemory(db, id, agentId, options.privacy);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Memory ${chalk.gray(id.slice(0, 16))} shared with ${chalk.cyan(agentId)} [${options.privacy}]`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // hmemory prune
  hmemory
    .command("prune")
    .description("Remove weak old memories")
    .option("--max-age <hours>", "Maximum age in hours", "720")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Pruning stale memories...").start();
        const result = pruneMemory(db, { maxAge: options.maxAge });
        spinner.succeed(`Pruned ${chalk.red(result.pruned)} stale memories`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
