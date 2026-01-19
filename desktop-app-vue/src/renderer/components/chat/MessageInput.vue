<template>
  <a-textarea
    :value="value"
    :placeholder="placeholder"
    :auto-size="{ minRows: 1, maxRows: 4 }"
    :disabled="disabled"
    data-test="chat-input"
    data-testid="chat-input"
    @update:value="$emit('update:value', $event)"
    @keydown="handleKeyDown"
  />
</template>

<script setup>
defineProps({
  value: {
    type: String,
    default: '',
  },
  placeholder: {
    type: String,
    default: '输入消息...',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:value', 'submit']);

const handleKeyDown = (event) => {
  // Ctrl+Enter 发送
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    emit('submit');
  }
};
</script>

<style scoped>
/* Textarea 样式由 ant-design-vue 处理 */
</style>
