<template>
  <view class="knowledge-list">
    <view class="header">
      <input
        class="search-input"
        type="text"
        v-model="searchQuery"
        placeholder="搜索知识库..."
        @input="handleSearch"
      />
    </view>

    <view class="list-container">
      <view class="loading" v-if="loading">
        <text>加载中...</text>
      </view>

      <view class="empty" v-else-if="items.length === 0">
        <text class="empty-icon">📝</text>
        <text class="empty-text">暂无知识条目</text>
        <button class="add-btn" @click="goToAdd">添加第一个条目</button>
      </view>

      <view class="item" v-for="item in items" :key="item.id" @click="goToDetail(item.id)">
        <text class="item-title">{{ item.title }}</text>
        <text class="item-content">{{ item.content }}</text>
        <text class="item-time">{{ formatTime(item.updated_at) }}</text>
      </view>
    </view>

    <view class="fab" @click="goToAdd">
      <text class="fab-icon">+</text>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      searchQuery: '',
      items: [],
      loading: false
    }
  },
  onLoad() {
    this.loadItems()
  },
  onShow() {
    // 页面显示时重新加载，确保新添加的条目能显示
    this.loadItems()
  },
  onPullDownRefresh() {
    this.loadItems().then(() => {
      uni.stopPullDownRefresh()
    })
  },
  methods: {
    async loadItems() {
      this.loading = true
      try {
        const result = await db.getKnowledgeItems({
          searchQuery: this.searchQuery,
          limit: 50
        })
        this.items = result || []
      } catch (error) {
        console.error('加载知识库失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },
    handleSearch() {
      // 防抖搜索
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => {
        this.loadItems()
      }, 300)
    },
    goToDetail(id) {
      uni.navigateTo({
        url: `/pages/knowledge/detail/detail?id=${id}`
      })
    },
    goToAdd() {
      uni.navigateTo({
        url: '/pages/knowledge/edit/edit'
      })
    },
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`

      return `${date.getMonth() + 1}/${date.getDate()}`
    }
  }
}
</script>

<style lang="scss" scoped>
.knowledge-list {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 100rpx;
}

.header {
  padding: 24rpx;
  background-color: var(--bg-card);
  box-shadow: var(--shadow-sm);

  .search-input {
    width: 100%;
    height: 72rpx;
    background-color: var(--bg-input);
    color: var(--text-primary);
    border-radius: 36rpx;
    padding: 0 32rpx;
    font-size: 28rpx;
  }
}

.list-container {
  padding: 24rpx;
}

.loading, .empty {
  text-align: center;
  padding: 100rpx 40rpx;
  color: var(--text-tertiary);
}

.empty-icon {
  display: block;
  font-size: 120rpx;
  margin-bottom: 20rpx;
}

.empty-text {
  display: block;
  font-size: 28rpx;
  color: var(--text-secondary);
  margin-bottom: 40rpx;
}

.add-btn {
  background-color: var(--color-primary);
  color: var(--text-inverse);
  border-radius: 48rpx;
  padding: 20rpx 60rpx;
  font-size: 28rpx;
  border: none;
}

.item {
  background-color: var(--bg-card);
  border-radius: 12rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);

  .item-title {
    display: block;
    font-size: 32rpx;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: 16rpx;
  }

  .item-content {
    display: block;
    font-size: 26rpx;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 16rpx;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .item-time {
    font-size: 24rpx;
    color: var(--text-tertiary);
  }
}

.fab {
  position: fixed;
  right: 40rpx;
  bottom: 120rpx;
  width: 112rpx;
  height: 112rpx;
  background-color: var(--color-primary);
  border-radius: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(60, 197, 31, 0.4);

  .fab-icon {
    font-size: 60rpx;
    color: var(--text-inverse);
    line-height: 1;
  }
}
</style>
