/**
 * Unit tests for src/utils/sla-parser.js
 *
 * Run: npx vitest run __tests__/unit/sla-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseTiers,
  parseStringList,
  parseContracts,
  parseContract,
  parseMetrics,
  parseViolations,
  parseCheckResult,
  parseCompensation,
  parseReport,
  parseStatsV2,
  detectSlaError,
  formatSlaTime,
  SLA_TIER_NAMES,
  SLA_STATUSES,
  SLA_TERMS_LIST,
  VIOLATION_SEVERITIES,
  VIOLATION_STATUSES,
} from '../../src/utils/sla-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('SLA_TIER_NAMES = gold/silver/bronze', () => {
    expect(SLA_TIER_NAMES).toEqual(['gold', 'silver', 'bronze'])
  })
  it('SLA_STATUSES = active/expired/terminated', () => {
    expect(SLA_STATUSES).toEqual(['active', 'expired', 'terminated'])
  })
  it('SLA_TERMS_LIST = 4 entries', () => {
    expect(SLA_TERMS_LIST).toEqual([
      'availability', 'response_time', 'throughput', 'error_rate',
    ])
  })
  it('VIOLATION_SEVERITIES = 4 entries', () => {
    expect(VIOLATION_SEVERITIES).toEqual(['minor', 'moderate', 'major', 'critical'])
  })
  it('VIOLATION_STATUSES = 4 entries', () => {
    expect(VIOLATION_STATUSES).toEqual(['open', 'acknowledged', 'resolved', 'waived'])
  })
  it('all enums frozen', () => {
    for (const e of [SLA_TIER_NAMES, SLA_STATUSES, SLA_TERMS_LIST, VIOLATION_SEVERITIES, VIOLATION_STATUSES]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── detectSlaError ─────────────────────────────────────────────────────────

describe('detectSlaError', () => {
  it('returns noDb=false on empty / clean output', () => {
    expect(detectSlaError('')).toEqual({ noDb: false, error: '' })
    expect(detectSlaError('[]')).toEqual({ noDb: false, error: '' })
  })

  it('detects "Database not available"', () => {
    expect(detectSlaError('Database not available'))
      .toEqual({ noDb: true, error: 'Database not available' })
  })

  it('still detects error wrapped in CLI noise', () => {
    expect(detectSlaError(withNoise('Database not available')).noDb).toBe(true)
  })

  it('case-insensitive', () => {
    expect(detectSlaError('DATABASE NOT AVAILABLE').noDb).toBe(true)
  })
})

// ─── parseTiers ─────────────────────────────────────────────────────────────

describe('parseTiers', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseTiers('')).toEqual([])
    expect(parseTiers('{}')).toEqual([])
  })

  it('parses the 3-tier catalogue', () => {
    const json = JSON.stringify([
      { name: 'gold', availability: 0.999, maxResponseTime: 100, minThroughput: 1000, maxErrorRate: 0.001, compensationRate: 0.05 },
      { name: 'silver', availability: 0.995, maxResponseTime: 200, minThroughput: 500, maxErrorRate: 0.005, compensationRate: 0.03 },
      { name: 'bronze', availability: 0.99, maxResponseTime: 500, minThroughput: 200, maxErrorRate: 0.01, compensationRate: 0.01 },
    ])
    const list = parseTiers(json)
    expect(list).toHaveLength(3)
    expect(list[0].name).toBe('gold')
    expect(list[0].availability).toBe(0.999)
    expect(list[0].maxResponseTime).toBe(100)
    expect(list[0].compensationRate).toBe(0.05)
  })

  it('drops entries without name', () => {
    expect(parseTiers(JSON.stringify([{ availability: 0.999 }]))).toEqual([])
  })

  it('coerces missing numeric fields to 0', () => {
    const [t] = parseTiers(JSON.stringify([{ name: 'gold' }]))
    expect(t.availability).toBe(0)
    expect(t.maxResponseTime).toBe(0)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ name: 'gold', availability: 0.999 }])
    expect(parseTiers(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseStringList ───────────────────────────────────────────────────────

describe('parseStringList', () => {
  it('parses statuses array', () => {
    expect(parseStringList(JSON.stringify(['active', 'expired', 'terminated'])))
      .toEqual(['active', 'expired', 'terminated'])
  })

  it('filters non-string entries', () => {
    expect(parseStringList(JSON.stringify(['open', 1, null, 'resolved'])))
      .toEqual(['open', 'resolved'])
  })

  it('returns empty for non-array', () => {
    expect(parseStringList('')).toEqual([])
    expect(parseStringList('{}')).toEqual([])
  })
})

// ─── parseContracts ────────────────────────────────────────────────────────

describe('parseContracts', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseContracts('')).toEqual([])
    expect(parseContracts('Database not available')).toEqual([])
  })

  it('parses contract rows', () => {
    const json = JSON.stringify([
      {
        slaId: 's1', orgId: 'org-acme', tier: 'gold',
        terms: { availability: 0.999, maxResponseTime: 100, minThroughput: 1000, maxErrorRate: 0.001, compensationRate: 0.05 },
        monthlyFee: 10000,
        startDate: 1700000000000, endDate: 1702592000000,
        status: 'active', createdAt: 1700000000000, updatedAt: 1700000000000,
      },
    ])
    const [c] = parseContracts(json)
    expect(c.slaId).toBe('s1')
    expect(c.orgId).toBe('org-acme')
    expect(c.tier).toBe('gold')
    expect(c.status).toBe('active')
    expect(c.monthlyFee).toBe(10000)
    expect(c.terms.availability).toBe(0.999)
  })

  it('lowercases tier + status', () => {
    const json = JSON.stringify([{ slaId: 's1', tier: 'GOLD', status: 'ACTIVE' }])
    const [c] = parseContracts(json)
    expect(c.tier).toBe('gold')
    expect(c.status).toBe('active')
  })

  it('coerces missing terms to empty-object defaults', () => {
    const [c] = parseContracts(JSON.stringify([{ slaId: 's1' }]))
    expect(c.terms.availability).toBe(0)
    expect(c.terms.maxResponseTime).toBe(0)
  })

  it('drops entries without slaId', () => {
    expect(parseContracts(JSON.stringify([{ orgId: 'org-1' }]))).toEqual([])
  })

  it('also accepts snake_case sla_id (idempotent)', () => {
    const json = JSON.stringify([{ sla_id: 's1', org_id: 'org-1', tier: 'silver' }])
    const [c] = parseContracts(json)
    expect(c.slaId).toBe('s1')
    expect(c.orgId).toBe('org-1')
  })
})

// ─── parseContract ─────────────────────────────────────────────────────────

describe('parseContract', () => {
  it('returns null for empty / array output', () => {
    expect(parseContract('')).toBeNull()
    expect(parseContract('[]')).toBeNull()
  })

  it('parses single envelope', () => {
    const json = JSON.stringify({ slaId: 's1', tier: 'silver', status: 'active' })
    expect(parseContract(json).tier).toBe('silver')
  })

  it('returns null when slaId missing', () => {
    expect(parseContract(JSON.stringify({ orgId: 'org-1' }))).toBeNull()
  })
})

// ─── parseMetrics ──────────────────────────────────────────────────────────

describe('parseMetrics', () => {
  it('returns empty shape for empty output', () => {
    const m = parseMetrics('')
    expect(m.totalSamples).toBe(0)
    expect(m.byTerm).toEqual({})
  })

  it('parses metrics summary', () => {
    const json = JSON.stringify({
      slaId: 's1',
      totalSamples: 100,
      byTerm: {
        availability: { count: 30, mean: 0.997, min: 0.99, max: 1.0, p95: 0.999 },
        response_time: { count: 70, mean: 80, min: 30, max: 250, p95: 180 },
      },
    })
    const m = parseMetrics(json)
    expect(m.slaId).toBe('s1')
    expect(m.totalSamples).toBe(100)
    expect(m.byTerm.availability.count).toBe(30)
    expect(m.byTerm.availability.p95).toBe(0.999)
    expect(m.byTerm.response_time.p95).toBe(180)
  })

  it('drops malformed aggregate entries', () => {
    const json = JSON.stringify({
      slaId: 's1', totalSamples: 5, byTerm: { availability: 'oops' },
    })
    expect(parseMetrics(json).byTerm).toEqual({})
  })
})

// ─── parseViolations ───────────────────────────────────────────────────────

describe('parseViolations', () => {
  it('returns empty for empty output', () => {
    expect(parseViolations('')).toEqual([])
  })

  it('parses violation rows', () => {
    const json = JSON.stringify([
      {
        violationId: 'v1', slaId: 's1', term: 'availability',
        severity: 'major', expectedValue: 0.999, actualValue: 0.97,
        deviationPercent: 2.9, compensationAmount: 50,
        occurredAt: 1700000000000, resolvedAt: null,
        v2Status: 'open',
      },
    ])
    const [v] = parseViolations(json)
    expect(v.violationId).toBe('v1')
    expect(v.term).toBe('availability')
    expect(v.severity).toBe('major')
    expect(v.expectedValue).toBe(0.999)
    expect(v.actualValue).toBe(0.97)
    expect(v.compensationAmount).toBe(50)
    expect(v.v2Status).toBe('open')
  })

  it('lowercases term + severity + v2Status', () => {
    const json = JSON.stringify([{
      violationId: 'v1', term: 'AVAILABILITY', severity: 'CRITICAL', v2Status: 'RESOLVED',
    }])
    const [v] = parseViolations(json)
    expect(v.term).toBe('availability')
    expect(v.severity).toBe('critical')
    expect(v.v2Status).toBe('resolved')
  })

  it('null compensationAmount preserved as null', () => {
    const json = JSON.stringify([{ violationId: 'v1', compensationAmount: null }])
    expect(parseViolations(json)[0].compensationAmount).toBeNull()
  })

  it('drops entries without violationId', () => {
    expect(parseViolations(JSON.stringify([{ term: 'availability' }]))).toEqual([])
  })

  it('also accepts snake_case violation_id', () => {
    const json = JSON.stringify([{ violation_id: 'v1', sla_id: 's1', term: 'throughput' }])
    expect(parseViolations(json)[0].violationId).toBe('v1')
  })
})

// ─── parseCheckResult ──────────────────────────────────────────────────────

describe('parseCheckResult', () => {
  it('returns empty shape for empty output', () => {
    const r = parseCheckResult('')
    expect(r.totalViolations).toBe(0)
    expect(r.violations).toEqual([])
  })

  it('parses check envelope', () => {
    const json = JSON.stringify({
      slaId: 's1', checkedAt: 1700000000000,
      totalViolations: 1,
      violations: [
        { violationId: 'v1', term: 'response_time', severity: 'minor', deviationPercent: 8 },
      ],
    })
    const r = parseCheckResult(json)
    expect(r.totalViolations).toBe(1)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].term).toBe('response_time')
  })
})

// ─── parseCompensation ─────────────────────────────────────────────────────

describe('parseCompensation', () => {
  it('returns null for empty / array output', () => {
    expect(parseCompensation('')).toBeNull()
    expect(parseCompensation('[]')).toBeNull()
  })

  it('parses compensation envelope', () => {
    const json = JSON.stringify({
      violationId: 'v1', slaId: 's1', severity: 'major',
      base: 500, multiplier: 1.5, amount: 750,
    })
    const c = parseCompensation(json)
    expect(c.violationId).toBe('v1')
    expect(c.base).toBe(500)
    expect(c.multiplier).toBe(1.5)
    expect(c.amount).toBe(750)
  })
})

// ─── parseReport ───────────────────────────────────────────────────────────

describe('parseReport', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const r = parseReport('')
    expect(r.slaId).toBe('')
    expect(r.compliance).toBe(0)
    for (const t of SLA_TERMS_LIST) expect(r.violations.byTerm[t]).toBe(0)
    for (const s of VIOLATION_SEVERITIES) expect(r.violations.bySeverity[s]).toBe(0)
  })

  it('parses populated report payload', () => {
    const json = JSON.stringify({
      slaId: 's1', tier: 'gold', compliance: 0.95,
      startDate: 1700000000000, endDate: 1702592000000,
      metricsByTerm: {
        availability: { count: 100, mean: 0.997, min: 0.99, max: 1.0, p95: 0.999 },
      },
      violations: {
        total: 3,
        byTerm: { availability: 2, response_time: 1 },
        bySeverity: { minor: 2, major: 1 },
        totalCompensation: 250.5,
      },
    })
    const r = parseReport(json)
    expect(r.slaId).toBe('s1')
    expect(r.tier).toBe('gold')
    expect(r.compliance).toBe(0.95)
    expect(r.metricsByTerm.availability.p95).toBe(0.999)
    expect(r.violations.total).toBe(3)
    expect(r.violations.byTerm.availability).toBe(2)
    expect(r.violations.bySeverity.major).toBe(1)
    expect(r.violations.totalCompensation).toBe(250.5)
    // Pre-keyed defaults preserved
    expect(r.violations.byTerm.error_rate).toBe(0)
    expect(r.violations.bySeverity.critical).toBe(0)
  })
})

// ─── parseStatsV2 ──────────────────────────────────────────────────────────

describe('parseStatsV2', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStatsV2('')
    expect(s.totalContracts).toBe(0)
    for (const k of SLA_STATUSES) expect(s.byStatus[k]).toBe(0)
    for (const k of SLA_TIER_NAMES) expect(s.byTier[k]).toBe(0)
    for (const k of SLA_TERMS_LIST) expect(s.violations.byTerm[k]).toBe(0)
    for (const k of VIOLATION_SEVERITIES) expect(s.violations.bySeverity[k]).toBe(0)
    for (const k of VIOLATION_STATUSES) expect(s.violations.byStatus[k]).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      totalContracts: 12, activeContracts: 8, activeOrgs: 5, maxActiveSlasPerOrg: 3,
      byStatus: { active: 8, expired: 3, terminated: 1 },
      byTier: { gold: 2, silver: 6, bronze: 4 },
      violations: {
        total: 7,
        byTerm: { availability: 4, response_time: 3 },
        bySeverity: { minor: 4, major: 2, critical: 1 },
        byStatus: { open: 3, resolved: 4 },
        totalCompensation: 1250.75,
      },
    })
    const s = parseStatsV2(json)
    expect(s.totalContracts).toBe(12)
    expect(s.activeContracts).toBe(8)
    expect(s.byStatus.active).toBe(8)
    expect(s.byTier.silver).toBe(6)
    expect(s.violations.total).toBe(7)
    expect(s.violations.byTerm.availability).toBe(4)
    expect(s.violations.bySeverity.critical).toBe(1)
    expect(s.violations.byStatus.resolved).toBe(4)
    expect(s.violations.totalCompensation).toBe(1250.75)
    // Pre-keyed defaults preserved
    expect(s.byTier.gold).toBe(2)
    expect(s.violations.byTerm.error_rate).toBe(0)
  })

  it('drops non-numeric byStatus / byTier entries', () => {
    const json = JSON.stringify({
      byStatus: { active: 'oops', expired: 2 },
      byTier: { gold: 'x', silver: 1 },
    })
    const s = parseStatsV2(json)
    expect(s.byStatus.active).toBe(0)
    expect(s.byStatus.expired).toBe(2)
    expect(s.byTier.gold).toBe(0)
    expect(s.byTier.silver).toBe(1)
  })
})

// ─── formatSlaTime ─────────────────────────────────────────────────────────

describe('formatSlaTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatSlaTime(null)).toBe('—')
    expect(formatSlaTime('')).toBe('—')
  })

  it('formats numeric ms timestamp', () => {
    expect(formatSlaTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatSlaTime('not-a-date')).toBe('not-a-date')
  })
})
