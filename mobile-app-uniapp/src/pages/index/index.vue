<template>
  <view class="home-container">
    <!-- 头部用户信息卡片 -->
    <view class="header-card">
      <view class="user-info">
        <view class="avatar">
          <text class="avatar-text">{{ userInitial }}</text>
        </view>
        <view class="info">
          <text class="greeting">{{ greeting }}</text>
          <text class="username">{{ currentIdentity?.nickname || 'ChainlessChain用户' }}</text>
        </view>
      </view>
      <view class="sync-status" @click="goToSync">
        <text class="status-icon">{{ syncStatus === 'synced' ? '✓' : '↻' }}</text>
        <text class="status-text">{{ syncStatusText }}</text>
      </view>
    </view>

    <!-- 快速操作卡片 -->
    <view class="quick-actions">
      <view class="quick-item" @click="quickAction('knowledge')">
        <view class="quick-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)">
          <text class="icon">📚</text>
        </view>
        <text class="quick-label">知识</text>
      </view>
      <view class="quick-item" @click="quickAction('ai-chat')">
        <view class="quick-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%)">
          <text class="icon">🤖</text>
        </view>
        <text class="quick-label">AI对话</text>
      </view>
      <view class="quick-item" @click="quickAction('scan')">
        <view class="quick-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)">
          <text class="icon">📷</text>
        </view>
        <text class="quick-label">扫一扫</text>
      </view>
      <view class="quick-item" @click="quickAction('voice')">
        <view class="quick-icon" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)">
          <text class="icon">🎤</text>
        </view>
        <text class="quick-label">语音</text>
      </view>
    </view>

    <!-- 功能模块卡片 -->
    <scroll-view class="modules-scroll" scroll-y>
      <!-- 项目管理 -->
      <view class="module-section">
        <view class="section-header">
          <text class="section-icon">📁</text>
          <text class="section-title">项目管理</text>
          <text class="section-more" @click="goToModule('projects')">更多 ›</text>
        </view>
        <view class="module-grid">
          <view class="module-card" @click="navigateTo('/pages/projects/list')">
            <view class="card-icon">🗂️</view>
            <text class="card-title">项目总览</text>
            <text class="card-desc">{{ statistics.projectCount }} 个项目</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/projects/list')">
            <view class="card-icon">📝</view>
            <text class="card-title">待办任务</text>
            <text class="card-desc">{{ statistics.activeTaskCount }} 个待办</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/projects/list?tab=collaborating')">
            <view class="card-icon">🤝</view>
            <text class="card-title">协作空间</text>
            <text class="card-desc">{{ statistics.collaboratingCount }} 个协作</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/projects/templates')">
            <view class="card-icon">📑</view>
            <text class="card-title">项目模板</text>
            <text class="card-desc">复用最佳实践</text>
          </view>
        </view>
      </view>

      <!-- 知识与AI -->
      <view class="module-section">
        <view class="section-header">
          <text class="section-icon">📚</text>
          <text class="section-title">知识与AI</text>
          <text class="section-more" @click="goToModule('knowledge')">更多 ›</text>
        </view>
        <view class="module-grid">
          <view class="module-card" @click="navigateTo('/pages/knowledge/list/list')">
            <view class="card-icon">📖</view>
            <text class="card-title">知识库</text>
            <text class="card-desc">{{ statistics.knowledgeCount }} 条</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/ai/chat/index')">
            <view class="card-icon">💬</view>
            <text class="card-title">AI对话</text>
            <text class="card-desc">{{ statistics.conversationCount }} 个会话</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/knowledge/import-export/import-export')">
            <view class="card-icon">📥</view>
            <text class="card-title">导入/导出</text>
            <text class="card-desc">数据迁移</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/knowledge/statistics/statistics')">
            <view class="card-icon">📊</view>
            <text class="card-title">知识统计</text>
            <text class="card-desc">数据分析</text>
          </view>
        </view>
      </view>

      <!-- 身份与社交 -->
      <view class="module-section">
        <view class="section-header">
          <text class="section-icon">👥</text>
          <text class="section-title">身份与社交</text>
          <text class="section-more" @click="goToModule('social')">更多 ›</text>
        </view>
        <view class="module-grid">
          <view class="module-card" @click="navigateTo('/pages/identity/list')">
            <view class="card-icon">🆔</view>
            <text class="card-title">DID身份</text>
            <text class="card-desc">去中心化身份</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/social/friends/list')">
            <view class="card-icon">👬</view>
            <text class="card-title">好友</text>
            <text class="card-desc">{{ statistics.friendCount }} 个好友</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/social/timeline/index')">
            <view class="card-icon">📝</view>
            <text class="card-title">动态</text>
            <text class="card-desc">最新动态</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/social/chat/index')">
            <view class="card-icon">💌</view>
            <text class="card-title">消息</text>
            <text class="card-desc" v-if="statistics.unreadCount > 0" style="color: #ff4d4f">
              {{ statistics.unreadCount }} 条未读
            </text>
            <text class="card-desc" v-else>无未读</text>
          </view>
        </view>
      </view>

      <!-- 交易系统 -->
      <view class="module-section">
        <view class="section-header">
          <text class="section-icon">💰</text>
          <text class="section-title">交易系统</text>
          <text class="section-more" @click="goToModule('trade')">更多 ›</text>
        </view>
        <view class="module-grid">
          <view class="module-card" @click="navigateTo('/pages/trade/market/market')">
            <view class="card-icon">🏪</view>
            <text class="card-title">交易市场</text>
            <text class="card-desc">知识交易</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/trade/orders/orders')">
            <view class="card-icon">📋</view>
            <text class="card-title">我的订单</text>
            <text class="card-desc">订单管理</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/trade/assets/assets')">
            <view class="card-icon">💎</view>
            <text class="card-title">我的资产</text>
            <text class="card-desc">资产管理</text>
          </view>
          <view class="module-card" style="opacity: 0.5">
            <view class="card-icon">⭐</view>
            <text class="card-title">信用评分</text>
            <text class="card-desc">即将推出</text>
          </view>
        </view>
      </view>

      <!-- 系统设置 -->
      <view class="module-section">
        <view class="section-header">
          <text class="section-icon">⚙️</text>
          <text class="section-title">系统设置</text>
          <text class="section-more" @click="goToModule('settings')">更多 ›</text>
        </view>
        <view class="module-grid">
          <view class="module-card" @click="navigateTo('/pages/ai/settings')">
            <view class="card-icon">🔧</view>
            <text class="card-title">AI配置</text>
            <text class="card-desc">LLM设置</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/backup/backup')">
            <view class="card-icon">☁️</view>
            <text class="card-title">数据备份</text>
            <text class="card-desc">云端同步</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/auth/change-pin')">
            <view class="card-icon">🔐</view>
            <text class="card-title">安全设置</text>
            <text class="card-desc">PIN/生物识别</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/settings/settings')">
            <view class="card-icon">🛠️</view>
            <text class="card-title">通用设置</text>
            <text class="card-desc">偏好设置</text>
          </view>
        </view>
      </view>

      <!-- 底部间距 -->
      <view style="height: 20px"></view>
    </scroll-view>
  </view>
