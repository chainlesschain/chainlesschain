/**
 * useAutoArchive composable tests — B4-auto-archive v1.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import { useWsStore } from '../../src/stores/ws.js'
import { useAutoArchive } from '../../src/composables/useAutoArchive.js'

function setEmbedded(embedded) {
  if (typeof window === 'undefined') globalThis.window = {}
  window.__CC_CONFIG__ = { embeddedShell: !!embedded }
}

describe('useAutoArchive', () => {
  let sendRawMock

  beforeEach(() => {
    setActivePinia(createPinia())
    sendRawMock = vi.fn()
    useWsStore().sendRaw = sendRawMock
    setEmbedded(true)
  })

  describe('getConfig', () => {
    it('returns + caches config on success', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: {
          success: true,
          config: {
            enabled: true,
            intervalMs: 86400000,
            providerSpec: { kind: 'webdav', useStoredCredentials: true },
            communityIds: [],
            lastRunAt: 1700000000000,
            lastRunStatus: 'ok',
          },
        },
      })
      const { config, getConfig } = useAutoArchive()
      const r = await getConfig()
      expect(r.enabled).toBe(true)
      expect(config.value.intervalMs).toBe(86400000)
      const args = sendRawMock.mock.calls[0][0]
      expect(args.type).toBe('mtc.auto-archive.config-get')
    })

    it('captures handler error envelope', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: false, error: 'autoArchiveScheduler not initialized' },
      })
      const { getConfig, errorMessage } = useAutoArchive()
      const r = await getConfig()
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/not initialized/)
    })
  })

  describe('setConfig', () => {
    it('forwards patch + updates config on success', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: {
          success: true,
          config: {
            enabled: true,
            intervalMs: 3600000,
            providerSpec: { kind: 'webdav', useStoredCredentials: true },
            communityIds: ['c1'],
          },
        },
      })
      const { config, setConfig } = useAutoArchive()
      const patch = {
        enabled: true,
        intervalMs: 3600000,
        providerSpec: { kind: 'webdav', useStoredCredentials: true },
        communityIds: ['c1'],
      }
      const r = await setConfig(patch)
      expect(r.enabled).toBe(true)
      expect(config.value.communityIds).toEqual(['c1'])
      const args = sendRawMock.mock.calls[0][0]
      expect(args.type).toBe('mtc.auto-archive.config-set')
      expect(args.patch).toEqual(patch)
    })

    it('rejects non-object patch', async () => {
      const { setConfig, errorMessage } = useAutoArchive()
      const r = await setConfig(null)
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/patch 必须是对象/)
    })

    it('captures validation error from main', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: false, error: 'intervalMs must be ≥ 300000 ms' },
      })
      const { setConfig, errorMessage } = useAutoArchive()
      const r = await setConfig({ enabled: true, intervalMs: 10 })
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/intervalMs/)
    })
  })

  describe('runNow', () => {
    it('triggers run-now + refreshes config', async () => {
      sendRawMock
        .mockResolvedValueOnce({
          ok: true,
          result: {
            success: true,
            result: { status: 'ok', summary: { totalArchives: 2 } },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          result: { success: true, config: { lastRunStatus: 'ok' } },
        })
      const { runNow, lastRunResult } = useAutoArchive()
      const r = await runNow()
      expect(r.status).toBe('ok')
      expect(lastRunResult.value.summary.totalArchives).toBe(2)
      expect(sendRawMock.mock.calls[0][0].type).toBe('mtc.auto-archive.run-now')
      expect(sendRawMock.mock.calls[1][0].type).toBe('mtc.auto-archive.config-get')
    })

    it('captures partial / failed status', async () => {
      sendRawMock
        .mockResolvedValueOnce({
          ok: true,
          result: {
            success: true,
            result: {
              status: 'partial',
              summary: {
                perCommunity: { c1: { ok: true }, c2: { ok: false, error: 'unauth' } },
              },
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          result: { success: true, config: { lastRunStatus: 'partial' } },
        })
      const { runNow, lastRunResult } = useAutoArchive()
      const r = await runNow()
      expect(r.status).toBe('partial')
      expect(lastRunResult.value.summary.perCommunity.c2.ok).toBe(false)
    })

    it('surfaces hard error from main', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: false, error: 'autoArchiveScheduler not initialized' },
      })
      const { runNow, errorMessage } = useAutoArchive()
      const r = await runNow()
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/not initialized/)
    })
  })

  it('isEmbedded reflects shell mode', () => {
    setEmbedded(false)
    const { isEmbedded } = useAutoArchive()
    expect(isEmbedded).toBe(false)
  })
})
