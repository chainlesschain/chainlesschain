/**
 * Unit tests for src/composables/useLlmChat.js
 *
 * useLlmChat streams chat tokens over the WS `llm.chat` topic through a custom
 * async-queue, with cancel()/external-signal abort wiring. The queue + abort
 * semantics are the bug-prone part, so they are pinned here with a deferred fake
 * sendStream that lets the test drive chunks + terminal resolution. WS store
 * mocked; no socket.
 *
 * Run: npx vitest run __tests__/unit/useLlmChat.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendStream } = vi.hoisted(() => ({ sendStream: vi.fn() }))
vi.mock('../../src/stores/ws.js', () => ({ useWsStore: () => ({ sendStream }) }))

import { useLlmChat } from '../../src/composables/useLlmChat.js'

/** Each chat() call captures its message + stream options here. */
let captured
beforeEach(() => {
  captured = null
  sendStream.mockReset()
  sendStream.mockImplementation((msg, opts) => {
    captured = { msg, opts }
    return new Promise((resolve, reject) => {
      captured.resolve = resolve
      captured.reject = reject
    })
  })
})

const MESSAGES = [{ role: 'user', content: 'Hi' }]

async function drain(stream) {
  const out = []
  for await (const c of stream) out.push(c)
  return out
}

describe('chat — validation + request shaping', () => {
  it('throws when messages is not an array', () => {
    expect(() => useLlmChat().chat({})).toThrow(/messages array is required/)
    expect(() => useLlmChat().chat({ messages: 'x' })).toThrow(/messages array is required/)
  })

  it('sends llm.chat with messages, default options and a 60s idle', () => {
    useLlmChat().chat({ messages: MESSAGES })
    expect(captured.msg).toEqual({ type: 'llm.chat', messages: MESSAGES, options: {} })
    expect(captured.opts.idleMs).toBe(60000)
  })

  it('honors a custom idleMs and options', () => {
    useLlmChat().chat({ messages: MESSAGES, options: { temp: 0.2 }, idleMs: 5000 })
    expect(captured.msg.options).toEqual({ temp: 0.2 })
    expect(captured.opts.idleMs).toBe(5000)
  })
})

describe('chat — streaming through the queue', () => {
  it('yields buffered chunks then resolves the result', async () => {
    const { stream, result } = useLlmChat().chat({ messages: MESSAGES })
    captured.opts.onChunk({ delta: 'He', content: 'He' })
    captured.opts.onChunk({ delta: 'llo', content: 'Hello' })
    captured.resolve({ message: { content: 'Hello' }, model: 'm' })

    expect(await drain(stream)).toEqual([
      { delta: 'He', content: 'He' },
      { delta: 'llo', content: 'Hello' },
    ])
    expect(await result).toEqual({ message: { content: 'Hello' }, model: 'm' })
  })

  it('propagates a stream error to both result and the iterator', async () => {
    const { stream, result } = useLlmChat().chat({ messages: MESSAGES })
    captured.reject(new Error('stream fail'))
    await expect(result).rejects.toThrow('stream fail')
    await expect(drain(stream)).rejects.toThrow('stream fail')
  })
})

describe('chat — cancellation', () => {
  it('cancel() aborts the internal signal handed to sendStream', () => {
    const { cancel } = useLlmChat().chat({ messages: MESSAGES })
    expect(captured.opts.signal.aborted).toBe(false)
    cancel()
    expect(captured.opts.signal.aborted).toBe(true)
  })

  it('mirrors an already-aborted external signal', () => {
    const ac = new AbortController()
    ac.abort(new Error('external'))
    useLlmChat().chat({ messages: MESSAGES, signal: ac.signal })
    expect(captured.opts.signal.aborted).toBe(true)
  })

  it('mirrors a later external abort into the internal signal', () => {
    const ac = new AbortController()
    useLlmChat().chat({ messages: MESSAGES, signal: ac.signal })
    expect(captured.opts.signal.aborted).toBe(false)
    ac.abort(new Error('later'))
    expect(captured.opts.signal.aborted).toBe(true)
  })
})

describe('chatTo — drains into onDelta', () => {
  it('feeds each chunk to onDelta and returns the terminal result', async () => {
    const deltas = []
    const p = useLlmChat().chatTo({
      messages: MESSAGES,
      onDelta: (c) => deltas.push(c.delta),
    })
    captured.opts.onChunk({ delta: 'a', content: 'a' })
    captured.opts.onChunk({ delta: 'b', content: 'ab' })
    captured.resolve({ message: { content: 'ab' } })
    const final = await p
    expect(deltas).toEqual(['a', 'b'])
    expect(final).toEqual({ message: { content: 'ab' } })
  })

  it('swallows the stream error but still surfaces it via the result', async () => {
    const p = useLlmChat().chatTo({ messages: MESSAGES })
    captured.reject(new Error('boom'))
    await expect(p).rejects.toThrow('boom')
  })
})
