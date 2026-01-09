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
        <view class="project-actions">
          <button class="project-action primary" @click="navigateTo('/pages/projects/create')">
            <text class="action-icon">＋</text>
            <text class="action-text">新建项目</text>
          </button>
          <button class="project-action secondary" @click="navigateTo('/pages/projects/templates')">
            <text class="action-icon">✨</text>
            <text class="action-text">AI模板</text>
          </button>
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
        <view class="recent-projects" v-if="recentProjects.length">
          <view class="recent-header">
            <text class="recent-title">最近项目</text>
            <text class="recent-link" @click="navigateTo('/pages/projects/list')">查看全部 ›</text>
          </view>
          <view class="recent-list">
            <view
              class="recent-item"
              v-for="project in recentProjects"
              :key="project.id"
              @click="goToProject(project.id)"
            >
              <view class="recent-name">{{ project.name }}</view>
              <view class="recent-meta">
                <text class="recent-type">{{ formatProjectType(project.type) }}</text>
                <text class="recent-updated">{{ formatProjectTime(project.updated_at) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- P2P协作 -->
      <view class="module-section">
        <view class="section-header">
          <text class="section-icon">🔗</text>
          <text class="section-title">P2P协作</text>
          <text class="section-more" @click="navigateTo('/pages/p2p/device-list')">更多 ›</text>
        </view>
        <view v-if="p2pSummary.pairedCount > 0" class="p2p-summary">
          <view class="p2p-stat">
            <text class="p2p-value">{{ p2pSummary.onlineCount }}/{{ p2pSummary.pairedCount }}</text>
            <text class="p2p-label">在线设备</text>
          </view>
          <view class="p2p-stat">
            <text class="p2p-value">{{ p2pSummary.primaryDevice || '未配对' }}</text>
            <text class="p2p-label">当前PC</text>
          </view>
          <view class="p2p-stat">
            <text class="p2p-value">{{ formatDeviceTime(p2pSummary.lastConnected) }}</text>
            <text class="p2p-label">最近连接</text>
          </view>
        </view>
        <view v-else class="p2p-empty">
          <text class="empty-title">尚未配对PC设备</text>
          <text class="empty-subtitle">保持桌面端在线，即可启用项目/知识镜像</text>
          <button class="pair-btn" @click="navigateTo('/pages/device-pairing/index')">立即配对</button>
        </view>
        <view class="module-grid">
          <view class="module-card" @click="navigateTo('/pages/p2p/pc-status')">
            <view class="card-icon">💻</view>
            <text class="card-title">PC状态</text>
            <text class="card-desc">CPU/内存监控</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/p2p/project-list')">
            <view class="card-icon">🛰️</view>
            <text class="card-title">项目镜像</text>
            <text class="card-desc">浏览PC项目</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/p2p/knowledge-list')">
            <view class="card-icon">🧠</view>
            <text class="card-title">知识镜像</text>
            <text class="card-desc">搜索PC知识</text>
          </view>
          <view class="module-card" @click="navigateTo('/pages/p2p/device-list')">
            <view class="card-icon">🛰</view>
            <text class="card-title">设备管理</text>
            <text class="card-desc">联网/断开PC</text>
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
import { getP2PManager } from '@/services/p2p/p2p-manager'

export default {
  data() {
    return {
      currentIdentity: null,
      syncStatus: 'synced', // 'synced', 'syncing', 'failed'
      recentProjects: [],
      p2pSummary: {
        pairedCount: 0,
        onlineCount: 0,
        primaryDevice: '',
        lastConnected: null
      },
      p2pManager: null,
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
    this.p2pManager = getP2PManager()
    await this.loadUserInfo()
    await this.loadStatistics()
    await this.loadP2PStatus()
  },

  async onShow() {
    await this.loadStatistics()
    await this.loadP2PStatus()
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
        this.recentProjects = projects.slice(0, 3)

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
        this.recentProjects = []
      }
    },

    goToProject(projectId) {
      if (!projectId) return
      uni.navigateTo({ url: `/pages/projects/detail?id=${projectId}` })
    },

    formatProjectType(type) {
      const map = {
        general: '通用',
        code: '代码',
        research: '研究',
        writing: '写作',
        learning: '学习',
        marketing: '营销',
        other: '其他'
      }
      return map[type] || '通用'
    },

    formatProjectTime(timestamp) {
      if (!timestamp) return ''
      const diff = Date.now() - timestamp
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour
      if (diff < minute) return '刚刚'
      if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
      if (diff < day) return `${Math.floor(diff / hour)} 小时前`
      if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
      const date = new Date(timestamp)
      return `${date.getMonth() + 1}月${date.getDate()}日`
    },

    async loadP2PStatus() {
      try {
        const devicesStr = uni.getStorageSync('paired_devices')
        if (!devicesStr) {
          this.p2pSummary = {
            pairedCount: 0,
            onlineCount: 0,
            primaryDevice: '',
            lastConnected: null
          }
          return
        }

        const devices = JSON.parse(devicesStr)
        const manager = this.p2pManager || getP2PManager()
        const enriched = devices.map(device => {
          const state = manager ? manager.getConnectionState(device.peerId) : 'disconnected'
          return {
            ...device,
            connected: state === 'connected'
          }
        })

        const online = enriched.filter(device => device.connected)
        const primary = online[0] || enriched[0]

        this.p2pSummary = {
          pairedCount: enriched.length,
          onlineCount: online.length,
          primaryDevice: primary ? (primary.deviceInfo?.name || 'PC设备') : '',
          lastConnected: primary?.lastConnected || null
        }
      } catch (error) {
        console.error('加载P2P状态失败:', error)
        this.p2pSummary = {
          pairedCount: 0,
          onlineCount: 0,
          primaryDevice: '',
          lastConnected: null
        }
      }
    },

    formatDeviceTime(timestamp) {
      if (!timestamp) {
        return this.p2pSummary.onlineCount > 0 ? '在线' : '未连接'
      }
      const diff = Date.now() - timestamp
      if (diff < 60 * 1000) return '刚刚'
      if (diff < 3600 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
      if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / (3600 * 1000))} 小时前`
      const date = new Date(timestamp)
      return `${date.getMonth() + 1}月${date.getDate()}日`
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

.project-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.project-action {
  flex: 1;
  border: none;
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}

.project-action.primary {
  background: linear-gradient(135deg, #5c6ac4 0%, #8066ff 100%);
  color: white;
}

.project-action.secondary {
  background: #f5f5f5;
  color: #333;
}

.project-action .action-icon {
  font-size: 18px;
}

.project-action .action-text {
  font-weight: 600;
}

.recent-projects {
  margin-top: 16px;
  background: #f8f8fc;
  border-radius: 12px;
  padding: 12px;
}

.recent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.recent-title {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}

.recent-link {
  font-size: 13px;
  color: #666;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.recent-item {
  background: white;
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.recent-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}

.recent-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #888;
  margin-top: 4px;
}

.p2p-summary {
  display: flex;
  justify-content: space-between;
  background: #f8f9ff;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 12px;
}

.p2p-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.p2p-value {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.p2p-label {
  font-size: 12px;
  color: #777;
}

.p2p-empty {
  background: #fff4f2;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  text-align: center;
}

.p2p-empty .empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #c44;
}

.p2p-empty .empty-subtitle {
  font-size: 12px;
  color: #c44;
  margin-top: 4px;
}

.pair-btn {
  margin-top: 12px;
  padding: 10px 18px;
  background: #ff7a45;
  color: white;
  border: none;
  border-radius: 20px;
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
