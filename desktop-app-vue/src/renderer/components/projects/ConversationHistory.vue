<template>
  <div class="conversation-history-wrapper">
    <!-- 对话列表 -->
    <div
      ref="messageListRef"
      class="message-list"
    >
      <div
        v-for="(message, index) in messages"
        :key="message.id || index"
        class="message-item"
        :class="`message-${message.role}`"
      >
        <!-- 用户消息 -->
        <template v-if="message.role === 'user'">
          <div class="message-avatar">
            <a-avatar :size="36">
              <template #icon>
                <UserOutlined />
              </template>
            </a-avatar>
          </div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-author">你</span>
              <span class="message-time">{{ formatTime(message.created_at) }}</span>
            </div>
            <div class="message-text">
              {{ message.content }}
            </div>
            <!-- 附件 -->
            <div
              v-if="message.attachments && message.attachments.length > 0"
              class="message-attachments"
            >
              <div
                v-for="(file, idx) in message.attachments"
                :key="idx"
                class="attachment-item"
                @click="handleViewAttachment(file)"
              >
                <FileOutlined />
                <span>{{ file.name }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- AI助手消息 -->
        <template v-else-if="message.role === 'assistant'">
          <div class="message-avatar">
            <a-avatar
              :size="36"
              style="background: #1677FF;"
            >
              <template #icon>
                <RobotOutlined />
              </template>
            </a-avatar>
          </div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-author">AI助手</span>
              <span class="message-time">{{ formatTime(message.created_at) }}</span>
            </div>

            <!-- 消息文本 -->
            <div
              v-if="message.content"
              class="message-text ai-response"
            >
              <div v-html="renderMarkdown(message.content)" />
            </div>

            <!-- Tool Calls (步骤展示) -->
            <div
              v-if="message.tool_calls && message.tool_calls.length > 0"
              class="message-tools"
            >
              <StepDisplay
                v-for="(toolCall, idx) in message.tool_calls"
                :key="idx"
                :step="parseToolCall(toolCall)"
                :default-expanded="idx === 0"
              />
            </div>

            <!-- 生成的文件/结果预览 -->
            <div
              v-if="message.files && message.files.length > 0"
              class="message-files"
            >
              <div class="files-header">
                <FileOutlined />
                <span>生成的文件 ({{ message.files.length }})</span>
              </div>
              <div class="files-list">
                <div
                  v-for="(file, idx) in message.files"
                  :key="idx"
                  class="file-card"
                  @click="handleOpenFile(file)"
                >
                  <div class="file-icon">
                    <component :is="getFileIcon(file.type)" />
                  </div>
                  <div class="file-info">
                    <div class="file-name">
                      {{ file.name }}
                    </div>
                    <div class="file-meta">
                      {{ formatFileSize(file.size) }}
                    </div>
                  </div>
                  <a-button
                    type="link"
                    size="small"
                  >
                    打开
                    <ArrowRightOutlined />
                  </a-button>
                </div>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="message-actions">
              <a-button
                type="text"
                size="small"
                @click="handleCopyMessage(message)"
              >
                <CopyOutlined />
                复制
              </a-button>
              <a-button
                type="text"
                size="small"
                @click="handleRegenerateResponse(message)"
              >
                <ReloadOutlined />
                重新生成
              </a-button>
              <a-button
                type="text"
                size="small"
              >
                <LikeOutlined />
              </a-button>
              <a-button
                type="text"
                size="small"
              >
                <DislikeOutlined />
              </a-button>
            </div>
          </div>
        </template>

        <!-- 系统消息 -->
        <template v-else-if="message.role === 'system'">
          <div class="system-message">
            <InfoCircleOutlined />
            <span>{{ message.content }}</span>
          </div>
        </template>
      </div>

      <!-- 加载更多 -->
      <div
        v-if="hasMore"
        class="load-more"
      >
        <a-button
          type="link"
          :loading="loadingMore"
          @click="handleLoadMore"
        >
          加载更多历史消息
        </a-button>
      </div>

      <!-- AI输入中状态 -->
      <div
        v-if="isTyping"
        class="typing-indicator"
      >
        <div class="message-avatar">
          <a-avatar
            :size="36"
            style="background: #1677FF;"
          >
            <template #icon>
              <RobotOutlined />
            </template>
          </a-avatar>
        </div>
        <div class="typing-dots">
          <span />
          <span />
          <span />
        </div>
      </div>

      <!-- 滚动到底部按钮 -->
      <a-float-button
        v-if="showScrollButton"
        type="primary"
        :style="{ right: '24px', bottom: '24px' }"
        @click="scrollToBottom"
      >
        <template #icon>
          <DownOutlined />
        </template>
      </a-float-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  UserOutlined,
  RobotOutlined,
  FileOutlined,
  CopyOutlined,
  ReloadOutlined,
  LikeOutlined,
  DislikeOutlined,
  InfoCircleOutlined,
  DownOutlined,
  ArrowRightOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  CodeOutlined,
} from '@ant-design/icons-vue';
import StepDisplay from './StepDisplay.vue';
import { marked } from 'marked';

