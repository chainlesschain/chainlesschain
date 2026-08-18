/**
 * CLI Prompt Compressor — 5 strategies for context window management.
 *
 * Strategies:
 *   1. deduplication  — Remove duplicate/similar messages (Jaccard similarity)
 *   2. truncation     — Keep most recent N messages
 *   3. summarization  — LLM-generated summary of old history
 *   4. snipCompact    — Remove stale tool results and processed markers
 *   5. contextCollapse — Fold consecutive same-type messages into summaries
 */

import { createHash } from "node:crypto";
import { feature, featureVariant } from "../lib/feature-flags.js";
import { isAbortError } from "../lib/abort-utils.js";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  getDurableSystemMessageProvenance,
  markDurableSystemMessage,
} from "../lib/session-message-provenance.js";
import {
  buildExtractiveHandoff,
  formatStructuredHandoff,
  parseStructuredHandoff,
  StructuredHandoffValidationError,
  STRUCTURED_HANDOFF_FIELDS,
} from "./structured-handoff.js";

export * from "./structured-handoff.js";

// Bounds for the fuzzy near-dup pass in _deduplicate (see there). Generous
// enough that real near-dups are still caught; small enough that compaction of
// a long, tool-heavy history stays sub-second instead of O(n²·content).
const DEDUP_JACCARD_MAX_CHARS = 4000;
const DEDUP_FUZZY_WINDOW = 100;
const SUMMARY_CALL_ID_MAX_CHARS = 128;
export const SUMMARY_INPUT_DEFAULT_MAX_CHARS = 24000;
export const SUMMARY_INPUT_HARD_MAX_CHARS = 32000;
const SUMMARY_INPUT_MIN_CHARS = 1024;

function isCompactionArtifact(message) {
  const kind = getDurableSystemMessageProvenance(message)?.kind;
  return (
    kind === DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY ||
    kind === DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_TOOL_COLLAPSE
  );
}

function boundedPositiveInteger(value, fallback, minimum, maximum) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.max(number, minimum), maximum);
}

function summaryEntry(message, index) {
  const role = typeof message?.role === "string" ? message.role : "unknown";
  return `[${index}] ${role}: ${getContent(message)
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 2000)}`;
}

/** Keep the earliest user objective plus as much recent context as fits. */
function buildBoundedHistory(messages, maxChars) {
  const entries = messages
    .map((message, index) => ({
      index,
      role: message?.role,
      text: summaryEntry(message, index),
    }))
    .filter((entry) => entry.text.trim());
  const all = entries.map((entry) => entry.text).join("\n");
  if (all.length <= maxChars) return all;

  const firstUser = entries.find((entry) => entry.role === "user");
  const selected = new Map();
  let remaining = maxChars;
  if (firstUser && remaining > 0) {
    const objectiveBudget = Math.min(
      firstUser.text.length,
      Math.max(1, Math.floor(maxChars / 3)),
    );
    selected.set(firstUser.index, firstUser.text.slice(0, objectiveBudget));
    remaining -= objectiveBudget;
  }

  for (let index = entries.length - 1; index >= 0 && remaining > 0; index--) {
    const entry = entries[index];
    if (selected.has(entry.index)) continue;
    const separator = selected.size > 0 ? 1 : 0;
    if (remaining <= separator) break;
    const text = entry.text.slice(0, remaining - separator);
    if (!text) break;
    selected.set(entry.index, text);
    remaining -= text.length + separator;
  }

  return [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text)
    .join("\n")
    .slice(0, maxChars);
}

function summaryPrompt(messages, maxChars) {
  const schema = `{${STRUCTURED_HANDOFF_FIELDS.map((field) => `"${field}"`).join(",")}}`;
  const instructions = [
    "Create a durable conversation handoff from the history below.",
    `Return exactly one strict JSON object with all keys in this order: ${schema}.`,
    '"objective" must be a string; every other value must be an array of strings.',
    "Preserve constraints, exact file paths, test evidence, unresolved external side effects, blockers, and actionable next steps. Do not use Markdown.",
    "Conversation history:",
  ].join("\n");
  const historyBudget = Math.max(0, maxChars - instructions.length - 1);
  const history = buildBoundedHistory(messages, historyBudget);
  return `${instructions}\n${history}`.slice(0, maxChars);
}

function boundedFailureMessage(error) {
  const message =
    error instanceof Error ? error.message : String(error || "unknown error");
  return message
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 240);
}

