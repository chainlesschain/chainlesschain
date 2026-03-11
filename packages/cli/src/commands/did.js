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
}
