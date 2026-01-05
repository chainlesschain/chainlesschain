<template>
  <div class="interview-message">
    <div class="interview-header">
      <QuestionCircleOutlined class="interview-icon" />
      <span class="interview-title">{{ message.content }}</span>
    </div>

    <div class="interview-content">
      <!-- 进度指示 -->
      <div v-if="questions.length > 0" class="interview-progress">
        <span>问题 {{ currentIndex + 1 }} / {{ questions.length }}</span>
      </div>

      <!-- 当前问题 -->
      <div v-if="currentQuestion && !isCompleted" class="current-question">
        <div class="question-text">
          <span class="question-number">Q{{ currentIndex + 1 }}</span>
          <span v-if="currentQuestion.required" class="required-mark">*</span>
          {{ currentQuestion.question }}
        </div>

        <!-- 选项按钮组（新增） -->
        <div v-if="currentQuestion.options && currentQuestion.options.length > 0"
             class="option-buttons">
          <a-space direction="vertical" :size="8" style="width: 100%">
            <a-button
              v-for="option in currentQuestion.options"
              :key="option.value"
              :type="selectedOption === option.value ? 'primary' : 'default'"
              :class="['option-button', { 'selected': selectedOption === option.value }]"
              block
              size="large"
              @click="handleSelectOption(option.value)"
            >
              <div class="option-content">
                <span class="option-label">{{ option.label }}</span>
                <span v-if="option.description" class="option-description">
                  {{ option.description }}
                </span>
              </div>
            </a-button>
          </a-space>
        </div>

        <!-- 补充输入框（选择选项后显示） -->
        <div v-if="selectedOption !== null" class="additional-input-section">
          <div class="input-label">补充说明（可选）</div>
          <a-textarea
            v-model:value="additionalInput"
            placeholder="您可以进一步说明..."
            :auto-size="{ minRows: 2, maxRows: 4 }"
            class="additional-input"
            @keydown.ctrl.enter="handleSubmitAnswer"
          />
        </div>

        <!-- 传统文本框（无选项时的降级方案） -->
        <a-textarea
          v-if="!currentQuestion.options || currentQuestion.options.length === 0"
          v-model:value="currentAnswer"
          :placeholder="currentQuestion.required ? '请输入答案（必填）' : '请输入答案（选填）'"
          :auto-size="{ minRows: 2, maxRows: 4 }"
          class="answer-input"
          @keydown.ctrl.enter="handleSubmitAnswer"
        />

        <div class="question-actions">
          <a-button
            v-if="!currentQuestion.required"
            @click="handleSkip"
            size="small"
          >
            跳过
          </a-button>
          <a-button
            type="primary"
            @click="handleSubmitAnswer"
            :disabled="isSubmitDisabled"
            size="small"
          >
            {{ currentIndex < questions.length - 1 ? '下一个' : '完成' }}
          </a-button>
        </div>
      </div>

      <!-- 已回答的问题 -->
      <div v-if="answeredQuestions.length > 0" class="answered-questions">
        <a-collapse>
          <a-collapse-panel
            v-for="(item, index) in answeredQuestions"
            :key="index"
            :header="`✓ ${item.question.question}`"
          >
            <div class="answer-text">
              <!-- 结构化答案显示 -->
              <template v-if="typeof item.answer === 'object' && item.answer !== null && item.answer.selectedOption !== undefined">
                <a-tag color="blue">{{ item.answer.selectedOption }}</a-tag>
                <span v-if="item.answer.additionalInput">
                  {{ item.answer.additionalInput }}
                </span>
              </template>
              <!-- 传统答案显示 -->
              <template v-else>
                {{ item.answer || '已跳过' }}
              </template>
            </div>
          </a-collapse-panel>
        </a-collapse>
      </div>

      <!-- 完成提示 -->
      <div v-if="isCompleted" class="interview-completed">
        <CheckCircleOutlined class="completed-icon" />
        <span>所有问题已完成，正在生成任务计划...</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import {
  QuestionCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['answer', 'skip', 'complete']);

// 响应式状态
const currentAnswer = ref('');              // 传统文本框答案
const selectedOption = ref(null);           // 当前选中的选项值
const additionalInput = ref('');            // 补充说明文本

const questions = computed(() => props.message.metadata?.questions || []);
const currentIndex = computed(() => props.message.metadata?.currentIndex || 0);
const answers = computed(() => props.message.metadata?.answers || {});

// 添加调试日志
onMounted(() => {
  console.log('[InterviewQuestionMessage] 组件已挂载');
  console.log('[InterviewQuestionMessage] message:', props.message);
  console.log('[InterviewQuestionMessage] questions:', questions.value);
  console.log('[InterviewQuestionMessage] currentIndex:', currentIndex.value);
});

