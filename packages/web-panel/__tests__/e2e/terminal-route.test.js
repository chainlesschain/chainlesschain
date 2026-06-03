/**
 * @vitest-environment node
 *
 * E2E test for Plan A remote-terminal — spawns the real `cc ui`
 * subprocess, opens its WS gateway as a real WebSocket client, and
 * verifies the terminal.* envelope round-trip on the SAME wire the
 * web-panel SPA uses.
 *
 * Distinct from the desktop-app-vue test `terminal-ws-smoke.test.js`
 * (which boots ws-cli-loader in-process with a fake node-pty) and
 * `terminal-real-pty-smoke.test.js` (which uses real node-pty but
 * skips the cc-ui subprocess layer). This file proves the cc-ui mirror
 * (Phase 1.5) actually works through the deployed CLI binary.
 *
 * Skipped when node-pty isn't loadable in the CLI's Node — same gate
 * as the desktop real-pty smoke.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import WebSocket from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cliRoot = path.join(__dirname, '..', '..', '..', 'cli')
const bin = path.join(cliRoot, 'bin', 'chainlesschain.js')

// Skip the suite if node-pty isn't loadable in the CLI's Node env.
const require = createRequire(import.meta.url)
let nodePtyAvailable = false
try {
  require.resolve('node-pty', { paths: [cliRoot, path.join(cliRoot, '..', '..', 'desktop-app-vue')] })
  nodePtyAvailable = true
} catch {
  nodePtyAvailable = false
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function startUiServer({ httpPort, wsPort }) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      bin, 'ui', '--no-open',
      '--port', String(httpPort),
      '--ws-port', String(wsPort),
    ], {
      env: { ...process.env, FORCE_COLOR: '0' },
      cwd: os.tmpdir(),
    })
    let out = ''
    let resolved = false
    const onData = (data) => {
      out += data.toString('utf8')
      const httpMatch = out.match(/UI:\s+http:\/\/127\.0\.0\.1:(\d+)/)
      const wsMatch = out.match(/WS:\s+ws:\/\/127\.0\.0\.1:(\d+)/)
      if (!resolved && httpMatch) {
        resolved = true
        resolve({
          proc,
          port: Number(httpMatch[1]),
          actualWsPort: wsMatch ? Number(wsMatch[1]) : wsPort,
        })
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', reject)
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error(`cc ui never printed UI banner. Output:\n${out}`))
      }
    }, 15000)
  })
}

async function stopUiServer({ proc }) {
  if (!proc) return
  return new Promise((resolve) => {
    proc.once('exit', () => resolve())
    try { proc.kill('SIGTERM') } catch { /* already dead */ }
    setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* idempotent */ }
      resolve()
    }, 3000)
  })
}

async function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function waitForFrame(ws, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const seen = []
    const onMsg = (raw) => {
      let f
      try { f = JSON.parse(raw.toString('utf-8')) } catch { return }
      seen.push(f)
      const match = typeof predicate === 'function' ? predicate(f) : f.type === predicate
      if (match) {
        ws.off('message', onMsg)
        clearTimeout(t)
        resolve(f)
      }
    }
    const t = setTimeout(() => {
      ws.off('message', onMsg)
      reject(new Error(`waitForFrame timeout. types seen: ${seen.map((x) => x.type).join(', ')}`))
    }, timeoutMs)
    ws.on('message', onMsg)
  })
}

describe.skipIf(!nodePtyAvailable)('cc ui terminal.* e2e — real subprocess', () => {
  let handle
  let httpPort
  let wsPort
  let wsClient

  beforeAll(async () => {
    httpPort = await findFreePort()
    wsPort = await findFreePort()
    handle = await startUiServer({ httpPort, wsPort })
    wsClient = await openWs(`ws://127.0.0.1:${handle.actualWsPort}/`)
  }, 30000)

  afterAll(async () => {
    try { wsClient?.close() } catch { /* ignore */ }
    await stopUiServer(handle)
  })

  it('terminal.create returns a sessionId and pid through real cc ui WS', async () => {
    wsClient.send(JSON.stringify({
      id: 'e2e-create-1',
      type: 'terminal.create',
      payload: { shell: process.platform === 'win32' ? 'cmd' : 'bash' },
    }))
    const f = await waitForFrame(wsClient, 'terminal.create.result', 15000)
    expect(f.ok).toBe(true)
    expect(f.result.sessionId).toBeTruthy()
    expect(typeof f.result.pid).toBe('number')
  }, 30000)

  it('stdin → stdout round-trip via real shell + real WS', async () => {
    const shell = process.platform === 'win32' ? 'cmd' : 'bash'
    wsClient.send(JSON.stringify({
      id: 'e2e-create-2',
      type: 'terminal.create',
      payload: { shell },
    }))
    const created = await waitForFrame(wsClient, 'terminal.create.result', 15000)
    const sessionId = created.result.sessionId
    await new Promise((r) => setTimeout(r, 800))

    const probe = 'WS_E2E_PROBE_77'
    const stdin = shell === 'cmd' ? `echo ${probe}\r\n` : `echo ${probe}\n`
    wsClient.send(JSON.stringify({
      id: 'e2e-stdin-1',
      type: 'terminal.stdin',
      payload: {
        sessionId,
        data: Buffer.from(stdin, 'utf-8').toString('base64'),
      },
    }))

    // Wait for any stdout frame containing the probe.
    const stdoutFrame = await new Promise((resolve, reject) => {
      let accumulated = ''
      const onMsg = (raw) => {
        let f
        try { f = JSON.parse(raw.toString('utf-8')) } catch { return }
        if (f.type !== 'terminal.stdout' || f.payload?.sessionId !== sessionId) return
        accumulated += Buffer.from(f.payload.data, 'base64').toString('utf-8')
        if (accumulated.includes(probe)) {
          wsClient.off('message', onMsg)
          clearTimeout(t)
          resolve(accumulated)
        }
      }
      const t = setTimeout(() => {
        wsClient.off('message', onMsg)
        reject(new Error(`No stdout probe within 12s. Got:\n${accumulated}`))
      }, 12000)
      wsClient.on('message', onMsg)
    })
    expect(stdoutFrame).toContain(probe)
  }, 45000)

  it('terminal.list reflects active sessions', async () => {
    wsClient.send(JSON.stringify({ id: 'e2e-list-1', type: 'terminal.list', payload: {} }))
    const f = await waitForFrame(wsClient, 'terminal.list.result', 10000)
    expect(f.ok).toBe(true)
    expect(Array.isArray(f.result.sessions)).toBe(true)
    // At least one session from the prior tests (create #1 + create #2 are still alive).
    expect(f.result.sessions.length).toBeGreaterThan(0)
  })
})
