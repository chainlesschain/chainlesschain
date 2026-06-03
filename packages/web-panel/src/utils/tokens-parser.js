/**
 * tokens-parser.js — Pure parsers for `cc tokens ...` CLI output.
 *
 * The token-tracker tracks LLM call usage per provider/model with cost
 * computation; commands accept `--json` for structured output. DB-backed
 * commands (show/breakdown/recent/cache/stats-v2) log
 * "Database not available" + exit 1 outside a project — caught by
 * `detectTokensError`.
 *
 * Lib emits sqlite-derived rows in snake_case (`total_tokens`, `cost_usd`,
 * `created_at`, etc.). Parsers normalize to camelCase. The `tokens show
 * --json` envelope is `{stats: {...}, today: {...}}` — `parseShowResult`
 * unwraps both halves.
 *
 * Reuses `stripCliNoise` from community-parser.
 */

import { stripCliNoise } from './community-parser.js'

function tryParseJson(output) {
  const cleaned = stripCliNoise(output)
  if (!cleaned) return null
  try { return JSON.parse(cleaned) } catch { /* fallthrough */ }
  const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export const PERIOD_OPTIONS = Object.freeze(['today', 'week', 'month', 'all'])

export const BUDGET_MATURITIES_V2 = Object.freeze([
  'planning', 'active', 'suspended', 'archived',
])

export const USAGE_RECORD_LIFECYCLES_V2 = Object.freeze([
  'pending', 'recorded', 'billed', 'rejected', 'refunded',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Detect "Database not available" — emitted by every DB-backed
 * tokens command outside a chainlesschain project.
 */
export function detectTokensError(output) {
  if (!output) return { noDb: false, error: '' }
  const cleaned = stripCliNoise(output)
  const noDb = /Database not available/i.test(cleaned)
  return {
    noDb,
    error: noDb ? 'Database not available' : '',
  }
}

const STATS_DEFAULTS = {
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  avgResponseTimeMs: 0,
}

function normalizeStats(raw) {
  const result = { ...STATS_DEFAULTS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  result.totalCalls = num(raw.total_calls ?? raw.totalCalls, 0)
  result.totalInputTokens = num(raw.total_input_tokens ?? raw.totalInputTokens, 0)
  result.totalOutputTokens = num(raw.total_output_tokens ?? raw.totalOutputTokens, 0)
  result.totalTokens = num(raw.total_tokens ?? raw.totalTokens, 0)
  result.totalCostUsd = num(raw.total_cost_usd ?? raw.totalCostUsd, 0)
  result.avgResponseTimeMs = num(raw.avg_response_time_ms ?? raw.avgResponseTimeMs, 0)
  return result
}

/**
 * Parse `cc tokens show --json`. Envelope is `{stats: {...}, today: {...}}`.
 * Returns both halves normalized to camelCase.
 */
export function parseShowResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { stats: { ...STATS_DEFAULTS }, today: { ...STATS_DEFAULTS } }
  }
  return {
    stats: normalizeStats(parsed.stats),
    today: normalizeStats(parsed.today),
  }
}

function normalizeBreakdownRow(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const provider = raw.provider || ''
  const model = raw.model || ''
  if (!provider && !model) return null
  return {
    key: `${provider}/${model}/${idx}`,
    provider: String(provider),
    model: String(model),
    calls: num(raw.calls, 0),
    inputTokens: num(raw.input_tokens ?? raw.inputTokens, 0),
    outputTokens: num(raw.output_tokens ?? raw.outputTokens, 0),
    totalTokens: num(raw.total_tokens ?? raw.totalTokens, 0),
    costUsd: num(raw.cost_usd ?? raw.costUsd, 0),
    _idx: idx,
  }
}

/** Parse `cc tokens breakdown --json` — array sorted by cost desc by lib. */
export function parseBreakdown(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeBreakdownRow).filter(Boolean)
}

function normalizeRecentRow(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    provider: String(raw.provider || ''),
    model: String(raw.model || ''),
    inputTokens: num(raw.input_tokens ?? raw.inputTokens, 0),
    outputTokens: num(raw.output_tokens ?? raw.outputTokens, 0),
    totalTokens: num(raw.total_tokens ?? raw.totalTokens, 0),
    costUsd: num(raw.cost_usd ?? raw.costUsd, 0),
    responseTimeMs: num(raw.response_time_ms ?? raw.responseTimeMs, 0),
    endpoint: String(raw.endpoint || ''),
    createdAt: raw.created_at ?? raw.createdAt ?? '',
    _idx: idx,
  }
}

/** Parse `cc tokens recent --json`. */
export function parseRecent(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeRecentRow).filter(Boolean)
}

const CACHE_DEFAULTS = {
  totalEntries: 0,
  totalHits: 0,
  totalTokensSaved: 0,
  expiredEntries: 0,
}

/** Parse `cc tokens cache --json`. Always returns full pre-keyed shape. */
export function parseCacheStats(output) {
  const result = { ...CACHE_DEFAULTS }
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
  result.totalEntries = num(parsed.total_entries ?? parsed.totalEntries, 0)
  result.totalHits = num(parsed.total_hits ?? parsed.totalHits, 0)
  result.totalTokensSaved = num(parsed.total_tokens_saved ?? parsed.totalTokensSaved, 0)
  result.expiredEntries = num(parsed.expired_entries ?? parsed.expiredEntries, 0)
  return result
}

const STATS_V2_DEFAULTS = {
  totalBudgetsV2: 0,
  totalRecordsV2: 0,
  maxActiveBudgetsPerOwner: 0,
  maxPendingRecordsPerBudget: 0,
  budgetIdleMs: 0,
  recordStuckMs: 0,
  budgetsByStatus: {},
  recordsByStatus: {},
}

/** Parse `cc tokens stats-v2`. Always returns full pre-keyed shape. */
export function parseStatsV2(output) {
  const result = JSON.parse(JSON.stringify(STATS_V2_DEFAULTS))
  for (const s of BUDGET_MATURITIES_V2) result.budgetsByStatus[s] = 0
  for (const s of USAGE_RECORD_LIFECYCLES_V2) result.recordsByStatus[s] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.totalBudgetsV2 = num(parsed.totalBudgetsV2, 0)
  result.totalRecordsV2 = num(parsed.totalRecordsV2, 0)
  result.maxActiveBudgetsPerOwner = num(parsed.maxActiveBudgetsPerOwner, 0)
  result.maxPendingRecordsPerBudget = num(parsed.maxPendingRecordsPerBudget, 0)
  result.budgetIdleMs = num(parsed.budgetIdleMs, 0)
  result.recordStuckMs = num(parsed.recordStuckMs, 0)

  if (parsed.budgetsByStatus && typeof parsed.budgetsByStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.budgetsByStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.budgetsByStatus[k] = v
    }
  }
  if (parsed.recordsByStatus && typeof parsed.recordsByStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.recordsByStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.recordsByStatus[k] = v
    }
  }
  return result
}

/**
 * Format a sqlite `datetime('now')` string ("YYYY-MM-DD HH:MM:SS") or
 * an ISO/numeric timestamp; em-dash on null, raw passthrough on parse fail.
 */
export function formatTokensTime(ts) {
  if (ts == null || ts === '') return '—'
  const s = String(ts)
  const iso = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') + 'Z' : s
  const d = typeof ts === 'number' ? new Date(ts) : new Date(iso)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** Format a USD cost — auto-precision: 4 decimals if < $1, else 2. */
export function formatCost(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return '$0'
  return '$' + (Math.abs(usd) < 1 ? usd.toFixed(4) : usd.toFixed(2))
}
