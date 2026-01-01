<template>
  <view class="chat-container">
    <!-- 顶部操作栏 -->
    <view class="header">
      <view class="header-left" @click="showConversationList">
        <text class="back-icon">☰</text>
        <text class="title">{{ conversationTitle }}</text>
      </view>
      <view class="actions">
        <button class="action-btn" @click="showKnowledgeSelector">
          <text>📚</text>
        </button>
        <button class="action-btn" @click="handleNewConversation">
          <text>+</text>
        </button>
        <button class="action-btn" @click="showConversationActions">
          <text>⋯</text>
        </button>
      </view>
    </view>

    <!-- 知识库引用提示 -->
    <view class="knowledge-ref" v-if="selectedKnowledge">
      <view class="ref-content">
        <text class="ref-icon">📚</text>
        <text class="ref-text">{{ selectedKnowledge.title }}</text>
      </view>
      <text class="ref-close" @click="clearKnowledgeRef">×</text>
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
            <text class="text" @longpress="showMessageActions(msg)">{{ msg.content }}</text>
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
              <text class="dot"></text>
              <text class="dot"></text>
              <text class="dot"></text>
            </view>
          </view>
        </view>
      </view>

      <view class="empty" v-if="messages.length === 0 && !loading && !configWarning">
        <text class="empty-icon">💬</text>
        <text class="empty-text">开始与 AI 对话吧</text>
        <text class="empty-hint">试试问我任何问题</text>
        <view class="suggestions">
          <view class="suggestion-item" @click="useSuggestion('帮我总结一下知识库的内容')">
            <text>📚 总结知识库</text>
          </view>
          <view class="suggestion-item" @click="useSuggestion('帮我生成学习计划')">
            <text>📝 生成计划</text>
          </view>
          <view class="suggestion-item" @click="useSuggestion('给我一些学习建议')">
            <text>💡 学习建议</text>
          </view>
        </view>
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

    <!-- 会话列表弹窗 -->
    <view class="modal" v-if="showConversations" @click="showConversations = false">
      <view class="modal-content conversations-modal" @click.stop>
        <text class="modal-title">对话历史</text>

        <view class="conversation-list">
          <view
            class="conversation-item"
            v-for="conv in conversations"
            :key="conv.id"
            @click="switchConversation(conv.id)"
          >
            <view class="conv-info">
              <text class="conv-title">{{ conv.title }}</text>
              <text class="conv-time">{{ formatDate(conv.updated_at) }}</text>
            </view>
            <text class="conv-arrow">›</text>
          </view>

          <view class="empty-conversations" v-if="conversations.length === 0">
            <text>暂无对话历史</text>
          </view>
        </view>

        <button class="modal-btn" @click="showConversations = false">
          <text>关闭</text>
        </button>
      </view>
    </view>

    <!-- 知识库选择弹窗 -->
    <view class="modal" v-if="showKnowledgeModal" @click="showKnowledgeModal = false">
      <view class="modal-content knowledge-modal" @click.stop>
        <text class="modal-title">选择知识库</text>

        <view class="knowledge-list">
          <view
            class="knowledge-item"
            v-for="item in knowledgeItems"
            :key="item.id"
            @click="selectKnowledge(item)"
          >
            <text class="knowledge-icon">{{ getTypeIcon(item.type) }}</text>
            <view class="knowledge-info">
              <text class="knowledge-title">{{ item.title }}</text>
              <text class="knowledge-preview">{{ item.content.substring(0, 50) }}...</text>
            </view>
          </view>

          <view class="empty-knowledge" v-if="knowledgeItems.length === 0">
            <text>暂无知识条目</text>
          </view>
        </view>

        <button class="modal-btn" @click="showKnowledgeModal = false">
          <text>取消</text>
        </button>
      </view>
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
      configWarning: '',
      showConversations: false,
      conversations: [],
      showKnowledgeModal: false,
      knowledgeItems: [],
      selectedKnowledge: null
    }
  },
  computed: {
    canSend() {
      return this.inputText.trim() !== '' && !this.loading && !this.configWarning
    }
  },
  onLoad(options) {
    // 如果有传入conversationId，加载指定对话
    if (options.conversationId) {
      this.conversationId = options.conversationId
      this.loadConversation(options.conversationId)
    } else {
      this.initConversation()
    }

    this.checkLLMConfig()
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
        this.selectedKnowledge = null

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

        // 加载对话信息
        const conversation = await db.getConversation(conversationId)
        if (conversation) {
          this.conversationTitle = conversation.title
        }

        // 加载消息
        const messages = await db.getMessages(conversationId)
        this.messages = messages
        this.conversationId = conversationId

        // 保存当前对话ID
        uni.setStorageSync('last_conversation_id', conversationId)

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
     * 显示会话列表
     */
    async showConversationList() {
      try {
        this.conversations = await db.getConversations(20)
        this.showConversations = true
      } catch (error) {
        console.error('加载会话列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    /**
     * 切换对话
     */
    async switchConversation(conversationId) {
      this.showConversations = false
      if (conversationId !== this.conversationId) {
        await this.loadConversation(conversationId)
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
     * 显示对话操作菜单
     */
    showConversationActions() {
      const items = ['重命名', '删除对话', '取消']
      uni.showActionSheet({
        itemList: items,
        success: async (res) => {
          if (res.tapIndex === 0) {
            // 重命名
            this.renameConversation()
          } else if (res.tapIndex === 1) {
            // 删除
            this.confirmDeleteConversation()
          }
        }
      })
    },

    /**
     * 重命名对话
     */
    renameConversation() {
      uni.showModal({
        title: '重命名对话',
        editable: true,
        placeholderText: this.conversationTitle,
        success: async (res) => {
          if (res.confirm && res.content) {
            try {
              await db.updateConversationTitle(this.conversationId, res.content)
              this.conversationTitle = res.content
              uni.showToast({
                title: '重命名成功',
                icon: 'success'
              })
            } catch (error) {
              console.error('重命名失败:', error)
              uni.showToast({
                title: '重命名失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    /**
     * 确认删除对话
     */
    confirmDeleteConversation() {
      uni.showModal({
        title: '删除对话',
        content: '确定要删除这个对话吗？所有消息将被永久删除。',
        confirmText: '删除',
        confirmColor: '#f5222d',
        success: async (res) => {
          if (res.confirm) {
            await this.deleteConversation()
          }
        }
      })
    },

    /**
     * 删除对话
     */
    async deleteConversation() {
      try {
        await db.deleteConversation(this.conversationId)

        uni.showToast({
          title: '已删除',
          icon: 'success'
        })

        // 创建新对话
        await this.createNewConversation()
      } catch (error) {
        console.error('删除对话失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none'
        })
      }
    },

    /**
     * 显示知识库选择器
     */
    async showKnowledgeSelector() {
      try {
        this.knowledgeItems = await db.getKnowledgeItems({ limit: 50 })
        this.showKnowledgeModal = true
      } catch (error) {
        console.error('加载知识库失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    /**
     * 选择知识库
     */
    selectKnowledge(item) {
      this.selectedKnowledge = item
      this.showKnowledgeModal = false

      // 自动填充提示语
      this.inputText = `请根据以下知识回答：\n\n知识标题：${item.title}\n\n`

      uni.showToast({
        title: '已选择知识',
        icon: 'success'
      })
    },

    /**
     * 清除知识库引用
     */
    clearKnowledgeRef() {
      this.selectedKnowledge = null
    },

    /**
     * 使用建议问题
     */
    useSuggestion(text) {
      this.inputText = text
      this.handleSend()
    },

    /**
     * 显示消息操作菜单
     */
    showMessageActions(msg) {
      const items = ['复制', '取消']
      uni.showActionSheet({
        itemList: items,
        success: (res) => {
          if (res.tapIndex === 0) {
            // 复制
            uni.setClipboardData({
              data: msg.content,
              success: () => {
                uni.showToast({
                  title: '已复制',
                  icon: 'success'
                })
              }
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
        url: '/pages/mine/mine'
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
        // 如果有选择知识库，将知识内容附加到消息中
        let messageWithContext = userMessage
        if (this.selectedKnowledge) {
          messageWithContext = `[知识库引用: ${this.selectedKnowledge.title}]\n\n${this.selectedKnowledge.content}\n\n---\n\n${userMessage}`
        }

        // 添加用户消息到数据库
        const userMsg = await db.addMessage(
          this.conversationId,
          'user',
          userMessage  // 显示时只显示用户输入的内容
        )

        // 添加到界面
        this.messages.push(userMsg)
        this.scrollToBottom()

        // 显示加载状态
        this.loading = true

        // 准备消息历史（智能截取上下文）
        const allHistory = this.messages.slice(0, -1).map(msg => ({
          role: msg.role,
          content: msg.content
        }))

        // 智能截取上下文：保留最近的对话，避免超出token限制
        const history = this.getOptimalHistory(allHistory, 4000)

        // 调用 LLM（发送包含知识库上下文的消息）
        const response = await llm.query(messageWithContext, history)

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

        // 更新对话时间
        await db.updateConversationTime(this.conversationId)

        // 清除知识库引用
        this.selectedKnowledge = null
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

    /**
     * 智能截取对话历史，控制上下文长度
     * @param {Array} history - 完整的对话历史
     * @param {number} maxChars - 最大字符数
     * @returns {Array} 截取后的历史
     */
    getOptimalHistory(history, maxChars = 4000) {
      if (history.length === 0) {
        return []
      }

      // 总是保留最近的消息
      const result = []
      let totalChars = 0

      // 从最近的消息开始向前遍历
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i]
        const msgLength = msg.content.length

        // 如果添加这条消息会超出限制，就停止
        if (totalChars + msgLength > maxChars && result.length > 0) {
          break
        }

        result.unshift(msg)
        totalChars += msgLength

        // 至少保留最近10轮对话
        if (result.length >= 20) {
          break
        }
      }

      return result
    },

    getTypeIcon(type) {
      const icons = {
        'note': '📝',
        'document': '📄',
        'conversation': '💬',
        'web_clip': '🔖'
      }
      return icons[type] || '📝'
    },

    formatTime(timestamp) {
      const date = new Date(timestamp)
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${hour}:${minute}`
    },

    formatDate(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 86400000) {
        // 小于24小时，显示时间
        return this.formatTime(timestamp)
      } else if (diff < 604800000) {
        // 小于7天，显示星期
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        return days[date.getDay()]
      } else {
        // 显示日期
        return `${date.getMonth() + 1}/${date.getDate()}`
      }
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

  .header-left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 16rpx;

    .back-icon {
      font-size: 32rpx;
      color: var(--text-secondary);
    }

    .title {
      font-size: 32rpx;
      font-weight: 500;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .actions {
    display: flex;
    gap: 12rpx;

    .action-btn {
      width: 64rpx;
      height: 64rpx;
      padding: 0;
      background-color: var(--color-brand);
      color: var(--text-inverse);
      border-radius: 32rpx;
      font-size: 28rpx;
      border: none;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;

      &::after {
        border: none;
      }

      &:active {
        opacity: 0.8;
      }
    }
  }
}

// 知识库引用
.knowledge-ref {
  background: var(--gradient-brand);
  padding: 16rpx 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .ref-content {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12rpx;

    .ref-icon {
      font-size: 28rpx;
    }

    .ref-text {
      flex: 1;
      font-size: 24rpx;
      color: var(--text-inverse);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .ref-close {
    font-size: 48rpx;
    color: var(--text-inverse);
    font-weight: 300;
    line-height: 1;
  }
}

.messages-container {
  flex: 1;
  padding: 24rpx;
  overflow-y: auto;
}

.empty {
  padding: 120rpx 40rpx;
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
    margin-bottom: 48rpx;
  }

  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 16rpx;
    max-width: 600rpx;
    margin: 0 auto;

    .suggestion-item {
      padding: 24rpx 32rpx;
      background-color: var(--bg-card);
      border-radius: 16rpx;
      font-size: 26rpx;
      color: var(--text-primary);
      box-shadow: var(--shadow-sm);

      &:active {
        background-color: var(--bg-hover);
      }
    }
  }

  .config-btn {
    margin: 0 auto;
    width: 200rpx;
    padding: 24rpx;
    background-color: var(--color-primary);
    color: var(--bg-card);
    border-radius: 36rpx;
    font-size: 28rpx;
    border: none;

    &::after {
      border: none;
    }
  }

  &.warning {
    .empty-icon {
      color: var(--color-warning);
    }

    .empty-text {
      color: var(--color-warning);
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
      background-color: var(--border-normal);
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
      max-width: 520rpx;

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

    &.user {
      flex-direction: row-reverse;

      .avatar {
        background-color: var(--color-primary);
      }

      .content {
        align-items: flex-end;

        .text {
          background: var(--gradient-brand);
          color: var(--text-inverse);
        }
      }
    }

    &.assistant {
      .avatar {
        background-color: var(--color-brand);
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
    color: var(--text-primary);
  }

  .send-btn {
    width: 120rpx;
    height: 72rpx;
    background: var(--gradient-brand);
    color: var(--text-inverse);
    border-radius: 36rpx;
    font-size: 28rpx;
    font-weight: 500;
    border: none;
    flex-shrink: 0;

    &.disabled {
      opacity: 0.5;
    }

    &::after {
      border: none;
    }
  }
}

// 弹窗样式
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  .modal-content {
    width: 680rpx;
    max-height: 80vh;
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 40rpx;
    overflow-y: auto;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .modal-btn {
      width: 100%;
      height: 88rpx;
      background-color: var(--color-primary);
      color: var(--text-inverse);
      border-radius: 44rpx;
      font-size: 30rpx;
      font-weight: 500;
      border: none;
      margin-top: 24rpx;

      &::after {
        border: none;
      }
    }
  }

  .conversations-modal {
    .conversation-list {
      max-height: 60vh;
      overflow-y: auto;

      .conversation-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 24rpx;
        background-color: var(--bg-input);
        border-radius: 12rpx;
        margin-bottom: 16rpx;

        &:active {
          background-color: var(--bg-hover);
        }

        .conv-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8rpx;

          .conv-title {
            font-size: 28rpx;
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .conv-time {
            font-size: 22rpx;
            color: var(--text-tertiary);
          }
        }

        .conv-arrow {
          font-size: 40rpx;
          color: var(--text-tertiary);
          font-weight: 300;
        }
      }

      .empty-conversations {
        padding: 80rpx 40rpx;
        text-align: center;
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }
  }

  .knowledge-modal {
    .knowledge-list {
      max-height: 60vh;
      overflow-y: auto;

      .knowledge-item {
        display: flex;
        align-items: center;
        gap: 20rpx;
        padding: 24rpx;
        background-color: var(--bg-input);
        border-radius: 12rpx;
        margin-bottom: 16rpx;

        &:active {
          background-color: var(--bg-hover);
        }

        .knowledge-icon {
          width: 64rpx;
          height: 64rpx;
          background-color: var(--bg-card);
          border-radius: 12rpx;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 36rpx;
          flex-shrink: 0;
        }

        .knowledge-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8rpx;
          overflow: hidden;

          .knowledge-title {
            font-size: 28rpx;
            color: var(--text-primary);
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .knowledge-preview {
            font-size: 22rpx;
            color: var(--text-tertiary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }
      }

      .empty-knowledge {
        padding: 80rpx 40rpx;
        text-align: center;
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }
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
