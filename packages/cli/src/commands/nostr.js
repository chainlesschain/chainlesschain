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
    .description("Publish a text note event")
    .option("-k, --kind <n>", "Event kind", "1")
    .option("-p, --pubkey <key>", "Author public key")
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
        );
        logger.success("Event published");
        logger.log(
          `  ${chalk.bold("ID:")}   ${chalk.cyan(result.event.id.slice(0, 16))}...`,
        );
        logger.log(`  ${chalk.bold("Sent:")} ${result.sentCount} relay(s)`);
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
          logger.success("Keypair generated");
          logger.log(`  ${chalk.bold("Public:")}  ${chalk.cyan(kp.publicKey)}`);
          logger.log(
            `  ${chalk.bold("Private:")} ${kp.privateKey.slice(0, 16)}...`,
          );
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
}
