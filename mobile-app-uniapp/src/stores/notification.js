import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import NotificationService from '../services/notification'

export const useNotificationStore = defineStore('notification', () => {
  // State
  const notifications = ref([])
  const unreadCount = ref(0)
  const filter = ref('all') // all, message, trade, social, system
  const sortBy = ref('time') // time, priority, type
  const loading = ref(false)

  // Computed
  const filteredNotifications = computed(() => {
    let filtered = notifications.value

    // Apply filter
    if (filter.value !== 'all') {
      filtered = filtered.filter(n => n.type === filter.value)
    }

    // Apply sort
    if (sortBy.value === 'time') {
      filtered = filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    } else if (sortBy.value === 'priority') {
      const priorityOrder = { high: 3, medium: 2, low: 1 }
      filtered = filtered.sort((a, b) => {
        const priorityDiff = (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0)
        if (priorityDiff !== 0) return priorityDiff
        return new Date(b.timestamp) - new Date(a.timestamp)
      })
    } else if (sortBy.value === 'type') {
      filtered = filtered.sort((a, b) => {
        const typeDiff = a.type.localeCompare(b.type)
        if (typeDiff !== 0) return typeDiff
        return new Date(b.timestamp) - new Date(a.timestamp)
      })
    }

    return filtered
  })

  const unreadNotifications = computed(() => {
    return notifications.value.filter(n => !n.read)
  })

  const notificationsByType = computed(() => {
    return {
      message: notifications.value.filter(n => n.type === 'message'),
      trade: notifications.value.filter(n => n.type === 'trade'),
      social: notifications.value.filter(n => n.type === 'social'),
      system: notifications.value.filter(n => n.type === 'system')
    }
  })

  const unreadCountByType = computed(() => {
    return {
      message: notifications.value.filter(n => n.type === 'message' && !n.read).length,
      trade: notifications.value.filter(n => n.type === 'trade' && !n.read).length,
      social: notifications.value.filter(n => n.type === 'social' && !n.read).length,
      system: notifications.value.filter(n => n.type === 'system' && !n.read).length
    }
  })

  // Actions
  async function loadNotifications() {
    loading.value = true
    try {
      const history = await NotificationService.getNotificationHistory()
      notifications.value = history
      updateUnreadCount()
    } catch (error) {
      console.error('Failed to load notifications:', error)
    } finally {
      loading.value = false
    }
  }

  async function addNotification(notification) {
    // Add to local state
    notifications.value.unshift({
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      read: false,
      ...notification
    })

    // Save to service
    await NotificationService.addNotification(notification)

    updateUnreadCount()

    // Show system notification if enabled
    const settings = uni.getStorageSync('app_settings')
    if (settings?.notificationEnabled) {
      await NotificationService.showNotification(notification)
    }
  }

  async function markAsRead(notificationId) {
    const notification = notifications.value.find(n => n.id === notificationId)
    if (notification) {
      notification.read = true
      await NotificationService.markAsRead(notificationId)
      updateUnreadCount()
    }
  }

  async function markAllAsRead() {
    notifications.value.forEach(n => {
      n.read = true
    })
    await NotificationService.markAllAsRead()
    updateUnreadCount()
  }

  async function deleteNotification(notificationId) {
    const index = notifications.value.findIndex(n => n.id === notificationId)
    if (index !== -1) {
      notifications.value.splice(index, 1)
      await NotificationService.deleteNotification(notificationId)
      updateUnreadCount()
    }
  }

  async function clearAll() {
    notifications.value = []
    await NotificationService.clearAll()
    updateUnreadCount()
  }

  async function clearByType(type) {
    notifications.value = notifications.value.filter(n => n.type !== type)
    updateUnreadCount()
  }

  function updateUnreadCount() {
    unreadCount.value = notifications.value.filter(n => !n.read).length

    // Update tab bar badge
    if (unreadCount.value > 0) {
      uni.setTabBarBadge({
        index: 2, // Messages tab index
        text: unreadCount.value > 99 ? '99+' : unreadCount.value.toString()
      })
    } else {
      uni.removeTabBarBadge({
        index: 2
      })
    }
  }

  function setFilter(newFilter) {
    filter.value = newFilter
  }

  function setSortBy(newSortBy) {
    sortBy.value = newSortBy
  }

  async function requestPermission() {
    return await NotificationService.requestPermission()
  }

  async function scheduleNotification(notification, delay) {
    // Schedule notification for later
    const scheduledTime = Date.now() + delay
    const scheduledNotification = {
      ...notification,
      scheduledTime,
      scheduled: true
    }

    notifications.value.push(scheduledNotification)

    // Set timeout to show notification
    setTimeout(async () => {
      await addNotification(notification)
      // Remove scheduled notification
      const index = notifications.value.findIndex(n => n.scheduledTime === scheduledTime)
      if (index !== -1) {
        notifications.value.splice(index, 1)
      }
    }, delay)
  }

  function getNotificationStats() {
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000

    return {
      total: notifications.value.length,
      unread: unreadCount.value,
      today: notifications.value.filter(n => new Date(n.timestamp).getTime() > oneDayAgo).length,
      thisWeek: notifications.value.filter(n => new Date(n.timestamp).getTime() > oneWeekAgo).length,
      byType: {
        message: notificationsByType.value.message.length,
        trade: notificationsByType.value.trade.length,
        social: notificationsByType.value.social.length,
        system: notificationsByType.value.system.length
      }
    }
  }

  // Initialize
  function init() {
    loadNotifications()

    // Listen for notification events
    uni.$on('notificationReceived', (notification) => {
      addNotification(notification)
    })

    // Listen for settings changes
    uni.$on('settingsChanged', (settings) => {
      // Update notification behavior based on settings
      if (!settings.notificationEnabled) {
        // Disable notifications
        NotificationService.disableNotifications()
      }
    })
  }

  return {
    // State
    notifications,
    unreadCount,
    filter,
    sortBy,
    loading,

    // Computed
    filteredNotifications,
    unreadNotifications,
    notificationsByType,
    unreadCountByType,

    // Actions
    loadNotifications,
    addNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    clearByType,
    updateUnreadCount,
    setFilter,
    setSortBy,
    requestPermission,
    scheduleNotification,
    getNotificationStats,
    init
  }
})
