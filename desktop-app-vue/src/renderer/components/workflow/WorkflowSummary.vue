<template>
  <a-card class="workflow-summary" :class="summaryClass">
    <template #title>
      <div class="summary-header">
        <span class="summary-icon">{{ summaryIcon }}</span>
        <span class="summary-title">{{ summaryTitle }}</span>
      </div>
    </template>

    <!-- 统计信息 -->
    <div class="summary-stats">
      <a-statistic
        title="总耗时"
        :value="formatDuration(workflow.duration)"
        class="stat-item"
      >
        <template #prefix>
          <ClockCircleOutlined />
        </template>
      </a-statistic>

      <a-statistic
        title="完成阶段"
        :value="completedStages"
        :suffix="`/ ${totalStages}`"
        class="stat-item"
      >
        <template #prefix>
          <CheckCircleOutlined />
        </template>
      </a-statistic>

      <a-statistic
        title="门禁通过率"
        :value="gatePassRate"
        suffix="%"
        class="stat-item"
        :value-style="{ color: gatePassRate >= 80 ? '#52c41a' : '#ff4d4f' }"
      >
        <template #prefix>
          <SafetyCertificateOutlined />
        </template>
      </a-statistic>

      <a-statistic
        title="质量评分"
        :value="qualityScore"
        suffix="/ 100"
        class="stat-item"
        :value-style="{ color: getScoreColor(qualityScore) }"
      >
        <template #prefix>
          <TrophyOutlined />
        </template>
      </a-statistic>
    </div>

    <!-- 阶段概览 -->
    <div class="stages-overview">
      <h4>阶段概览</h4>
      <div class="stages-list">
        <div
          v-for="stage in stages"
          :key="stage.id"
          class="stage-item"
          :class="getStageClass(stage)"
        >
          <div class="stage-info">
            <span class="stage-icon">{{ getStageStatusIcon(stage.status) }}</span>
            <span class="stage-name">{{ stage.name }}</span>
          </div>
          <div class="stage-duration">
            {{ formatDuration(stage.duration) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 失败信息（如果有） -->
    <div v-if="workflow.error" class="error-info">
      <a-alert
        type="error"
        :message="workflow.error"
        show-icon
      >
        <template #description>
          <div v-if="failedStage" class="failed-stage-info">
            失败阶段: {{ failedStage.name }}
          </div>
          <a-button
            type="primary"
            size="small"
            @click="$emit('retry')"
            style="margin-top: 8px"
          >
            <ReloadOutlined />
            重试
          </a-button>
        </template>
      </a-alert>
    </div>

    <!-- 操作按钮 -->
    <div class="summary-actions">
      <a-button
        v-if="workflow.results"
        type="primary"
        @click="$emit('view-result')"
      >
        <EyeOutlined />
        查看结果
      </a-button>
      <a-button @click="$emit('export')">
        <DownloadOutlined />
        导出报告
      </a-button>
      <a-button @click="$emit('close')">
        关闭
      </a-button>
    </div>
  </a-card>
</template>

<script setup>
import { computed } from 'vue';
import {
  ClockCircleOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  TrophyOutlined,
  ReloadOutlined,
  EyeOutlined,
  DownloadOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  workflow: {
    type: Object,
    required: true,
  },
  stages: {
    type: Array,
    default: () => [],
  },
  qualityGates: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['retry', 'view-result', 'export', 'close']);

// 计算属性
const summaryClass = computed(() => ({
  'status-success': props.workflow.success === true,
  'status-failed': props.workflow.success === false,
}));

const summaryIcon = computed(() => {
  if (props.workflow.success === true) return '🎉';
  if (props.workflow.success === false) return '😞';
  return '📋';
});

const summaryTitle = computed(() => {
  if (props.workflow.success === true) return '工作流执行成功';
  if (props.workflow.success === false) return '工作流执行失败';
  return '工作流执行摘要';
});

const totalStages = computed(() => props.stages.length);

const completedStages = computed(() => {
  return props.stages.filter(s => s.status === 'completed').length;
});

const gatePassRate = computed(() => {
  const gates = Object.values(props.qualityGates);
  if (gates.length === 0) return 100;
  const passed = gates.filter(g => g.passed === true || g.status === 'passed').length;
  return Math.round((passed / gates.length) * 100);
});

const qualityScore = computed(() => {
  const gates = Object.values(props.qualityGates);
  if (gates.length === 0) return 100;
  const totalScore = gates.reduce((sum, g) => sum + (g.score || 0), 0);
  return Math.round((totalScore / gates.length) * 100);
});

const failedStage = computed(() => {
  return props.stages.find(s => s.status === 'failed');
});

// 方法
const formatDuration = (ms) => {
  if (!ms || ms === 0) return '0秒';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}分${remainingSeconds}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}时${remainingMinutes}分`;
};

const getScoreColor = (score) => {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#faad14';
  return '#ff4d4f';
};

const getStageClass = (stage) => ({
  completed: stage.status === 'completed',
  failed: stage.status === 'failed',
  pending: stage.status === 'pending',
});

const getStageStatusIcon = (status) => {
  const iconMap = {
    completed: '✅',
    failed: '❌',
    running: '🔄',
    pending: '⏳',
    skipped: '⏭️',
  };
  return iconMap[status] || '📋';
};
</script>

<style scoped lang="scss">
.workflow-summary {
  border-radius: 12px;

  &.status-success {
    border-color: #b7eb8f;

    :deep(.ant-card-head) {
      background: linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%);
    }
  }

  &.status-failed {
    border-color: #ffccc7;

    :deep(.ant-card-head) {
      background: linear-gradient(135deg, #fff2f0 0%, #ffccc7 100%);
    }
  }
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 12px;

  .summary-icon {
    font-size: 24px;
  }

  .summary-title {
    font-size: 18px;
    font-weight: 600;
    color: #262626;
  }
}

.summary-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;

  .stat-item {
    text-align: center;

    :deep(.ant-statistic-title) {
      font-size: 12px;
      color: #8c8c8c;
    }

    :deep(.ant-statistic-content) {
      font-size: 20px;
    }
  }
}

.stages-overview {
  margin-bottom: 24px;

  h4 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: #262626;
  }
}

.stages-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stage-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #fafafa;
  border-radius: 6px;
  border-left: 3px solid #d9d9d9;

  &.completed {
    border-left-color: #52c41a;
    background: #f6ffed;
  }

  &.failed {
    border-left-color: #ff4d4f;
    background: #fff2f0;
  }

  .stage-info {
    display: flex;
    align-items: center;
    gap: 8px;

    .stage-icon {
      font-size: 14px;
    }

    .stage-name {
      font-size: 14px;
      color: #262626;
    }
  }

  .stage-duration {
    font-size: 12px;
    color: #8c8c8c;
  }
}

.error-info {
  margin-bottom: 24px;

  .failed-stage-info {
    font-size: 12px;
    margin-bottom: 4px;
  }
}

.summary-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

@media (max-width: 768px) {
  .summary-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
