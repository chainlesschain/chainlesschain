import chalk from "chalk";
import { numericOption } from "../lib/cli-numeric.js";
import { logger } from "../lib/logger.js";
import { getPrLinks } from "../lib/pr-link-store.js";
import { readSessionTranscriptPage } from "../lib/session-transcript-page.js";
import {
  getJsonlSessionMetadata,
  rebuildMessages,
  resolveSessionAuthority,
} from "../harness/jsonl-session-store.js";

export function registerSessionShowSubcommand(session, program) {
  session
    .command("show")
    .description("Show a session's messages")
    .argument("<id>", "Session ID (or prefix)")
    .option("-n, --limit <n>", "Max messages to show")
    .option("--json", "Output as JSON")
    .option(
      "--page-size <n>",
      "Verified saved-context page size (1–100; requires --json)",
    )
    .option(
      "--before <cursor>",
      "Load the previous verified context page (requires --json)",
    )
    .action(async (id, options) => {
      let ctx = null;
      let shutdown = null;
      try {
        let sess = null;

        // The feature flag controls creation/migration, not authority. Once a
        // canonical namespace witness exists it must fence the legacy DB even
        // if JSONL_SESSION is later disabled.
        const authority = resolveSessionAuthority(id);
        const jsonlId = authority?.readable ? authority.id : null;
        if (authority && !authority.readable) {
          logger.error(
            `Session ${authority.id} has canonical persistence evidence but no readable transcript (${authority.presence}).`,
          );
          process.exitCode = 1;
          return;
        }
        if (jsonlId) {
          if (options.pageSize || options.before) {
            if (!options.json)
              throw new Error("Transcript pagination requires --json");
            const page = readSessionTranscriptPage(jsonlId, {
              limit: numericOption(options.pageSize || "50", {
                name: "--page-size",
                integer: true,
                min: 1,
                max: 100,
              }),
              cursor: options.before || null,
            });
            console.log(JSON.stringify(page));
            return;
          }
          const metadata = getJsonlSessionMetadata(jsonlId);
          const messages = rebuildMessages(jsonlId);
          sess = {
            id: jsonlId,
            title: metadata?.title || "Untitled",
            provider: metadata?.provider || "",
            model: metadata?.model || "",
            message_count: messages.length,
            messages,
            _store: "jsonl",
          };
        }

        // Keep SQLite and the application bootstrap outside the canonical
        // JSONL read path. Legacy sessions still retain the original fallback.
        if (!sess) {
          if (options.pageSize || options.before)
            throw new Error(
              "Verified transcript pages require a canonical JSONL session",
            );
          const runtime = await import("../runtime/bootstrap.js");
          const sessionManager = await import("../lib/session-manager.js");
          shutdown = runtime.shutdown;
          ctx = await runtime.bootstrap({ verbose: program.opts().verbose });
          if (ctx?.db) {
            sess = sessionManager.getSession(ctx.db.getDatabase(), id);
          }
        }

        if (!sess) {
          logger.error(`Session not found: ${id}`);
          process.exitCode = 1;
          return;
        }

        try {
          const prLinks = getPrLinks(sess.id);
          if (prLinks.length > 0) sess.prLinks = prLinks;
        } catch {
          // PR decoration is cosmetic.
        }

        if (options.json) {
          console.log(JSON.stringify(sess, null, 2));
          return;
        }

        logger.log(chalk.bold(sess.title));
        logger.log(
          chalk.gray(
            `ID: ${sess.id}  Provider: ${sess.provider}  Model: ${sess.model}  Messages: ${sess.message_count}`,
          ),
        );
        if (sess.prLinks) {
          for (const pr of sess.prLinks) {
            logger.log(
              chalk.magenta(
                `PR: #${pr.number}${pr.state ? ` ${pr.state}` : ""}${pr.url ? `  ${pr.url}` : ""}`,
              ),
            );
          }
        }
        logger.log("");

        let messages = sess.messages;
        if (options.limit) {
          messages = messages.slice(
            -numericOption(options.limit, {
              name: "--limit",
              integer: true,
              min: 1,
            }),
          );
        }

        for (const message of messages) {
          if (message.role === "system") continue;
          const label =
            message.role === "user" ? chalk.green("you> ") : chalk.blue("ai> ");
          logger.log(`${label}${(message.content || "").substring(0, 500)}`);
          logger.log("");
        }
      } catch (error) {
        logger.error(`Failed: ${error.message}`);
        process.exitCode = 1;
      } finally {
        if (ctx && shutdown) await shutdown();
      }
    });
}

export function registerSessionShowCommand(program) {
  const session = program
    .command("session")
    .description("Conversation session management");
  registerSessionShowSubcommand(session, program);
}
