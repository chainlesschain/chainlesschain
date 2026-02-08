<template>
  <a-card class="stage-detail" size="small">
    <template #title>
      <div class="stage-header">
        <div class="stage-info">
          <span class="stage-icon">{{ getStageIcon(stage.name) }}</span>
          <span class="stage-name">{{ stage.name }}</span>
          <a-tag :color="getStatusColor(stage.status)" size="small">
            {{ getStatusText(stage.status) }}
          </a-tag>
        </div>
        <a-progress
          :percent="stage.progress || 0"
          :status="getProgressStatus(stage.status)"
          size="small"
          :style="{ width: '180px' }"
        />
      </div>
    </template>

    <!-- 步骤列表 -->
    <div class="steps-list">
      <div
        v-for="(step, index) in stage.steps"
        :key="step.id"
        class="step-item"
        :class="getStepClass(step)"
      >
        <div class="step-status">
          <CheckCircleFilled
            v-if="step.status === 'completed'"
            class="icon-success"
          />
          <LoadingOutlined
            v-else-if="step.status === 'running'"
            spin
            class="icon-running"
          />
          <CloseCircleFilled
            v-else-if="step.status === 'failed'"
            class="icon-error"
          />
          <ClockCircleOutlined v-else class="icon-pending" />
        </div>
        <div class="step-content">
          <div class="step-header">
            <span class="step-name">{{ step.name }}</span>
            <span
              v-if="step.progress > 0 && step.status === 'running'"
              class="step-progress"
            >
              {{ step.progress }}%
            </span>
          </div>
          <div v-if="step.message" class="step-message">
            {{ step.message }}
          </div>
          <!-- 展开详情 -->
          <a-collapse
            v-if="step.details"
            ghost
            size="small"
            class="step-details-collapse"
          >
            <a-collapse-panel key="1" header="查看详情">
              <pre class="step-details">{{ formatDetails(step.details) }}</pre>
            </a-collapse-panel>
          </a-collapse>
        </div>
        <div v-if="step.duration" class="step-duration">
          {{ formatDuration(step.duration) }}
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!stage.steps || stage.steps.length === 0" class="empty-steps">
        <InboxOutlined />
        <span>暂无步骤信息</span>
      </div>
    </div>

    <!-- 质量门禁结果 -->
    <div v-if="qualityGate && qualityGate.checks" class="quality-gate-result">
      <a-divider>
        <SafetyCertificateOutlined />
        质量检查
      </a-divider>
      <div class="gate-checks">
        <div
          v-for="check in qualityGate.checks"
          :key="check.checkId"
          class="check-item"
        >
          <span class="check-icon">
            {{ check.passed ? "✅" : "❌" }}
          </span>
          <span class="check-name">{{ check.name }}</span>
          <span class="check-score" :class="{ low: check.score < 0.7 }">
            {{ (check.score * 100).toFixed(0) }}%
          </span>
        </div>
      </div>
      <div class="gate-summary">
        <a-statistic
          title="质量评分"
          :value="qualityGate.score"
          :precision="2"
          suffix="/ 1.0"
          :value-style="{ color: getScoreColor(qualityGate.score) }"
        />
        <a-tag :color="qualityGate.passed ? 'success' : 'error'">
          {{ qualityGate.passed ? "门禁通过" : "门禁失败" }}
        </a-tag>
      </div>
    </div>
  </a-card>
</template>

<script setup>
import { computed } from "vue";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ClockCircleOutlined,
  InboxOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  stage: {
    type: Object,
    required: true,
  },
  qualityGate: {
    type: Object,
    default: null,
  },
});

// 方法
const getStageIcon = (stageName) => {
  const iconMap = {
    需求分析: "1",
    方案设计: "2",
    内容生成: "3",
    质量验证: "4",
    集成优化: "5",
    交付确认: "6",
  };
  return iconMap[stageName] || "?";
};

const getStatusColor = (status) => {
  const colorMap = {
    pending: "default",
    running: "processing",
    completed: "success",
    failed: "error",
    skipped: "warning",
  };
  return colorMap[status] || "default";
};

