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
    >
      <view v-if="loading" class="loading">
        <text>加载中...</text>
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
          :class="{ 'is-mine': isMyMessage(message) }"
        >
          <view class="message-bubble">
            <text class="message-content">{{ message.decryptedContent || message.content }}</text>
            <view class="message-meta">
              <text class="message-time">{{ formatMessageTime(message.createdAt) }}</text>
              <text class="message-status" v-if="isMyMessage(message)">
                {{ getMessageStatus(message) }}
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
      sending: false,
      pendingMessage: '',
      scrollToView: '',
      messageListener: null
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
      try {
        this.messages = await messagingService.getMessages(this.conversationId)

        // 滚动到底部
        this.$nextTick(() => {
          this.scrollToBottom()
        })
      } catch (error) {
        console.error('加载消息失败:', error)
      } finally {
        this.loading = false
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

      try {
        await messagingService.sendMessage(this.friendDid, {
          type: 'text',
          content: messageText
        })

        // 刷新消息列表
        await this.loadMessages()
      } catch (error) {
        console.error('发送消息失败:', error)

        let errorMsg = '发送失败'
        if (error.message) {
          errorMsg = error.message
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })

        // 恢复输入内容
        this.inputText = messageText
      } finally {
        this.pendingMessage = ''
        this.sending = false
        this.scrollToBottom()
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
    font-size: 26rpx;
    color: var(--text-secondary);
    text-align: center;
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
        .message-status {
          color: rgba(255, 255, 255, 0.8);
        }
      }
    }
  }

  .message-bubble {
    max-width: 500rpx;
    background: var(--bg-card);
    border-radius: 16rpx;
    padding: 20rpx 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

    &.pending {
      opacity: 0.6;
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
</style>
