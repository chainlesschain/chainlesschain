/**
 * Knowledge export commands
 * chainlesschain export markdown|site --output <dir>
 */

import chalk from "chalk";
import ora from "ora";
import { resolve } from "path";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  exportToMarkdown,
  exportToSite,
  TARGET_MATURITY_V2,
  EXPORT_JOB_LIFECYCLE_V2,
  getMaxActiveTargetsPerOwnerV2,
  setMaxActiveTargetsPerOwnerV2,
  getMaxPendingJobsPerTargetV2,
  setMaxPendingJobsPerTargetV2,
  getTargetIdleMsV2,
  setTargetIdleMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerTargetV2,
  getTargetV2,
  listTargetsV2,
  setTargetStatusV2,
  activateTargetV2,
  pauseTargetV2,
  archiveTargetV2,
  touchTargetV2,
  getActiveTargetCountV2,
  createExportJobV2,
  getExportJobV2,
  listExportJobsV2,
  setExportJobStatusV2,
  startExportJobV2,
  completeExportJobV2,
  failExportJobV2,
  cancelExportJobV2,
  getPendingJobCountV2,
  autoPauseIdleTargetsV2,
  autoFailStuckExportJobsV2,
  getKnowledgeExporterStatsV2,
} from "../lib/knowledge-exporter.js";

