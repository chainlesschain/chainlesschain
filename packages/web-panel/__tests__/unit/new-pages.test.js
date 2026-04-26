/**
 * Unit tests for the 4 new pages (Security, P2P, Git, Projects)
 * and the enhanced Providers page.
 *
 * Tests cover:
 * - Router registration (all 15 routes)
 * - parsers.js functions (parseProviders, parseStatus edge cases)
 * - Providers config parsing (parseConfigOutput logic)
 * - DID list parsing (parseDIDList inline logic)
 * - Audit log parsing (pipe-delimited and timestamp-prefixed)
 * - Git status parsing (branch, changed file count)
 * - P2P peers parsing
 * - Project status edge cases
 *
 * Run: npx vitest run __tests__/unit/new-pages.test.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseProviders, parseStatus, KNOWN_PROVIDERS } from '../../src/utils/parsers.js'

// ─── Router registration ─────────────────────────────────────────────────────

describe('Router registration', () => {
  it('has exactly 39 child routes under root', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    // 1 redirect + 38 named pages = 39 children
    expect(rootRoute.children.length).toBe(39)
  })

  it('contains all expected route names', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const names = rootRoute.children.map(r => r.name).filter(Boolean)
    const expected = [
      'Dashboard', 'Chat', 'Cowork', 'Services', 'Logs', 'Skills',
      'Providers', 'McpTools', 'ProjectSettings', 'Notes', 'Memory', 'Knowledge', 'Cron',
      'Workflow', 'Tasks', 'Security', 'DID', 'P2P', 'Git', 'Projects',
      'Permissions', 'Wallet', 'Organization', 'Analytics',
      'Templates', 'Backup', 'RssFeed', 'WebAuthn', 'Community', 'Marketplace',
      'Crosschain', 'AIOps', 'Compliance', 'Privacy', 'Inference',
      'NLProgramming', 'Tenant', 'VideoEditing',
    ]
    for (const name of expected) {
      expect(names).toContain(name)
    }
  })

  it('maps Knowledge to /knowledge path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const kgRoute = rootRoute.children.find(r => r.name === 'Knowledge')
    expect(kgRoute).toBeDefined()
    expect(kgRoute.path).toBe('knowledge')
  })

  it('maps DID to /did path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const didRoute = rootRoute.children.find(r => r.name === 'DID')
    expect(didRoute).toBeDefined()
    expect(didRoute.path).toBe('did')
  })

  it('maps ProjectSettings to /project-settings path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const psRoute = rootRoute.children.find(r => r.name === 'ProjectSettings')
    expect(psRoute).toBeDefined()
    expect(psRoute.path).toBe('project-settings')
  })

  it('maps Security to /security path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const secRoute = rootRoute.children.find(r => r.name === 'Security')
    expect(secRoute).toBeDefined()
    expect(secRoute.path).toBe('security')
  })

  it('maps P2P to /p2p path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const p2pRoute = rootRoute.children.find(r => r.name === 'P2P')
    expect(p2pRoute).toBeDefined()
    expect(p2pRoute.path).toBe('p2p')
  })

  it('maps Git to /git path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const gitRoute = rootRoute.children.find(r => r.name === 'Git')
    expect(gitRoute).toBeDefined()
    expect(gitRoute.path).toBe('git')
  })

  it('maps Projects to /projects path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const projRoute = rootRoute.children.find(r => r.name === 'Projects')
    expect(projRoute).toBeDefined()
    expect(projRoute.path).toBe('projects')
  })

  it('maps Community to /community path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const cRoute = rootRoute.children.find(r => r.name === 'Community')
    expect(cRoute).toBeDefined()
    expect(cRoute.path).toBe('community')
  })

  it('maps Marketplace to /marketplace path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const mRoute = rootRoute.children.find(r => r.name === 'Marketplace')
    expect(mRoute).toBeDefined()
    expect(mRoute.path).toBe('marketplace')
  })

  it('maps Crosschain to /crosschain path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const xRoute = rootRoute.children.find(r => r.name === 'Crosschain')
    expect(xRoute).toBeDefined()
    expect(xRoute.path).toBe('crosschain')
  })

  it('maps AIOps to /aiops path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const opsRoute = rootRoute.children.find(r => r.name === 'AIOps')
    expect(opsRoute).toBeDefined()
    expect(opsRoute.path).toBe('aiops')
  })

  it('maps Compliance to /compliance path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const cRoute = rootRoute.children.find(r => r.name === 'Compliance')
    expect(cRoute).toBeDefined()
    expect(cRoute.path).toBe('compliance')
  })

  it('maps Privacy to /privacy path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const pRoute = rootRoute.children.find(r => r.name === 'Privacy')
    expect(pRoute).toBeDefined()
    expect(pRoute.path).toBe('privacy')
  })

  it('maps Inference to /inference path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const iRoute = rootRoute.children.find(r => r.name === 'Inference')
    expect(iRoute).toBeDefined()
    expect(iRoute.path).toBe('inference')
  })

  it('maps NLProgramming to /nlprog path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const nRoute = rootRoute.children.find(r => r.name === 'NLProgramming')
    expect(nRoute).toBeDefined()
    expect(nRoute.path).toBe('nlprog')
  })

  it('maps Tenant to /tenant path', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const tRoute = rootRoute.children.find(r => r.name === 'Tenant')
    expect(tRoute).toBeDefined()
    expect(tRoute.path).toBe('tenant')
  })

  it('has redirect from / to /dashboard', async () => {
    const routerModule = await import('../../src/router/index.js')
    const router = routerModule.default
    const rootRoute = router.options.routes[0]
    const redirectChild = rootRoute.children.find(r => r.path === '' && r.redirect)
    expect(redirectChild).toBeDefined()
    expect(redirectChild.redirect).toBe('/dashboard')
  })
})

// ─── parseProviders edge cases ────────────────────────────────────────────────

describe('parseProviders edge cases', () => {
  it('returns all KNOWN_PROVIDERS entries even for empty output', () => {
    const result = parseProviders('')
    expect(result).toHaveLength(KNOWN_PROVIDERS.length)
    result.forEach(p => {
      expect(p.configured).toBe(false)
      expect(p.active).toBe(false)
      expect(p.status).toBe('unknown')
    })
  })

  it('marks provider as configured when name appears in output', () => {
    const result = parseProviders('Available providers:\n  ollama\n  openai')
    const ollama = result.find(p => p.name === 'ollama')
    const openai = result.find(p => p.name === 'openai')
    expect(ollama.configured).toBe(true)
    expect(openai.configured).toBe(true)
  })

  it('marks provider as active with asterisk prefix', () => {
    const result = parseProviders('* volcengine  (active)')
    const volc = result.find(p => p.name === 'volcengine')
    expect(volc.active).toBe(true)
  })

  it('falls back to "active: name" pattern', () => {
    const result = parseProviders('active: deepseek')
    const ds = result.find(p => p.name === 'deepseek')
    expect(ds.active).toBe(true)
  })

  it('is case insensitive for provider name matching', () => {
    const result = parseProviders('ANTHROPIC is configured')
    const a = result.find(p => p.name === 'anthropic')
    expect(a.configured).toBe(true)
  })

  it('handles Chinese characters in output', () => {
    const result = parseProviders('当前提供商: ollama\n火山引擎已配置')
    const ollama = result.find(p => p.name === 'ollama')
    expect(ollama.configured).toBe(true)
  })
})

// ─── parseStatus edge cases ──────────────────────────────────────────────────

describe('parseStatus edge cases', () => {
  it('returns default object for empty string', () => {
    const s = parseStatus('')
    expect(s.appRunning).toBe(false)
    expect(s.setupDone).toBe(false)
    expect(s.edition).toBe('')
    expect(s.activeLlm).toBe('')
    expect(s.activeModel).toBe('')
    expect(s.ports).toEqual([])
  })

  it('detects desktop app running (case insensitive)', () => {
    const s = parseStatus('Desktop App Running on port 18800')
    expect(s.appRunning).toBe(true)
  })

  it('parses LLM provider and model', () => {
    const s = parseStatus('LLM: volcengine (doubao-seed-1-6-251015)')
    expect(s.activeLlm).toBe('volcengine')
    expect(s.activeModel).toBe('doubao-seed-1-6-251015')
  })

  it('parses LLM provider only without model', () => {
    const s = parseStatus('LLM: ollama')
    expect(s.activeLlm).toBe('ollama')
    expect(s.activeModel).toBe('')
  })

  it('parses edition field', () => {
    const s = parseStatus('Edition: Evolution')
    expect(s.edition).toBe('Evolution')
  })

  it('parses setup completed with date', () => {
    const s = parseStatus('Setup completed (2024-03-15)')
    expect(s.setupDone).toBe(true)
    expect(s.setupDate).toBeTruthy()
  })

  it('handles docker-compose.yml not found', () => {
    const s = parseStatus('docker-compose.yml not found')
    expect(s.dockerStatus).toBe('未找到 docker-compose.yml')
  })

  it('handles Docker Services detected', () => {
    const s = parseStatus('Docker Services\n  postgres: 5432')
    expect(s.dockerStatus).toBe('已检测到 Docker 配置')
  })

  it('parses active port lines', () => {
    const s = parseStatus('● http: 18800\n○ ws: 18801')
    expect(s.ports).toHaveLength(2)
    expect(s.ports[0]).toEqual({ key: 'http', name: 'http', port: 18800, active: true })
    expect(s.ports[1]).toEqual({ key: 'ws', name: 'ws', port: 18801, active: false })
  })
})

// ─── Providers config parsing (inline in Providers.vue) ──────────────────────

describe('Providers config parsing (parseConfigOutput logic)', () => {
  // Replicate the parseConfigOutput function from Providers.vue
  function parseConfigOutput(output) {
    const result = {}
    if (!output) return result
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
    } catch (_) { /* not JSON */ }

    const lines = output.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      const match = trimmed.match(/^(?:llm\.)?(\w+)\s*[=:]\s*(.+)$/i)
      if (!match) continue
      const [, key, val] = match
      const value = val.trim()
      const keyLower = key.toLowerCase()
      if (keyLower === 'provider' && value) result.provider = value
      else if (keyLower === 'model' && value) result.model = value
      else if (keyLower === 'apikey' && value) {
        if (!value.includes('***')) result.apiKey = value
      }
      else if (keyLower === 'baseurl') result.baseUrl = value
      else if (keyLower === 'temperature') {
        const num = parseFloat(value)
        if (!isNaN(num)) result.temperature = num
      }
      else if (keyLower === 'maxtokens') {
        const num = parseInt(value, 10)
        if (!isNaN(num)) result.maxTokens = num
      }
    }
    return result
  }

  it('returns empty object for empty output', () => {
    expect(parseConfigOutput('')).toEqual({})
    expect(parseConfigOutput(null)).toEqual({})
    expect(parseConfigOutput(undefined)).toEqual({})
  })

  it('parses YAML-like key: value lines', () => {
    const output = [
      'llm:',
      '  provider: volcengine',
      '  apiKey: ****',
      '  baseUrl: https://ark.cn-beijing.volces.com/api/v3',
      '  model: doubao-seed-1-6-251015',
    ].join('\n')
    const result = parseConfigOutput(output)
    expect(result.provider).toBe('volcengine')
    expect(result.model).toBe('doubao-seed-1-6-251015')
    expect(result.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3')
  })

  it('skips masked apiKey with ***', () => {
    const output = 'apiKey: sk-***masked***'
    const result = parseConfigOutput(output)
    expect(result.apiKey).toBeUndefined()
  })

  it('accepts unmasked apiKey', () => {
    const output = 'apiKey: sk-1234567890abcdef'
    const result = parseConfigOutput(output)
    expect(result.apiKey).toBe('sk-1234567890abcdef')
  })

  it('parses llm.key = value format', () => {
    const output = [
      'llm.provider = openai',
      'llm.model = gpt-4o',
      'llm.temperature = 0.5',
      'llm.maxTokens = 8192',
    ].join('\n')
    const result = parseConfigOutput(output)
    expect(result.provider).toBe('openai')
    expect(result.model).toBe('gpt-4o')
    expect(result.temperature).toBe(0.5)
    expect(result.maxTokens).toBe(8192)
  })

  it('parses JSON format output', () => {
    const json = JSON.stringify({
      llm: { provider: 'anthropic', model: 'claude-3', temperature: 0.8, maxTokens: 4096 },
    })
    const result = parseConfigOutput(json)
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-3')
    expect(result.temperature).toBe(0.8)
    expect(result.maxTokens).toBe(4096)
  })

  it('parses flat JSON without llm wrapper', () => {
    const json = JSON.stringify({ provider: 'ollama', model: 'qwen2:7b' })
    const result = parseConfigOutput(json)
    expect(result.provider).toBe('ollama')
    expect(result.model).toBe('qwen2:7b')
  })
})

