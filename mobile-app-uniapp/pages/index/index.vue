<template>
  <view class="index-container">
    <view class="welcome">
      <text class="title">欢迎使用 ChainlessChain</text>
      <text class="subtitle">去中心化 · 隐私优先 · AI原生</text>
    </view>

    <view class="quick-actions">
      <navigator url="/pages/knowledge/list/list" class="action-item">
        <text class="action-icon">📚</text>
        <text class="action-text">知识库</text>
      </navigator>

      <navigator url="/pages/chat/chat" class="action-item">
        <text class="action-icon">🤖</text>
        <text class="action-text">AI助手</text>
      </navigator>

      <navigator url="/pages/social/friends/friends" class="action-item">
        <text class="action-icon">👥</text>
        <text class="action-text">社交</text>
      </navigator>

      <navigator url="/pages/trade/market/market" class="action-item">
        <text class="action-icon">💰</text>
        <text class="action-text">交易</text>
      </navigator>
    </view>
  </view>
</template>

<script>
export default {
  onLoad() {
    // 检查登录状态
    const isLoggedIn = uni.getStorageSync('isLoggedIn')
    if (!isLoggedIn) {
      uni.reLaunch({
        url: '/pages/login/login'
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.index-container {
  min-height: 100vh;
  padding: 60rpx 40rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.welcome {
  text-align: center;
  margin-bottom: 100rpx;

  .title {
    display: block;
    font-size: 48rpx;
    font-weight: bold;
    color: var(--bg-card);
    margin-bottom: 20rpx;
  }

  .subtitle {
    display: block;
    font-size: 28rpx;
    color: rgba(255, 255, 255, 0.8);
  }
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 30rpx;

  .action-item {
    background-color: rgba(255, 255, 255, 0.95);
    border-radius: 20rpx;
    padding: 60rpx 40rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.15);

    .action-icon {
      font-size: 80rpx;
      margin-bottom: 20rpx;
    }

    .action-text {
      font-size: 28rpx;
      font-weight: 500;
      color: var(--text-primary);
    }
  }
}
</style>
