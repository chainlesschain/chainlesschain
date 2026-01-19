<template>
  <div class="thinking-process">
    <div class="thinking-header">
      <div class="thinking-icon">
        <LoadingOutlined spin />
      </div>
      <div class="thinking-title">
        {{ currentStage }}
      </div>
    </div>

    <!-- 进度条 -->
    <div
      v-if="showProgress"
      class="progress-container"
    >
      <a-progress
        :percent="progress"
        :show-info="true"
        :status="status"
        stroke-color="#667eea"
      />
      <div class="progress-text">
        {{ progressText }}
      </div>
    </div>

    <!-- 步骤列表 -->
    <div
      v-if="steps.length > 0"
      class="steps-container"
    >
      <div
        v-for="(step, index) in steps"
        :key="index"
        :class="['step-item', step.status]"
      >
        <div class="step-icon">
          <CheckCircleOutlined
            v-if="step.status === 'completed'"
            class="completed"
          />
          <LoadingOutlined
            v-else-if="step.status === 'in-progress'"
            spin
            class="in-progress"
          />
          <ClockCircleOutlined
            v-else
            class="pending"
          />
        </div>
        <div class="step-content">
          <div class="step-title">
            {{ step.title }}
          </div>
          <div
            v-if="step.description"
            class="step-description"
          >
            {{ step.description }}
          </div>
          <div
            v-if="step.duration"
            class="step-duration"
          >
            {{ formatDuration(step.duration) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 流式内容预览 -->
    <div
      v-if="streamingContent"
      class="streaming-content"
    >
      <div class="streaming-label">
        生成中...
      </div>
      <div
        class="streaming-text"
        v-html="renderMarkdown(streamingContent)"
      />
    </div>

    <!-- 取消按钮 -->
    <div
      v-if="showCancelButton"
      class="action-buttons"
    >
      <a-button
        size="small"
        @click="handleCancel"
      >
        <CloseOutlined />
        取消
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  LoadingOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseOutlined
} from '@ant-design/icons-vue';
import { marked } from 'marked';

const props = defineProps({
  currentStage: {
    type: String,
    default: '正在思考...'
  },
  progress: {
    type: Number,
    default: 0
  },
  showProgress: {
    type: Boolean,
    default: true
  },
  progressText: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    default: 'active', // 'active' | 'success' | 'exception'
    validator: (value) => ['active', 'success', 'exception'].includes(value)
  },
  steps: {
    type: Array,
    default: () => []
    // 每个step格式: { title: string, description?: string, status: 'pending' | 'in-progress' | 'completed', duration?: number }
  },
  streamingContent: {
    type: String,
    default: ''
  },
  showCancelButton: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['cancel']);

// 渲染Markdown
const renderMarkdown = (content) => {
  try {
    return marked.parse(content || '');
  } catch (error) {
    return content;
  }
};

// 格式化持续时间
const formatDuration = (ms) => {
  if (ms < 1000) {return `${ms}ms`;}
  if (ms < 60000) {return `${(ms / 1000).toFixed(1)}s`;}
  return `${(ms / 60000).toFixed(1)}min`;
};

// 处理取消
const handleCancel = () => {
  emit('cancel');
};
</script>

<style scoped>
.thinking-process {
  padding: 20px;
  background: linear-gradient(135deg, #f5f7fa 0%, #eef2f7 100%);
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  margin: 16px 0;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.thinking-icon {
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 16px;
}

.thinking-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

/* 进度条 */
.progress-container {
  margin-bottom: 16px;
}

.progress-text {
  margin-top: 8px;
  font-size: 13px;
  color: #6b7280;
  text-align: center;
}

/* 步骤列表 */
.steps-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: white;
  border-radius: 8px;
  transition: all 0.3s;
}

.step-item.in-progress {
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
  background: linear-gradient(90deg, rgba(102, 126, 234, 0.05) 0%, transparent 100%);
}

.step-item.completed {
  opacity: 0.7;
}

.step-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.step-icon .completed {
  color: #10b981;
}

.step-icon .in-progress {
  color: #667eea;
}

.step-icon .pending {
  color: #9ca3af;
}

.step-content {
  flex: 1;
}

.step-title {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 4px;
}

.step-description {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.4;
}

.step-duration {
  margin-top: 4px;
  font-size: 11px;
  color: #9ca3af;
}

/* 流式内容 */
.streaming-content {
  padding: 16px;
  background: white;
  border-radius: 8px;
  border-left: 3px solid #667eea;
  margin-bottom: 16px;
}

.streaming-label {
  font-size: 12px;
  font-weight: 600;
  color: #667eea;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.streaming-text {
  font-size: 14px;
  line-height: 1.6;
  color: #374151;
  max-height: 200px;
  overflow-y: auto;
}

.streaming-text::-webkit-scrollbar {
  width: 4px;
}

.streaming-text::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 2px;
}

/* 动作按钮 */
.action-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