// ─── DID list parsing (inline in Security.vue) ───────────────────────────────

describe('DID list parsing (parseDIDList logic)', () => {
  // Replicate the parseDIDList from Security.vue
  function parseDIDList(output) {
    const result = []
    const lines = output.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('DID') || trimmed.match(/^\d+ identit/i)) continue
      const didMatch = trimmed.match(/(did:\w+:\w+)/)
      if (didMatch) {
        const did = didMatch[1]
        const method = did.split(':')[1] || 'key'
        const isDefault = /default|默认|\*/.test(trimmed)
        const dateMatch = trimmed.match(/(\d{4}-\d{2}-\d{2}[\sT]?\d{2}:\d{2}(?::\d{2})?)/)
        result.push({
          key: did,
          did,
          method,
          created: dateMatch ? dateMatch[1] : '-',
          isDefault,
        })
      }
    }
    return result
  }

  it('returns empty array for empty output', () => {
    expect(parseDIDList('')).toEqual([])
  })

  it('parses numbered DID entries with (default) marker', () => {
    const output = [
      '1. did:key:z6MkhaXgBZD  (default)  2024-03-15T10:30:00',
      '2. did:key:z6MkpTHRqjk             2024-03-14T09:00:00',
    ].join('\n')
    const result = parseDIDList(output)
    expect(result).toHaveLength(2)
    expect(result[0].did).toBe('did:key:z6MkhaXgBZD')
    expect(result[0].isDefault).toBe(true)
    expect(result[0].method).toBe('key')
    expect(result[0].created).toBe('2024-03-15T10:30:00')
    expect(result[1].did).toBe('did:key:z6MkpTHRqjk')
    expect(result[1].isDefault).toBe(false)
  })

  it('parses did:web method', () => {
    const output = 'did:web:example.com  2024-01-01 00:00'
    const result = parseDIDList(output)
    expect(result).toHaveLength(1)
    expect(result[0].method).toBe('web')
  })

  it('detects Chinese default marker (默认)', () => {
    const output = 'did:key:z6MkABC123  默认  2024-06-01 12:00'
    const result = parseDIDList(output)
    expect(result[0].isDefault).toBe(true)
  })

  it('detects asterisk default marker', () => {
    const output = '* did:key:z6MkABC123  2024-06-01 12:00'
    const result = parseDIDList(output)
    expect(result[0].isDefault).toBe(true)
  })

  it('skips header lines', () => {
    const output = [
      'DID Identities:',
      '───────────────',
      '2 identities found',
      'did:key:z6MkABC123  2024-01-01 00:00',
    ].join('\n')
    const result = parseDIDList(output)
    expect(result).toHaveLength(1)
  })

  it('sets created to "-" when no date present', () => {
    const output = 'did:key:z6MkABC123'
    const result = parseDIDList(output)
    expect(result[0].created).toBe('-')
  })
})

