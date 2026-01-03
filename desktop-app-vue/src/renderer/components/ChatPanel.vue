<template>
  <div class="chat-panel" :class="{ collapsed: !props.open }">
    <!-- 头部 -->
    <div class="chat-header">
      <div class="header-left">
        <a-space>
          <message-outlined />
          <span class="header-title">AI 对话</span>
          <a-tag v-if="llmStore.isAvailable" color="success" size="small">
            {{ llmStore.providerDisplayName }}
          </a-tag>
          <a-tag v-else color="error" size="small">
            未配置
          </a-tag>
        </a-space>
      </div>
      <div class="header-right">
        <a-space>
          <a-tooltip title="新对话">
            <a-button type="text" size="small" @click="handleNewConversation">
              <plus-outlined />
            </a-button>
          </a-tooltip>
          <a-tooltip title="对话历史">
            <a-button type="text" size="small" @click="showHistory = true">
              <history-outlined />
            </a-button>
          </a-tooltip>
          <a-tooltip title="设置">
            <a-button type="text" size="small" @click="router.push('/settings?tab=llm')">
              <setting-outlined />
            </a-button>
          </a-tooltip>
          <a-tooltip :title="props.open ? '收起' : '展开'">
            <a-button type="text" size="small" @click="togglePanel">
              <right-outlined v-if="props.open" />
              <left-outlined v-else />
            </a-button>
          </a-tooltip>
        </a-space>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="chat-messages" ref="messagesContainer">
      <a-empty
        v-if="!llmStore.isAvailable"
        description="LLM服务未配置或不可用"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      >
        <a-button type="primary" @click="router.push('/settings?tab=llm')">
          前往配置
        </a-button>
      </a-empty>

      <a-empty
        v-else-if="currentMessages.length === 0"
        description="开始新的对话"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      >
        <div class="quick-prompts">
          <a-button
            v-for="prompt in quickPrompts"
            :key="prompt"
            size="small"
            @click="handleQuickPrompt(prompt)"
            style="margin: 4px"
          >
            {{ prompt }}
          </a-button>
        </div>
      </a-empty>

      <div v-else class="messages-list">
        <div
          v-for="(msg, index) in currentMessages"
          :key="msg.id || index"
          class="message-item"
          :class="msg.role"
        >
          <div class="message-avatar">
            <a-avatar v-if="msg.role === 'user'" :style="{ backgroundColor: '#1890ff' }">
              <template #icon><user-outlined /></template>
            </a-avatar>
            <a-avatar v-else :style="{ backgroundColor: '#52c41a' }">
              <template #icon><robot-outlined /></template>
            </a-avatar>
          </div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-role">{{ msg.role === 'user' ? '我' : 'AI' }}</span>
              <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
            </div>
            <div class="message-text">
              <div v-if="msg.role === 'assistant'" v-html="renderMarkdown(msg.content)"></div>
              <div v-else>{{ msg.content }}</div>
            </div>
            <div v-if="msg.tokens || msg.references" class="message-meta">
              <a-space size="small" direction="vertical" style="width: 100%">
                <a-space size="small" v-if="msg.tokens">
                  <span class="meta-item">Tokens: {{ msg.tokens }}</span>
                  <span v-if="msg.model" class="meta-item">模型: {{ msg.model }}</span>
                </a-space>
                <div v-if="msg.references && msg.references.length > 0" class="message-references">
                  <div class="references-title">📚 参考了以下知识库内容:</div>
                  <div class="references-list">
                    <a-tag
                      v-for="ref in msg.references"
                      :key="ref.id"
                      color="blue"
                      size="small"
                      class="reference-tag"
                    >
                      {{ ref.title }} (相似度: {{ (ref.score * 100).toFixed(0) }}%)
                    </a-tag>
                  </div>
                </div>
              </a-space>
            </div>
          </div>
        </div>

        <!-- 流式输出中的消息 -->
        <div v-if="isStreaming" class="message-item assistant streaming">
          <div class="message-avatar">
            <a-avatar :style="{ backgroundColor: '#52c41a' }">
              <template #icon><robot-outlined /></template>
            </a-avatar>
          </div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-role">AI</span>
              <span class="message-time">正在输入...</span>
            </div>
            <div class="message-text">
              <div v-html="renderMarkdown(streamingText)"></div>
              <span class="typing-cursor">▊</span>
            </div>
          </div>
        </div>

        <!-- AI正在思考 -->
        <div v-if="isThinking && !isStreaming" class="message-item assistant">
          <div class="message-avatar">
            <a-avatar :style="{ backgroundColor: '#52c41a' }">
              <template #icon><robot-outlined /></template>
            </a-avatar>
          </div>
          <div class="message-content">
            <div class="message-text">
              <a-spin size="small" /> 正在思考...
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="chat-input">
      <a-textarea
        v-model:value="inputText"
        :placeholder="llmStore.isAvailable ? '输入消息... (Shift+Enter换行，Enter发送)' : 'LLM服务未配置'"
        :auto-size="{ minRows: 1, maxRows: 4 }"
        :disabled="!llmStore.isAvailable || isProcessing"
        @keydown.enter="handleKeyDown"
      />
      <div class="input-actions">
        <a-space>
          <a-button
            type="primary"
            :loading="isProcessing"
            :disabled="!inputText.trim() || !llmStore.isAvailable"
            @click="handleSend"
          >
            <template #icon><send-outlined /></template>
            发送
          </a-button>
          <a-button
            v-if="isProcessing"
            danger
            @click="handleStop"
          >
            <template #icon><stop-outlined /></template>
            停止
          </a-button>
          <a-dropdown>
            <a-button>
              <template #icon><more-outlined /></template>
            </a-button>
            <template #overlay>
              <a-menu>
                <a-menu-item @click="handleClearContext">
                  <delete-outlined /> 清除上下文
                </a-menu-item>
                <a-menu-item @click="handleExport">
                  <export-outlined /> 导出对话
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </a-space>
      </div>
    </div>

    <!-- 对话历史抽屉 -->
    <a-drawer
      v-model:open="showHistory"
      title="对话历史"
      placement="left"
      :width="300"
    >
      <ConversationHistory @select="handleSelectConversation" />
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Empty } from 'ant-design-vue';
import {
  MessageOutlined,
  UserOutlined,
  RobotOutlined,
  SendOutlined,
  PlusOutlined,
  HistoryOutlined,
  SettingOutlined,
  LeftOutlined,
  RightOutlined,
  StopOutlined,
  MoreOutlined,
  DeleteOutlined,
  ExportOutlined,
} from '@ant-design/icons-vue';
import { useLLMStore } from '../stores/llm';
import { useConversationStore } from '../stores/conversation';
import ConversationHistory from './ConversationHistory.vue';
import MarkdownIt from 'markdown-it';

