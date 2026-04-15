import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useWsStore } from './ws.js'

/**
 * Workflow store — CRUD + run streaming against the CLI WS gateway.
 * Backend handlers: workflow-list / workflow-get / workflow-save /
 * workflow-remove / workflow-run  (see packages/cli/src/gateways/ws/).
 */
export const useWorkflowStore = defineStore('workflow', () => {
  const ws = useWsStore()
  const workflows = ref([])
  const current = ref(null)
  const runEvents = ref([])
  const runStatus = ref('idle') // idle | running | completed | failed
  const loading = ref(false)
  const error = ref(null)

  async function list() {
    loading.value = true
    error.value = null
    try {
      await ws.waitConnected()
      const res = await ws.sendRaw({ type: 'workflow-list' })
      workflows.value = Array.isArray(res.workflows) ? res.workflows : []
      return workflows.value
    } catch (e) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function get(id) {
    await ws.waitConnected()
    const res = await ws.sendRaw({ type: 'workflow-get', id })
    current.value = res.workflow || null
    return current.value
  }

  async function save(workflow) {
    await ws.waitConnected()
    const res = await ws.sendRaw({ type: 'workflow-save', workflow })
    // Refresh local list on success
    if (res.saved) {
      const idx = workflows.value.findIndex((w) => w.id === workflow.id)
      if (idx >= 0) workflows.value.splice(idx, 1, workflow)
      else workflows.value.push(workflow)
    }
    return res
  }

  async function remove(id) {
    await ws.waitConnected()
    const res = await ws.sendRaw({ type: 'workflow-remove', id })
    if (res.removed) {
      workflows.value = workflows.value.filter((w) => w.id !== id)
    }
    return res
  }

  async function run(id, { onEvent } = {}) {
    await ws.waitConnected()
    runEvents.value = []
    runStatus.value = 'running'

    const unsubscribe = ws.onMessage((msg) => {
      if (!msg || typeof msg.type !== 'string') return
      if (!msg.type.startsWith('workflow:')) return
      runEvents.value.push(msg)
      if (onEvent) onEvent(msg)
      if (msg.type === 'workflow:done') {
        runStatus.value = msg.status || 'completed'
      }
    })

    try {
      const res = await ws.sendRaw({ type: 'workflow-run', id }, 120000)
      return res
    } catch (e) {
      runStatus.value = 'failed'
      error.value = e.message
      throw e
    } finally {
      unsubscribe()
    }
  }

  /** Local cycle detection — mirrors validateWorkflow on the backend. */
  function validateLocal(workflow) {
    const errors = []
    if (!workflow || typeof workflow !== 'object') {
      return { valid: false, errors: ['workflow must be an object'] }
    }
    if (!workflow.id) errors.push('id required')
    if (!workflow.name) errors.push('name required')
    if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      errors.push('steps required')
    } else {
      const ids = new Set()
      for (const s of workflow.steps) {
        if (!s.id) errors.push('step.id required')
        if (ids.has(s.id)) errors.push(`duplicate step id: ${s.id}`)
        ids.add(s.id)
      }
      // cycle detection via DFS
      const graph = new Map()
      for (const s of workflow.steps) graph.set(s.id, s.dependsOn || [])
      const WHITE = 0, GRAY = 1, BLACK = 2
      const color = new Map([...graph.keys()].map((k) => [k, WHITE]))
      function dfs(node) {
        color.set(node, GRAY)
        for (const dep of graph.get(node) || []) {
          if (!graph.has(dep)) {
            errors.push(`unknown dependency: ${dep}`)
            continue
          }
          const c = color.get(dep)
          if (c === GRAY) {
            errors.push(`cycle via ${node} -> ${dep}`)
            return
          }
          if (c === WHITE) dfs(dep)
        }
        color.set(node, BLACK)
      }
      for (const k of graph.keys()) if (color.get(k) === WHITE) dfs(k)
    }
    return { valid: errors.length === 0, errors }
  }

  function exportJson(workflow) {
    return JSON.stringify(workflow, null, 2)
  }

  return {
    workflows,
    current,
    runEvents,
    runStatus,
    loading,
    error,
    list,
    get,
    save,
    remove,
    run,
    validateLocal,
    exportJson,
  }
})
