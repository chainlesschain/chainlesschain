<template>
  <view class="chat-container">
    <!-- 顶部标题栏 -->
    <view class="header">
      <view class="back-btn" @click="goBack">
        <text>‹</text>
      </view>
      <text class="title">{{ nickname }}</text>
      <view class="more-btn" @click="showMore">
        <text>⋯</text>
      </view>
    </view>

    <!-- 消息列表 -->
    <scroll-view
      class="messages-container"
      scroll-y
      :scroll-into-view="scrollToView"
      scroll-with-animation
    >
      <view class="message-item" v-for="(msg, index) in messages" :key="msg.id" :id="'msg-' + index">
        <view class="message" :class="msg.role === 'user' ? 'sent' : 'received'">
          <view class="avatar">
            <text>{{ msg.role === 'user' ? '👤' : '👥' }}</text>
          </view>
          <view class="content">
            <text class="text">{{ msg.content }}</text>
            <text class="time">{{ formatTime(msg.timestamp) }}</text>
          </view>
        </view>
      </view>

      <!-- 加载状态 -->
      <view class="message-item" v-if="sending" id="msg-sending">
        <view class="message sent">
          <view class="avatar">
            <text>👤</text>
          </view>
          <view class="content">
            <view class="typing">
              <text class="dot">●</text>
              <text class="dot">●</text>
              <text class="dot">●</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 空状态 -->
      <view class="empty" v-if="messages.length === 0 && !sending">
        <text class="empty-icon">💬</text>
        <text class="empty-text">开始与{{ nickname }}聊天吧</text>
        <text class="empty-hint">发送第一条消息</text>
      </view>
    </scroll-view>

    <!-- 输入框 -->
    <view class="input-container">
      <textarea
        class="input"
        v-model="inputText"
        placeholder="输入消息..."
        :maxlength="2000"
        :auto-height="true"
        :show-confirm-bar="false"
        @confirm="handleSend"
      />
      <button
        class="send-btn"
        :class="{ disabled: !canSend }"
        :disabled="!canSend"
        @click="handleSend"
      >
        <text>{{ sending ? '⏳' : '发送' }}</text>
      </button>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      friendDid: '',
      nickname: '',
      conversationId: '',
      messages: [],
      inputText: '',
      sending: false,
      scrollToView: ''
    }
  },
  computed: {
    canSend() {
      return this.inputText.trim() !== '' && !this.sending
    }
  },
  onLoad(options) {
    // 从URL参数获取好友信息
    this.friendDid = options.friendDid || ''
    this.nickname = decodeURIComponent(options.nickname || '好友')

    if (!this.friendDid) {
      uni.showToast({
        title: '参数错误',
        icon: 'none'
      })
      setTimeout(() => {
        uni.navigateBack()
      }, 1500)
      return
    }

    this.initConversation()
  },
  methods: {
    /**
     * 初始化对话
     */
    async initConversation() {
      try {
        // 获取或创建对话
        const conversation = await db.getOrCreateFriendConversation(this.friendDid, this.nickname)
        this.conversationId = conversation.id

        // 加载历史消息
        await this.loadMessages()
      } catch (error) {
        console.error('初始化对话失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    /**
     * 加载历史消息
     */
    async loadMessages() {
      try {
        const messages = await db.getMessages(this.conversationId, 100)
        this.messages = messages
        console.log('加载历史消息:', messages.length)

        // 滚动到底部
        this.$nextTick(() => {
          this.scrollToBottom()
        })
      } catch (error) {
        console.error('加载消息失败:', error)
      }
    },

    /**
     * 发送消息
     */
    async handleSend() {
      if (!this.canSend) {
        return
      }

      const content = this.inputText.trim()
      this.inputText = ''

      try {
        this.sending = true

        // 发送消息
        const message = await db.sendFriendMessage(this.friendDid, this.nickname, content)

        // 添加到界面
        this.messages.push(message)
        this.scrollToBottom()

        // 模拟好友回复（实际应该通过P2P网络接收）
        setTimeout(async () => {
          await this.simulateFriendReply(content)
        }, 1000 + Math.random() * 2000)
      } catch (error) {
        console.error('发送消息失败:', error)
        uni.showToast({
          title: '发送失败',
          icon: 'none'
        })
      } finally {
        this.sending = false
      }
    },

    /**
     * 模拟好友回复（开发阶段）
     * 实际应该通过P2P网络接收
     */
    async simulateFriendReply(userMessage) {
      // 一些简单的自动回复
      const replies = [
        '收到！',
        '好的',
        '明白了',
        '谢谢分享',
        '有意思',
        `你说"${userMessage.substring(0, 10)}..."是什么意思？`,
        '稍等，我看看',
        '哈哈'
      ]

      const reply = replies[Math.floor(Math.random() * replies.length)]

      try {
        const message = await db.receiveFriendMessage(this.friendDid, this.nickname, reply)

        // 添加到界面
        this.messages.push(message)
        this.scrollToBottom()

        // 显示通知
        uni.showToast({
          title: `${this.nickname}回复了`,
          icon: 'none',
          duration: 1500
        })
      } catch (error) {
        console.error('接收消息失败:', error)
      }
    },

    /**
     * 返回
     */
    goBack() {
      uni.navigateBack()
    },

    /**
     * 更多选项
     */
    showMore() {
      uni.showActionSheet({
        itemList: ['查看好友资料', '清空聊天记录', '删除好友'],
        success: (res) => {
          const index = res.tapIndex
          if (index === 0) {
            this.viewFriendProfile()
          } else if (index === 1) {
            this.clearMessages()
          } else if (index === 2) {
            this.deleteFriend()
          }
        }
      })
    },

    /**
     * 查看好友资料
     */
    viewFriendProfile() {
      uni.showModal({
        title: '好友资料',
        content: `昵称：${this.nickname}\nDID：${this.friendDid}`,
        showCancel: false
      })
    },

    /**
     * 清空聊天记录
     */
    clearMessages() {
      uni.showModal({
        title: '清空聊天记录',
        content: '确定要清空与此好友的所有聊天记录吗？',
        success: async (res) => {
          if (res.confirm) {
            // TODO: 实现清空消息功能
            uni.showToast({
              title: '功能开发中',
              icon: 'none'
            })
          }
        }
      })
    },

    /**
     * 删除好友
     */
    deleteFriend() {
      uni.showModal({
        title: '删除好友',
        content: '确定要删除此好友吗？聊天记录也将被删除。',
        confirmColor: 'var(--color-error)',
        success: async (res) => {
          if (res.confirm) {
            // TODO: 实现删除好友功能
            uni.showToast({
              title: '功能开发中',
              icon: 'none'
            })
          }
        }
      })
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${hour}:${minute}`
    },

    /**
     * 滚动到底部
     */
    scrollToBottom() {
      this.$nextTick(() => {
        const lastIndex = this.sending ? 'msg-sending' : `msg-${this.messages.length - 1}`
        this.scrollToView = lastIndex
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.chat-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-page);
}

.header {
  background-color: var(--bg-card);
  padding: 20rpx 24rpx;
  box-shadow: 0 2rpx 8rpx var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 10;

  .back-btn,
  .more-btn {
    width: 64rpx;
    height: 64rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 48rpx;
    color: var(--text-primary);
  }

  .back-btn {
    font-size: 56rpx;
  }

  .title {
    flex: 1;
    font-size: 32rpx;
    font-weight: 500;
    color: var(--text-primary);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.messages-container {
  flex: 1;
  padding: 24rpx;
  overflow-y: auto;
}

.empty {
  padding: 200rpx 40rpx;
  text-align: center;

  .empty-icon {
    display: block;
    font-size: 120rpx;
    margin-bottom: 20rpx;
  }

  .empty-text {
    display: block;
    font-size: 32rpx;
    color: var(--text-primary);
    margin-bottom: 16rpx;
  }

  .empty-hint {
    display: block;
    font-size: 24rpx;
    color: var(--text-tertiary);
  }
}

.message-item {
  margin-bottom: 24rpx;

  .message {
    display: flex;
    gap: 20rpx;

    .avatar {
      width: 72rpx;
      height: 72rpx;
      flex-shrink: 0;
      background-color: #e0e0e0;
      border-radius: 36rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40rpx;
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8rpx;

      .text {
        background-color: var(--bg-card);
        padding: 24rpx;
        border-radius: 16rpx;
        font-size: 28rpx;
        line-height: 1.6;
        color: var(--text-primary);
        word-wrap: break-word;
      }

      .time {
        font-size: 20rpx;
        color: var(--text-tertiary);
        padding: 0 12rpx;
      }

      .typing {
        background-color: var(--bg-card);
        padding: 24rpx;
        border-radius: 16rpx;
        display: flex;
        gap: 8rpx;

        .dot {
          width: 12rpx;
          height: 12rpx;
          background-color: var(--text-tertiary);
          border-radius: 50%;
          animation: typing 1.4s infinite;

          &:nth-child(2) {
            animation-delay: 0.2s;
          }

          &:nth-child(3) {
            animation-delay: 0.4s;
          }
        }
      }
    }

    // 发送的消息（右侧）
    &.sent {
      flex-direction: row-reverse;

      .avatar {
        background-color: var(--color-primary);
      }

      .content {
        align-items: flex-end;

        .text {
          background-color: var(--color-primary);
          color: var(--bg-card);
        }
      }
    }

    // 接收的消息（左侧）
    &.received {
      .avatar {
        background-color: #667eea;
      }
    }
  }
}

.input-container {
  background-color: var(--bg-card);
  padding: 20rpx 24rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -2rpx 8rpx var(--shadow-sm);
  display: flex;
  align-items: flex-end;
  gap: 20rpx;
  position: relative;
  z-index: 10;

  .input {
    flex: 1;
    min-height: 72rpx;
    max-height: 200rpx;
    padding: 20rpx 24rpx;
    background-color: var(--bg-input);
    border-radius: 36rpx;
    font-size: 28rpx;
    line-height: 1.4;
  }

  .send-btn {
    width: 120rpx;
    height: 72rpx;
    background-color: var(--color-primary);
    color: var(--bg-card);
    border-radius: 36rpx;
    font-size: 28rpx;
    font-weight: 500;
    border: none;
    flex-shrink: 0;

    &.disabled {
      opacity: 0.5;
    }
  }

  .send-btn::after {
    border: none;
  }
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
  }
  30% {
    transform: translateY(-10rpx);
  }
}
</style>
