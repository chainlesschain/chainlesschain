/**
 * federation-parser.js — Pure parsers for `cc federation ...` CLI output.
 *
 * Federation Hardening (Phase 58) covers 3 surfaces backed by a common node
 * registry: circuit breakers (closed/open/half_open FSM with failure +
 * success counters), health checks (5 metric types × 4 statuses, with a
 * derived per-node aggregate), and connection pools (in-memory simulation
 * with active/idle counters + waiting queue).
 *
 * Lib emits sqlite-derived breaker / check rows in snake_case
 * (`node_id`, `failure_count`, `last_failure_time`, `state_changed_at`,
 * `check_id`, `check_type`, `checked_at`); pools and stats are already
 * camelCase from the in-memory shape; node-health aggregate is camelCase
 * with `latestChecks` (array of `{checkType, status, checkedAt}`).
 *
 * Action mutations all return uniform success / failure envelopes:
 *   - register/remove → {registered|removed, nodeId|reason}
 *   - failure/success → {updated, state, previousState, failureCount|successCount, reason?}
 *   - half-open       → {updated, state, reason?, remainingMs?}
 *   - reset           → {reset, state, reason?}
 *   - check           → {recorded, checkId, reason?}
 *   - pool-init       → {initialized, nodeId, reason?}
 *   - pool-acquire    → {acquired, active, idle, reason?, waiting?}
 *   - pool-release    → {released, active, idle, reason?}
 *   - pool-destroy    → {destroyed, reason?}
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

export const CIRCUIT_STATES = Object.freeze(['closed', 'open', 'half_open'])

export const HEALTH_STATUSES = Object.freeze([
  'healthy', 'degraded', 'unhealthy', 'unknown',
])

export const HEALTH_METRICS = Object.freeze([
  'heartbeat', 'latency', 'success_rate', 'cpu_usage', 'memory_usage',
])

export const NODE_STATUSES_V2 = Object.freeze([
  'registered', 'active', 'isolated', 'decommissioned',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Parse a JSON array of strings (catalog enum endpoints). */
export function parseStringList(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(s => typeof s === 'string')
}

