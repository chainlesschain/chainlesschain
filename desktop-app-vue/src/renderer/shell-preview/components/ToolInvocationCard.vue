<template>
  <div
    class="cb-action"
    :class="`cb-action--${item.status}`"
    :data-testid="`tool-card-${item.id}`"
  >
    <span class="cb-action__icon">
      <CheckCircleFilled v-if="item.status === 'done'" />
      <LoadingOutlined v-else-if="item.status === 'running'" />
      <ClockCircleOutlined v-else />
    </span>
    <span class="cb-action__label">{{ item.label }}</span>
    <span v-if="item.detail" class="cb-action__detail">
      {{ item.detail }}
    </span>
  </div>
</template>

<script setup lang="ts">
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons-vue";
import type { PreviewActionItem } from "../../stores/conversation-preview";

defineProps<{ item: PreviewActionItem }>();
</script>

<style scoped>
.cb-action {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 16px;
  background: var(--cc-preview-bg-elevated-muted);
  border: 1px solid var(--cc-preview-border-subtle);
  color: var(--cc-preview-text-secondary);
}

.cb-action__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--cc-preview-status-done);
}

.cb-action--running .cb-action__icon {
  color: var(--cc-preview-status-running);
}

.cb-action--pending .cb-action__icon {
  color: var(--cc-preview-text-muted);
}

.cb-action__label {
  font-weight: 600;
  color: var(--cc-preview-text-primary);
}

.cb-action__detail {
  margin-left: auto;
  font-size: 12px;
}
</style>
