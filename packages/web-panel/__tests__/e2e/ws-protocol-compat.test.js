/**
 * E2E tests for Web Panel ↔ WS Server protocol compatibility.
 *
 * Spawns a real `cc serve` WS server and connects via raw WebSocket
 * to verify v1.0 Coding Agent Envelope protocol is handled correctly:
 * - requestId correlation (not eventId)
 * - dot-case type mapping (session.started, session.resumed, etc.)
 * - payload flattening for consumers
 * - session lifecycle (create → list → resume → close)
 * - execute command (skill list, llm providers)
 *
 * Ports: 19300–19310 (no conflicts with panel.test.js suite).
 *
 * Run: npx vitest run __tests__/e2e/ws-protocol-compat.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cliRoot = path.join(__dirname, '..', '..', '..', 'cli')
const bin = path.join(cliRoot, 'bin', 'chainlesschain.js')

const WS_PORT = 19300

// ── helpers ──────────────────────────────────────────────────────────────────

let msgCounter = 0
function genId() {
  return `test-${++msgCounter}`
}

function startServeProcess(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [bin, 'serve', '--port', String(port)], {
      env: { ...process.env, FORCE_COLOR: '0' },
      cwd: process.cwd(),
    })

    let out = ''
    const onData = (data) => {
      out += data.toString('utf8')
      if (out.includes(`ws://`) && out.includes(String(port))) {
        resolve(proc)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', reject)

    // Fallback timeout
    setTimeout(() => resolve(proc), 15000)
  })
}

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) { resolve(); return }
    proc.once('close', resolve)
    proc.kill('SIGTERM')
    setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* */ }
      resolve()
    }, 3000)
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

/**
 * Send a JSON message and wait for a response correlated by the same id.
 * Handles v1.0 envelope: the response uses `requestId` (not `id`) for correlation.
 */
