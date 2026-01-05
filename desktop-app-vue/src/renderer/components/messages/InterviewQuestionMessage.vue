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

        <a-textarea
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
            :disabled="currentQuestion.required && !currentAnswer.trim()"
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
            <div class="answer-text">{{ item.answer || '已跳过' }}</div>
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
import { ref, computed } from 'vue';
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

const currentAnswer = ref('');

const questions = computed(() => props.message.metadata?.questions || []);
const currentIndex = computed(() => props.message.metadata?.currentIndex || 0);
const answers = computed(() => props.message.metadata?.answers || {});

const currentQuestion = computed(() => {
  return questions.value[currentIndex.value] || null;
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
  return currentIndex.value >= questions.value.length;
});

const handleSubmitAnswer = () => {
  if (!currentQuestion.value) return;

  if (currentQuestion.value.required && !currentAnswer.value.trim()) {
    return;
  }

  emit('answer', {
    questionKey: currentQuestion.value.key,
    answer: currentAnswer.value.trim(),
    index: currentIndex.value,
  });

  currentAnswer.value = '';

  // 如果是最后一个问题，触发完成事件
  if (currentIndex.value >= questions.value.length - 1) {
    emit('complete');
  }
};

const handleSkip = () => {
  if (!currentQuestion.value) return;

  emit('skip', {
    questionKey: currentQuestion.value.key,
    index: currentIndex.value,
  });

  currentAnswer.value = '';

  // 如果是最后一个问题，触发完成事件
  if (currentIndex.value >= questions.value.length - 1) {
    emit('complete');
  }
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
