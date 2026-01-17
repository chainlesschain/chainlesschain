<template>
  <view class="notification-center">
    <!-- Header -->
    <view class="header">
      <view class="header-title">
        <text class="title-text">通知中心</text>
        <view v-if="unreadCount > 0" class="header-badge">
          <text>{{ unreadCount > 99 ? '99+' : unreadCount }}</text>
        </view>
      </view>
      <view class="header-actions">
        <view class="action-icon" @click="showFilterSheet">
          <text>🔽</text>
        </view>
        <view class="action-icon" @click="showMoreActions">
          <text>⋮</text>
        </view>
      </view>
    </view>

    <!-- Filter Chips -->
    <scroll-view class="filter-chips" scroll-x>
      <view
        v-for="(filterItem, index) in filters"
        :key="index"
        class="chip"
        :class="{ active: currentFilter === filterItem.value }"
        @click="setFilter(filterItem.value)"
      >
        <text class="chip-icon">{{ filterItem.icon }}</text>
        <text class="chip-text">{{ filterItem.label }}</text>
        <view v-if="filterItem.count > 0" class="chip-badge">
          <text>{{ filterItem.count }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- Sort Options -->
    <view class="sort-bar">
      <view class="sort-options">
        <view
          v-for="(sortItem, index) in sortOptions"
          :key="index"
          class="sort-item"
          :class="{ active: currentSort === sortItem.value }"
          @click="setSort(sortItem.value)"
        >
          <text class="sort-text">{{ sortItem.label }}</text>
        </view>
      </view>
      <view class="notification-stats">
        <text class="stats-text">共 {{ filteredNotifications.length }} 条</text>
      </view>
    </view>

    <!-- Notifications List -->
    <scroll-view
      class="notifications-scroll"
      scroll-y
      @scrolltolower="loadMore"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view
        v-for="notification in filteredNotifications"
        :key="notification.id"
        class="notification-item"
        :class="{ unread: !notification.read, expanded: expandedId === notification.id }"
        @click="toggleExpand(notification)"
      >
        <!-- Notification Header -->
        <view class="notification-header">
          <view class="notification-icon" :class="`type-${notification.type}`">
            <text>{{ getTypeIcon(notification.type) }}</text>
          </view>
          <view class="notification-content">
            <view class="content-top">
              <text class="notification-title">{{ notification.title }}</text>
              <view v-if="notification.priority === 'high'" class="priority-badge">
                <text>重要</text>
              </view>
            </view>
            <text class="notification-time">{{ formatTime(notification.timestamp) }}</text>
          </view>
          <view class="notification-actions">
            <view v-if="!notification.read" class="unread-dot"></view>
            <view class="action-more" @click.stop="showNotificationActions(notification)">
              <text>⋮</text>
            </view>
          </view>
        </view>

        <!-- Notification Body -->
        <view class="notification-body">
          <text class="body-text" :class="{ expanded: expandedId === notification.id }">
            {{ notification.content }}
          </text>

          <!-- Rich Content -->
          <view v-if="notification.image" class="notification-image">
            <image :src="notification.image" mode="aspectFill" @click.stop="previewImage(notification.image)" />
          </view>

          <!-- Action Buttons -->
          <view v-if="notification.actions && notification.actions.length > 0" class="notification-action-buttons">
            <view
              v-for="(action, index) in notification.actions"
              :key="index"
              class="action-button"
              :class="action.type"
              @click.stop="handleAction(notification, action)"
            >
              <text>{{ action.label }}</text>
            </view>
          </view>

          <!-- Metadata -->
          <view v-if="expandedId === notification.id && notification.metadata" class="notification-metadata">
            <view v-for="(value, key) in notification.metadata" :key="key" class="metadata-item">
              <text class="metadata-key">{{ key }}:</text>
              <text class="metadata-value">{{ value }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- Loading Skeleton -->
      <Skeleton v-if="loading" type="list" :rows="5" :avatar="true" :animate="true" />

      <!-- Empty State -->
      <EmptyState
        v-else-if="filteredNotifications.length === 0"
        icon="🔔"
        title="暂无通知"
        :description="getEmptyHint()"
        icon-style="default"
      />
    </scroll-view>

    <!-- Do Not Disturb Banner -->
    <view v-if="isDoNotDisturbActive" class="dnd-banner">
      <text class="dnd-icon">🌙</text>
      <text class="dnd-text">勿扰模式已开启</text>
      <view class="dnd-action" @click="goToSettings">
        <text>设置</text>
      </view>
    </view>
  </view>
</template>

<script>
import { useNotificationStore } from '@/stores/notification'
import { useSettingsStore } from '@/stores/settings'
import { storeToRefs } from 'pinia'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'

export default {
  components: {
    EmptyState,
    Skeleton
  },
  data() {
    return {
      expandedId: null,
      refreshing: false,
      loading: false,
      filters: [
        { label: '全部', value: 'all', icon: '📋', count: 0 },
        { label: '消息', value: 'message', icon: '💬', count: 0 },
        { label: '交易', value: 'trade', icon: '💰', count: 0 },
        { label: '社交', value: 'social', icon: '👥', count: 0 },
        { label: '系统', value: 'system', icon: '⚙️', count: 0 }
      ],
      sortOptions: [
        { label: '时间', value: 'time' },
        { label: '优先级', value: 'priority' },
        { label: '类型', value: 'type' }
      ]
    }
  },

  setup() {
    const notificationStore = useNotificationStore()
    const settingsStore = useSettingsStore()

    const {
      filteredNotifications,
      unreadCount,
      filter: currentFilter,
      sortBy: currentSort,
      unreadCountByType
    } = storeToRefs(notificationStore)

    const { isDoNotDisturbActive } = storeToRefs(settingsStore)

    return {
      notificationStore,
      settingsStore,
      filteredNotifications,
      unreadCount,
      currentFilter,
      currentSort,
      unreadCountByType,
      isDoNotDisturbActive
    }
  },

  onLoad() {
    this.notificationStore.init()
    this.loadNotifications()
  },

  onShow() {
    this.updateFilterCounts()
  },

  methods: {
    async loadNotifications() {
      this.loading = true
      try {
        await this.notificationStore.loadNotifications()
        this.updateFilterCounts()
      } catch (error) {
        console.error('Failed to load notifications:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'error'
        })
      } finally {
        this.loading = false
      }
    },

    async onRefresh() {
      this.refreshing = true
      await this.loadNotifications()
      this.refreshing = false
    },

    updateFilterCounts() {
      this.filters[0].count = this.unreadCount
      this.filters[1].count = this.unreadCountByType.message
      this.filters[2].count = this.unreadCountByType.trade
      this.filters[3].count = this.unreadCountByType.social
      this.filters[4].count = this.unreadCountByType.system
    },

    setFilter(filter) {
      this.notificationStore.setFilter(filter)
      this.expandedId = null
    },

    setSort(sort) {
      this.notificationStore.setSortBy(sort)
    },

    toggleExpand(notification) {
      if (this.expandedId === notification.id) {
        this.expandedId = null
      } else {
        this.expandedId = notification.id
        if (!notification.read) {
          this.notificationStore.markAsRead(notification.id)
          this.updateFilterCounts()
        }
      }
    },

    showFilterSheet() {
      uni.showActionSheet({
        itemList: ['全部通知', '仅未读', '仅已读'],
        success: (res) => {
          if (res.tapIndex === 1) {
            this.setFilter('unread')
          } else if (res.tapIndex === 2) {
            this.setFilter('read')
          } else {
            this.setFilter('all')
          }
        }
      })
    },

    showMoreActions() {
      uni.showActionSheet({
        itemList: ['标记全部已读', '清除已读通知', '通知设置', '查看统计'],
        success: (res) => {
          switch (res.tapIndex) {
            case 0:
              this.markAllAsRead()
              break
            case 1:
              this.clearReadNotifications()
              break
            case 2:
              this.goToSettings()
              break
            case 3:
              this.showStats()
              break
          }
        }
      })
    },

    showNotificationActions(notification) {
      const items = ['标记为已读', '删除通知']
      if (!notification.read) {
        items[0] = '标记为已读'
      } else {
        items[0] = '标记为未读'
      }

      uni.showActionSheet({
        itemList: items,
        success: async (res) => {
          if (res.tapIndex === 0) {
            await this.notificationStore.markAsRead(notification.id)
            this.updateFilterCounts()
          } else if (res.tapIndex === 1) {
            this.deleteNotification(notification)
          }
        }
      })
    },

    async markAllAsRead() {
      await this.notificationStore.markAllAsRead()
      this.updateFilterCounts()
      uni.showToast({
        title: '已全部标记为已读',
        icon: 'success'
      })
    },

    async clearReadNotifications() {
      uni.showModal({
        title: '确认清除',
        content: '确定要清除所有已读通知吗?',
        success: async (res) => {
          if (res.confirm) {
            const readNotifications = this.filteredNotifications.filter(n => n.read)
            for (const notification of readNotifications) {
              await this.notificationStore.deleteNotification(notification.id)
            }
            this.updateFilterCounts()
            uni.showToast({
              title: '已清除',
              icon: 'success'
            })
          }
        }
      })
    },

    deleteNotification(notification) {
      uni.showModal({
        title: '确认删除',
        content: '确定要删除这条通知吗?',
        success: async (res) => {
          if (res.confirm) {
            await this.notificationStore.deleteNotification(notification.id)
            this.updateFilterCounts()
            uni.showToast({
              title: '已删除',
              icon: 'success'
            })
          }
        }
      })
    },

    handleAction(notification, action) {
      console.log('Handle action:', action, notification)
      if (action.handler) {
        action.handler(notification)
      }
    },

    previewImage(image) {
      uni.previewImage({
        urls: [image],
        current: image
      })
    },

    showStats() {
      const stats = this.notificationStore.getNotificationStats()
      const content = `总计: ${stats.total} 条\n未读: ${stats.unread} 条\n今日: ${stats.today} 条\n本周: ${stats.thisWeek} 条`

      uni.showModal({
        title: '通知统计',
        content,
        showCancel: false
      })
    },

    goToSettings() {
      uni.navigateTo({
        url: '/pages/settings/settings'
      })
    },

    loadMore() {
      console.log('Load more notifications')
    },

    getTypeIcon(type) {
      const icons = {
        message: '💬',
        trade: '💰',
        social: '👥',
        system: '⚙️',
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌'
      }
      return icons[type] || '🔔'
    },

    getEmptyHint() {
      if (this.currentFilter === 'all') {
        return '暂时没有任何通知'
      }
      return `暂时没有${this.filters.find(f => f.value === this.currentFilter)?.label}通知`
    },

    formatTime(timestamp) {
      if (!timestamp) return ''

      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
      if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
      if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`

      return `${date.getMonth() + 1}/${date.getDate()}`
    }
  }
}
</script>

<style scoped>
.notification-center {
  min-height: 100vh;
  background: #f5f7fa;
  display: flex;
  flex-direction: column;
}

/* Header */
.header {
  background: white;
  padding: 16px;
  padding-top: calc(16px + env(safe-area-inset-top));
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-text {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
}

.header-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: #ff4d4f;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-badge text {
  font-size: 12px;
  color: white;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.action-icon {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

/* Filter Chips */
.filter-chips {
  background: white;
  padding: 12px 16px;
  white-space: nowrap;
  border-bottom: 1px solid #f0f0f0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  margin-right: 8px;
  border-radius: 20px;
  background: #f5f7fa;
  border: 1px solid transparent;
}

.chip.active {
  background: #e6f0ff;
  border-color: #667eea;
}

.chip-icon {
  font-size: 16px;
}

.chip-text {
  font-size: 14px;
  color: #666;
}

.chip.active .chip-text {
  color: #667eea;
  font-weight: 500;
}

.chip-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  background: #ff4d4f;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chip-badge text {
  font-size: 11px;
  color: white;
  font-weight: 500;
}

/* Sort Bar */
.sort-bar {
  background: white;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f0f0f0;
}

.sort-options {
  display: flex;
  gap: 16px;
}

.sort-item {
  padding: 4px 12px;
  border-radius: 12px;
  background: transparent;
}

.sort-item.active {
  background: #f5f7fa;
}

.sort-text {
  font-size: 13px;
  color: #666;
}

.sort-item.active .sort-text {
  color: #667eea;
  font-weight: 500;
}

.notification-stats {
  font-size: 12px;
  color: #999;
}

/* Notifications List */
.notifications-scroll {
  flex: 1;
  background: white;
}

.notification-item {
  padding: 16px;
  border-bottom: 1px solid #f5f5f5;
  background: white;
  transition: background 0.2s;
}

.notification-item.unread {
  background: #f8f9ff;
}

.notification-item:active {
  background: #f0f0f0;
}

.notification-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.notification-icon {
  width: 40px;
  height: 40px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.notification-icon.type-message {
  background: #e6f7ff;
}

.notification-icon.type-trade {
  background: #fff7e6;
}

.notification-icon.type-social {
  background: #f6ffed;
}

.notification-icon.type-system {
  background: #f5f5f5;
}

.notification-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.content-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notification-title {
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
}

.priority-badge {
  padding: 2px 8px;
  background: #ff4d4f;
  border-radius: 4px;
}

.priority-badge text {
  font-size: 11px;
  color: white;
  font-weight: 500;
}

.notification-time {
  font-size: 12px;
  color: #999;
}

.notification-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unread-dot {
  width: 8px;
  height: 8px;
  background: #667eea;
  border-radius: 4px;
}

.action-more {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #999;
}

.notification-body {
  margin-top: 8px;
  margin-left: 52px;
}

.body-text {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.body-text.expanded {
  display: block;
  -webkit-line-clamp: unset;
}

.notification-image {
  margin-top: 12px;
  border-radius: 8px;
  overflow: hidden;
}

.notification-image image {
  width: 100%;
  height: 200px;
}

.notification-action-buttons {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.action-button {
  flex: 1;
  padding: 8px 16px;
  border-radius: 8px;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
}

.action-button.primary {
  background: #667eea;
  color: white;
}

.action-button.secondary {
  background: #f5f7fa;
  color: #666;
}

.notification-metadata {
  margin-top: 12px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 8px;
}

.metadata-item {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
}

.metadata-key {
  color: #999;
}

.metadata-value {
  color: #666;
}

/* Empty State */
.empty-state {
  padding: 80px 40px;
  text-align: center;
}

.empty-icon {
  display: block;
  font-size: 64px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.empty-text {
  display: block;
  font-size: 15px;
  color: #666;
  margin-bottom: 8px;
}

.empty-hint {
  display: block;
  font-size: 13px;
  color: #999;
}

/* Loading */
.loading-state {
  padding: 40px;
  text-align: center;
}

.loading-text {
  font-size: 14px;
  color: #999;
}

/* Do Not Disturb Banner */
.dnd-banner {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  gap: 12px;
}

.dnd-icon {
  font-size: 20px;
}

.dnd-text {
  flex: 1;
  font-size: 14px;
  color: white;
  font-weight: 500;
}

.dnd-action {
  padding: 6px 16px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
}

.dnd-action text {
  font-size: 13px;
  color: white;
  font-weight: 500;
}
</style>
