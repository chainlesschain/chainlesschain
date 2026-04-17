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
}
