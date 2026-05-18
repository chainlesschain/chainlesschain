/**
 * Unit tests for src/utils/tenant-parser.js
 *
 * Run: npx vitest run __tests__/unit/tenant-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parsePlans,
  parseMetrics,
  parseTenants,
  parseTenant,
  parseSubscriptions,
  parseQuotaResult,
  parseUsage,
  parseStats,
  formatTenantTime,
  formatBytes,
  currentPeriod,
  PLAN_IDS,
  TENANT_STATUSES,
  SUBSCRIPTION_STATUSES,
  KNOWN_METRICS,
} from '../../src/utils/tenant-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('PLAN_IDS = free/starter/pro/enterprise', () => {
    expect(PLAN_IDS).toEqual(['free', 'starter', 'pro', 'enterprise'])
  })
  it('TENANT_STATUSES = active/suspended/deleted', () => {
    expect(TENANT_STATUSES).toEqual(['active', 'suspended', 'deleted'])
  })
  it('SUBSCRIPTION_STATUSES = active/cancelled/expired/past_due', () => {
    expect(SUBSCRIPTION_STATUSES).toEqual(['active', 'cancelled', 'expired', 'past_due'])
  })
  it('KNOWN_METRICS = api_calls/storage_bytes/ai_requests', () => {
    expect(KNOWN_METRICS).toEqual(['api_calls', 'storage_bytes', 'ai_requests'])
  })
  it('all enums frozen', () => {
    for (const e of [PLAN_IDS, TENANT_STATUSES, SUBSCRIPTION_STATUSES, KNOWN_METRICS]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── parsePlans ─────────────────────────────────────────────────────────────

describe('parsePlans', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parsePlans('')).toEqual([])
    expect(parsePlans('{}')).toEqual([])
  })

  it('parses the 4 plan catalogue', () => {
    const json = JSON.stringify([
      { id: 'free', name: 'Free', monthlyFee: 0, quotas: { api_calls: 1000, storage_bytes: 104857600, ai_requests: 50 }, features: ['basic'] },
      { id: 'starter', name: 'Starter', monthlyFee: 49, quotas: { api_calls: 10000, storage_bytes: 1073741824, ai_requests: 500 }, features: ['basic', 'collaboration'] },
      { id: 'pro', name: 'Pro', monthlyFee: 399, quotas: { api_calls: 100000, storage_bytes: 10737418240, ai_requests: 5000 }, features: ['basic', 'collaboration', 'advanced_analytics'] },
      { id: 'enterprise', name: 'Enterprise', monthlyFee: null, quotas: { api_calls: null, storage_bytes: null, ai_requests: null }, features: ['basic', 'collaboration', 'sso', 'sla'] },
    ])
    const list = parsePlans(json)
    expect(list).toHaveLength(4)
    expect(list[0].id).toBe('free')
    expect(list[1].monthlyFee).toBe(49)
    expect(list[3].monthlyFee).toBeNull() // unlimited
    expect(list[3].quotas.api_calls).toBeNull()
    expect(list[3].features).toContain('sso')
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'free', name: 'Free', monthlyFee: 0, quotas: {}, features: [] }])
    expect(parsePlans(withNoise(json))).toHaveLength(1)
  })

  it('coerces non-array features to empty array', () => {
    const json = JSON.stringify([{ id: 'free', features: 'oops' }])
    expect(parsePlans(json)[0].features).toEqual([])
  })

  it('drops entries without id', () => {
    expect(parsePlans(JSON.stringify([{ name: 'orphan' }]))).toEqual([])
  })
})

// ─── parseMetrics ───────────────────────────────────────────────────────────

describe('parseMetrics', () => {
  it('parses 3 known metrics', () => {
    const json = JSON.stringify([
      { id: 'api_calls', name: 'API Calls', unit: 'calls' },
      { id: 'storage_bytes', name: 'Storage', unit: 'bytes' },
      { id: 'ai_requests', name: 'AI Requests', unit: 'requests' },
    ])
    const list = parseMetrics(json)
    expect(list).toHaveLength(3)
    expect(list[1].unit).toBe('bytes')
  })

  it('returns empty for non-array output', () => {
    expect(parseMetrics('')).toEqual([])
  })

  it('drops entries without id', () => {
    expect(parseMetrics(JSON.stringify([{ name: 'orphan' }]))).toEqual([])
  })
})

// ─── parseTenants ───────────────────────────────────────────────────────────

describe('parseTenants', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseTenants('')).toEqual([])
    expect(parseTenants('{}')).toEqual([])
  })

  it('parses tenant rows', () => {
    const json = JSON.stringify([
      {
        id: 't1', name: 'Acme Corp', slug: 'acme', config: null,
        status: 'active', plan: 'pro', dbPath: null, ownerId: 'user-1',
        createdAt: 1700000000000, updatedAt: 1700000001000, deletedAt: null,
      },
    ])
    const [t] = parseTenants(json)
    expect(t.id).toBe('t1')
    expect(t.name).toBe('Acme Corp')
    expect(t.slug).toBe('acme')
    expect(t.plan).toBe('pro')
    expect(t.status).toBe('active')
    expect(t.ownerId).toBe('user-1')
  })

  it('lowercases status and plan', () => {
    const json = JSON.stringify([{ id: 't1', name: 'a', slug: 'a', status: 'ACTIVE', plan: 'PRO' }])
    const [t] = parseTenants(json)
    expect(t.status).toBe('active')
    expect(t.plan).toBe('pro')
  })

  it('defaults status=active + plan=free when missing', () => {
    const [t] = parseTenants(JSON.stringify([{ id: 't1' }]))
    expect(t.status).toBe('active')
    expect(t.plan).toBe('free')
  })

  it('drops entries without id', () => {
    expect(parseTenants(JSON.stringify([{ name: 'orphan' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 't1', name: 'a', slug: 's' }])
    expect(parseTenants(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseTenant (single) ───────────────────────────────────────────────────

describe('parseTenant', () => {
  it('returns null on empty / array output', () => {
    expect(parseTenant('')).toBeNull()
    expect(parseTenant('[]')).toBeNull()
  })

  it('parses a single envelope', () => {
    const json = JSON.stringify({ id: 't1', name: 'A', slug: 'a', plan: 'starter' })
    const t = parseTenant(json)
    expect(t.id).toBe('t1')
    expect(t.plan).toBe('starter')
  })

  it('returns null when envelope lacks id', () => {
    expect(parseTenant(JSON.stringify({ name: 'noid' }))).toBeNull()
  })
})

// ─── parseSubscriptions ─────────────────────────────────────────────────────

describe('parseSubscriptions', () => {
  it('returns empty for empty output', () => {
    expect(parseSubscriptions('')).toEqual([])
  })

  it('parses subscription rows', () => {
    const json = JSON.stringify([
      {
        id: 's1', tenantId: 't1', plan: 'pro', status: 'active',
        startedAt: 1700000000000, expiresAt: 1702592000000,
        cancelledAt: null, paymentMethod: 'card', amount: 399,
        createdAt: 1700000000000,
      },
    ])
    const [s] = parseSubscriptions(json)
    expect(s.id).toBe('s1')
    expect(s.tenantId).toBe('t1')
    expect(s.plan).toBe('pro')
    expect(s.status).toBe('active')
    expect(s.amount).toBe(399)
  })

  it('lowercases status', () => {
    expect(parseSubscriptions(JSON.stringify([{ id: 's1', tenantId: 't', status: 'CANCELLED' }]))[0].status).toBe('cancelled')
  })

  it('keeps amount=null when null in input', () => {
    expect(parseSubscriptions(JSON.stringify([{ id: 's1', tenantId: 't', amount: null }]))[0].amount).toBeNull()
  })
})

// ─── parseQuotaResult ───────────────────────────────────────────────────────

describe('parseQuotaResult', () => {
  it('returns null for empty output', () => {
    expect(parseQuotaResult('')).toBeNull()
  })

  it('parses a normal quota envelope', () => {
    const json = JSON.stringify({
      tenantId: 't1', plan: 'pro', metric: 'api_calls', period: '2026-04',
      limit: 100000, used: 4523, remaining: 95477, unlimited: false, exceeded: false,
    })
    const r = parseQuotaResult(json)
    expect(r.tenantId).toBe('t1')
    expect(r.limit).toBe(100000)
    expect(r.used).toBe(4523)
    expect(r.remaining).toBe(95477)
    expect(r.unlimited).toBe(false)
    expect(r.exceeded).toBe(false)
  })

  it('parses an unlimited quota envelope (enterprise)', () => {
    const json = JSON.stringify({
      tenantId: 't1', plan: 'enterprise', metric: 'storage_bytes', period: '2026-04',
      limit: null, used: 999999999, remaining: null, unlimited: true, exceeded: false,
    })
    const r = parseQuotaResult(json)
    expect(r.unlimited).toBe(true)
    expect(r.limit).toBeNull()
    expect(r.remaining).toBeNull()
  })

  it('parses an exceeded envelope', () => {
    const json = JSON.stringify({
      tenantId: 't1', plan: 'free', metric: 'api_calls', period: '2026-04',
      limit: 1000, used: 1500, remaining: 0, unlimited: false, exceeded: true,
    })
    expect(parseQuotaResult(json).exceeded).toBe(true)
  })
})

// ─── parseUsage ─────────────────────────────────────────────────────────────

describe('parseUsage', () => {
  it('returns null for empty output', () => {
    expect(parseUsage('')).toBeNull()
  })

  it('parses usage aggregate', () => {
    const json = JSON.stringify({
      tenantId: 't1', period: '2026-04',
      byMetric: { api_calls: 4523, storage_bytes: 1048576 },
      records: [],
      total: 4523,
    })
    const u = parseUsage(json)
    expect(u.tenantId).toBe('t1')
    expect(u.byMetric.api_calls).toBe(4523)
  })

  it('coerces non-object byMetric to empty object', () => {
    expect(parseUsage(JSON.stringify({ tenantId: 't1', byMetric: 'oops' })).byMetric).toEqual({})
  })

  it('coerces non-array records to empty array', () => {
    expect(parseUsage(JSON.stringify({ records: 'oops' })).records).toEqual([])
  })
})

// ─── parseStats ─────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStats('')
    expect(s.tenantCount).toBe(0)
    expect(s.byStatus.active).toBe(0)
    expect(s.byPlan.free).toBe(0)
    expect(s.byPlan.enterprise).toBe(0)
    expect(s.totalUsage.api_calls).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      tenantCount: 12,
      byStatus: { active: 10, suspended: 1, deleted: 1 },
      byPlan: { free: 5, starter: 4, pro: 2, enterprise: 1 },
      subscriptionCount: 8,
      activeSubscriptions: 7,
      usageRecordCount: 5230,
      totalUsage: { api_calls: 12345, storage_bytes: 1073741824, ai_requests: 200 },
    })
    const s = parseStats(json)
    expect(s.tenantCount).toBe(12)
    expect(s.byPlan.starter).toBe(4)
    expect(s.activeSubscriptions).toBe(7)
    expect(s.totalUsage.storage_bytes).toBe(1073741824)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ tenantCount: 5 })
    expect(parseStats(withNoise(json)).tenantCount).toBe(5)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseStats('[]').tenantCount).toBe(0)
  })
})

// ─── formatBytes ────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('returns em-dash for invalid input', () => {
    expect(formatBytes('x')).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
  })

  it('returns "0" for 0', () => {
    expect(formatBytes(0)).toBe('0')
  })

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats KB', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
  })

  it('formats MB', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('formats GB', () => {
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB')
  })
})

// ─── formatTenantTime ───────────────────────────────────────────────────────

describe('formatTenantTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatTenantTime(null)).toBe('—')
    expect(formatTenantTime('')).toBe('—')
  })

  it('formats numeric ms timestamp', () => {
    expect(formatTenantTime(1700000000000).length).toBeGreaterThan(8)
  })
})

// ─── currentPeriod ──────────────────────────────────────────────────────────

describe('currentPeriod', () => {
  it('formats YYYY-MM with zero-padded month', () => {
    expect(currentPeriod(new Date(2026, 3, 26))).toBe('2026-04')
    expect(currentPeriod(new Date(2026, 0, 1))).toBe('2026-01')
    expect(currentPeriod(new Date(2026, 11, 31))).toBe('2026-12')
  })
})
