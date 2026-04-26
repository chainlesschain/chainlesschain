/**
 * community-parser.js — Pure parsers for `cc social ...` CLI output.
 *
 * The web-panel reaches the CLI via the WS `execute` protocol, which spawns
 * the CLI as a subprocess and streams raw stdout+stderr back. The CLI
 * bootstrap prints noise lines like `[AppConfig] Configuration loaded` and
 * `[DatabaseManager] Database initialized: ...` before the actual JSON
 * payload, plus a trailing `[DatabaseManager] Database closed`, so a naive
 * `JSON.parse` of the whole output fails. `stripCliNoise` filters those
 * out so `tryParseJson` can recover the embedded JSON.
 */

const NOISE_PREFIX_RE = /^\[[A-Z][a-zA-Z0-9_]*\]/
const NOISE_ICON_RE = /^[✖✗✓✔ℹ⚠]/  // ✖✗✓✔ℹ⚠

/**
 * Drop CLI bootstrap noise lines so a JSON-only payload survives. Exported
 * so other web-panel parsers can reuse the same heuristic.
 */
export function stripCliNoise(output) {
  if (!output) return ''
  return output
    .split('\n')
    .filter(line => {
      const t = line.trim()
      if (!t) return false
      if (NOISE_PREFIX_RE.test(t)) return false
      if (NOISE_ICON_RE.test(t)) return false
      return true
    })
    .join('\n')
    .trim()
}

function tryParseJson(output) {
  const cleaned = stripCliNoise(output)
  if (!cleaned) return null
  try { return JSON.parse(cleaned) } catch { /* fallthrough */ }
  const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export const STATS_DEFAULTS = Object.freeze({
  contacts: 0,
  friends: 0,
  posts: 0,
  messages: 0,
  pendingRequests: 0,
})

/**
 * Parse `cc social stats --json` output. Always returns a complete stats
 * object; missing fields fall back to STATS_DEFAULTS so the UI cards have
 * stable values.
 */
export function parseSocialStats(output) {
  const result = { ...STATS_DEFAULTS }
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
  for (const key of Object.keys(STATS_DEFAULTS)) {
    const v = parsed[key]
    if (typeof v === 'number' && Number.isFinite(v)) result[key] = v
  }
  // Snake-case fallback for older CLI versions
  if (typeof parsed.pending_requests === 'number') {
    result.pendingRequests = parsed.pending_requests
  }
  return result
}

function normalizeContact(raw, idx) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || raw.contactId || raw.contact_id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || ''),
    did: raw.did || '',
    email: raw.email || '',
    notes: raw.notes || '',
    createdAt: raw.createdAt || raw.created_at || '',
    _idx: idx,
  }
}

/**
 * Parse `cc social contact list --json`. Returns an array of contacts;
 * empty array on parse failure or empty payload.
 */
export function parseContacts(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeContact).filter(Boolean)
}

function normalizeFriend(raw, idx) {
  if (!raw || typeof raw !== 'object') return null
  const contactId = raw.contactId || raw.contact_id || raw.id || ''
  if (!contactId) return null
  return {
    key: raw.id || contactId,
    id: raw.id || contactId,
    contactId,
    status: String(raw.status || 'pending'),
    createdAt: raw.createdAt || raw.created_at || '',
    _idx: idx,
  }
}

/**
 * Parse `cc social friend list --json` or `cc social friend pending --json`.
 */
export function parseFriends(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeFriend).filter(Boolean)
}

function normalizePost(raw, idx) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    author: String(raw.author || 'unknown'),
    content: String(raw.content || ''),
    likes: typeof raw.likes === 'number' ? raw.likes : 0,
    createdAt: raw.createdAt || raw.created_at || '',
    _idx: idx,
  }
}

/**
 * Parse `cc social post list --json`.
 */
export function parsePosts(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizePost).filter(Boolean)
}

/**
 * Parse `cc social post publish <content> --json` (returns a post) or
 * `cc social contact add <name> --json` (returns a contact).
 * Returns the normalized object or null.
 */
export function parsePublishedPost(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizePost(parsed, 0)
}

export function parseAddedContact(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return normalizeContact(parsed, 0)
}
