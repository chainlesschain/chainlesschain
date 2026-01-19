<template>
  <div class="ai-chat-page">
    <!-- 右侧：主内容区 -->
    <div class="main-container">
      <!-- 对话内容区 -->
      <div class="conversation-content">
        <!-- 消息列表 -->
        <div
          ref="messagesContainerRef"
          class="messages-container"
        >
          <!-- 欢迎消息 -->
          <div
            v-if="messages.length === 0"
            class="welcome-message"
          >
            <div class="welcome-icon">
              <RobotOutlined />
            </div>
            <h2>你好！我是 ChainlessChain AI 助手</h2>
            <p>我可以帮你完成各种任务，比如：</p>
            <div class="welcome-features">
              <div class="feature-tag">
                💻 代码编写与调试
              </div>
              <div class="feature-tag">
                📄 文档生成与编辑
              </div>
              <div class="feature-tag">
                📊 数据分析与可视化
              </div>
              <div class="feature-tag">
                🌐 网页开发与设计
              </div>
            </div>
            <p class="welcome-hint">
              输入你的需求开始对话，或使用 @ 来引用知识库和文件
            </p>
          </div>

          <!-- 对话消息 -->
          <div
            v-for="message in messages"
            :key="message.id"
            class="message-item"
            :class="`message-${message.role}`"
          >
            <!-- 用户消息 -->
            <div
              v-if="message.role === 'user'"
              class="message-wrapper"
            >
              <div class="message-avatar">
                <a-avatar
                  :src="userAvatar"
                  :size="36"
                >
                  <template #icon>
                    <UserOutlined />
                  </template>
                </a-avatar>
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-author">{{ userName || '你' }}</span>
                  <span class="message-time">{{ formatTime(message.timestamp) }}</span>
                </div>
                <div class="message-text">
                  {{ message.content }}
                </div>
              </div>
            </div>

            <!-- AI消息 -->
            <div
              v-else-if="message.role === 'assistant'"
              class="message-wrapper"
            >
              <div class="message-avatar">
                <a-avatar
                  :size="36"
                  style="background: linear-gradient(135deg, #667EEA 0%, #764BA2 100%)"
                >
                  <RobotOutlined />
                </a-avatar>
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-author">AI 助手</span>
                  <span class="message-time">{{ formatTime(message.timestamp) }}</span>
                </div>
                <div
                  class="message-text"
                  v-html="renderMarkdown(message.content)"
                />

                <!-- 执行步骤 -->
                <div
                  v-if="message.steps && message.steps.length > 0"
                  class="message-steps"
                >
                  <StepDisplay
                    v-for="step in message.steps"
                    :key="step.id"
                    :step="step"
                    :default-expanded="step.status === 'running' || step.status === 'failed'"
                    @retry="handleStepRetry"
                    @cancel="handleStepCancel"
                  />
                </div>

                <!-- 预览内容 -->
                <div
                  v-if="message.preview"
                  class="message-preview"
                >
                  <BrowserPreview
                    :preview-type="message.preview.type"
                    :url="message.preview.url"
                    :html-content="message.preview.htmlContent"
                    :image-url="message.preview.imageUrl"
                    :pdf-url="message.preview.pdfUrl"
                    :title="message.preview.title"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- AI思考中 -->
          <div
            v-if="isThinking"
            class="message-item message-assistant"
          >
            <div class="message-wrapper">
              <div class="message-avatar">
                <a-avatar
                  :size="36"
                  style="background: linear-gradient(135deg, #667EEA 0%, #764BA2 100%)"
                >
                  <RobotOutlined />
                </a-avatar>
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-author">AI 助手</span>
                </div>
                <div class="thinking-indicator">
                  <LoadingOutlined spin />
                  <span>思考中...</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部：输入框 -->
        <div class="input-container">
          <ConversationInput
            ref="inputRef"
            :placeholder="inputPlaceholder"
            :disabled="isThinking"
            :show-hint="true"
            @submit="handleSubmitMessage"
            @file-upload="handleFileUpload"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import { useAuthStore } from '@/stores/auth';
import {
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
} from '@ant-design/icons-vue';
import ConversationInput from '@/components/projects/ConversationInput.vue';
import BrowserPreview from '@/components/projects/BrowserPreview.vue';
import StepDisplay from '@/components/projects/StepDisplay.vue';
import { marked } from 'marked';

const authStore = useAuthStore();

