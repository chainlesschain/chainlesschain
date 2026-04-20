<template>
  <transition name="cc-preview-artifact">
    <aside
      v-if="open"
      class="cc-preview-artifact"
      role="dialog"
      aria-label="Artifact 详情"
      aria-modal="false"
    >
      <header class="cc-preview-artifact__header">
        <span class="cc-preview-artifact__title">{{
          title || "Artifact"
        }}</span>
        <a-button type="text" size="small" @click="emit('close')">
          <template #icon>
            <CloseOutlined />
          </template>
        </a-button>
      </header>
      <div class="cc-preview-artifact__body">
        <slot>
          <div v-if="content" class="cc-preview-artifact__content">
            {{ content }}
          </div>
          <div v-else class="cc-preview-artifact__empty">
            当前会话暂无 artifact，从气泡中点击查看按钮可在此预览。
          </div>
        </slot>
      </div>
    </aside>
  </transition>
</template>

<script setup lang="ts">
import { CloseOutlined } from "@ant-design/icons-vue";

defineProps<{
  open: boolean;
  title?: string;
  content?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();
</script>

<style scoped>
.cc-preview-artifact {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 80vw;
  background: var(--cc-preview-bg-elevated);
  border-left: 1px solid var(--cc-preview-border-subtle);
  box-shadow: var(--cc-preview-shadow);
  display: flex;
  flex-direction: column;
  z-index: 20;
}

.cc-preview-artifact__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--cc-preview-border-subtle);
}

.cc-preview-artifact__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--cc-preview-text-primary);
}

.cc-preview-artifact__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  color: var(--cc-preview-text-primary);
}

.cc-preview-artifact__empty {
  padding: 32px 16px;
  font-size: 12px;
  color: var(--cc-preview-text-muted);
  text-align: center;
}

.cc-preview-artifact__content {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
}

.cc-preview-artifact-enter-from,
.cc-preview-artifact-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.cc-preview-artifact-enter-active,
.cc-preview-artifact-leave-active {
  transition:
    transform 0.22s ease,
    opacity 0.22s ease;
}
</style>
