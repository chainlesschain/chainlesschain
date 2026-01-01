<template>
  <view class="messages-container">
    <!-- 顶部搜索栏 -->
    <view class="search-bar">
      <view class="search-input">
        <text class="search-icon">🔍</text>
        <input
          type="text"
          placeholder="搜索消息"
          v-model="searchKeyword"
          @input="handleSearch"
        />
      </view>
      <view class="filter-btn" @click="showFilterMenu">
        <text class="filter-icon">⋮</text>
      </view>
    </view>

    <!-- 消息类型标签 -->
    <view class="message-tabs">
      <view
        v-for="(tab, index) in tabs"
        :key="index"
        class="tab-item"
        :class="{ active: currentTab === index }"
        @click="switchTab(index)"
      >
        <text class="tab-text">{{ tab.label }}</text>
        <view v-if="tab.count > 0" class="tab-badge">
          <text>{{ tab.count > 99 ? '99+' : tab.count }}</text>
        </view>
      </view>
    </view>

    <!-- 消息列表 -->
    <scroll-view class="messages-scroll" scroll-y @scrolltolower="loadMore">
      <!-- 好友消息 -->
      <view v-if="currentTab === 0">
        <view
          v-for="conv in friendConversations"
          :key="conv.id"
          class="message-item"
          @click="openFriendChat(conv)"
        >
          <view class="item-avatar">
            <text class="avatar-emoji">👤</text>
            <view v-if="conv.unreadCount > 0" class="unread-badge">
              <text>{{ conv.unreadCount }}</text>
            </view>
          </view>
          <view class="item-content">
            <view class="content-header">
              <text class="contact-name">{{ conv.nickname }}</text>
              <text class="message-time">{{ formatTime(conv.updated_at) }}</text>
            </view>
            <view class="content-preview">
              <text class="preview-text" :class="{ 'unread-text': conv.unreadCount > 0 }">
                <text v-if="conv.lastMessage?.isSent" class="sender-tag">[我] </text>
                {{ conv.lastMessage?.content || '暂无消息' }}
              </text>
            </view>
          </view>
        </view>

        <!-- 空状态 -->
        <view v-if="friendConversations.length === 0 && !loading" class="empty-state">
          <text class="empty-icon">💬</text>
          <text class="empty-text">暂无聊天消息</text>
          <text class="empty-hint">点击右上角开始新对话</text>
        </view>
      </view>

      <!-- 系统通知 -->
      <view v-if="currentTab === 1">
        <view
          v-for="notif in systemNotifications"
          :key="notif.id"
          class="message-item notification"
          @click="handleNotification(notif)"
        >
          <view class="item-avatar">
            <text class="avatar-emoji">{{ getNotificationIcon(notif.type) }}</text>
            <view v-if="!notif.isRead" class="unread-dot"></view>
          </view>
          <view class="item-content">
            <view class="content-header">
              <text class="contact-name">{{ notif.title }}</text>
              <text class="message-time">{{ formatTime(notif.createdAt) }}</text>
            </view>
            <view class="content-preview">
              <text class="preview-text" :class="{ 'unread-text': !notif.isRead }">
                {{ notif.content }}
              </text>
            </view>
          </view>
        </view>

        <!-- 空状态 -->
        <view v-if="systemNotifications.length === 0 && !loading" class="empty-state">
          <text class="empty-icon">🔔</text>
          <text class="empty-text">暂无系统通知</text>
        </view>
      </view>

      <!-- 好友请求 -->
      <view v-if="currentTab === 2">
        <view
          v-for="request in friendRequests"
          :key="request.id"
          class="message-item request"
          @click="handleFriendRequest(request)"
        >
          <view class="item-avatar">
            <text class="avatar-emoji">👋</text>
            <view v-if="request.status === 'pending'" class="unread-dot"></view>
          </view>
          <view class="item-content">
            <view class="content-header">
              <text class="contact-name">好友请求</text>
              <text class="message-time">{{ formatTime(request.createdAt) }}</text>
            </view>
            <view class="content-preview">
              <text class="preview-text">
                {{ request.senderName }} 请求添加你为好友
              </text>
            </view>
            <view v-if="request.status === 'pending'" class="request-actions">
              <view class="action-btn reject" @click.stop="rejectRequest(request)">
                <text>拒绝</text>
              </view>
              <view class="action-btn accept" @click.stop="acceptRequest(request)">
                <text>接受</text>
              </view>
            </view>
            <view v-else class="request-status">
              <text :class="request.status === 'accepted' ? 'status-accepted' : 'status-rejected'">
                {{ request.status === 'accepted' ? '已接受' : '已拒绝' }}
              </text>
            </view>
          </view>
        </view>

        <!-- 空状态 -->
        <view v-if="friendRequests.length === 0 && !loading" class="empty-state">
          <text class="empty-icon">👋</text>
          <text class="empty-text">暂无好友请求</text>
        </view>
      </view>

      <!-- 加载状态 -->
      <view v-if="loading" class="loading-state">
        <text class="loading-text">加载中...</text>
      </view>
    </scroll-view>

    <!-- 底部操作按钮 -->
    <view class="bottom-actions" v-if="currentTab === 0">
      <view class="action-button primary" @click="navigateTo('/pages/social/friends/list')">
        <text class="btn-icon">👥</text>
        <text class="btn-text">好友列表</text>
      </view>
      <view class="action-button secondary" @click="showNewMessageDialog">
        <text class="btn-icon">✨</text>
        <text class="btn-text">新建对话</text>
      </view>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'
