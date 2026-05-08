import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import { useWsStore } from './ws.js'
import {
  MessageType,
  createIntentConfirmationMessage,
  createIntentSystemMessage,
} from '../utils/messageTypes.js'

const DEFAULT_CHAT_TITLE = '新对话'
const DEFAULT_AGENT_TITLE = '新 Agent'
const CONTEXT_MODE_KEY = 'cc.web-panel.chat.contextMode'
const VALID_CONTEXT_MODES = ['project', 'file', 'global']
const INTENT_DECISIONS_KEY = 'cc.web-panel.chat.intentDecisions'
const INTENT_DECISIONS_LIMIT = 200
const INTENT_ENABLED_KEY = 'cc.web-panel.chat.intentEnabled'

function readPersistedContextMode() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CONTEXT_MODE_KEY) : null
    return VALID_CONTEXT_MODES.includes(raw) ? raw : null
  } catch (_) {
    return null
  }
}

// Intent understanding is OFF by default — the LLM round-trip before every
// project/file message added 0.5–90s of latency that surprised users used to
// the pre-v5.0.3.43 direct-send path. Users who want it back can flip the
// switch in Chat.vue header (persists to localStorage).
function readPersistedIntentEnabled() {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(INTENT_ENABLED_KEY) === 'true'
  } catch (_) {
    return false
  }
}

/**
 * Read intent-card decisions from localStorage. Shape:
 *   { "<sessionId>::<messageId>": { status, correction, ts }, ... }
 * Older entries above the LRU cap are evicted on write.
 */
function readPersistedIntentDecisions() {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(INTENT_DECISIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function writePersistedIntentDecisions(map) {
  try {
    if (typeof localStorage === 'undefined') return
    // Evict oldest by timestamp if over cap.
    const entries = Object.entries(map)
    if (entries.length > INTENT_DECISIONS_LIMIT) {
      entries.sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0))
      const trimmed = entries.slice(-INTENT_DECISIONS_LIMIT)
      map = Object.fromEntries(trimmed)
    }
    localStorage.setItem(INTENT_DECISIONS_KEY, JSON.stringify(map))
  } catch (_) {
    // Quota exceeded / private mode — degrade silently.
  }
}

function recordIntentDecision(sessionId, messageId, decision) {
  if (!sessionId || !messageId) return
  const map = readPersistedIntentDecisions()
  map[`${sessionId}::${messageId}`] = { ...decision, ts: Date.now() }
  writePersistedIntentDecisions(map)
}

