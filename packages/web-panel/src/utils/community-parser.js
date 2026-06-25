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

/**
 * 从首个 `{`/`[` 起按括号配对完整地抽取所有 JSON 候选子串（正确跳过字符串字面量
 * 与转义），从左到右排列。比贪婪正则 `/\{[\s\S]*\}/`（首 `{` 到末 `}`）更稳健：当
 * CLI 输出里 JSON 前后残留 `[标签]` 之类括号文本、或一次含多个 JSON 时，贪婪会过度
 * 捕获导致 JSON.parse 失败。
 */
function balancedJsonCandidates(text) {
  const candidates = []
  let i = 0
  while (i < text.length) {
    const rel = text.slice(i).search(/[{[]/)
    if (rel === -1) break
    const start = i + rel
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let j = start; j < text.length; j++) {
      const ch = text[j]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) { end = j; break }
      }
    }
    if (end === -1) break
    candidates.push(text.slice(start, end + 1))
    i = end + 1
  }
  return candidates
}

/**
 * 解析 CLI 输出里的 JSON：先剥离噪声行，直接 `JSON.parse`；失败时按从左到右每个
 * 括号配对完整的候选逐个尝试，最后退回贪婪正则兜底。各 parser 复用这一份实现
 * （此前是 20+ 份逐字节相同的拷贝，且只有贪婪兜底，JSON 前后有括号噪声时会丢数据）。
 */
export function tryParseJson(output) {
  const cleaned = stripCliNoise(output)
  if (!cleaned) return null
  try { return JSON.parse(cleaned) } catch { /* fallthrough */ }
  for (const candidate of balancedJsonCandidates(cleaned)) {
    try { return JSON.parse(candidate) } catch { /* try next candidate */ }
  }
  const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (m) {
    try { return JSON.parse(m[0]) } catch { /* fallthrough */ }
  }
  return null
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
