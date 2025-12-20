<template>
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
</template>

<script>
export default {
  props: {
    stats: {
      type: Object,
      default: () => ({
        knowledge: 0,
        favorites: 0,
        folders: 0
      })
    }
  },
  methods: {
    goToKnowledge() {
      uni.switchTab({
        url: '/pages/knowledge/list/list'
      })
    },
    goToFolders() {
      uni.navigateTo({
        url: '/pages/knowledge/folders/folders'
      })
    }
  }
}
</script>

<style lang="scss" scoped>
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
</style>
