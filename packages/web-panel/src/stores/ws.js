import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

let msgCounter = 0
const genId = () => `wp-${++msgCounter}`

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

    // Resolve pending one-shot requests
    if (id && pending.has(id)) {
      const { resolve, reject, timeout } = pending.get(id)
      clearTimeout(timeout)
      pending.delete(id)
      if (type === 'error') {
        reject(new Error(msg.message || 'Unknown error'))
      } else {
        resolve(msg)
      }
      return
    }

    // Streaming session events
    const sessionId = msg.sessionId
    if (sessionId && streamHandlers.has(sessionId)) {
      const handlers = streamHandlers.get(sessionId)
      handlers.forEach(h => h(msg))
    }

    // Global event bus (for listeners registered via onMessage)
    globalHandlers.forEach(h => h(msg))
  }

  const globalHandlers = new Set()

  function onMessage(handler) {
    globalHandlers.add(handler)
    return () => globalHandlers.delete(handler)
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

  // Execute a CLI command and return { output, exitCode }
  async function execute(command, timeoutMs = 30000) {
    const result = await sendRaw({ type: 'execute', command }, timeoutMs)
    return { output: result.output || '', exitCode: result.exitCode ?? 0 }
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
    const result = await sendRaw({ type: 'session-list' }, 10000)
    return result.sessions || []
  }

  // Close session
  async function closeSession(sessionId) {
    try {
      await sendRaw({ type: 'session-close', sessionId }, 5000)
    } catch (_) { /* ignore */ }
  }

  return {
    status, error, wsUrl,
    connect, disconnect,
    onMessage, onSession,
    execute, executeJson,
    createSession, sendSessionMessage, answerQuestion, listSessions, closeSession
  }
})
