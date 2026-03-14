<template>
  <div class="ai-chat-page">
    <!-- 右侧：主内容区 -->
    <div class="main-container">
      <!-- 对话内容区 -->
      <div class="conversation-content">
        <!-- 消息列表 -->
        <div ref="messagesContainerRef" class="messages-container">
          <!-- 对话操作栏 -->
          <div v-if="messages.length > 0" class="conversation-actions">
            <a-button
              type="text"
              size="small"
              :loading="savingConversation"
              @click="handleSaveConversation"
            >
              <template #icon>
                <BookOutlined />
              </template>
              保存对话到记忆
            </a-button>
          </div>

          <!-- 欢迎消息 -->
          <div v-if="messages.length === 0" class="welcome-message">
            <div class="welcome-icon">
              <RobotOutlined />
            </div>
            <h2>你好！我是 ChainlessChain AI 助手</h2>
            <p>我可以帮你完成各种任务，比如：</p>
            <div class="welcome-features">
              <div class="feature-tag">💻 代码编写与调试</div>
              <div class="feature-tag">📄 文档生成与编辑</div>
              <div class="feature-tag">📊 数据分析与可视化</div>
              <div class="feature-tag">🌐 网页开发与设计</div>
            </div>
            <p class="welcome-hint">
              输入你的需求开始对话，或使用 @ 来引用知识库和文件
            </p>
            <p class="welcome-hint shortcut-hint">
              <span class="shortcut-key">Ctrl+Shift+M</span> 保存消息到记忆 |
              <span class="shortcut-key">Ctrl+Shift+S</span> 保存对话
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
            <div v-if="message.role === 'user'" class="message-wrapper">
              <div class="message-avatar">
                <a-avatar :src="userAvatar" :size="36">
                  <template #icon>
                    <UserOutlined />
                  </template>
                </a-avatar>
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-author">{{ userName || "你" }}</span>
                  <span class="message-time">{{
                    formatTime(message.timestamp)
                  }}</span>
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
                  style="
                    background: linear-gradient(
                      135deg,
                      #667eea 0%,
                      #764ba2 100%
                    );
                  "
                >
                  <RobotOutlined />
                </a-avatar>
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-author">AI 助手</span>
                  <span class="message-time">{{
                    formatTime(message.timestamp)
                  }}</span>
                  <a-dropdown :trigger="['click']" class="save-memory-dropdown">
                    <a-button
                      type="text"
                      size="small"
                      class="save-memory-btn"
                      :class="{ saved: message.savedToMemory }"
                    >
                      <template #icon>
                        <CheckOutlined v-if="message.savedToMemory" />
                        <BookOutlined v-else />
                      </template>
                      <span class="btn-text">{{
                        message.savedToMemory ? "已保存" : "保存记忆"
                      }}</span>
                    </a-button>
                    <template #overlay>
                      <a-menu
                        @click="(e) => handleSaveToMemory(message, e.key)"
                      >
                        <a-menu-item key="daily">
                          <SaveOutlined /> 保存到 Daily Notes
                        </a-menu-item>
                        <a-menu-item key="discovery">
                          <BookOutlined /> 保存为技术发现
                        </a-menu-item>
                        <a-menu-item key="solution">
                          <BookOutlined /> 保存为解决方案
                        </a-menu-item>
                      </a-menu>
                    </template>
                  </a-dropdown>
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
                    :default-expanded="
                      step.status === 'running' || step.status === 'failed'
                    "
                    @retry="handleStepRetry"
                    @cancel="handleStepCancel"
                  />
                </div>

                <!-- 预览内容 -->
                <div v-if="message.preview" class="message-preview">
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
          <div v-if="isThinking" class="message-item message-assistant">
            <div class="message-wrapper">
              <div class="message-avatar">
                <a-avatar
                  :size="36"
                  style="
                    background: linear-gradient(
                      135deg,
                      #667eea 0%,
                      #764ba2 100%
                    );
                  "
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
          <div class="input-toolbar">
            <a-tooltip
              :title="
                agentMode
                  ? 'Agent Mode ON — AI can use tools autonomously'
                  : 'Agent Mode OFF — regular chat'
              "
            >
              <a-button
                :type="agentMode ? 'primary' : 'default'"
                size="small"
                @click="toggleAgentMode"
              >
                <template #icon>
                  <RobotOutlined />
                </template>
                Agent
              </a-button>
            </a-tooltip>
          </div>
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

    <!-- 重命名对话框 -->
    <a-modal
      v-model:open="renameModalVisible"
      title="重命名对话"
      @ok="handleRenameConfirm"
      @cancel="handleRenameCancel"
    >
      <a-input
        v-model:value="newConversationTitle"
        placeholder="输入新的对话标题"
        @press-enter="handleRenameConfirm"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { useAuthStore } from "@/stores/auth";
