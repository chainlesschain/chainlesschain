/**
 * Unit tests for src/utils/pipeline-parser.js
 *
 * Run: npx vitest run __tests__/unit/pipeline-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parsePipelines,
  parsePipeline,
  parseDeploys,
  parseTemplates,
  parseStatusEnums,
  parseStats,
  detectPipelineError,
  formatPipelineTime,
  PIPELINE_STATUSES,
  STAGE_STATUSES,
  DEPLOY_STATUSES,
  STAGE_NAMES,
  TEMPLATES,
  DEPLOY_STRATEGIES,
  GATE_STAGES,
} from '../../src/utils/pipeline-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('PIPELINE_STATUSES = pending/running/paused/completed/failed/cancelled', () => {
    expect(PIPELINE_STATUSES).toEqual(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'])
  })
  it('STAGE_STATUSES includes gate-waiting + skipped', () => {
    expect(STAGE_STATUSES).toEqual(['pending', 'running', 'gate-waiting', 'completed', 'failed', 'skipped'])
  })
  it('DEPLOY_STATUSES includes succeeded + rolled-back', () => {
    expect(DEPLOY_STATUSES).toEqual(['pending', 'running', 'succeeded', 'failed', 'rolled-back'])
  })
  it('STAGE_NAMES contains the 7 dev stages in order', () => {
    expect(STAGE_NAMES).toEqual([
      'requirement', 'architecture', 'code-generation', 'testing',
      'code-review', 'deploy', 'monitoring',
    ])
  })
  it('TEMPLATES = feature/bugfix/refactor/security-audit', () => {
    expect(TEMPLATES).toEqual(['feature', 'bugfix', 'refactor', 'security-audit'])
  })
  it('DEPLOY_STRATEGIES contains 6 entries', () => {
    expect(DEPLOY_STRATEGIES).toEqual(['git-pr', 'docker', 'npm-publish', 'local', 'staging', 'custom'])
  })
  it('GATE_STAGES = code-review + deploy', () => {
    expect(GATE_STAGES).toEqual(['code-review', 'deploy'])
  })
  it('all enums frozen', () => {
    for (const e of [PIPELINE_STATUSES, STAGE_STATUSES, DEPLOY_STATUSES, STAGE_NAMES, TEMPLATES, DEPLOY_STRATEGIES, GATE_STAGES]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── detectPipelineError ────────────────────────────────────────────────────

describe('detectPipelineError', () => {
  it('returns noDb=false on empty / clean output', () => {
    expect(detectPipelineError('')).toEqual({ noDb: false, error: '' })
    expect(detectPipelineError('[]')).toEqual({ noDb: false, error: '' })
  })

  it('detects "No database" error', () => {
    expect(detectPipelineError('No database')).toEqual({ noDb: true, error: 'No database' })
  })

  it('still detects "No database" wrapped in CLI noise', () => {
    expect(detectPipelineError(withNoise('No database')).noDb).toBe(true)
  })

  it('case-insensitive', () => {
    expect(detectPipelineError('NO DATABASE').noDb).toBe(true)
  })
})

// ─── parsePipelines ─────────────────────────────────────────────────────────

describe('parsePipelines', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parsePipelines('')).toEqual([])
    expect(parsePipelines('No database')).toEqual([])
    expect(parsePipelines('{}')).toEqual([])
  })

  it('parses pipeline rows with stages', () => {
    const json = JSON.stringify([
      {
        id: 'p1', name: 'fix-login', template: 'feature',
        config: { repo: 'web' }, status: 'running', currentStage: 2,
        result: null, errorMessage: null,
        createdAt: 1700000000000, updatedAt: 1700000001000,
        startedAt: 1700000000500, completedAt: null,
        stages: [
          { id: 's1', pipelineId: 'p1', stageIndex: 0, name: 'requirement', status: 'completed', gateRequired: 0, gateApproved: 0 },
          { id: 's2', pipelineId: 'p1', stageIndex: 1, name: 'architecture', status: 'completed', gateRequired: 0 },
          { id: 's3', pipelineId: 'p1', stageIndex: 2, name: 'code-generation', status: 'running', gateRequired: 0 },
        ],
      },
    ])
    const [p] = parsePipelines(json)
    expect(p.id).toBe('p1')
    expect(p.template).toBe('feature')
    expect(p.status).toBe('running')
    expect(p.currentStage).toBe(2)
    expect(p.stages).toHaveLength(3)
    expect(p.stages[0].name).toBe('requirement')
    expect(p.stages[2].status).toBe('running')
  })

  it('lowercases pipeline status', () => {
    expect(parsePipelines(JSON.stringify([{ id: 'p1', status: 'RUNNING' }]))[0].status).toBe('running')
  })

  it('coerces gate flags to boolean', () => {
    const json = JSON.stringify([
      { id: 'p1', stages: [{ id: 's1', name: 'code-review', gateRequired: 1, gateApproved: 0 }] },
    ])
    const [p] = parsePipelines(json)
    expect(p.stages[0].gateRequired).toBe(true)
    expect(p.stages[0].gateApproved).toBe(false)
  })

  it('handles missing stages array', () => {
    const [p] = parsePipelines(JSON.stringify([{ id: 'p1', template: 'feature' }]))
    expect(p.stages).toEqual([])
  })

  it('drops entries without id', () => {
    expect(parsePipelines(JSON.stringify([{ template: 'feature' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'p1', template: 'feature', status: 'pending' }])
    expect(parsePipelines(withNoise(json))).toHaveLength(1)
  })
})

// ─── parsePipeline (single envelope) ────────────────────────────────────────

describe('parsePipeline', () => {
  it('returns null for empty / array output', () => {
    expect(parsePipeline('')).toBeNull()
    expect(parsePipeline('[]')).toBeNull()
  })

  it('parses a single envelope', () => {
    const json = JSON.stringify({ id: 'p1', template: 'bugfix', status: 'pending' })
    expect(parsePipeline(json).template).toBe('bugfix')
  })

  it('returns null when envelope lacks id', () => {
    expect(parsePipeline(JSON.stringify({ template: 'feature' }))).toBeNull()
  })
})

// ─── parseDeploys ───────────────────────────────────────────────────────────

describe('parseDeploys', () => {
  it('returns empty for empty output', () => {
    expect(parseDeploys('')).toEqual([])
  })

  it('parses deploy rows', () => {
    const json = JSON.stringify([
      {
        id: 'd1', pipelineId: 'p1', strategy: 'git-pr',
        config: { branch: 'main' }, status: 'succeeded',
        result: { url: '...' }, errorMessage: null,
        rolledBackAt: null, rollbackReason: null,
        createdAt: 1700000000000, completedAt: 1700000001000,
      },
    ])
    const [d] = parseDeploys(json)
    expect(d.id).toBe('d1')
    expect(d.pipelineId).toBe('p1')
    expect(d.strategy).toBe('git-pr')
    expect(d.status).toBe('succeeded')
  })

  it('lowercases strategy + status', () => {
    const json = JSON.stringify([{ id: 'd1', strategy: 'DOCKER', status: 'ROLLED-BACK' }])
    const [d] = parseDeploys(json)
    expect(d.strategy).toBe('docker')
    expect(d.status).toBe('rolled-back')
  })

  it('drops entries without id', () => {
    expect(parseDeploys(JSON.stringify([{ strategy: 'docker' }]))).toEqual([])
  })
})

// ─── parseTemplates ─────────────────────────────────────────────────────────

describe('parseTemplates', () => {
  it('returns empty for non-array output', () => {
    expect(parseTemplates('')).toEqual([])
  })

  it('parses the 4 template catalogue', () => {
    const json = JSON.stringify([
      { name: 'feature', description: '功能开发', stages: ['requirement', 'architecture', 'code-generation'], gateStages: ['code-review'] },
      { name: 'security-audit', description: '安全审计', stages: ['code-generation', 'testing', 'code-review'], gateStages: ['code-review'] },
    ])
    const list = parseTemplates(json)
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('feature')
    expect(list[0].stages).toContain('architecture')
    expect(list[1].gateStages).toEqual(['code-review'])
  })

  it('coerces non-array stages to empty array', () => {
    const json = JSON.stringify([{ name: 'feature', stages: 'oops' }])
    expect(parseTemplates(json)[0].stages).toEqual([])
  })

  it('drops entries without name', () => {
    expect(parseTemplates(JSON.stringify([{ description: 'orphan' }]))).toEqual([])
  })
})

// ─── parseStatusEnums ───────────────────────────────────────────────────────

describe('parseStatusEnums', () => {
  it('returns full empty shape for empty output', () => {
    expect(parseStatusEnums('')).toEqual({ pipeline: [], stage: [], deploy: [] })
  })

  it('parses {pipeline, stage, deploy}', () => {
    const json = JSON.stringify({
      pipeline: ['pending', 'running'],
      stage: ['pending', 'gate-waiting'],
      deploy: ['pending', 'rolled-back'],
    })
    const r = parseStatusEnums(json)
    expect(r.pipeline).toEqual(['pending', 'running'])
    expect(r.stage).toContain('gate-waiting')
    expect(r.deploy).toContain('rolled-back')
  })

  it('filters non-string entries', () => {
    const json = JSON.stringify({ pipeline: ['ok', 1, null, 'also-ok'], stage: [], deploy: [] })
    expect(parseStatusEnums(json).pipeline).toEqual(['ok', 'also-ok'])
  })
})

// ─── parseStats ─────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStats('')
    expect(s.totalPipelines).toBe(0)
    expect(s.pipelinesByTemplate.feature).toBe(0)
    expect(s.pipelinesByTemplate['security-audit']).toBe(0)
    expect(s.pipelinesByStatus.pending).toBe(0)
    expect(s.stagesByStatus['gate-waiting']).toBe(0)
    expect(s.deploysByStrategy['git-pr']).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      totalPipelines: 5,
      pipelinesByTemplate: { feature: 3, bugfix: 2 },
      pipelinesByStatus: { running: 2, completed: 3 },
      totalStages: 30,
      stagesByStatus: { completed: 25, running: 5 },
      totalArtifacts: 15,
      totalDeploys: 8,
      deploysByStrategy: { 'git-pr': 5, docker: 3 },
    })
    const s = parseStats(json)
    expect(s.totalPipelines).toBe(5)
    expect(s.pipelinesByTemplate.feature).toBe(3)
    expect(s.stagesByStatus.completed).toBe(25)
    expect(s.deploysByStrategy['git-pr']).toBe(5)
    // Pre-keyed defaults preserved for unmentioned keys
    expect(s.pipelinesByTemplate.refactor).toBe(0)
    expect(s.deploysByStrategy.local).toBe(0)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ totalPipelines: 3 })
    expect(parseStats(withNoise(json)).totalPipelines).toBe(3)
  })

  it('drops non-numeric byTemplate/byStatus entries', () => {
    const json = JSON.stringify({
      pipelinesByTemplate: { feature: 'oops', bugfix: 2 },
    })
    const s = parseStats(json)
    expect(s.pipelinesByTemplate.feature).toBe(0) // pre-keyed default
    expect(s.pipelinesByTemplate.bugfix).toBe(2)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseStats('[]').totalPipelines).toBe(0)
  })
})

// ─── formatPipelineTime ─────────────────────────────────────────────────────

describe('formatPipelineTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatPipelineTime(null)).toBe('—')
    expect(formatPipelineTime('')).toBe('—')
  })

  it('formats a numeric ms timestamp', () => {
    expect(formatPipelineTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatPipelineTime('not-a-date')).toBe('not-a-date')
  })
})
