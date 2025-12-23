<template>
  <div v-if="questions.length > 0" class="suggested-questions">
    <!-- 标题 -->
    <div class="suggestions-header">
      <BulbOutlined class="header-icon" />
      <span class="header-text">{{ title }}</span>
    </div>

    <!-- 问题列表 -->
    <div class="questions-list">
      <div
        v-for="(question, index) in displayedQuestions"
        :key="index"
        class="question-item"
        @click="handleQuestionClick(question)"
      >
        <QuestionCircleOutlined class="question-icon" />
        <span class="question-text">{{ question.text }}</span>
        <ArrowRightOutlined class="arrow-icon" />
      </div>
    </div>

    <!-- 展开/收起按钮 -->
    <div v-if="questions.length > defaultShowCount" class="toggle-button">
      <a-button
        type="link"
        size="small"
        @click="toggleExpand"
      >
        {{ isExpanded ? '收起' : `查看更多 (${questions.length - defaultShowCount})` }}
        <DownOutlined v-if="!isExpanded" />
        <UpOutlined v-else />
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  BulbOutlined,
  QuestionCircleOutlined,
  ArrowRightOutlined,
  DownOutlined,
  UpOutlined
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  title: {
    type: String,
    default: '你可能想问'
  },
  questions: {
    type: Array,
    default: () => []
  },
  defaultShowCount: {
    type: Number,
    default: 3
  }
});

// Emits
const emit = defineEmits(['question-click']);

// State
const isExpanded = ref(false);

// Computed
const displayedQuestions = computed(() => {
  if (isExpanded.value || props.questions.length <= props.defaultShowCount) {
    return props.questions;
  }
  return props.questions.slice(0, props.defaultShowCount);
});

// Methods
const handleQuestionClick = (question) => {
  emit('question-click', question);
};

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};
</script>

<style lang="scss" scoped>
.suggested-questions {
  margin: 20px 0;
  padding: 16px;
  background: #f5f9ff;
  border: 1px solid #d6e4ff;
  border-radius: 8px;

  .suggestions-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;

    .header-icon {
      color: #faad14;
      font-size: 16px;
    }

    .header-text {
      font-size: 14px;
      font-weight: 500;
      color: #333;
    }
  }

  .questions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .question-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: #ffffff;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        border-color: #1677FF;
        background: #e6f4ff;

        .arrow-icon {
          transform: translateX(4px);
          opacity: 1;
        }
      }

      .question-icon {
        flex-shrink: 0;
        color: #1677FF;
        font-size: 14px;
      }

      .question-text {
        flex: 1;
        font-size: 13px;
        color: #666;
        line-height: 1.5;
      }

      .arrow-icon {
        flex-shrink: 0;
        color: #1677FF;
        font-size: 12px;
        opacity: 0;
        transition: all 0.2s ease;
      }
    }
  }

  .toggle-button {
    margin-top: 8px;
    text-align: center;

    .ant-btn-link {
      font-size: 13px;
      color: #1677FF;

      &:hover {
        color: #4096ff;
      }

      .anticon {
        margin-left: 4px;
        font-size: 12px;
      }
    }
  }
}
</style>