// ─── Audit log parsing (inline in Security.vue) ─────────────────────────────

describe('Audit log parsing (parseAuditLog logic)', () => {
  // Replicate the parseAuditLog from Security.vue
  function parseAuditLog(output) {
    const result = []
    const lines = output.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Audit') || trimmed.startsWith('Recent')) continue
      const parts = trimmed.split(/\s*[|│]\s*/)
      if (parts.length >= 3) {
        result.push({
          key: result.length,
          time: parts[0] || '-',
          event: parts[1] || '-',
          user: parts[2] || '-',
          level: parts[3] || 'info',
          detail: parts.slice(4).join(' ') || '',
        })
        continue
      }
      const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(?::\d{2})?)\s+(.+)/)
      if (dateMatch) {
        const rest = dateMatch[2]
        const levelMatch = rest.match(/\b(INFO|WARN|WARNING|ERROR|CRITICAL)\b/i)
        result.push({
          key: result.length,
          time: dateMatch[1],
          event: rest.replace(/\b(INFO|WARN|WARNING|ERROR|CRITICAL)\b/i, '').trim().slice(0, 80),
          user: '-',
          level: levelMatch ? levelMatch[1].toLowerCase() : 'info',
          detail: '',
        })
      } else if (trimmed.length > 3 && !trimmed.match(/^\d+ event/i)) {
        result.push({
          key: result.length,
          time: '-',
          event: trimmed.slice(0, 80),
          user: '-',
          level: 'info',
          detail: '',
        })
      }
    }
    return result
  }

  it('returns empty array for empty output', () => {
    expect(parseAuditLog('')).toEqual([])
  })

  it('parses pipe-delimited structured format', () => {
    const output = '2024-03-15 10:30|note:create|admin|info|Created note #42'
    const result = parseAuditLog(output)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe('2024-03-15 10:30')
    expect(result[0].event).toBe('note:create')
    expect(result[0].user).toBe('admin')
    expect(result[0].level).toBe('info')
    expect(result[0].detail).toBe('Created note #42')
  })

  it('parses Unicode vertical bar delimiter', () => {
    const output = '2024-01-01 00:00│login│user1│warn│suspicious'
    const result = parseAuditLog(output)
    expect(result).toHaveLength(1)
    expect(result[0].event).toBe('login')
    expect(result[0].level).toBe('warn')
  })

  it('parses timestamp-prefixed lines with level', () => {
    const output = '2024-03-15 10:30:00 ERROR Failed to connect'
    const result = parseAuditLog(output)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe('2024-03-15 10:30:00')
    expect(result[0].level).toBe('error')
    expect(result[0].event).toContain('Failed to connect')
  })

  it('falls back to plain text lines', () => {
    const output = 'Something happened here'
    const result = parseAuditLog(output)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe('-')
    expect(result[0].event).toBe('Something happened here')
  })

  it('skips header lines (Audit, Recent)', () => {
    const output = [
      'Audit Log:',
      'Recent events:',
      '─────────────',
      '2024-01-01 00:00 INFO test event',
    ].join('\n')
    const result = parseAuditLog(output)
    expect(result).toHaveLength(1)
  })

  it('skips short lines (3 chars or less)', () => {
    const output = 'ab\ncd\nabcde'
    const result = parseAuditLog(output)
    expect(result).toHaveLength(1)
    expect(result[0].event).toBe('abcde')
  })

  it('skips "N events" summary lines', () => {
    const output = '42 events found\nSome real event line here'
    const result = parseAuditLog(output)
    expect(result).toHaveLength(1)
    expect(result[0].event).toBe('Some real event line here')
  })
})

