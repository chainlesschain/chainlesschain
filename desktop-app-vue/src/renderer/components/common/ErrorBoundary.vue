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
import { handleError, ErrorType, ErrorLevel } from '@/utils/errorHandler';

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
    default: process.env.NODE_ENV === 'development',
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
  // 是否自动重试
  autoRetry: {
    type: Boolean,
    default: false,
  },
  // 最大重试次数
  maxRetries: {
    type: Number,
    default: 3,
  },
  // 重试延迟（毫秒）
  retryDelay: {
    type: Number,
    default: 1000,
  },
});

const emit = defineEmits(['error', 'reset', 'report']);

const hasError = ref(false);
const errorDetails = ref('');
const detailsVisible = ref(false);
const errorInfo = ref(null);
const retryCount = ref(0);

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
    timestamp: new Date().toISOString(),
  };

  // 构建错误详情
  errorDetails.value = `错误类型: ${err.name}
错误消息: ${err.message}
错误堆栈:
${err.stack || '无堆栈信息'}

生命周期钩子: ${info}
时间: ${new Date().toLocaleString()}`;

  // 使用统一错误处理工具
  handleError(err, {
    showMessage: false,  // 不显示消息，由边界组件处理
    logToFile: true,
    context: {
      component: 'ErrorBoundary',
      componentInfo: info,
      retryCount: retryCount.value,
    },
  });

  // 触发自定义错误处理
  if (props.onError) {
    props.onError(err, instance, info);
  }

  // 触发error事件
  emit('error', { error: err, instance, info });

  // 自动重试逻辑
  if (props.autoRetry && retryCount.value < props.maxRetries) {
    retryCount.value++;
    console.log(`[ErrorBoundary] 自动重试 ${retryCount.value}/${props.maxRetries}`);

    setTimeout(() => {
      handleReset();
    }, props.retryDelay * retryCount.value);  // 指数退避
  }

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
    url: window.location.href,
    retryCount: retryCount.value,
  };

  // 触发report事件
  emit('report', report);

  console.log('[ErrorBoundary] Error report:', report);

  // 复制错误信息到剪贴板
  const reportText = JSON.stringify(report, null, 2);
  navigator.clipboard.writeText(reportText).then(() => {
    console.log('[ErrorBoundary] 错误信息已复制到剪贴板');
  }).catch((err) => {
    console.error('[ErrorBoundary] 复制失败:', err);
  });

  // 可以在这里添加错误上报逻辑（如发送到日志服务）
  if (window.electronAPI && window.electronAPI.logError) {
    window.electronAPI.logError(report).catch(err => {
      console.error('[ErrorBoundary] 上报错误失败:', err);
    });
  }
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
