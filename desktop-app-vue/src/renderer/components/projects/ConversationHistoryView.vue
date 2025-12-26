<template>
  <div class="conversation-history-view">
    <!-- 消息列表容器 -->
    <div ref="messagesContainer" class="messages-container">
      <!-- 空状态 -->
      <div v-if="messages.length === 0 && !isLoading" class="empty-state">
        <div class="empty-icon">
          <RobotOutlined />
        </div>
        <h4>{{ emptyTitle }}</h4>
        <p class="empty-hint">{{ emptyHint }}</p>
      </div>

      <!-- 消息列表 -->
      <div v-else class="messages-list">
        <div
          v-for="(message, index) in messages"
          :key="message.id || index"
          :class="['message-item', message.role]"
        >
          <div class="message-avatar">
            <UserOutlined v-if="message.role === 'user'" />
            <RobotOutlined v-else />
          </div>

          <div class="message-content">
            <!-- 消息文本 -->
            <div class="message-text" v-html="renderMarkdown(message.content)"></div>

            <!-- 步骤列表（如果有） -->
            <div v-if="message.steps && message.steps.length > 0" class="steps-container">
              <div class="steps-header" @click="toggleSteps(message.id)">
                <CaretRightOutlined :class="{ 'expanded': expandedSteps[message.id] }" />
                <span>{{ message.steps.length }} 个步骤</span>
              </div>
              <div v-show="expandedSteps[message.id]" class="steps-content">
                <div
                  v-for="(step, idx) in message.steps"
                  :key="idx"
                  class="step-item"
                >
                  <CheckCircleOutlined v-if="step.completed" class="step-icon completed" />
                  <ClockCircleOutlined v-else class="step-icon pending" />
                  <span class="step-title">{{ step.title || step.name }}</span>
                </div>
              </div>
            </div>

            <!-- RAG上下文来源 -->
            <div v-if="message.sources && message.sources.length > 0" class="context-sources">
              <div class="source-header">
                <FileSearchOutlined />
                <span>引用来源 ({{ message.sources.length }})</span>
              </div>
              <div class="source-list">
                <a-tag
                  v-for="(source, idx) in message.sources"
                  :key="idx"
                  class="source-tag"
                  @click="handleSourceClick(source)"
                >
                  <FileTextOutlined v-if="source.source === 'project'" />
                  <BookOutlined v-else-if="source.source === 'knowledge'" />
                  <MessageOutlined v-else />
                  {{ source.fileName || source.title || '未知文件' }}
                  <span v-if="source.score" class="source-score">
                    {{ Math.round(source.score * 100) }}%
                  </span>
                </a-tag>
              </div>
            </div>

            <!-- 附件文件（如果有） -->
            <div v-if="message.attachments && message.attachments.length > 0" class="attachments">
              <div
                v-for="file in message.attachments"
                :key="file.id || file.name"
                class="attachment-item"
                @click="handleFileClick(file)"
              >
                <PaperClipOutlined />
                <span>{{ file.name }}</span>
              </div>
            </div>

            <!-- 消息元信息 -->
            <div class="message-meta">
              <span class="message-time">
                {{ formatTime(message.timestamp) }}
              </span>
              <span v-if="message.tokens" class="message-tokens">
                {{ message.tokens }} tokens
              </span>
            </div>
          </div>
        </div>

        <!-- 加载中指示器 -->
        <div v-if="isLoading" class="message-item assistant loading">
          <div class="message-avatar">
            <LoadingOutlined spin />
          </div>
          <div class="message-content">
            <div class="message-text">{{ loadingText }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import {
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
  FileSearchOutlined,
  BookOutlined,
  MessageOutlined,
  FileTextOutlined,
  CaretRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  PaperClipOutlined,
} from '@ant-design/icons-vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const props = defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
  loadingText: {
    type: String,
    default: '正在思考...',
  },
  emptyTitle: {
    type: String,
    default: '开始新对话',
  },
  emptyHint: {
    type: String,
    default: '在下方输入框中输入消息开始对话',
  },
  autoScroll: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['source-click', 'file-click']);

// 响应式状态
const messagesContainer = ref(null);
const expandedSteps = ref({});

// Markdown渲染配置
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false,
});

