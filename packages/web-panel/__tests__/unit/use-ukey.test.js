/**
 * useUkey composable — unit tests.
 *
 * Mocks ws.sendStream so neither a real WebSocket nor a real UKey is
 * needed. The composable is a thin streaming wrapper around the
 * `ukey.sign` topic — verify it shapes the right frame, threads chunks
 * into onStage, and returns the manager's resolved value.
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

import { useUkey } from '../../src/composables/useUkey.js'

beforeEach(() => {
  sendStreamCalls.length = 0
  sendStreamImpl = null
})

/** Build a fake sendStream that fires stages then resolves with `final`. */
function fakeStream({ stages = [], final, failWith = null }) {
  return (_payload, options) => {
    return new Promise((resolve, reject) => {
      let i = 0
      const tick = () => {
        if (i < stages.length) {
          options.onChunk({ stage: stages[i] })
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

describe('useUkey.sign — happy path', () => {
  it('forwards data via ukey.sign topic + reports stages', async () => {
    sendStreamImpl = fakeStream({
      stages: ['pre_check', 'signing'],
      final: { success: true, signature: 'ABC', algorithm: 'SM2' },
    })
    const ukey = useUkey()
    const seenStages = []
    const r = await ukey.sign('payload', {
      onStage: (s) => seenStages.push(s),
    })
    expect(sendStreamCalls[0][0]).toEqual({
      type: 'ukey.sign',
      data: 'payload',
    })
    expect(sendStreamCalls[0][1].idleMs).toBe(60000)
    expect(seenStages).toEqual(['pre_check', 'signing'])
    expect(r).toEqual({
      success: true,
      signature: 'ABC',
      algorithm: 'SM2',
    })
  })

  it('returns driver-level failures verbatim (does NOT throw on success:false)', async () => {
    sendStreamImpl = fakeStream({
      stages: ['pre_check', 'signing'],
      final: {
        success: false,
        reason: 'device_locked',
        message: 'U-Key device is locked',
      },
    })
    const ukey = useUkey()
    const r = await ukey.sign('x')
    expect(r.success).toBe(false)
    expect(r.reason).toBe('device_locked')
    expect(r.message).toContain('locked')
  })

  it('honours custom idleMs', async () => {
    sendStreamImpl = fakeStream({ final: { success: true } })
    const ukey = useUkey()
    await ukey.sign('x', { idleMs: 5000 })
    expect(sendStreamCalls[0][1].idleMs).toBe(5000)
  })

  it('still works when onStage is omitted', async () => {
    sendStreamImpl = fakeStream({
      stages: ['pre_check'],
      final: { success: true, signature: 'sig' },
    })
    const ukey = useUkey()
    const r = await ukey.sign('x')
    expect(r.success).toBe(true)
  })

  it('ignores chunks without a string `stage` field (defensive)', async () => {
    // The handler should only ever emit {stage: ...}, but the composable
    // shouldn't blow up if a future chunk shape is added.
    sendStreamImpl = (_payload, options) => {
      return new Promise((resolve) => {
        queueMicrotask(() => {
          options.onChunk({ stage: 'pre_check' })
          options.onChunk({ unknownField: 'whatever' })
          options.onChunk({ stage: 42 }) // wrong type
          options.onChunk({ stage: 'signing' })
          resolve({ success: true })
        })
      })
    }
    const ukey = useUkey()
    const stages = []
    await ukey.sign('x', { onStage: (s) => stages.push(s) })
    expect(stages).toEqual(['pre_check', 'signing'])
  })
})

describe('useUkey.sign — input validation', () => {
  it('rejects when data is missing', async () => {
    const ukey = useUkey()
    await expect(ukey.sign()).rejects.toThrow('data is required')
  })

  it('rejects when data is empty string', async () => {
    const ukey = useUkey()
    await expect(ukey.sign('')).rejects.toThrow('data is required')
  })

  it('rejects when data is non-string', async () => {
    const ukey = useUkey()
    await expect(ukey.sign(42)).rejects.toThrow('data is required')
    await expect(ukey.sign({})).rejects.toThrow('data is required')
    await expect(ukey.sign(null)).rejects.toThrow('data is required')
  })

  it('does NOT touch sendStream when input is invalid', async () => {
    const ukey = useUkey()
    await expect(ukey.sign('')).rejects.toThrow()
    expect(sendStreamCalls).toHaveLength(0)
  })
})

describe('useUkey.sign — cancellation via AbortSignal', () => {
  it('forwards the signal to sendStream and rejects on abort', async () => {
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
    const ukey = useUkey()
    const ctrl = new AbortController()
    const p = ukey.sign('payload', { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toThrow('aborted')
    expect(sendStreamCalls[0][1].signal).toBe(ctrl.signal)
  })

  it('threads abort reason through when caller supplies one', async () => {
    sendStreamImpl = (_payload, options) => {
      return new Promise((_resolve, reject) => {
        if (options.signal) {
          options.signal.addEventListener(
            'abort',
            () => {
              const reason = options.signal.reason instanceof Error
                ? options.signal.reason
                : new Error('aborted')
              reject(reason)
            },
            { once: true },
          )
        }
      })
    }
    const ukey = useUkey()
    const ctrl = new AbortController()
    const p = ukey.sign('x', { signal: ctrl.signal })
    ctrl.abort(new Error('user_cancelled'))
    await expect(p).rejects.toThrow('user_cancelled')
  })
})

describe('useUkey.sign — error propagation', () => {
  it('rejects when sendStream rejects (protocol-level error)', async () => {
    sendStreamImpl = fakeStream({
      stages: ['pre_check'],
      failWith: new Error('ukey_unavailable'),
    })
    const ukey = useUkey()
    await expect(ukey.sign('x')).rejects.toThrow('ukey_unavailable')
  })

  it('rejects with WebSocket close error when sendStream rejects with such', async () => {
    sendStreamImpl = fakeStream({
      failWith: new Error('WebSocket closed'),
    })
    const ukey = useUkey()
    await expect(ukey.sign('x')).rejects.toThrow('WebSocket closed')
  })
})
