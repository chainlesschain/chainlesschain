<template>
  <div class="step-timeline">
    <a-timeline>
      <a-timeline-item
        v-for="(step, index) in steps"
        :key="step.id || index"
        :color="getTimelineColor(step)"
      >
        <template #dot>
          <div class="timeline-dot" :class="getDotClass(step)">
            <CheckCircleFilled v-if="step.status === 'completed'" />
            <LoadingOutlined v-else-if="step.status === 'running'" spin />
            <CloseCircleFilled v-else-if="step.status === 'failed'" />
            <ClockCircleOutlined v-else />
          </div>
        </template>

        <div class="timeline-content" :class="getContentClass(step)">
          <div class="timeline-header">
            <span class="timeline-type-badge" :class="step.type">
              {{ step.type === "stage" ? "阶段" : "步骤" }}
            </span>
            <span class="timeline-name">{{ step.name }}</span>
            <span
              v-if="step.progress > 0 && step.status === 'running'"
              class="timeline-progress"
            >
              {{ step.progress }}%
            </span>
          </div>

          <div v-if="step.message" class="timeline-message">
            {{ step.message }}
          </div>

          <div class="timeline-meta">
            <span v-if="step.time" class="timeline-time">
              <ClockCircleOutlined />
              {{ formatTime(step.time) }}
            </span>
            <span v-if="step.duration" class="timeline-duration">
              耗时: {{ formatDuration(step.duration) }}
            </span>
          </div>
        </div>
      </a-timeline-item>
    </a-timeline>

    <!-- 空状态 -->
    <div v-if="!steps || steps.length === 0" class="empty-state">
      <InboxOutlined />
      <span>暂无执行记录</span>
    </div>
  </div>
</template>

<script setup>
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ClockCircleOutlined,
  InboxOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  steps: {
    type: Array,
    default: () => [],
  },
});

// 方法
const getTimelineColor = (step) => {
  const colorMap = {
    completed: "green",
    running: "blue",
    failed: "red",
    pending: "gray",
  };
  return colorMap[step.status] || "gray";
};

const getDotClass = (step) => ({
  completed: step.status === "completed",
  running: step.status === "running",
  failed: step.status === "failed",
  pending: step.status === "pending",
  "is-stage": step.type === "stage",
});

const getContentClass = (step) => ({
  "is-stage": step.type === "stage",
  "is-running": step.status === "running",
  "is-failed": step.status === "failed",
});

const formatTime = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const formatDuration = (ms) => {
  if (!ms || ms === 0) {
    return "0秒";
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}分${remainingSeconds}秒`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}时${remainingMinutes}分`;
};
</script>

<style scoped lang="scss">
.step-timeline {
  padding: 8px 0;
}

.timeline-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 12px;
  background: #fff;

  &.completed {
    color: #52c41a;
  }

  &.running {
    color: #1890ff;
  }

  &.failed {
    color: #ff4d4f;
  }

  &.pending {
    color: #8c8c8c;
  }

  &.is-stage {
    width: 28px;
    height: 28px;
    font-size: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
}

.timeline-content {
  padding: 8px 12px;
  background: #fafafa;
  border-radius: 6px;
  margin-left: 8px;
  transition: all 0.3s;

  &.is-stage {
    background: linear-gradient(135deg, #f5f7fa 0%, #e4e9f2 100%);
    border-left: 3px solid #667eea;
  }

  &.is-running {
    background: #e6f7ff;
    border-left: 3px solid #1890ff;
    animation: pulse-timeline 2s ease-in-out infinite;
  }

  &.is-failed {
    background: #fff2f0;
    border-left: 3px solid #ff4d4f;
  }
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;

  .timeline-type-badge {
    display: inline-block;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 600;
    border-radius: 10px;
    text-transform: uppercase;

    &.stage {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    &.step {
      background: #e6e6e6;
      color: #595959;
    }
  }

  .timeline-name {
    font-size: 14px;
    font-weight: 500;
    color: #262626;
  }

  .timeline-progress {
    font-size: 12px;
    font-weight: 600;
    color: #1890ff;
    padding: 2px 6px;
    background: rgba(24, 144, 255, 0.1);
    border-radius: 4px;
  }
}

.timeline-message {
  font-size: 12px;
  color: #595959;
  margin-bottom: 8px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
}

.timeline-meta {
  display: flex;
  gap: 16px;
  font-size: 11px;
  color: #8c8c8c;

  .timeline-time,
  .timeline-duration {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px;
  color: #8c8c8c;

  :deep(.anticon) {
    font-size: 40px;
    margin-bottom: 12px;
  }
}

@keyframes pulse-timeline {
  0%,
  100% {
    background: #e6f7ff;
  }
  50% {
    background: #bae7ff;
  }
}
</style>
