/**
 * Cowork Adapter — bridges CLI's LLM infrastructure to cowork modules.
 *
 * Provides:
 *  - Unified LLM chat function (works with any configured provider)
 *  - Logger shim compatible with desktop modules
 *  - Module initialization helper
 */

import { LLMProviderRegistry, BUILT_IN_PROVIDERS } from "./llm-providers.js";
import { loadConfig } from "./config-manager.js";
import { applyConfigLlmDefaults } from "./llm-config-defaults.js";

function plainUsage(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function normalizeOllamaUsage(data) {
  if (
    !Object.hasOwn(data, "prompt_eval_count") ||
    !Object.hasOwn(data, "eval_count")
  ) {
    return null;
  }
  return {
    input_tokens: data.prompt_eval_count,
    output_tokens: data.eval_count,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

function normalizeAnthropicUsage(value) {
  const usage = plainUsage(value);
  if (!usage) return null;
  // Keep malformed provider fields malformed so the canonical ledger projects
  // the call as unknown instead of manufacturing a known zero settlement.
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: Object.hasOwn(usage, "cache_read_input_tokens")
      ? usage.cache_read_input_tokens
      : 0,
    cache_creation_input_tokens: Object.hasOwn(
      usage,
      "cache_creation_input_tokens",
    )
      ? usage.cache_creation_input_tokens
      : 0,
  };
}

function normalizeOpenAiUsage(value) {
  const usage = plainUsage(value);
  if (!usage) return null;
  // OpenAI/volcengine report cached prompt tokens under the nested detail;
  // DeepSeek reports the same quantity as prompt_cache_hit_tokens. In both
  // cases prompt_tokens includes the cached prefix, so persist only the
  // uncached remainder as input_tokens.
  const detailed = Number(usage.prompt_tokens_details?.cached_tokens);
  const deepseek = Number(usage.prompt_cache_hit_tokens);
  const cached =
    Number.isFinite(detailed) && detailed > 0
      ? detailed
      : Number.isFinite(deepseek) && deepseek > 0
        ? deepseek
        : 0;
  const input =
    typeof usage.prompt_tokens === "number" && typeof cached === "number"
      ? usage.prompt_tokens - cached
      : usage.prompt_tokens;
  return {
    input_tokens: input,
    output_tokens: usage.completion_tokens,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

function chatEnvelope(content, usage = null) {
  return {
    content: typeof content === "string" ? content : "",
    ...(usage ? { usage } : {}),
  };
}

async function invokeChatCall(callWrapper, provider, model, call) {
  if (!callWrapper) return call();
  return callWrapper({ call, provider, model });
}

/**
 * Create a chat completion function that routes through the active LLM provider.
 *
 * Provider precedence: explicit `options.provider` > `LLM_PROVIDER` env >
 * `~/.chainlesschain/config.json` `llm` > ollama. Honoring config.llm here is
 * what makes the cowork/orchestrate commands (which build createChatFn with no
 * provider unless `--provider` is passed) work against a cloud-configured setup
 * instead of silently defaulting to ollama/localhost:11434 and failing with a
 * connection error on machines without a local ollama.
 *
 * @param {object} [options]
 * @param {string} [options.provider] - Provider name override
 * @param {string} [options.model] - Model name override
 * @param {string} [options.baseUrl] - Base URL override
 * @param {string} [options.apiKey] - API key override
 * @param {(request: {call: function, provider: string, model: string}) => Promise<object>} [options.callWrapper]
 *        Optional host boundary around each real provider call. The callback
 *        may invoke `call({ signal })` to bind cancellation and resolves to a
 *        private `{content, usage?}` envelope; callers still receive only the
 *        response string.
 * @returns {(messages: object[], opts?: object) => Promise<string>}
 */
export function createChatFn(options = {}) {
  // Fill provider/model/baseUrl/apiKey from config.llm only when the caller
  // gave no explicit provider AND no LLM_PROVIDER env override (both still win).
  // Fail-open: a config read must never break chat construction.
  const resolved = { ...options };
  if (!resolved.provider && !process.env.LLM_PROVIDER) {
    try {
      applyConfigLlmDefaults(resolved, loadConfig()?.llm || {}, {
        explicitModel: options.model,
      });
    } catch {
      /* fall through to ollama defaults below */
    }
  }
  const provider = resolved.provider || process.env.LLM_PROVIDER || "ollama";
  const providerDef = BUILT_IN_PROVIDERS[provider] || BUILT_IN_PROVIDERS.ollama;
  const model =
    resolved.model || process.env.LLM_MODEL || providerDef.models[0];
  const baseUrl = resolved.baseUrl || providerDef.baseUrl;
  const callWrapper = resolved.callWrapper || null;
  if (callWrapper !== null && typeof callWrapper !== "function") {
    throw new TypeError("cowork callWrapper must be a function");
  }

  return async function chat(messages, opts = {}) {
    const currentModel = opts.model || model;
    const maxTokens = opts.maxTokens || 2048;

    if (provider === "ollama") {
      const envelope = await invokeChatCall(
        callWrapper,
        provider,
        currentModel,
        async ({ signal = opts.signal || resolved.signal } = {}) => {
          const res = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: currentModel,
              messages,
              stream: false,
              options: { num_predict: maxTokens },
            }),
          });
          if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
          const data = await res.json();
          return chatEnvelope(
            data.message?.content,
            normalizeOllamaUsage(data),
          );
        },
      );
      return typeof envelope === "string" ? envelope : envelope?.content || "";
    }

    if (provider === "anthropic") {
      const key = resolved.apiKey || process.env[providerDef.apiKeyEnv];
      if (!key) throw new Error("ANTHROPIC_API_KEY not set");
      // Extract system message if present
      const systemMsgs = messages.filter((m) => m.role === "system");
      const otherMsgs = messages.filter((m) => m.role !== "system");
      const body = {
        model: currentModel,
        max_tokens: maxTokens,
        messages: otherMsgs,
      };
      if (systemMsgs.length > 0) {
        body.system = systemMsgs.map((m) => m.content).join("\n");
      }
      const envelope = await invokeChatCall(
        callWrapper,
        provider,
        currentModel,
        async ({ signal = opts.signal || resolved.signal } = {}) => {
          const res = await fetch(`${baseUrl}/messages`, {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
          const data = await res.json();
          return chatEnvelope(
            data.content?.[0]?.text,
            normalizeAnthropicUsage(data.usage),
          );
        },
      );
      return typeof envelope === "string" ? envelope : envelope?.content || "";
    }

    // OpenAI-compatible (openai, deepseek, dashscope, mistral, gemini)
    const key = resolved.apiKey || process.env[providerDef.apiKeyEnv];
    if (!key) throw new Error(`${providerDef.apiKeyEnv} not set`);

    const envelope = await invokeChatCall(
      callWrapper,
      provider,
      currentModel,
      async ({ signal = opts.signal || resolved.signal } = {}) => {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: currentModel,
            messages,
            max_tokens: maxTokens,
          }),
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        return chatEnvelope(
          data.choices?.[0]?.message?.content,
          normalizeOpenAiUsage(data.usage),
        );
      },
    );
    return typeof envelope === "string" ? envelope : envelope?.content || "";
  };
}