function safeSummaryCallId(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > SUMMARY_CALL_ID_MAX_CHARS ||
    /\p{Cc}/u.test(value)
  ) {
    return null;
  }
  return value.trim();
}

function summaryUsageCount(usage, canonical, alias, { required = false } = {}) {
  const hasCanonical = Object.hasOwn(usage, canonical);
  const hasAlias = Object.hasOwn(usage, alias);
  if (!hasCanonical && !hasAlias) return required ? null : 0;
  if (hasCanonical && hasAlias && usage[canonical] !== usage[alias]) {
    return null;
  }
  const value = hasCanonical ? usage[canonical] : usage[alias];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

export function estimateMessagesTokens(messages) {
  return messages.reduce((sum, msg) => {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content || "");
    return sum + estimateTokens(content);
  }, 0);
}

function jaccardSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;
  const tokens1 = new Set(str1.split(""));
  const tokens2 = new Set(str2.split(""));
  let intersection = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) intersection++;
  }
  return intersection / (tokens1.size + tokens2.size - intersection);
}

function getContent(msg) {
  return typeof msg.content === "string"
    ? msg.content
    : JSON.stringify(msg.content || "");
}

export const CONTEXT_WINDOWS = {
  "qwen2.5:7b": 32768,
  "qwen2.5:14b": 32768,
  "qwen2.5-coder:14b": 32768,
  "qwen2:7b": 32768,
  "llama3:8b": 8192,
  "mistral:7b": 32768,
  "codellama:7b": 16384,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-3.5-turbo": 16385,
  o1: 200000,
  "claude-opus-4-6": 200000,
  "claude-sonnet-4-6": 200000,
  "claude-haiku-4-5-20251001": 200000,
  "deepseek-chat": 64000,
  "deepseek-coder": 64000,
  "deepseek-reasoner": 64000,
  "qwen-turbo": 131072,
  "qwen-plus": 131072,
  "qwen-max": 32768,
  "gemini-2.0-flash": 1048576,
  "gemini-2.0-pro": 1048576,
  "gemini-1.5-flash": 1048576,
  "moonshot-v1-auto": 131072,
  "moonshot-v1-8k": 8192,
  "moonshot-v1-32k": 32768,
  "moonshot-v1-128k": 131072,
  "doubao-seed-1-6-251015": 32768,
  "doubao-seed-2-1-pro-260628": 32768,
  _provider_defaults: {
    ollama: 32768,
    openai: 128000,
    anthropic: 200000,
    deepseek: 64000,
    dashscope: 131072,
    gemini: 1048576,
    kimi: 131072,
    volcengine: 32768,
    minimax: 32768,
    mistral: 32768,
  },
};

export function getContextWindow(model, provider) {
  if (model && CONTEXT_WINDOWS[model]) {
    return CONTEXT_WINDOWS[model];
  }
  if (provider && CONTEXT_WINDOWS._provider_defaults[provider]) {
    return CONTEXT_WINDOWS._provider_defaults[provider];
  }
  return 32768;
}

export const COMPRESSION_VARIANTS = {
  aggressive: { tokenFactor: 0.4, messageFactor: 0.7 },
  balanced: { tokenFactor: 0.6, messageFactor: 1.0 },
  relaxed: { tokenFactor: 0.75, messageFactor: 1.3 },
};

export function getCompressionVariant() {
  if (!feature("COMPRESSION_AB")) return null;
  const variant = featureVariant("COMPRESSION_AB") || "balanced";
  return {
    variant,
    ...(COMPRESSION_VARIANTS[variant] || COMPRESSION_VARIANTS.balanced),
  };
}

export function adaptiveThresholds(contextWindow) {
  const abVariant = getCompressionVariant();
  const tokenFactor = abVariant ? abVariant.tokenFactor : 0.6;

  const maxTokens = Math.floor(contextWindow * tokenFactor);
  let maxMessages = Math.min(
    50,
    Math.max(15, Math.floor(10 + Math.log2(contextWindow / 1024) * 5)),
  );

  if (abVariant) {
    maxMessages = Math.min(
      50,
      Math.max(15, Math.round(maxMessages * abVariant.messageFactor)),
    );
  }

  const aggressive = contextWindow < 32768;

  const result = { maxMessages, maxTokens, aggressive };
  if (abVariant) result.variant = abVariant.variant;
  return result;
}

