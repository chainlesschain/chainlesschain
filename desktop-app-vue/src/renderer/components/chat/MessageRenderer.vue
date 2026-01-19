<template>
  <!-- 系统消息 -->
  <SystemMessage
    v-if="isSystemMessage"
    :message="message"
  />

  <!-- 意图确认消息 -->
  <IntentConfirmationMessage
    v-else-if="message.type === MessageType.INTENT_CONFIRMATION"
    :message="message"
    @confirm="$emit('intent-confirm', $event)"
    @correct="$emit('intent-correct', $event)"
  />

  <!-- 采访问题消息 -->
  <InterviewQuestionMessage
    v-else-if="message.type === MessageType.INTERVIEW"
    :key="`interview-${message.id}-${message.metadata?.currentIndex || 0}`"
    :message="message"
    @answer="$emit('interview-answer', $event)"
    @skip="$emit('interview-skip', $event)"
    @complete="$emit('interview-complete')"
  />

  <!-- 任务计划消息 -->
  <TaskPlanMessage
    v-else-if="message.type === MessageType.TASK_PLAN"
    :message="message"
    @confirm="$emit('plan-confirm', $event)"
    @modify="$emit('plan-modify', $event)"
    @cancel="$emit('plan-cancel', $event)"
  />

  <!-- 普通用户/助手消息 -->
  <UserAssistantMessage
    v-else
    :message="message"
    @open-source="$emit('open-source', $event)"
  />
</template>

<script setup>
import { computed } from 'vue';
import { MessageType } from '../../utils/messageTypes';
import SystemMessage from '../messages/SystemMessage.vue';
import IntentConfirmationMessage from '../messages/IntentConfirmationMessage.vue';
import InterviewQuestionMessage from '../messages/InterviewQuestionMessage.vue';
import TaskPlanMessage from '../messages/TaskPlanMessage.vue';
import UserAssistantMessage from './UserAssistantMessage.vue';

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
  index: {
    type: Number,
    default: 0,
  },
});

defineEmits([
  'intent-confirm',
  'intent-correct',
  'interview-answer',
  'interview-skip',
  'interview-complete',
  'plan-confirm',
  'plan-modify',
  'plan-cancel',
  'open-source',
]);

const isSystemMessage = computed(() => {
  return [
    MessageType.SYSTEM,
    MessageType.TASK_ANALYSIS,
    MessageType.INTENT_RECOGNITION,
  ].includes(props.message.type);
});
</script>

<style scoped>
/* MessageRenderer 不需要额外样式，由子组件处理 */
</style>