/**
 * Logger shim — compatible with desktop module expectations
 */
export const coworkLogger = {
  info: (...args) => console.log("[cowork]", ...args),
  warn: (...args) => console.warn("[cowork]", ...args),
  error: (...args) => console.error("[cowork]", ...args),
  debug: () => {},
};

// =====================================================================
// cowork-adapter V2 governance overlay (iter27)
// =====================================================================
export const CADPGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const CADPGOV_ADAPT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ADAPTING: "adapting",
  ADAPTED: "adapted",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cadpgovPTrans = new Map([
  [
    CADPGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CADPGOV_PROFILE_MATURITY_V2.ACTIVE,
      CADPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CADPGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CADPGOV_PROFILE_MATURITY_V2.STALE,
      CADPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CADPGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      CADPGOV_PROFILE_MATURITY_V2.ACTIVE,
      CADPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CADPGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cadpgovPTerminal = new Set([CADPGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _cadpgovJTrans = new Map([
  [
    CADPGOV_ADAPT_LIFECYCLE_V2.QUEUED,
    new Set([
      CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTING,
      CADPGOV_ADAPT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTING,
    new Set([
      CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTED,
      CADPGOV_ADAPT_LIFECYCLE_V2.FAILED,
      CADPGOV_ADAPT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTED, new Set()],
  [CADPGOV_ADAPT_LIFECYCLE_V2.FAILED, new Set()],
  [CADPGOV_ADAPT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cadpgovPsV2 = new Map();
const _cadpgovJsV2 = new Map();
let _cadpgovMaxActive = 6,
  _cadpgovMaxPending = 15,
  _cadpgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cadpgovStuckMs = 60 * 1000;
function _cadpgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cadpgovCheckP(from, to) {
  const a = _cadpgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cadpgov profile transition ${from} → ${to}`);
}
function _cadpgovCheckJ(from, to) {
  const a = _cadpgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cadpgov adapt transition ${from} → ${to}`);
}
function _cadpgovCountActive(owner) {
  let c = 0;
  for (const p of _cadpgovPsV2.values())
    if (p.owner === owner && p.status === CADPGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _cadpgovCountPending(profileId) {
  let c = 0;
  for (const j of _cadpgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CADPGOV_ADAPT_LIFECYCLE_V2.QUEUED ||
        j.status === CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTING)
    )
      c++;
  return c;
}
export function setMaxActiveCadpgovProfilesPerOwnerV2(n) {
  _cadpgovMaxActive = _cadpgovPos(n, "maxActiveCadpgovProfilesPerOwner");
}
export function getMaxActiveCadpgovProfilesPerOwnerV2() {
  return _cadpgovMaxActive;
}
export function setMaxPendingCadpgovAdaptsPerProfileV2(n) {
  _cadpgovMaxPending = _cadpgovPos(n, "maxPendingCadpgovAdaptsPerProfile");
}
export function getMaxPendingCadpgovAdaptsPerProfileV2() {
  return _cadpgovMaxPending;
}
export function setCadpgovProfileIdleMsV2(n) {
  _cadpgovIdleMs = _cadpgovPos(n, "cadpgovProfileIdleMs");
}
export function getCadpgovProfileIdleMsV2() {
  return _cadpgovIdleMs;
}
export function setCadpgovAdaptStuckMsV2(n) {
  _cadpgovStuckMs = _cadpgovPos(n, "cadpgovAdaptStuckMs");
}
export function getCadpgovAdaptStuckMsV2() {
  return _cadpgovStuckMs;
}
export function _resetStateCoworkAdapterGovV2() {
  _cadpgovPsV2.clear();
  _cadpgovJsV2.clear();
  _cadpgovMaxActive = 6;
  _cadpgovMaxPending = 15;
  _cadpgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cadpgovStuckMs = 60 * 1000;
}
export function registerCadpgovProfileV2({ id, owner, target, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cadpgovPsV2.has(id))
    throw new Error(`cadpgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    target: target || "default",
    status: CADPGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cadpgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCadpgovProfileV2(id) {
  const p = _cadpgovPsV2.get(id);
  if (!p) throw new Error(`cadpgov profile ${id} not found`);
  const isInitial = p.status === CADPGOV_PROFILE_MATURITY_V2.PENDING;
  _cadpgovCheckP(p.status, CADPGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cadpgovCountActive(p.owner) >= _cadpgovMaxActive)
    throw new Error(`max active cadpgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CADPGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleCadpgovProfileV2(id) {
  const p = _cadpgovPsV2.get(id);
  if (!p) throw new Error(`cadpgov profile ${id} not found`);
  _cadpgovCheckP(p.status, CADPGOV_PROFILE_MATURITY_V2.STALE);
  p.status = CADPGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCadpgovProfileV2(id) {
  const p = _cadpgovPsV2.get(id);
  if (!p) throw new Error(`cadpgov profile ${id} not found`);
  _cadpgovCheckP(p.status, CADPGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CADPGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCadpgovProfileV2(id) {
  const p = _cadpgovPsV2.get(id);
  if (!p) throw new Error(`cadpgov profile ${id} not found`);
  if (_cadpgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cadpgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCadpgovProfileV2(id) {
  const p = _cadpgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCadpgovProfilesV2() {
  return [..._cadpgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCadpgovAdaptV2({ id, profileId, source, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cadpgovJsV2.has(id))
    throw new Error(`cadpgov adapt ${id} already exists`);
  if (!_cadpgovPsV2.has(profileId))
    throw new Error(`cadpgov profile ${profileId} not found`);
  if (_cadpgovCountPending(profileId) >= _cadpgovMaxPending)
    throw new Error(
      `max pending cadpgov adapts for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    source: source || "",
    status: CADPGOV_ADAPT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cadpgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function adaptingCadpgovAdaptV2(id) {
  const j = _cadpgovJsV2.get(id);
  if (!j) throw new Error(`cadpgov adapt ${id} not found`);
  _cadpgovCheckJ(j.status, CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTING);
  const now = Date.now();
  j.status = CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeAdaptCadpgovV2(id) {
  const j = _cadpgovJsV2.get(id);
  if (!j) throw new Error(`cadpgov adapt ${id} not found`);
  _cadpgovCheckJ(j.status, CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTED);
  const now = Date.now();
  j.status = CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCadpgovAdaptV2(id, reason) {
  const j = _cadpgovJsV2.get(id);
  if (!j) throw new Error(`cadpgov adapt ${id} not found`);
  _cadpgovCheckJ(j.status, CADPGOV_ADAPT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CADPGOV_ADAPT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCadpgovAdaptV2(id, reason) {
  const j = _cadpgovJsV2.get(id);
  if (!j) throw new Error(`cadpgov adapt ${id} not found`);
  _cadpgovCheckJ(j.status, CADPGOV_ADAPT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CADPGOV_ADAPT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCadpgovAdaptV2(id) {
  const j = _cadpgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCadpgovAdaptsV2() {
  return [..._cadpgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleCadpgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cadpgovPsV2.values())
    if (
      p.status === CADPGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cadpgovIdleMs
    ) {
      p.status = CADPGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCadpgovAdaptsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cadpgovJsV2.values())
    if (
      j.status === CADPGOV_ADAPT_LIFECYCLE_V2.ADAPTING &&
      j.startedAt != null &&
      t - j.startedAt >= _cadpgovStuckMs
    ) {
      j.status = CADPGOV_ADAPT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkAdapterGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CADPGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cadpgovPsV2.values()) profilesByStatus[p.status]++;
  const adaptsByStatus = {};
  for (const v of Object.values(CADPGOV_ADAPT_LIFECYCLE_V2))
    adaptsByStatus[v] = 0;
  for (const j of _cadpgovJsV2.values()) adaptsByStatus[j.status]++;
  return {
    totalCadpgovProfilesV2: _cadpgovPsV2.size,
    totalCadpgovAdaptsV2: _cadpgovJsV2.size,
    maxActiveCadpgovProfilesPerOwner: _cadpgovMaxActive,
    maxPendingCadpgovAdaptsPerProfile: _cadpgovMaxPending,
    cadpgovProfileIdleMs: _cadpgovIdleMs,
    cadpgovAdaptStuckMs: _cadpgovStuckMs,
    profilesByStatus,
    adaptsByStatus,
  };
}
