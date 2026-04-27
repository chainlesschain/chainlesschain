/**
 * Unit tests for src/utils/governance-parser.js
 *
 * Run: npx vitest run __tests__/unit/governance-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseTypes,
  parseStatuses,
  parseImpactLevels,
  parseProposals,
  parseProposal,
  parseVotes,
  parseTally,
  parseAnalysis,
  parsePrediction,
  parseStats,
  detectGovernanceError,
  formatGovernanceTime,
  PROPOSAL_STATUSES,
  PROPOSAL_TYPE_IDS,
  IMPACT_LEVEL_IDS,
  VOTE_VALUES,
  PREDICTION_OUTCOMES,
} from '../../src/utils/governance-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('PROPOSAL_STATUSES = draft/active/passed/rejected/expired', () => {
    expect(PROPOSAL_STATUSES).toEqual(['draft', 'active', 'passed', 'rejected', 'expired'])
  })
  it('PROPOSAL_TYPE_IDS = 4 entries', () => {
    expect(PROPOSAL_TYPE_IDS).toEqual([
      'parameter_change', 'feature_request', 'policy_update', 'budget_allocation',
    ])
  })
  it('IMPACT_LEVEL_IDS = low/medium/high/critical', () => {
    expect(IMPACT_LEVEL_IDS).toEqual(['low', 'medium', 'high', 'critical'])
  })
  it('VOTE_VALUES = yes/no/abstain', () => {
    expect(VOTE_VALUES).toEqual(['yes', 'no', 'abstain'])
  })
  it('PREDICTION_OUTCOMES = pass/reject', () => {
    expect(PREDICTION_OUTCOMES).toEqual(['pass', 'reject'])
  })
  it('all enums are frozen', () => {
    for (const e of [PROPOSAL_STATUSES, PROPOSAL_TYPE_IDS, IMPACT_LEVEL_IDS, VOTE_VALUES, PREDICTION_OUTCOMES]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── detectGovernanceError ──────────────────────────────────────────────────

describe('detectGovernanceError', () => {
  it('returns noDb=false on empty / clean output', () => {
    expect(detectGovernanceError('')).toEqual({ noDb: false, error: '' })
    expect(detectGovernanceError('[]')).toEqual({ noDb: false, error: '' })
  })

  it('detects "Database not available" error', () => {
    expect(detectGovernanceError('Database not available'))
      .toEqual({ noDb: true, error: 'Database not available' })
  })

  it('still detects error wrapped in CLI noise', () => {
    expect(detectGovernanceError(withNoise('Database not available')).noDb).toBe(true)
  })

  it('case-insensitive', () => {
    expect(detectGovernanceError('DATABASE NOT AVAILABLE').noDb).toBe(true)
  })
})

// ─── parseTypes ─────────────────────────────────────────────────────────────

describe('parseTypes', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseTypes('')).toEqual([])
    expect(parseTypes('{}')).toEqual([])
  })

  it('parses the 4-type catalogue', () => {
    const json = JSON.stringify([
      { id: 'parameter_change', name: 'Parameter Change', description: '参数变更' },
      { id: 'feature_request', name: 'Feature Request', description: '功能请求' },
      { id: 'policy_update', name: 'Policy Update', description: '策略更新' },
      { id: 'budget_allocation', name: 'Budget Allocation', description: '预算分配' },
    ])
    const list = parseTypes(json)
    expect(list).toHaveLength(4)
    expect(list[0].id).toBe('parameter_change')
    expect(list[0].name).toBe('Parameter Change')
    expect(list[0].description).toBe('参数变更')
  })

  it('drops entries without id', () => {
    expect(parseTypes(JSON.stringify([{ name: 'Orphan' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'feature_request', name: 'F', description: '功能请求' }])
    expect(parseTypes(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseStatuses ──────────────────────────────────────────────────────────

describe('parseStatuses', () => {
  it('returns empty for non-array output', () => {
    expect(parseStatuses('')).toEqual([])
    expect(parseStatuses('{}')).toEqual([])
  })

  it('parses the 5-status array', () => {
    const json = JSON.stringify(['draft', 'active', 'passed', 'rejected', 'expired'])
    expect(parseStatuses(json)).toEqual(['draft', 'active', 'passed', 'rejected', 'expired'])
  })

  it('filters non-string entries', () => {
    expect(parseStatuses(JSON.stringify(['draft', 1, null, 'active']))).toEqual(['draft', 'active'])
  })
})

// ─── parseImpactLevels ──────────────────────────────────────────────────────

describe('parseImpactLevels', () => {
  it('returns empty for non-array output', () => {
    expect(parseImpactLevels('')).toEqual([])
  })

  it('parses the 4-level catalogue', () => {
    const json = JSON.stringify([
      { id: 'low', name: 'Low', description: '低影响' },
      { id: 'medium', name: 'Medium', description: '中等影响' },
      { id: 'high', name: 'High', description: '高影响' },
      { id: 'critical', name: 'Critical', description: '关键影响' },
    ])
    const list = parseImpactLevels(json)
    expect(list).toHaveLength(4)
    expect(list.map(l => l.id)).toEqual(['low', 'medium', 'high', 'critical'])
  })

  it('drops entries without id', () => {
    expect(parseImpactLevels(JSON.stringify([{ name: 'Orphan' }]))).toEqual([])
  })
})

// ─── parseProposals ─────────────────────────────────────────────────────────

describe('parseProposals', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseProposals('')).toEqual([])
    expect(parseProposals('Database not available')).toEqual([])
    expect(parseProposals('{}')).toEqual([])
  })

  it('parses proposal rows', () => {
    const json = JSON.stringify([
      {
        id: 'p1', title: '增加深色模式', description: '...', type: 'feature_request',
        proposerDid: 'did:key:z6MkX', status: 'active',
        impactLevel: 'medium', impactAnalysis: null,
        voteYes: 5, voteNo: 1, voteAbstain: 0,
        votingStartsAt: 1700000000000, votingEndsAt: 1700604800000,
        metadata: null, createdAt: 1699999000000,
      },
    ])
    const [p] = parseProposals(json)
    expect(p.id).toBe('p1')
    expect(p.title).toBe('增加深色模式')
    expect(p.type).toBe('feature_request')
    expect(p.status).toBe('active')
    expect(p.voteYes).toBe(5)
    expect(p.voteNo).toBe(1)
    expect(p.voteAbstain).toBe(0)
    expect(p.impactLevel).toBe('medium')
  })

  it('lowercases status', () => {
    expect(parseProposals(JSON.stringify([{ id: 'p1', status: 'ACTIVE' }]))[0].status).toBe('active')
  })

  it('coerces missing vote counts to 0', () => {
    const [p] = parseProposals(JSON.stringify([{ id: 'p1', status: 'draft' }]))
    expect(p.voteYes).toBe(0)
    expect(p.voteNo).toBe(0)
    expect(p.voteAbstain).toBe(0)
  })

  it('drops entries without id', () => {
    expect(parseProposals(JSON.stringify([{ title: 'orphan' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'p1', title: 't', type: 'feature_request', status: 'draft' }])
    expect(parseProposals(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseProposal (single envelope) ────────────────────────────────────────

describe('parseProposal', () => {
  it('returns null for empty / array output', () => {
    expect(parseProposal('')).toBeNull()
    expect(parseProposal('[]')).toBeNull()
  })

  it('parses a single envelope', () => {
    const json = JSON.stringify({ id: 'p1', title: 'X', type: 'policy_update', status: 'active' })
    expect(parseProposal(json).type).toBe('policy_update')
  })

  it('returns null when envelope lacks id', () => {
    expect(parseProposal(JSON.stringify({ title: 'orphan' }))).toBeNull()
  })
})

// ─── parseVotes ─────────────────────────────────────────────────────────────

describe('parseVotes', () => {
  it('returns empty for empty output', () => {
    expect(parseVotes('')).toEqual([])
  })

  it('parses vote rows', () => {
    const json = JSON.stringify([
      { id: 'v1', proposalId: 'p1', voterDid: 'did:key:A', vote: 'yes', reason: '+1', weight: 1.0, createdAt: 1700000000000 },
      { id: 'v2', proposalId: 'p1', voterDid: 'did:key:B', vote: 'no', reason: 'risky', weight: 2.0, createdAt: 1700000001000 },
    ])
    const list = parseVotes(json)
    expect(list).toHaveLength(2)
    expect(list[0].vote).toBe('yes')
    expect(list[0].weight).toBe(1)
    expect(list[1].vote).toBe('no')
    expect(list[1].weight).toBe(2)
  })

  it('lowercases vote value', () => {
    const [v] = parseVotes(JSON.stringify([{ id: 'v1', vote: 'YES', weight: 1 }]))
    expect(v.vote).toBe('yes')
  })

  it('coerces missing weight to 1', () => {
    const [v] = parseVotes(JSON.stringify([{ id: 'v1', vote: 'abstain' }]))
    expect(v.weight).toBe(1)
  })

  it('drops entries without id', () => {
    expect(parseVotes(JSON.stringify([{ vote: 'yes' }]))).toEqual([])
  })
})

// ─── parseTally ─────────────────────────────────────────────────────────────

describe('parseTally', () => {
  it('returns null for empty / non-object output', () => {
    expect(parseTally('')).toBeNull()
    expect(parseTally('[]')).toBeNull()
  })

  it('parses a tally envelope', () => {
    const json = JSON.stringify({
      proposalId: 'p1', voteCount: 6,
      yesWeight: 5, noWeight: 1, abstainWeight: 0, totalWeight: 6,
      yesRatio: 0.8333, quorum: 0.5, quorumMet: true,
      threshold: 0.6, passed: true,
    })
    const t = parseTally(json)
    expect(t.proposalId).toBe('p1')
    expect(t.voteCount).toBe(6)
    expect(t.yesRatio).toBe(0.8333)
    expect(t.quorumMet).toBe(true)
    expect(t.passed).toBe(true)
  })

  it('coerces boolean flags', () => {
    const json = JSON.stringify({ proposalId: 'p1', quorumMet: 1, passed: 0 })
    const t = parseTally(json)
    expect(t.quorumMet).toBe(true)
    expect(t.passed).toBe(false)
  })
})

// ─── parseAnalysis ──────────────────────────────────────────────────────────

describe('parseAnalysis', () => {
  it('returns null for empty / non-object output', () => {
    expect(parseAnalysis('')).toBeNull()
    expect(parseAnalysis('[]')).toBeNull()
  })

  it('parses analysis envelope with components + recs', () => {
    const json = JSON.stringify({
      impactLevel: 'high',
      affectedComponents: ['security', 'database'],
      riskScore: 0.62,
      benefitScore: 0.78,
      estimatedEffort: 'large',
      communitySentiment: 'cautious',
      recommendations: ['Phased rollout', 'Security review required'],
      analyzedAt: 1700000000000,
    })
    const a = parseAnalysis(json)
    expect(a.impactLevel).toBe('high')
    expect(a.affectedComponents).toEqual(['security', 'database'])
    expect(a.riskScore).toBe(0.62)
    expect(a.recommendations).toHaveLength(2)
  })

  it('coerces missing arrays to []', () => {
    const a = parseAnalysis(JSON.stringify({ impactLevel: 'low' }))
    expect(a.affectedComponents).toEqual([])
    expect(a.recommendations).toEqual([])
  })

  it('filters non-string array entries', () => {
    const json = JSON.stringify({
      impactLevel: 'low',
      affectedComponents: ['ok', 1, null, 'also-ok'],
      recommendations: ['rec', 42],
    })
    const a = parseAnalysis(json)
    expect(a.affectedComponents).toEqual(['ok', 'also-ok'])
    expect(a.recommendations).toEqual(['rec'])
  })
})

// ─── parsePrediction ────────────────────────────────────────────────────────

describe('parsePrediction', () => {
  it('returns null for empty / non-object output', () => {
    expect(parsePrediction('')).toBeNull()
    expect(parsePrediction('[]')).toBeNull()
  })

  it('parses prediction envelope (votes-based)', () => {
    const json = JSON.stringify({
      proposalId: 'p1', predictedOutcome: 'pass',
      confidence: 0.65, yesProb: 0.7, noProb: 0.2, abstainProb: 0.1,
      basedOn: 'votes', sampleSize: 8,
    })
    const p = parsePrediction(json)
    expect(p.predictedOutcome).toBe('pass')
    expect(p.confidence).toBe(0.65)
    expect(p.basedOn).toBe('votes')
    expect(p.sampleSize).toBe(8)
  })

  it('parses heuristic prediction (zero votes)', () => {
    const json = JSON.stringify({
      proposalId: 'p1', predictedOutcome: 'reject',
      confidence: 0.3, yesProb: 0.4, noProb: 0.6, abstainProb: 0,
      basedOn: 'heuristic', sampleSize: 0,
    })
    const p = parsePrediction(json)
    expect(p.basedOn).toBe('heuristic')
    expect(p.sampleSize).toBe(0)
  })
})

// ─── parseStats ─────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStats('')
    expect(s.proposalCount).toBe(0)
    expect(s.voteCount).toBe(0)
    expect(s.byStatus.draft).toBe(0)
    expect(s.byStatus.active).toBe(0)
    expect(s.byStatus.passed).toBe(0)
    expect(s.byStatus.rejected).toBe(0)
    expect(s.byStatus.expired).toBe(0)
    expect(s.byType.parameter_change).toBe(0)
    expect(s.byType.feature_request).toBe(0)
    expect(s.byType.policy_update).toBe(0)
    expect(s.byType.budget_allocation).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      proposalCount: 7,
      voteCount: 22,
      byStatus: { draft: 1, active: 2, passed: 3, rejected: 1 },
      byType: { feature_request: 4, policy_update: 2, budget_allocation: 1 },
    })
    const s = parseStats(json)
    expect(s.proposalCount).toBe(7)
    expect(s.voteCount).toBe(22)
    expect(s.byStatus.passed).toBe(3)
    expect(s.byType.feature_request).toBe(4)
    // Pre-keyed defaults preserved for unmentioned keys
    expect(s.byStatus.expired).toBe(0)
    expect(s.byType.parameter_change).toBe(0)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ proposalCount: 3 })
    expect(parseStats(withNoise(json)).proposalCount).toBe(3)
  })

  it('drops non-numeric byStatus / byType entries', () => {
    const json = JSON.stringify({
      byStatus: { draft: 'oops', active: 2 },
      byType: { feature_request: 'x', policy_update: 1 },
    })
    const s = parseStats(json)
    expect(s.byStatus.draft).toBe(0) // pre-keyed default
    expect(s.byStatus.active).toBe(2)
    expect(s.byType.feature_request).toBe(0)
    expect(s.byType.policy_update).toBe(1)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseStats('[]').proposalCount).toBe(0)
  })
})

// ─── formatGovernanceTime ───────────────────────────────────────────────────

describe('formatGovernanceTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatGovernanceTime(null)).toBe('—')
    expect(formatGovernanceTime('')).toBe('—')
  })

  it('formats a numeric ms timestamp', () => {
    expect(formatGovernanceTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatGovernanceTime('not-a-date')).toBe('not-a-date')
  })
})
