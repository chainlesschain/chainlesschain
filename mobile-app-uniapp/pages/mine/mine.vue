<template>
  <view class="mine-page">
    <!-- 用户信息头部 -->
    <view class="user-header">
      <view class="header-bg">
        <view class="bg-pattern"></view>
      </view>
      <view class="header-content">
        <view class="user-avatar">
          <text class="avatar-text">{{ avatarText }}</text>
        </view>
        <view class="user-info">
          <text class="username">{{ username }}</text>
          <text class="user-did">{{ userDidShort }}</text>
        </view>
        <view class="header-actions">
          <view class="action-icon" @click="navigateTo('/pages/identity/list')">
            <text>🆔</text>
          </view>
          <view class="action-icon" @click="navigateTo('/pages/settings/settings')">
            <text>⚙️</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 数据统计卡片 -->
    <view class="stats-card">
      <view class="stat-item" @click="switchTab('/pages/knowledge/list/list')">
        <text class="stat-number">{{ stats.knowledge }}</text>
        <text class="stat-label">知识</text>
      </view>
      <view class="stat-divider"></view>
      <view class="stat-item" @click="switchTab('/pages/ai/index')">
        <text class="stat-number">{{ stats.conversations }}</text>
        <text class="stat-label">对话</text>
      </view>
      <view class="stat-divider"></view>
      <view class="stat-item" @click="navigateTo('/pages/social/friends/list')">
        <text class="stat-number">{{ stats.friends }}</text>
        <text class="stat-label">好友</text>
      </view>
      <view class="stat-divider"></view>
      <view class="stat-item" @click="navigateTo('/pages/trade/assets/assets')">
        <text class="stat-number">{{ stats.assets }}</text>
        <text class="stat-label">资产</text>
      </view>
    </view>

    <!-- 功能网格 -->
    <scroll-view class="functions-scroll" scroll-y>
      <!-- 快速功能 -->
      <view class="quick-functions">
        <view class="function-card" @click="navigateTo('/pages/knowledge/import-export/import-export')">
          <view class="card-icon gradient-blue">
            <text>📥</text>
          </view>
          <text class="card-title">导入/导出</text>
        </view>
        <view class="function-card" @click="navigateTo('/pages/knowledge/statistics/statistics')">
          <view class="card-icon gradient-purple">
            <text>📊</text>
          </view>
          <text class="card-title">数据统计</text>
        </view>
        <view class="function-card" @click="navigateTo('/pages/backup/backup')">
          <view class="card-icon gradient-green">
            <text>☁️</text>
          </view>
          <text class="card-title">数据备份</text>
        </view>
        <view class="function-card" @click="navigateTo('/pages/ai/settings')">
          <view class="card-icon gradient-orange">
            <text>🔧</text>
          </view>
          <text class="card-title">AI配置</text>
        </view>
      </view>

      <!-- 功能列表 -->
      <view class="menu-section">
        <view class="section-header">
          <text class="section-title">知识管理</text>
        </view>
        <view class="menu-list">
          <view class="menu-item" @click="navigateTo('/pages/knowledge/folders/folders')">
            <view class="item-icon">📁</view>
            <text class="item-label">文件夹管理</text>
            <text class="item-arrow">›</text>
          </view>
          <view class="menu-item" @click="navigateTo('/pages/knowledge/statistics/statistics')">
            <view class="item-icon">📊</view>
            <text class="item-label">数据统计</text>
            <text class="item-arrow">›</text>
          </view>
        </view>
      </view>

      <view class="menu-section">
        <view class="section-header">
          <text class="section-title">社交互动</text>
        </view>
        <view class="menu-list">
          <view class="menu-item" @click="navigateTo('/pages/social/friends/list')">
            <view class="item-icon">👥</view>
            <text class="item-label">好友管理</text>
            <text class="item-arrow">›</text>
          </view>
          <view class="menu-item" @click="navigateTo('/pages/social/timeline/index')">
            <view class="item-icon">📝</view>
            <text class="item-label">我的动态</text>
            <text class="item-arrow">›</text>
          </view>
        </view>
      </view>

      <view class="menu-section">
        <view class="section-header">
          <text class="section-title">交易系统</text>
        </view>
        <view class="menu-list">
          <view class="menu-item" @click="navigateTo('/pages/trade/market/market')">
            <view class="item-icon">🏪</view>
            <text class="item-label">交易市场</text>
            <text class="item-arrow">›</text>
          </view>
          <view class="menu-item" @click="navigateTo('/pages/trade/orders/orders')">
            <view class="item-icon">📋</view>
            <text class="item-label">我的订单</text>
            <text class="item-arrow">›</text>
          </view>
          <view class="menu-item" @click="navigateTo('/pages/trade/assets/assets')">
            <view class="item-icon">💎</view>
            <text class="item-label">我的资产</text>
            <text class="item-arrow">›</text>
          </view>
        </view>
      </view>

      <view class="menu-section">
        <view class="section-header">
          <text class="section-title">系统设置</text>
        </view>
        <view class="menu-list">
          <view class="menu-item" @click="navigateTo('/pages/identity/list')">
            <view class="item-icon">🆔</view>
            <text class="item-label">身份管理</text>
            <text class="item-arrow">›</text>
          </view>
          <view class="menu-item" @click="navigateTo('/pages/backup/cloud-sync')">
            <view class="item-icon">🔄</view>
            <text class="item-label">云同步</text>
            <text class="item-arrow">›</text>
          </view>
          <view class="menu-item" @click="navigateTo('/pages/auth/change-pin')">
            <view class="item-icon">🔐</view>
            <text class="item-label">安全设置</text>
            <text class="item-arrow">›</text>
          </view>
          <view class="menu-item" @click="showAbout">
            <view class="item-icon">ℹ️</view>
            <text class="item-label">关于我们</text>
            <text class="item-arrow">›</text>
          </view>
        </view>
      </view>

      <!-- 退出登录 -->
      <view class="logout-section">
        <view class="logout-btn" @click="confirmLogout">
          <text class="logout-text">退出登录</text>
        </view>
      </view>

      <!-- 版本信息 -->
      <view class="version-info">
        <text class="version-text">ChainlessChain v1.0.0</text>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import database from '@/services/database'
