/**
 * LLM Provider registry — supports multiple AI providers with a unified interface.
 */

/**
 * Built-in provider definitions.
 */
export const BUILT_IN_PROVIDERS = {
  ollama: {
    name: "ollama",
    displayName: "Ollama (Local)",
    baseUrl: "http://localhost:11434",
    apiKeyEnv: null,
    models: [
      "qwen2.5:7b",
      "qwen2.5:14b",
      "qwen2.5-coder:14b",
      "qwen2:7b",
      "llama3:8b",
      "mistral:7b",
      "codellama:7b",
    ],
    free: true,
  },
  openai: {
    name: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1"],
    free: false,
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    free: false,
  },
  deepseek: {
    name: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
    free: false,
  },
  dashscope: {
    name: "dashscope",
    displayName: "DashScope (Alibaba)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    models: ["qwen-turbo", "qwen-plus", "qwen-max"],
    free: false,
  },
  gemini: {
    name: "gemini",
    displayName: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GEMINI_API_KEY",
    models: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-flash"],
    free: false,
  },
  mistral: {
    name: "mistral",
    displayName: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
    ],
    free: false,
  },
  volcengine: {
    name: "volcengine",
    displayName: "Volcengine (火山引擎/豆包)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnv: "VOLCENGINE_API_KEY",
    models: [
      "doubao-seed-1-6-251015",
      "doubao-seed-1-6-flash-250828",
      "doubao-seed-1-6-lite-251015",
      "doubao-seed-code",
    ],
    free: false,
  },
  kimi: {
    name: "kimi",
    displayName: "Kimi (月之暗面)",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    models: [
      "moonshot-v1-auto",
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k",
    ],
    free: false,
  },
  minimax: {
    name: "minimax",
    displayName: "MiniMax (海螺AI)",
    baseUrl: "https://api.minimax.chat/v1",
    apiKeyEnv: "MINIMAX_API_KEY",
    models: ["MiniMax-Text-01", "abab6.5s-chat", "abab5.5-chat"],
    free: false,
  },
};

/**
 * Provider registry — manages available providers and active selection.
 */
export class LLMProviderRegistry {
  constructor(db) {
    this.db = db;
    this.providers = new Map();
    this._ensureTable();
    this._loadBuiltins();
    this._loadCustom();
  }

  _ensureTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_providers (
        name TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_env TEXT,
        models TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 0,
        custom INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  _loadBuiltins() {
    for (const [name, def] of Object.entries(BUILT_IN_PROVIDERS)) {
      this.providers.set(name, { ...def, custom: false });
    }
  }

  _loadCustom() {
    const rows = this.db
      .prepare("SELECT * FROM llm_providers WHERE custom = 1")
      .all();
    for (const row of rows) {
      this.providers.set(row.name, {
        name: row.name,
        displayName: row.display_name,
        baseUrl: row.base_url,
        apiKeyEnv: row.api_key_env,
        models: JSON.parse(row.models || "[]"),
        custom: true,
        free: false,
      });
    }
  }

  /**
   * List all providers.
   */
  list() {
    const result = [];
    for (const [name, provider] of this.providers) {
      const hasKey = provider.apiKeyEnv
        ? !!process.env[provider.apiKeyEnv]
        : true;
      result.push({
        name,
        displayName: provider.displayName,
        baseUrl: provider.baseUrl,
        models: provider.models,
        hasApiKey: hasKey,
        custom: provider.custom || false,
        free: provider.free || false,
      });
    }
    return result;
  }

  /**
   * Get a specific provider.
   */
  get(name) {
    return this.providers.get(name) || null;
  }

  /**
   * Add a custom provider.
   */
  addProvider(name, config) {
    const provider = {
      name,
      displayName: config.displayName || name,
      baseUrl: config.baseUrl,
      apiKeyEnv: config.apiKeyEnv || null,
      models: config.models || [],
      custom: true,
      free: config.free || false,
    };

    this.db
      .prepare(
        "INSERT OR REPLACE INTO llm_providers (name, display_name, base_url, api_key_env, models, custom) VALUES (?, ?, ?, ?, ?, 1)",
      )
      .run(
        name,
        provider.displayName,
        provider.baseUrl,
        provider.apiKeyEnv,
        JSON.stringify(provider.models),
      );

    this.providers.set(name, provider);
    return provider;
  }

  /**
   * Remove a custom provider.
   */
  removeProvider(name) {
    const provider = this.providers.get(name);
    if (!provider) return false;
    if (!provider.custom)
      throw new Error(`Cannot remove built-in provider "${name}"`);

    this.db
      .prepare("DELETE FROM llm_providers WHERE name = ? AND custom = 1")
      .run(name);
    this.providers.delete(name);
    return true;
  }

  /**
   * Get/set the active provider.
   */
  getActive() {
    const row = this.db
      .prepare("SELECT name FROM llm_providers WHERE is_active = 1")
      .get();
    return row ? row.name : "ollama";
  }

  setActive(name) {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" not found`);
    }
    // Reset all
    this.db.prepare("UPDATE llm_providers SET is_active = 0 WHERE 1=1").run();
    // Set active
    this.db
      .prepare(
        "INSERT OR REPLACE INTO llm_providers (name, display_name, base_url, api_key_env, models, is_active) VALUES (?, ?, ?, ?, ?, 1)",
      )
      .run(
        name,
        this.providers.get(name).displayName,
        this.providers.get(name).baseUrl,
        this.providers.get(name).apiKeyEnv,
        JSON.stringify(this.providers.get(name).models),
      );
    return this.providers.get(name);
  }