const props = defineProps({
  open: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['update:open', 'toggle']);

const router = useRouter();
const llmStore = useLLMStore();
const conversationStore = useConversationStore();

// Markdown渲染器
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// 状态
const inputText = ref('');
const showHistory = ref(false);
const messagesContainer = ref(null);
const isProcessing = ref(false);
const isThinking = ref(false);
const isStreaming = ref(false);
const streamingText = ref('');

// 快捷提示
const quickPrompts = [
  '帮我总结一下这个笔记',
  '这个概念是什么意思？',
  '给我一些相关的例子',
  '解释一下这个问题',
];

// 当前消息列表
const currentMessages = computed(() => conversationStore.currentMessages);

// 切换面板
const togglePanel = () => {
  emit('toggle');
};

// 处理键盘事件
const handleKeyDown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
};

// 发送消息
const handleSend = async () => {
  if (!inputText.value.trim() || !llmStore.isAvailable) {
    return;
  }

  const userMessage = inputText.value.trim();
  inputText.value = '';

  // 添加用户消息
  conversationStore.addMessage({
    role: 'user',
    content: userMessage,
    timestamp: Date.now(),
  });

  // 滚动到底部
  scrollToBottom();

  // 发送到LLM
  isProcessing.value = true;

  try {
    // RAG增强查询
    let enhancedPrompt = userMessage;
    let retrievedDocs = [];

    try {
      const ragResult = await window.electronAPI.rag.enhanceQuery(userMessage);
      if (ragResult && ragResult.context) {
        enhancedPrompt = ragResult.context;
        retrievedDocs = ragResult.retrievedDocs || [];

        // 如果有检索到的文档，在消息中添加引用信息
        if (retrievedDocs.length > 0) {
          console.log(`[ChatPanel] RAG检索到 ${retrievedDocs.length} 个相关文档`);
        }
      }
    } catch (error) {
      console.warn('[ChatPanel] RAG增强失败，使用原始查询:', error);
    }

    if (llmStore.config.streamEnabled) {
      // 流式输出
      isStreaming.value = true;
      streamingText.value = '';

      await llmStore.queryStream(
        enhancedPrompt,
        (data) => {
          streamingText.value = data.fullText;
          scrollToBottom();
        }
      );

      // 添加AI消息
      const aiMessage = {
        role: 'assistant',
        content: streamingText.value,
        timestamp: Date.now(),
        model: llmStore.currentModel,
      };

      // 如果有检索到的文档，添加引用
      if (retrievedDocs.length > 0) {
        aiMessage.references = retrievedDocs.map(doc => ({
          id: doc.id,
          title: doc.title,
          score: doc.score,
        }));
      }

      conversationStore.addMessage(aiMessage);

      isStreaming.value = false;
      streamingText.value = '';
    } else {
      // 非流式输出
      isThinking.value = true;

      const response = await llmStore.query(enhancedPrompt);

      const aiMessage = {
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        tokens: response.tokens,
        model: response.model,
      };

      // 如果有检索到的文档，添加引用
      if (retrievedDocs.length > 0) {
        aiMessage.references = retrievedDocs.map(doc => ({
          id: doc.id,
          title: doc.title,
          score: doc.score,
        }));
      }

      conversationStore.addMessage(aiMessage);

      isThinking.value = false;
    }

    // 自动保存
    if (llmStore.config.autoSaveConversations) {
      await conversationStore.saveCurrentConversation();
    }

    scrollToBottom();
  } catch (error) {
    console.error('发送消息失败:', error);
    message.error('发送失败: ' + error.message);
    isStreaming.value = false;
    isThinking.value = false;
  } finally {
    isProcessing.value = false;
  }
};

