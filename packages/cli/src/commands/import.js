/**
 * Knowledge import commands
 * chainlesschain import markdown|evernote|notion|pdf <path>
 */

import chalk from "chalk";
import ora from "ora";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  importMarkdownDir,
  importEnexFile,
  importNotionDir,
  SOURCE_MATURITY_V2,
  IMPORT_JOB_LIFECYCLE_V2,
  getMaxActiveSourcesPerOwnerV2,
  setMaxActiveSourcesPerOwnerV2,
  getMaxPendingJobsPerSourceV2,
  setMaxPendingJobsPerSourceV2,
  getSourceIdleMsV2,
  setSourceIdleMsV2,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerSourceV2,
  getSourceV2,
  listSourcesV2,
  setSourceStatusV2,
  activateSourceV2,
  pauseSourceV2,
  archiveSourceV2,
  touchSourceV2,
  getActiveSourceCountV2,
  createImportJobV2,
  getImportJobV2,
  listImportJobsV2,
  setImportJobStatusV2,
  startImportJobV2,
  completeImportJobV2,
  failImportJobV2,
  cancelImportJobV2,
  getPendingJobCountV2,
  autoPauseIdleSourcesV2,
  autoFailStuckImportJobsV2,
  getKnowledgeImporterStatsV2,
} from "../lib/knowledge-importer.js";

