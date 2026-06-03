<template>
  <div class="step-display-wrapper">
    <!-- 步骤头部(可点击折叠) -->
    <div
      class="step-header"
      :class="`status-${step.status}`"
      @click="toggleExpanded"
    >
      <div class="step-left">
        <!-- 状态图标 -->
        <div class="status-icon">
          <LoadingOutlined
            v-if="step.status === 'running'"
            spin
          />
          <CheckCircleOutlined v-else-if="step.status === 'completed'" />
          <CloseCircleOutlined v-else-if="step.status === 'failed'" />
          <ClockCircleOutlined v-else />
        </div>

        <!-- 步骤信息 -->
        <div class="step-info">
          <div class="step-name">
            {{ step.name || step.title }}
          </div>
          <div class="step-meta">
            <span
              v-if="step.tool"
              class="step-tool"
            >
              <CodeOutlined />
              {{ step.tool }}
            </span>
            <span
              v-if="step.duration || step.estimatedTime"
              class="step-duration"
            >
              <ClockCircleOutlined />
              {{ formatDuration(step.duration || step.estimatedTime) }}
            </span>
          </div>
        </div>
      </div>

      <div class="step-right">
        <!-- 展开/折叠图标 -->
        <a-button
          type="text"
          size="small"
          class="expand-btn"
          @click.stop="toggleExpanded"
        >
          <DownOutlined :class="{ 'is-expanded': isExpanded }" />
        </a-button>
      </div>
    </div>

    <!-- 步骤内容(可折叠) -->
    <div
      v-if="isExpanded"
      class="step-content"
    >
      <!-- 步骤描述 -->
      <div
        v-if="step.description"
        class="step-description"
      >
        {{ step.description }}
      </div>

      <!-- 步骤参数 -->
      <div
        v-if="step.params && Object.keys(step.params).length > 0"
        class="step-params"
      >
        <div class="params-title">
          参数:
        </div>
        <div class="params-list">
          <div
            v-for="(value, key) in step.params"
            :key="key"
            class="param-item"
          >
            <span class="param-key">{{ key }}:</span>
            <span class="param-value">{{ formatValue(value) }}</span>
          </div>
        </div>
      </div>

      <!-- 步骤输出/结果 -->
      <div
        v-if="step.result"
        class="step-result"
      >
        <div class="result-title">
          输出:
        </div>
        <div class="result-content">
          <!-- 如果结果是字符串,直接显示 -->
          <template v-if="typeof step.result === 'string'">
            <pre class="result-text">{{ step.result }}</pre>
          </template>
          <!-- 如果结果是对象,格式化显示 -->
          <template v-else>
            <div
              v-for="(value, key) in step.result"
              :key="key"
              class="result-item"
            >
              <span class="result-key">{{ key }}:</span>
              <span class="result-value">{{ formatValue(value) }}</span>
            </div>
          </template>
        </div>
      </div>

      <!-- 步骤错误信息 -->
      <div
        v-if="step.error && step.status === 'failed'"
        class="step-error"
      >
        <div class="error-title">
          <ExclamationCircleOutlined />
          错误信息:
        </div>
        <div class="error-message">
          {{ step.error }}
        </div>
      </div>

      <!-- 步骤日志 -->
      <div
        v-if="step.logs && step.logs.length > 0"
        class="step-logs"
      >
        <div class="logs-title">
          <FileTextOutlined />
          执行日志:
        </div>
        <div class="logs-content">
          <div
            v-for="(log, index) in step.logs"
            :key="index"
            class="log-item"
            :class="`log-${log.level || 'info'}`"
          >
            <span class="log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="log-message">{{ log.message }}</span>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div
        v-if="showActions"
        class="step-actions"
      >
        <a-button
          v-if="step.status === 'failed'"
          type="primary"
          size="small"
          @click="handleRetry"
        >
          <RedoOutlined />
          重试
        </a-button>
        <a-button
          v-if="step.status === 'running'"
          danger
          size="small"
          @click="handleCancel"
        >
          <StopOutlined />
          取消
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  DownOutlined,
  CodeOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  RedoOutlined,
  StopOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  step: {
    type: Object,
    required: true,
    validator: (value) => {
      return ['pending', 'running', 'completed', 'failed'].includes(value.status);
    },
  },
  defaultExpanded: {
    type: Boolean,
    default: false,
  },
  showActions: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['retry', 'cancel', 'toggle']);

// 响应式状态
const isExpanded = ref(props.defaultExpanded);

