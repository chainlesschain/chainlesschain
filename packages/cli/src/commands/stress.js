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
  // V2
  RUN_STATUS_V2,
  LEVEL_NAME_V2,
  BOTTLENECK_KIND_V2,
  BOTTLENECK_SEVERITY_V2,
  STRESS_DEFAULT_MAX_CONCURRENT,
  setMaxConcurrentTests,
  getMaxConcurrentTests,
  getActiveTestCount,
  startStressTestV2,
  completeStressTest,
  stopStressTestV2,
  failStressTest,
  setRunStatus,
  recommendLevelV2,
  getStressStatsV2,
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

  // ---------- V2 (Phase 59) ----------
  const withDb = async (fn) => {
    const ctx = await bootstrap({ verbose: program.opts().verbose });
    if (!ctx.db) {
      logger.error("Database not available");
      process.exit(1);
    }
    try {
      const db = ctx.db.getDatabase();
      ensureStressTables(db);
      return await fn(db);
    } finally {
      await shutdown();
    }
  };

  stress
    .command("run-statuses")
    .description("List RUN_STATUS_V2 values")
    .action(() => {
      console.log(JSON.stringify(Object.values(RUN_STATUS_V2), null, 2));
    });

  stress
    .command("level-names")
    .description("List LEVEL_NAME_V2 values")
    .action(() => {
      console.log(JSON.stringify(Object.values(LEVEL_NAME_V2), null, 2));
    });

  stress
    .command("bottleneck-kinds")
    .description("List BOTTLENECK_KIND_V2 values")
    .action(() => {
      console.log(JSON.stringify(Object.values(BOTTLENECK_KIND_V2), null, 2));
    });

  stress
    .command("bottleneck-severities")
    .description("List BOTTLENECK_SEVERITY_V2 values")
    .action(() => {
      console.log(
        JSON.stringify(Object.values(BOTTLENECK_SEVERITY_V2), null, 2),
      );
    });

  stress
    .command("default-max-concurrent")
    .description("Show STRESS_DEFAULT_MAX_CONCURRENT")
    .action(() => {
      console.log(STRESS_DEFAULT_MAX_CONCURRENT);
    });

  stress
    .command("max-concurrent")
    .description("Show current max concurrent test limit")
    .action(() => {
      console.log(getMaxConcurrentTests());
    });

  stress
    .command("active-test-count")
    .description("Show current active (RUNNING) test count")
    .action(() => {
      console.log(getActiveTestCount());
    });

  stress
    .command("set-max-concurrent <n>")
    .description("Set max concurrent test admission limit")
    .action((n) => {
      try {
        const v = setMaxConcurrentTests(Number(n));
        logger.success(`maxConcurrentTests=${v}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("start-v2")
    .description("Start a V2 stress run (RUNNING, no metrics until complete)")
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
        await withDb((db) => {
          const run = startStressTestV2(db, {
            level: options.level,
            concurrency: options.concurrency,
            requestsPerSecond: options.rps,
            duration: options.duration,
          });
          if (options.json) {
            console.log(JSON.stringify(run, null, 2));
          } else {
            logger.success(
              `Started ${run.testId.slice(0, 8)} [${run.loadLevel}] → ${run.status}`,
            );
          }
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("complete <test-id>")
    .description("Complete a RUNNING run and compute metrics")
    .option("--json", "Output as JSON")
    .action(async (testId, options) => {
      try {
        await withDb((db) => {
          const r = completeStressTest(db, testId);
          if (options.json) {
            console.log(JSON.stringify(r, null, 2));
          } else {
            logger.success(
              `${r.testId.slice(0, 8)} → ${r.status} (tps=${r.result.tps})`,
            );
          }
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("stop-v2 <test-id>")
    .description("Stop a RUNNING run (→ STOPPED)")
    .action(async (testId) => {
      try {
        await withDb((db) => {
          const r = stopStressTestV2(db, testId);
          logger.success(`${r.testId.slice(0, 8)} → ${r.status}`);
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("fail <test-id> <error-message>")
    .description("Fail a RUNNING run with an error message (→ FAILED)")
    .action(async (testId, errorMessage) => {
      try {
        await withDb((db) => {
          const r = failStressTest(db, testId, errorMessage);
          logger.success(
            `${r.testId.slice(0, 8)} → ${r.status} (${r.errorMessage})`,
          );
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("set-status <test-id> <status>")
    .description("Transition run to a given status (state-machine guarded)")
    .option("--error-message <msg>", "Attach error message (for failed)")
    .action(async (testId, status, options) => {
      try {
        await withDb((db) => {
          const patch = {};
          if (options.errorMessage) patch.errorMessage = options.errorMessage;
          const r = setRunStatus(db, testId, status, patch);
          logger.success(`${r.testId.slice(0, 8)} → ${r.status}`);
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("recommend-level <target-rps>")
    .description("Recommend the largest built-in level ≤ targetRps")
    .option("--json", "Output as JSON")
    .action((targetRps, options) => {
      try {
        const level = recommendLevelV2(Number(targetRps));
        if (options.json) {
          console.log(JSON.stringify(level, null, 2));
        } else {
          logger.log(
            `  ${chalk.cyan(level.name)}  concurrency=${level.concurrency} rps=${level.requestsPerSecond} duration=${level.duration}ms`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  stress
    .command("stats-v2")
    .description("Show aggregate V2 stats (byStatus/byLevel/bottlenecks)")
    .action(() => {
      console.log(JSON.stringify(getStressStatsV2(), null, 2));
    });
}
