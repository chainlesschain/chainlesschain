<template>
  <view class="conversation-container">
    <!-- 头部导航 -->
    <view class="header">
      <view class="header-left" @click="goBack">
        <text class="back-icon">‹</text>
      </view>
      <view class="header-center">
        <text class="friend-name">{{ friendName }}</text>
        <text class="encryption-status">🔐 端到端加密</text>
      </view>
      <view class="header-right" @click="goToProfile">
        <text class="more-icon">•••</text>
      </view>
    </view>

    <!-- 消息列表 -->
    <scroll-view
      class="messages-container"
      scroll-y
      :scroll-into-view="scrollToView"
      :scroll-with-animation="true"
      refresher-enabled
      :refresher-triggered="loadingMore"
      @refresherrefresh="loadMoreMessages"
    >
      <view v-if="loading" class="loading">
        <text class="loading-icon">⏳</text>
        <text class="loading-text">加载中...</text>
      </view>

      <view v-else-if="loadError" class="error-state">
        <text class="error-icon">⚠️</text>
        <text class="error-text">{{ loadError }}</text>
        <button class="retry-btn" @click="loadMessages">
          重试
        </button>
      </view>

      <view v-else-if="messages.length === 0" class="empty">
        <text class="empty-icon">💬</text>
        <text class="empty-text">还没有消息，发送第一条消息吧</text>
      </view>

      <view v-else class="messages-list">
        <view
          v-for="(message, index) in messages"
          :key="message.id"
          :id="`msg-${index}`"
          class="message-wrapper"
          :class="{ 'is-mine': isMyMessage(message), 'is-failed': message.status === 'failed' }"
          @longpress="showMessageOptions(message)"
        >
          <view class="message-bubble" :class="{ failed: message.status === 'failed' }">
            <text class="message-content">{{ message.decryptedContent || message.content }}</text>
            <view class="message-meta">
              <text class="message-time">{{ formatMessageTime(message.createdAt) }}</text>
              <text class="message-status" v-if="isMyMessage(message)">
                {{ getMessageStatus(message) }}
              </text>
              <text class="retry-icon" v-if="message.status === 'failed'" @click="resendMessage(message)">
                ↻
              </text>
            </view>
          </view>
        </view>
      </view>

      <!-- 发送中的消息 -->
      <view v-if="pendingMessage" class="message-wrapper is-mine">
        <view class="message-bubble pending">
          <text class="message-content">{{ pendingMessage }}</text>
          <view class="message-meta">
            <text class="message-time">发送中...</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 输入区域 -->
    <view class="input-area">
      <input
        class="message-input"
        type="text"
        v-model="inputText"
        placeholder="输入消息..."
        :disabled="sending"
        @confirm="sendMessage"
      />
      <button
        class="send-btn"
        :class="{ 'btn-disabled': !canSend }"
        :disabled="!canSend"
        @click="sendMessage"
      >
        <text v-if="!sending">发送</text>
        <text v-else>...</text>
      </button>
    </view>

    <!-- 消息操作菜单 -->
    <view class="message-action-menu" v-if="selectedMessage" @click="closeMessageOptions">
      <view class="menu-content" @click.stop>
        <view class="menu-item" @click="copyMessage">
          <text class="menu-icon">📋</text>
          <text class="menu-text">复制</text>
        </view>
        <view class="menu-item danger" v-if="isMyMessage(selectedMessage)" @click="deleteMessage">
          <text class="menu-icon">🗑️</text>
          <text class="menu-text">删除</text>
        </view>
        <view class="menu-item" v-if="selectedMessage.status === 'failed'" @click="resendMessage(selectedMessage)">
          <text class="menu-icon">↻</text>
          <text class="menu-text">重发</text>
        </view>
        <view class="menu-item" @click="closeMessageOptions">
          <text class="menu-text">取消</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import messagingService from '@/services/messaging'
import friendService from '@/services/friends'
import database from '@/services/database'

