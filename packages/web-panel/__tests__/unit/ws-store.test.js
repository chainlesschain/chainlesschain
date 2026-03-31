/**
 * Unit tests for src/stores/ws.js
 *
 * Key scenarios:
 * - execute() reads server's `stdout` field (not `output`)
 * - waitConnected() waits for status to become connected
 * - execute() falls back to stderr when stdout is empty
 * - sendRaw() rejects immediately when socket not open
 * - Reconnect is scheduled on close
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── WebSocket mock ─────────────────────────────────────────────────────────────
class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = MockWebSocket.CONNECTING
    MockWebSocket._last = this
  }
  send(data) { this._sent = (this._sent || []).concat(JSON.parse(data)) }
  close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.() }

  // Test helpers
  _open()  { this.readyState = MockWebSocket.OPEN;   this.onopen?.() }
  _message(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  _error() { this.readyState = MockWebSocket.CLOSED; this.onerror?.() }
}
MockWebSocket.CONNECTING = 0
MockWebSocket.OPEN       = 1
MockWebSocket.CLOSED     = 3
MockWebSocket._last      = null

vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('window', { __CC_CONFIG__: { wsHost: '127.0.0.1', wsPort: 9999 } })

// Silence reconnect timers
vi.useFakeTimers()

import { useWsStore } from '../../src/stores/ws.js'

// Flush the microtask queued by `await waitConnected()` inside execute(),
// so that sendRaw() has run and _sent is populated before we read it.
const flushMicrotasks = () => Promise.resolve()

describe('ws store — execute() stdout field mapping', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllTimers()
    MockWebSocket._last = null
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  async function connectAndReady(store) {
    store.connect()
    MockWebSocket._last._open()
    // Let the status update propagate
    await Promise.resolve()
  }

  it('execute() returns output from server stdout field', async () => {
    const store = useWsStore()
    await connectAndReady(store)

    const p = store.execute('skill list', 5000)
    await flushMicrotasks() // let execute() run past await waitConnected()
    const req = MockWebSocket._last._sent.at(-1)

    // Server responds with stdout (not output)
    MockWebSocket._last._message({
      id: req.id,
      type: 'result',
      stdout: 'Skills (3):\n  ai (1)\n    ● my-skill   A skill [bundled]',
      stderr: '',
      exitCode: 0,
    })

    const { output, exitCode } = await p
    expect(output).toContain('Skills (3)')
    expect(output).toContain('my-skill')
    expect(exitCode).toBe(0)
  })

  it('execute() falls back to stderr when stdout is empty', async () => {
    const store = useWsStore()
    await connectAndReady(store)

    const p = store.execute('status', 5000)
    await flushMicrotasks()
    const req = MockWebSocket._last._sent.at(-1)

    MockWebSocket._last._message({
      id: req.id,
      type: 'result',
      stdout: '',
      stderr: 'some error output',
      exitCode: 1,
    })

    const { output } = await p
    expect(output).toBe('some error output')
  })

  it('execute() still works if server sends legacy output field', async () => {
    const store = useWsStore()
    await connectAndReady(store)

    const p = store.execute('status', 5000)
    await flushMicrotasks()
    const req = MockWebSocket._last._sent.at(-1)

    MockWebSocket._last._message({
      id: req.id,
      type: 'result',
      output: 'legacy output field',
      exitCode: 0,
    })

    const { output } = await p
    expect(output).toBe('legacy output field')
  })

  it('sendRaw rejects when socket is not open', async () => {
    const store = useWsStore()
    store.connect()
    // Do NOT call _open() — socket stays CONNECTING
    // waitConnected() polls via setTimeout; advance past its 8s deadline
    const p = store.execute('status', 100)
    vi.advanceTimersByTime(9000)
    await expect(p).rejects.toThrow()
  })
})

describe('ws store — waitConnected()', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllTimers()
    MockWebSocket._last = null
  })

  it('resolves immediately when already connected', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    await expect(store.waitConnected(1000)).resolves.toBeUndefined()
  })

  it('rejects when status is error', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._error()
    await Promise.resolve()

    // fast-forward timer ticks inside waitConnected
    const p = store.waitConnected(200)
    vi.advanceTimersByTime(300)
    await expect(p).rejects.toThrow()
  })
})

describe('ws store — message routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllTimers()
    MockWebSocket._last = null
  })

  it('rejects pending request on socket close', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const p = store.execute('status', 5000)
    // Flush so sendRaw() registers the pending entry before close fires
    await flushMicrotasks()
    MockWebSocket._last.close()

    await expect(p).rejects.toThrow('WebSocket closed')
  })

  it('error message type rejects pending promise', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const p = store.execute('bad-command', 5000)
    await flushMicrotasks()
    const req = MockWebSocket._last._sent.at(-1)

    MockWebSocket._last._message({
      id: req.id,
      type: 'error',
      message: 'Command blocked',
    })

    await expect(p).rejects.toThrow('Command blocked')
  })
})
