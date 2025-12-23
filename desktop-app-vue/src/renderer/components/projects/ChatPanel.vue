<template>
  <div class="chat-panel">
    <!-- 头部：上下文选择器 -->
    <div class="chat-header">
      <h3 class="chat-title">
        <MessageOutlined />
        AI 助手
      </h3>

      <a-radio-group v-model:value="contextMode" size="small" button-style="solid">
        <a-radio-button value="project">
          <FolderOutlined />
          项目
        </a-radio-button>
        <a-radio-button value="file">
          <FileTextOutlined />
          文件
        </a-radio-button>
        <a-radio-button value="global">
          <GlobalOutlined />
          全局
        </a-radio-button>
      </a-radio-group>
    </div>

    <!-- 消息列表容器 -->
    <div ref="messagesContainer" class="messages-container">
      <!-- 空状态 -->
      <div v-if="messages.length === 0" class="empty-state">
        <div class="empty-icon">
          <RobotOutlined />
        </div>
        <h4>{{ getEmptyStateText() }}</h4>
        <p class="empty-hint">{{ getEmptyHint() }}</p>
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
            <div class="message-text" v-html="renderMarkdown(message.content)"></div>
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
            <div class="message-text">正在思考...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-container">
      <div class="input-wrapper">
        <a-textarea
          v-model:value="userInput"
          :placeholder="getInputPlaceholder()"
          :auto-size="{ minRows: 1, maxRows: 4 }"
          :disabled="isLoading"
          @keydown="handleKeyDown"
        />

        <div class="input-actions">
          <a-tooltip title="清空对话">
            <a-button
              type="text"
              size="small"
              :disabled="messages.length === 0 || isLoading"
              @click="handleClearConversation"
            >
              <DeleteOutlined />
            </a-button>
          </a-tooltip>

          <a-button
            type="primary"
            size="small"
            :loading="isLoading"
            :disabled="!userInput.trim()"
            @click="handleSendMessage"
          >
            <SendOutlined v-if="!isLoading" />
            发送
          </a-button>
        </div>
      </div>

      <!-- 上下文信息提示 -->
      <div v-if="contextInfo" class="context-info">
        <InfoCircleOutlined />
        <span>{{ contextInfo }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  MessageOutlined,
  FolderOutlined,
  FileTextOutlined,
  GlobalOutlined,
  RobotOutlined,
  UserOutlined,
  SendOutlined,
  DeleteOutlined,
  LoadingOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons-vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const props = defineProps({
  projectId: {
    type: String,
    required: false,
    default: '',
  },
  currentFile: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['conversationLoaded']);

// 响应式状态
const contextMode = ref('project'); // 'project' | 'file' | 'global'
const messages = ref([]);
const userInput = ref('');
const isLoading = ref(false);
const messagesContainer = ref(null);
const currentConversation = ref(null);

// 计算属性
const contextInfo = computed(() => {
  if (contextMode.value === 'project') {
    return `包含项目结构和文件列表`;
  } else if (contextMode.value === 'file' && props.currentFile) {
    return `当前文件: ${props.currentFile.file_name}`;
  } else if (contextMode.value === 'file' && !props.currentFile) {
    return `请先选择一个文件`;
  }
  return null;
});

/**
 * 获取空状态文本
 */
const getEmptyStateText = () => {
  if (contextMode.value === 'project') {
    return '项目 AI 助手';
  } else if (contextMode.value === 'file') {
    return '文件 AI 助手';
  }
  return 'AI 助手';
};

/**
 * 获取空状态提示
 */
const getEmptyHint = () => {
  if (contextMode.value === 'project') {
    return '询问项目相关问题，比如"这个项目有哪些文件？"';
  } else if (contextMode.value === 'file' && props.currentFile) {
    return `询问关于 ${props.currentFile.file_name} 的问题`;
  } else if (contextMode.value === 'file') {
    return '请先从左侧选择一个文件';
  }
  return '开始新对话';
};

/**
 * 获取输入提示
 */
const getInputPlaceholder = () => {
  if (contextMode.value === 'project') {
    return '询问项目相关问题...';
  } else if (contextMode.value === 'file' && props.currentFile) {
    return `询问关于 ${props.currentFile.file_name} 的问题...`;
  } else if (contextMode.value === 'file') {
    return '请先选择一个文件...';
  }
  return '输入消息...';
};

/**
 * 渲染 Markdown
 */
const renderMarkdown = (content) => {
  try {
    // 确保 content 是字符串
    let textContent = content;
    if (typeof content === 'object') {
      // 如果是对象，尝试提取文本内容
      textContent = content?.text || content?.content || JSON.stringify(content);
    }
    textContent = String(textContent || '');

    const rawHTML = marked.parse(textContent);
    return DOMPurify.sanitize(rawHTML);
  } catch (error) {
    console.error('Markdown 渲染失败:', error);
    return String(content || '');
  }
};

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  if (!timestamp) return '';
  return formatDistanceToNow(new Date(timestamp), {
    addSuffix: true,
    locale: zhCN,
  });
};

/**
 * 构建项目上下文
 */
const buildProjectContext = async () => {
  try {
    // 获取项目信息
    const project = await window.electronAPI.project.get(props.projectId);
    if (!project) return '';

    // 获取项目文件列表
    const files = await window.electronAPI.project.getFiles(props.projectId);

    // 构建文件树结构文本
    let context = `# 项目：${project.name}\n\n`;
    context += `描述：${project.description || '无'}\n`;
    context += `类型：${project.project_type}\n\n`;
    context += `## 文件列表\n\n`;

    if (files && files.length > 0) {
      files.forEach(file => {
        context += `- ${file.file_path} (${file.file_type})\n`;
      });
    } else {
      context += '暂无文件\n';
    }

    return context;
  } catch (error) {
    console.error('构建项目上下文失败:', error);
    return '';
  }
};

/**
 * 构建文件上下文
 */
const buildFileContext = () => {
  if (!props.currentFile) return '';

  let context = `# 当前文件：${props.currentFile.file_name}\n\n`;
  context += `路径：${props.currentFile.file_path}\n`;
  context += `类型：${props.currentFile.file_type}\n\n`;
  context += `## 文件内容\n\n\`\`\`\n${props.currentFile.content || ''}\n\`\`\`\n`;

  return context;
};

/**
 * 构建系统提示
 */
const buildSystemPrompt = async () => {
  let systemPrompt = '你是一个专业的编程助手。';

  if (contextMode.value === 'project') {
    const projectContext = await buildProjectContext();
    systemPrompt += `\n\n${projectContext}\n\n请基于以上项目信息回答用户的问题。`;
  } else if (contextMode.value === 'file' && props.currentFile) {
    const fileContext = buildFileContext();
    systemPrompt += `\n\n${fileContext}\n\n请基于以上文件内容回答用户的问题。`;
  }

  return systemPrompt;
};

/**
 * 发送消息
 */
const handleSendMessage = async () => {
  const input = userInput.value.trim();
  if (!input || isLoading.value) return;

  // 检查API是否可用
  if (!window.electronAPI?.llm) {
    console.error('[ChatPanel] LLM API 不可用:', window.electronAPI);
    antMessage.error('LLM API 不可用，请重启应用');
    return;
  }

  if (!window.electronAPI?.conversation) {
    console.error('[ChatPanel] Conversation API 不可用:', window.electronAPI);
    antMessage.error('对话 API 不可用，请重启应用');
    return;
  }

  // 在文件模式下检查是否选择了文件
  if (contextMode.value === 'file' && !props.currentFile) {
    antMessage.warning('请先选择一个文件');
    return;
  }

  isLoading.value = true;
  userInput.value = '';

  console.log('[ChatPanel] 准备发送消息，input:', input);

  try {
    // 创建用户消息
    const userMessage = {
      id: `msg_${Date.now()}_user`,
      conversation_id: currentConversation.value?.id,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    // 添加到消息列表
    messages.value.push(userMessage);

    // 如果没有当前对话，创建一个
    if (!currentConversation.value) {
      await createConversation();
    }

    // 保存用户消息到数据库
    await window.electronAPI.conversation.createMessage({
      conversation_id: currentConversation.value.id,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    });

    // 滚动到底部
    await nextTick();
    scrollToBottom();

    // 构建消息上下文
    const systemPrompt = await buildSystemPrompt();

    // 调用 LLM
    const response = await window.electronAPI.llm.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.value.slice(-10).map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      ],
      stream: false,
    });

    // 创建助手消息
    const assistantMessage = {
      id: `msg_${Date.now()}_assistant`,
      conversation_id: currentConversation.value.id,
      role: 'assistant',
      content: response.content || response.message || '抱歉，我没有理解你的问题。',
      timestamp: Date.now(),
      tokens: response.usage?.total_tokens,
    };

    // 添加到消息列表
    messages.value.push(assistantMessage);

    // 保存助手消息到数据库
    await window.electronAPI.conversation.createMessage({
      conversation_id: currentConversation.value.id,
      role: 'assistant',
      content: assistantMessage.content,
      timestamp: Date.now(),
      tokens: response.usage?.total_tokens,
    });

    // 滚动到底部
    await nextTick();
    scrollToBottom();
  } catch (error) {
    console.error('发送消息失败:', error);
    antMessage.error('发送消息失败: ' + error.message);
  } finally {
    isLoading.value = false;
  }
};