import {
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
  BookOutlined,
  SaveOutlined,
  CheckOutlined,
} from "@ant-design/icons-vue";
import ConversationInput from "@/components/projects/ConversationInput.vue";
import BrowserPreview from "@/components/projects/BrowserPreview.vue";
import StepDisplay from "@/components/projects/StepDisplay.vue";
import { marked } from "marked";

const authStore = useAuthStore();

// 响应式状态
const conversations = ref([]);
const activeConversationId = ref("");
const messages = ref([]);
const isThinking = ref(false);
const messagesContainerRef = ref(null);
const inputRef = ref(null);
const savingConversation = ref(false);

// Agent mode state
const agentMode = ref(false);

const toggleAgentMode = () => {
  agentMode.value = !agentMode.value;
  antMessage.info(
    agentMode.value ? "Agent Mode ON — AI can use tools" : "Agent Mode OFF",
  );
};

// 重命名对话相关状态
const renameModalVisible = ref(false);
const renameConversation = ref(null);
const newConversationTitle = ref("");

// 用户信息
const userName = computed(() => authStore.currentUser?.username || "用户");
const userAvatar = computed(() => authStore.currentUser?.avatar || "");

// 输入框占位符
const inputPlaceholder = computed(() => {
  if (isThinking.value) {
    return "AI 正在思考中，请稍候...";
  }
  return "给我发消息或描述你的任务...";
});

