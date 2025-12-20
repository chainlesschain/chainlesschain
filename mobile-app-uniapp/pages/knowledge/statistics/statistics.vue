<template>
  <view class="statistics-page">
    <view class="loading" v-if="loading">
      <text>加载中...</text>
    </view>

    <view class="content" v-else>
      <!-- 总览卡片 -->
      <view class="overview-cards">
        <view class="card">
          <text class="card-icon">📚</text>
          <text class="card-value">{{ stats.total }}</text>
          <text class="card-label">知识总数</text>
        </view>

        <view class="card">
          <text class="card-icon">⭐</text>
          <text class="card-value">{{ stats.favorites }}</text>
          <text class="card-label">已收藏</text>
        </view>

        <view class="card">
          <text class="card-icon">🏷️</text>
          <text class="card-value">{{ stats.byTag.length }}</text>
          <text class="card-label">标签数</text>
        </view>

        <view class="card">
          <text class="card-icon">📈</text>
          <text class="card-value">{{ monthlyGrowth }}</text>
          <text class="card-label">本月新增</text>
        </view>
      </view>

      <!-- 类型分布 -->
      <view class="section" v-if="Object.keys(stats.byType).length > 0">
        <view class="section-header">
          <text class="section-title">📊 类型分布</text>
        </view>
        <view class="type-chart">
          <view
            class="type-item"
            v-for="(count, type) in stats.byType"
            :key="type"
          >
            <view class="type-info">
              <text class="type-label">{{ getTypeLabel(type) }}</text>
              <text class="type-count">{{ count }}</text>
            </view>
            <view class="type-bar-container">
              <view
                class="type-bar"
                :style="{ width: (count / stats.total * 100) + '%', backgroundColor: getTypeColor(type) }"
              ></view>
            </view>
            <text class="type-percent">{{ Math.round(count / stats.total * 100) }}%</text>
          </view>
        </view>
      </view>

      <!-- 标签分布 -->
      <view class="section" v-if="stats.byTag.length > 0">
        <view class="section-header">
          <text class="section-title">🏷️ 热门标签</text>
        </view>
        <view class="tag-chart">
          <view
            class="tag-item"
            v-for="tag in topTags"
            :key="tag.id"
          >
            <view class="tag-dot" :style="{ backgroundColor: tag.color }"></view>
            <text class="tag-name">{{ tag.name }}</text>
            <text class="tag-count">{{ tag.count }}</text>
            <view class="tag-bar-container">
              <view
                class="tag-bar"
                :style="{ width: (tag.count / maxTagCount * 100) + '%', backgroundColor: tag.color + '40' }"
              ></view>
            </view>
          </view>
        </view>
      </view>

      <!-- 创建趋势 -->
      <view class="section" v-if="stats.creationTrend.length > 0">
        <view class="section-header">
          <text class="section-title">📈 创建趋势</text>
          <text class="section-subtitle">最近6个月</text>
        </view>
        <view class="trend-chart">
          <view class="trend-bars">
            <view
              class="trend-bar-wrapper"
              v-for="item in stats.creationTrend"
              :key="item.month"
            >
              <view class="trend-bar-container">
                <view
                  class="trend-bar"
                  :style="{ height: (item.count / maxTrendCount * 100) + '%' }"
                ></view>
              </view>
              <text class="trend-count">{{ item.count }}</text>
              <text class="trend-label">{{ formatMonth(item.month) }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 最近活动 -->
      <view class="section" v-if="stats.recentActivity.length > 0">
        <view class="section-header">
          <text class="section-title">🕐 最近活动</text>
          <text class="section-subtitle">最近7天</text>
        </view>
        <view class="activity-list">
          <view
            class="activity-item"
            v-for="item in stats.recentActivity"
            :key="item.id"
            @click="goToDetail(item.id)"
          >
            <view class="activity-icon" :class="'type-' + item.type">
              {{ getTypeIcon(item.type) }}
            </view>
            <view class="activity-content">
              <text class="activity-title">{{ item.title }}</text>
              <text class="activity-time">{{ formatTime(item.updated_at) }}</text>
            </view>
            <text class="activity-arrow">›</text>
          </view>
        </view>
      </view>

      <!-- 空状态 -->
      <view class="empty" v-if="stats.total === 0">
        <text class="empty-icon">📊</text>
        <text class="empty-text">还没有知识条目，快去创建吧</text>
      </view>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      loading: true,
      stats: {
        total: 0,
        favorites: 0,
        byType: {},
        byTag: [],
        recentActivity: [],
        creationTrend: []
      }
    }
  },
  computed: {
    monthlyGrowth() {
      if (this.stats.creationTrend.length === 0) return 0
      const lastMonth = this.stats.creationTrend[this.stats.creationTrend.length - 1]
      return lastMonth ? lastMonth.count : 0
    },
    topTags() {
      return this.stats.byTag
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
    },
    maxTagCount() {
      if (this.topTags.length === 0) return 1
      return Math.max(...this.topTags.map(tag => tag.count))
    },
    maxTrendCount() {
      if (this.stats.creationTrend.length === 0) return 1
      return Math.max(...this.stats.creationTrend.map(item => item.count), 1)
    }
  },
  onLoad() {
    this.loadStatistics()
  },
  onPullDownRefresh() {
    this.loadStatistics()
      .then(() => {
        uni.stopPullDownRefresh()
      })
  },
  methods: {
    async loadStatistics() {
      this.loading = true
      try {
        this.stats = await db.getKnowledgeStatistics()
      } catch (error) {
        console.error('加载统计数据失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },
    getTypeLabel(type) {
      const labels = {
        note: '笔记',
        document: '文档',
        conversation: '对话',
        web_clip: '网页摘录'
      }
      return labels[type] || type
    },
    getTypeIcon(type) {
      const icons = {
        note: '📝',
        document: '📄',
        conversation: '💬',
        web_clip: '🌐'
      }
      return icons[type] || '📄'
    },
    getTypeColor(type) {
      const colors = {
        note: '#1890ff',
        document: '#52c41a',
        conversation: '#fa8c16',
        web_clip: '#722ed1'
      }
      return colors[type] || '#999999'
    },
    formatMonth(monthStr) {
      const [year, month] = monthStr.split('-')
      return `${month}月`
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
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${month}-${day}`
      }
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
.statistics-page {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 40rpx;
}

.loading {
  padding: 100rpx 40rpx;
  text-align: center;
  color: var(--text-tertiary);
}

.content {
  padding: 20rpx;
}

// 总览卡片
.overview-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20rpx;
  margin-bottom: 20rpx;

  .card {
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12rpx;

    .card-icon {
      font-size: 24px;
    }

    .card-value {
      font-size: 24px;
      font-weight: bold;
      color: var(--text-primary);
    }

    .card-label {
      font-size: 12px;
      color: var(--text-tertiary);
    }
  }
}

// 章节
.section {
  background-color: var(--bg-card);
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24rpx;

    .section-title {
      font-size: 16px;
      font-weight: bold;
      color: var(--text-primary);
    }

    .section-subtitle {
      font-size: 12px;
      color: var(--text-tertiary);
    }
  }
}

// 类型图表
.type-chart {
  .type-item {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 24rpx;

    &:last-child {
      margin-bottom: 0;
    }

    .type-info {
      width: 120rpx;
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;

      .type-label {
        font-size: 13px;
        color: var(--text-secondary);
      }

      .type-count {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary);
      }
    }

    .type-bar-container {
      flex: 1;
      height: 32rpx;
      background-color: var(--bg-input);
      border-radius: 16rpx;
      overflow: hidden;

      .type-bar {
        height: 100%;
        border-radius: 16rpx;
        transition: width 0.3s;
      }
    }

    .type-percent {
      width: 60rpx;
      text-align: right;
      font-size: 12px;
      color: var(--text-tertiary);
      flex-shrink: 0;
    }
  }
}

// 标签图表
.tag-chart {
  .tag-item {
    display: flex;
    align-items: center;
    gap: 12rpx;
    margin-bottom: 20rpx;

    &:last-child {
      margin-bottom: 0;
    }

    .tag-dot {
      width: 16rpx;
      height: 16rpx;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .tag-name {
      width: 120rpx;
      font-size: 13px;
      color: var(--text-secondary);
      flex-shrink: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tag-count {
      width: 50rpx;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-primary);
      text-align: right;
      flex-shrink: 0;
    }

    .tag-bar-container {
      flex: 1;
      height: 24rpx;
      position: relative;

      .tag-bar {
        height: 100%;
        border-radius: 12rpx;
        transition: width 0.3s;
      }
    }
  }
}

// 趋势图表
.trend-chart {
  .trend-bars {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8rpx;
    height: 300rpx;
    padding-top: 20rpx;

    .trend-bar-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8rpx;

      .trend-bar-container {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: flex-end;
        justify-content: center;

        .trend-bar {
          width: 70%;
          min-height: 8rpx;
          background: linear-gradient(180deg, #3cc51f 0%, #52c41a 100%);
          border-radius: 8rpx 8rpx 0 0;
          transition: height 0.3s;
        }
      }

      .trend-count {
        font-size: 11px;
        color: var(--text-primary);
        font-weight: 500;
      }

      .trend-label {
        font-size: 10px;
        color: var(--text-tertiary);
      }
    }
  }
}

// 活动列表
.activity-list {
  .activity-item {
    display: flex;
    align-items: center;
    gap: 16rpx;
    padding: 20rpx 0;
    border-bottom: 1rpx solid var(--border-light);

    &:last-child {
      border-bottom: none;
    }

    .activity-icon {
      width: 72rpx;
      height: 72rpx;
      border-radius: 12rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;

      &.type-note {
        background-color: #e6f7ff;
      }

      &.type-document {
        background-color: #f6ffed;
      }

      &.type-conversation {
        background-color: #fff7e6;
      }

      &.type-web_clip {
        background-color: #f9f0ff;
      }
    }

    .activity-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8rpx;
      overflow: hidden;

      .activity-title {
        font-size: 14px;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .activity-time {
        font-size: 12px;
        color: var(--text-tertiary);
      }
    }

    .activity-arrow {
      font-size: 20px;
      color: var(--text-tertiary);
      flex-shrink: 0;
    }
  }
}

// 空状态
.empty {
  text-align: center;
  padding: 100rpx 40rpx;

  .empty-icon {
    display: block;
    font-size: 60px;
    margin-bottom: 20rpx;
  }

  .empty-text {
    font-size: 14px;
    color: var(--text-secondary);
  }
}
</style>
