/**
 * Autonomous Learning Loop commands
 * chainlesschain learning stats|trajectories|reflect|synthesize|improve|cleanup
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";

export function registerLearningCommand(program) {
  const learning = program
    .command("learning")
    .description(
      "Autonomous learning loop — trajectories, reflection, skill synthesis",
    );

  // learning stats
  learning
    .command("stats")
    .description("Show learning loop statistics")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const { TrajectoryStore } =
          await import("../lib/learning/trajectory-store.js");
        const store = new TrajectoryStore(db);
        const stats = store.getStats();

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(chalk.bold("Learning Loop Statistics"));
          logger.log(`  Total trajectories:   ${chalk.cyan(stats.total)}`);
          logger.log(`  Complex (6+ tools):   ${chalk.cyan(stats.complex)}`);
          logger.log(`  Scored:               ${chalk.cyan(stats.scored)}`);
          logger.log(
            `  Skills synthesized:   ${chalk.cyan(stats.synthesized)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // learning trajectories
  learning
    .command("trajectories")
    .description("List recent trajectories")
    .option("-n, --limit <n>", "Number of trajectories", "20")
    .option("--session <id>", "Filter by session ID")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const { TrajectoryStore } =
          await import("../lib/learning/trajectory-store.js");
        const store = new TrajectoryStore(db);

        const trajs = store.getRecent({
          limit: parseInt(options.limit, 10),
          sessionId: options.session,
        });

        if (options.json) {
          console.log(JSON.stringify(trajs, null, 2));
        } else {
          if (trajs.length === 0) {
            logger.log(chalk.gray("No trajectories recorded yet."));
          } else {
            logger.log(chalk.bold(`Recent Trajectories (${trajs.length})`));
            for (const t of trajs) {
              const scoreStr =
                t.outcomeScore != null
                  ? chalk.cyan(t.outcomeScore.toFixed(2))
                  : chalk.gray("unscored");
              const synthStr = t.synthesizedSkill
                ? chalk.green(` → ${t.synthesizedSkill}`)
                : "";
              logger.log(
                `  ${chalk.dim(t.id.slice(0, 8))} | ${t.complexityLevel.padEnd(8)} | ` +
                  `${t.toolCount} tools | score: ${scoreStr}${synthStr}`,
              );
              if (t.userIntent) {
                logger.log(`    ${chalk.dim(t.userIntent.slice(0, 80))}`);
              }
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // learning export — §8.3 cross-device backup: full dump of learning_trajectories
  learning
    .command("export")
    .description("Export all learning trajectories as JSON (module 101 §8.3 backup)")
    .option("--output <file>", "Write JSON array to file (default: stdout)")
    .option("--json", "Output JSON ({ok,count} with --output; array otherwise)")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const { exportTrajectories } = await import("../lib/learning/learning-tables.js");
        const rows = exportTrajectories(ctx.db.getDatabase());
        if (options.output) {
          const fs = await import("fs");
          fs.writeFileSync(options.output, JSON.stringify(rows), "utf-8");
          if (options.json) {
            console.log(JSON.stringify({ ok: true, count: rows.length, output: options.output }));
          } else {
            logger.log(`exported ${rows.length} trajectories → ${options.output}`);
          }
        } else {
          console.log(JSON.stringify(rows));
        }
        await shutdown();
      } catch (err) {
        logger.error(`learning export failed: ${err.message}`);
        process.exit(1);
      }
    });

  // learning import — §8.3 restore: idempotent upsert by id from a JSON-array file
  learning
    .command("import")
    .description("Import learning trajectories from a JSON array file (idempotent upsert by id; §8.3)")
    .requiredOption("--input <file>", "JSON array of trajectories to import")
    .option("--json", "Output JSON result")
    .action(async (options) => {
      try {
        const fs = await import("fs");
        const rows = JSON.parse(fs.readFileSync(options.input, "utf-8"));
        if (!Array.isArray(rows)) {
          throw new Error("import: expected a JSON array of trajectories");
        }
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const { importTrajectories } = await import("../lib/learning/learning-tables.js");
        const result = importTrajectories(ctx.db.getDatabase(), rows);
        if (options.json) {
          console.log(JSON.stringify(result));
        } else {
          logger.log(`imported ${result.imported}, failed ${result.failed}`);
        }
        await shutdown();
        if (!result.ok) process.exitCode = 1;
      } catch (err) {
        logger.error(`learning import failed: ${err.message}`);
        process.exit(1);
      }
    });

  // learning reflect
  learning
    .command("reflect")
    .description("Run a reflection cycle and generate report")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const { TrajectoryStore } =
          await import("../lib/learning/trajectory-store.js");
        const { ReflectionEngine } =
          await import("../lib/learning/reflection-engine.js");
        const store = new TrajectoryStore(db);
        const engine = new ReflectionEngine(db, null, store);

        const spinner = ora("Running reflection...").start();
        const report = await engine.reflect();
        spinner.succeed("Reflection complete");

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          logger.log(chalk.bold("Reflection Report"));
          logger.log(`  Period:         ${chalk.dim(report.timestamp)}`);
          logger.log(
            `  Trajectories:   ${chalk.cyan(report.totalTrajectories)}`,
          );
          logger.log(
            `  Avg score:      ${chalk.cyan(report.avgScore?.toFixed(2) || "N/A")}`,
          );

          const trendColor =
            report.trend === "improving"
              ? chalk.green
              : report.trend === "declining"
                ? chalk.red
                : chalk.gray;
          logger.log(`  Trend:          ${trendColor(report.trend)}`);

          if (report.topTools && report.topTools.length > 0) {
            logger.log(chalk.bold("\n  Top Tools:"));
            for (const t of report.topTools.slice(0, 5)) {
              logger.log(
                `    ${t.tool}: ${t.count}x (${(t.errorRate * 100).toFixed(0)}% error)`,
              );
            }
          }

          if (report.errorProneTools && report.errorProneTools.length > 0) {
            logger.log(chalk.bold("\n  Error-prone Tools:"));
            for (const t of report.errorProneTools) {
              logger.log(
                `    ${chalk.red(t.tool)}: ${(t.errorRate * 100).toFixed(0)}% error rate`,
              );
            }
          }

          if (report.note) {
            logger.log(chalk.gray(`\n  Note: ${report.note}`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // learning synthesize
  learning
    .command("synthesize")
    .description("Synthesize new skills from eligible trajectories")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const { TrajectoryStore } =
          await import("../lib/learning/trajectory-store.js");
        const { SkillSynthesizer } =
          await import("../lib/learning/skill-synthesizer.js");
        const store = new TrajectoryStore(db);
        const synthesizer = new SkillSynthesizer(db, null, store);

        const spinner = ora("Scanning for synthesizable patterns...").start();
        const result = await synthesizer.synthesize();
        spinner.succeed("Synthesis complete");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.created.length > 0) {
            logger.log(
              chalk.green(`Created ${result.created.length} skill(s):`),
            );
            for (const name of result.created) {
              logger.log(`  ${chalk.cyan(name)}`);
            }
          } else {
            logger.log(chalk.gray("No new skills synthesized."));
          }

          if (result.skipped.length > 0) {
            logger.log(
              chalk.dim(`\nSkipped ${result.skipped.length} candidate(s)`),
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // learning cleanup
  learning
    .command("cleanup")
    .description("Delete old trajectories beyond retention period")
    .option("--days <n>", "Retention days", "90")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const { TrajectoryStore } =
          await import("../lib/learning/trajectory-store.js");
        const store = new TrajectoryStore(db);

        const days = parseInt(options.days, 10);
        const spinner = ora(
          `Cleaning up trajectories older than ${days} days...`,
        ).start();
        const deleted = store.cleanup(days);
        spinner.succeed(`Cleanup complete: ${deleted} trajectories deleted`);

        if (options.json) {
          console.log(JSON.stringify({ deleted, retentionDays: days }));
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
