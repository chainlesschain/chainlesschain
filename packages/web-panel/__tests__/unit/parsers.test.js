/**
 * Unit tests for src/utils/parsers.js
 *
 * All functions are pure — no Vue/Pinia/DOM required.
 * Run: npx vitest run __tests__/unit/parsers.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseSkillOutput,
  parseProviders,
  parseModels,
  parseStatus,
  parseNoteList,
  parseMcpServers,
  parseMcpTools,
  parseMemoryStats,
  parseMemories,
  parseCronTasks,
  classifyLogLine,
  KNOWN_PROVIDERS,
} from '../../src/utils/parsers.js'

// ─── parseSkillOutput ─────────────────────────────────────────────────────────

describe('parseSkillOutput', () => {
  it('returns empty array for empty string', () => {
    expect(parseSkillOutput('')).toEqual([])
  })

  it('returns empty array for whitespace-only input', () => {
    expect(parseSkillOutput('   \n\n   ')).toEqual([])
  })

  it('skips separator lines (─)', () => {
    expect(parseSkillOutput('─────────────\n─── separator ───')).toEqual([])
  })

  it('parses a single skill with category header and bullet', () => {
    const output = '  ai (1)\n    ● my-skill   A cool skill [bundled]'
    const skills = parseSkillOutput(output)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('my-skill')
    expect(skills[0].description).toBe('A cool skill')
    expect(skills[0].category).toBe('ai')
    expect(skills[0].executionMode).toBe('built-in')
  })

  it('strips [bundled] layer tag from description', () => {
    const output = '  tools (1)\n    ● helper   Does something [bundled]'
    const [s] = parseSkillOutput(output)
    expect(s.description).toBe('Does something')
    expect(s.description).not.toContain('[bundled]')
  })

  it('strips [project] layer tag from description', () => {
    const output = '  cli-direct (1)\n    ● my-pack   CLI pack description [project]'
    const [s] = parseSkillOutput(output)
    expect(s.description).toBe('CLI pack description')
  })

  it('sets executionMode=agent for cli-agent category', () => {
    const output = '  cli-agent (1)\n    ● agent-pack   Agent pack [project]'
    const [s] = parseSkillOutput(output)
    expect(s.executionMode).toBe('agent')
  })

  it('sets executionMode=llm-query for llm category', () => {
    const output = '  llm-tools (1)\n    ● llm-tool   LLM tool [bundled]'
    const [s] = parseSkillOutput(output)
    expect(s.executionMode).toBe('llm-query')
  })

  it('sets executionMode=cli-direct for cli-direct category', () => {
    const output = '  cli-direct (1)\n    ● cli-pack   CLI pack [project]'
    const [s] = parseSkillOutput(output)
    expect(s.executionMode).toBe('cli-direct')
  })

  it('sets executionMode=built-in for unknown category', () => {
    const output = '  automation (1)\n    ● auto-tool   Automation tool [bundled]'
    const [s] = parseSkillOutput(output)
    expect(s.executionMode).toBe('built-in')
  })

  it('parses multiple categories with multiple skills each', () => {
    const output = [
      '  ai (2)',
      '    ● skill-a   Desc A [bundled]',
      '    ● skill-b   Desc B [bundled]',
      '  automation (1)',
      '    ● skill-c   Desc C [bundled]',
    ].join('\n')
    const skills = parseSkillOutput(output)
    expect(skills).toHaveLength(3)
    expect(skills[0].category).toBe('ai')
    expect(skills[1].category).toBe('ai')
    expect(skills[2].category).toBe('automation')
    expect(skills[2].name).toBe('skill-c')
  })

  it('uses last known category for skills after a new header', () => {
    const output = [
      '  code-review (1)',
      '    ● debate-review   Code review with debate [bundled]',
    ].join('\n')
    const [s] = parseSkillOutput(output)
    expect(s.category).toBe('code-review')
  })

  it('parses legacy "name - description" format', () => {
    const output = '  tools (1)\n    old-skill - Old style description'
    const skills = parseSkillOutput(output)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('old-skill')
    expect(skills[0].description).toBe('Old style description')
  })

  it('handles real-world skill list output sample', () => {
    const output = `
Skills (5):

  ai (2)
    ● auto-context                   Maximum token budget [bundled]
    ● multi-model-router             Task description to route [bundled]

  cli-direct (2)
    ● cli-knowledge-pack             笔记增删改查 [project]
    ● cli-identity-pack              DID去中心化身份 [project]

  cli-agent (1)
    ● cli-agent-mode-pack            交互式AI对话 [project]
`
    const skills = parseSkillOutput(output)
    expect(skills).toHaveLength(5)
    expect(skills.find(s => s.name === 'auto-context')).toBeDefined()
    expect(skills.find(s => s.name === 'cli-knowledge-pack')?.executionMode).toBe('cli-direct')
    expect(skills.find(s => s.name === 'cli-agent-mode-pack')?.executionMode).toBe('agent')
  })
})

// ─── parseProviders ───────────────────────────────────────────────────────────

describe('parseProviders', () => {
  it('always returns all 10 known providers', () => {
    const result = parseProviders('')
    expect(result).toHaveLength(10)
  })

  it('all providers have required fields', () => {
    const result = parseProviders('')
    for (const p of result) {
      expect(p).toHaveProperty('name')
      expect(p).toHaveProperty('label')
      expect(p).toHaveProperty('icon')
      expect(p).toHaveProperty('status')
    }
  })

  it('marks provider as configured when name appears in output', () => {
    const result = parseProviders('anthropic is configured\nopenai key set')
    expect(result.find(p => p.name === 'anthropic').configured).toBe(true)
    expect(result.find(p => p.name === 'openai').configured).toBe(true)
    expect(result.find(p => p.name === 'mistral').configured).toBe(false)
  })

  it('marks active provider when "* name" pattern found', () => {
    const result = parseProviders('Providers:\n* anthropic\n  openai')
    expect(result.find(p => p.name === 'anthropic').active).toBe(true)
    expect(result.find(p => p.name === 'openai').active).toBe(false)
  })

  it('marks active via "active: name" fallback', () => {
    const result = parseProviders('active: volcengine')
    expect(result.find(p => p.name === 'volcengine').active).toBe(true)
  })

  it('volcengine is in the provider list', () => {
    const result = parseProviders('')
    expect(result.find(p => p.name === 'volcengine')).toBeDefined()
  })

  it('kimi replaces moonshot as provider name', () => {
    const result = parseProviders('')
    expect(result.find(p => p.name === 'kimi')).toBeDefined()
    expect(result.find(p => p.name === 'moonshot')).toBeUndefined()
  })

  it('dashscope replaces qianwen as provider name', () => {
    const result = parseProviders('')
    expect(result.find(p => p.name === 'dashscope')).toBeDefined()
    expect(result.find(p => p.name === 'qianwen')).toBeUndefined()
  })

  it('deepseek icon is valid emoji (not replacement char)', () => {
    const deepseek = KNOWN_PROVIDERS.find(p => p.name === 'deepseek')
    expect(deepseek.icon).toBe('🔍')
    expect(deepseek.icon).not.toContain('\uFFFD')
  })

  it('no provider icons contain replacement characters', () => {
    for (const p of KNOWN_PROVIDERS) {
      expect(p.icon).not.toContain('\uFFFD')
    }
  })

  it('handles empty output without crashing', () => {
    expect(() => parseProviders('')).not.toThrow()
    expect(() => parseProviders('no providers here')).not.toThrow()
  })
})

// ─── parseModels ──────────────────────────────────────────────────────────────

describe('parseModels', () => {
  it('returns empty array for empty output', () => {
    expect(parseModels('')).toEqual([])
  })

  it('filters lines without colon', () => {
    const result = parseModels('no-colon-line\nhas:colon')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('has:colon')
  })

  it('skips separator lines', () => {
    expect(parseModels('─────\nmodel:name')).toHaveLength(1)
  })

  it('caps output at 20 entries', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `model${i}:v1`).join('\n')
    expect(parseModels(lines)).toHaveLength(20)
  })
})

// ─── parseStatus ──────────────────────────────────────────────────────────────

describe('parseStatus', () => {
  const SAMPLE = `
  App Status

  ○ Desktop app not running
  ● Setup completed (2026-03-15T10:48:44.793Z)
    Edition: enterprise
    LLM: volcengine (doubao-seed-1-6)

  Docker Services

  ○ docker-compose.yml not found

  Ports

  ○ vite: 5173
  ○ signaling: 9001
  ● wsServer: 18800
`

  it('detects app not running', () => {
    expect(parseStatus(SAMPLE).appRunning).toBe(false)
  })

  it('detects app running', () => {
    expect(parseStatus('Desktop app running PID: 1234').appRunning).toBe(true)
  })

  it('detects setup completed', () => {
    expect(parseStatus(SAMPLE).setupDone).toBe(true)
  })

  it('extracts edition', () => {
    expect(parseStatus(SAMPLE).edition).toBe('enterprise')
  })

  it('extracts LLM provider and model', () => {
    const s = parseStatus(SAMPLE)
    expect(s.activeLlm).toBe('volcengine')
    expect(s.activeModel).toBe('doubao-seed-1-6')
  })

  it('extracts LLM without model in parentheses', () => {
    const s = parseStatus('LLM: anthropic')
    expect(s.activeLlm).toBe('anthropic')
    expect(s.activeModel).toBe('')
  })

  it('reports docker-compose not found', () => {
    expect(parseStatus(SAMPLE).dockerStatus).toBe('未找到 docker-compose.yml')
  })

  it('parses active ports (● symbol)', () => {
    const s = parseStatus(SAMPLE)
    const active = s.ports.filter(p => p.active)
    expect(active).toHaveLength(1)
    expect(active[0].name).toBe('wsServer')
    expect(active[0].port).toBe(18800)
  })

  it('parses inactive ports (○ symbol)', () => {
    const s = parseStatus(SAMPLE)
    const inactive = s.ports.filter(p => !p.active)
    expect(inactive.length).toBeGreaterThan(0)
    expect(inactive.find(p => p.name === 'vite')).toBeDefined()
  })

  it('handles empty output without crashing', () => {
    const s = parseStatus('')
    expect(s.appRunning).toBe(false)
    expect(s.ports).toEqual([])
  })
})

// ─── parseNoteList ────────────────────────────────────────────────────────────

describe('parseNoteList', () => {
  it('returns empty array for empty string', () => {
    expect(parseNoteList('')).toEqual([])
  })

  it('parses numbered note entry with tags and preview', () => {
    const output = '1. My Title [work,ai] - Preview text here'
    const notes = parseNoteList(output)
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('My Title')
    expect(notes[0].tags).toEqual(['work', 'ai'])
    expect(notes[0].preview).toBe('Preview text here')
  })

  it('parses numbered note entry without tags', () => {
    const notes = parseNoteList('2. Just a title')
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('Just a title')
    expect(notes[0].tags).toEqual([])
  })

  it('skips separator lines', () => {
    expect(parseNoteList('─────────\n1. Real note')).toHaveLength(1)
  })

  it('skips "N notes" summary lines', () => {
    expect(parseNoteList('3 notes found\n1. Real note')).toHaveLength(1)
  })

  it('skips lines starting with ✖', () => {
    expect(parseNoteList('✖ Database error')).toEqual([])
  })

  it('parses multiple notes', () => {
    const output = '1. Note One [tag1]\n2. Note Two [tag2]\n3. Note Three'
    const notes = parseNoteList(output)
    expect(notes).toHaveLength(3)
    expect(notes[1].title).toBe('Note Two')
  })

  it('truncates preview to 100 chars', () => {
    const longPreview = 'x'.repeat(200)
    const notes = parseNoteList(`1. Title - ${longPreview}`)
    expect(notes[0].preview.length).toBeLessThanOrEqual(100)
  })
})

// ─── parseMcpServers ──────────────────────────────────────────────────────────

describe('parseMcpServers', () => {
  it('returns empty array for empty output', () => {
    expect(parseMcpServers('')).toEqual([])
  })

  it('parses a server with name only', () => {
    const servers = parseMcpServers('  filesystem')
    expect(servers.length).toBeGreaterThanOrEqual(1)
    expect(servers.find(s => s.name === 'filesystem')).toBeDefined()
  })

  it('parses server with command field', () => {
    const output = '  myserver\n  command: npx -y @mcp/server'
    const servers = parseMcpServers(output)
    expect(servers[0].command).toBe('npx -y @mcp/server')
  })

  it('handles "no MCP servers" gracefully', () => {
    expect(parseMcpServers('No MCP servers configured')).toEqual([])
  })

  it('skips separator lines', () => {
    const servers = parseMcpServers('─────\n  myserver')
    expect(servers.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── parseMcpTools ────────────────────────────────────────────────────────────

describe('parseMcpTools', () => {
  it('returns empty array for empty output', () => {
    expect(parseMcpTools('')).toEqual([])
  })

  it('parses tools with bullet prefix and description', () => {
    const output = '● read-file - Read a file from disk'
    const tools = parseMcpTools(output)
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('read-file')
    expect(tools[0].description).toBe('Read a file from disk')
  })

  it('assigns server from [server-name] header', () => {
    const output = '[filesystem]\n● read-file - Read file'
    const tools = parseMcpTools(output)
    expect(tools[0].server).toBe('filesystem')
  })

  it('assigns server from Server: header', () => {
    const output = 'Server: myserver\n● tool-one - Does stuff'
    const tools = parseMcpTools(output)
    expect(tools[0].server).toBe('myserver')
  })

  it('defaults server to unknown when no header present', () => {
    const tools = parseMcpTools('● orphan-tool - No server')
    expect(tools[0].server).toBe('unknown')
  })
})

// ─── parseMemoryStats ─────────────────────────────────────────────────────────

describe('parseMemoryStats', () => {
  it('returns zeros for empty output', () => {
    expect(parseMemoryStats('')).toEqual({ shortTerm: 0, longTerm: 0, core: 0 })
  })

  it('parses short-term count', () => {
    expect(parseMemoryStats('short-term: 5 entries').shortTerm).toBe(5)
  })

  it('parses long-term count', () => {
    expect(parseMemoryStats('long-term: 12').longTerm).toBe(12)
  })

  it('parses core count', () => {
    expect(parseMemoryStats('core: 3 memories').core).toBe(3)
  })

  it('parses all three layers from multiline output', () => {
    const output = 'Memory Statistics:\n  short-term: 8\n  long-term: 24\n  core: 4'
    const stats = parseMemoryStats(output)
    expect(stats.shortTerm).toBe(8)
    expect(stats.longTerm).toBe(24)
    expect(stats.core).toBe(4)
  })

  it('handles alternative spacing patterns', () => {
    expect(parseMemoryStats('Short Term  15').shortTerm).toBe(15)
    expect(parseMemoryStats('LongTerm 7').longTerm).toBe(7)
  })
})

// ─── parseMemories ────────────────────────────────────────────────────────────

describe('parseMemories', () => {
  it('returns empty array for empty output', () => {
    expect(parseMemories('')).toEqual([])
  })

  it('parses bullet-prefixed memories', () => {
    const output = '- Remember to check the deploy\n- Meeting at 3pm tomorrow'
    const mems = parseMemories(output)
    expect(mems.length).toBeGreaterThanOrEqual(2)
    expect(mems[0].content).toBe('Remember to check the deploy')
  })

  it('assigns provided layer to all memories', () => {
    const mems = parseMemories('- A memory', 'long-term')
    expect(mems[0].layer).toBe('long-term')
  })

  it('caps at 20 memories', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `- Memory item ${i + 1}`).join('\n')
    expect(parseMemories(lines)).toHaveLength(20)
  })

  it('skips very short lines (≤5 chars)', () => {
    const mems = parseMemories('- hi\n- A longer memory entry here')
    expect(mems.every(m => m.content.length > 5)).toBe(true)
  })

  it('skips separator lines', () => {
    expect(parseMemories('─────────\n- Valid memory')).toHaveLength(1)
  })
})

// ─── parseCronTasks ───────────────────────────────────────────────────────────

describe('parseCronTasks', () => {
  it('returns empty array for empty output', () => {
    expect(parseCronTasks('')).toEqual([])
  })

  it('parses task with tab separator', () => {
    const output = 'daily-backup\t0 2 * * *\tenabled'
    const tasks = parseCronTasks(output)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('daily-backup')
    expect(tasks[0].cron).toBe('0 2 * * *')
    expect(tasks[0].enabled).toBe(true)
  })

  it('marks disabled tasks correctly', () => {
    const output = 'my-task\t* * * * *\tpaused'
    const tasks = parseCronTasks(output)
    expect(tasks[0].enabled).toBe(false)
  })

  it('marks task as enabled when no pause/disabled keyword', () => {
    const output = 'active-task\t0 9 * * *\trunning'
    const tasks = parseCronTasks(output)
    expect(tasks[0].enabled).toBe(true)
  })

  it('skips separator lines', () => {
    const tasks = parseCronTasks('─────\ntask-a\t* * * * *\tok')
    expect(tasks).toHaveLength(1)
  })
})

// ─── classifyLogLine ──────────────────────────────────────────────────────────

describe('classifyLogLine', () => {
  it('returns line-error for ✖ prefix', () => {
    expect(classifyLogLine('✖ Something failed')).toBe('line-error')
  })

  it('returns line-error for "error" keyword', () => {
    expect(classifyLogLine('Error connecting to database')).toBe('line-error')
    expect(classifyLogLine('connection error occurred')).toBe('line-error')
  })

  it('returns line-error for "failed" keyword', () => {
    expect(classifyLogLine('Command failed with exit code 1')).toBe('line-error')
  })

  it('returns line-success for ✔ symbol', () => {
    expect(classifyLogLine('✔ Build succeeded')).toBe('line-success')
  })

  it('returns line-success for "success" keyword', () => {
    expect(classifyLogLine('success: all tests passed')).toBe('line-success')
  })

  it('returns line-success for "running" keyword', () => {
    expect(classifyLogLine('● wsServer: 18800 running')).toBe('line-success')
  })

  it('returns line-warn for ○ symbol', () => {
    expect(classifyLogLine('○ service not started')).toBe('line-warn')
  })

  it('returns line-warn for "warn" keyword', () => {
    expect(classifyLogLine('warn: deprecated API used')).toBe('line-warn')
  })

  it('returns line-indent for lines starting with whitespace', () => {
    expect(classifyLogLine('  indented line')).toBe('line-indent')
    expect(classifyLogLine('\t tabbed line')).toBe('line-indent')
  })

  it('returns empty string for normal lines', () => {
    expect(classifyLogLine('Normal log line')).toBe('')
    expect(classifyLogLine('ChainlessChain v5.0.2.7')).toBe('')
  })

  it('prioritises error over other classes', () => {
    expect(classifyLogLine('✖ error in running service')).toBe('line-error')
  })
})
