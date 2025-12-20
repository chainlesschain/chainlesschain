<template>
  <view class="quick-actions">
    <text class="section-title">快捷功能</text>
    <view class="action-grid">
      <view class="action-item" @click="goToKnowledge">
        <view class="action-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
          <uni-icons type="notebook" color="#fff" size="30"></uni-icons>
        </view>
        <text class="action-label">知识库</text>
      </view>

      <view class="action-item" @click="goToChat">
        <view class="action-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
          <uni-icons type="chatbubble-filled" color="#fff" size="30"></uni-icons>
        </view>
        <text class="action-label">AI助手</text>
      </view>

      <view class="action-item" @click="goToFolders">
        <view class="action-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
          <uni-icons type="folder-filled" color="#fff" size="30"></uni-icons>
        </view>
        <text class="action-label">文件夹</text>
      </view>

      <view class="action-item" @click="goToStatistics">
        <view class="action-icon" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);">
          <uni-icons type="chart-bar-filled" color="#fff" size="30"></uni-icons>
        </view>
        <text class="action-label">统计分析</text>
      </view>

      <view class="action-item" @click="goToSocial">
        <view class="action-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
          <uni-icons type="staff-filled" color="#fff" size="30"></uni-icons>
        </view>
        <text class="action-label">社交</text>
      </view>

      <view class="action-item" @click="goToMarket">
        <view class="action-icon" style="background: linear-gradient(135deg, #30cfd0 0%, #330867 100%);">
          <uni-icons type="shop-filled" color="#fff" size="30"></uni-icons>
        </view>
        <text class="action-label">交易市场</text>
      </view>

      <view class="action-item" @click="goToBackup">
        <view class="action-icon" style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);">
          <uni-icons type="cloud-upload-filled" color="#fff" size="30"></uni-icons>
        </view>
        <text class="action-label">数据备份</text>
      </view>

      <view class="action-item" @click="goToSettings">
        <view class="action-icon" style="background: linear-gradient(135deg, #d299c2 0%, #fef9d7 100%);">
          <uni-icons type="gear-filled" color="#fff" size="30"></uni-icons>
        </view>
        <text class="action-label">设置</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  methods: {
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
    }
  }
}
</script>

<style lang="scss" scoped>
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
        box-shadow: var(--shadow-md);
        transition: transform 0.2s;

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
</style>
