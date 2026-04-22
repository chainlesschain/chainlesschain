import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import { useWsStore } from './ws.js'

const DEFAULT_CHAT_TITLE = '新对话'
const DEFAULT_AGENT_TITLE = '新 Agent'

/**
 * Map v1.0 Coding Agent dot-case event types to legacy kebab-case types
 * that the handleSessionMsg switch statement already handles.
 */
const DOT_TO_LEGACY_TYPE = {
  'assistant.delta': 'response-token',
  'assistant.final': 'response-complete',
  'assistant.message': 'response-complete',
  'tool.call.started': 'tool-executing',
  'tool.call.completed': 'tool-result',
  'tool.call.failed': 'tool-result',
  'slot.filling': 'question',
  'approval.requested': 'question',
  'error': 'error',
}

export const useChatStore = defineStore('chat', () => {
  const sessions = ref([])
  const currentSessionId = ref(null)
  const messages = reactive({})
  const streaming = reactive({})
  const pendingQuestion = reactive({})
  const loadingBySession = reactive({})
  let unsubscribeRuntimeEvents = null
  // Track which sessions already have a WS handler registered so we never
  // register a second one (the Set in ws.js can't deduplicate anonymous
  // arrow functions, which would cause every AI response to be pushed twice).
  const _registeredChannels = new Set()

  function getMessages(sessionId) {
    if (!messages[sessionId]) messages[sessionId] = []
    return messages[sessionId]
  }

  function getIsLoading(sessionId) {
    return Boolean(sessionId && loadingBySession[sessionId])
  }

  function setSessionLoading(sessionId, flag) {
    if (!sessionId) return
    loadingBySession[sessionId] = Boolean(flag)
  }

  function upsertSession(session) {
    if (!session?.id) return
    const existing = sessions.value.find((item) => item.id === session.id)
    if (existing) {
      Object.assign(existing, session)
      return
    }
    sessions.value.unshift(session)
  }

  function ensureSessionChannel(sessionId, ws = useWsStore()) {
    if (!messages[sessionId]) messages[sessionId] = []
    if (!streaming[sessionId]) streaming[sessionId] = { content: '', active: false }
    if (loadingBySession[sessionId] == null) loadingBySession[sessionId] = false
    if (_registeredChannels.has(sessionId)) return
    _registeredChannels.add(sessionId)
    ws.onSession(sessionId, (msg) => handleSessionMsg(sessionId, msg))
  }

  function ensureRuntimeSubscription(ws = useWsStore()) {
    if (unsubscribeRuntimeEvents) return
    unsubscribeRuntimeEvents = ws.onRuntimeEvent((event) => {
      const payload = event.payload || {}
      const record = payload.record || {}

      if (event.type === 'session:start') {
        const sessionType = payload.sessionType || record.type || 'chat'
        setSessionLoading(payload.sessionId, false)
        upsertSession({
          id: payload.sessionId,
          type: sessionType,
          provider: record.provider || null,
          model: record.model || null,
          projectRoot: record.projectRoot || null,
          status: record.status || 'created',
          title: sessionType === 'chat' ? DEFAULT_CHAT_TITLE : DEFAULT_AGENT_TITLE,
          createdAt: Date.now(),
          messageCount: record.messageCount ?? 0,
        })
      } else if (event.type === 'session:resume') {
        const sessionId = payload.sessionId
        if (!sessionId) return
        if (Array.isArray(payload.history)) {
          messages[sessionId] = payload.history.map((item) => ({
            role: item.role,
            content: item.content,
            timestamp: item.timestamp || Date.now(),
          }))
        }
        if (!streaming[sessionId]) streaming[sessionId] = { content: '', active: false }
        if (loadingBySession[sessionId] == null) loadingBySession[sessionId] = false
        upsertSession({
          id: sessionId,
          type: record.type || null,
          provider: record.provider || null,
          model: record.model || null,
          projectRoot: record.projectRoot || null,
          status: record.status || 'resumed',
          messageCount: record.messageCount ?? (Array.isArray(payload.history) ? payload.history.length : 0),
        })
      } else if (event.type === 'session:end') {
        const sessionId = payload.sessionId
        sessions.value = sessions.value.filter((item) => item.id !== sessionId)
        delete loadingBySession[sessionId]
        if (currentSessionId.value === sessionId) {
          currentSessionId.value = sessions.value[0]?.id || null
        }
      }
    })
  }

  async function loadSessions() {
    const ws = useWsStore()
    ensureRuntimeSubscription(ws)
    sessions.value = await ws.listSessions()
    sessions.value.forEach((session) => {
      ensureSessionChannel(session.id, ws)
    })
  }

  async function createSession(type = 'chat', options = {}) {
    const ws = useWsStore()
    ensureRuntimeSubscription(ws)
    const sessionId = await ws.createSession(type, null, options)

    upsertSession({
      id: sessionId,
      type,
      title: type === 'chat' ? DEFAULT_CHAT_TITLE : DEFAULT_AGENT_TITLE,
      createdAt: Date.now(),
      messageCount: 0,
    })

    setSessionLoading(sessionId, false)
    ensureSessionChannel(sessionId, ws)
    currentSessionId.value = sessionId
    return sessionId
  }

  function handleSessionMsg(sessionId, msg) {
    const msgs = getMessages(sessionId)

    // Normalize v1.0 dot-case type → legacy kebab-case
    const type = DOT_TO_LEGACY_TYPE[msg.type] || msg.type
    // v1.0 envelopes carry data in payload; flatten for field access
    const p = msg.payload || {}

    if (type === 'response-token') {
      if (!streaming[sessionId]) streaming[sessionId] = { content: '', active: true }
      // v1.0 uses payload.delta or payload.content; legacy uses msg.token
      const token = msg.token || p.token || p.delta || p.content || ''
      streaming[sessionId].content += token
      streaming[sessionId].active = true
      setSessionLoading(sessionId, true)
    } else if (type === 'response-complete') {
      const content = msg.content || p.content || streaming[sessionId]?.content || ''
      msgs.push({ role: 'assistant', content, timestamp: Date.now() })
      if (streaming[sessionId]) {
        streaming[sessionId].content = ''
        streaming[sessionId].active = false
      }
      const session = sessions.value.find((item) => item.id === sessionId)
      if (session && (session.title === DEFAULT_CHAT_TITLE || session.title === DEFAULT_AGENT_TITLE)) {
        const firstUser = msgs.find((item) => item.role === 'user')
        if (firstUser) session.title = firstUser.content.slice(0, 30)
      }
      if (session) {
        session.messageCount = msgs.filter((item) => item.role !== 'tool').length
      }
      setSessionLoading(sessionId, false)
    } else if (type === 'tool-executing') {
      msgs.push({
        role: 'tool',
        tool: msg.tool || p.tool || p.toolName || 'unknown',
        input: msg.input || p.input || p.args || null,
        status: 'running',
        timestamp: Date.now(),
      })
      setSessionLoading(sessionId, true)
    } else if (type === 'tool-result') {
      const toolName = msg.tool || p.tool || p.toolName || 'unknown'
      const last = [...msgs].reverse().find((item) => item.role === 'tool' && item.tool === toolName)
      if (last) {
        last.result = msg.result || p.result || p.output || null
        last.status = 'done'
      }
    } else if (type === 'question') {
      pendingQuestion[sessionId] = {
        requestId: msg.requestId || p.requestId || msg.id,
        question: msg.question || p.question || p.message || '',
        choices: msg.choices || p.choices || p.options || [],
      }
      setSessionLoading(sessionId, false)
    } else if (type === 'error') {
      // Surface errors in the chat as assistant messages
      const errMsg = msg.message || p.message || 'Unknown error'
      msgs.push({ role: 'assistant', content: `Error: ${errMsg}`, timestamp: Date.now() })
      setSessionLoading(sessionId, false)
      if (streaming[sessionId]) {
        streaming[sessionId].active = false
      }
    }
  }

  async function sendMessage(sessionId, content) {
    const ws = useWsStore()
    ensureRuntimeSubscription(ws)
    const msgs = getMessages(sessionId)
    msgs.push({ role: 'user', content, timestamp: Date.now() })
    if (!streaming[sessionId]) streaming[sessionId] = { content: '', active: false }
    streaming[sessionId].active = true
    setSessionLoading(sessionId, true)
    ws.sendSessionMessage(sessionId, content)
  }

  function answerQuestion(sessionId, answer) {
    const ws = useWsStore()
    const question = pendingQuestion[sessionId]
    if (!question) return
    ws.answerQuestion(sessionId, question.requestId, answer)
    delete pendingQuestion[sessionId]
  }

  async function switchSession(sessionId) {
    const ws = useWsStore()
    ensureRuntimeSubscription(ws)
    currentSessionId.value = sessionId
    ensureSessionChannel(sessionId, ws)
    if (!messages[sessionId] || messages[sessionId].length === 0) {
      try {
        await ws.resumeSession(sessionId)
      } catch (_) {
        // Best-effort; leave empty state if resume fails.
      }
    }
  }

  const isLoading = computed(() => getIsLoading(currentSessionId.value))

  return {
    sessions,
    currentSessionId,
    messages,
    streaming,
    pendingQuestion,
    loadingBySession,
    isLoading,
    getIsLoading,
    loadSessions,
    createSession,
    sendMessage,
    answerQuestion,
    switchSession,
    getMessages,
  }
})
