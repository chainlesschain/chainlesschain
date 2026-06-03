/**
 * Provider-options three-layer deep merge — inspired by open-agents'
 * getAnthropicSettings + mergeProviderOptions pattern.
 *
 * Resolves per-call LLM provider options as a deep merge of:
 *   1. PROVIDER_DEFAULTS[provider]      — hand-curated baseline per provider
 *   2. MODEL_INFERENCE(modelId)         — model-specific overrides (e.g. o1
 *                                         disables temperature, claude-opus
 *                                         enables extended thinking)
 *   3. callOverrides                    — whatever the caller passes
 *
 * Later layers win at leaf keys; objects are merged recursively, arrays are
 * replaced (not concatenated) to keep behavior predictable.
 *
 * @module provider-options
 */

// ─── Layer 1: per-provider defaults ────────────────────────────────────────

export const PROVIDER_DEFAULTS = Object.freeze({
  anthropic: {
    maxTokens: 8192,
    temperature: 1.0,
    anthropic: { thinking: { type: "disabled" } },
  },
  openai: {
    maxTokens: 4096,
    temperature: 0.7,
  },
  ollama: {
    temperature: 0.7,
  },
  deepseek: {
    maxTokens: 4096,
    temperature: 0.7,
  },
  gemini: {
    maxTokens: 8192,
    temperature: 0.7,
  },
  custom: {
    maxTokens: 4096,
    temperature: 0.7,
  },
});

// ─── Layer 2: model-id inference ───────────────────────────────────────────

/**
 * Derive per-model overrides from the model id string. Pure function, no I/O.
 *
 * @param {string} modelId
 * @returns {object} partial options to merge on top of provider defaults.
 */
export function inferModelOverrides(modelId) {
  if (!modelId || typeof modelId !== "string") return {};
  const id = modelId.toLowerCase();

  // OpenAI o1/o3 reasoning models — temperature is unsupported.
  if (
    id.startsWith("o1") ||
    id.startsWith("o3") ||
    id.includes("-o1-") ||
    id.includes("-o3-")
  ) {
    return { temperature: undefined, reasoning: { effort: "medium" } };
  }

  // Claude Opus — enable extended thinking by default (users can turn off).
  if (id.includes("opus-4") || id.includes("opus-3")) {
    return {
      maxTokens: 16384,
      anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } },
    };
  }

  // Claude Haiku — cheaper, smaller output by default.
  if (id.includes("haiku")) {
    return { maxTokens: 4096 };
  }

  // DeepSeek reasoner — reasoning tokens need headroom.
  if (id.includes("deepseek-reasoner")) {
    return { maxTokens: 8192, reasoning: { enabled: true } };
  }

  return {};
}

// ─── Deep merge primitive ──────────────────────────────────────────────────

