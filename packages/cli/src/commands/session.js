/**
 * Session management commands
 * chainlesschain session list|show|resume|export|delete
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  listSessions,
  getSession,
  deleteSession,
  exportSessionMarkdown,
} from "../lib/session-manager.js";
import {
  listJsonlSessions,
  rebuildMessages,
  sessionExists,
  readEvents,
  migrateLegacySessions,
  migrateLegacySessionsBatch,
  validateJsonlSession,
  validateAllJsonlSessions,
} from "../harness/jsonl-session-store.js";
import { feature } from "../lib/feature-flags.js";
import {
  listWorkflowSessions,
  readWorkflowSession,
} from "../lib/workflow-state-reader.js";

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
        const limit = Math.max(1, parseInt(options.limit) || 20);
        let sessions = [];

        // Merge DB sessions + JSONL sessions
        if (ctx.db) {
          const db = ctx.db.getDatabase();
          sessions.push(
            ...listSessions(db, { limit }).map((s) => ({
              ...s,
              _store: "db",
            })),
          );
        }

        if (feature("JSONL_SESSION")) {
          sessions.push(
            ...listJsonlSessions({ limit }).map((s) => ({
              ...s,
              _store: "jsonl",
            })),
          );
        }

        // Deduplicate by id (JSONL takes precedence), sort by updated_at
        const seen = new Set();
        sessions = sessions
          .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))
          .filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          })
          .slice(0, limit);

        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else if (sessions.length === 0) {
          logger.info(
            "No saved sessions. Use 'chat' or 'agent' to create one.",
          );
        } else {
          logger.log(chalk.bold(`Sessions (${sessions.length}):\n`));
          for (const s of sessions) {
            const storeTag =
              s._store === "jsonl" ? chalk.yellow("[JSONL]") : "";
            logger.log(
              `  ${chalk.gray(s.id.slice(0, 16))}  ${chalk.white(s.title)}  ${chalk.cyan(s.message_count + " msgs")}  ${chalk.gray(s.updated_at)} ${storeTag}`,
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
        let sess = null;

        // Try JSONL first if enabled
        if (feature("JSONL_SESSION") && sessionExists(id)) {
          const events = readEvents(id);
          const startEvent = events.find((e) => e.type === "session_start");
          const msgs = rebuildMessages(id);
          sess = {
            id,
            title: startEvent?.data?.title || "Untitled",
            provider: startEvent?.data?.provider || "",
            model: startEvent?.data?.model || "",
            message_count: msgs.length,
            messages: msgs,
            _store: "jsonl",
          };
        }

        // Fallback to DB
        if (!sess && ctx.db) {
          const db = ctx.db.getDatabase();
          sess = getSession(db, id);
        }

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
        let sess = null;

        // Try JSONL first
        if (feature("JSONL_SESSION") && sessionExists(id)) {
          const events = readEvents(id);
          const startEvent = events.find((e) => e.type === "session_start");
          sess = {
            id,
            title: startEvent?.data?.title || "Untitled",
            provider: startEvent?.data?.provider || "",
            model: startEvent?.data?.model || "",
            messages: rebuildMessages(id),
          };
          sess.message_count = sess.messages.length;
        }

        // Fallback to DB
        if (!sess && ctx.db) {
          const db = ctx.db.getDatabase();
          sess = getSession(db, id);
        }

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

  session
    .command("migrate")
    .description("Migrate legacy JSON session files to JSONL")
    .argument("[source]", "Directory containing legacy .json session files")
    .option("--dry-run", "Show what would migrate without writing files")
    .option("--force", "Overwrite existing JSONL sessions")
    .option("--no-archive", "Do not keep .migrated.json backups")
    .option(
      "--sample-size <n>",
      "Validate N migrated sessions after migration",
      "3",
    )
    .option("--retry-failures", "Retry failed migrations once")
    .option("--json", "Output as JSON")
    .action(async (source, options) => {
      try {
        const report = migrateLegacySessionsBatch(source, {
          dryRun: options.dryRun,
          force: options.force,
          archive: options.archive,
          sampleSize: parseInt(options.sampleSize, 10) || 3,
          retryFailures: options.retryFailures,
        });
        const results =
          report.results || migrateLegacySessions(source, options);

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        if (results.length === 0) {
          logger.info("No legacy JSON session files found.");
          return;
        }

        for (const result of results) {
          if (result.skipped) {
            logger.log(
              `${chalk.yellow("skip")} ${result.file} -> ${result.sessionId} (${result.reason})`,
            );
            continue;
          }
          logger.log(
            `${chalk.green(options.dryRun ? "plan" : "migrated")} ${result.file} -> ${result.sessionId} (${result.messageCount} messages)`,
          );
        }

        logger.log(
          chalk.gray(
            `summary: scanned ${report.summary.scanned}, migrated ${report.summary.migrated}, skipped ${report.summary.skipped}, failed ${report.summary.failed}, retries ${report.summary.retries}`,
          ),
        );

        if (report.sampledValidation?.length) {
          for (const item of report.sampledValidation) {
            const label =
              item.valid && item.matchesExpectedMessages
                ? chalk.green("sample-ok")
                : chalk.red("sample-fail");
            logger.log(
              `${label} ${item.sessionId} (${item.messageCount}/${item.expectedMessageCount} messages)`,
            );
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  session
    .command("validate")
    .description("Validate JSONL session files")
    .argument("[id]", "Session ID to validate")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const result = id
          ? validateJsonlSession(id)
          : validateAllJsonlSessions();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const results = Array.isArray(result) ? result : [result];
        for (const item of results) {
          const label = item.valid
            ? chalk.green("valid")
            : chalk.red("invalid");
          logger.log(
            `${label} ${item.sessionId} (${item.eventCount} events, ${item.messageCount || 0} messages, malformed: ${item.malformedLines})`,
          );
          if (!item.valid && item.reason) {
            logger.log(`  ${chalk.gray(item.reason)}`);
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // session workflow — inspect canonical coding workflow state
  // Reads .chainlesschain/sessions/<id>/{intent.md,plan.md,progress.log,mode.json}
  // written by the 4 workflow skills ($deep-interview/$ralplan/$ralph/$team).
  session
    .command("workflow")
    .description("Inspect coding workflow state (.chainlesschain/sessions/)")
    .argument("[id]", "Workflow session ID (omit to list all)")
    .option("--json", "Output as JSON")
    .option("--cwd <path>", "Project root (defaults to process.cwd())")
    .action((id, options) => {
      try {
        const projectRoot = path.resolve(options.cwd || process.cwd());

        if (!id) {
          const items = listWorkflowSessions(projectRoot);
          if (options.json) {
            console.log(JSON.stringify(items, null, 2));
            return;
          }
          if (items.length === 0) {
            logger.info("No workflow sessions under .chainlesschain/sessions/");
            logger.info(
              'Start one with: $deep-interview "<your goal>" in the coding agent',
            );
            return;
          }
          logger.log(chalk.bold(`Workflow sessions (${items.length}):\n`));
          for (const s of items) {
            const approvedTag = s.approved
              ? chalk.green("approved")
              : s.hasPlan
                ? chalk.yellow("unapproved")
                : chalk.gray("no-plan");
            logger.log(
              `  ${chalk.cyan(s.sessionId)}  ${chalk.white(s.stage || "?")}  ${approvedTag}  ${chalk.gray(s.updatedAt || "")}`,
            );
          }
          return;
        }

        const data = readWorkflowSession(projectRoot, id);
        if (!data) {
          logger.error(`Workflow session "${id}" not found`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        logger.log(chalk.bold(`\nSession: ${data.sessionId}`));
        logger.log(
          `Stage:  ${data.mode?.stage || chalk.gray("(unset)")}    Approved: ${
            data.planApproved ? chalk.green("yes") : chalk.yellow("no")
          }`,
        );
        logger.log(chalk.gray(`Dir:    ${data.dir}\n`));

        if (data.intent) {
          logger.log(chalk.bold("── intent.md ──"));
          logger.log(data.intent.trim());
          logger.log("");
        } else {
          logger.log(chalk.gray("(no intent.md — run $deep-interview first)"));
        }

        if (data.plan) {
          logger.log(chalk.bold("── plan.md ──"));
          logger.log(data.plan.trim());
          logger.log("");
        } else {
          logger.log(chalk.gray("(no plan.md — run $ralplan)"));
        }

        if (data.progress) {
          logger.log(chalk.bold("── progress.log (tail) ──"));
          const lines = data.progress.trim().split("\n");
          for (const line of lines.slice(-20)) {
            logger.log(`  ${line}`);
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
