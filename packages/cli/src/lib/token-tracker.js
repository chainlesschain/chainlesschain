/**
 * Token usage tracker for CLI
 *
 * Tracks LLM API call token counts and costs.
 * Lightweight port of desktop-app-vue/src/main/llm/token-tracker.js
 */

import { createHash } from "crypto";

/**
 * Pricing data per million tokens (USD)
 */
const PRICING = {
  ollama: { input: 0, output: 0 },
  openai: {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10, output: 30 },
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
    o1: { input: 15, output: 60 },
    _default: { input: 2.5, output: 10 },
  },
  anthropic: {
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-opus-4-6": { input: 15, output: 75 },
    "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
    _default: { input: 3, output: 15 },
  },
  deepseek: {
    "deepseek-chat": { input: 0.14, output: 0.28 },
    _default: { input: 0.14, output: 0.28 },
  },
  dashscope: {
    "qwen-turbo": { input: 0.3, output: 0.6 },
    "qwen-plus": { input: 0.8, output: 2 },
    _default: { input: 0.3, output: 0.6 },
  },
};

function ensureTokenTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage_log (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      response_time_ms INTEGER DEFAULT 0,
      endpoint TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Calculate cost for a given usage
 */
export function calculateCost(provider, model, inputTokens, outputTokens) {
  const providerPricing = PRICING[provider];
  if (!providerPricing) return 0;

  // Ollama is free
  if (provider === "ollama") return 0;

  const modelPricing = providerPricing[model] || providerPricing._default;
  if (!modelPricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output;
  return inputCost + outputCost;
}

/**
 * Record a token usage event
 */
export function recordUsage(db, params) {
  ensureTokenTable(db);

  const {
    provider,
    model,
    inputTokens = 0,
    outputTokens = 0,
    responseTimeMs = 0,
    endpoint = "",
  } = params;

  const totalTokens = inputTokens + outputTokens;
  const costUsd = calculateCost(provider, model, inputTokens, outputTokens);

  const id = createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 16);

  db.prepare(
    `INSERT INTO llm_usage_log (id, provider, model, input_tokens, output_tokens, total_tokens, cost_usd, response_time_ms, endpoint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    responseTimeMs,
    endpoint,
  );

  return { id, totalTokens, costUsd };
}

/**
 * Get usage stats with optional date filtering
 */
export function getUsageStats(db, options = {}) {
  ensureTokenTable(db);

  const { startDate, endDate, provider, model } = options;
  let sql = `SELECT
    COUNT(*) as total_calls,
    COALESCE(SUM(input_tokens), 0) as total_input_tokens,
    COALESCE(SUM(output_tokens), 0) as total_output_tokens,
    COALESCE(SUM(total_tokens), 0) as total_tokens,
    COALESCE(SUM(cost_usd), 0) as total_cost_usd,
    COALESCE(AVG(response_time_ms), 0) as avg_response_time_ms
    FROM llm_usage_log WHERE 1=1`;

  const params = [];
  if (startDate) {
    sql += " AND created_at >= ?";
    params.push(startDate);
  }
  if (endDate) {
    sql += " AND created_at <= ?";
    params.push(endDate);
  }
  if (provider) {
    sql += " AND provider = ?";
    params.push(provider);
  }
  if (model) {
    sql += " AND model = ?";
    params.push(model);
  }

  const result = db.prepare(sql).get(...params);
  return {
    total_calls: result?.total_calls || 0,
    total_input_tokens: result?.total_input_tokens || 0,
    total_output_tokens: result?.total_output_tokens || 0,
    total_tokens: result?.total_tokens || 0,
    total_cost_usd: result?.total_cost_usd || 0,
    avg_response_time_ms: result?.avg_response_time_ms || 0,
  };
}

/**
 * Get cost breakdown by provider
 */
export function getCostBreakdown(db) {
  ensureTokenTable(db);

  return db
    .prepare(
      `SELECT provider, model,
       COUNT(*) as calls,
       SUM(input_tokens) as input_tokens,
       SUM(output_tokens) as output_tokens,
       SUM(total_tokens) as total_tokens,
       SUM(cost_usd) as cost_usd
       FROM llm_usage_log
       GROUP BY provider, model
       ORDER BY cost_usd DESC`,
    )
    .all();
}

/**
 * Get recent usage entries
 */
export function getRecentUsage(db, limit = 20) {
  ensureTokenTable(db);

  return db
    .prepare(`SELECT * FROM llm_usage_log ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

/**
 * Get today's stats
 */
export function getTodayStats(db) {
  return getUsageStats(db, {
    startDate: new Date().toISOString().slice(0, 10),
  });
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Token tracker governance layer.
 * Tracks per-owner budget maturity + per-budget usage-record lifecycle
 * independent of legacy SQLite token_usage table.
 * ═══════════════════════════════════════════════════════════════ */

export const BUDGET_MATURITY_V2 = Object.freeze({
  PLANNING: "planning",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});

export const USAGE_RECORD_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  RECORDED: "recorded",
  BILLED: "billed",
  REJECTED: "rejected",
  REFUNDED: "refunded",
});

const BUDGET_TRANSITIONS_V2 = new Map([
  ["planning", new Set(["active", "archived"])],
  ["active", new Set(["suspended", "archived"])],
  ["suspended", new Set(["active", "archived"])],
  ["archived", new Set()],
]);
const BUDGET_TERMINALS_V2 = new Set(["archived"]);

const RECORD_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["recorded", "rejected"])],
  ["recorded", new Set(["billed", "rejected", "refunded"])],
  ["billed", new Set()],
  ["rejected", new Set()],
  ["refunded", new Set()],
]);
const RECORD_TERMINALS_V2 = new Set(["billed", "rejected", "refunded"]);