import didService from '@/services/did'
import friendService from '@/services/friends'
import aiConversationService from '@/services/ai-conversation'

export default {
  data() {
    return {
      currentIdentity: null,
      username: 'ChainlessChain 用户',
      userDid: '',
      stats: {
        knowledge: 0,
        conversations: 0,
        friends: 0,
        assets: 0
      }
    }
  },

  computed: {
    avatarText() {
      const name = this.currentIdentity?.nickname || this.username
      return name.charAt(0).toUpperCase()
    },

    userDidShort() {
      if (!this.userDid) return 'DID未设置'
      return 'DID: ' + this.userDid.substring(0, 12) + '...'
    }
  },

  async onLoad() {
    await this.loadUserInfo()
    await this.loadStats()
  },

  async onShow() {
    await this.loadStats()
  },

  methods: {
    /**
     * 加载用户信息
     */
    async loadUserInfo() {
      try {
        // 尝试从 DID 服务获取当前身份
        const identity = await didService.getCurrentIdentity()

        if (identity) {
          this.currentIdentity = identity
          this.username = identity.nickname || 'ChainlessChain 用户'
          this.userDid = identity.did || ''
        } else {
          // 未登录时使用默认值
          this.username = 'ChainlessChain 用户'
          this.userDid = ''
        }
      } catch (error) {
        console.error('加载用户信息失败:', error)
        // 加载失败时使用默认值
        this.username = 'ChainlessChain 用户'
        this.userDid = ''
      }
    },

    /**
     * 加载统计数据
     */
    async loadStats() {
      try {
        // 加载知识库统计
        const knowledge = await database.getAllKnowledge()
        this.stats.knowledge = knowledge.length

        // 加载AI对话统计
        const conversations = await aiConversationService.getConversations()
        this.stats.conversations = conversations.length

        // 加载好友统计
        const friends = await friendService.getFriends()
        this.stats.friends = friends.length

        // TODO: 加载资产统计
        this.stats.assets = 0
      } catch (error) {
        console.error('加载统计数据失败:', error)
      }
    },

    /**
     * 页面导航
     */
    navigateTo(url) {
      uni.navigateTo({ url })
    },

    /**
     * 切换Tab
     */
    switchTab(url) {
      uni.switchTab({ url })
    },

    /**
     * 显示关于信息
     */
    showAbout() {
      uni.showModal({
        title: '关于 ChainlessChain',
        content: 'ChainlessChain 是一个去中心化的知识管理平台，致力于保护用户隐私，提供 AI 原生的知识管理体验。\n\n版本：v1.0.0\n\n基于区块链和 DID 技术构建，确保您的数据完全由您掌控。',
        confirmText: '知道了',
        showCancel: false
      })
    },

    /**
     * 确认退出登录
     */
    confirmLogout() {
      uni.showModal({
        title: '确认退出',
        content: '退出后需要重新登录，确定要退出吗？',
        confirmText: '退出',
        confirmColor: '#ff4d4f',
        success: (res) => {
          if (res.confirm) {
            this.logout()
          }
        }
      })
    },

    /**
     * 退出登录
     */
    async logout() {
      try {
        // 清除本地存储
        uni.removeStorageSync('isLoggedIn')
        uni.removeStorageSync('username')
        uni.removeStorageSync('current_identity_id')

        // 清除 DID 服务状态
        await didService.clearCurrentIdentity()

        uni.showToast({
          title: '已退出登录',
          icon: 'success'
        })

        setTimeout(() => {
          uni.reLaunch({
            url: '/pages/login/login'
          })
        }, 1000)
      } catch (error) {
        console.error('退出登录失败:', error)
        uni.showToast({
          title: '退出失败',
          icon: 'none'
        })
      }
    }
  }
}
</script>

