/**
 * NotificationBell component — unit tests.
 *
 * Drives the bell's own logic (the useNotifications composable is mocked):
 *   - badge reflects unreadCount
 *   - opening the drawer (bell click + the cc:open-notification-drawer event)
 *     triggers a refresh in embedded mode
 *   - the list renders notifications with relative formatTime output
 *   - clicking an unread item marks it read; a read item does not
 *   - "全部已读" calls markAllRead
 *
 * ant-design-vue components + icons are stubbed; isEmbedded is driven via
 * window.__CC_CONFIG__ (read by the real useShellMode).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const notifications = ref([])
const unreadCount = ref(0)
const refresh = vi.fn().mockResolvedValue(undefined)
const markRead = vi.fn().mockResolvedValue(undefined)
const markAllRead = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/composables/useNotifications.js', () => ({
  useNotifications: () => ({
    notifications,
    unreadCount,
    refresh,
    markRead,
    markAllRead,
  }),
}))
vi.mock('ant-design-vue', () => ({
  Empty: { PRESENTED_IMAGE_SIMPLE: 'simple' },
}))
vi.mock('@ant-design/icons-vue', () => ({
  BellOutlined: { template: '<i class="bell-icon" />' },
  ReloadOutlined: { template: '<i class="reload-icon" />' },
}))

import NotificationBell from '../../src/components/NotificationBell.vue'

const stubs = {
  'a-tooltip': { template: '<div><slot /></div>' },
  'a-badge': {
    props: ['count'],
    template: '<div class="badge" :data-count="count"><slot /></div>',
  },
  // Render slot only when open (mirrors the real drawer).
  'a-drawer': {
    props: ['open'],
    template: '<div class="drawer" v-if="open"><slot /></div>',
  },
  'a-space': { template: '<div><slot /></div>' },
  'a-radio-group': { props: ['value'], template: '<div><slot /></div>' },
  'a-radio-button': { props: ['value'], template: '<span><slot /></span>' },
  'a-button': {
    props: ['disabled', 'loading'],
    template:
      '<button class="abtn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  'a-empty': {
    props: ['description'],
    template: '<div class="empty">{{ description }}</div>',
  },
  'a-spin': { template: '<div class="spin" />' },
}

function makeWrapper() {
  return mount(NotificationBell, { global: { stubs } })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-16T12:00:00Z'))
  notifications.value = []
  unreadCount.value = 0
  refresh.mockClear()
  markRead.mockClear()
  markAllRead.mockClear()
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = { embeddedShell: true }
})
afterEach(() => {
  vi.useRealTimers()
})

describe('NotificationBell — badge', () => {
  it('shows the unread count on the badge', () => {
    unreadCount.value = 5
    const w = makeWrapper()
    expect(w.find('.badge').attributes('data-count')).toBe('5')
  })
})

describe('NotificationBell — opening', () => {
  it('clicking the bell opens the drawer and refreshes (embedded)', async () => {
    const w = makeWrapper()
    expect(w.find('.drawer').exists()).toBe(false)
    await w.find('.notif-bell-btn').trigger('click')
    await flushPromises()
    expect(w.find('.drawer').exists()).toBe(true)
    expect(refresh).toHaveBeenCalledWith({ limit: 100 })
  })

  it('does not refresh outside the embedded shell', async () => {
    globalThis.window.__CC_CONFIG__ = {}
    const w = makeWrapper()
    await w.find('.notif-bell-btn').trigger('click')
    await flushPromises()
    expect(w.find('.drawer').exists()).toBe(true)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('the cc:open-notification-drawer event opens the drawer', async () => {
    const w = makeWrapper()
    window.dispatchEvent(new Event('cc:open-notification-drawer'))
    await flushPromises()
    expect(w.find('.drawer').exists()).toBe(true)
  })
})

describe('NotificationBell — list + formatTime', () => {
  it('renders notifications with relative time', async () => {
    const now = Date.now()
    notifications.value = [
      { id: 1, title: 'Just now', created_at: now - 10_000, is_read: 0 },
      { id: 2, title: 'Minutes', created_at: now - 5 * 60_000, is_read: 1 },
      { id: 3, title: 'Hours', created_at: now - 3 * 3_600_000, is_read: 1 },
    ]
    const w = makeWrapper()
    await w.find('.notif-bell-btn').trigger('click')
    await flushPromises()
    const items = w.findAll('.notif-item')
    expect(items).toHaveLength(3)
    const times = w.findAll('.notif-time').map((t) => t.text())
    expect(times[0]).toBe('刚刚')
    expect(times[1]).toBe('5 分钟前')
    expect(times[2]).toBe('3 小时前')
  })

  it('shows the empty state when there are no notifications', async () => {
    notifications.value = []
    const w = makeWrapper()
    await w.find('.notif-bell-btn').trigger('click')
    await flushPromises()
    expect(w.find('.empty').exists()).toBe(true)
  })
})

describe('NotificationBell — interactions', () => {
  it('clicking an unread item marks it read; a read item does not', async () => {
    notifications.value = [
      { id: 7, title: 'unread', created_at: Date.now(), is_read: 0 },
      { id: 8, title: 'read', created_at: Date.now(), is_read: 1 },
    ]
    const w = makeWrapper()
    await w.find('.notif-bell-btn').trigger('click')
    await flushPromises()
    const items = w.findAll('.notif-item')
    await items[0].trigger('click')
    expect(markRead).toHaveBeenCalledWith(7)
    markRead.mockClear()
    await items[1].trigger('click')
    expect(markRead).not.toHaveBeenCalled()
  })

  it('"全部已读" calls markAllRead', async () => {
    unreadCount.value = 2
    notifications.value = [
      { id: 1, title: 'a', created_at: Date.now(), is_read: 0 },
    ]
    const w = makeWrapper()
    await w.find('.notif-bell-btn').trigger('click')
    await flushPromises()
    const markAllBtn = w
      .findAll('.abtn')
      .find((b) => b.text().includes('全部已读'))
    expect(markAllBtn).toBeTruthy()
    await markAllBtn.trigger('click')
    expect(markAllRead).toHaveBeenCalled()
  })
})
