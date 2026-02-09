<template>
  <view class="conversation-container">
    <!-- 头部 -->
    <view class="header">
      <view class="header-content">
        <view class="back-btn" @click="goBack">
          <text class="icon">‹</text>
        </view>
        <view class="header-info">
          <text class="title">{{ conversation?.title || '对话' }}</text>
          <text class="subtitle">{{ formatModel(conversation?.model) }}</text>
        </view>
        <view class="header-actions">
          <view class="icon-btn" @click="showMenu = true">
            <text class="icon">⋯</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 消息列表 -->
    <scroll-view
      class="messages"
      scroll-y
      :scroll-into-view="scrollToView"
      :scroll-with-animation="true"
    >
      <Skeleton v-if="loading" type="chat" :rows="5" :animate="true" />

      <view v-else-if="messages.length === 0" class="empty">
        <text class="empty-icon">👋</text>
        <text class="empty-text">开始你的对话吧</text>
        <text class="empty-hint">输入你的问题或想法...</text>
      </view>

      <view v-else class="message-list">
        <!-- 使用 MessageBubble 组件渲染消息 -->
        <MessageBubble
          v-for="(msg, index) in messages"
          :key="msg.id"
          :id="'msg-' + index"
          :message="msg"
          :is-mine="msg.role === 'user'"
          @longpress="showMessageMenu(msg)"
        />

        <!-- AI正在输入指示器 -->
        <view v-if="aiTyping" class="message-wrapper" id="typing-indicator">
          <view class="message-bubble typing">
            <view class="typing-dots">
              <view class="dot"></view>
              <view class="dot"></view>
              <view class="dot"></view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 输入区域 -->
    <view class="input-area">
      <!-- 快捷操作 -->
      <view class="quick-actions" v-if="showQuickActions">
        <view class="action-item" @click="toggleKnowledgeBase">
          <text class="action-icon">📚</text>
          <text class="action-text">{{ useKnowledge ? '关闭知识库' : '知识库' }}</text>
        </view>
        <view class="action-item" @click="showPrompts">
          <text class="action-icon">💡</text>
          <text class="action-text">提示词</text>
        </view>
      </view>

      <!-- 输入框 -->
      <view class="input-container">
        <view class="input-wrapper">
          <textarea
            class="message-input"
            v-model="inputMessage"
            placeholder="输入消息..."
            :auto-height="true"
            :maxlength="2000"
            :disabled="sending"
            @focus="showQuickActions = false"
            @blur="handleInputBlur"
          />
          <view class="input-actions">
            <view class="action-btn" @click="toggleQuickActions">
              <text class="action-icon">➕</text>
            </view>
            <view
              class="send-btn"
              :class="{ disabled: !canSend }"
              @click="sendMessage"
            >
              <text class="send-icon">{{ sending ? '⏳' : '📤' }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 菜单 -->
    <view v-if="showMenu" class="modal-overlay" @click="showMenu = false">
      <view class="action-menu" @click.stop>
        <view class="menu-item" @click="regenerateTitle">
          <text class="menu-icon">✨</text>
          <text class="menu-text">生成标题</text>
        </view>
        <view class="menu-item" @click="exportChat">
          <text class="menu-icon">📤</text>
          <text class="menu-text">导出对话</text>
        </view>
        <view class="menu-item" @click="toggleKnowledgeBase">
          <text class="menu-icon">{{ useKnowledge ? '✅' : '☑️' }}</text>
          <text class="menu-text">使用知识库</text>
        </view>
        <view class="menu-item" @click="clearChat">
          <text class="menu-icon">🗑️</text>
          <text class="menu-text">清空消息</text>
        </view>
        <view class="menu-item" @click="showMenu = false">
          <text class="menu-text">取消</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import aiConversationService from '@/services/ai-conversation'
import MessageBubble from '../components/MessageBubble.vue'
import Skeleton from '@/components/Skeleton.vue'
import { debounce, performanceMonitor } from '@utils/performance'

export default {
  components: {
    MessageBubble,
    Skeleton
  },
  data() {
    return {
      conversationId: '',
      conversation: null,
      messages: [],
      inputMessage: '',
      loading: false,
      sending: false,
      aiTyping: false,
      showMenu: false,
      showQuickActions: false,
      useKnowledge: false,
      scrollToView: ''
    }
  },

  computed: {
    canSend() {
      return this.inputMessage.trim().length > 0 && !this.sending
    }
  },

  async onLoad(options) {
    // 性能监控: 标记对话加载开始
    performanceMonitor.mark('conversation-load-start')

    if (options.id) {
      this.conversationId = options.id
      await this.loadConversation()
      await this.loadMessages()
    }

    // 性能监控: 测量对话加载时间
    performanceMonitor.measure('conversation-load-duration', 'conversation-load-start')
  },

  methods: {
    async loadConversation() {
      try {
        this.conversation = await aiConversationService.getConversations()
          .then(convs => convs.find(c => c.id === this.conversationId))

        if (!this.conversation) {
          uni.showToast({
            title: '对话不存在',
            icon: 'none'
          })
          setTimeout(() => {
            uni.navigateBack()
          }, 1500)
        }
      } catch (error) {
        console.error('加载对话失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    async loadMessages() {
      try {
        this.loading = true
        this.messages = await aiConversationService.getConversationHistory(
          this.conversationId
        )
        this.scrollToBottom()
      } catch (error) {
        console.error('加载消息失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    async sendMessage() {
      if (!this.canSend) return

      // 性能监控: 标记消息发送开始
      performanceMonitor.mark('message-send-start')

      const message = this.inputMessage.trim()
      this.inputMessage = ''
      this.sending = true
      this.aiTyping = true

      try {
        // 添加用户消息到界面（临时）
        const tempUserMsg = {
          id: `temp_user_${Date.now()}`,
          role: 'user',
          content: message,
          createdAt: new Date().toISOString()
        }
        this.messages.push(tempUserMsg)
        this.scrollToBottom()

        // 添加AI消息占位符
        const tempAIMsg = {
          id: `temp_ai_${Date.now()}`,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString()
        }
        this.messages.push(tempAIMsg)
        this.scrollToBottom()

        // 选择发送方法（RAG增强 or 普通）
        const sendMethod = this.useKnowledge
          ? aiConversationService.sendMessageWithRAG
          : aiConversationService.sendMessageStream

        // 流式发送消息
        await sendMethod.call(
          aiConversationService,
          this.conversationId,
          message,
          (chunk) => {
            // 实时更新AI消息内容
            tempAIMsg.content += chunk
            this.$forceUpdate()  // 强制更新视图
            this.scrollToBottom()
          }
        )

        // 完成后重新加载消息（从数据库获取持久化数据）
        await this.loadMessages()

        // 自动生成标题（如果是第一条消息）
        if (this.messages.length === 2 && this.conversation.title === '新对话') {
          await this.autoGenerateTitle()
        }
      } catch (error) {
        console.error('发送消息失败:', error)
        uni.showToast({
          title: '发送失败: ' + error.message,
          icon: 'none'
        })

        // 移除临时消息
        this.messages = this.messages.filter(
          m => !m.id.startsWith('temp_')
        )
      } finally {
        this.sending = false
        this.aiTyping = false
      }
    },

    async autoGenerateTitle() {
      try {
        const title = await aiConversationService.generateConversationTitle(
          this.conversationId
        )
        await aiConversationService.updateConversationTitle(
          this.conversationId,
          title
        )
        await this.loadConversation()
      } catch (error) {
        console.error('生成标题失败:', error)
      }
    },

    async regenerateTitle() {
      this.showMenu = false

      try {
        uni.showLoading({ title: '生成中...' })
        const title = await aiConversationService.generateConversationTitle(
          this.conversationId
        )
        await aiConversationService.updateConversationTitle(
          this.conversationId,
          title
        )
        await this.loadConversation()
        uni.hideLoading()
        uni.showToast({
          title: '标题已更新',
          icon: 'success'
        })
      } catch (error) {
        uni.hideLoading()
        uni.showToast({
          title: '生成失败',
          icon: 'none'
        })
      }
    },

    async exportChat() {
      this.showMenu = false

      uni.showActionSheet({
        itemList: ['导出为 Markdown', '导出为 JSON', '导出为 TXT'],
        success: async (res) => {
          const formats = ['markdown', 'json', 'txt']
          const format = formats[res.tapIndex]

          try {
            const content = await aiConversationService.exportConversation(
              this.conversationId,
              format
            )

            // 保存文件
            await this.saveExportedFile(content, format)

            uni.showToast({
              title: '导出成功',
              icon: 'success'
            })
          } catch (error) {
            console.error('导出失败:', error)
            uni.showToast({
              title: '导出失败',
              icon: 'none'
            })
          }
        }
      })
    },

    toggleKnowledgeBase() {
      this.useKnowledge = !this.useKnowledge
      this.showMenu = false
      this.showQuickActions = false

      uni.showToast({
        title: this.useKnowledge ? '已启用知识库' : '已关闭知识库',
        icon: 'none'
      })
    },

    async clearChat() {
      this.showMenu = false

      uni.showModal({
        title: '清空消息',
        content: '确定要清空所有消息吗？',
        success: async (res) => {
          if (res.confirm) {
            try {
              await aiConversationService.clearConversationMessages(
                this.conversationId
              )
              await this.loadMessages()
              uni.showToast({
                title: '已清空',
                icon: 'success'
              })
            } catch (error) {
              uni.showToast({
                title: '清空失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    showMessageMenu(msg) {
      uni.showActionSheet({
        itemList: ['复制消息', '删除消息'],
        success: (res) => {
          if (res.tapIndex === 0) {
            // 复制消息
            uni.setClipboardData({
              data: msg.content,
              success: () => {
                uni.showToast({ title: '已复制', icon: 'success' })
              }
            })
          } else if (res.tapIndex === 1) {
            // 删除消息
            uni.showModal({
              title: '删除消息',
              content: '确定要删除这条消息吗？',
              success: async (modalRes) => {
                if (modalRes.confirm) {
                  // TODO: 实现单条消息删除功能
                  uni.showToast({
                    title: '功能开发中',
                    icon: 'none'
                  })
                }
              }
            })
          }
        }
      })
    },

    toggleQuickActions() {
      this.showQuickActions = !this.showQuickActions
    },

    showPrompts() {
      // TODO: 显示提示词模板
      this.showQuickActions = false
      uni.showToast({
        title: '功能开发中',
        icon: 'none'
      })
    },

    handleInputBlur() {
      setTimeout(() => {
        // this.showQuickActions = false
      }, 200)
    },

    scrollToBottom() {
      this.$nextTick(() => {
        const index = this.messages.length - 1
        if (index >= 0) {
          this.scrollToView = 'msg-' + index
        } else if (this.aiTyping) {
          this.scrollToView = 'typing-indicator'
        }
      })
    },

    goBack() {
      uni.navigateBack()
    },

    formatModel(model) {
      if (!model) return ''
      if (model.includes('gpt-4')) return 'GPT-4'
      if (model.includes('gpt-3.5')) return 'GPT-3.5'
      if (model.includes('deepseek')) return 'DeepSeek'
      if (model.includes('qwen')) return '通义千问'
      if (model.includes('doubao')) return '豆包'
      return model
    },

    /**
     * 保存导出的文件
     */
    async saveExportedFile(content, format) {
      const extensions = { markdown: 'md', json: 'json', txt: 'txt' }
      const ext = extensions[format] || 'txt'
      const fileName = `chat_export_${Date.now()}.${ext}`

      // #ifdef APP-PLUS
      try {
        const basePath = plus.io.convertLocalFileSystemURL('_downloads/')
        const filePath = basePath + fileName

        await new Promise((resolve, reject) => {
          plus.io.resolveLocalFileSystemURL(basePath, (entry) => {
            entry.getFile(fileName, { create: true }, (fileEntry) => {
              fileEntry.createWriter((writer) => {
                writer.onwrite = resolve
                writer.onerror = reject
                writer.write(content)
              }, reject)
            }, reject)
          }, reject)
        })

        uni.showModal({
          title: '导出成功',
          content: `文件已保存：${fileName}`,
          confirmText: '打开',
          success: (res) => {
            if (res.confirm) plus.runtime.openFile(filePath)
          }
        })
      } catch (e) {
        uni.setClipboardData({ data: content })
      }
      // #endif

      // #ifdef H5
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      // #endif

      // #ifdef MP-WEIXIN
      const fs = uni.getFileSystemManager()
      fs.writeFileSync(`${wx.env.USER_DATA_PATH}/${fileName}`, content, 'utf8')
      // #endif
    }
  }
}
</script>

<style scoped>
.conversation-container {
  height: 100vh;
  background: #f5f5f5;
  display: flex;
  flex-direction: column;
}

.header {
  background: white;
  border-bottom: 1px solid #e0e0e0;
  padding: 12px 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.header-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.back-btn .icon {
  font-size: 24px;
  font-weight: bold;
  color: #333;
}

.header-info {
  flex: 1;
  min-width: 0;
}

.title {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtitle {
  display: block;
  font-size: 12px;
  color: #999;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.icon-btn .icon {
  font-size: 20px;
}

.messages {
  flex: 1;
  padding: 16px;
}

.loading,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 40px;
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  color: #333;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  color: #999;
}

.message-list {
  display: flex;
  flex-direction: column;
}

/* AI正在输入 */
.message-wrapper {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 16px;
}

.message-bubble.typing {
  padding: 16px 20px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.typing-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #999;
  animation: typing 1.4s infinite;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-6px);
  }
}

/* 输入区域 */
.input-area {
  background: white;
  border-top: 1px solid #e0e0e0;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
}

.quick-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  overflow-x: auto;
}

.action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  background: #f5f5f5;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.action-item:active {
  background: #e0e0e0;
}

.action-icon {
  font-size: 20px;
}

.action-text {
  font-size: 12px;
  color: #666;
}

.input-container {
  display: flex;
  gap: 12px;
}

.input-wrapper {
  flex: 1;
  background: #f5f5f5;
  border-radius: 20px;
  padding: 8px 12px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.message-input {
  flex: 1;
  max-height: 120px;
  font-size: 15px;
  line-height: 1.5;
  resize: none;
  border: none;
  background: transparent;
}

.input-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding-bottom: 2px;
}

.action-btn,
.send-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.action-btn {
  background: white;
}

.send-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.send-btn.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.send-icon {
  font-size: 16px;
}

/* 模态框 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 1000;
}

.action-menu {
  background: white;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  width: 100%;
  padding: 8px;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  border-radius: 8px;
}

.menu-item:active {
  background: #f5f5f5;
}

.menu-icon {
  font-size: 20px;
  margin-right: 12px;
}

.menu-text {
  font-size: 16px;
}
</style>
