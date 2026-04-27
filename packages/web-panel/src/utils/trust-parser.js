/**
 * trust-parser.js — Pure parsers for `cc trust ...` CLI output.
 *
 * Trust & Security spans 4 sub-features (Phase 68-71): TPM/TEE/SecureElement
 * attestation, PQC interop testing, satellite messaging, HSM device
 * registration + signing. Like `cc recommend` / `cc codegen`, trust uses
 * `_dbFromCtx` returning undefined silently outside a project — read
 * commands degrade to empty results, mutating commands return
 * `{reason: 'missing_*'}` validation failures.
 *
 * Lib emits sqlite-derived rows in snake_case (`device_fingerprint`,
 * `latency_ms`, `serial_number`, etc.); parser normalizes to camelCase.
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

export const TRUST_ANCHORS = Object.freeze(['tpm', 'tee', 'secure_element'])

export const ATTESTATION_STATUSES = Object.freeze([
  'valid', 'expired', 'failed', 'pending',
])

export const SATELLITE_PROVIDERS = Object.freeze([
  'iridium', 'starlink', 'beidou',
])

export const SAT_MESSAGE_STATUSES = Object.freeze([
  'queued', 'sent', 'confirmed', 'failed',
])

export const HSM_VENDORS = Object.freeze([
  'yubikey', 'ledger', 'trezor', 'generic',
])

export const COMPLIANCE_LEVELS = Object.freeze([
  'fips_140_2', 'fips_140_3', 'cc_eal4',
])

export const HSM_MATURITIES_V2 = Object.freeze([
  'provisional', 'active', 'degraded', 'retired',
])

export const TRANSMISSION_LIFECYCLES_V2 = Object.freeze([
  'queued', 'sending', 'confirmed', 'failed', 'canceled',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Parse a JSON array of strings. */
export function parseStringList(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(s => typeof s === 'string')
}

function normalizeAttestation(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    anchor: String(raw.anchor || '').toLowerCase(),
    status: String(raw.status || 'pending').toLowerCase(),
    challenge: raw.challenge ?? '',
    response: raw.response ?? '',
    deviceFingerprint: raw.device_fingerprint ?? raw.deviceFingerprint ?? '',
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    expiresAt: raw.expires_at ?? raw.expiresAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc trust attestations --json`. */
export function parseAttestations(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeAttestation).filter(Boolean)
}

/** Parse `cc trust attest <anchor> --json` (action result with attestationId). */
export function parseAttestResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, attestationId: null, status: '', response: '', reason: '' }
  }
  return {
    ok: !!parsed.attestationId,
    attestationId: parsed.attestationId ? String(parsed.attestationId) : null,
    status: String(parsed.status || ''),
    response: String(parsed.response || ''),
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

function normalizeInteropTest(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    algorithm: String(raw.algorithm || ''),
    peer: raw.peer ?? '',
    compatible: !!raw.compatible,
    result: String(raw.result || ''),
    latencyMs: num(raw.latency_ms ?? raw.latencyMs, 0),
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc trust interop-tests --json`. */
export function parseInteropTests(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeInteropTest).filter(Boolean)
}

