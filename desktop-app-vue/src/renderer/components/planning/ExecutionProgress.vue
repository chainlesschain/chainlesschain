<template>
  <div class="execution-progress">
    <!-- 进度条 -->
    <div class="progress-header">
      <h3>正在执行任务...</h3>
      <div class="progress-stats">
        <span>{{ progress.currentStep }} / {{ progress.totalSteps }}</span>
        <span class="percentage">{{ percentage }}%</span>
      </div>
    </div>

    <a-progress
      :percent="percentage"
      :status="getProgressStatus()"
      stroke-color="#667eea"
      :show-info="false"
    />

    <!-- 当前状态 -->
    <div class="current-status">
      <a-spin />
      <span>{{ progress.status }}</span>
    </div>

    <!-- 执行日志 -->
    <div class="execution-logs">
      <div class="logs-header">
        <strong>执行日志</strong>
        <a-button
          type="text"
          size="small"
          @click="showAllLogs = !showAllLogs"
        >
          {{ showAllLogs ? '收起' : '展开' }}
        </a-button>
      </div>
      <div
        v-if="showAllLogs"
        class="logs-content"
        ref="logsContainer"
      >
        <div
          v-for="(log, index) in progress.logs"
          :key="index"
          class="log-entry"
        >
          <span class="log-time">{{ formatTime(log.timestamp) }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
        <div v-if="!progress.logs || progress.logs.length === 0" class="empty-logs">
          暂无日志
        </div>
      </div>
    </div>

    <!-- 提示信息 -->
    <a-alert
      message="执行过程中请勿关闭窗口"
      type="info"
      show-icon
      class="execution-alert"
    />
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';

const props = defineProps({
  progress: {
    type: Object,
    required: true
  },
  percentage: {
    type: Number,
    default: 0
  }
});

const showAllLogs = ref(false);
const logsContainer = ref(null);

// 获取进度条状态
const getProgressStatus = () => {
  if (props.percentage === 100) return 'success';
  if (props.percentage === 0) return 'normal';
  return 'active';
};

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

// 自动滚动到底部
watch(
  () => props.progress.logs,
  async () => {
    if (showAllLogs.value) {
      await nextTick();
      if (logsContainer.value) {
        logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
      }
    }
  },
  { deep: true }
);
</script>

<style scoped>
.execution-progress {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  background: #f9f9f9;
  border-radius: 8px;
}

/* 进度头部 */
.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-header h3 {
  margin: 0;
  font-size: 18px;
  color: #333;
}

.progress-stats {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 14px;
  color: #666;
}

.percentage {
  font-size: 24px;
  font-weight: 600;
  color: #667eea;
}

/* 当前状态 */
.current-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: white;
  border-radius: 6px;
  border-left: 4px solid #667eea;
}

.current-status span {
  font-size: 14px;
  color: #666;
}

/* 执行日志 */
.execution-logs {
  background: white;
  border-radius: 6px;
  overflow: hidden;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
}

.logs-content {
  max-height: 300px;
  overflow-y: auto;
  padding: 12px 16px;
}

.log-entry {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
  font-family: 'Monaco', 'Consolas', monospace;
}

.log-time {
  color: #999;
  flex-shrink: 0;
}

.log-message {
  color: #333;
  word-break: break-all;
}

.empty-logs {
  text-align: center;
  color: #999;
  padding: 24px;
}

/* 提示信息 */
.execution-alert {
  margin-top: 8px;
}

/* 滚动条样式 */
.logs-content::-webkit-scrollbar {
  width: 6px;
}

.logs-content::-webkit-scrollbar-track {
  background: #f5f5f5;
}

.logs-content::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 3px;
}

.logs-content::-webkit-scrollbar-thumb:hover {
  background: #bfbfbf;
}
</style>
