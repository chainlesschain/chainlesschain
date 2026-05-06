/**
 * useNotifications — web-panel composable for the desktop `notifications`
 * SQLite table, surfaced via the embedded web-shell's `notification.*` WS
 * topics (Phase 3c.6, 2026-05-06). Mirrors the V5/V6 ipcRenderer.invoke
 * surface (`notification:*`) so Phase 1.6 default-shell users get parity.
 *
 * Pattern mirrors useFs.js: branch on useShellMode().isEmbedded — outside
 * the embedded shell (pure browser, no WS topic backing) the composable
 * returns empty / no-op shapes so the bell badge doesn't error.
 *
 * Usage:
 *   const { notifications, unreadCount, refresh, markRead, markAllRead,
 *           sendDesktop } = useNotifications()
 *   await refresh()                      // populates notifications + count
 *   await markRead(123)
 *   await markAllRead()
 *   await sendDesktop('标题', '正文')    // toast via Electron Notification
 */

import { ref, computed } from 'vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

const _state = {
  notifications: ref([]),
  unreadCount: ref(0),
}

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'notification handler failed')
  }
  return reply?.result ?? reply
}

export function useNotifications() {
  const ws = useWsStore()

  async function refresh({ limit = 50, offset = 0, isRead } = {}) {
    if (!useShellMode().isEmbedded) {
      _state.notifications.value = []
      _state.unreadCount.value = 0
      return _state.notifications.value
    }
    const reply = await ws.sendRaw(
      { type: 'notification.list', limit, offset, isRead },
      15000,
    )
    const r = _unwrap(reply)
    if (r?.success === false) {
      throw new Error(r.error || 'notification.list failed')
    }
    _state.notifications.value = Array.isArray(r?.notifications)
      ? r.notifications
      : []
    await refreshUnreadCount()
    return _state.notifications.value
  }

  async function refreshUnreadCount() {
    if (!useShellMode().isEmbedded) {
      _state.unreadCount.value = 0
      return 0
    }
    const reply = await ws.sendRaw(
      { type: 'notification.unread-count' },
      10000,
    )
    const r = _unwrap(reply)
    _state.unreadCount.value = Number(r?.count) || 0
    return _state.unreadCount.value
  }

  async function markRead(id) {
    if (id === undefined || id === null || id === '') {
      throw new Error('id is required')
    }
    if (!useShellMode().isEmbedded) return
    const reply = await ws.sendRaw(
      { type: 'notification.mark-read', id },
      10000,
    )
    const r = _unwrap(reply)
    if (r?.success === false) {
      throw new Error(r.error || 'notification.mark-read failed')
    }
    // Local optimistic update so the UI flips without a full refetch.
    const target = _state.notifications.value.find((n) => n.id === id)
    if (target) target.is_read = 1
    await refreshUnreadCount()
  }

  async function markAllRead() {
    if (!useShellMode().isEmbedded) return
    const reply = await ws.sendRaw(
      { type: 'notification.mark-all-read' },
      10000,
    )
    const r = _unwrap(reply)
    if (r?.success === false) {
      throw new Error(r.error || 'notification.mark-all-read failed')
    }
    for (const n of _state.notifications.value) n.is_read = 1
    _state.unreadCount.value = 0
  }

  async function sendDesktop(title, body = '') {
    if (!useShellMode().isEmbedded) {
      throw new Error('桌面通知仅在嵌入式 web-shell 中可用')
    }
    const reply = await ws.sendRaw(
      { type: 'notification.send-desktop', title, body },
      10000,
    )
    const r = _unwrap(reply)
    if (r?.success === false) {
      throw new Error(r.error || 'notification.send-desktop failed')
    }
  }

  return {
    notifications: computed(() => _state.notifications.value),
    unreadCount: computed(() => _state.unreadCount.value),
    refresh,
    refreshUnreadCount,
    markRead,
    markAllRead,
    sendDesktop,
  }
}
