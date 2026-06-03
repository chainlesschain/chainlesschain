import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const runtimeHandlers = new Set()
const sessionHandlers = new Map()
const createSession = vi.fn()
const listSessions = vi.fn()
const resumeSession = vi.fn()
const sendSessionMessage = vi.fn()
const answerQuestion = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    onRuntimeEvent: (handler) => {
      runtimeHandlers.add(handler)
      return () => runtimeHandlers.delete(handler)
    },
    onSession: (sessionId, handler) => {
      sessionHandlers.set(sessionId, handler)
      return () => sessionHandlers.delete(sessionId)
    },
    createSession,
    listSessions,
    resumeSession,
    sendSessionMessage,
    answerQuestion,
  }),
}))

import { useChatStore } from '../../src/stores/chat.js'

describe('chat store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runtimeHandlers.clear()
    sessionHandlers.clear()
    createSession.mockReset()
    listSessions.mockReset()
    resumeSession.mockReset()
    sendSessionMessage.mockReset()
    answerQuestion.mockReset()
  })

  it('subscribes to runtime session events and deduplicates session creation', async () => {
    createSession.mockResolvedValueOnce('sess-1')
    const store = useChatStore()

    const sessionId = await store.createSession('agent')
    expect(sessionId).toBe('sess-1')
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].id).toBe('sess-1')
    expect(runtimeHandlers.size).toBe(1)

    const [handler] = [...runtimeHandlers]
    handler({
      type: 'session:start',
      payload: { sessionId: 'sess-1', sessionType: 'agent' },
    })

    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].type).toBe('agent')
  })

  it('applies resumed session history from runtime events', async () => {
    listSessions.mockResolvedValueOnce([])
    const store = useChatStore()
    await store.loadSessions()

    const [handler] = [...runtimeHandlers]
    handler({
      type: 'session:resume',
      payload: {
        sessionId: 'sess-2',
        history: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'world' },
        ],
      },
    })

    expect(store.getMessages('sess-2')).toEqual([
      expect.objectContaining({ role: 'user', content: 'hello' }),
      expect.objectContaining({ role: 'assistant', content: 'world' }),
    ])
    expect(store.sessions[0]).toEqual(
      expect.objectContaining({
        id: 'sess-2',
        messageCount: 2,
      }),
    )
  })

  it('hydrates session summary fields from runtime event record payloads', async () => {
    listSessions.mockResolvedValueOnce([])
    const store = useChatStore()
    await store.loadSessions()

    const [handler] = [...runtimeHandlers]
    handler({
      type: 'session:start',
      payload: {
        sessionId: 'sess-10',
        record: {
          id: 'sess-10',
          type: 'agent',
          provider: 'openai',
          model: 'gpt-4o',
          projectRoot: 'C:/code/demo',
          messageCount: 3,
          status: 'created',
        },
      },
    })
    handler({
      type: 'session:resume',
      payload: {
        sessionId: 'sess-10',
        history: [{ role: 'user', content: 'resume me' }],
        record: {
          id: 'sess-10',
          type: 'agent',
          provider: 'openai',
          model: 'gpt-4o',
          projectRoot: 'C:/code/demo',
          messageCount: 7,
          status: 'resumed',
        },
      },
    })

    expect(store.sessions[0]).toEqual(
      expect.objectContaining({
        id: 'sess-10',
        type: 'agent',
        provider: 'openai',
        model: 'gpt-4o',
        projectRoot: 'C:/code/demo',
        messageCount: 7,
        status: 'resumed',
      }),
    )
  })

  it('removes session on session:end runtime event', async () => {
    createSession.mockResolvedValueOnce('sess-3')
    const store = useChatStore()
    await store.createSession('chat')
    store.currentSessionId = 'sess-3'

    const [handler] = [...runtimeHandlers]
    handler({
      type: 'session:end',
      payload: { sessionId: 'sess-3' },
    })

    expect(store.sessions).toHaveLength(0)
    expect(store.currentSessionId).toBe(null)
  })

  it('falls back to the next available session when the current one ends', async () => {
    listSessions.mockResolvedValueOnce([
      { id: 'sess-a', type: 'chat', title: 'A' },
      { id: 'sess-b', type: 'agent', title: 'B' },
    ])
    const store = useChatStore()
    await store.loadSessions()
    store.currentSessionId = 'sess-a'

    const [handler] = [...runtimeHandlers]
    handler({
      type: 'session:end',
      payload: { sessionId: 'sess-a' },
    })

    expect(store.sessions).toEqual([expect.objectContaining({ id: 'sess-b' })])
    expect(store.currentSessionId).toBe('sess-b')
  })

  it('handles v1.0 assistant.delta and assistant.final event types', async () => {
    createSession.mockResolvedValueOnce('sess-v1')
    const store = useChatStore()
    await store.createSession('chat')

    const sessionHandler = sessionHandlers.get('sess-v1')
    expect(sessionHandler).toBeDefined()

    // Send user message
    await store.sendMessage('sess-v1', 'hi')

    // v1.0 streaming token (assistant.delta)
    sessionHandler({
      type: 'assistant.delta',
      sessionId: 'sess-v1',
      payload: { delta: 'Hello' },
    })
    sessionHandler({
      type: 'assistant.delta',
      sessionId: 'sess-v1',
      payload: { delta: ' world' },
    })

    expect(store.streaming['sess-v1'].content).toBe('Hello world')
    expect(store.streaming['sess-v1'].active).toBe(true)

    // v1.0 response complete (assistant.final)
    sessionHandler({
      type: 'assistant.final',
      sessionId: 'sess-v1',
      payload: { content: 'Hello world!' },
    })

    expect(store.streaming['sess-v1'].active).toBe(false)
    const msgs = store.getMessages('sess-v1')
    expect(msgs[msgs.length - 1]).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'Hello world!' }),
    )
    expect(store.isLoading).toBe(false)
    expect(store.getIsLoading('sess-v1')).toBe(false)
  })

  it('handles v1.0 tool.call.started and tool.call.completed', async () => {
    createSession.mockResolvedValueOnce('sess-tool')
    const store = useChatStore()
    await store.createSession('agent')

    const sessionHandler = sessionHandlers.get('sess-tool')

    sessionHandler({
      type: 'tool.call.started',
      sessionId: 'sess-tool',
      payload: { toolName: 'read_file', input: { path: '/tmp/test.js' } },
    })

    const msgs = store.getMessages('sess-tool')
    expect(msgs[0]).toEqual(
      expect.objectContaining({ role: 'tool', tool: 'read_file', status: 'running' }),
    )

    sessionHandler({
      type: 'tool.call.completed',
      sessionId: 'sess-tool',
      payload: { toolName: 'read_file', result: 'file contents' },
    })

    expect(msgs[0].status).toBe('done')
    expect(msgs[0].result).toBe('file contents')
  })

  it('handles v1.0 error events in chat as assistant messages', async () => {
    createSession.mockResolvedValueOnce('sess-err')
    const store = useChatStore()
    await store.createSession('chat')

    const sessionHandler = sessionHandlers.get('sess-err')
    await store.sendMessage('sess-err', 'test')

    sessionHandler({
      type: 'error',
      sessionId: 'sess-err',
      payload: { message: 'API key required for volcengine' },
    })

    const msgs = store.getMessages('sess-err')
    expect(msgs[msgs.length - 1].content).toContain('API key required')
    expect(store.isLoading).toBe(false)
  })

  it('tracks loading per session instead of globally', async () => {
    createSession
      .mockResolvedValueOnce('sess-a')
      .mockResolvedValueOnce('sess-b')

    const store = useChatStore()
    await store.createSession('chat')
    await store.createSession('chat')

    await store.sendMessage('sess-a', 'hello a')
    await store.sendMessage('sess-b', 'hello b')

    expect(store.getIsLoading('sess-a')).toBe(true)
    expect(store.getIsLoading('sess-b')).toBe(true)
    expect(store.isLoading).toBe(true)

    sessionHandlers.get('sess-a')({
      type: 'assistant.final',
      sessionId: 'sess-a',
      payload: { content: 'done a' },
    })

    expect(store.getIsLoading('sess-a')).toBe(false)
    expect(store.getIsLoading('sess-b')).toBe(true)
    expect(store.isLoading).toBe(true)

    store.currentSessionId = 'sess-a'
    expect(store.isLoading).toBe(false)

    store.currentSessionId = 'sess-b'
    expect(store.isLoading).toBe(true)
  })

  it('switchSession resumes history when local cache is empty', async () => {
    listSessions.mockResolvedValueOnce([{ id: 'sess-4', type: 'chat', title: 'cached' }])
    resumeSession.mockResolvedValueOnce({
      type: 'session-resumed',
      sessionId: 'sess-4',
      history: [{ role: 'user', content: 'hello again' }],
    })

    const store = useChatStore()
    await store.loadSessions()
    await store.switchSession('sess-4')

    expect(resumeSession).toHaveBeenCalledWith('sess-4')
  })
})
