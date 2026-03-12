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
}