// 响应式状态
const conversations = ref([]);
const activeConversationId = ref('');
const messages = ref([]);
const isThinking = ref(false);
const messagesContainerRef = ref(null);
const inputRef = ref(null);

// 用户信息
const userName = computed(() => authStore.currentUser?.username || '用户');
const userAvatar = computed(() => authStore.currentUser?.avatar || '');

// 输入框占位符
const inputPlaceholder = computed(() => {
  if (isThinking.value) {return 'AI 正在思考中，请稍候...';}
  return '给我发消息或描述你的任务...';
});

// 加载对话列表
const loadConversations = async () => {
  try {
    // 从数据库加载对话列表
    const data = await window.electronAPI.conversation.list();
    conversations.value = data.map(conv => ({
      id: conv.id,
      title: conv.title,
      updated_at: conv.updated_at,
      is_starred: conv.is_starred || false,
    }));

    // 如果有对话，加载第一个
    if (conversations.value.length > 0 && !activeConversationId.value) {
      activeConversationId.value = conversations.value[0].id;
      await loadConversationMessages(conversations.value[0].id);
    }
  } catch (error) {
    logger.error('加载对话列表失败:', error);
    antMessage.error('加载对话列表失败');
  }
};

// 加载对话消息
const loadConversationMessages = async (conversationId) => {
  try {
    const data = await window.electronAPI.conversation.getMessages(conversationId);
    messages.value = data.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.created_at,
      steps: msg.steps || [],
      preview: msg.preview || null,
    }));

    // 滚动到底部
    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error('加载对话消息失败:', error);
    antMessage.error('加载对话消息失败');
  }
};

// 新建对话
const handleNewConversation = async () => {
  try {
    const conversation = await window.electronAPI.conversation.create({
      title: '新对话',
    });

    conversations.value.unshift({
      id: conversation.id,
      title: conversation.title,
      updated_at: Date.now(),
      is_starred: false,
    });

    activeConversationId.value = conversation.id;
    messages.value = [];

    antMessage.success('创建新对话成功');
  } catch (error) {
    logger.error('创建对话失败:', error);
    antMessage.error('创建对话失败');
  }
};

// 点击对话
const handleConversationClick = async (conversation) => {
  if (activeConversationId.value === conversation.id) {return;}

  activeConversationId.value = conversation.id;
  await loadConversationMessages(conversation.id);
};

// 对话操作
const handleConversationAction = async ({ action, conversation }) => {
  switch (action) {
    case 'rename':
      // TODO: 显示重命名对话框
      break;
    case 'star':
      try {
        await window.electronAPI.conversation.toggleStar(conversation.id);
        conversation.is_starred = !conversation.is_starred;
      } catch (error) {
        antMessage.error('操作失败');
      }
      break;
    case 'delete':
      try {
        await window.electronAPI.conversation.delete(conversation.id);
        conversations.value = conversations.value.filter(c => c.id !== conversation.id);
        if (activeConversationId.value === conversation.id) {
          activeConversationId.value = conversations.value[0]?.id || '';
          if (activeConversationId.value) {
            await loadConversationMessages(activeConversationId.value);
          } else {
            messages.value = [];
          }
        }
        antMessage.success('删除对话成功');
      } catch (error) {
        antMessage.error('删除对话失败');
      }
      break;
  }
};

// 导航点击
const handleNavClick = (item) => {
  logger.info('导航点击:', item);
  // TODO: 处理不同的导航项
};

// 用户操作
const handleUserAction = (key) => {
  logger.info('用户操作:', key);
  // TODO: 处理用户操作（设置、退出等）
};