// 渲染Markdown
const renderMarkdown = (content) => {
  try {
    // 确保 content 是字符串
    let textContent = content;
    if (typeof content === 'object') {
      textContent = content?.text || content?.content || JSON.stringify(content);
    }
    textContent = String(textContent || '');

    const rawHTML = marked.parse(textContent);
    // 使用 DOMPurify 清理 HTML，防止 XSS 攻击
    return DOMPurify.sanitize(rawHTML);
  } catch (error) {
    console.error('Markdown rendering error:', error);
    return String(content || '');
  }
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return '';
  try {
    return formatDistanceToNow(new Date(timestamp), {
      addSuffix: true,
      locale: zhCN,
    });
  } catch (error) {
    console.error('Time formatting error:', error);
    return '';
  }
};

// 切换步骤展开/收起
const toggleSteps = (messageId) => {
  expandedSteps.value[messageId] = !expandedSteps.value[messageId];
};

// 处理来源点击
const handleSourceClick = (source) => {
  emit('source-click', source);
};

// 处理文件点击
const handleFileClick = (file) => {
  emit('file-click', file);
};

// 滚动到底部
const scrollToBottom = () => {
  if (!props.autoScroll) return;

  nextTick(() => {
    if (messagesContainer.value) {
      const container = messagesContainer.value;
      container.scrollTop = container.scrollHeight;
    }
  });
};

// 监听消息变化，自动滚动到底部
watch(() => props.messages, () => {
  scrollToBottom();
}, { deep: true });

watch(() => props.isLoading, () => {
  scrollToBottom();
});

// 组件挂载后滚动到底部
onMounted(() => {
  scrollToBottom();
});
</script>

<style scoped>
.conversation-history-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f5f7fa;
}

/* 消息容器 */
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.messages-container::-webkit-scrollbar {
  width: 6px;
}

.messages-container::-webkit-scrollbar-track {
  background: transparent;
}

.messages-container::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 3px;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  padding: 40px 20px;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.3;
}

.empty-state h4 {
  font-size: 18px;
  font-weight: 500;
  margin: 0 0 8px 0;
  color: #6b7280;
}

.empty-hint {
  font-size: 14px;
  margin: 0;
  color: #9ca3af;
}

/* 消息列表 */
.messages-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 消息项 */
.message-item {
  display: flex;
  gap: 12px;
  animation: fadeIn 0.3s ease-in;
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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 16px;
  background: #e5e7eb;
  color: #6b7280;
}

.message-item.user .message-avatar {
  background: #dbeafe;
  color: #3b82f6;
}

.message-item.assistant .message-avatar {
  background: #ddd6fe;
  color: #8b5cf6;
}

.message-content {
  flex: 1;
  min-width: 0;
}

/* 消息文本 */
.message-text {
  background: white;
  padding: 12px 16px;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  line-height: 1.6;
  word-wrap: break-word;
}

.message-item.user .message-text {
  background: #eff6ff;
  border: 1px solid #dbeafe;
}

.message-item.assistant .message-text {
  background: white;
}

/* Markdown 样式 */
.message-text :deep(code) {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.9em;
}

.message-text :deep(pre) {
  background: #1f2937;
  color: #f9fafb;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-text :deep(pre code) {
  background: none;
  color: inherit;
  padding: 0;
}

.message-text :deep(a) {
  color: #3b82f6;
  text-decoration: underline;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  padding-left: 24px;
  margin: 8px 0;
}

.message-text :deep(blockquote) {
  border-left: 3px solid #d1d5db;
  padding-left: 12px;
  margin: 8px 0;
  color: #6b7280;
}

/* 步骤容器 */
.steps-container {
  margin-top: 12px;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.steps-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  transition: background 0.2s;
}

.steps-header:hover {
  background: #f3f4f6;
}

.steps-header :deep(.anticon) {
  transition: transform 0.2s;
  font-size: 12px;
}

.steps-header :deep(.anticon.expanded) {
  transform: rotate(90deg);
}

.steps-content {
  padding: 8px 12px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
}

.step-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.step-icon.completed {
  color: #10b981;
}

.step-icon.pending {
  color: #9ca3af;
}

.step-title {
  color: #374151;
}

/* 上下文来源 */
.context-sources {
  margin-top: 12px;
}

.source-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
}

.source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.source-tag {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  transition: all 0.2s;
}

.source-tag:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.source-score {
  font-size: 11px;
  opacity: 0.7;
  margin-left: 2px;
}

/* 附件 */
.attachments {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s;
}

.attachment-item:hover {
  border-color: #3b82f6;
  color: #3b82f6;
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.1);
}

/* 消息元信息 */
.message-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  font-size: 12px;
  color: #9ca3af;
}

.message-time,
.message-tokens {
  display: inline-flex;
  align-items: center;
}

/* 加载状态 */
.message-item.loading .message-text {
  background: #fafafa;
  color: #9ca3af;
  font-style: italic;
}
</style>
