<template>
  <view class="stats-card">
    <view class="stat-item" @click="goToKnowledge">
      <view class="stat-icon">📚</view>
      <view class="stat-info">
        <text class="stat-value">{{ stats.knowledge }}</text>
        <text class="stat-label">知识条目</text>
      </view>
    </view>

    <view class="stat-divider"></view>

    <view class="stat-item" @click="goToKnowledge">
      <view class="stat-icon">⭐</view>
      <view class="stat-info">
        <text class="stat-value">{{ stats.favorites }}</text>
        <text class="stat-label">收藏</text>
      </view>
    </view>

    <view class="stat-divider"></view>

    <view class="stat-item" @click="goToFolders">
      <view class="stat-icon">📁</view>
      <view class="stat-info">
        <text class="stat-value">{{ stats.folders }}</text>
        <text class="stat-label">文件夹</text>
      </view>
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
  background-color: var(--bg-card);
  border-radius: 20rpx;
  padding: 32rpx 0;
  box-shadow: 0 4rpx 20rpx rgba(102, 126, 234, 0.08);
  margin-bottom: 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-around;

  .stat-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12rpx;
    padding: 12rpx 0;
    transition: transform 0.2s ease;

    &:active {
      transform: scale(0.95);
    }

    .stat-icon {
      font-size: 40rpx;
      margin-bottom: 4rpx;
    }

    .stat-info {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4rpx;

      .stat-value {
        font-size: 44rpx;
        font-weight: bold;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .stat-label {
        font-size: 22rpx;
        color: var(--text-tertiary);
        font-weight: 500;
      }
    }
  }

  .stat-divider {
    width: 2rpx;
    height: 80rpx;
    background: linear-gradient(180deg, transparent 0%, var(--border-color) 50%, transparent 100%);
  }
}
</style>