</template>

<script>
import didService from '@/services/did'
import friendService from '@/services/friends'
import aiConversationService from '@/services/ai-conversation'
import database from '@/services/database'
import projectManager from '@/services/project-manager'

export default {
  data() {
    return {
      currentIdentity: null,
      syncStatus: 'synced', // 'synced', 'syncing', 'failed'
      statistics: {
        knowledgeCount: 0,
        conversationCount: 0,
        friendCount: 0,
        unreadCount: 0,
        projectCount: 0,
        activeTaskCount: 0,
        collaboratingCount: 0
      }
    }
  },

  computed: {
    greeting() {
      const hour = new Date().getHours()
      if (hour < 6) return '夜深了'
      if (hour < 12) return '早上好'
      if (hour < 14) return '中午好'
      if (hour < 18) return '下午好'
      if (hour < 22) return '晚上好'
      return '夜深了'
    },

    userInitial() {
      const name = this.currentIdentity?.nickname || 'C'
      return name.charAt(0).toUpperCase()
    },

    syncStatusText() {
      const statusMap = {
        synced: '已同步',
        syncing: '同步中',
        failed: '同步失败'
      }
      return statusMap[this.syncStatus] || '未知'
    }
  },

  async onLoad() {
    await this.loadUserInfo()
    await this.loadStatistics()
  },

  async onShow() {
    await this.loadStatistics()
  },

  methods: {
    async loadUserInfo() {
      try {
        this.currentIdentity = await didService.getCurrentIdentity()
      } catch (error) {
        console.error('加载用户信息失败:', error)
      }
    },

    async loadStatistics() {
      try {
        const [knowledge, conversations, friends] = await Promise.all([
          database.getAllKnowledge(),
          aiConversationService.getConversations(),
          friendService.getFriends()
        ])

        this.statistics.knowledgeCount = knowledge.length
        this.statistics.conversationCount = conversations.length
        this.statistics.friendCount = friends.length
        this.statistics.unreadCount = 0

        await this.loadProjectStatistics()
      } catch (error) {
        console.error('加载统计数据失败:', error)
      }
    },

    navigateTo(url) {
      uni.navigateTo({ url })
    },

    quickAction(action) {
      const actions = {
        'knowledge': () => uni.navigateTo({ url: '/pages/knowledge/edit/edit?mode=new' }),
        'ai-chat': () => uni.switchTab({ url: '/pages/ai/index' }),
        'scan': () => {
          // TODO: 实现扫一扫功能
          uni.showToast({ title: '功能开发中', icon: 'none' })
        },
        'voice': () => {
          // TODO: 实现语音输入
          uni.showToast({ title: '功能开发中', icon: 'none' })
        }
      }

      if (actions[action]) {
        actions[action]()
      }
    },

    goToModule(module) {
      // 跳转到对应模块的更多页面
      const modulePages = {
        'knowledge': '/pages/knowledge/list/list',
        'social': '/pages/social/friends/list',
        'trade': '/pages/trade/market/market',
        'projects': '/pages/projects/list',
        'settings': '/pages/settings/settings'
      }

      if (modulePages[module]) {
        uni.navigateTo({ url: modulePages[module] })
      }
    },

    goToSync() {
      uni.navigateTo({ url: '/pages/backup/cloud-sync' })
    },

    async loadProjectStatistics() {
      try {
        const projects = await projectManager.getProjects()
        this.statistics.projectCount = projects.length

        const collaboratingProjects = await projectManager.getCollaboratingProjects()
        this.statistics.collaboratingCount = collaboratingProjects.length

        if (!projects.length) {
          this.statistics.activeTaskCount = 0
          return
        }

        const statsList = await Promise.all(
          projects.map(project => projectManager.getProjectStatistics(project.id))
        )

        const pendingTasks = statsList.reduce((total, stats) => {
          const tasksByStatus = stats.tasksByStatus || {}
          return total + (tasksByStatus.todo || 0) + (tasksByStatus.in_progress || 0)
        }, 0)

        this.statistics.activeTaskCount = pendingTasks
      } catch (error) {
        console.error('加载项目统计失败:', error)
        this.statistics.projectCount = 0
        this.statistics.collaboratingCount = 0
        this.statistics.activeTaskCount = 0
      }
    }
  }
}
</script>

