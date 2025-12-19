<template>
  <view class="chat-container">
    <!-- 顶部操作栏 -->
    <view class="header">
      <text class="title">{{ conversationTitle }}</text>
      <view class="actions">
        <button class="action-btn" @click="handleNewConversation">
          <text>新对话</text>
        </button>
      </view>
    </view>

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

      <view class="empty" v-if="messages.length === 0 && !loading && !configWarning">
        <text class="empty-icon">💬</text>
        <text class="empty-text">开始与 AI 对话吧</text>
        <text class="empty-hint">输入消息并发送</text>
      </view>

      <view class="empty warning" v-if="configWarning">
        <text class="empty-icon">⚠️</text>
        <text class="empty-text">AI 服务未配置</text>
        <text class="empty-hint">{{ configWarning }}</text>
        <button class="config-btn" @click="goToSettings">
          <text>去设置</text>
        </button>
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
      conversationTitle: 'AI 助手',
      messages: [],
      inputText: '',
      loading: false,
      scrollToView: '',
      configWarning: ''
    }
  },
  computed: {
    canSend() {
      return this.inputText.trim() !== '' && !this.loading && !this.configWarning
    }
  },
  onLoad() {
    this.checkLLMConfig()
    this.initConversation()
  },
  onShow() {
    // 每次显示页面时重新检查配置（用户可能刚设置完）
    this.checkLLMConfig()
  },
  methods: {
    /**
     * 检查 LLM 配置
     */
    async checkLLMConfig() {
      try {
        const status = await llm.checkStatus()
        if (!status.available) {
          this.configWarning = status.message || '请先在设置页面配置 AI 服务'
        } else {
          this.configWarning = ''
        }
      } catch (error) {
        console.error('检查LLM配置失败:', error)
        this.configWarning = '检查配置状态失败'
      }
    },

    /**
     * 初始化对话
     */
    async initConversation() {
      try {
        // 尝试加载最近的对话
        const lastConversationId = uni.getStorageSync('last_conversation_id')

        if (lastConversationId) {
          // 加载历史对话
          await this.loadConversation(lastConversationId)
        } else {
          // 创建新对话
          await this.createNewConversation()
        }
      } catch (error) {
        console.error('初始化对话失败:', error)
        // 如果加载失败，创建新对话
        await this.createNewConversation()
      }
    },

    /**
     * 创建新对话
     */
    async createNewConversation() {
      try {
        const conversation = await db.createConversation('AI 对话', null)
        this.conversationId = conversation.id
        this.conversationTitle = conversation.title
        this.messages = []

        // 保存当前对话ID
        uni.setStorageSync('last_conversation_id', this.conversationId)

        console.log('新对话已创建:', this.conversationId)
      } catch (error) {
        console.error('创建对话失败:', error)
        uni.showToast({
          title: '创建对话失败',
          icon: 'none'
        })
      }
    },

    /**
     * 加载历史对话
     */
    async loadConversation(conversationId) {
      try {
        this.loading = true

        // 加载消息
        const messages = await db.getMessages(conversationId)
        this.messages = messages
        this.conversationId = conversationId

        // 设置标题
        this.conversationTitle = messages.length > 0 ? 'AI 对话' : '新对话'

        console.log('已加载历史消息:', messages.length)

        // 滚动到底部
        this.$nextTick(() => {
          this.scrollToBottom()
        })
      } catch (error) {
        console.error('加载对话失败:', error)
        throw error
      } finally {
        this.loading = false
      }
    },

    /**
     * 新建对话按钮
     */
    handleNewConversation() {
      uni.showModal({
        title: '新建对话',
        content: '确定要开始新的对话吗？当前对话将被保存。',
        success: async (res) => {
          if (res.confirm) {
            await this.createNewConversation()
            uni.showToast({
              title: '新对话已创建',
              icon: 'success'
            })
          }
        }
      })
    },

    /**
     * 跳转到设置页面
     */
    goToSettings() {
      uni.switchTab({
        url: '/pages/settings/settings'
      })
    },
    async handleSend() {
      if (!this.canSend) {
        return
      }

      // 检查配置
      if (this.configWarning) {
        uni.showModal({
          title: '提示',
          content: this.configWarning,
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              this.goToSettings()
            }
          }
        })
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

        // 准备消息历史（排除当前用户消息）
        const history = this.messages.slice(0, -1).map(msg => ({
          role: msg.role,
          content: msg.content
        }))

        // 调用 LLM
        const response = await llm.query(userMessage, history)

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

        // 详细的错误提示
        let errorMessage = '发送失败'
        if (error.message) {
          if (error.message.includes('API')) {
            errorMessage = 'API 调用失败，请检查配置'
          } else if (error.message.includes('请求失败')) {
            errorMessage = '网络请求失败，请检查网络连接'
          } else if (error.message.includes('timeout')) {
            errorMessage = '请求超时，请稍后重试'
          } else {
            errorMessage = error.message
          }
        }

        uni.showModal({
          title: '发送失败',
          content: errorMessage,
          showCancel: true,
          cancelText: '取消',
          confirmText: '重试',
          success: (res) => {
            if (res.confirm) {
              // 恢复输入框内容以便重试
              this.inputText = userMessage
            }
          }
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

.header {
  background-color: #ffffff;
  padding: 20rpx 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 10;

  .title {
    font-size: 32rpx;
    font-weight: 500;
    color: #333;
  }

  .actions {
    display: flex;
    gap: 16rpx;

    .action-btn {
      padding: 12rpx 24rpx;
      background-color: #667eea;
      color: #ffffff;
      border-radius: 36rpx;
      font-size: 24rpx;
      border: none;
      line-height: 1;
      height: auto;

      &::after {
        border: none;
      }
    }
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
    color: #333;
    margin-bottom: 16rpx;
  }

  .empty-hint {
    display: block;
    font-size: 24rpx;
    color: #999;
    margin-bottom: 32rpx;
  }

  .config-btn {
    margin: 0 auto;
    width: 200rpx;
    padding: 24rpx;
    background-color: #3cc51f;
    color: #ffffff;
    border-radius: 36rpx;
    font-size: 28rpx;
    border: none;

    &::after {
      border: none;
    }
  }

  &.warning {
    .empty-icon {
      color: #ff9800;
    }

    .empty-text {
      color: #ff9800;
    }
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
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -2rpx 8rpx rgba(0, 0, 0, 0.05);
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
