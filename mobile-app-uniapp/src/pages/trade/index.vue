<template>
  <view class="trade-index">
    <view class="header">
      <text class="title">交易系统测试</text>
      <text class="subtitle">ChainlessChain Mobile UI</text>
    </view>

    <view class="page-list">
      <view
        v-for="page in pages"
        :key="page.path"
        class="page-card"
        @click="navigateTo(page.path)"
      >
        <view class="page-icon">{{ page.icon }}</view>
        <view class="page-info">
          <text class="page-title">{{ page.title }}</text>
          <text class="page-desc">{{ page.description }}</text>
        </view>
        <view class="page-arrow">→</view>
      </view>
    </view>

    <view class="test-info">
      <text class="info-title">🧪 后端测试状态</text>
      <view class="info-item">
        <text class="info-label">集成测试:</text>
        <text class="info-value success">✅ 39/39 通过</text>
      </view>
      <view class="info-item">
        <text class="info-label">通过率:</text>
        <text class="info-value">100%</text>
      </view>
      <view class="info-item">
        <text class="info-label">代码量:</text>
        <text class="info-value">6,809行</text>
      </view>
    </view>

    <view class="actions">
      <view class="action-btn" @click="runIntegrationTest">
        <text class="btn-text">运行集成测试</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      pages: [
        {
          path: '/pages/trade/assets/index',
          icon: '💰',
          title: '资产管理',
          description: '查看资产、创建资产、转账、历史记录'
        },
        {
          path: '/pages/trade/market/index',
          icon: '📊',
          title: '市场交易',
          description: '订单列表、创建订单、匹配订单、取消订单'
        },
        {
          path: '/pages/trade/contracts/index',
          icon: '📜',
          title: '智能合约',
          description: '合约创建、签署、激活、执行'
        },
        {
          path: '/pages/trade/social/index',
          icon: '💬',
          title: '社交交易',
          description: 'Feed流、点赞、评论、关注'
        },
        {
          path: '/pages/trade/user/index',
          icon: '👤',
          title: '用户中心',
          description: '等级系统、签到、任务、成就'
        }
      ]
    }
  },

  methods: {
    navigateTo(path) {
      uni.navigateTo({
        url: path
      })
    },

    runIntegrationTest() {
      uni.showToast({
        title: '请在命令行运行:\nnode test/integration-test-real.js',
        icon: 'none',
        duration: 3000
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.trade-index {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 32rpx;
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 80rpx 32rpx 48rpx;
  color: white;
  text-align: center;

  .title {
    display: block;
    font-size: 48rpx;
    font-weight: bold;
    margin-bottom: 16rpx;
  }

  .subtitle {
    display: block;
    font-size: 28rpx;
    opacity: 0.9;
  }
}

.page-list {
  padding: 32rpx;
}

.page-card {
  background: white;
  padding: 32rpx;
  border-radius: 16rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  gap: 24rpx;
  transition: transform 0.2s;

  &:active {
    transform: scale(0.98);
  }

  .page-icon {
    font-size: 56rpx;
  }

  .page-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;

    .page-title {
      font-size: 32rpx;
      font-weight: bold;
      color: #333;
    }

    .page-desc {
      font-size: 24rpx;
      color: #999;
      line-height: 1.5;
    }
  }

  .page-arrow {
    font-size: 32rpx;
    color: #ccc;
  }
}

.test-info {
  margin: 0 32rpx 32rpx;
  padding: 32rpx;
  background: white;
  border-radius: 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

  .info-title {
    display: block;
    font-size: 32rpx;
    font-weight: bold;
    color: #333;
    margin-bottom: 24rpx;
  }

  .info-item {
    display: flex;
    justify-content: space-between;
    padding: 16rpx 0;
    border-bottom: 1rpx solid #f0f0f0;

    &:last-child {
      border-bottom: none;
    }

    .info-label {
      font-size: 28rpx;
      color: #666;
    }

    .info-value {
      font-size: 28rpx;
      color: #333;
      font-weight: bold;

      &.success {
        color: #52c41a;
      }
    }
  }
}

.actions {
  padding: 0 32rpx;

  .action-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 24rpx;
    border-radius: 16rpx;
    text-align: center;

    .btn-text {
      color: white;
      font-size: 32rpx;
      font-weight: bold;
    }
  }
}
</style>
