/**
 * Unit tests for src/composables/useTerminal.js
 *
 * useTerminal multiplexes pty sessions over the WS terminal.* topics with a
 * module-singleton fan-out (per-session + "any session" subscriptions) and
 * UTF-8 base64 transcoding for stdin/stdout/history. The module ships
 * _resetTerminalSubsForTest + an `_internal` seam specifically for unit tests.
 * Pinned here: base64 UTF-8 round-trip (incl. CJK/emoji), the WS message
 * fan-out + decode, subscription add/unsubscribe + empty-set cleanup, and the
 * command methods' encode/decode + error handling. WS store mocked; no socket.
 *
 * Run: npx vitest run __tests__/unit/useTerminal.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { onMessage, sendRaw } = vi.hoisted(() => ({
  onMessage: vi.fn(),
  sendRaw: vi.fn(),
}))
vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ onMessage, sendRaw }),
}))

import {
  useTerminal,
  _resetTerminalSubsForTest,
} from '../../src/composables/useTerminal.js'

beforeEach(() => {
  _resetTerminalSubsForTest()
  onMessage.mockReset()
  sendRaw.mockReset()
  sendRaw.mockResolvedValue({ ok: true, result: {} })
})

/** Drive the singleton WS handler installed by the first useTerminal(). */
function emit(msg) {
  onMessage.mock.calls[0][0](msg)
}

describe('base64 UTF-8 transcoding', () => {
  it('round-trips ASCII, CJK and emoji', () => {
    const { _internal } = useTerminal()
    const { toBase64Utf8, fromBase64Utf8 } = _internal
    for (const s of ['hello', '你好世界', 'emoji 😀🚀', '']) {
      expect(fromBase64Utf8(toBase64Utf8(s))).toBe(s)
    }
  })
})

describe('WS stdout fan-out', () => {
  it('decodes base64 stdout and delivers to the session subscriber', () => {
    const term = useTerminal()
    const b64 = term._internal.toBase64Utf8('你好')
    const got = []
    term.onStdout('s1', (e) => got.push(e))
    emit({ type: 'terminal.stdout', payload: { sessionId: 's1', data: b64, seq: 3 } })
    expect(got).toEqual([{ sessionId: 's1', data: '你好', seq: 3 }])
  })

  it('routes only to the matching session, plus the any-session subscribers', () => {
    const term = useTerminal()
    const b64 = term._internal.toBase64Utf8('x')
    const s1 = []
    const any = []
    term.onStdout('s1', (e) => s1.push(e.sessionId))
    term.onStdout(null, (e) => any.push(e.sessionId))
    emit({ type: 'terminal.stdout', payload: { sessionId: 's2', data: b64 } })
    expect(s1).toEqual([]) // not for s1
    expect(any).toEqual(['s2']) // any-session sees it
  })

  it('delivers terminal.exit to exit subscribers', () => {
    const term = useTerminal()
    const got = []
    term.onExit('s1', (e) => got.push(e))
    emit({ type: 'terminal.exit', payload: { sessionId: 's1', exitCode: 0, signal: null } })
    expect(got).toEqual([{ sessionId: 's1', exitCode: 0, signal: null }])
  })

  it('ignores malformed or session-less messages without throwing', () => {
    const term = useTerminal()
    const got = []
    term.onStdout('s1', (e) => got.push(e))
    expect(() => {
      emit(null)
      emit({ type: 'terminal.stdout', payload: {} }) // no sessionId
      emit({ noType: true })
    }).not.toThrow()
    expect(got).toEqual([])
  })
})

describe('subscription lifecycle', () => {
  it('unsubscribe stops delivery and cleans the empty set', () => {
    const term = useTerminal()
    const b64 = term._internal.toBase64Utf8('y')
    const got = []
    const off = term.onStdout('s1', (e) => got.push(e))
    emit({ type: 'terminal.stdout', payload: { sessionId: 's1', data: b64 } })
    off()
    emit({ type: 'terminal.stdout', payload: { sessionId: 's1', data: b64 } })
    expect(got).toHaveLength(1) // only the pre-unsubscribe event
    expect(term._internal.stdoutSubs.has('s1')).toBe(false) // empty set pruned
  })
})

describe('command methods', () => {
  it('create returns result and throws on ok:false', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { sessionId: 's9', pid: 1 } })
    expect(await useTerminal().create({ shell: 'bash' })).toEqual({ sessionId: 's9', pid: 1 })

    sendRaw.mockResolvedValueOnce({ ok: false, error: 'nope' })
    await expect(useTerminal().create()).rejects.toThrow('nope')
  })

  it('stdin base64-encodes the data', async () => {
    const term = useTerminal()
    await term.stdin('s1', 'echo 你好')
    const payload = sendRaw.mock.calls.at(-1)[0].payload
    expect(payload.sessionId).toBe('s1')
    expect(term._internal.fromBase64Utf8(payload.data)).toBe('echo 你好')
  })

  it('list returns the sessions array (empty when absent)', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { sessions: [{ id: 'a' }] } })
    expect(await useTerminal().list()).toEqual([{ id: 'a' }])
    sendRaw.mockResolvedValueOnce({ ok: true, result: {} })
    expect(await useTerminal().list()).toEqual([])
  })

  it('history base64-decodes each chunk', async () => {
    const term = useTerminal()
    const b64 = term._internal.toBase64Utf8('out-data')
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { truncated: true, chunks: [{ seq: 5, data: b64 }] },
    })
    const h = await term.history('s1', 2)
    expect(h.truncated).toBe(true)
    expect(h.chunks).toEqual([{ seq: 5, data: 'out-data' }])
  })

  it('close/resize throw on ok:false', async () => {
    sendRaw.mockResolvedValue({ ok: false, error: 'boom' })
    await expect(useTerminal().close('s1')).rejects.toThrow('boom')
    await expect(useTerminal().resize('s1', 80, 24)).rejects.toThrow('boom')
  })
})
