/**
 * Unit tests for src/utils/privacy-parser.js
 *
 * Run: npx vitest run __tests__/unit/privacy-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseCatalog,
  parseEnumList,
  parseModels,
  parseComputations,
  parseDPResult,
  parseHEResult,
  parseReport,
  formatPrivacyTime,
  FL_STATUSES,
  MPC_STATUSES,
  MPC_PROTOCOLS,
  DP_MECHANISMS,
  HE_SCHEMES,
  HE_OPERATIONS,
} from '../../src/utils/privacy-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('FL_STATUSES contains the 5 lifecycle states', () => {
    expect(FL_STATUSES).toEqual(['initializing', 'training', 'aggregating', 'completed', 'failed'])
  })
  it('MPC_STATUSES contains the 3 transitions', () => {
    expect(MPC_STATUSES).toEqual(['pending', 'computing', 'completed'])
  })
  it('MPC_PROTOCOLS lists shamir / beaver / gmw', () => {
    expect(MPC_PROTOCOLS).toEqual(['shamir', 'beaver', 'gmw'])
  })
  it('DP_MECHANISMS lists laplace / gaussian / exponential', () => {
    expect(DP_MECHANISMS).toEqual(['laplace', 'gaussian', 'exponential'])
  })
  it('HE_SCHEMES lists paillier / bfv / ckks', () => {
    expect(HE_SCHEMES).toEqual(['paillier', 'bfv', 'ckks'])
  })
  it('HE_OPERATIONS lists 4 supported ops', () => {
    expect(HE_OPERATIONS).toEqual(['sum', 'product', 'mean', 'count'])
  })
  it('all enums frozen', () => {
    for (const e of [FL_STATUSES, MPC_STATUSES, MPC_PROTOCOLS, DP_MECHANISMS, HE_SCHEMES, HE_OPERATIONS]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── parseCatalog ───────────────────────────────────────────────────────────

describe('parseCatalog', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseCatalog('')).toEqual([])
    expect(parseCatalog('{}')).toEqual([])
  })

  it('parses {id,name,description} entries', () => {
    const json = JSON.stringify([
      { id: 'shamir', name: 'Shamir Secret Sharing', description: 'Shamir 秘密分享' },
      { id: 'beaver', name: 'Beaver Triples', description: 'Beaver 三元组乘法' },
    ])
    const list = parseCatalog(json)
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('shamir')
    expect(list[0].name).toBe('Shamir Secret Sharing')
    expect(list[1].description).toBe('Beaver 三元组乘法')
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'laplace', name: 'Laplace', description: '拉普拉斯噪声' }])
    expect(parseCatalog(withNoise(json))).toHaveLength(1)
  })

  it('drops entries without id', () => {
    expect(parseCatalog(JSON.stringify([{ name: 'orphan' }]))).toEqual([])
  })

  it('uses id as table row key', () => {
    expect(parseCatalog(JSON.stringify([{ id: 'ckks', name: 'CKKS' }]))[0].key).toBe('ckks')
  })
})

// ─── parseEnumList ──────────────────────────────────────────────────────────

describe('parseEnumList', () => {
  it('returns the array of strings', () => {
    expect(parseEnumList('["initializing","training","completed"]')).toEqual(['initializing', 'training', 'completed'])
  })

  it('returns empty for empty / non-array output', () => {
    expect(parseEnumList('')).toEqual([])
    expect(parseEnumList('{"a":1}')).toEqual([])
  })

  it('filters non-strings out', () => {
    expect(parseEnumList(JSON.stringify(['a', 1, null, 'b']))).toEqual(['a', 'b'])
  })

  it('survives CLI noise', () => {
    expect(parseEnumList(withNoise('["pending","computing"]'))).toEqual(['pending', 'computing'])
  })
})

// ─── parseModels (FL) ───────────────────────────────────────────────────────

describe('parseModels', () => {
  it('returns empty for empty output', () => {
    expect(parseModels('')).toEqual([])
  })

  it('parses snake_case DB rows into camelCase', () => {
    const json = JSON.stringify([
      {
        id: 'm1',
        name: 'fraud-detector',
        model_type: 'neural_network',
        architecture: 'mlp',
        status: 'training',
        current_round: 3,
        total_rounds: 10,
        participant_count: 5,
        accuracy: 0.85,
        loss: 0.15,
        learning_rate: 0.01,
        aggregation_strategy: 'fedavg',
        privacy_budget_spent: 0.3,
        created_at: 1700000000000,
        updated_at: 1700000001000,
      },
    ])
    const [m] = parseModels(json)
    expect(m.id).toBe('m1')
    expect(m.name).toBe('fraud-detector')
    expect(m.modelType).toBe('neural_network')
    expect(m.currentRound).toBe(3)
    expect(m.totalRounds).toBe(10)
    expect(m.participantCount).toBe(5)
    expect(m.learningRate).toBe(0.01)
    expect(m.privacyBudgetSpent).toBe(0.3)
    expect(m.aggregationStrategy).toBe('fedavg')
  })

  it('lowercases status', () => {
    expect(parseModels(JSON.stringify([{ id: 'm1', status: 'TRAINING' }]))[0].status).toBe('training')
  })

  it('keeps loss=null when null in input (vs coercing to 0)', () => {
    const [m] = parseModels(JSON.stringify([{ id: 'm1', loss: null }]))
    expect(m.loss).toBeNull()
  })

  it('drops entries without id', () => {
    expect(parseModels(JSON.stringify([{ name: 'orphan' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'm1', name: 'a', status: 'completed' }])
    expect(parseModels(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseComputations (MPC) ────────────────────────────────────────────────

describe('parseComputations', () => {
  it('returns empty for empty output', () => {
    expect(parseComputations('')).toEqual([])
  })

  it('parses MPC computation rows', () => {
    const json = JSON.stringify([
      {
        id: 'c1',
        computation_type: 'sum',
        protocol: 'shamir',
        participant_count: 3,
        participant_ids: ['a', 'b', 'c'],
        result_hash: 'abc123',
        status: 'completed',
        shares_received: 3,
        shares_required: 2,
        computation_time_ms: 150,
        error_message: null,
        created_at: 1700000000000,
        completed_at: 1700000000150,
      },
    ])
    const [c] = parseComputations(json)
    expect(c.id).toBe('c1')
    expect(c.computationType).toBe('sum')
    expect(c.protocol).toBe('shamir')
    expect(c.participantIds).toEqual(['a', 'b', 'c'])
    expect(c.sharesReceived).toBe(3)
    expect(c.sharesRequired).toBe(2)
    expect(c.computationTimeMs).toBe(150)
    expect(c.resultHash).toBe('abc123')
  })

  it('parses participant_ids when stored as JSON string (sqlite TEXT col)', () => {
    const json = JSON.stringify([
      { id: 'c1', participant_ids: '["alice","bob"]', protocol: 'shamir', status: 'pending' },
    ])
    const [c] = parseComputations(json)
    expect(c.participantIds).toEqual(['alice', 'bob'])
  })

  it('coerces unparseable participant_ids string to empty array', () => {
    const json = JSON.stringify([
      { id: 'c1', participant_ids: 'not-json', protocol: 'shamir' },
    ])
    expect(parseComputations(json)[0].participantIds).toEqual([])
  })

  it('lowercases status', () => {
    expect(parseComputations(JSON.stringify([{ id: 'c1', status: 'COMPUTING' }]))[0].status).toBe('computing')
  })

  it('drops entries without id', () => {
    expect(parseComputations(JSON.stringify([{ protocol: 'shamir' }]))).toEqual([])
  })
})

// ─── parseDPResult ──────────────────────────────────────────────────────────

describe('parseDPResult', () => {
  it('returns null for empty / non-object', () => {
    expect(parseDPResult('')).toBeNull()
    expect(parseDPResult('[]')).toBeNull()
  })

  it('parses a published envelope', () => {
    const json = JSON.stringify({
      published: true,
      data: 13.639,
      epsilon: 0.1,
      delta: 0.00001,
      mechanism: 'laplace',
      budgetSpent: 0.1,
      budgetRemaining: 9.9,
    })
    const r = parseDPResult(json)
    expect(r.published).toBe(true)
    expect(r.data).toBe(13.639)
    expect(r.epsilon).toBe(0.1)
    expect(r.mechanism).toBe('laplace')
    expect(r.budgetSpent).toBe(0.1)
    expect(r.budgetRemaining).toBe(9.9)
  })

  it('parses a rejection envelope (budget exhausted)', () => {
    const json = JSON.stringify({ published: false, reason: 'budget_exhausted' })
    const r = parseDPResult(json)
    expect(r.published).toBe(false)
    expect(r.reason).toBe('budget_exhausted')
  })

  it('falls back to snake_case budget_spent', () => {
    const json = JSON.stringify({ published: true, budget_spent: 0.5, budget_remaining: 9.5 })
    const r = parseDPResult(json)
    expect(r.budgetSpent).toBe(0.5)
    expect(r.budgetRemaining).toBe(9.5)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ published: true, mechanism: 'gaussian' })
    expect(parseDPResult(withNoise(json)).mechanism).toBe('gaussian')
  })
})

// ─── parseHEResult ──────────────────────────────────────────────────────────

describe('parseHEResult', () => {
  it('returns null for empty output', () => {
    expect(parseHEResult('')).toBeNull()
  })

  it('parses a HE query envelope', () => {
    const json = JSON.stringify({
      result: 15,
      operation: 'sum',
      scheme: 'paillier',
      inputCount: 5,
      encrypted: true,
    })
    const r = parseHEResult(json)
    expect(r.result).toBe(15)
    expect(r.operation).toBe('sum')
    expect(r.scheme).toBe('paillier')
    expect(r.inputCount).toBe(5)
    expect(r.encrypted).toBe(true)
  })

  it('defaults encrypted=true when missing', () => {
    const r = parseHEResult(JSON.stringify({ result: 10 }))
    expect(r.encrypted).toBe(true)
  })

  it('respects explicit encrypted=false', () => {
    expect(parseHEResult(JSON.stringify({ encrypted: false })).encrypted).toBe(false)
  })

  it('falls back to snake_case input_count', () => {
    expect(parseHEResult(JSON.stringify({ input_count: 7 })).inputCount).toBe(7)
  })
})

// ─── parseReport ────────────────────────────────────────────────────────────

describe('parseReport', () => {
  it('returns full zero shape for empty output', () => {
    const r = parseReport('')
    expect(r.privacyBudget.spent).toBe(0)
    expect(r.privacyBudget.exhausted).toBe(false)
    expect(r.federatedLearning.totalModels).toBe(0)
    expect(r.mpc.totalComputations).toBe(0)
    expect(r.mpc.byProtocol).toEqual({})
  })

  it('parses a full report payload', () => {
    const json = JSON.stringify({
      privacyBudget: { spent: 2.5, limit: 10, remaining: 7.5, exhausted: false },
      federatedLearning: { totalModels: 8, completed: 5, training: 2, avgAccuracy: 0.87 },
      mpc: {
        totalComputations: 12, completed: 9, pending: 1,
        byProtocol: { shamir: 6, beaver: 4, gmw: 2 },
      },
    })
    const r = parseReport(json)
    expect(r.privacyBudget.spent).toBe(2.5)
    expect(r.privacyBudget.remaining).toBe(7.5)
    expect(r.federatedLearning.completed).toBe(5)
    expect(r.federatedLearning.avgAccuracy).toBe(0.87)
    expect(r.mpc.byProtocol.shamir).toBe(6)
    expect(r.mpc.byProtocol.gmw).toBe(2)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ privacyBudget: { spent: 1, limit: 10, remaining: 9, exhausted: false } })
    expect(parseReport(withNoise(json)).privacyBudget.spent).toBe(1)
  })

  it('treats non-object substructure as zero', () => {
    const json = JSON.stringify({ privacyBudget: null, federatedLearning: 'x' })
    const r = parseReport(json)
    expect(r.privacyBudget.spent).toBe(0)
    expect(r.federatedLearning.totalModels).toBe(0)
  })

  it('does not treat JSON arrays as a report', () => {
    expect(parseReport('[]').privacyBudget.spent).toBe(0)
  })

  it('drops non-numeric byProtocol entries', () => {
    const json = JSON.stringify({
      mpc: { totalComputations: 1, completed: 1, pending: 0, byProtocol: { shamir: 'oops', beaver: 2 } },
    })
    const r = parseReport(json)
    expect(r.mpc.byProtocol.shamir).toBeUndefined()
    expect(r.mpc.byProtocol.beaver).toBe(2)
  })
})

// ─── formatPrivacyTime ──────────────────────────────────────────────────────

describe('formatPrivacyTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatPrivacyTime(null)).toBe('—')
    expect(formatPrivacyTime('')).toBe('—')
    expect(formatPrivacyTime(undefined)).toBe('—')
  })

  it('formats a numeric ms timestamp', () => {
    expect(formatPrivacyTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatPrivacyTime('not-a-date')).toBe('not-a-date')
  })
})
