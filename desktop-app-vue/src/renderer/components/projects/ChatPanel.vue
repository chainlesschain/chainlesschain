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
        <h4>{{ getEmptyStateText(contextMode) }}</h4>
        <p class="empty-hint">
          {{ getEmptyHint(contextMode, currentFile?.file_name) }}
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
        <template #default="{ message, index: _index }">
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
              <!-- eslint-disable vue/no-v-html -- sanitized via safeHtml / renderMarkdown / DOMPurify; see docs/audits/AUDIT_2026-04-22.md §3 -->
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
          :placeholder="
            getInputPlaceholder(contextMode, currentFile?.file_name)
          "
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
import { logger } from "@/utils/logger";

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
  createUserMessage,
  createAssistantMessage,
} from "../../utils/messageTypes";
import { marked } from "marked";
// 🔥 导入后续输入意图处理助手
import {
  findExecutingTask,
  buildClassificationContext,
  formatIntentLog,
  handleClassificationError,
} from "../../utils/followupIntentHelper";
import {
  cleanForIPC,
  getEmptyStateText,
  getEmptyHint,
  getInputPlaceholder,
  renderMarkdown,
  formatTime,
} from "./chatPanelUtils";
import { useMemoryLeakGuard } from "@/composables/useMemoryLeakGuard";
import { useTaskPlanning } from "@/composables/useTaskPlanning";
import { useChatExecution } from "@/composables/useChatExecution";
import { useConversationPersistence } from "@/composables/useConversationPersistence";
import { useFollowupIntent } from "@/composables/useFollowupIntent";
import { useMessageMemory } from "@/composables/useMessageMemory";

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

const emit = defineEmits([
  "conversationLoaded",
  "creation-complete",
  "files-changed",
]);

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

// 🔥 消息内存管理配置（messageLoadState + cleanupThreshold 已下沉到
// useMessageMemory；MAX_MESSAGES_IN_MEMORY 留在此处因 useConversation-
// Persistence 也消费这个值，保持单一来源）
const MAX_MESSAGES_IN_MEMORY = 200;

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
// getEmptyStateText / getEmptyHint / getInputPlaceholder / renderMarkdown /
// formatTime moved to ./chatPanelUtils.js. Template call sites pass
// contextMode and props.currentFile?.file_name through explicitly.

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

// ============ 内存 / 滚动 / 思考状态（已抽取到 useMessageMemory composable） ============

const {
  cleanupOldMessages,
  scrollToBottom,
  handleLoadMoreMessages,
  handleScrollToBottom,
  handleCancelThinking,
  updateThinkingState,
} = useMessageMemory({
  messages,
  currentConversation,
  isLoading,
  thinkingState,
  virtualListRef,
  messagesContainer,
  maxMessagesInMemory: MAX_MESSAGES_IN_MEMORY,
});

// ============ 对话持久化（已抽取到 useConversationPersistence composable） ============

const { createConversation, loadConversation } = useConversationPersistence({
  messages,
  currentConversation,
  contextMode,
  props,
  maxMessagesInMemory: MAX_MESSAGES_IN_MEMORY,
  scrollToBottom,
  emit,
});

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

// ============ 任务规划相关函数（已抽取到 useTaskPlanning composable） ============

const { shouldUsePlanning, startTaskPlanning, generateTaskPlanMessage } =
  useTaskPlanning({
    messages,
    currentConversation,
    contextMode,
    props,
    scrollToBottom,
    createConversation,
    safeSetTimeout,
    safeRegisterListener,
    emit,
  });

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

// ============ 后续输入意图（已抽取到 useFollowupIntent composable） ============

const { handleFollowupIntent } = useFollowupIntent({
  messages,
  currentConversation,
  scrollToBottom,
  startTaskPlanning,
});

// ============ 意图确认 + 对话执行（已抽取到 useChatExecution composable） ============

const { handleIntentConfirm, handleIntentCorrect, understandUserIntent } =
  useChatExecution({
    messages,
    currentConversation,
    contextMode,
    isLoading,
    thinkingState,
    props,
    scrollToBottom,
    createConversation,
    updateThinkingState,
    getProjectFiles,
    buildSmartContextHistory,
    cleanupOldMessages,
    safeSetTimeout,
    emit,
  });

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
