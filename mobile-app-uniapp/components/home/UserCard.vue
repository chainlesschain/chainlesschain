<template>
  <view class="user-card">
    <view class="card-bg"></view>
    <view class="card-content">
      <view class="user-info">
        <view class="avatar">
          <text class="avatar-text">{{ avatarEmoji }}</text>
        </view>
        <view class="user-details">
          <text class="username">{{ username }}</text>
          <text class="user-desc">{{ userDesc }}</text>
        </view>
      </view>
      <view class="settings-icon" @click="goToSettings">
        <text class="icon-emoji">⚙️</text>
      </view>
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
    avatarEmoji() {
      // 尝试从设置中获取头像emoji
      try {
        const userProfile = uni.getStorageSync('user_profile')
        if (userProfile) {
          const profile = JSON.parse(userProfile)
          if (profile.avatar) {
            return profile.avatar
          }
        }
      } catch (error) {
        console.error('获取头像失败:', error)
      }

      // 默认使用用户名首字母或emoji
      const firstChar = this.username.charAt(0)
      if (/[\u4e00-\u9fa5]/.test(firstChar)) {
        // 中文字符
        return firstChar
      } else if (/[A-Za-z]/.test(firstChar)) {
        // 英文字母
        return firstChar.toUpperCase()
      }
      return '👤'
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
  border-radius: 24rpx;
  padding: 48rpx 32rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 8rpx 32rpx rgba(102, 126, 234, 0.25);
  position: relative;
  overflow: hidden;

  // 背景装饰
  .card-bg {
    position: absolute;
    top: -100rpx;
    right: -100rpx;
    width: 300rpx;
    height: 300rpx;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    filter: blur(60rpx);
    pointer-events: none;
  }

  .card-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    z-index: 1;

    .user-info {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 24rpx;

      .avatar {
        width: 100rpx;
        height: 100rpx;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.25);
        backdrop-filter: blur(10rpx);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 3rpx solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.1);

        .avatar-text {
          font-size: 44rpx;
          font-weight: bold;
          color: #ffffff;
        }
      }

      .user-details {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8rpx;

        .username {
          font-size: 36rpx;
          font-weight: bold;
          color: #ffffff;
          letter-spacing: 0.5rpx;
        }

        .user-desc {
          font-size: 24rpx;
          color: rgba(255, 255, 255, 0.85);
          letter-spacing: 0.5rpx;
        }
      }
    }

    .settings-icon {
      width: 80rpx;
      height: 80rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10rpx);
      border-radius: 50%;
      transition: all 0.3s ease;

      &:active {
        background: rgba(255, 255, 255, 0.3);
        transform: scale(0.95);
      }

      .icon-emoji {
        font-size: 36rpx;
      }
    }
  }
}
</style>
