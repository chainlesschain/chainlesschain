<template>
  <view class="empty-state" :class="{ compact }">
    <!-- 图标 -->
    <view class="empty-icon-wrapper" :class="iconStyle">
      <text class="empty-icon">{{ icon }}</text>
    </view>

    <!-- 标题 -->
    <text class="empty-title">{{ title }}</text>

    <!-- 描述 -->
    <text class="empty-description" v-if="description">{{ description }}</text>

    <!-- 主要操作按钮 -->
    <button
      v-if="actionText"
      class="empty-action"
      :class="actionType"
      @click="$emit('action')"
    >
      <text class="action-icon" v-if="actionIcon">{{ actionIcon }}</text>
      <text class="action-text">{{ actionText }}</text>
    </button>

    <!-- 次要操作 -->
    <view class="secondary-action" v-if="secondaryText" @click="$emit('secondary')">
      <text class="secondary-text">{{ secondaryText }}</text>
    </view>

    <!-- 自定义内容插槽 -->
    <slot></slot>
  </view>
</template>

<script>
/**
 * EmptyState 空状态组件
 * 统一的空数据、错误、无结果等状态展示
 *
 * @props {String} icon - 图标emoji
 * @props {String} title - 标题文本
 * @props {String} description - 描述文本
 * @props {String} actionText - 主要操作按钮文本
 * @props {String} actionIcon - 主要操作按钮图标
 * @props {String} actionType - 按钮类型：primary/secondary/danger
 * @props {String} secondaryText - 次要操作文本
 * @props {String} iconStyle - 图标样式：default/success/warning/error/info
 * @props {Boolean} compact - 是否紧凑模式
 *
 * @emits action - 主要操作按钮点击
 * @emits secondary - 次要操作点击
 */
export default {
  name: 'EmptyState',
  props: {
    icon: {
      type: String,
      default: '📭'
    },
    title: {
      type: String,
      default: '暂无数据'
    },
    description: {
      type: String,
      default: ''
    },
    actionText: {
      type: String,
      default: ''
    },
    actionIcon: {
      type: String,
      default: ''
    },
    actionType: {
      type: String,
      default: 'primary',
      validator: (value) => ['primary', 'secondary', 'danger'].includes(value)
    },
    secondaryText: {
      type: String,
      default: ''
    },
    iconStyle: {
      type: String,
      default: 'default',
      validator: (value) => ['default', 'success', 'warning', 'error', 'info'].includes(value)
    },
    compact: {
      type: Boolean,
      default: false
    }
  },
  emits: ['action', 'secondary']
}
</script>

<style lang="scss" scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80rpx 40rpx;
  text-align: center;

  &.compact {
    padding: 40rpx 24rpx;

    .empty-icon-wrapper {
      width: 100rpx;
      height: 100rpx;
      margin-bottom: 20rpx;

      .empty-icon {
        font-size: 48rpx;
      }
    }

    .empty-title {
      font-size: 28rpx;
      margin-bottom: 8rpx;
    }

    .empty-description {
      font-size: 24rpx;
    }
  }
}

.empty-icon-wrapper {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 32rpx;
  background-color: var(--bg-input);

  &.success {
    background-color: rgba(60, 197, 31, 0.1);
  }

  &.warning {
    background-color: rgba(255, 170, 0, 0.1);
  }

  &.error {
    background-color: rgba(255, 77, 79, 0.1);
  }

  &.info {
    background-color: rgba(64, 169, 255, 0.1);
  }
}

.empty-icon {
  font-size: 72rpx;
  line-height: 1;
}

.empty-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12rpx;
}

.empty-description {
  font-size: 28rpx;
  color: var(--text-secondary);
  line-height: 1.6;
  max-width: 480rpx;
  margin-bottom: 40rpx;
}

.empty-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  min-width: 240rpx;
  height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 500;
  border: none;
  transition: all 0.2s ease;

  &::after {
    border: none;
  }

  &.primary {
    background: linear-gradient(135deg, var(--color-primary) 0%, #45d030 100%);
    color: var(--text-inverse);
    box-shadow: 0 8rpx 24rpx rgba(60, 197, 31, 0.3);

    &:active {
      transform: scale(0.96);
    }
  }

  &.secondary {
    background-color: var(--bg-input);
    color: var(--text-primary);

    &:active {
      background-color: var(--bg-hover);
    }
  }

  &.danger {
    background: linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%);
    color: #fff;
    box-shadow: 0 8rpx 24rpx rgba(255, 77, 79, 0.3);

    &:active {
      transform: scale(0.96);
    }
  }

  .action-icon {
    font-size: 32rpx;
  }

  .action-text {
    font-size: 30rpx;
  }
}

.secondary-action {
  margin-top: 24rpx;
  padding: 16rpx 32rpx;

  .secondary-text {
    font-size: 26rpx;
    color: var(--color-primary);
  }
}
</style>
