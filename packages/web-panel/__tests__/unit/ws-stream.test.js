/**
 * ws.js sendStream — unit tests.
 *
 * Drives the new streaming path with a fake socket: pushes `<topic>.chunk`
 * frames + a terminal `<topic>.result`, asserts onChunk is called per
 * chunk and the outer promise resolves on the terminal frame (or rejects
 * on ok:false).
 *
 * The test bypasses the real WebSocket by stubbing window.WebSocket so
 * `connect()` produces a controllable instance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

let fakeWs = null
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.OPEN
    this.sent = []
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    fakeWs = this
    // Fire onopen on next microtask so the store's connect() listeners attach
    // before we resolve.
    queueMicrotask(() => this.onopen?.({}))
  }
  send(data) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({})
  }
  // Test helper — feed a server-side frame back to the client
  emit(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  fakeWs = null
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = { wsHost: '127.0.0.1', wsPort: 18800 }
  globalThis.WebSocket = FakeWebSocket
  globalThis.window.WebSocket = FakeWebSocket
})

afterEach(() => {
  delete globalThis.window.__CC_CONFIG__
})

async function connectStore() {
  const { useWsStore } = await import('../../src/stores/ws.js')
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const ws = useWsStore()
  ws.connect()
  await ws.waitConnected(500)
  return ws
}

describe('ws.sendStream', () => {
  it('dispatches .chunk frames into onChunk and resolves on .result', async () => {
    const ws = await connectStore()
    const seen = []
    const p = ws.sendStream(
      { type: 'llm.chat', messages: [{ role: 'user', content: 'hi' }] },
      { onChunk: (chunk) => seen.push(chunk), idleMs: 0 },
    )

    // The store stamped its own id — read it off the sent payload.
    const sent = fakeWs.sent[0]
    const id = sent.id
    expect(typeof id).toBe('string')

    fakeWs.emit({ id, type: 'llm.chat.chunk', ok: true, chunk: { delta: 'He' } })
    fakeWs.emit({ id, type: 'llm.chat.chunk', ok: true, chunk: { delta: 'llo' } })
    fakeWs.emit({
      id,
      type: 'llm.chat.result',
      ok: true,
      result: { tokens: 2 },
    })

    const final = await p
    expect(seen.map((c) => c.delta)).toEqual(['He', 'llo'])
    expect(final).toEqual({ tokens: 2 })
  })

  it('rejects on terminal ok:false frames with the server error message', async () => {
    const ws = await connectStore()
    const p = ws.sendStream(
      { type: 'llm.chat', messages: [{ role: 'user', content: 'hi' }] },
      { onChunk: () => {}, idleMs: 0 },
    )
    const id = fakeWs.sent[0].id
    fakeWs.emit({
      id,
      type: 'llm.chat.result',
      ok: false,
      error: 'llm_unavailable',
    })
    await expect(p).rejects.toThrow('llm_unavailable')
  })

  it('rejects in-flight streams when the WS closes mid-stream', async () => {
    const ws = await connectStore()
    const p = ws.sendStream(
      { type: 'llm.chat', messages: [{ role: 'user', content: 'hi' }] },
      { onChunk: () => {}, idleMs: 0 },
    )
    const id = fakeWs.sent[0].id
    fakeWs.emit({ id, type: 'llm.chat.chunk', ok: true, chunk: { delta: 'a' } })
    fakeWs.close()
    await expect(p).rejects.toThrow('WebSocket closed')
  })

  it('rejects on idle timeout when no chunks arrive in time', async () => {
    // connect under real timers so waitConnected's polling can fire, then
    // switch to fake timers to deterministically drive the idle timeout.
    const ws = await connectStore()
    vi.useFakeTimers()
    try {
      const p = ws.sendStream(
        { type: 'llm.chat', messages: [{ role: 'user', content: 'hi' }] },
        { onChunk: () => {}, idleMs: 50 },
      )
      vi.advanceTimersByTime(100)
      await expect(p).rejects.toThrow('Stream idle timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('idle timer rearms on every chunk so a long live stream survives', async () => {
    const ws = await connectStore()
    vi.useFakeTimers()
    try {
      const seen = []
      const p = ws.sendStream(
        { type: 'llm.chat', messages: [{ role: 'user', content: 'hi' }] },
        { onChunk: (c) => seen.push(c), idleMs: 100 },
      )
      const id = fakeWs.sent[0].id

      // Three chunks, each at +60ms — never idle past the 100ms timeout.
      vi.advanceTimersByTime(60)
      fakeWs.emit({ id, type: 'llm.chat.chunk', ok: true, chunk: { delta: 'a' } })
      vi.advanceTimersByTime(60)
      fakeWs.emit({ id, type: 'llm.chat.chunk', ok: true, chunk: { delta: 'b' } })
      vi.advanceTimersByTime(60)
      fakeWs.emit({ id, type: 'llm.chat.chunk', ok: true, chunk: { delta: 'c' } })
      fakeWs.emit({ id, type: 'llm.chat.result', ok: true, result: { ok: 1 } })

      const final = await p
      expect(seen.map((c) => c.delta)).toEqual(['a', 'b', 'c'])
      expect(final).toEqual({ ok: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
})
