/**
 * nlprog-parser.js — Pure parsers for `cc nlprog ...` CLI output.
 *
 * NL Programming covers 3 stateless analysis ops (classify / extract /
 * detect-stack) + stateful translation CRUD + project conventions. DB
 * rows snake_case (input_text, tech_stack, completeness_score, ...) →
 * camelCase. Translation `entities` / `tech_stack` / `spec` /
 * `ambiguities` come back as JSON-strings from sqlite TEXT cols —
 * parser auto-decodes when valid, leaves as raw string otherwise.
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

export const INTENTS = Object.freeze([
  'create_component', 'add_feature', 'fix_bug', 'refactor', 'add_api',
  'add_test', 'update_style', 'configure', 'general',
])
export const TRANSLATION_STATUSES = Object.freeze(['draft', 'complete', 'refined'])
export const STYLE_CATEGORIES = Object.freeze([
  'naming', 'architecture', 'testing', 'style', 'imports', 'components',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Try to JSON-decode a sqlite TEXT field; return raw string on fail, [] on null. */
function decodeJsonField(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return raw }
}

/**
 * Parse `cc nlprog classify <text> --json`.
 * Envelope: `{intent, confidence}`.
 */
export function parseClassifyResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    intent: String(parsed.intent || 'general'),
    confidence: num(parsed.confidence, 0),
  }
}

/**
 * Parse `cc nlprog extract <text> --json`.
 * Envelope: `{entities: [{type, value}], count}`.
 */
export function parseExtractResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const entities = Array.isArray(parsed.entities)
    ? parsed.entities
        .map(e => e && typeof e === 'object'
          ? { type: String(e.type || ''), value: String(e.value || '') }
          : null)
        .filter(Boolean)
    : []
  return {
    entities,
    count: num(parsed.count, entities.length),
  }
}

/**
 * Parse `cc nlprog detect-stack <text> --json`.
 * Envelope: `{detected: [...], primary}`.
 */
export function parseStackResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const detected = Array.isArray(parsed.detected)
    ? parsed.detected.filter(s => typeof s === 'string')
    : []
  return {
    detected,
    primary: parsed.primary ? String(parsed.primary) : (detected[0] || null),
  }
}

function normalizeTranslation(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    inputText: raw.inputText ?? raw.input_text ?? '',
    intent: String(raw.intent || 'general'),
    entities: decodeJsonField(raw.entities, []),
    techStack: decodeJsonField(raw.techStack ?? raw.tech_stack, []),
    spec: decodeJsonField(raw.spec, null),
    completenessScore: num(raw.completenessScore ?? raw.completeness_score, 0),
    ambiguities: decodeJsonField(raw.ambiguities, []),
    status: String(raw.status || 'draft').toLowerCase(),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc nlprog list --json`. */
export function parseTranslations(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeTranslation).filter(Boolean)
}

/**
 * Parse `cc nlprog translate <text> --json`. The action returns
 * `{translated, translationId, intent, completeness}`. Returns null
 * on parse failure or stderr (CLI without project crashes; view
 * should detect via `parseTranslateError`).
 */
export function parseTranslateResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (parsed.translationId === undefined) return null
  return {
    translated: !!parsed.translated,
    translationId: parsed.translationId,
    intent: String(parsed.intent || ''),
    completeness: num(parsed.completeness, 0),
  }
}

/**
 * Detect the "no project DB" condition that `cc nlprog translate` hits
 * when run outside a chainlesschain project. Stderr reads
 * `TypeError: Cannot read properties of undefined (reading 'prepare')`.
 */
export function detectTranslateError(output) {
  if (!output) return { noDb: false, error: '' }
  const noDb = /Cannot read properties of undefined \(reading ['"]prepare['"]\)/i.test(output)
    || /TypeError.*prepare/i.test(output)
  const errMatch = output.match(/TypeError:\s*(.+?)(?:\r?\n|$)/i)
  return {
    noDb,
    error: errMatch ? errMatch[1].trim() : '',
  }
}

function normalizeConvention(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    category: String(raw.category || ''),
    pattern: String(raw.pattern || ''),
    examples: decodeJsonField(raw.examples, []),
    confidence: num(raw.confidence, 0),
    sourceFiles: decodeJsonField(raw.sourceFiles ?? raw.source_files, []),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc nlprog conventions --json`. */
export function parseConventions(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeConvention).filter(Boolean)
}

const STATS_DEFAULTS = {
  translations: {
    total: 0,
    byIntent: {},
    byStatus: { draft: 0, complete: 0, refined: 0 },
    avgCompleteness: 0,
  },
  conventions: { total: 0, byCategory: {} },
}

/** Parse `cc nlprog stats --json`. Always returns full nested shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  // pre-fill byIntent + byCategory with all known keys (zero values)
  for (const i of INTENTS) result.translations.byIntent[i] = 0
  for (const c of STYLE_CATEGORIES) result.conventions.byCategory[c] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  if (parsed.translations && typeof parsed.translations === 'object') {
    result.translations.total = num(parsed.translations.total, 0)
    result.translations.avgCompleteness = num(
      parsed.translations.avgCompleteness ?? parsed.translations.avg_completeness, 0,
    )
    if (parsed.translations.byIntent && typeof parsed.translations.byIntent === 'object') {
      for (const [k, v] of Object.entries(parsed.translations.byIntent)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.translations.byIntent[k] = v
      }
    }
    if (parsed.translations.byStatus && typeof parsed.translations.byStatus === 'object') {
      for (const k of Object.keys(result.translations.byStatus)) {
        result.translations.byStatus[k] = num(parsed.translations.byStatus[k], 0)
      }
    }
  }
  if (parsed.conventions && typeof parsed.conventions === 'object') {
    result.conventions.total = num(parsed.conventions.total, 0)
    if (parsed.conventions.byCategory && typeof parsed.conventions.byCategory === 'object') {
      for (const [k, v] of Object.entries(parsed.conventions.byCategory)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.conventions.byCategory[k] = v
      }
    }
  }
  return result
}

/** Format numeric ms timestamp; em-dash on empty. */
export function formatNlprogTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