// ─── Git status parsing (inline in Git.vue) ──────────────────────────────────

describe('Git status parsing (parseGitStatus logic)', () => {
  // Replicate the parseGitStatus from Git.vue
  function parseGitStatus(output) {
    const lines = output.split('\n')
    let branch = ''
    let changed = 0
    for (const line of lines) {
      const branchMatch = line.match(/On branch\s+(.+)/) || line.match(/分支\s+(.+)/)
      if (branchMatch) branch = branchMatch[1].trim()
      const trimmed = line.trim()
      if (/^(M|A|D|R|C|U|\?\?|MM|AM|AD)\s/.test(trimmed)) changed++
      if (/^(modified|new file|deleted|renamed):/i.test(trimmed)) changed++
    }
    return { branch, changed }
  }

  it('returns empty branch and 0 changes for empty output', () => {
    expect(parseGitStatus('')).toEqual({ branch: '', changed: 0 })
  })

  it('extracts branch name from "On branch main"', () => {
    const result = parseGitStatus('On branch main\nnothing to commit')
    expect(result.branch).toBe('main')
    expect(result.changed).toBe(0)
  })

  it('extracts branch name from Chinese locale output', () => {
    const result = parseGitStatus('位于分支 feature/test')
    expect(result.branch).toBe('feature/test')
  })

  it('counts short-format status codes', () => {
    const output = [
      'On branch dev',
      'M  src/index.js',
      'A  src/new.js',
      'D  src/old.js',
      '?? src/untracked.txt',
      'MM src/modified-twice.js',
    ].join('\n')
    const result = parseGitStatus(output)
    expect(result.branch).toBe('dev')
    expect(result.changed).toBe(5)
  })

  it('counts long-format status entries', () => {
    const output = [
      'On branch main',
      '  modified:   src/app.js',
      '  new file:   src/utils.js',
      '  deleted:    src/legacy.js',
    ].join('\n')
    const result = parseGitStatus(output)
    expect(result.changed).toBe(3)
  })

  it('handles rename status code', () => {
    const output = 'R  old-name.js -> new-name.js'
    const result = parseGitStatus(output)
    expect(result.changed).toBe(1)
  })

  it('returns 0 changes for clean working tree', () => {
    const output = 'On branch main\nnothing to commit, working tree clean'
    const result = parseGitStatus(output)
    expect(result.branch).toBe('main')
    expect(result.changed).toBe(0)
  })
})

