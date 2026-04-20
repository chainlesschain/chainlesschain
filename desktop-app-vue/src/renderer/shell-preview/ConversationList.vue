<template>
  <div class="cc-preview-conv-list">
    <div class="cc-preview-conv-list__header">
      <span class="cc-preview-conv-list__title">会话</span>
      <a-button
        type="text"
        size="small"
        class="cc-preview-conv-list__new"
        @click="emit('new-conversation')"
      >
        <template #icon>
          <PlusOutlined />
        </template>
      </a-button>
    </div>

    <div v-if="!conversations.length" class="cc-preview-conv-list__empty">
      暂无会话，点击右上角 + 新建
    </div>

    <div v-else class="cc-preview-conv-list__items" role="listbox">
      <div
        v-for="item in conversations"
        :key="item.id"
        class="cc-preview-conv-item"
        :class="{ 'cc-preview-conv-item--active': item.id === activeId }"
        role="option"
        :aria-selected="item.id === activeId"
        @click="emit('select', item.id)"
      >
        <div class="cc-preview-conv-item__title">
          {{ item.title }}
        </div>
        <div v-if="item.preview" class="cc-preview-conv-item__preview">
          {{ item.preview }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PlusOutlined } from "@ant-design/icons-vue";

export interface ConversationItem {
  id: string;
  title: string;
  preview?: string;
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
.cc-preview-conv-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  padding: 8px 8px 4px;
}

.cc-preview-conv-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 8px;
}

.cc-preview-conv-list__title {
  font-size: 12px;
  color: var(--cc-preview-text-secondary);
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.cc-preview-conv-list__new {
  color: var(--cc-preview-text-secondary);
}

.cc-preview-conv-list__empty {
  padding: 24px 12px;
  font-size: 12px;
  color: var(--cc-preview-text-muted);
  text-align: center;
}

.cc-preview-conv-list__items {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.cc-preview-conv-item {
  padding: 8px 10px;
  margin: 2px 0;
  border-radius: 6px;
  cursor: pointer;
  color: var(--cc-preview-text-primary);
  transition: background 0.12s;
}

.cc-preview-conv-item:hover {
  background: var(--cc-preview-bg-hover);
}

.cc-preview-conv-item--active {
  background: var(--cc-preview-bg-hover);
}

.cc-preview-conv-item__title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cc-preview-conv-item__preview {
  font-size: 11px;
  color: var(--cc-preview-text-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
