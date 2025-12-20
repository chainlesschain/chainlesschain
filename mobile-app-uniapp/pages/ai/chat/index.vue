<template>
  <view class="chat-container">
    <!-- 头部 -->
    <view class="header">
      <view class="header-content">
        <text class="title">AI 助手</text>
        <view class="actions">
          <view class="icon-btn" @click="goToSettings">
            <text class="icon">⚙️</text>
          </view>
          <view class="icon-btn" @click="createNewConversation">
            <text class="icon">➕</text>
          </view>
        </view>
      </view>

      <!-- 搜索栏 -->
      <view class="search-bar">
        <input
          class="search-input"
          type="text"
          v-model="searchQuery"
          placeholder="搜索对话..."
          @input="handleSearch"
        />
        <text class="search-icon">🔍</text>
      </view>
    </view>

    <!-- 对话列表 -->
    <scroll-view class="content" scroll-y>
      <view v-if="loading" class="loading">
        <text>加载中...</text>
      </view>

      <view v-else-if="filteredConversations.length === 0" class="empty">
        <text class="empty-icon">🤖</text>
        <text class="empty-text">{{ searchQuery ? '未找到对话' : '开始你的第一个AI对话' }}</text>
        <text class="empty-hint" v-if="!searchQuery">
          点击右上角 ➕ 创建新对话
        </text>
      </view>

      <view v-else class="conversation-list">
        <view
          class="conversation-item"
          v-for="conv in filteredConversations"
          :key="conv.id"
          @click="openConversation(conv)"
          @longpress="showConversationMenu(conv)"
        >
          <view class="conv-icon">
            <text class="icon-text">{{ getConversationIcon(conv) }}</text>
          </view>
          <view class="conv-info">
            <view class="conv-header">
              <text class="conv-title">{{ conv.title }}</text>
              <text class="conv-time">{{ formatTime(conv.updatedAt) }}</text>
            </view>
            <text class="conv-preview" v-if="conv.lastMessageAt">
              {{ conv.messageCount }} 条消息
            </text>
            <text class="conv-model">{{ formatModel(conv.model) }}</text>
          </view>
          <view class="conv-arrow">
            <text>›</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 新建对话底部弹窗 -->
    <view v-if="showNewConvSheet" class="modal-overlay" @click="showNewConvSheet = false">
      <view class="modal-sheet" @click.stop>
        <view class="sheet-header">
          <text class="sheet-title">新建对话</text>
          <text class="sheet-close" @click="showNewConvSheet = false">✕</text>
        </view>

        <view class="sheet-content">
          <view class="form-item">
            <text class="form-label">对话标题</text>
            <input
              class="form-input"
              v-model="newConv.title"
              placeholder="例如：工作助手、学习伙伴..."
            />
          </view>

          <view class="form-item">
            <text class="form-label">系统提示词 (可选)</text>
            <textarea
              class="form-textarea"
              v-model="newConv.systemPrompt"
              placeholder="定义AI的角色和行为，例如：你是一个专业的编程助手..."
              :maxlength="500"
            />
          </view>

          <view class="form-item">
            <text class="form-label">温度</text>
            <slider
              class="form-slider"
              :value="newConv.temperature * 100"
              @change="handleTemperatureChange"
              min="0"
              max="100"
              show-value
            />
            <text class="form-hint">{{ newConv.temperature.toFixed(1) }} ({{ getTemperatureDesc(newConv.temperature) }})</text>
          </view>

          <view class="form-actions">
            <button class="cancel-btn" @click="showNewConvSheet = false">取消</button>
            <button class="create-btn" @click="confirmCreateConversation" :disabled="!newConv.title">
              创建
            </button>
          </view>
        </view>
      </view>
    </view>

    <!-- 对话菜单 -->
    <view v-if="showMenu" class="modal-overlay" @click="showMenu = false">
      <view class="action-menu" @click.stop>
        <view class="menu-item" @click="renameConversation">
          <text class="menu-icon">✏️</text>
          <text class="menu-text">重命名</text>
        </view>
        <view class="menu-item" @click="exportConversation">
          <text class="menu-icon">📤</text>
          <text class="menu-text">导出</text>
        </view>
        <view class="menu-item" @click="clearMessages">
          <text class="menu-icon">🗑️</text>
          <text class="menu-text">清空消息</text>
        </view>
        <view class="menu-item danger" @click="deleteConversation">
          <text class="menu-icon">❌</text>
          <text class="menu-text">删除对话</text>
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

