import {
  estimateMessagesTokens,
  PromptCompressor,
  sanitizeToolPairs,
} from "./prompt-compressor.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const MIN_MAX_OUTPUT_TOKENS = 256;
const MAX_MAX_OUTPUT_TOKENS = 4096;
const MANUAL_MAX_MESSAGES = 4;
const MAX_USAGE_CALL_ID_CHARS = 128;

function safeUsageCallId(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_USAGE_CALL_ID_CHARS ||
    /\p{Cc}/u.test(value)
  ) {
    return null;
  }
  return value.trim();
}

function attachProviderCallId(result, startedCallId) {
  const callId =
    safeUsageCallId(startedCallId) || safeUsageCallId(result?.callId);
  if (!callId) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...result, callId };
  }
  return { summary: result, callId };
}

function attachProviderCallIdToError(error, callId) {
  const safeCallId = safeUsageCallId(callId);
  if (
    !safeCallId ||
    !error ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return;
  }
  try {
    Object.defineProperty(error, "compactionCallId", {
      configurable: true,
      value: safeCallId,
    });
  } catch {
    // Frozen provider errors still propagate; their call remains conservative
    // because no unsafe metadata is manufactured here.
  }
}

function boundedMaxOutputTokens(value) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }
  return Math.min(
    MAX_MAX_OUTPUT_TOKENS,
    Math.max(MIN_MAX_OUTPUT_TOKENS, parsed),
  );
}

function tokenCount(value, { required = false } = {}) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return required ? null : 0;
}

function responseSummary(response) {
  if (typeof response === "string") return response;
  return response?.message?.content ?? response?.content ?? "";
}

