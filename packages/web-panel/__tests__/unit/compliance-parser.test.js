/**
 * Unit tests for src/utils/compliance-parser.js
 *
 * Run: npx vitest run __tests__/unit/compliance-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseIndicators,
  parseMatchResult,
  parseThreatIntelStats,
  parseUebaTop,
  parseAnomalies,
  detectUebaError,
  formatComplianceTime,
  IOC_TYPES,
} from '../../src/utils/compliance-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen IOC_TYPES ───────────────────────────────────────────────────────

describe('IOC_TYPES export', () => {
  it('contains the 9 supported IoC types in CLI order', () => {
    expect(IOC_TYPES).toEqual([
      'file-md5', 'file-sha1', 'file-sha256', 'file-sha512',
      'ipv4', 'ipv6', 'domain', 'url', 'email',
    ])
  })

  it('is frozen', () => {
    expect(Object.isFrozen(IOC_TYPES)).toBe(true)
  })
})

// ─── parseIndicators ────────────────────────────────────────────────────────

describe('parseIndicators', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseIndicators('')).toEqual([])
    expect(parseIndicators('{}')).toEqual([])
  })

  it('parses indicator records (already-camelCase from _rowToIndicator)', () => {
    const json = JSON.stringify([
      {
        id: 'ind1',
        type: 'ipv4',
        value: '1.2.3.4',
        labels: ['malicious', 'c2'],
        confidence: 80,
        sourceId: 'feed-1',
        sourceName: 'TestFeed',
        validFrom: '2026-01-01',
        validUntil: null,
        firstSeenAt: '2026-04-26 10:00:00',
        lastSeenAt: '2026-04-26 11:00:00',
      },
    ])
    const [ind] = parseIndicators(json)
    expect(ind.id).toBe('ind1')
    expect(ind.type).toBe('ipv4')
    expect(ind.value).toBe('1.2.3.4')
    expect(ind.labels).toEqual(['malicious', 'c2'])
    expect(ind.confidence).toBe(80)
    expect(ind.sourceName).toBe('TestFeed')
  })

  it('falls back to snake_case source_id / valid_from / first_seen_at', () => {
    const json = JSON.stringify([
      { id: 'i1', type: 'ipv4', value: '1.1.1.1', source_id: 's1', valid_from: 'x', first_seen_at: 'y', last_seen_at: 'z' },
    ])
    const [ind] = parseIndicators(json)
    expect(ind.sourceId).toBe('s1')
    expect(ind.validFrom).toBe('x')
    expect(ind.firstSeenAt).toBe('y')
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'i1', type: 'domain', value: 'evil.com', labels: [] }])
    expect(parseIndicators(withNoise(json))).toHaveLength(1)
  })

  it('coerces non-array labels to empty array', () => {
    const json = JSON.stringify([{ id: 'i1', type: 'ipv4', value: '1.1.1.1', labels: 'oops' }])
    expect(parseIndicators(json)[0].labels).toEqual([])
  })

  it('drops entries without an id', () => {
    expect(parseIndicators(JSON.stringify([{ type: 'ipv4', value: '1.1.1.1' }]))).toEqual([])
  })

  it('uses indicator id as table row key', () => {
    const json = JSON.stringify([{ id: 'i1', type: 'ipv4', value: '1.1.1.1' }])
    expect(parseIndicators(json)[0].key).toBe('i1')
  })
})

// ─── parseMatchResult ───────────────────────────────────────────────────────

describe('parseMatchResult', () => {
  it('returns null for empty / array output', () => {
    expect(parseMatchResult('')).toBeNull()
    expect(parseMatchResult('[]')).toBeNull()
  })

  it('parses a hit envelope with indicator', () => {
    const json = JSON.stringify({
      matched: true,
      type: 'ipv4',
      indicator: { id: 'i1', type: 'ipv4', value: '1.2.3.4', labels: ['malicious'] },
    })
    const r = parseMatchResult(json)
    expect(r.matched).toBe(true)
    expect(r.type).toBe('ipv4')
    expect(r.indicator.id).toBe('i1')
    expect(r.indicator.labels).toEqual(['malicious'])
  })

  it('parses a miss envelope (matched=false but type classified)', () => {
    const json = JSON.stringify({ matched: false, type: 'ipv4' })
    const r = parseMatchResult(json)
    expect(r.matched).toBe(false)
    expect(r.type).toBe('ipv4')
    expect(r.indicator).toBeNull()
  })

  it('parses an "unknown" envelope when input cannot be classified', () => {
    const json = JSON.stringify({ matched: false, type: 'unknown' })
    expect(parseMatchResult(json).type).toBe('unknown')
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ matched: false, type: 'ipv4' })
    expect(parseMatchResult(withNoise(json)).type).toBe('ipv4')
  })
})

// ─── parseThreatIntelStats ──────────────────────────────────────────────────

describe('parseThreatIntelStats', () => {
  it('returns zero shape for empty output', () => {
    expect(parseThreatIntelStats('')).toEqual({ total: 0, byType: {} })
  })

  it('parses populated stats', () => {
    const json = JSON.stringify({
      total: 12,
      byType: { ipv4: 5, domain: 4, 'file-sha256': 3 },
    })
    const s = parseThreatIntelStats(json)
    expect(s.total).toBe(12)
    expect(s.byType.ipv4).toBe(5)
    expect(s.byType.domain).toBe(4)
    expect(s.byType['file-sha256']).toBe(3)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ total: 1, byType: { ipv4: 1 } })
    expect(parseThreatIntelStats(withNoise(json)).total).toBe(1)
  })

  it('drops non-numeric byType values', () => {
    const json = JSON.stringify({ total: 1, byType: { ipv4: 'oops', domain: 2 } })
    const s = parseThreatIntelStats(json)
    expect(s.byType.ipv4).toBeUndefined()
    expect(s.byType.domain).toBe(2)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseThreatIntelStats('[]')).toEqual({ total: 0, byType: {} })
  })
})

// ─── parseUebaTop ───────────────────────────────────────────────────────────

describe('parseUebaTop', () => {
  it('returns empty for empty output', () => {
    expect(parseUebaTop('')).toEqual([])
  })

  it('parses ranked entity records (camelCase)', () => {
    const json = JSON.stringify([
      {
        entity: 'alice',
        eventCount: 100,
        failureRate: 0.15,
        uniqueResources: 12,
        uniqueActions: 5,
        burstiness: 0.3,
        riskScore: 28.5,
      },
      { entity: 'bob', eventCount: 50, failureRate: 0.05, riskScore: 15 },
    ])
    const list = parseUebaTop(json)
    expect(list).toHaveLength(2)
    expect(list[0].entity).toBe('alice')
    expect(list[0].riskScore).toBe(28.5)
    expect(list[1].uniqueResources).toBe(0) // missing → default 0
  })

  it('falls back to snake_case event_count / risk_score', () => {
    const json = JSON.stringify([
      { entity: 'a', event_count: 10, failure_rate: 0.5, risk_score: 50 },
    ])
    const [r] = parseUebaTop(json)
    expect(r.eventCount).toBe(10)
    expect(r.failureRate).toBe(0.5)
    expect(r.riskScore).toBe(50)
  })

  it('drops entries without entity', () => {
    expect(parseUebaTop(JSON.stringify([{ riskScore: 90 }]))).toEqual([])
  })

  it('uses entity as table row key', () => {
    const json = JSON.stringify([{ entity: 'alice' }])
    expect(parseUebaTop(json)[0].key).toBe('alice')
  })
})

// ─── parseAnomalies ─────────────────────────────────────────────────────────

describe('parseAnomalies', () => {
  it('returns empty for empty output', () => {
    expect(parseAnomalies('')).toEqual([])
  })

  it('parses anomaly entries', () => {
    const json = JSON.stringify([
      { event: { entity: 'alice', action: 'login' }, score: 0.85, reasons: ['high_failure_rate'] },
      { event: { entity: 'bob' }, score: 0.72, reasons: [] },
    ])
    const list = parseAnomalies(json)
    expect(list).toHaveLength(2)
    expect(list[0].score).toBe(0.85)
    expect(list[0].reasons).toEqual(['high_failure_rate'])
    expect(list[1].event.entity).toBe('bob')
  })

  it('coerces non-array reasons to empty array', () => {
    const json = JSON.stringify([{ event: { entity: 'a' }, score: 0.9, reasons: null }])
    expect(parseAnomalies(json)[0].reasons).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ event: { entity: 'a' }, score: 0.8, reasons: [] }])
    expect(parseAnomalies(withNoise(json))).toHaveLength(1)
  })
})

// ─── detectUebaError ────────────────────────────────────────────────────────

describe('detectUebaError', () => {
  it('returns noAuditLog=false on empty output', () => {
    expect(detectUebaError('')).toEqual({ noAuditLog: false, error: '' })
  })

  it('detects "no such table: audit_log" pattern', () => {
    const out = '✖ Failed: no such table: audit_log'
    const r = detectUebaError(out)
    expect(r.noAuditLog).toBe(true)
    expect(r.error).toBe('no such table: audit_log')
  })

  it('reports non-audit-log errors via .error', () => {
    const out = '✖ Failed: connection refused'
    const r = detectUebaError(out)
    expect(r.noAuditLog).toBe(false)
    expect(r.error).toBe('connection refused')
  })

  it('strips CLI bootstrap noise before checking', () => {
    const out = withNoise('✖ Failed: no such table: audit_log')
    expect(detectUebaError(out).noAuditLog).toBe(true)
  })

  it('case-insensitive on the audit_log token', () => {
    expect(detectUebaError('Failed: NO SUCH TABLE: AUDIT_LOG').noAuditLog).toBe(true)
  })
})

// ─── formatComplianceTime ──────────────────────────────────────────────────

describe('formatComplianceTime', () => {
  it('returns em-dash for null / empty / undefined', () => {
    expect(formatComplianceTime(null)).toBe('—')
    expect(formatComplianceTime('')).toBe('—')
    expect(formatComplianceTime(undefined)).toBe('—')
  })

  it('formats a sqlite ISO datetime string', () => {
    const formatted = formatComplianceTime('2026-04-26 10:30:00')
    expect(formatted).toMatch(/2026/)
  })

  it('formats a numeric ms timestamp', () => {
    expect(formatComplianceTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatComplianceTime('not-a-date')).toBe('not-a-date')
  })
})