// 提交消息
const handleSubmitMessage = async ({ text, attachments }) => {
  if (!text.trim()) {
    antMessage.warning('请输入消息内容');
    return;
  }

  // 确保有活动对话
  if (!activeConversationId.value) {
    await handleNewConversation();
  }

  // 添加用户消息
  const userMessage = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now(),
  };
  messages.value.push(userMessage);

  // 滚动到底部
  await nextTick();
  scrollToBottom();

  // 保存用户消息到数据库
  try {
    await window.electronAPI.conversation.addMessage(activeConversationId.value, {
      role: 'user',
      content: text,
    });
  } catch (error) {
    logger.error('保存消息失败:', error);
  }

  // 开始AI思考
  isThinking.value = true;

  try {
    // 调用LLM API
    const response = await window.electronAPI.llm.chat({
      conversationId: activeConversationId.value,
      message: text,
      attachments: attachments,
    });

    // 添加AI响应
    const assistantMessage = {
      id: `msg-${Date.now()}-ai`,
      role: 'assistant',
      content: response.content,
      timestamp: Date.now(),
      steps: response.steps || [],
      preview: response.preview || null,
    };
    messages.value.push(assistantMessage);

    // 保存AI消息到数据库
    await window.electronAPI.conversation.addMessage(activeConversationId.value, {
      role: 'assistant',
      content: response.content,
      steps: response.steps,
      preview: response.preview,
    });

    // 更新对话标题（如果是第一条消息）
    const conversation = conversations.value.find(c => c.id === activeConversationId.value);
    if (conversation && conversation.title === '新对话') {
      const newTitle = text.substring(0, 30) + (text.length > 30 ? '...' : '');
      conversation.title = newTitle;
      await window.electronAPI.conversation.update(activeConversationId.value, {
        title: newTitle,
      });
    }

    // 滚动到底部
    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error('AI响应失败:', error);
    antMessage.error('AI响应失败: ' + error.message);

    // 添加错误消息
    messages.value.push({
      id: `msg-${Date.now()}-error`,
      role: 'assistant',
      content: '抱歉，我遇到了一些问题，无法完成你的请求。请稍后重试。',
      timestamp: Date.now(),
    });
  } finally {
    isThinking.value = false;
  }
};

// 处理文件上传
const handleFileUpload = (files) => {
  logger.info('上传文件:', files);
  // TODO: 处理文件上传
};

// 处理步骤重试
const handleStepRetry = (step) => {
  logger.info('重试步骤:', step);
  // TODO: 实现步骤重试
};

// 处理步骤取消
const handleStepCancel = (step) => {
  logger.info('取消步骤:', step);
  // TODO: 实现步骤取消
};

// 滚动到底部
const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop = messagesContainerRef.value.scrollHeight;
  }
};

// 配置 marked
marked.setOptions({
  highlight: function(code, lang) {
    // highlight.js 会在 EnhancedCodeBlock 中处理
    return code;
  },
  breaks: true,
  gfm: true,
});

// 自定义 marked renderer 来增强代码块
const renderer = new marked.Renderer();
const originalCodeRenderer = renderer.code.bind(renderer);

renderer.code = function(code, language) {
  // 为代码块添加特殊标记，以便后续处理
  const escapedCode = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return `<div class="code-block-wrapper" data-language="${language || ''}" data-code="${escapedCode}">
    <div class="code-block-placeholder">
      <pre><code class="language-${language || 'plaintext'}">${escapedCode}</code></pre>
    </div>
  </div>`;
};

marked.use({ renderer });

// 渲染Markdown（使用 marked 库）
const renderMarkdown = (content) => {
  if (!content) {return '';}

  try {
    // 使用 marked 解析 markdown - marked 会自动转义 HTML 标签
    const rawHtml = marked.parse(content);
    return rawHtml;
  } catch (error) {
    logger.error('Markdown 渲染失败:', error);
    // 发生错误时，转义文本以防止 XSS
    const div = document.createElement('div');
    div.textContent = content;
    return div.innerHTML;
  }
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return '';}
  const date = new Date(timestamp);
  const now = new Date();

  // 如果是今天，只显示时间
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // 否则显示日期和时间
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 增强代码块功能（添加复制按钮）
const enhanceCodeBlocks = () => {
  nextTick(() => {
    const codeBlocks = document.querySelectorAll('.code-block-wrapper');

    codeBlocks.forEach((wrapper) => {
      // 如果已经添加过按钮，跳过
      if (wrapper.querySelector('.code-copy-btn')) {return;}

      const code = wrapper.getAttribute('data-code');
      if (!code) {return;}

      // 创建复制按钮
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.textContent = '复制';
      copyBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          // 解码HTML实体
          const decodedCode = code
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

          await navigator.clipboard.writeText(decodedCode);
          copyBtn.textContent = '✓ 已复制';
          setTimeout(() => {
            copyBtn.textContent = '复制';
          }, 2000);
        } catch (err) {
          logger.error('复制失败:', err);
          copyBtn.textContent = '✗ 失败';
          setTimeout(() => {
            copyBtn.textContent = '复制';
          }, 2000);
        }
      };

      wrapper.appendChild(copyBtn);
    });
  });
};

