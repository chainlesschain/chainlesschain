/**
 * Reputation commands
 * chainlesschain reputation observe|score|list|decay-preview|anomalies|optimize|status|analytics|apply
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureReputationTables,
  addObservation,
  computeScore,
  listScores,
  detectAnomalies,
  startOptimization,
  getOptimizationStatus,
  getAnalytics,
  listOptimizationRuns,
  applyOptimizedParams,
  OPTIMIZATION_OBJECTIVES,
} from "../lib/reputation-optimizer.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureReputationTables(db);
  return db;
}

export function registerReputationCommand(program) {
  const rep = program
    .command("reputation")
    .alias("rep")
    .description(
      "Reputation optimizer — observations, decay, anomaly detection, Bayesian optimization",
    );

  rep
    .command("observe <did> <score>")
    .description("Record a reputation observation (score in [0,1])")
    .option(
      "-k, --kind <kind>",
      "Observation kind (generic|task|review|vote)",
      "generic",
    )
    .option("-w, --weight <n>", "Observation weight", parseFloat, 1)
    .option("--json", "Output as JSON")
    .action(async (did, score, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const obs = addObservation(db, did, Number(score), {
          kind: options.kind,
          weight: options.weight,
        });
        if (options.json) {
          console.log(JSON.stringify(obs, null, 2));
        } else {
          logger.success(`Observation recorded`);
          logger.log(`  ${chalk.bold("DID:")}    ${chalk.cyan(obs.did)}`);
          logger.log(`  ${chalk.bold("Score:")}  ${obs.score}`);
          logger.log(`  ${chalk.bold("Kind:")}   ${obs.kind}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("score <did>")
    .description("Compute aggregated reputation score for a DID")
    .option(
      "-d, --decay <model>",
      "Decay model (none|exponential|linear|step)",
      "none",
    )
    .option("--lambda <n>", "Exponential decay lambda", parseFloat)
    .option("--alpha <n>", "Linear decay alpha", parseFloat)
    .option("--json", "Output as JSON")
    .action(async (did, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const result = computeScore(did, {
          decay: options.decay,
          lambda: options.lambda,
          alpha: options.alpha,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("DID:")}          ${chalk.cyan(result.did)}`,
          );
          logger.log(`  ${chalk.bold("Score:")}        ${result.score}`);
          logger.log(`  ${chalk.bold("Observations:")} ${result.observations}`);
          logger.log(`  ${chalk.bold("Decay:")}        ${result.decay}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("list")
    .description("List all tracked DIDs with computed scores")
    .option("-d, --decay <model>", "Decay model", "none")
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listScores({
          decay: options.decay,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No reputation data recorded.");
        } else {
          for (const r of rows) {
            logger.log(
              `  ${chalk.cyan(r.did.slice(0, 24).padEnd(24))} score=${r.score} obs=${r.observations}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("anomalies")
    .description("Detect anomalies in current reputation scores")
    .option(
      "-m, --method <method>",
      "Detection method (z_score|iqr)",
      "z_score",
    )
    .option("-t, --threshold <n>", "Detection threshold", parseFloat)
    .option(
      "-d, --decay <model>",
      "Decay model applied before detection",
      "none",
    )
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const result = detectAnomalies({
          method: options.method,
          threshold: options.threshold,
          decay: options.decay,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Method:")}   ${result.method}`);
          logger.log(`  ${chalk.bold("Samples:")}  ${result.totalSamples}`);
          if (result.message) {
            logger.info(`  ${result.message}`);
          } else {
            logger.log(`  ${chalk.bold("Summary:")}  ${result.summary}`);
            for (const a of result.anomalies) {
              logger.log(
                `    ${chalk.yellow(a.did.slice(0, 24))} score=${a.score} ${a.reason}`,
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

  rep
    .command("optimize")
    .description("Run parameter optimization over the reputation algorithm")
    .option(
      "-o, --objective <name>",
      "Objective (accuracy|fairness|resilience|convergence_speed)",
      "accuracy",
    )
    .option("-i, --iterations <n>", "Iteration count", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const run = startOptimization(db, {
          objective: options.objective,
          iterations: options.iterations,
        });
        if (options.json) {
          console.log(JSON.stringify(run, null, 2));
        } else {
          logger.success(`Optimization ${run.status}`);
          logger.log(
            `  ${chalk.bold("Run ID:")}      ${chalk.cyan(run.runId)}`,
          );
          logger.log(`  ${chalk.bold("Objective:")}   ${run.objective}`);
          logger.log(`  ${chalk.bold("Iterations:")}  ${run.iterations}`);
          logger.log(`  ${chalk.bold("Best score:")}  ${run.bestScore}`);
          logger.log(
            `  ${chalk.bold("Best params:")} ${JSON.stringify(run.bestParams)}`,
          );
          for (const rec of run.analytics.recommendations) {
            logger.log(`    ${chalk.green("→")} ${rec}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("status <run-id>")
    .description("Show optimization run status")
    .option("--json", "Output as JSON")
    .action(async (runId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const run = getOptimizationStatus(runId);
        if (options.json) {
          console.log(JSON.stringify(run, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Run ID:")}      ${chalk.cyan(run.runId)}`,
          );
          logger.log(`  ${chalk.bold("Status:")}      ${run.status}`);
          logger.log(`  ${chalk.bold("Objective:")}   ${run.objective}`);
          logger.log(`  ${chalk.bold("Best score:")}  ${run.bestScore}`);
          logger.log(
            `  ${chalk.bold("Best params:")} ${JSON.stringify(run.bestParams)}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("analytics <run-id>")
    .description("Show analytics for an optimization run")
    .option("--json", "Output as JSON")
    .action(async (runId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const a = getAnalytics(runId);
        if (options.json) {
          console.log(JSON.stringify(a, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Run ID:")} ${chalk.cyan(a.runId)}`);
          logger.log(`  ${chalk.bold("Distribution:")}`);
          for (const b of a.reputationDistribution.buckets) {
            logger.log(`    ${b.label.padEnd(15)} ${b.count}`);
          }
          logger.log(
            `  ${chalk.bold("Anomalies:")} ${a.anomalies.summary || a.anomalies.message || ""}`,
          );
          for (const r of a.recommendations) {
            logger.log(`    ${chalk.green("→")} ${r}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("runs")
    .description("List optimization run history")
    .option("--limit <n>", "Maximum entries", parseInt, 10)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listOptimizationRuns({ limit: options.limit });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No optimization runs recorded.");
        } else {
          for (const r of rows) {
            logger.log(
              `  ${chalk.cyan(r.runId.slice(0, 8))} ${r.objective.padEnd(20)} iters=${r.iterations} best=${r.bestScore} [${r.status}]`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("apply <run-id>")
    .description("Mark an optimization run as applied")
    .action(async (runId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const r = applyOptimizedParams(runId);
        logger.success(`Applied run ${runId.slice(0, 8)}`);
        logger.log(`  ${chalk.bold("Params:")} ${JSON.stringify(r.params)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("objectives")
    .description("List supported optimization objectives")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(OPTIMIZATION_OBJECTIVES);
      if (options.json) {
        console.log(JSON.stringify(values, null, 2));
      } else {
        for (const v of values) logger.log(`  ${chalk.cyan(v)}`);
      }
    });
}