/**
 * Repair tool-call/tool-result pairing after lossy compaction.
 *
 * Strict chat APIs reject a `tool` message whose `tool_call_id` has no
 * preceding assistant `tool_calls`, and (for Anthropic) an assistant
 * `tool_calls` with no following result. Count-based truncation / per-message
 * snipping can orphan either side. This pass drops assistant tool_calls that
 * lost their result, then drops tool results whose call was removed — leaving a
 * sequence every provider will accept. Assistant messages whose calls are all
 * orphaned are kept as plain text (if any) or dropped.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>} a new, balanced array
 */
export function sanitizeToolPairs(messages) {
  if (!Array.isArray(messages)) return messages;

  const resultIds = new Set(
    messages
      .filter((m) => m && m.role === "tool" && m.tool_call_id)
      .map((m) => m.tool_call_id),
  );

  // Pass 1 — drop assistant tool_calls that have no matching tool result.
  const stage1 = [];
  for (const m of messages) {
    if (
      m &&
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length
    ) {
      const kept = m.tool_calls.filter((tc) => tc && resultIds.has(tc.id));
      if (kept.length === m.tool_calls.length) {
        stage1.push(m);
      } else if (kept.length > 0) {
        stage1.push({ ...m, tool_calls: kept });
      } else {
        // No surviving calls: keep the assistant text if any, else drop it.
        const rest = { ...m };
        delete rest.tool_calls;
        if (rest.content && String(rest.content).trim()) stage1.push(rest);
      }
    } else {
      stage1.push(m);
    }
  }

  // Pass 2 — drop tool results whose call was removed in pass 1.
  const survivingCallIds = new Set(
    stage1
      .filter((m) => m && m.role === "assistant" && Array.isArray(m.tool_calls))
      .flatMap((m) => m.tool_calls.map((tc) => tc.id)),
  );
  return stage1.filter(
    (m) =>
      !(
        m &&
        m.role === "tool" &&
        m.tool_call_id &&
        !survivingCallIds.has(m.tool_call_id)
      ),
  );
}

export class PromptCompressor {
  constructor(options = {}) {
    if (
      (options.model || options.provider) &&
      !options.maxMessages &&
      !options.maxTokens
    ) {
      const ctxWindow = getContextWindow(options.model, options.provider);
      const adaptive = adaptiveThresholds(ctxWindow);
      this.maxMessages = adaptive.maxMessages;
      this.maxTokens = adaptive.maxTokens;
      this._adaptive = true;
      this._contextWindow = ctxWindow;
    } else {
      this.maxMessages = options.maxMessages || 20;
      this.maxTokens = options.maxTokens || 8000;
      this._adaptive = false;
      this._contextWindow = null;
    }
    this.similarityThreshold = options.similarityThreshold || 0.9;
    this.llmQuery = options.llmQuery || null;
    this.summaryInputMaxChars = boundedPositiveInteger(
      options.summaryInputMaxChars,
      SUMMARY_INPUT_DEFAULT_MAX_CHARS,
      SUMMARY_INPUT_MIN_CHARS,
      SUMMARY_INPUT_HARD_MAX_CHARS,
    );
  }

  adaptToModel(model, provider) {
    const ctxWindow = getContextWindow(model, provider);
    const adaptive = adaptiveThresholds(ctxWindow);
    this.maxMessages = adaptive.maxMessages;
    this.maxTokens = adaptive.maxTokens;
    this._adaptive = true;
    this._contextWindow = ctxWindow;
  }

  async compress(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length <= 2) {
      return {
        messages: Array.isArray(messages) ? [...messages] : [],
        stats: { strategy: "none", saved: 0 },
      };
    }

    // Pinned facts — a DETERMINISTIC fact-retention guarantee. A message marked
    // `pinned:true` (or matched by an `options.isPinned` predicate) MUST survive
    // compaction verbatim regardless of any strategy or the non-deterministic LLM
    // summary. Every other retention here is positional (system / recent-N / last
    // user) or summary-dependent, so an important fact that scrolls out of the
    // recent window would otherwise survive only if the summary happens to keep
    // it. We pull pins out BEFORE any strategy runs (so nothing can drop them),
    // then re-insert them as a sticky block right after the system messages.
    const isPinned =
      typeof options.isPinned === "function"
        ? options.isPinned
        : (m) => m && (m.pinned === true || m._pin === true);
    const pinned = messages.filter((m) => isPinned(m));
    const working = pinned.length
      ? messages.filter((m) => !isPinned(m))
      : messages;

    const originalTokens = estimateMessagesTokens(messages);
    let result = [...working];
    const applied = [];
    let summaryStats = null;