// 加载对话列表
const loadConversations = async () => {
  // 检查 API 是否可用
  if (!window.electronAPI?.conversation?.list) {
    conversations.value = [];
    return;
  }

  try {
    // 从数据库加载对话列表
    const data = await window.electronAPI.conversation.list();
    conversations.value = (data || []).map((conv) => ({
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
    // IPC 未就绪时静默处理
    if (error.message?.includes("No handler registered")) {
      conversations.value = [];
      return;
    }
    logger.error("[AIChatPage] 加载对话列表失败:", error);
    antMessage.error("加载对话列表失败");
  }
};

// 加载对话消息
const loadConversationMessages = async (conversationId) => {
  try {
    const data =
      await window.electronAPI.conversation.getMessages(conversationId);
    messages.value = data.map((msg) => ({
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
    logger.error("加载对话消息失败:", error);
    antMessage.error("加载对话消息失败");
  }
};

// 新建对话
const handleNewConversation = async () => {
  try {
    const conversation = await window.electronAPI.conversation.create({
      title: "新对话",
    });

    conversations.value.unshift({
      id: conversation.id,
      title: conversation.title,
      updated_at: Date.now(),
      is_starred: false,
    });

    activeConversationId.value = conversation.id;
    messages.value = [];

    antMessage.success("创建新对话成功");
  } catch (error) {
    logger.error("创建对话失败:", error);
    antMessage.error("创建对话失败");
  }
};

// 点击对话
const handleConversationClick = async (conversation) => {
  if (activeConversationId.value === conversation.id) {
    return;
  }

  activeConversationId.value = conversation.id;
  await loadConversationMessages(conversation.id);
};

// 对话操作
const handleConversationAction = async ({ action, conversation }) => {
  switch (action) {
    case "rename":
      renameConversation.value = conversation;
      newConversationTitle.value = conversation.title;
      renameModalVisible.value = true;
      break;
    case "star":
      try {
        await window.electronAPI.conversation.toggleStar(conversation.id);
        conversation.is_starred = !conversation.is_starred;
      } catch (error) {
        antMessage.error("操作失败");
      }
      break;
    case "delete":
      try {
        await window.electronAPI.conversation.delete(conversation.id);
        conversations.value = conversations.value.filter(
          (c) => c.id !== conversation.id,
        );
        if (activeConversationId.value === conversation.id) {
          activeConversationId.value = conversations.value[0]?.id || "";
          if (activeConversationId.value) {
            await loadConversationMessages(activeConversationId.value);
          } else {
            messages.value = [];
          }
        }
        antMessage.success("删除对话成功");
      } catch (error) {
        antMessage.error("删除对话失败");
      }
      break;
  }
};

// 导航点击
const handleNavClick = (item) => {
  logger.info("导航点击:", item);
  // 处理不同的导航项
  if (item.route) {
    // 如果有路由，跳转到对应页面
    window.location.hash = item.route;
  } else if (item.action) {
    // 执行指定的动作
    switch (item.action) {
      case "newChat":
        handleNewConversation();
        break;
      case "settings":
        window.location.hash = "#/settings";
        break;
      case "help":
        window.location.hash = "#/help";
        break;
      default:
        logger.warn("未处理的导航动作:", item.action);
    }
  }
};

// 用户操作
const handleUserAction = (key) => {
  logger.info("用户操作:", key);
  // 处理用户操作
  switch (key) {
    case "settings":
      window.location.hash = "#/settings";
      break;
    case "profile":
      window.location.hash = "#/profile";
      break;
    case "logout":
      authStore.logout();
      window.location.hash = "#/login";
      break;
    case "help":
      window.location.hash = "#/help";
      break;
    default:
      logger.warn("未处理的用户操作:", key);
  }
};

// 提交消息
const handleSubmitMessage = async ({ text, attachments }) => {
  if (!text.trim()) {
    antMessage.warning("请输入消息内容");
    return;
  }

  // 确保有活动对话
  if (!activeConversationId.value) {
    await handleNewConversation();
  }

  // 添加用户消息
  const userMessage = {
    id: `msg-${Date.now()}`,
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
  messages.value.push(userMessage);

  // 滚动到底部
  await nextTick();
  scrollToBottom();

  // 保存用户消息到数据库
  try {
    await window.electronAPI.conversation.addMessage(
      activeConversationId.value,
      {
        role: "user",
        content: text,
      },
    );
  } catch (error) {
    logger.error("保存消息失败:", error);
  }

  // 开始AI思考
  isThinking.value = true;

  try {
    let response;

    if (agentMode.value && window.electronAPI?.conversation?.agentChat) {
      // Agent mode — tool-use loop via conversation:agent-chat
      const conversationHistory = messages.value
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));

      response = await window.electronAPI.conversation.agentChat({
        conversationId: activeConversationId.value,
        userMessage: text,
        conversationHistory,
      });

      if (!response.success) {
        throw new Error(response.error || "Agent chat failed");
      }
      response = { content: response.content, steps: [], preview: null };
    } else {
      // Regular chat
      response = await window.electronAPI.llm.chat({
        conversationId: activeConversationId.value,
        message: text,
        attachments: attachments,
      });
    }

    // 添加AI响应
    const assistantMessage = {
      id: `msg-${Date.now()}-ai`,
      role: "assistant",
      content: response.content,
      timestamp: Date.now(),
      steps: response.steps || [],
      preview: response.preview || null,
    };
    messages.value.push(assistantMessage);

    // 保存AI消息到数据库
    await window.electronAPI.conversation.addMessage(
      activeConversationId.value,
      {
        role: "assistant",
        content: response.content,
        steps: response.steps,
        preview: response.preview,
      },
    );

    // 更新对话标题（如果是第一条消息）
    const conversation = conversations.value.find(
      (c) => c.id === activeConversationId.value,
    );
    if (conversation && conversation.title === "新对话") {
      const newTitle = text.substring(0, 30) + (text.length > 30 ? "..." : "");
      conversation.title = newTitle;
      await window.electronAPI.conversation.update(activeConversationId.value, {
        title: newTitle,
      });
    }

    // 滚动到底部
    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error("AI响应失败:", error);
    antMessage.error("AI响应失败: " + error.message);

    // 添加错误消息
    messages.value.push({
      id: `msg-${Date.now()}-error`,
      role: "assistant",
      content: "抱歉，我遇到了一些问题，无法完成你的请求。请稍后重试。",
      timestamp: Date.now(),
    });
  } finally {
    isThinking.value = false;
  }
};

// 处理文件上传
const handleFileUpload = async (files) => {
  logger.info("上传文件:", files);

  if (!files || files.length === 0) {
    return;
  }

  // 验证文件
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = [
    "image/",
    "text/",
    "application/pdf",
    "application/json",
    "application/javascript",
  ];

  for (const file of files) {
    // 检查文件大小
    if (file.size > maxSize) {
      antMessage.warning(`文件 ${file.name} 过大，请选择小于 10MB 的文件`);
      continue;
    }

    // 检查文件类型
    const isAllowed = allowedTypes.some((type) => file.type.startsWith(type));
    if (!isAllowed && file.type) {
      antMessage.warning(`不支持的文件类型: ${file.type}`);
      continue;
    }

    // 读取文件内容
    try {
      if (file.type.startsWith("image/")) {
        // 图片文件：转为 base64
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target.result;
          antMessage.success(`图片 ${file.name} 已添加`);
          // 可以将 base64 数据存储起来供后续使用
          logger.info(`图片已加载: ${file.name}, 大小: ${base64.length} bytes`);
        };
        reader.readAsDataURL(file);
      } else {
        // 文本文件：读取内容
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target.result;
          antMessage.success(`文件 ${file.name} 已添加`);
          logger.info(`文件已加载: ${file.name}, 内容长度: ${content.length}`);
        };
        reader.readAsText(file);
      }
    } catch (error) {
      logger.error("读取文件失败:", error);
      antMessage.error(`读取文件 ${file.name} 失败`);
    }
  }
};

// 处理步骤重试
const handleStepRetry = async (step) => {
  logger.info("重试步骤:", step);

  if (!step || !step.action) {
    antMessage.warning("无法重试该步骤");
    return;
  }

  try {
    isThinking.value = true;

    // 重新执行步骤
    const response = await window.electronAPI.llm.retryStep({
      conversationId: activeConversationId.value,
      step: step,
    });

    if (response?.success) {
      // 更新步骤状态
      step.status = "completed";
      step.result = response.result;
      antMessage.success("步骤重试成功");
    } else {
      step.status = "failed";
      step.error = response?.error || "重试失败";
      antMessage.error("步骤重试失败: " + (response?.error || "未知错误"));
    }
  } catch (error) {
    logger.error("重试步骤失败:", error);
    step.status = "failed";
    step.error = error.message;
    antMessage.error("重试失败: " + error.message);
  } finally {
    isThinking.value = false;
  }
};

// 处理步骤取消
const handleStepCancel = async (step) => {
  logger.info("取消步骤:", step);

  if (!step) {
    return;
  }

  try {
    // 如果步骤正在执行，尝试取消
    if (step.status === "running" || step.status === "pending") {
      const response = await window.electronAPI.llm.cancelStep({
        conversationId: activeConversationId.value,
        stepId: step.id,
      });

      if (response?.success) {
        step.status = "cancelled";
        antMessage.info("步骤已取消");
      } else {
        antMessage.warning("无法取消该步骤");
      }
    } else {
      // 步骤已完成，只是标记为跳过
      step.status = "skipped";
      antMessage.info("步骤已跳过");
    }
  } catch (error) {
    logger.error("取消步骤失败:", error);
    antMessage.error("取消失败: " + error.message);
  }
};

// 保存整个对话到记忆
const handleSaveConversation = async () => {
  if (messages.value.length === 0) {
    antMessage.warning("对话为空，无法保存");
    return;
  }

  try {
    savingConversation.value = true;

    if (!window.electronAPI?.invoke) {
      antMessage.warning("IPC 未就绪，无法保存");
      return;
    }

    // 获取对话标题
    const conversation = conversations.value.find(
      (c) => c.id === activeConversationId.value,
    );
    const title = conversation?.title || "对话记录";

    // 调用 IPC 提取并保存对话
    const result = await window.electronAPI.invoke(
      "memory:extract-from-conversation",
      {
        messages: messages.value.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        conversationTitle: title,
      },
    );

    if (result?.success) {
      antMessage.success(
        `已保存到 Daily Notes (${result.result.messageCount} 条消息)`,
      );
    } else {
      antMessage.error(result?.error || "保存失败");
    }
  } catch (error) {
    logger.error("[AIChatPage] 保存对话失败:", error);
    antMessage.error("保存失败: " + error.message);
  } finally {
    savingConversation.value = false;
  }
};

// 保存到永久记忆
const handleSaveToMemory = async (message, type) => {
  if (message.savedToMemory) {
    antMessage.info("该消息已保存到记忆");
    return;
  }

  try {
    // 构建要保存的内容
    const content = message.content;

    // 调用 IPC 保存
    if (!window.electronAPI?.invoke) {
      antMessage.warning("IPC 未就绪，无法保存");
      return;
    }

    const result = await window.electronAPI.invoke("memory:save-to-memory", {
      content,
      type,
    });

    if (result?.success) {
      message.savedToMemory = true;
      const locationText =
        result.result.savedTo === "daily_notes"
          ? "Daily Notes"
          : `MEMORY.md (${result.result.section})`;
      antMessage.success(`已保存到 ${locationText}`);
    } else {
      antMessage.error(result?.error || "保存失败");
    }
  } catch (error) {
    logger.error("[AIChatPage] 保存到记忆失败:", error);
    antMessage.error("保存失败: " + error.message);
  }
};

// 确认重命名对话
const handleRenameConfirm = async () => {
  if (!newConversationTitle.value.trim()) {
    antMessage.warning("请输入对话标题");
    return;
  }

  try {
    await window.electronAPI.conversation.update(renameConversation.value.id, {
      title: newConversationTitle.value.trim(),
    });

    // 更新本地状态
    const conv = conversations.value.find(
      (c) => c.id === renameConversation.value.id,
    );
    if (conv) {
      conv.title = newConversationTitle.value.trim();
    }

    renameModalVisible.value = false;
    renameConversation.value = null;
    newConversationTitle.value = "";

    antMessage.success("重命名成功");
  } catch (error) {
    logger.error("重命名对话失败:", error);
    antMessage.error("重命名失败: " + error.message);
  }
};

// 取消重命名
const handleRenameCancel = () => {
  renameModalVisible.value = false;
  renameConversation.value = null;
  newConversationTitle.value = "";
};

// 滚动到底部
const scrollToBottom = () => {
  if (messagesContainerRef.value) {
    messagesContainerRef.value.scrollTop =
      messagesContainerRef.value.scrollHeight;
  }
};

// 配置 marked
marked.setOptions({
  highlight: function (code, lang) {
    // highlight.js 会在 EnhancedCodeBlock 中处理
    return code;
  },
  breaks: true,
  gfm: true,
});

// 自定义 marked renderer 来增强代码块
const renderer = new marked.Renderer();
const originalCodeRenderer = renderer.code.bind(renderer);

renderer.code = function (code, language) {
  // 为代码块添加特殊标记，以便后续处理
  const escapedCode = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  return `<div class="code-block-wrapper" data-language="${language || ""}" data-code="${escapedCode}">
    <div class="code-block-placeholder">
      <pre><code class="language-${language || "plaintext"}">${escapedCode}</code></pre>
    </div>
  </div>`;
};

marked.use({ renderer });

// 渲染Markdown（使用 marked 库）
const renderMarkdown = (content) => {
  if (!content) {
    return "";
  }

  try {
    // 使用 marked 解析 markdown - marked 会自动转义 HTML 标签
    const rawHtml = marked.parse(content);
    return rawHtml;
  } catch (error) {
    logger.error("Markdown 渲染失败:", error);
    // 发生错误时，转义文本以防止 XSS
    const div = document.createElement("div");
    div.textContent = content;
    return div.innerHTML;
  }
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const now = new Date();

  // 如果是今天，只显示时间
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // 否则显示日期和时间
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// 增强代码块功能（添加复制按钮）
const enhanceCodeBlocks = () => {
  nextTick(() => {
    const codeBlocks = document.querySelectorAll(".code-block-wrapper");

    codeBlocks.forEach((wrapper) => {
      // 如果已经添加过按钮，跳过
      if (wrapper.querySelector(".code-copy-btn")) {
        return;
      }

      const code = wrapper.getAttribute("data-code");
      if (!code) {
        return;
      }

      // 创建复制按钮
      const copyBtn = document.createElement("button");
      copyBtn.className = "code-copy-btn";
      copyBtn.textContent = "复制";
      copyBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          // 解码HTML实体
          const decodedCode = code
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

          await navigator.clipboard.writeText(decodedCode);
          copyBtn.textContent = "✓ 已复制";
          setTimeout(() => {
            copyBtn.textContent = "复制";
          }, 2000);
        } catch (err) {
          logger.error("复制失败:", err);
          copyBtn.textContent = "✗ 失败";
          setTimeout(() => {
            copyBtn.textContent = "复制";
          }, 2000);
        }
      };

      wrapper.appendChild(copyBtn);
    });
  });
};

// 键盘快捷键处理
const handleKeyboard = (e) => {
  // Ctrl+Shift+M: 保存最后一条 AI 消息到记忆
  if (e.ctrlKey && e.shiftKey && e.key === "M") {
    e.preventDefault();
    const lastAiMessage = [...messages.value]
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastAiMessage && !lastAiMessage.savedToMemory) {
      handleSaveToMemory(lastAiMessage, "daily");
    } else if (lastAiMessage?.savedToMemory) {
      antMessage.info("该消息已保存到记忆");
    } else {
      antMessage.warning("没有可保存的 AI 消息");
    }
  }

  // Ctrl+Shift+S: 保存整个对话到记忆
  if (e.ctrlKey && e.shiftKey && e.key === "S") {
    e.preventDefault();
    if (messages.value.length > 0) {
      handleSaveConversation();
    }
  }
};

// 组件挂载时加载数据
onMounted(async () => {
  await loadConversations();
  enhanceCodeBlocks();

  // 注册键盘快捷键
  window.addEventListener("keydown", handleKeyboard);

  // 检查是否有待插入的文本（来自音频转录等功能）
  const pendingText = localStorage.getItem("pendingInsertText");
  if (pendingText) {
    try {
      const data = JSON.parse(pendingText);
      // 检查是否过期（5分钟内有效）
      if (Date.now() - data.timestamp < 5 * 60 * 1000) {
        nextTick(() => {
          if (inputRef.value) {
            inputRef.value.setText(data.text);
          }
        });
      }
      // 无论是否过期，都清除
      localStorage.removeItem("pendingInsertText");
    } catch (e) {
      localStorage.removeItem("pendingInsertText");
    }
  }
});

// 组件卸载时清理
onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyboard);
});

