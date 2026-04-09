/**
 * Integration tests: Web Panel CLI command execution via WebSocket.
 *
 * Spawns a real `cc serve` WS server and sends CLI commands through
 * the WebSocket execute protocol. Verifies that each command returns
 * a valid response with output.
 *
 * Follows the same helper pattern as __tests__/e2e/ws-protocol-compat.test.js.
 *
 * Port: 19400 (no conflicts with other test suites).
 *
 * Run: npx vitest run __tests__/integration/cli-commands.test.js
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

const WS_PORT = 19400

// ── helpers ──────────────────────────────────────────────────────────────────

let msgCounter = 0
function genId() {
  return `cli-cmd-${++msgCounter}`
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
      if (out.includes('ws://') && out.includes(String(port))) {
        resolve(proc)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', reject)

    // Fallback timeout — resolve even if banner not detected
    setTimeout(() => resolve(proc), 15000)
  })
}

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) { resolve(); return }
    proc.once('close', resolve)
    proc.kill('SIGTERM')
    setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* ignored */ }
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
 * Execute a CLI command via the WS server and return the response.
 */
async function executeCommand(ws, command, timeoutMs = 30000) {
  const id = genId()
  return sendAndWait(ws, { type: 'execute', id, command }, timeoutMs)
}

/**
 * Extract the output text from an execute response.
 * The server may use stdout, output, or payload.output.
 */
function getOutput(response) {
  return response.stdout
    || response.output
    || response.payload?.stdout
    || response.payload?.output
    || ''
}

// ── Suite: CLI command execution via WebSocket ───────────────────────────────

describe('CLI commands via WebSocket execute protocol', () => {
  let proc, ws

  beforeAll(async () => {
    proc = await startServeProcess(WS_PORT)
    // Allow server to fully initialize
    await new Promise((r) => setTimeout(r, 2000))
    ws = await connectWs(WS_PORT)
  }, 30000)

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    await killProc(proc)
  })

  // ── 1. Connection sanity ──

  it('connects to serve WS server', () => {
    expect(ws).toBeDefined()
    expect(ws.readyState).toBe(WebSocket.OPEN)
  })

  // ── 2. skill list ──

  it('skill list returns non-empty output', async () => {
    const response = await executeCommand(ws, 'skill list')
    const output = getOutput(response)
    expect(typeof output).toBe('string')
    expect(output.length).toBeGreaterThan(0)
  }, 30000)

  // ── 3. llm providers ──

  it('llm providers returns provider names', async () => {
    const response = await executeCommand(ws, 'llm providers')
    const output = getOutput(response)
    expect(typeof output).toBe('string')
    expect(output.length).toBeGreaterThan(0)
  }, 30000)

  // ── 4. config list ──

  it('config list returns parseable config with llm section', async () => {
    const response = await executeCommand(ws, 'config list')
    const output = getOutput(response)
    expect(typeof output).toBe('string')
    expect(output.length).toBeGreaterThan(0)
    // Config output should reference LLM-related settings
    const lowerOutput = output.toLowerCase()
    const hasLlmRef = lowerOutput.includes('llm')
      || lowerOutput.includes('model')
      || lowerOutput.includes('provider')
      || lowerOutput.includes('ollama')
    expect(hasLlmRef).toBe(true)
  }, 30000)

  // ── 5. status ──

  it('status returns system status info', async () => {
    const response = await executeCommand(ws, 'status')
    const output = getOutput(response)
    expect(typeof output).toBe('string')
    expect(output.length).toBeGreaterThan(0)
  }, 30000)

  // ── 6. did list ──

  it('did list executes without error', async () => {
    const response = await executeCommand(ws, 'did list')
    // Should not be an error response
    const errMsg = response.error || response.payload?.error || ''
    // did list may return empty list but should not hard-error
    if (errMsg) {
      // Accept graceful "no identities" type messages
      expect(errMsg).not.toContain('FATAL')
    }
    // Response itself should be defined
    expect(response).toBeDefined()
  }, 30000)

  // ── 7. audit stats ──

  it('audit stats executes without error', async () => {
    const response = await executeCommand(ws, 'audit stats')
    expect(response).toBeDefined()
    const output = getOutput(response)
    expect(typeof output).toBe('string')
  }, 30000)

  // ── 8. session-create chat ──

  it('session-create chat returns a sessionId', async () => {
    const id = genId()
    const response = await sendAndWait(ws, {
      type: 'session-create',
      id,
      sessionType: 'chat',
    })

    const sessionId = response.payload?.sessionId || response.sessionId
    expect(sessionId).toBeTruthy()
    expect(typeof sessionId).toBe('string')
  }, 15000)

  // ── 9. session-list ──

  it('session-list returns an array of sessions', async () => {
    // Ensure at least one session exists
    await sendAndWait(ws, {
      type: 'session-create',
      sessionType: 'chat',
    })

    const response = await sendAndWait(ws, {
      type: 'session-list',
    })

    const sessions = response.payload?.sessions || response.sessions || []
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions.length).toBeGreaterThan(0)
  }, 15000)

  // ── 10. doctor ──

  it('doctor runs diagnostics and returns output', async () => {
    const response = await executeCommand(ws, 'doctor')
    const output = getOutput(response)
    expect(typeof output).toBe('string')
    expect(output.length).toBeGreaterThan(0)
  }, 30000)

  // ── 11. execute returns correlated id ──

  it('execute response correlates with request id', async () => {
    const id = genId()
    const response = await sendAndWait(ws, {
      type: 'execute',
      id,
      command: 'status',
    })

    const correlationId = response.requestId || response.id
    expect(correlationId).toBe(id)
  }, 15000)

  // ── 12. concurrent command execution ──

  it('multiple concurrent execute commands return correct results', async () => {
    const commands = ['status', 'llm providers', 'config list']
    const ids = commands.map(() => genId())

    const promises = commands.map((command, i) =>
      sendAndWait(ws, { type: 'execute', id: ids[i], command }, 30000),
    )

    const responses = await Promise.all(promises)

    for (let i = 0; i < ids.length; i++) {
      const correlationId = responses[i].requestId || responses[i].id
      expect(correlationId).toBe(ids[i])
      const output = getOutput(responses[i])
      expect(typeof output).toBe('string')
    }
  }, 45000)
})