    if (feature("CONTEXT_SNIP")) {
      const before = result.length;
      result = this._snipCompact(result);
      if (result.length < before) applied.push("snip");
    }

    if (result.length > 3) {
      const before = result.length;
      result = this._deduplicate(result);
      if (result.length < before) applied.push("dedup");
    }

    if (feature("CONTEXT_COLLAPSE") && result.length > 6) {
      const before = result.length;
      result = this._contextCollapse(result);
      if (result.length < before) applied.push("collapse");
    }

    // Semantic handoff must run BEFORE destructive count-based truncation;
    // otherwise long conversations commonly fall under maxTokens only because
    // the facts we needed to summarize were already discarded.
    const currentTokens = estimateMessagesTokens(result);
    if (
      this.llmQuery &&
      (currentTokens > this.maxTokens || result.length > this.maxMessages) &&
      result.length > 4
    ) {
      const summarized = await this._summarize(result);
      result = summarized.messages;
      summaryStats = summarized.stats;
      if (summaryStats.summaryMode !== "none") {
        applied.push("summarize");
      }
    }

    if (result.length > this.maxMessages) {
      result = this._truncate(result);
      applied.push("truncate");
    }

    // Re-insert pinned facts verbatim (order preserved) right after the leading
    // system messages, so they end up as a sticky facts block at the top.
    if (pinned.length) {
      const sys = result.filter((m) => m.role === "system");
      const nonSys = result.filter((m) => m.role !== "system");
      result = [...sys, ...pinned, ...nonSys];
      applied.push("pinned");
    }

    // Tool-pair repair (opt-in) — callers compacting tool-laden histories
    // (e.g. the headless agent loop) pass this so truncation/snip never leaves
    // an orphaned tool result or unanswered tool_call for a strict API.
    if (options.preserveToolPairs) {
      result = sanitizeToolPairs(result);
    }

    const compressedTokens = estimateMessagesTokens(result);
    const stats = {
      strategy: applied.join("+") || "none",
      originalMessages: messages.length,
      compressedMessages: result.length,
      originalTokens,
      compressedTokens,
      saved: originalTokens - compressedTokens,
      ratio: originalTokens > 0 ? compressedTokens / originalTokens : 1,
      ...(summaryStats || {}),
    };

    const abVariant = getCompressionVariant();
    if (abVariant) {
      stats.abVariant = abVariant.variant;
    }