export function registerImportCommand(program) {
  const imp = program
    .command("import")
    .description("Import knowledge from external sources");

  // import markdown
  imp
    .command("markdown")
    .description("Import markdown files from a directory")
    .argument("<dir>", "Directory containing .md files")
    .option("--json", "Output as JSON")
    .action(async (dir, options) => {
      try {
        const absDir = resolve(dir);
        if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
          logger.error(`Directory not found: ${absDir}`);
          process.exit(1);
        }

        const spinner = ora("Importing markdown files...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const imported = importMarkdownDir(db, absDir);
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: imported.length, notes: imported },
              null,
              2,
            ),
          );
        } else if (imported.length === 0) {
          logger.info("No .md files found in the directory");
        } else {
          logger.success(
            `Imported ${chalk.cyan(imported.length)} markdown notes`,
          );
          for (const n of imported.slice(0, 10)) {
            logger.log(
              `  ${chalk.gray(n.id.slice(0, 8))}  ${chalk.white(n.title)}  ${chalk.gray(n.source || "")}`,
            );
          }
          if (imported.length > 10) {
            logger.log(chalk.gray(`  ... and ${imported.length - 10} more`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Import failed: ${err.message}`);
        process.exit(1);
      }
    });

  // import evernote
  imp
    .command("evernote")
    .description("Import from Evernote ENEX export file")
    .argument("<file>", "Path to .enex file")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      try {
        const absFile = resolve(file);
        if (!existsSync(absFile)) {
          logger.error(`File not found: ${absFile}`);
          process.exit(1);
        }

        const spinner = ora("Importing Evernote notes...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const imported = importEnexFile(db, absFile);
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: imported.length, notes: imported },
              null,
              2,
            ),
          );
        } else if (imported.length === 0) {
          logger.info("No notes found in the ENEX file");
        } else {
          logger.success(
            `Imported ${chalk.cyan(imported.length)} Evernote notes`,
          );
          for (const n of imported.slice(0, 10)) {
            const tags =
              n.tags.length > 0 ? chalk.gray(` [${n.tags.join(", ")}]`) : "";
            logger.log(
              `  ${chalk.gray(n.id.slice(0, 8))}  ${chalk.white(n.title)}${tags}`,
            );
          }
          if (imported.length > 10) {
            logger.log(chalk.gray(`  ... and ${imported.length - 10} more`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Import failed: ${err.message}`);
        process.exit(1);
      }
    });

  // import notion
  imp
    .command("notion")
    .description("Import from Notion export directory")
    .argument("<dir>", "Notion export directory")
    .option("--json", "Output as JSON")
    .action(async (dir, options) => {
      try {
        const absDir = resolve(dir);
        if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
          logger.error(`Directory not found: ${absDir}`);
          process.exit(1);
        }

        const spinner = ora("Importing Notion pages...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();
        const imported = importNotionDir(db, absDir);
        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              { count: imported.length, notes: imported },
              null,
              2,
            ),
          );
        } else if (imported.length === 0) {
          logger.info("No markdown pages found in Notion export");
        } else {
          logger.success(
            `Imported ${chalk.cyan(imported.length)} Notion pages`,
          );
          for (const n of imported.slice(0, 10)) {
            const tags =
              n.tags.length > 0 ? chalk.gray(` [${n.tags.join(", ")}]`) : "";
            logger.log(
              `  ${chalk.gray(n.id.slice(0, 8))}  ${chalk.white(n.title)}${tags}`,
            );
          }
          if (imported.length > 10) {
            logger.log(chalk.gray(`  ... and ${imported.length - 10} more`));
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Import failed: ${err.message}`);
        process.exit(1);
      }
    });

  // import pdf
  imp
    .command("pdf")
    .description("Import text from a PDF file")
    .argument("<file>", "Path to .pdf file")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      try {
        const absFile = resolve(file);
        if (!existsSync(absFile)) {
          logger.error(`File not found: ${absFile}`);
          process.exit(1);
        }

        const spinner = ora("Extracting text from PDF...").start();
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          spinner.fail("Database not available");
          process.exit(1);
        }

        const db = ctx.db.getDatabase();

        // Lazy-load pdf-parser to keep it optional
        const { parsePdfText } = await import("../lib/pdf-parser.js");
        const { insertNote, ensureNotesTable } =
          await import("../lib/knowledge-importer.js");
        ensureNotesTable(db);

        const parsed = await parsePdfText(absFile);
        spinner.stop();

        if (!parsed.content || parsed.content.trim().length === 0) {
          logger.info("No text could be extracted from the PDF");
          await shutdown();
          return;
        }

        const note = insertNote(db, {
          title: parsed.title,
          content: parsed.content,
          tags: ["pdf"],
          category: "pdf",
        });

        if (options.json) {
          console.log(JSON.stringify(note, null, 2));
        } else {
          logger.success(`Imported PDF as note: ${chalk.cyan(parsed.title)}`);
          logger.log(`  ${chalk.gray("ID:")} ${note.id.slice(0, 8)}`);
          logger.log(
            `  ${chalk.gray("Length:")} ${parsed.content.length} chars`,
          );
          if (parsed.pages) {
            logger.log(`  ${chalk.gray("Pages:")} ${parsed.pages}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`PDF import failed: ${err.message}`);
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

  imp
    .command("source-maturities-v2")
    .description("List V2 source maturity states")
    .action(() => out(Object.values(SOURCE_MATURITY_V2)));

  imp
    .command("import-job-lifecycles-v2")
    .description("List V2 import-job lifecycle states")
    .action(() => out(Object.values(IMPORT_JOB_LIFECYCLE_V2)));

  imp
    .command("stats-v2")
    .description("V2 knowledge-importer stats")
    .action(() => out(getKnowledgeImporterStatsV2()));

  imp
    .command("get-max-active-sources-v2")
    .description("Get max active sources per owner (V2)")
    .action(() =>
      out({ maxActiveSourcesPerOwner: getMaxActiveSourcesPerOwnerV2() }),
    );

  imp
    .command("set-max-active-sources-v2 <n>")
    .description("Set max active sources per owner (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxActiveSourcesPerOwnerV2(Number(n));
        out({ maxActiveSourcesPerOwner: getMaxActiveSourcesPerOwnerV2() });
      }),
    );

  imp
    .command("get-max-pending-jobs-v2")
    .description("Get max pending jobs per source (V2)")
    .action(() =>
      out({ maxPendingJobsPerSource: getMaxPendingJobsPerSourceV2() }),
    );

  imp
    .command("set-max-pending-jobs-v2 <n>")
    .description("Set max pending jobs per source (V2)")
    .action((n) =>
      tryRun(() => {
        setMaxPendingJobsPerSourceV2(Number(n));
        out({ maxPendingJobsPerSource: getMaxPendingJobsPerSourceV2() });
      }),
    );

  imp
    .command("get-source-idle-ms-v2")
    .description("Get source idle threshold (V2)")
    .action(() => out({ sourceIdleMs: getSourceIdleMsV2() }));

  imp
    .command("set-source-idle-ms-v2 <ms>")
    .description("Set source idle threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setSourceIdleMsV2(Number(ms));
        out({ sourceIdleMs: getSourceIdleMsV2() });
      }),
    );

  imp
    .command("get-job-stuck-ms-v2")
    .description("Get import-job stuck threshold (V2)")
    .action(() => out({ jobStuckMs: getJobStuckMsV2() }));

  imp
    .command("set-job-stuck-ms-v2 <ms>")
    .description("Set import-job stuck threshold (V2)")
    .action((ms) =>
      tryRun(() => {
        setJobStuckMsV2(Number(ms));
        out({ jobStuckMs: getJobStuckMsV2() });
      }),
    );

  imp
    .command("active-source-count-v2 <ownerId>")
    .description("Active source count for owner (V2)")
    .action((ownerId) =>
      out({ ownerId, count: getActiveSourceCountV2(ownerId) }),
    );

  imp
    .command("pending-job-count-v2 <sourceId>")
    .description("Pending import-job count for source (V2)")
    .action((sourceId) =>
      out({ sourceId, count: getPendingJobCountV2(sourceId) }),
    );

  imp
    .command("register-source-v2 <id>")
    .description("Register a V2 source manifest")
    .requiredOption("-o, --owner <id>", "owner id")
    .requiredOption("-l, --label <label>", "source label")
    .option("-k, --kind <kind>", "source kind", "markdown")
    .action((id, opts) =>
      tryRun(() =>
        out(
          registerSourceV2(id, {
            ownerId: opts.owner,
            label: opts.label,
            kind: opts.kind,
          }),
        ),
      ),
    );

  imp
    .command("get-source-v2 <id>")
    .description("Get a V2 source")
    .action((id) => out(getSourceV2(id)));

  imp
    .command("list-sources-v2")
    .description("List V2 sources")
    .option("-o, --owner <id>", "filter by owner")
    .option("-s, --status <status>", "filter by status")
    .action((opts) =>
      out(listSourcesV2({ ownerId: opts.owner, status: opts.status })),
    );

  imp
    .command("set-source-status-v2 <id> <next>")
    .description("Set V2 source status")
    .action((id, next) => tryRun(() => out(setSourceStatusV2(id, next))));

  imp
    .command("activate-source-v2 <id>")
    .description("Activate a V2 source")
    .action((id) => tryRun(() => out(activateSourceV2(id))));

  imp
    .command("pause-source-v2 <id>")
    .description("Pause a V2 source")
    .action((id) => tryRun(() => out(pauseSourceV2(id))));

  imp
    .command("archive-source-v2 <id>")
    .description("Archive a V2 source")
    .action((id) => tryRun(() => out(archiveSourceV2(id))));

  imp
    .command("touch-source-v2 <id>")
    .description("Touch a V2 source")
    .action((id) => tryRun(() => out(touchSourceV2(id))));

  imp
    .command("create-import-job-v2 <id>")
    .description("Create a V2 import job")
    .requiredOption("-s, --source <id>", "source id")
    .option("-k, --kind <kind>", "job kind", "scan")
    .action((id, opts) =>
      tryRun(() =>
        out(createImportJobV2(id, { sourceId: opts.source, kind: opts.kind })),
      ),
    );

  imp
    .command("get-import-job-v2 <id>")
    .description("Get a V2 import job")
    .action((id) => out(getImportJobV2(id)));

  imp
    .command("list-import-jobs-v2")
    .description("List V2 import jobs")
    .option("-s, --source <id>", "filter by source")
    .option("-t, --status <status>", "filter by status")
    .action((opts) =>
      out(listImportJobsV2({ sourceId: opts.source, status: opts.status })),
    );

  imp
    .command("set-import-job-status-v2 <id> <next>")
    .description("Set V2 import-job status")
    .action((id, next) => tryRun(() => out(setImportJobStatusV2(id, next))));

  imp
    .command("start-import-job-v2 <id>")
    .description("Start a V2 import job")
    .action((id) => tryRun(() => out(startImportJobV2(id))));

  imp
    .command("complete-import-job-v2 <id>")
    .description("Complete a V2 import job")
    .action((id) => tryRun(() => out(completeImportJobV2(id))));

  imp
    .command("fail-import-job-v2 <id>")
    .description("Fail a V2 import job")
    .action((id) => tryRun(() => out(failImportJobV2(id))));

  imp
    .command("cancel-import-job-v2 <id>")
    .description("Cancel a V2 import job")
    .action((id) => tryRun(() => out(cancelImportJobV2(id))));

  imp
    .command("auto-pause-idle-sources-v2")
    .description("Auto-pause idle V2 sources")
    .action(() => out(autoPauseIdleSourcesV2()));

  imp
    .command("auto-fail-stuck-import-jobs-v2")
    .description("Auto-fail stuck V2 import jobs")
    .action(() => out(autoFailStuckImportJobsV2()));
}

