import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useWsStore } from './ws.js'

function createEmptyCompression() {
  return {
    samples: 0,
    compressedSamples: 0,
    hitRate: 0,
    totalSavedTokens: 0,
    averageSavedTokens: 0,
    totalOriginalTokens: 0,
    totalCompressedTokens: 0,
    netSavingsRate: 0,
    variantDistribution: {},
    strategyDistribution: [],
    providerDistribution: [],
    modelDistribution: [],
  }
}

export const useDashboardStore = defineStore('dashboard', () => {
  const loading = ref(false)
  const compressionLoading = ref(false)
  const stats = ref({
    wsStatus: 'disconnected',
    activeLlm: null,
    activeModel: null,
    skillCount: 0,
    sessionCount: 0,
    providerCount: 0,
    appRunning: false,
    setupDone: false,
    edition: '',
    mcpCount: null,
    noteCount: null,
  })
  const statusLog = ref('')
  const compression = ref(createEmptyCompression())
  const telemetryFilters = ref({
    windowPreset: 'all',
    provider: '',
    model: '',
  })
  let unsubscribeRuntimeEvents = null

  function ensureRuntimeSubscription(ws = useWsStore()) {
    if (unsubscribeRuntimeEvents) return
    unsubscribeRuntimeEvents = ws.onRuntimeEvent((event) => {
      if (event.type === 'compression:summary') {
        applyCompressionSummary(event.payload?.summary || {})
      } else if (event.type === 'session:start') {
        stats.value.sessionCount = (stats.value.sessionCount || 0) + 1
      } else if (event.type === 'session:end') {
        stats.value.sessionCount = Math.max(0, (stats.value.sessionCount || 0) - 1)
      }
    })
  }

  function stopRuntimeSubscription() {
    if (unsubscribeRuntimeEvents) {
      unsubscribeRuntimeEvents()
      unsubscribeRuntimeEvents = null
    }
  }

  function applyCompressionSummary(summary) {
    compression.value = { ...compression.value, ...(summary || {}) }
  }

  function toWindowMs(preset) {
    if (preset === '1h') return 60 * 60 * 1000
    if (preset === '24h') return 24 * 60 * 60 * 1000
    if (preset === '7d') return 7 * 24 * 60 * 60 * 1000
    return null
  }

  function parseStatus(out) {
    stats.value.appRunning = out.includes('Desktop app running')
    stats.value.setupDone = out.includes('Setup completed')
    const edition = out.match(/Edition:\s+(\S+)/i)
    if (edition) stats.value.edition = edition[1]
    const llm = out.match(/LLM:\s+(\S+)\s+\(([^)]+)\)/i)
    if (llm) {
      stats.value.activeLlm = llm[1]
      stats.value.activeModel = llm[2]
    } else {
      const fallback = out.match(/LLM:\s+(\S+)/i)
      if (fallback) stats.value.activeLlm = fallback[1]
    }
  }

  async function refreshCompression() {
    const ws = useWsStore()
    ensureRuntimeSubscription(ws)
    compressionLoading.value = true
    const payload = {
      type: 'compression-stats',
      windowMs: toWindowMs(telemetryFilters.value.windowPreset),
    }
    if (telemetryFilters.value.provider) payload.provider = telemetryFilters.value.provider
    if (telemetryFilters.value.model) payload.model = telemetryFilters.value.model

    try {
      const result = await ws.sendRaw(payload, 10000)
      applyCompressionSummary(result.summary || {})
    } catch (_) {
      // Best-effort
    } finally {
      compressionLoading.value = false
    }
  }

  async function refresh() {
    const ws = useWsStore()
    ensureRuntimeSubscription(ws)
    loading.value = true
    stats.value.wsStatus = ws.status
    statusLog.value = ''

    try {
      const [statusResult, sessions] = await Promise.allSettled([
        ws.execute('status', 15000),
        ws.listSessions(),
      ])

      if (statusResult.status === 'fulfilled') {
        const out = statusResult.value.output
        statusLog.value = out.split('\n').slice(0, 20).join('\n')
        parseStatus(out)
      }
      if (sessions.status === 'fulfilled') {
        stats.value.sessionCount = sessions.value.length
      }

      Promise.allSettled([
        ws.execute('skill sources', 15000),
        ws.execute('llm providers', 15000),
      ]).then(([skillResult, llmResult]) => {
        if (skillResult.status === 'fulfilled') {
          const match = skillResult.value.output.match(/(\d+)\s*(?:skills|技能)/i)
          if (match) stats.value.skillCount = parseInt(match[1], 10)
        }
        if (llmResult.status === 'fulfilled') {
          const out = llmResult.value.output
          const match = out.match(/active[:\s]+(\S+)/i)
          if (match && !stats.value.activeLlm) stats.value.activeLlm = match[1]
        }
      })

      ws.execute('mcp servers', 10000)
        .then(({ output }) => {
          const count = (output.match(/^[a-z]/gm) || []).length
          stats.value.mcpCount = count
        })
        .catch(() => {
          stats.value.mcpCount = 0
        })

      await refreshCompression()
    } catch (_) {
      // Best-effort
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    compressionLoading,
    stats,
    statusLog,
    compression,
    telemetryFilters,
    ensureRuntimeSubscription,
    stopRuntimeSubscription,
    refresh,
    refreshCompression,
    applyCompressionSummary,
    toWindowMs,
  }
})

