/**
 * Unit tests for src/utils/inference-parser.js
 *
 * Run: npx vitest run __tests__/unit/inference-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseNodes,
  parseTasks,
  parseStats,
  parseSubmitResult,
  formatInferenceTime,
  NODE_STATUSES,
  TASK_STATUSES,
  PRIVACY_MODES,
} from '../../src/utils/inference-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('NODE_STATUSES = online/offline/busy/degraded', () => {
    expect(NODE_STATUSES).toEqual(['online', 'offline', 'busy', 'degraded'])
  })
  it('TASK_STATUSES = queued/dispatched/running/complete/failed', () => {
    expect(TASK_STATUSES).toEqual(['queued', 'dispatched', 'running', 'complete', 'failed'])
  })
  it('PRIVACY_MODES = standard/encrypted/federated', () => {
    expect(PRIVACY_MODES).toEqual(['standard', 'encrypted', 'federated'])
  })
  it('all enums frozen', () => {
    for (const e of [NODE_STATUSES, TASK_STATUSES, PRIVACY_MODES]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── parseNodes ─────────────────────────────────────────────────────────────

describe('parseNodes', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseNodes('')).toEqual([])
    expect(parseNodes('{}')).toEqual([])
  })

  it('parses snake_case DB rows into camelCase', () => {
    const json = JSON.stringify([
      {
        id: 'n1',
        node_id: 'gpu-host-1',
        endpoint: 'https://node1.example.com',
        capabilities: ['llama2', 'mistral'],
        gpu_memory_mb: 16384,
        status: 'online',
        last_heartbeat: 1700000000000,
        task_count: 3,
        created_at: 1700000000000,
      },
    ])
    const [n] = parseNodes(json)
    expect(n.id).toBe('n1')
    expect(n.nodeId).toBe('gpu-host-1')
    expect(n.endpoint).toBe('https://node1.example.com')
    expect(n.capabilities).toEqual(['llama2', 'mistral'])
    expect(n.gpuMemoryMb).toBe(16384)
    expect(n.taskCount).toBe(3)
  })

  it('coerces JSON-string capabilities (sqlite TEXT col) into array', () => {
    const json = JSON.stringify([
      { id: 'n1', node_id: 'gpu', capabilities: '["llama2","gpt"]' },
    ])
    const [n] = parseNodes(json)
    expect(n.capabilities).toEqual(['llama2', 'gpt'])
  })

  it('coerces unparseable capabilities string to empty array', () => {
    const json = JSON.stringify([{ id: 'n1', capabilities: 'not-json' }])
    expect(parseNodes(json)[0].capabilities).toEqual([])
  })

  it('filters non-string capability entries', () => {
    const json = JSON.stringify([{ id: 'n1', capabilities: ['ok', 1, null, 'also-ok'] }])
    expect(parseNodes(json)[0].capabilities).toEqual(['ok', 'also-ok'])
  })

  it('lowercases status', () => {
    expect(parseNodes(JSON.stringify([{ id: 'n1', status: 'BUSY' }]))[0].status).toBe('busy')
  })

  it('drops entries without id', () => {
    expect(parseNodes(JSON.stringify([{ node_id: 'orphan' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'n1', node_id: 'a', status: 'online' }])
    expect(parseNodes(withNoise(json))).toHaveLength(1)
  })

  it('uses node id as table row key', () => {
    expect(parseNodes(JSON.stringify([{ id: 'n1' }]))[0].key).toBe('n1')
  })
})

// ─── parseTasks ─────────────────────────────────────────────────────────────

describe('parseTasks', () => {
  it('returns empty for empty output', () => {
    expect(parseTasks('')).toEqual([])
  })

  it('parses snake_case task rows', () => {
    const json = JSON.stringify([
      {
        id: 't1',
        model: 'llama2-7b',
        input: 'hello',
        output: null,
        privacy_mode: 'encrypted',
        priority: 7,
        assigned_node: 'n1',
        status: 'dispatched',
        duration_ms: null,
        created_at: 1700000000000,
        completed_at: null,
      },
    ])
    const [t] = parseTasks(json)
    expect(t.id).toBe('t1')
    expect(t.model).toBe('llama2-7b')
    expect(t.privacyMode).toBe('encrypted')
    expect(t.priority).toBe(7)
    expect(t.assignedNode).toBe('n1')
    expect(t.status).toBe('dispatched')
  })

  it('defaults priority to 5 when missing', () => {
    expect(parseTasks(JSON.stringify([{ id: 't1', model: 'x' }]))[0].priority).toBe(5)
  })

  it('lowercases status + privacy_mode', () => {
    const json = JSON.stringify([{ id: 't1', model: 'x', status: 'COMPLETE', privacy_mode: 'STANDARD' }])
    const [t] = parseTasks(json)
    expect(t.status).toBe('complete')
    expect(t.privacyMode).toBe('standard')
  })

  it('drops entries without id', () => {
    expect(parseTasks(JSON.stringify([{ model: 'x' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 't1', model: 'a', status: 'queued' }])
    expect(parseTasks(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseStats ─────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full zero shape for empty output', () => {
    const s = parseStats('')
    expect(s.nodes.total).toBe(0)
    expect(s.nodes.online).toBe(0)
    expect(s.tasks.total).toBe(0)
    expect(s.tasks.queued).toBe(0)
    expect(s.tasks.avgDurationMs).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      nodes: { total: 10, online: 7, offline: 2, busy: 1 },
      tasks: { total: 50, queued: 5, completed: 40, failed: 3, avgDurationMs: 250 },
    })
    const s = parseStats(json)
    expect(s.nodes.total).toBe(10)
    expect(s.nodes.online).toBe(7)
    expect(s.tasks.completed).toBe(40)
    expect(s.tasks.avgDurationMs).toBe(250)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ nodes: { total: 3, online: 3, offline: 0, busy: 0 }, tasks: { total: 0, queued: 0, completed: 0, failed: 0, avgDurationMs: 0 } })
    expect(parseStats(withNoise(json)).nodes.total).toBe(3)
  })

  it('falls back to snake_case avg_duration_ms', () => {
    const json = JSON.stringify({ tasks: { total: 1, queued: 0, completed: 1, failed: 0, avg_duration_ms: 999 } })
    expect(parseStats(json).tasks.avgDurationMs).toBe(999)
  })

  it('treats non-object substructure as zero', () => {
    const json = JSON.stringify({ nodes: null, tasks: 'oops' })
    const s = parseStats(json)
    expect(s.nodes.total).toBe(0)
    expect(s.tasks.total).toBe(0)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseStats('[]').nodes.total).toBe(0)
  })
})

// ─── parseSubmitResult ──────────────────────────────────────────────────────

describe('parseSubmitResult', () => {
  it('returns null for empty / array output', () => {
    expect(parseSubmitResult('')).toBeNull()
    expect(parseSubmitResult('[]')).toBeNull()
  })

  it('parses register node envelope', () => {
    const json = JSON.stringify({ nodeId: 'n1' })
    const r = parseSubmitResult(json)
    expect(r.nodeId).toBe('n1')
    expect(r.taskId).toBeNull()
  })

  it('parses submit task envelope (with assigned node)', () => {
    const json = JSON.stringify({ taskId: 't1', status: 'dispatched', assignedNode: 'n1' })
    const r = parseSubmitResult(json)
    expect(r.taskId).toBe('t1')
    expect(r.status).toBe('dispatched')
    expect(r.assignedNode).toBe('n1')
  })

  it('parses submit task envelope (queued — no online node)', () => {
    const json = JSON.stringify({ taskId: 't1', status: 'queued', assignedNode: null })
    const r = parseSubmitResult(json)
    expect(r.status).toBe('queued')
    expect(r.assignedNode).toBeNull()
  })

  it('parses rejection envelope', () => {
    const json = JSON.stringify({ nodeId: null, reason: 'duplicate_node' })
    const r = parseSubmitResult(json)
    expect(r.nodeId).toBeNull()
    expect(r.reason).toBe('duplicate_node')
  })
})

// ─── formatInferenceTime ────────────────────────────────────────────────────

describe('formatInferenceTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatInferenceTime(null)).toBe('—')
    expect(formatInferenceTime('')).toBe('—')
    expect(formatInferenceTime(undefined)).toBe('—')
  })

  it('formats a numeric ms timestamp', () => {
    expect(formatInferenceTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatInferenceTime('not-a-date')).toBe('not-a-date')
  })
})
