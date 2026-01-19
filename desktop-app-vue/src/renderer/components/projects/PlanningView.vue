<template>
  <div class="planning-view">
    <!-- 需求分析阶段 -->
    <div
      v-if="state === PlanningState.ANALYZING"
      class="planning-stage analyzing"
    >
      <div class="stage-header">
        <LoadingOutlined spin />
        <h3>正在分析您的需求...</h3>
      </div>
      <p class="stage-desc">
        AI正在理解您的需求并检查是否需要补充信息
      </p>
    </div>

    <!-- 采访阶段 -->
    <div
      v-else-if="state === PlanningState.INTERVIEWING"
      class="planning-stage interviewing"
    >
      <div class="stage-header">
        <QuestionCircleOutlined />
        <h3>需要了解更多信息</h3>
      </div>
      <p class="stage-desc">
        为了更好地完成任务，请回答以下问题
        ({{ currentQuestionIndex + 1 }}/{{ totalQuestions }})
      </p>

      <!-- 当前问题 -->
      <div
        v-if="currentQuestion"
        class="current-question"
      >
        <div class="question-text">
          <span class="question-number">问题 {{ currentQuestionIndex + 1 }}</span>
          <span
            v-if="currentQuestion.required"
            class="required-mark"
          >*</span>
          {{ currentQuestion.question }}
        </div>

        <a-textarea
          v-model:value="currentAnswer"
          :placeholder="currentQuestion.required ? '请输入答案（必填）' : '请输入答案（选填，可跳过）'"
          :auto-size="{ minRows: 2, maxRows: 6 }"
          class="answer-input"
          @keydown.ctrl.enter="handleSubmitAnswer"
        />

        <div class="question-actions">
          <a-button
            v-if="!currentQuestion.required"
            size="small"
            @click="handleSkipQuestion"
          >
            跳过
          </a-button>
          <a-button
            type="primary"
            :disabled="currentQuestion.required && !currentAnswer.trim()"
            size="small"
            @click="handleSubmitAnswer"
          >
            {{ currentQuestionIndex < totalQuestions - 1 ? '下一个' : '完成' }}
          </a-button>
        </div>
      </div>

      <!-- 已回答的问题 -->
      <div
        v-if="answeredQuestions.length > 0"
        class="answered-questions"
      >
        <a-collapse>
          <a-collapse-panel
            v-for="(item, index) in answeredQuestions"
            :key="index"
            :header="`✓ ${item.question.question}`"
          >
            <div class="answer-text">
              {{ item.answer || '已跳过' }}
            </div>
          </a-collapse-panel>
        </a-collapse>
      </div>
    </div>

    <!-- 计划生成阶段 -->
    <div
      v-else-if="state === PlanningState.PLANNING"
      class="planning-stage planning"
    >
      <div class="stage-header">
        <LoadingOutlined spin />
        <h3>正在生成任务计划...</h3>
      </div>
      <p class="stage-desc">
        AI正在根据您提供的信息制定详细的执行计划
      </p>
    </div>

    <!-- 计划确认阶段 -->
    <div
      v-else-if="state === PlanningState.CONFIRMING"
      class="planning-stage confirming"
    >
      <div class="stage-header">
        <FileTextOutlined />
        <h3>任务计划已生成</h3>
      </div>

      <div
        v-if="plan"
        class="plan-content"
      >
        <!-- 计划标题和摘要 -->
        <div class="plan-header">
          <h2>{{ plan.title }}</h2>
          <p class="plan-summary">
            {{ plan.summary }}
          </p>
        </div>

        <!-- 任务步骤 -->
        <div class="plan-tasks">
          <h3>📋 任务步骤</h3>
          <div
            v-for="(task, index) in plan.tasks"
            :key="task.id || index"
            class="task-item"
          >
            <div class="task-number">
              {{ index + 1 }}
            </div>
            <div class="task-details">
              <h4>{{ task.name }}</h4>
              <p class="task-description">
                {{ task.description }}
              </p>
              <div class="task-meta">
                <span class="meta-label">操作:</span>
                <span class="meta-value">{{ task.action }}</span>
              </div>
              <div class="task-meta">
                <span class="meta-label">输出:</span>
                <span class="meta-value">{{ task.output }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 预期输出 -->
        <div
          v-if="plan.outputs && plan.outputs.length > 0"
          class="plan-outputs"
        >
          <h3>🎯 预期输出</h3>
          <ul>
            <li
              v-for="(output, index) in plan.outputs"
              :key="index"
            >
              {{ output }}
            </li>
          </ul>
        </div>

        <!-- 注意事项 -->
        <div
          v-if="plan.notes && plan.notes.length > 0"
          class="plan-notes"
        >
          <h3>⚠️ 注意事项</h3>
          <ul>
            <li
              v-for="(note, index) in plan.notes"
              :key="index"
            >
              {{ note }}
            </li>
          </ul>
        </div>

        <!-- 确认按钮 -->
        <div class="plan-actions">
          <a-button
            size="large"
            @click="handleCancelPlan"
          >
            <CloseOutlined />
            取消
          </a-button>
          <a-button
            size="large"
            @click="handleModifyPlan"
          >
            <EditOutlined />
            修改计划
          </a-button>
          <a-button
            type="primary"
            size="large"
            @click="handleConfirmPlan"
          >
            <CheckOutlined />
            确认执行
          </a-button>
        </div>
      </div>
    </div>

    <!-- 执行阶段 -->
    <div
      v-else-if="state === PlanningState.EXECUTING"
      class="planning-stage executing"
    >
      <div class="stage-header">
        <LoadingOutlined spin />
        <h3>正在执行任务...</h3>
      </div>
      <p class="stage-desc">
        AI正在按照计划执行任务，请稍候
      </p>

      <div
        v-if="executingTask"
        class="current-task"
      >
        <a-progress
          :percent="executionProgress"
          :status="executionProgress === 100 ? 'success' : 'active'"
        />
        <p class="task-status">
          {{ executingTask }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, watch } from 'vue';
import {
  LoadingOutlined,
  QuestionCircleOutlined,
  FileTextOutlined,
  CheckOutlined,
  EditOutlined,
  CloseOutlined,
} from '@ant-design/icons-vue';
import { PlanningState } from '../../utils/taskPlanner';

const props = defineProps({
  state: {
    type: String,
    required: true,
  },
  session: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits([
  'answer-submitted',
  'question-skipped',
  'plan-confirmed',
  'plan-cancelled',
  'plan-modify',
]);

// 当前问题和答案
const currentAnswer = ref('');

// 计算属性
const currentQuestion = computed(() => {
  if (!props.session?.interview) {return null;}
  const index = props.session.interview.currentIndex;
  return props.session.interview.questions[index] || null;
});

const currentQuestionIndex = computed(() => {
  return props.session?.interview?.currentIndex || 0;
});

const totalQuestions = computed(() => {
  return props.session?.interview?.questions?.length || 0;
});

const answeredQuestions = computed(() => {
  if (!props.session?.interview) {return [];}
  return props.session.interview.questions
    .slice(0, currentQuestionIndex.value)
    .map((q, index) => ({
      question: q,
      answer: props.session.interview.answers[q.key],
    }));
});

const plan = computed(() => props.session?.plan);

const executingTask = ref('');
const executionProgress = ref(0);

// 方法
const handleSubmitAnswer = () => {
  if (!currentAnswer.value.trim() && currentQuestion.value?.required) {
    return;
  }

  emit('answer-submitted', {
    questionIndex: currentQuestionIndex.value,
    answer: currentAnswer.value.trim(),
  });

  currentAnswer.value = '';
};

const handleSkipQuestion = () => {
  emit('question-skipped', currentQuestionIndex.value);
  currentAnswer.value = '';
};

const handleConfirmPlan = () => {
  emit('plan-confirmed');
};

const handleCancelPlan = () => {
  emit('plan-cancelled');
};

const handleModifyPlan = () => {
  emit('plan-modify');
};

// 组件挂载时输出日志
onMounted(() => {
  logger.info('[PlanningView] 组件已挂载');
  logger.info('[PlanningView] state:', props.state);
  logger.info('[PlanningView] session:', props.session);
});

// 监听状态变化
watch(() => props.state, (newState, oldState) => {
  logger.info('[PlanningView] 状态变化:', oldState, '→', newState);
});

watch(() => props.session, (newSession) => {
  logger.info('[PlanningView] session变化:', newSession);
}, { deep: true });

// 暴露方法供父组件调用
defineExpose({
  setExecutionProgress: (task, progress) => {
    executingTask.value = task;
    executionProgress.value = progress;
  },
});
</script>

<style scoped>
.planning-view {
  padding: 24px;
  background: #f5f5f5;
  border-radius: 8px;
  min-height: 400px;
}

.planning-stage {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.stage-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.stage-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #262626;
}

.stage-header .anticon {
  font-size: 24px;
  color: #1890ff;
}

.stage-desc {
  color: #8c8c8c;
  margin-bottom: 20px;
}

/* 采访阶段样式 */
.current-question {
  background: #fafafa;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.question-text {
  font-size: 16px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 16px;
  line-height: 1.6;
}

.question-number {
  display: inline-block;
  background: #1890ff;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-right: 8px;
}

.required-mark {
  color: #ff4d4f;
  margin-left: 4px;
  font-weight: bold;
}

.answer-input {
  margin-bottom: 12px;
}

.question-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.answered-questions {
  margin-top: 24px;
}

.answer-text {
  color: #595959;
  padding: 8px 0;
}

/* 计划展示样式 */
.plan-content {
  max-height: 600px;
  overflow-y: auto;
}

.plan-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #e8e8e8;
}

.plan-header h2 {
  margin: 0 0 12px 0;
  font-size: 24px;
  font-weight: 600;
  color: #262626;
}

.plan-summary {
  color: #595959;
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

.plan-tasks,
.plan-outputs,
.plan-notes {
  margin-bottom: 24px;
}

.plan-tasks h3,
.plan-outputs h3,
.plan-notes h3 {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 16px;
}

.task-item {
  display: flex;
  gap: 16px;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
  margin-bottom: 12px;
}

.task-number {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  background: #1890ff;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}

.task-details {
  flex: 1;
}

.task-details h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #262626;
}

.task-description {
  color: #595959;
  margin-bottom: 8px;
  line-height: 1.6;
}

.task-meta {
  font-size: 14px;
  margin-top: 8px;
  padding: 4px 0;
}

.meta-label {
  font-weight: 600;
  color: #8c8c8c;
  margin-right: 8px;
}

.meta-value {
  color: #595959;
}

.plan-outputs ul,
.plan-notes ul {
  margin: 0;
  padding-left: 20px;
  list-style-type: disc;
}

.plan-outputs li,
.plan-notes li {
  color: #595959;
  margin-bottom: 8px;
  line-height: 1.6;
}

.plan-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #e8e8e8;
}

/* 执行阶段样式 */
.current-task {
  margin-top: 24px;
}

.task-status {
  margin-top: 12px;
  text-align: center;
  color: #595959;
  font-size: 14px;
}
</style>
