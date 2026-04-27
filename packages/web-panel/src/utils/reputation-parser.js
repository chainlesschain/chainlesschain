/**
 * reputation-parser.js — Pure parsers for `cc reputation ...` CLI output.
 *
 * Most reputation commands accept `--json`. The DB-backed ones
 * (`observe/score/list/anomalies/optimize/status/analytics/runs/apply/
 * stats-v2`) call bootstrap + `_dbFromCtx` which logs
 * "Database not available" + exits 1 outside a project — `detectReputationError`
 * catches that for the noDb banner.
 *
 * Lib operates on in-memory Maps (`_observations` / `_runs`) backed by sqlite
 * — output shapes are camelCase JS objects, no snake_case normalization
 * needed.
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

export const OPTIMIZATION_OBJECTIVES = Object.freeze([
  'accuracy', 'fairness', 'resilience', 'convergence_speed',
])

export const DECAY_MODELS = Object.freeze([
  'none', 'exponential', 'linear', 'step',
])

export const ANOMALY_METHODS = Object.freeze(['z_score', 'iqr'])

export const RUN_STATUSES = Object.freeze([
  'running', 'complete', 'applied', 'failed', 'cancelled',
])

export const OBSERVATION_KINDS = Object.freeze([
  'generic', 'task', 'review', 'vote',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Detect the "Database not available" condition that DB-backed reputation
 * commands hit when run outside a chainlesschain project.
 */
export function detectReputationError(output) {
  if (!output) return { noDb: false, error: '' }
  const cleaned = stripCliNoise(output)
  const noDb = /Database not available/i.test(cleaned)
  return {
    noDb,
    error: noDb ? 'Database not available' : '',
  }
}

function normalizeScore(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const did = raw.did || ''
  if (!did) return null
  return {
    key: did,
    did,
    score: num(raw.score, 0),
    observations: num(raw.observations, 0),
    decay: String(raw.decay || 'none'),
    weightTotal: num(raw.weightTotal, 0),
    _idx: idx,
  }
}

/** Parse `cc reputation list --json`. */
export function parseScores(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeScore).filter(Boolean)
}

/** Parse `cc reputation score <did> --json`. */
export function parseScore(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeScore(parsed, 0)
}

/** Parse `cc reputation observe <did> <score> --json` envelope. */
export function parseObservation(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const did = parsed.did || ''
  if (!did) return null
  return {
    observationId: String(parsed.observationId || parsed.id || ''),
    did,
    score: num(parsed.score, 0),
    kind: String(parsed.kind || 'generic'),
    weight: num(parsed.weight, 1),
    recordedAt: parsed.recordedAt ?? null,
  }
}

function normalizeAnomaly(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const did = raw.did || ''
  if (!did) return null
  return {
    key: `${did}-${idx}`,
    did,
    score: num(raw.score, 0),
    reason: String(raw.reason || ''),
    zScore: typeof raw.zScore === 'number' ? raw.zScore : null,
    lower: typeof raw.lower === 'number' ? raw.lower : null,
    upper: typeof raw.upper === 'number' ? raw.upper : null,
  }
}

/** Parse `cc reputation anomalies --json`. */
export function parseAnomalies(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { method: '', threshold: 0, totalSamples: 0, anomalies: [], summary: '', message: '' }
  }
  const list = Array.isArray(parsed.anomalies)
    ? parsed.anomalies.map(normalizeAnomaly).filter(Boolean)
    : []
  return {
    method: String(parsed.method || ''),
    threshold: num(parsed.threshold, 0),
    totalSamples: num(parsed.totalSamples, 0),
    anomalies: list,
    summary: parsed.summary ? String(parsed.summary) : '',
    message: parsed.message ? String(parsed.message) : '',
  }
}

function normalizeRun(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const runId = raw.runId || ''
  if (!runId) return null
  return {
    key: runId,
    runId,
    objective: String(raw.objective || ''),
    iterations: num(raw.iterations, 0),
    paramSpace: raw.paramSpace ?? null,
    bestParams: raw.bestParams ?? null,
    bestScore: num(raw.bestScore, 0),
    status: String(raw.status || 'complete').toLowerCase(),
    createdAt: raw.createdAt ?? null,
    completedAt: raw.completedAt ?? null,
    analytics: raw.analytics ?? null,
    errorMessage: raw.errorMessage ?? '',
    _idx: idx,
  }
}

/** Parse `cc reputation runs --json`. */
export function parseRuns(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeRun).filter(Boolean)
}

/**
 * Parse a single run envelope returned by `optimize`, `status <id>`,
 * `start-v2`, `complete <id>`, `apply`, etc.
 */
export function parseRun(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeRun(parsed, 0)
}

/** Parse `cc reputation analytics <run-id> --json`. */
export function parseAnalytics(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const dist = parsed.reputationDistribution || {}
  return {
    analyticsId: String(parsed.analyticsId || ''),
    runId: String(parsed.runId || ''),
    reputationDistribution: {
      buckets: Array.isArray(dist.buckets)
        ? dist.buckets
            .filter(b => b && typeof b === 'object')
            .map(b => ({
              label: String(b.label || ''),
              count: num(b.count, 0),
              min: typeof b.min === 'number' ? b.min : null,
              max: typeof b.max === 'number' ? b.max : null,
            }))
        : [],
      mean: typeof dist.mean === 'number' ? dist.mean : null,
      stdDev: typeof dist.stdDev === 'number' ? dist.stdDev : null,
    },
    anomalies: parsed.anomalies && typeof parsed.anomalies === 'object'
      ? {
          method: String(parsed.anomalies.method || ''),
          totalSamples: num(parsed.anomalies.totalSamples, 0),
          anomalies: Array.isArray(parsed.anomalies.anomalies)
            ? parsed.anomalies.anomalies.map(normalizeAnomaly).filter(Boolean)
            : [],
          summary: parsed.anomalies.summary ? String(parsed.anomalies.summary) : '',
          message: parsed.anomalies.message ? String(parsed.anomalies.message) : '',
        }
      : { method: '', totalSamples: 0, anomalies: [], summary: '', message: '' },
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter(r => typeof r === 'string')
      : [],
  }
}

const STATS_DEFAULTS = {
  totalRuns: 0,
  activeRuns: 0,
  maxConcurrentOptimizations: 0,
  byStatus: {},
  byObjective: {},
  observations: { totalObservations: 0, totalDids: 0 },
  bestScoreEver: 0,
}

/** Parse `cc reputation stats-v2 --json`. Always returns full pre-keyed shape. */
export function parseStatsV2(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  for (const s of RUN_STATUSES) result.byStatus[s] = 0
  for (const o of OPTIMIZATION_OBJECTIVES) result.byObjective[o] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.totalRuns = num(parsed.totalRuns, 0)
  result.activeRuns = num(parsed.activeRuns, 0)
  result.maxConcurrentOptimizations = num(parsed.maxConcurrentOptimizations, 0)
  result.bestScoreEver = num(parsed.bestScoreEver, 0)

  if (parsed.byStatus && typeof parsed.byStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.byStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byStatus[k] = v
    }
  }
  if (parsed.byObjective && typeof parsed.byObjective === 'object') {
    for (const [k, v] of Object.entries(parsed.byObjective)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byObjective[k] = v
    }
  }
  if (parsed.observations && typeof parsed.observations === 'object') {
    result.observations.totalObservations = num(parsed.observations.totalObservations, 0)
    result.observations.totalDids = num(parsed.observations.totalDids, 0)
  }
  return result
}

/** Format numeric ms timestamp; em-dash on null/empty. */
export function formatReputationTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
