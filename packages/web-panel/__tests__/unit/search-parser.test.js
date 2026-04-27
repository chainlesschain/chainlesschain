/**
 * Unit tests for src/utils/search-parser.js
 *
 * Run: npx vitest run __tests__/unit/search-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseSearchResults,
  parseNotes,
  parseNote,
  buildIndexSummary,
  detectSearchError,
  formatSearchTime,
  SEARCH_MODES,
} from '../../src/utils/search-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('SEARCH_MODES = bm25/vector/hybrid', () => {
    expect(SEARCH_MODES).toEqual(['bm25', 'vector', 'hybrid'])
    expect(Object.isFrozen(SEARCH_MODES)).toBe(true)
  })
})

// ─── detectSearchError ──────────────────────────────────────────────────────

describe('detectSearchError', () => {
  it('returns noDb=false on empty / clean output', () => {
    expect(detectSearchError('')).toEqual({ noDb: false, error: '' })
    expect(detectSearchError('[]')).toEqual({ noDb: false, error: '' })
  })

  it('detects "Database not available"', () => {
    expect(detectSearchError('Database not available'))
      .toEqual({ noDb: true, error: 'Database not available' })
  })

  it('still detects error wrapped in CLI noise', () => {
    expect(detectSearchError(withNoise('Database not available')).noDb).toBe(true)
  })

  it('case-insensitive', () => {
    expect(detectSearchError('DATABASE NOT AVAILABLE').noDb).toBe(true)
  })
})

// ─── parseSearchResults ─────────────────────────────────────────────────────

describe('parseSearchResults', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseSearchResults('')).toEqual([])
    expect(parseSearchResults('Database not available')).toEqual([])
    expect(parseSearchResults('{}')).toEqual([])
  })

  it('parses search result rows', () => {
    const json = JSON.stringify([
      {
        id: 'n1', score: 0.85, title: 'AI 入门',
        category: 'tech', created_at: '2024-03-15 10:30:00',
        snippet: '人工智能基础知识...',
      },
      {
        id: 'n2', score: 0.62, title: '机器学习',
        category: 'tech', created_at: '2024-03-14 09:00:00',
        snippet: 'ML 简介...',
      },
    ])
    const list = parseSearchResults(json)
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('n1')
    expect(list[0].score).toBe(0.85)
    expect(list[0].title).toBe('AI 入门')
    expect(list[0].category).toBe('tech')
    expect(list[0].snippet).toBe('人工智能基础知识...')
  })

  it('coerces missing score to 0', () => {
    const [r] = parseSearchResults(JSON.stringify([{ id: 'n1' }]))
    expect(r.score).toBe(0)
  })

  it('defaults missing category to "general"', () => {
    const [r] = parseSearchResults(JSON.stringify([{ id: 'n1', score: 0.5 }]))
    expect(r.category).toBe('general')
  })

  it('drops entries without id', () => {
    expect(parseSearchResults(JSON.stringify([{ score: 0.5 }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'n1', score: 0.5, title: 't' }])
    expect(parseSearchResults(withNoise(json))).toHaveLength(1)
  })

  it('also accepts pre-camelCased createdAt', () => {
    const json = JSON.stringify([{ id: 'n1', score: 0.5, createdAt: '2024-01-01' }])
    expect(parseSearchResults(json)[0].createdAt).toBe('2024-01-01')
  })
})

// ─── parseNotes ────────────────────────────────────────────────────────────

describe('parseNotes', () => {
  it('returns empty for non-array output', () => {
    expect(parseNotes('')).toEqual([])
    expect(parseNotes('{}')).toEqual([])
  })

  it('parses note rows + decodes JSON-string tags', () => {
    const json = JSON.stringify([
      {
        id: 'n1', title: 'AI 入门',
        tags: '["ai","ml","intro"]',
        category: 'tech',
        created_at: '2024-03-15 10:30:00',
      },
    ])
    const [n] = parseNotes(json)
    expect(n.id).toBe('n1')
    expect(n.title).toBe('AI 入门')
    expect(n.tags).toEqual(['ai', 'ml', 'intro'])
    expect(n.category).toBe('tech')
  })

  it('handles tags as already-parsed array', () => {
    const json = JSON.stringify([{ id: 'n1', tags: ['ai', 'vue'] }])
    expect(parseNotes(json)[0].tags).toEqual(['ai', 'vue'])
  })

  it('handles invalid JSON-string tags gracefully', () => {
    const json = JSON.stringify([{ id: 'n1', tags: 'not-json' }])
    expect(parseNotes(json)[0].tags).toEqual([])
  })

  it('handles missing tags as empty array', () => {
    const json = JSON.stringify([{ id: 'n1', title: 't' }])
    expect(parseNotes(json)[0].tags).toEqual([])
  })

  it('filters non-string tag entries', () => {
    const json = JSON.stringify([{ id: 'n1', tags: ['ai', 1, null, 'ml'] }])
    expect(parseNotes(json)[0].tags).toEqual(['ai', 'ml'])
  })

  it('drops entries without id', () => {
    expect(parseNotes(JSON.stringify([{ title: 't' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'n1', title: 't' }])
    expect(parseNotes(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseNote ─────────────────────────────────────────────────────────────

describe('parseNote', () => {
  it('returns null for empty / array output', () => {
    expect(parseNote('')).toBeNull()
    expect(parseNote('[]')).toBeNull()
  })

  it('parses single note envelope with content', () => {
    const json = JSON.stringify({
      id: 'n1', title: 'AI 入门', content: '正文内容...',
      tags: '["ai"]', category: 'tech',
      created_at: '2024-03-15 10:30:00', updated_at: '2024-03-15 10:30:00',
    })
    const n = parseNote(json)
    expect(n.id).toBe('n1')
    expect(n.title).toBe('AI 入门')
    expect(n.content).toBe('正文内容...')
    expect(n.tags).toEqual(['ai'])
    expect(n.category).toBe('tech')
  })

  it('returns null when id missing', () => {
    expect(parseNote(JSON.stringify({ title: 't' }))).toBeNull()
  })
})

// ─── buildIndexSummary ──────────────────────────────────────────────────────

describe('buildIndexSummary', () => {
  it('returns empty shape for empty / non-array input', () => {
    expect(buildIndexSummary([])).toEqual({ total: 0, categories: [], tags: [] })
    expect(buildIndexSummary(null)).toEqual({ total: 0, categories: [], tags: [] })
  })

  it('counts categories + tags correctly', () => {
    const notes = [
      { id: 'n1', tags: ['ai', 'ml'], category: 'tech' },
      { id: 'n2', tags: ['ai', 'vue'], category: 'tech' },
      { id: 'n3', tags: ['life'], category: 'personal' },
    ]
    const s = buildIndexSummary(notes)
    expect(s.total).toBe(3)
    expect(s.categories).toEqual([
      { name: 'tech', count: 2 },
      { name: 'personal', count: 1 },
    ])
    expect(s.tags).toEqual([
      { name: 'ai', count: 2 },
      { name: 'ml', count: 1 },
      { name: 'vue', count: 1 },
      { name: 'life', count: 1 },
    ])
  })

  it('sorts categories + tags by count desc', () => {
    const notes = [
      { id: 'n1', tags: [], category: 'a' },
      { id: 'n2', tags: [], category: 'b' },
      { id: 'n3', tags: [], category: 'b' },
      { id: 'n4', tags: [], category: 'b' },
    ]
    expect(buildIndexSummary(notes).categories[0]).toEqual({ name: 'b', count: 3 })
  })
})

// ─── formatSearchTime ──────────────────────────────────────────────────────

describe('formatSearchTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatSearchTime(null)).toBe('—')
    expect(formatSearchTime('')).toBe('—')
  })

  it('formats sqlite "YYYY-MM-DD HH:MM:SS" by injecting T+Z', () => {
    expect(formatSearchTime('2024-03-15 10:30:00').length).toBeGreaterThan(8)
  })

  it('formats ISO strings', () => {
    expect(formatSearchTime('2024-03-15T10:30:00Z').length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatSearchTime('not-a-date')).toBe('not-a-date')
  })
})
