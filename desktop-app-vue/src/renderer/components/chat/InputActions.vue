<template>
  <div class="input-actions">
    <a-tooltip title="清空对话">
      <a-button
        type="text"
        size="small"
        :disabled="disabledClear"
        data-testid="clear-conversation-button"
        @click="$emit('clear')"
      >
        <DeleteOutlined />
      </a-button>
    </a-tooltip>

    <a-button
      type="primary"
      size="small"
      :loading="isLoading"
      :disabled="disabledSend"
      data-test="chat-send-button"
      data-testid="chat-send-button"
      @click="$emit('send')"
    >
      <SendOutlined v-if="!isLoading" />
      发送
    </a-button>
  </div>
</template>

<script setup>
import { SendOutlined, DeleteOutlined } from '@ant-design/icons-vue';

defineProps({
  isLoading: {
    type: Boolean,
    default: false,
  },
  disabledSend: {
    type: Boolean,
    default: false,
  },
  disabledClear: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['send', 'clear']);
</script>

<style scoped>
.input-actions {
  display: flex;
  gap: 4px;
}
</style>
