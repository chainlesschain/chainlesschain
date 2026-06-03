/**
 * governance-parser.js — Pure parsers for `cc governance ...` CLI output.
 *
 * Most governance commands accept `--json` and emit structured JSON. The
 * DB-backed subcommands (`list/show/create/activate/close/expire/vote/votes/
 * tally/analyze/predict/stats`) call `_dbFromCtx` which logs
 * "Database not available" + exits 1 when run outside a chainlesschain
 * project — `detectGovernanceError` catches that to surface a graceful banner.
 *
 * Lib already returns camelCase shapes (proposal/vote/tally/analysis/
 * prediction/stats), so parsers are mostly passthrough with sensible
 * defaults + status normalization.
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

export const PROPOSAL_STATUSES = Object.freeze([
  'draft', 'active', 'passed', 'rejected', 'expired',
])
export const PROPOSAL_TYPE_IDS = Object.freeze([
  'parameter_change', 'feature_request', 'policy_update', 'budget_allocation',
])
export const IMPACT_LEVEL_IDS = Object.freeze([
  'low', 'medium', 'high', 'critical',
])
export const VOTE_VALUES = Object.freeze(['yes', 'no', 'abstain'])
export const PREDICTION_OUTCOMES = Object.freeze(['pass', 'reject'])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Detect the "Database not available" condition that DB-backed governance
 * commands hit when run outside a chainlesschain project.
 */
export function detectGovernanceError(output) {
  if (!output) return { noDb: false, error: '' }
  const cleaned = stripCliNoise(output)
  const noDb = /Database not available/i.test(cleaned)
  return {
    noDb,
    error: noDb ? 'Database not available' : '',
  }
}

function normalizeProposalType(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || ''),
    description: String(raw.description || ''),
    _idx: idx,
  }
}

function normalizeImpactLevel(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || ''),
    description: String(raw.description || ''),
    _idx: idx,
  }
}

/** Parse `cc governance types --json`. */
export function parseTypes(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeProposalType).filter(Boolean)
}

/** Parse `cc governance statuses --json` — array of status strings. */
export function parseStatuses(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(s => typeof s === 'string')
}

/** Parse `cc governance impact-levels --json`. */
export function parseImpactLevels(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeImpactLevel).filter(Boolean)
}

function normalizeProposal(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    title: String(raw.title || ''),
    description: raw.description ?? '',
    type: String(raw.type || 'feature_request'),
    proposerDid: raw.proposerDid ?? '',
    status: String(raw.status || 'draft').toLowerCase(),
    impactLevel: raw.impactLevel ?? '',
    impactAnalysis: raw.impactAnalysis ?? null,
    voteYes: num(raw.voteYes, 0),
    voteNo: num(raw.voteNo, 0),
    voteAbstain: num(raw.voteAbstain, 0),
    votingStartsAt: raw.votingStartsAt ?? null,
    votingEndsAt: raw.votingEndsAt ?? null,
    metadata: raw.metadata ?? null,
    createdAt: raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc governance list --json`. */
export function parseProposals(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeProposal).filter(Boolean)
}

/** Parse `cc governance show <id> --json`. */
export function parseProposal(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeProposal(parsed, 0)
}

function normalizeVote(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  const vote = String(raw.vote || '').toLowerCase()
  return {
    key: id,
    id,
    proposalId: String(raw.proposalId || ''),
    voterDid: String(raw.voterDid || ''),
    vote: VOTE_VALUES.includes(vote) ? vote : vote,
    reason: raw.reason ?? '',
    weight: num(raw.weight, 1),
    createdAt: raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc governance votes <proposal-id> --json`. */
export function parseVotes(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeVote).filter(Boolean)
}

/** Parse `cc governance tally <id> --json`. */
export function parseTally(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    proposalId: String(parsed.proposalId || ''),
    voteCount: num(parsed.voteCount, 0),
    yesWeight: num(parsed.yesWeight, 0),
    noWeight: num(parsed.noWeight, 0),
    abstainWeight: num(parsed.abstainWeight, 0),
    totalWeight: num(parsed.totalWeight, 0),
    yesRatio: num(parsed.yesRatio, 0),
    quorum: num(parsed.quorum, 0),
    quorumMet: !!parsed.quorumMet,
    threshold: num(parsed.threshold, 0),
    passed: !!parsed.passed,
  }
}

/** Parse `cc governance analyze <id> --json`. */
export function parseAnalysis(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    impactLevel: String(parsed.impactLevel || ''),
    affectedComponents: Array.isArray(parsed.affectedComponents)
      ? parsed.affectedComponents.filter(c => typeof c === 'string')
      : [],
    riskScore: num(parsed.riskScore, 0),
    benefitScore: num(parsed.benefitScore, 0),
    estimatedEffort: String(parsed.estimatedEffort || ''),
    communitySentiment: String(parsed.communitySentiment || ''),
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter(r => typeof r === 'string')
      : [],
    analyzedAt: parsed.analyzedAt ?? null,
  }
}

/** Parse `cc governance predict <id> --json`. */
export function parsePrediction(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    proposalId: String(parsed.proposalId || ''),
    predictedOutcome: String(parsed.predictedOutcome || ''),
    confidence: num(parsed.confidence, 0),
    yesProb: num(parsed.yesProb, 0),
    noProb: num(parsed.noProb, 0),
    abstainProb: num(parsed.abstainProb, 0),
    basedOn: String(parsed.basedOn || ''),
    sampleSize: num(parsed.sampleSize, 0),
  }
}

const STATS_DEFAULTS = {
  proposalCount: 0,
  voteCount: 0,
  byStatus: {},
  byType: {},
}

/** Parse `cc governance stats --json`. Always returns full pre-keyed shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  for (const s of PROPOSAL_STATUSES) result.byStatus[s] = 0
  for (const t of PROPOSAL_TYPE_IDS) result.byType[t] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.proposalCount = num(parsed.proposalCount, 0)
  result.voteCount = num(parsed.voteCount, 0)

  if (parsed.byStatus && typeof parsed.byStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.byStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byStatus[k] = v
    }
  }
  if (parsed.byType && typeof parsed.byType === 'object') {
    for (const [k, v] of Object.entries(parsed.byType)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.byType[k] = v
    }
  }
  return result
}

/** Format numeric ms timestamp; em-dash on null/empty. */
export function formatGovernanceTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
