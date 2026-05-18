/**
 * useLlmChat composable — unit tests.
 *
 * Mocks ws.sendStream so tests don't need a real WebSocket. The composable
 * has two surface shapes:
 *   - chat({messages}) → { stream: AsyncIterable, result: Promise }
 *   - chatTo({messages, onDelta}) → Promise<finalResult>
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

let sendStreamImpl = null
const sendStreamCalls = []

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    sendStream: (...args) => {
      sendStreamCalls.push(args)
      return sendStreamImpl(...args)
    },
  }),
}))

import { useLlmChat } from '../../src/composables/useLlmChat.js'

beforeEach(() => {
  sendStreamCalls.length = 0
  sendStreamImpl = null
})

/**
 * Build a fake sendStream that fires `deltas` via onChunk asynchronously,
 * then resolves with `final` (or rejects with `failWith`).
 */
function fakeSendStream({ deltas = [], final = { done: true }, failWith = null }) {
  return (_payload, options) => {
    return new Promise((resolve, reject) => {
      let i = 0
      const tick = () => {
        if (i < deltas.length) {
          options.onChunk({ delta: deltas[i], content: deltas.slice(0, i + 1).join('') })
          i++
          queueMicrotask(tick)
        } else if (failWith) {
          reject(failWith)
        } else {
          resolve(final)
        }
      }
      queueMicrotask(tick)
    })
  }
}

describe('useLlmChat.chat — async iterable', () => {
  it('yields one item per chunk and resolves result with the final value', async () => {
    sendStreamImpl = fakeSendStream({
      deltas: ['He', 'llo'],
      final: { message: { role: 'assistant', content: 'Hello' }, tokens: 2 },
    })
    const { chat } = useLlmChat()
    const { stream, result } = chat({
      messages: [{ role: 'user', content: 'Hi' }],
    })
    const collected = []
    for await (const c of stream) {
      collected.push(c.delta)
    }
    expect(collected).toEqual(['He', 'llo'])
    const final = await result
    expect(final.tokens).toBe(2)
  })

  it('forwards options + idleMs to sendStream', async () => {
    sendStreamImpl = fakeSendStream({})
    const { chat } = useLlmChat()
    const { result } = chat({
      messages: [{ role: 'user', content: 'Hi' }],
      options: { model: 'qwen2.5' },
      idleMs: 1234,
    })
    await result
    expect(sendStreamCalls[0][0]).toEqual({
      type: 'llm.chat',
      messages: [{ role: 'user', content: 'Hi' }],
      options: { model: 'qwen2.5' },
    })
    expect(sendStreamCalls[0][1].idleMs).toBe(1234)
  })

  it('throws messages array required when messages is missing', () => {
    const { chat } = useLlmChat()
    expect(() => chat({})).toThrow('messages array is required')
    expect(() => chat({ messages: 'hi' })).toThrow('messages array is required')
    expect(sendStreamCalls).toHaveLength(0)
  })

  it('propagates sendStream rejection to result + ends stream cleanly', async () => {
    sendStreamImpl = fakeSendStream({
      deltas: ['ok'],
      failWith: new Error('upstream_died'),
    })
    const { chat } = useLlmChat()
    const { stream, result } = chat({
      messages: [{ role: 'user', content: 'x' }],
    })
    let caught = null
    const collected = []
    try {
      for await (const c of stream) {
        collected.push(c.delta)
      }
    } catch (e) {
      caught = e
    }
    expect(collected).toEqual(['ok'])
    expect(caught?.message).toBe('upstream_died')
    await expect(result).rejects.toThrow('upstream_died')
  })
})

describe('useLlmChat.chat — cancellation', () => {
  it('chat() returns a cancel() that rejects result with Error("aborted")', async () => {
    let abortHook = null
    sendStreamImpl = (_payload, options) => {
      return new Promise((resolve, reject) => {
        // Hook the abort path so the test can drive it.
        if (options.signal) {
          abortHook = () => {
            const reason = options.signal.reason instanceof Error
              ? options.signal.reason
              : new Error('aborted')
            reject(reason)
          }
          options.signal.addEventListener('abort', abortHook, { once: true })
        }
        // Emit one chunk so the stream isn't completely empty.
        queueMicrotask(() => options.onChunk({ delta: 'a', content: 'a' }))
        // Don't resolve — wait for abort or timeout.
      })
    }
    const { chat } = useLlmChat()
    const { stream, result, cancel } = chat({
      messages: [{ role: 'user', content: 'x' }],
    })
    // Drain a tick so the chunk gets queued.
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.value.delta).toBe('a')
    cancel()
    await expect(result).rejects.toThrow('aborted')
  })

  it('cancel() is idempotent — calling twice does not double-reject', async () => {
    sendStreamImpl = (_payload, options) => {
      return new Promise((_resolve, reject) => {
        if (options.signal) {
          options.signal.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          )
        }
      })
    }
    const { chat } = useLlmChat()
    const { result, cancel } = chat({
      messages: [{ role: 'user', content: 'x' }],
    })
    cancel()
    cancel() // second call should be a noop
    await expect(result).rejects.toThrow('aborted')
  })

  it('honours an externally-supplied AbortSignal', async () => {
    sendStreamImpl = (_payload, options) => {
      return new Promise((_resolve, reject) => {
        if (options.signal) {
          options.signal.addEventListener(
            'abort',
            () => reject(new Error('external_abort')),
            { once: true },
          )
        }
      })
    }
    const externalCtrl = new AbortController()
    const { chat } = useLlmChat()
    const { result } = chat({
      messages: [{ role: 'user', content: 'x' }],
      signal: externalCtrl.signal,
    })
    externalCtrl.abort(new Error('external_abort'))
    await expect(result).rejects.toThrow('external_abort')
  })
})

describe('useLlmChat.chatTo — callback shape', () => {
  it('drains chunks into onDelta and returns the terminal result', async () => {
    sendStreamImpl = fakeSendStream({
      deltas: ['a', 'b', 'c'],
      final: { tokens: 3 },
    })
    const { chatTo } = useLlmChat()
    const seen = []
    const final = await chatTo({
      messages: [{ role: 'user', content: 'x' }],
      onDelta: (c) => seen.push(c.delta),
    })
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(final).toEqual({ tokens: 3 })
  })

  it('still works when onDelta is omitted', async () => {
    sendStreamImpl = fakeSendStream({ deltas: ['a'], final: { tokens: 1 } })
    const { chatTo } = useLlmChat()
    const final = await chatTo({ messages: [{ role: 'user', content: 'x' }] })
    expect(final.tokens).toBe(1)
  })

  it('rejects on stream error', async () => {
    sendStreamImpl = fakeSendStream({
      deltas: [],
      failWith: new Error('boom'),
    })
    const { chatTo } = useLlmChat()
    await expect(
      chatTo({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('boom')
  })
})
