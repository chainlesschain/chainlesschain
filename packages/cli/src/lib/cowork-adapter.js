/**
 * Cowork Adapter — bridges CLI's LLM infrastructure to cowork modules.
 *
 * Provides:
 *  - Unified LLM chat function (works with any configured provider)
 *  - Logger shim compatible with desktop modules
 *  - Module initialization helper
 */

import { LLMProviderRegistry, BUILT_IN_PROVIDERS } from "./llm-providers.js";

/**
 * Create a chat completion function that routes through the active LLM provider.
 *
 * @param {object} [options]
 * @param {string} [options.provider] - Provider name override
 * @param {string} [options.model] - Model name override
 * @param {string} [options.baseUrl] - Base URL override
 * @param {string} [options.apiKey] - API key override
 * @returns {(messages: object[], opts?: object) => Promise<string>}
 */
export function createChatFn(options = {}) {
  const provider = options.provider || process.env.LLM_PROVIDER || "ollama";
  const providerDef = BUILT_IN_PROVIDERS[provider] || BUILT_IN_PROVIDERS.ollama;
  const model = options.model || process.env.LLM_MODEL || providerDef.models[0];
  const baseUrl = options.baseUrl || providerDef.baseUrl;

  return async function chat(messages, opts = {}) {
    const currentModel = opts.model || model;
    const maxTokens = opts.maxTokens || 2048;

    if (provider === "ollama") {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
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
      return data.message?.content || "";
    }

    if (provider === "anthropic") {
      const key = options.apiKey || process.env[providerDef.apiKeyEnv];
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
      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
      const data = await res.json();
      return data.content?.[0]?.text || "";
    }

    // OpenAI-compatible (openai, deepseek, dashscope, mistral, gemini)
    const key = options.apiKey || process.env[providerDef.apiKeyEnv];
    if (!key) throw new Error(`${providerDef.apiKeyEnv} not set`);

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
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
    return data.choices?.[0]?.message?.content || "";
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
