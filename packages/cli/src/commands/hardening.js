/**
 * Hardening commands
 * chainlesschain hardening baseline|audit
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureHardeningTables,
  collectBaseline,
  compareBaseline,
  listBaselines,
  runAudit,
  getAuditReports,
  getAuditReport,
} from "../lib/hardening-manager.js";

export function registerHardeningCommand(program) {
  const hardening = program
    .command("hardening")
    .description(
      "Security hardening — baselines, audits, regression detection",
    );

  // baseline subcommands
  const baseline = hardening
    .command("baseline")
    .description("Performance baseline management");

  baseline
    .command("collect <name>")
    .description("Collect a performance baseline")
    .option("-v, --version <version>", "Baseline version", "1.0.0")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureHardeningTables(db);

        const result = collectBaseline(db, name, options.version);
        logger.success("Baseline collected");
        logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(result.id)}`);
        logger.log(`  ${chalk.bold("Name:")}    ${result.name}`);
        logger.log(`  ${chalk.bold("Version:")} ${result.version}`);
        logger.log(`  ${chalk.bold("Status:")}  ${result.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  baseline
    .command("compare <baseline-id>")
    .description("Compare baseline against current or another baseline")
    .option("-c, --current <id>", "Current baseline ID to compare against")
    .option("--json", "Output as JSON")
    .action(async (baselineId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureHardeningTables(db);

        const result = compareBaseline(baselineId, options.current);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Regressions:")} ${result.hasRegressions ? chalk.red("Yes") : chalk.green("No")}`,
          );
          logger.log(`  ${chalk.bold("Summary:")}     ${result.summary}`);
          for (const r of result.regressions) {
            logger.log(
              `    ${chalk.yellow(r.metric)}: ${r.ratio.toFixed(2)}x (threshold: ${r.threshold}x)`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  baseline
    .command("list")
    .description("List collected baselines")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureHardeningTables(db);

        const baselines = listBaselines();
        if (options.json) {
          console.log(JSON.stringify(baselines, null, 2));
        } else if (baselines.length === 0) {
          logger.info("No baselines collected.");
        } else {
          for (const b of baselines) {
            logger.log(
              `  ${chalk.cyan(b.id.slice(0, 8))} ${b.name} v${b.version} [${b.status}] samples=${b.sampleCount}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // audit subcommands
  const audit = hardening
    .command("audit")
    .description("Security audit management");

  audit
    .command("run <name>")
    .description("Run a security hardening audit")
    .action(async (name) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureHardeningTables(db);

        const result = runAudit(db, name);
        logger.success(`Audit complete: score ${result.score}%`);
        logger.log(`  ${chalk.bold("ID:")}     ${chalk.cyan(result.id)}`);
        logger.log(
          `  ${chalk.bold("Passed:")} ${result.passed}/${result.checks.length}`,
        );
        logger.log(
          `  ${chalk.bold("Failed:")} ${result.failed}/${result.checks.length}`,
        );
        for (const rec of result.recommendations) {
          logger.log(`  ${chalk.yellow("→")} ${rec}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  audit
    .command("reports")
    .description("List audit reports")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureHardeningTables(db);

        const reports = getAuditReports();
        if (options.json) {
          console.log(JSON.stringify(reports, null, 2));
        } else if (reports.length === 0) {
          logger.info("No audit reports.");
        } else {
          for (const r of reports) {
            logger.log(
              `  ${chalk.cyan(r.id.slice(0, 8))} ${r.name} score=${r.score}% passed=${r.passed} failed=${r.failed}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  audit
    .command("report <audit-id>")
    .description("Show a specific audit report")
    .option("--json", "Output as JSON")
    .action(async (auditId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureHardeningTables(db);

        const report = getAuditReport(auditId);
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          logger.log(`  ${chalk.bold("ID:")}     ${chalk.cyan(report.id)}`);
          logger.log(`  ${chalk.bold("Name:")}   ${report.name}`);
          logger.log(`  ${chalk.bold("Score:")}  ${report.score}%`);
          for (const c of report.checks) {
            const icon =
              c.status === "pass" ? chalk.green("✓") : chalk.red("✗");
            logger.log(`    ${icon} ${c.name}: ${c.detail}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