    return { messages: result, stats };
  }

  shouldAutoCompact(messages) {
    return (
      messages.length > this.maxMessages ||
      estimateMessagesTokens(messages) > this.maxTokens
    );
  }

  _deduplicate(messages) {
    const system = messages.filter((m) => m.role === "system");
    const last = [...messages].reverse().find((m) => m.role === "user");
    const rest = messages.filter((m) => m.role !== "system" && m !== last);

    // Bound the fuzzy pass so it stays usable on the very conversations
    // compaction targets (long + tool-heavy). The naive version compared every
    // message against EVERY prior one (O(n²)) and ran jaccard over full content
    // (O(content) per compare) — 300 msgs × ~8 KB tool results blocked ~3.4 s.
    //  • Exact dedup (the md5 hash set) still covers ALL messages.
    //  • The fuzzy near-dup compare uses a capped prefix (char-set jaccard is
    //    alphabet-bounded, so a prefix barely changes the decision) and only the
    //    most-recent kept entries (near-dups cluster; this can only UNDER-dedup,
    //    never drop a genuinely-distinct message).
    const seen = new Map();
    const deduped = [];
    const recent = []; // rolling window of recent kept {capped} contents

    for (const msg of rest) {
      const content = getContent(msg);
      const hash = createHash("md5").update(content).digest("hex");

      if (seen.has(hash)) continue;

      const capped =
        content.length > DEDUP_JACCARD_MAX_CHARS
          ? content.slice(0, DEDUP_JACCARD_MAX_CHARS)
          : content;
      let isDup = false;
      for (const prev of recent) {
        if (jaccardSimilarity(capped, prev) >= this.similarityThreshold) {
          isDup = true;
          break;
        }
      }

      if (!isDup) {
        seen.set(hash, msg);
        deduped.push(msg);
        recent.push(capped);
        if (recent.length > DEDUP_FUZZY_WINDOW) recent.shift();
      }
    }

    const result = [...system, ...deduped];
    if (last && !result.includes(last)) result.push(last);
    return result;
  }

  _truncate(messages) {
    const system = messages.filter(
      (m) => m.role === "system" && !isCompactionArtifact(m),
    );
    const last = [...messages].reverse().find((m) => m.role === "user");
    const rest = messages.filter(
      (m) => (m.role !== "system" || isCompactionArtifact(m)) && m !== last,
    );

    let slots = this.maxMessages - system.length;
    if (last) slots -= 1;

    const recent = rest.slice(-Math.max(slots, 1));
    const result = [...system, ...recent];
    if (last && !result.includes(last)) result.push(last);
    return result;
  }

  async _summarize(messages) {
    // Compaction summaries and collapsed tool groups are derived history, not
    // immutable host instructions. Fold them into the next summary so a long
    // session cannot retain one additional durable system message per cycle.
    const system = messages.filter(
      (m) => m.role === "system" && !isCompactionArtifact(m),
    );
    const last = [...messages].reverse().find((m) => m.role === "user");
    const toSummarize = messages.filter(
      (m) => (m.role !== "system" || isCompactionArtifact(m)) && m !== last,
    );

    if (toSummarize.length < 3) {
      return {
        messages,
        stats: {
          summaryMode: "none",
          degraded: false,
          degradedReason: null,
          summaryInputChars: 0,
          summaryInputLimit: this.summaryInputMaxChars,
        },
      };
    }

    const prompt = summaryPrompt(toSummarize, this.summaryInputMaxChars);
    let summary;
    let summaryMode = "llm-structured";
    let degraded = false;
    let degradedReason = null;
    let rawSummary;
    let summaryUsage = null;
    let summaryUsageUnknown = false;
    let summaryUsageUnknownReason = null;
    let summaryProvider = null;
    let summaryModel = null;
    let summaryCallId = null;
    let summaryUsageLedgerSettled = false;
    try {
      const queryResult = await this.llmQuery(prompt);
      if (
        queryResult &&
        typeof queryResult === "object" &&
        !Array.isArray(queryResult)
      ) {
        summaryCallId = safeSummaryCallId(queryResult.callId);
        summaryUsageLedgerSettled = queryResult.usageLedgerSettled === true;
      }
      if (
        queryResult &&
        typeof queryResult === "object" &&
        Object.prototype.hasOwnProperty.call(queryResult, "summary")
      ) {
        rawSummary = queryResult.summary;
        const usage = queryResult.usage;
        const inputTokens = usage
          ? summaryUsageCount(usage, "input_tokens", "prompt_tokens", {
              required: true,
            })
          : null;
        const outputTokens = usage
          ? summaryUsageCount(usage, "output_tokens", "completion_tokens", {
              required: true,
            })
          : null;
        const cacheReadTokens = usage
          ? summaryUsageCount(
              usage,
              "cache_read_input_tokens",
              "cache_read_tokens",
            )
          : null;
        const cacheCreationTokens = usage
          ? summaryUsageCount(
              usage,
              "cache_creation_input_tokens",
              "cache_creation_tokens",
            )
          : null;
        if (
          usage &&
          typeof usage === "object" &&
          !Array.isArray(usage) &&
          Number.isSafeInteger(inputTokens) &&
          inputTokens >= 0 &&
          Number.isSafeInteger(outputTokens) &&
          outputTokens >= 0 &&
          cacheReadTokens != null &&
          cacheCreationTokens != null
        ) {
          summaryUsage = {
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
          };
        } else if (queryResult.usageOutcome !== "not-billable") {
          // Standard provider adapters return an explicit `usage` field. A
          // successful response without it is still a paid call whose amount
          // is unknown; never let a hard budget silently count it as zero.
          summaryUsageUnknown = true;
          summaryUsageUnknownReason = "provider_usage_not_reported";
        }
        summaryProvider = queryResult.provider || null;
        summaryModel = queryResult.model || null;
      } else {
        rawSummary = queryResult;
      }
    } catch (error) {
      // Cancellation is authoritative. Treating AbortError as an ordinary
      // provider failure would manufacture an extractive summary after Stop and
      // let callers apply/persist it even though the operation was cancelled.
      if (isAbortError(error)) throw error;
      // A durable-ledger write failure is authoritative too. Falling back here
      // would let the host continue after losing the model-call boundary.
      if (error?.runtimeLedgerPersistence === true) throw error;
      // A workflow-bound query may already have reached the provider. An
      // extractive fallback would make the outer durable effect look completed
      // and authorize a replay of that physically unknown request.
      if (error?.workflowEffectOutcomeUnknown === true) throw error;
      summaryCallId = safeSummaryCallId(
        error?.compactionCallId ?? error?.callId,
      );
      summaryUsageLedgerSettled = error?.usageLedgerSettled === true;
      degraded = true;
      summaryMode = "extractive-fallback";
      degradedReason = `llm_query_failed:${boundedFailureMessage(error)}`;
      // A transport exception does not prove that the provider rejected the
      // request before billing it. Keep that uncertainty explicit so a hard
      // budget can latch instead of silently accounting the call as $0.
      summaryUsageUnknown = true;
      summaryUsageUnknownReason = "provider_transport_outcome_unknown";
    }
    if (!degraded) {
      try {
        summary = parseStructuredHandoff(rawSummary);
      } catch (error) {
        degraded = true;
        summaryMode = "extractive-fallback";
        degradedReason =
          error instanceof StructuredHandoffValidationError
            ? `invalid_llm_summary:${error.code}`
            : `invalid_llm_summary:normalization_error:${boundedFailureMessage(error)}`;
      }
    }
    if (degraded) {
      summary = buildExtractiveHandoff(toSummarize, {
        maxFallbackSourceChars: Math.min(
          this.summaryInputMaxChars,
          SUMMARY_INPUT_DEFAULT_MAX_CHARS,
        ),
      });
    }

    const result = [
      ...system,
      markDurableSystemMessage(
        {
          role: "system",
          content: `[Conversation Summary]\n${formatStructuredHandoff(summary)}`,
        },
        DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
      ),
    ];
    if (last) result.push(last);
    return {
      messages: result,
      stats: {
        summaryMode,
        degraded,
        degradedReason,
        summaryInputChars: prompt.length,
        summaryInputLimit: this.summaryInputMaxChars,
        ...(summaryUsage ? { summaryUsage } : {}),
        ...(summaryUsageUnknown
          ? {
              summaryUsageUnknown: true,
              summaryUsageUnknownReason,
            }
          : {}),
        ...(summaryProvider ? { summaryProvider } : {}),
        ...(summaryModel ? { summaryModel } : {}),
        ...(summaryCallId ? { summaryCallId } : {}),
        ...(summaryUsageLedgerSettled
          ? { summaryUsageLedgerSettled: true }
          : {}),
      },
    };
  }

  _snipCompact(messages) {
    if (messages.length <= 4) return messages;

    const head = messages.slice(0, 1);
    const middle = messages.slice(1, -4);
    const tail = messages.slice(-4);

    const snipped = middle.filter((msg) => {
      const content = getContent(msg);

      if (!content || content.trim() === "") return false;
      if (content.includes("[PROCESSED]") || content.includes("[STALE]")) {
        return false;
      }

      if (msg.role === "tool") {
        if (
          content === "ok" ||
          content === "{}" ||
          content === "null" ||
          content.length < 3
        ) {
          return false;
        }
      }

      if (msg.role === "assistant" && content.length < 10) return false;
      return true;
    });

    return [...head, ...snipped, ...tail];
  }

  _contextCollapse(messages) {
    if (messages.length <= 6) return messages;

    const result = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];

      if (
        i > 0 &&
        i < messages.length - 3 &&
        msg.role === "assistant" &&
        msg.tool_calls &&
        msg.tool_calls.length > 0
      ) {
        const toolGroup = [msg];
        let j = i + 1;
        while (j < messages.length - 3 && messages[j].role === "tool") {
          toolGroup.push(messages[j]);
          j++;
        }

        while (
          j < messages.length - 3 &&
          messages[j].role === "assistant" &&
          messages[j].tool_calls
        ) {
          toolGroup.push(messages[j]);
          j++;
          while (j < messages.length - 3 && messages[j].role === "tool") {
            toolGroup.push(messages[j]);
            j++;
          }
        }

        if (toolGroup.length >= 3) {
          const toolNames = toolGroup
            .filter((m) => m.tool_calls)
            .flatMap((m) =>
              m.tool_calls.map((tc) => tc.function?.name || "tool"),
            )
            .filter(Boolean);
          const uniqueTools = [...new Set(toolNames)];

          result.push(
            markDurableSystemMessage(
              {
                role: "system",
                content: `[Collapsed ${toolGroup.length} tool messages: ${uniqueTools.join(", ")}]`,
              },
              DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_TOOL_COLLAPSE,
            ),
          );
          i = j;
          continue;
        }
      }

      result.push(msg);
      i++;
    }

    return result;
  }
}