/**
 * 清空对话
 */
const handleClearConversation = async () => {
  try {
    if (!currentConversation.value) return;

    // 检查API是否可用
    if (!window.electronAPI?.conversation) {
      // 直接清空本地消息
      messages.value = [];
      antMessage.success('对话已清空');
      return;
    }

    // 清空数据库中的消息
    await window.electronAPI.conversation.clearMessages(currentConversation.value.id);

    // 清空本地消息列表
    messages.value = [];

    antMessage.success('对话已清空');
  } catch (error) {
    console.error('清空对话失败:', error);
    antMessage.error('清空对话失败');
  }
};

/**
 * 处理键盘事件
 */
const handleKeyDown = (event) => {
  // Ctrl+Enter 或 Cmd+Enter 发送消息
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    handleSendMessage();
  }
};

/**
 * 滚动到底部
 */
const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
};

/**
 * 创建对话
 */
const createConversation = async () => {
  try {
    // 检查API是否可用
    if (!window.electronAPI?.conversation) {
      console.warn('[ChatPanel] 对话API未实现，跳过创建');
      return;
    }

    const conversationData = {
      title: contextMode.value === 'project' ? '项目对话' : contextMode.value === 'file' ? '文件对话' : '新对话',
      project_id: contextMode.value === 'project' ? props.projectId : null,
      context_type: contextMode.value,
      context_data: contextMode.value === 'file' && props.currentFile
        ? { file_id: props.currentFile.id, file_name: props.currentFile.file_name }
        : null,
    };

    currentConversation.value = await window.electronAPI.conversation.create(conversationData);
    emit('conversationLoaded', currentConversation.value);
  } catch (error) {
    console.error('创建对话失败:', error);
    antMessage.error('创建对话失败');
  }
};

