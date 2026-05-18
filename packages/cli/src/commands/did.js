/**
 * DID management commands
 * chainlesschain did create|show|list|resolve|sign|verify|export|delete|set-default
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  createIdentity,
  getIdentity,
  getAllIdentities,
  setDefaultIdentity,
  deleteIdentity,
  signMessage,
  verifyWithDID,
  exportIdentity,
  resolveDID,
  IDENTITY_MATURITY_V2,
  ISSUANCE_LIFECYCLE_V2,
  getMaxActiveIdentitiesPerOwnerV2,
  setMaxActiveIdentitiesPerOwnerV2,
  getMaxPendingIssuancesPerIdentityV2,
  setMaxPendingIssuancesPerIdentityV2,
  getIdentityIdleMsV2,
  setIdentityIdleMsV2,
  getIssuanceStuckMsV2,
  setIssuanceStuckMsV2,
  registerIdentityV2,
  getIdentityV2,
  listIdentitiesV2,
  activateIdentityV2,
  suspendIdentityV2,
  revokeIdentityV2,
  touchIdentityV2,
  createIssuanceV2,
  getIssuanceV2,
  listIssuancesV2,
  startIssuanceV2,
  completeIssuanceV2,
  failIssuanceV2,
  cancelIssuanceV2,
  getActiveIdentityCountV2,
  getPendingIssuanceCountV2,
  autoSuspendIdleIdentitiesV2,
  autoFailStuckIssuancesV2,
  getDidManagerStatsV2,
} from "../lib/did-manager.js";

export function registerDidCommand(program) {
  const did = program
    .command("did")
    .description("Decentralized Identity (DID) management");

  // did create
  did
    .command("create")
    .description("Create a new DID identity")
    .option("--name <name>", "Display name for the identity")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const identity = createIdentity(db, options.name);

        if (options.json) {
          console.log(JSON.stringify(identity, null, 2));
        } else {
          logger.success("DID identity created");
          logger.log(`  ${chalk.bold("DID:")}     ${chalk.cyan(identity.did)}`);
          if (identity.displayName) {
            logger.log(`  ${chalk.bold("Name:")}    ${identity.displayName}`);
          }
          logger.log(
            `  ${chalk.bold("Default:")} ${identity.isDefault ? chalk.green("yes") : "no"}`,
          );
          logger.log(
            `  ${chalk.bold("PubKey:")}  ${chalk.gray(identity.publicKey.slice(0, 40))}...`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // did show
  did
    .command("show")
    .description("Show a specific DID identity")
    .argument("<did>", "DID or prefix")
    .option("--json", "Output as JSON")
    .action(async (didArg, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const identity = getIdentity(db, didArg);

        if (!identity) {
          logger.error(`Identity not found: ${didArg}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                did: identity.did,
                displayName: identity.display_name,
                publicKey: identity.public_key,
                isDefault: identity.is_default === 1,
                document: JSON.parse(identity.did_document || "{}"),
                createdAt: identity.created_at,
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(chalk.bold("DID Identity:\n"));
          logger.log(
            `  ${chalk.bold("DID:")}      ${chalk.cyan(identity.did)}`,
          );
          logger.log(
            `  ${chalk.bold("Name:")}     ${identity.display_name || chalk.gray("(none)")}`,
          );
          logger.log(
            `  ${chalk.bold("Default:")}  ${identity.is_default ? chalk.green("yes") : "no"}`,
          );
          logger.log(
            `  ${chalk.bold("PubKey:")}   ${chalk.gray(identity.public_key)}`,
          );
          logger.log(`  ${chalk.bold("Created:")}  ${identity.created_at}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // did list
  did
    .command("list", { isDefault: true })
    .description("List all DID identities")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const identities = getAllIdentities(db);

        if (options.json) {
          console.log(
            JSON.stringify(
              identities.map((i) => ({
                did: i.did,
                displayName: i.display_name,
                isDefault: i.is_default === 1,
                createdAt: i.created_at,
              })),
              null,
              2,
            ),
          );
        } else if (identities.length === 0) {
          logger.info(
            'No DID identities. Create one with "chainlesschain did create"',
          );
        } else {
          logger.log(chalk.bold(`DID Identities (${identities.length}):\n`));
          for (const id of identities) {
            const def = id.is_default ? chalk.green(" [default]") : "";
            const name = id.display_name ? ` (${id.display_name})` : "";
            logger.log(`  ${chalk.cyan(id.did)}${name}${def}`);
            logger.log(`    ${chalk.gray(`created: ${id.created_at}`)}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // did resolve
  did
    .command("resolve")
    .description("Resolve a DID to its DID Document")
    .argument("<did>", "DID to resolve")
    .action(async (didArg) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const doc = resolveDID(db, didArg);

        if (!doc) {
          logger.error(`DID not found: ${didArg}`);
          process.exit(1);
        }

        console.log(JSON.stringify(doc, null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // did sign
  did
    .command("sign")
    .description("Sign a message with a DID identity")
    .argument("<message>", "Message to sign")
    .option("--did <did>", "DID to sign with (default: default identity)")
    .option("--json", "Output as JSON")
    .action(async (message, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        const didStr =
          options.did ||
          (() => {
            const def = getIdentity(db, "did:chainless:");
            if (!def) throw new Error("No identities found. Create one first.");
            return def.did;
          })();

        const signature = signMessage(db, didStr, message);

        if (options.json) {
          console.log(
            JSON.stringify({ did: didStr, message, signature }, null, 2),
          );
        } else {
          logger.success("Message signed");
          logger.log(`  ${chalk.bold("Signature:")} ${chalk.gray(signature)}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // did verify
  did
    .command("verify")
    .description("Verify a signed message")
    .argument("<message>", "Original message")
    .argument("<signature>", "Signature to verify (hex)")
    .option("--did <did>", "DID that signed the message")
    .action(async (message, signature, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        if (!options.did) {
          logger.error("--did is required for verification");
          process.exit(1);
        }

        const valid = verifyWithDID(db, options.did, message, signature);
        if (valid) {
          logger.success("Signature is VALID");
        } else {
          logger.error("Signature is INVALID");
          process.exit(1);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // did export
  did
    .command("export")
    .description("Export DID identity (public data only)")
    .argument("<did>", "DID to export")
    .action(async (didArg) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const exported = exportIdentity(db, didArg);

        if (!exported) {
          logger.error(`Identity not found: ${didArg}`);
          process.exit(1);
        }

        console.log(JSON.stringify(exported, null, 2));
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // did set-default
  did
    .command("set-default")
    .description("Set a DID as the default identity")
    .argument("<did>", "DID to set as default")
    .action(async (didArg) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const ok = setDefaultIdentity(db, didArg);

        if (ok) {
          logger.success("Default identity updated");
        } else {
          logger.error(`Identity not found: ${didArg}`);
          process.exit(1);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // did delete
  did
    .command("delete")
    .description("Delete a DID identity")
    .argument("<did>", "DID to delete")
    .option("--force", "Skip confirmation")
    .action(async (didArg, options) => {
      try {
        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: "Delete this DID identity? The secret key will be lost.",
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
        const ok = deleteIdentity(db, didArg);

        if (ok) {
          logger.success("Identity deleted");
        } else {
          logger.error(`Identity not found: ${didArg}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ===== V2 in-memory governance surface (no DB, no bootstrap) =====

  did
    .command("identity-maturities-v2")
    .description("[V2] List identity maturity states")
    .option("--json")
    .action((o) => {
      const s = Object.values(IDENTITY_MATURITY_V2);
      if (o.json) console.log(JSON.stringify(s, null, 2));
      else for (const v of s) logger.log(v);
    });
  did
    .command("issuance-lifecycles-v2")
    .description("[V2] List issuance lifecycle states")
    .option("--json")
    .action((o) => {
      const s = Object.values(ISSUANCE_LIFECYCLE_V2);
      if (o.json) console.log(JSON.stringify(s, null, 2));
      else for (const v of s) logger.log(v);
    });
  did
    .command("config-v2")
    .description("[V2] Show governance config")
    .option("--json")
    .action((o) => {
      const cfg = {
        maxActiveIdentitiesPerOwner: getMaxActiveIdentitiesPerOwnerV2(),
        maxPendingIssuancesPerIdentity: getMaxPendingIssuancesPerIdentityV2(),
        identityIdleMs: getIdentityIdleMsV2(),
        issuanceStuckMs: getIssuanceStuckMsV2(),
      };
      if (o.json) console.log(JSON.stringify(cfg, null, 2));
      else for (const [k, v] of Object.entries(cfg)) logger.log(`${k}: ${v}`);
    });
  did
    .command("set-max-active-identities-per-owner-v2 <n>")
    .description("[V2] Set per-owner active identity cap")
    .action((n) => {
      try {
        setMaxActiveIdentitiesPerOwnerV2(Number(n));
        logger.success(`= ${getMaxActiveIdentitiesPerOwnerV2()}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("set-max-pending-issuances-per-identity-v2 <n>")
    .description("[V2] Set per-identity pending issuance cap")
    .action((n) => {
      try {
        setMaxPendingIssuancesPerIdentityV2(Number(n));
        logger.success(`= ${getMaxPendingIssuancesPerIdentityV2()}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("set-identity-idle-ms-v2 <ms>")
    .description("[V2] Set identity idle threshold (ms)")
    .action((m) => {
      try {
        setIdentityIdleMsV2(Number(m));
        logger.success(`= ${getIdentityIdleMsV2()}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("set-issuance-stuck-ms-v2 <ms>")
    .description("[V2] Set issuance stuck threshold (ms)")
    .action((m) => {
      try {
        setIssuanceStuckMsV2(Number(m));
        logger.success(`= ${getIssuanceStuckMsV2()}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });

  did
    .command("register-identity-v2 <id>")
    .description("[V2] Register a DID identity profile (PENDING)")
    .requiredOption("-o, --owner <id>")
    .requiredOption("-m, --method <method>")
    .option("-d, --display-name <name>")
    .action((id, o) => {
      try {
        const i = registerIdentityV2(id, {
          ownerId: o.owner,
          didMethod: o.method,
          displayName: o.displayName,
        });
        logger.success(`identity ${i.id} registered (status=${i.status})`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("activate-identity-v2 <id>")
    .description("[V2] Activate identity (pending|suspended -> active)")
    .action((id) => {
      try {
        activateIdentityV2(id);
        logger.success(`identity ${id} active`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("suspend-identity-v2 <id>")
    .description("[V2] Suspend identity (active -> suspended)")
    .action((id) => {
      try {
        suspendIdentityV2(id);
        logger.success(`identity ${id} suspended`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("revoke-identity-v2 <id>")
    .description("[V2] Revoke identity (terminal)")
    .action((id) => {
      try {
        revokeIdentityV2(id);
        logger.success(`identity ${id} revoked`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("touch-identity-v2 <id>")
    .description("[V2] Bump identity lastSeenAt")
    .action((id) => {
      try {
        touchIdentityV2(id);
        logger.success(`identity ${id} touched`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("get-identity-v2 <id>")
    .description("[V2] Show identity profile")
    .option("--json")
    .action((id, o) => {
      try {
        const i = getIdentityV2(id);
        if (!i) {
          logger.info("identity not found");
          return;
        }
        console.log(JSON.stringify(i, null, 2));
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("list-identities-v2")
    .description("[V2] List identity profiles")
    .option("-o, --owner <id>")
    .option("-s, --status <s>")
    .option("-m, --method <method>")
    .option("--json")
    .action((o) => {
      const list = listIdentitiesV2({
        ownerId: o.owner,
        status: o.status,
        didMethod: o.method,
      });
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else
        for (const i of list)
          logger.log(`${i.id}\t${i.ownerId}\t${i.status}\t${i.didMethod}`);
    });

  did
    .command("create-issuance-v2 <id>")
    .description("[V2] Create a queued V2 issuance")
    .requiredOption("-i, --identity <id>")
    .requiredOption("-t, --type <ctype>")
    .action((id, o) => {
      try {
        const j = createIssuanceV2(id, {
          identityId: o.identity,
          credentialType: o.type,
        });
        logger.success(
          `issuance ${j.id} queued (identity=${j.identityId} type=${j.credentialType})`,
        );
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("start-issuance-v2 <id>")
    .description("[V2] Start issuance (queued -> issuing)")
    .action((id) => {
      try {
        startIssuanceV2(id);
        logger.success(`issuance ${id} issuing`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("complete-issuance-v2 <id>")
    .description("[V2] Complete issuance (issuing -> issued)")
    .action((id) => {
      try {
        completeIssuanceV2(id);
        logger.success(`issuance ${id} issued`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("fail-issuance-v2 <id>")
    .description("[V2] Fail issuance (issuing -> failed)")
    .action((id) => {
      try {
        failIssuanceV2(id);
        logger.success(`issuance ${id} failed`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("cancel-issuance-v2 <id>")
    .description("[V2] Cancel issuance (queued|issuing -> cancelled)")
    .action((id) => {
      try {
        cancelIssuanceV2(id);
        logger.success(`issuance ${id} cancelled`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("get-issuance-v2 <id>")
    .description("[V2] Show issuance")
    .option("--json")
    .action((id, o) => {
      try {
        const j = getIssuanceV2(id);
        if (!j) {
          logger.info("issuance not found");
          return;
        }
        console.log(JSON.stringify(j, null, 2));
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      }
    });
  did
    .command("list-issuances-v2")
    .description("[V2] List V2 issuances")
    .option("-i, --identity <id>")
    .option("-s, --status <s>")
    .option("--json")
    .action((o) => {
      const list = listIssuancesV2({
        identityId: o.identity,
        status: o.status,
      });
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else
        for (const j of list)
          logger.log(
            `${j.id}\t${j.identityId}\t${j.status}\t${j.credentialType}`,
          );
    });

  did
    .command("active-identity-count-v2")
    .description("[V2] Count active identities (optional --owner)")
    .option("-o, --owner <id>")
    .action((o) => logger.log(String(getActiveIdentityCountV2(o.owner))));
  did
    .command("pending-issuance-count-v2")
    .description("[V2] Count pending issuances (queued+issuing)")
    .option("-i, --identity <id>")
    .action((o) => logger.log(String(getPendingIssuanceCountV2(o.identity))));
  did
    .command("auto-suspend-idle-identities-v2")
    .description("[V2] Suspend idle active identities")
    .option("--now <ms>")
    .option("--json")
    .action((o) => {
      const list = autoSuspendIdleIdentitiesV2(
        o.now ? { now: Number(o.now) } : undefined,
      );
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else logger.success(`suspended ${list.length}`);
    });
  did
    .command("auto-fail-stuck-issuances-v2")
    .description("[V2] Fail stuck issuing")
    .option("--now <ms>")
    .option("--json")
    .action((o) => {
      const list = autoFailStuckIssuancesV2(
        o.now ? { now: Number(o.now) } : undefined,
      );
      if (o.json) console.log(JSON.stringify(list, null, 2));
      else logger.success(`failed ${list.length}`);
    });
  did
    .command("stats-v2")
    .description("[V2] Show governance stats")
    .option("--json")
    .action(() => console.log(JSON.stringify(getDidManagerStatsV2(), null, 2)));
}

// === Iter19 V2 governance overlay ===
export function registerDidgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "did");
  if (!parent) return;
  const L = async () => await import("../lib/did-manager.js");
  parent
    .command("didgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.DIDGOV_PROFILE_MATURITY_V2,
            resolutionLifecycle: m.DIDGOV_RESOLUTION_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("didgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveDidgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingDidgovResolutionsPerProfileV2(),
            idleMs: m.getDidgovProfileIdleMsV2(),
            stuckMs: m.getDidgovResolutionStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("didgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveDidgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("didgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingDidgovResolutionsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("didgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setDidgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("didgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setDidgovResolutionStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("didgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--method <v>", "method")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerDidgovProfileV2({ id, owner, method: o.method }),
          null,
          2,
        ),
      );
    });
  parent
    .command("didgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateDidgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("didgov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendDidgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("didgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveDidgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("didgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchDidgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("didgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getDidgovProfileV2(id), null, 2));
    });
  parent
    .command("didgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listDidgovProfilesV2(), null, 2));
    });
  parent
    .command("didgov-create-resolution-v2 <id> <profileId>")
    .description("Create resolution")
    .option("--identifier <v>", "identifier")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createDidgovResolutionV2({
            id,
            profileId,
            identifier: o.identifier,
          }),
          null,
          2,
        ),
      );
    });
  parent
    .command("didgov-resolving-resolution-v2 <id>")
    .description("Mark resolution as resolving")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).resolvingDidgovResolutionV2(id), null, 2),
      );
    });
  parent
    .command("didgov-complete-resolution-v2 <id>")
    .description("Complete resolution")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeResolutionDidgovV2(id), null, 2),
      );
    });
  parent
    .command("didgov-fail-resolution-v2 <id> [reason]")
    .description("Fail resolution")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failDidgovResolutionV2(id, reason), null, 2),
      );
    });
  parent
    .command("didgov-cancel-resolution-v2 <id> [reason]")
    .description("Cancel resolution")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelDidgovResolutionV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("didgov-get-resolution-v2 <id>")
    .description("Get resolution")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getDidgovResolutionV2(id), null, 2),
      );
    });
  parent
    .command("didgov-list-resolutions-v2")
    .description("List resolutions")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listDidgovResolutionsV2(), null, 2),
      );
    });
  parent
    .command("didgov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleDidgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("didgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck resolutions")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckDidgovResolutionsV2(), null, 2),
      );
    });
  parent
    .command("didgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getDidManagerGovStatsV2(), null, 2),
      );
    });
}
