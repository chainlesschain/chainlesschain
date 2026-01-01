<template>
  <view class="ai-container">
    <!-- 顶部状态卡片 -->
    <view class="status-card">
      <view class="status-header">
        <view class="ai-avatar">
          <text class="avatar-emoji">🤖</text>
        </view>
        <view class="status-info">
          <text class="status-title">AI 助手</text>
          <text class="status-desc" :class="{ 'status-ready': isConfigured, 'status-error': !isConfigured }">
            {{ statusText }}
          </text>
        </view>
      </view>
      <view class="status-actions">
        <view class="action-btn" @click="navigateTo('/pages/ai/settings')">
          <text class="action-icon">⚙️</text>
          <text class="action-label">配置</text>
        </view>
      </view>
    </view>

    <!-- 快速开始 -->
    <view class="quick-start-card">
      <view class="card-header">
        <text class="header-title">快速开始</text>
      </view>
      <view class="quick-buttons">
        <view class="quick-btn primary" @click="handleNewConversation">
          <text class="btn-icon">✨</text>
          <text class="btn-text">新对话</text>
        </view>
        <view class="quick-btn secondary" @click="navigateTo('/pages/knowledge/list/list')">
          <text class="btn-icon">📚</text>
          <text class="btn-text">知识库</text>
        </view>
      </view>
    </view>

    <!-- 对话历史 -->
    <view class="conversations-section">
      <view class="section-header">
        <text class="section-title">对话历史</text>
        <text class="section-count">{{ conversations.length }} 个</text>
      </view>

      <scroll-view class="conversations-scroll" scroll-y>
        <!-- 对话列表 -->
        <view
          v-for="conv in conversations"
          :key="conv.id"
          class="conversation-card"
          @click="openConversation(conv.id)"
        >
          <view class="conv-header">
            <view class="conv-icon">💬</view>
            <view class="conv-info">
              <text class="conv-title">{{ conv.title }}</text>
              <text class="conv-time">{{ formatTime(conv.updatedAt) }}</text>
            </view>
            <view class="conv-actions" @click.stop="showConversationMenu(conv)">
              <text class="action-dot">⋯</text>
            </view>
          </view>
          <view class="conv-meta">
            <text class="meta-item">
              <text class="meta-icon">📝</text>
              <text class="meta-text">{{ conv.messageCount || 0 }} 条消息</text>
            </text>
            <text class="meta-item" v-if="conv.model">
              <text class="meta-icon">🤖</text>
              <text class="meta-text">{{ getModelName(conv.model) }}</text>
            </text>
          </view>
        </view>

        <!-- 空状态 -->
        <view class="empty-state" v-if="conversations.length === 0 && !loading">
          <text class="empty-icon">💬</text>
          <text class="empty-text">还没有对话记录</text>
          <text class="empty-hint">点击"新对话"开始与AI交流</text>
        </view>

        <!-- 加载状态 -->
        <view class="loading-state" v-if="loading">
          <text class="loading-text">加载中...</text>
        </view>
      </scroll-view>
    </view>

    <!-- AI功能卡片 -->
    <view class="features-section">
      <view class="section-header">
        <text class="section-title">AI 功能</text>
      </view>
      <view class="features-grid">
        <view class="feature-card" @click="navigateTo('/pages/ai/rag-settings')">
          <view class="feature-icon">🔍</view>
          <text class="feature-title">RAG 检索</text>
          <text class="feature-desc">知识增强</text>
        </view>
        <view class="feature-card" @click="navigateTo('/pages/knowledge/statistics/statistics')">
          <view class="feature-icon">📊</view>
          <text class="feature-title">统计分析</text>
          <text class="feature-desc">数据洞察</text>
        </view>
        <view class="feature-card" @click="navigateTo('/pages/ai/prompts')">
          <view class="feature-icon">💡</view>
          <text class="feature-title">提示词库</text>
          <text class="feature-desc">快速开始</text>
        </view>
        <view class="feature-card" style="opacity: 0.5">
          <view class="feature-icon">🎨</view>
          <text class="feature-title">AI 创作</text>
          <text class="feature-desc">即将推出</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import aiConversationService from '@/services/ai-conversation'
import { llm } from '@/services/llm'

