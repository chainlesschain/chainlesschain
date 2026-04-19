/**
 * Compliance commands
 * chainlesschain compliance evidence|report|classify|scan|policies|check-access
 */

import fs from "fs";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureComplianceTables,
  collectEvidence,
  generateReport,
  classifyData,
  scanCompliance,
  listPolicies,
  addPolicy,
  checkAccess,
  EVIDENCE_STATUS_V2,
  POLICY_STATUS_V2,
  REPORT_STATUS_V2,
  SEVERITY_V2,
  FRAMEWORKS_V2,
  POLICY_TYPES_V2,
  COMPLIANCE_DEFAULT_MAX_ACTIVE_POLICIES,
  COMPLIANCE_DEFAULT_EVIDENCE_RETENTION_MS,
  COMPLIANCE_DEFAULT_REPORT_RETENTION_MS,
  setMaxActivePolicies,
  setEvidenceRetentionMs,
  setReportRetentionMs,
  getMaxActivePolicies,
  getEvidenceRetentionMs,
  getReportRetentionMs,
  getActivePolicyCount,
  registerEvidenceV2,
  getEvidenceStatusV2,
  setEvidenceStatusV2,
  autoExpireEvidence,
  registerPolicyV2,
  getPolicyStatusV2,
  setPolicyStatusV2,
  activatePolicy,
  registerReportV2,
  getReportStatusV2,
  setReportStatusV2,
  publishReport,
  autoArchiveStaleReports,
  getComplianceStatsV2,
} from "../lib/compliance-manager.js";
import {
  generateFrameworkReport,
  listFrameworks as listReporterFrameworks,
  getFrameworkTemplate,
} from "../lib/compliance-framework-reporter.js";
import {
  ensureThreatIntelTables,
  importStixFile,
  listIndicators,
  matchObservable,
  getStats as getThreatIntelStats,
  removeIndicator,
  FEED_MATURITY_V2,
  INDICATOR_LIFECYCLE_V2,
  getMaxActiveFeedsPerOwnerV2,
  setMaxActiveFeedsPerOwnerV2,
  getMaxActiveIndicatorsPerFeedV2,
  setMaxActiveIndicatorsPerFeedV2,
  getFeedIdleMsV2,
  setFeedIdleMsV2,
  getIndicatorStaleMsV2,
  setIndicatorStaleMsV2,
  getActiveFeedCountV2,
  getActiveIndicatorCountV2,
  registerFeedV2,
  getFeedV2,
  listFeedsV2,
  setFeedMaturityV2,
  trustFeedV2,
  deprecateFeedV2,
  retireFeedV2,
  touchFeedV2,
  createIndicatorV2,
  getIndicatorV2,
  listIndicatorsV2,
  setIndicatorStatusV2,
  activateIndicatorV2,
  expireIndicatorV2,
  revokeIndicatorV2,
  supersedeIndicatorV2,
  refreshIndicatorV2,
  autoDeprecateIdleFeedsV2,
  autoExpireStaleIndicatorsV2,
  getThreatIntelStatsV2,
} from "../lib/threat-intel.js";
import { IOC_TYPES } from "../lib/stix-parser.js";
import {
  ensureUebaTables,
  buildBaseline,
  saveBaselines,
  loadBaseline,
  loadAllBaselines,
  detectAnomalies,
  rankEntities,
  scoreEvent,
  BASELINE_MATURITY_V2,
  INVESTIGATION_V2,
  getMaxActiveBaselinesPerOwnerV2,
  setMaxActiveBaselinesPerOwnerV2,
  getMaxOpenInvestigationsPerAnalystV2,
  setMaxOpenInvestigationsPerAnalystV2,
  getBaselineStaleMsV2,
  setBaselineStaleMsV2,
  getInvestigationStuckMsV2,
  setInvestigationStuckMsV2,
  getActiveBaselineCountV2,
  getOpenInvestigationCountV2,
  createBaselineV2,
  getBaselineV2,
  listBaselinesV2,
  setBaselineMaturityV2,
  activateBaselineV2,
  markBaselineStaleV2,
  archiveBaselineV2,
  refreshBaselineV2,
  openInvestigationV2,
  getInvestigationV2,
  listInvestigationsV2,
  setInvestigationStatusV2,
  startInvestigationV2,
  closeInvestigationV2,
  dismissInvestigationV2,
  escalateInvestigationV2,
  autoMarkStaleBaselinesV2,
  autoEscalateStuckInvestigationsV2,
  getUebaStatsV2,
} from "../lib/ueba.js";

function _loadEvidenceFromDb(db, framework) {
  return db
    .prepare(
      `SELECT id, framework, type, description, source, status, collected_at
         FROM compliance_evidence
        WHERE framework = ?`,
    )
    .all(framework)
    .map((r) => ({
      id: r.id,
      framework: r.framework,
      type: r.type,
      description: r.description,
      source: r.source,
      status: r.status,
      collectedAt: r.collected_at,
    }));
}

function _loadPoliciesFromDb(db, framework) {
  return db
    .prepare(
      `SELECT id, name, type, framework, rules, enabled, severity, created_at
         FROM compliance_policies
        WHERE framework = ? AND enabled = 1`,
    )
    .all(framework)
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      framework: r.framework,
      rules: r.rules ? JSON.parse(r.rules) : {},
      enabled: !!r.enabled,
      severity: r.severity,
      createdAt: r.created_at,
    }));
}

