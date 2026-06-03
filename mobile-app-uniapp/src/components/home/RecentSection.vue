<template>
  <view class="recent-section">
    <view class="empty" v-if="recentItems.length === 0">
      <text class="empty-icon">📭</text>
      <text class="empty-text">暂无最近访问</text>
    </view>
    <view class="recent-list" v-else>
      <view
        class="recent-item"
        v-for="item in recentItems"
        :key="item.id"
        @click="goToDetail(item.id)"
      >
        <view class="recent-icon">
          <text class="icon-emoji">{{ getTypeIcon(item.type) }}</text>
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
        'web_clip': '🔗'
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
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 60rpx 0;

    .empty-icon {
      font-size: 80rpx;
      margin-bottom: 16rpx;
      opacity: 0.5;
    }

    .empty-text {
      font-size: 24rpx;
      color: var(--text-tertiary);
    }
  }

  .recent-list {
    .recent-item {
      display: flex;
      align-items: center;
      gap: 20rpx;
      padding: 24rpx 0;
      border-bottom: 1rpx solid var(--border-light);

      &:last-child {
        border-bottom: none;
      }

      &:active {
        opacity: 0.7;
      }

      .recent-icon {
        width: 64rpx;
        height: 64rpx;
        border-radius: 12rpx;
        background-color: var(--bg-input);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;

        .icon-emoji {
          font-size: 32rpx;
        }
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
