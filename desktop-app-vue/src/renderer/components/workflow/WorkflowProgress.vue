<template>
  <div class="workflow-progress">
    <!-- 顶部概览 -->
    <div class="workflow-header">
      <div class="workflow-title">
        <h2>{{ workflow.title || '项目工作流' }}</h2>
        <a-tag :color="statusColor">{{ statusText }}</a-tag>
      </div>
      <div class="workflow-meta">
        <span class="elapsed-time">
          <ClockCircleOutlined />
          {{ formatDuration(elapsedTime) }}
        </span>
        <span class="workflow-id">ID: {{ workflow.workflowId }}</span>
      </div>
    </div>

    <!-- 阶段进度条 -->
    <div class="stages-progress">
      <a-steps
        :current="currentStageIndex"
        :status="stepsStatus"
        size="small"
      >
        <a-step
          v-for="(stage, index) in stages"
          :key="stage.id"
          :title="stage.name"
          :description="getStageDescription(stage, index)"
        >
          <template #icon>
            <div class="step-icon" :class="getStepIconClass(stage, index)">
              <CheckCircleFilled v-if="stage.status === 'completed'" />
              <CloseCircleFilled v-else-if="stage.status === 'failed'" />
              <LoadingOutlined v-else-if="stage.status === 'running'" spin />
              <span v-else class="step-number">{{ index + 1 }}</span>
            </div>
          </template>
        </a-step>
      </a-steps>
    </div>

    <!-- 整体进度 -->
    <div class="overall-progress">
      <div class="progress-label">
        <span>整体进度</span>
        <span class="progress-percent">{{ overallPercent }}%</span>
      </div>
      <a-progress
        :percent="overallPercent"
        :status="progressStatus"
        :stroke-color="progressGradient"
        :show-info="false"
      />
    </div>

    <!-- 当前阶段详情 -->
    <StageDetail
      v-if="currentStage"
      :stage="currentStage"
      :quality-gate="currentQualityGate"
      class="current-stage-detail"
    />

    <!-- 质量门禁状态 -->
    <div class="quality-gates-section">
      <div class="section-header">
        <h3>
          <SafetyCertificateOutlined />
          质量门禁状态
        </h3>
        <a-button
          size="small"
          type="text"
          @click="toggleGatesExpand"
        >
          {{ gatesExpanded ? '收起' : '展开' }}
        </a-button>
      </div>
      <div v-show="gatesExpanded" class="gates-grid">
        <QualityGateCard
          v-for="(gate, gateId) in qualityGates"
          :key="gateId"
          :gate="gate"
          @override="handleGateOverride"
        />
      </div>
    </div>

    <!-- 执行日志 -->
    <div class="execution-logs">
      <div class="section-header">
        <h3>
          <FileTextOutlined />
          执行详情
        </h3>
        <a-button
          size="small"
          type="text"
          @click="toggleLogsExpand"
        >
          {{ logsExpanded ? '收起' : '展开' }}
        </a-button>
      </div>
      <div v-show="logsExpanded" class="logs-container">
        <StepTimeline :steps="executionSteps" />
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="workflow-actions">
      <a-button
        v-if="canPause"
        type="default"
        @click="handlePause"
      >
        <PauseCircleOutlined />
        暂停
      </a-button>
      <a-button
        v-if="canResume"
        type="primary"
        @click="handleResume"
      >
        <PlayCircleOutlined />
        继续
      </a-button>
      <a-button
        v-if="canRetry"
        type="primary"
        @click="handleRetry"
      >
        <ReloadOutlined />
        重试
      </a-button>
      <a-popconfirm
        v-if="canCancel"
        title="确定要取消工作流吗？"
        ok-text="确定"
        cancel-text="取消"
        @confirm="handleCancel"
      >
        <a-button danger>
          <StopOutlined />
          取消
        </a-button>
      </a-popconfirm>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  ClockCircleOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  SafetyCertificateOutlined,
  FileTextOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons-vue';
import StageDetail from './StageDetail.vue';
import QualityGateCard from './QualityGateCard.vue';
import StepTimeline from './StepTimeline.vue';

