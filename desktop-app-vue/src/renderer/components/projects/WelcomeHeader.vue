<template>
  <div class="welcome-header">
    <h1 class="welcome-title">
      {{ title }}
    </h1>

    <!-- 建议问题 -->
    <div
      v-if="suggestion"
      class="welcome-suggestion"
      @click="handleSuggestionClick"
    >
      <BulbOutlined class="suggestion-icon" />
      <span class="suggestion-text">{{ suggestion }}</span>
      <ArrowRightOutlined class="suggestion-arrow" />
    </div>

    <!-- 自定义内容插槽 -->
    <slot />
  </div>
</template>

<script setup>
import { BulbOutlined, ArrowRightOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  title: {
    type: String,
    default: '又见面啦！有新的工作安排吗？',
  },
  suggestion: {
    type: String,
    default: 'Logo 设计怎么选取权威网站？',
  },
});

const emit = defineEmits(['suggestion-click']);

const handleSuggestionClick = () => {
  emit('suggestion-click', props.suggestion);
};
</script>

<style scoped lang="scss">
.welcome-header {
  text-align: center;
  padding: 60px 20px 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 16px;
  margin-bottom: 32px;
}

.welcome-title {
  font-size: 32px;
  font-weight: 600;
  margin: 0 0 24px 0;
  color: white;
  line-height: 1.4;
}

.welcome-suggestion {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 24px;
  cursor: pointer;
  transition: all 0.3s;
  backdrop-filter: blur(10px);

  &:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .suggestion-icon {
    font-size: 20px;
    color: #FFD700;
  }

  .suggestion-text {
    font-size: 15px;
    color: white;
    font-weight: 500;
  }

  .suggestion-arrow {
    font-size: 16px;
    color: rgba(255, 255, 255, 0.8);
  }
}
</style>