// 监听消息变化，自动滚动并增强代码块
watch(
  () => messages.value.length,
  () => {
    nextTick(() => {
      scrollToBottom();
      enhanceCodeBlocks();
    });
  },
);

// 暴露给测试使用
defineExpose({
  // 状态
  conversations,
  activeConversationId,
  messages,
  isThinking,
  messagesContainerRef,
  inputRef,
  savingConversation,
  renameModalVisible,
  renameConversation,
  newConversationTitle,
  // 计算属性
  userName,
  userAvatar,
  inputPlaceholder,
  // 方法
  loadConversations,
  loadConversationMessages,
  handleNewConversation,
  handleConversationClick,
  handleConversationAction,
  handleSubmitMessage,
  handleFileUpload,
  handleNavClick,
  handleStepRetry,
  handleStepCancel,
  handleUserAction,
  renderMarkdown,
  formatTime,
  scrollToBottom,
  enhanceCodeBlocks,
});
</script>

<style scoped lang="scss">
.ai-chat-page {
  height: 100vh;
  display: flex;
  overflow: hidden;
  background: #f5f7fa;
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
    background: #d1d5db;
    border-radius: 4px;

    &:hover {
      background: #9ca3af;
    }
  }
}

// 对话操作栏
.conversation-actions {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0;
  margin-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;

  :deep(.ant-btn) {
    color: #9ca3af;

    &:hover {
      color: #667eea;
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
    color: #667eea;
    margin-bottom: 24px;
  }

  h2 {
    font-size: 28px;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 16px 0;
  }

  p {
    font-size: 16px;
    color: #6b7280;
    margin: 0 0 24px 0;
  }

  .welcome-hint {
    font-size: 14px;
    color: #9ca3af;
    margin-top: 32px;

    &.shortcut-hint {
      margin-top: 16px;
      font-size: 12px;
    }
  }

  .shortcut-key {
    display: inline-block;
    padding: 2px 6px;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    font-family: monospace;
    font-size: 11px;
    color: #6b7280;
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
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.1) 0%,
    rgba(118, 75, 162, 0.1) 100%
  );
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: 20px;
  font-size: 14px;
  color: #667eea;
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
  color: #1f2937;
}

