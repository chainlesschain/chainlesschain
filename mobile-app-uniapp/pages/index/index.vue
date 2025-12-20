<template>
  <view class="home-page">
    <!-- 顶部用户信息卡片 -->
    <view class="user-card">
      <view class="user-info">
        <view class="avatar">
          <text class="avatar-text">{{ avatarText }}</text>
        </view>
        <view class="user-details">
          <text class="username">{{ username }}</text>
          <text class="user-desc">{{ userDesc }}</text>
        </view>
      </view>
      <view class="settings-icon" @click="goToSettings">
        <text>⚙️</text>
      </view>
    </view>

    <!-- 数据统计卡片 -->
    <view class="stats-card">
      <view class="stat-item" @click="goToKnowledge">
        <text class="stat-value">{{ stats.knowledge }}</text>
        <text class="stat-label">知识</text>
      </view>
      <view class="stat-divider"></view>
      <view class="stat-item" @click="goToKnowledge">
        <text class="stat-value">{{ stats.favorites }}</text>
        <text class="stat-label">收藏</text>
      </view>
      <view class="stat-divider"></view>
      <view class="stat-item" @click="goToFolders">
        <text class="stat-value">{{ stats.folders }}</text>
        <text class="stat-label">文件夹</text>
      </view>
    </view>

    <!-- 快捷功能入口 -->
    <view class="quick-actions">
      <text class="section-title">快捷功能</text>
      <view class="action-grid">
        <view class="action-item" @click="goToKnowledge">
          <view class="action-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <text>📚</text>
          </view>
          <text class="action-label">知识库</text>
        </view>

        <view class="action-item" @click="goToChat">
          <view class="action-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
            <text>🤖</text>
          </view>
          <text class="action-label">AI助手</text>
        </view>

        <view class="action-item" @click="goToFolders">
          <view class="action-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
            <text>📁</text>
          </view>
          <text class="action-label">文件夹</text>
        </view>

        <view class="action-item" @click="goToStatistics">
          <view class="action-icon" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);">
            <text>📊</text>
          </view>
          <text class="action-label">统计分析</text>
        </view>

        <view class="action-item" @click="goToSocial">
          <view class="action-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
            <text>👥</text>
          </view>
          <text class="action-label">社交</text>
        </view>

        <view class="action-item" @click="goToMarket">
          <view class="action-icon" style="background: linear-gradient(135deg, #30cfd0 0%, #330867 100%);">
            <text>💰</text>
          </view>
          <text class="action-label">交易市场</text>
        </view>

        <view class="action-item" @click="goToBackup">
          <view class="action-icon" style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);">
            <text>☁️</text>
          </view>
          <text class="action-label">数据备份</text>
        </view>

        <view class="action-item" @click="goToSettings">
          <view class="action-icon" style="background: linear-gradient(135deg, #d299c2 0%, #fef9d7 100%);">
            <text>⚙️</text>
          </view>
          <text class="action-label">设置</text>
        </view>
      </view>
    </view>

    <!-- 最近使用 -->
    <view class="recent-section" v-if="recentItems.length > 0">
      <text class="section-title">最近浏览</text>
      <view class="recent-list">
        <view
          class="recent-item"
          v-for="item in recentItems"
          :key="item.id"
          @click="goToDetail(item.id)"
        >
          <view class="recent-icon">
            <text>{{ getTypeIcon(item.type) }}</text>
          </view>
          <view class="recent-content">
            <text class="recent-title">{{ item.title }}</text>
            <text class="recent-time">{{ formatTime(item.updated_at) }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      username: 'ChainlessChain 用户',
      userDesc: '去中心化 · 隐私优先',
      stats: {
        knowledge: 0,
        favorites: 0,
        folders: 0
      },
      recentItems: []
    }
  },
  computed: {
    avatarText() {
      return this.username.charAt(0).toUpperCase()
    }
  },
  onLoad() {
    // 检查登录状态
    const isLoggedIn = uni.getStorageSync('isLoggedIn')
    if (!isLoggedIn) {
      uni.reLaunch({
        url: '/pages/login/login'
      })
      return
    }

    // 加载用户信息
    const savedUsername = uni.getStorageSync('username')
    if (savedUsername) {
      this.username = savedUsername
    }

    this.loadStats()
    this.loadRecentItems()
  },
  onShow() {
    // 每次显示页面时刷新统计数据
    this.loadStats()
    this.loadRecentItems()
  },
  methods: {
    async loadStats() {
      try {
        const stats = await db.getKnowledgeStatistics()
        this.stats.knowledge = stats.total || 0
        this.stats.favorites = stats.favorites || 0

        const folders = await db.getFolders()
        this.stats.folders = folders.length
      } catch (error) {
        console.error('加载统计数据失败:', error)
      }
    },

    async loadRecentItems() {
      try {
        const items = await db.getKnowledgeItems({ limit: 5 })
        this.recentItems = items || []
      } catch (error) {
        console.error('加载最近项目失败:', error)
      }
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
      const now = new Date()
      const diff = now - date

      if (diff < 60000) {
        return '刚刚'
      } else if (diff < 3600000) {
        return `${Math.floor(diff / 60000)}分钟前`
      } else if (diff < 86400000) {
        return `${Math.floor(diff / 3600000)}小时前`
      } else if (diff < 604800000) {
        return `${Math.floor(diff / 86400000)}天前`
      } else {
        return `${date.getMonth() + 1}/${date.getDate()}`
      }
    },

    goToKnowledge() {
      uni.switchTab({
        url: '/pages/knowledge/list/list'
      })
    },

    goToChat() {
      uni.navigateTo({
        url: '/pages/chat/chat'
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

    goToSocial() {
      uni.navigateTo({
        url: '/pages/social/friends/friends'
      })
    },

    goToMarket() {
      uni.navigateTo({
        url: '/pages/trade/market/market'
      })
    },

    goToBackup() {
      uni.navigateTo({
        url: '/pages/backup/backup'
      })
    },

    goToSettings() {
      uni.switchTab({
        url: '/pages/mine/mine'
      })
    },

    goToDetail(id) {
      uni.navigateTo({
        url: `/pages/knowledge/detail/detail?id=${id}`
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.home-page {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 120rpx;
}

// 用户信息卡片
.user-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 60rpx 40rpx 40rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .user-info {
    display: flex;
    align-items: center;
    gap: 24rpx;

    .avatar {
      width: 100rpx;
      height: 100rpx;
      border-radius: 50rpx;
      background-color: rgba(255, 255, 255, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;

      .avatar-text {
        font-size: 40rpx;
        font-weight: bold;
        color: #ffffff;
      }
    }

    .user-details {
      display: flex;
      flex-direction: column;
      gap: 8rpx;

      .username {
        font-size: 36rpx;
        font-weight: bold;
        color: #ffffff;
      }

      .user-desc {
        font-size: 24rpx;
        color: rgba(255, 255, 255, 0.8);
      }
    }
  }

  .settings-icon {
    font-size: 48rpx;
    width: 80rpx;
    height: 80rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 40rpx;
  }
}

// 统计卡片
.stats-card {
  margin: -40rpx 40rpx 32rpx;
  background-color: var(--bg-card);
  border-radius: 16rpx;
  padding: 32rpx 0;
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: center;
  justify-content: space-around;

  .stat-item {
    flex: 1;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 8rpx;

    .stat-value {
      font-size: 48rpx;
      font-weight: bold;
      color: var(--color-primary);
    }

    .stat-label {
      font-size: 24rpx;
      color: var(--text-secondary);
    }
  }

  .stat-divider {
    width: 2rpx;
    height: 60rpx;
    background-color: var(--border-color);
  }
}

// 快捷功能
.quick-actions {
  padding: 0 40rpx 32rpx;

  .section-title {
    display: block;
    font-size: 32rpx;
    font-weight: bold;
    color: var(--text-primary);
    margin-bottom: 24rpx;
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24rpx;

    .action-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12rpx;

      .action-icon {
        width: 96rpx;
        height: 96rpx;
        border-radius: 24rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 48rpx;
        box-shadow: 0 8rpx 16rpx rgba(0, 0, 0, 0.1);

        &:active {
          transform: scale(0.95);
        }
      }

      .action-label {
        font-size: 22rpx;
        color: var(--text-secondary);
        text-align: center;
      }
    }
  }
}

// 最近使用
.recent-section {
  padding: 0 40rpx;

  .section-title {
    display: block;
    font-size: 32rpx;
    font-weight: bold;
    color: var(--text-primary);
    margin-bottom: 24rpx;
  }

  .recent-list {
    background-color: var(--bg-card);
    border-radius: 16rpx;
    overflow: hidden;

    .recent-item {
      display: flex;
      align-items: center;
      gap: 20rpx;
      padding: 24rpx;
      border-bottom: 1rpx solid var(--border-color);

      &:last-child {
        border-bottom: none;
      }

      &:active {
        background-color: var(--bg-hover);
      }

      .recent-icon {
        width: 72rpx;
        height: 72rpx;
        border-radius: 12rpx;
        background-color: var(--bg-input);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 36rpx;
        flex-shrink: 0;
      }

      .recent-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8rpx;
        overflow: hidden;

        .recent-title {
          font-size: 28rpx;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .recent-time {
          font-size: 22rpx;
          color: var(--text-tertiary);
        }
      }
    }
  }
}
</style>