const props = defineProps({
  messages: {
    type: Array,
    required: true,
    default: () => []
  },
  hasMore: {
    type: Boolean,
    default: false
  },
  isTyping: {
    type: Boolean,
    default: false
  },
  autoScroll: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits([
  'load-more',
  'regenerate',
  'copy',
  'view-attachment',
  'open-file',
]);

// 响应式状态
const messageListRef = ref(null);
const showScrollButton = ref(false);
const loadingMore = ref(false);
const lastScrollHeight = ref(0);

// Markdown 渲染配置
marked.setOptions({
  breaks: true,
  gfm: true,
});

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return '';}
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60000) {return '刚刚';}
  // 小于1小时
  if (diff < 3600000) {return `${Math.floor(diff / 60000)}分钟前`;}
  // 小于1天
  if (diff < 86400000) {return `${Math.floor(diff / 3600000)}小时前`;}

  // 超过1天，显示具体时间
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 渲染Markdown
const renderMarkdown = (content) => {
  if (!content) {return '';}
  try {
    return marked(content);
  } catch (error) {
    console.error('Markdown render error:', error);
    return content;
  }
};

// 解析tool call为step格式
const parseToolCall = (toolCall) => {
  return {
    id: toolCall.id || `tool-${Date.now()}`,
    name: toolCall.function?.name || toolCall.tool || '执行操作',
    title: toolCall.function?.name || toolCall.tool || '执行操作',
    status: toolCall.status || 'completed',
    tool: toolCall.function?.name || toolCall.tool,
    params: toolCall.function?.arguments || toolCall.params || {},
    result: toolCall.result,
    duration: toolCall.duration,
    error: toolCall.error,
  };
};

