/**
 * SCIM commands
 * chainlesschain scim users|connectors|sync|status
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureSCIMTables,
  listUsers,
  createUser,
  getUser,
  deleteUser,
  listConnectors,
  addConnector,
  syncProvision,
  getStatus,
  IDENTITY_LIFECYCLE_V2,
  SYNC_JOB_V2,
  SCIM_DEFAULT_MAX_PROVISIONED_PER_CONNECTOR,
  SCIM_DEFAULT_MAX_RUNNING_SYNC_PER_CONNECTOR,
  SCIM_DEFAULT_IDENTITY_IDLE_MS,
  SCIM_DEFAULT_SYNC_STUCK_MS,
  getMaxProvisionedPerConnectorV2,
  setMaxProvisionedPerConnectorV2,
  getMaxRunningSyncPerConnectorV2,
  setMaxRunningSyncPerConnectorV2,
  getIdentityIdleMsV2,
  setIdentityIdleMsV2,
  getSyncStuckMsV2,
  setSyncStuckMsV2,
  getProvisionedCountV2,
  getRunningSyncCountV2,
  registerIdentityV2,
  getIdentityV2,
  listIdentitiesV2,
  provisionIdentityV2,
  suspendIdentityV2,
  deprovisionIdentityV2,
  touchIdentityV2,
  createSyncJobV2,
  getSyncJobV2,
  listSyncJobsV2,
  startSyncJobV2,
  succeedSyncJobV2,
  failSyncJobV2,
  cancelSyncJobV2,
  autoDeprovisionIdleIdentitiesV2,
  autoFailStuckSyncJobsV2,
  getScimManagerStatsV2,
} from "../lib/scim-manager.js";

export function registerScimCommand(program) {
  const scim = program
    .command("scim")
    .description("SCIM provisioning — user management, connectors, sync");

  // scim users
  const users = scim.command("users").description("SCIM user management");

  users
    .command("list")
    .description("List SCIM users")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        const result = listUsers();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.resources.length === 0) {
          logger.info("No SCIM users.");
        } else {
          for (const u of result.resources) {
            logger.log(
              `  ${chalk.cyan(u.id.slice(0, 8))} ${u.userName} (${u.displayName}) active=${u.active}`,
            );
          }
          logger.log(`\n${result.totalResults} user(s) total.`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  users
    .command("create <username>")
    .description("Create a SCIM user")
    .option("-n, --name <display-name>", "Display name")
    .option("-e, --email <email>", "Email address")
    .action(async (username, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        const user = createUser(db, username, options.name, options.email);
        logger.success("User created");
        logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(user.id)}`);
        logger.log(`  ${chalk.bold("Username:")} ${user.userName}`);
        logger.log(`  ${chalk.bold("Name:")}     ${user.displayName}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  users
    .command("get <user-id>")
    .description("Get a SCIM user by ID")
    .option("--json", "Output as JSON")
    .action(async (userId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        const user = getUser(userId);
        if (!user) {
          logger.error(`User not found: ${userId}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(user, null, 2));
        } else {
          logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(user.id)}`);
          logger.log(`  ${chalk.bold("Username:")} ${user.userName}`);
          logger.log(`  ${chalk.bold("Name:")}     ${user.displayName}`);
          logger.log(`  ${chalk.bold("Email:")}    ${user.email || "N/A"}`);
          logger.log(`  ${chalk.bold("Active:")}   ${user.active}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  users
    .command("delete <user-id>")
    .description("Delete a SCIM user")
    .action(async (userId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        deleteUser(db, userId);
        logger.success(`User ${chalk.cyan(userId.slice(0, 8))} deleted`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // scim connectors
  scim
    .command("connectors")
    .description("List SCIM connectors")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const connectors = listConnectors();
        if (options.json) {
          console.log(JSON.stringify(connectors, null, 2));
        } else if (connectors.length === 0) {
          logger.info("No SCIM connectors configured.");
        } else {
          for (const c of connectors) {
            logger.log(
              `  ${chalk.cyan(c.id.slice(0, 8))} ${c.name} [${c.provider}] status=${c.status}`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // scim sync
  scim
    .command("sync <connector-id>")
    .description("Trigger SCIM provisioning sync")
    .action(async (connectorId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureSCIMTables(db);

        const result = syncProvision(db, connectorId);
        logger.success(`Sync completed via ${chalk.cyan(result.connector)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // scim status
  scim
    .command("status")
    .description("Show SCIM provisioning status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const status = getStatus();
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          logger.log(`  ${chalk.bold("Users:")}      ${status.users}`);
          logger.log(`  ${chalk.bold("Connectors:")} ${status.connectors}`);
          logger.log(`  ${chalk.bold("Sync Ops:")}   ${status.syncOperations}`);
          logger.log(
            `  ${chalk.bold("Last Sync:")}  ${status.lastSync || "never"}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────
  // V2 Surface — identity + sync-job lifecycle (in-memory, throwing API)
  // ─────────────────────────────────────────────────────────────

  scim
    .command("identity-lifecycles-v2")
    .description("List V2 identity lifecycle states")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(IDENTITY_LIFECYCLE_V2);
      if (options.json) console.log(JSON.stringify(v));
      else logger.log(v.join(", "));
    });

  scim
    .command("sync-lifecycles-v2")
    .description("List V2 sync-job lifecycle states")
    .option("--json", "Output as JSON")
    .action((options) => {
      const v = Object.values(SYNC_JOB_V2);
      if (options.json) console.log(JSON.stringify(v));
      else logger.log(v.join(", "));
    });

  scim
    .command("stats-v2")
    .description("Show V2 SCIM stats")
    .option("--json", "Output as JSON")
    .action((options) => {
      const stats = getScimManagerStatsV2();
      if (options.json) console.log(JSON.stringify(stats, null, 2));
      else logger.log(JSON.stringify(stats, null, 2));
    });

  scim
    .command("get-max-provisioned-v2")
    .description("Get max provisioned identities per connector")
    .action(() => logger.log(String(getMaxProvisionedPerConnectorV2())));
  scim
    .command("set-max-provisioned-v2 <n>")
    .description("Set max provisioned identities per connector")
    .action((n) => {
      setMaxProvisionedPerConnectorV2(Number(n));
      logger.log(String(getMaxProvisionedPerConnectorV2()));
    });
  scim
    .command("get-max-running-sync-v2")
    .description("Get max running sync jobs per connector")
    .action(() => logger.log(String(getMaxRunningSyncPerConnectorV2())));
  scim
    .command("set-max-running-sync-v2 <n>")
    .description("Set max running sync jobs per connector")
    .action((n) => {
      setMaxRunningSyncPerConnectorV2(Number(n));
      logger.log(String(getMaxRunningSyncPerConnectorV2()));
    });
  scim
    .command("get-identity-idle-ms-v2")
    .description("Get identity idle ms")
    .action(() => logger.log(String(getIdentityIdleMsV2())));
  scim
    .command("set-identity-idle-ms-v2 <ms>")
    .description("Set identity idle ms")
    .action((ms) => {
      setIdentityIdleMsV2(Number(ms));
      logger.log(String(getIdentityIdleMsV2()));
    });
  scim
    .command("get-sync-stuck-ms-v2")
    .description("Get sync-job stuck ms")
    .action(() => logger.log(String(getSyncStuckMsV2())));
  scim
    .command("set-sync-stuck-ms-v2 <ms>")
    .description("Set sync-job stuck ms")
    .action((ms) => {
      setSyncStuckMsV2(Number(ms));
      logger.log(String(getSyncStuckMsV2()));
    });

  scim
    .command("provisioned-count-v2 <connectorId>")
    .description("Count provisioned identities for connector")
    .action((connectorId) =>
      logger.log(String(getProvisionedCountV2(connectorId))),
    );
  scim
    .command("running-sync-count-v2 <connectorId>")
    .description("Count running sync jobs for connector")
    .action((connectorId) =>
      logger.log(String(getRunningSyncCountV2(connectorId))),
    );

  scim
    .command("register-identity-v2 <id>")
    .description("Register V2 identity (initial=pending)")
    .requiredOption("-c, --connector <id>", "connector id")
    .requiredOption("-e, --external <id>", "external id")
    .option("-m, --metadata <json>", "metadata JSON", "{}")
    .action((id, opts) => {
      const meta = JSON.parse(opts.metadata);
      const i = registerIdentityV2(id, {
        connectorId: opts.connector,
        externalId: opts.external,
        metadata: meta,
      });
      console.log(JSON.stringify(i, null, 2));
    });

  scim
    .command("get-identity-v2 <id>")
    .description("Get V2 identity by id")
    .action((id) => {
      const i = getIdentityV2(id);
      if (!i) {
        logger.error(`identity ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(i, null, 2));
    });

  scim
    .command("list-identities-v2")
    .description("List V2 identities")
    .option("-c, --connector <id>", "filter by connector")
    .option("-s, --status <state>", "filter by status")
    .action((opts) => {
      const out = listIdentitiesV2({
        connectorId: opts.connector,
        status: opts.status,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  scim
    .command("provision-identity-v2 <id>")
    .description("Transition identity → provisioned")
    .action((id) =>
      console.log(JSON.stringify(provisionIdentityV2(id), null, 2)),
    );
  scim
    .command("suspend-identity-v2 <id>")
    .description("Transition identity → suspended")
    .action((id) =>
      console.log(JSON.stringify(suspendIdentityV2(id), null, 2)),
    );
  scim
    .command("deprovision-identity-v2 <id>")
    .description("Transition identity → deprovisioned (terminal)")
    .action((id) =>
      console.log(JSON.stringify(deprovisionIdentityV2(id), null, 2)),
    );
  scim
    .command("touch-identity-v2 <id>")
    .description("Update identity lastSeenAt")
    .action((id) => console.log(JSON.stringify(touchIdentityV2(id), null, 2)));

  scim
    .command("create-sync-job-v2 <id>")
    .description("Create V2 sync job (initial=queued)")
    .requiredOption("-c, --connector <id>", "connector id")
    .option("-k, --kind <kind>", "job kind", "full")
    .option("-m, --metadata <json>", "metadata JSON", "{}")
    .action((id, opts) => {
      const meta = JSON.parse(opts.metadata);
      const j = createSyncJobV2(id, {
        connectorId: opts.connector,
        kind: opts.kind,
        metadata: meta,
      });
      console.log(JSON.stringify(j, null, 2));
    });

  scim
    .command("get-sync-job-v2 <id>")
    .description("Get V2 sync job by id")
    .action((id) => {
      const j = getSyncJobV2(id);
      if (!j) {
        logger.error(`syncJob ${id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(j, null, 2));
    });

  scim
    .command("list-sync-jobs-v2")
    .description("List V2 sync jobs")
    .option("-c, --connector <id>", "filter by connector")
    .option("-s, --status <state>", "filter by status")
    .action((opts) => {
      const out = listSyncJobsV2({
        connectorId: opts.connector,
        status: opts.status,
      });
      console.log(JSON.stringify(out, null, 2));
    });

  scim
    .command("start-sync-job-v2 <id>")
    .description("Transition sync job → running")
    .action((id) => console.log(JSON.stringify(startSyncJobV2(id), null, 2)));
  scim
    .command("succeed-sync-job-v2 <id>")
    .description("Transition sync job → succeeded (terminal)")
    .action((id) => console.log(JSON.stringify(succeedSyncJobV2(id), null, 2)));
  scim
    .command("fail-sync-job-v2 <id>")
    .description("Transition sync job → failed (terminal)")
    .action((id) => console.log(JSON.stringify(failSyncJobV2(id), null, 2)));
  scim
    .command("cancel-sync-job-v2 <id>")
    .description("Transition sync job → cancelled (terminal)")
    .action((id) => console.log(JSON.stringify(cancelSyncJobV2(id), null, 2)));

  scim
    .command("auto-deprovision-idle-v2")
    .description("Auto-deprovision idle identities; output flipped")
    .action(() => {
      const flipped = autoDeprovisionIdleIdentitiesV2();
      console.log(JSON.stringify(flipped, null, 2));
    });
  scim
    .command("auto-fail-stuck-sync-v2")
    .description("Auto-fail stuck running syncs; output flipped")
    .action(() => {
      const flipped = autoFailStuckSyncJobsV2();
      console.log(JSON.stringify(flipped, null, 2));
    });
}

// === Iter19 V2 governance overlay ===
export function registerScimgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "scim");
  if (!parent) return;
  const L = async () => await import("../lib/scim-manager.js");
  parent
    .command("scimgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SCIMGOV_PROFILE_MATURITY_V2,
            syncLifecycle: m.SCIMGOV_SYNC_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("scimgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveScimgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingScimgovSyncsPerProfileV2(),
            idleMs: m.getScimgovProfileIdleMsV2(),
            stuckMs: m.getScimgovSyncStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("scimgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveScimgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("scimgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingScimgovSyncsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("scimgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setScimgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("scimgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setScimgovSyncStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("scimgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--resource <v>", "resource")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerScimgovProfileV2({ id, owner, resource: o.resource }),
          null,
          2,
        ),
      );
    });
  parent
    .command("scimgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateScimgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("scimgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleScimgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("scimgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveScimgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("scimgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchScimgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("scimgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getScimgovProfileV2(id), null, 2));
    });
  parent
    .command("scimgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listScimgovProfilesV2(), null, 2));
    });
  parent
    .command("scimgov-create-sync-v2 <id> <profileId>")
    .description("Create sync")
    .option("--endpoint <v>", "endpoint")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createScimgovSyncV2({ id, profileId, endpoint: o.endpoint }),
          null,
          2,
        ),
      );
    });
  parent
    .command("scimgov-syncing-sync-v2 <id>")
    .description("Mark sync as syncing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).syncingScimgovSyncV2(id), null, 2),
      );
    });
  parent
    .command("scimgov-complete-sync-v2 <id>")
    .description("Complete sync")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeSyncScimgovV2(id), null, 2),
      );
    });
  parent
    .command("scimgov-fail-sync-v2 <id> [reason]")
    .description("Fail sync")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failScimgovSyncV2(id, reason), null, 2),
      );
    });
  parent
    .command("scimgov-cancel-sync-v2 <id> [reason]")
    .description("Cancel sync")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelScimgovSyncV2(id, reason), null, 2),
      );
    });
  parent
    .command("scimgov-get-sync-v2 <id>")
    .description("Get sync")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getScimgovSyncV2(id), null, 2));
    });
  parent
    .command("scimgov-list-syncs-v2")
    .description("List syncs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listScimgovSyncsV2(), null, 2));
    });
  parent
    .command("scimgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleScimgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("scimgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck syncs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckScimgovSyncsV2(), null, 2),
      );
    });
  parent
    .command("scimgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getScimManagerGovStatsV2(), null, 2),
      );
    });
}