export const TOKEN_DEFAULT_MAX_ACTIVE_BUDGETS_PER_OWNER = 10;
export const TOKEN_DEFAULT_MAX_PENDING_RECORDS_PER_BUDGET = 500;
export const TOKEN_DEFAULT_BUDGET_IDLE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const TOKEN_DEFAULT_RECORD_STUCK_MS = 1000 * 60 * 60; // 1 hour

const _budgetsV2 = new Map();
const _recordsV2 = new Map();
let _maxActiveBudgetsPerOwnerV2 = TOKEN_DEFAULT_MAX_ACTIVE_BUDGETS_PER_OWNER;
let _maxPendingRecordsPerBudgetV2 =
  TOKEN_DEFAULT_MAX_PENDING_RECORDS_PER_BUDGET;
let _budgetIdleMsV2 = TOKEN_DEFAULT_BUDGET_IDLE_MS;
let _recordStuckMsV2 = TOKEN_DEFAULT_RECORD_STUCK_MS;

function _posIntTokenV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveBudgetsPerOwnerV2() {
  return _maxActiveBudgetsPerOwnerV2;
}
export function setMaxActiveBudgetsPerOwnerV2(n) {
  _maxActiveBudgetsPerOwnerV2 = _posIntTokenV2(n, "maxActiveBudgetsPerOwner");
}
export function getMaxPendingRecordsPerBudgetV2() {
  return _maxPendingRecordsPerBudgetV2;
}
export function setMaxPendingRecordsPerBudgetV2(n) {
  _maxPendingRecordsPerBudgetV2 = _posIntTokenV2(
    n,
    "maxPendingRecordsPerBudget",
  );
}
export function getBudgetIdleMsV2() {
  return _budgetIdleMsV2;
}
export function setBudgetIdleMsV2(n) {
  _budgetIdleMsV2 = _posIntTokenV2(n, "budgetIdleMs");
}
export function getRecordStuckMsV2() {
  return _recordStuckMsV2;
}
export function setRecordStuckMsV2(n) {
  _recordStuckMsV2 = _posIntTokenV2(n, "recordStuckMs");
}

export function getActiveBudgetCountV2(ownerId) {
  let n = 0;
  for (const b of _budgetsV2.values()) {
    if (b.ownerId === ownerId && b.status === "active") n += 1;
  }
  return n;
}

export function getPendingRecordCountV2(budgetId) {
  let n = 0;
  for (const r of _recordsV2.values()) {
    if (
      r.budgetId === budgetId &&
      (r.status === "pending" || r.status === "recorded")
    )
      n += 1;
  }
  return n;
}

