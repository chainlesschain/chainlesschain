/**
 * mtc-parser.js — Pure parsers for `cc audit mtc *` and `cc mtc *` JSON output.
 *
 * The /mtc page surfaces three workflows:
 *   1. Audit double-track status (`cc audit mtc status --json`)
 *   2. Marketplace publisher state (`cc mtc publish-status <file> --json`)
 *   3. Envelope verification (`cc mtc verify <env> --landmark <lm> --json`)
 *
 * All commands emit JSON; this module strips banners + extracts the payload.
 * Reuses `stripCliNoise` from community-parser.
 */

import { stripCliNoise, tryParseJson } from './community-parser.js'

const STATUS_DEFAULTS = Object.freeze({
  ok: false,
  config: {
    enabled: false,
    batch_interval_seconds: 3600,
    namespace_prefix: '',
    issuer: '',
  },
  staging: { count: 0, malformed: 0, oldest_queued_at: null },
  batches: {
    count: 0,
    last_batch_id: null,
    last_closed_at: null,
    last_tree_size: null,
    last_tree_head_id: null,
  },
})

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asString(v, fallback = '') {
  return typeof v === 'string' ? v : fallback
}

/**
 * Parse `cc audit mtc status --json`.
 * Always returns a fully-shaped object so the view doesn't need to defensively
 * check every field. Sets ok=true only when the command produced a parseable
 * status payload (i.e. cc serve was reachable + audit-mtc dir was readable).
 *
 * Accepts either the raw text output (standalone `cc serve` mode) or a
 * pre-parsed object (embedded desktop web-shell, where the in-process
 * `mtc.audit-status` topic returns the audit-mtc.getStatus() return value
 * directly without a JSON.stringify round-trip).
 */
export function parseAuditMtcStatus(output) {
  const result = JSON.parse(JSON.stringify(STATUS_DEFAULTS))
  const parsed = output && typeof output === 'object' && !Array.isArray(output)
    ? output
    : tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.ok = true
  if (parsed.config && typeof parsed.config === 'object') {
    result.config.enabled = parsed.config.enabled === true
    result.config.batch_interval_seconds = num(
      parsed.config.batch_interval_seconds,
      result.config.batch_interval_seconds,
    )
    result.config.namespace_prefix = asString(parsed.config.namespace_prefix)
    result.config.issuer = asString(parsed.config.issuer)
  }
  if (parsed.staging && typeof parsed.staging === 'object') {
    result.staging.count = num(parsed.staging.count, 0)
    result.staging.malformed = num(parsed.staging.malformed, 0)
    result.staging.oldest_queued_at = parsed.staging.oldest_queued_at ?? null
  }
  if (parsed.batches && typeof parsed.batches === 'object') {
    result.batches.count = num(parsed.batches.count, 0)
    result.batches.last_batch_id = parsed.batches.last_batch_id ?? null
    result.batches.last_closed_at = parsed.batches.last_closed_at ?? null
    result.batches.last_tree_size = parsed.batches.last_tree_size ?? null
    result.batches.last_tree_head_id = parsed.batches.last_tree_head_id ?? null
  }
  return result
}

const PUBLISH_DEFAULTS = Object.freeze({
  ok: false,
  exists: false,
  stateFile: '',
  lastSeq: 0,
  lastFingerprint: null,
  lastPublishedAt: null,
  historyCount: 0,
  history: [],
})

function normalizeHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const seq = asString(raw.seq)
  if (!seq) return null
  return {
    key: seq,
    seq,
    namespace: asString(raw.namespace),
    treeHeadId: asString(raw.tree_head_id),
    rootHash: asString(raw.root_hash),
    treeSize: num(raw.tree_size, 0),
    fingerprint: asString(raw.fingerprint),
    publishedAt: asString(raw.published_at),
    batchDir: asString(raw.batch_dir),
  }
}

/**
 * Parse `cc mtc publish-status <file> --json`.
 * Always returns full shape; ok=true means the command ran cleanly,
 * exists=false means the state file simply hasn't been created yet
 * (publisher hasn't run for this state file path).
 */
export function parsePublishStatus(output) {
  const result = JSON.parse(JSON.stringify(PUBLISH_DEFAULTS))
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.ok = parsed.ok === true
  result.exists = parsed.exists === true
  result.stateFile = asString(parsed.state_file)
  if (!result.exists) return result

  result.lastSeq = num(parsed.last_seq, 0)
  result.lastFingerprint = parsed.last_fingerprint ?? null
  result.lastPublishedAt = parsed.last_published_at ?? null
  result.historyCount = num(parsed.history_count, 0)
  if (Array.isArray(parsed.history)) {
    result.history = parsed.history.map(normalizeHistoryEntry).filter(Boolean)
  }
  return result
}

const VERIFY_DEFAULTS = Object.freeze({
  ok: false,
  code: '',
  recoverable: false,
  leaf: null,
  treeHead: null,
  raw: null,
})

/**
 * Parse `cc mtc verify <env> --landmark <lm> --json`.
 * The CLI exits 0 on pass, 2 on verification failure, 1 on input error.
 * Both 0 and 2 produce a JSON body — the verify result includes ok/code,
 * so we don't need to look at exit code for parsing (caller can still
 * surface non-zero exit + raw output for input errors that produce no JSON).
 */
export function parseVerifyResult(output) {
  const result = JSON.parse(JSON.stringify(VERIFY_DEFAULTS))
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  result.raw = parsed
  result.ok = parsed.ok === true
  result.code = asString(parsed.code, parsed.reason || '')
  result.recoverable = parsed.recoverable === true
  if (parsed.leaf && typeof parsed.leaf === 'object') {
    result.leaf = parsed.leaf
  }
  if (parsed.treeHead && typeof parsed.treeHead === 'object') {
    result.treeHead = parsed.treeHead
  }
  return result
}

export function formatBatchInterval(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return '—'
  }
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`
  return `${Math.round(seconds / 3600)}h`
}

export function formatTimestamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { hour12: false })
}

export function formatRelative(iso) {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (isNaN(t)) return iso
  const delta = Math.round((Date.now() - t) / 1000)
  if (delta < 60) return `${delta}s 前`
  if (delta < 3600) return `${Math.round(delta / 60)}min 前`
  if (delta < 86400) return `${Math.round(delta / 3600)}h 前`
  return `${Math.round(delta / 86400)}d 前`
}
