<template>
  <div
    class="loading-state"
    :class="[`loading-state--${type}`, { 'loading-state--fullscreen': fullscreen }]"
  >
    <!-- Spinner 加载 -->
    <div
      v-if="type === 'spinner'"
      class="loading-spinner"
    >
      <a-spin
        :size="size"
        :tip="message"
      >
        <template
          v-if="customIcon"
          #indicator
        >
          <component
            :is="customIcon"
            :spin="true"
          />
        </template>
      </a-spin>
      <div
        v-if="progress !== null"
        class="loading-progress"
      >
        <a-progress
          :percent="progress"
          :status="progressStatus"
          :show-info="showProgressInfo"
          :stroke-color="progressColor"
        />
      </div>
    </div>

    <!-- Skeleton 骨架屏 -->
    <div
      v-else-if="type === 'skeleton'"
      class="loading-skeleton"
    >
      <component
        :is="getSkeletonComponent()"
        v-bind="skeletonProps"
      />
    </div>

    <!-- Progress 进度条 -->
    <div
      v-else-if="type === 'progress'"
      class="loading-progress-bar"
    >
      <div
        v-if="message"
        class="progress-message"
      >
        {{ message }}
      </div>
      <a-progress
        :percent="progress || 0"
        :status="progressStatus"
        :show-info="showProgressInfo"
        :stroke-color="progressColor"
      />
      <div
        v-if="subMessage"
        class="progress-sub-message"
      >
        {{ subMessage }}
      </div>
    </div>

    <!-- Dots 点状加载 -->
    <div
      v-else-if="type === 'dots'"
      class="loading-dots"
    >
      <div class="dots-container">
        <span class="dot" />
        <span class="dot" />
        <span class="dot" />
      </div>
      <div
        v-if="message"
        class="dots-message"
      >
        {{ message }}
      </div>
    </div>

    <!-- Pulse 脉冲加载 -->
    <div
      v-else-if="type === 'pulse'"
      class="loading-pulse"
    >
      <div class="pulse-circle" />
      <div
        v-if="message"
        class="pulse-message"
      >
        {{ message }}
      </div>
    </div>

    <!-- Bar 条形加载 -->
    <div
      v-else-if="type === 'bar'"
      class="loading-bar"
    >
      <div class="bar-container">
        <div
          class="bar-fill"
          :style="{ width: `${progress || 0}%` }"
        />
      </div>
      <div
        v-if="message"
        class="bar-message"
      >
        {{ message }}
      </div>
    </div>

    <!-- Custom 自定义 -->
    <div
      v-else-if="type === 'custom'"
      class="loading-custom"
    >
      <slot name="custom">
        <a-spin
          :size="size"
          :tip="message"
        />
      </slot>
    </div>

    <!-- 默认 -->
    <div
      v-else
      class="loading-default"
    >
      <a-spin
        :size="size"
        :tip="message"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent } from 'vue';
import { LoadingOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  // 加载类型: spinner, skeleton, progress, dots, pulse, bar, custom
  type: {
    type: String,
    default: 'spinner',
    validator: (value) => ['spinner', 'skeleton', 'progress', 'dots', 'pulse', 'bar', 'custom'].includes(value),
  },
  // 加载提示消息
  message: {
    type: String,
    default: '',
  },
  // 子消息（仅progress类型）
  subMessage: {
    type: String,
    default: '',
  },
  // 大小: small, default, large
  size: {
    type: String,
    default: 'default',
    validator: (value) => ['small', 'default', 'large'].includes(value),
  },
  // 进度值 (0-100)
  progress: {
    type: Number,
    default: null,
    validator: (value) => value === null || (value >= 0 && value <= 100),
  },
  // 进度状态: success, exception, normal, active
  progressStatus: {
    type: String,
    default: 'active',
  },
  // 是否显示进度信息
  showProgressInfo: {
    type: Boolean,
    default: true,
  },
  // 进度条颜色
  progressColor: {
    type: [String, Object],
    default: null,
  },
  // 是否全屏显示
  fullscreen: {
    type: Boolean,
    default: false,
  },
  // 自定义图标
  customIcon: {
    type: Object,
    default: null,
  },
  // Skeleton类型: file-tree, chat, editor, card, list, table
  skeletonType: {
    type: String,
    default: 'card',
  },
  // Skeleton行数
  skeletonRows: {
    type: Number,
    default: 3,
  },
  // Skeleton额外属性
  skeletonProps: {
    type: Object,
    default: () => ({}),
  },
});