function _copyBudgetV2(b) {
  return { ...b, metadata: { ...b.metadata } };
}
function _copyRecordV2(r) {
  return { ...r, metadata: { ...r.metadata } };
}

export function registerBudgetV2(
  id,
  { ownerId, label, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!ownerId || typeof ownerId !== "string")
    throw new Error("ownerId must be a string");
  if (!label || typeof label !== "string")
    throw new Error("label must be a string");
  if (_budgetsV2.has(id)) throw new Error(`budget ${id} already exists`);
  const b = {
    id,
    ownerId,
    label,
    status: "planning",
    createdAt: now,
    lastSeenAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...metadata },
  };
  _budgetsV2.set(id, b);
  return _copyBudgetV2(b);
}

export function getBudgetV2(id) {
  const b = _budgetsV2.get(id);
  return b ? _copyBudgetV2(b) : null;
}

export function listBudgetsV2({ ownerId, status } = {}) {
  const out = [];
  for (const b of _budgetsV2.values()) {
    if (ownerId && b.ownerId !== ownerId) continue;
    if (status && b.status !== status) continue;
    out.push(_copyBudgetV2(b));
  }
  return out;
}

export function setBudgetStatusV2(id, next, { now = Date.now() } = {}) {
  const b = _budgetsV2.get(id);
  if (!b) throw new Error(`budget ${id} not found`);
  if (!BUDGET_TRANSITIONS_V2.has(next))
    throw new Error(`unknown budget status: ${next}`);
  if (BUDGET_TERMINALS_V2.has(b.status))
    throw new Error(`budget ${id} is in terminal state ${b.status}`);
  const allowed = BUDGET_TRANSITIONS_V2.get(b.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition budget from ${b.status} to ${next}`);
  if (next === "active") {
    if (b.status === "planning") {
      const count = getActiveBudgetCountV2(b.ownerId);
      if (count >= _maxActiveBudgetsPerOwnerV2)
        throw new Error(
          `owner ${b.ownerId} already at active-budget cap (${_maxActiveBudgetsPerOwnerV2})`,
        );
    }
    if (!b.activatedAt) b.activatedAt = now;
  }
  if (next === "archived" && !b.archivedAt) b.archivedAt = now;
  b.status = next;
  b.lastSeenAt = now;
  return _copyBudgetV2(b);
}

export function activateBudgetV2(id, opts) {
  return setBudgetStatusV2(id, "active", opts);
}
export function suspendBudgetV2(id, opts) {
  return setBudgetStatusV2(id, "suspended", opts);
}
export function archiveBudgetV2(id, opts) {
  return setBudgetStatusV2(id, "archived", opts);
}

export function touchBudgetV2(id, { now = Date.now() } = {}) {
  const b = _budgetsV2.get(id);
  if (!b) throw new Error(`budget ${id} not found`);
  b.lastSeenAt = now;
  return _copyBudgetV2(b);
}

export function createUsageRecordV2(
  id,
  { budgetId, units, metadata = {}, now = Date.now() } = {},
) {
  if (!id || typeof id !== "string") throw new Error("id must be a string");
  if (!budgetId || typeof budgetId !== "string")
    throw new Error("budgetId must be a string");
  if (!Number.isFinite(units) || units < 0)
    throw new Error("units must be a non-negative finite number");
  if (_recordsV2.has(id)) throw new Error(`record ${id} already exists`);
  const count = getPendingRecordCountV2(budgetId);
  if (count >= _maxPendingRecordsPerBudgetV2)
    throw new Error(
      `budget ${budgetId} already at pending-record cap (${_maxPendingRecordsPerBudgetV2})`,
    );
  const r = {
    id,
    budgetId,
    units,
    status: "pending",
    createdAt: now,
    lastSeenAt: now,
    recordedAt: null,
    settledAt: null,
    metadata: { ...metadata },
  };
  _recordsV2.set(id, r);
  return _copyRecordV2(r);
}

export function getUsageRecordV2(id) {
  const r = _recordsV2.get(id);
  return r ? _copyRecordV2(r) : null;
}

export function listUsageRecordsV2({ budgetId, status } = {}) {
  const out = [];
  for (const r of _recordsV2.values()) {
    if (budgetId && r.budgetId !== budgetId) continue;
    if (status && r.status !== status) continue;
    out.push(_copyRecordV2(r));
  }
  return out;
}

export function setUsageRecordStatusV2(id, next, { now = Date.now() } = {}) {
  const r = _recordsV2.get(id);
  if (!r) throw new Error(`record ${id} not found`);
  if (!RECORD_TRANSITIONS_V2.has(next))
    throw new Error(`unknown record status: ${next}`);
  if (RECORD_TERMINALS_V2.has(r.status))
    throw new Error(`record ${id} is in terminal state ${r.status}`);
  const allowed = RECORD_TRANSITIONS_V2.get(r.status);
  if (!allowed.has(next))
    throw new Error(`cannot transition record from ${r.status} to ${next}`);
  if (next === "recorded" && !r.recordedAt) r.recordedAt = now;
  if (RECORD_TERMINALS_V2.has(next) && !r.settledAt) r.settledAt = now;
  r.status = next;
  r.lastSeenAt = now;
  return _copyRecordV2(r);
}

export function recordUsageV2(id, opts) {
  return setUsageRecordStatusV2(id, "recorded", opts);
}
export function billUsageV2(id, opts) {
  return setUsageRecordStatusV2(id, "billed", opts);
}
export function rejectUsageV2(id, opts) {
  return setUsageRecordStatusV2(id, "rejected", opts);
}
export function refundUsageV2(id, opts) {
  return setUsageRecordStatusV2(id, "refunded", opts);
}

export function autoSuspendIdleBudgetsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const b of _budgetsV2.values()) {
    if (b.status !== "active") continue;
    if (now - b.lastSeenAt > _budgetIdleMsV2) {
      b.status = "suspended";
      b.lastSeenAt = now;
      flipped.push(_copyBudgetV2(b));
    }
  }
  return flipped;
}

export function autoRejectStaleRecordsV2({ now = Date.now() } = {}) {
  const flipped = [];
  for (const r of _recordsV2.values()) {
    if (r.status !== "pending" && r.status !== "recorded") continue;
    if (now - r.lastSeenAt > _recordStuckMsV2) {
      r.status = "rejected";
      r.lastSeenAt = now;
      if (!r.settledAt) r.settledAt = now;
      flipped.push(_copyRecordV2(r));
    }
  }
  return flipped;
}

export function getTokenTrackerStatsV2() {
  const budgetsByStatus = {};
  for (const v of Object.values(BUDGET_MATURITY_V2)) budgetsByStatus[v] = 0;
  for (const b of _budgetsV2.values()) budgetsByStatus[b.status] += 1;

  const recordsByStatus = {};
  for (const v of Object.values(USAGE_RECORD_LIFECYCLE_V2))
    recordsByStatus[v] = 0;
  for (const r of _recordsV2.values()) recordsByStatus[r.status] += 1;

  return {
    totalBudgetsV2: _budgetsV2.size,
    totalRecordsV2: _recordsV2.size,
    maxActiveBudgetsPerOwner: _maxActiveBudgetsPerOwnerV2,
    maxPendingRecordsPerBudget: _maxPendingRecordsPerBudgetV2,
    budgetIdleMs: _budgetIdleMsV2,
    recordStuckMs: _recordStuckMsV2,
    budgetsByStatus,
    recordsByStatus,
  };
}

export function _resetStateTokenTrackerV2() {
  _budgetsV2.clear();
  _recordsV2.clear();
  _maxActiveBudgetsPerOwnerV2 = TOKEN_DEFAULT_MAX_ACTIVE_BUDGETS_PER_OWNER;
  _maxPendingRecordsPerBudgetV2 = TOKEN_DEFAULT_MAX_PENDING_RECORDS_PER_BUDGET;
  _budgetIdleMsV2 = TOKEN_DEFAULT_BUDGET_IDLE_MS;
  _recordStuckMsV2 = TOKEN_DEFAULT_RECORD_STUCK_MS;
}

// =====================================================================
// token-tracker V2 governance overlay (iter24)
// =====================================================================
export const TOKTGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const TOKTGOV_USAGE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RECORDING: "recording",
  RECORDED: "recorded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _toktgovPTrans = new Map([
  [
    TOKTGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      TOKTGOV_PROFILE_MATURITY_V2.ACTIVE,
      TOKTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TOKTGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      TOKTGOV_PROFILE_MATURITY_V2.STALE,
      TOKTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TOKTGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      TOKTGOV_PROFILE_MATURITY_V2.ACTIVE,
      TOKTGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [TOKTGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _toktgovPTerminal = new Set([TOKTGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _toktgovJTrans = new Map([
  [
    TOKTGOV_USAGE_LIFECYCLE_V2.QUEUED,
    new Set([
      TOKTGOV_USAGE_LIFECYCLE_V2.RECORDING,
      TOKTGOV_USAGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    TOKTGOV_USAGE_LIFECYCLE_V2.RECORDING,
    new Set([
      TOKTGOV_USAGE_LIFECYCLE_V2.RECORDED,
      TOKTGOV_USAGE_LIFECYCLE_V2.FAILED,
      TOKTGOV_USAGE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [TOKTGOV_USAGE_LIFECYCLE_V2.RECORDED, new Set()],
  [TOKTGOV_USAGE_LIFECYCLE_V2.FAILED, new Set()],
  [TOKTGOV_USAGE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _toktgovPsV2 = new Map();
const _toktgovJsV2 = new Map();
let _toktgovMaxActive = 8,
  _toktgovMaxPending = 20,
  _toktgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _toktgovStuckMs = 60 * 1000;
function _toktgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _toktgovCheckP(from, to) {
  const a = _toktgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid toktgov profile transition ${from} → ${to}`);
}
function _toktgovCheckJ(from, to) {
  const a = _toktgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid toktgov usage transition ${from} → ${to}`);
}
function _toktgovCountActive(owner) {
  let c = 0;
  for (const p of _toktgovPsV2.values())
    if (p.owner === owner && p.status === TOKTGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _toktgovCountPending(profileId) {
  let c = 0;
  for (const j of _toktgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === TOKTGOV_USAGE_LIFECYCLE_V2.QUEUED ||
        j.status === TOKTGOV_USAGE_LIFECYCLE_V2.RECORDING)
    )
      c++;
  return c;
}
export function setMaxActiveToktgovProfilesPerOwnerV2(n) {
  _toktgovMaxActive = _toktgovPos(n, "maxActiveToktgovProfilesPerOwner");
}
export function getMaxActiveToktgovProfilesPerOwnerV2() {
  return _toktgovMaxActive;
}
export function setMaxPendingToktgovUsagesPerProfileV2(n) {
  _toktgovMaxPending = _toktgovPos(n, "maxPendingToktgovUsagesPerProfile");
}
export function getMaxPendingToktgovUsagesPerProfileV2() {
  return _toktgovMaxPending;
}
export function setToktgovProfileIdleMsV2(n) {
  _toktgovIdleMs = _toktgovPos(n, "toktgovProfileIdleMs");
}
export function getToktgovProfileIdleMsV2() {
  return _toktgovIdleMs;
}
export function setToktgovUsageStuckMsV2(n) {
  _toktgovStuckMs = _toktgovPos(n, "toktgovUsageStuckMs");
}
export function getToktgovUsageStuckMsV2() {
  return _toktgovStuckMs;
}
export function _resetStateTokenTrackerGovV2() {
  _toktgovPsV2.clear();
  _toktgovJsV2.clear();
  _toktgovMaxActive = 8;
  _toktgovMaxPending = 20;
  _toktgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _toktgovStuckMs = 60 * 1000;
}
export function registerToktgovProfileV2({ id, owner, budget, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_toktgovPsV2.has(id))
    throw new Error(`toktgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    budget: budget || "default",
    status: TOKTGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _toktgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateToktgovProfileV2(id) {
  const p = _toktgovPsV2.get(id);
  if (!p) throw new Error(`toktgov profile ${id} not found`);
  const isInitial = p.status === TOKTGOV_PROFILE_MATURITY_V2.PENDING;
  _toktgovCheckP(p.status, TOKTGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _toktgovCountActive(p.owner) >= _toktgovMaxActive)
    throw new Error(`max active toktgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = TOKTGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleToktgovProfileV2(id) {
  const p = _toktgovPsV2.get(id);
  if (!p) throw new Error(`toktgov profile ${id} not found`);
  _toktgovCheckP(p.status, TOKTGOV_PROFILE_MATURITY_V2.STALE);
  p.status = TOKTGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveToktgovProfileV2(id) {
  const p = _toktgovPsV2.get(id);
  if (!p) throw new Error(`toktgov profile ${id} not found`);
  _toktgovCheckP(p.status, TOKTGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = TOKTGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchToktgovProfileV2(id) {
  const p = _toktgovPsV2.get(id);
  if (!p) throw new Error(`toktgov profile ${id} not found`);
  if (_toktgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal toktgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getToktgovProfileV2(id) {
  const p = _toktgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listToktgovProfilesV2() {
  return [..._toktgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createToktgovUsageV2({ id, profileId, model, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_toktgovJsV2.has(id))
    throw new Error(`toktgov usage ${id} already exists`);
  if (!_toktgovPsV2.has(profileId))
    throw new Error(`toktgov profile ${profileId} not found`);
  if (_toktgovCountPending(profileId) >= _toktgovMaxPending)
    throw new Error(
      `max pending toktgov usages for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    model: model || "",
    status: TOKTGOV_USAGE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _toktgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function recordingToktgovUsageV2(id) {
  const j = _toktgovJsV2.get(id);
  if (!j) throw new Error(`toktgov usage ${id} not found`);
  _toktgovCheckJ(j.status, TOKTGOV_USAGE_LIFECYCLE_V2.RECORDING);
  const now = Date.now();
  j.status = TOKTGOV_USAGE_LIFECYCLE_V2.RECORDING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeUsageToktgovV2(id) {
  const j = _toktgovJsV2.get(id);
  if (!j) throw new Error(`toktgov usage ${id} not found`);
  _toktgovCheckJ(j.status, TOKTGOV_USAGE_LIFECYCLE_V2.RECORDED);
  const now = Date.now();
  j.status = TOKTGOV_USAGE_LIFECYCLE_V2.RECORDED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failToktgovUsageV2(id, reason) {
  const j = _toktgovJsV2.get(id);
  if (!j) throw new Error(`toktgov usage ${id} not found`);
  _toktgovCheckJ(j.status, TOKTGOV_USAGE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = TOKTGOV_USAGE_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelToktgovUsageV2(id, reason) {
  const j = _toktgovJsV2.get(id);
  if (!j) throw new Error(`toktgov usage ${id} not found`);
  _toktgovCheckJ(j.status, TOKTGOV_USAGE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = TOKTGOV_USAGE_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getToktgovUsageV2(id) {
  const j = _toktgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listToktgovUsagesV2() {
  return [..._toktgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleToktgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _toktgovPsV2.values())
    if (
      p.status === TOKTGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _toktgovIdleMs
    ) {
      p.status = TOKTGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckToktgovUsagesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _toktgovJsV2.values())
    if (
      j.status === TOKTGOV_USAGE_LIFECYCLE_V2.RECORDING &&
      j.startedAt != null &&
      t - j.startedAt >= _toktgovStuckMs
    ) {
      j.status = TOKTGOV_USAGE_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getTokenTrackerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(TOKTGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _toktgovPsV2.values()) profilesByStatus[p.status]++;
  const usagesByStatus = {};
  for (const v of Object.values(TOKTGOV_USAGE_LIFECYCLE_V2))
    usagesByStatus[v] = 0;
  for (const j of _toktgovJsV2.values()) usagesByStatus[j.status]++;
  return {
    totalToktgovProfilesV2: _toktgovPsV2.size,
    totalToktgovUsagesV2: _toktgovJsV2.size,
    maxActiveToktgovProfilesPerOwner: _toktgovMaxActive,
    maxPendingToktgovUsagesPerProfile: _toktgovMaxPending,
    toktgovProfileIdleMs: _toktgovIdleMs,
    toktgovUsageStuckMs: _toktgovStuckMs,
    profilesByStatus,
    usagesByStatus,
  };
}