export default {
  data() {
    return {
      isConfigured: false,
      statusText: '检查配置中...',
      conversations: [],
      loading: false
    }
  },

  async onLoad() {
    await this.checkConfig()
    await this.loadConversations()
  },

  async onShow() {
    // 每次显示页面时刷新
    await this.checkConfig()
    await this.loadConversations()
  },

  onPullDownRefresh() {
    this.loadConversations().then(() => {
      uni.stopPullDownRefresh()
    })
  },

  methods: {
    /**
     * 检查AI配置状态
     */
    async checkConfig() {
      try {
        const status = await llm.checkStatus()
        this.isConfigured = status.available

        if (status.available) {
          this.statusText = `已配置 ${status.provider || 'LLM'}`
        } else {
          this.statusText = status.message || '未配置'
        }
      } catch (error) {
        console.error('检查配置失败:', error)
        this.isConfigured = false
        this.statusText = '配置检查失败'
      }
    },

    /**
     * 加载对话列表
     */
    async loadConversations() {
      this.loading = true
      try {
        this.conversations = await aiConversationService.getConversations()
        console.log('已加载对话:', this.conversations.length)
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

    /**
     * 新建对话
     */
    async handleNewConversation() {
      // 检查配置
      if (!this.isConfigured) {
        uni.showModal({
          title: '提示',
          content: '请先配置 AI 服务',
          confirmText: '去配置',
          success: (res) => {
            if (res.confirm) {
              this.navigateTo('/pages/ai/settings')
            }
          }
        })
        return
      }

      // 创建新对话
      try {
        const conversation = await aiConversationService.createConversation()

        // 跳转到对话页面
        uni.navigateTo({
          url: `/pages/chat/chat?conversationId=${conversation.id}`
        })
      } catch (error) {
        console.error('创建对话失败:', error)
        uni.showToast({
          title: '创建失败',
          icon: 'none'
        })
      }
    },

    /**
     * 打开对话
     */
    openConversation(conversationId) {
      uni.navigateTo({
        url: `/pages/chat/chat?conversationId=${conversationId}`
      })
    },

    /**
     * 显示对话菜单
     */
    showConversationMenu(conv) {
      const items = ['重命名', '导出', '删除']

      uni.showActionSheet({
        itemList: items,
        success: async (res) => {
          if (res.tapIndex === 0) {
            // 重命名
            this.renameConversation(conv)
          } else if (res.tapIndex === 1) {
            // 导出
            this.exportConversation(conv)
          } else if (res.tapIndex === 2) {
            // 删除
            this.confirmDeleteConversation(conv)
          }
        }
      })
    },

    /**
     * 重命名对话
     */
    renameConversation(conv) {
      uni.showModal({
        title: '重命名对话',
        editable: true,
        placeholderText: conv.title,
        success: async (res) => {
          if (res.confirm && res.content) {
            try {
              await aiConversationService.updateConversationTitle(conv.id, res.content)
              await this.loadConversations()
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
     * 导出对话
     */
    async exportConversation(conv) {
      try {
        const markdown = await aiConversationService.exportConversation(conv.id, 'markdown')

        // 在移动端，可以使用分享功能
        uni.showModal({
          title: '导出成功',
          content: '对话已导出为Markdown格式',
          confirmText: '复制',
          success: (res) => {
            if (res.confirm) {
              uni.setClipboardData({
                data: markdown,
                success: () => {
                  uni.showToast({
                    title: '已复制到剪贴板',
                    icon: 'success'
                  })
                }
              })
            }
          }
        })
      } catch (error) {
        console.error('导出失败:', error)
        uni.showToast({
          title: '导出失败',
          icon: 'none'
        })
      }
    },

    /**
     * 确认删除对话
     */
    confirmDeleteConversation(conv) {
      uni.showModal({
        title: '删除对话',
        content: `确定要删除"${conv.title}"吗？此操作不可恢复。`,
        confirmText: '删除',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (res.confirm) {
            await this.deleteConversation(conv.id)
          }
        }
      })
    },

    /**
     * 删除对话
     */
    async deleteConversation(conversationId) {
      try {
        await aiConversationService.deleteConversation(conversationId)
        await this.loadConversations()
        uni.showToast({
          title: '已删除',
          icon: 'success'
        })
      } catch (error) {
        console.error('删除失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none'
        })
      }
    },

    /**
     * 页面导航
     */
    navigateTo(url) {
      uni.navigateTo({ url })
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
    },

    /**
     * 获取模型显示名称
     */
    getModelName(model) {
      if (!model) return ''

      // 简化显示
      if (model.includes('gpt-4')) return 'GPT-4'
      if (model.includes('gpt-3.5')) return 'GPT-3.5'
      if (model.includes('claude')) return 'Claude'
      if (model.includes('qwen')) return '通义千问'
      if (model.includes('glm')) return 'ChatGLM'

      return model.substring(0, 15)
    }
  }
}
</script>

<style scoped>
.ai-container {
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f7fa 0%, #ffffff 100%);
  padding: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom) + 50px);
}

/* 状态卡片 */
.status-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.ai-avatar {
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255, 255, 255, 0.5);
}

.avatar-emoji {
  font-size: 28px;
}

.status-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-title {
  font-size: 18px;
  font-weight: 600;
  color: white;
}

.status-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

.status-desc.status-ready {
  color: rgba(255, 255, 255, 0.95);
}

.status-desc.status-error {
  color: rgba(255, 200, 200, 1);
}

.status-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 8px;
}

.action-icon {
  font-size: 20px;
}

.action-label {
  font-size: 11px;
  color: white;
}

/* 快速开始卡片 */
.quick-start-card {
  background: white;
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.card-header {
  margin-bottom: 12px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.quick-buttons {
  display: flex;
  gap: 12px;
}

.quick-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.quick-btn.primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.quick-btn.secondary {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.btn-icon {
  font-size: 32px;
}

.btn-text {
  font-size: 14px;
  font-weight: 600;
  color: white;
}

/* 对话历史区域 */
.conversations-section {
  background: white;
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.section-count {
  font-size: 13px;
  color: #999;
}

.conversations-scroll {
  max-height: 400px;
}

.conversation-card {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
}

.conversation-card:last-child {
  margin-bottom: 0;
}

.conv-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.conv-icon {
  font-size: 24px;
  width: 40px;
  height: 40px;
  background: white;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.conv-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conv-title {
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-time {
  font-size: 12px;
  color: #999;
}

.conv-actions {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.05);
}

.action-dot {
  font-size: 18px;
  color: #666;
  line-height: 1;
}

.conv-meta {
  display: flex;
  gap: 12px;
  padding-left: 52px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #666;
}

.meta-icon {
  font-size: 14px;
}

.meta-text {
  font-size: 12px;
}

/* 空状态 */
.empty-state {
  padding: 60px 40px;
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

/* AI功能区域 */
.features-section {
  background: white;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.feature-card {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}

.feature-card:active {
  transform: scale(0.95);
  background: #f0f1f3;
}

.feature-icon {
  font-size: 32px;
  margin-bottom: 4px;
}

.feature-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}

.feature-desc {
  font-size: 12px;
  color: #999;
}
</style>
