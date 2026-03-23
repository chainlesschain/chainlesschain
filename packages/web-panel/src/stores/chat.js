import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { useWsStore } from './ws.js'

export const useChatStore = defineStore('chat', () => {
  const sessions = ref([])
  const currentSessionId = ref(null)
  const messages = reactive({}) // sessionId → message[]
  const streaming = reactive({}) // sessionId → { content, active }
  const pendingQuestion = reactive({}) // sessionId → { requestId, question, choices }
  const isLoading = ref(false)

  function getMessages(sessionId) {
    if (!messages[sessionId]) messages[sessionId] = []
    return messages[sessionId]
  }

  async function loadSessions() {
    const ws = useWsStore()
    sessions.value = await ws.listSessions()
  }

  async function createSession(type = 'chat') {
    const ws = useWsStore()
    const sessionId = await ws.createSession(type)

    // Add to local sessions list
    sessions.value.unshift({
      id: sessionId,
      type,
      title: type === 'chat' ? '新对话' : '新 Agent',
      createdAt: Date.now(),
      messageCount: 0
    })

    // Register stream handler
    ws.onSession(sessionId, (msg) => handleSessionMsg(sessionId, msg))

    currentSessionId.value = sessionId
    messages[sessionId] = []
    streaming[sessionId] = { content: '', active: false }
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
      // Update session title from first message if default
      const session = sessions.value.find(s => s.id === sessionId)
      if (session && session.title.startsWith('新')) {
        const firstUser = msgs.find(m => m.role === 'user')
        if (firstUser) session.title = firstUser.content.slice(0, 30)
      }
      isLoading.value = false
    } else if (msg.type === 'tool-executing') {
      msgs.push({
        role: 'tool',
        tool: msg.tool,
        input: msg.input,
        status: 'running',
        timestamp: Date.now()
      })
    } else if (msg.type === 'tool-result') {
      // Update last tool message
      const last = [...msgs].reverse().find(m => m.role === 'tool' && m.tool === msg.tool)
      if (last) { last.result = msg.result; last.status = 'done' }
    } else if (msg.type === 'question') {
      pendingQuestion[sessionId] = {
        requestId: msg.requestId || msg.id,
        question: msg.question,
        choices: msg.choices || []
      }
    }
  }

  async function sendMessage(sessionId, content) {
    const ws = useWsStore()
    const msgs = getMessages(sessionId)
    msgs.push({ role: 'user', content, timestamp: Date.now() })
    if (!streaming[sessionId]) streaming[sessionId] = { content: '', active: false }
    streaming[sessionId].active = true
    isLoading.value = true
    ws.sendSessionMessage(sessionId, content)
  }

  function answerQuestion(sessionId, answer) {
    const ws = useWsStore()
    const q = pendingQuestion[sessionId]
    if (!q) return
    ws.answerQuestion(sessionId, q.requestId, answer)
    delete pendingQuestion[sessionId]
  }

  async function switchSession(sessionId) {
    currentSessionId.value = sessionId
    if (!messages[sessionId]) {
      messages[sessionId] = []
      streaming[sessionId] = { content: '', active: false }
      const ws = useWsStore()
      ws.onSession(sessionId, (msg) => handleSessionMsg(sessionId, msg))
    }
  }

  return {
    sessions, currentSessionId, messages, streaming, pendingQuestion, isLoading,
    loadSessions, createSession, sendMessage, answerQuestion, switchSession, getMessages
  }
})