<style scoped>
.mine-page {
  min-height: 100vh;
  background: #f5f7fa;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(env(safe-area-inset-bottom) + 50px);
}

/* 用户头部 */
.user-header {
  position: relative;
  padding: 50px 20px 60px;
  overflow: hidden;
}

.header-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  z-index: 0;
}

.bg-pattern {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.1) 1px, transparent 1px);
  background-size: 20px 20px;
  opacity: 0.5;
}

.header-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 16px;
}

.user-avatar {
  width: 72px;
  height: 72px;
  border-radius: 36px;
  background: rgba(255, 255, 255, 0.3);
  border: 3px solid rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar-text {
  font-size: 32px;
  font-weight: bold;
  color: white;
}

.user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.username {
  font-size: 20px;
  font-weight: 600;
  color: white;
}

.user-did {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.header-actions {
  display: flex;
  gap: 12px;
}

.action-icon {
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

/* 数据统计卡片 */
.stats-card {
  margin: -30px 16px 16px;
  background: white;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-around;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.stat-number {
  font-size: 24px;
  font-weight: bold;
  color: #667eea;
}

.stat-label {
  font-size: 12px;
  color: #999;
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: #f0f0f0;
}

/* 功能滚动区 */
.functions-scroll {
  flex: 1;
  padding: 0 16px;
}

/* 快速功能网格 */
.quick-functions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.function-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.card-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.gradient-blue {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}

.gradient-purple {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.gradient-green {
  background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
}

.gradient-orange {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
}

.card-title {
  font-size: 12px;
  color: #666;
  text-align: center;
}

/* 菜单区域 */
.menu-section {
  margin-bottom: 16px;
}

.section-header {
  padding: 12px 0 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #999;
}

.menu-list {
  background: white;
  border-radius: 12px;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid #f5f5f5;
  transition: background 0.2s;
}

.menu-item:last-child {
  border-bottom: none;
}

.menu-item:active {
  background: #f8f9fa;
}

.item-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  margin-right: 12px;
  flex-shrink: 0;
}

.item-label {
  flex: 1;
  font-size: 15px;
  color: #1a1a1a;
}

.item-arrow {
  font-size: 20px;
  color: #ccc;
  font-weight: 300;
}

/* 退出登录 */
.logout-section {
  padding: 16px 0;
}

.logout-btn {
  background: white;
  border: 1px solid #ff4d4f;
  border-radius: 12px;
  padding: 14px;
  text-align: center;
}

.logout-text {
  font-size: 15px;
  font-weight: 500;
  color: #ff4d4f;
}

.logout-btn:active {
  background: #fff5f5;
}

/* 版本信息 */
.version-info {
  text-align: center;
  padding: 20px 0;
}

.version-text {
  font-size: 12px;
  color: #999;
}
</style>
