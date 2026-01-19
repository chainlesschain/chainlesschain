<template>
  <div class="input-container" data-testid="input-container">
    <div class="input-wrapper">
      <MessageInput
        :value="userInput"
        :disabled="isLoading"
        :placeholder="placeholder"
        @update:value="$emit('update:userInput', $event)"
        @submit="$emit('send')"
      />

      <InputActions
        :is-loading="isLoading"
        :disabled-send="!userInput.trim()"
        :disabled-clear="!hasMessages || isLoading"
        @send="$emit('send')"
        @clear="$emit('clear-conversation')"
      />
    </div>

    <ContextInfoBar :context-info="contextInfo" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import MessageInput from './MessageInput.vue';
import InputActions from './InputActions.vue';
import ContextInfoBar from './ContextInfoBar.vue';
import { getInputPlaceholder, getContextInfo } from '../../utils/chatHelpers';

const props = defineProps({
  userInput: {
    type: String,
    default: '',
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  hasMessages: {
    type: Boolean,
    default: false,
  },
  contextMode: {
    type: String,
    default: 'global',
  },
  currentFile: {
    type: Object,
    default: null,
  },
});

defineEmits(['update:userInput', 'send', 'clear-conversation']);

const placeholder = computed(() =>
  getInputPlaceholder(props.contextMode, props.currentFile)
);

const contextInfo = computed(() =>
  getContextInfo(props.contextMode, props.currentFile)
);
</script>

<style scoped>
/* 输入区域 */
.input-container {
  padding: 20px 24px;
  background: white;
  border-top: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.input-wrapper {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  width: 100%;
  max-width: 800px; /* 与消息区域同宽 */
}

.input-wrapper :deep(.ant-input) {
  flex: 1;
}
</style>
