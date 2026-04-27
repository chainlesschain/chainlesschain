/**
 * Unit tests for src/utils/federation-parser.js
 *
 * Run: npx vitest run __tests__/unit/federation-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseStringList,
  parseBreakers,
  parseBreaker,
  parseChecks,
  parseCheck,
  parsePools,
  parsePool,
  parseNodeHealth,
  parseRegisterResult,
  parseTransitionResult,
  parsePoolActionResult,
  parseRemoveResult,
  parseStats,
  formatFedTime,
  CIRCUIT_STATES,
  HEALTH_STATUSES,
  HEALTH_METRICS,
  NODE_STATUSES_V2,
} from '../../src/utils/federation-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('CIRCUIT_STATES = closed/open/half_open', () => {
    expect(CIRCUIT_STATES).toEqual(['closed', 'open', 'half_open'])
  })
  it('HEALTH_STATUSES = 4 entries', () => {
    expect(HEALTH_STATUSES).toEqual(['healthy', 'degraded', 'unhealthy', 'unknown'])
  })
  it('HEALTH_METRICS = 5 entries', () => {
    expect(HEALTH_METRICS).toEqual([
      'heartbeat', 'latency', 'success_rate', 'cpu_usage', 'memory_usage',
    ])
  })
  it('NODE_STATUSES_V2 = 4 entries', () => {
    expect(NODE_STATUSES_V2).toEqual(['registered', 'active', 'isolated', 'decommissioned'])
  })
  it('all enums frozen', () => {
    for (const e of [CIRCUIT_STATES, HEALTH_STATUSES, HEALTH_METRICS, NODE_STATUSES_V2]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── parseStringList ───────────────────────────────────────────────────────

describe('parseStringList', () => {
  it('returns empty for non-array', () => {
    expect(parseStringList('')).toEqual([])
    expect(parseStringList('{}')).toEqual([])
  })
  it('parses circuit-states catalog', () => {
    expect(parseStringList(JSON.stringify(['closed', 'open', 'half_open'])))
      .toEqual(['closed', 'open', 'half_open'])
  })
  it('strips noise wrapper', () => {
    const out = withNoise(JSON.stringify(['heartbeat', 'latency']))
    expect(parseStringList(out)).toEqual(['heartbeat', 'latency'])
  })
  it('filters out non-string entries', () => {
    expect(parseStringList(JSON.stringify(['a', 1, null, 'b'])))
      .toEqual(['a', 'b'])
  })
})

// ─── parseBreakers / parseBreaker ──────────────────────────────────────────

describe('parseBreakers', () => {
  it('returns empty for non-array input', () => {
    expect(parseBreakers('')).toEqual([])
    expect(parseBreakers('{}')).toEqual([])
  })
  it('normalizes snake_case row to camelCase', () => {
    const raw = [{
      node_id: 'n-1', state: 'open',
      failure_count: 7, success_count: 0,
      failure_threshold: 5, success_threshold: 2,
      open_timeout: 60000,
      last_failure_time: 1700000000000, last_success_time: null,
      state_changed_at: 1700000010000, metadata: null,
      created_at: 1699000000000, updated_at: 1700000010000,
    }]
    const got = parseBreakers(JSON.stringify(raw))
    expect(got.length).toBe(1)
    expect(got[0]).toMatchObject({
      key: 'n-1', nodeId: 'n-1', state: 'open',
      failureCount: 7, successCount: 0,
      failureThreshold: 5, successThreshold: 2,
      openTimeout: 60000,
      lastFailureTime: 1700000000000, lastSuccessTime: null,
      stateChangedAt: 1700000010000,
    })
  })
  it('filters rows missing node_id', () => {
    const raw = [{ node_id: 'n-1', state: 'closed' }, { state: 'open' }]
    expect(parseBreakers(JSON.stringify(raw)).length).toBe(1)
  })
  it('lowercases state', () => {
    const raw = [{ node_id: 'n-1', state: 'OPEN' }]
    expect(parseBreakers(JSON.stringify(raw))[0].state).toBe('open')
  })
  it('strips noise wrapper', () => {
    const raw = [{ node_id: 'n-1', state: 'closed' }]
    expect(parseBreakers(withNoise(JSON.stringify(raw))).length).toBe(1)
  })
  it('defaults missing numeric fields to 0', () => {
    const raw = [{ node_id: 'n-1', state: 'closed' }]
    const got = parseBreakers(JSON.stringify(raw))[0]
    expect(got.failureCount).toBe(0)
    expect(got.successCount).toBe(0)
    expect(got.failureThreshold).toBe(0)
  })
})

describe('parseBreaker', () => {
  it('returns null for non-object', () => {
    expect(parseBreaker('')).toBeNull()
    expect(parseBreaker('[]')).toBeNull()
  })
  it('normalizes single breaker', () => {
    const raw = { node_id: 'n-2', state: 'half_open', failure_count: 3 }
    expect(parseBreaker(JSON.stringify(raw))).toMatchObject({
      nodeId: 'n-2', state: 'half_open', failureCount: 3,
    })
  })
})

// ─── parseChecks / parseCheck ──────────────────────────────────────────────

describe('parseChecks', () => {
  it('returns empty for non-array input', () => {
    expect(parseChecks('')).toEqual([])
  })
  it('normalizes snake_case row', () => {
    const raw = [{
      check_id: 'c-1', node_id: 'n-1', check_type: 'heartbeat',
      status: 'healthy', metrics: '{"latencyMs":42}',
      checked_at: 1700000000000,
    }]
    const got = parseChecks(JSON.stringify(raw))
    expect(got[0]).toMatchObject({
      key: 'c-1', checkId: 'c-1', nodeId: 'n-1',
      checkType: 'heartbeat', status: 'healthy',
      metrics: '{"latencyMs":42}', checkedAt: 1700000000000,
    })
  })
  it('filters rows missing check_id', () => {
    const raw = [{ check_id: 'c-1', status: 'healthy' }, { status: 'degraded' }]
    expect(parseChecks(JSON.stringify(raw)).length).toBe(1)
  })
  it('lowercases status + check_type', () => {
    const raw = [{
      check_id: 'c-1', check_type: 'HEARTBEAT', status: 'HEALTHY',
    }]
    const got = parseChecks(JSON.stringify(raw))[0]
    expect(got.checkType).toBe('heartbeat')
    expect(got.status).toBe('healthy')
  })
})

describe('parseCheck', () => {
  it('returns null for non-object', () => {
    expect(parseCheck('[]')).toBeNull()
  })
  it('normalizes single check', () => {
    const raw = { check_id: 'c-1', node_id: 'n-1', check_type: 'latency', status: 'degraded' }
    expect(parseCheck(JSON.stringify(raw))).toMatchObject({
      checkId: 'c-1', nodeId: 'n-1', checkType: 'latency', status: 'degraded',
    })
  })
})

// ─── parsePools / parsePool ────────────────────────────────────────────────

describe('parsePools', () => {
  it('returns empty for non-array', () => {
    expect(parsePools('')).toEqual([])
  })
  it('normalizes pool already in camelCase', () => {
    const raw = [{
      nodeId: 'n-1', minConnections: 5, maxConnections: 50,
      idleTimeout: 300000, activeConnections: 3, idleConnections: 2,
      totalCreated: 5, totalDestroyed: 0, waitingRequests: 0,
      createdAt: 1700000000000,
    }]
    const got = parsePools(JSON.stringify(raw))
    expect(got[0]).toMatchObject({
      key: 'n-1', nodeId: 'n-1',
      minConnections: 5, maxConnections: 50,
      activeConnections: 3, idleConnections: 2,
      totalCreated: 5, waitingRequests: 0,
    })
  })
  it('filters rows missing nodeId', () => {
    const raw = [{ nodeId: 'n-1' }, { activeConnections: 3 }]
    expect(parsePools(JSON.stringify(raw)).length).toBe(1)
  })
  it('accepts snake_case node_id alias', () => {
    const raw = [{ node_id: 'n-snake', minConnections: 1 }]
    expect(parsePools(JSON.stringify(raw))[0].nodeId).toBe('n-snake')
  })
})

describe('parsePool', () => {
  it('returns null for non-object', () => {
    expect(parsePool('')).toBeNull()
    expect(parsePool('[]')).toBeNull()
  })
  it('normalizes single pool stat block', () => {
    const raw = { nodeId: 'n-2', activeConnections: 7, maxConnections: 50 }
    expect(parsePool(JSON.stringify(raw))).toMatchObject({
      nodeId: 'n-2', activeConnections: 7, maxConnections: 50,
    })
  })
})

// ─── parseNodeHealth ───────────────────────────────────────────────────────

describe('parseNodeHealth', () => {
  it('returns empty default for non-object', () => {
    expect(parseNodeHealth('')).toEqual({
      nodeId: '', status: 'unknown', checks: 0, latestChecks: [],
    })
  })
  it('parses unknown empty-history shape', () => {
    const raw = { nodeId: 'n-1', status: 'unknown', checks: 0 }
    expect(parseNodeHealth(JSON.stringify(raw))).toEqual({
      nodeId: 'n-1', status: 'unknown', checks: 0, latestChecks: [],
    })
  })
  it('parses aggregated worst-case status with latestChecks', () => {
    const raw = {
      nodeId: 'n-1', status: 'unhealthy', checks: 4,
      latestChecks: [
        { checkType: 'heartbeat', status: 'healthy', checkedAt: 1700000000000 },
        { checkType: 'latency', status: 'unhealthy', checkedAt: 1700000005000 },
      ],
    }
    const got = parseNodeHealth(JSON.stringify(raw))
    expect(got.nodeId).toBe('n-1')
    expect(got.status).toBe('unhealthy')
    expect(got.checks).toBe(4)
    expect(got.latestChecks.length).toBe(2)
    expect(got.latestChecks[1]).toEqual({
      checkType: 'latency', status: 'unhealthy', checkedAt: 1700000005000,
    })
  })
  it('lowercases status + checkType', () => {
    const raw = {
      nodeId: 'n-1', status: 'DEGRADED', checks: 1,
      latestChecks: [{ check_type: 'CPU_USAGE', status: 'DEGRADED', checked_at: 1 }],
    }
    const got = parseNodeHealth(JSON.stringify(raw))
    expect(got.status).toBe('degraded')
    expect(got.latestChecks[0].checkType).toBe('cpu_usage')
    expect(got.latestChecks[0].status).toBe('degraded')
  })
})

// ─── parseRegisterResult ───────────────────────────────────────────────────

describe('parseRegisterResult', () => {
  it('returns failure default for non-object', () => {
    expect(parseRegisterResult('')).toEqual({ ok: false, id: null, reason: '' })
  })
  it('parses register success', () => {
    expect(parseRegisterResult(JSON.stringify({ registered: true, nodeId: 'n-1' })))
      .toEqual({ ok: true, id: 'n-1', reason: '' })
  })
  it('parses register failure with reason', () => {
    expect(parseRegisterResult(JSON.stringify({ registered: false, reason: 'already_exists' })))
      .toEqual({ ok: false, id: null, reason: 'already_exists' })
  })
  it('parses pool-init success', () => {
    expect(parseRegisterResult(JSON.stringify({ initialized: true, nodeId: 'n-1' })))
      .toEqual({ ok: true, id: 'n-1', reason: '' })
  })
  it('parses check-record success', () => {
    expect(parseRegisterResult(JSON.stringify({ recorded: true, checkId: 'c-1' })))
      .toEqual({ ok: true, id: 'c-1', reason: '' })
  })
})

// ─── parseTransitionResult ─────────────────────────────────────────────────

describe('parseTransitionResult', () => {
  it('returns failure default for non-object', () => {
    expect(parseTransitionResult('')).toMatchObject({
      ok: false, state: '', previousState: '',
      failureCount: 0, successCount: 0, remainingMs: 0, reason: '',
    })
  })
  it('parses failure → trip envelope', () => {
    const raw = { updated: true, state: 'open', previousState: 'closed', failureCount: 5 }
    expect(parseTransitionResult(JSON.stringify(raw))).toMatchObject({
      ok: true, state: 'open', previousState: 'closed', failureCount: 5,
    })
  })
  it('parses success → close envelope', () => {
    const raw = { updated: true, state: 'closed', previousState: 'half_open', successCount: 2 }
    expect(parseTransitionResult(JSON.stringify(raw))).toMatchObject({
      ok: true, state: 'closed', previousState: 'half_open', successCount: 2,
    })
  })
  it('parses half-open cooldown failure with remainingMs', () => {
    const raw = { updated: false, reason: 'timeout_not_elapsed', remainingMs: 23000 }
    expect(parseTransitionResult(JSON.stringify(raw))).toMatchObject({
      ok: false, reason: 'timeout_not_elapsed', remainingMs: 23000,
    })
  })
  it('parses reset envelope', () => {
    expect(parseTransitionResult(JSON.stringify({ reset: true, state: 'closed' })))
      .toMatchObject({ ok: true, state: 'closed' })
  })
  it('parses not_found failure', () => {
    expect(parseTransitionResult(JSON.stringify({ updated: false, reason: 'not_found' })))
      .toMatchObject({ ok: false, reason: 'not_found' })
  })
})

// ─── parsePoolActionResult ─────────────────────────────────────────────────

describe('parsePoolActionResult', () => {
  it('returns failure default for non-object', () => {
    expect(parsePoolActionResult('')).toEqual({
      ok: false, active: 0, idle: 0, waiting: 0, reason: '',
    })
  })
  it('parses acquire success', () => {
    expect(parsePoolActionResult(JSON.stringify({ acquired: true, active: 4, idle: 1 })))
      .toEqual({ ok: true, active: 4, idle: 1, waiting: 0, reason: '' })
  })
  it('parses pool exhaustion failure with waiting', () => {
    const raw = { acquired: false, reason: 'pool_exhausted', waiting: 3 }
    expect(parsePoolActionResult(JSON.stringify(raw))).toEqual({
      ok: false, active: 0, idle: 0, waiting: 3, reason: 'pool_exhausted',
    })
  })
  it('parses release success', () => {
    expect(parsePoolActionResult(JSON.stringify({ released: true, active: 2, idle: 3 })))
      .toEqual({ ok: true, active: 2, idle: 3, waiting: 0, reason: '' })
  })
  it('parses destroy success', () => {
    expect(parsePoolActionResult(JSON.stringify({ destroyed: true })))
      .toMatchObject({ ok: true })
  })
  it('parses pool-not-found failure', () => {
    expect(parsePoolActionResult(JSON.stringify({ destroyed: false, reason: 'pool_not_found' })))
      .toMatchObject({ ok: false, reason: 'pool_not_found' })
  })
})

// ─── parseRemoveResult ─────────────────────────────────────────────────────

describe('parseRemoveResult', () => {
  it('returns failure default for non-object', () => {
    expect(parseRemoveResult('')).toEqual({ ok: false, reason: '' })
  })
  it('parses remove success', () => {
    expect(parseRemoveResult(JSON.stringify({ removed: true })))
      .toEqual({ ok: true, reason: '' })
  })
  it('parses remove not-found failure', () => {
    expect(parseRemoveResult(JSON.stringify({ removed: false, reason: 'not_found' })))
      .toEqual({ ok: false, reason: 'not_found' })
  })
})

// ─── parseStats ────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full pre-keyed defaults for empty input', () => {
    const got = parseStats('')
    expect(got.circuitBreakers.total).toBe(0)
    expect(got.circuitBreakers.byState).toEqual({ closed: 0, open: 0, half_open: 0 })
    expect(got.healthChecks.total).toBe(0)
    expect(got.healthChecks.byStatus).toEqual({
      healthy: 0, degraded: 0, unhealthy: 0, unknown: 0,
    })
    expect(got.connectionPools).toEqual({
      total: 0, totalActive: 0, totalIdle: 0, totalConnections: 0,
    })
  })
  it('parses populated stats', () => {
    const raw = {
      circuitBreakers: {
        total: 5, byState: { closed: 3, open: 1, half_open: 1 },
      },
      healthChecks: {
        total: 12, byStatus: { healthy: 8, degraded: 2, unhealthy: 1, unknown: 1 },
      },
      connectionPools: {
        total: 2, totalActive: 7, totalIdle: 3, totalConnections: 10,
      },
    }
    const got = parseStats(JSON.stringify(raw))
    expect(got.circuitBreakers.total).toBe(5)
    expect(got.circuitBreakers.byState.closed).toBe(3)
    expect(got.healthChecks.byStatus.healthy).toBe(8)
    expect(got.connectionPools.totalConnections).toBe(10)
  })
  it('preserves missing-key zeros', () => {
    const raw = { circuitBreakers: { total: 1, byState: { closed: 1 } } }
    const got = parseStats(JSON.stringify(raw))
    expect(got.circuitBreakers.byState.closed).toBe(1)
    expect(got.circuitBreakers.byState.open).toBe(0)
    expect(got.healthChecks.byStatus.healthy).toBe(0)
  })
  it('ignores non-numeric byState values', () => {
    const raw = { circuitBreakers: { total: 1, byState: { closed: 'oops' } } }
    expect(parseStats(JSON.stringify(raw)).circuitBreakers.byState.closed).toBe(0)
  })
  it('strips noise wrapper', () => {
    const raw = { circuitBreakers: { total: 2 } }
    const got = parseStats(withNoise(JSON.stringify(raw)))
    expect(got.circuitBreakers.total).toBe(2)
  })
})

// ─── formatFedTime ─────────────────────────────────────────────────────────

describe('formatFedTime', () => {
  it('em-dash on null/empty', () => {
    expect(formatFedTime(null)).toBe('—')
    expect(formatFedTime('')).toBe('—')
    expect(formatFedTime(undefined)).toBe('—')
  })
  it('formats numeric ms timestamp', () => {
    const ts = Date.parse('2026-04-27T12:00:00Z')
    const out = formatFedTime(ts)
    expect(out).not.toBe('—')
    expect(out.length).toBeGreaterThan(8)
  })
  it('returns raw string on unparseable input', () => {
    expect(formatFedTime('not-a-date')).toBe('not-a-date')
  })
})