<style scoped>
.home-container {
  min-height: 100vh;
  background: linear-gradient(180deg, #f0f2f5 0%, #ffffff 100%);
  padding: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom) + 50px);
}

/* 头部用户卡片 */
.header-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255, 255, 255, 0.5);
}

.avatar-text {
  font-size: 24px;
  font-weight: bold;
  color: white;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.greeting {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.username {
  font-size: 18px;
  font-weight: 600;
  color: white;
}

.sync-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
}

.status-icon {
  font-size: 18px;
  color: white;
}

.status-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.9);
}

/* 快速操作 */
.quick-actions {
  display: flex;
  justify-content: space-around;
  background: white;
  border-radius: 16px;
  padding: 20px 12px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.quick-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.quick-icon {
  width: 52px;
  height: 52px;
  border-radius: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.quick-icon .icon {
  font-size: 24px;
}

.quick-label {
  font-size: 12px;
  color: #666;
}

/* 模块滚动区 */
.modules-scroll {
  flex: 1;
  height: calc(100vh - 280px);
}

/* 模块区块 */
.module-section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  padding: 0 4px;
}

.section-icon {
  font-size: 20px;
  margin-right: 8px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
  flex: 1;
}

.section-more {
  font-size: 13px;
  color: #999;
}

/* 模块网格 */
.module-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.module-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: all 0.2s;
}

.module-card:active {
  transform: scale(0.95);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.card-icon {
  font-size: 32px;
  margin-bottom: 4px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}

.card-desc {
  font-size: 12px;
  color: #999;
  text-align: center;
}
</style>
