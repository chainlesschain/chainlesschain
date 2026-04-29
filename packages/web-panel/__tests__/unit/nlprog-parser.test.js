/**
 * Unit tests for src/utils/nlprog-parser.js
 *
 * Run: npx vitest run __tests__/unit/nlprog-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseClassifyResult,
  parseExtractResult,
  parseStackResult,
  parseTranslations,
  parseTranslateResult,
  detectTranslateError,
  parseConventions,
  parseStats,
  formatNlprogTime,
  INTENTS,
  TRANSLATION_STATUSES,
  STYLE_CATEGORIES,
} from '../../src/utils/nlprog-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('INTENTS contains the 9 supported intents in CLI order', () => {
    expect(INTENTS).toEqual([
      'create_component', 'add_feature', 'fix_bug', 'refactor', 'add_api',
      'add_test', 'update_style', 'configure', 'general',
    ])
  })
  it('TRANSLATION_STATUSES = draft/complete/refined', () => {
    expect(TRANSLATION_STATUSES).toEqual(['draft', 'complete', 'refined'])
  })
  it('STYLE_CATEGORIES = naming/architecture/testing/style/imports/components', () => {
    expect(STYLE_CATEGORIES).toEqual(['naming', 'architecture', 'testing', 'style', 'imports', 'components'])
  })
  it('all enums frozen', () => {
    for (const e of [INTENTS, TRANSLATION_STATUSES, STYLE_CATEGORIES]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── parseClassifyResult ────────────────────────────────────────────────────

describe('parseClassifyResult', () => {
  it('returns null for empty / array output', () => {
    expect(parseClassifyResult('')).toBeNull()
    expect(parseClassifyResult('[]')).toBeNull()
  })

  it('parses an intent envelope', () => {
    const r = parseClassifyResult(JSON.stringify({ intent: 'fix_bug', confidence: 0.6 }))
    expect(r.intent).toBe('fix_bug')
    expect(r.confidence).toBe(0.6)
  })

  it('defaults intent to general when missing', () => {
    expect(parseClassifyResult(JSON.stringify({ confidence: 0.3 })).intent).toBe('general')
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ intent: 'create_component', confidence: 0.85 })
    expect(parseClassifyResult(withNoise(json)).intent).toBe('create_component')
  })
})

// ─── parseExtractResult ─────────────────────────────────────────────────────

describe('parseExtractResult', () => {
  it('returns null for empty output', () => {
    expect(parseExtractResult('')).toBeNull()
  })

  it('parses an entities envelope', () => {
    const json = JSON.stringify({
      entities: [{ type: 'technical', value: 'LoginButton' }, { type: 'action', value: 'create' }],
      count: 2,
    })
    const r = parseExtractResult(json)
    expect(r.entities).toHaveLength(2)
    expect(r.entities[0].type).toBe('technical')
    expect(r.entities[1].value).toBe('create')
    expect(r.count).toBe(2)
  })

  it('treats non-array entities as empty array', () => {
    expect(parseExtractResult(JSON.stringify({ entities: 'oops' })).entities).toEqual([])
  })

  it('drops non-object entity items', () => {
    const json = JSON.stringify({ entities: [{ type: 't', value: 'v' }, null, 'oops'] })
    expect(parseExtractResult(json).entities).toHaveLength(1)
  })

  it('falls back count to entity-array length', () => {
    const json = JSON.stringify({ entities: [{ type: 'a', value: 'b' }] })
    expect(parseExtractResult(json).count).toBe(1)
  })
})

// ─── parseStackResult ───────────────────────────────────────────────────────

describe('parseStackResult', () => {
  it('returns null for empty output', () => {
    expect(parseStackResult('')).toBeNull()
  })

  it('parses a tech-stack envelope', () => {
    const json = JSON.stringify({ detected: ['vue', 'pinia', 'vite'], primary: 'vue' })
    const r = parseStackResult(json)
    expect(r.detected).toEqual(['vue', 'pinia', 'vite'])
    expect(r.primary).toBe('vue')
  })

  it('falls back primary to first detected when missing', () => {
    expect(parseStackResult(JSON.stringify({ detected: ['react'] })).primary).toBe('react')
  })

  it('returns primary=null on empty detection', () => {
    const r = parseStackResult(JSON.stringify({ detected: [], primary: null }))
    expect(r.detected).toEqual([])
    expect(r.primary).toBeNull()
  })

  it('filters non-string detected items', () => {
    expect(parseStackResult(JSON.stringify({ detected: ['vue', 1, null, 'react'] })).detected).toEqual(['vue', 'react'])
  })
})

// ─── parseTranslations ──────────────────────────────────────────────────────

describe('parseTranslations', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseTranslations('')).toEqual([])
    expect(parseTranslations('{}')).toEqual([])
  })

  it('parses snake_case rows + JSON-decodes TEXT cols', () => {
    const json = JSON.stringify([
      {
        id: 't1',
        input_text: 'create a button',
        intent: 'create_component',
        entities: '[{"type":"technical","value":"button"}]',
        tech_stack: '["react"]',
        spec: '{"name":"Button"}',
        completeness_score: 0.85,
        ambiguities: '[]',
        status: 'complete',
        created_at: 1700000000000,
        updated_at: 1700000001000,
      },
    ])
    const [t] = parseTranslations(json)
    expect(t.id).toBe('t1')
    expect(t.inputText).toBe('create a button')
    expect(t.intent).toBe('create_component')
    expect(Array.isArray(t.entities)).toBe(true)
    expect(t.entities[0].value).toBe('button')
    expect(t.techStack).toEqual(['react'])
    expect(t.spec).toEqual({ name: 'Button' })
    expect(t.completenessScore).toBe(0.85)
    expect(t.ambiguities).toEqual([])
  })

  it('keeps already-parsed object/array fields unchanged', () => {
    const json = JSON.stringify([
      { id: 't1', entities: [{ type: 'a', value: 'b' }], spec: { x: 1 } },
    ])
    const [t] = parseTranslations(json)
    expect(t.entities[0].value).toBe('b')
    expect(t.spec.x).toBe(1)
  })

  it('keeps malformed JSON-string field as raw string', () => {
    const json = JSON.stringify([{ id: 't1', entities: 'not-json{' }])
    expect(parseTranslations(json)[0].entities).toBe('not-json{')
  })

  it('lowercases status', () => {
    expect(parseTranslations(JSON.stringify([{ id: 't1', status: 'REFINED' }]))[0].status).toBe('refined')
  })

  it('drops entries without id', () => {
    expect(parseTranslations(JSON.stringify([{ input_text: 'orphan' }]))).toEqual([])
  })
})

// ─── parseTranslateResult ───────────────────────────────────────────────────

describe('parseTranslateResult', () => {
  it('returns null for empty output', () => {
    expect(parseTranslateResult('')).toBeNull()
  })

  it('parses a successful translate envelope', () => {
    const json = JSON.stringify({
      translated: true, translationId: 't1', intent: 'create_component', completeness: 0.7,
    })
    const r = parseTranslateResult(json)
    expect(r.translated).toBe(true)
    expect(r.translationId).toBe('t1')
    expect(r.intent).toBe('create_component')
    expect(r.completeness).toBe(0.7)
  })

  it('returns null when translationId is missing', () => {
    expect(parseTranslateResult(JSON.stringify({ translated: false }))).toBeNull()
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ translated: true, translationId: 't1', intent: 'general', completeness: 0.5 })
    expect(parseTranslateResult(withNoise(json)).translationId).toBe('t1')
  })
})

// ─── detectTranslateError ───────────────────────────────────────────────────

describe('detectTranslateError', () => {
  it('returns noDb=false on empty / clean output', () => {
    expect(detectTranslateError('')).toEqual({ noDb: false, error: '' })
  })

  it("detects the 'undefined.prepare' TypeError pattern", () => {
    const out = "TypeError: Cannot read properties of undefined (reading 'prepare')\n  at translate ..."
    const r = detectTranslateError(out)
    expect(r.noDb).toBe(true)
    expect(r.error).toContain('Cannot read properties of undefined')
  })

  it('handles the double-quoted variant', () => {
    const out = 'TypeError: Cannot read properties of undefined (reading "prepare")'
    expect(detectTranslateError(out).noDb).toBe(true)
  })

  it('falls back to noDb=false on unrelated TypeError', () => {
    const out = 'TypeError: foo is not a function'
    const r = detectTranslateError(out)
    expect(r.noDb).toBe(false)
    expect(r.error).toContain('foo is not a function')
  })

  it('detects the modern friendly "No ChainlessChain project database" error', () => {
    const out = 'Error: No ChainlessChain project database in this directory. Run `cc init` first, or run from a project root.\n    at _requireDb (...)'
    const r = detectTranslateError(out)
    expect(r.noDb).toBe(true)
    expect(r.error).toContain('No ChainlessChain project database')
  })
})

// ─── parseConventions ───────────────────────────────────────────────────────

describe('parseConventions', () => {
  it('returns empty for empty output', () => {
    expect(parseConventions('')).toEqual([])
  })

  it('parses convention rows + JSON-decodes examples / source_files', () => {
    const json = JSON.stringify([
      {
        id: 'c1',
        category: 'naming',
        pattern: 'kebab-case for files',
        examples: '["my-file.js"]',
        confidence: 0.9,
        source_files: '["src/foo.js","src/bar.js"]',
        created_at: 1700000000000,
      },
    ])
    const [c] = parseConventions(json)
    expect(c.category).toBe('naming')
    expect(c.pattern).toBe('kebab-case for files')
    expect(c.examples).toEqual(['my-file.js'])
    expect(c.confidence).toBe(0.9)
    expect(c.sourceFiles).toEqual(['src/foo.js', 'src/bar.js'])
  })

  it('drops entries without id', () => {
    expect(parseConventions(JSON.stringify([{ category: 'naming' }]))).toEqual([])
  })
})

// ─── parseStats ─────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStats('')
    expect(s.translations.total).toBe(0)
    expect(s.translations.byIntent.create_component).toBe(0)
    expect(s.translations.byIntent.general).toBe(0)
    expect(s.translations.byStatus.draft).toBe(0)
    expect(s.conventions.total).toBe(0)
    expect(s.conventions.byCategory.naming).toBe(0)
  })

  it('parses a populated stats payload', () => {
    const json = JSON.stringify({
      translations: {
        total: 12,
        byIntent: { create_component: 4, fix_bug: 3, general: 5 },
        byStatus: { draft: 7, complete: 4, refined: 1 },
        avgCompleteness: 0.72,
      },
      conventions: {
        total: 3,
        byCategory: { naming: 2, testing: 1 },
      },
    })
    const s = parseStats(json)
    expect(s.translations.total).toBe(12)
    expect(s.translations.byIntent.create_component).toBe(4)
    expect(s.translations.byStatus.draft).toBe(7)
    expect(s.translations.avgCompleteness).toBe(0.72)
    expect(s.conventions.byCategory.naming).toBe(2)
    expect(s.conventions.byCategory.architecture).toBe(0) // pre-keyed default
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ translations: { total: 1, byIntent: {}, byStatus: {}, avgCompleteness: 0 }, conventions: { total: 0, byCategory: {} } })
    expect(parseStats(withNoise(json)).translations.total).toBe(1)
  })

  it('drops non-numeric byIntent / byCategory entries', () => {
    const json = JSON.stringify({
      translations: { total: 1, byIntent: { create_component: 'oops', fix_bug: 2 }, byStatus: {}, avgCompleteness: 0 },
      conventions: { total: 0, byCategory: { naming: 'oops' } },
    })
    const s = parseStats(json)
    // 'oops' kept default 0; valid number passes through
    expect(s.translations.byIntent.create_component).toBe(0)
    expect(s.translations.byIntent.fix_bug).toBe(2)
    expect(s.conventions.byCategory.naming).toBe(0)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseStats('[]').translations.total).toBe(0)
  })
})

// ─── formatNlprogTime ───────────────────────────────────────────────────────

describe('formatNlprogTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatNlprogTime(null)).toBe('—')
    expect(formatNlprogTime('')).toBe('—')
  })

  it('formats a numeric ms timestamp', () => {
    expect(formatNlprogTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatNlprogTime('not-a-date')).toBe('not-a-date')
  })
})