watch(questions, (newVal) => {
  console.log('[InterviewQuestionMessage] questions 变化:', newVal);
}, { immediate: true });

const currentQuestion = computed(() => {
  const question = questions.value[currentIndex.value] || null;
  console.log('[InterviewQuestionMessage] currentQuestion computed:', question);
  return question;
});

const answeredQuestions = computed(() => {
  if (!questions.value.length) return [];

  return questions.value
    .slice(0, currentIndex.value)
    .map((q, index) => ({
      question: q,
      answer: answers.value[q.key],
    }));
});

const isCompleted = computed(() => {
  const completed = currentIndex.value >= questions.value.length;
  console.log('[InterviewQuestionMessage] isCompleted:', completed, 'currentIndex:', currentIndex.value, 'questions.length:', questions.value.length);
  return completed;
});

// 提交按钮禁用逻辑
const isSubmitDisabled = computed(() => {
  if (!currentQuestion.value) return true;
  if (!currentQuestion.value.required) return false;

  // 如果有选项：必须选择一个选项
  if (currentQuestion.value.options && currentQuestion.value.options.length > 0) {
    return selectedOption.value === null;
  }

  // 如果无选项：必须提供传统答案
  return !currentAnswer.value.trim();
});

// 选项点击处理
const handleSelectOption = (optionValue) => {
  selectedOption.value = optionValue;
  // 自动聚焦到补充输入框
  nextTick(() => {
    const inputEl = document.querySelector('.additional-input textarea');
    if (inputEl) inputEl.focus();
  });
};

const handleSubmitAnswer = () => {
  if (!currentQuestion.value) return;

  let answerData;

  if (currentQuestion.value.options && currentQuestion.value.options.length > 0) {
    // 新格式：结构化答案
    answerData = {
      selectedOption: selectedOption.value,
      additionalInput: additionalInput.value.trim()
    };
    console.log('[InterviewQuestionMessage] 提交结构化答案:', answerData);
  } else {
    // 旧格式：纯字符串答案（降级方案）
    answerData = currentAnswer.value.trim();
    console.log('[InterviewQuestionMessage] 提交传统答案:', answerData);
  }

  emit('answer', {
    questionKey: currentQuestion.value.key,
    answer: answerData,
    index: currentIndex.value,
  });

  // 重置所有状态
  currentAnswer.value = '';
  selectedOption.value = null;
  additionalInput.value = '';
  // 不在这里触发 complete，让 ChatPanel 统一检查
};

const handleSkip = () => {
  if (!currentQuestion.value) return;

  emit('skip', {
    questionKey: currentQuestion.value.key,
    index: currentIndex.value,
  });

  // 重置所有状态
  currentAnswer.value = '';
  selectedOption.value = null;
  additionalInput.value = '';
  // 不在这里触发 complete，让 ChatPanel 统一检查
};
</script>

<style scoped>
.interview-message {
  margin: 12px 0;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  background: white;
  overflow: hidden;
}

.interview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
}

.interview-icon {
  font-size: 18px;
  color: #1890ff;
}

.interview-title {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
}

.interview-content {
  padding: 16px;
}

.interview-progress {
  text-align: center;
  padding: 8px 0;
  font-size: 13px;
  color: #8c8c8c;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 16px;
}

.current-question {
  background: #fafafa;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.question-text {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 12px;
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

/* 选项按钮组样式（Claude 风格） */
.option-buttons {
  margin: 16px 0;
}

.option-button {
  height: auto !important;
  padding: 12px 16px !important;
  text-align: left !important;
  border-radius: 8px;
  transition: all 0.3s ease;
  border: 2px solid #d9d9d9 !important;
}

.option-button:hover {
  border-color: #1890ff !important;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(24, 144, 255, 0.15) !important;
}

.option-button.selected {
  border-color: #1890ff !important;
  background: #e6f7ff !important;
}

.option-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
}

.option-label {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
}

.option-description {
  font-size: 13px;
  color: #8c8c8c;
  line-height: 1.4;
}

/* 补充输入框样式 */
.additional-input-section {
  margin-top: 16px;
  padding: 12px;
  background: #fafafa;
  border-radius: 8px;
  border: 1px dashed #d9d9d9;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.input-label {
  font-size: 13px;
  color: #595959;
  margin-bottom: 8px;
  font-weight: 500;
}

.additional-input {
  background: white !important;
}

.answered-questions {
  margin-top: 16px;
}

.answer-text {
  color: #595959;
  font-size: 14px;
  line-height: 1.6;
  padding: 8px 0;
}

.interview-completed {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  border-radius: 6px;
  color: #52c41a;
  font-size: 14px;
}

.completed-icon {
  font-size: 18px;
}
</style>
