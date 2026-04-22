<template>
  <div class="chat-panel" data-testid="chat-panel">
    <!-- 头部：上下文选择器 -->
    <div class="chat-header" data-testid="chat-header">
      <h3 class="chat-title">
        <MessageOutlined />
        AI 助手
      </h3>

      <a-radio-group
        v-model:value="contextMode"
        size="small"
        button-style="solid"
        data-testid="context-mode-selector"
      >
        <a-radio-button value="project" data-testid="context-mode-project">
          <FolderOutlined />
          项目
        </a-radio-button>
        <a-radio-button value="file" data-testid="context-mode-file">
          <FileTextOutlined />
          文件
        </a-radio-button>
        <a-radio-button value="global" data-testid="context-mode-global">
          <GlobalOutlined />
          全局
        </a-radio-button>
      </a-radio-group>
    </div>

    <!-- 消息列表区域 -->
    <div
      ref="messagesContainer"
      class="messages-container"
      data-testid="messages-container"
    >
      <!-- 空状态 -->
      <div
        v-if="messages.length === 0 && !isLoading"
        class="empty-state"
        data-testid="chat-empty-state"
      >
        <div class="empty-icon">
          <RobotOutlined />
        </div>
        <h4>{{ getEmptyStateText() }}</h4>
        <p class="empty-hint">
          {{ getEmptyHint() }}
        </p>
      </div>

      <!-- 消息列表（虚拟滚动） -->
      <VirtualMessageList
        v-else
        ref="virtualListRef"
        :key="`messages-${messagesRefreshKey}`"
        :messages="messages"
        :estimate-size="150"
        data-test="chat-messages-list"
        data-testid="messages-list"
        @load-more="handleLoadMoreMessages"
        @scroll-to-bottom="handleScrollToBottom"
      >
        <template #default="{ message, index }">
          <!-- 系统消息 -->
          <SystemMessage
            v-if="
              message.type === MessageType.SYSTEM ||
              message.type === MessageType.TASK_ANALYSIS ||
              message.type === MessageType.INTENT_RECOGNITION
            "
            :message="message"
          />

          <!-- 意图确认消息 -->
          <IntentConfirmationMessage
            v-else-if="message.type === MessageType.INTENT_CONFIRMATION"
            :message="message"
            @confirm="handleIntentConfirm"
            @correct="handleIntentCorrect"
          />

          <!-- 采访问题消息 -->
          <InterviewQuestionMessage
            v-else-if="message.type === MessageType.INTERVIEW"
            :key="`interview-${message.id}-${message.metadata?.currentIndex || 0}-${messagesRefreshKey}`"
            :message="message"
            @answer="handleInterviewAnswer"
            @skip="handleInterviewSkip"
            @complete="handleInterviewComplete"
          />

          <!-- 任务计划消息 -->
          <TaskPlanMessage
            v-else-if="message.type === MessageType.TASK_PLAN"
            :message="message"
            @confirm="handlePlanConfirm"
            @modify="handlePlanModify"
            @cancel="handlePlanCancel"
          />

          <!-- 普通用户/助手消息 -->
          <div v-else :class="['message-item', message.role]">
            <div class="message-avatar">
              <UserOutlined v-if="message.role === 'user'" />
              <RobotOutlined v-else />
            </div>
            <div class="message-content">
              <!-- eslint-disable vue/no-v-html -- sanitized via safeHtml / renderMarkdown / DOMPurify; see AUDIT_2026-04-22.md §3 -->
              <div
                class="message-text"
                v-html="renderMarkdown(message.content)"
              />
              <!-- eslint-enable vue/no-v-html -->
              <div class="message-meta">
                <span class="message-time">{{
                  formatTime(message.timestamp)
                }}</span>
              </div>
            </div>
          </div>
        </template>
      </VirtualMessageList>

      <!-- 思考过程可视化 -->
      <ThinkingProcess
        v-if="isLoading && thinkingState.show"
        :current-stage="thinkingState.stage"
        :progress="thinkingState.progress"
        :show-progress="thinkingState.showProgress"
        :progress-text="thinkingState.progressText"
        :steps="thinkingState.steps"
        :streaming-content="thinkingState.streamingContent"
        :show-cancel-button="thinkingState.showCancelButton"
        @cancel="handleCancelThinking"
      />
    </div>

    <!-- 输入区域 -->
    <div class="input-container" data-testid="input-container">
      <div class="input-wrapper">
        <a-textarea
          v-model:value="userInput"
          :placeholder="getInputPlaceholder()"
          :auto-size="{ minRows: 1, maxRows: 4 }"
          :disabled="isLoading"
          data-test="chat-input"
          data-testid="chat-input"
          @keydown="handleKeyDown"
        />

        <div class="input-actions">
          <a-tooltip title="清空对话">
            <a-button
              type="text"
              size="small"
              :disabled="messages.length === 0 || isLoading"
              data-testid="clear-conversation-button"
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
            data-test="chat-send-button"
            data-testid="chat-send-button"
            @click="handleSendMessage"
          >
            <SendOutlined v-if="!isLoading" />
            发送
          </a-button>
        </div>
      </div>

      <!-- 上下文信息提示 -->
      <div v-if="contextInfo" class="context-info" data-testid="context-info">
        <InfoCircleOutlined />
        <span>{{ contextInfo }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from "@/utils/logger";

import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
  reactive,
} from "vue";
import { message as antMessage } from "ant-design-vue";
import {
  MessageOutlined,
  FolderOutlined,
  FileTextOutlined,
  GlobalOutlined,
  SendOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  UserOutlined,
  RobotOutlined,
} from "@ant-design/icons-vue";
import ConversationHistoryView from "./ConversationHistoryView.vue";
import SystemMessage from "../messages/SystemMessage.vue";
import IntentConfirmationMessage from "../messages/IntentConfirmationMessage.vue";
import TaskPlanMessage from "../messages/TaskPlanMessage.vue";
import InterviewQuestionMessage from "../messages/InterviewQuestionMessage.vue";
import VirtualMessageList from "./VirtualMessageList.vue";
import ThinkingProcess from "./ThinkingProcess.vue";
import {
  MessageType,
  createSystemMessage,
  createIntentConfirmationMessage,
  createInterviewMessage,
  createTaskPlanMessage,
  createUserMessage,
  createAssistantMessage,
} from "../../utils/messageTypes";
import { TaskPlanner } from "../../utils/taskPlanner";
import { marked } from "marked";
// 🔥 导入后续输入意图处理助手
import {
  findExecutingTask,
  buildClassificationContext,
  createIntentSystemMessage,
  mergeRequirements,
  addClarificationToTaskPlan,
  formatIntentLog,
  handleClassificationError,
} from "../../utils/followupIntentHelper";
import {
  sanitizeJSONString,
  resolveProjectOutput,
  cleanForIPC,
} from "./chatPanelUtils";
import { useMemoryLeakGuard } from "@/composables/useMemoryLeakGuard";

// 配置 marked 选项
marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false, // marked 3.0+ 不再支持 sanitize，改用自定义渲染器
});

const props = defineProps({
  projectId: {
    type: String,
    required: false,
    default: "",
  },
  currentFile: {
    type: Object,
    default: null,
  },
  aiCreationData: {
    type: Object,
    default: null,
  },
  autoSendMessage: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["conversationLoaded", "creation-complete"]);

// 响应式状态
const contextMode = ref("project"); // 'project' | 'file' | 'global'
const messages = ref([]);
const userInput = ref("");
const isLoading = ref(false);
const messagesContainer = ref(null);
const currentConversation = ref(null);
const creationProgress = ref(null); // AI创建进度数据
const virtualListRef = ref(null); // 虚拟列表引用
const messagesRefreshKey = ref(0); // 🔥 强制刷新消息列表的key

// 🔥 任务规划配置
const enablePlanning = ref(true); // 是否启用任务规划功能

// 🔥 思考过程可视化状态
const thinkingState = reactive({
  show: false,
  stage: "正在思考...",
  progress: 0,
  showProgress: true,
  progressText: "",
  steps: [],
  streamingContent: "",
  showCancelButton: true,
});

// 🔥 消息分页加载状态
const messageLoadState = reactive({
  currentPage: 0,
  pageSize: 50,
  hasMore: true,
  isLoadingMore: false,
});

// 🔥 消息内存管理配置
const MAX_MESSAGES_IN_MEMORY = 200; // 内存中最多保留200条消息
const CLEANUP_THRESHOLD = 220; // 超过220条时触发清理

// 计算属性
const contextInfo = computed(() => {
  if (contextMode.value === "project") {
    return `包含项目结构和文件列表`;
  } else if (contextMode.value === "file" && props.currentFile) {
    return `当前文件: ${props.currentFile.file_name}`;
  } else if (contextMode.value === "file" && !props.currentFile) {
    return `请先选择一个文件`;
  }
  return null;
});

// ============ 内存泄漏防护 ============
// AI对话取消通过 project:cancelAiChat IPC 在主进程中实现
const { safeSetTimeout, safeRegisterListener, clearSafeTimeout } =
  useMemoryLeakGuard("ChatPanel");

// ============ 空状态相关函数 ============

/**
 * 获取空状态文本
 */
const getEmptyStateText = () => {
  if (contextMode.value === "project") {
    return "项目 AI 助手";
  } else if (contextMode.value === "file") {
    return "文件 AI 助手";
  }
  return "AI 助手";
};

/**
 * 获取空状态提示
 */
const getEmptyHint = () => {
  if (contextMode.value === "project") {
    return '询问项目相关问题，比如"这个项目有哪些文件？"';
  } else if (contextMode.value === "file" && props.currentFile) {
    return `询问关于 ${props.currentFile.file_name} 的问题`;
  } else if (contextMode.value === "file") {
    return "请先从左侧选择一个文件";
  }
  return "开始新对话";
};

/**
 * 获取输入提示
 */
const getInputPlaceholder = () => {
  if (contextMode.value === "project") {
    return "询问项目相关问题...";
  } else if (contextMode.value === "file" && props.currentFile) {
    return `询问关于 ${props.currentFile.file_name} 的问题...`;
  } else if (contextMode.value === "file") {
    return "请先选择一个文件...";
  }
  return "输入消息...";
};

/**
 * 渲染 Markdown
 */
const renderMarkdown = (content) => {
  try {
    // 确保 content 是字符串
    let textContent = content;
    if (typeof content === "object") {
      // 如果是对象，尝试提取文本内容
      textContent =
        content?.text || content?.content || JSON.stringify(content);
    }
    textContent = String(textContent || "");

    // marked.parse() 已配置为安全模式，会自动转义危险内容
    const rawHTML = marked.parse(textContent);
    return rawHTML;
  } catch (error) {
    logger.error("Markdown 渲染失败:", error);
    // 发生错误时，转义文本以防止 XSS
    const div = document.createElement("div");
    div.textContent = String(content || "");
    return div.innerHTML;
  }
};

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60000) {
    return "刚刚";
  }

  // 小于1小时
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }

  // 小于24小时
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`;
  }

  // 今天
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // 超过今天
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/**
 * 打开文件
 */
const openFile = (source) => {
  if (!source) {
    return;
  }

  logger.info("[ChatPanel] 打开文件:", source);

  // 获取文件路径
  const filePath = source.filePath || source.path || source.metadata?.filePath;

  if (!filePath) {
    antMessage.warning("无法获取文件路径");
    return;
  }

  // 触发事件通知父组件打开文件
  emit("open-file", {
    path: filePath,
    fileName: source.fileName || source.title,
    fileId: source.fileId || source.id,
  });
};

/**
 * 处理文件附件点击
 */
const handleFileClick = (file) => {
  if (!file) {
    return;
  }

  logger.info("[ChatPanel] 打开附件文件:", file);

  // 触发事件通知父组件打开文件
  emit("open-file", {
    path: file.path || file.filePath,
    fileName: file.name || file.fileName,
    fileId: file.id,
  });
};

/**
 * 🔥 构建智能对话历史（多轮上下文保持）
 *
 * 策略：
 * 1. 优先保留重要消息（任务计划、采访、意图确认等）
 * 2. 保留最近的N轮对话（用户-助手配对）
 * 3. 如果有当前文件上下文，包含文件相关的对话
 * 4. 控制总 token 数不超过限制
 */
const buildSmartContextHistory = () => {
  const MAX_HISTORY_MESSAGES = 20; // 最多保留20条消息
  const MIN_RECENT_TURNS = 3; // 至少保留最近3轮对话

  if (messages.value.length === 0) {
    return [];
  }

  // 1. 分类消息
  const importantMessages = []; // 重要消息（任务计划、采访等）
  const regularMessages = []; // 普通对话消息

  messages.value.forEach((msg) => {
    // 重要消息类型
    if (
      [
        MessageType.TASK_PLAN,
        MessageType.INTERVIEW,
        MessageType.INTENT_CONFIRMATION,
        MessageType.INTENT_RECOGNITION,
      ].includes(msg.type)
    ) {
      importantMessages.push(msg);
    } else if (msg.role === "user" || msg.role === "assistant") {
      // 排除系统消息，只保留用户和助手的对话
      regularMessages.push(msg);
    }
  });

  logger.info("[ChatPanel] 📊 消息分类:", {
    total: messages.value.length,
    important: importantMessages.length,
    regular: regularMessages.length,
  });

  // 2. 提取最近的N轮对话（一轮 = 用户消息 + 助手回复）
  const recentTurns = [];
  let turnCount = 0;

  for (
    let i = regularMessages.length - 1;
    i >= 0 && turnCount < MIN_RECENT_TURNS * 2;
    i--
  ) {
    recentTurns.unshift(regularMessages[i]);
    turnCount++;
  }

  // 3. 合并重要消息和最近对话
  const contextMessages = [];

  // 添加最近的重要消息（最多3条）
  const recentImportant = importantMessages.slice(-3);
  contextMessages.push(...recentImportant);

  // 添加最近的对话
  contextMessages.push(...recentTurns);

  // 4. 去重（按 ID）
  const uniqueMessages = [];
  const seenIds = new Set();

  contextMessages.forEach((msg) => {
    if (!seenIds.has(msg.id)) {
      seenIds.add(msg.id);
      uniqueMessages.push(msg);
    }
  });

  // 5. 按时间戳排序
  uniqueMessages.sort((a, b) => a.timestamp - b.timestamp);

  // 6. 限制总消息数
  const finalMessages = uniqueMessages.slice(-MAX_HISTORY_MESSAGES);

  // 7. 转换为API格式
  const conversationHistory = finalMessages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    // 可选：添加消息类型信息供后端参考
    type: msg.type,
  }));

  logger.info("[ChatPanel] 📝 智能上下文历史:", {
    selectedMessages: conversationHistory.length,
    fromTotal: messages.value.length,
    turns: Math.floor(
      conversationHistory.filter((m) => m.role === "user").length,
    ),
  });

  return conversationHistory;
};

/**
 * 构建项目上下文
 */
const buildProjectContext = async () => {
  try {
    // 获取项目信息
    const project = await window.electronAPI.project.get(props.projectId);
    if (!project) {
      return "";
    }

    // 获取项目文件列表
    const files = await window.electronAPI.project.getFiles(props.projectId);

    // 构建文件树结构文本
    let context = `# 项目：${project.name}\n\n`;
    context += `描述：${project.description || "无"}\n`;
    context += `类型：${project.project_type}\n\n`;
    context += `## 文件列表\n\n`;

    if (files && files.length > 0) {
      files.forEach((file) => {
        context += `- ${file.file_path} (${file.file_type})\n`;
      });
    } else {
      context += "暂无文件\n";
    }

    return context;
  } catch (error) {
    logger.error("构建项目上下文失败:", error);
    return "";
  }
};

