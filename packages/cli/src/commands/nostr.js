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

  registerNostrV2Command(nostr);
}

import {
  NOSTR_RELAY_MATURITY_V2,
  NOSTR_EVENT_LIFECYCLE_V2,
  registerNostrRelayV2,
  activateNostrRelayV2,
  offlineNostrRelayV2,
  retireNostrRelayV2,
  touchNostrRelayV2,
  getNostrRelayV2,
  listNostrRelaysV2,
  createNostrEventV2,
  startNostrEventV2,
  publishNostrEventV2,
  failNostrEventV2,
  cancelNostrEventV2,
  getNostrEventV2,
  listNostrEventsV2,
  setMaxActiveNostrRelaysPerOwnerV2,
  getMaxActiveNostrRelaysPerOwnerV2,
  setMaxPendingNostrEventsPerRelayV2,
  getMaxPendingNostrEventsPerRelayV2,
  setNostrRelayIdleMsV2,
  getNostrRelayIdleMsV2,
  setNostrEventStuckMsV2,
  getNostrEventStuckMsV2,
  autoOfflineIdleNostrRelaysV2,
  autoFailStuckNostrEventsV2,
  getNostrBridgeStatsV2,
} from "../lib/nostr-bridge.js";

export function registerNostrV2Command(nostr) {
  nostr
    .command("enums-v2")
    .description("Show V2 enums")
    .action(() => {
      console.log(
        JSON.stringify(
          { NOSTR_RELAY_MATURITY_V2, NOSTR_EVENT_LIFECYCLE_V2 },
          null,
          2,
        ),
      );
    });
  nostr
    .command("register-relay-v2")
    .description("Register a nostr relay profile (pending)")
    .requiredOption("--id <id>")
    .requiredOption("--owner <owner>")
    .option("--url <url>")
    .action((o) => {
      console.log(JSON.stringify(registerNostrRelayV2(o), null, 2));
    });
  nostr
    .command("activate-relay-v2 <id>")
    .description("Activate relay")
    .action((id) => {
      console.log(JSON.stringify(activateNostrRelayV2(id), null, 2));
    });
  nostr
    .command("offline-relay-v2 <id>")
    .description("Mark relay offline")
    .action((id) => {
      console.log(JSON.stringify(offlineNostrRelayV2(id), null, 2));
    });
  nostr
    .command("retire-relay-v2 <id>")
    .description("Retire relay (terminal)")
    .action((id) => {
      console.log(JSON.stringify(retireNostrRelayV2(id), null, 2));
    });
  nostr
    .command("touch-relay-v2 <id>")
    .description("Refresh lastTouchedAt")
    .action((id) => {
      console.log(JSON.stringify(touchNostrRelayV2(id), null, 2));
    });
  nostr
    .command("get-relay-v2 <id>")
    .description("Get a relay")
    .action((id) => {
      console.log(JSON.stringify(getNostrRelayV2(id), null, 2));
    });
  nostr
    .command("list-relays-v2")
    .description("List relays")
    .action(() => {
      console.log(JSON.stringify(listNostrRelaysV2(), null, 2));
    });
  nostr
    .command("create-event-v2")
    .description("Create a nostr event (queued)")
    .requiredOption("--id <id>")
    .requiredOption("--relay-id <relayId>")
    .option("--kind <kind>", "event kind", (v) => Number(v))
    .action((o) => {
      console.log(
        JSON.stringify(
          createNostrEventV2({ id: o.id, relayId: o.relayId, kind: o.kind }),
          null,
          2,
        ),
      );
    });
  nostr
    .command("start-event-v2 <id>")
    .description("Transition event to publishing")
    .action((id) => {
      console.log(JSON.stringify(startNostrEventV2(id), null, 2));
    });
  nostr
    .command("publish-event-v2 <id>")
    .description("Transition event to published")
    .action((id) => {
      console.log(JSON.stringify(publishNostrEventV2(id), null, 2));
    });
  nostr
    .command("fail-event-v2 <id>")
    .description("Fail event")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(failNostrEventV2(id, o.reason), null, 2));
    });
  nostr
    .command("cancel-event-v2 <id>")
    .description("Cancel event")
    .option("--reason <r>")
    .action((id, o) => {
      console.log(JSON.stringify(cancelNostrEventV2(id, o.reason), null, 2));
    });
  nostr
    .command("get-event-v2 <id>")
    .description("Get event")
    .action((id) => {
      console.log(JSON.stringify(getNostrEventV2(id), null, 2));
    });
  nostr
    .command("list-events-v2")
    .description("List events")
    .action(() => {
      console.log(JSON.stringify(listNostrEventsV2(), null, 2));
    });
  nostr
    .command("set-max-active-relays-v2 <n>")
    .description("Set per-owner active cap")
    .action((n) => {
      setMaxActiveNostrRelaysPerOwnerV2(Number(n));
      console.log(
        JSON.stringify(
          { maxActiveNostrRelaysPerOwner: getMaxActiveNostrRelaysPerOwnerV2() },
          null,
          2,
        ),
      );
    });
  nostr
    .command("set-max-pending-events-v2 <n>")
    .description("Set per-relay pending cap")
    .action((n) => {
      setMaxPendingNostrEventsPerRelayV2(Number(n));
      console.log(
        JSON.stringify(
          {
            maxPendingNostrEventsPerRelay: getMaxPendingNostrEventsPerRelayV2(),
          },
          null,
          2,
        ),
      );
    });
  nostr
    .command("set-relay-idle-ms-v2 <n>")
    .description("Set idle threshold")
    .action((n) => {
      setNostrRelayIdleMsV2(Number(n));
      console.log(
        JSON.stringify({ nostrRelayIdleMs: getNostrRelayIdleMsV2() }, null, 2),
      );
    });
  nostr
    .command("set-event-stuck-ms-v2 <n>")
    .description("Set stuck threshold")
    .action((n) => {
      setNostrEventStuckMsV2(Number(n));
      console.log(
        JSON.stringify(
          { nostrEventStuckMs: getNostrEventStuckMsV2() },
          null,
          2,
        ),
      );
    });
  nostr
    .command("auto-offline-idle-relays-v2")
    .description("Auto-offline idle relays")
    .action(() => {
      console.log(JSON.stringify(autoOfflineIdleNostrRelaysV2(), null, 2));
    });
  nostr
    .command("auto-fail-stuck-events-v2")
    .description("Auto-fail stuck publishing events")
    .action(() => {
      console.log(JSON.stringify(autoFailStuckNostrEventsV2(), null, 2));
    });
  nostr
    .command("stats-v2")
    .description("V2 aggregate stats")
    .action(() => {
      console.log(JSON.stringify(getNostrBridgeStatsV2(), null, 2));
    });
}

