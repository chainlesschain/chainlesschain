/**
 * Integration tests: Phase B web-panel views ↔ CLI command roundtrip.
 *
 * For each Phase B view (Community / Marketplace / Crosschain / AIOps /
 * Compliance), spawn the real `cc serve` WS server and execute the CLI
 * commands the view uses. Verify the JSON output parses through the
 * matching parser without throwing — this catches CLI shape changes
 * that pure parser tests (which use synthetic input) miss.
 *
 * Port: 19410 (no conflict with cli-commands.test.js on 19400).
 *
 * Run: npx vitest run __tests__/integration/phase-b-cli-commands.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

import {
  parseSocialStats, parseContacts, parseFriends, parsePosts,
} from '../../src/utils/community-parser.js'
import {
  parseServices, parseInvocations, parseStats as parseMarketStats,
} from '../../src/utils/marketplace-parser.js'
import {
  parseChains, parseBridges, parseSwaps, parseMessages,
  parseStats as parseXChainStats, parseFeeEstimate,
} from '../../src/utils/crosschain-parser.js'
import {
  parseIncidents, parsePlaybooks, parseBaselines,
  parseStats as parseOpsStats,
} from '../../src/utils/aiops-parser.js'
import {
  parseIndicators, parseThreatIntelStats, parseMatchResult,
} from '../../src/utils/compliance-parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cliRoot = path.join(__dirname, '..', '..', '..', 'cli')
const bin = path.join(cliRoot, 'bin', 'chainlesschain.js')

const WS_PORT = 19410

// ── helpers (mirror cli-commands.test.js) ────────────────────────────────────

let msgCounter = 0
const genId = () => `phase-b-${++msgCounter}`

function startServeProcess(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [bin, 'serve', '--port', String(port)], {
      env: { ...process.env, FORCE_COLOR: '0' },
      cwd: process.cwd(),
    })
    let out = ''
    const onData = (data) => {
      out += data.toString('utf8')
      if (out.includes('ws://') && out.includes(String(port))) resolve(proc)
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', reject)
    setTimeout(() => resolve(proc), 15000)
  })
}

function killProc(proc) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null) { resolve(); return }
    proc.once('close', resolve)
    proc.kill('SIGTERM')
    setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* ignored */ }; resolve() }, 3000)
  })
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    setTimeout(() => reject(new Error('WS connect timeout')), 8000)
  })
}

function sendAndWait(ws, payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = payload.id || genId()
    const msg = { ...payload, id }
    const timer = setTimeout(() => {
      ws.off('message', onMsg)
      reject(new Error(`Timeout waiting for ${msg.type} (id=${id})`))
    }, timeoutMs)
    function onMsg(data) {
      let parsed
      try { parsed = JSON.parse(data.toString('utf8')) } catch { return }
      const correlationId = parsed.requestId || parsed.id
      if (correlationId === id) {
        clearTimeout(timer)
        ws.off('message', onMsg)
        resolve(parsed)
      }
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify(msg))
  })
}

async function exec(ws, command, timeoutMs = 30000) {
  const r = await sendAndWait(ws, { type: 'execute', id: genId(), command }, timeoutMs)
  return r.stdout || r.output || r.payload?.stdout || r.payload?.output || ''
}

// ── shared server fixture ────────────────────────────────────────────────────

let proc, ws

beforeAll(async () => {
  proc = await startServeProcess(WS_PORT)
  await new Promise(r => setTimeout(r, 2000))
  ws = await connectWs(WS_PORT)
}, 30000)

afterAll(async () => {
  if (ws && ws.readyState === ws.OPEN) ws.close()
  await killProc(proc)
})

// ── Community / cc social ────────────────────────────────────────────────────

describe('B1 Community ↔ cc social', () => {
  it('social stats --json returns a stats object', async () => {
    const out = await exec(ws, 'social stats --json')
    const stats = parseSocialStats(out)
    expect(stats).toBeDefined()
    expect(typeof stats.contacts).toBe('number')
    expect(typeof stats.friends).toBe('number')
    expect(typeof stats.posts).toBe('number')
    expect(typeof stats.messages).toBe('number')
    expect(typeof stats.pendingRequests).toBe('number')
  }, 30000)

  it('social contact list --json returns an array', async () => {
    const out = await exec(ws, 'social contact list --json')
    expect(Array.isArray(parseContacts(out))).toBe(true)
  }, 30000)

  it('social friend list --json returns an array', async () => {
    const out = await exec(ws, 'social friend list --json')
    expect(Array.isArray(parseFriends(out))).toBe(true)
  }, 30000)

  it('social post list --json returns an array', async () => {
    const out = await exec(ws, 'social post list --json')
    expect(Array.isArray(parsePosts(out))).toBe(true)
  }, 30000)
})

// ── Marketplace / cc marketplace ─────────────────────────────────────────────

describe('B2 Marketplace ↔ cc marketplace', () => {
  it('marketplace list --json returns an array', async () => {
    const out = await exec(ws, 'marketplace list --json')
    expect(Array.isArray(parseServices(out))).toBe(true)
  }, 30000)

  it('marketplace invocations --json returns an array', async () => {
    const out = await exec(ws, 'marketplace invocations --json')
    expect(Array.isArray(parseInvocations(out))).toBe(true)
  }, 30000)

  it('marketplace stats --json returns the full counts shape', async () => {
    const out = await exec(ws, 'marketplace stats --json')
    const s = parseMarketStats(out)
    expect(typeof s.total).toBe('number')
    expect(s.counts).toBeDefined()
    expect(typeof s.counts.success).toBe('number')
    expect(typeof s.counts.failed).toBe('number')
    expect(typeof s.successRate).toBe('number')
    expect(typeof s.avgDurationMs).toBe('number')
  }, 30000)
})