function normalizeBreaker(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const nodeId = raw.node_id ?? raw.nodeId ?? ''
  if (!nodeId) return null
  const state = String(raw.state || 'closed').toLowerCase()
  return {
    key: nodeId,
    nodeId,
    state,
    failureCount: num(raw.failure_count ?? raw.failureCount, 0),
    successCount: num(raw.success_count ?? raw.successCount, 0),
    failureThreshold: num(raw.failure_threshold ?? raw.failureThreshold, 0),
    successThreshold: num(raw.success_threshold ?? raw.successThreshold, 0),
    openTimeout: num(raw.open_timeout ?? raw.openTimeout, 0),
    lastFailureTime: raw.last_failure_time ?? raw.lastFailureTime ?? null,
    lastSuccessTime: raw.last_success_time ?? raw.lastSuccessTime ?? null,
    stateChangedAt: raw.state_changed_at ?? raw.stateChangedAt ?? null,
    metadata: raw.metadata ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    updatedAt: raw.updated_at ?? raw.updatedAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc federation breakers --json`. */
export function parseBreakers(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeBreaker).filter(Boolean)
}

/** Parse `cc federation breaker-show <nodeId> --json`. */
export function parseBreaker(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeBreaker(parsed, 0)
}

function normalizeCheck(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const checkId = raw.check_id ?? raw.checkId ?? ''
  if (!checkId) return null
  return {
    key: checkId,
    checkId,
    nodeId: raw.node_id ?? raw.nodeId ?? '',
    checkType: String(raw.check_type ?? raw.checkType ?? '').toLowerCase(),
    status: String(raw.status || 'unknown').toLowerCase(),
    metrics: raw.metrics ?? null,
    checkedAt: raw.checked_at ?? raw.checkedAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc federation checks --json`. */
export function parseChecks(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeCheck).filter(Boolean)
}

/** Parse `cc federation check-show <checkId> --json`. */
export function parseCheck(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeCheck(parsed, 0)
}

function normalizePool(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const nodeId = raw.nodeId ?? raw.node_id ?? ''
  if (!nodeId) return null
  return {
    key: nodeId,
    nodeId,
    minConnections: num(raw.minConnections, 0),
    maxConnections: num(raw.maxConnections, 0),
    idleTimeout: num(raw.idleTimeout, 0),
    activeConnections: num(raw.activeConnections, 0),
    idleConnections: num(raw.idleConnections, 0),
    totalCreated: num(raw.totalCreated, 0),
    totalDestroyed: num(raw.totalDestroyed, 0),
    waitingRequests: num(raw.waitingRequests, 0),
    createdAt: raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc federation pools --json`. */
export function parsePools(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizePool).filter(Boolean)
}

/** Parse `cc federation pool-stats <nodeId> --json`. */
export function parsePool(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizePool(parsed, 0)
}

/** Parse `cc federation node-health <nodeId> --json`. */
export function parseNodeHealth(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { nodeId: '', status: 'unknown', checks: 0, latestChecks: [] }
  }
  const latestRaw = Array.isArray(parsed.latestChecks) ? parsed.latestChecks : []
  const latestChecks = latestRaw
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      checkType: String(c.checkType ?? c.check_type ?? '').toLowerCase(),
      status: String(c.status || 'unknown').toLowerCase(),
      checkedAt: c.checkedAt ?? c.checked_at ?? null,
    }))
  return {
    nodeId: parsed.nodeId ?? parsed.node_id ?? '',
    status: String(parsed.status || 'unknown').toLowerCase(),
    checks: num(parsed.checks, 0),
    latestChecks,
  }
}

/** Parse register / pool-init / check envelopes (`{registered|recorded|initialized, nodeId|checkId, reason?}`). */
export function parseRegisterResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, id: null, reason: '' }
  }
  const ok = !!(parsed.registered || parsed.recorded || parsed.initialized)
  const id = parsed.nodeId ?? parsed.checkId ?? null
  return {
    ok,
    id: id ? String(id) : null,
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

/** Parse breaker transition envelopes (failure/success/half-open/reset). */
export function parseTransitionResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false, state: '', previousState: '',
      failureCount: 0, successCount: 0, remainingMs: 0, reason: '',
    }
  }
  const ok = !!(parsed.updated || parsed.reset)
  return {
    ok,
    state: String(parsed.state || ''),
    previousState: String(parsed.previousState || ''),
    failureCount: num(parsed.failureCount, 0),
    successCount: num(parsed.successCount, 0),
    remainingMs: num(parsed.remainingMs, 0),
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

/** Parse pool-acquire/release/destroy envelopes. */
export function parsePoolActionResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, active: 0, idle: 0, waiting: 0, reason: '' }
  }
  const ok = !!(parsed.acquired || parsed.released || parsed.destroyed)
  return {
    ok,
    active: num(parsed.active, 0),
    idle: num(parsed.idle, 0),
    waiting: num(parsed.waiting, 0),
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

/** Parse remove envelope (`{removed, reason?}`). */
export function parseRemoveResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: '' }
  }
  return {
    ok: !!parsed.removed,
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

const STATS_DEFAULTS = {
  circuitBreakers: { total: 0, byState: {} },
  healthChecks: { total: 0, byStatus: {} },
  connectionPools: { total: 0, totalActive: 0, totalIdle: 0, totalConnections: 0 },
}

/** Parse `cc federation stats --json`. Always returns full pre-keyed shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  for (const s of CIRCUIT_STATES) result.circuitBreakers.byState[s] = 0
  for (const s of HEALTH_STATUSES) result.healthChecks.byStatus[s] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  if (parsed.circuitBreakers && typeof parsed.circuitBreakers === 'object') {
    result.circuitBreakers.total = num(parsed.circuitBreakers.total, 0)
    if (parsed.circuitBreakers.byState && typeof parsed.circuitBreakers.byState === 'object') {
      for (const [k, v] of Object.entries(parsed.circuitBreakers.byState)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.circuitBreakers.byState[k] = v
      }
    }
  }
  if (parsed.healthChecks && typeof parsed.healthChecks === 'object') {
    result.healthChecks.total = num(parsed.healthChecks.total, 0)
    if (parsed.healthChecks.byStatus && typeof parsed.healthChecks.byStatus === 'object') {
      for (const [k, v] of Object.entries(parsed.healthChecks.byStatus)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.healthChecks.byStatus[k] = v
      }
    }
  }
  if (parsed.connectionPools && typeof parsed.connectionPools === 'object') {
    result.connectionPools.total = num(parsed.connectionPools.total, 0)
    result.connectionPools.totalActive = num(parsed.connectionPools.totalActive, 0)
    result.connectionPools.totalIdle = num(parsed.connectionPools.totalIdle, 0)
    result.connectionPools.totalConnections = num(parsed.connectionPools.totalConnections, 0)
  }
  return result
}

/** Format a numeric ms timestamp; em-dash on null/empty. */
export function formatFedTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
