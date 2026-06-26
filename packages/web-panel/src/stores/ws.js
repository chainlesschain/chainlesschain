import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { tryParseJson } from '../utils/community-parser.js'

let msgCounter = 0
const genId = () => `wp-${++msgCounter}`
const runtimeHandlers = new Set()

function createRuntimeEvent(type, payload = {}, context = {}) {
  return {
    type,
    kind: context.kind || 'server',
    sessionId: context.sessionId || payload.sessionId || null,
    timestamp: context.timestamp || Date.now(),
    payload,
  }
}

function normalizeRuntimeEvent(msg) {
  const type = msg?.type
  const payload = msg?.payload || {}
  switch (type) {
    case 'task:notification':
      return createRuntimeEvent('task:notification', { task: msg.task || payload.task }, { kind: 'server' })
    case 'session-created':
    case 'session.started':
      return createRuntimeEvent(
        'session:start',
        {
          sessionId: msg.sessionId || payload.sessionId,
          sessionType: msg.sessionType || payload.sessionType || null,
          record:
            msg.record || payload.record || {
              id: msg.sessionId || payload.sessionId,
              type: msg.sessionType || payload.sessionType || null,
              status: 'created',
              history: [],
              messageCount: 0,
            },
        },
        { kind: 'server', sessionId: msg.sessionId || payload.sessionId },
      )
    case 'session-resumed':
    case 'session.resumed': {
      const sid = msg.sessionId || payload.sessionId
      const history = msg.history || payload.history || []
      return createRuntimeEvent(
        'session:resume',
        {
          sessionId: sid,
          history,
          historyCount: Array.isArray(history) ? history.length : 0,
          record:
            msg.record || payload.record || {
              id: sid,
              type: null,
              status: 'resumed',
              history,
              messageCount: Array.isArray(history) ? history.length : 0,
            },
        },
        { kind: 'server', sessionId: sid },
      )
    }
    case 'worktree-diff':
    case 'worktree.diff':
      return createRuntimeEvent(
        'worktree:diff:ready',
        {
          requestId: msg.requestId || msg.id || null,
          record:
            msg.record || payload.record || {
              branch: msg.branch || payload.branch || null,
              summary: msg.summary || payload.summary || null,
              previewEntrypoints: [{ type: 'worktree-diff', branch: msg.branch || payload.branch || null }],
            },
        },
        { kind: 'server' },
      )
    case 'worktree-merged':
    case 'worktree.merged':
      return createRuntimeEvent(
        'worktree:merge:completed',
        {
          requestId: msg.requestId || msg.id || null,
          record:
            msg.record || payload.record || {
              branch: msg.branch || payload.branch || null,
              summary: msg.summary || payload.summary || null,
              conflicts: msg.conflicts || payload.conflicts || [],
              previewEntrypoints: msg.previewEntrypoints || payload.previewEntrypoints || [],
            },
        },
        { kind: 'server' },
      )
    case 'compression-stats':
    case 'context.compaction.completed':
      return createRuntimeEvent(
        'compression:summary',
        {
          requestId: msg.requestId || msg.id || null,
          summary: msg.summary || payload.summary || {},
        },
        { kind: 'server' },
      )
    default:
      return null
  }
}

function emitRuntimeEvent(runtimeEvent, rawMessage = null) {
  runtimeHandlers.forEach(h => h(runtimeEvent, rawMessage || runtimeEvent))
}

function normalizeSessionSummary(session) {
  if (!session) return null
  const record = session.record || {
    id: session.id || null,
    type: session.type || null,
    provider: session.provider || null,
    model: session.model || null,
    projectRoot: session.projectRoot || null,
    messageCount: session.messageCount ?? 0,
    history: session.history || [],
    status: session.status || null,
  }

  return {
    ...session,
    id: session.id || record.id,
    type: session.type || record.type,
    provider: session.provider || record.provider,
    model: session.model || record.model,
    projectRoot: session.projectRoot || record.projectRoot,
    messageCount: session.messageCount ?? record.messageCount ?? 0,
    status: session.status || record.status || null,
    record,
  }
}

