/**
 * Unit tests for src/utils/recommend-parser.js
 *
 * Run: npx vitest run __tests__/unit/recommend-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseContentTypes,
  parseStringList,
  parseProfiles,
  parseProfile,
  parseRecommendations,
  parseRecommendation,
  parseUserStats,
  parseTopInterests,
  parseSuggestions,
  parseStatsV2,
  parseActionResult,
  formatRecommendTime,
  CONTENT_TYPE_IDS,
  RECOMMENDATION_STATUSES,
  FEEDBACK_VALUES,
  PROFILE_MATURITIES_V2,
  FEED_LIFECYCLES_V2,
} from '../../src/utils/recommend-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('CONTENT_TYPE_IDS = note/post/article/document', () => {
    expect(CONTENT_TYPE_IDS).toEqual(['note', 'post', 'article', 'document'])
  })
  it('RECOMMENDATION_STATUSES = pending/viewed/dismissed', () => {
    expect(RECOMMENDATION_STATUSES).toEqual(['pending', 'viewed', 'dismissed'])
  })
  it('FEEDBACK_VALUES = like/dislike/later', () => {
    expect(FEEDBACK_VALUES).toEqual(['like', 'dislike', 'later'])
  })
  it('PROFILE_MATURITIES_V2 = 4 entries', () => {
    expect(PROFILE_MATURITIES_V2).toEqual(['onboarding', 'active', 'dormant', 'retired'])
  })
  it('FEED_LIFECYCLES_V2 = 4 entries', () => {
    expect(FEED_LIFECYCLES_V2).toEqual(['draft', 'active', 'paused', 'archived'])
  })
  it('all enums frozen', () => {
    for (const e of [CONTENT_TYPE_IDS, RECOMMENDATION_STATUSES, FEEDBACK_VALUES, PROFILE_MATURITIES_V2, FEED_LIFECYCLES_V2]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── parseContentTypes ─────────────────────────────────────────────────────

describe('parseContentTypes', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseContentTypes('')).toEqual([])
    expect(parseContentTypes('{}')).toEqual([])
  })

  it('parses the 4-type catalogue', () => {
    const json = JSON.stringify([
      { id: 'note', name: 'Note', description: '笔记' },
      { id: 'post', name: 'Post', description: '帖子' },
      { id: 'article', name: 'Article', description: '文章' },
      { id: 'document', name: 'Document', description: '文档' },
    ])
    const list = parseContentTypes(json)
    expect(list).toHaveLength(4)
    expect(list[0].id).toBe('note')
    expect(list[0].name).toBe('Note')
    expect(list[0].description).toBe('笔记')
  })

  it('drops entries without id', () => {
    expect(parseContentTypes(JSON.stringify([{ name: 'Orphan' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'note', name: 'Note', description: '笔记' }])
    expect(parseContentTypes(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseStringList ───────────────────────────────────────────────────────

describe('parseStringList', () => {
  it('parses statuses array', () => {
    expect(parseStringList(JSON.stringify(['pending', 'viewed', 'dismissed'])))
      .toEqual(['pending', 'viewed', 'dismissed'])
  })

  it('filters non-string entries', () => {
    expect(parseStringList(JSON.stringify(['pending', 1, null, 'viewed'])))
      .toEqual(['pending', 'viewed'])
  })

  it('returns empty for non-array', () => {
    expect(parseStringList('')).toEqual([])
    expect(parseStringList('{}')).toEqual([])
  })
})

// ─── parseProfiles ─────────────────────────────────────────────────────────

describe('parseProfiles', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseProfiles('')).toEqual([])
    expect(parseProfiles('{}')).toEqual([])
  })

  it('parses profile rows from snake_case', () => {
    const json = JSON.stringify([
      {
        id: 'p1', user_id: 'alice',
        topics: { ai: 0.8, vue: 0.5 },
        interaction_weights: { like: 1.0, view: 0.3 },
        decay_factor: 0.9, last_updated: 1700000000000, update_count: 5,
      },
    ])
    const [p] = parseProfiles(json)
    expect(p.id).toBe('p1')
    expect(p.userId).toBe('alice')
    expect(p.topics.ai).toBe(0.8)
    expect(p.topicCount).toBe(2)
    expect(p.interactionWeights.like).toBe(1.0)
    expect(p.decayFactor).toBe(0.9)
    expect(p.updateCount).toBe(5)
  })

  it('filters non-numeric topic weights', () => {
    const json = JSON.stringify([
      { user_id: 'alice', topics: { ai: 0.8, bad: 'oops', vue: 0.5 } },
    ])
    const [p] = parseProfiles(json)
    expect(p.topics).toEqual({ ai: 0.8, vue: 0.5 })
    expect(p.topicCount).toBe(2)
  })

  it('coerces missing topic dict to empty object', () => {
    const [p] = parseProfiles(JSON.stringify([{ user_id: 'alice' }]))
    expect(p.topics).toEqual({})
    expect(p.topicCount).toBe(0)
    expect(p.interactionWeights).toEqual({})
  })

  it('drops entries without user_id', () => {
    expect(parseProfiles(JSON.stringify([{ id: 'p1', topics: {} }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ user_id: 'alice', topics: { ai: 0.5 } }])
    expect(parseProfiles(withNoise(json))).toHaveLength(1)
  })

  it('also accepts pre-camelCased input (idempotent)', () => {
    const json = JSON.stringify([{
      userId: 'alice', topics: { ai: 0.8 },
      interactionWeights: { like: 1.0 },
      decayFactor: 0.85, lastUpdated: 1700000000000, updateCount: 2,
    }])
    const [p] = parseProfiles(json)
    expect(p.userId).toBe('alice')
    expect(p.decayFactor).toBe(0.85)
    expect(p.updateCount).toBe(2)
  })
})

// ─── parseProfile ──────────────────────────────────────────────────────────

describe('parseProfile', () => {
  it('returns null for empty / array output', () => {
    expect(parseProfile('')).toBeNull()
    expect(parseProfile('[]')).toBeNull()
  })

  it('parses single profile envelope', () => {
    const json = JSON.stringify({
      id: 'p1', user_id: 'alice', topics: { ai: 0.8 },
      decay_factor: 0.9, last_updated: 1700000000000, update_count: 0,
    })
    expect(parseProfile(json).userId).toBe('alice')
  })

  it('returns null when user_id missing', () => {
    expect(parseProfile(JSON.stringify({ id: 'p1' }))).toBeNull()
  })
})

// ─── parseRecommendations ──────────────────────────────────────────────────

describe('parseRecommendations', () => {
  it('returns empty for empty output', () => {
    expect(parseRecommendations('')).toEqual([])
  })

  it('parses recommendation rows from snake_case', () => {
    const json = JSON.stringify([
      {
        id: 'r1', user_id: 'alice',
        content_id: 'c1', content_type: 'note',
        title: 'AI 入门', score: 0.85,
        reason: 'Matches interests: ai, ml',
        source: 'heuristic', status: 'pending',
        feedback: null, created_at: 1700000000000, viewed_at: null,
      },
    ])
    const [r] = parseRecommendations(json)
    expect(r.id).toBe('r1')
    expect(r.userId).toBe('alice')
    expect(r.contentId).toBe('c1')
    expect(r.contentType).toBe('note')
    expect(r.title).toBe('AI 入门')
    expect(r.score).toBe(0.85)
    expect(r.status).toBe('pending')
    expect(r.feedback).toBeNull()
    expect(r.viewedAt).toBeNull()
  })

  it('lowercases status + contentType', () => {
    const json = JSON.stringify([{ id: 'r1', status: 'VIEWED', content_type: 'POST' }])
    const [r] = parseRecommendations(json)
    expect(r.status).toBe('viewed')
    expect(r.contentType).toBe('post')
  })

  it('drops entries without id', () => {
    expect(parseRecommendations(JSON.stringify([{ user_id: 'alice', score: 0.5 }]))).toEqual([])
  })

  it('preserves feedback values', () => {
    const json = JSON.stringify([
      { id: 'r1', feedback: 'like', status: 'viewed' },
      { id: 'r2', feedback: 'dislike', status: 'dismissed' },
      { id: 'r3', feedback: 'later', status: 'viewed' },
    ])
    const list = parseRecommendations(json)
    expect(list.map(r => r.feedback)).toEqual(['like', 'dislike', 'later'])
  })
})

// ─── parseRecommendation ───────────────────────────────────────────────────

describe('parseRecommendation', () => {
  it('returns null for empty / array output', () => {
    expect(parseRecommendation('')).toBeNull()
    expect(parseRecommendation('[]')).toBeNull()
  })

  it('parses single envelope', () => {
    const json = JSON.stringify({ id: 'r1', user_id: 'alice', score: 0.7 })
    expect(parseRecommendation(json).score).toBe(0.7)
  })
})

// ─── parseUserStats ────────────────────────────────────────────────────────

describe('parseUserStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseUserStats('')
    expect(s.total).toBe(0)
    expect(s.pending).toBe(0)
    expect(s.viewed).toBe(0)
    expect(s.dismissed).toBe(0)
    expect(s.feedbackCount).toBe(0)
    expect(s.feedbackRate).toBe(0)
    expect(s.avgScore).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      total: 20, pending: 5, viewed: 12, dismissed: 3,
      feedbackCount: 8, feedbackRate: 0.4, avgScore: 0.682,
    })
    const s = parseUserStats(json)
    expect(s.total).toBe(20)
    expect(s.feedbackRate).toBe(0.4)
    expect(s.avgScore).toBe(0.682)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ total: 10 })
    expect(parseUserStats(withNoise(json)).total).toBe(10)
  })
})

// ─── parseTopInterests ─────────────────────────────────────────────────────

describe('parseTopInterests', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseTopInterests('')).toEqual([])
  })

  it('parses interest rows', () => {
    const json = JSON.stringify([
      { topic: 'ai', weight: 0.8 },
      { topic: 'vue', weight: 0.5 },
    ])
    const list = parseTopInterests(json)
    expect(list).toHaveLength(2)
    expect(list[0].topic).toBe('ai')
    expect(list[0].weight).toBe(0.8)
  })

  it('drops entries without topic string', () => {
    const json = JSON.stringify([{ weight: 0.5 }, { topic: 'ai', weight: 0.8 }])
    expect(parseTopInterests(json)).toHaveLength(1)
  })
})

// ─── parseSuggestions ──────────────────────────────────────────────────────

describe('parseSuggestions', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseSuggestions('')).toEqual([])
  })

  it('parses suggestion rows (boost / reduce)', () => {
    const json = JSON.stringify([
      { topic: 'ai', action: 'boost', amount: 0.2 },
      { topic: 'spam', action: 'reduce', amount: 0.1 },
    ])
    const list = parseSuggestions(json)
    expect(list).toHaveLength(2)
    expect(list[0].action).toBe('boost')
    expect(list[1].action).toBe('reduce')
  })

  it('drops entries missing topic or action', () => {
    const json = JSON.stringify([
      { topic: 'ai' },
      { action: 'boost', amount: 0.1 },
      { topic: 'vue', action: 'boost', amount: 0.1 },
    ])
    expect(parseSuggestions(json)).toHaveLength(1)
  })
})

// ─── parseStatsV2 ──────────────────────────────────────────────────────────

describe('parseStatsV2', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStatsV2('')
    expect(s.totalProfilesV2).toBe(0)
    expect(s.totalFeedsV2).toBe(0)
    for (const k of PROFILE_MATURITIES_V2) expect(s.profilesByStatus[k]).toBe(0)
    for (const k of FEED_LIFECYCLES_V2) expect(s.feedsByStatus[k]).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      totalProfilesV2: 5, totalFeedsV2: 3,
      maxActiveProfilesPerSegment: 100, maxActiveFeedsPerCurator: 20,
      profileIdleMs: 86400000, feedStaleMs: 604800000,
      profilesByStatus: { onboarding: 1, active: 3, dormant: 1 },
      feedsByStatus: { draft: 1, active: 2 },
    })
    const s = parseStatsV2(json)
    expect(s.totalProfilesV2).toBe(5)
    expect(s.profilesByStatus.active).toBe(3)
    expect(s.feedsByStatus.active).toBe(2)
    // Pre-keyed defaults preserved
    expect(s.profilesByStatus.retired).toBe(0)
    expect(s.feedsByStatus.archived).toBe(0)
  })

  it('drops non-numeric byStatus entries', () => {
    const json = JSON.stringify({
      profilesByStatus: { onboarding: 'oops', active: 2 },
    })
    const s = parseStatsV2(json)
    expect(s.profilesByStatus.onboarding).toBe(0)
    expect(s.profilesByStatus.active).toBe(2)
  })
})

// ─── parseActionResult ─────────────────────────────────────────────────────

describe('parseActionResult', () => {
  it('returns ok=false for empty / non-object output', () => {
    expect(parseActionResult('')).toEqual({ ok: false, reason: '', profileId: null, topicCount: null })
  })

  it('detects updated:true', () => {
    expect(parseActionResult(JSON.stringify({ updated: true })).ok).toBe(true)
  })

  it('detects deleted:true', () => {
    expect(parseActionResult(JSON.stringify({ deleted: true })).ok).toBe(true)
  })

  it('detects marked / dismissed / recorded / applied', () => {
    expect(parseActionResult(JSON.stringify({ marked: true })).ok).toBe(true)
    expect(parseActionResult(JSON.stringify({ dismissed: true })).ok).toBe(true)
    expect(parseActionResult(JSON.stringify({ recorded: true })).ok).toBe(true)
    expect(parseActionResult(JSON.stringify({ applied: true })).ok).toBe(true)
  })

  it('detects profileId for create-profile result', () => {
    const r = parseActionResult(JSON.stringify({ profileId: 'p-uuid' }))
    expect(r.ok).toBe(true)
    expect(r.profileId).toBe('p-uuid')
  })

  it('preserves reason for failure cases', () => {
    const r = parseActionResult(JSON.stringify({ updated: false, reason: 'not_found' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not_found')
  })

  it('captures topicCount from decay result', () => {
    const r = parseActionResult(JSON.stringify({ applied: true, topicCount: 7 }))
    expect(r.topicCount).toBe(7)
  })
})

// ─── formatRecommendTime ───────────────────────────────────────────────────

describe('formatRecommendTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatRecommendTime(null)).toBe('—')
    expect(formatRecommendTime('')).toBe('—')
  })

  it('formats numeric ms timestamp', () => {
    expect(formatRecommendTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatRecommendTime('not-a-date')).toBe('not-a-date')
  })
})