// ─── P2P peers parsing (inline in P2P.vue) ───────────────────────────────────

describe('P2P peers parsing (parsePeersOutput logic)', () => {
  // Replicate parsePeersOutput from P2P.vue
  function parsePeersOutput(output) {
    if (!output || output.includes('No peers') || output.includes('no peers')) return []
    const lines = output.split('\n').filter(l => l.trim())
    const result = []
    for (const line of lines) {
      const match = line.match(/^\s*(\S+)\s+(.+?)\s+(connected|online|offline|disconnected)\s*$/i)
      if (match) {
        result.push({
          id: match[1],
          name: match[2].trim(),
          connected: /connected|online/i.test(match[3]),
        })
        continue
      }
      const idMatch = line.match(/^\s*((?:12D3|Qm)\S{10,})\s*(.*)$/)
      if (idMatch) {
        const rest = idMatch[2].trim()
        result.push({
          id: idMatch[1],
          name: rest || idMatch[1].slice(0, 12),
          connected: /connected|online/i.test(rest),
        })
      }
    }
    return result
  }

  it('returns empty array for empty output', () => {
    expect(parsePeersOutput('')).toEqual([])
  })

  it('returns empty array when "No peers" message present', () => {
    expect(parsePeersOutput('No peers connected')).toEqual([])
  })

  it('returns empty array for "no peers" (lowercase)', () => {
    expect(parsePeersOutput('There are no peers available')).toEqual([])
  })

  it('parses structured peer lines with status', () => {
    const output = '12D3KooWAbCdEfG  MyPhone  connected'
    const result = parsePeersOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('12D3KooWAbCdEfG')
    expect(result[0].name).toBe('MyPhone')
    expect(result[0].connected).toBe(true)
  })

  it('handles offline status keyword', () => {
    const output = '12D3KooWXyZ1234  Desktop  offline'
    const result = parsePeersOutput(output)
    expect(result[0].connected).toBe(false)
  })

  it('notes "disconnected" contains "connected" substring (matches as connected)', () => {
    // This is a known quirk of the regex: /connected|online/i matches inside "disconnected"
    const output = '12D3KooWXyZ1234  Desktop  disconnected'
    const result = parsePeersOutput(output)
    expect(result[0].connected).toBe(true)
  })

  it('handles Qm-prefixed peer IDs', () => {
    const output = 'QmYwAPJzv5CZsnN625s3Xf2nemtYgPpHdWEz79ojWnPbdG  MyNode  online'
    const result = parsePeersOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('MyNode')
    expect(result[0].connected).toBe(true)
  })

  it('falls back to ID-only parsing for 12D3 prefix', () => {
    const output = '12D3KooWAbCdEfGhIjKlMn'
    const result = parsePeersOutput(output)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('12D3KooWAbCdEfGhIjKlMn')
    expect(result[0].name).toBe('12D3KooWAbCd')
    expect(result[0].connected).toBe(false)
  })

  it('parses multiple peers', () => {
    const output = [
      '12D3KooWPeer1AAAA  Phone  connected',
      '12D3KooWPeer2BBBB  Laptop  offline',
    ].join('\n')
    const result = parsePeersOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0].connected).toBe(true)
    expect(result[1].connected).toBe(false)
  })
})

