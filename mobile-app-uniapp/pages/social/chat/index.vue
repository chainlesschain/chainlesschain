<template>
  <view class="chat-container">
    <!-- 头部 -->
    <view class="header">
      <text class="title">消息</text>
    </view>

    <!-- 会话列表 -->
    <scroll-view class="conversations-list" scroll-y>
      <view v-if="loading" class="loading">
        <text>加载中...</text>
      </view>

      <view v-else-if="conversations.length === 0" class="empty">
        <text class="empty-icon">💬</text>
        <text class="empty-text">暂无消息</text>
        <button class="start-chat-btn" @click="goToFriends">
          选择好友开始聊天
        </button>
      </view>

      <view v-else>
        <view
          class="conversation-item"
          v-for="conv in conversations"
          :key="conv.id"
          @click="openConversation(conv)"
          @longpress="showConversationOptions(conv)"
        >
          <view class="conversation-avatar">
            <text class="avatar-text">{{ getAvatarText(conv) }}</text>
            <view class="online-indicator" v-if="false"></view>
          </view>

          <view class="conversation-info">
            <view class="info-top">
              <text class="friend-name">{{ getFriendName(conv) }}</text>
              <text class="time">{{ formatTime(conv.lastMessageAt) }}</text>
            </view>

            <view class="info-bottom">
              <text class="last-message" :class="{ encrypted: isEncrypted(conv) }">
                {{ getLastMessagePreview(conv) }}
              </text>
              <view class="unread-badge" v-if="conv.unreadCount > 0">
                <text class="badge-text">{{ conv.unreadCount }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 操作菜单 -->
    <view class="action-menu" v-if="selectedConversation" @click="closeActionMenu">
      <view class="action-content" @click.stop>
        <view class="action-item" @click="markAsRead">
          <text class="action-icon">✓</text>
          <text class="action-text">标记为已读</text>
        </view>
        <view class="action-item danger" @click="deleteConversation">
          <text class="action-icon">🗑️</text>
          <text class="action-text">删除会话</text>
        </view>
        <view class="action-item" @click="closeActionMenu">
          <text class="action-text">取消</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import messagingService from '@/services/messaging'

export default {
  data() {
    return {
      conversations: [],
      loading: false,
      selectedConversation: null
    }
  },

  onLoad() {
    this.loadConversations()
    this.setupMessageListener()
  },

  onShow() {
    // 每次显示时刷新
    this.loadConversations()
  },

  onUnload() {
    // 移除监听器
    if (this.messageListener) {
      messagingService.removeMessageListener(this.messageListener)
    }
  },

  methods: {
    async loadConversations() {
      this.loading = true
      try {
        await messagingService.init()
        this.conversations = await messagingService.getConversations()
      } catch (error) {
        console.error('加载会话列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    setupMessageListener() {
      this.messageListener = (event, data) => {
        if (event === 'message:received' || event === 'message:sent' || event === 'conversation:read') {
          // 刷新会话列表
          this.loadConversations()
        }
      }
      messagingService.addMessageListener(this.messageListener)
    },

    openConversation(conv) {
      // 获取对方DID
      const friendDid = this.getFriendDid(conv)

      uni.navigateTo({
        url: `/pages/social/chat/conversation?did=${friendDid}`
      })
    },

    showConversationOptions(conv) {
      this.selectedConversation = conv
    },

    closeActionMenu() {
      this.selectedConversation = null
    },

    async markAsRead() {
      if (!this.selectedConversation) return

      try {
        await messagingService.markAsRead(this.selectedConversation.id)
        this.closeActionMenu()
        await this.loadConversations()
      } catch (error) {
        console.error('标记已读失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    async deleteConversation() {
      if (!this.selectedConversation) return

      uni.showModal({
        title: '删除会话',
        content: '确定要删除这个会话吗？',
        confirmText: '删除',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm) {
            try {
              await messagingService.deleteConversation(this.selectedConversation.id)
              this.closeActionMenu()
              await this.loadConversations()

              uni.showToast({
                title: '已删除',
                icon: 'success'
              })
            } catch (error) {
              console.error('删除会话失败:', error)
              uni.showToast({
                title: '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    goToFriends() {
      uni.navigateTo({
        url: '/pages/social/friends/list'
      })
    },

    getFriendDid(conv) {
      // 从participants中找到不是自己的DID
      if (!conv.participants || conv.participants.length < 2) {
        return ''
      }
      // 这里简化处理，实际应该从当前用户DID中排除
      return conv.participants.find(p => p !== conv.userDid) || conv.participants[0]
    },

    getFriendName(conv) {
      if (conv.friendInfo && conv.friendInfo.nickname) {
        return conv.friendInfo.nickname
      }
      const friendDid = this.getFriendDid(conv)
      return friendDid ? this.formatDid(friendDid) : '未知用户'
    },

    getAvatarText(conv) {
      const name = this.getFriendName(conv)
      if (name && name.length >= 2 && !name.startsWith('did:')) {
        return name.substring(0, 2)
      }
      const friendDid = this.getFriendDid(conv)
      return friendDid ? friendDid.slice(-2).toUpperCase() : '?'
    },

    getLastMessagePreview(conv) {
      if (!conv.lastMessage) {
        return '暂无消息'
      }

      // 如果是加密消息，显示占位符
      if (this.isEncrypted(conv)) {
        return '🔐 加密消息'
      }

      // 限制长度
      const maxLength = 30
      if (conv.lastMessage.length > maxLength) {
        return conv.lastMessage.substring(0, maxLength) + '...'
      }
      return conv.lastMessage
    },

    isEncrypted(conv) {
      // 检查lastMessage是否为加密格式（Base64）
      return conv.lastMessage && conv.lastMessage.length > 50 && /^[A-Za-z0-9+/=]+$/.test(conv.lastMessage)
    },

    formatDid(did) {
      if (!did || did.length <= 32) {
        return did
      }
      return `${did.substring(0, 24)}...${did.slice(-8)}`
    },

    formatTime(timestamp) {
      if (!timestamp) return ''

      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      // 今天
      if (diff < 86400000 && date.getDate() === now.getDate()) {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      }

      // 昨天
      if (diff < 172800000 && date.getDate() === now.getDate() - 1) {
        return '昨天'
      }

      // 本周
      if (diff < 604800000) {
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        return days[date.getDay()]
      }

      // 更早
      return `${date.getMonth() + 1}/${date.getDate()}`
    }
  }
}
</script>

<style lang="scss" scoped>
.chat-container {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--bg-card);
  padding: 32rpx;
  border-bottom: 2rpx solid var(--border-color);

  .title {
    font-size: 44rpx;
    font-weight: bold;
    color: var(--text-primary);
  }
}

.conversations-list {
  flex: 1;
}

.loading,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 48rpx;

  .empty-icon {
    font-size: 96rpx;
    margin-bottom: 24rpx;
    opacity: 0.5;
  }

  .empty-text {
    font-size: 28rpx;
    color: var(--text-secondary);
    margin-bottom: 32rpx;
  }

  .start-chat-btn {
    background: var(--bg-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 48rpx;
    padding: 16rpx 48rpx;
    font-size: 28rpx;

    &::after {
      border: none;
    }
  }
}

.conversation-item {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx;
  background: var(--bg-card);
  border-bottom: 1rpx solid var(--border-color);
  gap: 24rpx;

  &:active {
    background: var(--bg-secondary);
  }
}

.conversation-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 48rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;

  .avatar-text {
    font-size: 36rpx;
    font-weight: bold;
    color: white;
  }

  .online-indicator {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 24rpx;
    height: 24rpx;
    background: #52c41a;
    border: 3rpx solid var(--bg-card);
    border-radius: 12rpx;
  }
}

.conversation-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  min-width: 0;

  .info-top {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .friend-name {
      font-size: 32rpx;
      font-weight: bold;
      color: var(--text-primary);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .time {
      font-size: 22rpx;
      color: var(--text-tertiary);
      margin-left: 16rpx;
      flex-shrink: 0;
    }
  }

  .info-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .last-message {
      font-size: 26rpx;
      color: var(--text-secondary);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      &.encrypted {
        font-style: italic;
      }
    }

    .unread-badge {
      min-width: 36rpx;
      height: 36rpx;
      background: var(--color-error);
      border-radius: 18rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 8rpx;
      margin-left: 16rpx;
      flex-shrink: 0;

      .badge-text {
        font-size: 20rpx;
        color: white;
        font-weight: bold;
      }
    }
  }
}

.action-menu {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 1000;

  .action-content {
    width: 100%;
    background: var(--bg-card);
    border-radius: 24rpx 24rpx 0 0;
    overflow: hidden;

    .action-item {
      height: 112rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16rpx;
      border-bottom: 1rpx solid var(--border-color);

      &:active {
        background: var(--bg-secondary);
      }

      &.danger {
        .action-text {
          color: var(--color-error);
        }
      }

      &:last-child {
        border-bottom: none;
        border-top: 8rpx solid var(--bg-secondary);
      }

      .action-icon {
        font-size: 32rpx;
      }

      .action-text {
        font-size: 32rpx;
        color: var(--text-primary);
      }
    }
  }
}
</style>
