/**
 * useNotifications composable — unit tests.
 *
 * Two modes (mirrors useFs):
 *   - browser (no embeddedShell): empty / no-op shapes, no WS calls
 *   - embedded web-shell: notification.* WS topics via ws.sendRaw
 *
 * isEmbedded is read per-call from window.__CC_CONFIG__.embeddedShell, so
 * each test sets the flag before invoking a method.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw }),
}))

import { useNotifications } from '../../src/composables/useNotifications.js'

function embedded(on) {
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = on ? { embeddedShell: true } : {}
}

beforeEach(() => {
  sendRaw.mockReset()
  embedded(false)
})

describe('useNotifications — browser mode (no WS backing)', () => {
  it('refresh yields an empty list + zero count without any WS call', async () => {
    const n = useNotifications()
    expect(await n.refresh()).toEqual([])
    expect(n.notifications.value).toEqual([])
    expect(n.unreadCount.value).toBe(0)
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('refreshUnreadCount returns 0 without a WS call', async () => {
    const n = useNotifications()
    expect(await n.refreshUnreadCount()).toBe(0)
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('markRead / markAllRead are no-ops', async () => {
    const n = useNotifications()
    await n.markRead(5)
    await n.markAllRead()
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('sendDesktop throws (desktop-only)', async () => {
    const n = useNotifications()
    await expect(n.sendDesktop('t')).rejects.toThrow(/嵌入式/)
  })
})

describe('useNotifications — embedded mode', () => {
  beforeEach(() => embedded(true))

  it('refresh lists notifications and refreshes the unread count', async () => {
    sendRaw.mockImplementation(async (msg) => {
      if (msg.type === 'notification.list') {
        return {
          ok: true,
          result: {
            notifications: [
              { id: 1, is_read: 0 },
              { id: 2, is_read: 1 },
            ],
          },
        }
      }
      if (msg.type === 'notification.unread-count') {
        return { ok: true, result: { count: 1 } }
      }
      throw new Error(`unexpected ${msg.type}`)
    })
    const n = useNotifications()
    const list = await n.refresh({ limit: 10, offset: 0, isRead: false })
    expect(list).toHaveLength(2)
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'notification.list', limit: 10, offset: 0, isRead: false },
      15000,
    )
    expect(n.unreadCount.value).toBe(1)
  })

  it('refresh coerces a non-array payload to []', async () => {
    sendRaw.mockImplementation(async (msg) =>
      msg.type === 'notification.list'
        ? { ok: true, result: { notifications: null } }
        : { ok: true, result: { count: 0 } },
    )
    const n = useNotifications()
    expect(await n.refresh()).toEqual([])
  })

  it('refresh throws when the handler reports success:false', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'boom' },
    })
    await expect(useNotifications().refresh()).rejects.toThrow(/boom/)
  })

  it('refreshUnreadCount coerces the count and defaults to 0', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { count: '7' } })
    expect(await useNotifications().refreshUnreadCount()).toBe(7)
    sendRaw.mockResolvedValueOnce({ ok: true, result: {} })
    expect(await useNotifications().refreshUnreadCount()).toBe(0)
  })

  it('markRead requires an id', async () => {
    const n = useNotifications()
    await expect(n.markRead(undefined)).rejects.toThrow(/id is required/)
    await expect(n.markRead('')).rejects.toThrow(/id is required/)
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('markRead optimistically flips is_read and refreshes the count', async () => {
    let count = 2
    sendRaw.mockImplementation(async (msg) => {
      if (msg.type === 'notification.list') {
        return {
          ok: true,
          result: { notifications: [{ id: 1, is_read: 0 }, { id: 2, is_read: 0 }] },
        }
      }
      if (msg.type === 'notification.mark-read') {
        count = 1
        return { ok: true, result: { success: true } }
      }
      if (msg.type === 'notification.unread-count') {
        return { ok: true, result: { count } }
      }
      throw new Error(`unexpected ${msg.type}`)
    })
    const n = useNotifications()
    await n.refresh()
    await n.markRead(1)
    expect(n.notifications.value.find((x) => x.id === 1).is_read).toBe(1)
    expect(n.unreadCount.value).toBe(1)
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'notification.mark-read', id: 1 },
      10000,
    )
  })

  it('markRead throws on success:false', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'nope' },
    })
    await expect(useNotifications().markRead(9)).rejects.toThrow(/nope/)
  })

  it('markAllRead flips every entry and zeroes the count', async () => {
    sendRaw.mockImplementation(async (msg) => {
      if (msg.type === 'notification.list') {
        return {
          ok: true,
          result: { notifications: [{ id: 1, is_read: 0 }, { id: 2, is_read: 0 }] },
        }
      }
      if (msg.type === 'notification.unread-count') {
        return { ok: true, result: { count: 2 } }
      }
      if (msg.type === 'notification.mark-all-read') {
        return { ok: true, result: { success: true } }
      }
      throw new Error(`unexpected ${msg.type}`)
    })
    const n = useNotifications()
    await n.refresh()
    await n.markAllRead()
    expect(n.notifications.value.every((x) => x.is_read === 1)).toBe(true)
    expect(n.unreadCount.value).toBe(0)
  })

  it('sendDesktop posts title + body', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: { success: true } })
    await useNotifications().sendDesktop('Title', 'Body')
    expect(sendRaw).toHaveBeenCalledWith(
      { type: 'notification.send-desktop', title: 'Title', body: 'Body' },
      10000,
    )
  })

  it('sendDesktop throws on success:false', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'denied' },
    })
    await expect(useNotifications().sendDesktop('t')).rejects.toThrow(/denied/)
  })
})
