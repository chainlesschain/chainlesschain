<template>
  <div class="system-message">
    <div class="system-icon">
      <InfoCircleOutlined v-if="messageType === 'info'" />
      <CheckCircleOutlined
        v-else-if="messageType === 'success'"
        style="color: #52c41a;"
      />
      <ExclamationCircleOutlined
        v-else-if="messageType === 'warning'"
        style="color: #faad14;"
      />
      <CloseCircleOutlined
        v-else-if="messageType === 'error'"
        style="color: #ff4d4f;"
      />
      <LoadingOutlined
        v-else-if="messageType === 'loading'"
        spin
      />
      <InfoCircleOutlined v-else />
    </div>
    <div class="system-content">
      <div class="system-text">
        {{ message.content }}
      </div>
      <div
        v-if="message.metadata?.detail"
        class="system-detail"
      >
        {{ message.metadata.detail }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  InfoCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
});

const messageType = computed(() => {
  return props.message.metadata?.type || 'info';
});
</script>

<style scoped>
.system-message {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  margin: 8px 0;
  background: #f5f5f5;
  border-radius: 8px;
  align-items: flex-start;
}

.system-icon {
  flex-shrink: 0;
  font-size: 16px;
  color: #1890ff;
  margin-top: 2px;
}

.system-content {
  flex: 1;
}

.system-text {
  color: #595959;
  font-size: 14px;
  line-height: 1.6;
}

.system-detail {
  color: #8c8c8c;
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.5;
}
</style>