// =====================================================================
// Prompt Compressor V2 governance overlay
// =====================================================================
export const PCOMP_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const PCOMP_RUN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  COMPRESSING: "compressing",
  COMPRESSED: "compressed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _pcompPTrans = new Map([
  [
    PCOMP_PROFILE_MATURITY_V2.PENDING,
    new Set([
      PCOMP_PROFILE_MATURITY_V2.ACTIVE,
      PCOMP_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PCOMP_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      PCOMP_PROFILE_MATURITY_V2.STALE,
      PCOMP_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    PCOMP_PROFILE_MATURITY_V2.STALE,
    new Set([
      PCOMP_PROFILE_MATURITY_V2.ACTIVE,
      PCOMP_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [PCOMP_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _pcompPTerminal = new Set([PCOMP_PROFILE_MATURITY_V2.ARCHIVED]);
const _pcompRTrans = new Map([
  [
    PCOMP_RUN_LIFECYCLE_V2.QUEUED,
    new Set([
      PCOMP_RUN_LIFECYCLE_V2.COMPRESSING,
      PCOMP_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    PCOMP_RUN_LIFECYCLE_V2.COMPRESSING,
    new Set([
      PCOMP_RUN_LIFECYCLE_V2.COMPRESSED,
      PCOMP_RUN_LIFECYCLE_V2.FAILED,
      PCOMP_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [PCOMP_RUN_LIFECYCLE_V2.COMPRESSED, new Set()],
  [PCOMP_RUN_LIFECYCLE_V2.FAILED, new Set()],
  [PCOMP_RUN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _pcompPsV2 = new Map();
const _pcompRsV2 = new Map();
let _pcompMaxActive = 8,
  _pcompMaxPending = 20,
  _pcompIdleMs = 30 * 24 * 60 * 60 * 1000,
  _pcompStuckMs = 60 * 1000;
function _pcompPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _pcompCheckP(from, to) {
  const a = _pcompPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pcomp profile transition ${from} → ${to}`);
}
function _pcompCheckR(from, to) {
  const a = _pcompRTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid pcomp run transition ${from} → ${to}`);
}
function _pcompCountActive(owner) {
  let c = 0;
  for (const p of _pcompPsV2.values())
    if (p.owner === owner && p.status === PCOMP_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _pcompCountPending(profileId) {
  let c = 0;
  for (const r of _pcompRsV2.values())
    if (
      r.profileId === profileId &&
      (r.status === PCOMP_RUN_LIFECYCLE_V2.QUEUED ||
        r.status === PCOMP_RUN_LIFECYCLE_V2.COMPRESSING)
    )
      c++;
  return c;
}
export function setMaxActivePcompProfilesPerOwnerV2(n) {
  _pcompMaxActive = _pcompPos(n, "maxActivePcompProfilesPerOwner");
}
export function getMaxActivePcompProfilesPerOwnerV2() {
  return _pcompMaxActive;
}
export function setMaxPendingPcompRunsPerProfileV2(n) {
  _pcompMaxPending = _pcompPos(n, "maxPendingPcompRunsPerProfile");
}
export function getMaxPendingPcompRunsPerProfileV2() {
  return _pcompMaxPending;
}
export function setPcompProfileIdleMsV2(n) {
  _pcompIdleMs = _pcompPos(n, "pcompProfileIdleMs");
}
export function getPcompProfileIdleMsV2() {
  return _pcompIdleMs;
}
export function setPcompRunStuckMsV2(n) {
  _pcompStuckMs = _pcompPos(n, "pcompRunStuckMs");
}
export function getPcompRunStuckMsV2() {
  return _pcompStuckMs;
}
export function _resetStatePromptCompressorV2() {
  _pcompPsV2.clear();
  _pcompRsV2.clear();
  _pcompMaxActive = 8;
  _pcompMaxPending = 20;
  _pcompIdleMs = 30 * 24 * 60 * 60 * 1000;
  _pcompStuckMs = 60 * 1000;
}
export function registerPcompProfileV2({ id, owner, variant, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_pcompPsV2.has(id)) throw new Error(`pcomp profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    variant: variant || "default",
    status: PCOMP_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pcompPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePcompProfileV2(id) {
  const p = _pcompPsV2.get(id);
  if (!p) throw new Error(`pcomp profile ${id} not found`);
  const isInitial = p.status === PCOMP_PROFILE_MATURITY_V2.PENDING;
  _pcompCheckP(p.status, PCOMP_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _pcompCountActive(p.owner) >= _pcompMaxActive)
    throw new Error(`max active pcomp profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = PCOMP_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function stalePcompProfileV2(id) {
  const p = _pcompPsV2.get(id);
  if (!p) throw new Error(`pcomp profile ${id} not found`);
  _pcompCheckP(p.status, PCOMP_PROFILE_MATURITY_V2.STALE);
  p.status = PCOMP_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePcompProfileV2(id) {
  const p = _pcompPsV2.get(id);
  if (!p) throw new Error(`pcomp profile ${id} not found`);
  _pcompCheckP(p.status, PCOMP_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = PCOMP_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPcompProfileV2(id) {
  const p = _pcompPsV2.get(id);
  if (!p) throw new Error(`pcomp profile ${id} not found`);
  if (_pcompPTerminal.has(p.status))
    throw new Error(`cannot touch terminal pcomp profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPcompProfileV2(id) {
  const p = _pcompPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPcompProfilesV2() {
  return [..._pcompPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPcompRunV2({ id, profileId, input, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_pcompRsV2.has(id)) throw new Error(`pcomp run ${id} already exists`);
  if (!_pcompPsV2.has(profileId))
    throw new Error(`pcomp profile ${profileId} not found`);
  if (_pcompCountPending(profileId) >= _pcompMaxPending)
    throw new Error(`max pending pcomp runs for profile ${profileId} reached`);
  const now = Date.now();
  const r = {
    id,
    profileId,
    input: input || "",
    status: PCOMP_RUN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _pcompRsV2.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
export function compressingPcompRunV2(id) {
  const r = _pcompRsV2.get(id);
  if (!r) throw new Error(`pcomp run ${id} not found`);
  _pcompCheckR(r.status, PCOMP_RUN_LIFECYCLE_V2.COMPRESSING);
  const now = Date.now();
  r.status = PCOMP_RUN_LIFECYCLE_V2.COMPRESSING;
  r.updatedAt = now;
  if (!r.startedAt) r.startedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function compressPcompRunV2(id) {
  const r = _pcompRsV2.get(id);
  if (!r) throw new Error(`pcomp run ${id} not found`);
  _pcompCheckR(r.status, PCOMP_RUN_LIFECYCLE_V2.COMPRESSED);
  const now = Date.now();
  r.status = PCOMP_RUN_LIFECYCLE_V2.COMPRESSED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function failPcompRunV2(id, reason) {
  const r = _pcompRsV2.get(id);
  if (!r) throw new Error(`pcomp run ${id} not found`);
  _pcompCheckR(r.status, PCOMP_RUN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  r.status = PCOMP_RUN_LIFECYCLE_V2.FAILED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.failReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function cancelPcompRunV2(id, reason) {
  const r = _pcompRsV2.get(id);
  if (!r) throw new Error(`pcomp run ${id} not found`);
  _pcompCheckR(r.status, PCOMP_RUN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  r.status = PCOMP_RUN_LIFECYCLE_V2.CANCELLED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.cancelReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function getPcompRunV2(id) {
  const r = _pcompRsV2.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listPcompRunsV2() {
  return [..._pcompRsV2.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}
export function autoStaleIdlePcompProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _pcompPsV2.values())
    if (
      p.status === PCOMP_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _pcompIdleMs
    ) {
      p.status = PCOMP_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPcompRunsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _pcompRsV2.values())
    if (
      r.status === PCOMP_RUN_LIFECYCLE_V2.COMPRESSING &&
      r.startedAt != null &&
      t - r.startedAt >= _pcompStuckMs
    ) {
      r.status = PCOMP_RUN_LIFECYCLE_V2.FAILED;
      r.updatedAt = t;
      if (!r.settledAt) r.settledAt = t;
      r.metadata.failReason = "auto-fail-stuck";
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}
export function getPromptCompressorGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PCOMP_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _pcompPsV2.values()) profilesByStatus[p.status]++;
  const runsByStatus = {};
  for (const v of Object.values(PCOMP_RUN_LIFECYCLE_V2)) runsByStatus[v] = 0;
  for (const r of _pcompRsV2.values()) runsByStatus[r.status]++;
  return {
    totalPcompProfilesV2: _pcompPsV2.size,
    totalPcompRunsV2: _pcompRsV2.size,
    maxActivePcompProfilesPerOwner: _pcompMaxActive,
    maxPendingPcompRunsPerProfile: _pcompMaxPending,
    pcompProfileIdleMs: _pcompIdleMs,
    pcompRunStuckMs: _pcompStuckMs,
    profilesByStatus,
    runsByStatus,
  };
}
