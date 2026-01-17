<template>
  <view class="loading-state" :class="[type, { fullscreen }]">
    <!-- 骨架屏模式 -->
    <template v-if="type === 'skeleton'">
      <Skeleton :type="skeletonType" :rows="skeletonRows" :avatar="skeletonAvatar" :animate="true" />
    </template>

    <!-- 加载动画模式 -->
    <template v-else-if="type === 'spinner'">
      <view class="spinner-container">
        <view class="spinner"></view>
        <text class="loading-text" v-if="text">{{ text }}</text>
      </view>
    </template>

    <!-- 脉冲动画模式 -->
    <template v-else-if="type === 'pulse'">
      <view class="pulse-container">
        <view class="pulse-dot"></view>
        <view class="pulse-dot"></view>
        <view class="pulse-dot"></view>
      </view>
      <text class="loading-text" v-if="text">{{ text }}</text>
    </template>

    <!-- 进度条模式 -->
    <template v-else-if="type === 'progress'">
      <view class="progress-container">
        <view class="progress-bar">
          <view class="progress-fill" :style="{ width: progress + '%' }"></view>
        </view>
        <text class="progress-text">{{ progress }}%</text>
      </view>
      <text class="loading-text" v-if="text">{{ text }}</text>
    </template>

    <!-- 默认加载模式 -->
    <template v-else>
      <view class="default-loading">
        <text class="loading-icon">⏳</text>
        <text class="loading-text">{{ text || '加载中...' }}</text>
      </view>
    </template>
  </view>
</template>

<script>
import Skeleton from './Skeleton.vue'

/**
 * LoadingState 统一加载状态组件
 * 提供多种加载状态展示方式
 *
 * @props {String} type - 加载类型：skeleton/spinner/pulse/progress/default
 * @props {String} text - 加载提示文本
 * @props {Boolean} fullscreen - 是否全屏显示
 * @props {Number} progress - 进度值（0-100），仅 progress 类型有效
 * @props {String} skeletonType - 骨架屏类型
 * @props {Number} skeletonRows - 骨架屏行数
 * @props {Boolean} skeletonAvatar - 骨架屏是否显示头像
 */
export default {
  name: 'LoadingState',
  components: {
    Skeleton
  },
  props: {
    type: {
      type: String,
      default: 'default',
      validator: (value) => ['skeleton', 'spinner', 'pulse', 'progress', 'default'].includes(value)
    },
    text: {
      type: String,
      default: ''
    },
    fullscreen: {
      type: Boolean,
      default: false
    },
    progress: {
      type: Number,
      default: 0
    },
    skeletonType: {
      type: String,
      default: 'list'
    },
    skeletonRows: {
      type: Number,
      default: 3
    },
    skeletonAvatar: {
      type: Boolean,
      default: false
    }
  }
}
</script>

<style lang="scss" scoped>
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40rpx;

  &.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--bg-page);
    z-index: 999;
  }
}

.loading-text {
  font-size: 28rpx;
  color: var(--text-secondary);
  margin-top: 20rpx;
}

// 旋转加载动画
.spinner-container {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.spinner {
  width: 64rpx;
  height: 64rpx;
  border: 6rpx solid var(--bg-input);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

// 脉冲点动画
.pulse-container {
  display: flex;
  gap: 16rpx;
}

.pulse-dot {
  width: 20rpx;
  height: 20rpx;
  background-color: var(--color-primary);
  border-radius: 50%;
  animation: pulse 1.4s ease-in-out infinite;

  &:nth-child(1) {
    animation-delay: 0s;
  }
  &:nth-child(2) {
    animation-delay: 0.2s;
  }
  &:nth-child(3) {
    animation-delay: 0.4s;
  }
}

@keyframes pulse {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

// 进度条
.progress-container {
  width: 100%;
  max-width: 400rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}

.progress-bar {
  width: 100%;
  height: 12rpx;
  background-color: var(--bg-input);
  border-radius: 6rpx;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-light, #5fd35f));
  border-radius: 6rpx;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 24rpx;
  color: var(--text-tertiary);
}

// 默认加载
.default-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;

  .loading-icon {
    font-size: 48rpx;
    animation: bounce 1s ease-in-out infinite;
  }
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10rpx);
  }
}
</style>
