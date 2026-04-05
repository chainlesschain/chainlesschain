import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWsStore } from './ws'

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([])
  const loading = ref(false)
  let pollTimer = null

  const running = computed(() => tasks.value.filter(t => t.status === 'running'))
  const pending = computed(() => tasks.value.filter(t => t.status === 'pending'))
  const completed = computed(() =>
    tasks.value.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'timeout')
  )

  async function fetchTasks() {
    const ws = useWsStore()
    loading.value = true
    try {
      const result = await ws.execute('tasks-list')
      if (result && Array.isArray(result.tasks)) {
        tasks.value = result.tasks
      }
    } catch {
      // Non-critical
    } finally {
      loading.value = false
    }
  }

  async function stopTask(taskId) {
    const ws = useWsStore()
    try {
      await ws.sendRaw({ type: 'tasks-stop', taskId })
      // Refresh after stop
      await fetchTasks()
    } catch {
      // Non-critical
    }
  }

  function startPolling(intervalMs = 5000) {
    stopPolling()
    fetchTasks()
    pollTimer = setInterval(fetchTasks, intervalMs)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  function getStatusColor(status) {
    switch (status) {
      case 'running': return 'processing'
      case 'pending': return 'default'
      case 'completed': return 'success'
      case 'failed': return 'error'
      case 'timeout': return 'warning'
      default: return 'default'
    }
  }

  return {
    tasks,
    loading,
    running,
    pending,
    completed,
    fetchTasks,
    stopTask,
    startPolling,
    stopPolling,
    formatDuration,
    getStatusColor,
  }
})
