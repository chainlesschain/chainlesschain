import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useWsStore } from './ws.js'

export const useDashboardStore = defineStore('dashboard', () => {
  const loading = ref(false)
  const stats = ref({
    wsStatus: 'disconnected',
    activeLlm: null,
    activeModel: null,
    skillCount: 0,
    sessionCount: 0,
    providerCount: 0,
  })

  async function refresh() {
    const ws = useWsStore()
    loading.value = true
    stats.value.wsStatus = ws.status

    try {
      // Get LLM providers
      const { output: providersOut } = await ws.execute('llm providers')
      const activeMatch = providersOut.match(/active[:\s]+(\S+)/i)
      if (activeMatch) stats.value.activeLlm = activeMatch[1]

      // Count skills
      const { output: skillOut } = await ws.execute('skill sources')
      const countMatch = skillOut.match(/(\d+)\s*(?:skills|技能)/i)
      if (countMatch) stats.value.skillCount = parseInt(countMatch[1])
      else {
        // Fallback: count lines with skill entries
        const lines = skillOut.split('\n').filter(l => l.trim() && !l.startsWith('─'))
        stats.value.skillCount = Math.max(lines.length - 3, 0) * 10
      }

      // Session list
      const sessions = await ws.listSessions()
      stats.value.sessionCount = sessions.length

    } catch (_) {
      // Best-effort refresh
    } finally {
      loading.value = false
    }
  }

  return { loading, stats, refresh }
})
