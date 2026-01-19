<template>
  <div ref="messagesContainer" class="messages-container" data-testid="messages-container">
    <!-- 空状态 -->
    <EmptyState
      v-if="messages.length === 0 && !isLoading"
      :context-mode="contextMode"
      :current-file="currentFile"
    />

    <!-- 虚拟滚动消息列表 -->
    <VirtualMessageList
      v-else
      ref="virtualListRef"
      :key="`messages-${messagesRefreshKey}`"
      :messages="messages"
      :estimate-size="150"
      data-test="chat-messages-list"
      data-testid="messages-list"
      @load-more="$emit('load-more')"
      @scroll-to-bottom="$emit('scroll-to-bottom')"
    >
      <template #default="{ message, index }">
        <MessageRenderer
          :message="message"
          :index="index"
          @intent-confirm="$emit('intent-confirm', $event)"
          @intent-correct="$emit('intent-correct', $event)"
          @interview-answer="$emit('interview-answer', $event)"
          @interview-skip="$emit('interview-skip', $event)"
          @interview-complete="$emit('interview-complete')"
          @plan-confirm="$emit('plan-confirm', $event)"
          @plan-modify="$emit('plan-modify', $event)"
          @plan-cancel="$emit('plan-cancel', $event)"
          @open-source="$emit('open-source', $event)"
        />
      </template>
    </VirtualMessageList>

    <!-- 思考过程可视化 -->
    <ThinkingProcess
      v-if="isLoading && thinkingState.show"
      :current-stage="thinkingState.stage"
      :progress="thinkingState.progress"
      :show-progress="thinkingState.showProgress"
      :progress-text="thinkingState.progressText"
      :steps="thinkingState.steps"
      :streaming-content="thinkingState.streamingContent"
      :show-cancel-button="thinkingState.showCancelButton"
      @cancel="$emit('cancel-thinking')"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import EmptyState from './EmptyState.vue';
import MessageRenderer from './MessageRenderer.vue';
import VirtualMessageList from '../projects/VirtualMessageList.vue';
import ThinkingProcess from '../projects/ThinkingProcess.vue';

defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  thinkingState: {
    type: Object,
    default: () => ({
      show: false,
      stage: '',
      progress: 0,
      showProgress: false,
      progressText: '',
      steps: [],
      streamingContent: '',
      showCancelButton: false,
    }),
  },
  contextMode: {
    type: String,
    default: 'global',
  },
  currentFile: {
    type: Object,
    default: null,
  },
  messagesRefreshKey: {
    type: Number,
    default: 0,
  },
});

defineEmits([
  'scroll-to-bottom',
  'load-more',
  'intent-confirm',
  'intent-correct',
  'interview-answer',
  'interview-skip',
  'interview-complete',
  'plan-confirm',
  'plan-modify',
  'plan-cancel',
  'open-source',
  'cancel-thinking',
]);

const messagesContainer = ref(null);
const virtualListRef = ref(null);

// 暴露给父组件的方法
defineExpose({
  messagesContainer,
  virtualListRef,
});
</script>

<style scoped>
/* 消息容器 */
.messages-container {
  flex: 1;
  overflow-y: auto;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
}

/* 滚动条 */
.messages-container::-webkit-scrollbar {
  width: 6px;
}

.messages-container::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.messages-container::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
