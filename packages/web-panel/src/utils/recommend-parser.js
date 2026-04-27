/**
 * recommend-parser.js — Pure parsers for `cc recommend ...` CLI output.
 *
 * Most recommend commands accept `--json`. Unlike most other modules, the
 * recommend CLI does NOT exit hard with "Database not available" — its
 * `_dbFromCtx` returns undefined silently and lib functions degrade to
 * empty results (in-memory Maps stay empty when no DB rows are loaded).
 * So the view shows graceful empty states without a noDb banner.
 *
 * Lib emits sqlite-derived rows in snake_case (`user_id`, `content_type`,
 * `last_updated`, etc.). Parsers normalize to camelCase. Topic / weight
 * dicts are pre-parsed JSON objects on the lib side, no nested decoding
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

export const CONTENT_TYPE_IDS = Object.freeze([
  'note', 'post', 'article', 'document',
])

export const RECOMMENDATION_STATUSES = Object.freeze([
  'pending', 'viewed', 'dismissed',
])

export const FEEDBACK_VALUES = Object.freeze(['like', 'dislike', 'later'])

export const PROFILE_MATURITIES_V2 = Object.freeze([
  'onboarding', 'active', 'dormant', 'retired',
])

export const FEED_LIFECYCLES_V2 = Object.freeze([
  'draft', 'active', 'paused', 'archived',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function safeDict(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {}
  const out = {}
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

/** Parse `cc recommend content-types --json`. */
export function parseContentTypes(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(t => t && typeof t === 'object' && t.id)
    .map((t, idx) => ({
      key: t.id,
      id: String(t.id),
      name: String(t.name || ''),
      description: String(t.description || ''),
      _idx: idx,
    }))
}

/** Parse `cc recommend statuses --json` / `feedback-values --json`. */
export function parseStringList(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(s => typeof s === 'string')
}

function normalizeProfile(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const userId = raw.user_id ?? raw.userId ?? ''
  if (!userId) return null
  const topics = raw.topics && typeof raw.topics === 'object' && !Array.isArray(raw.topics)
    ? safeDict(raw.topics)
    : {}
  const interactionWeights = raw.interaction_weights ?? raw.interactionWeights
  const weights = interactionWeights && typeof interactionWeights === 'object' && !Array.isArray(interactionWeights)
    ? safeDict(interactionWeights)
    : {}
  return {
    key: userId,
    id: String(raw.id || ''),
    userId,
    topics,
    topicCount: Object.keys(topics).length,
    interactionWeights: weights,
    decayFactor: num(raw.decay_factor ?? raw.decayFactor, 0.9),
    lastUpdated: raw.last_updated ?? raw.lastUpdated ?? null,
    updateCount: num(raw.update_count ?? raw.updateCount, 0),
    _idx: idx,
  }
}

/** Parse `cc recommend profiles --json`. */
export function parseProfiles(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeProfile).filter(Boolean)
}

/** Parse `cc recommend profile <user-id> --json`. */
export function parseProfile(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeProfile(parsed, 0)
}