// 动态加载Skeleton组件
const getSkeletonComponent = () => {
  const skeletonMap = {
    'file-tree': defineAsyncComponent(() => import('./skeleton/FileTreeSkeleton.vue')),
    'chat': defineAsyncComponent(() => import('./skeleton/ChatSkeleton.vue')),
    'editor': defineAsyncComponent(() => import('./skeleton/EditorSkeleton.vue')),
    'card': defineAsyncComponent(() => import('./skeleton/CardSkeleton.vue')),
    'list': defineAsyncComponent(() => import('./skeleton/ListSkeleton.vue')),
    'table': 'a-skeleton',
  };

  return skeletonMap[props.skeletonType] || 'a-skeleton';
};

// 合并skeleton属性
const skeletonProps = computed(() => ({
  rows: props.skeletonRows,
  ...props.skeletonProps,
}));
</script>

<style scoped lang="scss">
.loading-state {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100px;
  width: 100%;

  &--fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    min-height: 100vh;
    background: rgba(255, 255, 255, 0.9);
    z-index: 9999;
    backdrop-filter: blur(4px);
  }
}

// Spinner样式
.loading-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  .loading-progress {
    width: 300px;
    max-width: 90%;
  }
}

// Skeleton样式
.loading-skeleton {
  width: 100%;
  padding: 16px;
}

// Progress样式
.loading-progress-bar {
  width: 100%;
  max-width: 500px;
  padding: 24px;

  .progress-message {
    margin-bottom: 12px;
    font-size: 14px;
    color: #262626;
    font-weight: 500;
    text-align: center;
  }

  .progress-sub-message {
    margin-top: 8px;
    font-size: 12px;
    color: #8c8c8c;
    text-align: center;
  }
}

// Dots样式
.loading-dots {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  .dots-container {
    display: flex;
    gap: 8px;

    .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #1890ff;
      animation: dot-pulse 1.4s infinite ease-in-out both;

      &:nth-child(1) {
        animation-delay: -0.32s;
      }

      &:nth-child(2) {
        animation-delay: -0.16s;
      }
    }
  }

  .dots-message {
    font-size: 14px;
    color: #595959;
  }
}

@keyframes dot-pulse {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

// Pulse样式
.loading-pulse {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  .pulse-circle {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: #1890ff;
    animation: pulse-animation 1.5s infinite ease-in-out;
  }

  .pulse-message {
    font-size: 14px;
    color: #595959;
  }
}

@keyframes pulse-animation {
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.5;
  }
  100% {
    transform: scale(0.8);
    opacity: 1;
  }
}

// Bar样式
.loading-bar {
  width: 100%;
  max-width: 400px;

  .bar-container {
    width: 100%;
    height: 4px;
    background: #f0f0f0;
    border-radius: 2px;
    overflow: hidden;

    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #1890ff, #40a9ff);
      border-radius: 2px;
      transition: width 0.3s ease;
      animation: bar-shimmer 1.5s infinite;
    }
  }

  .bar-message {
    margin-top: 12px;
    font-size: 14px;
    color: #595959;
    text-align: center;
  }
}

@keyframes bar-shimmer {
  0% {
    background-position: -400px 0;
  }
  100% {
    background-position: 400px 0;
  }
}

// 暗色主题
.dark {
  .loading-state--fullscreen {
    background: rgba(0, 0, 0, 0.9);
  }

  .progress-message {
    color: #ffffff;
  }

  .progress-sub-message,
  .dots-message,
  .pulse-message,
  .bar-message {
    color: #bfbfbf;
  }

  .bar-container {
    background: #3e3e3e;
  }
}

// 响应式设计
@media (max-width: 768px) {
  .loading-progress-bar,
  .loading-bar {
    max-width: 90%;
    padding: 16px;
  }

  .loading-spinner .loading-progress {
    width: 250px;
  }
}
</style>
