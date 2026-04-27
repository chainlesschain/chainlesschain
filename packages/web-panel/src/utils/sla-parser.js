/**
 * sla-parser.js — Pure parsers for `cc sla ...` CLI output.
 *
 * Most SLA commands accept `--json` and emit camelCase JS objects from
 * lib's in-memory Maps backed by sqlite. The DB-backed commands
 * (`create/list/show/terminate/record/metrics/check/violations/compensate/
 * report/stats-v2`) call `_dbFromCtx` which logs "Database not available"
 * + exits 1 outside a project — `detectSlaError` catches that for the
 * noDb banner.
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

export const SLA_TIER_NAMES = Object.freeze(['gold', 'silver', 'bronze'])

export const SLA_STATUSES = Object.freeze(['active', 'expired', 'terminated'])

export const SLA_TERMS_LIST = Object.freeze([
  'availability', 'response_time', 'throughput', 'error_rate',
])

export const VIOLATION_SEVERITIES = Object.freeze([
  'minor', 'moderate', 'major', 'critical',
])

export const VIOLATION_STATUSES = Object.freeze([
  'open', 'acknowledged', 'resolved', 'waived',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Detect "Database not available" — emitted by `_dbFromCtx` outside a
 * chainlesschain project.
 */
export function detectSlaError(output) {
  if (!output) return { noDb: false, error: '' }
  const cleaned = stripCliNoise(output)
  const noDb = /Database not available/i.test(cleaned)
  return {
    noDb,
    error: noDb ? 'Database not available' : '',
  }
}

function normalizeTier(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const name = raw.name || ''
  if (!name) return null
  return {
    key: name,
    name,
    availability: num(raw.availability, 0),
    maxResponseTime: num(raw.maxResponseTime, 0),
    minThroughput: num(raw.minThroughput, 0),
    maxErrorRate: num(raw.maxErrorRate, 0),
    compensationRate: num(raw.compensationRate, 0),
    _idx: idx,
  }
}

/** Parse `cc sla tiers --json`. */
export function parseTiers(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeTier).filter(Boolean)
}

/** Parse a JSON array of strings (e.g. `cc sla statuses` / `severities`). */
export function parseStringList(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(s => typeof s === 'string')
}

function safeTermsObject(t) {
  const base = {
    availability: 0,
    maxResponseTime: 0,
    minThroughput: 0,
    maxErrorRate: 0,
    compensationRate: 0,
  }
  if (!t || typeof t !== 'object' || Array.isArray(t)) return base
  return {
    availability: num(t.availability, 0),
    maxResponseTime: num(t.maxResponseTime, 0),
    minThroughput: num(t.minThroughput, 0),
    maxErrorRate: num(t.maxErrorRate, 0),
    compensationRate: num(t.compensationRate, 0),
  }
}

