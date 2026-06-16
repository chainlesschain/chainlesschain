/**
 * useNotificationSettings composable — unit tests.
 *
 *   - browser mode: returns DEFAULTS, update() is rejected (read-only)
 *   - embedded web-shell: get/update via notification-settings.* WS topics
 *
 * isEmbedded is captured at useNotificationSettings() call time, so each
 * test sets window.__CC_CONFIG__ before constructing the composable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw }),
}))

import { useNotificationSettings } from '../../src/composables/useNotificationSettings.js'

function embedded(on) {
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = on ? { embeddedShell: true } : {}
}

beforeEach(() => {
  sendRaw.mockReset()
  embedded(false)
})

describe('useNotificationSettings — DEFAULTS', () => {
  it('exposes the all-on defaults', () => {
    const { DEFAULTS } = useNotificationSettings()
    expect(DEFAULTS).toEqual({
      enabled: true,
      sound: true,
      badge: true,
      desktop: true,
    })
  })
})

describe('useNotificationSettings — browser mode', () => {
  it('load returns DEFAULTS without a WS call', async () => {
    const ns = useNotificationSettings()
    const s = await ns.load()
    expect(s).toEqual({ enabled: true, sound: true, badge: true, desktop: true })
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('update is rejected (desktop-only)', async () => {
    const ns = useNotificationSettings()
    await expect(ns.update({ sound: false })).rejects.toThrow(/嵌入式/)
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('isEmbedded is false', () => {
    expect(useNotificationSettings().isEmbedded).toBe(false)
  })
})

describe('useNotificationSettings — embedded mode', () => {
  beforeEach(() => embedded(true))

  it('load merges the handler settings over DEFAULTS', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { settings: { sound: false, badge: false } },
    })
    const ns = useNotificationSettings()
    const s = await ns.load()
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'notification-settings.get' },
      10000,
    )
    // overridden fields off, untouched defaults stay on
    expect(s).toEqual({
      enabled: true,
      sound: false,
      badge: false,
      desktop: true,
    })
    expect(ns.settings.value).toEqual(s)
  })

  it('load throws when the handler reports success:false', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'get-failed' },
    })
    await expect(useNotificationSettings().load()).rejects.toThrow(/get-failed/)
  })

  it('load throws on an ok:false envelope', async () => {
    sendRaw.mockResolvedValueOnce({ ok: false, error: 'ws-down' })
    await expect(useNotificationSettings().load()).rejects.toThrow(/ws-down/)
  })

  it('update requires a patch object', async () => {
    const ns = useNotificationSettings()
    await expect(ns.update(null)).rejects.toThrow(/patch is required/)
    await expect(ns.update('nope')).rejects.toThrow(/patch is required/)
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('update sends the patch and merges the result over DEFAULTS', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { settings: { desktop: false } },
    })
    const ns = useNotificationSettings()
    const s = await ns.update({ desktop: false })
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'notification-settings.update', settings: { desktop: false } },
      10000,
    )
    expect(s).toEqual({
      enabled: true,
      sound: true,
      badge: true,
      desktop: false,
    })
  })

  it('update throws on success:false', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'update-failed' },
    })
    await expect(
      useNotificationSettings().update({ sound: false }),
    ).rejects.toThrow(/update-failed/)
  })
})
