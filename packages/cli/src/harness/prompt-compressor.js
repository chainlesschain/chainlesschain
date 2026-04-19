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
