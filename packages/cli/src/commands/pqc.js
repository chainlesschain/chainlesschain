/**
 * PQC commands
 * chainlesschain pqc keys|generate|migration-status|migrate
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensurePQCTables,
  listKeys,
  generateKey,
  getMigrationStatus,
  migrate,
  listAlgorithms,
  KEY_MATURITY_V2,
  MIGRATION_LIFECYCLE_V2,
  getMaxActiveKeysPerOwnerV2,
  setMaxActiveKeysPerOwnerV2,
  getMaxPendingMigrationsPerKeyV2,
  setMaxPendingMigrationsPerKeyV2,
  getKeyIdleMsV2,
  setKeyIdleMsV2,
  getMigrationStuckMsV2,
  setMigrationStuckMsV2,
  registerKeyV2,
  getKeyV2,
  listKeysV2,
  activateKeyV2,
  deprecateKeyV2,
  archiveKeyV2,
  touchKeyV2,
  createMigrationV2,
  getMigrationV2,
  listMigrationsV2,
  startMigrationV2,
  completeMigrationV2,
  failMigrationV2,
  cancelMigrationV2,
  getActiveKeyCountV2,
  getPendingMigrationCountV2,
  autoDeprecateIdleKeysV2,
  autoFailStuckMigrationsV2,
  getPqcManagerStatsV2,
} from "../lib/pqc-manager.js";

export function registerPqcCommand(program) {
  const pqc = program
    .command("pqc")
    .description("Post-quantum cryptography — key management and migration");

  // pqc keys
  pqc
    .command("keys")
    .description("List PQC keys")
    .option("-a, --algorithm <algo>", "Filter by algorithm")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensurePQCTables(db);

        const keys = listKeys({ algorithm: options.algorithm });
        if (options.json) {
          console.log(JSON.stringify(keys, null, 2));
        } else if (keys.length === 0) {
          logger.info("No PQC keys. Use `pqc generate` to create one.");
        } else {
          for (const k of keys) {
            logger.log(
              `  ${chalk.cyan(k.id.slice(0, 8))} ${k.algorithm} [${k.purpose}] size=${k.keySize} hybrid=${k.hybridMode}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // pqc generate
  pqc
    .command("generate <algorithm>")
    .description("Generate a PQC key pair")
    .option(
      "-p, --purpose <purpose>",
      "Key purpose: encryption, signing, key_exchange",
      "encryption",
    )
    .action(async (algorithm, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensurePQCTables(db);

        const key = generateKey(db, algorithm, options.purpose);
        logger.success("PQC key generated");
        logger.log(`  ${chalk.bold("ID:")}        ${chalk.cyan(key.id)}`);
        logger.log(`  ${chalk.bold("Algorithm:")} ${key.algorithm}`);
        logger.log(`  ${chalk.bold("Purpose:")}   ${key.purpose}`);
        logger.log(`  ${chalk.bold("Key Size:")}  ${key.keySize}`);
        logger.log(`  ${chalk.bold("Hybrid:")}    ${key.hybridMode}`);
        if (key.classicalAlgorithm) {
          logger.log(`  ${chalk.bold("Classical:")} ${key.classicalAlgorithm}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // pqc migration-status
  pqc
    .command("migration-status")
    .description("Show PQC migration status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensurePQCTables(db);

        const plans = getMigrationStatus();
        if (options.json) {
          console.log(JSON.stringify(plans, null, 2));
        } else if (plans.length === 0) {
          logger.info("No migration plans.");
        } else {
          for (const p of plans) {
            logger.log(
              `  ${chalk.cyan(p.id.slice(0, 8))} ${p.planName} ${p.sourceAlgorithm}→${p.targetAlgorithm} [${p.status}] ${p.migratedKeys}/${p.totalKeys}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // pqc algorithms
  pqc
    .command("algorithms")
    .description("List supported PQC algorithms (FIPS 203/204/205 + hybrid)")
    .option(
      "-f, --family <family>",
      "Filter by family: ml-kem|ml-dsa|slh-dsa|hybrid",
    )
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const algos = listAlgorithms({ family: options.family });
        if (options.json) {
          console.log(JSON.stringify(algos, null, 2));
          return;
        }
        if (algos.length === 0) {
          logger.info("No algorithms match filter.");
          return;
        }
        for (const a of algos) {
          const sig =
            a.signatureBytes != null ? `sig=${a.signatureBytes}B` : "sig=—";
          logger.log(
            `  ${chalk.cyan(a.algorithm.padEnd(26))} ${chalk.dim(a.family.padEnd(8))} lvl=${a.keySize} pk=${a.publicKeyBytes}B ${sig}`,
          );
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // pqc migrate
  pqc
    .command("migrate <plan-name> <target-algorithm>")
    .description("Execute PQC key migration")
    .option("-s, --source <algorithm>", "Source algorithm to migrate from")
    .action(async (planName, targetAlgorithm, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensurePQCTables(db);

        const plan = migrate(db, planName, options.source, targetAlgorithm);
        logger.success("Migration completed");
        logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(plan.id)}`);
        logger.log(`  ${chalk.bold("Plan:")}     ${plan.planName}`);
        logger.log(`  ${chalk.bold("Source:")}   ${plan.sourceAlgorithm}`);
        logger.log(`  ${chalk.bold("Target:")}   ${plan.targetAlgorithm}`);
        logger.log(
          `  ${chalk.bold("Migrated:")} ${plan.migratedKeys}/${plan.totalKeys}`,
        );
        logger.log(`  ${chalk.bold("Status:")}   ${plan.status}`);

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ===== V2 in-memory governance surface (no DB, no bootstrap) =====

  pqc
    .command("key-maturities-v2")
    .description("[V2] List key maturity states")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const states = Object.values(KEY_MATURITY_V2);
      if (opts.json) console.log(JSON.stringify(states, null, 2));
      else for (const s of states) logger.log(s);
    });

  pqc
    .command("migration-lifecycles-v2")
    .description("[V2] List migration lifecycle states")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const states = Object.values(MIGRATION_LIFECYCLE_V2);
      if (opts.json) console.log(JSON.stringify(states, null, 2));
      else for (const s of states) logger.log(s);
    });

  pqc
    .command("config-v2")
    .description("[V2] Show governance config")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const cfg = {
        maxActiveKeysPerOwner: getMaxActiveKeysPerOwnerV2(),
        maxPendingMigrationsPerKey: getMaxPendingMigrationsPerKeyV2(),
        keyIdleMs: getKeyIdleMsV2(),
        migrationStuckMs: getMigrationStuckMsV2(),
      };
      if (opts.json) console.log(JSON.stringify(cfg, null, 2));
      else for (const [k, v] of Object.entries(cfg)) logger.log(`${k}: ${v}`);
    });

  pqc
    .command("set-max-active-keys-per-owner-v2 <n>")
    .description("[V2] Set per-owner active key cap")
    .action((n) => {
      try {
        setMaxActiveKeysPerOwnerV2(Number(n));
        logger.success(
          `max active keys/owner = ${getMaxActiveKeysPerOwnerV2()}`,
        );
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("set-max-pending-migrations-per-key-v2 <n>")
    .description("[V2] Set per-key pending migration cap")
    .action((n) => {
      try {
        setMaxPendingMigrationsPerKeyV2(Number(n));
        logger.success(
          `max pending migrations/key = ${getMaxPendingMigrationsPerKeyV2()}`,
        );
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("set-key-idle-ms-v2 <ms>")
    .description("[V2] Set key idle threshold (ms)")
    .action((ms) => {
      try {
        setKeyIdleMsV2(Number(ms));
        logger.success(`key idle ms = ${getKeyIdleMsV2()}`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("set-migration-stuck-ms-v2 <ms>")
    .description("[V2] Set migration stuck threshold (ms)")
    .action((ms) => {
      try {
        setMigrationStuckMsV2(Number(ms));
        logger.success(`migration stuck ms = ${getMigrationStuckMsV2()}`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("register-key-v2 <id>")
    .description("[V2] Register a key profile (PENDING)")
    .requiredOption("-o, --owner <id>", "Owner ID")
    .requiredOption("-a, --algorithm <algo>", "Algorithm")
    .option("-p, --purpose <purpose>", "Purpose", "general")
    .action((id, opts) => {
      try {
        const k = registerKeyV2(id, {
          ownerId: opts.owner,
          algorithm: opts.algorithm,
          purpose: opts.purpose,
        });
        logger.success(`key ${k.id} registered (status=${k.status})`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("activate-key-v2 <id>")
    .description("[V2] Activate a key (pending|deprecated -> active)")
    .action((id) => {
      try {
        const k = activateKeyV2(id);
        logger.success(`key ${k.id} active`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("deprecate-key-v2 <id>")
    .description("[V2] Deprecate a key (active -> deprecated)")
    .action((id) => {
      try {
        const k = deprecateKeyV2(id);
        logger.success(`key ${k.id} deprecated`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("archive-key-v2 <id>")
    .description("[V2] Archive a key (terminal)")
    .action((id) => {
      try {
        const k = archiveKeyV2(id);
        logger.success(`key ${k.id} archived`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("touch-key-v2 <id>")
    .description("[V2] Bump key lastSeenAt")
    .action((id) => {
      try {
        const k = touchKeyV2(id);
        logger.success(`key ${k.id} touched`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("get-key-v2 <id>")
    .description("[V2] Show a key profile")
    .option("--json", "Output as JSON")
    .action((id, opts) => {
      try {
        const k = getKeyV2(id);
        if (!k) {
          logger.info("key not found");
          return;
        }
        if (opts.json) console.log(JSON.stringify(k, null, 2));
        else logger.log(JSON.stringify(k, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("list-keys-v2")
    .description("[V2] List key profiles")
    .option("-o, --owner <id>", "Filter by owner")
    .option("-s, --status <s>", "Filter by status")
    .option("-a, --algorithm <algo>", "Filter by algorithm")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = listKeysV2({
        ownerId: opts.owner,
        status: opts.status,
        algorithm: opts.algorithm,
      });
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else
        for (const k of list)
          logger.log(`${k.id}\t${k.ownerId}\t${k.status}\t${k.algorithm}`);
    });

  pqc
    .command("create-migration-v2 <id>")
    .description("[V2] Create a queued V2 migration")
    .requiredOption("-k, --key <keyId>", "Key ID")
    .requiredOption("-t, --target <algo>", "Target algorithm")
    .action((id, opts) => {
      try {
        const m = createMigrationV2(id, {
          keyId: opts.key,
          targetAlgorithm: opts.target,
        });
        logger.success(
          `migration ${m.id} queued (key=${m.keyId} ${m.sourceAlgorithm}->${m.targetAlgorithm})`,
        );
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("start-migration-v2 <id>")
    .description("[V2] Start a migration (queued -> running)")
    .action((id) => {
      try {
        const m = startMigrationV2(id);
        logger.success(`migration ${m.id} running`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("complete-migration-v2 <id>")
    .description("[V2] Complete a migration (running -> completed)")
    .action((id) => {
      try {
        const m = completeMigrationV2(id);
        logger.success(`migration ${m.id} completed`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("fail-migration-v2 <id>")
    .description("[V2] Fail a migration (running -> failed)")
    .action((id) => {
      try {
        const m = failMigrationV2(id);
        logger.success(`migration ${m.id} failed`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("cancel-migration-v2 <id>")
    .description("[V2] Cancel a migration (queued|running -> cancelled)")
    .action((id) => {
      try {
        const m = cancelMigrationV2(id);
        logger.success(`migration ${m.id} cancelled`);
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("get-migration-v2 <id>")
    .description("[V2] Show migration job")
    .option("--json", "Output as JSON")
    .action((id, opts) => {
      try {
        const m = getMigrationV2(id);
        if (!m) {
          logger.info("migration not found");
          return;
        }
        if (opts.json) console.log(JSON.stringify(m, null, 2));
        else logger.log(JSON.stringify(m, null, 2));
      } catch (err) {
        logger.error(err.message);
        process.exit(1);
      }
    });

  pqc
    .command("list-migrations-v2")
    .description("[V2] List V2 migrations")
    .option("-k, --key <keyId>", "Filter by key")
    .option("-s, --status <s>", "Filter by status")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = listMigrationsV2({ keyId: opts.key, status: opts.status });
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else
        for (const m of list)
          logger.log(
            `${m.id}\t${m.keyId}\t${m.status}\t${m.sourceAlgorithm}->${m.targetAlgorithm}`,
          );
    });

  pqc
    .command("active-key-count-v2")
    .description("[V2] Count active keys (optional --owner filter)")
    .option("-o, --owner <id>", "Filter by owner")
    .action((opts) => {
      logger.log(String(getActiveKeyCountV2(opts.owner)));
    });

  pqc
    .command("pending-migration-count-v2")
    .description(
      "[V2] Count pending migrations (queued+running) (optional --key filter)",
    )
    .option("-k, --key <keyId>", "Filter by key")
    .action((opts) => {
      logger.log(String(getPendingMigrationCountV2(opts.key)));
    });

  pqc
    .command("auto-deprecate-idle-keys-v2")
    .description("[V2] Deprecate idle active keys")
    .option("--now <ms>", "Override current time (ms)")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = autoDeprecateIdleKeysV2(
        opts.now ? { now: Number(opts.now) } : undefined,
      );
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else logger.success(`deprecated ${list.length} key(s)`);
    });

  pqc
    .command("auto-fail-stuck-migrations-v2")
    .description("[V2] Fail stuck running migrations")
    .option("--now <ms>", "Override current time (ms)")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const list = autoFailStuckMigrationsV2(
        opts.now ? { now: Number(opts.now) } : undefined,
      );
      if (opts.json) console.log(JSON.stringify(list, null, 2));
      else logger.success(`failed ${list.length} migration(s)`);
    });

  pqc
    .command("stats-v2")
    .description("[V2] Show governance stats")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const s = getPqcManagerStatsV2();
      if (opts.json) console.log(JSON.stringify(s, null, 2));
      else logger.log(JSON.stringify(s, null, 2));
    });
}

// === Iter22 V2 governance overlay ===
export function registerPqcgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "pqc");
  if (!parent) return;
  const L = async () => await import("../lib/pqc-manager.js");
  parent
    .command("pqcgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.PQCGOV_PROFILE_MATURITY_V2,
            keygenLifecycle: m.PQCGOV_KEYGEN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pqcgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePqcgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPqcgovKeygensPerProfileV2(),
            idleMs: m.getPqcgovProfileIdleMsV2(),
            stuckMs: m.getPqcgovKeygenStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pqcgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePqcgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pqcgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPqcgovKeygensPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pqcgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPqcgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pqcgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPqcgovKeygenStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pqcgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--algorithm <v>", "algorithm")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPqcgovProfileV2({ id, owner, algorithm: o.algorithm }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pqcgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePqcgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pqcgov-deprecate-v2 <id>")
    .description("Deprecate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).deprecatePqcgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pqcgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePqcgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pqcgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchPqcgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pqcgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPqcgovProfileV2(id), null, 2));
    });
  parent
    .command("pqcgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPqcgovProfilesV2(), null, 2));
    });
  parent
    .command("pqcgov-create-keygen-v2 <id> <profileId>")
    .description("Create keygen")
    .option("--purpose <v>", "purpose")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPqcgovKeygenV2({ id, profileId, purpose: o.purpose }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pqcgov-generating-keygen-v2 <id>")
    .description("Mark keygen as generating")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).generatingPqcgovKeygenV2(id), null, 2),
      );
    });
  parent
    .command("pqcgov-complete-keygen-v2 <id>")
    .description("Complete keygen")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeKeygenPqcgovV2(id), null, 2),
      );
    });
  parent
    .command("pqcgov-fail-keygen-v2 <id> [reason]")
    .description("Fail keygen")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPqcgovKeygenV2(id, reason), null, 2),
      );
    });
  parent
    .command("pqcgov-cancel-keygen-v2 <id> [reason]")
    .description("Cancel keygen")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelPqcgovKeygenV2(id, reason), null, 2),
      );
    });
  parent
    .command("pqcgov-get-keygen-v2 <id>")
    .description("Get keygen")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPqcgovKeygenV2(id), null, 2));
    });
  parent
    .command("pqcgov-list-keygens-v2")
    .description("List keygens")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPqcgovKeygensV2(), null, 2));
    });
  parent
    .command("pqcgov-auto-deprecate-idle-v2")
    .description("Auto-deprecate idle")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).autoDeprecateIdlePqcgovProfilesV2(),
          null,
          2,
        ),
      );
    });
  parent
    .command("pqcgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck keygens")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPqcgovKeygensV2(), null, 2),
      );
    });
  parent
    .command("pqcgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getPqcManagerGovStatsV2(), null, 2),
      );
    });
}
