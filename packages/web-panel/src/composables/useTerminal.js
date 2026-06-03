/**
 * useTerminal — Plan A remote-terminal composable.
 *
 * Talks to the desktop web-shell's `terminal.*` topics (see
 * `desktop-app-vue/src/main/web-shell/handlers/terminal-handlers.js`):
 *
 *   request/reply:  terminal.create / list / stdin / resize / close / history
 *   server push:    terminal.stdout / terminal.exit  (broadcast to all clients)
 *
 * Two API surfaces:
 *
 *   1. Imperative — one-shot calls returning Promises:
 *
 *        const t = useTerminal()
 *        const { sessionId } = await t.create({ shell: 'pwsh' })
 *        await t.stdin(sessionId, 'ls\r')
 *        await t.close(sessionId)
 *
 *   2. Subscription — server push fan-out via callbacks:
 *
 *        const off = t.onStdout(sessionId, ({ data, seq }) => render(data))
 *        const offExit = t.onExit(sessionId, ({ exitCode }) => done(exitCode))
 *        // call returned off() to unsubscribe
 *
 * `data` is base64(UTF-8) on the wire. `stdin()` accepts a string and
 * encodes it; `onStdout` callbacks receive a decoded UTF-8 string. The
 * raw `seq` is forwarded so callers can pass it back to `history(fromSeq)`
 * after a transient WS disconnect.
 *
 * Per-session subscription bookkeeping is kept in a module-scoped map so
 * the composable is naturally a singleton across components — opening
 * the TerminalPanel route and a sidebar peek widget hits the same
 * fan-out. The first call to `useTerminal()` installs a single
 * `ws.onMessage` listener; later calls just register their callbacks.
 */

import { useWsStore } from '../stores/ws.js'

// Module-singleton fan-out: keyed by sessionId, value = Set of callbacks.
// Listeners are reused across all callers of useTerminal() in one tab.
const stdoutSubs = new Map() // sessionId → Set<(payload) => void>
const exitSubs = new Map() // sessionId → Set<(payload) => void>
// "any session" subscriptions — useful for the "+ 새 session" UI which
// wants to see exits without binding to a known id yet.
const stdoutAnySubs = new Set()
const exitAnySubs = new Set()

