/**
 * BI commands
 * chainlesschain bi query|dashboard|report|schedule|anomaly|predict|templates
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureBITables,
  nlQuery,
  createDashboard,
  generateReport,
  scheduleReport,
  detectAnomaly,
  predictTrend,
  listTemplates,
} from "../lib/bi-engine.js";

export function registerBiCommand(program) {
  const bi = program
    .command("bi")
    .description(
      "Business intelligence — queries, dashboards, reports, analytics",
    );

  // bi query
  bi.command("query <question>")
    .description("Natural-language query (NL→SQL)")
    .option("--json", "Output as JSON")
    .action(async (question, options) => {
      try {
        const result = nlQuery(question);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success("Query translated");
          logger.log(
            `  ${chalk.bold("SQL:")}    ${chalk.cyan(result.generatedSQL)}`,
          );
          logger.log(`  ${chalk.bold("Rows:")}   ${result.rowCount}`);
          logger.log(`  ${chalk.bold("Visual:")} ${result.visualization.type}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi dashboard
  bi.command("dashboard <name>")
    .description("Create a dashboard")
    .option("--widgets <json>", "Widgets as JSON array")
    .option("--layout <json>", "Layout as JSON")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureBITables(db);

        const widgets = options.widgets ? JSON.parse(options.widgets) : [];
        const layout = options.layout ? JSON.parse(options.layout) : undefined;
        const dashboard = createDashboard(db, name, widgets, layout);

        if (options.json) {
          console.log(JSON.stringify(dashboard, null, 2));
        } else {
          logger.success(`Dashboard created: ${chalk.cyan(name)}`);
          logger.log(`  ${chalk.bold("ID:")}      ${chalk.cyan(dashboard.id)}`);
          logger.log(`  ${chalk.bold("Widgets:")} ${dashboard.widgets.length}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi report
  bi.command("report <name>")
    .description("Generate a report")
    .option("--format <pdf|excel>", "Report format", "pdf")
    .option("--sections <csv>", "Comma-separated section names")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureBITables(db);

        const sections = options.sections
          ? options.sections.split(",").map((s) => s.trim())
          : undefined;
        const report = generateReport(db, name, {
          format: options.format,
          sections,
        });

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          logger.success(`Report generated: ${chalk.cyan(name)}`);
          logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(report.id)}`);
          logger.log(`  ${chalk.bold("Format:")}   ${report.format}`);
          logger.log(`  ${chalk.bold("Sections:")} ${report.sections.length}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi schedule
  bi.command("schedule <report-id> <cron>")
    .description("Schedule a report for recurring generation")
    .option("--recipients <csv>", "Comma-separated recipient emails")
    .action(async (reportId, cron, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureBITables(db);

        const recipients = options.recipients
          ? options.recipients.split(",").map((s) => s.trim())
          : [];
        const schedule = scheduleReport(db, reportId, cron, recipients);
        logger.success("Report scheduled");
        logger.log(`  ${chalk.bold("ID:")}         ${chalk.cyan(schedule.id)}`);
        logger.log(`  ${chalk.bold("Cron:")}       ${schedule.cron}`);
        logger.log(
          `  ${chalk.bold("Recipients:")} ${schedule.recipients.length}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi anomaly
  bi.command("anomaly")
    .description("Detect anomalies in data using Z-score")
    .option("--data <json>", "Data as JSON array of numbers")
    .option("--threshold <n>", "Z-score threshold", "2")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const data = options.data ? JSON.parse(options.data) : [];
        const result = detectAnomaly(data, {
          threshold: parseFloat(options.threshold),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Mean:")}      ${result.mean.toFixed(2)}`);
          logger.log(`  ${chalk.bold("Std Dev:")}   ${result.std.toFixed(2)}`);
          logger.log(`  ${chalk.bold("Threshold:")} ${result.threshold}`);
          logger.log(
            `  ${chalk.bold("Anomalies:")} ${result.anomalies.length}`,
          );
          for (const a of result.anomalies) {
            logger.log(
              `    [${a.index}] value=${a.value} z=${a.zScore.toFixed(2)}`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi predict
  bi.command("predict")
    .description("Predict trend using linear regression")
    .option("--data <json>", "Data as JSON array of numbers")
    .option("--periods <n>", "Number of periods to predict", "3")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const data = options.data ? JSON.parse(options.data) : [];
        const result = predictTrend(data, parseInt(options.periods));

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Trend:")}       ${chalk.cyan(result.trend)}`,
          );
          logger.log(`  ${chalk.bold("Slope:")}       ${result.slope}`);
          logger.log(
            `  ${chalk.bold("Predictions:")} ${result.predictions.join(", ")}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi templates
  bi.command("templates")
    .description("List available BI templates")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const templates = listTemplates();
        if (options.json) {
          console.log(JSON.stringify(templates, null, 2));
        } else {
          for (const t of templates) {
            logger.log(
              `  ${chalk.cyan(t.id)} ${chalk.bold(t.name)} — ${t.description}`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
