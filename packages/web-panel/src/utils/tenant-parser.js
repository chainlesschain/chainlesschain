/**
 * tenant-parser.js — Pure parsers for `cc tenant ...` CLI output.
 *
 * Multi-tenant SaaS: tenants + subscriptions + usage metering + plan
 * quotas. Lib output is already camelCase via `_strip()`, so parsers
 * are mostly direct passthrough with sensible defaults + lowercase
 * status normalization.
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

export const PLAN_IDS = Object.freeze(['free', 'starter', 'pro', 'enterprise'])
export const TENANT_STATUSES = Object.freeze(['active', 'suspended', 'deleted'])
export const SUBSCRIPTION_STATUSES = Object.freeze([
  'active', 'cancelled', 'expired', 'past_due',
])
export const KNOWN_METRICS = Object.freeze(['api_calls', 'storage_bytes', 'ai_requests'])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizePlan(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  const quotas = raw.quotas && typeof raw.quotas === 'object' ? { ...raw.quotas } : {}
  return {
    key: id,
    id,
    name: String(raw.name || id),
    monthlyFee: raw.monthlyFee == null ? null : num(raw.monthlyFee, null),
    quotas,
    features: Array.isArray(raw.features) ? raw.features.filter(s => typeof s === 'string') : [],
    _idx: idx,
  }
}

/** Parse `cc tenant plans --json`. */
export function parsePlans(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizePlan).filter(Boolean)
}

function normalizeMetric(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || id),
    unit: String(raw.unit || ''),
    _idx: idx,
  }
}

/** Parse `cc tenant metrics --json`. */
export function parseMetrics(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeMetric).filter(Boolean)
}

function normalizeTenant(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || ''),
    slug: String(raw.slug || ''),
    config: raw.config ?? null,
    status: String(raw.status || 'active').toLowerCase(),
    plan: String(raw.plan || 'free').toLowerCase(),
    dbPath: raw.dbPath || null,
    ownerId: raw.ownerId || '',
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    deletedAt: raw.deletedAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc tenant list --json`. */
export function parseTenants(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeTenant).filter(Boolean)
}

/** Parse `cc tenant show <id> --json` or single-record envelope. */
export function parseTenant(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeTenant(parsed, 0)
}

function normalizeSubscription(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    tenantId: String(raw.tenantId || ''),
    plan: String(raw.plan || 'free').toLowerCase(),
    status: String(raw.status || 'active').toLowerCase(),
    startedAt: raw.startedAt ?? null,
    expiresAt: raw.expiresAt ?? null,
    cancelledAt: raw.cancelledAt ?? null,
    paymentMethod: raw.paymentMethod || null,
    amount: raw.amount == null ? null : num(raw.amount, null),
    createdAt: raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc tenant subscriptions --json`. */
export function parseSubscriptions(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeSubscription).filter(Boolean)
}

/**
 * Parse `cc tenant check-quota <tenant-id> <metric> --json`.
 * Envelope: `{tenantId, plan, metric, period, limit, used, remaining,
 * unlimited, exceeded}`.
 */
export function parseQuotaResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    tenantId: String(parsed.tenantId || ''),
    plan: String(parsed.plan || 'free').toLowerCase(),
    metric: String(parsed.metric || ''),
    period: String(parsed.period || ''),
    limit: parsed.limit == null ? null : num(parsed.limit, null),
    used: num(parsed.used, 0),
    remaining: parsed.remaining == null ? null : num(parsed.remaining, null),
    unlimited: !!parsed.unlimited,
    exceeded: !!parsed.exceeded,
  }
}

/**
 * Parse `cc tenant usage <tenant-id> --json`. Returns aggregated
 * `{byMetric, total, ...}` or null on failure. Doesn't try to enumerate
 * fields aggressively since the shape varies by filters.
 */
export function parseUsage(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    tenantId: parsed.tenantId || null,
    period: parsed.period || null,
    byMetric: parsed.byMetric && typeof parsed.byMetric === 'object' ? { ...parsed.byMetric } : {},
    records: Array.isArray(parsed.records) ? parsed.records : [],
    total: num(parsed.total, 0),
  }
}

const STATS_DEFAULTS = {
  tenantCount: 0,
  byStatus: { active: 0, suspended: 0, deleted: 0 },
  byPlan: { free: 0, starter: 0, pro: 0, enterprise: 0 },
  subscriptionCount: 0,
  activeSubscriptions: 0,
  usageRecordCount: 0,
  totalUsage: { api_calls: 0, storage_bytes: 0, ai_requests: 0 },
}

/** Parse `cc tenant stats --json`. Always returns full pre-keyed shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.tenantCount = num(parsed.tenantCount, 0)
  result.subscriptionCount = num(parsed.subscriptionCount, 0)
  result.activeSubscriptions = num(parsed.activeSubscriptions, 0)
  result.usageRecordCount = num(parsed.usageRecordCount, 0)

  if (parsed.byStatus && typeof parsed.byStatus === 'object') {
    for (const k of Object.keys(result.byStatus)) {
      result.byStatus[k] = num(parsed.byStatus[k], 0)
    }
  }
  if (parsed.byPlan && typeof parsed.byPlan === 'object') {
    for (const k of Object.keys(result.byPlan)) {
      result.byPlan[k] = num(parsed.byPlan[k], 0)
    }
  }
  if (parsed.totalUsage && typeof parsed.totalUsage === 'object') {
    for (const k of Object.keys(result.totalUsage)) {
      result.totalUsage[k] = num(parsed.totalUsage[k], 0)
    }
  }
  return result
}

/** Format numeric ms timestamp; em-dash on null/empty. */
export function formatTenantTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** Pretty-format storage_bytes values into KB/MB/GB. */
export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—'
  if (n === 0) return '0'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Format current month period as YYYY-MM. */
export function currentPeriod(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