const getStatusText = (status) => {
  const textMap = {
    pending: "等待中",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    skipped: "已跳过",
  };
  return textMap[status] || "未知";
};

const getProgressStatus = (status) => {
  if (status === "failed") {
    return "exception";
  }
  if (status === "completed") {
    return "success";
  }
  return "active";
};

const getStepClass = (step) => {
  return {
    completed: step.status === "completed",
    running: step.status === "running",
    failed: step.status === "failed",
    pending: step.status === "pending",
  };
};

const getScoreColor = (score) => {
  if (score >= 0.8) {
    return "#52c41a";
  }
  if (score >= 0.6) {
    return "#faad14";
  }
  return "#ff4d4f";
};

const formatDuration = (ms) => {
  if (!ms || ms === 0) {
    return "";
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds}秒`;
};

const formatDetails = (details) => {
  if (typeof details === "string") {
    return details;
  }
  return JSON.stringify(details, null, 2);
};
</script>

<style scoped lang="scss">
.stage-detail {
  :deep(.ant-card-head) {
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    border-radius: 8px 8px 0 0;
  }
}

.stage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;

  .stage-info {
    display: flex;
    align-items: center;
    gap: 8px;

    .stage-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 50%;
      font-size: 14px;
      font-weight: 600;
    }

    .stage-name {
      font-size: 16px;
      font-weight: 600;
      color: #262626;
    }
  }
}

.steps-list {
  padding: 8px 0;
}

.step-item {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  margin-bottom: 8px;
  background: #fafafa;
  border-radius: 6px;
  border-left: 3px solid #d9d9d9;
  transition: all 0.3s;

  &:last-child {
    margin-bottom: 0;
  }

  &:hover {
    background: #f5f5f5;
  }

  &.completed {
    border-left-color: #52c41a;
    background: #f6ffed;
  }

  &.running {
    border-left-color: #1890ff;
    background: #e6f7ff;
    animation: pulse-bg 2s ease-in-out infinite;
  }

  &.failed {
    border-left-color: #ff4d4f;
    background: #fff2f0;
  }

  .step-status {
    margin-right: 12px;
    font-size: 16px;

    .icon-success {
      color: #52c41a;
    }

    .icon-running {
      color: #1890ff;
    }

    .icon-error {
      color: #ff4d4f;
    }

    .icon-pending {
      color: #8c8c8c;
    }
  }

  .step-content {
    flex: 1;

    .step-header {
      display: flex;
      align-items: center;
      gap: 8px;

      .step-name {
        font-size: 14px;
        font-weight: 500;
        color: #262626;
      }

      .step-progress {
        font-size: 12px;
        color: #1890ff;
        font-weight: 600;
      }
    }

    .step-message {
      margin-top: 4px;
      font-size: 12px;
      color: #8c8c8c;
    }

    .step-details-collapse {
      margin-top: 8px;

      :deep(.ant-collapse-header) {
        padding: 4px 8px;
        font-size: 12px;
      }

      .step-details {
        margin: 0;
        padding: 8px;
        background: #f0f0f0;
        border-radius: 4px;
        font-size: 11px;
        max-height: 200px;
        overflow: auto;
      }
    }
  }

  .step-duration {
    font-size: 12px;
    color: #8c8c8c;
    white-space: nowrap;
  }
}

.empty-steps {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  color: #8c8c8c;
  font-size: 14px;

  :deep(.anticon) {
    font-size: 32px;
    margin-bottom: 8px;
  }
}

.quality-gate-result {
  margin-top: 16px;
  padding-top: 16px;

  :deep(.ant-divider) {
    margin: 0 0 16px 0;
    font-size: 14px;
    color: #595959;
  }
}

.gate-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #fafafa;
  border-radius: 16px;
  font-size: 12px;

  .check-icon {
    font-size: 14px;
  }

  .check-name {
    color: #595959;
  }

  .check-score {
    font-weight: 600;
    color: #52c41a;

    &.low {
      color: #ff4d4f;
    }
  }
}

.gate-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fafafa;
  border-radius: 8px;
}

@keyframes pulse-bg {
  0%,
  100% {
    background: #e6f7ff;
  }
  50% {
    background: #bae7ff;
  }
}
</style>