function lookupIntentDecision(sessionId, messageId) {
  if (!sessionId || !messageId) return null
  const map = readPersistedIntentDecisions()
  return map[`${sessionId}::${messageId}`] || null
}

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

  const cfg = (typeof window !== 'undefined' && window.__CC_CONFIG__) || {}
  const isProjectEnv = cfg.mode === 'project'
  const defaultMode = isProjectEnv ? 'project' : 'global'
  const persisted = readPersistedContextMode()
  // If persisted mode is 'project' but we're not in a project env, fall back.
  // 'file' is currently always disabled in web-shell (no current-file concept).
  const initialMode =
    persisted === 'file' ? 'global'
    : persisted === 'project' && !isProjectEnv ? 'global'
    : (persisted || defaultMode)
  const contextMode = ref(initialMode)

  function setContextMode(mode) {
    if (!VALID_CONTEXT_MODES.includes(mode)) return
    contextMode.value = mode
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(CONTEXT_MODE_KEY, mode)
    } catch (_) {
      // localStorage may be unavailable (private browsing); degrade silently
    }
  }

  const intentEnabled = ref(readPersistedIntentEnabled())

  function setIntentEnabled(enabled) {
    intentEnabled.value = !!enabled
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(INTENT_ENABLED_KEY, intentEnabled.value ? 'true' : 'false')
      }
    } catch (_) {
      // localStorage may be unavailable (private browsing); degrade silently
    }
  }

  // ── Custom quick prompts (Improvement 4) ────────────────────────────
  // Defaults come from the i18n catalog; users may override per-environment
  // via setCustomQuickPrompts. Stored as an array of strings; null/empty
  // disables the override and falls back to i18n.
  const QUICK_PROMPTS_KEY = 'cc.web-panel.chat.customQuickPrompts'
  function readCustomQuickPrompts() {
    try {
      if (typeof localStorage === 'undefined') return null
      const raw = localStorage.getItem(QUICK_PROMPTS_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      const cleaned = parsed
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s) => s.length > 0 && s.length <= 120)
        .slice(0, 12)
      return cleaned.length > 0 ? cleaned : null
    } catch (_) {
      return null
    }
  }
  const customQuickPrompts = ref(readCustomQuickPrompts())
  function setCustomQuickPrompts(prompts) {
    if (prompts == null) {
      customQuickPrompts.value = null
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(QUICK_PROMPTS_KEY) } catch (_) { /* */ }
      return
    }
    if (!Array.isArray(prompts)) return
    const cleaned = prompts
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => s.length > 0 && s.length <= 120)
      .slice(0, 12)
    customQuickPrompts.value = cleaned.length > 0 ? cleaned : null
    try {
      if (typeof localStorage !== 'undefined') {
        if (cleaned.length > 0) {
          localStorage.setItem(QUICK_PROMPTS_KEY, JSON.stringify(cleaned))
        } else {
          localStorage.removeItem(QUICK_PROMPTS_KEY)
        }
      }
    } catch (_) {
      // Quota exceeded — degrade silently.
    }
  }

  // autoSendMessage protocol — programmatic staging from other views. The
  // ChatView watches this ref and consumes it on mount / change. Carries a
  // token so retries don't double-fire.
  const pendingAutoSend = ref(null)
  let _autoSendSeq = 0
  function scheduleAutoSend({ prompt, autoSend = true, session = null } = {}) {
    if (!prompt || !String(prompt).trim()) return
    _autoSendSeq += 1
    pendingAutoSend.value = {
      prompt: String(prompt),
      autoSend: autoSend !== false,
      session: session || null,
      token: `staged::${_autoSendSeq}::${Date.now()}`,
    }
  }
  function clearAutoSend() {
    pendingAutoSend.value = null
  }
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

  /**
   * High-level entry point used by the chat input. When `contextMode` is
   * project or file, run the intent-understanding flow first (V5 desktop
   * parity). When global — or when the backend can't deliver useful
   * understanding (no LLM configured / parse failure / pass-through) —
   * fall straight through to sendMessage so the UX stays usable offline.
   */
  async function submitUserInput(sessionId, content) {
    if (!sessionId || !content?.trim()) return
    const mode = contextMode.value
    // Intent understanding is opt-in (v5.0.3.45+). When disabled — the default —
    // even project/file mode skips the chat.intent.understand-stream round-trip
    // and goes straight to sendMessage so the user isn't blocked on a possibly-
    // hung LLM call. Toggleable via the 意图理解 switch in the Chat header.
    if (mode === 'global' || !intentEnabled.value) {
      await sendMessage(sessionId, content)
      return
    }
    const ws = useWsStore()
    // Slice the last few exchanges so the model can resolve "再来一次"-style
    // references. Trim each message body to keep the WS frame compact.
    const recent = getMessages(sessionId)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-5)
      .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 500) }))

    // Push a placeholder card immediately so the user sees "理解中…" while
    // the LLM streams. The card.metadata.understanding stays empty until
    // the .result frame arrives; IntentConfirmationMessage suppresses the
    // confirm/correct buttons whenever metadata.streaming is true.
    const placeholder = createIntentConfirmationMessage(content, {})
    placeholder.metadata.streaming = true
    placeholder.metadata.streamingTokens = 0
    placeholder.content = '理解中…'
    const msgs = getMessages(sessionId)
    msgs.push(placeholder)
    // Re-acquire the reactive Proxy reference. Vue 3 reactivity caveat:
    // pushing a plain object into a reactive collection wraps it in a Proxy,
    // but the local `placeholder` ref still points at the raw target. Any
    // later `placeholder.metadata.X = …` mutation bypasses the Proxy `set`
    // trap and never triggers a re-render — even though the data is updated
    // and unit tests reading `getMessages()[idx].metadata.X` still pass. Pre-
    // v5.0.3.46 this bug pinned the card visibly at "理解中… / 意图: 未识别"
    // for the entire LLM round-trip, even after `streaming=false` flipped on
    // the raw object.
    const card = msgs[msgs.length - 1]

    let understanding = null
    // Wall-clock ceiling on top of sendStream's 60s idle timer. The idle
    // timer rearms on every chunk, so a slow LLM that dribbles tokens but
    // never produces a `final` frame would keep the placeholder card spinning
    // indefinitely. Aborting the signal makes sendStream reject + emit a
    // `.cancel` frame so the server releases its end of the stream too.
    const ctl = new AbortController()
    const wallTimeoutId = setTimeout(
      () => ctl.abort(new Error('Intent understand wall-clock timeout')),
      90000,
    )
    try {
      const result = await ws.sendStream(
        {
          type: 'chat.intent.understand-stream',
          sessionId,
          userInput: content,
          contextMode: mode,
          history: recent,
        },
        {
          onChunk: () => {
            card.metadata.streamingTokens =
              (card.metadata.streamingTokens || 0) + 1
          },
          // The chat-intent-service caps maxTokens at 500 — even on slow
          // local Ollama that's well under a minute. Disable the idle
          // timer so a brief stall mid-stream doesn't kill the request.
          idleMs: 60000,
          signal: ctl.signal,
        },
      )
      if (result?.success) understanding = result
    } catch (_err) {
      // sendStream rejected — backend missing, stream broken, or wall-clock
      // timeout fired. Either way fall through to a direct send so the user
      // isn't stuck.
    } finally {
      clearTimeout(wallTimeoutId)
    }

    const hasUsefulUnderstanding =
      understanding &&
      ((understanding.correctedInput && understanding.correctedInput !== content) ||
        (Array.isArray(understanding.keyPoints) && understanding.keyPoints.length > 0))

    if (!hasUsefulUnderstanding) {
      // Drop the placeholder + run the original input through the agent.
      const idx = msgs.indexOf(card)
      if (idx >= 0) msgs.splice(idx, 1)
      await sendMessage(sessionId, content)
      return
    }

    // Promote the placeholder into the real confirmation card so the slot
    // re-renders with action buttons.
    card.content = '我理解您的需求如下，请确认：'
    card.metadata.streaming = false
    card.metadata.understanding = {
      correctedInput: understanding.correctedInput,
      intent: understanding.intent,
      keyPoints: understanding.keyPoints,
    }
    // Replay any persisted decision so a refresh-then-resend lands with the
    // user's prior choice still applied.
    const prior = lookupIntentDecision(sessionId, card.id)
    if (prior?.status) {
      card.metadata.status = prior.status
      if (prior.correction) card.metadata.correction = prior.correction
    }
  }

  /**
   * User confirmed the AI's understanding — finalize the card and dispatch
   * the original input to the agent.
   */
  async function confirmIntent(sessionId, messageId) {
    const msgs = getMessages(sessionId)
    const card = msgs.find((m) => m.id === messageId)
    if (!card || card.type !== MessageType.INTENT_CONFIRMATION) return
    if (card.metadata) card.metadata.status = 'confirmed'
    recordIntentDecision(sessionId, messageId, { status: 'confirmed', correction: null })
    const original = card.metadata?.originalInput || ''
    if (original.trim()) await sendMessage(sessionId, original)
  }

  /**
   * User edited the input — finalize the card with their correction and
   * dispatch the corrected text instead of the original.
   */
  async function correctIntent(sessionId, messageId, correction) {
    const msgs = getMessages(sessionId)
    const card = msgs.find((m) => m.id === messageId)
    if (!card || card.type !== MessageType.INTENT_CONFIRMATION) return
    if (card.metadata) {
      card.metadata.status = 'corrected'
      card.metadata.correction = correction
    }
    recordIntentDecision(sessionId, messageId, { status: 'corrected', correction })
    const text = (correction || '').trim()
    if (text) await sendMessage(sessionId, text)
  }

  /**
   * Classify a follow-up input while a task is running. Returns the raw
   * classifier result (intent + confidence + extractedInfo). The caller
   * decides whether to push a system message via createIntentSystemMessage.
   */
  async function classifyFollowupIntent(sessionId, input, context = {}) {
    const ws = useWsStore()
    try {
      const resp = await ws.sendRaw({
        type: 'chat.intent.classify-followup',
        sessionId,
        input,
        context,
      }, 20000)
      return resp
    } catch (_err) {
      return null
    }
  }

  /**
   * Push a system-style banner describing how a follow-up intent was
   * classified (the V5 createIntentSystemMessage UX).
   */
  function pushFollowupIntentBanner(sessionId, intent, userInput, options = {}) {
    const msgs = getMessages(sessionId)
    msgs.push(createIntentSystemMessage(intent, userInput, options))
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
    contextMode,
    setContextMode,
    intentEnabled,
    setIntentEnabled,
    customQuickPrompts,
    setCustomQuickPrompts,
    pendingAutoSend,
    scheduleAutoSend,
    clearAutoSend,
    getIsLoading,
    loadSessions,
    createSession,
    sendMessage,
    submitUserInput,
    confirmIntent,
    correctIntent,
    classifyFollowupIntent,
    pushFollowupIntentBanner,
    answerQuestion,
    switchSession,
    getMessages,
  }
})
