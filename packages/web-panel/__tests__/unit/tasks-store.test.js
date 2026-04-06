import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const onMessageHandlers = new Set()
const onRuntimeEventHandlers = new Set()
const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    sendRaw,
    onMessage: (handler) => {
      onMessageHandlers.add(handler)
      return () => onMessageHandlers.delete(handler)
    },
    onRuntimeEvent: (handler) => {
      onRuntimeEventHandlers.add(handler)
      return () => onRuntimeEventHandlers.delete(handler)
    },
  }),
}))

import { useTasksStore } from '../../src/stores/tasks.js'

describe('tasks store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sendRaw.mockReset()
    onMessageHandlers.clear()
    onRuntimeEventHandlers.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetchTasks uses tasks-list websocket protocol', async () => {
    sendRaw.mockResolvedValueOnce({
      type: 'tasks-list',
      tasks: [{ id: 'task-1', status: 'running' }],
    })

    const store = useTasksStore()
    await store.fetchTasks()

    expect(sendRaw).toHaveBeenCalledWith({ type: 'tasks-list' })
    expect(store.tasks).toEqual([{ id: 'task-1', status: 'running' }])
  })

  it('stopTask sends tasks-stop and refreshes tasks', async () => {
    sendRaw
      .mockResolvedValueOnce({ type: 'tasks-stopped', taskId: 'task-1' })
      .mockResolvedValueOnce({
        type: 'tasks-list',
        tasks: [{ id: 'task-1', status: 'failed', error: 'Stopped by user' }],
      })

    const store = useTasksStore()
    await store.stopTask('task-1')

    expect(sendRaw).toHaveBeenNthCalledWith(1, { type: 'tasks-stop', taskId: 'task-1' })
    expect(sendRaw).toHaveBeenNthCalledWith(2, { type: 'tasks-list' })
    expect(store.tasks[0].status).toBe('failed')
  })

  it('subscribes to notifications once and clears subscription on stopPolling', async () => {
    sendRaw.mockResolvedValue({ type: 'tasks-list', tasks: [] })

    const store = useTasksStore()
    store.startPolling(5000)

    expect(onRuntimeEventHandlers.size).toBe(1)

    store.startPolling(5000)
    expect(onRuntimeEventHandlers.size).toBe(1)

    store.stopPolling()
    expect(onRuntimeEventHandlers.size).toBe(0)
  })

  it('notification updates lastNotification and triggers refresh', async () => {
    sendRaw
      .mockResolvedValueOnce({ type: 'tasks-list', tasks: [] })
      .mockResolvedValueOnce({
        type: 'tasks-list',
        tasks: [{ id: 'task-2', status: 'completed', result: 'ok' }],
      })

    const store = useTasksStore()
    store.startPolling(5000)

    const [handler] = [...onRuntimeEventHandlers]
    handler({
      type: 'task:notification',
      payload: {
        task: { id: 'task-2', status: 'completed', result: 'ok' },
      },
    })
    await Promise.resolve()

    expect(store.lastNotification).toEqual({
      id: 'task-2',
      status: 'completed',
      result: 'ok',
    })
    expect(sendRaw).toHaveBeenLastCalledWith({ type: 'tasks-list' })

    vi.advanceTimersByTime(8000)
    expect(store.lastNotification).toBeNull()
  })
})