function sendAndWait(ws, payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = payload.id || genId()
    const msg = { ...payload, id }
    const timer = setTimeout(() => {
      ws.off('message', onMsg)
      reject(new Error(`Timeout waiting for response to ${msg.type} (id=${id})`))
    }, timeoutMs)

    function onMsg(data) {
      let parsed
      try { parsed = JSON.parse(data.toString('utf8')) } catch { return }
      // v1.0 envelope correlation: match on requestId OR legacy id
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

/**
 * Collect streaming messages for a session until a condition is met or timeout.
 */
function collectSessionMessages(ws, sessionId, { until, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const collected = []
    const timer = setTimeout(() => {
      ws.off('message', onMsg)
      resolve(collected)
    }, timeoutMs)

    function onMsg(data) {
      let parsed
      try { parsed = JSON.parse(data.toString('utf8')) } catch { return }
      const sid = parsed.sessionId || (parsed.payload && parsed.payload.sessionId) || null
      if (sid === sessionId) {
        collected.push(parsed)
        if (until && until(parsed, collected)) {
          clearTimeout(timer)
          ws.off('message', onMsg)
          resolve(collected)
        }
      }
    }

    ws.on('message', onMsg)
  })
}

// ── Suite: WS Protocol Compatibility ─────────────────────────────────────────

describe('WS protocol compatibility — v1.0 Coding Agent Envelope', () => {
  let proc, ws

  beforeAll(async () => {
    proc = await startServeProcess(WS_PORT)
    // Small delay to ensure server is fully ready
    await new Promise((r) => setTimeout(r, 2000))
    ws = await connectWs(WS_PORT)
  }, 30000)

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    await killProc(proc)
  })

  // ── 1. Connection ──

  it('connects to WS server successfully', () => {
    expect(ws).toBeDefined()
    expect(ws.readyState).toBe(WebSocket.OPEN)
  })

  // ── 2. Execute command ──

  it('execute command returns result correlated by id', async () => {
    const id = genId()
    const response = await sendAndWait(ws, {
      type: 'execute',
      id,
      command: 'status',
    })

    // Execute uses legacy flat format (not v1.0 envelope) — correlation via id
    const correlationId = response.requestId || response.id
    expect(correlationId).toBe(id)
    expect(response).toBeDefined()
  })

  it('execute "skill list" returns parseable output', async () => {
    const response = await sendAndWait(ws, {
      type: 'execute',
      command: 'skill list',
    }, 30000)

    // Response should contain stdout with skill data
    const output = response.stdout || response.output || ''
    expect(typeof output).toBe('string')
    // Skills output should contain at least some text
    expect(output.length).toBeGreaterThan(0)
  })

  it('execute "llm providers" returns provider list', async () => {
    const response = await sendAndWait(ws, {
      type: 'execute',
      command: 'llm providers',
    }, 30000)

    const output = response.stdout || response.output || ''
    expect(typeof output).toBe('string')
    // Should list at least one provider
    expect(output.length).toBeGreaterThan(0)
  })

  // ── 3. Session lifecycle ──

  it('session-create returns v1.0 envelope with sessionId in payload', async () => {
    const id = genId()
    const response = await sendAndWait(ws, {
      type: 'session-create',
      id,
      sessionType: 'chat',
    })

    // v1.0: type should be dot-case "session.started"
    expect(response.type).toBe('session.started')
    // Correlation: requestId matches our request id
    expect(response.requestId).toBe(id)
    // Payload contains sessionId
    const sessionId = response.payload?.sessionId || response.sessionId
    expect(sessionId).toBeTruthy()
    expect(typeof sessionId).toBe('string')

    // Envelope has version field
    expect(response.version).toBe('1.0')
    // Envelope has eventId (different from requestId)
    expect(response.eventId).toBeTruthy()
    expect(response.eventId).not.toBe(id)
  })

  it('session-list returns sessions including the one just created', async () => {
    // First create a session
    const createResp = await sendAndWait(ws, {
      type: 'session-create',
      sessionType: 'chat',
    })
    const createdId = createResp.payload?.sessionId || createResp.sessionId

    // Then list sessions
    const listResp = await sendAndWait(ws, {
      type: 'session-list',
    })

    // Response should contain sessions array (in payload or top-level)
    const sessions = listResp.payload?.sessions || listResp.sessions || []
    expect(Array.isArray(sessions)).toBe(true)
    // At least the session we just created
    const found = sessions.find((s) => s.id === createdId)
    expect(found).toBeTruthy()
  })

  it('session-resume returns history in v1.0 envelope', async () => {
    // Create a session first
    const createResp = await sendAndWait(ws, {
      type: 'session-create',
      sessionType: 'chat',
    })
    const sessionId = createResp.payload?.sessionId || createResp.sessionId

    // Resume it
    const id = genId()
    const resumeResp = await sendAndWait(ws, {
      type: 'session-resume',
      id,
      sessionId,
    })

    expect(resumeResp.requestId).toBe(id)
    expect(resumeResp.type).toBe('session.resumed')
    // History should be in payload
    const history = resumeResp.payload?.history || resumeResp.history || []
    expect(Array.isArray(history)).toBe(true)
  })

  it('session-close removes the session', async () => {
    // Create a session
    const createResp = await sendAndWait(ws, {
      type: 'session-create',
      sessionType: 'chat',
    })
    const sessionId = createResp.payload?.sessionId || createResp.sessionId

    // Close it
    const closeResp = await sendAndWait(ws, {
      type: 'session-close',
      sessionId,
    })
    expect(closeResp).toBeDefined()

    // List should no longer include it
    const listResp = await sendAndWait(ws, {
      type: 'session-list',
    })
    const sessions = listResp.payload?.sessions || listResp.sessions || []
    const found = sessions.find((s) => s.id === sessionId)
    expect(found).toBeFalsy()
  })

  // ── 4. Session record fields ──

  it('session-create response includes session record with type and status', async () => {
    const response = await sendAndWait(ws, {
      type: 'session-create',
      sessionType: 'agent',
    })

    const record = response.payload?.record || response.record
    expect(record).toBeTruthy()
    expect(record.status).toBe('created')
    // sessionType should be reflected
    expect(record.type || record.sessionType).toBe('agent')
  })

  // ── 5. Web Panel ws.js flattenEnvelope compatibility ──

  it('v1.0 envelope can be flattened for legacy consumers', async () => {
    const id = genId()
    const response = await sendAndWait(ws, {
      type: 'session-create',
      id,
      sessionType: 'chat',
    })

    // Simulate what ws.js flattenEnvelope does
    const payload = response.payload || {}
    const flat = { ...response, ...payload, type: response.type }
    flat.id = response.requestId || response.id

    // After flattening, sessionId should be directly accessible
    expect(flat.sessionId).toBeTruthy()
    // The id should be our original request id (for pending promise resolution)
    expect(flat.id).toBe(id)
    // Type is preserved
    expect(flat.type).toBe('session.started')
  })

  // ── 6. Multiple concurrent requests ──

  it('multiple concurrent requests are correlated correctly', async () => {
    const ids = [genId(), genId(), genId()]
    const promises = ids.map((id) =>
      sendAndWait(ws, {
        type: 'session-create',
        id,
        sessionType: 'chat',
      }),
    )

    const responses = await Promise.all(promises)

    // Each response should have the correct requestId
    for (let i = 0; i < ids.length; i++) {
      expect(responses[i].requestId).toBe(ids[i])
    }

    // Each response should have a different sessionId
    const sessionIds = responses.map(
      (r) => r.payload?.sessionId || r.sessionId,
    )
    const unique = new Set(sessionIds)
    expect(unique.size).toBe(ids.length)
  })

  // ── 7. Error envelope ──

  it('error responses use v1.0 envelope format', async () => {
    const id = genId()
    const response = await sendAndWait(ws, {
      type: 'session-resume',
      id,
      sessionId: 'nonexistent-session-id-12345',
    })

    expect(response.requestId).toBe(id)
    expect(response.type).toBe('error')
    // Error details in payload
    const errMsg = response.payload?.message || response.message || ''
    expect(errMsg).toContain('not found')
  })
})
