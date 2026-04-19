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
  // Phase 95 V2
  CHART_TYPE,
  ANOMALY_METHOD,
  REPORT_FORMAT,
  REPORT_STATUS,
  DASHBOARD_LAYOUT,
  nlQueryV2,
  detectAnomalyV2,
  predictTrendV2,
  recommendChart,
  createDashboardV2,
  updateReportStatus,
  getReportStatus,
  getReportStatusHistory,
  getBIStatsV2,
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

  // ─── Phase 95 V2 subcommands ──────────────────────────────

  // bi chart-types
  bi.command("chart-types")
    .description("List supported chart types (V2)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const types = Object.values(CHART_TYPE);
      if (options.json) {
        console.log(JSON.stringify(types, null, 2));
      } else {
        logger.log(chalk.bold("Chart Types:"));
        for (const t of types) logger.log(`  ${chalk.cyan(t)}`);
      }
    });

  // bi anomaly-methods
  bi.command("anomaly-methods")
    .description("List supported anomaly detection methods (V2)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const methods = Object.values(ANOMALY_METHOD);
      if (options.json) {
        console.log(JSON.stringify(methods, null, 2));
      } else {
        logger.log(chalk.bold("Anomaly Methods:"));
        for (const m of methods) logger.log(`  ${chalk.cyan(m)}`);
      }
    });

  // bi report-formats
  bi.command("report-formats")
    .description("List supported report formats (V2)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const formats = Object.values(REPORT_FORMAT);
      if (options.json) {
        console.log(JSON.stringify(formats, null, 2));
      } else {
        logger.log(chalk.bold("Report Formats:"));
        for (const f of formats) logger.log(`  ${chalk.cyan(f)}`);
      }
    });

  // bi report-statuses
  bi.command("report-statuses")
    .description("List canonical report statuses (V2)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const statuses = Object.values(REPORT_STATUS);
      if (options.json) {
        console.log(JSON.stringify(statuses, null, 2));
      } else {
        logger.log(chalk.bold("Report Statuses:"));
        for (const s of statuses) logger.log(`  ${chalk.cyan(s)}`);
      }
    });

  // bi dashboard-layouts
  bi.command("dashboard-layouts")
    .description("List supported dashboard layouts (V2)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const layouts = Object.values(DASHBOARD_LAYOUT);
      if (options.json) {
        console.log(JSON.stringify(layouts, null, 2));
      } else {
        logger.log(chalk.bold("Dashboard Layouts:"));
        for (const l of layouts) logger.log(`  ${chalk.cyan(l)}`);
      }
    });

  // bi query-v2 <question>
  bi.command("query-v2 <question>")
    .description("Heuristic NL→SQL with intent detection (V2)")
    .option("--schema <json>", "Schema hint as JSON, e.g. '{\"tables\":[...]}'")
    .option("--json", "Output as JSON")
    .action((question, options) => {
      try {
        const schema = options.schema ? JSON.parse(options.schema) : undefined;
        const result = nlQueryV2({ query: question, schema });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Intent: ${chalk.cyan(result.intent)}`);
          logger.log(`  ${chalk.bold("SQL:")}    ${result.sql}`);
          logger.log(`  ${chalk.bold("Table:")}  ${result.table}`);
          logger.log(`  ${chalk.bold("Visual:")} ${result.visualization}`);
          if (result.aggregate)
            logger.log(`  ${chalk.bold("Agg:")}    ${result.aggregate}`);
          if (result.limit !== null)
            logger.log(`  ${chalk.bold("Limit:")}  ${result.limit}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi anomaly-v2
  bi.command("anomaly-v2")
    .description("Anomaly detection with method choice (V2)")
    .option("--data <json>", "Data as JSON array of numbers")
    .option("--method <m>", "Method: z_score|iqr", "z_score")
    .option("--threshold <n>", "Threshold (z_score σ or iqr multiplier)")
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const data = options.data ? JSON.parse(options.data) : [];
        const threshold =
          options.threshold !== undefined
            ? parseFloat(options.threshold)
            : undefined;
        const result = detectAnomalyV2({
          data,
          method: options.method,
          threshold,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.bold(`Method: ${result.method}`));
          logger.log(`  ${chalk.bold("Threshold:")} ${result.threshold}`);
          if (result.method === "iqr") {
            logger.log(
              `  ${chalk.bold("Q1/Q3/IQR:")} ${result.q1} / ${result.q3} / ${result.iqr}`,
            );
            logger.log(
              `  ${chalk.bold("Bounds:")}    [${result.lowerBound}, ${result.upperBound}]`,
            );
          } else {
            logger.log(`  ${chalk.bold("Mean:")}     ${result.mean}`);
            logger.log(`  ${chalk.bold("Std:")}      ${result.std}`);
          }
          logger.log(
            `  ${chalk.bold("Anomalies:")} ${result.anomalies.length}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi predict-v2
  bi.command("predict-v2")
    .description("Trend prediction with r² confidence (V2)")
    .option("--data <json>", "Data as JSON array of numbers")
    .option("--periods <n>", "Number of periods to predict", "3")
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const data = options.data ? JSON.parse(options.data) : [];
        const result = predictTrendV2({
          data,
          periods: parseInt(options.periods, 10),
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.bold(`Trend: ${chalk.cyan(result.trend)}`));
          logger.log(`  ${chalk.bold("Slope:")}       ${result.slope}`);
          logger.log(
            `  ${chalk.bold("R²:")}          ${result.r2} (${result.confidence})`,
          );
          logger.log(
            `  ${chalk.bold("Predictions:")} ${result.predictions.join(", ")}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi recommend-chart
  bi.command("recommend-chart")
    .description("Recommend chart type from intent or data shape (V2)")
    .option("--intent <text>", "User intent description")
    .option("--shape <json>", "Data shape hint as JSON")
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const shape = options.shape ? JSON.parse(options.shape) : undefined;
        const chart = recommendChart({
          intent: options.intent,
          dataShape: shape,
        });
        if (options.json) {
          console.log(JSON.stringify({ chart }, null, 2));
        } else {
          logger.log(`Recommended chart: ${chalk.cyan(chart)}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi dashboard-v2 <name>
  bi.command("dashboard-v2 <name>")
    .description("Create dashboard with validated layout (V2)")
    .option("--widgets <json>", "Widgets as JSON array", "[]")
    .option("--layout <spec>", "Layout: grid|flow|tabs OR JSON object")
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

        const widgets = JSON.parse(options.widgets);
        let layout;
        if (options.layout) {
          try {
            layout = JSON.parse(options.layout);
          } catch (_err) {
            layout = options.layout;
          }
        }
        const dashboard = createDashboardV2(db, { name, widgets, layout });
        if (options.json) {
          console.log(JSON.stringify(dashboard, null, 2));
        } else {
          logger.success(`Dashboard created: ${chalk.cyan(name)}`);
          logger.log(`  ${chalk.bold("ID:")}     ${dashboard.id}`);
          logger.log(`  ${chalk.bold("Layout:")} ${dashboard.layout.type}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi set-report-status <report-id> <status>
  bi.command("set-report-status <report-id> <status>")
    .description("Update report status with validated transition (V2)")
    .option("--json", "Output as JSON")
    .action(async (reportId, status, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureBITables(db);

        const result = updateReportStatus(db, { reportId, status });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `${chalk.cyan(reportId)}: ${result.previous} → ${chalk.bold(result.status)}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // bi report-status <report-id>
  bi.command("report-status <report-id>")
    .description("Show current report status (V2)")
    .option("--json", "Output as JSON")
    .action((reportId, options) => {
      const status = getReportStatus(reportId);
      if (options.json) {
        console.log(JSON.stringify({ reportId, status }, null, 2));
      } else {
        logger.log(`${chalk.cyan(reportId)}: ${chalk.bold(status)}`);
      }
    });

  // bi report-history <report-id>
  bi.command("report-history <report-id>")
    .description("Show report status transition history (V2)")
    .option("--json", "Output as JSON")
    .action((reportId, options) => {
      const hist = getReportStatusHistory(reportId);
      if (options.json) {
        console.log(JSON.stringify(hist, null, 2));
      } else if (hist.length === 0) {
        logger.info("No transitions recorded");
      } else {
        logger.log(chalk.bold(`History (${hist.length}):`));
        for (const h of hist) {
          logger.log(`  ${chalk.gray(h.at)}  ${h.from} → ${chalk.cyan(h.to)}`);
        }
      }
    });

  // bi stats-v2
  bi.command("stats-v2")
    .description("BI platform statistics (V2)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureBITables(db);

        const stats = getBIStatsV2(db);
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(chalk.bold("BI Stats (V2):"));
          logger.log(`  Dashboards:   ${stats.dashboards}`);
          logger.log(
            `  Reports:      ${stats.reports.total}  byStatus=${JSON.stringify(stats.reports.byStatus)}`,
          );
          logger.log(`  Scheduled:    ${stats.scheduled}`);
          logger.log(`  Templates:    ${stats.templates}`);
          logger.log(`  Chart types:  ${stats.chartTypes}`);
        }
        await shutdown();
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
  registerBiV2Command(bi);
}


import {
  BI_DATASET_MATURITY_V2,
  BI_QUERY_LIFECYCLE_V2,
  registerBiDatasetV2,
  activateBiDatasetV2,
  staleBiDatasetV2,
  archiveBiDatasetV2,
  touchBiDatasetV2,
  getBiDatasetV2,
  listBiDatasetsV2,
  createBiQueryV2,
  startBiQueryV2,
  completeBiQueryV2,
  failBiQueryV2,
  cancelBiQueryV2,
  getBiQueryV2,
  listBiQueriesV2,
  setMaxActiveBiDatasetsPerOwnerV2,
  getMaxActiveBiDatasetsPerOwnerV2,
  setMaxPendingBiQueriesPerDatasetV2,
  getMaxPendingBiQueriesPerDatasetV2,
  setBiDatasetIdleMsV2,
  getBiDatasetIdleMsV2,
  setBiQueryStuckMsV2,
  getBiQueryStuckMsV2,
  autoStaleIdleBiDatasetsV2,
  autoFailStuckBiQueriesV2,
  getBiEngineStatsV2,
} from "../lib/bi-engine.js";

export function registerBiV2Command(bi) {
  bi.command("enums-v2").description("Show V2 enums").action(() => { console.log(JSON.stringify({ BI_DATASET_MATURITY_V2, BI_QUERY_LIFECYCLE_V2 }, null, 2)); });
  bi.command("register-dataset-v2").description("Register a BI dataset profile (pending)")
    .requiredOption("--id <id>").requiredOption("--owner <owner>").option("--source <source>")
    .action((o) => { console.log(JSON.stringify(registerBiDatasetV2(o), null, 2)); });
  bi.command("activate-dataset-v2 <id>").description("Activate dataset").action((id) => { console.log(JSON.stringify(activateBiDatasetV2(id), null, 2)); });
  bi.command("stale-dataset-v2 <id>").description("Mark dataset stale").action((id) => { console.log(JSON.stringify(staleBiDatasetV2(id), null, 2)); });
  bi.command("archive-dataset-v2 <id>").description("Archive dataset (terminal)").action((id) => { console.log(JSON.stringify(archiveBiDatasetV2(id), null, 2)); });
  bi.command("touch-dataset-v2 <id>").description("Refresh lastTouchedAt").action((id) => { console.log(JSON.stringify(touchBiDatasetV2(id), null, 2)); });
  bi.command("get-dataset-v2 <id>").description("Get dataset").action((id) => { console.log(JSON.stringify(getBiDatasetV2(id), null, 2)); });
  bi.command("list-datasets-v2").description("List datasets").action(() => { console.log(JSON.stringify(listBiDatasetsV2(), null, 2)); });
  bi.command("create-query-v2").description("Create a BI query (queued)")
    .requiredOption("--id <id>").requiredOption("--dataset-id <datasetId>").option("--sql <sql>")
    .action((o) => { console.log(JSON.stringify(createBiQueryV2({ id: o.id, datasetId: o.datasetId, sql: o.sql }), null, 2)); });
  bi.command("start-query-v2 <id>").description("Transition query to running").action((id) => { console.log(JSON.stringify(startBiQueryV2(id), null, 2)); });
  bi.command("complete-query-v2 <id>").description("Transition query to completed").action((id) => { console.log(JSON.stringify(completeBiQueryV2(id), null, 2)); });
  bi.command("fail-query-v2 <id>").description("Fail query").option("--reason <r>").action((id, o) => { console.log(JSON.stringify(failBiQueryV2(id, o.reason), null, 2)); });
  bi.command("cancel-query-v2 <id>").description("Cancel query").option("--reason <r>").action((id, o) => { console.log(JSON.stringify(cancelBiQueryV2(id, o.reason), null, 2)); });
  bi.command("get-query-v2 <id>").description("Get query").action((id) => { console.log(JSON.stringify(getBiQueryV2(id), null, 2)); });
  bi.command("list-queries-v2").description("List queries").action(() => { console.log(JSON.stringify(listBiQueriesV2(), null, 2)); });
  bi.command("set-max-active-datasets-v2 <n>").description("Set per-owner active cap").action((n) => { setMaxActiveBiDatasetsPerOwnerV2(Number(n)); console.log(JSON.stringify({ maxActiveBiDatasetsPerOwner: getMaxActiveBiDatasetsPerOwnerV2() }, null, 2)); });
  bi.command("set-max-pending-queries-v2 <n>").description("Set per-dataset pending cap").action((n) => { setMaxPendingBiQueriesPerDatasetV2(Number(n)); console.log(JSON.stringify({ maxPendingBiQueriesPerDataset: getMaxPendingBiQueriesPerDatasetV2() }, null, 2)); });
  bi.command("set-dataset-idle-ms-v2 <n>").description("Set idle threshold").action((n) => { setBiDatasetIdleMsV2(Number(n)); console.log(JSON.stringify({ biDatasetIdleMs: getBiDatasetIdleMsV2() }, null, 2)); });
  bi.command("set-query-stuck-ms-v2 <n>").description("Set stuck threshold").action((n) => { setBiQueryStuckMsV2(Number(n)); console.log(JSON.stringify({ biQueryStuckMs: getBiQueryStuckMsV2() }, null, 2)); });
  bi.command("auto-stale-idle-datasets-v2").description("Auto-stale idle datasets").action(() => { console.log(JSON.stringify(autoStaleIdleBiDatasetsV2(), null, 2)); });
  bi.command("auto-fail-stuck-queries-v2").description("Auto-fail stuck running queries").action(() => { console.log(JSON.stringify(autoFailStuckBiQueriesV2(), null, 2)); });
  bi.command("gov-stats-v2").description("V2 governance aggregate stats").action(() => { console.log(JSON.stringify(getBiEngineStatsV2(), null, 2)); });
}
