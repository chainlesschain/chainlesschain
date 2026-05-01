import { describe, it, expect } from 'vitest'
import {
  parseAuditMtcStatus,
  parsePublishStatus,
  parseVerifyResult,
  formatBatchInterval,
  formatTimestamp,
  formatRelative,
} from '../../src/utils/mtc-parser.js'

describe('mtc-parser — parseAuditMtcStatus', () => {
  it('returns shape with ok=false on empty input', () => {
    const r = parseAuditMtcStatus('')
    expect(r.ok).toBe(false)
    expect(r.config.enabled).toBe(false)
    expect(r.staging.count).toBe(0)
    expect(r.batches.count).toBe(0)
  })

  it('parses a fully-populated status payload', () => {
    const payload = {
      config: {
        enabled: true,
        batch_interval_seconds: 60,
        namespace_prefix: 'mtc/v1/audit/test',
        issuer: 'mtca:cc:test',
      },
      staging: { count: 7, malformed: 0, oldest_queued_at: '2026-05-01T10:00:00Z' },
      batches: {
        count: 3,
        last_batch_id: '000003',
        last_closed_at: '2026-05-01T11:30:00Z',
        last_tree_size: 12,
        last_tree_head_id: 'sha256:abc',
      },
    }
    const r = parseAuditMtcStatus(JSON.stringify(payload))
    expect(r.ok).toBe(true)
    expect(r.config.enabled).toBe(true)
    expect(r.config.batch_interval_seconds).toBe(60)
    expect(r.staging.count).toBe(7)
    expect(r.batches.last_batch_id).toBe('000003')
    expect(r.batches.last_tree_head_id).toBe('sha256:abc')
  })

  it('strips banner noise before parsing', () => {
    const noisy =
      '> connected to cc serve\n' +
      '⚠ STOPGAP — banner that should be stripped\n' +
      '{"config":{"enabled":true,"batch_interval_seconds":3600,"namespace_prefix":"x","issuer":"y"},"staging":{"count":0},"batches":{"count":0}}\n'
    const r = parseAuditMtcStatus(noisy)
    expect(r.ok).toBe(true)
    expect(r.config.enabled).toBe(true)
  })

  it('coerces malformed numeric fields to safe defaults', () => {
    const payload = {
      config: { enabled: 'yes', batch_interval_seconds: 'wrong' },
      staging: { count: null },
    }
    const r = parseAuditMtcStatus(JSON.stringify(payload))
    expect(r.config.enabled).toBe(false)
    expect(r.config.batch_interval_seconds).toBe(3600) // fallback
    expect(r.staging.count).toBe(0)
  })
})

describe('mtc-parser — parsePublishStatus', () => {
  it('flags non-existent state file', () => {
    const out = JSON.stringify({ ok: true, exists: false, state_file: '/tmp/x.json' })
    const r = parsePublishStatus(out)
    expect(r.ok).toBe(true)
    expect(r.exists).toBe(false)
    expect(r.history).toHaveLength(0)
  })

  it('parses populated state file with history', () => {
    const out = JSON.stringify({
      ok: true,
      exists: true,
      state_file: '/data/state.json',
      last_seq: 3,
      last_fingerprint: 'sha256:def',
      last_published_at: '2026-05-01T10:00:00Z',
      history_count: 3,
      history: [
        { seq: '000003', namespace: 'mtc/v1/skill/000003', tree_head_id: 'sha256:c', tree_size: 7, fingerprint: 'sha256:c', published_at: '2026-05-01T10:00:00Z', batch_dir: '/data/000003' },
        { seq: '000002', namespace: 'mtc/v1/skill/000002', tree_head_id: 'sha256:b', tree_size: 5, fingerprint: 'sha256:b', published_at: '2026-04-30T10:00:00Z', batch_dir: '/data/000002' },
        { seq: '000001', namespace: 'mtc/v1/skill/000001', tree_head_id: 'sha256:a', tree_size: 3, fingerprint: 'sha256:a', published_at: '2026-04-29T10:00:00Z', batch_dir: '/data/000001' },
      ],
    })
    const r = parsePublishStatus(out)
    expect(r.ok).toBe(true)
    expect(r.exists).toBe(true)
    expect(r.lastSeq).toBe(3)
    expect(r.history).toHaveLength(3)
    expect(r.history[0].seq).toBe('000003')
    expect(r.history[0].treeSize).toBe(7)
    expect(r.history[0].batchDir).toBe('/data/000003')
  })

  it('drops invalid history entries silently', () => {
    const out = JSON.stringify({
      ok: true,
      exists: true,
      state_file: '/x',
      history: [
        { seq: '000001' },
        null,
        { not_a_seq: 'broken' },
      ],
    })
    const r = parsePublishStatus(out)
    expect(r.history).toHaveLength(1)
    expect(r.history[0].seq).toBe('000001')
  })
})

describe('mtc-parser — parseVerifyResult', () => {
  it('parses a successful verify', () => {
    const out = JSON.stringify({
      ok: true,
      leaf: { kind: 'did-document', subject: 'did:cc:zQ3...' },
      treeHead: { tree_size: 4, issuer: 'mtca:cc:test' },
    })
    const r = parseVerifyResult(out)
    expect(r.ok).toBe(true)
    expect(r.leaf.subject).toBe('did:cc:zQ3...')
    expect(r.treeHead.tree_size).toBe(4)
  })

  it('parses a failed verify with code', () => {
    const out = JSON.stringify({ ok: false, code: 'LANDMARK_EXPIRED', recoverable: false })
    const r = parseVerifyResult(out)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('LANDMARK_EXPIRED')
  })

  it('returns shape with ok=false when output is empty/garbage', () => {
    expect(parseVerifyResult('').ok).toBe(false)
    expect(parseVerifyResult('not json').ok).toBe(false)
  })
})

describe('mtc-parser — formatters', () => {
  it('formatBatchInterval scales correctly', () => {
    expect(formatBatchInterval(30)).toBe('30s')
    expect(formatBatchInterval(60)).toBe('1min')
    expect(formatBatchInterval(3600)).toBe('1h')
    expect(formatBatchInterval(7200)).toBe('2h')
    expect(formatBatchInterval(0)).toBe('—')
    expect(formatBatchInterval(undefined)).toBe('—')
  })

  it('formatTimestamp returns dash for empty input', () => {
    expect(formatTimestamp('')).toBe('—')
    expect(formatTimestamp(null)).toBe('—')
    expect(formatTimestamp('not-a-date')).toBe('not-a-date')
  })

  it('formatRelative produces human-readable deltas', () => {
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString()
    expect(formatRelative(oneMinAgo)).toMatch(/min 前/)
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString()
    expect(formatRelative(twoHoursAgo)).toMatch(/h 前/)
    expect(formatRelative('')).toBe('—')
  })
})