function normalizeContract(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const slaId = raw.slaId || raw.sla_id || ''
  if (!slaId) return null
  return {
    key: slaId,
    slaId,
    orgId: String(raw.orgId ?? raw.org_id ?? ''),
    tier: String(raw.tier || '').toLowerCase(),
    terms: safeTermsObject(raw.terms),
    monthlyFee: num(raw.monthlyFee ?? raw.monthly_fee, 0),
    startDate: raw.startDate ?? raw.start_date ?? null,
    endDate: raw.endDate ?? raw.end_date ?? null,
    status: String(raw.status || 'active').toLowerCase(),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc sla list --json`. */
export function parseContracts(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeContract).filter(Boolean)
}

/** Parse `cc sla show <sla-id> --json` / `create --json`. */
export function parseContract(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeContract(parsed, 0)
}

function normalizeAggregate(agg) {
  if (!agg || typeof agg !== 'object') return null
  return {
    count: num(agg.count, 0),
    mean: num(agg.mean, 0),
    min: num(agg.min, 0),
    max: num(agg.max, 0),
    p95: num(agg.p95, 0),
  }
}

/** Parse `cc sla metrics <sla-id> --json`. */
export function parseMetrics(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { slaId: '', totalSamples: 0, byTerm: {} }
  }
  const byTerm = {}
  if (parsed.byTerm && typeof parsed.byTerm === 'object') {
    for (const [term, agg] of Object.entries(parsed.byTerm)) {
      const n = normalizeAggregate(agg)
      if (n) byTerm[term] = n
    }
  }
  return {
    slaId: String(parsed.slaId || ''),
    totalSamples: num(parsed.totalSamples, 0),
    byTerm,
  }
}

function normalizeViolation(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const violationId = raw.violationId || raw.violation_id || ''
  if (!violationId) return null
  return {
    key: violationId,
    violationId,
    slaId: String(raw.slaId ?? raw.sla_id ?? ''),
    term: String(raw.term || '').toLowerCase(),
    severity: String(raw.severity || 'minor').toLowerCase(),
    expectedValue: num(raw.expectedValue ?? raw.expected_value, 0),
    actualValue: num(raw.actualValue ?? raw.actual_value, 0),
    deviationPercent: num(raw.deviationPercent ?? raw.deviation_percent, 0),
    compensationAmount: typeof raw.compensationAmount === 'number'
      ? raw.compensationAmount
      : (typeof raw.compensation_amount === 'number' ? raw.compensation_amount : null),
    occurredAt: raw.occurredAt ?? raw.occurred_at ?? null,
    resolvedAt: raw.resolvedAt ?? raw.resolved_at ?? null,
    v2Status: raw.v2Status ? String(raw.v2Status).toLowerCase() : 'open',
    v2Note: raw.v2Note ?? '',
    _idx: idx,
  }
}

/** Parse `cc sla violations --json`. */
export function parseViolations(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeViolation).filter(Boolean)
}

/** Parse `cc sla check <sla-id> --json`. */
export function parseCheckResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { slaId: '', checkedAt: null, totalViolations: 0, violations: [] }
  }
  return {
    slaId: String(parsed.slaId || ''),
    checkedAt: parsed.checkedAt ?? null,
    totalViolations: num(parsed.totalViolations, 0),
    violations: Array.isArray(parsed.violations)
      ? parsed.violations.map(normalizeViolation).filter(Boolean)
      : [],
  }
}

/** Parse `cc sla compensate <violation-id> --json`. */
export function parseCompensation(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    violationId: String(parsed.violationId || ''),
    slaId: String(parsed.slaId || ''),
    severity: String(parsed.severity || ''),
    base: num(parsed.base, 0),
    multiplier: num(parsed.multiplier, 0),
    amount: num(parsed.amount, 0),
  }
}

const REPORT_DEFAULTS = {
  slaId: '',
  tier: '',
  compliance: 0,
  startDate: null,
  endDate: null,
  metricsByTerm: {},
  violations: { total: 0, byTerm: {}, bySeverity: {}, totalCompensation: 0 },
}

/** Parse `cc sla report <sla-id> --json`. */
export function parseReport(output) {
  const result = JSON.parse(JSON.stringify(REPORT_DEFAULTS))
  for (const t of SLA_TERMS_LIST) result.violations.byTerm[t] = 0
  for (const s of VIOLATION_SEVERITIES) result.violations.bySeverity[s] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.slaId = String(parsed.slaId || '')
  result.tier = String(parsed.tier || '').toLowerCase()
  result.compliance = num(parsed.compliance, 0)
  result.startDate = parsed.startDate ?? null
  result.endDate = parsed.endDate ?? null

  if (parsed.metricsByTerm && typeof parsed.metricsByTerm === 'object') {
    for (const [term, agg] of Object.entries(parsed.metricsByTerm)) {
      const n = normalizeAggregate(agg)
      if (n) result.metricsByTerm[term] = n
    }
  }
  if (parsed.violations && typeof parsed.violations === 'object') {
    result.violations.total = num(parsed.violations.total, 0)
    result.violations.totalCompensation = num(parsed.violations.totalCompensation, 0)
    if (parsed.violations.byTerm && typeof parsed.violations.byTerm === 'object') {
      for (const [k, v] of Object.entries(parsed.violations.byTerm)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.violations.byTerm[k] = v
      }
    }
    if (parsed.violations.bySeverity && typeof parsed.violations.bySeverity === 'object') {
      for (const [k, v] of Object.entries(parsed.violations.bySeverity)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.violations.bySeverity[k] = v
      }
    }
  }
  return result
}

const STATS_V2_DEFAULTS = {
  totalContracts: 0,
  activeContracts: 0,
  activeOrgs: 0,
  maxActiveSlasPerOrg: 0,
  byStatus: {},
  byTier: {},
  violations: {
    total: 0,
    byTerm: {},
    bySeverity: {},
    byStatus: {},
    totalCompensation: 0,
  },
}

/** Parse `cc sla stats-v2 --json`. Always returns full pre-keyed shape. */
export function parseStatsV2(output) {
  const result = JSON.parse(JSON.stringify(STATS_V2_DEFAULTS))
  for (const s of SLA_STATUSES) result.byStatus[s] = 0
  for (const t of SLA_TIER_NAMES) result.byTier[t] = 0
  for (const t of SLA_TERMS_LIST) result.violations.byTerm[t] = 0
  for (const s of VIOLATION_SEVERITIES) result.violations.bySeverity[s] = 0
  for (const s of VIOLATION_STATUSES) result.violations.byStatus[s] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.totalContracts = num(parsed.totalContracts, 0)
  result.activeContracts = num(parsed.activeContracts, 0)
  result.activeOrgs = num(parsed.activeOrgs, 0)
  result.maxActiveSlasPerOrg = num(parsed.maxActiveSlasPerOrg, 0)

  if (parsed.byStatus && typeof parsed.byStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.byStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byStatus[k] = v
    }
  }
  if (parsed.byTier && typeof parsed.byTier === 'object') {
    for (const [k, v] of Object.entries(parsed.byTier)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byTier[k] = v
    }
  }
  if (parsed.violations && typeof parsed.violations === 'object') {
    result.violations.total = num(parsed.violations.total, 0)
    result.violations.totalCompensation = num(parsed.violations.totalCompensation, 0)
    for (const dim of ['byTerm', 'bySeverity', 'byStatus']) {
      if (parsed.violations[dim] && typeof parsed.violations[dim] === 'object') {
        for (const [k, v] of Object.entries(parsed.violations[dim])) {
          if (typeof v === 'number' && Number.isFinite(v)) result.violations[dim][k] = v
        }
      }
    }
  }
  return result
}

/** Format numeric ms timestamp; em-dash on null/empty. */
export function formatSlaTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
