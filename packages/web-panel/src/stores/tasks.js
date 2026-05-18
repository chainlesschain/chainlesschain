import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWsStore } from './ws'

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([])
  const loading = ref(false)
  let pollTimer = null
  let unsubscribeNotifications = null

  const running = computed(() => tasks.value.filter(t => t.status === 'running'))
  const pending = computed(() => tasks.value.filter(t => t.status === 'pending'))
  const completed = computed(() =>
    tasks.value.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'timeout')
  )

  async function fetchTasks() {
    const ws = useWsStore()
    loading.value = true
    try {
      const result = await ws.sendRaw({ type: 'tasks-list' })
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
    } catch {
      // Non-critical
    } finally {
      await fetchTasks()
    }
  }

  /** Latest notification from server (cleared after display) */
  const lastNotification = ref(null)

  function startPolling(intervalMs = 5000) {
    stopPolling()
    fetchTasks()
    pollTimer = setInterval(fetchTasks, intervalMs)
    // Subscribe to real-time task notifications
    _subscribeNotifications()
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (unsubscribeNotifications) {
      unsubscribeNotifications()
      unsubscribeNotifications = null
    }
  }

  function _subscribeNotifications() {
    const ws = useWsStore()
    if (unsubscribeNotifications) return
    const handler = (event) => {
      if (event.type === 'task:notification' && event.payload?.task) {
        lastNotification.value = event.payload.task
        // Refresh task list immediately
        fetchTasks()
        // Auto-clear notification after 8 seconds
        setTimeout(() => { lastNotification.value = null }, 8000)
      }
    }
    unsubscribeNotifications = ws.onRuntimeEvent(handler)
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
    lastNotification,
    fetchTasks,
    stopTask,
    startPolling,
    stopPolling,
    formatDuration,
    getStatusColor,
  }
})