function preserveCompletedExchange(originalMessages, compactedMessages) {
  if (originalMessages.at(-1)?.role === "user") return compactedMessages;
  let lastUserIndex = -1;
  for (let index = originalMessages.length - 1; index >= 0; index -= 1) {
    if (originalMessages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return compactedMessages;

  const completedExchange = originalMessages.slice(lastUserIndex);
  const exchangeMessages = new Set(completedExchange);
  const prefix = compactedMessages.filter(
    (message) => !exchangeMessages.has(message),
  );
  return sanitizeToolPairs([...prefix, ...completedExchange]);
}

/**
 * Convert PromptCompressor's provider-neutral summary accounting into the
 * token-usage wire shape shared by the agent hosts.
 */
export function compactionTokenUsage(stats) {
  const usage = stats?.summaryUsage;
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = tokenCount(usage.inputTokens, { required: true });
  const outputTokens = tokenCount(usage.outputTokens, { required: true });
  if (inputTokens == null || outputTokens == null) return null;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: tokenCount(usage.cacheReadTokens),
    cache_creation_input_tokens: tokenCount(usage.cacheCreationTokens),
  };
}

/**
 * Build one provider-backed semantic compaction operation.
 *
 * The provider request is deliberately tool-free. A missing provider adapter,
 * transport error, or malformed summary is handled by PromptCompressor's
 * structured extractive handoff, so every host gets the same safe degradation
 * contract instead of falling back to positional truncation.
 */
export async function compactConversationWithProvider(messages, options = {}) {
  const originalMessages = Array.isArray(messages) ? [...messages] : [];
  const provider = options.provider || null;
  const model = options.model || null;
  const maxOutputTokens = boundedMaxOutputTokens(options.maxOutputTokens);
  const chatFn = options.chatFn;
  const invokeProviderCall = async (call) => {
    const callId = safeUsageCallId(await options.onProviderCallStart?.());
    try {
      return attachProviderCallId(await call(), callId);
    } catch (error) {
      attachProviderCallIdToError(error, callId);
      throw error;
    }
  };
  const llmQuery =
    typeof options.llmQuery === "function"
      ? async (prompt) => invokeProviderCall(() => options.llmQuery(prompt))
      : async (prompt) => {
          if (typeof chatFn !== "function") {
            throw new Error("provider adapter unavailable");
          }
          return invokeProviderCall(async () => {
            const response = await chatFn([{ role: "user", content: prompt }], {
              ...(options.chatOptions || {}),
              provider,
              model,
              baseUrl: options.baseUrl,
              apiKey: options.apiKey,
              signal: options.signal,
              contextEngine: null,
              enabledToolNames: [],
              extraToolDefinitions: [],
              hostManagedToolPolicy: null,
              onToken: undefined,
              onStall: undefined,
              onStreamRetry: undefined,
              maxOutputTokens,
            });
            return {
              summary: responseSummary(response),
              usage: response?.usage || null,
              provider,
              model,
              ...(safeUsageCallId(response?.callId)
                ? { callId: safeUsageCallId(response.callId) }
                : {}),
              ...(response?.usageLedgerSettled === true
                ? { usageLedgerSettled: true }
                : {}),
            };
          });
        };

  const compressor =
    options.compressor ||
    new PromptCompressor({
      model,
      provider,
      llmQuery,
      ...(options.force === true
        ? { maxMessages: options.maxMessages || MANUAL_MAX_MESSAGES }
        : options.maxMessages
          ? { maxMessages: options.maxMessages }
          : {}),
      ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
      summaryInputMaxChars: options.summaryInputMaxChars,
    });
  if (
    options.onlyIfNeeded === true &&
    !compressor.shouldAutoCompact(originalMessages)
  ) {
    const originalTokens = estimateMessagesTokens(originalMessages);
    return {
      messages: originalMessages,
      stats: {
        strategy: "none",
        originalMessages: originalMessages.length,
        compressedMessages: originalMessages.length,
        originalTokens,
        compressedTokens: originalTokens,
        saved: 0,
        ratio: 1,
        trimmed: 0,
      },
      degradedEvent: null,
      usageEvent: null,
      usageUnknownEvent: null,
    };
  }
  const result = await compressor.compress(originalMessages, {
    preserveToolPairs: true,
    ...(typeof options.isPinned === "function"
      ? { isPinned: options.isPinned }
      : {}),
  });
  const compactedMessages =
    options.preserveCompletedExchange === true
      ? preserveCompletedExchange(originalMessages, result.messages)
      : result.messages;
  const originalTokens = estimateMessagesTokens(originalMessages);
  const compressedTokens = estimateMessagesTokens(compactedMessages);
  const stats = {
    ...result.stats,
    originalMessages: originalMessages.length,
    compressedMessages: compactedMessages.length,
    originalTokens,
    compressedTokens,
    saved: originalTokens - compressedTokens,
    ratio: originalTokens > 0 ? compressedTokens / originalTokens : 1,
    trimmed: Math.max(0, originalMessages.length - compactedMessages.length),
  };
  const usage = compactionTokenUsage(stats);
  const usageUnknownEvent =
    stats.summaryUsageUnknown === true
      ? {
          provider: stats.summaryProvider || provider,
          model: stats.summaryModel || model,
          source: "semantic-compaction",
          reason:
            stats.summaryUsageUnknownReason ||
            "provider_transport_outcome_unknown",
          usageOutcome: "unknown",
          ...(stats.summaryCallId ? { callId: stats.summaryCallId } : {}),
          ...(stats.summaryUsageLedgerSettled === true
            ? { usageLedgerSettled: true }
            : {}),
        }
      : null;

  return {
    messages: compactedMessages,
    stats,
    degradedEvent:
      stats.degraded === true
        ? {
            reason: stats.degradedReason || "semantic-summary-degraded",
            summaryMode: stats.summaryMode || "extractive-fallback",
            stats,
          }
        : null,
    usageEvent: usage
      ? {
          provider: stats.summaryProvider || provider,
          model: stats.summaryModel || model,
          usage,
          source: "semantic-compaction",
          ...(stats.summaryCallId ? { callId: stats.summaryCallId } : {}),
          ...(stats.summaryUsageLedgerSettled === true
            ? { usageLedgerSettled: true }
            : {}),
        }
      : null,
    usageUnknownEvent,
  };
}
