/**
 * Stress commands
 * chainlesschain stress run|list|show|analyze|plan|stop|levels
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureStressTables,
  startStressTest,
  stopStressTest,
  getTestResults,
  listTestHistory,
  analyzeBottlenecks,
  generateCapacityPlan,
  listLoadLevels,
} from "../lib/stress-tester.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureStressTables(db);
  return db;
}

export function registerStressCommand(program) {
  const stress = program
    .command("stress")
    .description(
      "Federation stress testing — load simulation, bottleneck & capacity planning",
    );

  stress
    .command("run")
    .description("Run a stress test at a given load level")
    .option(
      "-l, --level <level>",
      "Load level (light|medium|heavy|extreme)",
      "medium",
    )
    .option("-c, --concurrency <n>", "Override concurrency", parseInt)
    .option("-r, --rps <n>", "Override requests per second", parseInt)
    .option("-d, --duration <ms>", "Override duration in ms", parseInt)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const run = startStressTest(db, {
          level: options.level,
          concurrency: options.concurrency,
          requestsPerSecond: options.rps,
          duration: options.duration,
        });
        if (options.json) {
          console.log(JSON.stringify(run, null, 2));
        } else {
          logger.success(`Stress test ${run.status}`);
          logger.log(
            `  ${chalk.bold("ID:")}          ${chalk.cyan(run.testId)}`,
          );
          logger.log(`  ${chalk.bold("Level:")}       ${run.loadLevel}`);
          logger.log(
            `  ${chalk.bold("Load:")}        ${run.concurrency} concurrent, ${run.requestsPerSecond} rps, ${run.duration}ms`,
          );
          const m = run.result;
          logger.log(`  ${chalk.bold("TPS:")}         ${m.tps}`);
          logger.log(
            `  ${chalk.bold("Latency:")}     p50=${m.p50ResponseTime}ms p95=${m.p95ResponseTime}ms p99=${m.p99ResponseTime}ms`,
          );
          logger.log(
            `  ${chalk.bold("Error rate:")}  ${(m.errorRate * 100).toFixed(2)}%`,
          );
          if (m.bottlenecks.length) {
            logger.log(chalk.yellow(`  Bottlenecks:`));
            for (const b of m.bottlenecks) {
              logger.log(
                `    ${chalk.yellow("•")} ${b.kind} (${b.severity}): ${b.detail}`,
              );
            }
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("list")
    .description("List stress test history")
    .option("-l, --level <level>", "Filter by load level")
    .option(
      "-s, --status <status>",
      "Filter by status (running|complete|stopped)",
    )
    .option("--limit <n>", "Maximum entries", parseInt, 10)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listTestHistory({
          level: options.level,
          status: options.status,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No stress tests recorded.");
        } else {
          for (const r of rows) {
            logger.log(
              `  ${chalk.cyan(r.testId.slice(0, 8))} ${r.loadLevel.padEnd(8)} [${r.status}] c=${r.concurrency} rps=${r.requestsPerSecond}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("show <test-id>")
    .description("Show full results for a stress test")
    .option("--json", "Output as JSON")
    .action(async (testId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const r = getTestResults(testId);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          logger.log(`  ${chalk.bold("ID:")}          ${chalk.cyan(r.testId)}`);
          logger.log(`  ${chalk.bold("Level:")}       ${r.loadLevel}`);
          logger.log(`  ${chalk.bold("Status:")}      ${r.status}`);
          if (r.result) {
            const m = r.result;
            logger.log(`  ${chalk.bold("TPS:")}         ${m.tps}`);
            logger.log(
              `  ${chalk.bold("Latency:")}     p50=${m.p50ResponseTime}ms p95=${m.p95ResponseTime}ms p99=${m.p99ResponseTime}ms`,
            );
            logger.log(
              `  ${chalk.bold("Error rate:")}  ${(m.errorRate * 100).toFixed(2)}%`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("analyze <test-id>")
    .description("Analyze bottlenecks for a stress test")
    .option("--json", "Output as JSON")
    .action(async (testId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const r = analyzeBottlenecks(testId);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Summary:")} ${r.summary}`);
          for (const b of r.bottlenecks) {
            logger.log(
              `    ${chalk.yellow(b.kind)} (${b.severity}): ${b.detail}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("plan <test-id>")
    .description("Generate capacity plan recommendations")
    .option("--json", "Output as JSON")
    .action(async (testId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const plan = generateCapacityPlan(testId);
        if (options.json) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Level:")}     ${plan.loadLevel}`);
          logger.log(
            `  ${chalk.bold("Target/Got:")} ${plan.targetRps} rps → ${plan.realizedTps} rps`,
          );
          logger.log(
            `  ${chalk.bold("Scale:")}     ${plan.scale}× (${plan.headroom})`,
          );
          for (const rec of plan.recommendations) {
            logger.log(`    ${chalk.green("→")} ${rec}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("stop <test-id>")
    .description("Mark a running stress test as stopped")
    .action(async (testId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const r = stopStressTest(testId);
        logger.success(`Test ${r.testId.slice(0, 8)} → ${r.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("levels")
    .description("List built-in load levels")
    .option("--json", "Output as JSON")
    .action((options) => {
      const levels = listLoadLevels();
      if (options.json) {
        console.log(JSON.stringify(levels, null, 2));
      } else {
        for (const l of levels) {
          logger.log(
            `  ${chalk.cyan(l.name.padEnd(8))} concurrency=${l.concurrency} rps=${l.requestsPerSecond} duration=${l.duration}ms`,
          );
        }
      }
    });
}