function normalizeRecommendation(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    userId: raw.user_id ?? raw.userId ?? '',
    contentId: raw.content_id ?? raw.contentId ?? '',
    contentType: String(raw.content_type ?? raw.contentType ?? 'note').toLowerCase(),
    title: String(raw.title || ''),
    score: num(raw.score, 0),
    reason: String(raw.reason || ''),
    source: String(raw.source || 'heuristic'),
    status: String(raw.status || 'pending').toLowerCase(),
    feedback: raw.feedback ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    viewedAt: raw.viewed_at ?? raw.viewedAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc recommend list <user-id> --json`. */
export function parseRecommendations(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeRecommendation).filter(Boolean)
}

/** Parse `cc recommend show <rec-id> --json`. */
export function parseRecommendation(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeRecommendation(parsed, 0)
}

const USER_STATS_DEFAULTS = {
  total: 0,
  pending: 0,
  viewed: 0,
  dismissed: 0,
  feedbackCount: 0,
  feedbackRate: 0,
  avgScore: 0,
}

/** Parse `cc recommend stats <user-id> --json`. Always full pre-keyed shape. */
export function parseUserStats(output) {
  const result = { ...USER_STATS_DEFAULTS }
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
  result.total = num(parsed.total, 0)
  result.pending = num(parsed.pending, 0)
  result.viewed = num(parsed.viewed, 0)
  result.dismissed = num(parsed.dismissed, 0)
  result.feedbackCount = num(parsed.feedbackCount, 0)
  result.feedbackRate = num(parsed.feedbackRate, 0)
  result.avgScore = num(parsed.avgScore, 0)
  return result
}

/** Parse `cc recommend top-interests <user-id> --json`. */
export function parseTopInterests(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(i => i && typeof i === 'object' && typeof i.topic === 'string')
    .map((i, idx) => ({
      key: `${i.topic}-${idx}`,
      topic: i.topic,
      weight: num(i.weight, 0),
    }))
}

/** Parse `cc recommend suggest <user-id> --json`. */
export function parseSuggestions(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(s => s && typeof s === 'object' && typeof s.topic === 'string' && typeof s.action === 'string')
    .map((s, idx) => ({
      key: `${s.topic}-${idx}`,
      topic: s.topic,
      action: s.action,
      amount: num(s.amount, 0),
    }))
}

const STATS_V2_DEFAULTS = {
  totalProfilesV2: 0,
  totalFeedsV2: 0,
  maxActiveProfilesPerSegment: 0,
  maxActiveFeedsPerCurator: 0,
  profileIdleMs: 0,
  feedStaleMs: 0,
  profilesByStatus: {},
  feedsByStatus: {},
}

/** Parse `cc recommend stats-v2 --json`. Full pre-keyed shape. */
export function parseStatsV2(output) {
  const result = JSON.parse(JSON.stringify(STATS_V2_DEFAULTS))
  for (const s of PROFILE_MATURITIES_V2) result.profilesByStatus[s] = 0
  for (const s of FEED_LIFECYCLES_V2) result.feedsByStatus[s] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.totalProfilesV2 = num(parsed.totalProfilesV2, 0)
  result.totalFeedsV2 = num(parsed.totalFeedsV2, 0)
  result.maxActiveProfilesPerSegment = num(parsed.maxActiveProfilesPerSegment, 0)
  result.maxActiveFeedsPerCurator = num(parsed.maxActiveFeedsPerCurator, 0)
  result.profileIdleMs = num(parsed.profileIdleMs, 0)
  result.feedStaleMs = num(parsed.feedStaleMs, 0)

  if (parsed.profilesByStatus && typeof parsed.profilesByStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.profilesByStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.profilesByStatus[k] = v
    }
  }
  if (parsed.feedsByStatus && typeof parsed.feedsByStatus === 'object') {
    for (const [k, v] of Object.entries(parsed.feedsByStatus)) {
      if (typeof v === 'number' && Number.isFinite(v)) result.feedsByStatus[k] = v
    }
  }
  return result
}

/** Parse a generic `{updated|deleted|marked|dismissed|recorded|applied: bool, reason?}` envelope. */
export function parseActionResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: '', profileId: null, topicCount: null }
  }
  const ok = !!(parsed.updated || parsed.deleted || parsed.marked
    || parsed.dismissed || parsed.recorded || parsed.applied || parsed.profileId)
  return {
    ok,
    reason: parsed.reason ? String(parsed.reason) : '',
    profileId: parsed.profileId ? String(parsed.profileId) : null,
    topicCount: typeof parsed.topicCount === 'number' ? parsed.topicCount : null,
  }
}

/** Format numeric ms timestamp; em-dash on null/empty. */
export function formatRecommendTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
