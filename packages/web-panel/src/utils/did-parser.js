/**
 * did-parser.js — Pure parsing helpers for `cc did` CLI output.
 *
 * Each function tolerates both --json (preferred) and human-readable output
 * so the web-panel keeps working if a future CLI version drops a flag.
 */

function tryParseJson(output) {
  if (!output) return null
  const trimmed = output.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (!match) return null
    try { return JSON.parse(match[1]) } catch { return null }
  }
}

function normalizeIdentity(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const did = raw.did || raw.id || ''
  if (!did) return null
  const displayName = raw.displayName ?? raw.display_name ?? raw.name ?? ''
  const isDefault =
    raw.isDefault === true ||
    raw.is_default === 1 ||
    raw.is_default === true ||
    raw.default === true
  const publicKey = raw.publicKey ?? raw.public_key ?? ''
  const createdAt = raw.createdAt ?? raw.created_at ?? raw.created ?? ''
  const method = (did.split(':')[1] || 'chainless').trim()
  return {
    key: did,
    did,
    displayName: displayName || '',
    publicKey: publicKey || '',
    isDefault: !!isDefault,
    createdAt: createdAt || '',
    method,
    raw: raw.document ? raw : null,
    _idx: idx,
  }
}

/**
 * Parse output of `cc did list --json` (preferred) or `cc did list` (fallback).
 * Returns an array of normalized identity objects.
 */
export function parseDidList(output) {
  const parsed = tryParseJson(output)
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeIdentity).filter(Boolean)
  }
  if (parsed && Array.isArray(parsed.identities)) {
    return parsed.identities.map(normalizeIdentity).filter(Boolean)
  }
  return parseDidListText(output || '')
}

/**
 * Plain-text fallback for `cc did list` (no --json).
 * Format example:
 *   DID Identities (2):
 *
 *     did:chainless:abc123 (alice) [default]
 *       created: 2026-04-21 10:00:00
 *     did:chainless:def456
 *       created: 2026-04-22 12:30:00
 */
export function parseDidListText(output) {
  const lines = (output || '').split('\n')
  const out = []
  let current = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('─') || trimmed.startsWith('=')) continue

    const didMatch = trimmed.match(/(did:[a-z0-9]+:[A-Za-z0-9_-]+)/)
    if (didMatch && /^did:/.test(trimmed)) {
      if (current) out.push(current)
      const did = didMatch[1]
      const nameMatch = trimmed.match(/\(([^)]+)\)/)
      const isDefault = /\[default\]|默认|\*/.test(trimmed)
      current = {
        key: did,
        did,
        displayName: nameMatch ? nameMatch[1] : '',
        publicKey: '',
        isDefault,
        createdAt: '',
        method: (did.split(':')[1] || 'chainless').trim(),
        raw: null,
        _idx: out.length,
      }
      continue
    }

    if (current) {
      const created = trimmed.match(/created\s*[:：]\s*(.+)$/i)
      if (created) {
        current.createdAt = created[1].trim()
      }
    }
  }
  if (current) out.push(current)
  return out
}

/**
 * Parse `cc did show <did> --json` output. Returns a single identity object
 * (with .document) or null if the output couldn't be parsed.
 */
export function parseDidShow(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object') return null
  if (Array.isArray(parsed)) return null
  const norm = normalizeIdentity(parsed)
  if (!norm) return null
  norm.document = parsed.document || null
  return norm
}

/**
 * Parse `cc did sign <msg> --json` output. Returns { did, message, signature }
 * or null. Falls back to a regex grep on plain text output for "Signature: <hex>".
 */
export function parseSignResult(output) {
  const parsed = tryParseJson(output)
  if (parsed && typeof parsed === 'object' && parsed.signature) {
    return {
      did: parsed.did || '',
      message: parsed.message || '',
      signature: String(parsed.signature),
    }
  }
  const text = output || ''
  const sigMatch = text.match(/Signature[:：]\s*([a-f0-9]+)/i)
  if (sigMatch) {
    return { did: '', message: '', signature: sigMatch[1] }
  }
  return null
}

/**
 * Parse `cc did export <did>` output (always JSON, no --json flag needed).
 * Returns the exported identity object (public data only) or null.
 */
export function parseDidExport(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object') return null
  if (Array.isArray(parsed)) return null
  return parsed
}