.message-time {
  font-size: 12px;
  color: #9ca3af;
}

.save-memory-dropdown {
  margin-left: auto;
}

.save-memory-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
  font-size: 12px;
  color: #9ca3af;

  &:hover {
    color: #667eea;
  }

  &.saved {
    opacity: 1;
    color: #52c41a;
  }

  .btn-text {
    margin-left: 4px;
  }
}

.message-wrapper:hover .save-memory-btn {
  opacity: 1;
}

.message-text {
  font-size: 15px;
  line-height: 1.6;
  color: #374151;
  word-wrap: break-word;

  /* 行内代码 */
  :deep(code) {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: "Courier New", monospace;
    font-size: 13px;
    color: #dc2626;
  }

  /* 增强的代码块容器 */
  :deep(.code-block-wrapper) {
    position: relative;
    margin: 12px 0;
    border: 1px solid #374151;
    border-radius: 8px;
    overflow: hidden;
    background: #1f2937;
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
    color: #9ca3af;
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
    color: #9ca3af;
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
    background: #1f2937;
    padding: 40px 16px 16px 16px;
    border-radius: 0;
    overflow-x: auto;
    margin: 0;
    position: relative;

    code {
      background: transparent;
      color: #e5e7eb;
      padding: 0;
      font-size: 14px;
      line-height: 1.8;
      font-family: "Consolas", "Monaco", "Courier New", monospace;
    }
  }

  :deep(a) {
    color: #667eea;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(strong) {
    font-weight: 600;
    color: #1f2937;
  }
}

// 用户消息样式
.message-user {
  .message-text {
    background: #f9fafb;
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
  border: 1px solid #e5e7eb;
}

// 思考指示器
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 12px;
  color: #6b7280;
  font-size: 14px;

  .anticon {
    color: #667eea;
  }
}

// 输入容器
.input-container {
  padding: 16px 24px;
  border-top: 1px solid #e5e7eb;
  background: #ffffff;
}

.input-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
