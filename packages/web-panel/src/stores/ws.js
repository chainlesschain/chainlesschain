import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

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
  switch (msg?.type) {
    case 'task:notification':
      return createRuntimeEvent('task:notification', { task: msg.task }, { kind: 'server' })
    case 'session-created':
      return createRuntimeEvent(
        'session:start',
        {
          sessionId: msg.sessionId,
          sessionType: msg.sessionType || null,
          record:
            msg.record || {
              id: msg.sessionId,
              type: msg.sessionType || null,
              status: 'created',
              history: [],
              messageCount: 0,
            },
        },
        { kind: 'server', sessionId: msg.sessionId },
      )
    case 'session-resumed':
      return createRuntimeEvent(
        'session:resume',
        {
          sessionId: msg.sessionId,
          history: msg.history || [],
          historyCount: Array.isArray(msg.history) ? msg.history.length : 0,
          record:
            msg.record || {
              id: msg.sessionId,
              type: null,
              status: 'resumed',
              history: msg.history || [],
              messageCount: Array.isArray(msg.history) ? msg.history.length : 0,
            },
        },
        { kind: 'server', sessionId: msg.sessionId },
      )
    case 'worktree-diff':
      return createRuntimeEvent(
        'worktree:diff:ready',
        {
          requestId: msg.id || null,
          record:
            msg.record || {
              branch: msg.branch || null,
              summary: msg.summary || null,
              previewEntrypoints: [{ type: 'worktree-diff', branch: msg.branch || null }],
            },
        },
        { kind: 'server' },
      )
    case 'worktree-merged':
      return createRuntimeEvent(
        'worktree:merge:completed',
        {
          requestId: msg.id || null,
          record:
            msg.record || {
              branch: msg.branch || null,
              summary: msg.summary || null,
              conflicts: msg.conflicts || [],
              previewEntrypoints: msg.previewEntrypoints || [],
            },
        },
        { kind: 'server' },
      )
    case 'compression-stats':
      return createRuntimeEvent(
        'compression:summary',
        {
          requestId: msg.id || null,
          summary: msg.summary || {},
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

  const cfg = window.__CC_CONFIG__ || {}
  const wsUrl = computed(() => `ws://${cfg.wsHost || '127.0.0.1'}:${cfg.wsPort || 18800}`)

  function connect() {
    if (socket.value?.readyState === WebSocket.OPEN) return
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
        // Schedule reconnect
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000)
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
    socket.value?.close()
    socket.value = null
    status.value = 'disconnected'
  }

  function handleMessage(msg) {
    const { type, id } = msg
    let wasPending = false

    // Resolve pending one-shot requests
    if (id && pending.has(id)) {
      const { resolve, reject, timeout } = pending.get(id)
      clearTimeout(timeout)
      pending.delete(id)
      wasPending = true
      if (type === 'error') {
        reject(new Error(msg.message || 'Unknown error'))
      } else {
        resolve(msg)
      }
    }

    // Streaming session events
    const sessionId = msg.sessionId
    if (sessionId && streamHandlers.has(sessionId)) {
      const handlers = streamHandlers.get(sessionId)
      handlers.forEach(h => h(msg))
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
      // Try to find JSON in output (may have extra text)
      const match = output.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
      if (match) return JSON.parse(match[0])
      throw new Error(`Invalid JSON output: ${output.slice(0, 200)}`)
    }
  }

  // Create a chat/agent session
  async function createSession(sessionType = 'chat', projectRoot = null) {
    await waitConnected(8000)
    const id = genId()
    const result = await sendRaw({ type: 'session-create', id, sessionType, projectRoot: projectRoot || cfg.projectRoot || null })
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
    sendRaw,
    execute, executeJson,
    createSession, resumeSession, sendSessionMessage, answerQuestion, listSessions, closeSession
  }
})
