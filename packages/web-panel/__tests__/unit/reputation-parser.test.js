/**
 * Unit tests for src/utils/reputation-parser.js
 *
 * Run: npx vitest run __tests__/unit/reputation-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseScores,
  parseScore,
  parseObservation,
  parseAnomalies,
  parseRun,
  parseRuns,
  parseAnalytics,
  parseStatsV2,
  detectReputationError,
  formatReputationTime,
  OPTIMIZATION_OBJECTIVES,
  DECAY_MODELS,
  ANOMALY_METHODS,
  RUN_STATUSES,
  OBSERVATION_KINDS,
} from '../../src/utils/reputation-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('OPTIMIZATION_OBJECTIVES = 4 entries', () => {
    expect(OPTIMIZATION_OBJECTIVES).toEqual([
      'accuracy', 'fairness', 'resilience', 'convergence_speed',
    ])
  })
  it('DECAY_MODELS = 4 entries (none/exponential/linear/step)', () => {
    expect(DECAY_MODELS).toEqual(['none', 'exponential', 'linear', 'step'])
  })
  it('ANOMALY_METHODS = z_score/iqr', () => {
    expect(ANOMALY_METHODS).toEqual(['z_score', 'iqr'])
  })
  it('RUN_STATUSES = running/complete/applied/failed/cancelled', () => {
    expect(RUN_STATUSES).toEqual(['running', 'complete', 'applied', 'failed', 'cancelled'])
  })
  it('OBSERVATION_KINDS = generic/task/review/vote', () => {
    expect(OBSERVATION_KINDS).toEqual(['generic', 'task', 'review', 'vote'])
  })
  it('all enums frozen', () => {
    for (const e of [OPTIMIZATION_OBJECTIVES, DECAY_MODELS, ANOMALY_METHODS, RUN_STATUSES, OBSERVATION_KINDS]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── detectReputationError ─────────────────────────────────────────────────

describe('detectReputationError', () => {
  it('returns noDb=false on empty / clean output', () => {
    expect(detectReputationError('')).toEqual({ noDb: false, error: '' })
    expect(detectReputationError('[]')).toEqual({ noDb: false, error: '' })
  })

  it('detects "Database not available"', () => {
    expect(detectReputationError('Database not available'))
      .toEqual({ noDb: true, error: 'Database not available' })
  })

  it('still detects error wrapped in CLI noise', () => {
    expect(detectReputationError(withNoise('Database not available')).noDb).toBe(true)
  })

  it('case-insensitive', () => {
    expect(detectReputationError('DATABASE NOT AVAILABLE').noDb).toBe(true)
  })
})

// ─── parseScores ───────────────────────────────────────────────────────────

describe('parseScores', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseScores('')).toEqual([])
    expect(parseScores('Database not available')).toEqual([])
    expect(parseScores('{}')).toEqual([])
  })

  it('parses score rows', () => {
    const json = JSON.stringify([
      { did: 'did:key:A', score: 0.92, observations: 12, decay: 'exponential', weightTotal: 8.5 },
      { did: 'did:key:B', score: 0.4, observations: 3, decay: 'none', weightTotal: 3 },
    ])
    const list = parseScores(json)
    expect(list).toHaveLength(2)
    expect(list[0].did).toBe('did:key:A')
    expect(list[0].score).toBe(0.92)
    expect(list[0].observations).toBe(12)
    expect(list[0].decay).toBe('exponential')
    expect(list[0].weightTotal).toBe(8.5)
  })

  it('coerces missing numeric fields to 0', () => {
    const [r] = parseScores(JSON.stringify([{ did: 'did:key:A' }]))
    expect(r.score).toBe(0)
    expect(r.observations).toBe(0)
    expect(r.weightTotal).toBe(0)
    expect(r.decay).toBe('none')
  })

  it('drops entries without did', () => {
    expect(parseScores(JSON.stringify([{ score: 0.5 }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ did: 'did:key:A', score: 0.5 }])
    expect(parseScores(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseScore ─────────────────────────────────────────────────────────────

describe('parseScore', () => {
  it('returns null for empty / array output', () => {
    expect(parseScore('')).toBeNull()
    expect(parseScore('[]')).toBeNull()
  })

  it('parses a single score envelope', () => {
    const json = JSON.stringify({ did: 'did:key:A', score: 0.7, observations: 5, decay: 'linear' })
    const r = parseScore(json)
    expect(r.did).toBe('did:key:A')
    expect(r.score).toBe(0.7)
  })

  it('returns null when did missing', () => {
    expect(parseScore(JSON.stringify({ score: 0.5 }))).toBeNull()
  })
})

// ─── parseObservation ──────────────────────────────────────────────────────

describe('parseObservation', () => {
  it('returns null for empty / array output', () => {
    expect(parseObservation('')).toBeNull()
    expect(parseObservation('[]')).toBeNull()
  })

  it('parses observation envelope', () => {
    const json = JSON.stringify({
      observationId: 'obs-1', did: 'did:key:A', score: 0.8,
      kind: 'review', weight: 1.5, recordedAt: 1700000000000,
    })
    const o = parseObservation(json)
    expect(o.observationId).toBe('obs-1')
    expect(o.did).toBe('did:key:A')
    expect(o.score).toBe(0.8)
    expect(o.kind).toBe('review')
    expect(o.weight).toBe(1.5)
  })

  it('falls back to id field when observationId missing', () => {
    const json = JSON.stringify({ id: 'obs-1', did: 'did:key:A', score: 0.5 })
    expect(parseObservation(json).observationId).toBe('obs-1')
  })

  it('defaults missing kind/weight', () => {
    const o = parseObservation(JSON.stringify({ did: 'did:key:A', score: 0.5 }))
    expect(o.kind).toBe('generic')
    expect(o.weight).toBe(1)
  })
})

// ─── parseAnomalies ─────────────────────────────────────────────────────────

describe('parseAnomalies', () => {
  it('returns empty shape for empty / non-object output', () => {
    const r = parseAnomalies('')
    expect(r.method).toBe('')
    expect(r.threshold).toBe(0)
    expect(r.totalSamples).toBe(0)
    expect(r.anomalies).toEqual([])
  })

  it('parses z_score result with anomalies', () => {
    const json = JSON.stringify({
      method: 'z_score', threshold: 2.5, totalSamples: 10,
      summary: '2 anomalies detected',
      anomalies: [
        { did: 'did:key:A', score: 0.95, zScore: 2.8, reason: 'unusually high' },
        { did: 'did:key:B', score: 0.05, zScore: -2.6, reason: 'unusually low' },
      ],
    })
    const r = parseAnomalies(json)
    expect(r.method).toBe('z_score')
    expect(r.threshold).toBe(2.5)
    expect(r.totalSamples).toBe(10)
    expect(r.anomalies).toHaveLength(2)
    expect(r.anomalies[0].zScore).toBe(2.8)
    expect(r.summary).toBe('2 anomalies detected')
  })

  it('parses iqr result with bound fields', () => {
    const json = JSON.stringify({
      method: 'iqr', threshold: 1.5, totalSamples: 8,
      anomalies: [
        { did: 'did:key:A', score: 0.99, reason: 'above upper fence', lower: 0.1, upper: 0.9 },
      ],
    })
    const r = parseAnomalies(json)
    expect(r.anomalies[0].lower).toBe(0.1)
    expect(r.anomalies[0].upper).toBe(0.9)
  })

  it('preserves message when sample size insufficient', () => {
    const json = JSON.stringify({
      method: 'z_score', threshold: 2.5, totalSamples: 1,
      anomalies: [],
      message: 'Insufficient samples for anomaly detection (<3)',
    })
    const r = parseAnomalies(json)
    expect(r.anomalies).toEqual([])
    expect(r.message).toContain('Insufficient')
  })

  it('drops anomaly entries without did', () => {
    const json = JSON.stringify({
      method: 'z_score', threshold: 2.5, totalSamples: 5,
      anomalies: [{ score: 0.99, reason: 'oops' }, { did: 'did:key:A', score: 0.5 }],
    })
    expect(parseAnomalies(json).anomalies).toHaveLength(1)
  })
})

// ─── parseRun ──────────────────────────────────────────────────────────────

describe('parseRun', () => {
  it('returns null for empty / array output', () => {
    expect(parseRun('')).toBeNull()
    expect(parseRun('[]')).toBeNull()
  })

  it('parses run envelope (sync optimize result)', () => {
    const json = JSON.stringify({
      runId: 'r1', objective: 'accuracy', iterations: 50,
      paramSpace: { lambda: [0.01, 0.5] },
      bestParams: { lambda: 0.1, kappa: 2.5, contamination: 0.05 },
      bestScore: 0.87, status: 'complete',
      createdAt: 1700000000000, completedAt: 1700000001000,
    })
    const r = parseRun(json)
    expect(r.runId).toBe('r1')
    expect(r.objective).toBe('accuracy')
    expect(r.iterations).toBe(50)
    expect(r.bestScore).toBe(0.87)
    expect(r.status).toBe('complete')
    expect(r.bestParams.lambda).toBe(0.1)
  })

  it('lowercases status', () => {
    expect(parseRun(JSON.stringify({ runId: 'r1', status: 'RUNNING' })).status).toBe('running')
  })

  it('returns null when runId missing', () => {
    expect(parseRun(JSON.stringify({ objective: 'accuracy' }))).toBeNull()
  })
})

// ─── parseRuns ─────────────────────────────────────────────────────────────

describe('parseRuns', () => {
  it('returns empty for empty output', () => {
    expect(parseRuns('')).toEqual([])
  })

  it('parses run history rows', () => {
    const json = JSON.stringify([
      { runId: 'r1', objective: 'accuracy', iterations: 50, bestScore: 0.87, status: 'applied' },
      { runId: 'r2', objective: 'fairness', iterations: 30, bestScore: 0.71, status: 'complete' },
    ])
    const list = parseRuns(json)
    expect(list).toHaveLength(2)
    expect(list[0].status).toBe('applied')
  })

  it('drops entries without runId', () => {
    expect(parseRuns(JSON.stringify([{ objective: 'accuracy' }]))).toEqual([])
  })
})

// ─── parseAnalytics ────────────────────────────────────────────────────────

describe('parseAnalytics', () => {
  it('returns null for empty / array output', () => {
    expect(parseAnalytics('')).toBeNull()
    expect(parseAnalytics('[]')).toBeNull()
  })

  it('parses analytics envelope with distribution', () => {
    const json = JSON.stringify({
      analyticsId: 'a1', runId: 'r1',
      reputationDistribution: {
        buckets: [
          { label: '[0.0, 0.2)', count: 1, min: 0, max: 0.2 },
          { label: '[0.2, 0.4)', count: 3 },
          { label: '[0.8, 1.0]', count: 2 },
        ],
        mean: 0.55, stdDev: 0.2,
      },
      anomalies: { method: 'z_score', totalSamples: 6, anomalies: [], summary: '0 anomalies detected' },
      recommendations: ['Try fairness objective', 'Increase iterations'],
    })
    const a = parseAnalytics(json)
    expect(a.runId).toBe('r1')
    expect(a.reputationDistribution.buckets).toHaveLength(3)
    expect(a.reputationDistribution.buckets[0].label).toBe('[0.0, 0.2)')
    expect(a.reputationDistribution.mean).toBe(0.55)
    expect(a.anomalies.method).toBe('z_score')
    expect(a.recommendations).toHaveLength(2)
  })

  it('coerces missing arrays to []', () => {
    const a = parseAnalytics(JSON.stringify({ analyticsId: 'a1', runId: 'r1' }))
    expect(a.reputationDistribution.buckets).toEqual([])
    expect(a.recommendations).toEqual([])
    expect(a.anomalies.anomalies).toEqual([])
  })

  it('filters non-string recommendations', () => {
    const json = JSON.stringify({
      analyticsId: 'a1', runId: 'r1',
      recommendations: ['rec1', 42, null, 'rec2'],
    })
    expect(parseAnalytics(json).recommendations).toEqual(['rec1', 'rec2'])
  })
})

// ─── parseStatsV2 ──────────────────────────────────────────────────────────

describe('parseStatsV2', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStatsV2('')
    expect(s.totalRuns).toBe(0)
    expect(s.activeRuns).toBe(0)
    expect(s.maxConcurrentOptimizations).toBe(0)
    expect(s.bestScoreEver).toBe(0)
    expect(s.observations.totalObservations).toBe(0)
    expect(s.observations.totalDids).toBe(0)
    // All 5 statuses pre-keyed at 0
    for (const r of RUN_STATUSES) expect(s.byStatus[r]).toBe(0)
    // All 4 objectives pre-keyed at 0
    for (const o of OPTIMIZATION_OBJECTIVES) expect(s.byObjective[o]).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      totalRuns: 10,
      activeRuns: 1,
      maxConcurrentOptimizations: 2,
      byStatus: { running: 1, complete: 4, applied: 3, failed: 1, cancelled: 1 },
      byObjective: { accuracy: 6, fairness: 2, resilience: 1, convergence_speed: 1 },
      observations: { totalObservations: 250, totalDids: 30 },
      bestScoreEver: 0.93,
    })
    const s = parseStatsV2(json)
    expect(s.totalRuns).toBe(10)
    expect(s.byStatus.applied).toBe(3)
    expect(s.byObjective.accuracy).toBe(6)
    expect(s.observations.totalObservations).toBe(250)
    expect(s.observations.totalDids).toBe(30)
    expect(s.bestScoreEver).toBe(0.93)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ totalRuns: 5 })
    expect(parseStatsV2(withNoise(json)).totalRuns).toBe(5)
  })

  it('drops non-numeric byStatus / byObjective entries', () => {
    const json = JSON.stringify({
      byStatus: { running: 'oops', complete: 4 },
      byObjective: { accuracy: 'x', fairness: 2 },
    })
    const s = parseStatsV2(json)
    expect(s.byStatus.running).toBe(0)  // pre-keyed default
    expect(s.byStatus.complete).toBe(4)
    expect(s.byObjective.accuracy).toBe(0)
    expect(s.byObjective.fairness).toBe(2)
  })
})

// ─── formatReputationTime ──────────────────────────────────────────────────

describe('formatReputationTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatReputationTime(null)).toBe('—')
    expect(formatReputationTime('')).toBe('—')
  })

  it('formats numeric ms timestamp', () => {
    expect(formatReputationTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatReputationTime('not-a-date')).toBe('not-a-date')
  })
})
