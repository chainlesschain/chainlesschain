/**
 * useTerminal composable — unit tests.
 *
 * Validates:
 *   - imperative API (create/list/stdin/resize/close/history) sends the
 *     correct envelope and unwraps result
 *   - stdin base64-encodes the payload
 *   - history base64-decodes chunks back to UTF-8 strings
 *   - module-singleton subscription fan-out (onStdout/onExit) routes by
 *     sessionId, calls all subscribers, supports unsubscribe
 *   - "any session" subscription receives all events
 *   - the ws.onMessage listener is installed exactly once across many
 *     useTerminal() calls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()
const onMessageRegistered = []
const onMessage = vi.fn((cb) => {
  onMessageRegistered.push(cb)
  return () => {}
})

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw, onMessage }),
}))

import { useTerminal, _resetTerminalSubsForTest } from '../../src/composables/useTerminal.js'

function emitWs(msg) {
  for (const cb of onMessageRegistered) cb(msg)
}

beforeEach(() => {
  sendRaw.mockReset()
  onMessage.mockClear()
  onMessageRegistered.length = 0
  _resetTerminalSubsForTest()
})

describe('useTerminal — imperative API', () => {
  it('create sends terminal.create envelope and returns result object', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: {
        sessionId: 'sess-1',
        pid: 999,
        shell: 'pwsh',
        createdAt: 1700000000000,
      },
    })
    const t = useTerminal()
    const res = await t.create({ shell: 'pwsh', cols: 80, rows: 24 })
    expect(sendRaw).toHaveBeenCalledWith({
      type: 'terminal.create',
      payload: { shell: 'pwsh', cwd: undefined, env: undefined, cols: 80, rows: 24 },
    })
    expect(res.sessionId).toBe('sess-1')
    expect(res.pid).toBe(999)
  })

  it('create surfaces ok:false error via thrown Error', async () => {
    sendRaw.mockResolvedValueOnce({ ok: false, error: 'shell_not_allowed' })
    const t = useTerminal()
    await expect(t.create({ shell: 'evil' })).rejects.toThrow('shell_not_allowed')
  })

  it('list unwraps result.sessions array', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: {
        sessions: [
          { id: 's1', shell: 'pwsh', alive: true, lastSeq: 5 },
        ],
      },
    })
    const t = useTerminal()
    const sessions = await t.list()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('s1')
  })

  it('list returns empty array when result.sessions missing', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: {} })
    const t = useTerminal()
    const sessions = await t.list()
    expect(sessions).toEqual([])
  })

  it('stdin base64-encodes UTF-8 and sends payload', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { ok: true } })
    const t = useTerminal()
    await t.stdin('sess-1', 'ls\r')
    const call = sendRaw.mock.calls[0][0]
    expect(call.type).toBe('terminal.stdin')
    expect(call.payload.sessionId).toBe('sess-1')
    // 'ls\r' = 6c 73 0d → "bHMNCg==" no, just "bHMN" (3 bytes)
    expect(call.payload.data).toBe(
      Buffer.from('ls\r', 'utf-8').toString('base64'),
    )
  })

  it('stdin encodes multi-byte UTF-8 (CJK) correctly', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { ok: true } })
    const t = useTerminal()
    await t.stdin('sess-1', '中文测试')
    const call = sendRaw.mock.calls[0][0]
    // Server-side decode should round-trip to original string
    const b64 = call.payload.data
    const decoded = Buffer.from(b64, 'base64').toString('utf-8')
    expect(decoded).toBe('中文测试')
  })

  it('resize sends cols+rows', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { ok: true } })
    const t = useTerminal()
    await t.resize('sess-1', 120, 40)
    expect(sendRaw).toHaveBeenCalledWith({
      type: 'terminal.resize',
      payload: { sessionId: 'sess-1', cols: 120, rows: 40 },
    })
  })

  it('close sends sessionId', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { ok: true } })
    const t = useTerminal()
    await t.close('sess-1')
    expect(sendRaw).toHaveBeenCalledWith({
      type: 'terminal.close',
      payload: { sessionId: 'sess-1' },
    })
  })

  it('history base64-decodes chunks to UTF-8 strings', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: {
        chunks: [
          { seq: 1, data: Buffer.from('hello', 'utf-8').toString('base64') },
          { seq: 2, data: Buffer.from('世界', 'utf-8').toString('base64') },
        ],
        truncated: true,
      },
    })
    const t = useTerminal()
    const { chunks, truncated } = await t.history('sess-1', 0)
    expect(truncated).toBe(true)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].data).toBe('hello')
    expect(chunks[1].data).toBe('世界')
    expect(chunks[0].seq).toBe(1)
  })
})

describe('useTerminal — subscription fan-out', () => {
  it('onStdout fires for matching sessionId only', () => {
    const t = useTerminal()
    const aCalls = []
    const bCalls = []
    t.onStdout('a', (e) => aCalls.push(e))
    t.onStdout('b', (e) => bCalls.push(e))

    const data = Buffer.from('chunk', 'utf-8').toString('base64')
    emitWs({ type: 'terminal.stdout', payload: { sessionId: 'a', data, seq: 1 } })
    expect(aCalls).toHaveLength(1)
    expect(aCalls[0].data).toBe('chunk')
    expect(aCalls[0].seq).toBe(1)
    expect(bCalls).toHaveLength(0)

    emitWs({ type: 'terminal.stdout', payload: { sessionId: 'b', data, seq: 2 } })
    expect(bCalls).toHaveLength(1)
  })

  it('onStdout(null) receives all sessions (any-session subscription)', () => {
    const t = useTerminal()
    const all = []
    t.onStdout(null, (e) => all.push(e.sessionId))
    const data = Buffer.from('x', 'utf-8').toString('base64')
    emitWs({ type: 'terminal.stdout', payload: { sessionId: 'a', data, seq: 1 } })
    emitWs({ type: 'terminal.stdout', payload: { sessionId: 'b', data, seq: 1 } })
    expect(all).toEqual(['a', 'b'])
  })

  it('onExit fires with exitCode/signal', () => {
    const t = useTerminal()
    const calls = []
    t.onExit('a', (e) => calls.push(e))
    emitWs({
      type: 'terminal.exit',
      payload: { sessionId: 'a', exitCode: 0, signal: null },
    })
    expect(calls).toEqual([{ sessionId: 'a', exitCode: 0, signal: null }])
  })

  it('returned unsubscribe function detaches the callback', () => {
    const t = useTerminal()
    const calls = []
    const off = t.onStdout('a', (e) => calls.push(e.seq))
    const data = Buffer.from('x', 'utf-8').toString('base64')
    emitWs({ type: 'terminal.stdout', payload: { sessionId: 'a', data, seq: 1 } })
    off()
    emitWs({ type: 'terminal.stdout', payload: { sessionId: 'a', data, seq: 2 } })
    expect(calls).toEqual([1])
  })

  it('decodes multi-byte UTF-8 stdout correctly', () => {
    const t = useTerminal()
    const calls = []
    t.onStdout('a', (e) => calls.push(e.data))
    const data = Buffer.from('日本語', 'utf-8').toString('base64')
    emitWs({ type: 'terminal.stdout', payload: { sessionId: 'a', data, seq: 1 } })
    expect(calls).toEqual(['日本語'])
  })

  it('ws.onMessage listener installs exactly once across many useTerminal calls', () => {
    useTerminal()
    useTerminal()
    useTerminal()
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('ignores frames without sessionId in payload', () => {
    const t = useTerminal()
    const calls = []
    t.onStdout(null, (e) => calls.push(e))
    emitWs({ type: 'terminal.stdout', payload: {} })
    expect(calls).toHaveLength(0)
  })

  it('ignores non-terminal frames', () => {
    const t = useTerminal()
    const calls = []
    t.onStdout(null, (e) => calls.push(e))
    emitWs({ type: 'llm.chat.chunk', payload: { sessionId: 'a' } })
    emitWs({ type: 'unknown', payload: {} })
    expect(calls).toHaveLength(0)
  })
})
