<template>
  <div class="enhanced-error-boundary">
    <slot v-if="!hasError"></slot>

    <transition name="error-fade">
      <div v-if="hasError" class="error-fallback" :class="{ 'error-fallback--fullscreen': fullscreen }">
        <a-result
          :status="errorStatus"
          :title="errorTitle"
          :sub-title="errorSubtitle"
        >
          <template #icon>
            <component :is="errorIcon" class="error-icon" />
          </template>

          <template #extra>
            <a-space direction="vertical" :size="12" style="width: 100%">
              <!-- 操作按钮 -->
              <a-space>
                <a-button type="primary" @click="handleReset" :loading="resetting">
                  <ReloadOutlined />
                  {{ resetButtonText }}
                </a-button>

                <a-button v-if="showDetails" @click="toggleDetails">
                  <FileTextOutlined />
                  {{ detailsVisible ? '隐藏详情' : '查看详情' }}
                </a-button>

                <a-button @click="handleReport" :loading="reporting">
                  <BugOutlined />
                  报告问题
                </a-button>

                <a-button v-if="showHome" @click="handleGoHome">
                  <HomeOutlined />
                  返回首页
                </a-button>
              </a-space>

              <!-- 重试倒计时 -->
              <div v-if="autoRetry && retryCount < maxRetries" class="retry-countdown">
                <a-progress
                  :percent="retryProgress"
                  :show-info="false"
                  status="active"
                  stroke-color="#1890ff"
                />
                <div class="retry-text">
                  {{ retryCount + 1 }}/{{ maxRetries }} 次重试，{{ retryCountdown }}秒后自动重试...
                </div>
              </div>

              <!-- 错误详情 -->
              <transition name="details-slide">
                <div v-if="detailsVisible && errorDetails" class="error-details">
                  <a-tabs v-model:activeKey="activeTab" size="small">
                    <!-- 错误信息 -->
                    <a-tab-pane key="error" tab="错误信息">
                      <div class="error-info">
                        <div class="info-item">
                          <span class="info-label">错误类型:</span>
                          <a-tag color="red">{{ errorInfo?.error?.name || 'Unknown' }}</a-tag>
                        </div>
                        <div class="info-item">
                          <span class="info-label">错误消息:</span>
                          <span class="info-value">{{ errorInfo?.error?.message || '未知错误' }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">发生时间:</span>
                          <span class="info-value">{{ formatTime(errorInfo?.timestamp) }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">重试次数:</span>
                          <span class="info-value">{{ retryCount }}</span>
                        </div>
                      </div>
                    </a-tab-pane>

                    <!-- 堆栈跟踪 -->
                    <a-tab-pane key="stack" tab="堆栈跟踪">
                      <div class="stack-trace">
                        <pre>{{ errorInfo?.error?.stack || '无堆栈信息' }}</pre>
                      </div>
                    </a-tab-pane>

                    <!-- 组件信息 -->
                    <a-tab-pane key="component" tab="组件信息">
                      <div class="component-info">
                        <div class="info-item">
                          <span class="info-label">生命周期钩子:</span>
                          <a-tag>{{ errorInfo?.info || 'unknown' }}</a-tag>
                        </div>
                        <div class="info-item">
                          <span class="info-label">组件名称:</span>
                          <span class="info-value">{{ getComponentName() }}</span>
                        </div>
                      </div>
                    </a-tab-pane>

                    <!-- 环境信息 -->
                    <a-tab-pane key="environment" tab="环境信息">
                      <div class="environment-info">
                        <div class="info-item">
                          <span class="info-label">浏览器:</span>
                          <span class="info-value">{{ getBrowserInfo() }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">URL:</span>
                          <span class="info-value">{{ window.location.href }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">User Agent:</span>
                          <span class="info-value small">{{ navigator.userAgent }}</span>
                        </div>
                      </div>
                    </a-tab-pane>
                  </a-tabs>

                  <!-- 复制按钮 -->
                  <div class="details-actions">
                    <a-button size="small" @click="copyErrorDetails">
                      <CopyOutlined />
                      复制错误信息
                    </a-button>
                  </div>
                </div>
              </transition>
            </a-space>
          </template>
        </a-result>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onErrorCaptured, provide, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  ReloadOutlined,
  FileTextOutlined,
  BugOutlined,
  HomeOutlined,
  CopyOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons-vue';
import { handleError } from '@/utils/errorHandler';

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
  // 错误状态: error, warning, info
  errorStatus: {
    type: String,
    default: 'error',
    validator: (value) => ['error', 'warning', 'info'].includes(value),
  },
  // 是否显示详细错误信息
  showDetails: {
    type: Boolean,
    default: process.env.NODE_ENV === 'development',
  },
  // 是否显示返回首页按钮
  showHome: {
    type: Boolean,
    default: false,
  },
  // 是否全屏显示
  fullscreen: {
    type: Boolean,
    default: false,
  },
  // 重置按钮文本
  resetButtonText: {
    type: String,
    default: '重新加载',
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
  // 自定义报告函数
  onReport: {
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
    default: 3000,
  },
  // 是否记录错误日志
  logError: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['error', 'reset', 'report', 'go-home']);

const hasError = ref(false);
const errorDetails = ref('');
const detailsVisible = ref(false);
const errorInfo = ref(null);
const retryCount = ref(0);
const resetting = ref(false);
const reporting = ref(false);
const activeTab = ref('error');
const retryCountdown = ref(0);
const retryProgress = ref(0);
let retryTimer = null;

// 错误图标
const errorIcon = computed(() => {
  const iconMap = {
    error: CloseCircleOutlined,
    warning: WarningOutlined,
    info: ExclamationCircleOutlined,
  };
  return iconMap[props.errorStatus] || CloseCircleOutlined;
});

// 捕获子组件错误
onErrorCaptured((err, instance, info) => {
  console.error('[EnhancedErrorBoundary] Captured error:', err);
  console.error('[EnhancedErrorBoundary] Error info:', info);
  console.error('[EnhancedErrorBoundary] Component instance:', instance);

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
时间: ${new Date().toLocaleString()}
重试次数: ${retryCount.value}`;

  // 使用统一错误处理工具
  if (props.logError) {
    handleError(err, {
      showMessage: false,
      logToFile: true,
      context: {
        component: 'EnhancedErrorBoundary',
        componentInfo: info,
        retryCount: retryCount.value,
      },
    });
  }

  // 触发自定义错误处理
  if (props.onError) {
    props.onError(err, instance, info);
  }

  // 触发error事件
  emit('error', { error: err, instance, info });

  // 自动重试逻辑
  if (props.autoRetry && retryCount.value < props.maxRetries) {
    startRetryCountdown();
  }

  // 阻止错误继续传播
  return false;
});

// 开始重试倒计时
const startRetryCountdown = () => {
  const delay = props.retryDelay * Math.pow(1.5, retryCount.value); // 指数退避
  retryCountdown.value = Math.ceil(delay / 1000);
  retryProgress.value = 0;

  const interval = 100;
  const steps = delay / interval;
  let currentStep = 0;

  retryTimer = setInterval(() => {
    currentStep++;
    retryProgress.value = (currentStep / steps) * 100;
    retryCountdown.value = Math.ceil((delay - currentStep * interval) / 1000);

    if (currentStep >= steps) {
      clearInterval(retryTimer);
      retryCount.value++;
      handleReset();
    }
  }, interval);
};

// 切换详情显示
const toggleDetails = () => {
  detailsVisible.value = !detailsVisible.value;
};

// 重置错误状态
const handleReset = async () => {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }

  resetting.value = true;

  try {
    // 触发自定义重置函数
    if (props.onReset) {
      await props.onReset();
    }

    // 触发reset事件
    emit('reset');

    // 延迟重置状态，给用户视觉反馈
    setTimeout(() => {
      hasError.value = false;
      errorDetails.value = '';
      detailsVisible.value = false;
      errorInfo.value = null;
      resetting.value = false;
      retryCountdown.value = 0;
      retryProgress.value = 0;
    }, 300);
  } catch (error) {
    console.error('[EnhancedErrorBoundary] Reset failed:', error);
    message.error('重置失败，请刷新页面');
    resetting.value = false;
  }
};

// 报告问题
const handleReport = async () => {
  reporting.value = true;

  try {
    const report = {
      title: props.errorTitle,
      subtitle: props.errorSubtitle,
      details: errorDetails.value,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      retryCount: retryCount.value,
      errorType: errorInfo.value?.error?.name,
      errorMessage: errorInfo.value?.error?.message,
      stack: errorInfo.value?.error?.stack,
    };

    // 触发自定义报告函数
    if (props.onReport) {
      await props.onReport(report);
    }

    // 触发report事件
    emit('report', report);

    // 复制错误信息到剪贴板
    const reportText = JSON.stringify(report, null, 2);
    await navigator.clipboard.writeText(reportText);
    message.success('错误信息已复制到剪贴板');

    // 上报到日志服务
    if (window.electronAPI && window.electronAPI.logError) {
      await window.electronAPI.logError(report);
    }
  } catch (error) {
    console.error('[EnhancedErrorBoundary] Report failed:', error);
    message.error('报告失败，请手动复制错误信息');
  } finally {
    reporting.value = false;
  }
};

// 返回首页
const handleGoHome = () => {
  emit('go-home');
  if (window.$router) {
    window.$router.push('/');
  }
};

// 复制错误详情
const copyErrorDetails = async () => {
  try {
    await navigator.clipboard.writeText(errorDetails.value);
    message.success('错误详情已复制到剪贴板');
  } catch (error) {
    console.error('[EnhancedErrorBoundary] Copy failed:', error);
    message.error('复制失败');
  }
};

// 获取组件名称
const getComponentName = () => {
  const instance = errorInfo.value?.instance;
  if (!instance) return 'Unknown';
  return instance.$options?.name || instance.$options?.__name || 'Anonymous';
};

// 获取浏览器信息
const getBrowserInfo = () => {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Edge')) return 'Edge';
  return 'Unknown';
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

// 提供重置方法给子组件
provide('errorBoundaryReset', handleReset);

// 清理定时器
watch(() => hasError.value, (newVal) => {
  if (!newVal && retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
});
</script>

<style scoped lang="scss">
.enhanced-error-boundary {
  width: 100%;
  height: 100%;
}

.error-fallback {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
  padding: 40px 20px;

  &--fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    min-height: 100vh;
    background: rgba(255, 255, 255, 0.98);
    z-index: 9999;
    backdrop-filter: blur(8px);
  }

  .error-icon {
    font-size: 72px;
  }
}

.retry-countdown {
  width: 100%;
  max-width: 400px;
  padding: 16px;
  background: #f0f5ff;
  border-radius: 8px;
  border: 1px solid #adc6ff;

  .retry-text {
    margin-top: 8px;
    text-align: center;
    font-size: 13px;
    color: #1890ff;
    font-weight: 500;
  }
}

.error-details {
  width: 100%;
  max-width: 800px;
  margin-top: 24px;
  padding: 20px;
  background: #fafafa;
  border-radius: 8px;
  border: 1px solid #d9d9d9;

  .error-info,
  .component-info,
  .environment-info {
    .info-item {
      display: flex;
      align-items: flex-start;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;

      &:last-child {
        border-bottom: none;
      }

      .info-label {
        min-width: 100px;
        font-weight: 500;
        color: #595959;
        font-size: 13px;
      }

      .info-value {
        flex: 1;
        color: #262626;
        font-size: 13px;
        word-break: break-all;

        &.small {
          font-size: 11px;
        }
      }
    }
  }

  .stack-trace {
    max-height: 300px;
    overflow: auto;
    background: #ffffff;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    padding: 12px;

    pre {
      margin: 0;
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #262626;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  }

  .details-actions {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #e8e8e8;
    text-align: center;
  }
}

// 动画
.error-fade-enter-active,
.error-fade-leave-active {
  transition: opacity 0.3s ease;
}

.error-fade-enter-from,
.error-fade-leave-to {
  opacity: 0;
}

.details-slide-enter-active,
.details-slide-leave-active {
  transition: all 0.3s ease;
}

.details-slide-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.details-slide-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

// 暗色主题
.dark {
  .error-fallback--fullscreen {
    background: rgba(0, 0, 0, 0.98);
  }

  .retry-countdown {
    background: #111b26;
    border-color: #15395b;

    .retry-text {
      color: #40a9ff;
    }
  }

  .error-details {
    background: #1f1f1f;
    border-color: #3e3e3e;

    .info-item {
      border-bottom-color: #3e3e3e;

      .info-label {
        color: #bfbfbf;
      }

      .info-value {
        color: #ffffff;
      }
    }

    .stack-trace {
      background: #141414;
      border-color: #3e3e3e;

      pre {
        color: #ffffff;
      }
    }

    .details-actions {
      border-top-color: #3e3e3e;
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .error-fallback {
    padding: 20px 16px;
    min-height: 300px;
  }

  .error-details {
    padding: 16px;

    .info-item {
      flex-direction: column;
      gap: 4px;

      .info-label {
        min-width: auto;
      }
    }
  }

  .error-icon {
    font-size: 48px !important;
  }
}
</style>
