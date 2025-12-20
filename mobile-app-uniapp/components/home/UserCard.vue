<template>
  <view class="user-card">
    <view class="user-info">
      <view class="avatar">
        <text class="avatar-text">{{ avatarText }}</text>
      </view>
      <view class="user-details">
        <text class="username">{{ username }}</text>
        <text class="user-desc">{{ userDesc }}</text>
      </view>
    </view>
    <view class="settings-icon" @click="goToSettings">
      <text>⚙️</text>
    </view>
  </view>
</template>

<script>
export default {
  props: {
    username: {
      type: String,
      default: 'ChainlessChain 用户'
    },
    userDesc: {
      type: String,
      default: '去中心化 · 隐私优先'
    }
  },
  computed: {
    avatarText() {
      return this.username.charAt(0).toUpperCase()
    }
  },
  methods: {
    goToSettings() {
      uni.switchTab({
        url: '/pages/mine/mine'
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.user-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 60rpx 40rpx 40rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .user-info {
    display: flex;
    align-items: center;
    gap: 24rpx;

    .avatar {
      width: 100rpx;
      height: 100rpx;
      border-radius: 50rpx;
      background-color: rgba(255, 255, 255, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;

      .avatar-text {
        font-size: 40rpx;
        font-weight: bold;
        color: #ffffff;
      }
    }

    .user-details {
      display: flex;
      flex-direction: column;
      gap: 8rpx;

      .username {
        font-size: 36rpx;
        font-weight: bold;
        color: #ffffff;
      }

      .user-desc {
        font-size: 24rpx;
        color: rgba(255, 255, 255, 0.8);
      }
    }
  }

  .settings-icon {
    font-size: 48rpx;
    width: 80rpx;
    height: 80rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 40rpx;
  }
}
</style>