function _isPlainObject(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

export function deepMerge(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!_isPlainObject(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) {
        // explicit undefined → erase from accumulator (used to disable fields)
        delete out[key];
      } else if (_isPlainObject(value) && _isPlainObject(out[key])) {
        out[key] = deepMerge(out[key], value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Merge three layers into a single options object for a given LLM call.
 *
 * @param {string} provider
 * @param {string} modelId
 * @param {object} [callOverrides]
 * @returns {object}
 */
export function mergeProviderOptions(provider, modelId, callOverrides = {}) {
  const defaults = PROVIDER_DEFAULTS[provider] || {};
  const modelLayer = inferModelOverrides(modelId);
  return deepMerge(defaults, modelLayer, callOverrides || {});
}

// =====================================================================
// provider-options V2 governance overlay (iter27)
// =====================================================================
export const POPTGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const POPTGOV_RESOLVE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RESOLVING: "resolving",
  RESOLVED: "resolved",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _poptgovPTrans = new Map([
  [
    POPTGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      POPTGOV_PROFILE_MATURITY_V2.ACTIVE,
      POPTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    POPTGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      POPTGOV_PROFILE_MATURITY_V2.STALE,
      POPTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    POPTGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      POPTGOV_PROFILE_MATURITY_V2.ACTIVE,
      POPTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [POPTGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _poptgovPTerminal = new Set([POPTGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _poptgovJTrans = new Map([
  [
    POPTGOV_RESOLVE_LIFECYCLE_V2.QUEUED,
    new Set([
      POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVING,
      POPTGOV_RESOLVE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVING,
    new Set([
      POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVED,
      POPTGOV_RESOLVE_LIFECYCLE_V2.FAILED,
      POPTGOV_RESOLVE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVED, new Set()],
  [POPTGOV_RESOLVE_LIFECYCLE_V2.FAILED, new Set()],
  [POPTGOV_RESOLVE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _poptgovPsV2 = new Map();
const _poptgovJsV2 = new Map();
let _poptgovMaxActive = 8,
  _poptgovMaxPending = 20,
  _poptgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _poptgovStuckMs = 60 * 1000;
function _poptgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _poptgovCheckP(from, to) {
  const a = _poptgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid poptgov profile transition ${from} → ${to}`);
}
function _poptgovCheckJ(from, to) {
  const a = _poptgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid poptgov resolve transition ${from} → ${to}`);
}
function _poptgovCountActive(owner) {
  let c = 0;
  for (const p of _poptgovPsV2.values())
    if (p.owner === owner && p.status === POPTGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _poptgovCountPending(profileId) {
  let c = 0;
  for (const j of _poptgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === POPTGOV_RESOLVE_LIFECYCLE_V2.QUEUED ||
        j.status === POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVING)
    )
      c++;
  return c;
}
export function setMaxActivePoptgovProfilesPerOwnerV2(n) {
  _poptgovMaxActive = _poptgovPos(n, "maxActivePoptgovProfilesPerOwner");
}
export function getMaxActivePoptgovProfilesPerOwnerV2() {
  return _poptgovMaxActive;
}
export function setMaxPendingPoptgovResolvesPerProfileV2(n) {
  _poptgovMaxPending = _poptgovPos(n, "maxPendingPoptgovResolvesPerProfile");
}
export function getMaxPendingPoptgovResolvesPerProfileV2() {
  return _poptgovMaxPending;
}
export function setPoptgovProfileIdleMsV2(n) {
  _poptgovIdleMs = _poptgovPos(n, "poptgovProfileIdleMs");
}
export function getPoptgovProfileIdleMsV2() {
  return _poptgovIdleMs;
}
export function setPoptgovResolveStuckMsV2(n) {
  _poptgovStuckMs = _poptgovPos(n, "poptgovResolveStuckMs");
}
export function getPoptgovResolveStuckMsV2() {
  return _poptgovStuckMs;
}
export function _resetStateProviderOptionsGovV2() {
  _poptgovPsV2.clear();
  _poptgovJsV2.clear();
  _poptgovMaxActive = 8;
  _poptgovMaxPending = 20;
  _poptgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _poptgovStuckMs = 60 * 1000;
}
export function registerPoptgovProfileV2({
  id,
  owner,
  provider,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_poptgovPsV2.has(id))
    throw new Error(`poptgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    provider: provider || "default",
    status: POPTGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _poptgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activatePoptgovProfileV2(id) {
  const p = _poptgovPsV2.get(id);
  if (!p) throw new Error(`poptgov profile ${id} not found`);
  const isInitial = p.status === POPTGOV_PROFILE_MATURITY_V2.PENDING;
  _poptgovCheckP(p.status, POPTGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _poptgovCountActive(p.owner) >= _poptgovMaxActive)
    throw new Error(`max active poptgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = POPTGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function stalePoptgovProfileV2(id) {
  const p = _poptgovPsV2.get(id);
  if (!p) throw new Error(`poptgov profile ${id} not found`);
  _poptgovCheckP(p.status, POPTGOV_PROFILE_MATURITY_V2.STALE);
  p.status = POPTGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archivePoptgovProfileV2(id) {
  const p = _poptgovPsV2.get(id);
  if (!p) throw new Error(`poptgov profile ${id} not found`);
  _poptgovCheckP(p.status, POPTGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = POPTGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchPoptgovProfileV2(id) {
  const p = _poptgovPsV2.get(id);
  if (!p) throw new Error(`poptgov profile ${id} not found`);
  if (_poptgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal poptgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getPoptgovProfileV2(id) {
  const p = _poptgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listPoptgovProfilesV2() {
  return [..._poptgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createPoptgovResolveV2({
  id,
  profileId,
  option,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_poptgovJsV2.has(id))
    throw new Error(`poptgov resolve ${id} already exists`);
  if (!_poptgovPsV2.has(profileId))
    throw new Error(`poptgov profile ${profileId} not found`);
  if (_poptgovCountPending(profileId) >= _poptgovMaxPending)
    throw new Error(
      `max pending poptgov resolves for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    option: option || "",
    status: POPTGOV_RESOLVE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _poptgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function resolvingPoptgovResolveV2(id) {
  const j = _poptgovJsV2.get(id);
  if (!j) throw new Error(`poptgov resolve ${id} not found`);
  _poptgovCheckJ(j.status, POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVING);
  const now = Date.now();
  j.status = POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeResolvePoptgovV2(id) {
  const j = _poptgovJsV2.get(id);
  if (!j) throw new Error(`poptgov resolve ${id} not found`);
  _poptgovCheckJ(j.status, POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVED);
  const now = Date.now();
  j.status = POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failPoptgovResolveV2(id, reason) {
  const j = _poptgovJsV2.get(id);
  if (!j) throw new Error(`poptgov resolve ${id} not found`);
  _poptgovCheckJ(j.status, POPTGOV_RESOLVE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = POPTGOV_RESOLVE_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelPoptgovResolveV2(id, reason) {
  const j = _poptgovJsV2.get(id);
  if (!j) throw new Error(`poptgov resolve ${id} not found`);
  _poptgovCheckJ(j.status, POPTGOV_RESOLVE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = POPTGOV_RESOLVE_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getPoptgovResolveV2(id) {
  const j = _poptgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listPoptgovResolvesV2() {
  return [..._poptgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdlePoptgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _poptgovPsV2.values())
    if (
      p.status === POPTGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _poptgovIdleMs
    ) {
      p.status = POPTGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckPoptgovResolvesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _poptgovJsV2.values())
    if (
      j.status === POPTGOV_RESOLVE_LIFECYCLE_V2.RESOLVING &&
      j.startedAt != null &&
      t - j.startedAt >= _poptgovStuckMs
    ) {
      j.status = POPTGOV_RESOLVE_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getProviderOptionsGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(POPTGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _poptgovPsV2.values()) profilesByStatus[p.status]++;
  const resolvesByStatus = {};
  for (const v of Object.values(POPTGOV_RESOLVE_LIFECYCLE_V2))
    resolvesByStatus[v] = 0;
  for (const j of _poptgovJsV2.values()) resolvesByStatus[j.status]++;
  return {
    totalPoptgovProfilesV2: _poptgovPsV2.size,
    totalPoptgovResolvesV2: _poptgovJsV2.size,
    maxActivePoptgovProfilesPerOwner: _poptgovMaxActive,
    maxPendingPoptgovResolvesPerProfile: _poptgovMaxPending,
    poptgovProfileIdleMs: _poptgovIdleMs,
    poptgovResolveStuckMs: _poptgovStuckMs,
    profilesByStatus,
    resolvesByStatus,
  };
}
