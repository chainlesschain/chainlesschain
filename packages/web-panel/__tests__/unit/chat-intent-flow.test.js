import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// ---------------------------------------------------------------------------
// Mock the WS store BEFORE importing the chat store. Each helper is a vi.fn so
// individual tests can stub the response shape.
// ---------------------------------------------------------------------------
const sendRaw = vi.fn()
const sendStream = vi.fn()
const createSession = vi.fn()
const listSessions = vi.fn()
const resumeSession = vi.fn()
const sendSessionMessage = vi.fn()
const answerQuestion = vi.fn()
const onRuntimeEvent = vi.fn(() => () => {})
const onSession = vi.fn(() => () => {})

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    sendRaw,
    sendStream,
    onRuntimeEvent,
    onSession,
    createSession,
    listSessions,
    resumeSession,
    sendSessionMessage,
    answerQuestion,
  }),
}))

import { useChatStore } from '../../src/stores/chat.js'

beforeEach(() => {
  setActivePinia(createPinia())
  sendRaw.mockReset()
  sendStream.mockReset()
  createSession.mockReset()
  listSessions.mockReset()
  resumeSession.mockReset()
  sendSessionMessage.mockReset()
  answerQuestion.mockReset()
  onRuntimeEvent.mockClear()
  onSession.mockClear()
  // Reset persisted contextMode + intent decisions between tests.
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

describe('chat store — contextMode', () => {
  it('defaults to global when not in project mode', () => {
    const store = useChatStore()
    expect(store.contextMode).toBe('global')
  })

  it('setContextMode writes to localStorage and updates ref', () => {
    const store = useChatStore()
    store.setContextMode('project')
    expect(store.contextMode).toBe('project')
    expect(localStorage.getItem('cc.web-panel.chat.contextMode')).toBe('project')
  })

  it('rejects unknown context modes', () => {
    const store = useChatStore()
    store.setContextMode('not-a-mode')
    expect(store.contextMode).toBe('global')
  })

  it('coerces persisted "file" back to global (file always disabled in web-shell)', async () => {
    localStorage.setItem('cc.web-panel.chat.contextMode', 'file')
    setActivePinia(createPinia())
    // Re-import via fresh pinia — rehydrate path runs in store factory.
    const fresh = useChatStore()
    expect(fresh.contextMode).toBe('global')
  })
})

describe('chat store — submitUserInput intent flow', () => {
  it('global mode: bypasses intent.understand and calls sendSessionMessage directly', async () => {
    createSession.mockResolvedValueOnce('s-1')
    const store = useChatStore()
    await store.createSession('chat')
    await store.submitUserInput('s-1', 'hello world')
    expect(sendRaw).not.toHaveBeenCalled()
    expect(sendSessionMessage).toHaveBeenCalledWith('s-1', 'hello world')
  })

  it('project mode + useful understanding: pushes INTENT_CONFIRMATION, holds send', async () => {
    createSession.mockResolvedValueOnce('s-2')
    sendStream.mockResolvedValueOnce({
      success: true,
      correctedInput: 'fix login',
      intent: '修复登录',
      keyPoints: ['登录', 'bug'],
    })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')

    await store.submitUserInput('s-2', 'fxi loign')
    const msgs = store.getMessages('s-2')
    const card = msgs.find((m) => m.type === 'intent-confirmation')
    expect(card).toBeTruthy()
    expect(card.metadata.originalInput).toBe('fxi loign')
    expect(card.metadata.understanding.correctedInput).toBe('fix login')
    expect(card.metadata.streaming).toBe(false)
    // Original input is held — agent has NOT been called yet.
    expect(sendSessionMessage).not.toHaveBeenCalled()
  })

  it('project mode + LLM unconfigured: falls through to direct send', async () => {
    createSession.mockResolvedValueOnce('s-3')
    sendStream.mockResolvedValueOnce({ success: false, correctedInput: 'x', intent: 'general', keyPoints: [] })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    await store.submitUserInput('s-3', 'anything')
    expect(sendSessionMessage).toHaveBeenCalledWith('s-3', 'anything')
    // Placeholder must be removed when we fall through to direct send.
    const msgs = store.getMessages('s-3')
    expect(msgs.find((m) => m.type === 'intent-confirmation')).toBeUndefined()
  })

  it('project mode + understanding identical to input: skips card and sends directly', async () => {
    createSession.mockResolvedValueOnce('s-4')
    sendStream.mockResolvedValueOnce({
      success: true,
      correctedInput: 'identical',
      intent: 'general',
      keyPoints: [],
    })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    await store.submitUserInput('s-4', 'identical')
    expect(sendSessionMessage).toHaveBeenCalledWith('s-4', 'identical')
    const msgs = store.getMessages('s-4')
    expect(msgs.find((m) => m.type === 'intent-confirmation')).toBeUndefined()
  })

  it('confirmIntent finalises card status=confirmed and dispatches original input', async () => {
    createSession.mockResolvedValueOnce('s-5')
    sendStream.mockResolvedValueOnce({
      success: true,
      correctedInput: 'fix login',
      intent: '修复登录',
      keyPoints: ['k'],
    })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    await store.submitUserInput('s-5', 'fxi loign')
    const card = store.getMessages('s-5').find((m) => m.type === 'intent-confirmation')

    await store.confirmIntent('s-5', card.id)
    expect(card.metadata.status).toBe('confirmed')
    expect(sendSessionMessage).toHaveBeenCalledWith('s-5', 'fxi loign')
  })

  it('correctIntent finalises card status=corrected and dispatches correction', async () => {
    createSession.mockResolvedValueOnce('s-6')
    sendStream.mockResolvedValueOnce({
      success: true,
      correctedInput: 'fix login',
      intent: 'x',
      keyPoints: ['y'],
    })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    await store.submitUserInput('s-6', 'fxi loign')
    const card = store.getMessages('s-6').find((m) => m.type === 'intent-confirmation')

    await store.correctIntent('s-6', card.id, 'fix login flow')
    expect(card.metadata.status).toBe('corrected')
    expect(card.metadata.correction).toBe('fix login flow')
    expect(sendSessionMessage).toHaveBeenCalledWith('s-6', 'fix login flow')
  })

  it('intent.understand WS error degrades to direct send', async () => {
    createSession.mockResolvedValueOnce('s-7')
    sendStream.mockRejectedValueOnce(new Error('network'))
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    await store.submitUserInput('s-7', 'hi')
    expect(sendSessionMessage).toHaveBeenCalledWith('s-7', 'hi')
  })
})

describe('chat store — Improvement 1 (streaming intent)', () => {
  it('uses sendStream and forwards onChunk', async () => {
    createSession.mockResolvedValueOnce('s-stream-1')
    let onChunk
    sendStream.mockImplementationOnce((_payload, opts) => {
      onChunk = opts.onChunk
      // Simulate a few token chunks before resolving.
      onChunk('a')
      onChunk('b')
      return Promise.resolve({ success: true, correctedInput: 'fix x', intent: 'i', keyPoints: ['k'] })
    })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    await store.submitUserInput('s-stream-1', 'fxi x')

    expect(sendStream).toHaveBeenCalledTimes(1)
    expect(sendStream.mock.calls[0][0].type).toBe('chat.intent.understand-stream')
    const card = store.getMessages('s-stream-1').find((m) => m.type === 'intent-confirmation')
    expect(card).toBeTruthy()
    expect(card.metadata.streaming).toBe(false)
    // The placeholder counted both incoming chunks before the final result.
    expect(card.metadata.streamingTokens).toBe(2)
  })
})

describe('chat store — Improvement 2 (multi-turn history)', () => {
  it('forwards last user/assistant exchanges in chat.intent.understand-stream payload', async () => {
    createSession.mockResolvedValueOnce('s-hist-1')
    sendStream.mockResolvedValueOnce({
      success: true,
      correctedInput: 'do it',
      intent: 'go',
      keyPoints: ['x'],
    })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    // Seed prior history.
    const msgs = store.getMessages('s-hist-1')
    msgs.push({ role: 'user', content: 'first', timestamp: 1 })
    msgs.push({ role: 'assistant', content: 'reply', timestamp: 2 })
    msgs.push({ role: 'tool', tool: 't', timestamp: 3 })

    await store.submitUserInput('s-hist-1', '再来一次')
    const payload = sendStream.mock.calls[0][0]
    expect(Array.isArray(payload.history)).toBe(true)
    // Tool messages are filtered out.
    expect(payload.history.every((m) => m.role !== 'tool')).toBe(true)
    expect(payload.history[0]).toMatchObject({ role: 'user', content: 'first' })
    expect(payload.history[1]).toMatchObject({ role: 'assistant', content: 'reply' })
  })
})

describe('chat store — Improvement 3 (persisted intent decisions)', () => {
  it('persists confirmIntent + correctIntent to localStorage', async () => {
    createSession.mockResolvedValueOnce('s-persist-1')
    sendStream.mockResolvedValueOnce({
      success: true,
      correctedInput: 'corr',
      intent: 'i',
      keyPoints: ['k'],
    })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    await store.submitUserInput('s-persist-1', 'orig')
    const card = store.getMessages('s-persist-1').find((m) => m.type === 'intent-confirmation')

    await store.confirmIntent('s-persist-1', card.id)
    const persisted = JSON.parse(localStorage.getItem('cc.web-panel.chat.intentDecisions'))
    const stored = persisted[`s-persist-1::${card.id}`]
    expect(stored.status).toBe('confirmed')
  })

  it('correctIntent records the correction text', async () => {
    createSession.mockResolvedValueOnce('s-persist-2')
    sendStream.mockResolvedValueOnce({
      success: true,
      correctedInput: 'corr',
      intent: 'i',
      keyPoints: ['k'],
    })
    const store = useChatStore()
    store.setContextMode('project')
    await store.createSession('chat')
    await store.submitUserInput('s-persist-2', 'orig')
    const card = store.getMessages('s-persist-2').find((m) => m.type === 'intent-confirmation')

    await store.correctIntent('s-persist-2', card.id, 'my correction')
    const persisted = JSON.parse(localStorage.getItem('cc.web-panel.chat.intentDecisions'))
    expect(persisted[`s-persist-2::${card.id}`].status).toBe('corrected')
    expect(persisted[`s-persist-2::${card.id}`].correction).toBe('my correction')
  })
})

describe('chat store — Improvement 4 (customQuickPrompts)', () => {
  it('setCustomQuickPrompts persists trimmed entries to localStorage', () => {
    const store = useChatStore()
    store.setCustomQuickPrompts(['  one  ', '', 'two', '  '])
    expect(store.customQuickPrompts).toEqual(['one', 'two'])
    expect(JSON.parse(localStorage.getItem('cc.web-panel.chat.customQuickPrompts'))).toEqual(['one', 'two'])
  })

  it('caps to 12 entries and 120 chars per entry', () => {
    const store = useChatStore()
    const overlong = 'x'.repeat(121)
    const arr = ['ok'].concat(Array(20).fill('item')).concat([overlong])
    store.setCustomQuickPrompts(arr)
    expect(store.customQuickPrompts.length).toBe(12)
    expect(store.customQuickPrompts.every((s) => s.length <= 120)).toBe(true)
  })

  it('null clears the override and removes the localStorage key', () => {
    const store = useChatStore()
    store.setCustomQuickPrompts(['x'])
    expect(localStorage.getItem('cc.web-panel.chat.customQuickPrompts')).not.toBeNull()
    store.setCustomQuickPrompts(null)
    expect(store.customQuickPrompts).toBeNull()
    expect(localStorage.getItem('cc.web-panel.chat.customQuickPrompts')).toBeNull()
  })
})

describe('chat store — autoSendMessage staging', () => {
  it('scheduleAutoSend stores the request with a unique token', () => {
    const store = useChatStore()
    store.scheduleAutoSend({ prompt: 'a' })
    const first = store.pendingAutoSend
    expect(first).toMatchObject({ prompt: 'a', autoSend: true, session: null })
    expect(typeof first.token).toBe('string')

    store.scheduleAutoSend({ prompt: 'b', autoSend: false, session: 'sx' })
    const second = store.pendingAutoSend
    expect(second.prompt).toBe('b')
    expect(second.autoSend).toBe(false)
    expect(second.session).toBe('sx')
    expect(second.token).not.toBe(first.token)
  })

  it('scheduleAutoSend ignores empty prompt', () => {
    const store = useChatStore()
    store.scheduleAutoSend({ prompt: '   ' })
    expect(store.pendingAutoSend).toBeNull()
  })

  it('clearAutoSend resets the staged request', () => {
    const store = useChatStore()
    store.scheduleAutoSend({ prompt: 'x' })
    expect(store.pendingAutoSend).not.toBeNull()
    store.clearAutoSend()
    expect(store.pendingAutoSend).toBeNull()
  })
})

describe('chat store — classifyFollowupIntent', () => {
  it('proxies to chat.intent.classify-followup WS topic', async () => {
    sendRaw.mockResolvedValueOnce({
      intent: 'CANCEL_TASK',
      confidence: 1,
      reason: 'r',
      method: 'rule',
    })
    const store = useChatStore()
    const result = await store.classifyFollowupIntent('s-9', '算了')
    expect(sendRaw).toHaveBeenCalledTimes(1)
    expect(sendRaw.mock.calls[0][0].type).toBe('chat.intent.classify-followup')
    expect(sendRaw.mock.calls[0][0].input).toBe('算了')
    expect(result.intent).toBe('CANCEL_TASK')
  })

  it('returns null on WS error rather than throwing', async () => {
    sendRaw.mockRejectedValueOnce(new Error('boom'))
    const store = useChatStore()
    const result = await store.classifyFollowupIntent('s-10', 'x')
    expect(result).toBeNull()
  })

  it('pushFollowupIntentBanner appends a system banner to the session', () => {
    const store = useChatStore()
    store.pushFollowupIntentBanner('s-11', 'CONTINUE_EXECUTION', 'go')
    const banner = store.getMessages('s-11').find((m) => m.role === 'system')
    expect(banner).toBeTruthy()
    expect(banner.content).toContain('✅')
  })
})