export function registerExportCommand(program) {
  const exp = program
    .command("export")
    .description("Export knowledge base to external formats");

  // export markdown
  exp
    .command("markdown")
    .description("Export notes as markdown files")
    .requiredOption("-o, --output <dir>", "Output directory")
    .option("--category <category>", "Filter by category")
    .option("--tag <tag>", "Filter by tag")
    .option("-n, --limit <n>", "Max notes to export")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const outputDir = resolve(options.output);
        const spinner = ora("Exporting to markdown...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const exported = exportToMarkdown(db, outputDir, {
          category: options.category,
          tag: options.tag,
          limit: options.limit ? parseInt(options.limit) : undefined,
        });
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: exported.length, output: outputDir, files: exported },
              null,
              2,
            ),
          );
        } else if (exported.length === 0) {
          logger.info("No notes to export");
        } else {
          logger.success(
            `Exported ${chalk.cyan(exported.length)} notes to ${chalk.gray(outputDir)}`,
          );
          for (const f of exported.slice(0, 10)) {
            logger.log(`  ${chalk.gray(f.path)}`);
          }
          if (exported.length > 10) {
            logger.log(chalk.gray(`  ... and ${exported.length - 10} more`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Export failed: ${err.message}`);
        process.exit(1);
      }
    });

  // export site
  exp
    .command("site")
    .description("Export notes as a static HTML website")
    .requiredOption("-o, --output <dir>", "Output directory")
    .option("--title <title>", "Site title", "ChainlessChain Knowledge Base")
    .option("--category <category>", "Filter by category")
    .option("--tag <tag>", "Filter by tag")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const outputDir = resolve(options.output);
        const spinner = ora("Generating static site...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const exported = exportToSite(db, outputDir, {
          title: options.title,
          category: options.category,
          tag: options.tag,
        });
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: exported.length, output: outputDir, files: exported },
              null,
              2,
            ),
          );
        } else {
          logger.success(
            `Generated static site with ${chalk.cyan(exported.length)} pages`,
          );
          logger.log(`  ${chalk.gray("Output:")} ${outputDir}`);
          logger.log(
            `  ${chalk.gray("Files:")} index.html, style.css, ${exported.length} note pages`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Export failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ─── V2 Governance Layer ──────────────────────────────────────────
  const out = (obj) => console.log(JSON.stringify(obj, null, 2));
  const tryRun = (fn) => {
    try {
      fn();
    } catch (err) {
      logger.error(err.message);
      process.exit(1);
    }
  };

  exp
    .command("target-maturities-v2")
    .description("List V2 target maturity states")
    .action(() => out(Object.values(TARGET_MATURITY_V2)));

  exp
    .command("export-job-lifecycles-v2")
    .description("List V2 export-job lifecycle states")
    .action(() => out(Object.values(EXPORT_JOB_LIFECYCLE_V2)));

  exp
    .command("stats-v2")
    .description("V2 knowledge-exporter stats")
    .action(() => out(getKnowledgeExporterStatsV2()));

  exp
    .command("get-max-active-targets-v2")
    .description("Get max active targets per owner (V2)")
    .action(() =>
      out({ maxActiveTargetsPerOwner: getMaxActiveTargetsPerOwnerV2() }),
    );

  exp
    .command("set-max-active-targets-v2 <n>")
    .description("Set max active targets per owner (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxActiveTargetsPerOwnerV2(Number(n));
        out({ maxActiveTargetsPerOwner: getMaxActiveTargetsPerOwnerV2() });
      }),
    );

  exp
    .command("get-max-pending-jobs-v2")
    .description("Get max pending jobs per target (V2)")
    .action(() =>
      out({ maxPendingJobsPerTarget: getMaxPendingJobsPerTargetV2() }),
    );

  exp
    .command("set-max-pending-jobs-v2 <n>")
    .description("Set max pending jobs per target (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxPendingJobsPerTargetV2(Number(n));
        out({ maxPendingJobsPerTarget: getMaxPendingJobsPerTargetV2() });
      }),
    );

  exp
    .command("get-target-idle-ms-v2")
    .description("Get target idle threshold (V2)")
    .action(() => out({ targetIdleMs: getTargetIdleMsV2() }));

  exp
    .command("set-target-idle-ms-v2 <ms>")
    .description("Set target idle threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setTargetIdleMsV2(Number(ms));
        out({ targetIdleMs: getTargetIdleMsV2() });
      }),
    );

  exp
    .command("get-job-stuck-ms-v2")
    .description("Get export-job stuck threshold (V2)")
    .action(() => out({ jobStuckMs: getJobStuckMsV2() }));

  exp
    .command("set-job-stuck-ms-v2 <ms>")
    .description("Set export-job stuck threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setJobStuckMsV2(Number(ms));
        out({ jobStuckMs: getJobStuckMsV2() });
      }),
    );

  exp
    .command("active-target-count-v2 <ownerId>")
    .description("Active target count for owner (V2)")
    .action((ownerId) =>
      out({ ownerId, count: getActiveTargetCountV2(ownerId) }),
    );

  exp
    .command("pending-job-count-v2 <targetId>")
    .description("Pending export-job count for target (V2)")
    .action((targetId) =>
      out({ targetId, count: getPendingJobCountV2(targetId) }),
    );

  exp
    .command("register-target-v2 <id>")
    .description("Register a V2 export target")
    .requiredOption("-o, --owner <id>", "owner id")
    .requiredOption("-l, --label <label>", "target label")
    .option("-f, --format <format>", "target format", "markdown")
    .action((id, opts) =>
      tryRun(() =>
        out(
          registerTargetV2(id, {
            ownerId: opts.owner,
            label: opts.label,
            format: opts.format,
          }),
        ),
      ),
    );

  exp
    .command("get-target-v2 <id>")
    .description("Get a V2 target")
    .action((id) => out(getTargetV2(id)));

  exp
    .command("list-targets-v2")
    .description("List V2 targets")
    .option("-o, --owner <id>", "filter by owner")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listTargetsV2({ ownerId: opts.owner, status: opts.status })),
    );

  exp
    .command("set-target-status-v2 <id> <next>")
    .description("Set V2 target status")
    .action((id, next) => tryRun(() => out(setTargetStatusV2(id, next))));

  exp
    .command("activate-target-v2 <id>")
    .description("Activate a V2 target")
    .action((id) => tryRun(() => out(activateTargetV2(id))));

  exp
    .command("pause-target-v2 <id>")
    .description("Pause a V2 target")
    .action((id) => tryRun(() => out(pauseTargetV2(id))));

  exp
    .command("archive-target-v2 <id>")
    .description("Archive a V2 target")
    .action((id) => tryRun(() => out(archiveTargetV2(id))));

  exp
    .command("touch-target-v2 <id>")
    .description("Touch a V2 target")
    .action((id) => tryRun(() => out(touchTargetV2(id))));

  exp
    .command("create-export-job-v2 <id>")
    .description("Create a V2 export job")
    .requiredOption("-t, --target <id>", "target id")
    .option("-k, --kind <kind>", "job kind", "snapshot")
    .action((id, opts) =>
      tryRun(() =>
        out(createExportJobV2(id, { targetId: opts.target, kind: opts.kind })),
      ),
    );

  exp
    .command("get-export-job-v2 <id>")
    .description("Get a V2 export job")
    .action((id) => out(getExportJobV2(id)));

  exp
    .command("list-export-jobs-v2")
    .description("List V2 export jobs")
    .option("-t, --target <id>", "filter by target")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listExportJobsV2({ targetId: opts.target, status: opts.status })),
    );

  exp
    .command("set-export-job-status-v2 <id> <next>")
    .description("Set V2 export-job status")
    .action((id, next) => tryRun(() => out(setExportJobStatusV2(id, next))));

  exp
    .command("start-export-job-v2 <id>")
    .description("Start a V2 export job")
    .action((id) => tryRun(() => out(startExportJobV2(id))));

  exp
    .command("complete-export-job-v2 <id>")
    .description("Complete a V2 export job")
    .action((id) => tryRun(() => out(completeExportJobV2(id))));

  exp
    .command("fail-export-job-v2 <id>")
    .description("Fail a V2 export job")
    .action((id) => tryRun(() => out(failExportJobV2(id))));

  exp
    .command("cancel-export-job-v2 <id>")
    .description("Cancel a V2 export job")
    .action((id) => tryRun(() => out(cancelExportJobV2(id))));

  exp
    .command("auto-pause-idle-targets-v2")
    .description("Auto-pause idle V2 targets")
    .action(() => out(autoPauseIdleTargetsV2()));

  exp
    .command("auto-fail-stuck-export-jobs-v2")
    .description("Auto-fail stuck V2 export jobs")
    .action(() => out(autoFailStuckExportJobsV2()));
}

// === Iter22 V2 governance overlay ===
export function registerKexpgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "export");
  if (!parent) return;
  const L = async () => await import("../lib/knowledge-exporter.js");
  parent
    .command("kexpgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.KEXPGOV_PROFILE_MATURITY_V2,
            exportLifecycle: m.KEXPGOV_EXPORT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("kexpgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveKexpgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingKexpgovExportsPerProfileV2(),
            idleMs: m.getKexpgovProfileIdleMsV2(),
            stuckMs: m.getKexpgovExportStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("kexpgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveKexpgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("kexpgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingKexpgovExportsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("kexpgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setKexpgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("kexpgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setKexpgovExportStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("kexpgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--format <v>", "format")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerKexpgovProfileV2({ id, owner, format: o.format }),
          null,
          2,
        ),
      );
    });
  parent
    .command("kexpgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateKexpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("kexpgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleKexpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("kexpgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveKexpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("kexpgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchKexpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("kexpgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getKexpgovProfileV2(id), null, 2));
    });
  parent
    .command("kexpgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listKexpgovProfilesV2(), null, 2));
    });
  parent
    .command("kexpgov-create-export-v2 <id> <profileId>")
    .description("Create export")
    .option("--destination <v>", "destination")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createKexpgovExportV2({
            id,
            profileId,
            destination: o.destination,
          }),
          null,
          2,
        ),
      );
    });
  parent
    .command("kexpgov-exporting-export-v2 <id>")
    .description("Mark export as exporting")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).exportingKexpgovExportV2(id), null, 2),
      );
    });
  parent
    .command("kexpgov-complete-export-v2 <id>")
    .description("Complete export")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeExportKexpgovV2(id), null, 2),
      );
    });
  parent
    .command("kexpgov-fail-export-v2 <id> [reason]")
    .description("Fail export")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failKexpgovExportV2(id, reason), null, 2),
      );
    });
  parent
    .command("kexpgov-cancel-export-v2 <id> [reason]")
    .description("Cancel export")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelKexpgovExportV2(id, reason), null, 2),
      );
    });
  parent
    .command("kexpgov-get-export-v2 <id>")
    .description("Get export")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getKexpgovExportV2(id), null, 2));
    });
  parent
    .command("kexpgov-list-exports-v2")
    .description("List exports")
    .action(async () => {
      console.log(JSON.stringify((await L()).listKexpgovExportsV2(), null, 2));
    });
  parent
    .command("kexpgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleKexpgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("kexpgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck exports")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckKexpgovExportsV2(), null, 2),
      );
    });
  parent
    .command("kexpgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getKnowledgeExporterGovStatsV2(), null, 2),
      );
    });
}
