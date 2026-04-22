<template>
  <transition name="cb-artifact">
    <aside
      v-if="open"
      class="cb-artifact"
      role="dialog"
      aria-label="Artifact 详情"
      aria-modal="false"
    >
      <header class="cb-artifact__header">
        <div>
          <div class="cb-artifact__eyebrow">Quick Panel</div>
          <div class="cb-artifact__title">
            {{ title || "Artifact" }}
          </div>
        </div>
        <a-button type="text" size="small" @click="emit('close')">
          <template #icon>
            <CloseOutlined />
          </template>
        </a-button>
      </header>
      <div class="cb-artifact__body">
        <slot>
          <div v-if="content" class="cb-artifact__content">
            {{ content }}
          </div>
          <div v-else class="cb-artifact__empty">
            当前没有可展示的 artifact，点击左下角快捷入口可以打开额外面板。
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
.cb-artifact {
  position: absolute;
  top: 18px;
  right: 18px;
  bottom: 18px;
  width: 360px;
  max-width: calc(100vw - 36px);
  border: 1px solid var(--cc-preview-border-strong);
  border-radius: 24px;
  background: var(--cc-preview-bg-elevated);
  box-shadow: var(--cc-preview-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 40;
}

.cb-artifact__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--cc-preview-border-subtle);
}

.cb-artifact__eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cc-preview-text-muted);
}

.cb-artifact__title {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 600;
  color: var(--cc-preview-text-primary);
}

.cb-artifact__body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  color: var(--cc-preview-text-primary);
}

.cb-artifact__content {
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.7;
}

.cb-artifact__empty {
  padding: 32px 12px;
  font-size: 13px;
  color: var(--cc-preview-text-secondary);
  text-align: center;
}

.cb-artifact-enter-from,
.cb-artifact-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

.cb-artifact-enter-active,
.cb-artifact-leave-active {
  transition:
    transform 0.22s ease,
    opacity 0.22s ease;
}
</style>
