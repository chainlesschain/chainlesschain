/**
 * cc compact — compact a stored session's history (Claude-Code `/compact` parity,
 * headless). Complements the interactive agent REPL's `/compact`, which only
 * works on the live in-memory conversation.
 *
 *   cc compact <session-id>              compact and persist (writes a `compact`
 *                                        checkpoint event the resume path honors)
 *   cc compact <session-id> --dry-run    offline preview; no provider call/write
 *
 * Engine: PromptCompressor with a bounded structured semantic handoff using the
 * session's recorded provider. `--offline` explicitly selects deterministic
 * extractive/count-based compaction. Provider failure degrades visibly to the
 * bounded extractive handoff instead of silently discarding facts.
 *
 * After compaction the new history is appended as a revision-checked JSONL
 * `compact` event; verified resume rebuilds from the last such event, so a
 * later `cc agent --resume <id>` picks up the shortened history automatically.
 * Distinct from `cc checkpoint` (file state) and `cc workflow checkpoint`
 * (execution state).
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  appendAuthorityEventIfHead,
  appendEventIfHead,
  readVerifiedProjection,
  sessionExists,
} from "../harness/jsonl-session-store.js";
import { PromptCompressor } from "../harness/prompt-compressor.js";
import { compactConversationWithProvider } from "../harness/provider-backed-compaction.js";
import { runMeteredDirectModelCall } from "../lib/direct-model-usage.js";
import { chatWithTools } from "../runtime/agent-core.js";

/** Build a compressor sized to the session (or explicit overrides). */
function buildCompressor(options, recorded, llmQuery) {
  const maxTokens = options.maxTokens ? Number(options.maxTokens) : undefined;
  const maxMessages = options.maxMessages
    ? Number(options.maxMessages)
    : undefined;
  if (maxTokens || maxMessages) {
    // Hard thresholds win — adaptive sizing is bypassed by the constructor.
    return new PromptCompressor({
      maxTokens,
      maxMessages,
      llmQuery,
    });
  }
  const model = options.model || recorded.model || undefined;
  const provider = options.provider || recorded.provider || undefined;
  // model/provider → adaptive context-window thresholds; neither → defaults.
  return new PromptCompressor({
    model,
    provider,
    llmQuery,
  });
}

function attachMeteringMetadata(value, { callId, settled }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  try {
    Object.defineProperties(value, {
      compactionCallId: {
        configurable: true,
        value: callId || undefined,
      },
      usageLedgerSettled: {
        configurable: true,
        value: settled === true,
      },
    });
  } catch {
    // A frozen provider error still propagates. The durable started row remains
    // authoritative if its unknown settlement could not be attached here.
  }
}

function buildSemanticQuery(options, recorded, sessionId, ledger) {
  const provider = options.provider || recorded.provider || undefined;
  const model = options.model || recorded.model || undefined;
  // A preview must be both write-free and spend-free. It uses the same
  // deterministic compressor thresholds, but never installs an LLM callback.
  if (options.offline || options.dryRun || !provider) return null;
  const baseUrl =
    options.baseUrl ||
    (provider === "ollama" ? "http://localhost:11434" : undefined);
  return async (prompt) => {
    let callId = null;
    try {
      const response = await runMeteredDirectModelCall({
        sessionId,
        provider,
        model,
        source: "semantic-compaction",
        persist: async (type, data) => {
          const appended = appendEventIfHead(
            sessionId,
            type,
            data,
            ledger.headHash,
          );
          ledger.headHash = appended.hash;
          if (type === "model_usage_started") {
            callId = data.callId;
            ledger.callId = callId;
            ledger.started = true;
          } else {
            ledger.settled = true;
          }
        },
        call: () =>
          chatWithTools([{ role: "user", content: prompt }], {
            provider,
            model,
            baseUrl,
            enabledToolNames: [],
            extraToolDefinitions: [],
            hostManagedToolPolicy: null,
            contextEngine: null,
            maxOutputTokens: 2048,
          }),
      });
      return {
        summary: response?.message?.content || "",
        usage: response?.usage || null,
        provider,
        model,
        callId,
        usageLedgerSettled: true,
      };
    } catch (error) {
      attachMeteringMetadata(error, {
        callId: callId || ledger.callId,
        settled: ledger.settled,
      });
      throw error;
    }
  };
}

function readCompactSource(sessionId) {
  return readVerifiedProjection(sessionId, () => {
    let recorded = Object.freeze({ model: "", provider: "" });
    let sawSessionStart = false;
    return {
      accept(event) {
        if (!sawSessionStart && event?.type === "session_start") {
          sawSessionStart = true;
          recorded = Object.freeze({
            model:
              typeof event.data?.model === "string" ? event.data.model : "",
            provider:
              typeof event.data?.provider === "string"
                ? event.data.provider
                : "",
          });
        }
      },
      finish(authority) {
        return Object.freeze({
          headHash: authority.headHash,
          messages: Object.freeze([...authority.readMessages()]),
          recorded,
        });
      },
    };
  });
}

export function registerCompactCommand(program) {
  program
    .command("compact <session-id>")
    .description(
      "Compact a stored session into a structured handoff (persists for --resume)",
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
    .option(
      "--offline",
      "Disable provider summarization and stay deterministic",
    )
    .option("--base-url <url>", "Provider base URL for semantic compaction")
    .option("--json", "Output as JSON")
    .action(async (sessionId, options) => {
      try {
        if (!sessionExists(sessionId)) {
          logger.error(chalk.red(`no such session: ${sessionId}`));
          logger.log(chalk.gray("  list sessions with: cc session list"));
          process.exitCode = 1;
          return;
        }

        const source = readCompactSource(sessionId);
        const messages = source.messages;
        const ledger = {
          headHash: source.headHash,
          callId: null,
          started: false,
          settled: false,
        };
        const llmQuery = buildSemanticQuery(
          options,
          source.recorded,
          sessionId,
          ledger,
        );
        const compressor = buildCompressor(options, source.recorded, llmQuery);
        // llmQuery already persisted a complete call ledger. The provider
        // helper only carries its metadata through stats; its projected usage
        // event is intentionally not appended a second time here.
        const { messages: compacted, stats } =
          await compactConversationWithProvider(messages, {
            compressor,
            provider: options.provider || source.recorded.provider || undefined,
            model: options.model || source.recorded.model || undefined,
          });

        if (ledger.started && !ledger.settled) {
          throw new Error("semantic compaction usage ledger is unsettled");
        }

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
          appendAuthorityEventIfHead(
            sessionId,
            "compact",
            { ...stats, messages: compacted },
            ledger.headHash,
          );
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
        if (stats.degraded === true) {
          logger.log(
            chalk.yellow(
              `  semantic summary degraded to ${stats.summaryMode}: ${stats.degradedReason}`,
            ),
          );
        }
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
        const reason =
          err?.code === "SESSION_REVISION_STALE"
            ? "session changed while compacting; retry"
            : err.message;
        logger.error(chalk.red(`compact failed: ${reason}`));
        process.exitCode = 1;
      }
    });
}
