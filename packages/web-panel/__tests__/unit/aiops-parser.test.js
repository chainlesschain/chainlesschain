/**
 * Unit tests for src/utils/aiops-parser.js
 *
 * Run: npx vitest run __tests__/unit/aiops-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseIncidents,
  parsePlaybooks,
  parseBaselines,
  parseDetectResult,
  parseStats,
  formatOpsTime,
  SEVERITIES,
  INCIDENT_STATUSES,
  ALGORITHMS,
} from '../../src/utils/aiops-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('enum exports', () => {
  it('SEVERITIES contains P0–P3', () => {
    expect(SEVERITIES).toEqual(['P0', 'P1', 'P2', 'P3'])
  })
  it('INCIDENT_STATUSES contains the 4 lifecycle states', () => {
    expect(INCIDENT_STATUSES).toEqual(['open', 'acknowledged', 'resolved', 'closed'])
  })
  it('ALGORITHMS contains z_score and iqr', () => {
    expect(ALGORITHMS).toEqual(['z_score', 'iqr'])
  })
  it('all enums are frozen', () => {
    expect(Object.isFrozen(SEVERITIES)).toBe(true)
    expect(Object.isFrozen(INCIDENT_STATUSES)).toBe(true)
    expect(Object.isFrozen(ALGORITHMS)).toBe(true)
  })
})

// ─── parseIncidents ─────────────────────────────────────────────────────────

describe('parseIncidents', () => {
  it('returns empty array for empty / non-array output', () => {
    expect(parseIncidents('')).toEqual([])
    expect(parseIncidents('{}')).toEqual([])
  })

  it('parses snake_case DB rows into camelCase', () => {
    const json = JSON.stringify([
      {
        id: 'inc1',
        anomaly_metric: 'cpu_usage',
        severity: 'P1',
        status: 'open',
        description: 'High CPU',
        anomaly_data: '{}',
        remediation_id: null,
        postmortem: null,
        acknowledged_at: null,
        resolved_at: null,
        created_at: 1700000000000,
      },
    ])
    const [i] = parseIncidents(json)
    expect(i.id).toBe('inc1')
    expect(i.anomalyMetric).toBe('cpu_usage')
    expect(i.severity).toBe('P1')
    expect(i.status).toBe('open')
    expect(i.createdAt).toBe(1700000000000)
  })

  it('also accepts already-camelCase fields', () => {
    const json = JSON.stringify([
      { id: 'inc1', anomalyMetric: 'm1', severity: 'P0', status: 'OPEN' },
    ])
    const [i] = parseIncidents(json)
    expect(i.anomalyMetric).toBe('m1')
    expect(i.status).toBe('open') // lowercased
  })

  it('drops entries without an id', () => {
    expect(parseIncidents(JSON.stringify([{ severity: 'P0' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'inc1', severity: 'P3', status: 'open' }])
    expect(parseIncidents(withNoise(json))).toHaveLength(1)
  })

  it('uses incident id as table row key', () => {
    const json = JSON.stringify([{ id: 'inc1', status: 'open' }, { id: 'inc2', status: 'open' }])
    const list = parseIncidents(json)
    expect(list[0].key).toBe('inc1')
    expect(list[1].key).toBe('inc2')
  })

  it('defaults severity to P3 when missing', () => {
    const json = JSON.stringify([{ id: 'inc1' }])
    expect(parseIncidents(json)[0].severity).toBe('P3')
  })
})

// ─── parsePlaybooks ─────────────────────────────────────────────────────────

describe('parsePlaybooks', () => {
  it('returns empty for empty output', () => {
    expect(parsePlaybooks('')).toEqual([])
  })

  it('parses snake_case fields and integer-encoded enabled flag', () => {
    const json = JSON.stringify([
      {
        id: 'pb1',
        name: 'restart-pod',
        trigger_condition: 'cpu>90',
        steps: 'kubectl rollout restart',
        enabled: 1,
        success_count: 5,
        failure_count: 1,
        created_at: 1700000000000,
      },
    ])
    const [p] = parsePlaybooks(json)
    expect(p.name).toBe('restart-pod')
    expect(p.triggerCondition).toBe('cpu>90')
    expect(p.enabled).toBe(true)
    expect(p.successCount).toBe(5)
    expect(p.failureCount).toBe(1)
  })

  it('coerces integer 0 to enabled=false', () => {
    const json = JSON.stringify([{ id: 'pb1', name: 'x', enabled: 0 }])
    expect(parsePlaybooks(json)[0].enabled).toBe(false)
  })

  it('coerces boolean true/false directly', () => {
    const json = JSON.stringify([
      { id: 'pb1', name: 'a', enabled: true },
      { id: 'pb2', name: 'b', enabled: false },
    ])
    const list = parsePlaybooks(json)
    expect(list[0].enabled).toBe(true)
    expect(list[1].enabled).toBe(false)
  })

  it('coerces string "1" / "0" too', () => {
    const json = JSON.stringify([
      { id: 'pb1', name: 'a', enabled: '1' },
      { id: 'pb2', name: 'b', enabled: '0' },
    ])
    const list = parsePlaybooks(json)
    expect(list[0].enabled).toBe(true)
    expect(list[1].enabled).toBe(false)
  })

  it('drops entries without an id', () => {
    expect(parsePlaybooks(JSON.stringify([{ name: 'orphan' }]))).toEqual([])
  })
})

// ─── parseBaselines ─────────────────────────────────────────────────────────

describe('parseBaselines', () => {
  it('returns empty for empty output', () => {
    expect(parseBaselines('')).toEqual([])
  })

  it('parses metric baselines using metric_name as key', () => {
    const json = JSON.stringify([
      {
        metric_name: 'cpu_usage',
        mean: 45.5,
        std_dev: 5.2,
        q1: 40,
        q3: 50,
        sample_count: 100,
        updated_at: 1700000000000,
      },
    ])
    const [b] = parseBaselines(json)
    expect(b.metricName).toBe('cpu_usage')
    expect(b.key).toBe('cpu_usage')
    expect(b.mean).toBe(45.5)
    expect(b.stdDev).toBe(5.2)
    expect(b.sampleCount).toBe(100)
  })

  it('drops entries without metric_name', () => {
    expect(parseBaselines(JSON.stringify([{ mean: 1 }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ metric_name: 'm1', mean: 0, std_dev: 0, q1: 0, q3: 0, sample_count: 0 }])
    expect(parseBaselines(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseDetectResult ──────────────────────────────────────────────────────

describe('parseDetectResult', () => {
  it('returns null for empty / non-object output', () => {
    expect(parseDetectResult('')).toBeNull()
    expect(parseDetectResult('[]')).toBeNull()
  })

  it('parses an anomaly detection envelope (anomaly=true)', () => {
    const json = JSON.stringify({
      anomaly: true,
      metricName: 'cpu',
      value: 99,
      algorithm: 'z_score',
      score: 4.5,
      threshold: 3.0,
      baseline: { mean: 50, std_dev: 10, q1: 45, q3: 55 },
      incidentId: 'inc1',
      severity: 'P1',
    })
    const r = parseDetectResult(json)
    expect(r.anomaly).toBe(true)
    expect(r.score).toBe(4.5)
    expect(r.threshold).toBe(3)
    expect(r.baseline.mean).toBe(50)
    expect(r.baseline.stdDev).toBe(10)
    expect(r.incidentId).toBe('inc1')
    expect(r.severity).toBe('P1')
  })

  it('parses a no-anomaly envelope', () => {
    const json = JSON.stringify({
      anomaly: false, metricName: 'cpu', value: 50, algorithm: 'z_score',
      score: 0.1, threshold: 3, baseline: { mean: 50, std_dev: 10 },
    })
    const r = parseDetectResult(json)
    expect(r.anomaly).toBe(false)
    expect(r.incidentId).toBeNull()
    expect(r.severity).toBeNull()
  })

  it('parses a "no_baseline" reason envelope', () => {
    const json = JSON.stringify({ anomaly: false, reason: 'no_baseline' })
    const r = parseDetectResult(json)
    expect(r.anomaly).toBe(false)
    expect(r.reason).toBe('no_baseline')
  })

  it('falls back to snake_case baseline.std_dev', () => {
    const json = JSON.stringify({ anomaly: false, baseline: { mean: 1, std_dev: 2 } })
    expect(parseDetectResult(json).baseline.stdDev).toBe(2)
  })
})

// ─── parseStats ─────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full zero shape for empty output', () => {
    const s = parseStats('')
    expect(s.incidents.total).toBe(0)
    expect(s.incidents.bySeverity.P0).toBe(0)
    expect(s.incidents.byStatus.open).toBe(0)
    expect(s.playbooks.total).toBe(0)
    expect(s.baselines.total).toBe(0)
    expect(s.baselines.metrics).toEqual([])
  })

  it('parses a complete stats payload', () => {
    const json = JSON.stringify({
      incidents: {
        total: 8,
        bySeverity: { P0: 1, P1: 2, P2: 3, P3: 2 },
        byStatus: { open: 3, acknowledged: 2, resolved: 2, closed: 1 },
        avgResolveMs: 12000,
      },
      playbooks: { total: 4, enabled: 3, totalSuccess: 12, totalFailure: 1 },
      baselines: { total: 2, metrics: ['cpu_usage', 'mem_usage'] },
    })
    const s = parseStats(json)
    expect(s.incidents.total).toBe(8)
    expect(s.incidents.bySeverity.P0).toBe(1)
    expect(s.incidents.byStatus.acknowledged).toBe(2)
    expect(s.incidents.avgResolveMs).toBe(12000)
    expect(s.playbooks.totalSuccess).toBe(12)
    expect(s.baselines.metrics).toEqual(['cpu_usage', 'mem_usage'])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ incidents: { total: 5 } })
    expect(parseStats(withNoise(json)).incidents.total).toBe(5)
  })

  it('falls back to snake_case totalSuccess / totalFailure / avg_resolve_ms', () => {
    const json = JSON.stringify({
      incidents: { total: 1, avg_resolve_ms: 999 },
      playbooks: { total: 1, enabled: 1, total_success: 5, total_failure: 0 },
    })
    const s = parseStats(json)
    expect(s.incidents.avgResolveMs).toBe(999)
    expect(s.playbooks.totalSuccess).toBe(5)
    expect(s.playbooks.totalFailure).toBe(0)
  })

  it('treats non-object substructure as zero', () => {
    const json = JSON.stringify({ incidents: null, playbooks: 'x', baselines: undefined })
    const s = parseStats(json)
    expect(s.incidents.total).toBe(0)
    expect(s.playbooks.total).toBe(0)
    expect(s.baselines.total).toBe(0)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseStats('[]').incidents.total).toBe(0)
  })
})

// ─── formatOpsTime ──────────────────────────────────────────────────────────

describe('formatOpsTime', () => {
  it('returns em-dash for null / empty / undefined', () => {
    expect(formatOpsTime(null)).toBe('—')
    expect(formatOpsTime('')).toBe('—')
    expect(formatOpsTime(undefined)).toBe('—')
  })

  it('formats a numeric ms timestamp', () => {
    expect(formatOpsTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatOpsTime('not-a-date')).toBe('not-a-date')
  })
})