export default {
  data() {
    return {
      friendDid: '',
      friendName: '',
      conversationId: '',
      messages: [],
      inputText: '',
      loading: false,
      loadingMore: false,
      loadError: null,
      sending: false,
      pendingMessage: '',
      scrollToView: '',
      messageListener: null,
      selectedMessage: null,
      failedMessages: new Map() // 存储发送失败的消息
    }
  },

  computed: {
    canSend() {
      return this.inputText.trim().length > 0 && !this.sending
    }
  },

  onLoad(options) {
    if (options.did) {
      this.friendDid = options.did
      this.init()
    } else {
      uni.showToast({
        title: '参数错误',
        icon: 'none'
      })
      setTimeout(() => {
        uni.navigateBack()
      }, 1500)
    }
  },

  onUnload() {
    // 移除监听器
    if (this.messageListener) {
      messagingService.removeMessageListener(this.messageListener)
    }

    // 标记为已读
    if (this.conversationId) {
      messagingService.markAsRead(this.conversationId)
    }
  },

  methods: {
    async init() {
      try {
        // 加载好友信息
        await friendService.init()
        const friends = await friendService.getFriends()
        const friend = friends.find(f => f.friendDid === this.friendDid)

        if (friend) {
          this.friendName = friend.nickname || this.formatDid(this.friendDid)
        } else {
          this.friendName = this.formatDid(this.friendDid)
        }

        // 初始化消息服务
        await messagingService.init()

        // 生成会话ID
        this.conversationId = this.getConversationId(this.friendDid)

        // 加载消息
        await this.loadMessages()

        // 设置消息监听
        this.setupMessageListener()

        // 标记为已读
        await messagingService.markAsRead(this.conversationId)
      } catch (error) {
        console.error('初始化失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    async loadMessages() {
      this.loading = true
      this.loadError = null

      try {
        this.messages = await messagingService.getMessages(this.conversationId)

        // 滚动到底部
        this.$nextTick(() => {
          this.scrollToBottom()
        })
      } catch (error) {
        console.error('加载消息失败:', error)
        this.loadError = error.message || '加载失败'

        let errorMsg = '加载消息失败，请稍后重试'
        if (error.message) {
          if (error.message.includes('网络') || error.message.includes('timeout')) {
            errorMsg = '网络连接失败，请检查网络'
          } else if (error.message.includes('database')) {
            errorMsg = '数据库错误，请重启应用'
          } else {
            errorMsg = error.message
          }
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2500
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 下拉加载更多历史消息
     */
    async loadMoreMessages() {
      this.loadingMore = true

      try {
        // TODO: 实现分页加载历史消息
        // 目前只是刷新当前消息
        const messages = await messagingService.getMessages(this.conversationId)
        this.messages = messages

        uni.showToast({
          title: '已是全部消息',
          icon: 'none',
          duration: 1000
        })
      } catch (error) {
        console.error('加载更多消息失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none',
          duration: 1500
        })
      } finally {
        this.loadingMore = false
      }
    },

    setupMessageListener() {
      this.messageListener = (event, data) => {
        if (event === 'message:received' || event === 'message:sent') {
          // 检查是否属于当前会话
          if (data.conversationId === this.conversationId) {
            // 刷新消息列表
            this.loadMessages()
          }
        }
      }
      messagingService.addMessageListener(this.messageListener)
    },

    async sendMessage() {
      if (!this.canSend) {
        return
      }

      const messageText = this.inputText.trim()
      this.inputText = ''
      this.pendingMessage = messageText
      this.sending = true

      // 创建临时消息ID
      const tempMessageId = `temp_${Date.now()}`

      try {
        await messagingService.sendMessage(this.friendDid, {
          type: 'text',
          content: messageText
        })

        // 发送成功，刷新消息列表
        await this.loadMessages()

        // 清除失败记录（如果有）
        this.failedMessages.delete(tempMessageId)
      } catch (error) {
        console.error('发送消息失败:', error)

        let errorMsg = '发送失败'
        if (error.message) {
          if (error.message.includes('网络') || error.message.includes('timeout')) {
            errorMsg = '网络连接失败，消息发送失败'
          } else if (error.message.includes('加密')) {
            errorMsg = '加密失败，请检查DID配置'
          } else {
            errorMsg = error.message
          }
        }

        uni.showModal({
          title: '发送失败',
          content: `${errorMsg}\n是否重新发送？`,
          confirmText: '重发',
          cancelText: '放弃',
          success: (res) => {
            if (res.confirm) {
              // 重新发送
              this.inputText = messageText
            } else {
              // 保存失败的消息
              this.failedMessages.set(tempMessageId, {
                id: tempMessageId,
                content: messageText,
                createdAt: Date.now(),
                status: 'failed',
                toDid: this.friendDid
              })

              // 将失败消息添加到列表显示
              this.messages.push(this.failedMessages.get(tempMessageId))
            }
          }
        })
      } finally {
        this.pendingMessage = ''
        this.sending = false
        this.scrollToBottom()
      }
    },

    /**
     * 重发消息
     */
    async resendMessage(message) {
      if (!message || message.status !== 'failed') {
        return
      }

      this.closeMessageOptions()

      // 移除失败的消息
      this.messages = this.messages.filter(m => m.id !== message.id)
      this.failedMessages.delete(message.id)

      // 重新发送
      this.inputText = message.content || message.decryptedContent
      await this.sendMessage()
    },

    /**
     * 显示消息操作菜单
     */
    showMessageOptions(message) {
      this.selectedMessage = message
    },

    /**
     * 关闭消息操作菜单
     */
    closeMessageOptions() {
      this.selectedMessage = null
    },

    /**
     * 复制消息
     */
    copyMessage() {
      if (!this.selectedMessage) {
        return
      }

      const content = this.selectedMessage.decryptedContent || this.selectedMessage.content

      uni.setClipboardData({
        data: content,
        success: () => {
          uni.showToast({
            title: '✓ 已复制',
            icon: 'none',
            duration: 1000
          })
          this.closeMessageOptions()
        },
        fail: () => {
          uni.showToast({
            title: '复制失败',
            icon: 'none'
          })
        }
      })
    },

    /**
     * 删除消息
     */
    async deleteMessage() {
      if (!this.selectedMessage) {
        return
      }

      const confirm = await new Promise((resolve) => {
        uni.showModal({
          title: '删除消息',
          content: '确定要删除这条消息吗？',
          confirmText: '删除',
          confirmColor: '#ff4d4f',
          success: (res) => {
            resolve(res.confirm)
          }
        })
      })

      if (!confirm) {
        this.closeMessageOptions()
        return
      }

      try {
        // TODO: 实现删除消息API
        // await messagingService.deleteMessage(this.selectedMessage.id)

        // 临时从列表中移除
        this.messages = this.messages.filter(m => m.id !== this.selectedMessage.id)

        uni.showToast({
          title: '✓ 已删除',
          icon: 'none',
          duration: 1000
        })

        this.closeMessageOptions()
      } catch (error) {
        console.error('删除消息失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none',
          duration: 2000
        })
      }
    },

    scrollToBottom() {
      if (this.messages.length > 0) {
        this.scrollToView = `msg-${this.messages.length - 1}`
      }
    },

    getConversationId(friendDid) {
      // 这里应该获取当前用户DID，简化处理
      return `conv_${friendDid}`
    },

    isMyMessage(message) {
      // 检查是否是自己发送的消息
      // 这里需要获取当前用户DID进行比较
      // 简化处理：根据toDid判断
      return message.toDid === this.friendDid
    },

    getMessageStatus(message) {
      switch (message.status) {
        case 'sending':
          return '发送中'
        case 'sent':
          return '已发送'
        case 'delivered':
          return '已送达'
        case 'read':
          return '已读'
        case 'failed':
          return '失败'
        default:
          return ''
      }
    },

    formatMessageTime(timestamp) {
      const date = new Date(timestamp)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    },

    formatDid(did) {
      if (!did || did.length <= 32) {
        return did
      }
      return `${did.substring(0, 20)}...${did.slice(-6)}`
    },

    goBack() {
      uni.navigateBack()
    },

    goToProfile() {
      uni.navigateTo({
        url: `/pages/social/friends/profile?did=${this.friendDid}`
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.conversation-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.header {
  background: var(--bg-card);
  border-bottom: 2rpx solid var(--border-color);
  padding: 32rpx 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .header-left,
  .header-right {
    width: 80rpx;
    height: 80rpx;
    display: flex;
    align-items: center;
    justify-content: center;

    .back-icon,
    .more-icon {
      font-size: 48rpx;
      color: var(--text-primary);
    }
  }

  .header-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4rpx;

    .friend-name {
      font-size: 32rpx;
      font-weight: bold;
      color: var(--text-primary);
    }

    .encryption-status {
      font-size: 20rpx;
      color: var(--text-tertiary);
    }
  }
}

.messages-container {
  flex: 1;
  padding: 24rpx;
}

.loading,
.empty,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 48rpx;

  .loading-icon,
  .empty-icon,
  .error-icon {
    font-size: 96rpx;
    margin-bottom: 24rpx;
    opacity: 0.5;
  }

  .loading-text,
  .empty-text,
  .error-text {
    font-size: 26rpx;
    color: var(--text-secondary);
    text-align: center;
    margin-bottom: 32rpx;
  }

  .retry-btn {
    background: var(--bg-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 48rpx;
    padding: 16rpx 48rpx;
    font-size: 28rpx;

    &::after {
      border: none;
    }

    &:active {
      opacity: 0.8;
    }
  }
}

.error-state {
  .error-icon {
    opacity: 0.7;
  }

  .error-text {
    color: var(--color-error);
  }
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.message-wrapper {
  display: flex;
  align-items: flex-start;

  &.is-mine {
    justify-content: flex-end;

    .message-bubble {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

      .message-content {
        color: white;
      }

      .message-meta {
        .message-time,
        .message-status,
        .retry-icon {
          color: rgba(255, 255, 255, 0.8);
        }
      }

      &.failed {
        background: var(--color-error);
        opacity: 0.7;
      }
    }
  }

  &.is-failed {
    opacity: 0.8;
  }

  .message-bubble {
    max-width: 500rpx;
    background: var(--bg-card);
    border-radius: 16rpx;
    padding: 20rpx 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
    position: relative;

    &.pending {
      opacity: 0.6;
    }

    &.failed {
      border: 2rpx solid var(--color-error);
    }

    .message-content {
      font-size: 28rpx;
      color: var(--text-primary);
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .message-meta {
      display: flex;
      align-items: center;
      gap: 12rpx;
      margin-top: 8rpx;

      .message-time {
        font-size: 20rpx;
        color: var(--text-tertiary);
      }

      .message-status {
        font-size: 20rpx;
        color: var(--text-tertiary);
      }

      .retry-icon {
        font-size: 28rpx;
        color: var(--color-error);
        margin-left: auto;
        cursor: pointer;
        padding: 0 8rpx;

        &:active {
          opacity: 0.6;
        }
      }
    }
  }
}

.input-area {
  background: var(--bg-card);
  border-top: 2rpx solid var(--border-color);
  padding: 24rpx;
  display: flex;
  gap: 16rpx;

  .message-input {
    flex: 1;
    height: 72rpx;
    background: var(--bg-secondary);
    border-radius: 36rpx;
    padding: 0 24rpx;
    font-size: 28rpx;
    color: var(--text-primary);
  }

  .send-btn {
    width: 120rpx;
    height: 72rpx;
    background: var(--bg-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 36rpx;
    font-size: 28rpx;
    font-weight: bold;
    padding: 0;

    &.btn-disabled {
      opacity: 0.5;
    }

    &::after {
      border: none;
    }
  }
}

.message-action-menu {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 1000;

  .menu-content {
    width: 100%;
    background: var(--bg-card);
    border-radius: 24rpx 24rpx 0 0;
    overflow: hidden;

    .menu-item {
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
        .menu-text {
          color: var(--color-error);
        }
      }

      &:last-child {
        border-bottom: none;
        border-top: 8rpx solid var(--bg-secondary);
      }

      .menu-icon {
        font-size: 32rpx;
      }

      .menu-text {
        font-size: 32rpx;
        color: var(--text-primary);
      }
    }
  }
}
</style>
