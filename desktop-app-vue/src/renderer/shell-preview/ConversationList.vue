<template>
  <div class="cb-projects">
    <button
      type="button"
      class="cb-projects__open"
      @click="emit('new-conversation')"
    >
      <span class="cb-projects__open-icon">+</span>
      <span>打开项目</span>
    </button>

    <div class="cb-projects__items" role="listbox" aria-label="项目列表">
      <button
        v-for="item in conversations"
        :key="item.id"
        type="button"
        class="cb-project-item"
        :class="{ 'cb-project-item--active': item.id === activeId }"
        role="option"
        :aria-selected="item.id === activeId"
        @click="emit('select', item.id)"
      >
        <div class="cb-project-item__header">
          <span class="cb-project-item__title">{{ item.title }}</span>
          <span
            class="cb-project-item__status"
            :class="`cb-project-item__status--${item.status || 'idle'}`"
          />
        </div>
        <div class="cb-project-item__meta">
          <span>{{ item.relativeTime }}</span>
          <span>{{ item.workspaceLabel }}</span>
        </div>
        <div v-if="item.preview" class="cb-project-item__preview">
          {{ item.preview }}
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface ConversationItem {
  id: string;
  title: string;
  preview?: string;
  relativeTime?: string;
  workspaceLabel?: string;
  status?: "done" | "running" | "idle";
}

defineProps<{
  conversations: ConversationItem[];
  activeId?: string;
}>();

const emit = defineEmits<{
  (e: "select", id: string): void;
  (e: "new-conversation"): void;
}>();
</script>

<style scoped>
.cb-projects {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.cb-projects__open {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  width: 100%;
  border: 1px solid var(--cc-preview-border-strong);
  border-radius: 16px;
  padding: 14px 16px;
  background: var(--cc-preview-bg-elevated);
  color: var(--cc-preview-text-primary);
  font-size: 15px;
  font-weight: 600;
  box-shadow: var(--cc-preview-soft-shadow);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    border-color 0.16s ease;
}

.cb-projects__open:hover {
  transform: translateY(-1px);
  border-color: var(--cc-preview-accent-soft);
  box-shadow: var(--cc-preview-shadow);
}

.cb-projects__open-icon {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--cc-preview-chip-bg);
  color: var(--cc-preview-accent);
  font-size: 18px;
  line-height: 1;
}

.cb-projects__items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.cb-project-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 18px;
  padding: 14px 14px 13px;
  background: transparent;
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.cb-project-item:hover {
  background: var(--cc-preview-bg-hover);
}

.cb-project-item--active {
  background: linear-gradient(
    180deg,
    var(--cc-preview-card-highlight),
    var(--cc-preview-bg-elevated)
  );
  border-color: var(--cc-preview-border-strong);
  box-shadow: var(--cc-preview-soft-shadow);
}

.cb-project-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cb-project-item__title {
  min-width: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--cc-preview-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cb-project-item__status {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--cc-preview-status-idle);
}

.cb-project-item__status--done {
  background: var(--cc-preview-status-done);
}

.cb-project-item__status--running {
  background: var(--cc-preview-status-running);
  box-shadow: 0 0 0 4px var(--cc-preview-status-running-ring);
}

.cb-project-item__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--cc-preview-text-secondary);
}

.cb-project-item__preview {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--cc-preview-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