export default {
  data() {
    return {
      conversations: [],
      searchQuery: '',
      loading: false,
      showNewConvSheet: false,
      showMenu: false,
      selectedConv: null,
      newConv: {
        title: '',
        systemPrompt: '你是一个helpful的AI助手，能够帮助用户解答问题、提供建议和完成各种任务。',
        temperature: 0.7
      }
    }
  },

  computed: {
    filteredConversations() {
      if (!this.searchQuery) {
        return this.conversations
      }

      const query = this.searchQuery.toLowerCase()
      return this.conversations.filter(conv =>
        conv.title.toLowerCase().includes(query)
      )
    }
  },

  async onLoad() {
    await this.loadConversations()
  },

  async onShow() {
    // 刷新对话列表
    await this.loadConversations()
  },

  methods: {
    async loadConversations() {
      try {
        this.loading = true
        this.conversations = await aiConversationService.getConversations()
      } catch (error) {
        console.error('加载对话列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    createNewConversation() {
      this.newConv = {
        title: '',
        systemPrompt: '你是一个helpful的AI助手，能够帮助用户解答问题、提供建议和完成各种任务。',
        temperature: 0.7
      }
      this.showNewConvSheet = true
    },

    async confirmCreateConversation() {
      if (!this.newConv.title) {
        uni.showToast({
          title: '请输入对话标题',
          icon: 'none'
        })
        return
      }

      try {
        const conversation = await aiConversationService.createConversation({
          title: this.newConv.title,
          systemPrompt: this.newConv.systemPrompt,
          temperature: this.newConv.temperature
        })

        this.showNewConvSheet = false

        // 跳转到对话页面
        uni.navigateTo({
          url: `/pages/ai/chat/conversation?id=${conversation.id}`
        })
      } catch (error) {
        console.error('创建对话失败:', error)
        uni.showToast({
          title: '创建失败: ' + error.message,
          icon: 'none'
        })
      }
    },

    openConversation(conv) {
      uni.navigateTo({
        url: `/pages/ai/chat/conversation?id=${conv.id}`
      })
    },

    showConversationMenu(conv) {
      this.selectedConv = conv
      this.showMenu = true
    },

    async renameConversation() {
      this.showMenu = false

      uni.showModal({
        title: '重命名对话',
        editable: true,
        placeholderText: this.selectedConv.title,
        success: async (res) => {
          if (res.confirm && res.content) {
            try {
              await aiConversationService.updateConversationTitle(
                this.selectedConv.id,
                res.content
              )
              await this.loadConversations()
              uni.showToast({
                title: '重命名成功',
                icon: 'success'
              })
            } catch (error) {
              uni.showToast({
                title: '重命名失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    async exportConversation() {
      this.showMenu = false

      uni.showActionSheet({
        itemList: ['导出为 Markdown', '导出为 JSON', '导出为 TXT'],
        success: async (res) => {
          const formats = ['markdown', 'json', 'txt']
          const format = formats[res.tapIndex]

          try {
            const content = await aiConversationService.exportConversation(
              this.selectedConv.id,
              format
            )

            // 保存到文件或分享
            // TODO: 实现文件保存功能
            console.log('导出内容:', content)

            uni.showToast({
              title: '导出成功',
              icon: 'success'
            })
          } catch (error) {
            uni.showToast({
              title: '导出失败',
              icon: 'none'
            })
          }
        }
      })
    },

    async clearMessages() {
      this.showMenu = false

      uni.showModal({
        title: '清空消息',
        content: '确定要清空此对话的所有消息吗？',
        success: async (res) => {
          if (res.confirm) {
            try {
              await aiConversationService.clearConversationMessages(
                this.selectedConv.id
              )
              await this.loadConversations()
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

    async deleteConversation() {
      this.showMenu = false

      uni.showModal({
        title: '删除对话',
        content: '确定要删除此对话吗？此操作无法撤销。',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm) {
            try {
              await aiConversationService.deleteConversation(
                this.selectedConv.id
              )
              await this.loadConversations()
              uni.showToast({
                title: '已删除',
                icon: 'success'
              })
            } catch (error) {
              uni.showToast({
                title: '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    goToSettings() {
      uni.navigateTo({
        url: '/pages/ai/settings'
      })
    },

    handleSearch() {
      // 搜索在 computed 中处理
    },

    handleTemperatureChange(e) {
      this.newConv.temperature = e.detail.value / 100
    },

    getTemperatureDesc(temp) {
      if (temp < 0.3) return '精确'
      if (temp < 0.7) return '平衡'
      return '创造性'
    },

    getConversationIcon(conv) {
      // 根据对话类型返回不同图标
      return '🤖'
    },

    formatModel(model) {
      // 简化模型名称显示
      if (!model) return ''
      if (model.includes('gpt-4')) return 'GPT-4'
      if (model.includes('gpt-3.5')) return 'GPT-3.5'
      if (model.includes('deepseek')) return 'DeepSeek'
      if (model.includes('qwen')) return '通义千问'
      if (model.includes('doubao')) return '豆包'
      return model
    },

    formatTime(timestamp) {
      if (!timestamp) return ''

      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour

      if (diff < minute) {
        return '刚刚'
      } else if (diff < hour) {
        return Math.floor(diff / minute) + '分钟前'
      } else if (diff < day) {
        return Math.floor(diff / hour) + '小时前'
      } else if (diff < 7 * day) {
        return Math.floor(diff / day) + '天前'
      } else {
        return date.toLocaleDateString('zh-CN', {
          month: '2-digit',
          day: '2-digit'
        })
      }
    }
  }
}
</script>

<style scoped>
.chat-container {
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
}

.header {
  background: rgba(255, 255, 255, 0.95);
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
  padding: 20px 16px 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.title {
  font-size: 24px;
  font-weight: bold;
  color: #1a1a1a;
}

.actions {
  display: flex;
  gap: 12px;
}

.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s;
}

.icon-btn:active {
  transform: scale(0.95);
}

.icon {
  font-size: 18px;
}

.search-bar {
  position: relative;
  margin-bottom: 8px;
}

.search-input {
  width: 100%;
  height: 40px;
  background: #f5f5f5;
  border-radius: 20px;
  padding: 0 40px 0 16px;
  font-size: 14px;
}

.search-icon {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 16px;
  opacity: 0.5;
}

.content {
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
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
}

.conversation-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.conversation-item {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.conversation-item:active {
  transform: scale(0.98);
  background: rgba(255, 255, 255, 0.9);
}

.conv-icon {
  width: 48px;
  height: 48px;
  border-radius: 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon-text {
  font-size: 24px;
}

.conv-info {
  flex: 1;
  min-width: 0;
}

.conv-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.conv-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-time {
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
  margin-left: 8px;
}

.conv-preview {
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}

.conv-model {
  font-size: 12px;
  color: #999;
}

.conv-arrow {
  font-size: 24px;
  color: #ccc;
  flex-shrink: 0;
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
}

.modal-sheet {
  background: white;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  width: 100%;
  max-height: 80vh;
  overflow: hidden;
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

.sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #f0f0f0;
}

.sheet-title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.sheet-close {
  font-size: 24px;
  color: #999;
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sheet-content {
  padding: 20px;
  max-height: calc(80vh - 60px);
  overflow-y: auto;
}

.form-item {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}

.form-input {
  width: 100%;
  height: 44px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
}

.form-textarea {
  width: 100%;
  min-height: 100px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  font-size: 14px;
  resize: vertical;
}

.form-slider {
  width: 100%;
  margin-bottom: 8px;
}

.form-hint {
  font-size: 12px;
  color: #999;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.cancel-btn,
.create-btn {
  flex: 1;
  height: 44px;
  border-radius: 8px;
  font-size: 16px;
  border: none;
}

.cancel-btn {
  background: #f5f5f5;
  color: #666;
}

.create-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.create-btn:disabled {
  opacity: 0.5;
}

/* 操作菜单 */
.action-menu {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: white;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  padding: 8px;
  animation: slideUp 0.3s ease-out;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.2s;
}

.menu-item:active {
  background: #f5f5f5;
}

.menu-item.danger {
  color: #ff4d4f;
}

.menu-icon {
  font-size: 20px;
  margin-right: 12px;
}

.menu-text {
  font-size: 16px;
}
</style>
