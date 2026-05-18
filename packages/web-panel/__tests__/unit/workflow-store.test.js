import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const onMessageHandlers = new Set()
const sendRaw = vi.fn()
const waitConnected = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    sendRaw,
    waitConnected,
    onMessage: (handler) => {
      onMessageHandlers.add(handler)
      return () => onMessageHandlers.delete(handler)
    },
  }),
}))

import { useWorkflowStore } from '../../src/stores/workflow.js'

describe('workflow store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sendRaw.mockReset()
    onMessageHandlers.clear()
  })

  it('list() fetches workflows via workflow-list protocol', async () => {
    sendRaw.mockResolvedValueOnce({
      type: 'workflow:list',
      workflows: [{ id: 'wf1', name: 'F', steps: [] }],
    })
    const store = useWorkflowStore()
    const result = await store.list()
    expect(sendRaw).toHaveBeenCalledWith({ type: 'workflow-list' })
    expect(result.map((w) => w.id)).toEqual(['wf1'])
    expect(store.workflows.length).toBe(1)
  })

  it('list() captures error message on failure', async () => {
    sendRaw.mockRejectedValueOnce(new Error('ws down'))
    const store = useWorkflowStore()
    await expect(store.list()).rejects.toThrow('ws down')
    expect(store.error).toBe('ws down')
    expect(store.loading).toBe(false)
  })

  it('get() returns workflow and updates current', async () => {
    sendRaw.mockResolvedValueOnce({
      type: 'workflow:get',
      workflow: { id: 'wf1', name: 'F', steps: [] },
    })
    const store = useWorkflowStore()
    const wf = await store.get('wf1')
    expect(sendRaw).toHaveBeenCalledWith({ type: 'workflow-get', id: 'wf1' })
    expect(wf.id).toBe('wf1')
    expect(store.current.id).toBe('wf1')
  })

  it('save() inserts new workflow into local list', async () => {
    sendRaw.mockResolvedValueOnce({ type: 'workflow:save', saved: true, workflowId: 'wf1' })
    const store = useWorkflowStore()
    const wf = { id: 'wf1', name: 'F', steps: [{ id: 's1', message: 'hi' }] }
    await store.save(wf)
    expect(sendRaw).toHaveBeenCalledWith({ type: 'workflow-save', workflow: wf })
    expect(store.workflows.find((w) => w.id === 'wf1')).toBeTruthy()
  })

  it('save() replaces existing workflow by id', async () => {
    sendRaw.mockResolvedValue({ type: 'workflow:save', saved: true, workflowId: 'wf1' })
    const store = useWorkflowStore()
    await store.save({ id: 'wf1', name: 'v1', steps: [] })
    await store.save({ id: 'wf1', name: 'v2', steps: [] })
    expect(store.workflows).toHaveLength(1)
    expect(store.workflows[0].name).toBe('v2')
  })

  it('remove() deletes workflow from local list', async () => {
    sendRaw
      .mockResolvedValueOnce({ type: 'workflow:save', saved: true, workflowId: 'wf1' })
      .mockResolvedValueOnce({ type: 'workflow:remove', removed: true })
    const store = useWorkflowStore()
    await store.save({ id: 'wf1', name: 'F', steps: [] })
    await store.remove('wf1')
    expect(sendRaw).toHaveBeenLastCalledWith({ type: 'workflow-remove', id: 'wf1' })
    expect(store.workflows).toHaveLength(0)
  })

  it('run() collects workflow events and sets runStatus on done', async () => {
    sendRaw.mockImplementationOnce(async (req) => {
      // Simulate server pushing streaming events concurrently
      const handlers = [...onMessageHandlers]
      handlers.forEach((h) => h({ type: 'workflow:started', runId: 'r1' }))
      handlers.forEach((h) =>
        h({ type: 'workflow:step-start', stepId: 's1', message: 'hi' }),
      )
      handlers.forEach((h) =>
        h({ type: 'workflow:step-complete', stepId: 's1', status: 'completed', summary: 'ok' }),
      )
      handlers.forEach((h) => h({ type: 'workflow:done', runId: 'r1', status: 'completed' }))
      return { type: 'workflow:done', runId: 'r1', status: 'completed' }
    })
    const store = useWorkflowStore()
    await store.run('wf1')
    expect(store.runStatus).toBe('completed')
    expect(store.runEvents.map((e) => e.type)).toEqual([
      'workflow:started',
      'workflow:step-start',
      'workflow:step-complete',
      'workflow:done',
    ])
  })

  it('run() sets runStatus=failed on request error', async () => {
    sendRaw.mockRejectedValueOnce(new Error('boom'))
    const store = useWorkflowStore()
    await expect(store.run('wf1')).rejects.toThrow('boom')
    expect(store.runStatus).toBe('failed')
  })

  it('run() ignores non-workflow messages', async () => {
    sendRaw.mockImplementationOnce(async () => {
      const handlers = [...onMessageHandlers]
      handlers.forEach((h) => h({ type: 'log', data: 'noise' }))
      handlers.forEach((h) => h({ type: 'workflow:done', status: 'completed' }))
      return { type: 'workflow:done', status: 'completed' }
    })
    const store = useWorkflowStore()
    await store.run('wf1')
    expect(store.runEvents).toHaveLength(1)
    expect(store.runEvents[0].type).toBe('workflow:done')
  })

  it('validateLocal rejects workflow without id/name', () => {
    const store = useWorkflowStore()
    const res = store.validateLocal({ steps: [{ id: 's1' }] })
    expect(res.valid).toBe(false)
    expect(res.errors).toContain('id required')
    expect(res.errors).toContain('name required')
  })

  it('validateLocal rejects empty steps', () => {
    const store = useWorkflowStore()
    const res = store.validateLocal({ id: 'x', name: 'y', steps: [] })
    expect(res.valid).toBe(false)
    expect(res.errors).toContain('steps required')
  })

  it('validateLocal detects duplicate step id', () => {
    const store = useWorkflowStore()
    const res = store.validateLocal({
      id: 'x',
      name: 'y',
      steps: [
        { id: 's1', message: 'a' },
        { id: 's1', message: 'b' },
      ],
    })
    expect(res.valid).toBe(false)
    expect(res.errors.some((e) => e.includes('duplicate'))).toBe(true)
  })

  it('validateLocal detects cycle in dependsOn', () => {
    const store = useWorkflowStore()
    const res = store.validateLocal({
      id: 'x',
      name: 'y',
      steps: [
        { id: 'a', message: '', dependsOn: ['b'] },
        { id: 'b', message: '', dependsOn: ['a'] },
      ],
    })
    expect(res.valid).toBe(false)
    expect(res.errors.some((e) => /cycle/.test(e))).toBe(true)
  })

  it('validateLocal flags unknown dependencies', () => {
    const store = useWorkflowStore()
    const res = store.validateLocal({
      id: 'x',
      name: 'y',
      steps: [{ id: 'a', message: '', dependsOn: ['nope'] }],
    })
    expect(res.valid).toBe(false)
    expect(res.errors.some((e) => e.includes('unknown dependency'))).toBe(true)
  })

  it('validateLocal accepts acyclic multi-step workflow', () => {
    const store = useWorkflowStore()
    const res = store.validateLocal({
      id: 'x',
      name: 'y',
      steps: [
        { id: 'a', message: 'a' },
        { id: 'b', message: 'b', dependsOn: ['a'] },
        { id: 'c', message: 'c', dependsOn: ['a', 'b'] },
      ],
    })
    expect(res.valid).toBe(true)
  })

  it('exportJson returns pretty-printed JSON', () => {
    const store = useWorkflowStore()
    const json = store.exportJson({ id: 'x', name: 'y', steps: [] })
    expect(json).toContain('  "id": "x"')
    expect(() => JSON.parse(json)).not.toThrow()
  })
})
