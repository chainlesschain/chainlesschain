/**
 * privacy-parser.js — Pure parsers for `cc privacy ...` CLI output.
 *
 * Privacy Computing covers four independent technique families:
 *   - Federated Learning (FL): model + per-round training
 *   - Multi-Party Computation (MPC): shamir/beaver/gmw protocols
 *   - Differential Privacy (DP): laplace/gaussian/exponential
 *   - Homomorphic Encryption (HE): paillier/bfv/ckks
 *
 * DB rows come back snake_case from sqlite; parsers normalize to
 * camelCase. Reuses `stripCliNoise` from community-parser.
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

export const FL_STATUSES = Object.freeze([
  'initializing', 'training', 'aggregating', 'completed', 'failed',
])
export const MPC_STATUSES = Object.freeze(['pending', 'computing', 'completed'])
export const MPC_PROTOCOLS = Object.freeze(['shamir', 'beaver', 'gmw'])
export const DP_MECHANISMS = Object.freeze(['laplace', 'gaussian', 'exponential'])
export const HE_SCHEMES = Object.freeze(['paillier', 'bfv', 'ckks'])
export const HE_OPERATIONS = Object.freeze(['sum', 'product', 'mean', 'count'])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizeCatalog(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || id),
    description: String(raw.description || ''),
    _idx: idx,
  }
}

/** Parse `cc privacy {protocols|dp-mechanisms|he-schemes} --json`. */
export function parseCatalog(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeCatalog).filter(Boolean)
}

/**
 * Parse `cc privacy fl-statuses --json` etc. — bare arrays of strings.
 * Returns array of strings in the original order.
 */
export function parseEnumList(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(s => typeof s === 'string')
}

function normalizeModel(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || ''),
    modelType: raw.modelType ?? raw.model_type ?? 'neural_network',
    architecture: String(raw.architecture || ''),
    status: String(raw.status || 'initializing').toLowerCase(),
    currentRound: num(raw.currentRound ?? raw.current_round, 0),
    totalRounds: num(raw.totalRounds ?? raw.total_rounds, 0),
    participantCount: num(raw.participantCount ?? raw.participant_count, 0),
    accuracy: num(raw.accuracy, 0),
    loss: raw.loss == null ? null : num(raw.loss, null),
    learningRate: num(raw.learningRate ?? raw.learning_rate, 0),
    aggregationStrategy: raw.aggregationStrategy ?? raw.aggregation_strategy ?? '',
    privacyBudgetSpent: num(raw.privacyBudgetSpent ?? raw.privacy_budget_spent, 0),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc privacy models --json`. */
export function parseModels(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeModel).filter(Boolean)
}

function normalizeComputation(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  let participantIds = raw.participantIds ?? raw.participant_ids ?? []
  if (typeof participantIds === 'string') {
    try { participantIds = JSON.parse(participantIds) } catch { participantIds = [] }
  }
  if (!Array.isArray(participantIds)) participantIds = []
  return {
    key: id,
    id,
    computationType: raw.computationType ?? raw.computation_type ?? '',
    protocol: String(raw.protocol || 'shamir').toLowerCase(),
    participantCount: num(raw.participantCount ?? raw.participant_count, 0),
    participantIds,
    resultHash: raw.resultHash ?? raw.result_hash ?? null,
    status: String(raw.status || 'pending').toLowerCase(),
    sharesReceived: num(raw.sharesReceived ?? raw.shares_received, 0),
    sharesRequired: num(raw.sharesRequired ?? raw.shares_required, 0),
    computationTimeMs: raw.computationTimeMs ?? raw.computation_time_ms ?? null,
    errorMessage: raw.errorMessage ?? raw.error_message ?? '',
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    completedAt: raw.completedAt ?? raw.completed_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc privacy computations --json`. */
export function parseComputations(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeComputation).filter(Boolean)
}

/**
 * Parse `cc privacy dp-publish --json`. Returns publish envelope or null.
 */
export function parseDPResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    published: !!parsed.published,
    reason: parsed.reason || null,
    data: parsed.data ?? null,
    epsilon: num(parsed.epsilon, 0),
    delta: num(parsed.delta, 0),
    mechanism: String(parsed.mechanism || ''),
    budgetSpent: num(parsed.budgetSpent ?? parsed.budget_spent, 0),
    budgetRemaining: num(parsed.budgetRemaining ?? parsed.budget_remaining, 0),
  }
}

/**
 * Parse `cc privacy he-query --json`. Returns the HE query envelope or null.
 */
export function parseHEResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    result: parsed.result ?? null,
    operation: String(parsed.operation || ''),
    scheme: String(parsed.scheme || ''),
    inputCount: num(parsed.inputCount ?? parsed.input_count, 0),
    encrypted: parsed.encrypted !== false,
  }
}

const REPORT_DEFAULTS = {
  privacyBudget: { spent: 0, limit: 0, remaining: 0, exhausted: false },
  federatedLearning: { totalModels: 0, completed: 0, training: 0, avgAccuracy: 0 },
  mpc: { totalComputations: 0, completed: 0, pending: 0, byProtocol: {} },
}

/** Parse `cc privacy report --json`. Always returns the full nested shape. */
export function parseReport(output) {
  const result = JSON.parse(JSON.stringify(REPORT_DEFAULTS))
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  if (parsed.privacyBudget && typeof parsed.privacyBudget === 'object') {
    result.privacyBudget.spent = num(parsed.privacyBudget.spent, 0)
    result.privacyBudget.limit = num(parsed.privacyBudget.limit, 0)
    result.privacyBudget.remaining = num(parsed.privacyBudget.remaining, 0)
    result.privacyBudget.exhausted = !!parsed.privacyBudget.exhausted
  }
  if (parsed.federatedLearning && typeof parsed.federatedLearning === 'object') {
    result.federatedLearning.totalModels = num(parsed.federatedLearning.totalModels, 0)
    result.federatedLearning.completed = num(parsed.federatedLearning.completed, 0)
    result.federatedLearning.training = num(parsed.federatedLearning.training, 0)
    result.federatedLearning.avgAccuracy = num(parsed.federatedLearning.avgAccuracy, 0)
  }
  if (parsed.mpc && typeof parsed.mpc === 'object') {
    result.mpc.totalComputations = num(parsed.mpc.totalComputations, 0)
    result.mpc.completed = num(parsed.mpc.completed, 0)
    result.mpc.pending = num(parsed.mpc.pending, 0)
    if (parsed.mpc.byProtocol && typeof parsed.mpc.byProtocol === 'object') {
      for (const [k, v] of Object.entries(parsed.mpc.byProtocol)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.mpc.byProtocol[k] = v
      }
    }
  }
  return result
}

/** Format numeric ms timestamp; em-dash on empty. */
export function formatPrivacyTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
