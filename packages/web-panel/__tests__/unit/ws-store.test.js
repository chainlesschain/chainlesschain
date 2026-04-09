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

  it('maps protocol messages into runtime events for panel subscribers', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const runtimeHandler = vi.fn()
    store.onRuntimeEvent(runtimeHandler)

    MockWebSocket._last._message({
      type: 'task:notification',
      task: { id: 'task-1', status: 'completed' },
    })
    MockWebSocket._last._message({
      id: 'req-1',
      type: 'compression-stats',
      summary: { totalSavedTokens: 42 },
    })

    expect(runtimeHandler).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'task:notification',
        kind: 'server',
        payload: {
          task: { id: 'task-1', status: 'completed' },
        },
      }),
      expect.objectContaining({
        type: 'task:notification',
      }),
    )
    expect(runtimeHandler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'compression:summary',
        kind: 'server',
        payload: expect.objectContaining({
          requestId: 'req-1',
          summary: { totalSavedTokens: 42 },
        }),
      }),
      expect.objectContaining({
        type: 'compression-stats',
      }),
    )
  })

  it('maps worktree protocol messages into runtime events with normalized record payloads', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const runtimeHandler = vi.fn()
    store.onRuntimeEvent(runtimeHandler)

    MockWebSocket._last._message({
      id: 'req-worktree-1',
      type: 'worktree-diff',
      branch: 'agent/task-42',
      summary: { changedFiles: 3 },
      record: {
        branch: 'agent/task-42',
        summary: { changedFiles: 3 },
        previewEntrypoints: [{ type: 'worktree-diff', branch: 'agent/task-42' }],
      },
    })
    MockWebSocket._last._message({
      id: 'req-worktree-2',
      type: 'worktree-merged',
      branch: 'agent/task-42',
      summary: { conflictedFiles: 1 },
      record: {
        branch: 'agent/task-42',
        summary: { conflictedFiles: 1 },
        conflicts: [{ path: 'src/index.js', type: 'both_modified' }],
        previewEntrypoints: [{ type: 'worktree-diff', branch: 'agent/task-42' }],
      },
    })

    expect(runtimeHandler).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'worktree:diff:ready',
        payload: expect.objectContaining({
          requestId: 'req-worktree-1',
          record: expect.objectContaining({
            branch: 'agent/task-42',
            summary: { changedFiles: 3 },
          }),
        }),
      }),
      expect.objectContaining({
        type: 'worktree-diff',
      }),
    )
    expect(runtimeHandler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'worktree:merge:completed',
        payload: expect.objectContaining({
          requestId: 'req-worktree-2',
          record: expect.objectContaining({
            branch: 'agent/task-42',
            summary: { conflictedFiles: 1 },
            conflicts: [{ path: 'src/index.js', type: 'both_modified' }],
          }),
        }),
      }),
      expect.objectContaining({
        type: 'worktree-merged',
      }),
    )
  })

  it('emits runtime events even when a response resolves a pending request', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const runtimeHandler = vi.fn()
    store.onRuntimeEvent(runtimeHandler)

    const request = store.sendRaw({ type: 'compression-stats' }, 5000)
    await flushMicrotasks()
    const req = MockWebSocket._last._sent.at(-1)

    MockWebSocket._last._message({
      id: req.id,
      type: 'compression-stats',
      summary: { totalSavedTokens: 64 },
    })

    await expect(request).resolves.toEqual(
      expect.objectContaining({
        type: 'compression-stats',
        summary: { totalSavedTokens: 64 },
      }),
    )
    expect(runtimeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'compression:summary',
        payload: expect.objectContaining({
          requestId: req.id,
          summary: { totalSavedTokens: 64 },
        }),
      }),
      expect.objectContaining({
        type: 'compression-stats',
      }),
    )
  })

  it('maps session protocol responses into runtime events with normalized record payloads', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const runtimeHandler = vi.fn()
    store.onRuntimeEvent(runtimeHandler)

    MockWebSocket._last._message({
      type: 'session-created',
      sessionId: 'sess-11',
      sessionType: 'agent',
      record: {
        id: 'sess-11',
        type: 'agent',
        status: 'created',
        messageCount: 0,
      },
    })
    MockWebSocket._last._message({
      type: 'session-resumed',
      sessionId: 'sess-11',
      history: [{ role: 'user', content: 'hello' }],
      record: {
        id: 'sess-11',
        type: 'agent',
        status: 'resumed',
        history: [{ role: 'user', content: 'hello' }],
        messageCount: 1,
      },
    })

    expect(runtimeHandler).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'session:start',
        sessionId: 'sess-11',
        payload: expect.objectContaining({
          sessionId: 'sess-11',
          sessionType: 'agent',
          record: expect.objectContaining({
            id: 'sess-11',
            type: 'agent',
            status: 'created',
            messageCount: 0,
          }),
        }),
      }),
      expect.objectContaining({
        type: 'session-created',
        sessionId: 'sess-11',
      }),
    )
    expect(runtimeHandler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'session:resume',
        sessionId: 'sess-11',
        payload: expect.objectContaining({
          sessionId: 'sess-11',
          historyCount: 1,
          record: expect.objectContaining({
            id: 'sess-11',
            type: 'agent',
            status: 'resumed',
            messageCount: 1,
          }),
        }),
      }),
      expect.objectContaining({
        type: 'session-resumed',
        sessionId: 'sess-11',
      }),
    )
  })

  it('closeSession emits a synthetic session:end runtime event after success', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const runtimeHandler = vi.fn()
    store.onRuntimeEvent(runtimeHandler)

    const closePromise = store.closeSession('sess-9')
    await flushMicrotasks()
    const req = MockWebSocket._last._sent.at(-1)

    MockWebSocket._last._message({
      id: req.id,
      type: 'result',
      success: true,
      sessionId: 'sess-9',
    })

    await closePromise
    expect(runtimeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session:end',
        sessionId: 'sess-9',
        payload: { sessionId: 'sess-9' },
      }),
      expect.objectContaining({
        type: 'result',
        sessionId: 'sess-9',
      }),
    )
  })

  it('resolves pending request using requestId from v1.0 envelope', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const p = store.sendRaw({ type: 'session-create', sessionType: 'chat' }, 5000)
    await flushMicrotasks()
    const req = MockWebSocket._last._sent.at(-1)

    // Server responds with v1.0 envelope: id is a new eventId, requestId is the correlation id
    MockWebSocket._last._message({
      version: '1.0',
      eventId: 'evt-random-uuid',
      id: 'evt-random-uuid',          // NOT the request id
      type: 'session.started',        // dot-case
      requestId: req.id,              // the original request id
      sessionId: 'sess-42',
      payload: { sessionId: 'sess-42', sessionType: 'chat' },
    })

    const result = await p
    expect(result.sessionId).toBe('sess-42')
    expect(result.id).toBe(req.id)  // flattened to correlation id
  })

  it('flattens v1.0 payload fields into resolved message', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const p = store.sendRaw({ type: 'session-list' }, 5000)
    await flushMicrotasks()
    const req = MockWebSocket._last._sent.at(-1)

    MockWebSocket._last._message({
      version: '1.0',
      id: 'evt-uuid-2',
      type: 'session.list',
      requestId: req.id,
      payload: { sessions: [{ id: 'sess-1', type: 'agent' }] },
    })

    const result = await p
    expect(result.sessions).toEqual([{ id: 'sess-1', type: 'agent' }])
  })

  it('routes v1.0 session events to stream handlers using payload.sessionId', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const handler = vi.fn()
    store.onSession('sess-77', handler)

    MockWebSocket._last._message({
      version: '1.0',
      id: 'evt-uuid-3',
      type: 'assistant.delta',
      requestId: 'req-1',
      sessionId: 'sess-77',
      payload: { sessionId: 'sess-77', delta: 'Hello' },
    })

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'assistant.delta',
        sessionId: 'sess-77',
        delta: 'Hello',
      }),
    )
  })

  it('maps v1.0 session.started to session:start runtime event', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const runtimeHandler = vi.fn()
    store.onRuntimeEvent(runtimeHandler)

    MockWebSocket._last._message({
      version: '1.0',
      id: 'evt-uuid-4',
      type: 'session.started',
      requestId: 'req-2',
      sessionId: 'sess-99',
      payload: {
        sessionId: 'sess-99',
        sessionType: 'chat',
        record: { id: 'sess-99', type: 'chat', status: 'created', messageCount: 0 },
      },
    })

    expect(runtimeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session:start',
        sessionId: 'sess-99',
        payload: expect.objectContaining({
          sessionId: 'sess-99',
          sessionType: 'chat',
        }),
      }),
      expect.anything(),
    )
  })

  it('listSessions normalizes returned session records', async () => {
    const store = useWsStore()
    store.connect()
    MockWebSocket._last._open()
    await Promise.resolve()

    const request = store.listSessions()
    await flushMicrotasks()
    const req = MockWebSocket._last._sent.at(-1)

    MockWebSocket._last._message({
      id: req.id,
      type: 'session-list-result',
      sessions: [
        {
          id: 'sess-21',
          type: 'agent',
          status: 'active',
          record: {
            id: 'sess-21',
            type: 'agent',
            provider: 'openai',
            model: 'gpt-4o-mini',
            projectRoot: 'C:/code/demo',
            messageCount: 3,
            history: [{ role: 'user', content: 'hello' }],
            status: 'active',
          },
        },
      ],
    })

    await expect(request).resolves.toEqual([
      expect.objectContaining({
        id: 'sess-21',
        type: 'agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        projectRoot: 'C:/code/demo',
        messageCount: 3,
        status: 'active',
        record: expect.objectContaining({
          id: 'sess-21',
          type: 'agent',
          messageCount: 3,
        }),
      }),
    ])
  })
})
