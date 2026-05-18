/**
 * compliance-parser.js — Pure parsers for `cc compliance threat-intel` and
 * `cc compliance ueba` CLI output.
 *
 * threat-intel rows are already normalized to camelCase by the CLI's
 * `_rowToIndicator` helper, so list/match parsers are mostly passthrough.
 * UEBA top output is also camelCase from `rankEntities`.
 *
 * Reuses `stripCliNoise` from community-parser. UEBA gracefully degrades
 * to empty arrays when audit_log table is missing (fresh installs).
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

export const IOC_TYPES = Object.freeze([
  'file-md5', 'file-sha1', 'file-sha256', 'file-sha512',
  'ipv4', 'ipv6', 'domain', 'url', 'email',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizeIndicator(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  const labels = Array.isArray(raw.labels) ? raw.labels : []
  return {
    key: id,
    id,
    type: String(raw.type || ''),
    value: String(raw.value || ''),
    labels,
    confidence: raw.confidence != null ? num(raw.confidence, null) : null,
    sourceId: raw.sourceId ?? raw.source_id ?? null,
    sourceName: raw.sourceName ?? raw.source_name ?? null,
    validFrom: raw.validFrom ?? raw.valid_from ?? null,
    validUntil: raw.validUntil ?? raw.valid_until ?? null,
    firstSeenAt: raw.firstSeenAt ?? raw.first_seen_at ?? null,
    lastSeenAt: raw.lastSeenAt ?? raw.last_seen_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc compliance threat-intel list --json`. */
export function parseIndicators(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeIndicator).filter(Boolean)
}

/**
 * Parse `cc compliance threat-intel match <observable> --json`.
 * Returns `{matched, type, indicator?}` or null on failure.
 */
export function parseMatchResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    matched: !!parsed.matched,
    type: String(parsed.type || 'unknown'),
    indicator: parsed.indicator ? normalizeIndicator(parsed.indicator) : null,
  }
}

/** Parse `cc compliance threat-intel stats --json`. */
export function parseThreatIntelStats(output) {
  const result = { total: 0, byType: {} }
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
  result.total = num(parsed.total, 0)
  if (parsed.byType && typeof parsed.byType === 'object') {
    for (const [k, v] of Object.entries(parsed.byType)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byType[k] = v
    }
  }
  return result
}

function normalizeUebaEntity(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const entity = raw.entity || ''
  if (!entity) return null
  return {
    key: entity,
    entity,
    eventCount: num(raw.eventCount ?? raw.event_count, 0),
    failureRate: num(raw.failureRate ?? raw.failure_rate, 0),
    uniqueResources: num(raw.uniqueResources ?? raw.unique_resources, 0),
    uniqueActions: num(raw.uniqueActions ?? raw.unique_actions, 0),
    burstiness: num(raw.burstiness, 0),
    riskScore: num(raw.riskScore ?? raw.risk_score, 0),
    _idx: idx,
  }
}

/**
 * Parse `cc compliance ueba top --json`. Returns [] on parse failure or
 * when audit_log table is missing (fresh install). Caller can detect the
 * missing-audit-log state via the `noAuditLog` flag from `detectUebaError`.
 */
export function parseUebaTop(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeUebaEntity).filter(Boolean)
}

function normalizeAnomaly(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  return {
    key: idx,
    score: num(raw.score, 0),
    reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
    event: raw.event && typeof raw.event === 'object' ? raw.event : null,
    _idx: idx,
  }
}

/** Parse `cc compliance ueba analyze --json`. */
export function parseAnomalies(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeAnomaly).filter(Boolean)
}

/**
 * Detect the "audit_log table missing" condition that UEBA commands hit
 * on fresh installs (no audit events recorded yet). Returns true when
 * the CLI emitted the well-known sqlite error.
 *
 * NOTE: deliberately checks the *raw* output, not the noise-stripped form,
 * because `stripCliNoise` filters out the `✖ Failed: ...` status-icon line
 * where this error always appears.
 */
export function detectUebaError(output) {
  if (!output) return { noAuditLog: false, error: '' }
  const noAuditLog = /no such table:\s*audit_log/i.test(output)
  const failedMatch = output.match(/Failed:\s*(.+?)(?:\r?\n|$)/i)
  return {
    noAuditLog,
    error: failedMatch ? failedMatch[1].trim() : '',
  }
}

/** Format an ISO-8601 string from threat-intel `last_seen_at`; em-dash empty. */
export function formatComplianceTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
