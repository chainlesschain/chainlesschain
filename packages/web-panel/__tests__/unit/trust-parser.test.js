/**
 * Unit tests for src/utils/trust-parser.js
 *
 * Run: npx vitest run __tests__/unit/trust-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseStringList,
  parseAttestations,
  parseAttestResult,
  parseInteropTests,
  parseInteropTestResult,
  parseSatMessages,
  parseSatMessage,
  parseHsmDevices,
  parseHsmDevice,
  parseSignResult,
  parseActionResult,
  parseStats,
  formatTrustTime,
  TRUST_ANCHORS,
  ATTESTATION_STATUSES,
  SATELLITE_PROVIDERS,
  SAT_MESSAGE_STATUSES,
  HSM_VENDORS,
  COMPLIANCE_LEVELS,
  HSM_MATURITIES_V2,
  TRANSMISSION_LIFECYCLES_V2,
} from '../../src/utils/trust-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen enums ───────────────────────────────────────────────────────────

describe('frozen enum exports', () => {
  it('TRUST_ANCHORS = tpm/tee/secure_element', () => {
    expect(TRUST_ANCHORS).toEqual(['tpm', 'tee', 'secure_element'])
  })
  it('ATTESTATION_STATUSES = 4 entries', () => {
    expect(ATTESTATION_STATUSES).toEqual(['valid', 'expired', 'failed', 'pending'])
  })
  it('SATELLITE_PROVIDERS = iridium/starlink/beidou', () => {
    expect(SATELLITE_PROVIDERS).toEqual(['iridium', 'starlink', 'beidou'])
  })
  it('SAT_MESSAGE_STATUSES = 4 entries', () => {
    expect(SAT_MESSAGE_STATUSES).toEqual(['queued', 'sent', 'confirmed', 'failed'])
  })
  it('HSM_VENDORS = 4 entries', () => {
    expect(HSM_VENDORS).toEqual(['yubikey', 'ledger', 'trezor', 'generic'])
  })
  it('COMPLIANCE_LEVELS = 3 entries', () => {
    expect(COMPLIANCE_LEVELS).toEqual(['fips_140_2', 'fips_140_3', 'cc_eal4'])
  })
  it('HSM_MATURITIES_V2 = 4 entries', () => {
    expect(HSM_MATURITIES_V2).toEqual(['provisional', 'active', 'degraded', 'retired'])
  })
  it('TRANSMISSION_LIFECYCLES_V2 = 5 entries', () => {
    expect(TRANSMISSION_LIFECYCLES_V2).toEqual([
      'queued', 'sending', 'confirmed', 'failed', 'canceled',
    ])
  })
  it('all enums frozen', () => {
    for (const e of [TRUST_ANCHORS, ATTESTATION_STATUSES, SATELLITE_PROVIDERS, SAT_MESSAGE_STATUSES, HSM_VENDORS, COMPLIANCE_LEVELS, HSM_MATURITIES_V2, TRANSMISSION_LIFECYCLES_V2]) {
      expect(Object.isFrozen(e)).toBe(true)
    }
  })
})

// ─── parseStringList ───────────────────────────────────────────────────────

describe('parseStringList', () => {
  it('returns empty for non-array', () => {
    expect(parseStringList('')).toEqual([])
    expect(parseStringList('{}')).toEqual([])
  })

  it('parses anchors array', () => {
    expect(parseStringList(JSON.stringify(['tpm', 'tee'])))
      .toEqual(['tpm', 'tee'])
  })

  it('filters non-string entries', () => {
    expect(parseStringList(JSON.stringify(['tpm', 1, null, 'tee'])))
      .toEqual(['tpm', 'tee'])
  })
})

// ─── parseAttestations ─────────────────────────────────────────────────────

describe('parseAttestations', () => {
  it('returns empty for empty / non-array output', () => {
    expect(parseAttestations('')).toEqual([])
    expect(parseAttestations('{}')).toEqual([])
  })

  it('parses attestation rows from snake_case', () => {
    const json = JSON.stringify([
      {
        id: 'a1', anchor: 'tpm', status: 'valid',
        challenge: 'deadbeef', response: 'cafe1234',
        device_fingerprint: 'fp-abc',
        created_at: 1700000000000, expires_at: 1702000000000,
      },
    ])
    const [a] = parseAttestations(json)
    expect(a.id).toBe('a1')
    expect(a.anchor).toBe('tpm')
    expect(a.status).toBe('valid')
    expect(a.deviceFingerprint).toBe('fp-abc')
    expect(a.createdAt).toBe(1700000000000)
  })

  it('lowercases anchor + status', () => {
    const json = JSON.stringify([{ id: 'a1', anchor: 'TPM', status: 'VALID' }])
    const [a] = parseAttestations(json)
    expect(a.anchor).toBe('tpm')
    expect(a.status).toBe('valid')
  })

  it('drops entries without id', () => {
    expect(parseAttestations(JSON.stringify([{ anchor: 'tpm' }]))).toEqual([])
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'a1', anchor: 'tpm', status: 'valid' }])
    expect(parseAttestations(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseAttestResult ─────────────────────────────────────────────────────

describe('parseAttestResult', () => {
  it('returns ok=false for empty / non-object output', () => {
    expect(parseAttestResult('')).toEqual({ ok: false, attestationId: null, status: '', response: '', reason: '' })
  })

  it('parses success envelope', () => {
    const json = JSON.stringify({ attestationId: 'a1', status: 'valid', response: 'sig' })
    const r = parseAttestResult(json)
    expect(r.ok).toBe(true)
    expect(r.attestationId).toBe('a1')
    expect(r.status).toBe('valid')
  })

  it('parses failure envelope', () => {
    const json = JSON.stringify({ attestationId: null, reason: 'invalid_anchor' })
    const r = parseAttestResult(json)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_anchor')
  })
})

// ─── parseInteropTests ─────────────────────────────────────────────────────

describe('parseInteropTests', () => {
  it('returns empty for empty output', () => {
    expect(parseInteropTests('')).toEqual([])
  })

  it('parses interop test rows', () => {
    const json = JSON.stringify([
      {
        id: 't1', algorithm: 'ml_kem_768', peer: 'p1',
        compatible: true, result: 'pass', latency_ms: 42,
        created_at: 1700000000000,
      },
    ])
    const [t] = parseInteropTests(json)
    expect(t.id).toBe('t1')
    expect(t.algorithm).toBe('ml_kem_768')
    expect(t.compatible).toBe(true)
    expect(t.latencyMs).toBe(42)
    expect(t.result).toBe('pass')
  })

  it('coerces missing latency to 0', () => {
    const json = JSON.stringify([{ id: 't1', algorithm: 'a', compatible: false }])
    expect(parseInteropTests(json)[0].latencyMs).toBe(0)
  })

  it('drops entries without id', () => {
    expect(parseInteropTests(JSON.stringify([{ algorithm: 'a' }]))).toEqual([])
  })
})

// ─── parseInteropTestResult ────────────────────────────────────────────────

describe('parseInteropTestResult', () => {
  it('returns ok=false for empty output', () => {
    const r = parseInteropTestResult('')
    expect(r.ok).toBe(false)
    expect(r.testId).toBeNull()
  })

  it('parses success envelope', () => {
    const json = JSON.stringify({
      testId: 't1', compatible: true, result: 'pass', latencyMs: 50,
    })
    const r = parseInteropTestResult(json)
    expect(r.ok).toBe(true)
    expect(r.testId).toBe('t1')
    expect(r.compatible).toBe(true)
    expect(r.latencyMs).toBe(50)
  })
})

// ─── parseSatMessages ──────────────────────────────────────────────────────

describe('parseSatMessages', () => {
  it('returns empty for empty output', () => {
    expect(parseSatMessages('')).toEqual([])
  })

  it('parses sat message rows', () => {
    const json = JSON.stringify([
      {
        id: 'm1', provider: 'iridium', priority: 7,
        status: 'sent', payload: 'hello world',
        sent_at: 1700000000000, confirmed_at: null,
        created_at: 1699999000000,
      },
    ])
    const [m] = parseSatMessages(json)
    expect(m.id).toBe('m1')
    expect(m.provider).toBe('iridium')
    expect(m.priority).toBe(7)
    expect(m.status).toBe('sent')
    expect(m.sentAt).toBe(1700000000000)
    expect(m.confirmedAt).toBeNull()
  })

  it('lowercases provider + status', () => {
    const json = JSON.stringify([{ id: 'm1', provider: 'IRIDIUM', status: 'CONFIRMED' }])
    const [m] = parseSatMessages(json)
    expect(m.provider).toBe('iridium')
    expect(m.status).toBe('confirmed')
  })

  it('defaults missing priority to 5', () => {
    const [m] = parseSatMessages(JSON.stringify([{ id: 'm1' }]))
    expect(m.priority).toBe(5)
  })

  it('drops entries without id', () => {
    expect(parseSatMessages(JSON.stringify([{ payload: 'x' }]))).toEqual([])
  })
})

// ─── parseSatMessage ───────────────────────────────────────────────────────

describe('parseSatMessage', () => {
  it('returns null for empty / array output', () => {
    expect(parseSatMessage('')).toBeNull()
    expect(parseSatMessage('[]')).toBeNull()
  })

  it('parses single envelope', () => {
    const json = JSON.stringify({ id: 'm1', provider: 'starlink', status: 'queued' })
    expect(parseSatMessage(json).provider).toBe('starlink')
  })
})

// ─── parseHsmDevices ───────────────────────────────────────────────────────

describe('parseHsmDevices', () => {
  it('returns empty for empty output', () => {
    expect(parseHsmDevices('')).toEqual([])
  })

  it('parses HSM rows', () => {
    const json = JSON.stringify([
      {
        id: 'd1', vendor: 'yubikey', model: 'YK5',
        serial_number: 'SN-12345',
        compliance_level: 'fips_140_2',
        firmware_version: '5.4.3',
        created_at: 1700000000000,
      },
    ])
    const [d] = parseHsmDevices(json)
    expect(d.id).toBe('d1')
    expect(d.vendor).toBe('yubikey')
    expect(d.model).toBe('YK5')
    expect(d.serialNumber).toBe('SN-12345')
    expect(d.complianceLevel).toBe('fips_140_2')
    expect(d.firmwareVersion).toBe('5.4.3')
  })

  it('lowercases vendor', () => {
    const json = JSON.stringify([{ id: 'd1', vendor: 'YUBIKEY' }])
    expect(parseHsmDevices(json)[0].vendor).toBe('yubikey')
  })

  it('drops entries without id', () => {
    expect(parseHsmDevices(JSON.stringify([{ vendor: 'yubikey' }]))).toEqual([])
  })
})

// ─── parseHsmDevice ────────────────────────────────────────────────────────

describe('parseHsmDevice', () => {
  it('returns null for empty / array output', () => {
    expect(parseHsmDevice('')).toBeNull()
    expect(parseHsmDevice('[]')).toBeNull()
  })

  it('parses single envelope', () => {
    const json = JSON.stringify({ id: 'd1', vendor: 'ledger', model: 'Nano X' })
    expect(parseHsmDevice(json).model).toBe('Nano X')
  })
})

// ─── parseSignResult ───────────────────────────────────────────────────────

describe('parseSignResult', () => {
  it('returns ok=false for empty output', () => {
    expect(parseSignResult('')).toEqual({ ok: false, signature: '', algorithm: '', reason: '' })
  })

  it('parses success envelope', () => {
    const json = JSON.stringify({ signature: '0xdeadbeef', algorithm: 'ed25519' })
    const r = parseSignResult(json)
    expect(r.ok).toBe(true)
    expect(r.signature).toBe('0xdeadbeef')
    expect(r.algorithm).toBe('ed25519')
  })

  it('parses failure envelope', () => {
    const json = JSON.stringify({ signature: null, reason: 'device_not_found' })
    const r = parseSignResult(json)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('device_not_found')
  })
})

// ─── parseActionResult ─────────────────────────────────────────────────────

describe('parseActionResult', () => {
  it('returns ok=false for empty output', () => {
    expect(parseActionResult('')).toEqual({ ok: false, id: null, reason: '' })
  })

  it('detects deviceId success', () => {
    const r = parseActionResult(JSON.stringify({ deviceId: 'd-uuid' }))
    expect(r.ok).toBe(true)
    expect(r.id).toBe('d-uuid')
  })

  it('detects messageId success', () => {
    const r = parseActionResult(JSON.stringify({ messageId: 'm-uuid' }))
    expect(r.id).toBe('m-uuid')
  })

  it('detects removed:true / updated:true', () => {
    expect(parseActionResult(JSON.stringify({ removed: true })).ok).toBe(true)
    expect(parseActionResult(JSON.stringify({ updated: true })).ok).toBe(true)
  })

  it('preserves reason for failure', () => {
    const r = parseActionResult(JSON.stringify({ deviceId: null, reason: 'invalid_vendor' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_vendor')
  })
})

// ─── parseStats ────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full pre-keyed shape for empty output', () => {
    const s = parseStats('')
    expect(s.attestations.total).toBe(0)
    expect(s.interopTests.total).toBe(0)
    expect(s.satellite.total).toBe(0)
    expect(s.hsm.total).toBe(0)
    for (const a of TRUST_ANCHORS) expect(s.attestations.byAnchor[a]).toBe(0)
    for (const v of HSM_VENDORS) expect(s.hsm.byVendor[v]).toBe(0)
  })

  it('parses populated stats payload', () => {
    const json = JSON.stringify({
      attestations: { total: 8, valid: 6, byAnchor: { tpm: 4, tee: 3, secure_element: 1 } },
      interopTests: { total: 12, compatible: 10, avgLatencyMs: 65 },
      satellite: { total: 5, queued: 1, confirmed: 3 },
      hsm: { total: 4, byVendor: { yubikey: 2, ledger: 1, trezor: 1 } },
    })
    const s = parseStats(json)
    expect(s.attestations.total).toBe(8)
    expect(s.attestations.valid).toBe(6)
    expect(s.attestations.byAnchor.tpm).toBe(4)
    expect(s.interopTests.compatible).toBe(10)
    expect(s.interopTests.avgLatencyMs).toBe(65)
    expect(s.satellite.queued).toBe(1)
    expect(s.hsm.byVendor.yubikey).toBe(2)
    // Pre-keyed defaults preserved
    expect(s.hsm.byVendor.generic).toBe(0)
  })

  it('drops non-numeric byAnchor / byVendor entries', () => {
    const json = JSON.stringify({
      attestations: { byAnchor: { tpm: 'oops', tee: 2 } },
      hsm: { byVendor: { yubikey: 'x', ledger: 1 } },
    })
    const s = parseStats(json)
    expect(s.attestations.byAnchor.tpm).toBe(0)
    expect(s.attestations.byAnchor.tee).toBe(2)
    expect(s.hsm.byVendor.yubikey).toBe(0)
    expect(s.hsm.byVendor.ledger).toBe(1)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ attestations: { total: 5 } })
    expect(parseStats(withNoise(json)).attestations.total).toBe(5)
  })
})

// ─── formatTrustTime ───────────────────────────────────────────────────────

describe('formatTrustTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatTrustTime(null)).toBe('—')
    expect(formatTrustTime('')).toBe('—')
  })

  it('formats numeric ms timestamp', () => {
    expect(formatTrustTime(1700000000000).length).toBeGreaterThan(8)
  })

  it('returns raw value for unparseable input', () => {
    expect(formatTrustTime('not-a-date')).toBe('not-a-date')
  })
})