// === Iter22 V2 governance overlay ===
export function registerKimpgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "import");
  if (!parent) return;
  const L = async () => await import("../lib/knowledge-importer.js");
  parent
    .command("kimpgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.KIMPGOV_PROFILE_MATURITY_V2,
            importLifecycle: m.KIMPGOV_IMPORT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("kimpgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveKimpgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingKimpgovImportsPerProfileV2(),
            idleMs: m.getKimpgovProfileIdleMsV2(),
            stuckMs: m.getKimpgovImportStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("kimpgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveKimpgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("kimpgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingKimpgovImportsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("kimpgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setKimpgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("kimpgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setKimpgovImportStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("kimpgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--format <v>", "format")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerKimpgovProfileV2({ id, owner, format: o.format }),
          null,
          2,
        ),
      );
    });
  parent
    .command("kimpgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateKimpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("kimpgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleKimpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("kimpgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveKimpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("kimpgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchKimpgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("kimpgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getKimpgovProfileV2(id), null, 2));
    });
  parent
    .command("kimpgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listKimpgovProfilesV2(), null, 2));
    });
  parent
    .command("kimpgov-create-import-v2 <id> <profileId>")
    .description("Create import")
    .option("--source <v>", "source")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createKimpgovImportV2({ id, profileId, source: o.source }),
          null,
          2,
        ),
      );
    });
  parent
    .command("kimpgov-importing-import-v2 <id>")
    .description("Mark import as importing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).importingKimpgovImportV2(id), null, 2),
      );
    });
  parent
    .command("kimpgov-complete-import-v2 <id>")
    .description("Complete import")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeImportKimpgovV2(id), null, 2),
      );
    });
  parent
    .command("kimpgov-fail-import-v2 <id> [reason]")
    .description("Fail import")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failKimpgovImportV2(id, reason), null, 2),
      );
    });
  parent
    .command("kimpgov-cancel-import-v2 <id> [reason]")
    .description("Cancel import")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelKimpgovImportV2(id, reason), null, 2),
      );
    });
  parent
    .command("kimpgov-get-import-v2 <id>")
    .description("Get import")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getKimpgovImportV2(id), null, 2));
    });
  parent
    .command("kimpgov-list-imports-v2")
    .description("List imports")
    .action(async () => {
      console.log(JSON.stringify((await L()).listKimpgovImportsV2(), null, 2));
    });
  parent
    .command("kimpgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleKimpgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("kimpgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck imports")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckKimpgovImportsV2(), null, 2),
      );
    });
  parent
    .command("kimpgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getKnowledgeImporterGovStatsV2(), null, 2),
      );
    });
}
