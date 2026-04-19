/**
 * Encryption commands
 * chainlesschain encrypt <file> | decrypt <file> | db encrypt | db decrypt | info <file>
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  encryptFile,
  decryptFile,
  isEncryptedFile,
  getEncryptedFileInfo,
  getDbEncryptionStatus,
  setDbEncryptionStatus,
  hashPassword,
  KEY_MATURITY_V2 as CRYPTO_KEY_MATURITY_V2,
  CRYPTO_JOB_LIFECYCLE_V2,
  getMaxActiveKeysPerOwnerV2 as cryptoGetMaxActiveKeys,
  setMaxActiveKeysPerOwnerV2 as cryptoSetMaxActiveKeys,
  getMaxPendingJobsPerKeyV2 as cryptoGetMaxPendingJobs,
  setMaxPendingJobsPerKeyV2 as cryptoSetMaxPendingJobs,
  getKeyIdleMsV2 as cryptoGetKeyIdleMs,
  setKeyIdleMsV2 as cryptoSetKeyIdleMs,
  getJobStuckMsV2,
  setJobStuckMsV2,
  registerKeyV2 as cryptoRegisterKey,
  getKeyV2 as cryptoGetKey,
  listKeysV2 as cryptoListKeys,
  activateKeyV2 as cryptoActivateKey,
  rotateKeyV2,
  retireKeyV2,
  touchKeyV2 as cryptoTouchKey,
  createJobV2,
  getJobV2,
  listJobsV2,
  startJobV2,
  completeJobV2,
  failJobV2,
  cancelJobV2,
  getActiveKeyCountV2 as cryptoGetActiveKeyCount,
  getPendingJobCountV2,
  autoRotateIdleKeysV2,
  autoFailStuckJobsV2,
  getCryptoManagerStatsV2,
} from "../lib/crypto-manager.js";

async function promptPassword(message = "Password:") {
  const { password } = await import("@inquirer/prompts");
  return password({ message });
}

export function registerEncryptCommand(program) {
  const enc = program
    .command("encrypt")
    .description("File encryption and database encryption management");

  // encrypt file
  enc
    .command("file")
    .description("Encrypt a file with AES-256-GCM")
    .argument("<path>", "File to encrypt")
    .option("-o, --output <path>", "Output file path (default: <file>.enc)")
    .option("-p, --password <pass>", "Password (prompted if not given)")
    .action(async (filePath, options) => {
      try {
        const pass =
          options.password || (await promptPassword("Encryption password:"));
        if (!pass) {
          logger.error("Password is required");
          process.exit(1);
        }

        // Confirm password
        if (!options.password) {
          const confirm = await promptPassword("Confirm password:");
          if (pass !== confirm) {
            logger.error("Passwords do not match");
            process.exit(1);
          }
        }

        const result = encryptFile(filePath, pass, options.output);
        logger.success("File encrypted");
        logger.log(
          `  ${chalk.bold("Input:")}    ${result.inputPath} (${result.originalSize} bytes)`,
        );
        logger.log(
          `  ${chalk.bold("Output:")}   ${result.outputPath} (${result.encryptedSize} bytes)`,
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // decrypt file
  const dec = program
    .command("decrypt")
    .description("Decrypt an encrypted file");

  dec
    .command("file")
    .description("Decrypt an AES-256-GCM encrypted file")
    .argument("<path>", "File to decrypt (.enc)")
    .option("-o, --output <path>", "Output file path")
    .option("-p, --password <pass>", "Password (prompted if not given)")
    .action(async (filePath, options) => {
      try {
        const pass =
          options.password || (await promptPassword("Decryption password:"));
        if (!pass) {
          logger.error("Password is required");
          process.exit(1);
        }

        const result = decryptFile(filePath, pass, options.output);
        logger.success("File decrypted");
        logger.log(
          `  ${chalk.bold("Input:")}    ${result.inputPath} (${result.encryptedSize} bytes)`,
        );
        logger.log(
          `  ${chalk.bold("Output:")}   ${result.outputPath} (${result.decryptedSize} bytes)`,
        );
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // encrypt db
  enc
    .command("db")
    .description("Enable database encryption tracking")
    .option("-p, --password <pass>", "Password (prompted if not given)")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        if (getDbEncryptionStatus(db)) {
          logger.info("Database is already marked as encrypted");
          await shutdown();
          return;
        }

        const pass =
          options.password ||
          (await promptPassword("Database encryption password:"));
        if (!pass) {
          logger.error("Password is required");
          process.exit(1);
        }

        const { hash, salt } = hashPassword(pass);
        setDbEncryptionStatus(db, true, hash, salt);
        logger.success(
          "Database encryption status set. Note: full SQLCipher encryption requires the desktop app.",
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // decrypt db
  dec
    .command("db")
    .description("Disable database encryption tracking")
    .option("--force", "Skip confirmation")
    .action(async (options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Disable database encryption tracking?",
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
        setDbEncryptionStatus(db, false);
        logger.success("Database encryption status cleared");

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // encrypt info
  enc
    .command("info")
    .description("Check if a file is encrypted")
    .argument("<path>", "File to check")
    .option("--json", "Output as JSON")
    .action(async (filePath, options) => {
      try {
        const info = getEncryptedFileInfo(filePath);

        if (options.json) {
          console.log(JSON.stringify(info, null, 2));
        } else {
          logger.log(chalk.bold("File Info:\n"));
          logger.log(`  ${chalk.bold("Path:")}      ${info.path}`);
          logger.log(`  ${chalk.bold("Size:")}      ${info.size} bytes`);
          logger.log(
            `  ${chalk.bold("Encrypted:")} ${info.encrypted ? chalk.green("yes (ChainlessChain format)") : chalk.gray("no")}`,
          );
          logger.log(`  ${chalk.bold("Modified:")}  ${info.modified}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // encrypt status (db status)
  enc
    .command("status")
    .description("Show database encryption status")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const encrypted = getDbEncryptionStatus(db);

        if (options.json) {
          console.log(JSON.stringify({ encrypted }, null, 2));
        } else {
          logger.log(
            `Database encryption: ${encrypted ? chalk.green("enabled") : chalk.gray("not enabled")}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ===== V2 in-memory governance surface (no DB, no bootstrap) =====

  enc
    .command("key-maturities-v2")
    .description("[V2] List crypto key maturity states")
    .option("--json")
    .action((o) => {
      const s = Object.values(CRYPTO_KEY_MATURITY_V2);
      if (o.json) console.log(JSON.stringify(s, null, 2));
      else for (const v of s) logger.log(v);
    });
  enc
    .command("job-lifecycles-v2")
    .description("[V2] List crypto job lifecycle states")
    .option("--json")
    .action((o) => {
      const s = Object.values(CRYPTO_JOB_LIFECYCLE_V2);
      if (o.json) console.log(JSON.stringify(s, null, 2));
      else for (const v of s) logger.log(v);
    });
  enc
    .command("config-v2")
    .description("[V2] Show governance config")
    .option("--json")
    .action((o) => {
      const cfg = {
        maxActiveKeysPerOwner: cryptoGetMaxActiveKeys(),
        maxPendingJobsPerKey: cryptoGetMaxPendingJobs(),
        keyIdleMs: cryptoGetKeyIdleMs(),
        jobStuckMs: getJobStuckMsV2(),
      };
      if (o.json) console.log(JSON.stringify(cfg, null, 2));
      else for (const [k, v] of Object.entries(cfg)) logger.log(`${k}: ${v}`);
    });
  enc
    .command("set-max-active-keys-per-owner-v2 <n>")
    .description("[V2] Set per-owner active key cap")
    .action((n) => {
      try {
        cryptoSetMaxActiveKeys(Number(n));
        logger.success(`= ${cryptoGetMaxActiveKeys()}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("set-max-pending-jobs-per-key-v2 <n>")
    .description("[V2] Set per-key pending job cap")
    .action((n) => {
      try {
        cryptoSetMaxPendingJobs(Number(n));
        logger.success(`= ${cryptoGetMaxPendingJobs()}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("set-key-idle-ms-v2 <ms>")
    .description("[V2] Set key idle threshold (ms)")
    .action((m) => {
      try {
        cryptoSetKeyIdleMs(Number(m));
        logger.success(`= ${cryptoGetKeyIdleMs()}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("set-job-stuck-ms-v2 <ms>")
    .description("[V2] Set job stuck threshold (ms)")
    .action((m) => {
      try {
        setJobStuckMsV2(Number(m));
        logger.success(`= ${getJobStuckMsV2()}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });

  enc
    .command("register-key-v2 <id>")
    .description("[V2] Register a crypto key profile (PENDING)")
    .requiredOption("-o, --owner <id>")
    .requiredOption("-a, --algorithm <algo>")
    .option("-p, --purpose <p>", "Purpose", "encryption")
    .action((id, o) => {
      try {
        const k = cryptoRegisterKey(id, {
          ownerId: o.owner,
          algorithm: o.algorithm,
          purpose: o.purpose,
        });
        logger.success(`key ${k.id} registered (status=${k.status})`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("activate-key-v2 <id>")
    .description("[V2] Activate key (pending|rotated -> active)")
    .action((id) => {
      try {
        cryptoActivateKey(id);
        logger.success(`key ${id} active`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("rotate-key-v2 <id>")
    .description("[V2] Rotate key (active -> rotated)")
    .action((id) => {
      try {
        rotateKeyV2(id);
        logger.success(`key ${id} rotated`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("retire-key-v2 <id>")
    .description("[V2] Retire key (terminal)")
    .action((id) => {
      try {
        retireKeyV2(id);
        logger.success(`key ${id} retired`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("touch-key-v2 <id>")
    .description("[V2] Bump key lastSeenAt")
    .action((id) => {
      try {
        cryptoTouchKey(id);
        logger.success(`key ${id} touched`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("get-key-v2 <id>")
    .description("[V2] Show crypto key profile")
    .option("--json")
    .action((id) => {
      const k = cryptoGetKey(id);
      if (!k) {
        logger.info("key not found");
        return;
      }
      console.log(JSON.stringify(k, null, 2));
    });
  enc
    .command("list-keys-v2")
    .description("[V2] List crypto key profiles")
    .option("-o, --owner <id>")
    .option("-s, --status <s>")
    .option("-a, --algorithm <algo>")
    .option("--json")
    .action((o) => {
      const list = cryptoListKeys({
        ownerId: o.owner,
        status: o.status,
        algorithm: o.algorithm,
      });
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else
        for (const k of list)
          logger.log(`${k.id}\t${k.ownerId}\t${k.status}\t${k.algorithm}`);
    });

  enc
    .command("create-job-v2 <id>")
    .description("[V2] Create a queued V2 crypto job")
    .requiredOption("-k, --key <keyId>")
    .option("-K, --kind <kind>", "Job kind", "encrypt")
    .action((id, o) => {
      try {
        const j = createJobV2(id, { keyId: o.key, kind: o.kind });
        logger.success(`job ${j.id} queued (key=${j.keyId} kind=${j.kind})`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("start-job-v2 <id>")
    .description("[V2] Start crypto job (queued -> running)")
    .action((id) => {
      try {
        startJobV2(id);
        logger.success(`job ${id} running`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("complete-job-v2 <id>")
    .description("[V2] Complete crypto job (running -> completed)")
    .action((id) => {
      try {
        completeJobV2(id);
        logger.success(`job ${id} completed`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("fail-job-v2 <id>")
    .description("[V2] Fail crypto job (running -> failed)")
    .action((id) => {
      try {
        failJobV2(id);
        logger.success(`job ${id} failed`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("cancel-job-v2 <id>")
    .description("[V2] Cancel crypto job (queued|running -> cancelled)")
    .action((id) => {
      try {
        cancelJobV2(id);
        logger.success(`job ${id} cancelled`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  enc
    .command("get-job-v2 <id>")
    .description("[V2] Show crypto job")
    .option("--json")
    .action((id) => {
      const j = getJobV2(id);
      if (!j) {
        logger.info("job not found");
        return;
      }
      console.log(JSON.stringify(j, null, 2));
    });
  enc
    .command("list-jobs-v2")
    .description("[V2] List V2 crypto jobs")
    .option("-k, --key <keyId>")
    .option("-s, --status <s>")
    .option("-K, --kind <kind>")
    .option("--json")
    .action((o) => {
      const list = listJobsV2({ keyId: o.key, status: o.status, kind: o.kind });
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else
        for (const j of list)
          logger.log(`${j.id}\t${j.keyId}\t${j.status}\t${j.kind}`);
    });

  enc
    .command("active-key-count-v2")
    .description("[V2] Count active crypto keys (optional --owner)")
    .option("-o, --owner <id>")
    .action((o) => logger.log(String(cryptoGetActiveKeyCount(o.owner))));
  enc
    .command("pending-job-count-v2")
    .description("[V2] Count pending crypto jobs (queued+running)")
    .option("-k, --key <keyId>")
    .action((o) => logger.log(String(getPendingJobCountV2(o.key))));
  enc
    .command("auto-rotate-idle-keys-v2")
    .description("[V2] Rotate idle active keys")
    .option("--now <ms>")
    .option("--json")
    .action((o) => {
      const list = autoRotateIdleKeysV2(
        o.now ? { now: Number(o.now) } : undefined,
      );
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else logger.success(`rotated ${list.length}`);
    });
  enc
    .command("auto-fail-stuck-jobs-v2")
    .description("[V2] Fail stuck running crypto jobs")
    .option("--now <ms>")
    .option("--json")
    .action((o) => {
      const list = autoFailStuckJobsV2(
        o.now ? { now: Number(o.now) } : undefined,
      );
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else logger.success(`failed ${list.length}`);
    });
  enc
    .command("stats-v2")
    .description("[V2] Show governance stats")
    .option("--json")
    .action(() =>
      console.log(JSON.stringify(getCryptoManagerStatsV2(), null, 2)),
    );
}

// === Iter28 V2 governance overlay: Crygov ===
export function registerCryV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "encrypt");
  if (!parent) return;
  const L = async () => await import("../lib/crypto-manager.js");
  parent
    .command("crygov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.CRYGOV_PROFILE_MATURITY_V2,
            encryptLifecycle: m.CRYGOV_ENCRYPT_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("crygov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveCryProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingCryEncryptsPerProfileV2(),
            idleMs: m.getCryProfileIdleMsV2(),
            stuckMs: m.getCryEncryptStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("crygov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveCryProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("crygov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingCryEncryptsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("crygov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setCryProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("crygov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setCryEncryptStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("crygov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--provider <v>", "provider")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerCryProfileV2({ id, owner, provider: o.provider }),
          null,
          2,
        ),
      );
    });
  parent
    .command("crygov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateCryProfileV2(id), null, 2),
      );
    });
  parent
    .command("crygov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).staleCryProfileV2(id), null, 2));
    });
  parent
    .command("crygov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).archiveCryProfileV2(id), null, 2));
    });
  parent
    .command("crygov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchCryProfileV2(id), null, 2));
    });
  parent
    .command("crygov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCryProfileV2(id), null, 2));
    });
  parent
    .command("crygov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCryProfilesV2(), null, 2));
    });
  parent
    .command("crygov-create-encrypt-v2 <id> <profileId>")
    .description("Create encrypt")
    .option("--keyId <v>", "keyId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createCryEncryptV2({ id, profileId, keyId: o.keyId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("crygov-encrypting-encrypt-v2 <id>")
    .description("Mark encrypt as encrypting")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).encryptingCryEncryptV2(id), null, 2),
      );
    });
  parent
    .command("crygov-complete-encrypt-v2 <id>")
    .description("Complete encrypt")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeEncryptCryV2(id), null, 2),
      );
    });
  parent
    .command("crygov-fail-encrypt-v2 <id> [reason]")
    .description("Fail encrypt")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failCryEncryptV2(id, reason), null, 2),
      );
    });
  parent
    .command("crygov-cancel-encrypt-v2 <id> [reason]")
    .description("Cancel encrypt")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelCryEncryptV2(id, reason), null, 2),
      );
    });
  parent
    .command("crygov-get-encrypt-v2 <id>")
    .description("Get encrypt")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCryEncryptV2(id), null, 2));
    });
  parent
    .command("crygov-list-encrypts-v2")
    .description("List encrypts")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCryEncryptsV2(), null, 2));
    });
  parent
    .command("crygov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleCryProfilesV2(), null, 2),
      );
    });
  parent
    .command("crygov-auto-fail-stuck-v2")
    .description("Auto-fail stuck encrypts")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckCryEncryptsV2(), null, 2),
      );
    });
  parent
    .command("crygov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getCrygovStatsV2(), null, 2));
    });
}
