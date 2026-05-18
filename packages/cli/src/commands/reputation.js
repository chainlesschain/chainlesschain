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
  // V2 (Phase 60)
  RUN_STATUS_V2,
  OBJECTIVE_V2,
  DECAY_MODEL_V2,
  ANOMALY_METHOD_V2,
  REPUTATION_DEFAULT_MAX_CONCURRENT,
  setMaxConcurrentOptimizations,
  getMaxConcurrentOptimizations,
  getActiveOptimizationCount,
  startOptimizationV2,
  completeOptimization,
  cancelOptimization,
  failOptimization,
  applyOptimization,
  setRunStatus,
  getReputationStatsV2,
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

  /* ── V2 (Phase 60) ───────────────────────────────────────── */

  rep
    .command("run-statuses")
    .description(
      "List V2 run statuses (running/complete/applied/failed/cancelled)",
    )
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(RUN_STATUS_V2);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else for (const v of values) logger.log(`  ${chalk.cyan(v)}`);
    });

  rep
    .command("v2-objectives")
    .description("List V2 objectives (frozen enum)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(OBJECTIVE_V2);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else for (const v of values) logger.log(`  ${chalk.cyan(v)}`);
    });

  rep
    .command("decay-models")
    .description("List V2 decay models (frozen enum)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(DECAY_MODEL_V2);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else for (const v of values) logger.log(`  ${chalk.cyan(v)}`);
    });

  rep
    .command("anomaly-methods")
    .description("List V2 anomaly methods (frozen enum)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const values = Object.values(ANOMALY_METHOD_V2);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else for (const v of values) logger.log(`  ${chalk.cyan(v)}`);
    });

  rep
    .command("default-max-concurrent")
    .description("Show default max concurrent optimizations")
    .action(() => {
      logger.log(`  ${REPUTATION_DEFAULT_MAX_CONCURRENT}`);
    });

  rep
    .command("max-concurrent")
    .description("Show current max concurrent optimizations")
    .action(() => {
      logger.log(`  ${getMaxConcurrentOptimizations()}`);
    });

  rep
    .command("active-optimization-count")
    .description("Show count of currently-RUNNING optimizations")
    .action(() => {
      logger.log(`  ${getActiveOptimizationCount()}`);
    });

  rep
    .command("set-max-concurrent <n>")
    .description("Set the concurrency cap for RUNNING optimizations")
    .action((n) => {
      try {
        const v = setMaxConcurrentOptimizations(Number(n));
        logger.success(`Max concurrent = ${v}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("start-v2")
    .description(
      "Start a V2 optimization (RUNNING only, driven by complete/cancel/fail)",
    )
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
        const run = startOptimizationV2(db, {
          objective: options.objective,
          iterations: options.iterations,
        });
        if (options.json) console.log(JSON.stringify(run, null, 2));
        else {
          logger.success(`Optimization started [${run.status}]`);
          logger.log(`  ${chalk.bold("Run ID:")}     ${chalk.cyan(run.runId)}`);
          logger.log(`  ${chalk.bold("Objective:")}  ${run.objective}`);
          logger.log(`  ${chalk.bold("Iterations:")} ${run.iterations}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("complete <run-id>")
    .description(
      "Complete a V2 optimization (RUNNING → COMPLETE, runs iterations)",
    )
    .option("--json", "Output as JSON")
    .action(async (runId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = completeOptimization(db, runId);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else {
          logger.success(`Completed [${result.status}]`);
          logger.log(`  ${chalk.bold("Best score:")}  ${result.bestScore}`);
          logger.log(
            `  ${chalk.bold("Best params:")} ${JSON.stringify(result.bestParams)}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("cancel <run-id>")
    .description("Cancel a V2 RUNNING optimization")
    .action(async (runId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = cancelOptimization(db, runId);
        logger.success(`Cancelled [${result.status}]`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("fail <run-id>")
    .description("Fail a V2 RUNNING optimization")
    .option("--message <msg>", "Error message")
    .action(async (runId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = failOptimization(db, runId, options.message);
        logger.success(`Failed [${result.status}]`);
        if (result.errorMessage)
          logger.log(`  ${chalk.bold("Error:")} ${result.errorMessage}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("apply-v2 <run-id>")
    .description("Apply a V2 COMPLETE optimization (COMPLETE → APPLIED)")
    .action(async (runId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const result = applyOptimization(db, runId);
        logger.success(`Applied [${result.status}]`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("set-status <run-id> <status>")
    .description("Set V2 run status via the state machine")
    .option("--message <msg>", "Error message (FAILED only)")
    .option("--json", "Output as JSON")
    .action(async (runId, status, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const patch = options.message ? { errorMessage: options.message } : {};
        const result = setRunStatus(db, runId, status, patch);
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else logger.success(`Status = ${result.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  rep
    .command("stats-v2")
    .description("V2 aggregated stats")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const stats = getReputationStatsV2();
        if (options.json) console.log(JSON.stringify(stats, null, 2));
        else {
          logger.log(`  ${chalk.bold("Total runs:")}   ${stats.totalRuns}`);
          logger.log(`  ${chalk.bold("Active:")}       ${stats.activeRuns}`);
          logger.log(
            `  ${chalk.bold("Max concurrent:")} ${stats.maxConcurrentOptimizations}`,
          );
          logger.log(`  ${chalk.bold("By status:")}`);
          for (const [k, v] of Object.entries(stats.byStatus))
            logger.log(`    ${k.padEnd(12)} ${v}`);
          logger.log(`  ${chalk.bold("By objective:")}`);
          for (const [k, v] of Object.entries(stats.byObjective))
            logger.log(`    ${k.padEnd(20)} ${v}`);
          logger.log(
            `  ${chalk.bold("Observations:")} ${stats.observations.totalObservations} (${stats.observations.totalDids} DIDs)`,
          );
          logger.log(
            `  ${chalk.bold("Best score ever:")} ${stats.bestScoreEver}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}

// === Iter16 V2 governance overlay ===
export function registerRepgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "reputation");
  if (!parent) return;
  const L = async () => await import("../lib/reputation-optimizer.js");
  parent
    .command("repgov-enums-v2")
    .description("Show V2 enums (repgov maturity + cycle lifecycle)")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.REPGOV_PROFILE_MATURITY_V2,
            cycleLifecycle: m.REPGOV_CYCLE_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("repgov-config-v2")
    .description("Show V2 config thresholds")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveRepgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingRepgovCyclesPerProfileV2(),
            idleMs: m.getRepgovProfileIdleMsV2(),
            stuckMs: m.getRepgovCycleStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("repgov-set-max-active-v2 <n>")
    .description("Set max active profiles per owner")
    .action(async (n) => {
      const m = await L();
      m.setMaxActiveRepgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("repgov-set-max-pending-v2 <n>")
    .description("Set max pending cycles per profile")
    .action(async (n) => {
      const m = await L();
      m.setMaxPendingRepgovCyclesPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("repgov-set-idle-ms-v2 <n>")
    .description("Set profile idle threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setRepgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("repgov-set-stuck-ms-v2 <n>")
    .description("Set cycle stuck threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setRepgovCycleStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("repgov-register-v2 <id> <owner>")
    .description("Register V2 repgov profile")
    .option("--objective <v>", "objective")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerRepgovProfileV2({ id, owner, objective: o.objective }),
          null,
          2,
        ),
      );
    });
  parent
    .command("repgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.activateRepgovProfileV2(id), null, 2));
    });
  parent
    .command("repgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.staleRepgovProfileV2(id), null, 2));
    });
  parent
    .command("repgov-archive-v2 <id>")
    .description("Archive profile (terminal)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.archiveRepgovProfileV2(id), null, 2));
    });
  parent
    .command("repgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.touchRepgovProfileV2(id), null, 2));
    });
  parent
    .command("repgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getRepgovProfileV2(id), null, 2));
    });
  parent
    .command("repgov-list-v2")
    .description("List profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listRepgovProfilesV2(), null, 2));
    });
  parent
    .command("repgov-create-cycle-v2 <id> <profileId>")
    .description("Create cycle (queued)")
    .option("--subject <v>", "subject")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createRepgovCycleV2({ id, profileId, subject: o.subject }),
          null,
          2,
        ),
      );
    });
  parent
    .command("repgov-running-cycle-v2 <id>")
    .description("Mark cycle as running")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.runningRepgovCycleV2(id), null, 2));
    });
  parent
    .command("repgov-complete-cycle-v2 <id>")
    .description("Complete cycle")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.completeCycleRepgovV2(id), null, 2));
    });
  parent
    .command("repgov-fail-cycle-v2 <id> [reason]")
    .description("Fail cycle")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.failRepgovCycleV2(id, reason), null, 2));
    });
  parent
    .command("repgov-cancel-cycle-v2 <id> [reason]")
    .description("Cancel cycle")
    .action(async (id, reason) => {
      const m = await L();
      console.log(JSON.stringify(m.cancelRepgovCycleV2(id, reason), null, 2));
    });
  parent
    .command("repgov-get-cycle-v2 <id>")
    .description("Get cycle")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getRepgovCycleV2(id), null, 2));
    });
  parent
    .command("repgov-list-cycles-v2")
    .description("List cycles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listRepgovCyclesV2(), null, 2));
    });
  parent
    .command("repgov-auto-stale-idle-v2")
    .description("Auto-stale idle profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoStaleIdleRepgovProfilesV2(), null, 2));
    });
  parent
    .command("repgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck cycles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoFailStuckRepgovCyclesV2(), null, 2));
    });
  parent
    .command("repgov-gov-stats-v2")
    .description("V2 gov aggregate stats")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(m.getReputationOptimizerGovStatsV2(), null, 2),
      );
    });
}
