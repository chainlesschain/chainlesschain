/**
 * ActivityPub C2S commands
 * chainlesschain activitypub actor|publish|follow|unfollow|outbox|inbox|...
 *
 * In-memory bridge that implements the W3C ActivityPub Client-to-Server
 * surface (actors, outbox, inbox, follow graph). Network delivery is
 * simulated — `activitypub inbox deliver` lets you push a JSON activity
 * into a local actor's inbox.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureActivityPubTables,
  createActor,
  listActors,
  getActor,
  publishNote,
  follow,
  acceptFollow,
  undoFollow,
  like,
  announce,
  deliverToInbox,
  getOutbox,
  getInbox,
  listFollowers,
  listFollowing,
  searchActors,
  searchNotes,
} from "../lib/activitypub-bridge.js";

async function bootstrapDb(program) {
  const ctx = await bootstrap({ verbose: program.opts().verbose });
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureActivityPubTables(db);
  return db;
}

export function registerActivityPubCommand(program) {
  const ap = program
    .command("activitypub")
    .alias("ap")
    .description(
      "ActivityPub C2S bridge — actors, outbox/inbox, Follow/Create/Like/Announce",
    );

  // ── Actor management ──────────────────────────────────────────────

  const actor = ap
    .command("actor")
    .description("Manage local and remote ActivityPub actors");

  actor
    .command("create <username>")
    .description("Create a local Person actor")
    .option("-n, --name <name>", "Display name (defaults to username)")
    .option("-s, --summary <text>", "Profile summary / bio")
    .option("--origin <url>", "Origin URL for the actor id")
    .option("--json", "Output as JSON")
    .action(async (username, options) => {
      try {
        const db = await bootstrapDb(program);
        const result = createActor(db, {
          username,
          name: options.name,
          summary: options.summary,
          origin: options.origin,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Actor created: ${chalk.cyan(result.actor.id)}`);
          logger.log(`  ${chalk.bold("Name:")}   ${result.actor.name || "-"}`);
          logger.log(`  ${chalk.bold("Inbox:")}  ${result.actor.inbox}`);
          logger.log(`  ${chalk.bold("Outbox:")} ${result.actor.outbox}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  actor
    .command("list")
    .description("List known actors")
    .option("--local", "Local actors only")
    .option("--remote", "Remote actors only")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        await bootstrapDb(program);
        const filter =
          options.local && !options.remote
            ? { local: true }
            : options.remote && !options.local
              ? { local: false }
              : {};
        const actors = listActors(filter);
        if (options.json) {
          console.log(JSON.stringify(actors, null, 2));
        } else if (actors.length === 0) {
          logger.info("No actors.");
        } else {
          for (const a of actors) {
            const scope = a.isLocal
              ? chalk.green("local")
              : chalk.yellow("remote");
            logger.log(`  [${scope}] ${chalk.cyan(a.id)} — ${a.name || "-"}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  actor
    .command("show <username>")
    .description("Show an actor's profile (username or full URL)")
    .option("--json", "Output as JSON")
    .action(async (username, options) => {
      try {
        await bootstrapDb(program);
        const found = getActor(username);
        if (!found) {
          logger.error(`Actor not found: ${username}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(found, null, 2));
        } else {
          logger.log(`  ${chalk.bold("ID:")}       ${chalk.cyan(found.id)}`);
          logger.log(`  ${chalk.bold("Name:")}     ${found.name || "-"}`);
          logger.log(`  ${chalk.bold("Summary:")}  ${found.summary || "-"}`);
          logger.log(`  ${chalk.bold("Inbox:")}    ${found.inbox}`);
          logger.log(`  ${chalk.bold("Outbox:")}   ${found.outbox}`);
          logger.log(`  ${chalk.bold("Local:")}    ${found.isLocal}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Publishing ────────────────────────────────────────────────────

  ap.command("publish <content>")
    .description("Publish a Create(Note) activity to the actor's outbox")
    .requiredOption(
      "-a, --actor <username>",
      "Authoring actor (username or URL)",
    )
    .option("--to <target...>", "Primary audience URLs")
    .option("--cc <target...>", "Secondary audience URLs")
    .option("--reply-to <id>", "Reply to an existing Note id")
    .option("--json", "Output as JSON")
    .action(async (content, options) => {
      try {
        const db = await bootstrapDb(program);
        const result = publishNote(db, {
          actor: options.actor,
          content,
          to: options.to,
          cc: options.cc,
          inReplyTo: options.replyTo,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Note published by ${chalk.cyan(options.actor)}`);
          logger.log(`  ${chalk.bold("Activity:")} ${result.activity.id}`);
          logger.log(
            `  ${chalk.bold("Note:")}     ${result.activity.object.id}`,
          );
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ap.command("follow <target>")
    .description("Publish a Follow activity (target: username or actor URL)")
    .requiredOption("-a, --actor <username>", "Follower actor")
    .option("--json", "Output as JSON")
    .action(async (target, options) => {
      try {
        const db = await bootstrapDb(program);
        const result = follow(db, { actor: options.actor, target });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `${chalk.cyan(options.actor)} → Follow(${chalk.cyan(target)})`,
          );
          logger.log(`  ${chalk.bold("Activity:")} ${result.activity.id}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ap.command("accept <follow-activity-id>")
    .description("Accept a pending Follow request")
    .requiredOption(
      "-a, --actor <username>",
      "Target actor (the one being followed)",
    )
    .option("--json", "Output as JSON")
    .action(async (followActivityId, options) => {
      try {
        const db = await bootstrapDb(program);
        const result = acceptFollow(db, {
          actor: options.actor,
          followActivityId,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Follow accepted: ${chalk.cyan(result.activity.id)}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ap.command("unfollow <target>")
    .description("Publish an Undo(Follow) activity")
    .requiredOption("-a, --actor <username>", "Follower actor")
    .option("--json", "Output as JSON")
    .action(async (target, options) => {
      try {
        const db = await bootstrapDb(program);
        const result = undoFollow(db, { actor: options.actor, target });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `${chalk.cyan(options.actor)} → Undo(Follow(${chalk.cyan(target)}))`,
          );
          logger.log(`  ${chalk.bold("Activity:")} ${result.activity.id}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ap.command("like <object-id>")
    .description("Publish a Like activity for an object URL")
    .requiredOption("-a, --actor <username>", "Actor")
    .option("--json", "Output as JSON")
    .action(async (objectId, options) => {
      try {
        const db = await bootstrapDb(program);
        const result = like(db, { actor: options.actor, object: objectId });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Liked ${chalk.cyan(objectId)}`);
          logger.log(`  ${chalk.bold("Activity:")} ${result.activity.id}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ap.command("announce <object-id>")
    .description("Publish an Announce (boost) activity for an object URL")
    .requiredOption("-a, --actor <username>", "Actor")
    .option("--json", "Output as JSON")
    .action(async (objectId, options) => {
      try {
        const db = await bootstrapDb(program);
        const result = announce(db, {
          actor: options.actor,
          object: objectId,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Announced ${chalk.cyan(objectId)}`);
          logger.log(`  ${chalk.bold("Activity:")} ${result.activity.id}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Outbox / Inbox reads ──────────────────────────────────────────

  ap.command("outbox <username>")
    .description("List an actor's outbox activities")
    .option("-n, --limit <n>", "Max activities", "50")
    .option(
      "-t, --type <type...>",
      "Filter by activity type (Create, Follow, ...)",
    )
    .option("--json", "Output as JSON")
    .action(async (username, options) => {
      try {
        await bootstrapDb(program);
        const items = getOutbox(username, {
          limit: parseInt(options.limit),
          types: options.type,
        });
        if (options.json) {
          console.log(JSON.stringify(items, null, 2));
        } else if (items.length === 0) {
          logger.info("Outbox empty.");
        } else {
          for (const a of items) {
            const body =
              typeof a.object === "string"
                ? a.object
                : a.object?.content || a.object?.id || "";
            logger.log(
              `  ${chalk.cyan(a.type.padEnd(10))} ${a.published} ${body.slice(0, 80)}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ap.command("inbox <username>")
    .description("List an actor's inbox activities")
    .option("-n, --limit <n>", "Max activities", "50")
    .option("-t, --type <type...>", "Filter by activity type")
    .option("--json", "Output as JSON")
    .action(async (username, options) => {
      try {
        await bootstrapDb(program);
        const items = getInbox(username, {
          limit: parseInt(options.limit),
          types: options.type,
        });
        if (options.json) {
          console.log(JSON.stringify(items, null, 2));
        } else if (items.length === 0) {
          logger.info("Inbox empty.");
        } else {
          for (const a of items) {
            const body =
              typeof a.object === "string"
                ? a.object
                : a.object?.content || a.object?.id || "";
            logger.log(
              `  ${chalk.cyan(a.type.padEnd(10))} from ${a.actor} ${body.slice(0, 80)}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ap.command("deliver <username> <activity-json>")
    .description(
      "Simulate inbox delivery — push a JSON activity into a local actor's inbox",
    )
    .option("--json", "Output as JSON")
    .action(async (username, activityJson, options) => {
      try {
        const db = await bootstrapDb(program);
        let activity;
        try {
          activity = JSON.parse(activityJson);
        } catch (e) {
          throw new Error(`Invalid JSON activity: ${e.message}`);
        }
        const result = deliverToInbox(db, { actor: username, activity });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Delivered ${result.activity.type} to ${chalk.cyan(username)}`,
          );
          logger.log(`  ${chalk.bold("Activity:")} ${result.activity.id}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Follow graph ──────────────────────────────────────────────────

  ap.command("followers <username>")
    .description("List followers of an actor")
    .option("--state <state>", "Filter by state (pending | accepted)")
    .option("--json", "Output as JSON")
    .action(async (username, options) => {
      try {
        await bootstrapDb(program);
        const rows = listFollowers(username, { state: options.state });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("No followers.");
        } else {
          for (const r of rows) {
            logger.log(`  ${chalk.cyan(r.id)} [${r.state}]`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Fediverse search ──────────────────────────────────────────────

  ap.command("search <query>")
    .description("Search actors and/or notes in the local Fediverse index")
    .option("-t, --target <type>", "actors | notes | all", "all")
    .option("-s, --scope <scope>", "local | remote | all", "all")
    .option(
      "-a, --author <username>",
      "Filter notes by author (username or URL)",
    )
    .option("--since <iso>", "Only notes published since this ISO timestamp")
    .option("--until <iso>", "Only notes published until this ISO timestamp")
    .option("-n, --limit <n>", "Max results per target", "20")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      try {
        await bootstrapDb(program);
        const limit = parseInt(options.limit);
        const target = options.target;
        const result = {};
        if (target === "actors" || target === "all") {
          result.actors = searchActors(query, {
            limit,
            scope: options.scope,
          });
        }
        if (target === "notes" || target === "all") {
          result.notes = searchNotes(query, {
            limit,
            author: options.author,
            since: options.since,
            until: options.until,
            scope: options.scope,
          });
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const actors = result.actors || [];
          const notes = result.notes || [];
          if (actors.length === 0 && notes.length === 0) {
            logger.info("No matches.");
          } else {
            if (actors.length > 0) {
              logger.log(chalk.bold("Actors:"));
              for (const a of actors) {
                const scope = a.isLocal
                  ? chalk.green("local")
                  : chalk.yellow("remote");
                logger.log(
                  `  [${scope}] ${chalk.cyan(a.id)} — ${a.name || "-"} (score=${a.score})`,
                );
              }
            }
            if (notes.length > 0) {
              logger.log(chalk.bold("Notes:"));
              for (const n of notes) {
                logger.log(
                  `  ${chalk.gray(n.actor)} ${chalk.cyan(n.content.slice(0, 80))} (score=${n.score})`,
                );
              }
            }
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  ap.command("following <username>")
    .description("List who this actor is following")
    .option("--state <state>", "Filter by state (pending | accepted)")
    .option("--json", "Output as JSON")
    .action(async (username, options) => {
      try {
        await bootstrapDb(program);
        const rows = listFollowing(username, { state: options.state });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          logger.info("Following no one.");
        } else {
          for (const r of rows) {
            logger.log(`  ${chalk.cyan(r.id)} [${r.state}]`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
