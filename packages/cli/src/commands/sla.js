/**
 * SLA commands
 * chainlesschain sla tiers|create|list|show|terminate|record|metrics|check|violations|compensate|report
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureSlaTables,
  listTiers,
  createSLA,
  listSLAs,
  getSLA,
  terminateSLA,
  recordMetric,
  getSLAMetrics,
  checkViolations,
  listViolations,
  calculateCompensation,
  generateReport,
  SLA_TERMS,
  VIOLATION_SEVERITY,
  // V2
  SLA_STATUS_V2,
  SLA_TIER_V2,
  SLA_TERM_V2,
  VIOLATION_SEVERITY_V2,
  VIOLATION_STATUS_V2,
  SLA_DEFAULT_MAX_ACTIVE_PER_ORG,
  setMaxActiveSlasPerOrg,
  getMaxActiveSlasPerOrg,
  getActiveSlaCountForOrg,
  createSLAV2,
  setSLAStatus,
  expireSLA,
  autoExpireSLAs,
  setViolationStatus,
  acknowledgeViolation,
  resolveViolation,
  waiveViolation,
  getSLAStatsV2,
} from "../lib/sla-manager.js";

function _dbFromCtx(ctx) {
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureSlaTables(db);
  return db;
}

export function registerSlaCommand(program) {
  const sla = program
    .command("sla")
    .description(
      "Cross-org SLA management — contracts, metrics, violations, compensation",
    );

  sla
    .command("tiers")
    .description("List built-in SLA tiers")
    .option("--json", "Output as JSON")
    .action((options) => {
      const tiers = listTiers();
      if (options.json) {
        console.log(JSON.stringify(tiers, null, 2));
      } else {
        for (const t of tiers) {
          logger.log(
            `  ${chalk.cyan(t.name.padEnd(8))} availability=${t.availability} p95<=${t.maxResponseTime}ms rps>=${t.minThroughput} comp=${(t.compensationRate * 100).toFixed(1)}%`,
          );
        }
      }
    });

  sla
    .command("create <org-id>")
    .description("Create a new SLA contract")
    .option("-t, --tier <tier>", "SLA tier (gold|silver|bronze)", "silver")
    .option("-d, --duration <ms>", "Contract duration in ms", parseInt)
    .option("-f, --fee <amount>", "Monthly fee", parseFloat, 0)
    .option("--json", "Output as JSON")
    .action(async (orgId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const contract = createSLA(db, {
          orgId,
          tier: options.tier,
          duration: options.duration,
          monthlyFee: options.fee,
        });
        if (options.json) {
          console.log(JSON.stringify(contract, null, 2));
        } else {
          logger.success(`SLA contract created`);
          logger.log(
            `  ${chalk.bold("SLA ID:")} ${chalk.cyan(contract.slaId)}`,
          );
          logger.log(`  ${chalk.bold("Org:")}    ${contract.orgId}`);
          logger.log(`  ${chalk.bold("Tier:")}   ${contract.tier}`);
          logger.log(`  ${chalk.bold("Fee:")}    ${contract.monthlyFee}/month`);
          logger.log(
            `  ${chalk.bold("Expires:")} ${new Date(contract.endDate).toISOString()}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("list")
    .description("List SLA contracts")
    .option("-o, --org <id>", "Filter by orgId")
    .option("-t, --tier <tier>", "Filter by tier")
    .option(
      "-s, --status <status>",
      "Filter by status (active|expired|terminated)",
    )
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listSLAs({
          orgId: options.org,
          tier: options.tier,
          status: options.status,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No SLA contracts recorded.");
        } else {
          for (const r of rows) {
            logger.log(
              `  ${chalk.cyan(r.slaId.slice(0, 8))} org=${r.orgId.padEnd(16)} tier=${r.tier.padEnd(7)} [${r.status}]`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("show <sla-id>")
    .description("Show a single SLA contract")
    .option("--json", "Output as JSON")
    .action(async (slaId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const r = getSLA(slaId);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          logger.log(`  ${chalk.bold("SLA ID:")} ${chalk.cyan(r.slaId)}`);
          logger.log(`  ${chalk.bold("Org:")}    ${r.orgId}`);
          logger.log(`  ${chalk.bold("Tier:")}   ${r.tier}`);
          logger.log(`  ${chalk.bold("Status:")} ${r.status}`);
          logger.log(`  ${chalk.bold("Terms:")}  ${JSON.stringify(r.terms)}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("terminate <sla-id>")
    .description("Terminate an SLA contract")
    .action(async (slaId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const r = terminateSLA(db, slaId);
        logger.success(`SLA ${slaId.slice(0, 8)} → ${r.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("record <sla-id> <term> <value>")
    .description(
      `Record a metric (term: ${Object.values(SLA_TERMS).join("|")})`,
    )
    .option("--json", "Output as JSON")
    .action(async (slaId, term, value, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const m = recordMetric(db, slaId, term, Number(value));
        if (options.json) {
          console.log(JSON.stringify(m, null, 2));
        } else {
          logger.success(`Metric recorded`);
          logger.log(`  ${chalk.bold("Term:")}  ${m.term}`);
          logger.log(`  ${chalk.bold("Value:")} ${m.value}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("metrics <sla-id>")
    .description("Show aggregated metrics for an SLA")
    .option("--json", "Output as JSON")
    .action(async (slaId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const m = getSLAMetrics(slaId);
        if (options.json) {
          console.log(JSON.stringify(m, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Samples:")} ${m.totalSamples}`);
          for (const [term, agg] of Object.entries(m.byTerm)) {
            logger.log(
              `  ${chalk.cyan(term.padEnd(15))} mean=${agg.mean.toFixed(4)} p95=${agg.p95.toFixed(4)} (n=${agg.count})`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("check <sla-id>")
    .description("Detect violations against the contract's terms")
    .option("--json", "Output as JSON")
    .action(async (slaId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const r = checkViolations(db, slaId);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else if (r.totalViolations === 0) {
          logger.success("No violations detected.");
        } else {
          logger.warn(`${r.totalViolations} violation(s) detected`);
          for (const v of r.violations) {
            logger.log(
              `  ${chalk.yellow(v.term.padEnd(15))} [${v.severity}] expected=${v.expectedValue} actual=${v.actualValue} dev=${v.deviationPercent}%`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("violations")
    .description("List recorded violations")
    .option("-s, --sla <id>", "Filter by SLA ID")
    .option(
      "-S, --severity <level>",
      `Filter by severity (${Object.values(VIOLATION_SEVERITY).join("|")})`,
    )
    .option("--limit <n>", "Maximum entries", parseInt, 50)
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const rows = listViolations({
          slaId: options.sla,
          severity: options.severity,
          limit: options.limit,
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No violations recorded.");
        } else {
          for (const v of rows) {
            logger.log(
              `  ${chalk.cyan(v.violationId.slice(0, 8))} ${v.term.padEnd(15)} [${v.severity}] dev=${v.deviationPercent}%`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("compensate <violation-id>")
    .description("Calculate compensation for a violation")
    .option("--json", "Output as JSON")
    .action(async (violationId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        const db = _dbFromCtx(ctx);
        const r = calculateCompensation(db, violationId);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Base:")}       ${r.base}`);
          logger.log(`  ${chalk.bold("Multiplier:")} ${r.multiplier}`);
          logger.log(`  ${chalk.bold("Amount:")}     ${chalk.green(r.amount)}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("report <sla-id>")
    .description("Generate an SLA compliance report")
    .option("--start <ms>", "Start of window (ms since epoch)", parseInt)
    .option("--end <ms>", "End of window (ms since epoch)", parseInt)
    .option("--json", "Output as JSON")
    .action(async (slaId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        _dbFromCtx(ctx);
        const r = generateReport(slaId, {
          startDate: options.start,
          endDate: options.end,
        });
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else {
          logger.log(`  ${chalk.bold("SLA:")}        ${chalk.cyan(r.slaId)}`);
          logger.log(`  ${chalk.bold("Tier:")}       ${r.tier}`);
          logger.log(
            `  ${chalk.bold("Compliance:")} ${(r.compliance * 100).toFixed(2)}%`,
          );
          logger.log(
            `  ${chalk.bold("Violations:")} ${r.violations.total} (comp=${r.violations.totalCompensation})`,
          );
          for (const [sev, n] of Object.entries(r.violations.bySeverity)) {
            if (n > 0) logger.log(`    ${chalk.yellow(sev.padEnd(10))} ${n}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ---------- V2 (Phase 61) ----------
  const withDb = async (fn) => {
    const ctx = await bootstrap({ verbose: program.opts().verbose });
    if (!ctx.db) {
      logger.error("Database not available");
      process.exit(1);
    }
    try {
      const db = ctx.db.getDatabase();
      ensureSlaTables(db);
      return await fn(db);
    } finally {
      await shutdown();
    }
  };

  sla
    .command("statuses")
    .description("List SLA_STATUS_V2 values")
    .action(() => {
      console.log(JSON.stringify(Object.values(SLA_STATUS_V2), null, 2));
    });

  sla
    .command("tier-names")
    .description("List SLA_TIER_V2 values")
    .action(() => {
      console.log(JSON.stringify(Object.values(SLA_TIER_V2), null, 2));
    });

  sla
    .command("term-names")
    .description("List SLA_TERM_V2 values")
    .action(() => {
      console.log(JSON.stringify(Object.values(SLA_TERM_V2), null, 2));
    });

  sla
    .command("severities")
    .description("List VIOLATION_SEVERITY_V2 values")
    .action(() => {
      console.log(
        JSON.stringify(Object.values(VIOLATION_SEVERITY_V2), null, 2),
      );
    });

  sla
    .command("violation-statuses")
    .description("List VIOLATION_STATUS_V2 values")
    .action(() => {
      console.log(JSON.stringify(Object.values(VIOLATION_STATUS_V2), null, 2));
    });

  sla
    .command("default-max-active")
    .description("Show SLA_DEFAULT_MAX_ACTIVE_PER_ORG")
    .action(() => {
      console.log(SLA_DEFAULT_MAX_ACTIVE_PER_ORG);
    });

  sla
    .command("max-active")
    .description("Show current max active SLAs per org")
    .action(() => {
      console.log(getMaxActiveSlasPerOrg());
    });

  sla
    .command("set-max-active <n>")
    .description("Set per-org active-contract admission cap")
    .action((n) => {
      try {
        const v = setMaxActiveSlasPerOrg(Number(n));
        logger.success(`maxActiveSlasPerOrg=${v}`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("active-count <org-id>")
    .description("Show active SLA count for an org")
    .action((orgId) => {
      console.log(getActiveSlaCountForOrg(orgId));
    });

  sla
    .command("create-v2 <org-id>")
    .description("Create a V2 SLA contract (enforces per-org active cap)")
    .option("-t, --tier <tier>", "gold|silver|bronze", "silver")
    .option("-d, --duration <ms>", "Contract duration in ms", parseInt)
    .option("-f, --fee <amount>", "Monthly fee", parseFloat)
    .option("--json", "Output as JSON")
    .action(async (orgId, options) => {
      try {
        await withDb((db) => {
          const c = createSLAV2(db, {
            orgId,
            tier: options.tier,
            duration: options.duration,
            monthlyFee: options.fee,
          });
          if (options.json) {
            console.log(JSON.stringify(c, null, 2));
          } else {
            logger.success(
              `Created ${c.slaId.slice(0, 8)} [${c.tier}] → ${c.status}`,
            );
          }
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("set-status <sla-id> <status>")
    .description("Transition SLA to a given status (state-machine guarded)")
    .action(async (slaId, status) => {
      try {
        await withDb((db) => {
          const c = setSLAStatus(db, slaId, status);
          logger.success(`${c.slaId.slice(0, 8)} → ${c.status}`);
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("expire <sla-id>")
    .description("Expire an SLA (shortcut for set-status ... expired)")
    .action(async (slaId) => {
      try {
        await withDb((db) => {
          const c = expireSLA(db, slaId);
          logger.success(`${c.slaId.slice(0, 8)} → ${c.status}`);
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("auto-expire")
    .description("Bulk-flip ACTIVE contracts past endDate to EXPIRED")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await withDb((db) => {
          const flipped = autoExpireSLAs(db);
          if (options.json) {
            console.log(JSON.stringify(flipped, null, 2));
          } else {
            logger.success(`Auto-expired ${flipped.length} contract(s)`);
          }
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("set-violation-status <violation-id> <status>")
    .description("Transition a violation (open→{acknowledged,resolved,waived})")
    .option("--note <note>", "Attach a note")
    .action(async (violationId, status, options) => {
      try {
        await withDb((db) => {
          const v = setViolationStatus(db, violationId, status, {
            note: options.note,
          });
          logger.success(`${v.violationId.slice(0, 8)} → ${v.v2Status}`);
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("acknowledge-violation <violation-id>")
    .description("Acknowledge a violation")
    .option("--note <note>", "Attach a note")
    .action(async (violationId, options) => {
      try {
        await withDb((db) => {
          const v = acknowledgeViolation(db, violationId, options.note);
          logger.success(`${v.violationId.slice(0, 8)} → ${v.v2Status}`);
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("resolve-violation <violation-id>")
    .description("Resolve a violation")
    .option("--note <note>", "Attach a note")
    .action(async (violationId, options) => {
      try {
        await withDb((db) => {
          const v = resolveViolation(db, violationId, options.note);
          logger.success(`${v.violationId.slice(0, 8)} → ${v.v2Status}`);
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("waive-violation <violation-id>")
    .description("Waive a violation")
    .option("--note <note>", "Attach a note")
    .action(async (violationId, options) => {
      try {
        await withDb((db) => {
          const v = waiveViolation(db, violationId, options.note);
          logger.success(`${v.violationId.slice(0, 8)} → ${v.v2Status}`);
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  sla
    .command("stats-v2")
    .description("Show aggregate V2 SLA stats (byStatus/byTier/violations)")
    .action(() => {
      console.log(JSON.stringify(getSLAStatsV2(), null, 2));
    });
}

// === Iter16 V2 governance overlay ===
export function registerSlagovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "sla");
  if (!parent) return;
  const L = async () => await import("../lib/sla-manager.js");
  parent
    .command("slagov-enums-v2")
    .description("Show V2 enums (slagov maturity + measurement lifecycle)")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SLAGOV_PROFILE_MATURITY_V2,
            measurementLifecycle: m.SLAGOV_MEASUREMENT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("slagov-config-v2")
    .description("Show V2 config thresholds")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSlagovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSlagovMeasurementsPerProfileV2(),
            idleMs: m.getSlagovProfileIdleMsV2(),
            stuckMs: m.getSlagovMeasurementStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("slagov-set-max-active-v2 <n>")
    .description("Set max active profiles per owner")
    .action(async (n) => {
      const m = await L();
      m.setMaxActiveSlagovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("slagov-set-max-pending-v2 <n>")
    .description("Set max pending measurements per profile")
    .action(async (n) => {
      const m = await L();
      m.setMaxPendingSlagovMeasurementsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("slagov-set-idle-ms-v2 <n>")
    .description("Set profile idle threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setSlagovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("slagov-set-stuck-ms-v2 <n>")
    .description("Set measurement stuck threshold (ms)")
    .action(async (n) => {
      const m = await L();
      m.setSlagovMeasurementStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("slagov-register-v2 <id> <owner>")
    .description("Register V2 slagov profile")
    .option("--tier <v>", "tier")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSlagovProfileV2({ id, owner, tier: o.tier }),
          null,
          2,
        ),
      );
    });
  parent
    .command("slagov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.activateSlagovProfileV2(id), null, 2));
    });
  parent
    .command("slagov-breach-v2 <id>")
    .description("Breach profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.breachSlagovProfileV2(id), null, 2));
    });
  parent
    .command("slagov-archive-v2 <id>")
    .description("Archive profile (terminal)")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.archiveSlagovProfileV2(id), null, 2));
    });
  parent
    .command("slagov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.touchSlagovProfileV2(id), null, 2));
    });
  parent
    .command("slagov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getSlagovProfileV2(id), null, 2));
    });
  parent
    .command("slagov-list-v2")
    .description("List profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listSlagovProfilesV2(), null, 2));
    });
  parent
    .command("slagov-create-measurement-v2 <id> <profileId>")
    .description("Create measurement (queued)")
    .option("--metric <v>", "metric")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSlagovMeasurementV2({ id, profileId, metric: o.metric }),
          null,
          2,
        ),
      );
    });
  parent
    .command("slagov-measuring-measurement-v2 <id>")
    .description("Mark measurement as measuring")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.measuringSlagovMeasurementV2(id), null, 2));
    });
  parent
    .command("slagov-complete-measurement-v2 <id>")
    .description("Complete measurement")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.completeMeasurementSlagovV2(id), null, 2));
    });
  parent
    .command("slagov-fail-measurement-v2 <id> [reason]")
    .description("Fail measurement")
    .action(async (id, reason) => {
      const m = await L();
      console.log(
        JSON.stringify(m.failSlagovMeasurementV2(id, reason), null, 2),
      );
    });
  parent
    .command("slagov-cancel-measurement-v2 <id> [reason]")
    .description("Cancel measurement")
    .action(async (id, reason) => {
      const m = await L();
      console.log(
        JSON.stringify(m.cancelSlagovMeasurementV2(id, reason), null, 2),
      );
    });
  parent
    .command("slagov-get-measurement-v2 <id>")
    .description("Get measurement")
    .action(async (id) => {
      const m = await L();
      console.log(JSON.stringify(m.getSlagovMeasurementV2(id), null, 2));
    });
  parent
    .command("slagov-list-measurements-v2")
    .description("List measurements")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.listSlagovMeasurementsV2(), null, 2));
    });
  parent
    .command("slagov-auto-breach-idle-v2")
    .description("Auto-breach idle profiles")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.autoBreachIdleSlagovProfilesV2(), null, 2));
    });
  parent
    .command("slagov-auto-fail-stuck-v2")
    .description("Auto-fail stuck measurements")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(m.autoFailStuckSlagovMeasurementsV2(), null, 2),
      );
    });
  parent
    .command("slagov-gov-stats-v2")
    .description("V2 gov aggregate stats")
    .action(async () => {
      const m = await L();
      console.log(JSON.stringify(m.getSlaManagerGovStatsV2(), null, 2));
    });
}
