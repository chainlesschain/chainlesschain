<template>
  <div class="task-detail-panel">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" tip="加载任务详情..." />
    </div>

    <!-- 任务详情 -->
    <div v-else>
      <!-- 基本信息 -->
      <a-descriptions
        title="基本信息"
        :column="1"
        bordered
        class="info-section"
      >
        <a-descriptions-item label="任务 ID">
          <a-typography-text copyable>{{ task.id }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="任务名称">
          {{ task.name }}
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="getTaskStatusColor(task.status)">
            {{ getTaskStatusText(task.status) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="描述">
          {{ task.description || "-" }}
        </a-descriptions-item>
        <a-descriptions-item label="所属团队">
          <a-tag color="blue">{{ task.teamId }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="执行者">
          <a-tag v-if="task.assignedTo" color="geekblue">
            {{ task.assignedTo }}
          </a-tag>
          <span v-else style="color: #8c8c8c;">未分配</span>
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">
          {{ formatDateTime(task.createdAt) }}
        </a-descriptions-item>
        <a-descriptions-item v-if="task.startedAt" label="开始时间">
          {{ formatDateTime(task.startedAt) }}
        </a-descriptions-item>
        <a-descriptions-item v-if="task.completedAt" label="完成时间">
          {{ formatDateTime(task.completedAt) }}
        </a-descriptions-item>
        <a-descriptions-item label="耗时">
          {{ formatDuration(task.duration || 0) }}
        </a-descriptions-item>
      </a-descriptions>

      <!-- 进度信息 -->
      <div class="info-section">
        <h3 class="section-title">
          <RiseOutlined />
          执行进度
        </h3>

        <div class="progress-container">
          <a-progress
            :percent="task.progress || 0"
            :status="getProgressStatus(task)"
          />
          <div v-if="task.progressMessage" class="progress-message">
            {{ task.progressMessage }}
          </div>
        </div>

        <!-- 步骤列表（如果有） -->
        <div v-if="task.steps && task.steps.length > 0" class="steps-container">
          <a-steps
            :current="currentStepIndex"
            :status="getStepsStatus(task)"
            direction="vertical"
            size="small"
          >
            <a-step
              v-for="(step, index) in task.steps"
              :key="index"
              :title="step.name"
              :description="step.description"
            />
          </a-steps>
        </div>
      </div>

      <!-- 检查点列表 -->
      <div v-if="task.checkpoints && task.checkpoints.length > 0" class="info-section">
        <h3 class="section-title">
          <SaveOutlined />
          检查点
        </h3>

        <a-timeline>
          <a-timeline-item
            v-for="(checkpoint, index) in task.checkpoints"
            :key="checkpoint.id || index"
            :color="index === 0 ? 'green' : 'gray'"
          >
            <div class="checkpoint-item">
              <div class="checkpoint-header">
                <strong>检查点 #{{ task.checkpoints.length - index }}</strong>
                <span class="checkpoint-time">
                  {{ formatDateTime(checkpoint.timestamp) }}
                </span>
              </div>
              <div v-if="checkpoint.reason" class="checkpoint-reason">
                原因: {{ checkpoint.reason }}
              </div>
              <div v-if="checkpoint.progress !== undefined" class="checkpoint-progress">
                进度: {{ checkpoint.progress }}%
              </div>
            </div>
          </a-timeline-item>
        </a-timeline>
      </div>

      <!-- 错误信息 -->
      <div v-if="task.error" class="info-section">
        <h3 class="section-title">
          <ExclamationCircleOutlined style="color: #f5222d;" />
          错误信息
        </h3>

        <a-alert
          :message="task.error.message || '未知错误'"
          :description="task.error.stack"
          type="error"
          show-icon
        />

        <div v-if="task.retryCount !== undefined" style="margin-top: 12px;">
          <a-tag color="orange">
            已重试: {{ task.retryCount }} 次
          </a-tag>
        </div>
      </div>

      <!-- 结果信息 -->
      <div v-if="task.result && task.status === 'completed'" class="info-section">
        <h3 class="section-title">
          <CheckCircleOutlined style="color: #52c41a;" />
          执行结果
        </h3>

        <pre class="result-content">{{ formatResult(task.result) }}</pre>
      </div>

      <!-- 操作按钮 -->
      <div class="actions-section">
        <a-space>
          <a-button @click="emit('refresh')">
            <ReloadOutlined />
            刷新
          </a-button>
          <a-button
            v-if="task.status === 'running'"
            type="primary"
            @click="emit('pause', task)"
          >
            <PauseCircleOutlined />
            暂停任务
          </a-button>
          <a-button
            v-if="task.status === 'paused'"
            type="primary"
            @click="emit('resume', task)"
          >
            <PlayCircleOutlined />
            恢复任务
          </a-button>
          <a-button
            v-if="['pending', 'running', 'paused'].includes(task.status)"
            danger
            @click="emit('cancel', task)"
          >
            <StopOutlined />
            取消任务
          </a-button>
          <a-button
            v-if="task.status === 'running'"
            @click="handleCreateCheckpoint"
          >
            <SaveOutlined />
            创建检查点
          </a-button>
        </a-space>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { message } from "ant-design-vue";
import {
  RiseOutlined,
  SaveOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from "@ant-design/icons-vue";
import { format } from "date-fns";
import { logger, createLogger } from '@/utils/logger';

const taskDetailLogger = createLogger('task-detail');

// Props
const props = defineProps({
  task: {
    type: Object,
    required: true,
  },
});

// Emits
const emit = defineEmits(["refresh", "pause", "resume", "cancel", "close"]);

// 状态
const loading = ref(false);

// 计算当前步骤索引
const currentStepIndex = computed(() => {
  if (!props.task.steps || props.task.steps.length === 0) return 0;

  const progress = props.task.progress || 0;
  const stepSize = 100 / props.task.steps.length;

  return Math.floor(progress / stepSize);
});

// ==========================================
// 操作处理
// ==========================================

async function handleCreateCheckpoint() {
  message.info("创建检查点功能即将上线");
  // TODO: 调用 IPC 创建检查点
}

// ==========================================
// 辅助函数
// ==========================================

function getTaskStatusColor(status) {
  const colors = {
    pending: "default",
    running: "processing",
    paused: "warning",
    completed: "success",
    failed: "error",
    cancelled: "default",
  };
  return colors[status] || "default";
}

function getTaskStatusText(status) {
  const texts = {
    pending: "待处理",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return texts[status] || status;
}

function getProgressStatus(task) {
  if (task.status === "failed") return "exception";
  if (task.status === "completed") return "success";
  if (task.status === "running") return "active";
  return "normal";
}

function getStepsStatus(task) {
  if (task.status === "failed") return "error";
  if (task.status === "completed") return "finish";
  return "process";
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";

  try {
    return format(new Date(timestamp), "yyyy-MM-dd HH:mm:ss");
  } catch (error) {
    return "-";
  }
}

function formatDuration(ms) {
  if (!ms || ms === 0) return "-";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours} 小时 ${minutes % 60} 分钟`;
  } else if (minutes > 0) {
    return `${minutes} 分钟 ${seconds % 60} 秒`;
  } else {
    return `${seconds} 秒`;
  }
}

function formatResult(result) {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch (error) {
    return String(result);
  }
}
</script>

<style scoped lang="scss">
.task-detail-panel {
  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 60px 0;
  }

  .info-section {
    margin-bottom: 24px;

    :deep(.ant-descriptions-title) {
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 16px;
    }
  }

  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;

    :deep(.anticon) {
      color: #1890ff;
    }
  }

  .progress-container {
    padding: 16px;
    background: #fafafa;
    border-radius: 8px;

    .progress-message {
      margin-top: 12px;
      color: #595959;
      font-size: 14px;
    }
  }

  .steps-container {
    margin-top: 24px;
  }

  .checkpoint-item {
    .checkpoint-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;

      strong {
        color: #262626;
      }

      .checkpoint-time {
        color: #8c8c8c;
        font-size: 12px;
      }
    }

    .checkpoint-reason,
    .checkpoint-progress {
      font-size: 13px;
      color: #595959;
      margin-top: 4px;
    }
  }

  .result-content {
    background: #fafafa;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    padding: 12px;
    font-size: 13px;
    font-family: "Courier New", monospace;
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 400px;
    overflow-y: auto;
  }

  .actions-section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #f0f0f0;
    display: flex;
    justify-content: flex-end;
  }
}
</style>