  /**
   * Get API key for a provider (from env or config).
   */
  getApiKey(name) {
    const provider = this.providers.get(name);
    if (!provider) return null;
    if (!provider.apiKeyEnv) return null;
    return process.env[provider.apiKeyEnv] || null;
  }

  /**
   * Test provider connectivity.
   */
  async testProvider(name, model) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider "${name}" not found`);

    const start = Date.now();
    const testModel = model || provider.models[0];

    if (name === "ollama") {
      const res = await fetch(`${provider.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: testModel, prompt: "Hi", stream: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        ok: true,
        elapsed: Date.now() - start,
        response: data.response?.trim(),
      };
    }

    if (name === "gemini") {
      const key = this.getApiKey(name);
      if (!key) throw new Error("GEMINI_API_KEY not set");
      const res = await fetch(
        `${provider.baseUrl}/models/${testModel}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return { ok: true, elapsed: Date.now() - start, response: text.trim() };
    }

    if (name === "anthropic") {
      const key = this.getApiKey(name);
      if (!key) throw new Error("ANTHROPIC_API_KEY not set");
      const res = await fetch(`${provider.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: testModel,
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      return { ok: true, elapsed: Date.now() - start, response: text.trim() };
    }

    // OpenAI-compatible (openai, deepseek, dashscope, mistral, volcengine, kimi, minimax)
    const key = this.getApiKey(name);
    if (!key) throw new Error(`${provider.apiKeyEnv} not set`);
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 10,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    return { ok: true, elapsed: Date.now() - start, response: text.trim() };
  }
}

/* ─────────────────────────────────────────────────────────────────
 * V2 Governance Layer (in-memory, independent of SQLite llm_providers)
 *
 *   Provider profile maturity: pending → active → suspended → retired
 *     - retired terminal
 *     - suspended → active recovery (cap-exempt)
 *
 *   Request lifecycle: queued → running → completed | failed | cancelled
 *     - 3 terminals
 *     - per-profile pending-request cap counts queued+running
 *
 *   Per-owner active-profile cap on pending→active only (recovery exempt).
 *   Per-profile pending-request cap enforced at createRequestV2.
 *
 *   Auto-flip:
 *     - autoSuspendIdleProfilesV2  active w/ lastSeenAt past idle threshold → suspended
 *     - autoFailStuckRequestsV2    running w/ startedAt past stuck threshold → failed
 * ───────────────────────────────────────────────────────────────── */

export const PROVIDER_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  RETIRED: "retired",
});