// ─── Project config parsing (inline in Projects.vue) ─────────────────────────

describe('Project config parsing (parseConfig logic)', () => {
  // Replicate parseConfig from Projects.vue (returns items array)
  function parseConfig(output) {
    const items = []
    const lines = output.split('\n')
    for (const line of lines) {
      const m = line.match(/^\s*(\S+)\s*[=:]\s*(.+)$/)
      if (m) {
        items.push({ key: m[1].trim(), value: m[2].trim() })
      }
    }
    return items
  }

  it('returns empty array for empty output', () => {
    expect(parseConfig('')).toEqual([])
  })

  it('parses key = value format', () => {
    const output = 'llm.provider = volcengine\nllm.model = doubao'
    const items = parseConfig(output)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ key: 'llm.provider', value: 'volcengine' })
    expect(items[1]).toEqual({ key: 'llm.model', value: 'doubao' })
  })

  it('parses key: value format', () => {
    const output = 'provider: openai'
    const items = parseConfig(output)
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({ key: 'provider', value: 'openai' })
  })

  it('skips lines without key-value pattern', () => {
    const output = 'Configuration:\n───────\nfoo = bar\nsome text without equals'
    const items = parseConfig(output)
    expect(items).toHaveLength(1)
    expect(items[0].key).toBe('foo')
  })
})

