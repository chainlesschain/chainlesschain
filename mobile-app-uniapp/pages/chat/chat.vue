<template>
  <view class="chat-container">
    <scroll-view
      class="messages-container"
      scroll-y
      :scroll-into-view="scrollToView"
      scroll-with-animation
    >
      <view class="message-item" v-for="(msg, index) in messages" :key="msg.id" :id="'msg-' + index">
        <view class="message" :class="msg.role">
          <view class="avatar">
            <text>{{ msg.role === 'user' ? '👤' : '🤖' }}</text>
          </view>
          <view class="content">
            <text class="text">{{ msg.content }}</text>
            <text class="time">{{ formatTime(msg.timestamp) }}</text>
          </view>
        </view>
      </view>

      <view class="message-item" v-if="loading" id="msg-loading">
        <view class="message assistant">
          <view class="avatar">
            <text>🤖</text>
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

      <view class="empty" v-if="messages.length === 0 && !loading">
        <text class="empty-icon">💬</text>
        <text class="empty-text">开始与 AI 对话吧</text>
        <text class="empty-hint">输入消息并发送</text>
      </view>
    </scroll-view>

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
        <text>{{ loading ? '⏳' : '发送' }}</text>
      </button>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'
import { llm } from '@/services/llm'

export default {
  data() {
    return {
      conversationId: '',
      messages: [],
      inputText: '',
      loading: false,
      scrollToView: ''
    }
  },
  computed: {
    canSend() {
      return this.inputText.trim() !== '' && !this.loading
    }
  },
  onLoad() {
    this.initConversation()
  },
  methods: {
    async initConversation() {
      try {
        // 创建新对话
        const conversation = await db.createConversation('AI 对话', null)
        this.conversationId = conversation.id
        console.log('对话已创建:', this.conversationId)
      } catch (error) {
        console.error('创建对话失败:', error)
        uni.showToast({
          title: '初始化失败',
          icon: 'none'
        })
      }
    },
    async handleSend() {
      if (!this.canSend) {
        return
      }

      const userMessage = this.inputText.trim()
      this.inputText = ''

      try {
        // 添加用户消息到数据库
        const userMsg = await db.addMessage(
          this.conversationId,
          'user',
          userMessage
        )

        // 添加到界面
        this.messages.push(userMsg)
        this.scrollToBottom()

        // 显示加载状态
        this.loading = true

        // 准备消息历史
        const history = this.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))

        // 调用 LLM
        const response = await llm.query(userMessage, history.slice(0, -1))

        // 添加 AI 回复到数据库
        const assistantMsg = await db.addMessage(
          this.conversationId,
          'assistant',
          response.content,
          response.tokens || 0
        )

        // 添加到界面
        this.messages.push(assistantMsg)
        this.scrollToBottom()
      } catch (error) {
        console.error('发送消息失败:', error)
        uni.showToast({
          title: error.message || '发送失败',
          icon: 'none',
          duration: 2000
        })
      } finally {
        this.loading = false
      }
    },
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${hour}:${minute}`
    },
    scrollToBottom() {
      this.$nextTick(() => {
        const lastIndex = this.loading ? 'msg-loading' : `msg-${this.messages.length - 1}`
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
  background-color: #f8f8f8;
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
    color: #333;
    margin-bottom: 16rpx;
  }

  .empty-hint {
    display: block;
    font-size: 24rpx;
    color: #999;
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
        background-color: #ffffff;
        padding: 24rpx;
        border-radius: 16rpx;
        font-size: 28rpx;
        line-height: 1.6;
        color: #333;
        word-wrap: break-word;
      }

      .time {
        font-size: 20rpx;
        color: #999;
        padding: 0 12rpx;
      }

      .typing {
        background-color: #ffffff;
        padding: 24rpx;
        border-radius: 16rpx;
        display: flex;
        gap: 8rpx;

        .dot {
          width: 12rpx;
          height: 12rpx;
          background-color: #999;
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

    &.user {
      flex-direction: row-reverse;

      .avatar {
        background-color: #3cc51f;
      }

      .content {
        align-items: flex-end;

        .text {
          background-color: #3cc51f;
          color: #ffffff;
        }
      }
    }

    &.assistant {
      .avatar {
        background-color: #667eea;
      }
    }
  }
}

.input-container {
  background-color: #ffffff;
  padding: 20rpx 24rpx;
  box-shadow: 0 -2rpx 8rpx rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: flex-end;
  gap: 20rpx;

  .input {
    flex: 1;
    min-height: 72rpx;
    max-height: 200rpx;
    padding: 20rpx 24rpx;
    background-color: #f5f5f5;
    border-radius: 36rpx;
    font-size: 28rpx;
    line-height: 1.4;
  }

  .send-btn {
    width: 120rpx;
    height: 72rpx;
    background-color: #3cc51f;
    color: #ffffff;
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