let wsListenerInstalled = false
function ensureWsListener(ws) {
  if (wsListenerInstalled) return
  wsListenerInstalled = true
  ws.onMessage((msg) => {
    if (!msg || typeof msg.type !== 'string') return
    if (msg.type === 'terminal.stdout') {
      const { sessionId, data, seq } = msg.payload || {}
      if (!sessionId) return
      // Decode base64 → utf-8 once per push so every subscriber gets the
      // already-decoded string. Doing it inline (rather than per-callback)
      // saves CPU when multiple components watch the same session.
      let decoded
      try {
        // atob → binary string → utf-8 (handles multi-byte CJK / emoji)
        const bin = atob(data || '')
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        decoded = new TextDecoder('utf-8').decode(bytes)
      } catch {
        decoded = ''
      }
      const evt = { sessionId, data: decoded, seq }
      stdoutSubs.get(sessionId)?.forEach((cb) => cb(evt))
      stdoutAnySubs.forEach((cb) => cb(evt))
    } else if (msg.type === 'terminal.exit') {
      const { sessionId, exitCode, signal } = msg.payload || {}
      if (!sessionId) return
      const evt = { sessionId, exitCode, signal }
      exitSubs.get(sessionId)?.forEach((cb) => cb(evt))
      exitAnySubs.forEach((cb) => cb(evt))
    }
  })
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromBase64Utf8(b64) {
  const bin = atob(b64 || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function useTerminal() {
  const ws = useWsStore()
  ensureWsListener(ws)

  /** @returns {Promise<{ sessionId, pid, shell, createdAt }>} */
  async function create(req = {}) {
    const reply = await ws.sendRaw({
      type: 'terminal.create',
      payload: {
        shell: req.shell,
        cwd: req.cwd,
        env: req.env,
        cols: req.cols,
        rows: req.rows,
      },
    })
    if (reply.ok === false) {
      throw new Error(reply.error || 'terminal_create_failed')
    }
    // Server replies as { type: 'terminal.create.result', ok, result } via
    // ws-cli-loader's non-streaming envelope. ws-store flattens to whatever
    // sendRaw resolves with — for non-streaming topics it's the full frame.
    return reply.result ?? reply
  }

  /** @returns {Promise<Array<{ id, shell, cwd, createdAt, alive, lastSeq }>>} */
  async function list() {
    const reply = await ws.sendRaw({ type: 'terminal.list', payload: {} })
    if (reply.ok === false) throw new Error(reply.error || 'terminal_list_failed')
    const result = reply.result ?? reply
    return Array.isArray(result.sessions) ? result.sessions : []
  }

  async function stdin(sessionId, data) {
    const reply = await ws.sendRaw({
      type: 'terminal.stdin',
      payload: { sessionId, data: toBase64Utf8(String(data)) },
    })
    if (reply.ok === false) {
      throw new Error(reply.error || 'terminal_stdin_failed')
    }
    return reply.result ?? reply
  }

  async function resize(sessionId, cols, rows) {
    const reply = await ws.sendRaw({
      type: 'terminal.resize',
      payload: { sessionId, cols, rows },
    })
    if (reply.ok === false) {
      throw new Error(reply.error || 'terminal_resize_failed')
    }
    return reply.result ?? reply
  }

  async function close(sessionId) {
    const reply = await ws.sendRaw({
      type: 'terminal.close',
      payload: { sessionId },
    })
    if (reply.ok === false) {
      throw new Error(reply.error || 'terminal_close_failed')
    }
    return reply.result ?? reply
  }

  /**
   * @returns {Promise<{ chunks: Array<{seq, data:string}>, truncated:boolean }>}
   * `data` is decoded UTF-8 (not base64).
   */
  async function history(sessionId, fromSeq = 0) {
    const reply = await ws.sendRaw({
      type: 'terminal.history',
      payload: { sessionId, fromSeq },
    })
    if (reply.ok === false) {
      throw new Error(reply.error || 'terminal_history_failed')
    }
    const result = reply.result ?? reply
    return {
      truncated: !!result.truncated,
      chunks: (result.chunks || []).map((c) => ({
        seq: c.seq,
        data: fromBase64Utf8(c.data),
      })),
    }
  }

  function onStdout(sessionId, cb) {
    if (!sessionId) {
      stdoutAnySubs.add(cb)
      return () => stdoutAnySubs.delete(cb)
    }
    if (!stdoutSubs.has(sessionId)) stdoutSubs.set(sessionId, new Set())
    stdoutSubs.get(sessionId).add(cb)
    return () => {
      stdoutSubs.get(sessionId)?.delete(cb)
      if (stdoutSubs.get(sessionId)?.size === 0) stdoutSubs.delete(sessionId)
    }
  }

  function onExit(sessionId, cb) {
    if (!sessionId) {
      exitAnySubs.add(cb)
      return () => exitAnySubs.delete(cb)
    }
    if (!exitSubs.has(sessionId)) exitSubs.set(sessionId, new Set())
    exitSubs.get(sessionId).add(cb)
    return () => {
      exitSubs.get(sessionId)?.delete(cb)
      if (exitSubs.get(sessionId)?.size === 0) exitSubs.delete(sessionId)
    }
  }

  return {
    create, list, stdin, resize, close, history,
    onStdout, onExit,
    // exported for tests
    _internal: { stdoutSubs, exitSubs, toBase64Utf8, fromBase64Utf8 },
  }
}

// Test-only — reset the module-singleton state between unit tests.
export function _resetTerminalSubsForTest() {
  stdoutSubs.clear()
  exitSubs.clear()
  stdoutAnySubs.clear()
  exitAnySubs.clear()
  wsListenerInstalled = false
}