// 组件挂载时加载数据
onMounted(async () => {
  await loadConversations();
  enhanceCodeBlocks();
});

// 监听消息变化，自动滚动并增强代码块
watch(() => messages.value.length, () => {
  nextTick(() => {
    scrollToBottom();
    enhanceCodeBlocks();
  });
});
</script>

<style scoped lang="scss">
.ai-chat-page {
  height: 100vh;
  display: flex;
  overflow: hidden;
  background: #F5F7FA;
}

.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conversation-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: white;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  scroll-behavior: smooth;

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
}

// 欢迎消息
.welcome-message {
  max-width: 700px;
  margin: 80px auto;
  text-align: center;

  .welcome-icon {
    font-size: 80px;
    color: #667EEA;
    margin-bottom: 24px;
  }

  h2 {
    font-size: 28px;
    font-weight: 600;
    color: #1F2937;
    margin: 0 0 16px 0;
  }

  p {
    font-size: 16px;
    color: #6B7280;
    margin: 0 0 24px 0;
  }

  .welcome-hint {
    font-size: 14px;
    color: #9CA3AF;
    margin-top: 32px;
  }
}

.welcome-features {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin: 24px 0;
}

.feature-tag {
  padding: 8px 16px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: 20px;
  font-size: 14px;
  color: #667EEA;
  font-weight: 500;
}

// 消息项
.message-item {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
}

.message-wrapper {
  display: flex;
  gap: 12px;
  max-width: 100%;
}

.message-avatar {
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  min-width: 0;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.message-author {
  font-size: 14px;
  font-weight: 600;
  color: #1F2937;
}

.message-time {
  font-size: 12px;
  color: #9CA3AF;
}

.message-text {
  font-size: 15px;
  line-height: 1.6;
  color: #374151;
  word-wrap: break-word;

  /* 行内代码 */
  :deep(code) {
    background: #F3F4F6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    font-size: 13px;
    color: #DC2626;
  }

  /* 增强的代码块容器 */
  :deep(.code-block-wrapper) {
    position: relative;
    margin: 12px 0;
    border: 1px solid #374151;
    border-radius: 8px;
    overflow: hidden;
    background: #1F2937;
    transition: all 0.2s ease;
  }

  :deep(.code-block-wrapper:hover) {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  /* 语言标签 */
  :deep(.code-block-wrapper::before) {
    content: attr(data-language);
    position: absolute;
    top: 8px;
    right: 12px;
    padding: 3px 10px;
    background: rgba(255, 255, 255, 0.1);
    color: #9CA3AF;
    font-size: 11px;
    text-transform: uppercase;
    border-radius: 4px;
    z-index: 2;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  /* 复制按钮（通过JavaScript添加） */
  :deep(.code-copy-btn) {
    position: absolute;
    top: 8px;
    right: 80px;
    padding: 4px 12px;
    background: rgba(255, 255, 255, 0.1);
    color: #9CA3AF;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    z-index: 2;
    opacity: 0;
    transition: all 0.2s ease;
  }

  :deep(.code-block-wrapper:hover .code-copy-btn) {
    opacity: 1;
  }

  :deep(.code-copy-btn:hover) {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  :deep(pre) {
    background: #1F2937;
    padding: 40px 16px 16px 16px;
    border-radius: 0;
    overflow-x: auto;
    margin: 0;
    position: relative;

    code {
      background: transparent;
      color: #E5E7EB;
      padding: 0;
      font-size: 14px;
      line-height: 1.8;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    }
  }

  :deep(a) {
    color: #667EEA;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(strong) {
    font-weight: 600;
    color: #1F2937;
  }
}

// 用户消息样式
.message-user {
  .message-text {
    background: #F9FAFB;
    padding: 12px 16px;
    border-radius: 12px;
    display: inline-block;
    max-width: 100%;
  }
}

// AI消息步骤
.message-steps {
  margin-top: 16px;
}

// AI消息预览
.message-preview {
  margin-top: 16px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #E5E7EB;
}

// 思考指示器
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #F9FAFB;
  border-radius: 12px;
  color: #6B7280;
  font-size: 14px;

  .anticon {
    color: #667EEA;
  }
}

// 输入容器
.input-container {
  padding: 16px 24px;
  border-top: 1px solid #E5E7EB;
  background: #FFFFFF;
}
</style>
