import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const runtimeHandlers = new Set()
const execute = vi.fn()
const listSessions = vi.fn()
const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({
    status: 'connected',
    onRuntimeEvent: (handler) => {
      runtimeHandlers.add(handler)
      return () => runtimeHandlers.delete(handler)
    },
    execute,
    listSessions,
    sendRaw,
  }),
}))

import { useDashboardStore } from '../../src/stores/dashboard.js'

describe('dashboard store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runtimeHandlers.clear()
    execute.mockReset()
    listSessions.mockReset()
    sendRaw.mockReset()
  })

  it('subscribes to runtime events and updates compression/session stats', () => {
    const store = useDashboardStore()
    store.ensureRuntimeSubscription()

    expect(runtimeHandlers.size).toBe(1)

    const [handler] = [...runtimeHandlers]
    handler({
      type: 'compression:summary',
      payload: {
        summary: {
          samples: 5,
          totalSavedTokens: 128,
        },
      },
    })
    handler({
      type: 'session:start',
      payload: { sessionId: 'sess-1' },
    })
    handler({
      type: 'session:end',
      payload: { sessionId: 'sess-1' },
    })

    expect(store.compression.samples).toBe(5)
    expect(store.compression.totalSavedTokens).toBe(128)
    expect(store.stats.sessionCount).toBe(0)

    store.stopRuntimeSubscription()
    expect(runtimeHandlers.size).toBe(0)
  })

  it('refreshCompression sends current telemetry filters and applies summary', async () => {
    sendRaw.mockResolvedValueOnce({
      type: 'compression-stats',
      summary: {
        samples: 7,
        providerDistribution: [{ key: 'openai', samples: 7, hitRate: 0.5 }],
      },
    })

    const store = useDashboardStore()
    store.telemetryFilters.windowPreset = '24h'
    store.telemetryFilters.provider = 'openai'
    store.telemetryFilters.model = 'gpt-4o'

    await store.refreshCompression()

    expect(sendRaw).toHaveBeenCalledWith({
      type: 'compression-stats',
      windowMs: 24 * 60 * 60 * 1000,
      provider: 'openai',
      model: 'gpt-4o',
    }, 10000)
    expect(store.compression.samples).toBe(7)
    expect(store.compression.providerDistribution).toEqual([
      { key: 'openai', samples: 7, hitRate: 0.5 },
    ])
  })

  it('refresh loads status, sessions and secondary stats', async () => {
    execute
      .mockResolvedValueOnce({
        output: [
          'Desktop app running',
          'Setup completed',
          'Edition: Enterprise',
          'LLM: openai (gpt-4o)',
        ].join('\n'),
      })
      .mockResolvedValueOnce({
        output: '12 skills available',
      })
      .mockResolvedValueOnce({
        output: 'active: openai',
      })
      .mockResolvedValueOnce({
        output: 'alpha\nbeta\n',
      })
    listSessions.mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
    sendRaw.mockResolvedValueOnce({
      type: 'compression-stats',
      summary: { samples: 3 },
    })

    const store = useDashboardStore()
    await store.refresh()
    await Promise.resolve()

    expect(store.statusLog).toContain('Desktop app running')
    expect(store.stats.appRunning).toBe(true)
    expect(store.stats.setupDone).toBe(true)
    expect(store.stats.edition).toBe('Enterprise')
    expect(store.stats.activeLlm).toBe('openai')
    expect(store.stats.activeModel).toBe('gpt-4o')
    expect(store.stats.sessionCount).toBe(2)
    expect(store.stats.skillCount).toBe(12)
    expect(store.stats.mcpCount).toBe(2)
    expect(store.compression.samples).toBe(3)
  })
})
