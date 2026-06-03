/**
 * parsers.js — Pure parsing utility functions for ChainlessChain Web Panel.
 *
 * All functions are pure (no side-effects, no Vue/Pinia dependencies) so they
 * can be tested directly with Vitest without a DOM environment.
 */

// ─── Skills ───────────────────────────────────────────────────────────────────

/**
 * Parse `chainlesschain skill list` text output into skill objects.
 * Actual format:
 *   ai (4)
 *     ● auto-context   Maximum token budget [bundled]
 */
export function parseSkillOutput(output) {
  const lines = output.split('\n')
  const skills = []
  let currentCategory = 'built-in'

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('=')) continue

    // Category header: "ai (4)", "cli-direct (8)", "automation (9)"
    const catMatch = trimmed.match(/^([a-z][a-z0-9-]+)\s+\(\d+\)$/)
    if (catMatch) {
      currentCategory = catMatch[1]
      continue
    }

    // Skill entry: "● skill-name   description [bundled]"
    const bulletMatch = trimmed.match(/^[●•]\s+([a-z][a-z0-9-]+)\s+(.+)$/)
    if (bulletMatch) {
      let description = bulletMatch[2].trim()
      const layerMatch = description.match(/\s+\[(bundled|project|managed|workspace|marketplace)\]$/)
      if (layerMatch) description = description.slice(0, -layerMatch[0].length).trim()

      const executionMode = currentCategory.includes('agent') ? 'agent'
        : currentCategory.includes('llm') ? 'llm-query'
        : currentCategory === 'cli-direct' ? 'cli-direct'
        : currentCategory.includes('cli') ? 'cli-direct'
        : 'built-in'

      skills.push({ name: bulletMatch[1], description, category: currentCategory, executionMode })
      continue
    }

    // Legacy fallback: "name - description" or "name  description"
    const legacyMatch = trimmed.match(/^([a-z][a-z0-9-]+)\s+[-–]\s+(.+)/)
      || trimmed.match(/^([a-z][a-z0-9-]+)\s{2,}(.+)/)
    if (legacyMatch) {
      skills.push({
        name: legacyMatch[1],
        description: legacyMatch[2],
        category: currentCategory,
        executionMode: currentCategory.includes('agent') ? 'agent'
          : currentCategory.includes('llm') ? 'llm-query'
          : currentCategory.includes('cli') ? 'cli-direct'
          : 'built-in',
      })
    }
  }

  return skills
}

// ─── Providers ────────────────────────────────────────────────────────────────

// Names match the CLI's llm-providers.js keys exactly
export const KNOWN_PROVIDERS = [
  { name: 'anthropic',  label: 'Anthropic (Claude)',    icon: '🤖' },
  { name: 'openai',     label: 'OpenAI (GPT)',           icon: '🧠' },
  { name: 'ollama',     label: 'Ollama (本地)',           icon: '🦙' },
  { name: 'deepseek',   label: 'DeepSeek',               icon: '🔍' },
  { name: 'gemini',     label: 'Google Gemini',          icon: '✨' },
  { name: 'volcengine', label: '火山引擎 (豆包)',          icon: '🌋' },
  { name: 'dashscope',  label: '通义千问 (DashScope)',    icon: '🌊' },
  { name: 'kimi',       label: 'Kimi (月之暗面)',         icon: '🌙' },
  { name: 'minimax',    label: 'MiniMax (海螺AI)',        icon: '🐚' },
  { name: 'mistral',    label: 'Mistral AI',             icon: '💨' },
]

/**
 * Parse `chainlesschain llm providers` text output into provider objects.
 */
export function parseProviders(output) {
  const result = []
  for (const p of KNOWN_PROVIDERS) {
    result.push({
      ...p,
      configured: output.toLowerCase().includes(p.name),
      active: output.match(new RegExp(`\\*\\s*${p.name}`, 'i')) !== null,
      status: 'unknown',
    })
  }

  // Mark active via "active: providerName" fallback
  if (!result.find(p => p.active)) {
    const activeMatch = output.match(/active[:\s]+(\w+)/i)
    if (activeMatch) {
      const p = result.find(r => r.name === activeMatch[1].toLowerCase())
      if (p) p.active = true
    }
  }

  return result
}

/**
 * Parse `chainlesschain llm models` text output into model objects.
 */
export function parseModels(output) {
  return output.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('─') && l.includes(':'))
    .map(l => ({ name: l, size: '' }))
    .slice(0, 20)
}

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Parse `chainlesschain status` output into a structured status object.
 * Returns: { appRunning, setupDone, setupDate, edition, activeLlm, activeModel,
 *            dockerStatus, ports }
 */