// 停止生成
const handleStop = () => {
  // TODO: 实现停止功能
  isProcessing.value = false;
  isStreaming.value = false;
  isThinking.value = false;
  message.info('已停止生成');
};

// 快捷提示
const handleQuickPrompt = (prompt) => {
  inputText.value = prompt;
};

// 新对话
const handleNewConversation = () => {
  conversationStore.createNewConversation();
  message.success('已创建新对话');
};

// 清除上下文
const handleClearContext = async () => {
  try {
    await llmStore.clearContext();
    message.success('已清除上下文');
  } catch (error) {
    message.error('清除失败: ' + error.message);
  }
};

// 导出对话
const handleExport = () => {
  const conversation = conversationStore.currentConversation;
  if (!conversation || conversation.messages.length === 0) {
    message.warning('没有可导出的对话');
    return;
  }

  const content = conversation.messages
    .map((msg) => {
      const role = msg.role === 'user' ? '我' : 'AI';
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      return `[${role}] ${time}\n${msg.content}\n`;
    })
    .join('\n---\n\n');

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `对话_${conversation.title}_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);

  message.success('对话已导出');
};

// 选择对话
const handleSelectConversation = (conversation) => {
  conversationStore.loadConversation(conversation.id);
  showHistory.value = false;
  message.success('已加载对话: ' + conversation.title);
};

// 渲染Markdown
const renderMarkdown = (text) => {
  if (!text) return '';
  return md.render(text);
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) {
    return '刚刚';
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  } else if (diff < 86400000) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
};

// 滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

// 监听消息变化
watch(currentMessages, () => {
  scrollToBottom();
});

// 组件挂载时
onMounted(async () => {
  // 加载LLM配置
  await llmStore.loadConfig();
  await llmStore.checkStatus();

  // 加载最近的对话
  await conversationStore.loadConversations();

  // 如果没有当前对话，创建新对话
  if (!conversationStore.currentConversation) {
    conversationStore.createNewConversation();
  }
});
</script>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-left: 1px solid #f0f0f0;
  transition: all 0.3s;
}

.chat-panel.collapsed {
  width: 0;
  overflow: hidden;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}

.header-title {
  font-weight: 500;
  font-size: 14px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-item {
  display: flex;
  gap: 12px;
  animation: fadeIn 0.3s;
}

.message-item.user {
  flex-direction: row-reverse;
}

.message-avatar {
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  min-width: 0;
}

.message-item.user .message-content {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.message-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.message-item.user .message-header {
  flex-direction: row-reverse;
}

.message-role {
  font-weight: 500;
}

.message-text {
  padding: 8px 12px;
  border-radius: 8px;
  background: #f5f5f5;
  word-wrap: break-word;
  line-height: 1.6;
}

.message-item.user .message-text {
  background: #1890ff;
  color: white;
}

.message-text :deep(p) {
  margin: 0;
}

.message-text :deep(pre) {
  background: #f0f0f0;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-text :deep(code) {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
}

.message-item.user .message-text :deep(pre),
.message-item.user .message-text :deep(code) {
  background: rgba(255, 255, 255, 0.2);
}

.message-meta {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.meta-item {
  margin-right: 8px;
}

.message-references {
  width: 100%;
  padding: 8px;
  background: #f0f8ff;
  border-radius: 4px;
  border-left: 3px solid #1890ff;
}

.references-title {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
  margin-bottom: 6px;
  font-weight: 500;
}

.references-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.reference-tag {
  cursor: pointer;
  transition: opacity 0.2s;
}

.reference-tag:hover {
  opacity: 0.8;
}

.typing-cursor {
  display: inline-block;
  animation: blink 1s infinite;
  margin-left: 2px;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.chat-input {
  padding: 16px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
}

.input-actions {
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.quick-prompts {
  margin-top: 16px;
  text-align: center;
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
</style>
