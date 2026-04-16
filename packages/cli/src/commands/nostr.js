/**
 * Nostr commands
 * chainlesschain nostr relays|add-relay|publish|events|keygen|map-did
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureNostrTables,
  listRelays,
  addRelay,
  publishEvent,
  getEvents,
  generateKeypair,
  mapDid,
  publishDirectMessage,
  decryptDirectMessage,
  publishDeletion,
  publishReaction,
} from "../lib/nostr-bridge.js";

export function registerNostrCommand(program) {
  const nostr = program
    .command("nostr")
    .description("Nostr bridge — relays, events, keypairs, DID mapping");

  nostr
    .command("relays")
    .description("List configured Nostr relays")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureNostrTables(db);

        const relays = listRelays();
        if (options.json) {
          console.log(JSON.stringify(relays, null, 2));
        } else if (relays.length === 0) {
          logger.info(
            "No relays configured. Use `nostr add-relay <url>` to add one.",
          );
        } else {
          for (const r of relays) {
            logger.log(
              `  ${chalk.cyan(r.url)} [${r.status}] events=${r.eventCount}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  nostr
    .command("add-relay <url>")
    .description("Add a Nostr relay")
    .action(async (url) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureNostrTables(db);

        const relay = addRelay(db, url);
        logger.success(`Relay added: ${chalk.cyan(relay.url)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  nostr
    .command("publish <content>")
    .description("Publish a text note event (signed if --privkey provided)")
    .option("-k, --kind <n>", "Event kind", "1")
    .option("-p, --pubkey <key>", "Author public key (unsigned path)")
    .option(
      "--privkey <hex>",
      "Sign event with this 32-byte private key (hex). Pubkey is derived.",
    )
    .action(async (content, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureNostrTables(db);

        const result = publishEvent(
          db,
          parseInt(options.kind),
          content,
          options.pubkey,
          [],
          options.privkey,
        );
        logger.success("Event published");
        logger.log(
          `  ${chalk.bold("ID:")}     ${chalk.cyan(result.event.id.slice(0, 16))}...`,
        );
        logger.log(
          `  ${chalk.bold("Signed:")} ${result.event.sig ? chalk.green("yes (BIP-340)") : chalk.yellow("no — will be rejected by real relays")}`,
        );
        logger.log(`  ${chalk.bold("Sent:")}   ${result.sentCount} relay(s)`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  nostr
    .command("events")
    .description("List events")
    .option("-k, --kind <n>", "Filter by event kind")
    .option("-n, --limit <n>", "Max results", "50")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureNostrTables(db);

        const filter = { limit: parseInt(options.limit) };
        if (options.kind) filter.kinds = [parseInt(options.kind)];
        const events = getEvents(filter);
        if (options.json) {
          console.log(JSON.stringify(events, null, 2));
        } else if (events.length === 0) {
          logger.info("No events found.");
        } else {
          for (const e of events) {
            logger.log(
              `  ${chalk.cyan(e.id.slice(0, 12))} kind=${e.kind} "${e.content.slice(0, 60)}"`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  nostr
    .command("keygen")
    .description("Generate a Nostr keypair")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const kp = generateKeypair();
        if (options.json) {
          console.log(JSON.stringify(kp, null, 2));
        } else {
          logger.success("Keypair generated (BIP-340 schnorr / NIP-19)");
          logger.log(`  ${chalk.bold("npub:")}    ${chalk.cyan(kp.npub)}`);
          logger.log(
            `  ${chalk.bold("nsec:")}    ${chalk.yellow(kp.nsec.slice(0, 20))}…  ${chalk.dim("(keep private!)")}`,
          );
          logger.log(`  ${chalk.bold("pubHex:")}  ${kp.publicKey}`);
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  nostr
    .command("map-did <did> <pubkey>")
    .description("Map a DID identity to a Nostr pubkey")
    .action(async (did, pubkey) => {
      try {
        const result = mapDid(did, pubkey);
        logger.success(`DID ${chalk.cyan(did)} mapped to Nostr pubkey`);
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── NIP-04: Encrypted Direct Message ──────────────────────────────

  nostr
    .command("dm <recipientPubkey> <plaintext>")
    .description("Send a NIP-04 encrypted direct message (kind=4)")
    .requiredOption("--sender-priv <hex>", "Sender's 32-byte private key (hex)")
    .requiredOption(
      "--sender-pub <hex>",
      "Sender's 32-byte x-only public key (hex)",
    )
    .option("--json", "Output as JSON")
    .action(async (recipientPubkey, plaintext, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureNostrTables(db);

        const result = publishDirectMessage(db, {
          senderPrivkey: options.senderPriv,
          senderPubkey: options.senderPub,
          recipientPubkey,
          plaintext,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success("Encrypted DM sent");
          logger.log(
            `  ${chalk.bold("ID:")}   ${chalk.cyan(result.event.id.slice(0, 16))}...`,
          );
          logger.log(`  ${chalk.bold("Sent:")} ${result.sentCount} relay(s)`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  nostr
    .command("dm-decrypt <eventId>")
    .description("Decrypt a stored NIP-04 direct message by event id")
    .requiredOption(
      "--recipient-priv <hex>",
      "Recipient's 32-byte private key (hex)",
    )
    .option("--json", "Output as JSON")
    .action(async (eventId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureNostrTables(db);

        const events = getEvents({ kinds: [4], limit: 1000 });
        const event = events.find((e) => e.id === eventId);
        if (!event) {
          logger.error(`Event not found: ${eventId}`);
          process.exit(1);
        }

        const plaintext = decryptDirectMessage({
          event,
          recipientPrivkey: options.recipientPriv,
        });

        if (options.json) {
          console.log(JSON.stringify({ success: true, plaintext }, null, 2));
        } else {
          logger.success("Decrypted");
          logger.log(
            `  ${chalk.bold("From:")}     ${chalk.cyan(event.pubkey.slice(0, 16))}...`,
          );
          logger.log(`  ${chalk.bold("Message:")}  ${plaintext}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── NIP-09: Event Deletion Request ─────────────────────────────────

  nostr
    .command("delete <eventIds...>")
    .description("Publish a NIP-09 deletion request (kind=5)")
    .option("-r, --reason <text>", "Reason for deletion", "")
    .option("-p, --pubkey <key>", "Author public key")
    .option("--json", "Output as JSON")
    .action(async (eventIds, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureNostrTables(db);

        const result = publishDeletion(db, {
          eventIds,
          reason: options.reason,
          pubkey: options.pubkey,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Deletion request published for ${eventIds.length} event(s)`,
          );
          logger.log(
            `  ${chalk.bold("ID:")}   ${chalk.cyan(result.event.id.slice(0, 16))}...`,
          );
          logger.log(`  ${chalk.bold("Sent:")} ${result.sentCount} relay(s)`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── NIP-25: Reactions ──────────────────────────────────────────────

  nostr
    .command("react <targetEventId> <targetPubkey>")
    .description(
      'Publish a NIP-25 reaction (kind=7). content "+" | "-" | emoji',
    )
    .option("-c, --content <symbol>", "Reaction symbol", "+")
    .option("-p, --pubkey <key>", "Author public key")
    .option("--json", "Output as JSON")
    .action(async (targetEventId, targetPubkey, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureNostrTables(db);

        const result = publishReaction(db, {
          targetEventId,
          targetPubkey,
          content: options.content,
          pubkey: options.pubkey,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Reaction "${options.content}" published`);
          logger.log(
            `  ${chalk.bold("ID:")}   ${chalk.cyan(result.event.id.slice(0, 16))}...`,
          );
          logger.log(`  ${chalk.bold("Sent:")} ${result.sentCount} relay(s)`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
