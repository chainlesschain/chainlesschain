/**
 * codegen-parser.js — Pure parsers for `cc codegen ...` CLI output.
 *
 * Most codegen commands accept `--json`. Like `cc recommend`, the
 * `_dbFromCtx` helper silently returns undefined outside a project: read
 * commands (list/show/stats) degrade to empty results from the in-memory
 * Maps, while mutating commands (generate/review/scaffold) throw on
 * `db.prepare`. The view shows graceful empty states without a noDb
 * banner.
 *
 * Lib uses sqlite-derived rows in snake_case (`generation_id`,
 * `file_count`, `created_at`, etc.); parsers normalize to camelCase.
 * Review rows additionally have `severity_summary` and `issues_detail`
 * as JSON-encoded strings — the parser auto-decodes them.
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

export const SCAFFOLD_TEMPLATES = Object.freeze([
  'react', 'vue', 'express', 'fastapi', 'spring_boot',
])

export const REVIEW_SEVERITIES = Object.freeze([
  'critical', 'high', 'medium', 'low', 'info',
])

export const SECURITY_RULES = Object.freeze([
  'eval_detection', 'sql_injection', 'xss', 'path_traversal', 'command_injection',
])

export const CICD_PLATFORMS = Object.freeze([
  'github_actions', 'gitlab_ci', 'jenkins',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function decodeJson(s, fallback = null) {
  if (s == null) return fallback
  if (typeof s !== 'string') return s
  try { return JSON.parse(s) } catch { return fallback }
}

/** Parse a JSON array of strings (e.g. `cc codegen templates --json`). */
export function parseStringList(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(s => typeof s === 'string')
}

function normalizeGeneration(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    prompt: String(raw.prompt || ''),
    language: raw.language ?? '',
    framework: raw.framework ?? '',
    generatedCode: raw.generated_code ?? raw.generatedCode ?? '',
    fileCount: num(raw.file_count ?? raw.fileCount, 0),
    tokenCount: num(raw.token_count ?? raw.tokenCount, 0),
    metadata: raw.metadata ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc codegen list --json`. */
export function parseGenerations(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeGeneration).filter(Boolean)
}

/** Parse `cc codegen show <id> --json`. */
export function parseGeneration(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeGeneration(parsed, 0)
}

function normalizeIssue(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  return {
    key: idx,
    rule: String(raw.rule || ''),
    severity: String(raw.severity || 'info').toLowerCase(),
    match: String(raw.match || ''),
    pattern: String(raw.pattern || ''),
  }
}

function normalizeReview(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null

  // severity_summary may arrive as a JSON-string (sqlite TEXT) OR an object
  // (already parsed). Normalize to object with non-numeric values dropped.
  const rawSummary = decodeJson(raw.severity_summary ?? raw.severitySummary, null)
    ?? raw.severity_summary ?? raw.severitySummary
  const severitySummary = {}
  for (const s of REVIEW_SEVERITIES) severitySummary[s] = 0
  if (rawSummary && typeof rawSummary === 'object' && !Array.isArray(rawSummary)) {
    for (const [k, v] of Object.entries(rawSummary)) {
      if (typeof v === 'number' && Number.isFinite(v)) severitySummary[k] = v
    }
  }

  // issues_detail can be a JSON-string OR a parsed array.
  const rawDetail = decodeJson(raw.issues_detail ?? raw.issuesDetail, null)
    ?? raw.issues_detail ?? raw.issuesDetail
  const issuesDetail = Array.isArray(rawDetail)
    ? rawDetail.map(normalizeIssue).filter(Boolean)
    : []

  return {
    key: id,
    id,
    generationId: raw.generation_id ?? raw.generationId ?? '',
    codeHash: String(raw.code_hash ?? raw.codeHash ?? ''),
    language: raw.language ?? '',
    issuesFound: num(raw.issues_found ?? raw.issuesFound, 0),
    securityIssues: num(raw.security_issues ?? raw.securityIssues, 0),
    severitySummary,
    issuesDetail,
    reviewedAt: raw.reviewed_at ?? raw.reviewedAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc codegen reviews --json`. */
export function parseReviews(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeReview).filter(Boolean)
}