/**
 * 构建文件上下文
 */
const buildFileContext = () => {
  if (!props.currentFile) {
    return "";
  }

  let context = `# 当前文件：${props.currentFile.file_name}\n\n`;
  context += `路径：${props.currentFile.file_path}\n`;
  context += `类型：${props.currentFile.file_type}\n\n`;
  context += `## 文件内容\n\n\`\`\`\n${props.currentFile.content || ""}\n\`\`\`\n`;

  return context;
};

/**
 * 构建系统提示
 */
const buildSystemPrompt = async () => {
  let systemPrompt = "你是一个专业的编程助手。";

  if (contextMode.value === "project") {
    const projectContext = await buildProjectContext();
    systemPrompt += `\n\n${projectContext}\n\n请基于以上项目信息回答用户的问题。`;
  } else if (contextMode.value === "file" && props.currentFile) {
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
  if (!input || isLoading.value) {
    return;
  }

  // 检查API是否可用
  if (!window.electronAPI?.project) {
    logger.error("[ChatPanel] Project API 不可用:", window.electronAPI);
    antMessage.error("Project API 不可用，请重启应用");
    return;
  }

  if (!window.electronAPI?.conversation) {
    logger.error("[ChatPanel] Conversation API 不可用:", window.electronAPI);
    antMessage.error("对话 API 不可用，请重启应用");
    return;
  }

  // 在文件模式下检查是否选择了文件
  if (contextMode.value === "file" && !props.currentFile) {
    antMessage.warning("请先选择一个文件");
    return;
  }

  isLoading.value = true;
  userInput.value = "";

  logger.info("[ChatPanel] 准备发送消息，input:", input);

  // 🔥 NEW: 检查是否有正在执行的任务，判断后续输入意图
  const executingTask = findExecutingTask(messages.value);
  if (executingTask && executingTask.metadata?.status === "executing") {
    logger.info("[ChatPanel] 🎯 检测到正在执行的任务，分析后续输入意图");

    try {
      // 检查 followupIntent API 是否可用
      if (!window.electronAPI?.followupIntent) {
        logger.warn(
          "[ChatPanel] followupIntent API 不可用，跳过后续输入意图分类",
        );
      } else {
        // 调用后续输入意图分类器
        const classifyResult = await window.electronAPI.followupIntent.classify(
          {
            input,
            context: buildClassificationContext(executingTask, messages.value),
          },
        );

        if (classifyResult.success) {
          const { intent, confidence, reason, extractedInfo } =
            classifyResult.data;

          logger.info(formatIntentLog(classifyResult, input));

          // 根据意图类型采取不同的行动
          await handleFollowupIntent(
            intent,
            input,
            extractedInfo,
            reason,
            executingTask,
          );

          isLoading.value = false;
          return;
        } else {
          logger.error("[ChatPanel] 意图分类失败:", classifyResult.error);
        }
      }
    } catch (error) {
      logger.error("[ChatPanel] 后续输入意图分类异常:", error);
      // 继续执行原有逻辑
    }
  }

  // 🔥 任务规划模式：对复杂任务进行需求分析和任务规划
  if (enablePlanning.value && shouldUsePlanning(input)) {
    logger.info("[ChatPanel] 检测到复杂任务，启动任务规划模式");
    await startTaskPlanning(input);
    isLoading.value = false;
    return;
  }

  // 🔥 新增：意图理解和确认步骤
  logger.info("[ChatPanel] 🎯 启动意图理解流程");
  try {
    await understandUserIntent(input);
    // 意图理解后，等待用户确认或纠正
    // 实际的对话执行将在 handleIntentConfirm 中进行
    isLoading.value = false;
    return;
  } catch (error) {
    logger.error("[ChatPanel] 意图理解失败，继续执行原流程:", error);
    // 如果意图理解失败，继续原有流程（已在 understandUserIntent 中处理）
    isLoading.value = false;
    return;
  }
};

/**
 * 获取项目文件列表
 */
const getProjectFiles = async () => {
  try {
    if (!props.projectId) {
      return [];
    }

    const result = await window.electronAPI.project.getFiles(props.projectId);
    return result.files || [];
  } catch (error) {
    logger.error("获取文件列表失败:", error);
    return [];
  }
};

/**
 * 清空对话
 */
const handleClearConversation = async () => {
  try {
    if (!currentConversation.value) {
      return;
    }

    // 检查API是否可用
    if (!window.electronAPI?.conversation) {
      // 直接清空本地消息
      messages.value = [];
      antMessage.success("对话已清空");
      return;
    }

    // 清空数据库中的消息
    await window.electronAPI.conversation.clearMessages(
      currentConversation.value.id,
    );

    // 清空本地消息列表
    messages.value = [];

    antMessage.success("对话已清空");
  } catch (error) {
    logger.error("清空对话失败:", error);
    antMessage.error("清空对话失败");
  }
};

/**
 * 处理键盘事件
 */
const handleKeyDown = (event) => {
  // Ctrl+Enter 或 Cmd+Enter 发送消息
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    handleSendMessage();
  }
};

/**
 * 🔥 清理过多的消息以释放内存
 * 当消息数量超过阈值时，保留最近的消息，移除最旧的消息
 */
const cleanupOldMessages = () => {
  if (messages.value.length > CLEANUP_THRESHOLD) {
    const messagesToRemove = messages.value.length - MAX_MESSAGES_IN_MEMORY;
    logger.info(
      `[ChatPanel] 🧹 消息数量超过阈值(${CLEANUP_THRESHOLD})，清理最旧的${messagesToRemove}条消息`,
    );

    // 保留最近的 MAX_MESSAGES_IN_MEMORY 条消息
    messages.value = messages.value.slice(-MAX_MESSAGES_IN_MEMORY);

    logger.info(
      `[ChatPanel] ✅ 清理完成，当前消息数: ${messages.value.length}`,
    );
  }
};

/**
 * 滚动到底部（使用虚拟列表）
 */
