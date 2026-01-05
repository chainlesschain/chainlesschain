<template>
  <a-modal
    v-model:open="visible"
    :title="dialogTitle"
    width="90%"
    :max-width="1200"
    :footer="null"
    :closable="!planningStore.isExecuting"
    :maskClosable="false"
    :keyboard="!planningStore.isExecuting"
    @cancel="handleCancel"
  >
    <div class="interactive-planning-dialog">
      <!-- 规划生成中 -->
      <div v-if="planningStore.isPlanning" class="planning-loading">
        <a-spin size="large" />
        <p class="loading-text">AI正在分析您的需求，制定执行计划...</p>
      </div>

      <!-- 等待用户确认 -->
      <div v-else-if="planningStore.isAwaitingConfirmation" class="plan-review">
        <!-- Plan预览 -->
        <PlanPreview
          :plan="planningStore.taskPlan"
          :recommended-templates="planningStore.recommendedTemplates"
          :recommended-skills="planningStore.recommendedSkills"
          :recommended-tools="planningStore.recommendedTools"
          @adjust="handleAdjust"
          @use-template="handleUseTemplate"
        />

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <a-space :size="12">
            <a-button @click="handleCancel">
              取消
            </a-button>
            <a-button @click="handleRegenerate">
              重新生成
            </a-button>
            <a-button
              type="primary"
              :loading="planningStore.loading"
              @click="handleConfirm"
            >
              确认执行
            </a-button>
          </a-space>
        </div>
      </div>

      <!-- 执行中 -->
      <div v-else-if="planningStore.isExecuting" class="plan-execution">
        <ExecutionProgress
          :progress="planningStore.executionProgress"
          :percentage="planningStore.progressPercentage"
        />
      </div>

      <!-- 执行完成 -->
      <div v-else-if="planningStore.isCompleted" class="plan-completed">
        <ExecutionResult
          :result="planningStore.executionResult"
          :quality-score="planningStore.qualityScore"
          @submit-feedback="handleSubmitFeedback"
          @view-project="handleViewProject"
          @close="handleClose"
        />
      </div>

      <!-- 执行失败 -->
      <div v-else-if="planningStore.isFailed" class="plan-failed">
        <a-result
          status="error"
          title="执行失败"
          :sub-title="planningStore.executionProgress.status"
        >
          <template #extra>
            <a-space>
              <a-button @click="handleClose">
                关闭
              </a-button>
              <a-button type="primary" @click="handleRetry">
                重试
              </a-button>
            </a-space>
          </template>
        </a-result>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { computed, watch } from 'vue';
import { usePlanningStore } from '../../stores/planning';
import PlanPreview from './PlanPreview.vue';
import ExecutionProgress from './ExecutionProgress.vue';
import ExecutionResult from './ExecutionResult.vue';

const planningStore = usePlanningStore();

// 对话框可见性
const visible = computed({
  get: () => planningStore.dialogVisible,
  set: (val) => {
    if (!val) {
      planningStore.closePlanDialog();
    }
  }
});

// 对话框标题
const dialogTitle = computed(() => {
  if (planningStore.isPlanning) {
    return 'AI正在制定计划...';
  } else if (planningStore.isAwaitingConfirmation) {
    return '任务执行计划 - 请确认';
  } else if (planningStore.isExecuting) {
    return '正在执行任务...';
  } else if (planningStore.isCompleted) {
    return '任务执行完成';
  } else if (planningStore.isFailed) {
    return '任务执行失败';
  }
  return '交互式任务规划';
});

// 处理调整计划
const handleAdjust = (adjustments) => {
  planningStore.respondToPlan('adjust', { adjustments });
};

// 处理应用模板
const handleUseTemplate = (templateId) => {
  planningStore.respondToPlan('use_template', { templateId });
};

// 处理重新生成
const handleRegenerate = () => {
  planningStore.respondToPlan('regenerate');
};

// 处理确认执行
const handleConfirm = () => {
  planningStore.respondToPlan('confirm');
};

// 处理取消
const handleCancel = () => {
  if (planningStore.isExecuting) {
    // 执行中不允许取消
    return;
  }
  planningStore.respondToPlan('cancel');
};

// 处理关闭
const handleClose = () => {
  planningStore.closePlanDialog();
  planningStore.reset();
};

// 处理重试
const handleRetry = () => {
  const { userRequest, projectContext } = planningStore.currentSession;
  planningStore.startPlanSession(userRequest, projectContext);
};

// 处理提交反馈
const handleSubmitFeedback = (feedback) => {
  planningStore.submitFeedback(feedback);
};

// 处理查看项目
const handleViewProject = (projectId) => {
  // 跳转到项目详情页
  window.location.hash = `#/projects/${projectId}`;
  handleClose();
};
</script>

<style scoped>
.interactive-planning-dialog {
  min-height: 400px;
  display: flex;
  flex-direction: column;
}

/* 规划生成中 */
.planning-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  gap: 24px;
}

.loading-text {
  font-size: 16px;
  color: #666;
  margin: 0;
}

/* Plan审查 */
.plan-review {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 操作按钮 */
.action-buttons {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

/* 执行中 */
.plan-execution {
  min-height: 400px;
}

/* 执行完成 */
.plan-completed {
  min-height: 400px;
}

/* 执行失败 */
.plan-failed {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
