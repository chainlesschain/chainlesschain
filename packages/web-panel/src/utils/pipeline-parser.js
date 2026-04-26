/**
 * pipeline-parser.js — Pure parsers for `cc pipeline ...` CLI output.
 *
 * Pipeline output is JSON-by-default (no --json flag needed). When run
 * outside a chainlesschain project, error commands emit "No database"
 * — `detectPipelineError` catches that to surface a graceful banner.
 *
 * Lib already returns camelCase via `_rowToPipeline()` etc., so parsers
 * are mostly passthrough with sensible defaults + status normalization.
 *
 * Reuses `stripCliNoise` from community-parser.
 */

import { stripCliNoise } from './community-parser.js'

function tryParseJson(output) {
  const cleaned = stripCliNoise(output)
  if (!cleaned) return null
  try { return JSON.parse(cleaned) } catch { /* fallthrough */ }
  const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export const PIPELINE_STATUSES = Object.freeze([
  'pending', 'running', 'paused', 'completed', 'failed', 'cancelled',
])
export const STAGE_STATUSES = Object.freeze([
  'pending', 'running', 'gate-waiting', 'completed', 'failed', 'skipped',
])
export const DEPLOY_STATUSES = Object.freeze([
  'pending', 'running', 'succeeded', 'failed', 'rolled-back',
])
export const STAGE_NAMES = Object.freeze([
  'requirement', 'architecture', 'code-generation', 'testing',
  'code-review', 'deploy', 'monitoring',
])
export const TEMPLATES = Object.freeze(['feature', 'bugfix', 'refactor', 'security-audit'])
export const DEPLOY_STRATEGIES = Object.freeze([
  'git-pr', 'docker', 'npm-publish', 'local', 'staging', 'custom',
])
export const GATE_STAGES = Object.freeze(['code-review', 'deploy'])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Detect the "No database" condition that pipeline commands hit when
 * run outside a chainlesschain project.
 */
export function detectPipelineError(output) {
  if (!output) return { noDb: false, error: '' }
  const cleaned = stripCliNoise(output)
  const noDb = /No database/i.test(cleaned)
  return {
    noDb,
    error: noDb ? 'No database' : '',
  }
}

function normalizeStage(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    pipelineId: String(raw.pipelineId || ''),
    stageIndex: num(raw.stageIndex, idx),
    name: String(raw.name || ''),
    status: String(raw.status || 'pending').toLowerCase(),
    gateRequired: !!raw.gateRequired,
    gateApproved: !!raw.gateApproved,
    gateRejectReason: raw.gateRejectReason || '',
    input: raw.input ?? null,
    output: raw.output ?? null,
    errorMessage: raw.errorMessage || '',
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    _idx: idx,
  }
}

function normalizePipeline(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  const stages = Array.isArray(raw.stages)
    ? raw.stages.map(normalizeStage).filter(Boolean)
    : []
  return {
    key: id,
    id,
    name: raw.name || '',
    template: String(raw.template || ''),
    config: raw.config ?? null,
    status: String(raw.status || 'pending').toLowerCase(),
    currentStage: num(raw.currentStage, 0),
    result: raw.result ?? null,
    errorMessage: raw.errorMessage || '',
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    stages,
    _idx: idx,
  }
}

/** Parse `cc pipeline list`. Returns [] on parse failure or "No database". */
export function parsePipelines(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizePipeline).filter(Boolean)
}

/** Parse `cc pipeline show <id>` or single-pipeline envelope. */
export function parsePipeline(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizePipeline(parsed, 0)
}

function normalizeDeploy(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    pipelineId: String(raw.pipelineId || ''),
    strategy: String(raw.strategy || '').toLowerCase(),
    config: raw.config ?? null,
    status: String(raw.status || 'pending').toLowerCase(),
    result: raw.result ?? null,
    errorMessage: raw.errorMessage || '',
    rolledBackAt: raw.rolledBackAt ?? null,
    rollbackReason: raw.rollbackReason || '',
    createdAt: raw.createdAt ?? null,
    completedAt: raw.completedAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc pipeline deploys`. */
export function parseDeploys(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeDeploy).filter(Boolean)
}

function normalizeTemplate(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const name = raw.name || ''
  if (!name) return null
  return {
    key: name,
    name,
    description: String(raw.description || ''),
    stages: Array.isArray(raw.stages) ? raw.stages.filter(s => typeof s === 'string') : [],
    gateStages: Array.isArray(raw.gateStages) ? raw.gateStages.filter(s => typeof s === 'string') : [],
    _idx: idx,
  }
}

/** Parse `cc pipeline templates`. */
export function parseTemplates(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeTemplate).filter(Boolean)
}

/**
 * Parse `cc pipeline statuses`. Returns the full
 * `{pipeline, stage, deploy}` shape with arrays of status strings.
 */
export function parseStatusEnums(output) {
  const result = { pipeline: [], stage: [], deploy: [] }
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
  for (const k of Object.keys(result)) {
    if (Array.isArray(parsed[k])) {
      result[k] = parsed[k].filter(s => typeof s === 'string')
    }
  }
  return result
}

const STATS_DEFAULTS = {
  totalPipelines: 0,
  pipelinesByTemplate: {},
  pipelinesByStatus: {},
  totalStages: 0,
  stagesByStatus: {},
  totalArtifacts: 0,
  totalDeploys: 0,
  deploysByStrategy: {},
}

/** Parse `cc pipeline stats`. Always returns full pre-keyed shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  // Pre-key with all known templates / statuses / strategies
  for (const t of TEMPLATES) result.pipelinesByTemplate[t] = 0
  for (const s of PIPELINE_STATUSES) result.pipelinesByStatus[s] = 0
  for (const s of STAGE_STATUSES) result.stagesByStatus[s] = 0
  for (const s of DEPLOY_STRATEGIES) result.deploysByStrategy[s] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.totalPipelines = num(parsed.totalPipelines, 0)
  result.totalStages = num(parsed.totalStages, 0)
  result.totalArtifacts = num(parsed.totalArtifacts, 0)
  result.totalDeploys = num(parsed.totalDeploys, 0)

  if (parsed.pipelinesByTemplate && typeof parsed.pipelinesByTemplate === 'object') {
    for (const [k, v] of Object.entries(parsed.pipelinesByTemplate)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.pipelinesByTemplate[k] = v
    }
  }
  if (parsed.pipelinesByStatus && typeof parsed.pipelinesByStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.pipelinesByStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.pipelinesByStatus[k] = v
    }
  }
  if (parsed.stagesByStatus && typeof parsed.stagesByStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.stagesByStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.stagesByStatus[k] = v
    }
  }
  if (parsed.deploysByStrategy && typeof parsed.deploysByStrategy === 'object') {
    for (const [k, v] of Object.entries(parsed.deploysByStrategy)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.deploysByStrategy[k] = v
    }
  }
  return result
}

/** Format numeric ms timestamp; em-dash on null/empty. */
export function formatPipelineTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
