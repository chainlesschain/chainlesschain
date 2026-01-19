<template>
  <div :class="['message-item', message.role]">
    <div class="message-avatar">
      <UserOutlined v-if="message.role === 'user'" />
      <RobotOutlined v-else />
    </div>
    <div class="message-content">
      <div class="message-text" v-html="renderedContent" />

      <!-- RAG上下文来源 -->
      <div
        v-if="message.ragSources && message.ragSources.length > 0"
        class="context-sources"
      >
        <div class="source-header">
          <DatabaseOutlined />
          上下文来源
        </div>
        <div class="source-list">
          <a-tag
            v-for="(source, idx) in message.ragSources"
            :key="idx"
            class="source-tag"
            @click="handleSourceClick(source)"
          >
            {{ source.fileName }}
            <span class="source-score">{{ (source.score * 100).toFixed(0) }}%</span>
          </a-tag>
        </div>
      </div>

      <div class="message-meta">
        <span class="message-time">{{ formattedTime }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { UserOutlined, RobotOutlined, DatabaseOutlined } from '@ant-design/icons-vue';
import { renderMarkdown, formatTime } from '../../utils/chatHelpers';

const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['open-source']);

const renderedContent = computed(() => renderMarkdown(props.message.content));
const formattedTime = computed(() => formatTime(props.message.timestamp));

const handleSourceClick = (source) => {
  emit('open-source', source);
};
</script>

<style scoped>
/* 消息项基础样式 */
.message-item {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  padding: 0 24px;
  animation: fadeIn 0.2s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 18px;
}

.message-item.assistant .message-avatar {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.message-content {
  flex: 1;
  max-width: 800px;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.message-item.user .message-text {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}

.message-item.assistant .message-text {
  background: #f9fafb;
  color: #1f2937;
  border: 1px solid #e5e7eb;
}

.message-item.loading .message-text {
  opacity: 0.7;
}

.message-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #9ca3af;
  display: flex;
  gap: 8px;
}

/* RAG上下文来源 */
.context-sources {
  margin-top: 12px;
  padding: 12px;
  background: #f0f9ff;
  border-radius: 8px;
  border-left: 3px solid #3b82f6;
}

.source-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #3b82f6;
  margin-bottom: 8px;
}

.source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.source-tag {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: white;
  border: 1px solid #3b82f6;
  color: #3b82f6;
  border-radius: 12px;
  font-size: 12px;
  transition: all 0.2s;
}

.source-tag:hover {
  background: #3b82f6;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
}

.source-score {
  font-weight: 600;
  margin-left: 4px;
  padding: 0 4px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 4px;
}

.source-tag:hover .source-score {
  background: rgba(255, 255, 255, 0.2);
}

/* Markdown 样式 */
.message-text :deep(code) {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
}

.message-item.user .message-text :deep(code) {
  background: rgba(255, 255, 255, 0.2);
}

.message-text :deep(pre) {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-text :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}
</style>
