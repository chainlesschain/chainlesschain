<template>
  <view class="home-page">
    <view class="header">
      <view class="title-container">
        <image src="/static/logo.png" class="logo" />
        <text class="title">ChainlessChain</text>
      </view>
      <text class="subtitle">我的数字生活空间</text>
    </view>

    <user-card :username="username" :user-desc="userDesc" />
    <stats-card :stats="stats" />
    <quick-actions />
    <recent-section :recent-items="recentItems" />
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

.header {
  padding: 40rpx 40rpx 20rpx;
  background-color: var(--bg-card);
  border-bottom: 1rpx solid var(--border-color);
  .title-container {
    display: flex;
    align-items: center;
    gap: 16rpx;

    .logo {
      width: 50rpx;
      height: 50rpx;
    }

    .title {
      font-size: $font-size-xxl;
      font-weight: bold;
      color: var(--text-primary);
    }
  }

  .subtitle {
    font-size: $font-size-base;
    color: var(--text-secondary);
    margin-top: 8rpx;
  }
}
</style>