/** Parse `cc codegen review-show <id> --json`. */
export function parseReview(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeReview(parsed, 0)
}

/**
 * Parse `cc codegen review <code> --json` envelope.
 * Lib returns `{reviewId, issuesFound, securityIssues, severitySummary}`
 * on success or `{reviewId: null, reason: '...'}` on failure.
 */
export function parseReviewResult(output) {
  const emptySummary = {}
  for (const s of REVIEW_SEVERITIES) emptySummary[s] = 0
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reviewId: null, reason: '', issuesFound: 0, securityIssues: 0, severitySummary: emptySummary }
  }
  const ok = !!parsed.reviewId
  const severitySummary = { ...emptySummary }
  if (parsed.severitySummary && typeof parsed.severitySummary === 'object' && !Array.isArray(parsed.severitySummary)) {
    for (const [k, v] of Object.entries(parsed.severitySummary)) {
      if (typeof v === 'number' && Number.isFinite(v)) severitySummary[k] = v
    }
  }
  return {
    ok,
    reviewId: parsed.reviewId ? String(parsed.reviewId) : null,
    reason: parsed.reason ? String(parsed.reason) : '',
    issuesFound: num(parsed.issuesFound, 0),
    securityIssues: num(parsed.securityIssues, 0),
    severitySummary,
  }
}

function normalizeScaffold(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    template: String(raw.template || ''),
    projectName: raw.project_name ?? raw.projectName ?? '',
    options: raw.options ?? null,
    filesGenerated: num(raw.files_generated ?? raw.filesGenerated, 0),
    outputPath: raw.output_path ?? raw.outputPath ?? '',
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc codegen scaffolds --json`. */
export function parseScaffolds(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeScaffold).filter(Boolean)
}

/** Parse `cc codegen scaffold-show <id> --json`. */
export function parseScaffold(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeScaffold(parsed, 0)
}

const STATS_DEFAULTS = {
  generations: { total: 0, totalTokens: 0, totalFiles: 0, uniqueLanguages: 0 },
  reviews: { total: 0, totalIssues: 0, totalSecurityIssues: 0, avgIssuesPerReview: 0 },
  scaffolds: { total: 0, byTemplate: {} },
}

/** Parse `cc codegen stats --json`. Always returns full pre-keyed shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  for (const t of SCAFFOLD_TEMPLATES) result.scaffolds.byTemplate[t] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  if (parsed.generations && typeof parsed.generations === 'object') {
    result.generations.total = num(parsed.generations.total, 0)
    result.generations.totalTokens = num(parsed.generations.totalTokens, 0)
    result.generations.totalFiles = num(parsed.generations.totalFiles, 0)
    result.generations.uniqueLanguages = num(parsed.generations.uniqueLanguages, 0)
  }
  if (parsed.reviews && typeof parsed.reviews === 'object') {
    result.reviews.total = num(parsed.reviews.total, 0)
    result.reviews.totalIssues = num(parsed.reviews.totalIssues, 0)
    result.reviews.totalSecurityIssues = num(parsed.reviews.totalSecurityIssues, 0)
    result.reviews.avgIssuesPerReview = num(parsed.reviews.avgIssuesPerReview, 0)
  }
  if (parsed.scaffolds && typeof parsed.scaffolds === 'object') {
    result.scaffolds.total = num(parsed.scaffolds.total, 0)
    if (parsed.scaffolds.byTemplate && typeof parsed.scaffolds.byTemplate === 'object') {
      for (const [k, v] of Object.entries(parsed.scaffolds.byTemplate)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.scaffolds.byTemplate[k] = v
      }
    }
  }
  return result
}

/** Parse a generic `{generationId|scaffoldId|reviewId: id, reason?}` envelope. */
export function parseActionResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, id: null, reason: '' }
  }
  const id = parsed.generationId || parsed.scaffoldId || parsed.reviewId || null
  return {
    ok: !!id,
    id: id ? String(id) : null,
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

/** Format numeric ms timestamp; em-dash on null/empty. */
export function formatCodegenTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
