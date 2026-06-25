/**
 * useNotifications composable — unit tests.
 *
 * Mirrors the useFs test harness: mock ws.sendRaw and drive
 * useShellMode().isEmbedded via window.__CC_CONFIG__.embeddedShell.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw }),
}))

import { useNotifications } from '../../src/composables/useNotifications.js'

beforeEach(() => {
  sendRaw.mockReset()
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = { embeddedShell: true }
})

describe('useNotifications — embedded shell mode', () => {
  it('refresh populates notifications and the unread count', async () => {
    sendRaw
      .mockResolvedValueOnce({
        ok: true,
        result: {
          success: true,
          notifications: [
            { id: 1, is_read: 0 },
            { id: 2, is_read: 1 },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, result: { count: 3 } })
    const n = useNotifications()
    const list = await n.refresh({ limit: 10 })
    expect(sendRaw).toHaveBeenNthCalledWith(
      1,
      { type: 'notification.list', limit: 10, offset: 0, isRead: undefined },
      15000,
    )
    expect(list).toHaveLength(2)
    expect(n.notifications.value).toHaveLength(2)
    expect(n.unreadCount.value).toBe(3)
  })

  it('refresh falls back to an empty array when the result has no notifications', async () => {
    sendRaw
      .mockResolvedValueOnce({ ok: true, result: { success: true } })
      .mockResolvedValueOnce({ ok: true, result: { count: 0 } })
    const n = useNotifications()
    expect(await n.refresh()).toEqual([])
  })

  it('refresh throws when the handler reports failure', async () => {
    sendRaw.mockResolvedValueOnce({ ok: false, error: 'boom' })
    await expect(useNotifications().refresh()).rejects.toThrow('boom')
  })

  it('refreshUnreadCount coerces a non-numeric count to 0', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { count: 'x' } })
    expect(await useNotifications().refreshUnreadCount()).toBe(0)
  })

  it('markRead requires an id and never hits the WS topic without one', async () => {
    const n = useNotifications()
    await expect(n.markRead(undefined)).rejects.toThrow('id is required')
    await expect(n.markRead(null)).rejects.toThrow('id is required')
    await expect(n.markRead('')).rejects.toThrow('id is required')
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('markRead optimistically flips is_read and refreshes the count', async () => {
    sendRaw
      .mockResolvedValueOnce({
        ok: true,
        result: { success: true, notifications: [{ id: 7, is_read: 0 }] },
      })
      .mockResolvedValueOnce({ ok: true, result: { count: 1 } })
    const n = useNotifications()
    await n.refresh()

    sendRaw
      .mockResolvedValueOnce({ ok: true, result: { success: true } })
      .mockResolvedValueOnce({ ok: true, result: { count: 0 } })
    await n.markRead(7)
    expect(n.notifications.value[0].is_read).toBe(1)
    expect(n.unreadCount.value).toBe(0)
  })

  it('markAllRead flips all rows and zeroes the count without a refetch', async () => {
    sendRaw
      .mockResolvedValueOnce({
        ok: true,
        result: {
          success: true,
          notifications: [
            { id: 1, is_read: 0 },
            { id: 2, is_read: 0 },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, result: { count: 2 } })
    const n = useNotifications()
    await n.refresh()

    sendRaw.mockResolvedValueOnce({ ok: true, result: { success: true } })
    await n.markAllRead()
    expect(n.notifications.value.every((x) => x.is_read === 1)).toBe(true)
    expect(n.unreadCount.value).toBe(0)
    // exactly one extra WS call (mark-all-read), no unread-count refetch
    expect(sendRaw).toHaveBeenLastCalledWith(
      { type: 'notification.mark-all-read' },
      10000,
    )
  })
})

describe('useNotifications — non-embedded (pure browser)', () => {
  beforeEach(() => {
    globalThis.window.__CC_CONFIG__ = {} // not embedded
  })

  it('refresh returns empty no-op shapes and never calls the WS topic', async () => {
    const n = useNotifications()
    expect(await n.refresh()).toEqual([])
    expect(n.unreadCount.value).toBe(0)
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('markRead / markAllRead are no-ops; sendDesktop throws', async () => {
    const n = useNotifications()
    await n.markRead(1) // id provided → passes validation, then no-ops
    await n.markAllRead()
    expect(sendRaw).not.toHaveBeenCalled()
    await expect(n.sendDesktop('标题')).rejects.toThrow(/嵌入式/)
  })
})