const props = defineProps({
  workflowId: {
    type: String,
    required: true,
  },
  autoRefresh: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['complete', 'error', 'update']);

// 状态
const workflow = ref({});
const stages = ref([]);
const qualityGates = ref({});
const logs = ref([]);
const elapsedTime = ref(0);
const gatesExpanded = ref(true);
const logsExpanded = ref(true);
const elapsedTimer = ref(null);

// 计算属性
const currentStageIndex = computed(() => {
  return workflow.value.overall?.stage - 1 || 0;
});

const currentStage = computed(() => {
  return workflow.value.currentStage || null;
});

const currentQualityGate = computed(() => {
  if (!currentStage.value?.id) return null;
  const gateId = `gate_${currentStageIndex.value + 1}_${getStageKey(currentStageIndex.value)}`;
  return qualityGates.value[gateId] || null;
});

const overallPercent = computed(() => {
  return workflow.value.overall?.percent || 0;
});

const statusText = computed(() => {
  const statusMap = {
    idle: '等待中',
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return statusMap[workflow.value.overall?.status] || '未知';
});

const statusColor = computed(() => {
  const colorMap = {
    idle: 'default',
    running: 'processing',
    paused: 'warning',
    completed: 'success',
    failed: 'error',
    cancelled: 'default',
  };
  return colorMap[workflow.value.overall?.status] || 'default';
});

const stepsStatus = computed(() => {
  const status = workflow.value.overall?.status;
  if (status === 'failed') return 'error';
  if (status === 'completed') return 'finish';
  return 'process';
});

const progressStatus = computed(() => {
  const status = workflow.value.overall?.status;
  if (status === 'failed') return 'exception';
  if (status === 'completed') return 'success';
  return 'active';
});

const progressGradient = computed(() => ({
  '0%': '#108ee9',
  '100%': '#87d068',
}));

const canPause = computed(() => {
  return workflow.value.overall?.status === 'running';
});

const canResume = computed(() => {
  return workflow.value.overall?.status === 'paused';
});

const canRetry = computed(() => {
  return workflow.value.overall?.status === 'failed';
});

const canCancel = computed(() => {
  return ['running', 'paused'].includes(workflow.value.overall?.status);
});

const executionSteps = computed(() => {
  const steps = [];

  stages.value.forEach((stage, stageIndex) => {
    // 添加阶段
    steps.push({
      type: 'stage',
      id: stage.id,
      name: stage.name,
      status: stage.status,
      time: stage.startTime,
      duration: stage.duration,
    });

    // 添加阶段内的步骤
    if (stage.steps) {
      stage.steps.forEach(step => {
        steps.push({
          type: 'step',
          id: step.id,
          name: step.name,
          status: step.status,
          progress: step.progress,
          message: step.message,
          time: step.startTime,
          duration: step.duration,
          parentStageId: stage.id,
        });
      });
    }
  });

  return steps;
});

// 方法
const getStageKey = (index) => {
  const keys = ['analysis', 'design', 'generation', 'validation', 'integration', 'delivery'];
  return keys[index] || 'unknown';
};

const getStageDescription = (stage, index) => {
  if (stage.status === 'completed') {
    return `完成 (${formatDuration(stage.duration)})`;
  }
  if (stage.status === 'running') {
    return `${stage.progress || 0}%`;
  }
  if (stage.status === 'failed') {
    return '失败';
  }
  return '';
};

const getStepIconClass = (stage, index) => {
  return {
    completed: stage.status === 'completed',
    running: stage.status === 'running',
    failed: stage.status === 'failed',
    pending: stage.status === 'pending',
  };
};

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

const toggleGatesExpand = () => {
  gatesExpanded.value = !gatesExpanded.value;
};

const toggleLogsExpand = () => {
  logsExpanded.value = !logsExpanded.value;
};

// IPC 操作
const handlePause = async () => {
  try {
    const result = await window.ipc.invoke('workflow:pause', {
      workflowId: props.workflowId,
    });
    if (!result.success) {
      message.error(result.error || '暂停失败');
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const handleResume = async () => {
  try {
    const result = await window.ipc.invoke('workflow:resume', {
      workflowId: props.workflowId,
    });
    if (!result.success) {
      message.error(result.error || '恢复失败');
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const handleRetry = async () => {
  try {
    const result = await window.ipc.invoke('workflow:retry', {
      workflowId: props.workflowId,
    });
    if (!result.success) {
      message.error(result.error || '重试失败');
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const handleCancel = async () => {
  try {
    const result = await window.ipc.invoke('workflow:cancel', {
      workflowId: props.workflowId,
      reason: '用户取消',
    });
    if (!result.success) {
      message.error(result.error || '取消失败');
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const handleGateOverride = async (gateId) => {
  try {
    const result = await window.ipc.invoke('workflow:override-gate', {
      workflowId: props.workflowId,
      gateId,
      reason: '手动覆盖',
    });
    if (result.success) {
      message.success('门禁已跳过');
    } else {
      message.error(result.error || '操作失败');
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

// 数据加载
const loadWorkflowStatus = async () => {
  try {
    const result = await window.ipc.invoke('workflow:get-status', {
      workflowId: props.workflowId,
    });
    if (result.success) {
      workflow.value = result.data;
      qualityGates.value = result.data.qualityGates || {};
      emit('update', result.data);
    }
  } catch (error) {
    console.error('加载工作流状态失败:', error);
  }
};

const loadStages = async () => {
  try {
    const result = await window.ipc.invoke('workflow:get-stages', {
      workflowId: props.workflowId,
    });
    if (result.success) {
      stages.value = result.data;
    }
  } catch (error) {
    console.error('加载阶段失败:', error);
  }
};

const loadLogs = async () => {
  try {
    const result = await window.ipc.invoke('workflow:get-logs', {
      workflowId: props.workflowId,
      limit: 100,
    });
    if (result.success) {
      logs.value = result.data;
    }
  } catch (error) {
    console.error('加载日志失败:', error);
  }
};

// 事件处理
const handleWorkflowProgress = (data) => {
  if (data.workflowId !== props.workflowId) return;
  workflow.value = data;
  qualityGates.value = data.qualityGates || {};
};

const handleWorkflowStageChange = (data) => {
  if (data.workflowId !== props.workflowId) return;
  loadStages();
};

const handleWorkflowComplete = (data) => {
  if (data.workflowId !== props.workflowId) return;
  emit('complete', data);
};

const handleWorkflowError = (data) => {
  if (data.workflowId !== props.workflowId) return;
  emit('error', data);
};

// 生命周期
onMounted(() => {
  // 加载初始数据
  loadWorkflowStatus();
  loadStages();
  loadLogs();

  // 设置计时器
  elapsedTimer.value = setInterval(() => {
    if (workflow.value.overall?.status === 'running') {
      elapsedTime.value = Date.now() - (workflow.value.overall?.elapsedTime || 0);
    }
  }, 1000);

  // 监听事件
  if (window.ipc) {
    window.ipc.on('workflow:progress', handleWorkflowProgress);
    window.ipc.on('workflow:stage-complete', handleWorkflowStageChange);
    window.ipc.on('workflow:complete', handleWorkflowComplete);
    window.ipc.on('workflow:error', handleWorkflowError);
  }
});

onUnmounted(() => {
  if (elapsedTimer.value) {
    clearInterval(elapsedTimer.value);
  }

  if (window.ipc) {
    window.ipc.off('workflow:progress', handleWorkflowProgress);
    window.ipc.off('workflow:stage-complete', handleWorkflowStageChange);
    window.ipc.off('workflow:complete', handleWorkflowComplete);
    window.ipc.off('workflow:error', handleWorkflowError);
  }
});

// 暴露方法
defineExpose({
  refresh: () => {
    loadWorkflowStatus();
    loadStages();
    loadLogs();
  },
});
</script>

<style scoped lang="scss">
.workflow-progress {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  padding: 24px;
}

.workflow-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;

  .workflow-title {
    display: flex;
    align-items: center;
    gap: 12px;

    h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: #262626;
    }
  }

  .workflow-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    color: #8c8c8c;
    font-size: 12px;

    .elapsed-time {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 14px;
      color: #595959;
    }
  }
}

.stages-progress {
  margin-bottom: 24px;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;

  :deep(.ant-steps-item-icon) {
    .step-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-size: 14px;

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

      .step-number {
        font-weight: 600;
      }
    }
  }
}

.overall-progress {
  margin-bottom: 24px;

  .progress-label {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 14px;
    color: #595959;

    .progress-percent {
      font-weight: 600;
      color: #1890ff;
    }
  }
}

.current-stage-detail {
  margin-bottom: 24px;
}

.quality-gates-section,
.execution-logs {
  margin-bottom: 24px;

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;

    h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #262626;
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }
}

.gates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.logs-container {
  max-height: 400px;
  overflow-y: auto;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
}

.workflow-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
