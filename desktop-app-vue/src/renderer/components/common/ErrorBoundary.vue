<template>
  <div class="error-boundary">
    <slot v-if="!hasError"></slot>
    <div v-else class="error-fallback">
      <a-result
        status="error"
        :title="errorTitle"
        :sub-title="errorSubtitle"
      >
        <template #extra>
          <a-space>
            <a-button type="primary" @click="handleReset">
              重新加载
            </a-button>
            <a-button v-if="showDetails" @click="toggleDetails">
              {{ detailsVisible ? '隐藏详情' : '查看详情' }}
            </a-button>
            <a-button @click="handleReport">
              报告问题
            </a-button>
          </a-space>
        </template>

        <div v-if="detailsVisible && errorDetails" class="error-details">
          <a-typography-paragraph>
            <pre>{{ errorDetails }}</pre>
          </a-typography-paragraph>
        </div>
      </a-result>
    </div>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured, provide } from 'vue';

const props = defineProps({
  // 错误标题
  errorTitle: {
    type: String,
    default: '组件渲染失败',
  },
  // 错误副标题
  errorSubtitle: {
    type: String,
    default: '抱歉，该组件遇到错误无法正常显示',
  },
  // 是否显示详细错误信息
  showDetails: {
    type: Boolean,
    default: true,
  },
  // 自定义错误处理函数
  onError: {
    type: Function,
    default: null,
  },
  // 自定义重置函数
  onReset: {
    type: Function,
    default: null,
  },
});

const emit = defineEmits(['error', 'reset', 'report']);

const hasError = ref(false);
const errorDetails = ref('');
const detailsVisible = ref(false);
const errorInfo = ref(null);

// 捕获子组件错误
onErrorCaptured((err, instance, info) => {
  console.error('[ErrorBoundary] Captured error:', err);
  console.error('[ErrorBoundary] Error info:', info);
  console.error('[ErrorBoundary] Component instance:', instance);

  hasError.value = true;
  errorInfo.value = {
    error: err,
    instance,
    info,
  };

  // 构建错误详情
  errorDetails.value = `错误类型: ${err.name}
错误消息: ${err.message}
错误堆栈:
${err.stack || '无堆栈信息'}

生命周期钩子: ${info}`;

  // 触发自定义错误处理
  if (props.onError) {
    props.onError(err, instance, info);
  }

  // 触发error事件
  emit('error', { error: err, instance, info });

  // 阻止错误继续传播
  return false;
});

// 切换详情显示
const toggleDetails = () => {
  detailsVisible.value = !detailsVisible.value;
};

// 重置错误状态
const handleReset = () => {
  hasError.value = false;
  errorDetails.value = '';
  detailsVisible.value = false;
  errorInfo.value = null;

  // 触发自定义重置函数
  if (props.onReset) {
    props.onReset();
  }

  // 触发reset事件
  emit('reset');
};

// 报告问题
const handleReport = () => {
  const report = {
    title: props.errorTitle,
    subtitle: props.errorSubtitle,
    details: errorDetails.value,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
  };

  // 触发report事件
  emit('report', report);

  console.log('[ErrorBoundary] Error report:', report);

  // 可以在这里添加错误上报逻辑（如发送到日志服务）
};

// 提供重置方法给子组件
provide('errorBoundaryReset', handleReset);
</script>

<style scoped lang="scss">
.error-boundary {
  width: 100%;
  height: 100%;

  .error-fallback {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 300px;
    padding: 40px;

    .error-details {
      margin-top: 24px;
      padding: 16px;
      background-color: #f6f8fa;
      border-radius: 6px;
      border: 1px solid #d0d7de;
      max-width: 800px;
      overflow: auto;

      pre {
        margin: 0;
        font-family: 'Courier New', Courier, monospace;
        font-size: 12px;
        line-height: 1.5;
        color: #24292e;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    }
  }
}
</style>
