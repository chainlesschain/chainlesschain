<template>
  <view class="mine-page">
    <!-- 用户信息头部 -->
    <view class="user-header">
      <view class="user-avatar">
        <text class="avatar-text">{{ avatarText }}</text>
      </view>
      <view class="user-info">
        <text class="username">{{ username }}</text>
        <text class="user-id">ID: {{ userId }}</text>
      </view>
      <view class="edit-profile" @click="editProfile">
        <text>编辑</text>
      </view>
    </view>

    <!-- 数据统计 -->
    <view class="stats-section">
      <view class="stat-card" @click="goToKnowledge">
        <text class="stat-number">{{ stats.knowledge }}</text>
        <text class="stat-label">知识</text>
      </view>
      <view class="stat-card" @click="goToKnowledge">
        <text class="stat-number">{{ stats.favorites }}</text>
        <text class="stat-label">收藏</text>
      </view>
      <view class="stat-card" @click="goToFolders">
        <text class="stat-number">{{ stats.folders }}</text>
        <text class="stat-label">文件夹</text>
      </view>
      <view class="stat-card" @click="goToFriends">
        <text class="stat-number">{{ stats.friends }}</text>
        <text class="stat-label">好友</text>
      </view>
    </view>

    <!-- 功能菜单 -->
    <view class="menu-section">
      <text class="section-title">知识管理</text>
      <view class="menu-group">
        <view class="menu-item" @click="goToKnowledge">
          <view class="menu-icon">📚</view>
          <text class="menu-label">我的知识库</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-item" @click="goToFolders">
          <view class="menu-icon">📁</view>
          <text class="menu-label">文件夹管理</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-item" @click="goToStatistics">
          <view class="menu-icon">📊</view>
          <text class="menu-label">数据统计</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="menu-section">
      <text class="section-title">AI 功能</text>
      <view class="menu-group">
        <view class="menu-item" @click="goToChat">
          <view class="menu-icon">🤖</view>
          <text class="menu-label">AI 助手</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="menu-section">
      <text class="section-title">社交互动</text>
      <view class="menu-group">
        <view class="menu-item" @click="goToFriends">
          <view class="menu-icon">👥</view>
          <text class="menu-label">好友</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-item" @click="goToPosts">
          <view class="menu-icon">📱</view>
          <text class="menu-label">动态</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-item" @click="goToMessages">
          <view class="menu-icon">💬</view>
          <text class="menu-label">消息</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="menu-section">
      <text class="section-title">交易市场</text>
      <view class="menu-group">
        <view class="menu-item" @click="goToMarket">
          <view class="menu-icon">🛒</view>
          <text class="menu-label">知识市场</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-item" @click="goToOrders">
          <view class="menu-icon">📦</view>
          <text class="menu-label">我的订单</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-item" @click="goToAssets">
          <view class="menu-icon">💰</view>
          <text class="menu-label">我的资产</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="menu-section">
      <text class="section-title">数据与安全</text>
      <view class="menu-group">
        <view class="menu-item" @click="goToBackup">
          <view class="menu-icon">☁️</view>
          <text class="menu-label">数据备份</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-item" @click="goToCloudSync">
          <view class="menu-icon">🔄</view>
          <text class="menu-label">云同步设置</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="menu-section">
      <text class="section-title">设置</text>
      <view class="menu-group">
        <view class="menu-item" @click="goToSettings">
          <view class="menu-icon">⚙️</view>
          <text class="menu-label">应用设置</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-item" @click="showAbout">
          <view class="menu-icon">ℹ️</view>
          <text class="menu-label">关于我们</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- 退出登录按钮 -->
    <view class="logout-section">
      <button class="logout-btn" @click="confirmLogout">
        <text>退出登录</text>
      </button>
    </view>

    <!-- 版本信息 -->
    <view class="version-info">
      <text>ChainlessChain v1.0.0</text>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      username: 'ChainlessChain 用户',
      userId: 'CLC_' + Date.now().toString(36),
      stats: {
        knowledge: 0,
        favorites: 0,
        folders: 0,
        friends: 0
      }
    }
  },
  computed: {
    avatarText() {
      return this.username.charAt(0).toUpperCase()
    }
  },
  onLoad() {
    this.loadUserInfo()
    this.loadStats()
  },
  onShow() {
    this.loadStats()
  },
  methods: {
    loadUserInfo() {
      const savedUsername = uni.getStorageSync('username')
      if (savedUsername) {
        this.username = savedUsername
      }

      const savedUserId = uni.getStorageSync('userId')
      if (savedUserId) {
        this.userId = savedUserId
      } else {
        // 生成并保存用户ID
        uni.setStorageSync('userId', this.userId)
      }
    },

    async loadStats() {
      try {
        const knowledgeStats = await db.getKnowledgeStatistics()
        this.stats.knowledge = knowledgeStats.total || 0
        this.stats.favorites = knowledgeStats.favorites || 0

        const folders = await db.getFolders()
        this.stats.folders = folders.length

        // TODO: 加载好友数量
        this.stats.friends = 0
      } catch (error) {
        console.error('加载统计数据失败:', error)
      }
    },

    editProfile() {
      uni.showModal({
        title: '编辑资料',
        editable: true,
        placeholderText: '请输入昵称',
        success: (res) => {
          if (res.confirm && res.content) {
            this.username = res.content
            uni.setStorageSync('username', res.content)
            uni.showToast({
              title: '保存成功',
              icon: 'success'
            })
          }
        }
      })
    },

    goToKnowledge() {
      uni.switchTab({
        url: '/pages/knowledge/list/list'
      })
    },

    goToFolders() {
      uni.navigateTo({
        url: '/pages/knowledge/folders/folders'
      })
    },

    goToStatistics() {
      uni.navigateTo({
        url: '/pages/knowledge/statistics/statistics'
      })
    },

    goToChat() {
      uni.navigateTo({
        url: '/pages/chat/chat'
      })
    },

    goToFriends() {
      uni.navigateTo({
        url: '/pages/social/friends/friends'
      })
    },

    goToPosts() {
      uni.navigateTo({
        url: '/pages/social/posts/posts'
      })
    },

    goToMessages() {
      uni.navigateTo({
        url: '/pages/social/messages/messages'
      })
    },

    goToMarket() {
      uni.navigateTo({
        url: '/pages/trade/market/market'
      })
    },

    goToOrders() {
      uni.navigateTo({
        url: '/pages/trade/orders/orders'
      })
    },

    goToAssets() {
      uni.navigateTo({
        url: '/pages/trade/assets/assets'
      })
    },

    goToBackup() {
      uni.navigateTo({
        url: '/pages/backup/backup'
      })
    },

    goToCloudSync() {
      uni.navigateTo({
        url: '/pages/backup/cloud-sync'
      })
    },

    goToSettings() {
      uni.navigateTo({
        url: '/pages/settings/settings'
      })
    },

    showAbout() {
      uni.showModal({
        title: '关于 ChainlessChain',
        content: 'ChainlessChain 是一个去中心化的知识管理平台，致力于保护用户隐私，提供 AI 原生的知识管理体验。\n\n版本：v1.0.0',
        confirmText: '知道了',
        showCancel: false
      })
    },

    confirmLogout() {
      uni.showModal({
        title: '确认退出',
        content: '退出后需要重新登录，确定要退出吗？',
        success: (res) => {
          if (res.confirm) {
            this.logout()
          }
        }
      })
    },

    logout() {
      uni.removeStorageSync('isLoggedIn')
      uni.removeStorageSync('username')

      uni.showToast({
        title: '已退出登录',
        icon: 'success'
      })

      setTimeout(() => {
        uni.reLaunch({
          url: '/pages/login/login'
        })
      }, 1000)
    }
  }
}
</script>

