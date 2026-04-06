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