export const useWsStore = defineStore('ws', () => {
  const socket = ref(null)
  const status = ref('disconnected') // 'connecting' | 'connected' | 'disconnected' | 'error'
  const error = ref(null)

  // Pending promises: id → { resolve, reject, timeout }
  const pending = new Map()
  // Event handlers for streaming: sessionId → handler[]
  const streamHandlers = new Map()

  let reconnectTimer = null
  let reconnectDelay = 1000
  let manualClose = false

  const cfg = window.__CC_CONFIG__ || {}
  const wsUrl = computed(() => `ws://${cfg.wsHost || '127.0.0.1'}:${cfg.wsPort || 18800}`)

  function connect() {
    if (socket.value?.readyState === WebSocket.OPEN || socket.value?.readyState === WebSocket.CONNECTING) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    manualClose = false
    status.value = 'connecting'
    error.value = null

    try {
      const ws = new WebSocket(wsUrl.value)
      socket.value = ws

      ws.onopen = () => {
        reconnectDelay = 1000
        // Authenticate if token provided
        if (cfg.wsToken) {
          sendRaw({ type: 'auth', id: genId(), token: cfg.wsToken })
            .then(() => { status.value = 'connected' })
            .catch(() => { status.value = 'connected' }) // still set connected even if auth fails
        } else {
          status.value = 'connected'
        }
      }

      ws.onmessage = (event) => {
        let msg
        try { msg = JSON.parse(event.data) } catch { return }
        handleMessage(msg)
      }

      ws.onerror = () => {
        error.value = 'WebSocket error'
        status.value = 'error'
      }

      ws.onclose = () => {
        status.value = 'disconnected'
        socket.value = null
        // Reject all pending
        pending.forEach(({ reject }) => reject(new Error('WebSocket closed')))
        pending.clear()
        // Tear down any in-flight streams so their consumers can fail-fast
        // instead of hanging on a never-arriving terminal frame.
        pendingStreams.forEach(({ reject, clear }) => {
          try { clear() } catch { /* defensive */ }
          reject(new Error('WebSocket closed'))
        })
        pendingStreams.clear()
        if (manualClose) {
          manualClose = false
          reconnectTimer = null
          return
        }
        // Schedule reconnect
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000)
          reconnectTimer = null
          connect()
        }, reconnectDelay)
      }
    } catch (e) {
      status.value = 'error'
      error.value = e.message
    }
  }

  function disconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    manualClose = true
    socket.value?.close()
    socket.value = null
    status.value = 'disconnected'
  }

  /**
   * Flatten a v1.0 Coding Agent envelope into a legacy-compatible shape.
   * v1.0 envelopes carry data in `payload`, use `requestId` for correlation,
   * and dot-case types (e.g. "session.started"). Legacy messages use flat
   * top-level fields, `id` for correlation, and kebab-case types.
   */
  function flattenEnvelope(msg) {
    if (!msg.version && !msg.payload) return msg
    const payload = msg.payload || {}
    return {
      ...msg,
      ...payload,
      // Keep the original envelope type (consumers handle both formats)
      type: msg.type,
      // Ensure sessionId is top-level (may come from envelope or payload)
      sessionId: msg.sessionId || payload.sessionId || null,
    }
  }

  function handleMessage(msg) {
    const { type } = msg
    // v1.0 envelope uses requestId for correlation; legacy uses id
    const correlationId = msg.requestId || msg.id
    let wasPending = false

    // Streaming envelope (desktop web-shell): <topic>.chunk + <topic>.result.
    // The `pendingStreams` map keys are request ids. We dispatch chunks to
    // the per-stream onChunk callback, and a terminal `.result` resolves /
    // rejects the outer promise. handled-here short-circuits the regular
    // pending path so the server's reply doesn't double-resolve.
    if (correlationId && pendingStreams.has(correlationId) && typeof type === 'string') {
      const stream = pendingStreams.get(correlationId)
      if (type.endsWith('.chunk')) {
        try { stream.onChunk(msg.chunk) } catch { /* consumer error must not break the stream wire */ }
        stream.rearm()
        return true
      }
      if (type.endsWith('.result')) {
        pendingStreams.delete(correlationId)
        stream.clear()
        if (msg.ok === false) {
          stream.reject(new Error(msg.error || 'Stream error'))
        } else {
          stream.resolve(msg.result ?? null)
        }
        return true
      }
    }

    // Resolve pending one-shot requests
    if (correlationId && pending.has(correlationId)) {
      const { resolve, reject, timeout } = pending.get(correlationId)
      clearTimeout(timeout)
      pending.delete(correlationId)
      wasPending = true
      const flat = flattenEnvelope(msg)
      // Stamp the correlation id so consumers can read it as .id
      flat.id = correlationId
      if (type === 'error') {
        reject(new Error(flat.message || 'Unknown error'))
      } else {
        resolve(flat)
      }
    }

    // Streaming session events — use envelope sessionId or payload sessionId
    const sessionId = msg.sessionId || (msg.payload && msg.payload.sessionId) || null
    if (sessionId && streamHandlers.has(sessionId)) {
      const flat = flattenEnvelope(msg)
      const handlers = streamHandlers.get(sessionId)
      handlers.forEach(h => h(flat))
    }

    // Global event bus (for listeners registered via onMessage)
    globalHandlers.forEach(h => h(msg))

    const runtimeEvent = normalizeRuntimeEvent(msg)
    if (runtimeEvent) {
      emitRuntimeEvent(runtimeEvent, msg)
    }

    return wasPending
  }

  const globalHandlers = new Set()

  function onMessage(handler) {
    globalHandlers.add(handler)
    return () => globalHandlers.delete(handler)
  }

  function onRuntimeEvent(handler) {
    runtimeHandlers.add(handler)
    return () => runtimeHandlers.delete(handler)
  }

  function onSession(sessionId, handler) {
    if (!streamHandlers.has(sessionId)) {
      streamHandlers.set(sessionId, new Set())
    }
    streamHandlers.get(sessionId).add(handler)
    return () => {
      streamHandlers.get(sessionId)?.delete(handler)
      if (streamHandlers.get(sessionId)?.size === 0) {
        streamHandlers.delete(sessionId)
      }
    }
  }

  function sendRaw(payload, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (socket.value?.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }
      const id = payload.id || genId()
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Request timeout'))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timeout: timer })
      socket.value.send(JSON.stringify({ ...payload, id }))
    })
  }

  // Pending streams: id → { onChunk, resolve, reject, timer, idleMs }
  const pendingStreams = new Map()

  /**
   * Send a frame whose handler is an async generator on the server (see
   * desktop-app-vue/src/main/web-shell/ws-cli-loader.js streaming envelope).
   * Listens for `<type>.chunk` frames matching the request id, calls
   * options.onChunk(chunkValue) for each, then resolves with the result of
   * the terminal `<type>.result` frame (or rejects on ok:false).
   *
   * The idle timeout resets on every chunk so a long stream that's
   * actively producing tokens never trips the timer; only a true stall
   * does. Pass `idleMs: 0` to disable.
   *
   * Cancellation: pass `signal: AbortSignal`. When the signal aborts:
   *   - The promise rejects with `new Error('aborted')` (matches DOMException
   *     AbortError shape — signal.reason is preserved if set).
   *   - The pendingStreams entry is removed so subsequent server frames
   *     for the same id are dropped silently.
   *   - A best-effort `{type: '<topic>.cancel', id}` frame is sent to the
   *     server. The server's existing dispatcher does not currently act on
   *     it (UNKNOWN_TYPE) — this is the stub side of cancellation. When
   *     LLMManager / UKeyManager grow real AbortController support, the
   *     server can route this frame into the in-flight handler.
   *
   * @param {object} payload  - WS frame (e.g. { type: 'llm.chat', messages })
   * @param {object} options
   * @param {(chunk:any) => void} options.onChunk
   * @param {number} [options.idleMs=30000]  reset on every chunk; 0 disables
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<any>}  resolves with the .result's `result` field
   */
  function sendStream(payload, options = {}) {
    return new Promise((resolve, reject) => {
      if (socket.value?.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }
      const id = payload.id || genId()
      const idleMs = options.idleMs ?? 30000
      const onChunk = typeof options.onChunk === 'function' ? options.onChunk : () => {}
      const signal = options.signal

      // Pre-aborted signal — reject without sending the frame at all.
      if (signal?.aborted) {
        const reason = signal.reason instanceof Error ? signal.reason : new Error('aborted')
        reject(reason)
        return
      }

      let idleTimer = null
      const armIdle = () => {
        if (!idleMs) return
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          if (pendingStreams.has(id)) {
            pendingStreams.delete(id)
            reject(new Error('Stream idle timeout'))
          }
        }, idleMs)
      }

      const onAbort = () => {
        if (!pendingStreams.has(id)) return
        pendingStreams.delete(id)
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
        // Best-effort: hint the server to release any resources tied to
        // this id. The dispatcher will treat this as UNKNOWN_TYPE today
        // (no abort handlers in main); harmless. When LLMManager /
        // UKeyManager grow AbortController support, the server can route
        // this frame into the live handler. Wrapped in try since the
        // socket may be closing already.
        try {
          if (socket.value?.readyState === WebSocket.OPEN) {
            socket.value.send(JSON.stringify({
              type: `${payload.type}.cancel`,
              id,
            }))
          }
        } catch { /* swallow — abort path must not throw */ }
        const reason = signal?.reason instanceof Error
          ? signal.reason
          : new Error('aborted')
        reject(reason)
      }

      pendingStreams.set(id, {
        onChunk,
        resolve,
        reject,
        clear: () => {
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = null
          if (signal && onAbort) {
            try { signal.removeEventListener('abort', onAbort) } catch { /* noop */ }
          }
        },
        rearm: armIdle,
      })
      armIdle()
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }
      socket.value.send(JSON.stringify({ ...payload, id }))
    })
  }

  // Wait until WS is connected (or timeout)
  function waitConnected(timeoutMs = 8000) {
    if (status.value === 'connected') return Promise.resolve()
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      const tick = () => {
        if (status.value === 'connected') return resolve()
        if (status.value === 'error' || Date.now() >= deadline) {
          return reject(new Error(`WS not ready: ${status.value}`))
        }
        setTimeout(tick, 150)
      }
      // Trigger connect if not already started
      if (status.value === 'disconnected') connect()
      tick()
    })
  }

  // Execute a CLI command and return { output, exitCode }
  // Server sends { stdout, stderr } — output = stdout + stderr combined
  async function execute(command, timeoutMs = 30000) {
    await waitConnected(8000)
    const result = await sendRaw({ type: 'execute', command }, timeoutMs)
    const output = result.output ?? result.stdout ?? ''
    const stderr = result.stderr ?? ''
    return { output: output || stderr, exitCode: result.exitCode ?? 0 }
  }

  // Parse JSON output from execute
  async function executeJson(command, timeoutMs = 30000) {
    const { output, exitCode } = await execute(command, timeoutMs)
    if (exitCode !== 0) throw new Error(`Command failed: ${output}`)
    try {
      return JSON.parse(output.trim())
    } catch {
      // Output had prose/log noise around the JSON. Recover via the shared
      // robust parser (strips CLI noise + balanced-candidate scanning, never
      // throws). The previous bare greedy /\{[\s\S]*\}/ + unguarded
      // JSON.parse over-captured (first { to last }) and threw a raw
      // SyntaxError on noisy/multi-object output instead of the clean error.
      const parsed = tryParseJson(output)
      if (parsed !== null) return parsed
      throw new Error(`Invalid JSON output: ${output.slice(0, 200)}`)
    }
  }

  // Create a chat/agent session
  async function createSession(sessionType = 'chat', projectRoot = null, options = {}) {
    await waitConnected(8000)
    const id = genId()
    const payload = {
      type: 'session-create',
      id,
      sessionType,
      projectRoot: projectRoot || cfg.projectRoot || null,
    }
    if (options.systemPromptExtension) {
      payload.systemPromptExtension = options.systemPromptExtension
    }
    if (Array.isArray(options.shellPolicyOverrides) && options.shellPolicyOverrides.length) {
      payload.shellPolicyOverrides = options.shellPolicyOverrides
    }
    const result = await sendRaw(payload)
    return result.sessionId
  }

  // Send message to session (returns immediately, listen for tokens via onSession)
  function sendSessionMessage(sessionId, content) {
    if (socket.value?.readyState !== WebSocket.OPEN) return
    socket.value.send(JSON.stringify({
      type: 'session-message',
      id: genId(),
      sessionId,
      content
    }))
  }

  // Answer an interactive question
  function answerQuestion(sessionId, requestId, answer) {
    if (socket.value?.readyState !== WebSocket.OPEN) return
    socket.value.send(JSON.stringify({
      type: 'session-answer',
      id: genId(),
      sessionId,
      requestId,
      answer
    }))
  }

  // List sessions
  async function listSessions() {
    await waitConnected(8000)
    const result = await sendRaw({ type: 'session-list' }, 10000)
    return (result.sessions || []).map(normalizeSessionSummary).filter(Boolean)
  }

  // Close session
  async function closeSession(sessionId) {
    try {
      await sendRaw({ type: 'session-close', sessionId }, 5000)
      emitRuntimeEvent(
        createRuntimeEvent(
          'session:end',
          { sessionId },
          { kind: 'server', sessionId },
        ),
        { type: 'result', sessionId, success: true },
      )
    } catch (_) { /* ignore */ }
  }

  async function resumeSession(sessionId) {
    await waitConnected(8000)
    const result = await sendRaw({ type: 'session-resume', sessionId }, 10000)
    return result
  }

  return {
    status, error, wsUrl,
    connect, disconnect, waitConnected,
    onMessage, onRuntimeEvent, onSession,
    sendRaw, sendStream,
    execute, executeJson,
    createSession, resumeSession, sendSessionMessage, answerQuestion, listSessions, closeSession
  }
})