// ── Crosschain / cc crosschain ──────────────────────────────────────────────

describe('B3 Cross-chain ↔ cc crosschain', () => {
  it('crosschain chains --json returns the 5-chain catalogue', async () => {
    const out = await exec(ws, 'crosschain chains --json')
    const chains = parseChains(out)
    expect(chains.length).toBeGreaterThanOrEqual(5)
    const ids = chains.map(c => c.id)
    expect(ids).toContain('ethereum')
    expect(ids).toContain('polygon')
    expect(ids).toContain('bsc')
    expect(ids).toContain('arbitrum')
    expect(ids).toContain('solana')
  }, 30000)

  it('crosschain bridges/swaps/messages all return arrays', async () => {
    const [bOut, sOut, mOut] = await Promise.all([
      exec(ws, 'crosschain bridges --json'),
      exec(ws, 'crosschain swaps --json'),
      exec(ws, 'crosschain messages --json'),
    ])
    expect(Array.isArray(parseBridges(bOut))).toBe(true)
    expect(Array.isArray(parseSwaps(sOut))).toBe(true)
    expect(Array.isArray(parseMessages(mOut))).toBe(true)
  }, 60000)

  it('crosschain stats --json returns the full nested shape', async () => {
    const out = await exec(ws, 'crosschain stats --json')
    const s = parseXChainStats(out)
    expect(typeof s.bridges.total).toBe('number')
    expect(typeof s.bridges.totalVolume).toBe('number')
    expect(typeof s.swaps.total).toBe('number')
    expect(typeof s.messages.total).toBe('number')
  }, 30000)

  it('crosschain estimate-fee ethereum bsc 100 --json returns a fee envelope', async () => {
    const out = await exec(ws, 'crosschain estimate-fee ethereum bsc 100 --json')
    const fee = parseFeeEstimate(out)
    expect(fee).not.toBeNull()
    expect(typeof fee.fee).toBe('number')
    expect(fee.breakdown).toBeDefined()
    expect(typeof fee.breakdown.sourceFee).toBe('number')
    expect(typeof fee.breakdown.bridgeFee).toBe('number')
    expect(fee.currency).toBeDefined()
  }, 30000)
})

// ── AIOps / cc ops ───────────────────────────────────────────────────────────

describe('B4 AIOps ↔ cc ops', () => {
  it('ops incidents --json returns an array', async () => {
    const out = await exec(ws, 'ops incidents --json')
    expect(Array.isArray(parseIncidents(out))).toBe(true)
  }, 30000)

  it('ops playbooks --json returns an array', async () => {
    const out = await exec(ws, 'ops playbooks --json')
    expect(Array.isArray(parsePlaybooks(out))).toBe(true)
  }, 30000)

  it('ops baselines --json returns an array', async () => {
    const out = await exec(ws, 'ops baselines --json')
    expect(Array.isArray(parseBaselines(out))).toBe(true)
  }, 30000)

  it('ops stats --json returns the full nested shape', async () => {
    const out = await exec(ws, 'ops stats --json')
    const s = parseOpsStats(out)
    expect(typeof s.incidents.total).toBe('number')
    expect(s.incidents.bySeverity).toBeDefined()
    expect(typeof s.incidents.bySeverity.P0).toBe('number')
    expect(typeof s.incidents.bySeverity.P3).toBe('number')
    expect(s.incidents.byStatus).toBeDefined()
    expect(typeof s.incidents.byStatus.open).toBe('number')
    expect(typeof s.playbooks.total).toBe('number')
    expect(typeof s.baselines.total).toBe('number')
  }, 30000)
})

// ── Compliance / cc compliance ───────────────────────────────────────────────

describe('B5 Compliance ↔ cc compliance', () => {
  it('compliance threat-intel list --json returns an array', async () => {
    const out = await exec(ws, 'compliance threat-intel list --json')
    expect(Array.isArray(parseIndicators(out))).toBe(true)
  }, 30000)

  it('compliance threat-intel stats --json returns total + byType', async () => {
    const out = await exec(ws, 'compliance threat-intel stats --json')
    const s = parseThreatIntelStats(out)
    expect(typeof s.total).toBe('number')
    expect(s.byType).toBeDefined()
    expect(typeof s.byType).toBe('object')
  }, 30000)

  it('compliance threat-intel match 1.2.3.4 --json returns a match envelope', async () => {
    const out = await exec(ws, 'compliance threat-intel match 1.2.3.4 --json')
    const r = parseMatchResult(out)
    expect(r).not.toBeNull()
    expect(typeof r.matched).toBe('boolean')
    expect(r.type).toBe('ipv4') // classification works even on miss
  }, 30000)

  it('compliance threat-intel match unparseable --json reports type=unknown', async () => {
    const out = await exec(ws, 'compliance threat-intel match "totally-not-an-iov" --json')
    const r = parseMatchResult(out)
    expect(r).not.toBeNull()
    expect(r.matched).toBe(false)
    expect(r.type).toBe('unknown')
  }, 30000)
})
