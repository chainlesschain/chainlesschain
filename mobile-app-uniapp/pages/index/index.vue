<template>
  <view class="home-page">
    <view class="container">
      <user-card :username="username" :user-desc="userDesc" />

      <!-- 统计卡片 -->
      <stats-card :stats="stats" />

      <!-- 快捷功能 -->
      <view class="quick-actions-wrapper">
        <view class="section-header">
          <text class="section-title">✨ 快捷功能</text>
          <text class="section-subtitle">快速访问常用功能</text>
        </view>
        <quick-actions />
      </view>

      <!-- 最近访问 -->
      <view class="recent-wrapper">
        <view class="section-header">
          <text class="section-title">🕒 最近访问</text>
          <text class="section-subtitle">继续您的工作</text>
        </view>
        <recent-section :recent-items="recentItems" />
      </view>

      <!-- 底部装饰 -->
      <view class="footer-decoration">
        <text class="footer-text">ChainlessChain © 2025</text>
        <text class="footer-slogan">去中心化 · 隐私优先 · AI增强</text>
      </view>
    </view>
  </view>
</template>

<script>
import UserCard from '@/components/home/UserCard.vue'
import StatsCard from '@/components/home/StatsCard.vue'
import QuickActions from '@/components/home/QuickActions.vue'
import RecentSection from '@/components/home/RecentSection.vue'
import { db } from '@/services/database'

export default {
  components: {
    UserCard,
    StatsCard,
    QuickActions,
    RecentSection
  },
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
    const userProfile = uni.getStorageSync('user_profile')
    if (userProfile) {
      try {
        const profile = JSON.parse(userProfile)
        this.username = profile.nickname || 'ChainlessChain 用户'
        if (profile.bio) {
          this.userDesc = profile.bio
        }
      } catch (error) {
        console.error('解析用户信息失败:', error)
      }
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
    }
  }
}
</script>

<style lang="scss" scoped>
.home-page {
  min-height: 100vh;
  background: var(--bg-page);
  padding-bottom: 140rpx;
}

// 内容容器
.container {
  padding: 24rpx;
}

// Section 头部
.section-header {
  margin: 48rpx 0 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;

  .section-title {
    font-size: 36rpx;
    font-weight: bold;
    color: var(--text-primary);
    letter-spacing: 0.5rpx;
  }

  .section-subtitle {
    font-size: 24rpx;
    color: var(--text-tertiary);
  }
}

// 快捷功能包装
.quick-actions-wrapper {
  background-color: var(--bg-card);
  border-radius: 24rpx;
  padding: 32rpx 24rpx;
  box-shadow: var(--shadow-md);
  margin-bottom: 24rpx;
}

// 最近访问包装
.recent-wrapper {
  background-color: var(--bg-card);
  border-radius: 24rpx;
  padding: 32rpx 24rpx;
  box-shadow: var(--shadow-md);
  margin-bottom: 32rpx;
}

// 底部装饰
.footer-decoration {
  padding: 60rpx 0 40rpx;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12rpx;

  .footer-text {
    font-size: 24rpx;
    color: var(--text-tertiary);
  }

  .footer-slogan {
    font-size: 22rpx;
    color: var(--text-quaternary);
    letter-spacing: 1rpx;
  }
}
</style>