// === Iter21 V2 governance overlay ===
export function registerNosgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "nostr");
  if (!parent) return;
  const L = async () => await import("../lib/nostr-bridge.js");
  parent
    .command("nosgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.NOSGOV_PROFILE_MATURITY_V2,
            publishLifecycle: m.NOSGOV_PUBLISH_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("nosgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveNosgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingNosgovPublishsPerProfileV2(),
            idleMs: m.getNosgovProfileIdleMsV2(),
            stuckMs: m.getNosgovPublishStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("nosgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveNosgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("nosgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingNosgovPublishsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("nosgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setNosgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("nosgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setNosgovPublishStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("nosgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--relay <v>", "relay")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerNosgovProfileV2({ id, owner, relay: o.relay }),
          null,
          2,
        ),
      );
    });
  parent
    .command("nosgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateNosgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("nosgov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendNosgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("nosgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveNosgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("nosgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchNosgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("nosgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getNosgovProfileV2(id), null, 2));
    });
  parent
    .command("nosgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listNosgovProfilesV2(), null, 2));
    });
  parent
    .command("nosgov-create-publish-v2 <id> <profileId>")
    .description("Create publish")
    .option("--kind <v>", "kind")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createNosgovPublishV2({ id, profileId, kind: o.kind }),
          null,
          2,
        ),
      );
    });
  parent
    .command("nosgov-publishing-publish-v2 <id>")
    .description("Mark publish as publishing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).publishingNosgovPublishV2(id), null, 2),
      );
    });
  parent
    .command("nosgov-complete-publish-v2 <id>")
    .description("Complete publish")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completePublishNosgovV2(id), null, 2),
      );
    });
  parent
    .command("nosgov-fail-publish-v2 <id> [reason]")
    .description("Fail publish")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failNosgovPublishV2(id, reason), null, 2),
      );
    });
  parent
    .command("nosgov-cancel-publish-v2 <id> [reason]")
    .description("Cancel publish")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelNosgovPublishV2(id, reason), null, 2),
      );
    });
  parent
    .command("nosgov-get-publish-v2 <id>")
    .description("Get publish")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getNosgovPublishV2(id), null, 2));
    });
  parent
    .command("nosgov-list-publishs-v2")
    .description("List publishs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listNosgovPublishsV2(), null, 2));
    });
  parent
    .command("nosgov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleNosgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("nosgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck publishs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckNosgovPublishsV2(), null, 2),
      );
    });
  parent
    .command("nosgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getNostrBridgeGovStatsV2(), null, 2),
      );
    });
}