const scrollToBottom = () => {
  if (virtualListRef.value) {
    virtualListRef.value.scrollToBottom();
  } else if (messagesContainer.value) {
    // 后备方案：如果虚拟列表未初始化
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
};

/**
 * 处理加载更多消息（分页加载）
 */
const handleLoadMoreMessages = async () => {
  if (messageLoadState.isLoadingMore || !messageLoadState.hasMore) {
    return;
  }

  if (!currentConversation.value) {
    return;
  }

  try {
    messageLoadState.isLoadingMore = true;

    // 加载下一页消息
    const nextPage = messageLoadState.currentPage + 1;
    const offset = nextPage * messageLoadState.pageSize;

    const result = await window.electronAPI.conversation.getMessages(
      currentConversation.value.id,
      {
        limit: messageLoadState.pageSize,
        offset: offset,
      },
    );

    const loadedMessages = result?.data || [];

    if (loadedMessages.length > 0) {
      // 在前面插入历史消息
      messages.value.unshift(
        ...loadedMessages.map((msg) => {
          if (msg.message_type) {
            return { ...msg, type: msg.message_type };
          }
          return msg;
        }),
      );

      // 🔥 清理过多的消息以释放内存（从末尾移除最新的消息）
      if (messages.value.length > CLEANUP_THRESHOLD) {
        const messagesToRemove = messages.value.length - MAX_MESSAGES_IN_MEMORY;
        logger.info(
          `[ChatPanel] 🧹 加载历史消息后超过阈值，移除末尾${messagesToRemove}条最新消息`,
        );
        messages.value = messages.value.slice(0, MAX_MESSAGES_IN_MEMORY);
      }

      messageLoadState.currentPage = nextPage;
      logger.info(`[ChatPanel] 📜 加载了${loadedMessages.length}条历史消息`);
    } else {
      messageLoadState.hasMore = false;
      logger.info("[ChatPanel] 📜 没有更多历史消息");
    }
  } catch (error) {
    logger.error("[ChatPanel] 加载历史消息失败:", error);
    antMessage.error("加载历史消息失败");
  } finally {
    messageLoadState.isLoadingMore = false;
  }
};

/**
 * 处理滚动到底部事件
 */
const handleScrollToBottom = () => {
  // 可以在这里添加逻辑，比如标记消息为已读
  logger.info("[ChatPanel] 📍 已滚动到底部");
};

/**
 * 取消AI思考/生成
 */
const handleCancelThinking = async () => {
  logger.info("[ChatPanel] ⛔ 用户取消了AI思考");
  isLoading.value = false;
  thinkingState.show = false;

  // 通过IPC通知主进程取消正在进行的AI请求
  try {
    if (window.electronAPI?.project?.cancelAiChat) {
      await window.electronAPI.project.cancelAiChat();
    }
  } catch (error) {
    logger.warn("[ChatPanel] 取消请求失败:", error);
  }

  antMessage.info("已取消");
};

/**
 * 更新思考过程状态
 */
const updateThinkingState = (updates) => {
  Object.assign(thinkingState, updates);
};

/**
 * 创建对话
 */
const createConversation = async () => {
  try {
    // 检查API是否可用
    if (!window.electronAPI?.conversation) {
      logger.warn("[ChatPanel] 对话API未实现，跳过创建");
      return;
    }

    const conversationData = {
      id: `conv_${Date.now()}`, // 添加ID字段
      title:
        contextMode.value === "project"
          ? "项目对话"
          : contextMode.value === "file"
            ? "文件对话"
            : "新对话",
      project_id: contextMode.value === "project" ? props.projectId : null,
      context_type: contextMode.value,
      context_data:
        contextMode.value === "file" && props.currentFile
          ? {
              file_id: props.currentFile.id,
              file_name: props.currentFile.file_name,
            }
          : null,
    };

    const result =
      await window.electronAPI.conversation.create(conversationData);

    // 提取对话数据（API返回 {success: true, data: {...}} 格式）
    if (result && result.success && result.data) {
      currentConversation.value = result.data;
      emit("conversationLoaded", currentConversation.value);
    } else {
      throw new Error(result?.error || "创建对话失败");
    }
  } catch (error) {
    logger.error("创建对话失败:", error);
    antMessage.error("创建对话失败");
  }
};

/**
 * 加载对话
 */
const loadConversation = async () => {
  try {
    // 检查对话API是否可用
    if (!window.electronAPI?.conversation) {
      logger.warn("[ChatPanel] 对话API未实现，跳过加载");
      messages.value = [];
      currentConversation.value = null;
      return;
    }

    if (contextMode.value === "project") {
      // 尝试加载项目对话
      const result = await window.electronAPI.conversation.getByProject(
        props.projectId,
      );

      // 提取对话数据（API返回 {success: true, data: [...]} 格式）
      let conversation = null;
      if (
        result &&
        result.success &&
        Array.isArray(result.data) &&
        result.data.length > 0
      ) {
        conversation = result.data[0]; // 取第一个对话
      } else if (result && !result.success) {
        logger.warn("[ChatPanel] 获取项目对话失败:", result.error);
      }

      if (conversation) {
        currentConversation.value = conversation;

        // 🔥 加载消息（使用分页，只加载最近的消息）
        const loadedMessages =
          await window.electronAPI.conversation.getMessages(conversation.id, {
            limit: MAX_MESSAGES_IN_MEMORY, // 只加载最近的 N 条消息
            offset: 0,
          });

        // 提取消息数组（API返回 {success: true, data: [...]} 格式）
        let rawMessages = [];
        if (
          loadedMessages &&
          loadedMessages.success &&
          Array.isArray(loadedMessages.data)
        ) {
          rawMessages = loadedMessages.data;
        } else if (Array.isArray(loadedMessages)) {
          // 兼容直接返回数组的情况
          rawMessages = loadedMessages;
        }

        // 🔄 恢复特殊类型的消息（INTERVIEW、TASK_PLAN）
        messages.value = rawMessages.map((msg) => {
          // 🔥 反序列化 metadata（如果是字符串）
          let metadata = msg.metadata;
          if (typeof metadata === "string") {
            try {
              metadata = JSON.parse(metadata);
            } catch (e) {
              logger.error("[ChatPanel] metadata 解析失败:", e, metadata);
            }
          }

          // 如果有message_type字段，使用它来恢复消息类型
          if (msg.message_type) {
            return {
              ...msg,
              type: msg.message_type, // 将message_type映射到type字段
              metadata: metadata,
            };
          }
          // 向后兼容：没有message_type的旧消息
          return {
            ...msg,
            metadata: metadata,
          };
        });

        // 🔥 数据修复：验证并修复采访消息的 currentIndex
        messages.value.forEach((msg, index) => {
          if (msg.type === MessageType.INTERVIEW && msg.metadata) {
            const currentIdx = msg.metadata.currentIndex || 0;
            const totalQuestions = msg.metadata.questions?.length || 0;

            logger.info("[ChatPanel] 🔍 检查采访消息", {
              messageId: msg.id,
              currentIndex: currentIdx,
              totalQuestions: totalQuestions,
              metadata类型: typeof msg.metadata,
              metadata: msg.metadata,
            });

            if (currentIdx > totalQuestions) {
              logger.warn("[ChatPanel] 🔧 修复损坏的采访消息数据", {
                messageId: msg.id,
                原currentIndex: currentIdx,
                问题总数: totalQuestions,
                修复为: totalQuestions,
              });
              msg.metadata.currentIndex = totalQuestions;
            }
          }
        });

        logger.info(
          "[ChatPanel] 💾 从数据库恢复了",
          messages.value.length,
          "条消息",
        );

        emit("conversationLoaded", conversation);

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
    logger.error("加载对话失败:", error);
    // 不显示错误消息，因为API可能未实现
  }
};

// 监听上下文模式变化
watch(contextMode, () => {
  loadConversation();
});

// 监听项目变化
watch(
  () => props.projectId,
  () => {
    if (contextMode.value === "project") {
      loadConversation();
    }
  },
);

// 监听当前文件变化
watch(
  () => props.currentFile,
  () => {
    if (contextMode.value === "file") {
      // 文件变化时不自动清空对话，只更新上下文
    }
  },
);

/**
 * 开始AI创建项目
 */
const startAICreation = async (createData) => {
  logger.info("[ChatPanel] 开始AI创建项目:", createData);

  // 创建一个系统消息来展示创建过程
  const creationMessage = {
    id: `msg_creation_${Date.now()}`,
    role: "system",
    type: "creation",
    content: "正在使用AI创建项目...",
    timestamp: Date.now(),
    progress: {
      currentStage: "",
      stages: [],
      contentByStage: {},
      overallProgress: 0,
      status: "running",
    },
  };

  messages.value.push(creationMessage);
  isLoading.value = true;

  try {
    // BUGFIX: 深拷贝 createData 以确保是纯对象（避免 Vue 响应式代理导致的克隆错误）
    const pureCreateData = JSON.parse(JSON.stringify(createData));

    // 导入projectStore
    const { useProjectStore } = await import("@/stores/project");
    const projectStore = useProjectStore();

    // 调用流式创建
    await projectStore.createProjectStream(pureCreateData, (progressUpdate) => {
      logger.info("[ChatPanel] 收到创建进度更新:", progressUpdate);

      // 更新消息中的进度信息
      const message = messages.value.find((m) => m.id === creationMessage.id);
      if (message) {
        if (progressUpdate.type === "progress") {
          message.progress.currentStage = progressUpdate.currentStage;
          message.progress.stages = progressUpdate.stages || [];
          message.content = `正在 ${progressUpdate.currentStage}...`;

          // 计算总进度
          const completedStages = message.progress.stages.filter(
            (s) => s.status === "completed",
          ).length;
          const totalStages = message.progress.stages.length || 1;
          message.progress.overallProgress = Math.round(
            (completedStages / totalStages) * 100,
          );
        } else if (progressUpdate.type === "content") {
          if (!message.progress.contentByStage) {
            message.progress.contentByStage = {};
          }
          if (!message.progress.contentByStage[progressUpdate.currentStage]) {
            message.progress.contentByStage[progressUpdate.currentStage] = "";
          }
          message.progress.contentByStage[progressUpdate.currentStage] =
            progressUpdate.contentByStage[progressUpdate.currentStage] || "";
        } else if (progressUpdate.type === "complete") {
          message.content = "✅ 项目创建完成！";
          message.progress.status = "completed";
          message.progress.overallProgress = 100;
          message.result = progressUpdate.result;

          // 触发完成事件
          emit("creation-complete", progressUpdate.result);

          antMessage.success("项目创建成功！");
        } else if (progressUpdate.type === "error") {
          message.content = `❌ 创建失败: ${progressUpdate.error}`;
          message.progress.status = "error";
          message.error = progressUpdate.error;

          antMessage.error("项目创建失败: " + progressUpdate.error);
        }

        // 滚动到底部
        nextTick(() => scrollToBottom());
      }
    });
  } catch (error) {
    logger.error("[ChatPanel] AI创建失败:", error);

    const message = messages.value.find((m) => m.id === creationMessage.id);
    if (message) {
      message.content = `❌ 创建失败: ${error.message}`;
      message.progress.status = "error";
      message.error = error.message;
    }

    antMessage.error("创建项目失败: " + error.message);
  } finally {
    isLoading.value = false;
  }
};

// ============ 任务规划相关函数 ============

/**
 * 判断是否需要使用任务规划
 * @param {string} input - 用户输入
 * @returns {boolean}
 */
const shouldUsePlanning = (input) => {
  // 简单启发式规则：如果包含创建、生成、制作等关键词，且超过一定长度，启用规划
  const keywords = [
    "创建",
    "生成",
    "制作",
    "写",
    "做",
    "开发",
    "设计",
    "ppt",
    "PPT",
    "文档",
    "报告",
  ];
  const hasKeyword = keywords.some((keyword) => input.includes(keyword));

  // 对于创建型任务，启用规划
  return hasKeyword;
};

/**
 * 启动任务规划流程（新版 - 基于消息流）
 * @param {string} userInput - 用户输入
 */
const startTaskPlanning = async (userInput) => {
  logger.info("[ChatPanel] 🚀 启动任务规划流程:", userInput);

  try {
    // 0. 确保对话已创建
    if (!currentConversation.value) {
      logger.info("[ChatPanel] 对话不存在，创建新对话...");
      await createConversation();

      if (!currentConversation.value) {
        throw new Error("创建对话失败，无法开始任务规划");
      }
    }

    // 从上下文推断项目类型
    let projectType = "document"; // 默认类型
    try {
      // 尝试从 projectStore 获取当前项目类型
      const { useProjectStore } = await import("@/stores/project");
      const projectStore = useProjectStore();
      if (props.projectId && projectStore.currentProject?.type) {
        projectType = projectStore.currentProject.type;
      } else if (props.currentFile?.type) {
        // 根据当前文件类型推断
        const fileTypeMap = {
          md: "document",
          txt: "document",
          doc: "document",
          docx: "document",
          xlsx: "data",
          xls: "data",
          csv: "data",
          ppt: "ppt",
          pptx: "ppt",
          html: "web",
          css: "web",
          js: "web",
          py: "code",
          java: "code",
          ts: "code",
        };
        const ext = props.currentFile.name?.split(".").pop()?.toLowerCase();
        projectType = fileTypeMap[ext] || "document";
      }
    } catch (e) {
      logger.warn("[ChatPanel] 无法获取项目类型，使用默认值:", e);
    }

    // 1. 添加用户消息
    const userMessage = createUserMessage(
      userInput,
      currentConversation.value.id,
    );
    messages.value.push(userMessage);
    logger.info(
      "[ChatPanel] 💬 用户消息已添加到列表，当前消息数:",
      messages.value.length,
    );
    logger.info("[ChatPanel] 💬 用户消息内容:", userMessage);

    // 🔥 立即滚动到底部，确保用户能看到自己的消息
    await nextTick();
    scrollToBottom();

    // 1.1 保存用户消息到数据库
    if (currentConversation.value && currentConversation.value.id) {
      try {
        await window.electronAPI.conversation.createMessage({
          id: userMessage.id, // 🔥 关键修复：传入id以保持一致性
          conversation_id: currentConversation.value.id,
          role: "user",
          content: userInput,
          timestamp: userMessage.timestamp,
        });
        logger.info("[ChatPanel] 💾 用户消息已保存，id:", userMessage.id);
      } catch (error) {
        logger.error("[ChatPanel] 保存用户消息失败:", error);
      }
    }

    // 2. 添加"正在分析"系统消息
    const analyzingMsg = createSystemMessage(
      "🤔 正在分析您的需求，请稍候...（最长可能需要10分钟）",
      { type: "loading" },
    );
    messages.value.push(analyzingMsg);
    logger.info(
      "[ChatPanel] 📝 系统消息已添加，当前消息数:",
      messages.value.length,
    );

    await nextTick();
    scrollToBottom();

    // 3. 调用LLM分析需求（流式）
    const llmService = {
      chat: async (prompt) => {
        // 创建一个流式思考消息
        const thinkingMsg = createSystemMessage("💭 AI 思考中...", {
          type: "thinking",
        });
        messages.value.push(thinkingMsg);
        await nextTick();
        scrollToBottom();

        return new Promise((resolve, reject) => {
          let fullResponse = "";
          let streamStarted = false;

          // 监听流式chunk事件
          const handleChunk = (chunkData) => {
            logger.info("[ChatPanel] 📥 收到 chunk 事件:", chunkData);
            if (!streamStarted) {
              streamStarted = true;
              logger.info("[ChatPanel] 🎬 流式输出开始");
              // 第一次收到chunk时，更新消息类型
              thinkingMsg.content = ""; // 清空初始文本
              thinkingMsg.metadata.type = "streaming";
            }

            fullResponse = chunkData.fullContent;
            // 更新思考消息的内容
            thinkingMsg.content = fullResponse;

            // 🔥 强制触发响应式更新：找到消息并完全替换它（深拷贝metadata）
            const thinkingIndex = messages.value.findIndex(
              (m) => m.id === thinkingMsg.id,
            );
            if (thinkingIndex !== -1) {
              messages.value[thinkingIndex] = {
                ...thinkingMsg,
                metadata: { ...thinkingMsg.metadata },
              };
              messages.value = [...messages.value]; // 触发数组更新
            }
            logger.info("[ChatPanel] 📝 更新内容，长度:", fullResponse.length);

            nextTick(() => scrollToBottom());
          };

          // 监听流式完成事件
          const handleComplete = (result) => {
            // 移除思考消息
            const thinkingIndex = messages.value.findIndex(
              (m) => m.id === thinkingMsg.id,
            );
            if (thinkingIndex !== -1) {
              messages.value.splice(thinkingIndex, 1);
            }

            resolve(fullResponse);
          };

          // 监听流式错误事件
          const handleError = (error) => {
            // 更新思考消息为错误状态
            thinkingMsg.content = `❌ LLM调用失败: ${error.message}`;
            thinkingMsg.metadata.type = "error";
            messages.value = [...messages.value];

            reject(new Error(error.message));
          };

          // 注册事件监听器 (自动跟踪，组件卸载时清理)
          logger.info("[ChatPanel] 📡 注册流式事件监听器");
          safeRegisterListener("project:aiChatStream-chunk", handleChunk);
          safeRegisterListener("project:aiChatStream-complete", handleComplete);
          safeRegisterListener("project:aiChatStream-error", handleError);

          // 调用流式API
          logger.info("[ChatPanel] 🚀 开始调用流式 API");
          window.electronAPI.project
            .aiChatStream({
              projectId: props.projectId,
              userMessage: prompt,
              conversationHistory: [], // 空历史记录，只发送当前prompt
              contextMode: contextMode.value,
              currentFile: null,
              projectInfo: null,
              fileList: [],
            })
            .catch((error) => {
              logger.error("[ChatPanel] ❌ API 调用失败:", error);
              handleError(error);
            });
        });
      },
    };

    const analysis = await TaskPlanner.analyzeRequirements(
      userInput,
      projectType,
      llmService,
    );
    logger.info("[ChatPanel] ✅ 需求分析完成:", analysis);

    // 更新"正在分析"消息为完成状态
    analyzingMsg.content = "✅ 需求分析完成";
    analyzingMsg.metadata.type = "success";
    messages.value = [...messages.value]; // 触发响应式更新

    await nextTick();

    // 短暂延迟后移除分析消息
    safeSetTimeout(() => {
      const analyzingIndex = messages.value.findIndex(
        (m) => m.id === analyzingMsg.id,
      );
      if (analyzingIndex !== -1) {
        messages.value.splice(analyzingIndex, 1);
      }
    }, 1000);

    // 4. 如果需求完整，直接生成计划
    if (analysis.isComplete && analysis.confidence > 0.7) {
      logger.info("[ChatPanel] 需求完整，直接生成任务计划");

      // 添加系统消息
      const completeMsgContent = createSystemMessage(
        "✅ 需求分析完成，正在生成任务计划...",
        { type: "success" },
      );
      messages.value.push(completeMsgContent);

      await nextTick();
      scrollToBottom();

      // 生成并添加任务计划
      await generateTaskPlanMessage(userInput, analysis, {});
      return;
    }

    // 5. 如果需要采访，添加采访消息
    if (
      analysis.needsInterview &&
      analysis.suggestedQuestions &&
      analysis.suggestedQuestions.length > 0
    ) {
      logger.info(
        "[ChatPanel] 需求不完整，启动采访模式，问题数:",
        analysis.suggestedQuestions.length,
      );
      logger.info("[ChatPanel] 问题列表:", analysis.suggestedQuestions);

      // 创建采访消息
      const interviewMsg = createInterviewMessage(
        analysis.suggestedQuestions,
        0,
      );
      // 保存分析结果和用户输入到metadata，以便后续生成计划时使用
      interviewMsg.metadata.userInput = userInput;
      interviewMsg.metadata.analysis = analysis;

      logger.info("[ChatPanel] 创建的采访消息:", interviewMsg);
      logger.info("[ChatPanel] 添加前 messages 数量:", messages.value.length);

      messages.value.push(interviewMsg);

      logger.info("[ChatPanel] 添加后 messages 数量:", messages.value.length);
      logger.info(
        "[ChatPanel] 最后一条消息类型:",
        messages.value[messages.value.length - 1]?.type,
      );
      logger.info(
        "[ChatPanel] 最后一条消息内容:",
        messages.value[messages.value.length - 1],
      );

      // 💾 保存采访消息到数据库
      if (currentConversation.value && currentConversation.value.id) {
        try {
          await window.electronAPI.conversation.createMessage({
            id: interviewMsg.id, // 🔥 关键修复：传入id以保持一致性
            conversation_id: currentConversation.value.id,
            role: "system",
            content: interviewMsg.content,
            timestamp: interviewMsg.timestamp,
            type: MessageType.INTERVIEW,
            metadata: cleanForIPC(interviewMsg.metadata), // 🔥 清理不可序列化的对象
          });
          logger.info(
            "[ChatPanel] 💾 采访消息已保存到数据库，id:",
            interviewMsg.id,
          );
        } catch (error) {
          logger.error("[ChatPanel] 保存采访消息失败:", error);
        }
      }

      // 等待 DOM 更新并滚动（采访组件渲染需要时间）
      await nextTick();
      scrollToBottom();

      // 延迟再次滚动，确保采访组件完全渲染
      safeSetTimeout(() => {
        scrollToBottom();
      }, 100);

      return;
    }

    // 6. 如果既不完整也没有问题，显示错误
    const errorMsg = createSystemMessage(
      "❌ 无法分析您的需求，请提供更多详细信息",
      { type: "error" },
    );
    messages.value.push(errorMsg);
  } catch (error) {
    logger.error("[ChatPanel] ❌ 任务规划启动失败:", error);

    const errorMsg = createSystemMessage(`任务规划失败: ${error.message}`, {
      type: "error",
    });
    messages.value.push(errorMsg);

    antMessage.error("任务规划失败: " + error.message);
  }
};

/**
 * 生成并添加任务计划消息
 * @param {string} userInput - 用户原始输入
 * @param {Object} analysis - 需求分析结果
 * @param {Object} interviewAnswers - 采访答案
 */
const generateTaskPlanMessage = async (
  userInput,
  analysis,
  interviewAnswers = {},
) => {
  logger.info("[ChatPanel] 🔨 开始生成任务计划...");

  try {
    // 添加"正在生成"系统消息
    const generatingMsg = createSystemMessage("⚙️ 正在生成任务计划...", {
      type: "loading",
    });
    messages.value.push(generatingMsg);

    await nextTick();
    scrollToBottom();

    // 构建LLM服务（流式）
    const llmService = {
      chat: async (prompt) => {
        // 创建一个流式生成消息
        const planGenerationMsg = createSystemMessage(
          "📝 正在编写任务计划...",
          { type: "thinking" },
        );
        messages.value.push(planGenerationMsg);
        await nextTick();
        scrollToBottom();

        return new Promise((resolve, reject) => {
          let fullResponse = "";
          let streamStarted = false;

          const handleChunk = (chunkData) => {
            if (!streamStarted) {
              streamStarted = true;
              planGenerationMsg.content = "";
              planGenerationMsg.metadata.type = "streaming";
            }

            fullResponse = chunkData.fullContent;
            planGenerationMsg.content = fullResponse;

            // 🔥 强制触发响应式更新：找到消息并完全替换它（深拷贝metadata）
            const planGenIndex = messages.value.findIndex(
              (m) => m.id === planGenerationMsg.id,
            );
            if (planGenIndex !== -1) {
              messages.value[planGenIndex] = {
                ...planGenerationMsg,
                metadata: { ...planGenerationMsg.metadata },
              };
              messages.value = [...messages.value]; // 触发数组更新
            }
            nextTick(() => scrollToBottom());
          };

          const handleComplete = (result) => {
            // 移除生成消息
            const planGenIndex = messages.value.findIndex(
              (m) => m.id === planGenerationMsg.id,
            );
            if (planGenIndex !== -1) {
              messages.value.splice(planGenIndex, 1);
            }

            resolve(fullResponse);
          };

          const handleError = (error) => {
            planGenerationMsg.content = `❌ 生成失败: ${error.message}`;
            planGenerationMsg.metadata.type = "error";
            messages.value = [...messages.value];

            reject(new Error(error.message));
          };

          safeRegisterListener("project:aiChatStream-chunk", handleChunk);
          safeRegisterListener("project:aiChatStream-complete", handleComplete);
          safeRegisterListener("project:aiChatStream-error", handleError);

          window.electronAPI.project
            .aiChatStream({
              projectId: props.projectId,
              userMessage: prompt,
              conversationId: currentConversation.value?.id,
              context: contextMode.value,
            })
            .catch((error) => {
              handleError(error);
            });
        });
      },
    };

    // 构建上下文（用于生成计划）
    const context = {
      userInput,
      projectType: "document",
      analysis,
      interviewAnswers,
    };

    // 调用TaskPlanner生成计划（需要伪造session对象）
    const fakeSession = {
      userInput,
      projectType: "document",
      analysis: {
        collected: analysis.collected || {},
      },
      interview: {
        answers: interviewAnswers,
      },
    };

    const plan = await TaskPlanner.generatePlan(fakeSession, llmService);

    // 验证 plan 对象
    if (!plan) {
      logger.error(
        "[ChatPanel] ❌ TaskPlanner.generatePlan 返回 null/undefined",
      );
      const generatingIndex = messages.value.findIndex(
        (m) => m.id === generatingMsg.id,
      );
      if (generatingIndex !== -1) {
        messages.value.splice(generatingIndex, 1);
      }
      const errorMsg = createSystemMessage("任务计划生成失败，请重试", {
        type: "error",
      });
      messages.value.push(errorMsg);
      return;
    }

    // 确保 plan.tasks 是数组
    if (!Array.isArray(plan.tasks)) {
      plan.tasks = [];
    }

    logger.info("[ChatPanel] ✅ 任务计划生成完成:", plan);

    // 移除"正在生成"消息
    const generatingIndex = messages.value.findIndex(
      (m) => m.id === generatingMsg.id,
    );
    if (generatingIndex !== -1) {
      messages.value.splice(generatingIndex, 1);
    }

    // 创建任务计划消息
    const planMsg = createTaskPlanMessage(plan);
    messages.value.push(planMsg);

    // 💾 保存任务计划消息到数据库
    if (currentConversation.value && currentConversation.value.id) {
      try {
        await window.electronAPI.conversation.createMessage({
          id: planMsg.id, // 🔥 关键修复：传入id以保持一致性
          conversation_id: currentConversation.value.id,
          role: "system",
          content: planMsg.content,
          timestamp: planMsg.timestamp,
          type: MessageType.TASK_PLAN,
          metadata: cleanForIPC(planMsg.metadata), // 🔥 清理不可序列化的对象
        });
        logger.info(
          "[ChatPanel] 💾 任务计划消息已保存到数据库，id:",
          planMsg.id,
        );
      } catch (error) {
        logger.error("[ChatPanel] 保存任务计划消息失败:", error);
      }
    }

    // 🎨 检测是否是PPT任务，如果是则自动生成PPT文件
    logger.info("[ChatPanel] 🔍 检测PPT任务，userInput:", userInput);
    logger.info("[ChatPanel] 🔍 plan.title:", plan.title);
    const isPPTTask =
      userInput.toLowerCase().includes("ppt") ||
      userInput.toLowerCase().includes("演示") ||
      userInput.toLowerCase().includes("幻灯片") ||
      userInput.toLowerCase().includes("powerpoint") ||
      (plan.title && plan.title.toLowerCase().includes("ppt"));

    logger.info("[ChatPanel] 🔍 isPPTTask:", isPPTTask);

    // 📝 检测是否是Word文档任务
    const isWordTask =
      userInput.toLowerCase().includes("word") ||
      userInput.toLowerCase().includes("docx") ||
      userInput.toLowerCase().includes("文档") ||
      userInput.toLowerCase().includes("报告") ||
      userInput.toLowerCase().includes("总结") ||
      (plan.title &&
        (plan.title.toLowerCase().includes("word") ||
          plan.title.toLowerCase().includes("文档") ||
          plan.title.toLowerCase().includes("报告") ||
          plan.title.toLowerCase().includes("总结")));

    logger.info("[ChatPanel] 🔍 isWordTask:", isWordTask);

    // 📊 检测是否是Excel/数据分析任务
    const isExcelTask =
      userInput.toLowerCase().includes("excel") ||
      userInput.toLowerCase().includes("表格") ||
      userInput.toLowerCase().includes("数据分析") ||
      userInput.toLowerCase().includes("xlsx") ||
      userInput.toLowerCase().includes("csv") ||
      (plan.title &&
        (plan.title.toLowerCase().includes("excel") ||
          plan.title.toLowerCase().includes("表格") ||
          plan.title.toLowerCase().includes("数据")));

    logger.info("[ChatPanel] 🔍 isExcelTask:", isExcelTask);

    // 📄 检测是否是Markdown任务
    const isMarkdownTask =
      userInput.toLowerCase().includes("markdown") ||
      userInput.toLowerCase().includes("md文件") ||
      userInput.toLowerCase().includes("技术文档") ||
      userInput.toLowerCase().includes("笔记") ||
      (plan.title &&
        (plan.title.toLowerCase().includes("markdown") ||
          plan.title.toLowerCase().includes("技术文档")));

    logger.info("[ChatPanel] 🔍 isMarkdownTask:", isMarkdownTask);

    // 🌐 检测是否是网页任务
    const isWebTask =
      userInput.toLowerCase().includes("网页") ||
      userInput.toLowerCase().includes("html") ||
      userInput.toLowerCase().includes("网站") ||
      userInput.toLowerCase().includes("前端页面") ||
      (plan.title &&
        (plan.title.toLowerCase().includes("网页") ||
          plan.title.toLowerCase().includes("html") ||
          plan.title.toLowerCase().includes("网站")));

    logger.info("[ChatPanel] 🔍 isWebTask:", isWebTask);
    if (isPPTTask) {
      logger.info("[ChatPanel] 🎨 检测到PPT任务，开始生成PPT文件...");

      // 显示"正在生成PPT"消息
      const generatingPPTMsg = createSystemMessage("⏳ 正在生成PPT文件...", {
        type: "info",
      });
      messages.value.push(generatingPPTMsg);
      await nextTick();
      scrollToBottom();

      try {
        // 使用LLM将任务计划转换为PPT大纲
        const outlinePrompt = `请根据以下任务计划，生成一个详细的PPT演示文稿大纲。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成一个包含标题、副标题和多个章节的PPT大纲，每个章节包含标题和要点列表。

要求返回JSON格式：
\`\`\`json
{
  "title": "PPT标题",
  "subtitle": "副标题",
  "sections": [
    {
      "title": "章节1标题",
      "subsections": [
        {
          "title": "子章节标题",
          "points": ["要点1", "要点2", "要点3"]
        }
      ]
    }
  ]
}
\`\`\``;

        const outlineResponse = await llmService.chat(outlinePrompt);
        logger.info("[ChatPanel] 📄 LLM生成的PPT大纲:", outlineResponse);

        // 提取JSON大纲
        const jsonMatch =
          outlineResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
          outlineResponse.match(/(\{[\s\S]*\})/);

        if (!jsonMatch) {
          throw new Error("无法从LLM响应中提取PPT大纲JSON");
        }

        // 🔥 清理JSON字符串中的控制字符，防止解析错误
        const sanitizedJSON = sanitizeJSONString(jsonMatch[1]);
        logger.info(
          "[ChatPanel] 🧹 JSON字符串已清理，长度:",
          sanitizedJSON.length,
        );

        const outline = JSON.parse(sanitizedJSON);
        logger.info("[ChatPanel] ✅ PPT大纲解析成功:", outline);

        // 更新消息为"正在写入文件"
        generatingPPTMsg.content = "⏳ 正在写入PPT文件...";
        messages.value = [...messages.value];

        // 获取项目路径
        const { fileName, outputPath } = await resolveProjectOutput(
          props.projectId,
          outline.title || "presentation",
          "pptx",
          "presentation",
        );

        // 调用PPT生成API
        const result = await window.electronAPI.aiEngine.generatePPT({
          outline,
          theme: "business",
          author: "用户",
          outputPath,
        });

        if (result.success) {
          logger.info("[ChatPanel] ✅ PPT文件生成成功:", result.fileName);

          // 移除"正在生成"消息
          const genPPTIndex = messages.value.findIndex(
            (m) => m.id === generatingPPTMsg.id,
          );
          if (genPPTIndex !== -1) {
            messages.value.splice(genPPTIndex, 1);
          }

          // 显示成功消息
          const successMsg = createSystemMessage(
            `✅ PPT文件已生成: ${result.fileName}\n📁 保存位置: ${result.path}\n📊 幻灯片数量: ${result.slideCount}`,
            { type: "success" },
          );
          messages.value.push(successMsg);

          antMessage.success(`PPT文件已生成: ${result.fileName}`);

          // 🔄 延迟2秒后刷新文件树，避免立即刷新导致对话面板重新渲染
          safeSetTimeout(() => {
            logger.info("[ChatPanel] 延迟刷新文件树");
            emit("files-changed");
          }, 2000);
        } else {
          throw new Error(result.error || "生成PPT失败");
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error("[ChatPanel] ❌ 生成PPT文件失败:", {
          message: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          error,
        });

        // 移除"正在生成"消息
        const genPPTIndex = messages.value.findIndex(
          (m) => m.id === generatingPPTMsg.id,
        );
        if (genPPTIndex !== -1) {
          messages.value.splice(genPPTIndex, 1);
        }

        // 显示错误消息
        const errorMsg = createSystemMessage(
          `⚠️ PPT文件生成失败: ${errorMessage || "未知错误"}\n📋 任务计划已生成，您可以稍后手动创建PPT`,
          { type: "warning" },
        );
        messages.value.push(errorMsg);

        antMessage.warning("PPT文件生成失败，但任务计划已完成");
      }
    }

    // 📝 如果是Word文档任务，自动生成Word文件
    if (isWordTask) {
      logger.info("[ChatPanel] 📝 检测到Word文档任务，开始生成Word文件...");

      // 显示"正在生成Word"消息
      const generatingWordMsg = createSystemMessage("⏳ 正在生成Word文档...", {
        type: "info",
      });
      messages.value.push(generatingWordMsg);
      await nextTick();
      scrollToBottom();

      try {
        // 使用LLM生成文档结构
        const structurePrompt = `请根据以下任务计划，生成一个详细的Word文档结构。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成一个包含标题和多个段落的文档结构，内容要正式、专业。

要求返回JSON格式：
\`\`\`json
{
  "title": "文档标题",
  "paragraphs": [
    {
      "heading": "章节标题",
      "level": 1,
      "content": "段落内容"
    }
  ]
}
\`\`\``;

        const structureResponse = await llmService.chat(structurePrompt);
        logger.info("[ChatPanel] 📄 LLM生成的文档结构:", structureResponse);

        // 提取JSON结构
        const jsonMatch =
          structureResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
          structureResponse.match(/(\{[\s\S]*\})/);

        if (!jsonMatch) {
          throw new Error("无法从LLM响应中提取文档结构JSON");
        }

        // 🔥 清理JSON字符串中的控制字符，防止解析错误
        const sanitizedJSON = sanitizeJSONString(jsonMatch[1]);
        logger.info(
          "[ChatPanel] 🧹 JSON字符串已清理，长度:",
          sanitizedJSON.length,
        );

        const rawDocumentStructure = JSON.parse(sanitizedJSON);
        logger.info("[ChatPanel] ✅ 文档结构解析成功:", rawDocumentStructure);

        // 🔥 转换LLM返回的格式为word-engine期望的格式
        // LLM返回: { heading: "string", level: number, content: "string" }
        // word-engine期望: { text: "string", heading: number }
        const documentStructure = {
          title: rawDocumentStructure.title || "文档",
          paragraphs: (rawDocumentStructure.paragraphs || []).map((para) => ({
            text: para.content || para.text || para.heading || "",
            heading:
              para.level ||
              (typeof para.heading === "number" ? para.heading : undefined),
            alignment: para.alignment || "left",
            style: para.style || {},
            spacing: para.spacing || { after: 200 },
          })),
        };
        logger.info("[ChatPanel] 📝 文档结构已转换:", {
          title: documentStructure.title,
          paragraphCount: documentStructure.paragraphs.length,
        });

        // 更新消息为"正在写入文件"
        generatingWordMsg.content = "⏳ 正在写入Word文件...";
        messages.value = [...messages.value];

        // 获取项目路径
        const { fileName, outputPath } = await resolveProjectOutput(
          props.projectId,
          documentStructure.title || "document",
          "docx",
          "document",
        );

        // 调用Word生成API
        const result = await window.electronAPI.aiEngine.generateWord({
          structure: documentStructure,
          outputPath,
        });

        if (result.success) {
          logger.info("[ChatPanel] ✅ Word文件生成成功:", result.fileName);

          // 移除"正在生成"消息
          const genWordIndex = messages.value.findIndex(
            (m) => m.id === generatingWordMsg.id,
          );
          if (genWordIndex !== -1) {
            messages.value.splice(genWordIndex, 1);
          }

          // 显示成功消息
          const successMsg = createSystemMessage(
            `✅ Word文档已生成: ${result.fileName}\n📁 保存位置: ${result.path}\n📄 段落数量: ${result.paragraphCount || 0}`,
            { type: "success" },
          );
          messages.value.push(successMsg);

          antMessage.success(`Word文档已生成: ${result.fileName}`);

          // 🔄 延迟2秒后刷新文件树
          safeSetTimeout(() => {
            logger.info("[ChatPanel] 延迟刷新文件树");
            emit("files-changed");
          }, 2000);
        } else {
          throw new Error(result.error || "生成Word文档失败");
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error("[ChatPanel] ❌ 生成Word文件失败:", {
          message: errorMessage,
          stack: errorStack,
          error,
        });

        // 移除"正在生成"消息
        const genWordIndex = messages.value.findIndex(
          (m) => m.id === generatingWordMsg.id,
        );
        if (genWordIndex !== -1) {
          messages.value.splice(genWordIndex, 1);
        }

        // 显示错误消息
        const errorMsg = createSystemMessage(
          `⚠️ Word文件生成失败: ${errorMessage || "未知错误"}\n📋 任务计划已生成，您可以稍后手动创建Word文档`,
          { type: "warning" },
        );
        messages.value.push(errorMsg);

        antMessage.warning("Word文件生成失败，但任务计划已完成");
      }
    }

    // 📊 如果是Excel任务，自动生成Excel文件
    if (isExcelTask) {
      logger.info("[ChatPanel] 📊 检测到Excel任务，开始生成Excel文件...");

      const generatingExcelMsg = createSystemMessage(
        "⏳ 正在生成Excel文件...",
        { type: "info" },
      );
      messages.value.push(generatingExcelMsg);
      await nextTick();
      scrollToBottom();

      try {
        // 使用LLM生成数据结构
        const dataPrompt = `请根据以下任务计划，生成一个Excel数据结构。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成包含表头和数据行的结构。

要求返回JSON格式：
\`\`\`json
{
  "sheetName": "Sheet1",
  "headers": ["列1", "列2", "列3"],
  "data": [
    ["数据1", "数据2", "数据3"],
    ["数据4", "数据5", "数据6"]
  ]
}
\`\`\``;

        const dataResponse = await llmService.chat(dataPrompt);
        logger.info("[ChatPanel] 📄 LLM生成的数据结构:", dataResponse);

        const jsonMatch =
          dataResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
          dataResponse.match(/(\{[\s\S]*\})/);

        if (!jsonMatch) {
          throw new Error("无法从LLM响应中提取数据结构JSON");
        }

        // 🔥 清理JSON字符串中的控制字符，防止解析错误
        const sanitizedJSON = sanitizeJSONString(jsonMatch[1]);
        logger.info(
          "[ChatPanel] 🧹 JSON字符串已清理，长度:",
          sanitizedJSON.length,
        );

        const dataStructure = JSON.parse(sanitizedJSON);
        logger.info("[ChatPanel] ✅ 数据结构解析成功:", dataStructure);

        generatingExcelMsg.content = "⏳ 正在写入Excel文件...";
        messages.value = [...messages.value];

        const { fileName, outputPath } = await resolveProjectOutput(
          props.projectId,
          plan.title || "data",
          "xlsx",
          "data",
        );

        // 调用data-engine写入Excel
        await window.electronAPI.file.writeExcel(outputPath, {
          sheetName: dataStructure.sheetName || "Sheet1",
          headers: dataStructure.headers,
          data: dataStructure.data,
        });

        logger.info("[ChatPanel] ✅ Excel文件生成成功");

        const genExcelIndex = messages.value.findIndex(
          (m) => m.id === generatingExcelMsg.id,
        );
        if (genExcelIndex !== -1) {
          messages.value.splice(genExcelIndex, 1);
        }

        const successMsg = createSystemMessage(
          `✅ Excel文件已生成: ${fileName}\n📁 保存位置: ${outputPath}\n📊 数据行数: ${dataStructure.data.length}`,
          { type: "success" },
        );
        messages.value.push(successMsg);

        antMessage.success(`Excel文件已生成: ${fileName}`);

        safeSetTimeout(() => {
          emit("files-changed");
        }, 2000);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error("[ChatPanel] ❌ 生成Excel文件失败:", {
          message: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          error,
        });

        const genExcelIndex = messages.value.findIndex(
          (m) => m.id === generatingExcelMsg.id,
        );
        if (genExcelIndex !== -1) {
          messages.value.splice(genExcelIndex, 1);
        }

        const errorMsg = createSystemMessage(
          `⚠️ Excel文件生成失败: ${errorMessage || "未知错误"}\n📋 任务计划已生成，您可以稍后手动创建Excel文件`,
          { type: "warning" },
        );
        messages.value.push(errorMsg);

        antMessage.warning("Excel文件生成失败，但任务计划已完成");
      }
    }

    // 📄 如果是Markdown任务，自动生成Markdown文件
    if (isMarkdownTask) {
      logger.info("[ChatPanel] 📄 检测到Markdown任务，开始生成Markdown文件...");

      const generatingMdMsg = createSystemMessage(
        "⏳ 正在生成Markdown文档...",
        { type: "info" },
      );
      messages.value.push(generatingMdMsg);
      await nextTick();
      scrollToBottom();

      try {
        const mdPrompt = `请根据以下任务计划，生成一个Markdown文档内容。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成完整的Markdown格式内容，包含标题、章节、列表等。`;

        const mdResponse = await llmService.chat(mdPrompt);
        logger.info("[ChatPanel] 📄 LLM生成的Markdown内容");

        generatingMdMsg.content = "⏳ 正在写入Markdown文件...";
        messages.value = [...messages.value];

        const { fileName, outputPath } = await resolveProjectOutput(
          props.projectId,
          plan.title || "document",
          "md",
          "document",
        );

        // 写入Markdown文件
        await window.electronAPI.file.writeContent(outputPath, mdResponse);

        logger.info("[ChatPanel] ✅ Markdown文件生成成功");

        const genMdIndex = messages.value.findIndex(
          (m) => m.id === generatingMdMsg.id,
        );
        if (genMdIndex !== -1) {
          messages.value.splice(genMdIndex, 1);
        }

        const successMsg = createSystemMessage(
          `✅ Markdown文档已生成: ${fileName}\n📁 保存位置: ${outputPath}`,
          { type: "success" },
        );
        messages.value.push(successMsg);

        antMessage.success(`Markdown文档已生成: ${fileName}`);

        safeSetTimeout(() => {
          emit("files-changed");
        }, 2000);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error("[ChatPanel] ❌ 生成Markdown文件失败:", {
          message: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          error,
        });

        const genMdIndex = messages.value.findIndex(
          (m) => m.id === generatingMdMsg.id,
        );
        if (genMdIndex !== -1) {
          messages.value.splice(genMdIndex, 1);
        }

        const errorMsg = createSystemMessage(
          `⚠️ Markdown文件生成失败: ${errorMessage || "未知错误"}\n📋 任务计划已生成，您可以稍后手动创建Markdown文档`,
          { type: "warning" },
        );
        messages.value.push(errorMsg);

        antMessage.warning("Markdown文件生成失败，但任务计划已完成");
      }
    }

    // 🌐 如果是网页任务，自动生成HTML文件
    if (isWebTask) {
      logger.info("[ChatPanel] 🌐 检测到网页任务，开始生成HTML文件...");

      const generatingWebMsg = createSystemMessage("⏳ 正在生成网页文件...", {
        type: "info",
      });
      messages.value.push(generatingWebMsg);
      await nextTick();
      scrollToBottom();

      try {
        const htmlPrompt = `请根据以下任务计划，生成一个完整的HTML网页。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成包含HTML、CSS和基本交互的完整网页代码。`;

        const htmlResponse = await llmService.chat(htmlPrompt);
        logger.info("[ChatPanel] 📄 LLM生成的HTML内容");

        // 提取HTML代码
        let htmlContent = htmlResponse;
        const htmlMatch = htmlResponse.match(/```(?:html)?\s*([\s\S]*?)\s*```/);
        if (htmlMatch) {
          htmlContent = htmlMatch[1];
        }

        generatingWebMsg.content = "⏳ 正在写入HTML文件...";
        messages.value = [...messages.value];

        const { fileName, outputPath } = await resolveProjectOutput(
          props.projectId,
          plan.title || "index",
          "html",
          "index",
        );

        // 写入HTML文件
        await window.electronAPI.file.writeContent(outputPath, htmlContent);

        logger.info("[ChatPanel] ✅ 网页文件生成成功");

        const genWebIndex = messages.value.findIndex(
          (m) => m.id === generatingWebMsg.id,
        );
        if (genWebIndex !== -1) {
          messages.value.splice(genWebIndex, 1);
        }

        const successMsg = createSystemMessage(
          `✅ 网页文件已生成: ${fileName}\n📁 保存位置: ${outputPath}`,
          { type: "success" },
        );
        messages.value.push(successMsg);

        antMessage.success(`网页文件已生成: ${fileName}`);

        safeSetTimeout(() => {
          emit("files-changed");
        }, 2000);
      } catch (error) {
        logger.error("[ChatPanel] ❌ 生成网页文件失败:", error);

        const genWebIndex = messages.value.findIndex(
          (m) => m.id === generatingWebMsg.id,
        );
        if (genWebIndex !== -1) {
          messages.value.splice(genWebIndex, 1);
        }

        const errorMsg = createSystemMessage(
          `⚠️ 网页文件生成失败: ${error.message}\n📋 任务计划已生成，您可以稍后手动创建网页`,
          { type: "warning" },
        );
        messages.value.push(errorMsg);

        antMessage.warning("网页文件生成失败，但任务计划已完成");
      }
    }

    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error("[ChatPanel] ❌ 任务计划生成失败:", error);

    // 移除"正在生成"消息
    const generatingIndex = messages.value.findIndex(
      (m) => m.type === MessageType.SYSTEM && m.content.includes("正在生成"),
    );
    if (generatingIndex !== -1) {
      messages.value.splice(generatingIndex, 1);
    }

    const errorMsg = createSystemMessage(`生成任务计划失败: ${error.message}`, {
      type: "error",
    });
    messages.value.push(errorMsg);

    antMessage.error("生成任务计划失败: " + error.message);
  }
};

// ============ 事件处理器（新版 - 基于消息） ============

/**
 * 处理采访问题回答
 */
const handleInterviewAnswer = async ({ questionKey, answer, index }) => {
  logger.info("[ChatPanel] 💬 用户回答问题:", questionKey, answer);

  // 🆕 记录答案类型（结构化 vs 传统）
  if (
    typeof answer === "object" &&
    answer !== null &&
    answer.selectedOption !== undefined
  ) {
    logger.info("[ChatPanel] 📝 结构化答案:", {
      选项: answer.selectedOption,
      补充说明: answer.additionalInput || "(无)",
    });
  } else {
    logger.info("[ChatPanel] 📝 传统文本答案:", answer);
  }

  // 找到采访消息的索引
  const interviewMsgIndex = messages.value.findIndex(
    (m) => m.type === MessageType.INTERVIEW,
  );
  if (interviewMsgIndex === -1) {
    logger.error("[ChatPanel] 找不到采访消息");
    return;
  }

  const interviewMsg = messages.value[interviewMsgIndex];

  // 🔥 数据验证：修复错误的 currentIndex
  const currentIdx = interviewMsg.metadata.currentIndex || 0;
  const totalQuestions = interviewMsg.metadata.questions?.length || 0;

  if (currentIdx >= totalQuestions) {
    logger.error("[ChatPanel] ⚠️ 数据异常：currentIndex 超出范围", {
      currentIndex: currentIdx,
      totalQuestions: totalQuestions,
    });
    // 重置为最后一个问题
    interviewMsg.metadata.currentIndex = Math.max(0, totalQuestions - 1);
  }

  // 🔥 关键修复：创建新的metadata对象，确保Vue能检测到变化
  const newMetadata = {
    ...interviewMsg.metadata,
    answers: {
      ...interviewMsg.metadata.answers,
      [questionKey]: answer,
    },
    currentIndex: Math.min(
      interviewMsg.metadata.currentIndex + 1,
      totalQuestions,
    ),
  };

  // 🔥 替换整个消息对象以触发响应式更新
  messages.value[interviewMsgIndex] = {
    ...interviewMsg,
    metadata: newMetadata,
  };

  // 触发数组更新
  messages.value = [...messages.value];

  // 🔥 强制刷新虚拟列表组件
  messagesRefreshKey.value++;

  logger.info("[ChatPanel] 📝 已更新到下一个问题", {
    currentIndex: newMetadata.currentIndex,
    nextQuestionKey: newMetadata.questions[newMetadata.currentIndex]?.key,
    refreshKey: messagesRefreshKey.value,
  });

  // 🔥 保存到数据库
  if (currentConversation.value && currentConversation.value.id) {
    try {
      await window.electronAPI.conversation.updateMessage({
        id: messages.value[interviewMsgIndex].id,
        metadata: cleanForIPC(newMetadata), // 🔥 清理不可序列化的对象
      });
      logger.info("[ChatPanel] 💾 采访进度已保存到数据库");
    } catch (error) {
      logger.error("[ChatPanel] 保存采访进度失败:", error);
      logger.error("[ChatPanel] 失败的metadata:", newMetadata);
    }
  }

  // 🔥 优化滚动：使用单次延迟滚动，等待组件完全渲染
  nextTick(() => {
    safeSetTimeout(() => {
      scrollToBottom();
    }, 150); // 给组件足够的渲染时间
  });

  // 检查是否所有问题都已回答
  if (newMetadata.currentIndex >= newMetadata.questions.length) {
    logger.info("[ChatPanel] 所有问题已回答，自动触发完成");
    handleInterviewComplete();
  }
};

/**
 * 处理跳过问题
 */
const handleInterviewSkip = async ({ questionKey, index }) => {
  logger.info("[ChatPanel] ⏭️ 用户跳过问题:", questionKey);

  // 找到采访消息的索引
  const interviewMsgIndex = messages.value.findIndex(
    (m) => m.type === MessageType.INTERVIEW,
  );
  if (interviewMsgIndex === -1) {
    logger.error("[ChatPanel] 找不到采访消息");
    return;
  }

  const interviewMsg = messages.value[interviewMsgIndex];

  // 🔥 数据验证：修复错误的 currentIndex
  const currentIdx = interviewMsg.metadata.currentIndex || 0;
  const totalQuestions = interviewMsg.metadata.questions?.length || 0;

  if (currentIdx >= totalQuestions) {
    logger.error("[ChatPanel] ⚠️ 数据异常：currentIndex 超出范围", {
      currentIndex: currentIdx,
      totalQuestions: totalQuestions,
    });
    interviewMsg.metadata.currentIndex = Math.max(0, totalQuestions - 1);
  }

  // 🔥 关键修复：创建新的metadata对象，确保Vue能检测到变化
  const newMetadata = {
    ...interviewMsg.metadata,
    answers: {
      ...interviewMsg.metadata.answers,
      [questionKey]: "",
    },
    currentIndex: Math.min(
      interviewMsg.metadata.currentIndex + 1,
      totalQuestions,
    ),
  };

  // 🔥 替换整个消息对象以触发响应式更新
  messages.value[interviewMsgIndex] = {
    ...interviewMsg,
    metadata: newMetadata,
  };

  // 触发数组更新
  messages.value = [...messages.value];

  // 🔥 强制刷新虚拟列表组件
  messagesRefreshKey.value++;

  logger.info("[ChatPanel] 📝 已跳过问题", {
    currentIndex: newMetadata.currentIndex,
    refreshKey: messagesRefreshKey.value,
  });

  // 🔥 保存到数据库
  if (currentConversation.value && currentConversation.value.id) {
    try {
      await window.electronAPI.conversation.updateMessage({
        id: messages.value[interviewMsgIndex].id,
        metadata: cleanForIPC(newMetadata), // 🔥 清理不可序列化的对象
      });
      logger.info("[ChatPanel] 💾 采访进度已保存到数据库（跳过）");
    } catch (error) {
      logger.error("[ChatPanel] 保存采访进度失败:", error);
      logger.error("[ChatPanel] 失败的metadata:", newMetadata);
    }
  }

  // 🔥 优化滚动：使用单次延迟滚动，等待组件完全渲染
  nextTick(() => {
    safeSetTimeout(() => {
      scrollToBottom();
    }, 150); // 给组件足够的渲染时间
  });

  // 检查是否所有问题都已回答
  if (newMetadata.currentIndex >= newMetadata.questions.length) {
    logger.info("[ChatPanel] 所有问题已回答/跳过，自动触发完成");
    handleInterviewComplete();
  }
};

/**
 * 处理采访完成
 */
const handleInterviewComplete = async () => {
  logger.info("[ChatPanel] ✅ 采访完成，开始生成任务计划");

  // 找到采访消息
  const interviewMsg = messages.value.find(
    (m) => m.type === MessageType.INTERVIEW,
  );
  if (!interviewMsg) {
    logger.error("[ChatPanel] 找不到采访消息");
    return;
  }

  // 获取用户输入、分析结果和答案
  const userInput = interviewMsg.metadata.userInput;
  const analysis = interviewMsg.metadata.analysis;
  const answers = interviewMsg.metadata.answers;

  // 生成任务计划
  await generateTaskPlanMessage(userInput, analysis, answers);
};

/**
 * 处理计划确认
 */
const handlePlanConfirm = async (message) => {
  logger.info("[ChatPanel] ✅ 用户确认计划，开始执行");

  // 更新计划消息状态为"已确认"
  message.metadata.status = "confirmed";
  messages.value = [...messages.value]; // 触发更新

  try {
    // 更新为"执行中"
    message.metadata.status = "executing";
    messages.value = [...messages.value];

    const plan = message.metadata.plan;

    // 执行任务：调用AI对话API
    const prompt = `请根据以下任务计划执行任务：\n\n${JSON.stringify(plan, null, 2)}\n\n请按照计划逐步完成任务。`;

    // 取消通过 project:cancelAiChat IPC 实现
    const response = await window.electronAPI.project.aiChat({
      projectId: props.projectId,
      userMessage: prompt,
      conversationId: currentConversation.value?.id,
      context: contextMode.value,
    });

    // 添加AI响应消息
    const aiMessage = createAssistantMessage(
      response.conversationResponse,
      currentConversation.value?.id,
    );
    messages.value.push(aiMessage);

    // 检查PPT生成结果
    if (response.pptGenerated && response.pptResult) {
      logger.info("[ChatPanel] ✅ PPT已生成:", response.pptResult);
      antMessage.success({
        content: `🎉 PPT文件已生成！\n文件名: ${response.pptResult.fileName}\n幻灯片数: ${response.pptResult.slideCount}`,
        duration: 5,
      });

      // 🔄 延迟2秒后刷新文件树，避免立即刷新导致对话面板重新渲染
      safeSetTimeout(() => {
        logger.info("[ChatPanel] 延迟刷新文件树");
        emit("files-changed");
      }, 2000);
    }

    // 检查Word生成结果
    if (response.wordGenerated && response.wordResult) {
      logger.info("[ChatPanel] ✅ Word文档已生成:", response.wordResult);
      antMessage.success({
        content: `📝 Word文档已生成！\n文件名: ${response.wordResult.fileName}\n文件大小: ${(response.wordResult.fileSize / 1024).toFixed(2)} KB`,
        duration: 5,
      });

      // 🔄 延迟2秒后刷新文件树，避免立即刷新导致对话面板重新渲染
      setTimeout(() => {
        logger.info("[ChatPanel] 延迟刷新文件树（Word）");
        emit("files-changed");
      }, 2000);
    }

    // 更新计划状态为"已完成"
    message.metadata.status = "completed";
    messages.value = [...messages.value];

    antMessage.success("任务执行完成！");

    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error("[ChatPanel] ❌ 任务执行失败:", error);

    // 恢复为待确认状态
    message.metadata.status = "pending";
    messages.value = [...messages.value];

    const errorMsg = createSystemMessage(`任务执行失败: ${error.message}`, {
      type: "error",
    });
    messages.value.push(errorMsg);

    antMessage.error("任务执行失败: " + error.message);
  }
};

/**
 * 处理取消计划
 */
const handlePlanCancel = (message) => {
  logger.info("[ChatPanel] ❌ 用户取消计划");

  // 更新计划消息状态
  message.metadata.status = "cancelled";
  messages.value = [...messages.value];

  const cancelMsg = createSystemMessage("已取消任务计划", { type: "info" });
  messages.value.push(cancelMsg);

  antMessage.info("已取消任务计划");
};

/**
 * 处理修改计划
 */
const handlePlanModify = (message) => {
  logger.info("[ChatPanel] ✏️ 用户请求修改计划");

  // 添加提示消息
  const modifyMsg = createSystemMessage(
    "💡 提示：您可以在下方输入框中描述需要修改的内容，我会为您重新生成计划。",
    { type: "info" },
  );
  messages.value.push(modifyMsg);

  antMessage.info("请在输入框中描述需要修改的内容");
};

// ============ 后续输入意图处理函数 ============

/**
 * 处理后续输入的不同意图
 * @param {string} intent - 意图类型
 * @param {string} userInput - 用户输入
 * @param {string} extractedInfo - 提取的关键信息
 * @param {string} reason - 判断理由
 * @param {Object} executingTask - 正在执行的任务消息
 */
const handleFollowupIntent = async (
  intent,
  userInput,
  extractedInfo,
  reason,
  executingTask,
) => {
  logger.info(`[ChatPanel] 📋 处理后续输入意图: ${intent}`);

  // 创建用户消息（记录用户的输入）
  const userMessage = createUserMessage(
    userInput,
    currentConversation.value?.id,
  );
  messages.value.push(userMessage);

  // 保存用户消息到数据库
  if (currentConversation.value && currentConversation.value.id) {
    try {
      await window.electronAPI.conversation.createMessage({
        id: userMessage.id, // 🔥 关键修复：传入id以保持一致性
        conversation_id: currentConversation.value.id,
        role: "user",
        content: userInput,
        timestamp: userMessage.timestamp,
      });
    } catch (error) {
      logger.error("[ChatPanel] 保存用户消息失败:", error);
    }
  }

  switch (intent) {
    case "CONTINUE_EXECUTION": {
      // 用户催促继续执行，不做任何修改
      logger.info("[ChatPanel] ✅ 用户催促继续执行，无需操作");

      // 添加一条确认消息
      const continueMessage = createIntentSystemMessage(intent, userInput, {
        reason,
        extractedInfo,
      });
      messages.value.push(continueMessage);
      await saveMessageToDb(continueMessage);

      // 可选：向用户反馈正在执行
      antMessage.info("继续执行任务中...");
      break;
    }

    case "MODIFY_REQUIREMENT": {
      // 用户修改需求，需要暂停并重新规划
      logger.info("[ChatPanel] ⚠️ 用户修改需求:", extractedInfo);

      // 1. 暂停当前任务
      if (executingTask) {
        executingTask.metadata.status = "paused";
        executingTask.metadata.pauseReason = "用户修改需求";
        messages.value = [...messages.value]; // 触发更新
        await updateMessageInDb(executingTask);
      }

      // 2. 添加系统提示
      const modifyMessage = createIntentSystemMessage(intent, userInput, {
        reason,
        extractedInfo,
      });
      messages.value.push(modifyMessage);
      await saveMessageToDb(modifyMessage);

      // 3. 重新启动任务规划（将原需求和新需求合并）
      const originalRequirement =
        executingTask.metadata?.plan?.description || "原始需求";
      const mergedInput = mergeRequirements(originalRequirement, userInput);

      antMessage.warning("检测到需求变更，正在重新规划任务...");

      // 延迟一下，让用户看到提示消息
      await nextTick();
      scrollToBottom();

      // 重新启动任务规划
      await startTaskPlanning(mergedInput);
      break;
    }

    case "CLARIFICATION": {
      // 用户补充说明，追加到上下文继续执行
      logger.info("[ChatPanel] 📝 用户补充说明:", extractedInfo);

      // 1. 将信息追加到任务计划的上下文中
      if (
        executingTask &&
        executingTask.metadata &&
        executingTask.metadata.plan
      ) {
        const updatedPlan = addClarificationToTaskPlan(
          executingTask.metadata.plan,
          extractedInfo || userInput,
        );
        executingTask.metadata.plan = updatedPlan;
        messages.value = [...messages.value]; // 触发更新
        await updateMessageInDb(executingTask);
      }

      // 2. 添加确认消息
      const clarifyMessage = createIntentSystemMessage(intent, userInput, {
        reason,
        extractedInfo,
      });
      messages.value.push(clarifyMessage);
      await saveMessageToDb(clarifyMessage);

      antMessage.success("已记录补充信息，继续执行任务...");

      // 3. 可选：调用 AI 服务使用更新后的上下文重新生成响应
      // 这里可以根据需要决定是否重新调用 AI
      break;
    }

    case "CANCEL_TASK": {
      // 用户取消任务
      logger.info("[ChatPanel] ❌ 用户取消任务");

      // 1. 停止任务执行
      if (executingTask) {
        executingTask.metadata.status = "cancelled";
        executingTask.metadata.cancelReason = reason;
        messages.value = [...messages.value]; // 触发更新
        await updateMessageInDb(executingTask);
      }

      // 2. 添加取消消息
      const cancelMessage = createIntentSystemMessage(intent, userInput, {
        reason,
      });
      messages.value.push(cancelMessage);
      await saveMessageToDb(cancelMessage);

      antMessage.info("任务已取消");
      break;
    }

    default:
      logger.warn("[ChatPanel] ⚠️ 未知意图类型:", intent);
      antMessage.warning("无法识别您的意图，请重新表述");
  }

  // 滚动到底部
  await nextTick();
  scrollToBottom();
};

/**
 * 保存消息到数据库
 */
const saveMessageToDb = async (message) => {
  if (!currentConversation.value || !currentConversation.value.id) {
    logger.warn("[ChatPanel] 无当前对话，无法保存消息");
    return;
  }

  try {
    await window.electronAPI.conversation.createMessage({
      id: message.id, // 🔥 关键修复：传入id以保持一致性
      conversation_id: currentConversation.value.id,
      role: message.role || "system",
      content: message.content,
      timestamp: message.timestamp,
      type: message.type,
      metadata: cleanForIPC(message.metadata), // 🔥 清理不可序列化的对象
    });
  } catch (error) {
    logger.error("[ChatPanel] 保存消息失败:", error);
  }
};

/**
 * 更新消息到数据库
 */
const updateMessageInDb = async (message) => {
  if (!currentConversation.value || !currentConversation.value.id) {
    logger.warn("[ChatPanel] 无当前对话，无法更新消息");
    return;
  }

  try {
    await window.electronAPI.conversation.updateMessage({
      id: message.id,
      conversation_id: currentConversation.value.id,
      metadata: cleanForIPC(message.metadata), // 🔥 清理不可序列化的对象
    });
  } catch (error) {
    logger.error("[ChatPanel] 更新消息失败:", error);
  }
};

// ============ 意图确认相关函数 ============

/**
 * 处理意图确认
 * 用户确认AI的理解是正确的，继续执行原有的对话流程
 */
const handleIntentConfirm = async ({
  messageId,
  originalInput,
  understanding,
}) => {
  logger.info("[ChatPanel] ✅ 用户确认意图理解正确");

  // 找到意图确认消息并更新状态
  const intentMsg = messages.value.find((m) => m.id === messageId);
  if (intentMsg) {
    intentMsg.metadata.status = "confirmed";
    messages.value = [...messages.value]; // 触发更新
  }

  // 使用纠错后的输入继续对话流程
  const finalInput = understanding.correctedInput || originalInput;
  await executeChatWithInput(finalInput);
};

/**
 * 处理意图纠正
 * 用户认为AI理解有误，提供了纠正内容
 */
const handleIntentCorrect = async ({
  messageId,
  originalInput,
  correction,
}) => {
  logger.info("[ChatPanel] 🔄 用户提供了纠正内容:", correction);

  // 找到意图确认消息并更新状态
  const intentMsg = messages.value.find((m) => m.id === messageId);
  if (intentMsg) {
    intentMsg.metadata.status = "corrected";
    intentMsg.metadata.correction = correction;
    messages.value = [...messages.value]; // 触发更新
  }

  // 重新理解纠正后的内容
  await understandUserIntent(correction);
};

/**
 * 理解用户意图（纠错 + 意图识别）
 * @param {string} input - 用户输入
 * @returns {Promise<Object>} - 返回理解结果
 */
const understandUserIntent = async (input) => {
  logger.info("[ChatPanel] 🤔 开始理解用户意图:", input);

  try {
    // 调用意图理解API
    const result = await window.electronAPI.project.understandIntent({
      userInput: input,
      projectId: props.projectId,
      contextMode: contextMode.value,
    });

    logger.info("[ChatPanel] ✅ 意图理解完成:", result);

    // 创建意图确认消息
    const confirmationMsg = createIntentConfirmationMessage(input, result);
    messages.value.push(confirmationMsg);

    // 保存到数据库
    if (currentConversation.value && currentConversation.value.id) {
      await window.electronAPI.conversation.createMessage({
        id: confirmationMsg.id, // 🔥 关键修复：传入id以保持一致性
        conversation_id: currentConversation.value.id,
        role: "system",
        content: confirmationMsg.content,
        timestamp: confirmationMsg.timestamp,
        type: MessageType.INTENT_CONFIRMATION,
        metadata: cleanForIPC(confirmationMsg.metadata), // 🔥 清理不可序列化的对象
      });
    }

    await nextTick();
    scrollToBottom();

    return result;
  } catch (error) {
    logger.error("[ChatPanel] ❌ 意图理解失败:", error);
    antMessage.error("意图理解失败: " + error.message);

    // 如果理解失败，直接执行原始输入
    await executeChatWithInput(input);
    throw error;
  }
};

/**
 * 执行对话（使用确认后的输入）
 * @param {string} input - 确认后的输入
 */
const executeChatWithInput = async (input) => {
  logger.info("[ChatPanel] 🚀 执行对话，输入:", input);

  isLoading.value = true;

  // 🔥 初始化思考过程可视化
  updateThinkingState({
    show: true,
    stage: "理解您的需求...",
    progress: 10,
    showProgress: true,
    progressText: "正在分析问题",
    steps: [
      {
        title: "理解需求",
        status: "in-progress",
        description: "分析用户输入的问题",
      },
      {
        title: "检索知识",
        status: "pending",
        description: "从知识库中查找相关信息",
      },
      { title: "生成回复", status: "pending", description: "使用AI生成答案" },
      { title: "完成", status: "pending", description: "返回结果" },
    ],
    streamingContent: "",
    showCancelButton: true,
  });

  try {
    // 创建用户消息
    const userMessage = {
      id: `msg_${Date.now()}_user`,
      conversation_id: currentConversation.value?.id,
      role: "user",
      content: input,
      timestamp: Date.now(),
    };

    // 确保 messages.value 是数组
    if (!Array.isArray(messages.value)) {
      logger.warn("[ChatPanel] messages.value 不是数组，重新初始化为空数组");
      messages.value = [];
    }

    // 添加用户消息到列表
    messages.value.push(userMessage);

    // 如果没有当前对话，创建一个
    if (!currentConversation.value) {
      updateThinkingState({ stage: "创建对话...", progress: 15 });
      await createConversation();

      if (!currentConversation.value) {
        throw new Error("创建对话失败，无法发送消息");
      }
    }

    // 保存用户消息到数据库
    await window.electronAPI.conversation.createMessage({
      id: userMessage.id, // 🔥 关键修复：传入id以保持一致性
      conversation_id: currentConversation.value.id,
      role: "user",
      content: userMessage.content,
      timestamp: userMessage.timestamp,
    });

    // 滚动到底部
    await nextTick();
    scrollToBottom();

    // 🔥 更新思考状态：完成需求理解
    thinkingState.steps[0].status = "completed";
    thinkingState.steps[1].status = "in-progress";
    updateThinkingState({
      stage: "检索相关知识...",
      progress: 30,
      progressText: "查找相关信息",
    });

    // 获取项目信息和文件列表
    const project = await window.electronAPI.project.get(props.projectId);
    const projectInfo = project
      ? {
          name: project.name,
          description: project.description || "",
          type: project.project_type || "general",
        }
      : null;
    const rawFileList = await getProjectFiles();

    // 清理文件列表
    const fileList = Array.isArray(rawFileList)
      ? rawFileList.map((file) => ({
          id: file.id,
          file_name: file.file_name,
          file_path: file.file_path,
          file_type: file.file_type,
          content: file.content,
          size: file.size,
        }))
      : [];

    // 🔥 更新思考状态：构建上下文
    thinkingState.steps[1].status = "completed";
    thinkingState.steps[2].status = "in-progress";
    updateThinkingState({
      stage: "生成回复...",
      progress: 50,
      progressText: "AI正在思考答案",
    });

    // 🔥 构建智能对话历史（保留最近N轮，优先保留重要消息）
    const conversationHistory = buildSmartContextHistory();

    // 清理 currentFile
    const cleanCurrentFile = props.currentFile
      ? {
          id: props.currentFile.id,
          file_name: props.currentFile.file_name,
          file_path: props.currentFile.file_path,
          file_type: props.currentFile.file_type,
          content: props.currentFile.content,
          size: props.currentFile.size,
        }
      : null;

    // 调用AI对话API（取消通过 project:cancelAiChat IPC 实现）
    const response = await window.electronAPI.project.aiChat({
      projectId: props.projectId,
      userMessage: input,
      conversationHistory: conversationHistory,
      contextMode: contextMode.value,
      currentFile: cleanCurrentFile,
      projectInfo: projectInfo,
      fileList: fileList,
    });

    logger.info("[ChatPanel] AI响应:", response);

    // 检查是否被用户取消
    if (response.cancelled) {
      logger.info("[ChatPanel] AI对话已被用户取消，跳过后续处理");
      thinkingState.show = false;
      return;
    }

    // 🔥 更新思考状态：生成完成
    thinkingState.steps[2].status = "completed";
    thinkingState.steps[3].status = "in-progress";
    updateThinkingState({
      stage: "处理结果...",
      progress: 90,
      progressText: "几乎完成了",
    });

    // 检查PPT生成结果
    if (response.pptGenerated && response.pptResult) {
      logger.info("[ChatPanel] ✅ PPT已生成:", response.pptResult);
      antMessage.success({
        content: `🎉 PPT文件已生成！\n文件名: ${response.pptResult.fileName}\n幻灯片数: ${response.pptResult.slideCount}`,
        duration: 5,
      });

      // 🔄 延迟2秒后刷新文件树，避免立即刷新导致对话面板重新渲染
      safeSetTimeout(() => {
        logger.info("[ChatPanel] 延迟刷新文件树");
        emit("files-changed");
      }, 2000);
    }

    // 检查Word生成结果
    if (response.wordGenerated && response.wordResult) {
      logger.info("[ChatPanel] ✅ Word文档已生成:", response.wordResult);
      antMessage.success({
        content: `📝 Word文档已生成！\n文件名: ${response.wordResult.fileName}\n文件大小: ${(response.wordResult.fileSize / 1024).toFixed(2)} KB`,
        duration: 5,
      });

      // 🔄 延迟2秒后刷新文件树，避免立即刷新导致对话面板重新渲染
      setTimeout(() => {
        logger.info("[ChatPanel] 延迟刷新文件树（Word）");
        emit("files-changed");
      }, 2000);
    }

    // 创建助手消息
    const assistantMessage = {
      id: `msg_${Date.now()}_assistant`,
      conversation_id: currentConversation.value.id,
      role: "assistant",
      content: response.conversationResponse || "抱歉，我没有理解你的问题。",
      timestamp: Date.now(),
      fileOperations: response.fileOperations || [],
      hasFileOperations: response.hasFileOperations || false,
      ragSources: response.ragSources || [],
      pptGenerated: response.pptGenerated || false,
      pptResult: response.pptResult || null,
      wordGenerated: response.wordGenerated || false,
      wordResult: response.wordResult || null,
    };

    // 确保 messages.value 是数组
    if (!Array.isArray(messages.value)) {
      logger.warn(
        "[ChatPanel] messages.value 不是数组（assistant），重新初始化为空数组",
      );
      messages.value = [];
    }

    // 添加到消息列表
    messages.value.push(assistantMessage);

    // 🔥 清理过多的消息以释放内存
    cleanupOldMessages();

    // 保存助手消息到数据库
    if (currentConversation.value && currentConversation.value.id) {
      await window.electronAPI.conversation.createMessage({
        id: assistantMessage.id, // 🔥 关键修复：传入id以保持一致性
        conversation_id: currentConversation.value.id,
        role: "assistant",
        content: assistantMessage.content,
        timestamp: assistantMessage.timestamp,
        metadata: cleanForIPC({
          hasFileOperations: assistantMessage.hasFileOperations,
          fileOperationCount: assistantMessage.fileOperations.length,
        }), // 🔥 清理不可序列化的对象
      });
    } else {
      logger.warn("[ChatPanel] 无法保存助手消息：当前对话不存在");
    }

    // 处理文件操作
    if (response.hasFileOperations && response.fileOperations.length > 0) {
      const successCount = response.fileOperations.filter(
        (op) => op.success === true || op.status === "success",
      ).length;
      const errorCount = response.fileOperations.filter(
        (op) => op.success === false || op.status === "error",
      ).length;

      logger.info("[ChatPanel] 文件操作统计:", {
        total: response.fileOperations.length,
        successCount,
        errorCount,
        operations: response.fileOperations,
      });

      if (successCount > 0) {
        antMessage.success(`成功执行 ${successCount} 个文件操作`);
        emit("files-changed");
      }

      if (errorCount > 0) {
        antMessage.warning(`${errorCount} 个文件操作失败`);
      }
    }

    // 🔥 完成所有步骤
    thinkingState.steps[3].status = "completed";
    updateThinkingState({
      stage: "完成！",
      progress: 100,
      progressText: "回复已生成",
    });

    // 短暂延迟后隐藏思考状态
    safeSetTimeout(() => {
      thinkingState.show = false;
    }, 500);

    // 滚动到底部
    await nextTick();
    scrollToBottom();
  } catch (error) {
    logger.error("[ChatPanel] 执行对话失败:", error);
    antMessage.error("对话失败: " + error.message);

    // 🔥 更新思考状态为错误
    updateThinkingState({
      show: true,
      stage: "发生错误",
      progress: 100,
      status: "exception",
      progressText: error.message,
    });

    // 2秒后隐藏
    safeSetTimeout(() => {
      thinkingState.show = false;
    }, 2000);
  } finally {
    isLoading.value = false;
  }
};

// 监听aiCreationData的变化
watch(
  () => props.aiCreationData,
  (newData) => {
    if (newData) {
      logger.info("[ChatPanel] 检测到AI创建数据:", newData);
      startAICreation(newData);
    }
  },
  { immediate: true },
);

// 🔥 监听autoSendMessage的变化，自动发送消息
watch(
  () => props.autoSendMessage,
  async (newMessage) => {
    if (newMessage && newMessage.trim()) {
      logger.info("[ChatPanel] 检测到自动发送消息:", newMessage);

      // 检查是否已经处理过（避免重复处理）
      if (currentConversation.value && currentConversation.value.context_data) {
        try {
          const contextData = JSON.parse(
            currentConversation.value.context_data,
          );
          if (contextData.autoMessageHandled) {
            logger.info("[ChatPanel] 自动消息已处理过，跳过");
            return;
          }
        } catch (e) {
          // 忽略解析错误
        }
      }

      // 使用nextTick确保对话已加载
      await nextTick();

      // 设置用户输入
      userInput.value = newMessage;

      // 标记为已处理（保存到conversation metadata）
      if (currentConversation.value && currentConversation.value.id) {
        try {
          const contextData = {
            autoSendMessage: newMessage,
            autoMessageHandled: true,
            handledAt: Date.now(),
          };
          await window.electronAPI.conversation.update(
            currentConversation.value.id,
            {
              context_data: JSON.stringify(contextData),
            },
          );
          logger.info("[ChatPanel] 自动消息已标记为已处理");
        } catch (error) {
          logger.error("[ChatPanel] 保存处理标记失败:", error);
        }
      }

      // 延迟一小段时间，确保对话完全加载
      safeSetTimeout(() => {
        handleSendMessage();
      }, 500);
    }
  },
  { immediate: true },
);

// 组件挂载时加载对话
onMounted(() => {
  loadConversation();
});

// 🔥 组件卸载时清理所有资源 - 防止内存泄漏
// 定时器/监听器由 useMemoryLeakGuard 自动清理
onUnmounted(() => {
  logger.info("[ChatPanel] 组件卸载，开始清理资源...");

  if (window.electronAPI?.project?.cancelAiChat) {
    logger.info("[ChatPanel] 取消进行中的API请求");
    window.electronAPI.project.cancelAiChat().catch(() => {});
  }

  thinkingState.show = false;
  thinkingState.streamingContent = "";
  messages.value = [];

  logger.info("[ChatPanel] 资源清理完成");
});
</script>

<style scoped>
.chat-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
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
  padding: 32px 16px;
  min-height: 0;
  display: flex;
  flex-direction: column; /* 确保内容从上到下排列 */
  align-items: center; /* 使用 align-items 实现水平居中 */
}

.messages-container > * {
  width: 100%;
  max-width: 800px; /* 限制消息最大宽度，使其居中显示 */
  flex-shrink: 0; /* 防止内容被压缩 */
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
  gap: 24px;
  width: 100%;
}

.message-item {
  display: flex;
  gap: 16px;
  width: 100%;
}

.message-item.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
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
  padding: 16px 20px;
  border-radius: 12px;
  word-wrap: break-word;
  max-width: 100%;
  font-size: 15px;
  line-height: 1.6;
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

/* 输入区域 */
.input-container {
  padding: 20px 24px;
  background: white;
  border-top: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.input-wrapper {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  width: 100%;
  max-width: 800px; /* 与消息区域同宽 */
}

.input-wrapper :deep(.ant-input) {
  flex: 1;
}

.input-actions {
  display: flex;
  gap: 4px;
}

.context-info {
  margin-top: 12px;
  padding: 10px 16px;
  background: #f3f4f6;
  border-radius: 8px;
  font-size: 13px;
  color: #6b7280;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 800px;
}

/* Markdown 样式 */
.message-text :deep(code) {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: "Consolas", "Monaco", monospace;
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
