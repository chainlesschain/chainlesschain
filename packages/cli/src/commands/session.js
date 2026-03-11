/**
 * Session management commands
 * chainlesschain session list|show|resume|export|delete
 */

import fs from "fs";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  listSessions,
  getSession,
  deleteSession,
  exportSessionMarkdown,
} from "../lib/session-manager.js";

export function registerSessionCommand(program) {
  const session = program
    .command("session")
    .description("Conversation session management");

  // session list
  session
    .command("list", { isDefault: true })
    .description("List saved sessions")
    .option("-n, --limit <n>", "Max sessions", "20")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const sessions = listSessions(db, {
          limit: Math.max(1, parseInt(options.limit) || 20),
        });

        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else if (sessions.length === 0) {
          logger.info(
            "No saved sessions. Use 'chat' or 'agent' to create one.",
          );
        } else {
          logger.log(chalk.bold(`Sessions (${sessions.length}):\n`));
          for (const s of sessions) {
            logger.log(
              `  ${chalk.gray(s.id.slice(0, 16))}  ${chalk.white(s.title)}  ${chalk.cyan(s.message_count + " msgs")}  ${chalk.gray(s.updated_at)}`,
            );
            if (s.summary) {
              logger.log(`    ${chalk.gray(s.summary.substring(0, 100))}`);
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session show
  session
    .command("show")
    .description("Show a session's messages")
    .argument("<id>", "Session ID (or prefix)")
    .option("-n, --limit <n>", "Max messages to show")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const sess = getSession(db, id);

        if (!sess) {
          logger.error(`Session not found: ${id}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(sess, null, 2));
        } else {
          logger.log(chalk.bold(sess.title));
          logger.log(
            chalk.gray(
              `ID: ${sess.id}  Provider: ${sess.provider}  Model: ${sess.model}  Messages: ${sess.message_count}`,
            ),
          );
          logger.log("");

          let messages = sess.messages;
          if (options.limit) {
            messages = messages.slice(-parseInt(options.limit));
          }

          for (const msg of messages) {
            if (msg.role === "system") continue;
            const label =
              msg.role === "user" ? chalk.green("you> ") : chalk.blue("ai> ");
            const content = (msg.content || "").substring(0, 500);
            logger.log(`${label}${content}`);
            logger.log("");
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session resume
  session
    .command("resume")
    .description("Resume a session in chat mode")
    .argument("<id>", "Session ID (or prefix)")
    .option("--model <model>", "Model name")
    .option("--provider <provider>", "LLM provider")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const sess = getSession(db, id);

        if (!sess) {
          logger.error(`Session not found: ${id}`);
          process.exit(1);
        }

        logger.info(
          `Resuming session: ${chalk.cyan(sess.title)} (${sess.message_count} messages)`,
        );

        // Import and start chat REPL with restored messages
        const { startChatRepl } = await import("../repl/chat-repl.js");
        await startChatRepl({
          model: options.model || sess.model || "qwen2:7b",
          provider: options.provider || sess.provider || "ollama",
          baseUrl: options.baseUrl || "http://localhost:11434",
          resumeMessages: sess.messages,
          sessionId: sess.id,
        });
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session export
  session
    .command("export")
    .description("Export a session as Markdown")
    .argument("<id>", "Session ID (or prefix)")
    .option("-o, --output <file>", "Output file path")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const sess = getSession(db, id);

        if (!sess) {
          logger.error(`Session not found: ${id}`);
          process.exit(1);
        }

        const markdown = exportSessionMarkdown(sess);

        if (options.output) {
          fs.writeFileSync(options.output, markdown, "utf8");
          logger.success(`Exported to ${chalk.cyan(options.output)}`);
        } else {
          console.log(markdown);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session delete
  session
    .command("delete")
    .description("Delete a session")
    .argument("<id>", "Session ID")
    .option("--force", "Skip confirmation")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        if (!options.force) {
          const { confirm } = await import("@inquirer/prompts");
          const ok = await confirm({
            message: `Delete session "${id}"?`,
          });
          if (!ok) {
            logger.info("Cancelled");
            await shutdown();
            return;
          }
        }

        const ok = deleteSession(db, id);
        if (ok) {
          logger.success("Session deleted");
        } else {
          logger.error(`Session not found: ${id}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
