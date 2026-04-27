/**
 * Unit tests for src/utils/audit-parser.js
 *
 * Run: npx vitest run __tests__/unit/audit-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseLogs,
  parseStats,
  detectAuditError,
  formatAuditTime,
  EVENT_TYPES,
  RISK_LEVELS,
} from '../../src/utils/audit-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('EVENT_TYPES = 8 entries (auth/permission/data/system/file/did/crypto/api)', () => {
    expect(EVENT_TYPES).toEqual([
      'auth', 'permission', 'data', 'system', 'file', 'did', 'crypto', 'api',
    ])
  })
  it('RISK_LEVELS = low/medium/high/critical', () => {
    expect(RISK_LEVELS).toEqual(['low', 'medium', 'high', 'critical'])
  })
  it('all enums frozen', () => {
    for (const e of [EVENT_TYPES, RISK_LEVELS]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── detectAuditError ───────────────────────────────────────────────────────

describe('detectAuditError', () => {
  it('returns noDb=false on empty / clean output', () => {
    expect(detectAuditError('')).toEqual({ noDb: false, error: '' })
    expect(detectAuditError('[]')).toEqual({ noDb: false, error: '' })
  })

  it('detects "Database not available"', () => {
    expect(detectAuditError('Database not available'))
      .toEqual({ noDb: true, error: 'Database not available' })
  })

  it('still detects error wrapped in CLI noise', () => {
    expect(detectAuditError(withNoise('Database not available')).noDb).toBe(true)
  })

  it('case-insensitive', () => {
    expect(detectAuditError('DATABASE NOT AVAILABLE').noDb).toBe(true)
  })
})

// ─── parseLogs ──────────────────────────────────────────────────────────────

describe('parseLogs', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseLogs('')).toEqual([])
    expect(parseLogs('Database not available')).toEqual([])
    expect(parseLogs('{}')).toEqual([])
  })

  it('parses log rows from sqlite SELECT * (snake_case)', () => {
    const json = JSON.stringify([
      {
        id: 'a1', event_type: 'auth', operation: 'login',
        actor: 'admin', target: null,
        details: { method: 'password' }, risk_level: 'low',
        ip_address: '127.0.0.1', user_agent: 'curl/8.0',
        success: true, error_message: null,
        created_at: '2024-03-15 10:30:00',
      },
    ])
    const [r] = parseLogs(json)
    expect(r.id).toBe('a1')
    expect(r.eventType).toBe('auth')
    expect(r.operation).toBe('login')
    expect(r.actor).toBe('admin')
    expect(r.riskLevel).toBe('low')
    expect(r.success).toBe(true)
    expect(r.ipAddress).toBe('127.0.0.1')
    expect(r.userAgent).toBe('curl/8.0')
    expect(r.createdAt).toBe('2024-03-15 10:30:00')
    expect(r.details).toEqual({ method: 'password' })
  })

  it('lowercases eventType + riskLevel', () => {
    const json = JSON.stringify([{ id: 'a1', event_type: 'AUTH', risk_level: 'CRITICAL' }])
    const [r] = parseLogs(json)
    expect(r.eventType).toBe('auth')
    expect(r.riskLevel).toBe('critical')
  })

  it('coerces sqlite int success (0/1) to boolean', () => {
    const json = JSON.stringify([
      { id: 'a1', success: 1 },
      { id: 'a2', success: 0 },
    ])
    const [ok, fail] = parseLogs(json)
    expect(ok.success).toBe(true)
    expect(fail.success).toBe(false)
  })

  it('preserves boolean success when lib-normalized', () => {
    const json = JSON.stringify([{ id: 'a1', success: true }])
    expect(parseLogs(json)[0].success).toBe(true)
  })

  it('parses string details JSON when not pre-decoded', () => {
    const json = JSON.stringify([
      { id: 'a1', details: '{"k":"v"}' },
    ])
    expect(parseLogs(json)[0].details).toEqual({ k: 'v' })
  })

  it('keeps unparseable details string as-is (no throw)', () => {
    const json = JSON.stringify([
      { id: 'a1', details: 'not-json-but-still-a-string' },
    ])
    expect(parseLogs(json)[0].details).toBe('not-json-but-still-a-string')
  })

  it('handles null details', () => {
    const json = JSON.stringify([{ id: 'a1', details: null }])
    expect(parseLogs(json)[0].details).toBeNull()
  })

  it('defaults missing risk_level to "low"', () => {
    const [r] = parseLogs(JSON.stringify([{ id: 'a1' }]))
    expect(r.riskLevel).toBe('low')
  })

  it('drops entries without id', () => {
    expect(parseLogs(JSON.stringify([{ event_type: 'auth' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'a1', event_type: 'auth', operation: 'login' }])
    expect(parseLogs(withNoise(json))).toHaveLength(1)
  })

  it('also accepts pre-camelCased input (idempotent)', () => {
    const json = JSON.stringify([{
      id: 'a1', eventType: 'auth', riskLevel: 'high',
      ipAddress: '1.2.3.4', userAgent: 'ua', errorMessage: 'oops',
      createdAt: '2024-01-01T00:00:00Z',
    }])
    const [r] = parseLogs(json)
    expect(r.eventType).toBe('auth')
    expect(r.riskLevel).toBe('high')
    expect(r.ipAddress).toBe('1.2.3.4')
    expect(r.userAgent).toBe('ua')
    expect(r.errorMessage).toBe('oops')
  })
})

// ─── parseStats ─────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStats('')
    expect(s.total).toBe(0)
    expect(s.failures).toBe(0)
    expect(s.highRisk).toBe(0)
    // All 8 event types pre-keyed at 0
    for (const t of EVENT_TYPES) expect(s.byEventType[t]).toBe(0)
    // All 4 risk levels pre-keyed at 0
    for (const r of RISK_LEVELS) expect(s.byRiskLevel[r]).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      total: 100,
      failures: 7,
      highRisk: 12,
      byEventType: { auth: 40, permission: 25, did: 10, system: 25 },
      byRiskLevel: { low: 80, medium: 8, high: 10, critical: 2 },
    })
    const s = parseStats(json)
    expect(s.total).toBe(100)
    expect(s.failures).toBe(7)
    expect(s.highRisk).toBe(12)
    expect(s.byEventType.auth).toBe(40)
    expect(s.byEventType.permission).toBe(25)
    expect(s.byRiskLevel.critical).toBe(2)
    // Pre-keyed defaults preserved for unmentioned keys
    expect(s.byEventType.crypto).toBe(0)
    expect(s.byEventType.api).toBe(0)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ total: 5 })
    expect(parseStats(withNoise(json)).total).toBe(5)
  })

  it('drops non-numeric byEventType / byRiskLevel entries', () => {
    const json = JSON.stringify({
      byEventType: { auth: 'oops', permission: 5 },
      byRiskLevel: { low: 'x', high: 3 },
    })
    const s = parseStats(json)
    expect(s.byEventType.auth).toBe(0) // pre-keyed default
    expect(s.byEventType.permission).toBe(5)
    expect(s.byRiskLevel.low).toBe(0)
    expect(s.byRiskLevel.high).toBe(3)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseStats('[]').total).toBe(0)
  })
})

// ─── formatAuditTime ────────────────────────────────────────────────────────

describe('formatAuditTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatAuditTime(null)).toBe('—')
    expect(formatAuditTime('')).toBe('—')
  })

  it('formats sqlite "YYYY-MM-DD HH:MM:SS" timestamps', () => {
    expect(formatAuditTime('2024-03-15 10:30:00').length).toBeGreaterThan(8)
  })

  it('formats ISO strings', () => {
    expect(formatAuditTime('2024-03-15T10:30:00Z').length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatAuditTime('not-a-date')).toBe('not-a-date')
  })
})
