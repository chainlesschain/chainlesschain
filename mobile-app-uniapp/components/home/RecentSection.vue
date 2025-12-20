<template>
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
</template>

<script>
export default {
  props: {
    recentItems: {
      type: Array,
      default: () => []
    }
  },
  methods: {
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

    goToDetail(id) {
      uni.navigateTo({
        url: `/pages/knowledge/detail/detail?id=${id}`
      })
    }
  }
}
</script>

<style lang="scss" scoped>
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
