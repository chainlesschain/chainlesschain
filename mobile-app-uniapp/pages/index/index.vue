<template>
  <view class="home-page">
    <!-- 渐变头部 -->
    <view class="header-gradient">
      <view class="header-content">
        <view class="title-row">
          <image src="/logo.png" class="logo" mode="aspectFit" />
          <view class="title-info">
            <text class="app-title">ChainlessChain</text>
            <text class="app-subtitle">AI原生知识管理平台</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 用户卡片（悬浮效果） -->
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
  background: linear-gradient(180deg, #f8f9ff 0%, var(--bg-page) 30%);
  padding-bottom: 140rpx;
}

// 渐变头部
.header-gradient {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 0 0 80rpx 0;
  position: relative;
  overflow: hidden;

  // 装饰性背景图案
  &::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -20%;
    width: 400rpx;
    height: 400rpx;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    filter: blur(80rpx);
  }

  &::after {
    content: '';
    position: absolute;
    bottom: -30%;
    left: -10%;
    width: 300rpx;
    height: 300rpx;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 50%;
    filter: blur(60rpx);
  }

  .header-content {
    padding: 60rpx 32rpx 0;
    position: relative;
    z-index: 1;

    .title-row {
      display: flex;
      align-items: center;
      gap: 20rpx;

      .logo {
        width: 80rpx;
        height: 80rpx;
        border-radius: 20rpx;
        background-color: rgba(255, 255, 255, 0.2);
        padding: 8rpx;
        box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.15);
      }

      .title-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8rpx;

        .app-title {
          font-size: 40rpx;
          font-weight: bold;
          color: #ffffff;
          letter-spacing: 1rpx;
        }

        .app-subtitle {
          font-size: 24rpx;
          color: rgba(255, 255, 255, 0.85);
          letter-spacing: 0.5rpx;
        }
      }
    }
  }
}

// 内容容器
.container {
  position: relative;
  margin-top: -60rpx;
  padding: 0 24rpx;
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
  box-shadow: 0 4rpx 20rpx rgba(102, 126, 234, 0.08);
  margin-bottom: 24rpx;
}

// 最近访问包装
.recent-wrapper {
  background-color: var(--bg-card);
  border-radius: 24rpx;
  padding: 32rpx 24rpx;
  box-shadow: 0 4rpx 20rpx rgba(102, 126, 234, 0.08);
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
