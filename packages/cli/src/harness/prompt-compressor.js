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

    const originalTokens = estimateMessagesTokens(messages);
    let result = [...messages];
    const applied = [];

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

    if (result.length > this.maxMessages) {
      result = this._truncate(result);
      applied.push("truncate");
    }

    const currentTokens = estimateMessagesTokens(result);
    if (this.llmQuery && currentTokens > this.maxTokens && result.length > 4) {
      try {
        result = await this._summarize(result);
        applied.push("summarize");
      } catch (_err) {
        // Summarization failed — continue with what we have
      }
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

    const seen = new Map();
    const deduped = [];

    for (const msg of rest) {
      const content = getContent(msg);
      const hash = createHash("md5").update(content).digest("hex");

      if (seen.has(hash)) continue;

      let isDup = false;
      for (const [, existing] of seen) {
        if (
          jaccardSimilarity(content, getContent(existing)) >=
          this.similarityThreshold
        ) {
          isDup = true;
          break;
        }
      }

      if (!isDup) {
        seen.set(hash, msg);
        deduped.push(msg);
      }
    }

    const result = [...system, ...deduped];
    if (last && !result.includes(last)) result.push(last);
    return result;
  }

  _truncate(messages) {
    const system = messages.filter((m) => m.role === "system");
    const last = [...messages].reverse().find((m) => m.role === "user");
    const rest = messages.filter((m) => m.role !== "system" && m !== last);

    let slots = this.maxMessages - system.length;
    if (last) slots -= 1;

    const recent = rest.slice(-Math.max(slots, 1));
    const result = [...system, ...recent];
    if (last && !result.includes(last)) result.push(last);
    return result;
  }

  async _summarize(messages) {
    const system = messages.filter((m) => m.role === "system");
    const last = [...messages].reverse().find((m) => m.role === "user");
    const toSummarize = messages.filter(
      (m) => m.role !== "system" && m !== last,
    );

    if (toSummarize.length < 3) return messages;

    const historyText = toSummarize
      .map((m) => `${m.role}: ${getContent(m).slice(0, 500)}`)
      .join("\n");

    const summary = await this.llmQuery(
      `Summarize this conversation history concisely, preserving key facts and decisions:\n\n${historyText}\n\nSummary:`,
    );

    if (!summary) return messages;

    const result = [
      ...system,
      { role: "system", content: `[Conversation Summary]\n${summary}` },
    ];
    if (last) result.push(last);
    return result;
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

          result.push({
            role: "system",
            content: `[Collapsed ${toolGroup.length} tool messages: ${uniqueTools.join(", ")}]`,
          });
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
