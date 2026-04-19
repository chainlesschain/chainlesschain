/**
 * Matrix commands
 * chainlesschain matrix login|rooms|send|messages|join
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  ensureMatrixTables,
  login,
  listRooms,
  sendMessage,
  getMessages,
  joinRoom,
  getLoginState,
  sendThreadReply,
  getThreadMessages,
  getThreadRoots,
  createSpace,
  addSpaceChild,
  removeSpaceChild,
  listSpaceChildren,
  listSpaces,
} from "../lib/matrix-bridge.js";

export function registerMatrixCommand(program) {
  const matrix = program
    .command("matrix")
    .description("Matrix bridge — rooms, messaging, E2EE");

  matrix
    .command("login")
    .description("Login to a Matrix homeserver")
    .option("-s, --server <url>", "Homeserver URL", "https://matrix.org")
    .requiredOption("-u, --user <id>", "User ID (e.g. @user:matrix.org)")
    .requiredOption("-p, --password <pass>", "Password")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const result = login(
          db,
          options.server,
          options.user,
          options.password,
        );
        logger.success(`Logged in as ${chalk.cyan(result.userId)}`);
        logger.log(`  ${chalk.bold("Server:")} ${result.homeserver}`);
        logger.log(`  ${chalk.bold("Token:")}  ${result.accessToken}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  matrix
    .command("rooms")
    .description("List joined rooms")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const rooms = listRooms();
        if (options.json) {
          console.log(JSON.stringify(rooms, null, 2));
        } else if (rooms.length === 0) {
          logger.info("No rooms joined.");
        } else {
          for (const r of rooms) {
            logger.log(
              `  ${chalk.cyan(r.roomId)} ${r.name || ""} members=${r.memberCount} encrypted=${r.isEncrypted}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  matrix
    .command("send <room-id> <message>")
    .description("Send a message to a room")
    .option("-t, --type <msgtype>", "Message type", "m.text")
    .action(async (roomId, message, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const result = sendMessage(db, roomId, message, options.type);
        logger.success(`Message sent to ${chalk.cyan(roomId)}`);
        logger.log(`  ${chalk.bold("Event:")} ${result.event.eventId}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  matrix
    .command("messages <room-id>")
    .description("Get messages from a room")
    .option("-n, --limit <n>", "Max messages", "50")
    .option("--json", "Output as JSON")
    .action(async (roomId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const messages = getMessages(roomId, {
          limit: parseInt(options.limit),
        });
        if (options.json) {
          console.log(JSON.stringify(messages, null, 2));
        } else if (messages.length === 0) {
          logger.info("No messages found.");
        } else {
          for (const m of messages) {
            logger.log(`  ${chalk.gray(m.sender)} ${m.content.body}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  matrix
    .command("join <room-id>")
    .description("Join a Matrix room")
    .action(async (roomId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const result = joinRoom(db, roomId);
        logger.success(`Joined room ${chalk.cyan(result.room.roomId)}`);
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Threads (MSC3440 / spec §11.38) ──────────────────────────────

  const thread = matrix
    .command("thread")
    .description("Matrix threaded replies (m.thread relation)");

  thread
    .command("send <room-id> <root-event-id> <body>")
    .description("Send a threaded reply referencing a root event")
    .option("-t, --type <msgtype>", "Message type", "m.text")
    .option(
      "--reply-to <event-id>",
      "Event the reply directly targets (defaults to root)",
    )
    .option(
      "--no-fallback",
      "Disable is_falling_back (non-thread clients won't see it as a reply)",
    )
    .option("--json", "Output as JSON")
    .action(async (roomId, rootEventId, body, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const result = sendThreadReply(db, {
          roomId,
          rootEventId,
          body,
          msgtype: options.type,
          inReplyTo: options.replyTo,
          isFallingBack: options.fallback !== false,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Thread reply sent to ${chalk.cyan(roomId)}`);
          logger.log(`  ${chalk.bold("Root:")}  ${rootEventId}`);
          logger.log(`  ${chalk.bold("Event:")} ${result.event.eventId}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  thread
    .command("list <room-id> <root-event-id>")
    .description("List all replies in a thread")
    .option("--json", "Output as JSON")
    .action(async (roomId, rootEventId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const messages = getThreadMessages(roomId, rootEventId);
        if (options.json) {
          console.log(JSON.stringify(messages, null, 2));
        } else if (messages.length === 0) {
          logger.info("No replies in this thread.");
        } else {
          for (const m of messages) {
            logger.log(`  ${chalk.gray(m.sender)} ${m.content.body}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  thread
    .command("roots <room-id>")
    .description("List distinct thread roots within a room")
    .option("--json", "Output as JSON")
    .action(async (roomId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const roots = getThreadRoots(roomId);
        if (options.json) {
          console.log(JSON.stringify(roots, null, 2));
        } else if (roots.length === 0) {
          logger.info("No threads found.");
        } else {
          for (const r of roots) {
            logger.log(
              `  ${chalk.cyan(r.rootEventId.slice(0, 16))}... replies=${r.replyCount} last=${r.lastReplyAt}`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── Spaces (spec §11.34) ─────────────────────────────────────────

  const space = matrix
    .command("space")
    .description("Matrix Spaces — hierarchical room grouping (m.space)");

  space
    .command("create <name>")
    .description("Create a new Matrix Space")
    .option("-t, --topic <text>", "Space topic / description")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const result = createSpace(db, { name, topic: options.topic });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(`Space created: ${chalk.cyan(result.space.name)}`);
          logger.log(`  ${chalk.bold("Room ID:")} ${result.space.roomId}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  space
    .command("add-child <space-id> <child-room-id>")
    .description("Add a child room to a Space")
    .option("--via <server...>", "Homeserver(s) via which child is reachable")
    .option("--json", "Output as JSON")
    .action(async (spaceId, childRoomId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const result = addSpaceChild(db, {
          spaceId,
          childRoomId,
          via: options.via,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Added ${chalk.cyan(childRoomId)} to space ${chalk.cyan(spaceId)}`,
          );
          logger.log(`  ${chalk.bold("Via:")} ${result.via.join(", ")}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  space
    .command("remove-child <space-id> <child-room-id>")
    .description("Remove a child room from a Space")
    .action(async (spaceId, childRoomId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const result = removeSpaceChild(db, { spaceId, childRoomId });
        if (result.removed) {
          logger.success(
            `Removed ${chalk.cyan(childRoomId)} from ${chalk.cyan(spaceId)}`,
          );
        } else {
          logger.info(`${childRoomId} was not a child of ${spaceId}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  space
    .command("children <space-id>")
    .description("List all child rooms of a Space")
    .option("--json", "Output as JSON")
    .action(async (spaceId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const children = listSpaceChildren(spaceId);
        if (options.json) {
          console.log(JSON.stringify(children, null, 2));
        } else if (children.length === 0) {
          logger.info("Space has no children.");
        } else {
          for (const c of children) {
            logger.log(`  ${chalk.cyan(c.childRoomId)} via=${c.via.join(",")}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  space
    .command("list")
    .description("List all Spaces")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        ensureMatrixTables(db);

        const spaces = listSpaces();
        if (options.json) {
          console.log(JSON.stringify(spaces, null, 2));
        } else if (spaces.length === 0) {
          logger.info("No spaces found.");
        } else {
          for (const s of spaces) {
            logger.log(`  ${chalk.cyan(s.roomId)} ${s.name}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  registerMatrixV2Command(matrix);
}


import {
  MX_ROOM_MATURITY_V2,
  MX_MESSAGE_LIFECYCLE_V2,
  registerMatrixRoomV2,
  activateMatrixRoomV2,
  muteMatrixRoomV2,
  archiveMatrixRoomV2,
  touchMatrixRoomV2,
  getMatrixRoomV2,
  listMatrixRoomsV2,
  createMatrixMessageV2,
  startMatrixMessageV2,
  deliverMatrixMessageV2,
  failMatrixMessageV2,
  cancelMatrixMessageV2,
  getMatrixMessageV2,
  listMatrixMessagesV2,
  setMaxActiveMatrixRoomsPerOwnerV2,
  getMaxActiveMatrixRoomsPerOwnerV2,
  setMaxPendingMatrixMessagesPerRoomV2,
  getMaxPendingMatrixMessagesPerRoomV2,
  setMatrixRoomIdleMsV2,
  getMatrixRoomIdleMsV2,
  setMatrixMessageStuckMsV2,
  getMatrixMessageStuckMsV2,
  autoMuteIdleMatrixRoomsV2,
  autoFailStuckMatrixMessagesV2,
  getMatrixBridgeStatsV2,
} from "../lib/matrix-bridge.js";

export function registerMatrixV2Command(matrix) {
  matrix.command("enums-v2").description("Show V2 enums").action(() => { console.log(JSON.stringify({ MX_ROOM_MATURITY_V2, MX_MESSAGE_LIFECYCLE_V2 }, null, 2)); });
  matrix.command("register-room-v2").description("Register a matrix room profile (pending)")
    .requiredOption("--id <id>").requiredOption("--owner <owner>").option("--alias <alias>")
    .action((o) => { console.log(JSON.stringify(registerMatrixRoomV2(o), null, 2)); });
  matrix.command("activate-room-v2 <id>").description("Activate room").action((id) => { console.log(JSON.stringify(activateMatrixRoomV2(id), null, 2)); });
  matrix.command("mute-room-v2 <id>").description("Mute room").action((id) => { console.log(JSON.stringify(muteMatrixRoomV2(id), null, 2)); });
  matrix.command("archive-room-v2 <id>").description("Archive room (terminal)").action((id) => { console.log(JSON.stringify(archiveMatrixRoomV2(id), null, 2)); });
  matrix.command("touch-room-v2 <id>").description("Refresh lastTouchedAt").action((id) => { console.log(JSON.stringify(touchMatrixRoomV2(id), null, 2)); });
  matrix.command("get-room-v2 <id>").description("Get a room").action((id) => { console.log(JSON.stringify(getMatrixRoomV2(id), null, 2)); });
  matrix.command("list-rooms-v2").description("List rooms").action(() => { console.log(JSON.stringify(listMatrixRoomsV2(), null, 2)); });
  matrix.command("create-msg-v2").description("Create a matrix message (queued)")
    .requiredOption("--id <id>").requiredOption("--room-id <roomId>").option("--body <body>")
    .action((o) => { console.log(JSON.stringify(createMatrixMessageV2({ id: o.id, roomId: o.roomId, body: o.body }), null, 2)); });
  matrix.command("start-msg-v2 <id>").description("Transition msg to sending").action((id) => { console.log(JSON.stringify(startMatrixMessageV2(id), null, 2)); });
  matrix.command("deliver-msg-v2 <id>").description("Transition msg to delivered").action((id) => { console.log(JSON.stringify(deliverMatrixMessageV2(id), null, 2)); });
  matrix.command("fail-msg-v2 <id>").description("Fail msg").option("--reason <r>").action((id, o) => { console.log(JSON.stringify(failMatrixMessageV2(id, o.reason), null, 2)); });
  matrix.command("cancel-msg-v2 <id>").description("Cancel msg").option("--reason <r>").action((id, o) => { console.log(JSON.stringify(cancelMatrixMessageV2(id, o.reason), null, 2)); });
  matrix.command("get-msg-v2 <id>").description("Get msg").action((id) => { console.log(JSON.stringify(getMatrixMessageV2(id), null, 2)); });
  matrix.command("list-msgs-v2").description("List msgs").action(() => { console.log(JSON.stringify(listMatrixMessagesV2(), null, 2)); });
  matrix.command("set-max-active-rooms-v2 <n>").description("Set per-owner active cap").action((n) => { setMaxActiveMatrixRoomsPerOwnerV2(Number(n)); console.log(JSON.stringify({ maxActiveMatrixRoomsPerOwner: getMaxActiveMatrixRoomsPerOwnerV2() }, null, 2)); });
  matrix.command("set-max-pending-msgs-v2 <n>").description("Set per-room pending cap").action((n) => { setMaxPendingMatrixMessagesPerRoomV2(Number(n)); console.log(JSON.stringify({ maxPendingMatrixMessagesPerRoom: getMaxPendingMatrixMessagesPerRoomV2() }, null, 2)); });
  matrix.command("set-room-idle-ms-v2 <n>").description("Set idle threshold").action((n) => { setMatrixRoomIdleMsV2(Number(n)); console.log(JSON.stringify({ matrixRoomIdleMs: getMatrixRoomIdleMsV2() }, null, 2)); });
  matrix.command("set-msg-stuck-ms-v2 <n>").description("Set stuck threshold").action((n) => { setMatrixMessageStuckMsV2(Number(n)); console.log(JSON.stringify({ matrixMessageStuckMs: getMatrixMessageStuckMsV2() }, null, 2)); });
  matrix.command("auto-mute-idle-rooms-v2").description("Auto-mute idle rooms").action(() => { console.log(JSON.stringify(autoMuteIdleMatrixRoomsV2(), null, 2)); });
  matrix.command("auto-fail-stuck-msgs-v2").description("Auto-fail stuck sending msgs").action(() => { console.log(JSON.stringify(autoFailStuckMatrixMessagesV2(), null, 2)); });
  matrix.command("stats-v2").description("V2 aggregate stats").action(() => { console.log(JSON.stringify(getMatrixBridgeStatsV2(), null, 2)); });
}
