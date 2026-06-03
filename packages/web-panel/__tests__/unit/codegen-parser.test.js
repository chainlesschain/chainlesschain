/**
 * Unit tests for src/utils/codegen-parser.js
 *
 * Run: npx vitest run __tests__/unit/codegen-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseStringList,
  parseGenerations,
  parseGeneration,
  parseReviews,
  parseReview,
  parseReviewResult,
  parseScaffolds,
  parseScaffold,
  parseStats,
  parseActionResult,
  formatCodegenTime,
  SCAFFOLD_TEMPLATES,
  REVIEW_SEVERITIES,
  SECURITY_RULES,
  CICD_PLATFORMS,
} from '../../src/utils/codegen-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('SCAFFOLD_TEMPLATES = 5 entries', () => {
    expect(SCAFFOLD_TEMPLATES).toEqual([
      'react', 'vue', 'express', 'fastapi', 'spring_boot',
    ])
  })
  it('REVIEW_SEVERITIES = critical/high/medium/low/info', () => {
    expect(REVIEW_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low', 'info'])
  })
  it('SECURITY_RULES = 5 entries', () => {
    expect(SECURITY_RULES).toEqual([
      'eval_detection', 'sql_injection', 'xss', 'path_traversal', 'command_injection',
    ])
  })
  it('CICD_PLATFORMS = 3 entries', () => {
    expect(CICD_PLATFORMS).toEqual(['github_actions', 'gitlab_ci', 'jenkins'])
  })
  it('all enums frozen', () => {
    for (const e of [SCAFFOLD_TEMPLATES, REVIEW_SEVERITIES, SECURITY_RULES, CICD_PLATFORMS]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── parseStringList ───────────────────────────────────────────────────────

describe('parseStringList', () => {
  it('returns empty for non-array', () => {
    expect(parseStringList('')).toEqual([])
    expect(parseStringList('{}')).toEqual([])
  })

  it('parses templates array', () => {
    expect(parseStringList(JSON.stringify(['react', 'vue', 'express'])))
      .toEqual(['react', 'vue', 'express'])
  })

  it('filters non-string entries', () => {
    expect(parseStringList(JSON.stringify(['react', 1, null, 'vue']))).toEqual(['react', 'vue'])
  })
})

// ─── parseGenerations ──────────────────────────────────────────────────────

describe('parseGenerations', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseGenerations('')).toEqual([])
    expect(parseGenerations('{}')).toEqual([])
  })

  it('parses generation rows from snake_case', () => {
    const json = JSON.stringify([
      {
        id: 'g1', prompt: 'create a button',
        language: 'typescript', framework: 'vue',
        generated_code: '<template>...</template>',
        file_count: 3, token_count: 1500,
        metadata: '{"hint":"primary"}',
        created_at: 1700000000000,
      },
    ])
    const [g] = parseGenerations(json)
    expect(g.id).toBe('g1')
    expect(g.prompt).toBe('create a button')
    expect(g.language).toBe('typescript')
    expect(g.framework).toBe('vue')
    expect(g.fileCount).toBe(3)
    expect(g.tokenCount).toBe(1500)
    expect(g.generatedCode).toContain('<template>')
  })

  it('coerces missing fileCount/tokenCount to 0', () => {
    const [g] = parseGenerations(JSON.stringify([{ id: 'g1', prompt: 'x' }]))
    expect(g.fileCount).toBe(0)
    expect(g.tokenCount).toBe(0)
  })

  it('drops entries without id', () => {
    expect(parseGenerations(JSON.stringify([{ prompt: 'x' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'g1', prompt: 'x', file_count: 1 }])
    expect(parseGenerations(withNoise(json))).toHaveLength(1)
  })

  it('also accepts pre-camelCased input (idempotent)', () => {
    const json = JSON.stringify([{
      id: 'g1', prompt: 'x', language: 'js', framework: 'react',
      fileCount: 5, tokenCount: 200, createdAt: 1700000000000,
    }])
    const [g] = parseGenerations(json)
    expect(g.fileCount).toBe(5)
    expect(g.tokenCount).toBe(200)
    expect(g.createdAt).toBe(1700000000000)
  })
})

// ─── parseGeneration ───────────────────────────────────────────────────────

describe('parseGeneration', () => {
  it('returns null for empty / array output', () => {
    expect(parseGeneration('')).toBeNull()
    expect(parseGeneration('[]')).toBeNull()
  })

  it('parses single envelope', () => {
    const json = JSON.stringify({ id: 'g1', prompt: 'x', file_count: 2 })
    expect(parseGeneration(json).fileCount).toBe(2)
  })

  it('returns null when id missing', () => {
    expect(parseGeneration(JSON.stringify({ prompt: 'x' }))).toBeNull()
  })
})

// ─── parseReviews ──────────────────────────────────────────────────────────

describe('parseReviews', () => {
  it('returns empty for empty output', () => {
    expect(parseReviews('')).toEqual([])
  })

  it('parses review rows from snake_case + decodes JSON-string severity_summary', () => {
    const json = JSON.stringify([
      {
        id: 'r1', generation_id: 'g1',
        code_hash: 'abc123def456',
        language: 'javascript',
        issues_found: 3, security_issues: 2,
        severity_summary: JSON.stringify({ critical: 1, high: 1, medium: 1, low: 0, info: 0 }),
        issues_detail: JSON.stringify([
          { rule: 'sql_injection', severity: 'critical', match: 'execute("SELECT *', pattern: 'execute' },
        ]),
        reviewed_at: 1700000000000,
      },
    ])
    const [r] = parseReviews(json)
    expect(r.id).toBe('r1')
    expect(r.generationId).toBe('g1')
    expect(r.codeHash).toBe('abc123def456')
    expect(r.issuesFound).toBe(3)
    expect(r.securityIssues).toBe(2)
    expect(r.severitySummary.critical).toBe(1)
    expect(r.severitySummary.high).toBe(1)
    expect(r.issuesDetail).toHaveLength(1)
    expect(r.issuesDetail[0].rule).toBe('sql_injection')
    expect(r.issuesDetail[0].severity).toBe('critical')
  })

  it('handles severity_summary as already-parsed object', () => {
    const json = JSON.stringify([{
      id: 'r1', issues_found: 1,
      severity_summary: { critical: 1 },
      issues_detail: [{ rule: 'eval_detection', severity: 'high', match: 'eval(', pattern: '\\beval' }],
    }])
    const [r] = parseReviews(json)
    expect(r.severitySummary.critical).toBe(1)
    expect(r.issuesDetail[0].rule).toBe('eval_detection')
  })

  it('pre-keys severitySummary at 0 for missing severities', () => {
    const json = JSON.stringify([{ id: 'r1', severity_summary: { critical: 1 } }])
    const [r] = parseReviews(json)
    expect(r.severitySummary.critical).toBe(1)
    expect(r.severitySummary.low).toBe(0)
    expect(r.severitySummary.info).toBe(0)
  })

  it('handles invalid JSON-string severity_summary gracefully', () => {
    const json = JSON.stringify([{ id: 'r1', severity_summary: 'not-json' }])
    const [r] = parseReviews(json)
    expect(r.severitySummary.critical).toBe(0)
  })

  it('drops entries without id', () => {
    expect(parseReviews(JSON.stringify([{ language: 'js' }]))).toEqual([])
  })

  it('lowercases issue severity', () => {
    const json = JSON.stringify([{
      id: 'r1',
      issues_detail: [{ rule: 'xss', severity: 'HIGH', match: 'innerHTML', pattern: 'x' }],
    }])
    expect(parseReviews(json)[0].issuesDetail[0].severity).toBe('high')
  })
})

// ─── parseReview ───────────────────────────────────────────────────────────

describe('parseReview', () => {
  it('returns null for empty / array output', () => {
    expect(parseReview('')).toBeNull()
    expect(parseReview('[]')).toBeNull()
  })

  it('parses single envelope', () => {
    const json = JSON.stringify({ id: 'r1', issues_found: 1 })
    expect(parseReview(json).issuesFound).toBe(1)
  })
})

// ─── parseReviewResult ─────────────────────────────────────────────────────

describe('parseReviewResult', () => {
  it('returns ok=false for empty output', () => {
    const r = parseReviewResult('')
    expect(r.ok).toBe(false)
    expect(r.reviewId).toBeNull()
    expect(r.severitySummary.critical).toBe(0)
  })

  it('parses success envelope', () => {
    const json = JSON.stringify({
      reviewId: 'r1', issuesFound: 2, securityIssues: 1,
      severitySummary: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
    })
    const r = parseReviewResult(json)
    expect(r.ok).toBe(true)
    expect(r.reviewId).toBe('r1')
    expect(r.issuesFound).toBe(2)
    expect(r.severitySummary.critical).toBe(1)
  })

  it('parses failure envelope (missing_code)', () => {
    const json = JSON.stringify({ reviewId: null, reason: 'missing_code' })
    const r = parseReviewResult(json)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing_code')
  })
})

// ─── parseScaffolds ────────────────────────────────────────────────────────

describe('parseScaffolds', () => {
  it('returns empty for empty output', () => {
    expect(parseScaffolds('')).toEqual([])
  })

  it('parses scaffold rows from snake_case', () => {
    const json = JSON.stringify([
      {
        id: 's1', template: 'react', project_name: 'my-app',
        options: '{"typescript":true}',
        files_generated: 12, output_path: '/tmp/my-app',
        created_at: 1700000000000,
      },
    ])
    const [s] = parseScaffolds(json)
    expect(s.id).toBe('s1')
    expect(s.template).toBe('react')
    expect(s.projectName).toBe('my-app')
    expect(s.filesGenerated).toBe(12)
    expect(s.outputPath).toBe('/tmp/my-app')
  })

  it('drops entries without id', () => {
    expect(parseScaffolds(JSON.stringify([{ template: 'react' }]))).toEqual([])
  })
})

// ─── parseScaffold ─────────────────────────────────────────────────────────

describe('parseScaffold', () => {
  it('returns null for empty / array output', () => {
    expect(parseScaffold('')).toBeNull()
    expect(parseScaffold('[]')).toBeNull()
  })

  it('parses single envelope', () => {
    const json = JSON.stringify({ id: 's1', template: 'vue', project_name: 'x' })
    expect(parseScaffold(json).template).toBe('vue')
  })
})

// ─── parseStats ────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStats('')
    expect(s.generations.total).toBe(0)
    expect(s.reviews.total).toBe(0)
    expect(s.scaffolds.total).toBe(0)
    for (const t of SCAFFOLD_TEMPLATES) expect(s.scaffolds.byTemplate[t]).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      generations: { total: 5, totalTokens: 8500, totalFiles: 22, uniqueLanguages: 3 },
      reviews: { total: 4, totalIssues: 12, totalSecurityIssues: 5, avgIssuesPerReview: 3 },
      scaffolds: {
        total: 7,
        byTemplate: { react: 3, vue: 2, express: 2 },
      },
    })
    const s = parseStats(json)
    expect(s.generations.total).toBe(5)
    expect(s.generations.totalTokens).toBe(8500)
    expect(s.reviews.totalIssues).toBe(12)
    expect(s.scaffolds.byTemplate.react).toBe(3)
    expect(s.scaffolds.byTemplate.vue).toBe(2)
    // Pre-keyed defaults preserved
    expect(s.scaffolds.byTemplate.fastapi).toBe(0)
    expect(s.scaffolds.byTemplate.spring_boot).toBe(0)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ generations: { total: 3 } })
    expect(parseStats(withNoise(json)).generations.total).toBe(3)
  })

  it('drops non-numeric byTemplate entries', () => {
    const json = JSON.stringify({
      scaffolds: { byTemplate: { react: 'oops', vue: 2 } },
    })
    const s = parseStats(json)
    expect(s.scaffolds.byTemplate.react).toBe(0)
    expect(s.scaffolds.byTemplate.vue).toBe(2)
  })
})

// ─── parseActionResult ─────────────────────────────────────────────────────

describe('parseActionResult', () => {
  it('returns ok=false for empty output', () => {
    expect(parseActionResult('')).toEqual({ ok: false, id: null, reason: '' })
  })

  it('detects generationId success', () => {
    const r = parseActionResult(JSON.stringify({ generationId: 'g-uuid' }))
    expect(r.ok).toBe(true)
    expect(r.id).toBe('g-uuid')
  })

  it('detects scaffoldId success', () => {
    const r = parseActionResult(JSON.stringify({ scaffoldId: 's-uuid' }))
    expect(r.ok).toBe(true)
    expect(r.id).toBe('s-uuid')
  })

  it('detects reviewId success', () => {
    const r = parseActionResult(JSON.stringify({ reviewId: 'r-uuid' }))
    expect(r.ok).toBe(true)
    expect(r.id).toBe('r-uuid')
  })

  it('preserves reason for failure', () => {
    const r = parseActionResult(JSON.stringify({ generationId: null, reason: 'missing_prompt' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing_prompt')
  })
})

// ─── formatCodegenTime ─────────────────────────────────────────────────────

describe('formatCodegenTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatCodegenTime(null)).toBe('—')
    expect(formatCodegenTime('')).toBe('—')
  })

  it('formats numeric ms timestamp', () => {
    expect(formatCodegenTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatCodegenTime('not-a-date')).toBe('not-a-date')
  })
})