<style lang="scss" scoped>
.mine-page {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 120rpx;
}

// 用户信息头部
.user-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 60rpx 40rpx 40rpx;
  display: flex;
  align-items: center;
  gap: 24rpx;

  .user-avatar {
    width: 120rpx;
    height: 120rpx;
    border-radius: 60rpx;
    background-color: rgba(255, 255, 255, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    .avatar-text {
      font-size: 48rpx;
      font-weight: bold;
      color: #ffffff;
    }
  }

  .user-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;

    .username {
      font-size: 36rpx;
      font-weight: bold;
      color: #ffffff;
    }

    .user-id {
      font-size: 24rpx;
      color: rgba(255, 255, 255, 0.7);
    }
  }

  .edit-profile {
    padding: 12rpx 24rpx;
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 32rpx;
    font-size: 24rpx;
    color: #ffffff;
  }
}

// 数据统计
.stats-section {
  margin: -40rpx 40rpx 32rpx;
  background-color: var(--bg-card);
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: var(--shadow-md);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16rpx;

  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8rpx;
    padding: 16rpx 0;

    .stat-number {
      font-size: 40rpx;
      font-weight: bold;
      color: var(--color-primary);
    }

    .stat-label {
      font-size: 22rpx;
      color: var(--text-secondary);
    }
  }
}

// 功能菜单
.menu-section {
  margin: 0 0 32rpx;

  .section-title {
    display: block;
    font-size: 28rpx;
    font-weight: 500;
    color: var(--text-tertiary);
    padding: 0 40rpx 16rpx;
  }

  .menu-group {
    background-color: var(--bg-card);
    overflow: hidden;

    .menu-item {
      display: flex;
      align-items: center;
      padding: 28rpx 40rpx;
      border-bottom: 1rpx solid var(--border-color);

      &:last-child {
        border-bottom: none;
      }

      &:active {
        background-color: var(--bg-hover);
      }

      .menu-icon {
        width: 64rpx;
        height: 64rpx;
        border-radius: 12rpx;
        background-color: var(--bg-input);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 36rpx;
        margin-right: 20rpx;
        flex-shrink: 0;
      }

      .menu-label {
        flex: 1;
        font-size: 28rpx;
        color: var(--text-primary);
      }

      .menu-arrow {
        font-size: 40rpx;
        color: var(--text-tertiary);
        font-weight: 300;
      }
    }
  }
}

// 退出登录
.logout-section {
  padding: 0 40rpx 32rpx;

  .logout-btn {
    width: 100%;
    height: 88rpx;
    background-color: var(--bg-card);
    border: 2rpx solid #f5222d;
    border-radius: 44rpx;
    color: #f5222d;
    font-size: 30rpx;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;

    &::after {
      border: none;
    }

    &:active {
      background-color: rgba(245, 34, 45, 0.1);
    }
  }
}

// 版本信息
.version-info {
  text-align: center;
  padding: 20rpx;
  font-size: 22rpx;
  color: var(--text-tertiary);
}
</style>