// 计算属性
const statusColor = computed(() => {
  const colors = {
    pending: '#9CA3AF',
    running: '#1677FF',
    completed: '#52C41A',
    failed: '#FF4D4F',
  };
  return colors[props.step.status] || colors.pending;
});

// 切换展开/折叠
const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
  emit('toggle', isExpanded.value);
};

// 格式化时间
const formatDuration = (ms) => {
  if (!ms) {return '-';}
  if (ms < 1000) {return `${ms}ms`;}
  if (ms < 60000) {return `${(ms / 1000).toFixed(1)}s`;}
  return `${(ms / 60000).toFixed(1)}min`;
};

const formatTime = (timestamp) => {
  if (!timestamp) {return '';}
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

// 格式化值
const formatValue = (value) => {
  if (value === null || value === undefined) {return '-';}
  if (typeof value === 'object') {return JSON.stringify(value, null, 2);}
  return String(value);
};

// 处理重试
const handleRetry = () => {
  emit('retry', props.step);
};

// 处理取消
const handleCancel = () => {
  emit('cancel', props.step);
};
</script>

<style scoped lang="scss">
.step-display-wrapper {
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
  transition: all 0.3s;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }
}

.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  transition: background 0.2s;
  border-left: 4px solid transparent;

  &:hover {
    background: #F9FAFB;
  }

  // 状态颜色
  &.status-pending {
    border-left-color: #9CA3AF;
  }

  &.status-running {
    border-left-color: #1677FF;
    background: linear-gradient(90deg, rgba(22, 119, 255, 0.05) 0%, rgba(255, 255, 255, 0) 100%);
  }

  &.status-completed {
    border-left-color: #52C41A;
  }

  &.status-failed {
    border-left-color: #FF4D4F;
    background: linear-gradient(90deg, rgba(255, 77, 79, 0.05) 0%, rgba(255, 255, 255, 0) 100%);
  }
}

.step-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.status-icon {
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;

  .status-pending & {
    color: #9CA3AF;
  }

  .status-running & {
    color: #1677FF;
  }

  .status-completed & {
    color: #52C41A;
  }

  .status-failed & {
    color: #FF4D4F;
  }
}

.step-info {
  flex: 1;
  min-width: 0;
}

.step-name {
  font-size: 15px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: #6B7280;
}

.step-tool,
.step-duration {
  display: flex;
  align-items: center;
  gap: 4px;

  .anticon {
    font-size: 12px;
  }
}

.step-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expand-btn {
  color: #6B7280;

  .anticon {
    transition: transform 0.3s;

    &.is-expanded {
      transform: rotate(180deg);
    }
  }
}

.step-content {
  padding: 0 16px 16px 52px;
  border-top: 1px solid #F3F4F6;
}

.step-description {
  padding: 12px 0;
  color: #6B7280;
  font-size: 14px;
  line-height: 1.6;
}

.step-params,
.step-result,
.step-error,
.step-logs {
  margin-top: 12px;
}

.params-title,
.result-title,
.error-title,
.logs-title {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.params-list,
.result-content {
  background: #F9FAFB;
  border-radius: 6px;
  padding: 12px;
}

.param-item,
.result-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
  font-family: 'Courier New', monospace;
}

.param-key,
.result-key {
  color: #6B7280;
  font-weight: 500;
  min-width: 120px;
  flex-shrink: 0;
}

.param-value,
.result-value {
  color: #333;
  flex: 1;
  word-break: break-all;
}

.result-text {
  margin: 0;
  padding: 12px;
  background: #F9FAFB;
  border-radius: 6px;
  font-size: 13px;
  font-family: 'Courier New', monospace;
  color: #333;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.step-error {
  .error-title {
    color: #FF4D4F;
  }

  .error-message {
    background: #FEF2F2;
    border: 1px solid #FEE2E2;
    border-radius: 6px;
    padding: 12px;
    font-size: 13px;
    color: #DC2626;
    font-family: 'Courier New', monospace;
  }
}

.step-logs {
  .logs-content {
    background: #1F2937;
    border-radius: 6px;
    padding: 12px;
    max-height: 200px;
    overflow-y: auto;
  }

  .log-item {
    display: flex;
    gap: 12px;
    padding: 4px 0;
    font-size: 12px;
    font-family: 'Courier New', monospace;

    &.log-info {
      color: #E5E7EB;
    }

    &.log-warn {
      color: #FCD34D;
    }

    &.log-error {
      color: #F87171;
    }

    &.log-success {
      color: #6EE7B7;
    }
  }

  .log-time {
    color: #9CA3AF;
    flex-shrink: 0;
  }

  .log-message {
    flex: 1;
  }
}

.step-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}
</style>
