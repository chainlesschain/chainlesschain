/**
 * Unit tests for src/utils/tokens-parser.js
 *
 * Run: npx vitest run __tests__/unit/tokens-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseShowResult,
  parseBreakdown,
  parseRecent,
  parseCacheStats,
  parseStatsV2,
  detectTokensError,
  formatTokensTime,
  formatCost,
  PERIOD_OPTIONS,
  BUDGET_MATURITIES_V2,
  USAGE_RECORD_LIFECYCLES_V2,
} from '../../src/utils/tokens-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('PERIOD_OPTIONS = today/week/month/all', () => {
    expect(PERIOD_OPTIONS).toEqual(['today', 'week', 'month', 'all'])
  })
  it('BUDGET_MATURITIES_V2 = 4 entries', () => {
    expect(BUDGET_MATURITIES_V2).toEqual(['planning', 'active', 'suspended', 'archived'])
  })
  it('USAGE_RECORD_LIFECYCLES_V2 = 5 entries', () => {
    expect(USAGE_RECORD_LIFECYCLES_V2).toEqual([
      'pending', 'recorded', 'billed', 'rejected', 'refunded',
    ])
  })
  it('all enums frozen', () => {
    for (const e of [PERIOD_OPTIONS, BUDGET_MATURITIES_V2, USAGE_RECORD_LIFECYCLES_V2]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── detectTokensError ──────────────────────────────────────────────────────

describe('detectTokensError', () => {
  it('returns noDb=false on empty / clean output', () => {
    expect(detectTokensError('')).toEqual({ noDb: false, error: '' })
    expect(detectTokensError('[]')).toEqual({ noDb: false, error: '' })
  })

  it('detects "Database not available"', () => {
    expect(detectTokensError('Database not available'))
      .toEqual({ noDb: true, error: 'Database not available' })
  })

  it('still detects error wrapped in CLI noise', () => {
    expect(detectTokensError(withNoise('Database not available')).noDb).toBe(true)
  })

  it('case-insensitive', () => {
    expect(detectTokensError('DATABASE NOT AVAILABLE').noDb).toBe(true)
  })
})

// ─── parseShowResult ───────────────────────────────────────────────────────

describe('parseShowResult', () => {
  it('returns full pre-keyed shape for empty / non-object output', () => {
    const r = parseShowResult('')
    expect(r.stats.totalCalls).toBe(0)
    expect(r.stats.totalCostUsd).toBe(0)
    expect(r.today.totalCalls).toBe(0)
  })

  it('parses {stats, today} envelope from snake_case', () => {
    const json = JSON.stringify({
      stats: {
        total_calls: 100, total_input_tokens: 50000, total_output_tokens: 30000,
        total_tokens: 80000, total_cost_usd: 12.34, avg_response_time_ms: 850,
      },
      today: {
        total_calls: 5, total_input_tokens: 2000, total_output_tokens: 1500,
        total_tokens: 3500, total_cost_usd: 0.5, avg_response_time_ms: 700,
      },
    })
    const r = parseShowResult(json)
    expect(r.stats.totalCalls).toBe(100)
    expect(r.stats.totalInputTokens).toBe(50000)
    expect(r.stats.totalOutputTokens).toBe(30000)
    expect(r.stats.totalTokens).toBe(80000)
    expect(r.stats.totalCostUsd).toBe(12.34)
    expect(r.stats.avgResponseTimeMs).toBe(850)
    expect(r.today.totalCalls).toBe(5)
    expect(r.today.totalCostUsd).toBe(0.5)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ stats: { total_calls: 3 }, today: {} })
    expect(parseShowResult(withNoise(json)).stats.totalCalls).toBe(3)
  })

  it('also accepts pre-camelCased input', () => {
    const json = JSON.stringify({
      stats: { totalCalls: 5, totalCostUsd: 1.5 },
      today: { totalCalls: 1 },
    })
    const r = parseShowResult(json)
    expect(r.stats.totalCalls).toBe(5)
    expect(r.stats.totalCostUsd).toBe(1.5)
    expect(r.today.totalCalls).toBe(1)
  })

  it('coerces missing inner fields to 0', () => {
    const json = JSON.stringify({ stats: {}, today: {} })
    const r = parseShowResult(json)
    expect(r.stats.totalCalls).toBe(0)
    expect(r.stats.avgResponseTimeMs).toBe(0)
  })
})

// ─── parseBreakdown ────────────────────────────────────────────────────────

describe('parseBreakdown', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseBreakdown('')).toEqual([])
    expect(parseBreakdown('{}')).toEqual([])
  })

  it('parses provider/model breakdown rows', () => {
    const json = JSON.stringify([
      {
        provider: 'anthropic', model: 'claude-opus',
        calls: 50, input_tokens: 25000, output_tokens: 12000,
        total_tokens: 37000, cost_usd: 8.5,
      },
      {
        provider: 'openai', model: 'gpt-4',
        calls: 30, input_tokens: 15000, output_tokens: 8000,
        total_tokens: 23000, cost_usd: 5.2,
      },
    ])
    const list = parseBreakdown(json)
    expect(list).toHaveLength(2)
    expect(list[0].provider).toBe('anthropic')
    expect(list[0].model).toBe('claude-opus')
    expect(list[0].calls).toBe(50)
    expect(list[0].costUsd).toBe(8.5)
    expect(list[1].provider).toBe('openai')
    expect(list[1].costUsd).toBe(5.2)
  })

  it('drops entries with both provider and model missing', () => {
    expect(parseBreakdown(JSON.stringify([{ calls: 5 }]))).toEqual([])
  })

  it('keeps entries with only provider OR only model', () => {
    const json = JSON.stringify([
      { provider: 'anthropic', calls: 1 },
      { model: 'gpt-4', calls: 1 },
    ])
    expect(parseBreakdown(json)).toHaveLength(2)
  })

  it('coerces missing token fields to 0', () => {
    const json = JSON.stringify([{ provider: 'anthropic', model: 'claude' }])
    const [r] = parseBreakdown(json)
    expect(r.calls).toBe(0)
    expect(r.totalTokens).toBe(0)
    expect(r.costUsd).toBe(0)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ provider: 'a', model: 'b', calls: 1, cost_usd: 0.1 }])
    expect(parseBreakdown(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseRecent ───────────────────────────────────────────────────────────

describe('parseRecent', () => {
  it('returns empty for empty output', () => {
    expect(parseRecent('')).toEqual([])
  })

  it('parses recent call rows from snake_case', () => {
    const json = JSON.stringify([
      {
        id: 'call-1', provider: 'anthropic', model: 'claude-opus',
        input_tokens: 500, output_tokens: 300, total_tokens: 800,
        cost_usd: 0.024, response_time_ms: 1200,
        endpoint: '/v1/messages',
        created_at: '2024-03-15 10:30:00',
      },
    ])
    const [r] = parseRecent(json)
    expect(r.id).toBe('call-1')
    expect(r.provider).toBe('anthropic')
    expect(r.totalTokens).toBe(800)
    expect(r.costUsd).toBe(0.024)
    expect(r.responseTimeMs).toBe(1200)
    expect(r.endpoint).toBe('/v1/messages')
  })

  it('drops entries without id', () => {
    expect(parseRecent(JSON.stringify([{ provider: 'a', model: 'b' }]))).toEqual([])
  })

  it('also accepts pre-camelCased', () => {
    const json = JSON.stringify([{
      id: 'c1', provider: 'a', model: 'b',
      totalTokens: 100, costUsd: 0.05, responseTimeMs: 500,
      createdAt: '2024-01-01T00:00:00Z',
    }])
    const [r] = parseRecent(json)
    expect(r.totalTokens).toBe(100)
    expect(r.costUsd).toBe(0.05)
    expect(r.createdAt).toBe('2024-01-01T00:00:00Z')
  })
})

// ─── parseCacheStats ───────────────────────────────────────────────────────

describe('parseCacheStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const c = parseCacheStats('')
    expect(c.totalEntries).toBe(0)
    expect(c.totalHits).toBe(0)
    expect(c.totalTokensSaved).toBe(0)
    expect(c.expiredEntries).toBe(0)
  })

  it('parses cache stats payload', () => {
    const json = JSON.stringify({
      total_entries: 42, total_hits: 128, total_tokens_saved: 50000, expired_entries: 5,
    })
    const c = parseCacheStats(json)
    expect(c.totalEntries).toBe(42)
    expect(c.totalHits).toBe(128)
    expect(c.totalTokensSaved).toBe(50000)
    expect(c.expiredEntries).toBe(5)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ total_entries: 7 })
    expect(parseCacheStats(withNoise(json)).totalEntries).toBe(7)
  })

  it('also accepts camelCase', () => {
    const json = JSON.stringify({ totalEntries: 3, totalHits: 10 })
    const c = parseCacheStats(json)
    expect(c.totalEntries).toBe(3)
    expect(c.totalHits).toBe(10)
  })
})

// ─── parseStatsV2 ──────────────────────────────────────────────────────────

describe('parseStatsV2', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStatsV2('')
    expect(s.totalBudgetsV2).toBe(0)
    for (const k of BUDGET_MATURITIES_V2) expect(s.budgetsByStatus[k]).toBe(0)
    for (const k of USAGE_RECORD_LIFECYCLES_V2) expect(s.recordsByStatus[k]).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      totalBudgetsV2: 8, totalRecordsV2: 50,
      maxActiveBudgetsPerOwner: 3, maxPendingRecordsPerBudget: 100,
      budgetIdleMs: 86400000, recordStuckMs: 3600000,
      budgetsByStatus: { planning: 1, active: 5, suspended: 1, archived: 1 },
      recordsByStatus: { pending: 5, recorded: 30, billed: 12, rejected: 2, refunded: 1 },
    })
    const s = parseStatsV2(json)
    expect(s.totalBudgetsV2).toBe(8)
    expect(s.budgetsByStatus.active).toBe(5)
    expect(s.recordsByStatus.billed).toBe(12)
  })

  it('drops non-numeric byStatus entries', () => {
    const json = JSON.stringify({
      budgetsByStatus: { planning: 'oops', active: 2 },
    })
    const s = parseStatsV2(json)
    expect(s.budgetsByStatus.planning).toBe(0)
    expect(s.budgetsByStatus.active).toBe(2)
  })
})

// ─── formatTokensTime ──────────────────────────────────────────────────────

describe('formatTokensTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatTokensTime(null)).toBe('—')
    expect(formatTokensTime('')).toBe('—')
  })

  it('formats sqlite "YYYY-MM-DD HH:MM:SS"', () => {
    expect(formatTokensTime('2024-03-15 10:30:00').length).toBeGreaterThan(8)
  })

  it('formats numeric ms timestamp', () => {
    expect(formatTokensTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatTokensTime('not-a-date')).toBe('not-a-date')
  })
})

// ─── formatCost ────────────────────────────────────────────────────────────

describe('formatCost', () => {
  it('returns $0 for non-numeric input', () => {
    expect(formatCost(null)).toBe('$0')
    expect(formatCost(undefined)).toBe('$0')
    expect(formatCost(NaN)).toBe('$0')
    expect(formatCost('5')).toBe('$0')
  })

  it('uses 4 decimals for sub-$1 amounts', () => {
    expect(formatCost(0.0234)).toBe('$0.0234')
    expect(formatCost(0.5)).toBe('$0.5000')
  })

  it('uses 2 decimals for $1+', () => {
    expect(formatCost(12.345)).toBe('$12.35')
    expect(formatCost(1)).toBe('$1.00')
  })

  it('handles 0', () => {
    expect(formatCost(0)).toBe('$0.0000')
  })
})
