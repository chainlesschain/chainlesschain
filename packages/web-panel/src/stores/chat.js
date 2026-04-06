import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { useWsStore } from './ws.js'

const DEFAULT_CHAT_TITLE = '新对话'
const DEFAULT_AGENT_TITLE = '新 Agent'

export const useChatStore = defineStore('chat', () => {
  const sessions = ref([])
  const currentSessionId = ref(null)
  const messages = reactive({})
  const streaming = reactive({})
  const pendingQuestion = reactive({})
  const isLoading = ref(false)
  let unsubscribeRuntimeEvents = null

  function getMessages(sessionId) {
    if (!messages[sessionId]) messages[sessionId] = []
    return messages[sessionId]
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
    ws.onSession(sessionId, (msg) => handleSessionMsg(sessionId, msg))
  }

  function ensureRuntimeSubscription(ws = useWsStore()) {
    if (unsubscribeRuntimeEvents) return
    unsubscribeRuntimeEvents = ws.onRuntimeEvent((event) => {
      const payload = event.payload || {}
      const record = payload.record || {}

      if (event.type === 'session:start') {
        const sessionType = payload.sessionType || record.type || 'chat'
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
  }

  async function createSession(type = 'chat') {
    const ws = useWsStore()
    ensureRuntimeSubscription(ws)
    const sessionId = await ws.createSession(type)

    upsertSession({
      id: sessionId,
      type,
      title: type === 'chat' ? DEFAULT_CHAT_TITLE : DEFAULT_AGENT_TITLE,
      createdAt: Date.now(),
      messageCount: 0,
    })

    ensureSessionChannel(sessionId, ws)
    currentSessionId.value = sessionId
    return sessionId
  }

  function handleSessionMsg(sessionId, msg) {
    const msgs = getMessages(sessionId)

    if (msg.type === 'response-token') {
      if (!streaming[sessionId]) streaming[sessionId] = { content: '', active: true }
      streaming[sessionId].content += (msg.token || '')
      streaming[sessionId].active = true
    } else if (msg.type === 'response-complete') {
      const content = msg.content || streaming[sessionId]?.content || ''
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
      isLoading.value = false
    } else if (msg.type === 'tool-executing') {
      msgs.push({
        role: 'tool',
        tool: msg.tool,
        input: msg.input,
        status: 'running',
        timestamp: Date.now(),
      })
    } else if (msg.type === 'tool-result') {
      const last = [...msgs].reverse().find((item) => item.role === 'tool' && item.tool === msg.tool)
      if (last) {
        last.result = msg.result
        last.status = 'done'
      }
    } else if (msg.type === 'question') {
      pendingQuestion[sessionId] = {
        requestId: msg.requestId || msg.id,
        question: msg.question,
        choices: msg.choices || [],
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
    isLoading.value = true
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

  return {
    sessions,
    currentSessionId,
    messages,
    streaming,
    pendingQuestion,
    isLoading,
    loadSessions,
    createSession,
    sendMessage,
    answerQuestion,
    switchSession,
    getMessages,
  }
})