/**
 * 加载对话
 */
const loadConversation = async () => {
  try {
    // 检查对话API是否可用
    if (!window.electronAPI?.conversation) {
      console.warn('[ChatPanel] 对话API未实现，跳过加载');
      messages.value = [];
      currentConversation.value = null;
      return;
    }

    if (contextMode.value === 'project') {
      // 尝试加载项目对话
      const conversation = await window.electronAPI.conversation.getByProject(props.projectId);

      if (conversation) {
        currentConversation.value = conversation;

        // 加载消息
        const loadedMessages = await window.electronAPI.conversation.getMessages(conversation.id);
        messages.value = loadedMessages || [];

        emit('conversationLoaded', conversation);

        // 滚动到底部
        await nextTick();
        scrollToBottom();
      } else {
        // 没有对话，清空消息
        messages.value = [];
        currentConversation.value = null;
      }
    } else {
      // 非项目模式，清空对话
      messages.value = [];
      currentConversation.value = null;
    }
  } catch (error) {
    console.error('加载对话失败:', error);
    // 不显示错误消息，因为API可能未实现
  }
};

// 监听上下文模式变化
watch(contextMode, () => {
  loadConversation();
});

// 监听项目变化
watch(() => props.projectId, () => {
  if (contextMode.value === 'project') {
    loadConversation();
  }
});

// 监听当前文件变化
watch(() => props.currentFile, () => {
  if (contextMode.value === 'file') {
    // 文件变化时不自动清空对话，只更新上下文
  }
});

// 组件挂载时加载对话
onMounted(() => {
  loadConversation();
});
</script>

<style scoped>
.chat-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f9fafb;
  border-left: 1px solid #e5e7eb;
}

/* 头部 */
.chat-header {
  padding: 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 消息容器 */
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  min-height: 0;
}

/* 空状态 */
.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: #9ca3af;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
  color: #6b7280;
}

.empty-hint {
  margin: 0;
  font-size: 14px;
  color: #9ca3af;
}

/* 消息列表 */
.messages-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-item {
  display: flex;
  gap: 12px;
}

.message-item.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.message-item.user .message-avatar {
  background: #667eea;
  color: white;
}

.message-item.assistant .message-avatar {
  background: #f3f4f6;
  color: #667eea;
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

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  word-wrap: break-word;
  max-width: 100%;
}

.message-item.user .message-text {
  background: #667eea;
  color: white;
}

.message-item.assistant .message-text {
  background: white;
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

/* 输入区域 */
.input-container {
  padding: 16px;
  background: white;
  border-top: 1px solid #e5e7eb;
}

.input-wrapper {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.input-wrapper :deep(.ant-input) {
  flex: 1;
}

.input-actions {
  display: flex;
  gap: 4px;
}

.context-info {
  margin-top: 8px;
  padding: 8px 12px;
  background: #f3f4f6;
  border-radius: 6px;
  font-size: 12px;
  color: #6b7280;
  display: flex;
  align-items: center;
  gap: 6px;
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

/* 滚动条 */
.messages-container::-webkit-scrollbar {
  width: 6px;
}

.messages-container::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.messages-container::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