import friendService from '@/services/friends'

export default {
  data() {
    return {
      searchKeyword: '',
      currentTab: 0,
      tabs: [
        { label: '聊天', count: 0 },
        { label: '通知', count: 0 },
        { label: '请求', count: 0 }
      ],
      friendConversations: [],
      systemNotifications: [],
      friendRequests: [],
      loading: false
    }
  },

  async onLoad() {
    await this.loadAllMessages()
  },

  async onShow() {
    // 每次显示时刷新
    await this.loadAllMessages()
  },

  onPullDownRefresh() {
    this.loadAllMessages().then(() => {
      uni.stopPullDownRefresh()
    })
  },

  methods: {
    /**
     * 加载所有消息
     */
    async loadAllMessages() {
      this.loading = true
      try {
        await Promise.all([
          this.loadFriendConversations(),
          this.loadSystemNotifications(),
          this.loadFriendRequests()
        ])
        this.updateTabCounts()
      } catch (error) {
        console.error('加载消息失败:', error)
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载好友对话
     */
    async loadFriendConversations() {
      try {
        const conversations = await db.getFriendConversations()
        this.friendConversations = conversations || []
        console.log('加载好友对话:', this.friendConversations.length)
      } catch (error) {
        console.error('加载好友对话失败:', error)
        this.friendConversations = []
      }
    },

    /**
     * 加载系统通知
     */
    async loadSystemNotifications() {
      try {
        // 从数据库获取系统通知
        const sql = `
          SELECT * FROM system_notifications
          ORDER BY created_at DESC
          LIMIT 50
        `
        const result = await db.selectSql(sql, [])

        this.systemNotifications = (result || []).map(n => ({
          id: n.id,
          type: n.type || 'info',
          title: n.title || '系统通知',
          content: n.content || '',
          isRead: n.is_read === 1,
          createdAt: n.created_at
        }))

        console.log('加载系统通知:', this.systemNotifications.length)
      } catch (error) {
        console.error('加载系统通知失败:', error)
        this.systemNotifications = []
      }
    },

    /**
     * 加载好友请求
     */
    async loadFriendRequests() {
      try {
        const requests = await friendService.getFriendRequests()
        this.friendRequests = requests || []
        console.log('加载好友请求:', this.friendRequests.length)
      } catch (error) {
        console.error('加载好友请求失败:', error)
        this.friendRequests = []
      }
    },

    /**
     * 更新标签计数
     */
    updateTabCounts() {
      // 聊天未读数
      this.tabs[0].count = this.friendConversations.reduce(
        (sum, conv) => sum + (conv.unreadCount || 0),
        0
      )

      // 系统通知未读数
      this.tabs[1].count = this.systemNotifications.filter(n => !n.isRead).length

      // 待处理的好友请求数
      this.tabs[2].count = this.friendRequests.filter(r => r.status === 'pending').length
    },

    /**
     * 切换标签
     */
    switchTab(index) {
      this.currentTab = index
    },

    /**
     * 搜索
     */
    handleSearch() {
      // TODO: 实现搜索功能
      console.log('搜索:', this.searchKeyword)
    },

    /**
     * 显示筛选菜单
     */
    showFilterMenu() {
      const items = ['全部消息', '仅未读', '标记全部已读']
      uni.showActionSheet({
        itemList: items,
        success: (res) => {
          if (res.tapIndex === 2) {
            this.markAllAsRead()
          }
        }
      })
    },

    /**
     * 标记全部已读
     */
    async markAllAsRead() {
      try {
        if (this.currentTab === 1) {
          // 标记系统通知为已读
          const sql = `UPDATE system_notifications SET is_read = 1 WHERE is_read = 0`
          await db.executeSql(sql, [])
          await this.loadSystemNotifications()
          this.updateTabCounts()
          uni.showToast({
            title: '已标记全部已读',
            icon: 'success'
          })
        }
      } catch (error) {
        console.error('标记已读失败:', error)
      }
    },

    /**
     * 打开好友聊天
     */
    openFriendChat(conv) {
      uni.navigateTo({
        url: `/pages/social/friend-chat/friend-chat?friendDid=${conv.friendDid}&nickname=${encodeURIComponent(conv.nickname)}`
      })
    },

    /**
     * 处理系统通知
     */
    async handleNotification(notif) {
      try {
        // 标记为已读
        if (!notif.isRead) {
          const sql = `UPDATE system_notifications SET is_read = 1 WHERE id = ?`
          await db.executeSql(sql, [notif.id])
          await this.loadSystemNotifications()
          this.updateTabCounts()
        }

        // 根据通知类型跳转
        if (notif.type === 'friend_request') {
          this.switchTab(2) // 切换到好友请求标签
        }
      } catch (error) {
        console.error('处理通知失败:', error)
      }
    },

    /**
     * 处理好友请求
     */
    handleFriendRequest(request) {
      if (request.status !== 'pending') {
        return
      }

      uni.showModal({
        title: '好友请求',
        content: `${request.senderName} 请求添加你为好友`,
        confirmText: '接受',
        cancelText: '拒绝',
        success: async (res) => {
          if (res.confirm) {
            await this.acceptRequest(request)
          } else if (res.cancel) {
            await this.rejectRequest(request)
          }
        }
      })
    },

    /**
     * 接受好友请求
     */
    async acceptRequest(request) {
      try {
        await friendService.acceptFriendRequest(request.id)
        await this.loadFriendRequests()
        this.updateTabCounts()
        uni.showToast({
          title: '已接受',
          icon: 'success'
        })
      } catch (error) {
        console.error('接受请求失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    /**
     * 拒绝好友请求
     */
    async rejectRequest(request) {
      try {
        await friendService.rejectFriendRequest(request.id)
        await this.loadFriendRequests()
        this.updateTabCounts()
        uni.showToast({
          title: '已拒绝',
          icon: 'success'
        })
      } catch (error) {
        console.error('拒绝请求失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    /**
     * 显示新建对话对话框
     */
    showNewMessageDialog() {
      uni.navigateTo({
        url: '/pages/social/friends/list'
      })
    },

    /**
     * 加载更多
     */
    loadMore() {
      console.log('滚动到底部，加载更多')
    },

    /**
     * 页面导航
     */
    navigateTo(url) {
      uni.navigateTo({ url })
    },

    /**
     * 获取通知图标
     */
    getNotificationIcon(type) {
      const icons = {
        'info': 'ℹ️',
        'success': '✅',
        'warning': '⚠️',
        'error': '❌',
        'friend_request': '👋',
        'system': '⚙️'
      }
      return icons[type] || '🔔'
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      if (!timestamp) return ''

      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      // 小于1分钟
      if (diff < 60000) {
        return '刚刚'
      }

      // 小于1小时
      if (diff < 3600000) {
        return `${Math.floor(diff / 60000)} 分钟前`
      }

      // 小于24小时
      if (diff < 86400000) {
        return `${Math.floor(diff / 3600000)} 小时前`
      }

      // 小于7天
      if (diff < 604800000) {
        return `${Math.floor(diff / 86400000)} 天前`
      }

      // 显示日期
      return `${date.getMonth() + 1}/${date.getDate()}`
    }
  }
}
</script>

<style scoped>
.messages-container {
  min-height: 100vh;
  background: #f5f7fa;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(env(safe-area-inset-bottom) + 50px);
}

/* 搜索栏 */
.search-bar {
  background: white;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.search-input {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f5f7fa;
  border-radius: 20px;
  padding: 8px 16px;
}

.search-icon {
  font-size: 18px;
  color: #999;
}

.search-input input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 14px;
  color: #1a1a1a;
}

.filter-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: #f5f7fa;
}

.filter-icon {
  font-size: 20px;
  color: #666;
}

/* 消息类型标签 */
.message-tabs {
  background: white;
  display: flex;
  padding: 0 16px;
  border-bottom: 1px solid #f0f0f0;
}

.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 0;
  position: relative;
}

.tab-item.active {
  border-bottom: 2px solid #667eea;
}

.tab-text {
  font-size: 15px;
  font-weight: 500;
  color: #666;
}

.tab-item.active .tab-text {
  color: #667eea;
}

.tab-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  background: #ff4d4f;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-badge text {
  font-size: 11px;
  color: white;
  line-height: 1;
  transform: scale(0.9);
}

/* 消息列表 */
.messages-scroll {
  flex: 1;
  background: white;
}

.message-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #f5f5f5;
  background: white;
  transition: background 0.2s;
}

.message-item:active {
  background: #f8f9fa;
}

.item-avatar {
  width: 48px;
  height: 48px;
  border-radius: 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
}

.avatar-emoji {
  font-size: 24px;
}

.unread-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  background: #ff4d4f;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid white;
}

.unread-badge text {
  font-size: 11px;
  color: white;
  line-height: 1;
  transform: scale(0.85);
}

.unread-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 10px;
  height: 10px;
  background: #ff4d4f;
  border-radius: 5px;
  border: 2px solid white;
}

.item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.contact-name {
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-time {
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
  margin-left: 12px;
}

.content-preview {
  display: flex;
  align-items: center;
}

.preview-text {
  font-size: 13px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.preview-text.unread-text {
  color: #1a1a1a;
  font-weight: 500;
}

.sender-tag {
  color: #999;
}

/* 好友请求操作 */
.request-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.action-btn {
  flex: 1;
  height: 32px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 500;
}

.action-btn.reject {
  background: #f5f5f5;
  color: #666;
}

.action-btn.accept {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.request-status {
  margin-top: 6px;
  font-size: 13px;
}

.status-accepted {
  color: #52c41a;
}

.status-rejected {
  color: #999;
}

/* 空状态 */
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

/* 加载状态 */
.loading-state {
  padding: 40px;
  text-align: center;
}

.loading-text {
  font-size: 14px;
  color: #999;
}

/* 底部操作按钮 */
.bottom-actions {
  background: white;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid #f0f0f0;
  display: flex;
  gap: 12px;
}

.action-button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
}

.action-button.primary {
  background: #f5f7fa;
  color: #1a1a1a;
}

.action-button.secondary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-icon {
  font-size: 18px;
}

.btn-text {
  font-size: 14px;
}
</style>
