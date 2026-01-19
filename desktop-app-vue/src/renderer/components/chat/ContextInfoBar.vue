<template>
  <div v-if="contextInfo" class="context-info" data-testid="context-info">
    <InfoCircleOutlined />
    <span>{{ contextInfo }}</span>
  </div>
</template>

<script setup>
import { InfoCircleOutlined } from '@ant-design/icons-vue';

defineProps({
  contextInfo: {
    type: String,
    default: null,
  },
});
</script>

<style scoped>
.context-info {
  margin-top: 12px;
  padding: 10px 16px;
  background: #f3f4f6;
  border-radius: 8px;
  font-size: 13px;
  color: #6b7280;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 800px;
}
</style>
