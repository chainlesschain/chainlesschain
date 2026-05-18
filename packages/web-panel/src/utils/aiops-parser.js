/**
 * aiops-parser.js — Pure parsers for `cc ops ...` CLI output.
 *
 * Reuses `stripCliNoise` from community-parser. Like cross-chain, AIOps DB
 * rows come back snake_case (anomaly_metric, std_dev, success_count, ...) —
 * we normalize to camelCase. Numeric ms timestamps via _now().
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

export const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3'])
export const INCIDENT_STATUSES = Object.freeze(['open', 'acknowledged', 'resolved', 'closed'])
export const ALGORITHMS = Object.freeze(['z_score', 'iqr'])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizeIncident(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    anomalyMetric: raw.anomalyMetric ?? raw.anomaly_metric ?? '',
    severity: String(raw.severity || 'P3'),
    status: String(raw.status || 'open').toLowerCase(),
    description: String(raw.description || ''),
    anomalyData: raw.anomalyData ?? raw.anomaly_data ?? null,
    remediationId: raw.remediationId ?? raw.remediation_id ?? null,
    postmortem: raw.postmortem || '',
    acknowledgedAt: raw.acknowledgedAt ?? raw.acknowledged_at ?? null,
    resolvedAt: raw.resolvedAt ?? raw.resolved_at ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc ops incidents --json`. */
export function parseIncidents(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeIncident).filter(Boolean)
}

function normalizePlaybook(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  // CLI persists enabled as integer 0/1, but the JSON serializer may emit
  // either form depending on whether it round-trips through SQLite.
  const rawEnabled = raw.enabled
  let enabled = false
  if (rawEnabled === true || rawEnabled === 1 || rawEnabled === '1') enabled = true
  else if (rawEnabled === false || rawEnabled === 0 || rawEnabled === '0') enabled = false
  else enabled = !!rawEnabled
  return {
    key: id,
    id,
    name: String(raw.name || ''),
    triggerCondition: raw.triggerCondition ?? raw.trigger_condition ?? '',
    steps: raw.steps || '',
    enabled,
    successCount: num(raw.successCount ?? raw.success_count, 0),
    failureCount: num(raw.failureCount ?? raw.failure_count, 0),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc ops playbooks --json`. */
export function parsePlaybooks(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizePlaybook).filter(Boolean)
}

function normalizeBaseline(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const metricName = raw.metricName ?? raw.metric_name ?? ''
  if (!metricName) return null
  return {
    key: metricName,
    metricName,
    mean: num(raw.mean, 0),
    stdDev: num(raw.stdDev ?? raw.std_dev, 0),
    q1: num(raw.q1, 0),
    q3: num(raw.q3, 0),
    sampleCount: num(raw.sampleCount ?? raw.sample_count, 0),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc ops baselines --json`. */
export function parseBaselines(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeBaseline).filter(Boolean)
}

/**
 * Parse `cc ops detect <metric> <value> [--algorithm z_score|iqr] --json`.
 * Returns the detection result envelope or null.
 */
export function parseDetectResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    anomaly: !!parsed.anomaly,
    reason: parsed.reason || null,
    metricName: parsed.metricName ?? parsed.metric_name ?? '',
    value: num(parsed.value, 0),
    algorithm: String(parsed.algorithm || ''),
    score: num(parsed.score, 0),
    threshold: num(parsed.threshold, 0),
    baseline: parsed.baseline ? {
      mean: num(parsed.baseline.mean, 0),
      stdDev: num(parsed.baseline.stdDev ?? parsed.baseline.std_dev, 0),
      q1: num(parsed.baseline.q1, 0),
      q3: num(parsed.baseline.q3, 0),
    } : null,
    incidentId: parsed.incidentId ?? parsed.incident_id ?? null,
    severity: parsed.severity || null,
  }
}

const STATS_DEFAULTS = {
  incidents: {
    total: 0,
    bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 },
    byStatus: { open: 0, acknowledged: 0, resolved: 0, closed: 0 },
    avgResolveMs: 0,
  },
  playbooks: { total: 0, enabled: 0, totalSuccess: 0, totalFailure: 0 },
  baselines: { total: 0, metrics: [] },
}

/** Parse `cc ops stats --json`. Always returns the full shape with zeros. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  if (parsed.incidents && typeof parsed.incidents === 'object') {
    result.incidents.total = num(parsed.incidents.total, 0)
    result.incidents.avgResolveMs = num(parsed.incidents.avgResolveMs ?? parsed.incidents.avg_resolve_ms, 0)
    if (parsed.incidents.bySeverity && typeof parsed.incidents.bySeverity === 'object') {
      for (const sev of Object.keys(result.incidents.bySeverity)) {
        result.incidents.bySeverity[sev] = num(parsed.incidents.bySeverity[sev], 0)
      }
    }
    if (parsed.incidents.byStatus && typeof parsed.incidents.byStatus === 'object') {
      for (const st of Object.keys(result.incidents.byStatus)) {
        result.incidents.byStatus[st] = num(parsed.incidents.byStatus[st], 0)
      }
    }
  }
  if (parsed.playbooks && typeof parsed.playbooks === 'object') {
    result.playbooks.total = num(parsed.playbooks.total, 0)
    result.playbooks.enabled = num(parsed.playbooks.enabled, 0)
    result.playbooks.totalSuccess = num(parsed.playbooks.totalSuccess ?? parsed.playbooks.total_success, 0)
    result.playbooks.totalFailure = num(parsed.playbooks.totalFailure ?? parsed.playbooks.total_failure, 0)
  }
  if (parsed.baselines && typeof parsed.baselines === 'object') {
    result.baselines.total = num(parsed.baselines.total, 0)
    if (Array.isArray(parsed.baselines.metrics)) {
      result.baselines.metrics = [...parsed.baselines.metrics]
    }
  }
  return result
}

/** Format a numeric ms timestamp from AIOps; em-dash on empty. */
export function formatOpsTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