export function parseStatus(output) {
  const status = {
    appRunning: false,
    setupDone: false,
    setupDate: '',
    edition: '',
    activeLlm: '',
    activeModel: '',
    dockerStatus: '',
    ports: [],
  }

  status.appRunning = /desktop app running/i.test(output)
  status.setupDone = output.includes('Setup completed')

  const dateMatch = output.match(/Setup completed \(([^)]+)\)/i)
  if (dateMatch) {
    try { status.setupDate = new Date(dateMatch[1]).toLocaleDateString('zh-CN') } catch { /* ignore */ }
  }

  const edMatch = output.match(/Edition:\s+(\S+)/i)
  if (edMatch) status.edition = edMatch[1]

  const llmMatch = output.match(/LLM:\s+(\S+)\s+\(([^)]+)\)/i)
  if (llmMatch) {
    status.activeLlm = llmMatch[1]
    status.activeModel = llmMatch[2]
  } else {
    const l2 = output.match(/LLM:\s+(\S+)/i)
    if (l2) status.activeLlm = l2[1]
  }

  if (output.includes('docker-compose.yml not found')) {
    status.dockerStatus = '未找到 docker-compose.yml'
  } else if (output.includes('Docker Services')) {
    status.dockerStatus = '已检测到 Docker 配置'
  }

  const portLines = output.split('\n').filter(l => l.match(/[○●]\s+\w+:\s+\d+/))
  status.ports = portLines.map(l => {
    const m = l.match(/([○●])\s+(\w+):\s+(\d+)/)
    if (!m) return null
    return { key: m[2], name: m[2], port: parseInt(m[3]), active: m[1] === '●' }
  }).filter(Boolean)

  return status
}

// ─── Notes ────────────────────────────────────────────────────────────────────

/**
 * Parse `chainlesschain note list` text output into note objects.
 */
export function parseNoteList(output) {
  const result = []
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || /^\d+ note/i.test(trimmed) || trimmed.startsWith('Note')) continue

    // Format: "1. Title [tag1,tag2] - preview text"
    const m = trimmed.match(/^(\d+)\.\s+(.+?)(?:\s+\[([^\]]+)\])?\s*(?:-\s*(.*))?$/)
    if (m) {
      result.push({
        key: m[1],
        id: m[1],
        title: m[2].trim(),
        tags: m[3] ? m[3].split(',').map(t => t.trim()) : [],
        preview: (m[4] || '').trim().slice(0, 100),
        content: '',
      })
    } else if (trimmed.length > 2 && !trimmed.startsWith('✖') && !trimmed.startsWith('[')) {
      result.push({
        key: String(result.length),
        id: String(result.length),
        title: trimmed,
        tags: [],
        preview: '',
        content: '',
      })
    }
  }
  return result
}

// ─── MCP Tools ────────────────────────────────────────────────────────────────

/**
 * Parse `chainlesschain mcp servers` output into server objects.
 */
// Field names that must not be treated as server names
const MCP_FIELD_NAMES = new Set(['command', 'args', 'description', 'type', 'url', 'env'])

export function parseMcpServers(output) {
  const result = []
  let current = null
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || /^mcp/i.test(trimmed)) continue

    // Check known field patterns first (before nameMatch to avoid mis-classification)
    if (/^command:/i.test(trimmed) && current) {
      current.command = trimmed.replace(/^command:\s*/i, '').trim(); continue
    }
    if (/^args:/i.test(trimmed) && current) {
      current.args = trimmed.replace(/^args:\s*/i, '').split(',').map(a => a.trim()); continue
    }

    const nameMatch = trimmed.match(/^[●•]?\s*([a-z][a-z0-9-_]+)\s*$/i)
      || trimmed.match(/^([a-z][a-z0-9-_]+)\s*[:：]/)
    const candidateName = nameMatch?.[1]?.toLowerCase()
    if (nameMatch && !MCP_FIELD_NAMES.has(candidateName)) {
      if (current) result.push(current)
      current = { key: nameMatch[1], name: nameMatch[1], command: '', args: [], description: '' }
    } else if (current && !current.description) {
      current.description = trimmed.slice(0, 80)
    }
  }
  if (current) result.push(current)
  return result
}

/**
 * Parse `chainlesschain mcp tools` output into tool objects.
 */
export function parseMcpTools(output) {
  const result = []
  let currentServer = 'unknown'
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─')) continue

    if (trimmed.match(/^\[/) || /^Server:/i.test(trimmed)) {
      currentServer = trimmed.replace(/[\[\]]/g, '').replace(/^Server:\s*/i, '').trim()
      continue
    }

    const m = trimmed.match(/^[●•]?\s*([a-z][a-z0-9_-]+)\s*[-–]\s*(.+)/i)
      || trimmed.match(/^[●•]?\s*([a-z][a-z0-9_-]+)$/)
    if (m) {
      result.push({ key: result.length, name: m[1], description: m[2] || '', server: currentServer })
    }
  }
  return result
}

// ─── Memory ───────────────────────────────────────────────────────────────────

/**
 * Parse `chainlesschain hmemory stats` output into stats object.
 */
