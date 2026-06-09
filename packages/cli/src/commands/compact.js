/**
 * cc compact — compact a stored session's history (Claude-Code `/compact` parity,
 * headless). Complements the interactive agent REPL's `/compact`, which only
 * works on the live in-memory conversation.
 *
 *   cc compact <session-id>              compact and persist (writes a `compact`
 *                                        checkpoint event the resume path honors)
 *   cc compact <session-id> --dry-run    preview the reduction, write nothing
 *
 * Engine: the existing PromptCompressor (snip + dedup + collapse + truncate).
 * Runs OFFLINE and deterministic — no LLM summarization is wired here, so a
 * compaction never makes a network call and is reproducible. By default it
 * sizes its thresholds to the session's recorded model/provider context window;
 * override with --model/--provider or the hard --max-tokens/--max-messages.
 *
 * After compaction the new history is appended as a JSONL `compact` event;
 * `rebuildMessages()` already rebuilds from the last such event, so a later
 * `cc agent --resume <id>` picks up the shortened history automatically.
 * Distinct from `cc checkpoint` (file state) and `cc workflow checkpoint`
 * (execution state).
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  sessionExists,
  readEvents,
  rebuildMessages,
  appendCompactEvent,
} from "../harness/jsonl-session-store.js";
import { PromptCompressor } from "../harness/prompt-compressor.js";

/** Build a compressor sized to the session (or explicit overrides). */
function buildCompressor(options, recorded) {
  const maxTokens = options.maxTokens ? Number(options.maxTokens) : undefined;
  const maxMessages = options.maxMessages
    ? Number(options.maxMessages)
    : undefined;
  if (maxTokens || maxMessages) {
    // Hard thresholds win — adaptive sizing is bypassed by the constructor.
    return new PromptCompressor({ maxTokens, maxMessages });
  }
  const model = options.model || recorded.model || undefined;
  const provider = options.provider || recorded.provider || undefined;
  // model/provider → adaptive context-window thresholds; neither → defaults.
  return new PromptCompressor({ model, provider });
}

export function registerCompactCommand(program) {
  program
    .command("compact <session-id>")
    .description(
      "Compact a stored session's history (offline; persists for --resume)",
    )
    .option(
      "-m, --model <model>",
      "Model for adaptive context-window sizing (default: session's recorded model)",
    )
    .option(
      "-p, --provider <provider>",
      "Provider for adaptive sizing (default: session's recorded provider)",
    )
    .option("--max-tokens <n>", "Override the token threshold (skips adaptive)")
    .option(
      "--max-messages <n>",
      "Override the message-count threshold (skips adaptive)",
    )
    .option("--dry-run", "Preview the reduction without writing")
    .option("--json", "Output as JSON")
    .action(async (sessionId, options) => {
      try {
        if (!sessionExists(sessionId)) {
          logger.error(chalk.red(`no such session: ${sessionId}`));
          logger.log(chalk.gray("  list sessions with: cc session list"));
          process.exitCode = 1;
          return;
        }

        const events = readEvents(sessionId);
        const start = events.find((e) => e.type === "session_start");
        const recorded = {
          model: start?.data?.model || "",
          provider: start?.data?.provider || "",
        };

        const messages = rebuildMessages(sessionId);
        const compressor = buildCompressor(options, recorded);
        const { messages: compacted, stats } =
          await compressor.compress(messages);

        const reduced = stats.saved > 0 || compacted.length < messages.length;

        if (!reduced) {
          if (options.json) {
            console.log(
              JSON.stringify({ sessionId, compacted: false, stats }, null, 2),
            );
            return;
          }
          logger.log(
            chalk.gray(
              `Nothing to compact — ${messages.length} message(s), ${stats.originalTokens} tokens (under threshold).`,
            ),
          );
          return;
        }

        if (!options.dryRun) {
          appendCompactEvent(sessionId, { ...stats, messages: compacted });
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              { sessionId, dryRun: !!options.dryRun, stats },
              null,
              2,
            ),
          );
          return;
        }

        const verb = options.dryRun ? "Would compact" : "Compacted";
        logger.log(
          (options.dryRun ? chalk.cyan : chalk.green)(
            `${options.dryRun ? "" : "✓ "}${verb} ${sessionId}`,
          ),
        );
        logger.log(
          chalk.gray(
            `  ${stats.originalMessages} → ${stats.compressedMessages} messages` +
              `, ${stats.originalTokens} → ${stats.compressedTokens} tokens` +
              ` (saved ${stats.saved}, ${stats.strategy})`,
          ),
        );
        if (options.dryRun) {
          logger.log(
            chalk.gray(`  re-run without --dry-run to persist the compaction`),
          );
        } else {
          logger.log(
            chalk.gray(`  resume with: cc agent --resume ${sessionId}`),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`compact failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
