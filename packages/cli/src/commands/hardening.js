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
  runConfigAudit,
  deployCheck,
  // V2 (Phase 29)
  AUDIT_STATUS_V2,
  BASELINE_STATUS_V2,
  SEVERITY_V2,
  HARDENING_DEFAULT_MAX_CONCURRENT_AUDITS,
  HARDENING_DEFAULT_BASELINE_RETENTION_MS,
  HARDENING_DEFAULT_AUDIT_TIMEOUT_MS,
  setMaxConcurrentAudits,
  getMaxConcurrentAudits,
  setBaselineRetentionMs,
  getBaselineRetentionMs,
  setAuditTimeoutMs,
  getAuditTimeoutMs,
  getRunningAuditCount,
  registerAuditV2,
  startAudit,
  completeAudit,
  setAuditStatusV2,
  getAuditStatusV2,
  autoTimeoutAudits,
  createBaselineV2,
  getBaselineStatusV2,
  setBaselineStatusV2,
  activateBaseline,
  autoArchiveStaleBaselines,
  getHardeningStatsV2,
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

  // config-check subcommand — real config-file audit
  hardening
    .command("config-check <config-path>")
    .description("Audit a config file (presence, required keys, placeholders)")
    .option("-n, --name <name>", "Audit name", "default")
    .option(
      "-r, --required <keys>",
      "Comma-separated required key paths (e.g. db.host,server.port)",
    )
    .option(
      "-f, --forbidden <placeholders>",
      "Comma-separated forbidden placeholder substrings",
    )
    .option("--json", "Output as JSON")
    .action(async (configPath, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureHardeningTables(db);

        const requiredKeys = options.required
          ? options.required
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
        const forbiddenPlaceholders = options.forbidden
          ? options.forbidden
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

        const result = runConfigAudit(db, {
          name: options.name,
          configPath,
          requiredKeys,
          forbiddenPlaceholders,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Config audit complete: score ${result.score}%`);
          logger.log(`  ${chalk.bold("ID:")}     ${chalk.cyan(result.id)}`);
          logger.log(`  ${chalk.bold("Path:")}   ${result.configPath}`);
          logger.log(
            `  ${chalk.bold("Passed:")} ${result.passed}/${result.checks.length}`,
          );
          for (const c of result.checks) {
            const icon =
              c.status === "pass" ? chalk.green("✓") : chalk.red("✗");
            const sev = c.severity ? chalk.dim(`[${c.severity}]`) : "";
            logger.log(`    ${icon} ${sev} ${c.name}: ${c.detail}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // deploy-check subcommand — checklist from docs/design/modules/29_生产强化系统.md §八
  hardening
    .command("deploy-check")
    .description("Evaluate the 6-item production-deployment checklist")
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

        const result = deployCheck();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(
            `  ${chalk.bold("Ready:")}   ${result.ready ? chalk.green("YES") : chalk.red("NO")}`,
          );
          logger.log(`  ${chalk.bold("Summary:")} ${result.summary}`);
          for (const it of result.items) {
            const icon =
              it.status === "pass"
                ? chalk.green("✓")
                : it.status === "skipped"
                  ? chalk.yellow("—")
                  : chalk.red("✗");
            logger.log(`    ${icon} ${it.label}: ${it.detail}`);
          }
        }
        if (!result.ready) process.exitCode = 2;
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

  /* ── V2 (Phase 29) ──────────────────────────────── */

  hardening
    .command("audit-statuses-v2")
    .description("List V2 audit lifecycle statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const out = Object.values(AUDIT_STATUS_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });

  hardening
    .command("baseline-statuses-v2")
    .description("List V2 baseline lifecycle statuses")
    .option("--json", "JSON output")
    .action((opts) => {
      const out = Object.values(BASELINE_STATUS_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });

  hardening
    .command("severities-v2")
    .description("List V2 severity buckets")
    .option("--json", "JSON output")
    .action((opts) => {
      const out = Object.values(SEVERITY_V2);
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      for (const s of out) console.log(`  ${s}`);
    });

  hardening
    .command("default-max-concurrent-audits")
    .description("Default concurrent audit cap")
    .option("--json", "JSON output")
    .action((opts) => {
      if (opts.json)
        return console.log(
          JSON.stringify(HARDENING_DEFAULT_MAX_CONCURRENT_AUDITS),
        );
      console.log(HARDENING_DEFAULT_MAX_CONCURRENT_AUDITS);
    });

  hardening
    .command("max-concurrent-audits")
    .description("Current concurrent audit cap")
    .option("--json", "JSON output")
    .action((opts) => {
      const n = getMaxConcurrentAudits();
      if (opts.json) return console.log(JSON.stringify(n));
      console.log(n);
    });

  hardening
    .command("set-max-concurrent-audits <n>")
    .description("Set concurrent audit cap")
    .option("--json", "JSON output")
    .action((n, opts) => {
      setMaxConcurrentAudits(Number(n));
      const out = { maxConcurrentAudits: getMaxConcurrentAudits() };
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      console.log(`maxConcurrentAudits = ${out.maxConcurrentAudits}`);
    });

  hardening
    .command("default-baseline-retention-ms")
    .description("Default baseline retention in ms")
    .option("--json", "JSON output")
    .action((opts) => {
      if (opts.json)
        return console.log(
          JSON.stringify(HARDENING_DEFAULT_BASELINE_RETENTION_MS),
        );
      console.log(HARDENING_DEFAULT_BASELINE_RETENTION_MS);
    });

  hardening
    .command("baseline-retention-ms")
    .description("Current baseline retention in ms")
    .option("--json", "JSON output")
    .action((opts) => {
      const n = getBaselineRetentionMs();
      if (opts.json) return console.log(JSON.stringify(n));
      console.log(n);
    });

  hardening
    .command("set-baseline-retention-ms <ms>")
    .description("Set baseline retention in ms")
    .option("--json", "JSON output")
    .action((ms, opts) => {
      setBaselineRetentionMs(Number(ms));
      const out = { baselineRetentionMs: getBaselineRetentionMs() };
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      console.log(`baselineRetentionMs = ${out.baselineRetentionMs}`);
    });

  hardening
    .command("default-audit-timeout-ms")
    .description("Default audit timeout in ms")
    .option("--json", "JSON output")
    .action((opts) => {
      if (opts.json)
        return console.log(JSON.stringify(HARDENING_DEFAULT_AUDIT_TIMEOUT_MS));
      console.log(HARDENING_DEFAULT_AUDIT_TIMEOUT_MS);
    });

  hardening
    .command("audit-timeout-ms")
    .description("Current audit timeout in ms")
    .option("--json", "JSON output")
    .action((opts) => {
      const n = getAuditTimeoutMs();
      if (opts.json) return console.log(JSON.stringify(n));
      console.log(n);
    });

  hardening
    .command("set-audit-timeout-ms <ms>")
    .description("Set audit timeout in ms")
    .option("--json", "JSON output")
    .action((ms, opts) => {
      setAuditTimeoutMs(Number(ms));
      const out = { auditTimeoutMs: getAuditTimeoutMs() };
      if (opts.json) return console.log(JSON.stringify(out, null, 2));
      console.log(`auditTimeoutMs = ${out.auditTimeoutMs}`);
    });

  hardening
    .command("running-audit-count")
    .description("Number of currently RUNNING audits")
    .option("--json", "JSON output")
    .action((opts) => {
      const n = getRunningAuditCount();
      if (opts.json) return console.log(JSON.stringify(n));
      console.log(n);
    });

  hardening
    .command("register-audit-v2 <name>")
    .description("Register a V2 audit entry (PENDING)")
    .option("-t, --type <type>", "Audit type", "generic")
    .option(
      "-s, --severity <severity>",
      "critical|high|medium|low|info",
      "medium",
    )
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action(async (name, opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;
        const r = registerAuditV2(db, {
          name,
          type: opts.type,
          severity: opts.severity,
          metadata,
        });
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`Registered audit ${r.audit_id} (${r.status})`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("start-audit <audit-id>")
    .description("Start a PENDING audit (enforces concurrency cap)")
    .option("--json", "JSON output")
    .action(async (auditId, opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const r = startAudit(db, auditId);
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`${auditId} → ${r.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("complete-audit <audit-id>")
    .description("Complete a RUNNING audit")
    .option("-p, --passed <n>", "Passed check count", parseInt)
    .option("-f, --failed <n>", "Failed check count", parseInt)
    .option("-w, --warning-threshold <n>", "Score threshold for WARNING (0–1)")
    .option("--json", "JSON output")
    .action(async (auditId, opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const warningThreshold = opts.warningThreshold
          ? Number(opts.warningThreshold)
          : undefined;
        const r = completeAudit(db, auditId, {
          passed: opts.passed ?? 0,
          failed: opts.failed ?? 0,
          warningThreshold,
        });
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`${auditId} → ${r.status} (score: ${r.score})`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("set-audit-status-v2 <audit-id> <status>")
    .description("Transition audit to a new status")
    .option("-e, --error-message <msg>")
    .option("-m, --metadata <json>")
    .option("--json", "JSON output")
    .action(async (auditId, status, opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const patch = {};
        if (opts.errorMessage !== undefined)
          patch.errorMessage = opts.errorMessage;
        if (opts.metadata !== undefined)
          patch.metadata = JSON.parse(opts.metadata);
        const r = setAuditStatusV2(db, auditId, status, patch);
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`${auditId} → ${r.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("audit-status-v2 <audit-id>")
    .description("Get V2 audit status")
    .option("--json", "JSON output")
    .action((auditId, opts) => {
      const r = getAuditStatusV2(auditId);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r) return console.log("(not found)");
      console.log(`${auditId}: ${r.status}`);
    });

  hardening
    .command("auto-timeout-audits")
    .description("Bulk-fail RUNNING audits past auditTimeoutMs")
    .option("--json", "JSON output")
    .action(async (opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const r = autoTimeoutAudits(db);
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`Timed out ${r.length} audit(s)`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("create-baseline-v2 <name>")
    .description("Create a V2 baseline (DRAFT)")
    .option("-v, --version <ver>", "Version", "1.0.0")
    .option("-m, --metadata <json>", "Metadata JSON")
    .option("--json", "JSON output")
    .action(async (name, opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;
        const r = createBaselineV2(db, {
          name,
          version: opts.version,
          metadata,
        });
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`Baseline ${r.baseline_id} (${r.status})`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("activate-baseline <baseline-id>")
    .description("Activate a DRAFT baseline (supersedes previous ACTIVE)")
    .option("--json", "JSON output")
    .action(async (baselineId, opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const r = activateBaseline(db, baselineId);
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`${baselineId} → ${r.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("set-baseline-status-v2 <baseline-id> <status>")
    .description("Transition baseline to a new status")
    .option("-r, --reason <reason>")
    .option("-m, --metadata <json>")
    .option("--json", "JSON output")
    .action(async (baselineId, status, opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const patch = {};
        if (opts.reason !== undefined) patch.reason = opts.reason;
        if (opts.metadata !== undefined)
          patch.metadata = JSON.parse(opts.metadata);
        const r = setBaselineStatusV2(db, baselineId, status, patch);
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`${baselineId} → ${r.status}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("baseline-status-v2 <baseline-id>")
    .description("Get V2 baseline status")
    .option("--json", "JSON output")
    .action((baselineId, opts) => {
      const r = getBaselineStatusV2(baselineId);
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      if (!r) return console.log("(not found)");
      console.log(`${baselineId}: ${r.status}`);
    });

  hardening
    .command("auto-archive-stale-baselines")
    .description("Bulk-archive SUPERSEDED baselines past retention")
    .option("--json", "JSON output")
    .action(async (opts) => {
      try {
        const { db } = await bootstrap();
        ensureHardeningTables(db);
        const r = autoArchiveStaleBaselines(db);
        if (opts.json) console.log(JSON.stringify(r, null, 2));
        else console.log(`Archived ${r.length} baseline(s)`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  hardening
    .command("stats-v2")
    .description("V2 hardening statistics")
    .option("--json", "JSON output")
    .action((opts) => {
      const s = getHardeningStatsV2();
      if (opts.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`Audits: ${s.totalAudits} (running=${s.runningAudits})`);
      for (const [st, n] of Object.entries(s.auditsByStatus)) {
        if (n > 0) console.log(`  ${st.padEnd(10)} ${n}`);
      }
      console.log(
        `Baselines: ${s.totalBaselines} (active=${s.activeBaselines})`,
      );
      console.log(
        `config: maxConcurrentAudits=${s.maxConcurrentAudits} baselineRetentionMs=${s.baselineRetentionMs} auditTimeoutMs=${s.auditTimeoutMs}`,
      );
    });
}

// === Iter17 V2 governance overlay ===
export function registerHardgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "hardening");
  if (!parent) return;
  const L = async () => await import("../lib/hardening-manager.js");
  parent
    .command("hardgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.HARDGOV_PROFILE_MATURITY_V2,
            scanLifecycle: m.HARDGOV_SCAN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("hardgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveHardgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingHardgovScansPerProfileV2(),
            idleMs: m.getHardgovProfileIdleMsV2(),
            stuckMs: m.getHardgovScanStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("hardgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveHardgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("hardgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingHardgovScansPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("hardgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setHardgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("hardgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setHardgovScanStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("hardgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--category <v>", "category")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerHardgovProfileV2({ id, owner, category: o.category }),
          null,
          2,
        ),
      );
    });
  parent
    .command("hardgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateHardgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("hardgov-disable-v2 <id>")
    .description("Disable profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).disableHardgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("hardgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveHardgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("hardgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchHardgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("hardgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getHardgovProfileV2(id), null, 2));
    });
  parent
    .command("hardgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listHardgovProfilesV2(), null, 2));
    });
  parent
    .command("hardgov-create-scan-v2 <id> <profileId>")
    .description("Create scan")
    .option("--target <v>", "target")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createHardgovScanV2({ id, profileId, target: o.target }),
          null,
          2,
        ),
      );
    });
  parent
    .command("hardgov-scanning-scan-v2 <id>")
    .description("Mark scan as scanning")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).scanningHardgovScanV2(id), null, 2),
      );
    });
  parent
    .command("hardgov-complete-scan-v2 <id>")
    .description("Complete scan")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeScanHardgovV2(id), null, 2),
      );
    });
  parent
    .command("hardgov-fail-scan-v2 <id> [reason]")
    .description("Fail scan")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failHardgovScanV2(id, reason), null, 2),
      );
    });
  parent
    .command("hardgov-cancel-scan-v2 <id> [reason]")
    .description("Cancel scan")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelHardgovScanV2(id, reason), null, 2),
      );
    });
  parent
    .command("hardgov-get-scan-v2 <id>")
    .description("Get scan")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getHardgovScanV2(id), null, 2));
    });
  parent
    .command("hardgov-list-scans-v2")
    .description("List scans")
    .action(async () => {
      console.log(JSON.stringify((await L()).listHardgovScansV2(), null, 2));
    });
  parent
    .command("hardgov-auto-disable-idle-v2")
    .description("Auto-disable idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDisableIdleHardgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("hardgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck scans")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckHardgovScansV2(), null, 2),
      );
    });
  parent
    .command("hardgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getHardeningManagerGovStatsV2(), null, 2),
      );
    });
}
