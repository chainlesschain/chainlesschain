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
import {
  estimateMessagesTokens,
  getContextWindow,
  PromptCompressor,
} from "../harness/prompt-compressor.js";
import { compactConversationWithProvider } from "../harness/provider-backed-compaction.js";
import { runMeteredDirectModelCall } from "../lib/direct-model-usage.js";
import { chatWithTools } from "../runtime/agent-core.js";
import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import {
  contextItemsToMessages,
  createCliContextMemoryRuntime,
  createSummaryContextItem,
} from "../lib/context-memory-kernel/index.js";

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

function buildSemanticQuery(options, recorded, sessionId, operationId, ledger) {
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
        operationId,
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

function kernelBudget(options, recorded, compressor) {
  const model = options.model || recorded.model || undefined;
  const provider = options.provider || recorded.provider || undefined;
  const modelWindowTokens = getContextWindow(model, provider);
  const reservedOutputTokens = Math.max(
    1,
    Math.min(2048, Math.floor(modelWindowTokens / 10)),
  );
  const maximumInput = Math.max(1, modelWindowTokens - reservedOutputTokens);
  const targetInput = Math.max(
    1,
    Math.min(
      maximumInput,
      Math.trunc(Number(compressor.maxTokens)) || maximumInput,
    ),
  );
  const safetyMarginTokens = Math.max(
    0,
    modelWindowTokens - reservedOutputTokens - targetInput,
  );
  const recoveryReserveTokens =
    targetInput <= 1
      ? 0
      : Math.min(256, Math.max(1, Math.floor(targetInput * 0.05)));
  return {
    modelWindowTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    recoveryReserveTokens,
  };
}

function buildKernelSummarizer({
  llmQuery,
  provider,
  model,
  compressor,
  ledger,
  sessionPort,
}) {
  if (typeof llmQuery !== "function") return undefined;
  return async (droppedItems, context) => {
    if (ledger.headHash !== context.inputHead) {
      const error = new Error("session changed before semantic compaction");
      error.code = "SESSION_REVISION_STALE";
      throw error;
    }
    const droppedMessages = contextItemsToMessages(droppedItems);
    if (droppedMessages.length < 3) {
      return { items: [], usageReceipt: { outcome: "not_metered" } };
    }
    const summaryCompressor = new PromptCompressor({
      maxMessages: 4,
      maxTokens: Math.max(256, Math.floor(compressor.maxTokens / 4)),
      llmQuery,
    });
    let compacted;
    try {
      compacted = await compactConversationWithProvider(droppedMessages, {
        compressor: summaryCompressor,
        provider,
        model,
      });
    } finally {
      if (ledger.headHash !== context.inputHead) {
        sessionPort.registerOwnedHeadAdvance({
          operationId: context.operationId,
          fromHead: context.inputHead,
          toHead: ledger.headHash,
        });
      }
    }
    const { messages, stats } = compacted;
    if (stats.summaryUsageUnknown === true) {
      const error = new Error(
        stats.summaryUsageUnknownReason || "provider usage outcome is unknown",
      );
      error.code = "reconciliation_required";
      error.outcomeUnknown = true;
      throw error;
    }
    const providerWasCalled = Boolean(stats.summaryCallId);
    if (providerWasCalled && stats.summaryUsageLedgerSettled !== true) {
      const error = new Error("semantic compaction usage ledger is unsettled");
      error.code = "provider_usage_unsettled";
      error.outcomeUnknown = true;
      throw error;
    }
    const reduced =
      Number(stats.saved || 0) > 0 || messages.length < droppedMessages.length;
    const item = reduced
      ? createSummaryContextItem({
          messages,
          parents: droppedItems,
          operationId: context.operationId,
          now: new Date().toISOString(),
        })
      : null;
    const usageReceipt = providerWasCalled
      ? {
          outcome: "settled",
          callId: stats.summaryCallId,
          ...(stats.summaryProvider || provider
            ? { provider: stats.summaryProvider || provider }
            : {}),
          ...(stats.summaryModel || model
            ? { model: stats.summaryModel || model }
            : {}),
          inputTokens: stats.summaryUsage?.inputTokens || 0,
          outputTokens: stats.summaryUsage?.outputTokens || 0,
          ledgerDigest: canonicalDigest(
            { callId: stats.summaryCallId, headHash: ledger.headHash },
            "chainlesschain.cli-compaction-usage/v1",
          ),
        }
      : { outcome: "not_metered" };
    return { items: item ? [item] : [], usageReceipt };
  };
}

function compactionRequest({
  sessionId,
  operationId,
  options,
  source,
  compressor,
  memoryRevision,
  summarizer,
}) {
  const provider =
    options.provider || source.recorded.provider || "provider.local";
  const model = options.model || source.recorded.model || "default";
  return {
    operationId,
    sessionId,
    ...kernelBudget(options, source.recorded, compressor),
    sink: provider,
    scopeAdmissions: [{ scope: "session", scopeId: sessionId }],
    policyVersion: "cli-context-policy-v1",
    modelProfile: model,
    memoryRevision,
    allowFallback: false,
    ...(summarizer ? { summarizer } : {}),
    metadata: {
      inputMessageCount: source.messages.length,
      originalTokens: estimateMessagesTokens(source.messages),
      provider,
      model,
    },
  };
}

async function dryRunKernelPlan(runtime, request) {
  const snapshot = await runtime.sessionPort.readSnapshot(request.sessionId);
  const plan = await runtime.kernel.planContext({
    modelWindowTokens: request.modelWindowTokens,
    reservedOutputTokens: request.reservedOutputTokens,
    safetyMarginTokens: request.safetyMarginTokens,
    recoveryReserveTokens: request.recoveryReserveTokens,
    items: snapshot.items,
    sink: request.sink,
    scopeAdmissions: request.scopeAdmissions,
    ...(request.partitionCeilings
      ? { partitionCeilings: request.partitionCeilings }
      : {}),
    ...(request.partitionMinimums
      ? { partitionMinimums: request.partitionMinimums }
      : {}),
    policyVersion: request.policyVersion,
    modelProfile: request.modelProfile,
    sessionHead: snapshot.head,
    memoryRevision: request.memoryRevision ?? snapshot.memoryRevision,
    ...(request.now ? { now: request.now } : {}),
  });
  return {
    plan,
    messages: contextItemsToMessages(plan.selected),
    stats: {
      strategy: "canonical-deterministic-selection",
      originalMessages: snapshot.items.length,
      compressedMessages: plan.selected.length,
      originalTokens: snapshot.items.reduce(
        (total, item) => total + item.tokenEstimate,
        0,
      ),
      compressedTokens: plan.selectedTokens,
      saved:
        snapshot.items.reduce((total, item) => total + item.tokenEstimate, 0) -
        plan.selectedTokens,
      dropped: plan.dropped,
      digest: plan.digest,
    },
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
    .option(
      "--operation-id <id>",
      "Stable idempotency key (default: derived from session head)",
    )
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
        const operationId =
          options.operationId ||
          `compact-${sessionId}-${String(source.headHash).slice(-24)}`;
        const runtime = createCliContextMemoryRuntime({ sessionId });
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
          operationId,
          ledger,
        );
        const compressor = buildCompressor(options, source.recorded, llmQuery);
        const memoryRevision =
          runtime.decision.canonical && !options.dryRun
            ? await runtime.memoryPort.getRevision()
            : 0;
        const summarizer = buildKernelSummarizer({
          llmQuery,
          provider: options.provider || source.recorded.provider || undefined,
          model: options.model || source.recorded.model || undefined,
          compressor,
          ledger,
          sessionPort: runtime.sessionPort,
        });
        const request = compactionRequest({
          sessionId,
          operationId,
          options,
          source,
          compressor,
          memoryRevision,
          summarizer,
        });
        const canonicalPreview = await dryRunKernelPlan(runtime, request);

        if (runtime.decision.canonical) {
          const reduced = canonicalPreview.plan.dropped.length > 0;
          if (!reduced || options.dryRun) {
            if (options.json) {
              console.log(
                JSON.stringify(
                  {
                    sessionId,
                    operationId,
                    compacted: false,
                    dryRun: Boolean(options.dryRun),
                    cutover: runtime.decision,
                    stats: canonicalPreview.stats,
                  },
                  null,
                  2,
                ),
              );
              return;
            }
            logger.log(
              chalk.gray(
                reduced
                  ? `Would compact ${canonicalPreview.plan.dropped.length} canonical item(s).`
                  : `Nothing to compact - ${messages.length} message(s) are within the canonical budget.`,
              ),
            );
            return;
          }

          const receipt = await runtime.kernel.compactContext(request);
          if (["stale", "reconciliation_required"].includes(receipt.status)) {
            if (options.json) {
              console.log(
                JSON.stringify(
                  {
                    sessionId,
                    operationId,
                    cutover: runtime.decision,
                    receipt,
                  },
                  null,
                  2,
                ),
              );
            } else {
              logger.error(
                chalk.yellow(
                  `Compaction requires ${receipt.status === "stale" ? "a retry" : "reconciliation"}: ${operationId}`,
                ),
              );
            }
            process.exitCode = receipt.status === "stale" ? 1 : 2;
            return;
          }
          const committed = await runtime.sessionPort.readSnapshot(sessionId);
          const compressedTokens = committed.items.reduce(
            (total, item) => total + item.tokenEstimate,
            0,
          );
          const stats = {
            strategy: "canonical-context-memory-kernel",
            originalMessages: messages.length,
            compressedMessages: committed.items.length,
            originalTokens: canonicalPreview.stats.originalTokens,
            compressedTokens,
            saved: canonicalPreview.stats.originalTokens - compressedTokens,
            dropped: canonicalPreview.plan.dropped,
          };
          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  sessionId,
                  operationId,
                  compacted: true,
                  cutover: runtime.decision,
                  stats,
                  receipt,
                },
                null,
                2,
              ),
            );
            return;
          }
          logger.log(chalk.green(`Compacted ${sessionId}`));
          logger.log(
            chalk.gray(
              `  ${stats.originalMessages} -> ${stats.compressedMessages} messages` +
                `, ${stats.originalTokens} -> ${stats.compressedTokens} tokens` +
                ` (saved ${stats.saved}, canonical kernel)`,
            ),
          );
          logger.log(
            chalk.gray(`  resume with: cc agent --resume ${sessionId}`),
          );
          return;
        }

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
              {
                sessionId,
                dryRun: !!options.dryRun,
                cutover: runtime.decision,
                stats,
                ...(runtime.decision.shadow
                  ? { canonicalShadow: canonicalPreview.stats }
                  : {}),
              },
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
