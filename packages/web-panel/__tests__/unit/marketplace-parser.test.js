/**
 * Unit tests for src/utils/marketplace-parser.js
 *
 * Run: npx vitest run __tests__/unit/marketplace-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseServices,
  parseService,
  parseInvocations,
  parseStats,
  formatMarketplaceTime,
  SERVICE_STATUSES,
  INVOCATION_STATUSES,
} from '../../src/utils/marketplace-parser.js'

const NOISE_PREAMBLE = [
  '[AppConfig] Configuration loaded',
  '[DatabaseManager] Database initialized: C:\\Users\\x\\db',
].join('\n')
const NOISE_TRAILER = '[DatabaseManager] Database closed'

function withNoise(jsonBody) {
  return `${NOISE_PREAMBLE}\n${jsonBody}\n${NOISE_TRAILER}`
}

// ─── frozen enums ────────────────────────────────────────────────────────────

describe('SERVICE_STATUSES + INVOCATION_STATUSES', () => {
  it('exposes the 4 service statuses in CLI order', () => {
    expect(SERVICE_STATUSES).toEqual(['draft', 'published', 'deprecated', 'suspended'])
  })

  it('exposes the 5 invocation statuses', () => {
    expect(INVOCATION_STATUSES).toEqual(['pending', 'running', 'success', 'failed', 'timeout'])
  })

  it('both enums are frozen', () => {
    expect(Object.isFrozen(SERVICE_STATUSES)).toBe(true)
    expect(Object.isFrozen(INVOCATION_STATUSES)).toBe(true)
  })
})

// ─── parseServices ───────────────────────────────────────────────────────────

describe('parseServices', () => {
  it('returns empty array for empty / non-array output', () => {
    expect(parseServices('')).toEqual([])
    expect(parseServices('{}')).toEqual([])
    expect(parseServices('error: db locked')).toEqual([])
  })

  it('parses a clean array of services', () => {
    const json = JSON.stringify([
      {
        id: 's1',
        name: 'fancy-skill',
        version: '1.2.3',
        description: 'desc',
        endpoint: 'https://x',
        status: 'published',
        owner: 'did:key:abc',
        invocationCount: 7,
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
      },
      { id: 's2', name: 'b' },
    ])
    const list = parseServices(json)
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('s1')
    expect(list[0].name).toBe('fancy-skill')
    expect(list[0].invocationCount).toBe(7)
    expect(list[0].status).toBe('published')
    expect(list[1].name).toBe('b')
    expect(list[1].invocationCount).toBe(0)
    expect(list[1].status).toBe('draft')
  })

  it('survives CLI bootstrap noise', () => {
    const json = JSON.stringify([{ id: 's1', name: 'x', status: 'published' }])
    expect(parseServices(withNoise(json))).toHaveLength(1)
  })

  it('parses an empty array', () => {
    expect(parseServices(withNoise('[]'))).toEqual([])
  })

  it('falls back to snake_case invocation_count + created_at', () => {
    const json = JSON.stringify([
      { id: 's1', name: 'x', invocation_count: 4, created_at: 1700000000000 },
    ])
    const [s] = parseServices(json)
    expect(s.invocationCount).toBe(4)
    expect(s.createdAt).toBe(1700000000000)
  })

  it('drops entries without an id', () => {
    const json = JSON.stringify([{ name: 'orphan' }, { id: 's1', name: 'ok' }])
    expect(parseServices(json)).toHaveLength(1)
  })

  it('lowercases status', () => {
    const json = JSON.stringify([{ id: 's1', name: 'x', status: 'PUBLISHED' }])
    expect(parseServices(json)[0].status).toBe('published')
  })

  it('uses service id as table row key', () => {
    const json = JSON.stringify([{ id: 's1', name: 'a' }])
    expect(parseServices(json)[0].key).toBe('s1')
  })
})

// ─── parseService (single envelope) ──────────────────────────────────────────

describe('parseService', () => {
  it('returns null for empty / array output', () => {
    expect(parseService('')).toBeNull()
    expect(parseService('[]')).toBeNull()
  })

  it('normalizes a single envelope', () => {
    const json = JSON.stringify({ id: 's1', name: 'a', version: '1.0.0', status: 'published' })
    const s = parseService(json)
    expect(s.id).toBe('s1')
    expect(s.version).toBe('1.0.0')
  })

  it('returns null when service lacks an id', () => {
    expect(parseService(JSON.stringify({ name: 'noid' }))).toBeNull()
  })
})

// ─── parseInvocations ────────────────────────────────────────────────────────

describe('parseInvocations', () => {
  it('returns empty array for empty output', () => {
    expect(parseInvocations('')).toEqual([])
  })

  it('parses a clean invocation array', () => {
    const json = JSON.stringify([
      {
        id: 'i1',
        serviceId: 's1',
        callerId: 'did:key:c',
        status: 'success',
        durationMs: 150,
        createdAt: 1700000000000,
      },
      { id: 'i2', serviceId: 's2', status: 'failed', error: 'boom' },
    ])
    const list = parseInvocations(json)
    expect(list).toHaveLength(2)
    expect(list[0].serviceId).toBe('s1')
    expect(list[0].durationMs).toBe(150)
    expect(list[1].error).toBe('boom')
    expect(list[1].callerId).toBe('')
  })

  it('falls back to snake_case service_id + caller_id + duration_ms', () => {
    const json = JSON.stringify([
      { id: 'i1', service_id: 's1', caller_id: 'did:c', duration_ms: 50 },
    ])
    const [inv] = parseInvocations(json)
    expect(inv.serviceId).toBe('s1')
    expect(inv.callerId).toBe('did:c')
    expect(inv.durationMs).toBe(50)
  })

  it('defaults status to success when missing', () => {
    const json = JSON.stringify([{ id: 'i1', serviceId: 's1' }])
    expect(parseInvocations(json)[0].status).toBe('success')
  })

  it('drops entries without an id', () => {
    const json = JSON.stringify([{ serviceId: 's1' }, { id: 'i1', serviceId: 's1' }])
    expect(parseInvocations(json)).toHaveLength(1)
  })
})

// ─── parseStats ──────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns zero-valued stats for empty / non-object output', () => {
    const empty = parseStats('')
    expect(empty.total).toBe(0)
    expect(empty.counts.success).toBe(0)
    expect(empty.successRate).toBe(0)
    expect(empty.avgDurationMs).toBe(0)
    expect(empty.scopedToService).toBeNull()
  })

  it('parses a complete stats payload', () => {
    const json = JSON.stringify({
      total: 100,
      counts: { success: 80, failed: 15, timeout: 3, pending: 1, running: 1 },
      successRate: 0.8,
      avgDurationMs: 250,
      scopedToService: 's1',
    })
    const stats = parseStats(json)
    expect(stats.total).toBe(100)
    expect(stats.counts.success).toBe(80)
    expect(stats.counts.failed).toBe(15)
    expect(stats.successRate).toBe(0.8)
    expect(stats.avgDurationMs).toBe(250)
    expect(stats.scopedToService).toBe('s1')
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ total: 5, counts: { success: 5, failed: 0, timeout: 0, pending: 0, running: 0 }, successRate: 1, avgDurationMs: 10 })
    expect(parseStats(withNoise(json)).total).toBe(5)
  })

  it('falls back to zeros for missing counts fields', () => {
    const json = JSON.stringify({ total: 3, counts: { success: 3 }, successRate: 1 })
    const stats = parseStats(json)
    expect(stats.counts.success).toBe(3)
    expect(stats.counts.failed).toBe(0)
    expect(stats.counts.timeout).toBe(0)
  })

  it('treats non-object counts as all zeros', () => {
    const json = JSON.stringify({ total: 3, counts: null })
    const stats = parseStats(json)
    expect(stats.counts.success).toBe(0)
  })

  it('accepts snake_case successRate / avgDurationMs / scopedToService', () => {
    const json = JSON.stringify({
      total: 1,
      counts: { success: 1 },
      success_rate: 1,
      avg_duration_ms: 99,
      scoped_to_service: 'svc1',
    })
    const stats = parseStats(json)
    expect(stats.successRate).toBe(1)
    expect(stats.avgDurationMs).toBe(99)
    expect(stats.scopedToService).toBe('svc1')
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseStats('[]').total).toBe(0)
  })
})

// ─── formatMarketplaceTime ──────────────────────────────────────────────────

describe('formatMarketplaceTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatMarketplaceTime(null)).toBe('—')
    expect(formatMarketplaceTime('')).toBe('—')
    expect(formatMarketplaceTime(undefined)).toBe('—')
  })

  it('formats a numeric ms timestamp', () => {
    const ts = 1700000000000
    const formatted = formatMarketplaceTime(ts)
    expect(formatted).not.toBe(String(ts))
    expect(formatted.length).toBeGreaterThan(8)
  })

  it('formats an ISO string timestamp', () => {
    const formatted = formatMarketplaceTime('2026-04-26T10:00:00Z')
    expect(formatted).toMatch(/2026/)
  })

  it('returns raw value for non-parseable input', () => {
    expect(formatMarketplaceTime('not a date')).toBe('not a date')
  })
})