export function parseMemoryStats(output) {
  const stats = { shortTerm: 0, longTerm: 0, core: 0 }
  const short = output.match(/short.?term[^\d]*(\d+)/i)
  const long = output.match(/long.?term[^\d]*(\d+)/i)
  const core = output.match(/core[^\d]*(\d+)/i)
  if (short) stats.shortTerm = parseInt(short[1])
  if (long) stats.longTerm = parseInt(long[1])
  if (core) stats.core = parseInt(core[1])
  return stats
}

/**
 * Parse `chainlesschain hmemory recall` output into memory item objects.
 */
export function parseMemories(output, layer = 'short-term') {
  const result = []
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || /^recall/i.test(trimmed)) continue

    const m = trimmed.match(/^[-●•\d.]+\s+(.+)/)
    const text = m ? m[1].trim() : trimmed
    if (text.length > 5 && result.length < 20) {
      result.push({ id: result.length, content: text, layer, importance: '', time: '' })
    }
  }
  return result
}

// ─── Cron ─────────────────────────────────────────────────────────────────────

/**
 * Parse cron-scheduler skill output into task objects.
 */
export function parseCronTasks(output) {
  const result = []
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─')) continue

    const m = trimmed.match(/^([^\t|]+?)[\t|]+([*\d/,\-?LW#\s]+)[\t|]+/)
    if (m) {
      result.push({
        key: result.length,
        name: m[1].trim(),
        cron: m[2].trim(),
        enabled: !/pause|disabled/i.test(trimmed),
        description: '',
        running: false,
      })
    }
  }
  return result
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

/**
 * Classify a log line into a CSS class name.
 */
export function classifyLogLine(line) {
  if (/[✖✗]|error|Error|failed/i.test(line)) return 'line-error'
  if (/[✔✓]|success|running/i.test(line)) return 'line-success'
  if (/warn|Warn|○/.test(line)) return 'line-warn'
  if (/^\s/.test(line)) return 'line-indent'
  return ''
}

// ─── LLM Config (Providers.vue) ──────────────────────────────────────────────

/**
 * Parse `cc config list` output into the LLM section's parameter values.
 *
 * `cc config list` emits an indented section format:
 *   llm:
 *     provider: volcengine
 *     apiKey: ****               ← masked, filtered out below
 *     baseUrl: https://...
 *   enterprise:
 *     apiKey: null               ← belongs to a different section, MUST NOT leak
 *
 * The parser is section-aware: keys under `llm:` are captured, keys under any
 * other section are ignored. The `llm.<key> = value` flat form is also
 * honoured regardless of section context.
 *
 * Also accepts JSON: either `{llm:{…}}` or a flat object.
 *
 * @param {string|null|undefined} output
 * @returns {{provider?:string, model?:string, apiKey?:string, baseUrl?:string, temperature?:number, maxTokens?:number}}
 */
export function parseLlmConfigOutput(output) {
  const result = {}
  if (!output) return result

  // Try JSON parse first
  try {
    const json = JSON.parse(output.trim())
    const llm = json.llm || json
    if (llm.provider) result.provider = llm.provider
    if (llm.model) result.model = llm.model
    if (llm.apiKey) result.apiKey = llm.apiKey
    if (llm.baseUrl) result.baseUrl = llm.baseUrl
    if (llm.temperature !== undefined) result.temperature = Number(llm.temperature)
    if (llm.maxTokens !== undefined) result.maxTokens = Number(llm.maxTokens)
    return result
  } catch (_) {
    // Not JSON, parse line-by-line
  }

  const assign = (key, val) => {
    const value = val.trim()
    const keyLower = key.toLowerCase()
    if (keyLower === 'provider' && value) {
      result.provider = value
    } else if (keyLower === 'model' && value) {
      result.model = value
    } else if (keyLower === 'apikey' && value) {
      // Don't overwrite with masked values
      if (!value.includes('***')) {
        result.apiKey = value
      }
    } else if (keyLower === 'baseurl') {
      result.baseUrl = value
    } else if (keyLower === 'temperature') {
      const num = parseFloat(value)
      if (!isNaN(num)) result.temperature = num
    } else if (keyLower === 'maxtokens') {
      const num = parseInt(value, 10)
      if (!isNaN(num)) result.maxTokens = num
    }
  }

  let currentSection = null
  const lines = output.split('\n')
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue
    const trimmed = rawLine.trim()

    // Flat-key form: "llm.<key> = value" / "llm.<key>: value"
    const flatMatch = trimmed.match(/^llm\.(\w+)\s*[=:]\s*(.+)$/i)
    if (flatMatch) {
      assign(flatMatch[1], flatMatch[2])
      continue
    }

    // Section header: "<name>:" with no value
    const sectionMatch = trimmed.match(/^([a-zA-Z][\w-]*)\s*:\s*$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase()
      continue
    }

    // Indented "key: value" — only honoured inside the `llm:` block
    if (currentSection !== 'llm') continue
    const kvMatch = trimmed.match(/^(\w+)\s*[=:]\s*(.+)$/)
    if (!kvMatch) continue
    assign(kvMatch[1], kvMatch[2])
  }

  return result
}