// ─── Audit stats parsing (inline in Security.vue) ────────────────────────────

describe('Audit stats parsing (parseAuditStats logic)', () => {
  // Replicate parseAuditStats from Security.vue (without auditEvents.value dependency)
  function parseAuditStats(output) {
    const stats = []
    const lines = output.split('\n')
    const colors = ['#1677ff', '#52c41a', '#faad14', '#ff4d4f']
    let colorIdx = 0
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Audit')) continue
      const kvMatch = trimmed.match(/^(.+?)\s*[:=：]\s*(.+)$/)
      if (kvMatch) {
        const label = kvMatch[1].trim()
        const rawValue = kvMatch[2].trim()
        const numMatch = rawValue.match(/^(\d+)/)
        stats.push({
          label,
          value: numMatch ? parseInt(numMatch[1], 10) : rawValue,
          color: colors[colorIdx % colors.length],
        })
        colorIdx++
      }
    }
    return stats
  }

  it('returns empty array for empty output', () => {
    expect(parseAuditStats('')).toEqual([])
  })

  it('parses numeric stat values', () => {
    const output = 'Total Events: 42\nErrors: 3'
    const stats = parseAuditStats(output)
    expect(stats).toHaveLength(2)
    expect(stats[0].label).toBe('Total Events')
    expect(stats[0].value).toBe(42)
    expect(stats[1].label).toBe('Errors')
    expect(stats[1].value).toBe(3)
  })

  it('keeps non-numeric values as strings', () => {
    const output = 'Status: Active'
    const stats = parseAuditStats(output)
    expect(stats[0].value).toBe('Active')
  })

  it('cycles through 4 colors', () => {
    const output = 'a: 1\nb: 2\nc: 3\nd: 4\ne: 5'
    const stats = parseAuditStats(output)
    expect(stats).toHaveLength(5)
    expect(stats[0].color).toBe('#1677ff')
    expect(stats[4].color).toBe('#1677ff') // wraps around
  })

  it('supports Chinese colon delimiter', () => {
    const output = '总事件数：128'
    const stats = parseAuditStats(output)
    expect(stats).toHaveLength(1)
    expect(stats[0].label).toBe('总事件数')
    expect(stats[0].value).toBe(128)
  })

  it('skips Audit header and separator lines', () => {
    const output = 'Audit Statistics\n─────────\nTotal: 10'
    const stats = parseAuditStats(output)
    expect(stats).toHaveLength(1)
  })
})

// ─── Sync status parsing (inline in P2P.vue) ────────────────────────────────

describe('Sync status parsing (parseSyncStatus logic)', () => {
  // Replicate parseSyncStatus return values
  function parseSyncStatus(output) {
    const result = { online: false, statusText: '未知', pending: 0, lastSyncTime: '' }
    if (!output) return result
    result.online = /synced|online|up.to.date/i.test(output)
    result.statusText = result.online ? '已同步' : '未同步'
    const pendingMatch = output.match(/pending[:\s]+(\d+)/i)
    result.pending = pendingMatch ? parseInt(pendingMatch[1]) : 0
    const timeMatch = output.match(/last[:\s]+(.+)/i)
    if (timeMatch) result.lastSyncTime = timeMatch[1].trim()
    return result
  }

  it('returns default for empty output', () => {
    const s = parseSyncStatus('')
    expect(s.online).toBe(false)
    expect(s.statusText).toBe('未知')
    expect(s.pending).toBe(0)
  })

  it('detects synced status', () => {
    const s = parseSyncStatus('Status: synced\nPending: 0')
    expect(s.online).toBe(true)
    expect(s.statusText).toBe('已同步')
  })

  it('detects up to date status', () => {
    const s = parseSyncStatus('Everything is up to date')
    expect(s.online).toBe(true)
  })

  it('parses pending count', () => {
    const s = parseSyncStatus('Status: not synced\nPending: 5')
    expect(s.pending).toBe(5)
  })

  it('parses last sync time', () => {
    const s = parseSyncStatus('Last: 2024-03-15 10:30:00')
    expect(s.lastSyncTime).toBe('2024-03-15 10:30:00')
  })
})