/** Parse `cc trust interop-test <algorithm> --json` action result. */
export function parseInteropTestResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, testId: null, compatible: false, result: '', latencyMs: 0, reason: '' }
  }
  return {
    ok: !!parsed.testId,
    testId: parsed.testId ? String(parsed.testId) : null,
    compatible: !!parsed.compatible,
    result: String(parsed.result || ''),
    latencyMs: num(parsed.latencyMs, 0),
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

function normalizeSatMessage(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    provider: String(raw.provider || '').toLowerCase(),
    priority: num(raw.priority, 5),
    status: String(raw.status || 'queued').toLowerCase(),
    payload: String(raw.payload || ''),
    sentAt: raw.sent_at ?? raw.sentAt ?? null,
    confirmedAt: raw.confirmed_at ?? raw.confirmedAt ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc trust sat-messages --json`. */
export function parseSatMessages(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeSatMessage).filter(Boolean)
}

/** Parse `cc trust sat-show <id> --json`. */
export function parseSatMessage(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeSatMessage(parsed, 0)
}

function normalizeHsmDevice(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    vendor: String(raw.vendor || '').toLowerCase(),
    model: raw.model ?? '',
    serialNumber: raw.serial_number ?? raw.serialNumber ?? '',
    complianceLevel: raw.compliance_level ?? raw.complianceLevel ?? '',
    firmwareVersion: raw.firmware_version ?? raw.firmwareVersion ?? '',
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    _idx: idx,
  }
}

/** Parse `cc trust hsm-devices --json`. */
export function parseHsmDevices(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeHsmDevice).filter(Boolean)
}

/** Parse `cc trust hsm-show <id> --json`. */
export function parseHsmDevice(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeHsmDevice(parsed, 0)
}

/** Parse `cc trust hsm-sign --json` envelope `{signature, algorithm}` or `{reason}`. */
export function parseSignResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, signature: '', algorithm: '', reason: '' }
  }
  return {
    ok: !!parsed.signature,
    signature: parsed.signature ? String(parsed.signature) : '',
    algorithm: String(parsed.algorithm || ''),
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

/**
 * Parse a generic `{deviceId|messageId|...: id, removed?, updated?, reason?}`
 * envelope returned by register/remove/sat-status mutations.
 */
export function parseActionResult(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, id: null, reason: '' }
  }
  const id = parsed.deviceId || parsed.messageId || parsed.attestationId || parsed.testId || null
  const ok = !!(id || parsed.removed || parsed.updated)
  return {
    ok,
    id: id ? String(id) : null,
    reason: parsed.reason ? String(parsed.reason) : '',
  }
}

const STATS_DEFAULTS = {
  attestations: { total: 0, valid: 0, byAnchor: {} },
  interopTests: { total: 0, compatible: 0, avgLatencyMs: 0 },
  satellite: { total: 0, queued: 0, confirmed: 0 },
  hsm: { total: 0, byVendor: {} },
}

/** Parse `cc trust stats --json`. Always returns full pre-keyed shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  for (const a of TRUST_ANCHORS) result.attestations.byAnchor[a] = 0
  for (const v of HSM_VENDORS) result.hsm.byVendor[v] = 0

  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  if (parsed.attestations && typeof parsed.attestations === 'object') {
    result.attestations.total = num(parsed.attestations.total, 0)
    result.attestations.valid = num(parsed.attestations.valid, 0)
    if (parsed.attestations.byAnchor && typeof parsed.attestations.byAnchor === 'object') {
      for (const [k, v] of Object.entries(parsed.attestations.byAnchor)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.attestations.byAnchor[k] = v
      }
    }
  }
  if (parsed.interopTests && typeof parsed.interopTests === 'object') {
    result.interopTests.total = num(parsed.interopTests.total, 0)
    result.interopTests.compatible = num(parsed.interopTests.compatible, 0)
    result.interopTests.avgLatencyMs = num(parsed.interopTests.avgLatencyMs, 0)
  }
  if (parsed.satellite && typeof parsed.satellite === 'object') {
    result.satellite.total = num(parsed.satellite.total, 0)
    result.satellite.queued = num(parsed.satellite.queued, 0)
    result.satellite.confirmed = num(parsed.satellite.confirmed, 0)
  }
  if (parsed.hsm && typeof parsed.hsm === 'object') {
    result.hsm.total = num(parsed.hsm.total, 0)
    if (parsed.hsm.byVendor && typeof parsed.hsm.byVendor === 'object') {
      for (const [k, v] of Object.entries(parsed.hsm.byVendor)) {
        if (typeof v === 'number' && Number.isFinite(v)) result.hsm.byVendor[k] = v
      }
    }
  }
  return result
}

/** Format a numeric ms timestamp; em-dash on null/empty. */
export function formatTrustTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
