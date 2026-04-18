/**
 * Sync commands
 * chainlesschain sync status|push|pull|conflicts|resolve|log|clear
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  getSyncStatus,
  pushResources,
  pullResources,
  getConflicts,
  resolveConflict,
  getSyncLog,
  clearSyncData,
  registerResource,
  getAllSyncStates,
  RESOURCE_MATURITY_V2,
  SYNC_RUN_V2,
  getMaxActiveResourcesPerOwnerV2,
  setMaxActiveResourcesPerOwnerV2,
  getMaxRunningRunsPerResourceV2,
  setMaxRunningRunsPerResourceV2,
  getResourceIdleMsV2,
  setResourceIdleMsV2,
  getRunStuckMsV2,
  setRunStuckMsV2,
  getActiveResourceCountV2,
  getRunningRunCountV2,
  registerResourceV2,
  getResourceV2,
  listResourcesV2,
  activateResourceV2,
  pauseResourceV2,
  archiveResourceV2,
  touchResourceV2,
  createSyncRunV2,
  getSyncRunV2,
  listSyncRunsV2,
  startSyncRunV2,
  succeedSyncRunV2,
  failSyncRunV2,
  cancelSyncRunV2,
  autoArchiveIdleResourcesV2,
  autoFailStuckSyncRunsV2,
  getSyncManagerStatsV2,
} from "../lib/sync-manager.js";

export function registerSyncCommand(program) {
  const sync = program
    .command("sync")
    .description("File and knowledge synchronization");

  // sync status
  sync
    .command("status", { isDefault: true })
    .description("Show sync status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const status = getSyncStatus(db);

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          logger.log(chalk.bold("Sync Status:\n"));
          logger.log(`  ${chalk.bold("Resources:")}  ${status.totalResources}`);
          logger.log(
            `  ${chalk.bold("Pending:")}    ${chalk.yellow(status.pending)}`,
          );
          logger.log(
            `  ${chalk.bold("Synced:")}     ${chalk.green(status.synced)}`,
          );
          logger.log(
            `  ${chalk.bold("Conflicts:")}  ${status.conflicts > 0 ? chalk.red(status.conflicts) : "0"}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync push
  sync
    .command("push")
    .description("Push local changes to remote")
    .option("--type <type>", "Resource type to push")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = pushResources(db, options.type);
        logger.success(`Pushed ${result.pushed}/${result.total} resources`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync pull
  sync
    .command("pull")
    .description("Pull remote changes to local")
    .option("--type <type>", "Resource type to pull")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = pullResources(db, options.type);
        logger.success(
          `Checked ${result.checked} resources, updated ${result.updated}`,
        );
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync conflicts
  sync
    .command("conflicts")
    .description("Show sync conflicts")
    .option("--all", "Include resolved conflicts")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const conflicts = getConflicts(db, { resolved: options.all });

        if (options.json) {
          console.log(JSON.stringify(conflicts, null, 2));
        } else if (conflicts.length === 0) {
          logger.info("No conflicts");
        } else {
          logger.log(chalk.bold(`Conflicts (${conflicts.length}):\n`));
          for (const c of conflicts) {
            const resolved = c.resolution
              ? chalk.green("[resolved]")
              : chalk.red("[unresolved]");
            logger.log(`  ${chalk.cyan(c.id)} ${resolved}`);
            logger.log(
              `    ${chalk.gray(`${c.resource_type}/${c.resource_id}`)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync resolve
  sync
    .command("resolve")
    .description("Resolve a sync conflict")
    .argument("<conflict-id>", "Conflict ID")
    .option("--use <side>", "Use local or remote version", "local")
    .action(async (conflictId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = resolveConflict(db, conflictId, options.use);

        if (ok) {
          logger.success(`Conflict resolved (${options.use})`);
        } else {
          logger.error(`Conflict not found: ${conflictId}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync log
  sync
    .command("log")
    .description("Show sync operation log")
    .option("--limit <n>", "Number of entries", "20")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const entries = getSyncLog(db, { limit: parseInt(options.limit) });

        if (options.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else if (entries.length === 0) {
          logger.info("No sync log entries");
        } else {
          logger.log(chalk.bold(`Sync Log (${entries.length}):\n`));
          for (const e of entries) {
            const statusColor =
              e.status === "success" ? chalk.green : chalk.red;
            logger.log(
              `  ${chalk.gray(e.created_at)} ${chalk.bold(e.operation)} ${statusColor(e.status)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // sync clear
  sync
    .command("clear")
    .description("Clear all sync data")
    .option("--force", "Skip confirmation")
    .action(async (options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Clear all sync data? This cannot be undone.",
          });
          if (!ok) {
            logger.info("Cancelled");
            return;
          }
        }

        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        clearSyncData(db);
        logger.success("Sync data cleared");
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────
  // V2 Surface — resource + sync-run lifecycle (in-memory, throwing API)
  // ─────────────────────────────────────────────────────────────

  sync
    .command("resource-maturities-v2")
    .description("List V2 resource maturity states")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(RESOURCE_MATURITY_V2);
      if (options.json) console.log(JSON.stringify(v));
      else logger.log(v.join(", "));
    });

  sync
    .command("run-lifecycles-v2")
    .description("List V2 sync-run lifecycle states")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(SYNC_RUN_V2);
      if (options.json) console.log(JSON.stringify(v));
      else logger.log(v.join(", "));
    });

  sync
    .command("stats-v2")
    .description("Show V2 sync stats")
    .option("--json", "Output as JSON")
    .action((options) => {
      const stats = getSyncManagerStatsV2();
      if (options.json) console.log(JSON.stringify(stats, null, 2));
      else logger.log(JSON.stringify(stats, null, 2));
    });

  sync
    .command("get-max-active-resources-v2")
    .description("Get max active resources per owner")
    .action(() => logger.log(String(getMaxActiveResourcesPerOwnerV2())));
  sync
    .command("set-max-active-resources-v2 <n>")
    .description("Set max active resources per owner")
    .action((n) => {
      setMaxActiveResourcesPerOwnerV2(Number(n));
      logger.log(String(getMaxActiveResourcesPerOwnerV2()));
    });
  sync
    .command("get-max-running-runs-v2")
    .description("Get max running runs per resource")
    .action(() => logger.log(String(getMaxRunningRunsPerResourceV2())));
  sync
    .command("set-max-running-runs-v2 <n>")
    .description("Set max running runs per resource")
    .action((n) => {
      setMaxRunningRunsPerResourceV2(Number(n));
      logger.log(String(getMaxRunningRunsPerResourceV2()));
    });
  sync
    .command("get-resource-idle-ms-v2")
    .description("Get resource idle ms")
    .action(() => logger.log(String(getResourceIdleMsV2())));
  sync
    .command("set-resource-idle-ms-v2 <ms>")
    .description("Set resource idle ms")
    .action((ms) => {
      setResourceIdleMsV2(Number(ms));
      logger.log(String(getResourceIdleMsV2()));
    });
  sync
    .command("get-run-stuck-ms-v2")
    .description("Get run stuck ms")
    .action(() => logger.log(String(getRunStuckMsV2())));
  sync
    .command("set-run-stuck-ms-v2 <ms>")
    .description("Set run stuck ms")
    .action((ms) => {
      setRunStuckMsV2(Number(ms));
      logger.log(String(getRunStuckMsV2()));
    });

  sync
    .command("active-resource-count-v2 <owner>")
    .description("Count active resources for owner")
    .action((owner) => logger.log(String(getActiveResourceCountV2(owner))));
  sync
    .command("running-run-count-v2 <resourceId>")
    .description("Count running runs for resource")
    .action((resourceId) =>
      logger.log(String(getRunningRunCountV2(resourceId))),
    );

  sync
    .command("register-resource-v2 <id>")
    .description("Register V2 resource (initial=pending)")
    .requiredOption("-o, --owner <owner>", "owner")
    .requiredOption("-k, --kind <kind>", "kind (file/note/...)")
    .option("-m, --metadata <json>", "metadata JSON", "{}")
    .action((id, opts) => {
      const meta = JSON.parse(opts.metadata);
      const r = registerResourceV2(id, {
        owner: opts.owner,
        kind: opts.kind,
        metadata: meta,
      });
      console.log(JSON.stringify(r, null, 2));
    });

  sync
    .command("get-resource-v2 <id>")
    .description("Get V2 resource by id")
    .action((id) => {
      const r = getResourceV2(id);
      if (!r) {
        logger.error(`resource ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(r, null, 2));
    });

  sync
    .command("list-resources-v2")
    .description("List V2 resources")
    .option("-o, --owner <owner>", "filter by owner")
    .option("-k, --kind <kind>", "filter by kind")
    .option("-s, --status <state>", "filter by status")
    .action((opts) => {
      const out = listResourcesV2({
        owner: opts.owner,
        kind: opts.kind,
        status: opts.status,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  sync
    .command("activate-resource-v2 <id>")
    .description("Transition resource → active")
    .action((id) =>
      console.log(JSON.stringify(activateResourceV2(id), null, 2)),
    );
  sync
    .command("pause-resource-v2 <id>")
    .description("Transition resource → paused")
    .action((id) => console.log(JSON.stringify(pauseResourceV2(id), null, 2)));
  sync
    .command("archive-resource-v2 <id>")
    .description("Transition resource → archived (terminal)")
    .action((id) =>
      console.log(JSON.stringify(archiveResourceV2(id), null, 2)),
    );
  sync
    .command("touch-resource-v2 <id>")
    .description("Update resource lastSeenAt")
    .action((id) => console.log(JSON.stringify(touchResourceV2(id), null, 2)));

  sync
    .command("create-sync-run-v2 <id>")
    .description("Create V2 sync run (initial=queued)")
    .requiredOption("-r, --resource <id>", "resource id")
    .option("-k, --kind <kind>", "run kind", "push")
    .option("-m, --metadata <json>", "metadata JSON", "{}")
    .action((id, opts) => {
      const meta = JSON.parse(opts.metadata);
      const j = createSyncRunV2(id, {
        resourceId: opts.resource,
        kind: opts.kind,
        metadata: meta,
      });
      console.log(JSON.stringify(j, null, 2));
    });

  sync
    .command("get-sync-run-v2 <id>")
    .description("Get V2 sync run by id")
    .action((id) => {
      const j = getSyncRunV2(id);
      if (!j) {
        logger.error(`syncRun ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(j, null, 2));
    });

  sync
    .command("list-sync-runs-v2")
    .description("List V2 sync runs")
    .option("-r, --resource <id>", "filter by resource")
    .option("-s, --status <state>", "filter by status")
    .action((opts) => {
      const out = listSyncRunsV2({
        resourceId: opts.resource,
        status: opts.status,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  sync
    .command("start-sync-run-v2 <id>")
    .description("Transition sync run → running")
    .action((id) => console.log(JSON.stringify(startSyncRunV2(id), null, 2)));
  sync
    .command("succeed-sync-run-v2 <id>")
    .description("Transition sync run → succeeded (terminal)")
    .action((id) => console.log(JSON.stringify(succeedSyncRunV2(id), null, 2)));
  sync
    .command("fail-sync-run-v2 <id>")
    .description("Transition sync run → failed (terminal)")
    .action((id) => console.log(JSON.stringify(failSyncRunV2(id), null, 2)));
  sync
    .command("cancel-sync-run-v2 <id>")
    .description("Transition sync run → cancelled (terminal)")
    .action((id) => console.log(JSON.stringify(cancelSyncRunV2(id), null, 2)));

  sync
    .command("auto-archive-idle-v2")
    .description("Auto-archive idle resources; output flipped")
    .action(() => {
      const flipped = autoArchiveIdleResourcesV2();
      console.log(JSON.stringify(flipped, null, 2));
    });
  sync
    .command("auto-fail-stuck-runs-v2")
    .description("Auto-fail stuck running syncs; output flipped")
    .action(() => {
      const flipped = autoFailStuckSyncRunsV2();
      console.log(JSON.stringify(flipped, null, 2));
    });
}
