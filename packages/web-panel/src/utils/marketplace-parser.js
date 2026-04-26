/**
 * marketplace-parser.js — Pure parsers for `cc marketplace ...` CLI output.
 *
 * Reuses `stripCliNoise` from community-parser so the same noise-stripping
 * heuristic stays in one place.
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

export const SERVICE_STATUSES = Object.freeze(['draft', 'published', 'deprecated', 'suspended'])
export const INVOCATION_STATUSES = Object.freeze(['pending', 'running', 'success', 'failed', 'timeout'])

export const STATS_DEFAULTS = Object.freeze({
  total: 0,
  counts: { success: 0, failed: 0, timeout: 0, pending: 0, running: 0 },
  successRate: 0,
  avgDurationMs: 0,
  scopedToService: null,
})

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizeService(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || ''),
    version: String(raw.version || ''),
    description: String(raw.description || ''),
    endpoint: raw.endpoint || '',
    pricing: raw.pricing ?? null,
    status: String(raw.status || 'draft').toLowerCase(),
    owner: raw.owner || '',
    invocationCount: num(raw.invocationCount ?? raw.invocation_count, 0),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    _idx: idx,
  }
}

/**
 * Parse `cc marketplace list --json`. Returns [] on parse failure or empty
 * payload.
 */
export function parseServices(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeService).filter(Boolean)
}

/**
 * Parse `cc marketplace show <id> --json` or the JSON envelope returned by
 * `cc marketplace publish <name> --json`. Returns null on failure.
 */
export function parseService(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeService(parsed, 0)
}

function normalizeInvocation(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    serviceId: raw.serviceId || raw.service_id || '',
    callerId: raw.callerId || raw.caller_id || '',
    input: raw.input ?? null,
    output: raw.output ?? null,
    status: String(raw.status || 'success').toLowerCase(),
    durationMs: raw.durationMs ?? raw.duration_ms ?? null,
    error: raw.error || '',
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    _idx: idx,
  }
}

/**
 * Parse `cc marketplace invocations --json`.
 */
export function parseInvocations(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeInvocation).filter(Boolean)
}

/**
 * Parse `cc marketplace stats --json`. Always returns a complete stats
 * object so the UI cards have stable values.
 */
export function parseStats(output) {
  const result = {
    total: 0,
    counts: { success: 0, failed: 0, timeout: 0, pending: 0, running: 0 },
    successRate: 0,
    avgDurationMs: 0,
    scopedToService: null,
  }
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.total = num(parsed.total, 0)
  result.successRate = num(parsed.successRate ?? parsed.success_rate, 0)
  result.avgDurationMs = num(parsed.avgDurationMs ?? parsed.avg_duration_ms, 0)
  result.scopedToService = parsed.scopedToService ?? parsed.scoped_to_service ?? null

  const c = parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {}
  for (const key of Object.keys(result.counts)) {
    result.counts[key] = num(c[key], 0)
  }
  return result
}

/**
 * Format a marketplace timestamp. Marketplace stores numeric ms since epoch,
 * but tolerate ISO strings just in case the CLI shape ever changes.
 */
export function formatMarketplaceTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
