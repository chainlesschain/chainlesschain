/**
 * search-parser.js — Pure parsers for `cc search` + `cc note ...` CLI output.
 *
 * `cc search` is a single-command surface (no subcommands). It runs hybrid
 * BM25 + vector retrieval over the project's notes table and emits a flat
 * `{id, score, title, category, created_at, snippet}` array per `--json`.
 *
 * The view also pulls in `cc note list --json` for the index browser
 * (and `cc note show --json` for full content). Both DB-backed; outside a
 * project the bootstrap fails with "Database not available" — caught by
 * `detectSearchError`.
 *
 * Notes' `tags` column is a JSON-encoded string from sqlite. The parser
 * auto-decodes it to an array; falls back to [] on parse failure.
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

export const SEARCH_MODES = Object.freeze(['bm25', 'vector', 'hybrid'])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function decodeTags(raw) {
  if (Array.isArray(raw)) return raw.filter(t => typeof t === 'string')
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter(t => typeof t === 'string')
  } catch { /* not JSON */ }
  return []
}

/**
 * Detect the "Database not available" condition from `cc search` /
 * `cc note ...` outside a chainlesschain project. The search command
 * uses `ora.fail("Database not available")` which still emits the
 * substring even without --json.
 */
export function detectSearchError(output) {
  if (!output) return { noDb: false, error: '' }
  const cleaned = stripCliNoise(output)
  const noDb = /Database not available/i.test(cleaned)
  return {
    noDb,
    error: noDb ? 'Database not available' : '',
  }
}

function normalizeResult(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    score: num(raw.score, 0),
    title: String(raw.title || ''),
    category: String(raw.category || 'general'),
    createdAt: raw.created_at ?? raw.createdAt ?? '',
    snippet: String(raw.snippet || ''),
    _idx: idx,
  }
}

/** Parse `cc search <query> --json`. */
export function parseSearchResults(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeResult).filter(Boolean)
}

function normalizeNote(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    title: String(raw.title || ''),
    content: raw.content ?? '',
    tags: decodeTags(raw.tags),
    category: String(raw.category || 'general'),
    createdAt: raw.created_at ?? raw.createdAt ?? '',
    updatedAt: raw.updated_at ?? raw.updatedAt ?? '',
    _idx: idx,
  }
}

/** Parse `cc note list --json`. */
export function parseNotes(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeNote).filter(Boolean)
}

/** Parse `cc note show <id> --json`. */
export function parseNote(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeNote(parsed, 0)
}

/**
 * Compute index summary from a parsed notes array — categories + tag
 * frequency + total count. Returns `{total, categories: [{name, count}],
 * tags: [{name, count}]}` sorted by count desc.
 */
export function buildIndexSummary(notes) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return { total: 0, categories: [], tags: [] }
  }
  const catCounts = new Map()
  const tagCounts = new Map()
  for (const n of notes) {
    catCounts.set(n.category, (catCounts.get(n.category) || 0) + 1)
    for (const t of n.tags) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1)
    }
  }
  return {
    total: notes.length,
    categories: [...catCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    tags: [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  }
}

/**
 * Format a search/note timestamp. Notes use sqlite `datetime('now')` so
 * the value is `"YYYY-MM-DD HH:MM:SS"` (no T, no Z). We normalize to
 * ISO before formatting; raw passthrough on parse failure.
 */
export function formatSearchTime(ts) {
  if (ts == null || ts === '') return '—'
  const s = String(ts)
  const iso = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') + 'Z' : s
  const d = new Date(iso)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('zh-CN', { hour12: false })
}