export const REQUEST_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _PROVIDER_TRANSITIONS_V2 = new Map([
  [
    PROVIDER_MATURITY_V2.PENDING,
    new Set([PROVIDER_MATURITY_V2.ACTIVE, PROVIDER_MATURITY_V2.RETIRED]),
  ],
  [
    PROVIDER_MATURITY_V2.ACTIVE,
    new Set([PROVIDER_MATURITY_V2.SUSPENDED, PROVIDER_MATURITY_V2.RETIRED]),
  ],
  [
    PROVIDER_MATURITY_V2.SUSPENDED,
    new Set([PROVIDER_MATURITY_V2.ACTIVE, PROVIDER_MATURITY_V2.RETIRED]),
  ],
  [PROVIDER_MATURITY_V2.RETIRED, new Set()],
]);
const _PROVIDER_TERMINALS_V2 = new Set([PROVIDER_MATURITY_V2.RETIRED]);

const _REQUEST_TRANSITIONS_V2 = new Map([
  [
    REQUEST_LIFECYCLE_V2.QUEUED,
    new Set([REQUEST_LIFECYCLE_V2.RUNNING, REQUEST_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    REQUEST_LIFECYCLE_V2.RUNNING,
    new Set([
      REQUEST_LIFECYCLE_V2.COMPLETED,
      REQUEST_LIFECYCLE_V2.FAILED,
      REQUEST_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [REQUEST_LIFECYCLE_V2.COMPLETED, new Set()],
  [REQUEST_LIFECYCLE_V2.FAILED, new Set()],
  [REQUEST_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _REQUEST_TERMINALS_V2 = new Set([
  REQUEST_LIFECYCLE_V2.COMPLETED,
  REQUEST_LIFECYCLE_V2.FAILED,
  REQUEST_LIFECYCLE_V2.CANCELLED,
]);

export const PROVIDER_DEFAULT_MAX_ACTIVE_PER_OWNER = 8;
export const PROVIDER_DEFAULT_MAX_PENDING_REQUESTS_PER_PROFILE = 16;
export const PROVIDER_DEFAULT_PROFILE_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const PROVIDER_DEFAULT_REQUEST_STUCK_MS = 5 * 60 * 1000;

const _stateLlmV2 = {
  profiles: new Map(),
  requests: new Map(),
  maxActiveProfilesPerOwner: PROVIDER_DEFAULT_MAX_ACTIVE_PER_OWNER,
  maxPendingRequestsPerProfile:
    PROVIDER_DEFAULT_MAX_PENDING_REQUESTS_PER_PROFILE,
  profileIdleMs: PROVIDER_DEFAULT_PROFILE_IDLE_MS,
  requestStuckMs: PROVIDER_DEFAULT_REQUEST_STUCK_MS,
};

function _posIntLlmV2(n, label) {
  const v = Math.floor(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return v;
}

function _copyProfileV2(p) {
  return { ...p, metadata: { ...p.metadata } };
}

function _copyRequestV2(r) {
  return { ...r, metadata: { ...r.metadata } };
}

export function getMaxActiveProfilesPerOwnerV2() {
  return _stateLlmV2.maxActiveProfilesPerOwner;
}

export function setMaxActiveProfilesPerOwnerV2(n) {
  _stateLlmV2.maxActiveProfilesPerOwner = _posIntLlmV2(
    n,
    "maxActiveProfilesPerOwner",
  );
}

export function getMaxPendingRequestsPerProfileV2() {
  return _stateLlmV2.maxPendingRequestsPerProfile;
}

export function setMaxPendingRequestsPerProfileV2(n) {
  _stateLlmV2.maxPendingRequestsPerProfile = _posIntLlmV2(
    n,
    "maxPendingRequestsPerProfile",
  );
}

export function getProfileIdleMsV2() {
  return _stateLlmV2.profileIdleMs;
}

export function setProfileIdleMsV2(ms) {
  _stateLlmV2.profileIdleMs = _posIntLlmV2(ms, "profileIdleMs");
}

export function getRequestStuckMsV2() {
  return _stateLlmV2.requestStuckMs;
}

export function setRequestStuckMsV2(ms) {
  _stateLlmV2.requestStuckMs = _posIntLlmV2(ms, "requestStuckMs");
}

export function getActiveProfileCountV2(ownerId) {
  let count = 0;
  for (const p of _stateLlmV2.profiles.values()) {
    if (p.ownerId === ownerId && p.status === PROVIDER_MATURITY_V2.ACTIVE) {
      count++;
    }
  }
  return count;
}

export function getPendingRequestCountV2(profileId) {
  let count = 0;
  for (const r of _stateLlmV2.requests.values()) {
    if (
      r.profileId === profileId &&
      (r.status === REQUEST_LIFECYCLE_V2.QUEUED ||
        r.status === REQUEST_LIFECYCLE_V2.RUNNING)
    ) {
      count++;
    }
  }
  return count;
}

export function registerProfileV2(
  id,
  { ownerId, provider, model, metadata } = {},
) {
  if (!id) throw new Error("profile id is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (!provider) throw new Error("provider is required");
  if (_stateLlmV2.profiles.has(id))
    throw new Error(`profile ${id} already exists`);
  const now = Date.now();
  const profile = {
    id,
    ownerId,
    provider,
    model: model || "default",
    status: PROVIDER_MATURITY_V2.PENDING,
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    retiredAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateLlmV2.profiles.set(id, profile);
  return _copyProfileV2(profile);
}

export function getProfileV2(id) {
  const p = _stateLlmV2.profiles.get(id);
  return p ? _copyProfileV2(p) : null;
}

export function listProfilesV2({ ownerId, status, provider } = {}) {
  const out = [];
  for (const p of _stateLlmV2.profiles.values()) {
    if (ownerId && p.ownerId !== ownerId) continue;
    if (status && p.status !== status) continue;
    if (provider && p.provider !== provider) continue;
    out.push(_copyProfileV2(p));
  }
  return out;
}

export function setProfileStatusV2(id, next) {
  const p = _stateLlmV2.profiles.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  const allowed = _PROVIDER_TRANSITIONS_V2.get(p.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid profile transition: ${p.status} → ${next}`);
  }
  if (
    p.status === PROVIDER_MATURITY_V2.PENDING &&
    next === PROVIDER_MATURITY_V2.ACTIVE
  ) {
    const count = getActiveProfileCountV2(p.ownerId);
    if (count >= _stateLlmV2.maxActiveProfilesPerOwner) {
      throw new Error(
        `owner ${p.ownerId} active-profile cap reached (${count}/${_stateLlmV2.maxActiveProfilesPerOwner})`,
      );
    }
  }
  const now = Date.now();
  p.status = next;
  p.lastSeenAt = now;
  if (next === PROVIDER_MATURITY_V2.ACTIVE && !p.activatedAt)
    p.activatedAt = now;
  if (_PROVIDER_TERMINALS_V2.has(next) && !p.retiredAt) p.retiredAt = now;
  return _copyProfileV2(p);
}

export function activateProfileV2(id) {
  return setProfileStatusV2(id, PROVIDER_MATURITY_V2.ACTIVE);
}

export function suspendProfileV2(id) {
  return setProfileStatusV2(id, PROVIDER_MATURITY_V2.SUSPENDED);
}

export function retireProfileV2(id) {
  return setProfileStatusV2(id, PROVIDER_MATURITY_V2.RETIRED);
}

export function touchProfileV2(id) {
  const p = _stateLlmV2.profiles.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  p.lastSeenAt = Date.now();
  return _copyProfileV2(p);
}

export function createRequestV2(id, { profileId, kind, metadata } = {}) {
  if (!id) throw new Error("request id is required");
  if (!profileId) throw new Error("profileId is required");
  if (_stateLlmV2.requests.has(id))
    throw new Error(`request ${id} already exists`);
  const profile = _stateLlmV2.profiles.get(profileId);
  if (!profile) throw new Error(`profile ${profileId} not found`);
  const pending = getPendingRequestCountV2(profileId);
  if (pending >= _stateLlmV2.maxPendingRequestsPerProfile) {
    throw new Error(
      `profile ${profileId} pending-request cap reached (${pending}/${_stateLlmV2.maxPendingRequestsPerProfile})`,
    );
  }
  const now = Date.now();
  const req = {
    id,
    profileId,
    kind: kind || "completion",
    status: REQUEST_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    lastSeenAt: now,
    startedAt: null,
    settledAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _stateLlmV2.requests.set(id, req);
  return _copyRequestV2(req);
}

export function getRequestV2(id) {
  const r = _stateLlmV2.requests.get(id);
  return r ? _copyRequestV2(r) : null;
}

export function listRequestsV2({ profileId, status } = {}) {
  const out = [];
  for (const r of _stateLlmV2.requests.values()) {
    if (profileId && r.profileId !== profileId) continue;
    if (status && r.status !== status) continue;
    out.push(_copyRequestV2(r));
  }
  return out;
}

export function setRequestStatusV2(id, next) {
  const r = _stateLlmV2.requests.get(id);
  if (!r) throw new Error(`request ${id} not found`);
  const allowed = _REQUEST_TRANSITIONS_V2.get(r.status);
  if (!allowed || !allowed.has(next)) {
    throw new Error(`invalid request transition: ${r.status} → ${next}`);
  }
  const now = Date.now();
  r.status = next;
  r.lastSeenAt = now;
  if (next === REQUEST_LIFECYCLE_V2.RUNNING && !r.startedAt) r.startedAt = now;
  if (_REQUEST_TERMINALS_V2.has(next) && !r.settledAt) r.settledAt = now;
  return _copyRequestV2(r);
}

export function startRequestV2(id) {
  return setRequestStatusV2(id, REQUEST_LIFECYCLE_V2.RUNNING);
}

export function completeRequestV2(id) {
  return setRequestStatusV2(id, REQUEST_LIFECYCLE_V2.COMPLETED);
}

export function failRequestV2(id) {
  return setRequestStatusV2(id, REQUEST_LIFECYCLE_V2.FAILED);
}

export function cancelRequestV2(id) {
  return setRequestStatusV2(id, REQUEST_LIFECYCLE_V2.CANCELLED);
}

export function autoSuspendIdleProfilesV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const p of _stateLlmV2.profiles.values()) {
    if (
      p.status === PROVIDER_MATURITY_V2.ACTIVE &&
      now - p.lastSeenAt >= _stateLlmV2.profileIdleMs
    ) {
      p.status = PROVIDER_MATURITY_V2.SUSPENDED;
      p.lastSeenAt = now;
      flipped.push(p.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckRequestsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const r of _stateLlmV2.requests.values()) {
    if (
      r.status === REQUEST_LIFECYCLE_V2.RUNNING &&
      r.startedAt &&
      now - r.startedAt >= _stateLlmV2.requestStuckMs
    ) {
      r.status = REQUEST_LIFECYCLE_V2.FAILED;
      r.lastSeenAt = now;
      if (!r.settledAt) r.settledAt = now;
      flipped.push(r.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function getLlmProvidersStatsV2() {
  const profilesByStatus = {};
  for (const s of Object.values(PROVIDER_MATURITY_V2)) profilesByStatus[s] = 0;
  for (const p of _stateLlmV2.profiles.values()) profilesByStatus[p.status]++;
  const requestsByStatus = {};
  for (const s of Object.values(REQUEST_LIFECYCLE_V2)) requestsByStatus[s] = 0;
  for (const r of _stateLlmV2.requests.values()) requestsByStatus[r.status]++;
  return {
    totalProfilesV2: _stateLlmV2.profiles.size,
    totalRequestsV2: _stateLlmV2.requests.size,
    maxActiveProfilesPerOwner: _stateLlmV2.maxActiveProfilesPerOwner,
    maxPendingRequestsPerProfile: _stateLlmV2.maxPendingRequestsPerProfile,
    profileIdleMs: _stateLlmV2.profileIdleMs,
    requestStuckMs: _stateLlmV2.requestStuckMs,
    profilesByStatus,
    requestsByStatus,
  };
}

export function _resetStateLlmProvidersV2() {
  _stateLlmV2.profiles.clear();
  _stateLlmV2.requests.clear();
  _stateLlmV2.maxActiveProfilesPerOwner = PROVIDER_DEFAULT_MAX_ACTIVE_PER_OWNER;
  _stateLlmV2.maxPendingRequestsPerProfile =
    PROVIDER_DEFAULT_MAX_PENDING_REQUESTS_PER_PROFILE;
  _stateLlmV2.profileIdleMs = PROVIDER_DEFAULT_PROFILE_IDLE_MS;
  _stateLlmV2.requestStuckMs = PROVIDER_DEFAULT_REQUEST_STUCK_MS;
}