// 获取文件图标
const getFileIcon = (fileType) => {
  const iconMap = {
    'text': FileTextOutlined,
    'image': FileImageOutlined,
    'pdf': FilePdfOutlined,
    'word': FileWordOutlined,
    'excel': FileExcelOutlined,
    'code': CodeOutlined,
  };
  return iconMap[fileType] || FileOutlined;
};

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) {return '0 B';}
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// 滚动到底部
const scrollToBottom = (smooth = true) => {
  if (!messageListRef.value) {return;}
  nextTick(() => {
    messageListRef.value.scrollTo({
      top: messageListRef.value.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  });
};

// 处理滚动事件
const handleScroll = () => {
  if (!messageListRef.value) {return;}

  const { scrollTop, scrollHeight, clientHeight } = messageListRef.value;
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;

  showScrollButton.value = !isAtBottom;
};

// 加载更多
const handleLoadMore = async () => {
  loadingMore.value = true;
  lastScrollHeight.value = messageListRef.value.scrollHeight;

  try {
    emit('load-more');
  } catch (error) {
    console.error('Load more failed:', error);
    antMessage.error('加载失败');
  } finally {
    loadingMore.value = false;
    // 保持滚动位置
    nextTick(() => {
      if (messageListRef.value) {
        const newScrollHeight = messageListRef.value.scrollHeight;
        messageListRef.value.scrollTop = newScrollHeight - lastScrollHeight.value;
      }
    });
  }
};

// 复制消息
const handleCopyMessage = async (msg) => {
  try {
    await navigator.clipboard.writeText(msg.content);
    antMessage.success('已复制到剪贴板');
    emit('copy', msg);
  } catch (error) {
    console.error('Copy failed:', error);
    antMessage.error('复制失败');
  }
};

// 重新生成回复
const handleRegenerateResponse = (msg) => {
  emit('regenerate', msg);
};

// 查看附件
const handleViewAttachment = (file) => {
  emit('view-attachment', file);
};

// 打开文件
const handleOpenFile = (file) => {
  emit('open-file', file);
};

// 监听消息变化，自动滚动到底部
watch(() => props.messages.length, () => {
  if (props.autoScroll) {
    nextTick(() => scrollToBottom());
  }
});

// 监听输入状态
watch(() => props.isTyping, (newVal) => {
  if (newVal && props.autoScroll) {
    nextTick(() => scrollToBottom());
  }
});

// 组件挂载
onMounted(() => {
  if (messageListRef.value) {
    messageListRef.value.addEventListener('scroll', handleScroll);
    scrollToBottom(false);
  }
});

// 组件卸载
onUnmounted(() => {
  if (messageListRef.value) {
    messageListRef.value.removeEventListener('scroll', handleScroll);
  }
});

// 暴露方法
defineExpose({
  scrollToBottom,
  scrollTo: (top) => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = top;
    }
  },
});
</script>

<style scoped lang="scss">
.conversation-history-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #FFFFFF;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: #D1D5DB;
    border-radius: 4px;

    &:hover {
      background: #9CA3AF;
    }
  }

  &::-webkit-scrollbar-track {
    background: #F9FAFB;
  }
}

.message-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  animation: fadeIn 0.3s ease-in;

  &.message-user {
    .message-content {
      background: #F0F5FF;
      border: 1px solid #D6E4FF;
    }
  }

  &.message-assistant {
    .message-content {
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
    }
  }
}

.message-avatar {
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  border-radius: 12px;
  padding: 16px;
  max-width: calc(100% - 60px);
}

.message-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.message-author {
  font-weight: 600;
  font-size: 14px;
  color: #374151;
}

.message-time {
  font-size: 12px;
  color: #9CA3AF;
}

.message-text {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  word-wrap: break-word;

  &.ai-response {
    :deep(p) {
      margin: 0 0 12px 0;

      &:last-child {
        margin-bottom: 0;
      }
    }

    :deep(code) {
      background: #F3F4F6;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
    }

    :deep(pre) {
      background: #1F2937;
      color: #E5E7EB;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 12px 0;

      code {
        background: transparent;
        color: inherit;
        padding: 0;
      }
    }
  }
}

.message-attachments {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  font-size: 13px;
  color: #1677FF;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: #F0F5FF;
    border-color: #1677FF;
  }
}

.message-tools {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-files {
  margin-top: 16px;
  border-top: 1px solid #E5E7EB;
  padding-top: 16px;
}

.files-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 12px;
}

.files-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: #F0F5FF;
    border-color: #1677FF;
  }
}

.file-icon {
  font-size: 24px;
  color: #1677FF;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: 12px;
  color: #6B7280;
  margin-top: 2px;
}

.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #F3F4F6;
}

.system-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  background: #FFF7ED;
  border: 1px solid #FED7AA;
  border-radius: 8px;
  font-size: 13px;
  color: #92400E;
  text-align: center;
}

.load-more {
  text-align: center;
  padding: 16px 0;
}

.typing-indicator {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.typing-dots {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 16px 20px;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 12px;

  span {
    width: 8px;
    height: 8px;
    background: #9CA3AF;
    border-radius: 50%;
    animation: typing 1.4s infinite;

    &:nth-child(2) {
      animation-delay: 0.2s;
    }

    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
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

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-10px);
    opacity: 1;
  }
}
</style>
