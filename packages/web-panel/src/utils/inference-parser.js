/**
 * inference-parser.js — Pure parsers for `cc inference ...` CLI output.
 *
 * Inference network: node registry + task scheduler. DB rows snake_case
 * (node_id, gpu_memory_mb, last_heartbeat, ...) — parser normalizes to
 * camelCase. Capabilities may arrive as a parsed array OR as JSON-string
 * from the sqlite TEXT column; parser handles both.
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

export const NODE_STATUSES = Object.freeze(['online', 'offline', 'busy', 'degraded'])
export const TASK_STATUSES = Object.freeze([
  'queued', 'dispatched', 'running', 'complete', 'failed',
])
export const PRIVACY_MODES = Object.freeze(['standard', 'encrypted', 'federated'])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function coerceCapabilities(raw) {
  if (Array.isArray(raw)) return raw.filter(s => typeof s === 'string')
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter(s => typeof s === 'string')
    } catch { /* not JSON */ }
  }
  return []
}

function normalizeNode(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    nodeId: raw.nodeId ?? raw.node_id ?? '',
    endpoint: raw.endpoint || '',
    capabilities: coerceCapabilities(raw.capabilities),
    gpuMemoryMb: num(raw.gpuMemoryMb ?? raw.gpu_memory_mb, 0),
    status: String(raw.status || 'offline').toLowerCase(),
    lastHeartbeat: raw.lastHeartbeat ?? raw.last_heartbeat ?? null,
    taskCount: num(raw.taskCount ?? raw.task_count, 0),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc inference nodes --json`. */
export function parseNodes(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeNode).filter(Boolean)
}

function normalizeTask(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    model: String(raw.model || ''),
    input: raw.input ?? '',
    output: raw.output ?? '',
    privacyMode: String(raw.privacyMode ?? raw.privacy_mode ?? 'standard').toLowerCase(),
    priority: num(raw.priority, 5),
    assignedNode: raw.assignedNode ?? raw.assigned_node ?? null,
    status: String(raw.status || 'queued').toLowerCase(),
    durationMs: raw.durationMs ?? raw.duration_ms ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    completedAt: raw.completedAt ?? raw.completed_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc inference tasks --json`. */
export function parseTasks(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeTask).filter(Boolean)
}

const STATS_DEFAULTS = {
  nodes: { total: 0, online: 0, offline: 0, busy: 0 },
  tasks: { total: 0, queued: 0, completed: 0, failed: 0, avgDurationMs: 0 },
}

/** Parse `cc inference stats --json`. Always returns full nested shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  if (parsed.nodes && typeof parsed.nodes === 'object') {
    result.nodes.total = num(parsed.nodes.total, 0)
    result.nodes.online = num(parsed.nodes.online, 0)
    result.nodes.offline = num(parsed.nodes.offline, 0)
    result.nodes.busy = num(parsed.nodes.busy, 0)
  }
  if (parsed.tasks && typeof parsed.tasks === 'object') {
    result.tasks.total = num(parsed.tasks.total, 0)
    result.tasks.queued = num(parsed.tasks.queued, 0)
    result.tasks.completed = num(parsed.tasks.completed, 0)
    result.tasks.failed = num(parsed.tasks.failed, 0)
    result.tasks.avgDurationMs = num(parsed.tasks.avgDurationMs ?? parsed.tasks.avg_duration_ms, 0)
  }
  return result
}

/**
 * Parse `cc inference register/submit --json` envelope. Returns the inner
 * id (`nodeId` or `taskId`) plus reason on failure.
 */
export function parseSubmitResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    nodeId: parsed.nodeId ?? null,
    taskId: parsed.taskId ?? null,
    status: parsed.status || null,
    assignedNode: parsed.assignedNode ?? null,
    reason: parsed.reason || null,
  }
}

/** Format numeric ms timestamp; em-dash on empty. */
export function formatInferenceTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
