/**
 * project-settings-parser.js — Pure parser for `cc config get project`.
 *
 * The CLI dumps an object value as `JSON.stringify(value, null, 2)` and a
 * scalar value as `String(value)`. When the key doesn't exist, the CLI
 * exits non-zero with stderr "Key not found".
 */

export const PROJECT_DEFAULTS = Object.freeze({
  rootPath: '',
  maxSizeMB: 1000,
  autoSync: false,
  syncIntervalSeconds: 300,
})

function tryParseJson(output) {
  if (!output) return null
  const trimmed = output.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!match) return null
    try { return JSON.parse(match[1]) } catch { return null }
  }
}

function coerceBool(v) {
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'on'
}

function coerceNum(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Parse `cc config get project` output (object → JSON, scalar → string,
 * empty/missing → null) into a normalized project-config object with
 * defaults applied.
 *
 * Always returns a complete object; missing fields fall back to
 * PROJECT_DEFAULTS so the form has stable values.
 */
export function parseProjectConfig(output) {
  const result = { ...PROJECT_DEFAULTS }
  if (!output) return result

  const text = output.trim()
  if (!text || /key not found/i.test(text)) return result

  const parsed = tryParseJson(text)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.rootPath !== undefined) result.rootPath = String(parsed.rootPath || '')
    if (parsed.maxSizeMB !== undefined) {
      result.maxSizeMB = coerceNum(parsed.maxSizeMB, PROJECT_DEFAULTS.maxSizeMB)
    }
    if (parsed.autoSync !== undefined) result.autoSync = coerceBool(parsed.autoSync)
    if (parsed.syncIntervalSeconds !== undefined) {
      result.syncIntervalSeconds = coerceNum(parsed.syncIntervalSeconds, PROJECT_DEFAULTS.syncIntervalSeconds)
    }
    return result
  }

  // Scalar fallback for `cc config get project.rootPath` style
  // (only valid when the caller passes a single-field output)
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    const m = trimmed.match(/^(?:project\.)?(rootPath|maxSizeMB|autoSync|syncIntervalSeconds)\s*[=:]\s*(.+)$/i)
    if (!m) continue
    const key = m[1]
    const val = m[2].trim()
    if (key === 'rootPath') result.rootPath = val
    else if (key === 'maxSizeMB') result.maxSizeMB = coerceNum(val, PROJECT_DEFAULTS.maxSizeMB)
    else if (key === 'autoSync') result.autoSync = coerceBool(val)
    else if (key === 'syncIntervalSeconds') {
      result.syncIntervalSeconds = coerceNum(val, PROJECT_DEFAULTS.syncIntervalSeconds)
    }
  }
  return result
}

/**
 * Diff a current form against a baseline snapshot and return only the keys
 * that changed, plus their new value. Used by the view to emit one
 * `cc config set project.<key> <value>` command per changed field.
 */
export function diffProjectConfig(baseline, current) {
  const changes = {}
  for (const key of Object.keys(PROJECT_DEFAULTS)) {
    if (baseline[key] !== current[key]) {
      changes[key] = current[key]
    }
  }
  return changes
}
