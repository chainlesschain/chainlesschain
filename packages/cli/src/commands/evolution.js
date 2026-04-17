/**
 * Self-Evolving System commands
 * chainlesschain evolution assess|learn|diagnose|repair|predict|growth|stats|export
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  assessCapability,
  trainIncremental,
  selfDiagnose,
  selfRepair,
  predictBehavior,
  getGrowthLog,
  getCapabilities,
  getModels,
  exportModel,
  // Phase 100 V2
  CAPABILITY_DIMENSION,
  DIAGNOSIS_SEVERITY,
  REPAIR_STRATEGY,
  GROWTH_MILESTONE,
  assessCapabilityV2,
  getCapabilityV2,
  listCapabilitiesV2,
  trainIncrementalV2,
  listTrainingLogV2,
  selfDiagnoseV2,
  getDiagnosisV2,
  listDiagnosesV2,
  selfRepairV2,
  predictBehaviorV2,
  recordMilestone,
  getGrowthLogV2,
  configureEvolution,
  getEvolutionConfig,
  getEvolutionStatsV2,
} from "../lib/evolution-system.js";

export function registerEvolutionCommand(program) {
  const evolution = program
    .command("evolution")
    .description("Self-evolving AI system — capabilities, learning, diagnosis");

  // evolution assess <name> <score>
  evolution
    .command("assess")
    .description("Assess and track a capability")
    .argument("<name>", "Capability name")
    .argument("<score>", "Score (0-1)")
    .option("--category <cat>", "Capability category", "general")
    .option("--json", "Output as JSON")
    .action(async (name, score, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora(`Assessing capability: ${name}...`).start();

        const result = assessCapability(
          db,
          name,
          parseFloat(score),
          options.category,
        );
        spinner.succeed("Capability assessed");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const trendIcon =
            result.trend === "improving"
              ? chalk.green("improving")
              : result.trend === "declining"
                ? chalk.red("declining")
                : chalk.gray("stable");
          logger.log(chalk.bold(`Capability: ${result.name}`));
          logger.log(`  Score:    ${chalk.cyan(result.score)}`);
          logger.log(`  Trend:    ${trendIcon}`);
          logger.log(`  History:  ${result.history.length} assessments`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // evolution learn <model-id>
  evolution
    .command("learn")
    .description("Train a model with incremental data")
    .argument("<model-id>", "Model ID to train")
    .option("--data <json>", "Training data as JSON array")
    .option(
      "--type <type>",
      "Model type (classification|regression)",
      "classification",
    )
    .option("--json", "Output as JSON")
    .action(async (modelId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora(`Training model: ${modelId}...`).start();

        let data = [{ sample: true }];
        if (options.data) {
          try {
            data = JSON.parse(options.data);
          } catch (_err) {
            // Use data string as single data point
            data = [options.data];
          }
        }

        const result = trainIncremental(db, modelId, data, {
          type: options.type,
        });
        spinner.succeed("Model trained");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.bold(`Model: ${result.name}`));
          logger.log(`  Type:       ${result.type}`);
          logger.log(`  Accuracy:   ${chalk.cyan(result.accuracy.toFixed(4))}`);
          logger.log(`  Data Points: ${result.dataPoints}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // evolution diagnose
  evolution
    .command("diagnose")
    .description("Run self-diagnosis on the system")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Running self-diagnosis...").start();

        const result = selfDiagnose(db);
        spinner.succeed("Diagnosis complete");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const statusColor =
            result.overallStatus === "healthy" ? chalk.green : chalk.yellow;
          logger.log(
            chalk.bold(`Overall Status: ${statusColor(result.overallStatus)}`),
          );

          logger.log(chalk.bold("\nComponents:"));
          for (const c of result.components) {
            const icon =
              c.status === "healthy" ? chalk.green("OK") : chalk.yellow("WARN");
            logger.log(`  ${icon} ${c.name}`);
          }

          if (result.issues.length > 0) {
            logger.log(chalk.bold("\nIssues:"));
            for (const issue of result.issues) {
              logger.log(`  - ${chalk.yellow(issue.type)}: ${issue.details}`);
            }
          }

          if (result.recommendations.length > 0) {
            logger.log(chalk.bold("\nRecommendations:"));
            for (const rec of result.recommendations) {
              logger.log(`  - ${rec}`);
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // evolution repair <issue>
  evolution
    .command("repair")
    .description("Self-repair a diagnosed issue")
    .argument("<issue>", "Issue type (high-memory|stale-cache|degraded-model)")
    .option("--json", "Output as JSON")
    .action(async (issue, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora(`Repairing: ${issue}...`).start();

        const result = selfRepair(db, issue);
        spinner.succeed("Repair complete");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.bold(`Repaired: ${result.issue}`));
          logger.log(chalk.bold("Actions taken:"));
          for (const action of result.actions) {
            logger.log(`  - ${chalk.green(action)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // evolution predict [user-id]
  evolution
    .command("predict")
    .description("Predict user behavior")
    .argument("[user-id]", "User ID (optional)")
    .option("--json", "Output as JSON")
    .action(async (userId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const spinner = ora("Predicting behavior...").start();

        const result = predictBehavior(db, userId);
        spinner.succeed("Prediction complete");

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            chalk.bold(`Behavior Prediction (user: ${result.userId})`),
          );
          logger.log(`  Confidence: ${chalk.cyan(result.confidence)}`);
          logger.log(`  Based on:   ${result.basedOnEvents} events\n`);

          if (result.predictions.length > 0) {
            logger.log(chalk.bold("  Predicted Actions:"));
            for (const p of result.predictions) {
              const bar = "=".repeat(Math.round(p.probability * 20));
              logger.log(
                `    ${p.action.padEnd(25)} ${chalk.cyan(bar)} ${(p.probability * 100).toFixed(1)}%`,
              );
            }
          } else {
            logger.log(chalk.gray("  No predictions available yet."));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // evolution growth
  evolution
    .command("growth")
    .description("Show growth log")
    .option("--type <filter>", "Filter by event type")
    .option("--limit <n>", "Limit entries", parseInt)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const entries = getGrowthLog(db, {
          type: options.type,
          limit: options.limit,
        });

        if (options.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else if (entries.length === 0) {
          logger.info("No growth events recorded yet.");
        } else {
          logger.log(chalk.bold(`Growth Log (${entries.length} entries):\n`));
          for (const e of entries) {
            const ts = chalk.gray(e.timestamp);
            const type = chalk.yellow(e.eventType);
            logger.log(`  ${ts}  ${type}`);
            logger.log(`    ${e.description}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // evolution stats
  evolution
    .command("stats")
    .description("Show capabilities and models overview")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const caps = getCapabilities(db);
        const mdls = getModels(db);

        if (options.json) {
          console.log(
            JSON.stringify({ capabilities: caps, models: mdls }, null, 2),
          );
        } else {
          logger.log(chalk.bold(`Capabilities (${caps.length}):\n`));
          if (caps.length === 0) {
            logger.log(chalk.gray("  No capabilities tracked yet."));
          }
          for (const c of caps) {
            const trendColor =
              c.trend === "improving"
                ? chalk.green
                : c.trend === "declining"
                  ? chalk.red
                  : chalk.gray;
            logger.log(
              `  ${chalk.cyan(c.name.padEnd(20))} score=${c.score.toFixed(2)}  trend=${trendColor(c.trend)}  [${c.category}]`,
            );
          }

          logger.log(chalk.bold(`\nModels (${mdls.length}):\n`));
          if (mdls.length === 0) {
            logger.log(chalk.gray("  No models registered yet."));
          }
          for (const m of mdls) {
            logger.log(
              `  ${chalk.cyan(m.id.padEnd(20))} type=${m.type}  accuracy=${m.accuracy.toFixed(4)}  data=${m.dataPoints}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // evolution export <model-id>
  evolution
    .command("export")
    .description("Export a model for portability")
    .argument("<model-id>", "Model ID to export")
    .option("--json", "Output as JSON")
    .action(async (modelId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const result = exportModel(db, modelId);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.bold(`Exported Model: ${result.name}`));
          logger.log(`  ID:         ${result.id}`);
          logger.log(`  Type:       ${result.type}`);
          logger.log(`  Accuracy:   ${result.accuracy.toFixed(4)}`);
          logger.log(`  Data Points: ${result.dataPoints}`);
          logger.log(`  Exported:   ${result.exportedAt}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════════════
  // Phase 100 — Self-Evolving AI V2 subcommands
  // ═══════════════════════════════════════════════════════════

  evolution
    .command("dimensions")
    .description("List CAPABILITY_DIMENSION enum")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = Object.values(CAPABILITY_DIMENSION);
      if (options.json) console.log(JSON.stringify(list, null, 2));
      else list.forEach((d) => logger.log(d));
    });

  evolution
    .command("severities")
    .description("List DIAGNOSIS_SEVERITY enum")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = Object.values(DIAGNOSIS_SEVERITY);
      if (options.json) console.log(JSON.stringify(list, null, 2));
      else list.forEach((d) => logger.log(d));
    });

  evolution
    .command("strategies")
    .description("List REPAIR_STRATEGY enum")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = Object.values(REPAIR_STRATEGY);
      if (options.json) console.log(JSON.stringify(list, null, 2));
      else list.forEach((d) => logger.log(d));
    });

  evolution
    .command("milestones")
    .description("List GROWTH_MILESTONE enum")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = Object.values(GROWTH_MILESTONE);
      if (options.json) console.log(JSON.stringify(list, null, 2));
      else list.forEach((d) => logger.log(d));
    });

  evolution
    .command("assess-v2")
    .description("Assess capability by canonical dimension")
    .argument("<dimension>", "Dimension (use `evolution dimensions`)")
    .argument("<score>", "Score 0..1")
    .option("-m, --metadata <json>", "Metadata JSON", "{}")
    .option("--json", "Output as JSON")
    .action((dimension, score, options) => {
      try {
        const metadata = JSON.parse(options.metadata);
        const r = assessCapabilityV2({
          dimension,
          score: parseFloat(score),
          metadata,
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else {
          logger.log(chalk.bold(`Capability ${r.dimension}`));
          logger.log(`  Score:     ${r.score}`);
          logger.log(`  Previous:  ${r.previousScore}`);
          logger.log(`  Trend:     ${r.trend}`);
          logger.log(`  Samples:   ${r.sampleCount}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  evolution
    .command("capabilities-v2")
    .description("List V2 capabilities")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = listCapabilitiesV2();
      if (options.json) console.log(JSON.stringify(list, null, 2));
      else {
        if (list.length === 0) logger.log("(no capabilities)");
        for (const c of list) {
          logger.log(
            `${c.dimension.padEnd(14)} score=${c.score.toFixed(3)} trend=${c.trend} samples=${c.sampleCount}`,
          );
        }
      }
    });

  evolution
    .command("train-v2")
    .description("Record V2 incremental training run")
    .requiredOption(
      "-s, --strategy <s>",
      "replay|elastic-weight|knowledge-distill",
    )
    .requiredOption("--data-size <n>", "Data size")
    .requiredOption("--loss-before <n>", "Loss before training")
    .requiredOption("--loss-after <n>", "Loss after training")
    .option("--duration-ms <n>", "Duration in ms", "0")
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const r = trainIncrementalV2({
          strategy: options.strategy,
          dataSize: parseFloat(options.dataSize),
          lossBefore: parseFloat(options.lossBefore),
          lossAfter: parseFloat(options.lossAfter),
          durationMs: parseFloat(options.durationMs),
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else {
          logger.log(chalk.bold(`Training ${r.id}`));
          logger.log(`  Strategy:          ${r.strategy}`);
          logger.log(`  KnowledgeRetention ${r.knowledgeRetention.toFixed(4)}`);
          logger.log(`  Status:            ${r.status}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  evolution
    .command("training-log-v2")
    .description("List V2 training runs")
    .option("-s, --strategy <s>", "Filter by strategy")
    .option("-l, --limit <n>", "Limit")
    .option("--json", "Output as JSON")
    .action((options) => {
      const limit = options.limit ? parseInt(options.limit, 10) : undefined;
      const list = listTrainingLogV2({ strategy: options.strategy, limit });
      if (options.json) console.log(JSON.stringify(list, null, 2));
      else {
        if (list.length === 0) logger.log("(no training log)");
        for (const t of list) {
          logger.log(
            `${new Date(t.createdAt).toISOString()} ${t.strategy.padEnd(20)} retention=${t.knowledgeRetention.toFixed(3)} status=${t.status}`,
          );
        }
      }
    });

  evolution
    .command("diagnose-v2")
    .description("Run V2 self-diagnosis")
    .option("--scope <s>", "Scope", "system")
    .option("--depth <d>", "Depth", "shallow")
    .option("--json", "Output as JSON")
    .action((options) => {
      const r = selfDiagnoseV2({ scope: options.scope, depth: options.depth });
      if (options.json) console.log(JSON.stringify(r, null, 2));
      else {
        logger.log(chalk.bold(`Diagnosis ${r.id}`));
        logger.log(`  Severity:        ${r.severity}`);
        logger.log(`  AnomaliesFound:  ${r.anomaliesDetected}`);
        if (r.rootCause) logger.log(`  RootCause:       ${r.rootCause}`);
        if (r.repairSuggestion)
          logger.log(`  RepairSuggestion ${r.repairSuggestion}`);
      }
    });

  evolution
    .command("diagnoses-v2")
    .description("List V2 diagnoses")
    .option("-s, --severity <s>", "Filter by severity")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = listDiagnosesV2({ severity: options.severity });
      if (options.json) console.log(JSON.stringify(list, null, 2));
      else {
        if (list.length === 0) logger.log("(no diagnoses)");
        for (const d of list) {
          logger.log(
            `${d.id} severity=${d.severity} anomalies=${d.anomaliesDetected} status=${d.repairStatus}`,
          );
        }
      }
    });

  evolution
    .command("diagnosis-show")
    .description("Show a specific diagnosis")
    .argument("<id>", "Diagnosis ID")
    .option("--json", "Output as JSON")
    .action((id, options) => {
      const d = getDiagnosisV2(id);
      if (!d) {
        logger.error(`Diagnosis not found: ${id}`);
        process.exit(1);
      }
      if (options.json) console.log(JSON.stringify(d, null, 2));
      else {
        logger.log(chalk.bold(`Diagnosis ${d.id}`));
        logger.log(`  Scope:           ${d.scope}`);
        logger.log(`  Severity:        ${d.severity}`);
        logger.log(`  AnomaliesFound:  ${d.anomaliesDetected}`);
        logger.log(`  RepairStatus:    ${d.repairStatus}`);
      }
    });

  evolution
    .command("repair-v2")
    .description("Apply V2 self-repair to a diagnosis")
    .argument("<diagnosis-id>", "Diagnosis ID")
    .requiredOption(
      "-s, --strategy <s>",
      "parameter_tune|model_rollback|cache_rebuild|full_reset",
    )
    .option("--json", "Output as JSON")
    .action((diagnosisId, options) => {
      try {
        const r = selfRepairV2({ diagnosisId, strategy: options.strategy });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else {
          logger.log(chalk.green(`Repaired ${r.diagnosisId}`));
          logger.log(`  Strategy: ${r.strategy}`);
          for (const a of r.actions) logger.log(`  - ${a}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  evolution
    .command("predict-v2")
    .description("V2 behavior prediction")
    .option("--horizon-ms <n>", "Time horizon in ms")
    .option("--json", "Output as JSON")
    .action((options) => {
      const horizon = options.horizonMs
        ? parseFloat(options.horizonMs)
        : undefined;
      const r = predictBehaviorV2({ timeHorizonMs: horizon });
      if (options.json) console.log(JSON.stringify(r, null, 2));
      else {
        logger.log(chalk.bold("Prediction"));
        logger.log(`  Horizon:    ${r.horizonMs}ms`);
        logger.log(`  Confidence: ${r.confidence}`);
        for (const p of r.predictions) {
          logger.log(`  ${p.type.padEnd(24)} p=${p.probability}`);
        }
      }
    });

  evolution
    .command("record-milestone")
    .description("Record a growth milestone explicitly")
    .argument("<type>", "Milestone type (use `evolution milestones`)")
    .requiredOption("-d, --description <s>", "Description")
    .option("--capability-id <id>", "Capability ID")
    .option("-m, --details <json>", "Details JSON", "{}")
    .option("--json", "Output as JSON")
    .action((type, options) => {
      try {
        const details = JSON.parse(options.details);
        const r = recordMilestone({
          type,
          description: options.description,
          capabilityId: options.capabilityId || null,
          details,
        });
        if (options.json) console.log(JSON.stringify(r, null, 2));
        else {
          logger.log(chalk.green(`Milestone ${r.id}`));
          logger.log(`  Type:        ${r.type}`);
          logger.log(`  Description: ${r.description}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  evolution
    .command("growth-v2")
    .description("List V2 growth milestones")
    .option("-t, --type <t>", "Filter by milestone type")
    .option("--from <ms>", "From timestamp (ms)")
    .option("--to <ms>", "To timestamp (ms)")
    .option("-l, --limit <n>", "Limit")
    .option("--json", "Output as JSON")
    .action((options) => {
      const period = {};
      if (options.from) period.fromMs = parseFloat(options.from);
      if (options.to) period.toMs = parseFloat(options.to);
      const list = getGrowthLogV2({
        milestoneType: options.type,
        period: Object.keys(period).length ? period : undefined,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
      if (options.json) console.log(JSON.stringify(list, null, 2));
      else {
        if (list.length === 0) logger.log("(no milestones)");
        for (const m of list) {
          logger.log(
            `${new Date(m.timestamp).toISOString()} ${m.type.padEnd(24)} ${m.description}`,
          );
        }
      }
    });

  evolution
    .command("configure")
    .description("Update evolution config")
    .requiredOption("-k, --key <k>", "Config key")
    .requiredOption("-v, --value <v>", "Config value")
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        let value = options.value;
        // Coerce booleans and numbers for typed keys
        if (value === "true") value = true;
        else if (value === "false") value = false;
        else if (!Number.isNaN(Number(value)) && value !== "") {
          const asNum = Number(value);
          if (Number.isFinite(asNum) && String(asNum) === value) value = asNum;
        }
        const c = configureEvolution({ key: options.key, value });
        if (options.json) console.log(JSON.stringify(c, null, 2));
        else logger.log(chalk.green("Updated"));
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  evolution
    .command("config")
    .description("Show evolution config")
    .option("--json", "Output as JSON")
    .action((options) => {
      const c = getEvolutionConfig();
      if (options.json) console.log(JSON.stringify(c, null, 2));
      else {
        for (const [k, v] of Object.entries(c)) {
          logger.log(`${k.padEnd(30)} ${Array.isArray(v) ? v.join(",") : v}`);
        }
      }
    });

  evolution
    .command("stats-v2")
    .description("V2 evolution stats")
    .option("--json", "Output as JSON")
    .action((options) => {
      const s = getEvolutionStatsV2();
      if (options.json) console.log(JSON.stringify(s, null, 2));
      else {
        logger.log(chalk.bold("Evolution Stats V2"));
        logger.log(`  Capabilities: ${s.capabilityCount}`);
        logger.log(`  TrainingRuns: ${s.trainingRuns}`);
        logger.log(
          `  Diagnoses:    ${s.diagnoses.total} (${Object.entries(
            s.diagnoses.bySeverity,
          )
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")})`,
        );
        logger.log(
          `  Milestones:   ${s.milestones.total} (${Object.entries(
            s.milestones.byType,
          )
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")})`,
        );
      }
    });
}