export function registerComplianceCommand(program) {
  const compliance = program
    .command("compliance")
    .description(
      "Compliance management — evidence, reports, scanning, policies",
    );

  // compliance evidence
  compliance
    .command("evidence <framework>")
    .description("Collect compliance evidence (gdpr, soc2, hipaa, iso27001)")
    .option("-t, --type <type>", "Evidence type", "general")
    .option("-d, --description <text>", "Evidence description")
    .option("-s, --source <source>", "Evidence source", "cli")
    .action(async (framework, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureComplianceTables(db);

        const result = collectEvidence(
          db,
          framework,
          options.type,
          options.description,
          options.source,
        );
        logger.success("Evidence collected");
        logger.log(`  ${chalk.bold("ID:")}        ${chalk.cyan(result.id)}`);
        logger.log(`  ${chalk.bold("Framework:")} ${result.framework}`);
        logger.log(`  ${chalk.bold("Type:")}      ${result.type}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance report
  compliance
    .command("report <framework>")
    .description(
      "Generate compliance report (frameworks: soc2, iso27001, gdpr, hipaa)",
    )
    .option("-t, --title <title>", "Report title")
    .option(
      "-f, --format <fmt>",
      "Output format: summary | md | html | json",
      "summary",
    )
    .option("-o, --output <path>", "Write report to file instead of stdout")
    .option(
      "--detailed",
      "Use framework-aware template reporter (SOC2/ISO27001/GDPR)",
    )
    .option("--json", "Alias for --format=json (backwards-compat)")
    .action(async (framework, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureComplianceTables(db);

        const fmt = options.json ? "json" : options.format;
        const useDetailed =
          options.detailed ||
          fmt === "md" ||
          fmt === "markdown" ||
          fmt === "html" ||
          !!options.output;

        // Fast path — legacy generic report for backwards-compat.
        if (!useDetailed && fmt === "summary") {
          const result = generateReport(db, framework, options.title);
          logger.success("Report generated");
          logger.log(`  ${chalk.bold("ID:")}        ${chalk.cyan(result.id)}`);
          logger.log(`  ${chalk.bold("Title:")}     ${result.title}`);
          logger.log(`  ${chalk.bold("Score:")}     ${result.score}`);
          logger.log(`  ${chalk.bold("Summary:")}   ${result.summary}`);
          await shutdown();
          return;
        }

        if (!getFrameworkTemplate(framework)) {
          logger.error(
            `Framework "${framework}" has no detailed template. ` +
              `Available: ${listReporterFrameworks().join(", ")}.`,
          );
          process.exit(1);
        }

        const evidence = _loadEvidenceFromDb(db, framework);
        const policies = _loadPoliciesFromDb(db, framework);

        const { analysis, body, format } = generateFrameworkReport(framework, {
          evidence,
          policies,
          format: fmt === "summary" ? "markdown" : fmt,
        });

        if (options.output) {
          fs.writeFileSync(options.output, body, "utf-8");
          logger.success(
            `Report written to ${chalk.cyan(options.output)} ` +
              `(${format}, ${body.length} bytes)`,
          );
          logger.log(
            `  ${chalk.bold("Score:")}   ${analysis.score}/100  ` +
              chalk.dim(`(${analysis.summary})`),
          );
        } else {
          process.stdout.write(body);
          if (!body.endsWith("\n")) process.stdout.write("\n");
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance frameworks (list templates)
  compliance
    .command("frameworks")
    .description("List supported report frameworks")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const frameworks = listReporterFrameworks().map((id) => {
        const t = getFrameworkTemplate(id);
        return {
          id,
          name: t.name,
          version: t.version,
          category: t.category,
          controlCount: t.controls.length,
        };
      });
      if (options.json) {
        console.log(JSON.stringify(frameworks, null, 2));
      } else {
        for (const f of frameworks) {
          logger.log(
            `  ${chalk.cyan(f.id.padEnd(10))} ${f.name} ` +
              chalk.dim(`(${f.version}, ${f.controlCount} controls)`),
          );
        }
      }
    });

  // compliance classify
  compliance
    .command("classify <content>")
    .description("Classify data sensitivity")
    .option("--json", "Output as JSON")
    .action(async (content, options) => {
      try {
        const result = classifyData(content);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Sensitive:")}       ${result.hasClassifiedData ? "Yes" : "No"}`,
          );
          logger.log(
            `  ${chalk.bold("Classifications:")} ${result.classifications.join(", ") || "none"}`,
          );
          logger.log(
            `  ${chalk.bold("Sensitivity:")}     ${result.sensitivity}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance scan
  compliance
    .command("scan <framework>")
    .description("Scan compliance posture against policies")
    .option("--json", "Output as JSON")
    .action(async (framework, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureComplianceTables(db);

        const result = scanCompliance(db, framework);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Framework:")} ${result.framework}`);
          logger.log(`  ${chalk.bold("Score:")}     ${result.score}%`);
          logger.log(
            `  ${chalk.bold("Passed:")}    ${result.passed}/${result.total}`,
          );
          logger.log(
            `  ${chalk.bold("Failed:")}    ${result.failed}/${result.total}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance policies
  compliance
    .command("policies")
    .description("List compliance policies")
    .option("--framework <fw>", "Filter by framework")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureComplianceTables(db);

        const policies = listPolicies(db, { framework: options.framework });
        if (options.json) {
          console.log(JSON.stringify(policies, null, 2));
        } else if (policies.length === 0) {
          logger.info("No policies configured.");
        } else {
          for (const p of policies) {
            logger.log(
              `  ${chalk.cyan(p.id.slice(0, 8))} ${p.name} [${p.type}] ${p.framework} severity=${p.severity}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance check-access
  compliance
    .command("check-access <resource> <action> <role>")
    .description("Check RBAC access permission")
    .option("--json", "Output as JSON")
    .action(async (resource, action, role, options) => {
      try {
        const result = checkAccess(resource, action, role);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Access:")} ${result.granted ? chalk.green("GRANTED") : chalk.red("DENIED")} (${role} → ${action} on ${resource})`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // compliance threat-intel
  const threat = compliance
    .command("threat-intel")
    .description(
      "Threat-intelligence IoC store — STIX 2.1 import, list, match",
    );

  threat
    .command("import <file>")
    .description("Import a STIX 2.1 bundle JSON file")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureThreatIntelTables(db);

        const result = importStixFile(db, file);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Imported ${chalk.cyan(result.imported)} new, ` +
              `${chalk.cyan(result.updated)} updated, ` +
              `${chalk.dim(result.skipped)} skipped ` +
              chalk.dim(`(of ${result.total} indicators)`),
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  threat
    .command("list")
    .description("List stored indicators")
    .option("-t, --type <type>", `Filter by IOC type (${IOC_TYPES.join("|")})`)
    .option("--limit <n>", "Max rows", "100")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureThreatIntelTables(db);

        const rows = listIndicators(db, {
          type: options.type,
          limit: Number(options.limit) || 100,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No indicators stored.");
        } else {
          for (const r of rows) {
            const labels = r.labels.length ? ` [${r.labels.join(",")}]` : "";
            logger.log(
              `  ${chalk.cyan(r.type.padEnd(12))} ${r.value}` +
                chalk.dim(labels) +
                (r.sourceName ? chalk.dim(`  ← ${r.sourceName}`) : ""),
            );
          }
          logger.log(chalk.dim(`  (${rows.length} shown)`));
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  threat
    .command("match <observable>")
    .description("Check whether a value matches a stored indicator")
    .option("--json", "Output as JSON")
    .action(async (observable, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureThreatIntelTables(db);

        const result = matchObservable(db, observable);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.matched) {
          logger.log(
            `  ${chalk.red("⚠ MATCH")} ` +
              `${chalk.cyan(result.type)} ${observable}` +
              (result.indicator.sourceName
                ? chalk.dim(`  ← ${result.indicator.sourceName}`)
                : ""),
          );
          if (result.indicator.labels.length) {
            logger.log(
              chalk.dim(`    labels: ${result.indicator.labels.join(", ")}`),
            );
          }
        } else if (result.type === "unknown") {
          logger.warn(`Observable type could not be classified.`);
          // match result already includes matched:false via JSON path
        } else {
          logger.log(
            `  ${chalk.green("✓ clean")} ${chalk.cyan(result.type)} ${observable}`,
          );
        }
        await shutdown();
        if (result.matched) process.exit(2);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  threat
    .command("stats")
    .description("Show indicator counts per type")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureThreatIntelTables(db);

        const stats = getThreatIntelStats(db);
        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Total:")} ${stats.total}`);
          for (const [t, n] of Object.entries(stats.byType)) {
            logger.log(`  ${chalk.cyan(t.padEnd(12))} ${n}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  threat
    .command("remove <type> <value>")
    .description("Remove a single indicator")
    .option("--json", "Output as JSON")
    .action(async (type, value, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureThreatIntelTables(db);

        const removed = removeIndicator(db, type, value);
        if (options.json) {
          console.log(JSON.stringify({ removed }, null, 2));
        } else if (removed) {
          logger.success(`Removed ${chalk.cyan(type)} ${value}`);
        } else {
          logger.info(`No indicator matched ${type} ${value}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ═══ Threat-Intel V2 — feed maturity + indicator lifecycle ═══ */

  threat
    .command("feed-maturities-v2")
    .description("List feed maturity states (V2)")
    .action(() => {
      for (const v of Object.values(FEED_MATURITY_V2)) console.log(`  ${v}`);
    });

  threat
    .command("indicator-lifecycles-v2")
    .description("List indicator lifecycle states (V2)")
    .action(() => {
      for (const v of Object.values(INDICATOR_LIFECYCLE_V2))
        console.log(`  ${v}`);
    });

  threat
    .command("stats-v2")
    .description("Show V2 feed/indicator stats")
    .action(() => {
      console.log(JSON.stringify(getThreatIntelStatsV2(), null, 2));
    });

  threat
    .command("max-active-feeds-per-owner")
    .argument("[n]", "New cap")
    .description("Get/set max active feeds per owner (V2)")
    .action((n) => {
      if (n !== undefined) setMaxActiveFeedsPerOwnerV2(n);
      console.log(getMaxActiveFeedsPerOwnerV2());
    });

  threat
    .command("max-active-indicators-per-feed")
    .argument("[n]", "New cap")
    .description("Get/set max active indicators per feed (V2)")
    .action((n) => {
      if (n !== undefined) setMaxActiveIndicatorsPerFeedV2(n);
      console.log(getMaxActiveIndicatorsPerFeedV2());
    });

  threat
    .command("feed-idle-ms")
    .argument("[ms]", "New idle window")
    .description("Get/set feed idle window ms (V2)")
    .action((ms) => {
      if (ms !== undefined) setFeedIdleMsV2(ms);
      console.log(getFeedIdleMsV2());
    });

  threat
    .command("indicator-stale-ms")
    .argument("[ms]", "New stale window")
    .description("Get/set indicator stale window ms (V2)")
    .action((ms) => {
      if (ms !== undefined) setIndicatorStaleMsV2(ms);
      console.log(getIndicatorStaleMsV2());
    });

  threat
    .command("active-feed-count-v2 <owner>")
    .description("Count active feeds for owner (V2)")
    .action((owner) => {
      console.log(getActiveFeedCountV2(owner));
    });

  threat
    .command("active-indicator-count-v2 <feedId>")
    .description("Count active indicators for feed (V2)")
    .action((feedId) => {
      console.log(getActiveIndicatorCountV2(feedId));
    });

  threat
    .command("register-feed-v2 <id>")
    .requiredOption("-o, --owner <owner>", "Owner")
    .requiredOption("-n, --name <name>", "Feed name")
    .description("Register a new pending feed (V2)")
    .action((id, opts) => {
      console.log(
        JSON.stringify(
          registerFeedV2(id, { owner: opts.owner, name: opts.name }),
          null,
          2,
        ),
      );
    });

  threat
    .command("feed-v2 <id>")
    .description("Show feed by id (V2)")
    .action((id) => {
      const f = getFeedV2(id);
      if (!f) {
        console.error(`feed ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(f, null, 2));
    });

  threat
    .command("list-feeds-v2")
    .option("-o, --owner <owner>", "Filter by owner")
    .option("-m, --maturity <m>", "Filter by maturity")
    .description("List feeds (V2)")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listFeedsV2({ owner: opts.owner, maturity: opts.maturity }),
          null,
          2,
        ),
      );
    });

  threat
    .command("set-feed-maturity-v2 <id> <next>")
    .description("Transition feed maturity (V2)")
    .action((id, next) => {
      console.log(JSON.stringify(setFeedMaturityV2(id, next), null, 2));
    });

  threat
    .command("trust-feed-v2 <id>")
    .description("Trust feed (V2)")
    .action((id) => {
      console.log(JSON.stringify(trustFeedV2(id), null, 2));
    });

  threat
    .command("deprecate-feed-v2 <id>")
    .description("Deprecate feed (V2)")
    .action((id) => {
      console.log(JSON.stringify(deprecateFeedV2(id), null, 2));
    });

  threat
    .command("retire-feed-v2 <id>")
    .description("Retire feed terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(retireFeedV2(id), null, 2));
    });

  threat
    .command("touch-feed-v2 <id>")
    .description("Update feed lastSeenAt (V2)")
    .action((id) => {
      console.log(JSON.stringify(touchFeedV2(id), null, 2));
    });

  threat
    .command("create-indicator-v2 <id>")
    .requiredOption("-f, --feed <feedId>", "Feed id")
    .requiredOption("-t, --type <iocType>", "IoC type")
    .requiredOption("-v, --value <value>", "IoC value")
    .description("Create a pending indicator under a feed (V2)")
    .action((id, opts) => {
      console.log(
        JSON.stringify(
          createIndicatorV2(id, {
            feedId: opts.feed,
            iocType: opts.type,
            value: opts.value,
          }),
          null,
          2,
        ),
      );
    });

  threat
    .command("indicator-v2 <id>")
    .description("Show indicator by id (V2)")
    .action((id) => {
      const i = getIndicatorV2(id);
      if (!i) {
        console.error(`indicator ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(i, null, 2));
    });

  threat
    .command("list-indicators-v2")
    .option("-f, --feed <feedId>", "Filter by feedId")
    .option("-s, --status <s>", "Filter by status")
    .description("List indicators (V2)")
    .action((opts) => {
      console.log(
        JSON.stringify(
          listIndicatorsV2({ feedId: opts.feed, status: opts.status }),
          null,
          2,
        ),
      );
    });

  threat
    .command("set-indicator-status-v2 <id> <next>")
    .description("Transition indicator status (V2)")
    .action((id, next) => {
      console.log(JSON.stringify(setIndicatorStatusV2(id, next), null, 2));
    });

  threat
    .command("activate-indicator-v2 <id>")
    .description("Activate indicator (V2)")
    .action((id) => {
      console.log(JSON.stringify(activateIndicatorV2(id), null, 2));
    });

  threat
    .command("expire-indicator-v2 <id>")
    .description("Expire indicator terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(expireIndicatorV2(id), null, 2));
    });

  threat
    .command("revoke-indicator-v2 <id>")
    .description("Revoke indicator terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(revokeIndicatorV2(id), null, 2));
    });

  threat
    .command("supersede-indicator-v2 <id>")
    .description("Supersede indicator terminally (V2)")
    .action((id) => {
      console.log(JSON.stringify(supersedeIndicatorV2(id), null, 2));
    });

  threat
    .command("refresh-indicator-v2 <id>")
    .description("Update indicator lastSeenAt (V2)")
    .action((id) => {
      console.log(JSON.stringify(refreshIndicatorV2(id), null, 2));
    });

  threat
    .command("auto-deprecate-idle-feeds")
    .description("Auto-deprecate trusted feeds idle past window (V2)")
    .action(() => {
      console.log(JSON.stringify(autoDeprecateIdleFeedsV2(), null, 2));
    });

  threat
    .command("auto-expire-stale-indicators")
    .description("Auto-expire active indicators stale past window (V2)")
    .action(() => {
      console.log(JSON.stringify(autoExpireStaleIndicatorsV2(), null, 2));
    });

  // ── UEBA ────────────────────────────────────────────────────
  const ueba = compliance
    .command("ueba")
    .description("User and Entity Behavior Analytics over audit_log events");

  const _loadAuditEvents = (db, { entity, days } = {}) => {
    const sql = entity
      ? `SELECT actor, operation, target, success, created_at
           FROM audit_log
          WHERE actor = ?`
      : `SELECT actor, operation, target, success, created_at
           FROM audit_log`;
    const rows = entity ? db.prepare(sql).all(entity) : db.prepare(sql).all();

    const cutoff = days
      ? Date.now() - Number(days) * 24 * 60 * 60 * 1000
      : null;

    return rows
      .filter((r) => {
        if (!cutoff) return true;
        const t = new Date(r.created_at).getTime();
        return Number.isFinite(t) && t >= cutoff;
      })
      .map((r) => ({
        entity: r.actor,
        action: r.operation,
        resource: r.target,
        timestamp: r.created_at,
        success: r.success === 1 || r.success === true,
      }));
  };

  ueba
    .command("baseline")
    .description("Build and persist per-entity baselines from audit_log")
    .option("-e, --entity <entity>", "Only baseline this entity")
    .option("-d, --days <n>", "Limit to events from last N days")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureUebaTables(db);

        const events = _loadAuditEvents(db, {
          entity: options.entity,
          days: options.days,
        });
        const baselineMap = buildBaseline(events);
        const saved = saveBaselines(db, baselineMap);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                saved,
                entities: [...baselineMap.keys()],
                events: events.length,
              },
              null,
              2,
            ),
          );
        } else {
          logger.success(
            `Built ${saved} baseline(s) from ${events.length} events.`,
          );
          for (const [entity, b] of baselineMap) {
            logger.log(
              `  ${chalk.cyan(entity.padEnd(24))} ` +
                `events=${b.eventCount} failures=${b.failureCount} ` +
                `actions=${b.uniqueActions} resources=${b.uniqueResources}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ueba
    .command("analyze")
    .description(
      "Score recent audit_log events against stored baselines; print anomalies",
    )
    .option("-e, --entity <entity>", "Only analyze this entity")
    .option("-t, --threshold <n>", "Anomaly score threshold (default 0.7)")
    .option("-d, --days <n>", "Candidate window in days (default 1)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureUebaTables(db);

        const threshold = options.threshold ? Number(options.threshold) : 0.7;
        const candidates = _loadAuditEvents(db, {
          entity: options.entity,
          days: options.days || 1,
        });

        const baselineMap = options.entity
          ? (() => {
              const m = new Map();
              const b = loadBaseline(db, options.entity);
              if (b) m.set(options.entity, b);
              return m;
            })()
          : loadAllBaselines(db);

        if (baselineMap.size === 0) {
          logger.warn(
            "No saved baselines found. Run `cc compliance ueba baseline` first.",
          );
          if (options.json) console.log(JSON.stringify([]));
          await shutdown();
          return;
        }

        const hits = detectAnomalies(baselineMap, candidates, { threshold });
        if (options.json) {
          console.log(JSON.stringify(hits, null, 2));
        } else if (hits.length === 0) {
          logger.info(
            `No anomalies above ${threshold} (scanned ${candidates.length} events).`,
          );
        } else {
          logger.log(
            `${chalk.yellow(`⚠ ${hits.length} anomal${hits.length === 1 ? "y" : "ies"}`)}` +
              ` (threshold=${threshold}, scanned ${candidates.length}):`,
          );
          for (const h of hits) {
            const score = h.score.toFixed(2);
            logger.log(
              `  ${chalk.red(score)} ${chalk.cyan(h.event.entity.padEnd(18))}` +
                ` ${h.event.action} ${h.event.resource || ""}` +
                chalk.dim(` @ ${h.event.timestamp}`),
            );
            for (const reason of h.reasons) {
              logger.log(chalk.dim(`      · ${reason}`));
            }
          }
        }
        await shutdown();
        // CI hook: non-zero exit on anomaly hit (mirrors threat-intel match).
        if (hits && hits.length > 0) process.exit(2);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ueba
    .command("top")
    .description(
      "Rank entities by composite risk score (direct over audit_log)",
    )
    .option("-k, --top-k <n>", "Return top K entities (default 10)")
    .option("-d, --days <n>", "Window in days")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const events = _loadAuditEvents(db, { days: options.days });
        const topK = options.topK ? Number(options.topK) : 10;
        const rows = rankEntities(events, { topK });

        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No events found in the selected window.");
        } else {
          logger.log(
            `${chalk.bold("Top risky entities")} (scored over ${events.length} events):`,
          );
          for (const r of rows) {
            logger.log(
              `  ${chalk.red(String(r.riskScore).padStart(6))} ` +
                `${chalk.cyan(r.entity.padEnd(20))} ` +
                `events=${r.eventCount} failRate=${r.failureRate.toFixed(2)} ` +
                `actions=${r.uniqueActions} resources=${r.uniqueResources}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ueba
    .command("show <entity>")
    .description("Show a stored baseline for one entity")
    .option("--json", "Output as JSON")
    .action(async (entity, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureUebaTables(db);

        const b = loadBaseline(db, entity);
        if (!b) {
          if (options.json) console.log(JSON.stringify(null));
          else logger.warn(`No baseline saved for ${entity}.`);
          await shutdown();
          return;
        }

        if (options.json) {
          // Strip runtime-only Maps for JSON.
          const { actionCounts: _a, resourceCounts: _r, ...rest } = b;
          console.log(JSON.stringify(rest, null, 2));
        } else {
          logger.log(`${chalk.bold(entity)}`);
          logger.log(`  events       : ${b.eventCount}`);
          logger.log(
            `  failures     : ${b.failureCount} (rate ${b.failureRate.toFixed(2)})`,
          );
          logger.log(`  unique acts  : ${b.uniqueActions}`);
          logger.log(`  unique res   : ${b.uniqueResources}`);
          if (b.firstSeen) {
            logger.log(
              `  first seen   : ${new Date(b.firstSeen).toISOString()}`,
            );
          }
          if (b.lastSeen) {
            logger.log(
              `  last seen    : ${new Date(b.lastSeen).toISOString()}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  /* ═══════════════════════════════════════════════════════════════
     V2 SURFACE (Phase 19 canonical) — compliance V2 subcommands
     ═══════════════════════════════════════════════════════════════ */

  const parseMeta = (s) => {
    if (!s) return {};
    try {
      return JSON.parse(s);
    } catch {
      return {};
    }
  };

  compliance
    .command("evidence-statuses-v2")
    .description("List evidence V2 lifecycle states")
    .action(() => {
      for (const v of Object.values(EVIDENCE_STATUS_V2)) console.log("  " + v);
    });

  compliance
    .command("policy-statuses-v2")
    .description("List policy V2 lifecycle states")
    .action(() => {
      for (const v of Object.values(POLICY_STATUS_V2)) console.log("  " + v);
    });

  compliance
    .command("report-statuses-v2")
    .description("List report V2 lifecycle states")
    .action(() => {
      for (const v of Object.values(REPORT_STATUS_V2)) console.log("  " + v);
    });

  compliance
    .command("severities-v2")
    .description("List V2 severity buckets")
    .action(() => {
      for (const v of Object.values(SEVERITY_V2)) console.log("  " + v);
    });

  compliance
    .command("frameworks-v2")
    .description("List V2 supported frameworks")
    .action(() => {
      for (const v of FRAMEWORKS_V2) console.log("  " + v);
    });

  compliance
    .command("policy-types-v2")
    .description("List V2 supported policy types")
    .action(() => {
      for (const v of POLICY_TYPES_V2) console.log("  " + v);
    });

  compliance
    .command("default-max-active-policies")
    .description("Show default max-active-policies cap")
    .action(() => console.log(COMPLIANCE_DEFAULT_MAX_ACTIVE_POLICIES));

  compliance
    .command("max-active-policies")
    .description("Show current max-active-policies cap")
    .action(() => console.log(getMaxActivePolicies()));

  compliance
    .command("set-max-active-policies <n>")
    .description("Set max-active-policies cap")
    .action((n) => {
      try {
        console.log(setMaxActivePolicies(n));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("default-evidence-retention-ms")
    .description("Show default evidence retention (ms)")
    .action(() => console.log(COMPLIANCE_DEFAULT_EVIDENCE_RETENTION_MS));

  compliance
    .command("evidence-retention-ms")
    .description("Show current evidence retention (ms)")
    .action(() => console.log(getEvidenceRetentionMs()));

  compliance
    .command("set-evidence-retention-ms <ms>")
    .description("Set evidence retention (ms)")
    .action((ms) => {
      try {
        console.log(setEvidenceRetentionMs(ms));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("default-report-retention-ms")
    .description("Show default report retention (ms)")
    .action(() => console.log(COMPLIANCE_DEFAULT_REPORT_RETENTION_MS));

  compliance
    .command("report-retention-ms")
    .description("Show current report retention (ms)")
    .action(() => console.log(getReportRetentionMs()));

  compliance
    .command("set-report-retention-ms <ms>")
    .description("Set report retention (ms)")
    .action((ms) => {
      try {
        console.log(setReportRetentionMs(ms));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("active-policy-count")
    .description("Show current active-policy count")
    .option("-f, --framework <fw>", "Filter by framework")
    .action((options) => {
      console.log(getActivePolicyCount(options.framework));
    });

  compliance
    .command("register-evidence-v2 <evidence-id>")
    .description("Register a new V2 evidence entry (tagged COLLECTED)")
    .option("-f, --framework <fw>", "Framework (gdpr|soc2|hipaa|iso27001)")
    .option("-t, --type <type>", "Evidence type", "general")
    .option("-d, --description <desc>", "Description")
    .option("-s, --source <source>", "Source", "cli")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((evidenceId, options) => {
      try {
        const r = registerEvidenceV2(null, {
          evidenceId,
          framework: options.framework,
          type: options.type,
          description: options.description,
          source: options.source,
          metadata: parseMeta(options.metadata),
        });
        console.log(JSON.stringify(r, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("evidence-status-v2 <evidence-id>")
    .description("Show V2 evidence lifecycle entry")
    .action((evidenceId) => {
      const r = getEvidenceStatusV2(evidenceId);
      if (!r) {
        logger.warn("Evidence not found");
        process.exit(1);
      }
      console.log(JSON.stringify(r, null, 2));
    });

  compliance
    .command("set-evidence-status-v2 <evidence-id> <status>")
    .description(
      "Transition V2 evidence lifecycle (collected/verified/rejected/expired)",
    )
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata patch JSON")
    .action((evidenceId, status, options) => {
      try {
        const r = setEvidenceStatusV2(null, evidenceId, status, {
          reason: options.reason,
          metadata: options.metadata ? parseMeta(options.metadata) : undefined,
        });
        console.log(JSON.stringify(r, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("auto-expire-evidence")
    .description("Bulk-flip stale evidence to EXPIRED")
    .action(() => {
      const r = autoExpireEvidence(null, Date.now());
      console.log(JSON.stringify({ expired: r.length, entries: r }, null, 2));
    });

  compliance
    .command("register-policy-v2 <policy-id>")
    .description("Register a new V2 policy entry (tagged DRAFT)")
    .option("-n, --name <name>", "Policy name")
    .option("-t, --type <type>", "Policy type")
    .option("-f, --framework <fw>", "Framework")
    .option(
      "-s, --severity <sev>",
      "Severity (critical|high|medium|low)",
      "medium",
    )
    .option("-r, --rules <json>", "Rules JSON")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((policyId, options) => {
      try {
        const r = registerPolicyV2(null, {
          policyId,
          name: options.name,
          type: options.type,
          framework: options.framework,
          severity: options.severity,
          rules: parseMeta(options.rules),
          metadata: parseMeta(options.metadata),
        });
        console.log(JSON.stringify(r, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("policy-status-v2 <policy-id>")
    .description("Show V2 policy lifecycle entry")
    .action((policyId) => {
      const r = getPolicyStatusV2(policyId);
      if (!r) {
        logger.warn("Policy not found");
        process.exit(1);
      }
      console.log(JSON.stringify(r, null, 2));
    });

  compliance
    .command("set-policy-status-v2 <policy-id> <status>")
    .description(
      "Transition V2 policy lifecycle (draft/active/suspended/deprecated)",
    )
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "Metadata patch JSON")
    .action((policyId, status, options) => {
      try {
        const r = setPolicyStatusV2(null, policyId, status, {
          reason: options.reason,
          metadata: options.metadata ? parseMeta(options.metadata) : undefined,
        });
        console.log(JSON.stringify(r, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("activate-policy <policy-id>")
    .description("Activate a V2 policy (DRAFT→ACTIVE, enforces max-active cap)")
    .action((policyId) => {
      try {
        const r = activatePolicy(null, policyId);
        console.log(JSON.stringify(r, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("register-report-v2 <report-id>")
    .description("Register a new V2 report entry (tagged PENDING)")
    .option("-f, --framework <fw>", "Framework")
    .option("-t, --title <title>", "Title")
    .option("-m, --metadata <json>", "Metadata JSON")
    .action((reportId, options) => {
      try {
        const r = registerReportV2(null, {
          reportId,
          framework: options.framework,
          title: options.title,
          metadata: parseMeta(options.metadata),
        });
        console.log(JSON.stringify(r, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("report-status-v2 <report-id>")
    .description("Show V2 report lifecycle entry")
    .action((reportId) => {
      const r = getReportStatusV2(reportId);
      if (!r) {
        logger.warn("Report not found");
        process.exit(1);
      }
      console.log(JSON.stringify(r, null, 2));
    });

  compliance
    .command("set-report-status-v2 <report-id> <status>")
    .description(
      "Transition V2 report lifecycle (pending/generating/published/archived)",
    )
    .option("-r, --reason <reason>", "Reason")
    .option("-s, --score <n>", "Score (on publish)")
    .option("-y, --summary <text>", "Summary (on publish)")
    .option("-m, --metadata <json>", "Metadata patch JSON")
    .action((reportId, status, options) => {
      try {
        const r = setReportStatusV2(null, reportId, status, {
          reason: options.reason,
          score:
            options.score !== undefined ? Number(options.score) : undefined,
          summary: options.summary,
          metadata: options.metadata ? parseMeta(options.metadata) : undefined,
        });
        console.log(JSON.stringify(r, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("publish-report <report-id>")
    .description("Publish a V2 report (pending→generating→published)")
    .option("-s, --score <n>", "Score", "0")
    .option("-y, --summary <text>", "Summary", "")
    .action((reportId, options) => {
      try {
        const r = publishReport(null, reportId, {
          score: Number(options.score),
          summary: options.summary,
        });
        console.log(JSON.stringify(r, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  compliance
    .command("auto-archive-stale-reports")
    .description("Bulk-flip stale published reports to ARCHIVED")
    .action(() => {
      const r = autoArchiveStaleReports(null, Date.now());
      console.log(JSON.stringify({ archived: r.length, entries: r }, null, 2));
    });

  compliance
    .command("stats-v2")
    .description("V2 compliance stats (all-enum-key zero-initialized)")
    .action(() => {
      console.log(JSON.stringify(getComplianceStatsV2(), null, 2));
    });

  /* ═══ UEBA V2 ═══ */

  function _parseMetaUeba(s) {
    if (!s) return undefined;
    try {
      return JSON.parse(s);
    } catch {
      throw new Error("--metadata must be valid JSON");
    }
  }

  ueba
    .command("baseline-maturities-v2")
    .description("List baseline maturity states (V2)")
    .action(() => {
      for (const v of Object.values(BASELINE_MATURITY_V2)) logger.log(`  ${v}`);
    });

  ueba
    .command("investigation-lifecycles-v2")
    .description("List investigation lifecycle states (V2)")
    .action(() => {
      for (const v of Object.values(INVESTIGATION_V2)) logger.log(`  ${v}`);
    });

  ueba
    .command("stats-v2")
    .description("UEBA V2 stats")
    .action(() => {
      console.log(JSON.stringify(getUebaStatsV2(), null, 2));
    });

  ueba
    .command("max-active-baselines-per-owner")
    .description("Get/set max active baselines per owner (V2)")
    .option("-s, --set <n>", "Set value", (v) => parseInt(v, 10))
    .action((o) => {
      if (typeof o.set === "number")
        console.log(setMaxActiveBaselinesPerOwnerV2(o.set));
      else console.log(getMaxActiveBaselinesPerOwnerV2());
    });

  ueba
    .command("max-open-investigations-per-analyst")
    .description("Get/set max open investigations per analyst (V2)")
    .option("-s, --set <n>", "Set value", (v) => parseInt(v, 10))
    .action((o) => {
      if (typeof o.set === "number")
        console.log(setMaxOpenInvestigationsPerAnalystV2(o.set));
      else console.log(getMaxOpenInvestigationsPerAnalystV2());
    });

  ueba
    .command("baseline-stale-ms")
    .description("Get/set baseline stale threshold ms (V2)")
    .option("-s, --set <n>", "Set value", (v) => parseInt(v, 10))
    .action((o) => {
      if (typeof o.set === "number") console.log(setBaselineStaleMsV2(o.set));
      else console.log(getBaselineStaleMsV2());
    });

  ueba
    .command("investigation-stuck-ms")
    .description("Get/set investigation stuck threshold ms (V2)")
    .option("-s, --set <n>", "Set value", (v) => parseInt(v, 10))
    .action((o) => {
      if (typeof o.set === "number")
        console.log(setInvestigationStuckMsV2(o.set));
      else console.log(getInvestigationStuckMsV2());
    });

  ueba
    .command("active-baseline-count")
    .description("Count active baselines for owner (V2)")
    .requiredOption("-o, --owner <owner>", "Owner")
    .action((o) => {
      console.log(getActiveBaselineCountV2(o.owner));
    });

  ueba
    .command("open-investigation-count")
    .description("Count open investigations for analyst (V2)")
    .requiredOption("-a, --analyst <analyst>", "Analyst")
    .action((o) => {
      console.log(getOpenInvestigationCountV2(o.analyst));
    });

  ueba
    .command("create-baseline-v2 <id>")
    .description("Create baseline V2 (draft)")
    .requiredOption("-o, --owner <owner>", "Owner")
    .requiredOption("-e, --entity <entity>", "Entity")
    .option("-m, --metadata <json>", "JSON metadata")
    .action((id, o) => {
      console.log(
        JSON.stringify(
          createBaselineV2({
            id,
            owner: o.owner,
            entity: o.entity,
            metadata: _parseMetaUeba(o.metadata),
          }),
          null,
          2,
        ),
      );
    });

  ueba
    .command("baseline-v2 <id>")
    .description("Show baseline V2")
    .action((id) => {
      const b = getBaselineV2(id);
      if (!b) {
        logger.error(`baseline ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(b, null, 2));
    });

  ueba
    .command("list-baselines-v2")
    .description("List baselines V2")
    .option("-o, --owner <owner>", "Filter by owner")
    .option("-s, --status <status>", "Filter by status")
    .action((o) => {
      console.log(
        JSON.stringify(
          listBaselinesV2({ owner: o.owner, status: o.status }),
          null,
          2,
        ),
      );
    });

  ueba
    .command("set-baseline-maturity-v2 <id> <status>")
    .description("Transition baseline V2 to status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "JSON metadata patch")
    .action((id, status, o) => {
      console.log(
        JSON.stringify(
          setBaselineMaturityV2(id, status, {
            reason: o.reason,
            metadata: _parseMetaUeba(o.metadata),
          }),
          null,
          2,
        ),
      );
    });

  ueba
    .command("activate-baseline-v2 <id>")
    .description("Baseline → active (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(activateBaselineV2(id, { reason: o.reason }), null, 2),
      );
    });

  ueba
    .command("mark-baseline-stale <id>")
    .description("Baseline → stale (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(markBaselineStaleV2(id, { reason: o.reason }), null, 2),
      );
    });

  ueba
    .command("archive-baseline-v2 <id>")
    .description("Baseline → archived (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(archiveBaselineV2(id, { reason: o.reason }), null, 2),
      );
    });

  ueba
    .command("refresh-baseline-v2 <id>")
    .description("Update lastRefreshedAt (V2)")
    .action((id) => {
      console.log(JSON.stringify(refreshBaselineV2(id), null, 2));
    });

  ueba
    .command("open-investigation-v2 <id>")
    .description("Open investigation V2")
    .requiredOption("-a, --analyst <analyst>", "Analyst")
    .requiredOption("-b, --baseline <baselineId>", "Baseline id")
    .option("--summary <summary>", "Summary")
    .option("-m, --metadata <json>", "JSON metadata")
    .action((id, o) => {
      console.log(
        JSON.stringify(
          openInvestigationV2({
            id,
            analyst: o.analyst,
            baselineId: o.baseline,
            summary: o.summary,
            metadata: _parseMetaUeba(o.metadata),
          }),
          null,
          2,
        ),
      );
    });

  ueba
    .command("investigation-v2 <id>")
    .description("Show investigation V2")
    .action((id) => {
      const i = getInvestigationV2(id);
      if (!i) {
        logger.error(`investigation ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(i, null, 2));
    });

  ueba
    .command("list-investigations-v2")
    .description("List investigations V2")
    .option("-a, --analyst <analyst>", "Filter by analyst")
    .option("-s, --status <status>", "Filter by status")
    .option("-b, --baseline <baselineId>", "Filter by baseline")
    .action((o) => {
      console.log(
        JSON.stringify(
          listInvestigationsV2({
            analyst: o.analyst,
            status: o.status,
            baselineId: o.baseline,
          }),
          null,
          2,
        ),
      );
    });

  ueba
    .command("set-investigation-status-v2 <id> <status>")
    .description("Transition investigation V2 to status")
    .option("-r, --reason <reason>", "Reason")
    .option("-m, --metadata <json>", "JSON metadata patch")
    .action((id, status, o) => {
      console.log(
        JSON.stringify(
          setInvestigationStatusV2(id, status, {
            reason: o.reason,
            metadata: _parseMetaUeba(o.metadata),
          }),
          null,
          2,
        ),
      );
    });

  ueba
    .command("start-investigation-v2 <id>")
    .description("Investigation → investigating (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(startInvestigationV2(id, { reason: o.reason }), null, 2),
      );
    });

  ueba
    .command("close-investigation-v2 <id>")
    .description("Investigation → closed (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(closeInvestigationV2(id, { reason: o.reason }), null, 2),
      );
    });

  ueba
    .command("dismiss-investigation-v2 <id>")
    .description("Investigation → dismissed (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(
          dismissInvestigationV2(id, { reason: o.reason }),
          null,
          2,
        ),
      );
    });

  ueba
    .command("escalate-investigation-v2 <id>")
    .description("Investigation → escalated (V2)")
    .option("-r, --reason <reason>", "Reason")
    .action((id, o) => {
      console.log(
        JSON.stringify(
          escalateInvestigationV2(id, { reason: o.reason }),
          null,
          2,
        ),
      );
    });

  ueba
    .command("auto-mark-stale-baselines")
    .description("Bulk auto-flip active→stale past threshold (V2)")
    .action(() => {
      console.log(JSON.stringify(autoMarkStaleBaselinesV2(), null, 2));
    });

  ueba
    .command("auto-escalate-stuck-investigations")
    .description(
      "Bulk auto-escalate investigating → escalated past threshold (V2)",
    )
    .action(() => {
      console.log(JSON.stringify(autoEscalateStuckInvestigationsV2(), null, 2));
    });

  _registerComplianceFwReporterV2Commands(compliance);
}

function _registerComplianceFwReporterV2Commands(parent) {
  const L = async () => await import("../lib/compliance-framework-reporter.js");
  parent
    .command("fwrep-enums-v2")
    .description("Show V2 enums (fw maturity + report lifecycle)")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            fwMaturity: m.COMPLIANCE_FW_MATURITY_V2,
            reportLifecycle: m.COMPLIANCE_FW_REPORT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("fwrep-config-v2")
    .description("Show V2 config thresholds")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActiveComplianceFwsPerOwner:
              m.getMaxActiveComplianceFwsPerOwnerV2(),
            maxPendingComplianceFwReportsPerFw:
              m.getMaxPendingComplianceFwReportsPerFwV2(),
            complianceFwIdleMs: m.getComplianceFwIdleMsV2(),
            complianceFwReportStuckMs: m.getComplianceFwReportStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("fwrep-set-max-active-v2 <n>")
    .description("Set max active fws per owner")
    .action(async (n) => {
      const m = await L();
      m.setMaxActiveComplianceFwsPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("fwrep-set-max-pending-v2 <n>")
    .description("Set max pending reports per fw")
    .action(async (n) => {
      const m = await L();
      m.setMaxPendingComplianceFwReportsPerFwV2(Number(n));
      console.log("ok");
    });
  parent
    .command("fwrep-set-fw-idle-ms-v2 <n>")
    .description("Set fw idle threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setComplianceFwIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("fwrep-set-report-stuck-ms-v2 <n>")
    .description("Set report stuck threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setComplianceFwReportStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("fwrep-register-v2 <id> <owner>")
    .description("Register V2 compliance framework")
    .option("--name <n>", "Framework name")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerComplianceFwV2({ id, owner, name: o.name }),
          null,
          2,
        ),
      );
    });
  parent
    .command("fwrep-activate-v2 <id>")
    .description("Activate framework")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.activateComplianceFwV2(id), null, 2));
    });
  parent
    .command("fwrep-deprecate-v2 <id>")
    .description("Deprecate framework")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.deprecateComplianceFwV2(id), null, 2));
    });
  parent
    .command("fwrep-archive-v2 <id>")
    .description("Archive framework (terminal)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.archiveComplianceFwV2(id), null, 2));
    });
  parent
    .command("fwrep-touch-v2 <id>")
    .description("Touch framework")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.touchComplianceFwV2(id), null, 2));
    });
  parent
    .command("fwrep-get-v2 <id>")
    .description("Get V2 framework")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getComplianceFwV2(id), null, 2));
    });
  parent
    .command("fwrep-list-v2")
    .description("List V2 frameworks")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listComplianceFwsV2(), null, 2));
    });
  parent
    .command("fwrep-create-report-v2 <id> <frameworkId>")
    .description("Create V2 report (queued)")
    .option("--format <f>", "Format", "markdown")
    .action(async (id, frameworkId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createComplianceFwReportV2({ id, frameworkId, format: o.format }),
          null,
          2,
        ),
      );
    });
  parent
    .command("fwrep-start-report-v2 <id>")
    .description("Start report")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.startComplianceFwReportV2(id), null, 2));
    });
  parent
    .command("fwrep-complete-report-v2 <id>")
    .description("Complete report")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.completeComplianceFwReportV2(id), null, 2));
    });
  parent
    .command("fwrep-fail-report-v2 <id> [reason]")
    .description("Fail report")
    .action(async (id, reason) => {
      const m = await L();
      console.log(
        JSON.stringify(m.failComplianceFwReportV2(id, reason), null, 2),
      );
    });
  parent
    .command("fwrep-cancel-report-v2 <id> [reason]")
    .description("Cancel report")
    .action(async (id, reason) => {
      const m = await L();
      console.log(
        JSON.stringify(m.cancelComplianceFwReportV2(id, reason), null, 2),
      );
    });
  parent
    .command("fwrep-get-report-v2 <id>")
    .description("Get V2 report")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getComplianceFwReportV2(id), null, 2));
    });
  parent
    .command("fwrep-list-reports-v2")
    .description("List V2 reports")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listComplianceFwReportsV2(), null, 2));
    });
  parent
    .command("fwrep-auto-deprecate-idle-v2")
    .description("Auto-deprecate idle fws")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(m.autoDeprecateIdleComplianceFwsV2(), null, 2),
      );
    });
  parent
    .command("fwrep-auto-fail-stuck-v2")
    .description("Auto-fail stuck generating reports")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(m.autoFailStuckComplianceFwReportsV2(), null, 2),
      );
    });
  parent
    .command("fwrep-gov-stats-v2")
    .description("V2 gov aggregate stats (fw reporter)")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(m.getComplianceFwReporterGovStatsV2(), null, 2),
      );
    });
}

// === Iter17 V2 governance overlay ===
export function registerCmgrV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "compliance");
  if (!parent) return;
  const L = async () => await import("../lib/compliance-manager.js");
  parent
    .command("cmgr-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.CMGR_PROFILE_MATURITY_V2,
            auditLifecycle: m.CMGR_AUDIT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("cmgr-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveCmgrProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingCmgrAuditsPerProfileV2(),
            idleMs: m.getCmgrProfileIdleMsV2(),
            stuckMs: m.getCmgrAuditStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("cmgr-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveCmgrProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("cmgr-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingCmgrAuditsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("cmgr-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setCmgrProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("cmgr-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setCmgrAuditStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("cmgr-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--framework <v>", "framework")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerCmgrProfileV2({ id, owner, framework: o.framework }),
          null,
          2,
        ),
      );
    });
  parent
    .command("cmgr-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateCmgrProfileV2(id), null, 2),
      );
    });
  parent
    .command("cmgr-deprecate-v2 <id>")
    .description("Deprecate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).deprecateCmgrProfileV2(id), null, 2),
      );
    });
  parent
    .command("cmgr-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveCmgrProfileV2(id), null, 2),
      );
    });
  parent
    .command("cmgr-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchCmgrProfileV2(id), null, 2));
    });
  parent
    .command("cmgr-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCmgrProfileV2(id), null, 2));
    });
  parent
    .command("cmgr-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCmgrProfilesV2(), null, 2));
    });
  parent
    .command("cmgr-create-audit-v2 <id> <profileId>")
    .description("Create audit")
    .option("--control <v>", "control")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createCmgrAuditV2({ id, profileId, control: o.control }),
          null,
          2,
        ),
      );
    });
  parent
    .command("cmgr-auditing-audit-v2 <id>")
    .description("Mark audit as auditing")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).auditingCmgrAuditV2(id), null, 2));
    });
  parent
    .command("cmgr-complete-audit-v2 <id>")
    .description("Complete audit")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeAuditCmgrV2(id), null, 2));
    });
  parent
    .command("cmgr-fail-audit-v2 <id> [reason]")
    .description("Fail audit")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failCmgrAuditV2(id, reason), null, 2),
      );
    });
  parent
    .command("cmgr-cancel-audit-v2 <id> [reason]")
    .description("Cancel audit")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelCmgrAuditV2(id, reason), null, 2),
      );
    });
  parent
    .command("cmgr-get-audit-v2 <id>")
    .description("Get audit")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCmgrAuditV2(id), null, 2));
    });
  parent
    .command("cmgr-list-audits-v2")
    .description("List audits")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCmgrAuditsV2(), null, 2));
    });
  parent
    .command("cmgr-auto-deprecate-idle-v2")
    .description("Auto-deprecate idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDeprecateIdleCmgrProfilesV2(), null, 2),
      );
    });
  parent
    .command("cmgr-auto-fail-stuck-v2")
    .description("Auto-fail stuck audits")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckCmgrAuditsV2(), null, 2),
      );
    });
  parent
    .command("cmgr-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getComplianceManagerGovStatsV2(), null, 2),
      );
    });
}

// === Iter24 V2 governance overlay ===
export function registerTigovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "compliance");
  if (!parent) return;
  const L = async () => await import("../lib/threat-intel.js");
  parent
    .command("tigov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.TIGOV_PROFILE_MATURITY_V2,
            feedLifecycle: m.TIGOV_FEED_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("tigov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveTigovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingTigovFeedsPerProfileV2(),
            idleMs: m.getTigovProfileIdleMsV2(),
            stuckMs: m.getTigovFeedStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("tigov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveTigovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("tigov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingTigovFeedsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("tigov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setTigovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("tigov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setTigovFeedStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("tigov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--source <v>", "source")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerTigovProfileV2({ id, owner, source: o.source }),
          null,
          2,
        ),
      );
    });
  parent
    .command("tigov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateTigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("tigov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).staleTigovProfileV2(id), null, 2));
    });
  parent
    .command("tigov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveTigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("tigov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchTigovProfileV2(id), null, 2));
    });
  parent
    .command("tigov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getTigovProfileV2(id), null, 2));
    });
  parent
    .command("tigov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listTigovProfilesV2(), null, 2));
    });
  parent
    .command("tigov-create-feed-v2 <id> <profileId>")
    .description("Create feed")
    .option("--indicator <v>", "indicator")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createTigovFeedV2({ id, profileId, indicator: o.indicator }),
          null,
          2,
        ),
      );
    });
  parent
    .command("tigov-ingesting-feed-v2 <id>")
    .description("Mark feed as ingesting")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).ingestingTigovFeedV2(id), null, 2),
      );
    });
  parent
    .command("tigov-complete-feed-v2 <id>")
    .description("Complete feed")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeFeedTigovV2(id), null, 2));
    });
  parent
    .command("tigov-fail-feed-v2 <id> [reason]")
    .description("Fail feed")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failTigovFeedV2(id, reason), null, 2),
      );
    });
  parent
    .command("tigov-cancel-feed-v2 <id> [reason]")
    .description("Cancel feed")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelTigovFeedV2(id, reason), null, 2),
      );
    });
  parent
    .command("tigov-get-feed-v2 <id>")
    .description("Get feed")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getTigovFeedV2(id), null, 2));
    });
  parent
    .command("tigov-list-feeds-v2")
    .description("List feeds")
    .action(async () => {
      console.log(JSON.stringify((await L()).listTigovFeedsV2(), null, 2));
    });
  parent
    .command("tigov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleTigovProfilesV2(), null, 2),
      );
    });
  parent
    .command("tigov-auto-fail-stuck-v2")
    .description("Auto-fail stuck feeds")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckTigovFeedsV2(), null, 2),
      );
    });
  parent
    .command("tigov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getThreatIntelGovStatsV2(), null, 2),
      );
    });
}

// === Iter24 V2 governance overlay ===
export function registerUebgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "compliance");
  if (!parent) return;
  const L = async () => await import("../lib/ueba.js");
  parent
    .command("uebgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.UEBGOV_PROFILE_MATURITY_V2,
            alertLifecycle: m.UEBGOV_ALERT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("uebgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveUebgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingUebgovAlertsPerProfileV2(),
            idleMs: m.getUebgovProfileIdleMsV2(),
            stuckMs: m.getUebgovAlertStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("uebgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveUebgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("uebgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingUebgovAlertsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("uebgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setUebgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("uebgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setUebgovAlertStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("uebgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--entity <v>", "entity")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerUebgovProfileV2({ id, owner, entity: o.entity }),
          null,
          2,
        ),
      );
    });
  parent
    .command("uebgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateUebgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("uebgov-suppress-v2 <id>")
    .description("Suppress profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suppressUebgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("uebgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveUebgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("uebgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchUebgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("uebgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getUebgovProfileV2(id), null, 2));
    });
  parent
    .command("uebgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listUebgovProfilesV2(), null, 2));
    });
  parent
    .command("uebgov-create-alert-v2 <id> <profileId>")
    .description("Create alert")
    .option("--behavior <v>", "behavior")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createUebgovAlertV2({ id, profileId, behavior: o.behavior }),
          null,
          2,
        ),
      );
    });
  parent
    .command("uebgov-analyzing-alert-v2 <id>")
    .description("Mark alert as analyzing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).analyzingUebgovAlertV2(id), null, 2),
      );
    });
  parent
    .command("uebgov-complete-alert-v2 <id>")
    .description("Complete alert")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeAlertUebgovV2(id), null, 2),
      );
    });
  parent
    .command("uebgov-fail-alert-v2 <id> [reason]")
    .description("Fail alert")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failUebgovAlertV2(id, reason), null, 2),
      );
    });
  parent
    .command("uebgov-cancel-alert-v2 <id> [reason]")
    .description("Cancel alert")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelUebgovAlertV2(id, reason), null, 2),
      );
    });
  parent
    .command("uebgov-get-alert-v2 <id>")
    .description("Get alert")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getUebgovAlertV2(id), null, 2));
    });
  parent
    .command("uebgov-list-alerts-v2")
    .description("List alerts")
    .action(async () => {
      console.log(JSON.stringify((await L()).listUebgovAlertsV2(), null, 2));
    });
  parent
    .command("uebgov-auto-suppress-idle-v2")
    .description("Auto-suppress idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuppressIdleUebgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("uebgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck alerts")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckUebgovAlertsV2(), null, 2),
      );
    });
  parent
    .command("uebgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getUebaGovStatsV2(), null, 2));
    });
}
