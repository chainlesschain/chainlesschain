/**
 * audit-parser.js — Pure parsers for `cc audit ...` CLI output.
 *
 * Most audit commands accept `--json`. The DB-backed ones (`log/search/
 * stats/export/purge`) call bootstrap + check `ctx.db` and log
 * "Database not available" + exit 1 outside a project — `detectAuditError`
 * catches that for the noDb banner.
 *
 * Lib `queryLogs()` returns sqlite `SELECT *` rows (snake_case columns),
 * so this parser normalizes to camelCase. `details` is auto-decoded JSON
 * (already a parsed object from the lib). `success` is boolean (lib coerces).
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

export const EVENT_TYPES = Object.freeze([
  'auth', 'permission', 'data', 'system', 'file', 'did', 'crypto', 'api',
])

export const RISK_LEVELS = Object.freeze([
  'low', 'medium', 'high', 'critical',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Detect the "Database not available" condition that DB-backed audit
 * commands hit when run outside a chainlesschain project.
 */
export function detectAuditError(output) {
  if (!output) return { noDb: false, error: '' }
  const cleaned = stripCliNoise(output)
  const noDb = /Database not available/i.test(cleaned)
  return {
    noDb,
    error: noDb ? 'Database not available' : '',
  }
}

function normalizeLog(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null

  // `details` may be a parsed object (from lib) OR a JSON string fallback.
  let details = raw.details
  if (typeof details === 'string' && details) {
    try { details = JSON.parse(details) } catch { /* keep as string */ }
  }

  // `success` may arrive as 0/1 (sqlite int) or boolean (lib-normalized).
  const success = typeof raw.success === 'boolean'
    ? raw.success
    : raw.success === 1 || raw.success === '1' || raw.success === true

  return {
    key: id,
    id,
    eventType: String(raw.event_type ?? raw.eventType ?? '').toLowerCase(),
    operation: String(raw.operation || ''),
    actor: raw.actor ?? '',
    target: raw.target ?? '',
    details: details ?? null,
    riskLevel: String(raw.risk_level ?? raw.riskLevel ?? 'low').toLowerCase(),
    ipAddress: raw.ip_address ?? raw.ipAddress ?? '',
    userAgent: raw.user_agent ?? raw.userAgent ?? '',
    success,
    errorMessage: raw.error_message ?? raw.errorMessage ?? '',
    createdAt: raw.created_at ?? raw.createdAt ?? '',
    _idx: idx,
  }
}

/** Parse `cc audit log --json` / `cc audit search <q> --json`. */
export function parseLogs(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeLog).filter(Boolean)
}

const STATS_DEFAULTS = {
  total: 0,
  failures: 0,
  highRisk: 0,
  byEventType: {},
  byRiskLevel: {},
}

/** Parse `cc audit stats --json`. Always returns full pre-keyed shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  for (const t of EVENT_TYPES) result.byEventType[t] = 0
  for (const r of RISK_LEVELS) result.byRiskLevel[r] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.total = num(parsed.total, 0)
  result.failures = num(parsed.failures, 0)
  result.highRisk = num(parsed.highRisk, 0)

  if (parsed.byEventType && typeof parsed.byEventType === 'object') {
    for (const [k, v] of Object.entries(parsed.byEventType)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byEventType[k] = v
    }
  }
  if (parsed.byRiskLevel && typeof parsed.byRiskLevel === 'object') {
    for (const [k, v] of Object.entries(parsed.byRiskLevel)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byRiskLevel[k] = v
    }
  }
  return result
}

/**
 * Format an audit timestamp.
 *
 * Audit timestamps come from sqlite `datetime('now')` — a string like
 * `"2024-03-15 10:30:00"` (no T, no Z). We normalize to ISO-compatible
 * by replacing the space with T, then format. Falls back to raw string
 * on parse failure.
 */
export function formatAuditTime(ts) {
  if (ts == null || ts === '') return '—'
  const s = String(ts)
  // sqlite "YYYY-MM-DD HH:MM:SS" → ISO
  const iso = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') + 'Z' : s
  const d = new Date(iso)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('zh-CN', { hour12: false })
}
