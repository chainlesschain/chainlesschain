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

    <!-- 对话历史显示组件 -->
    <ConversationHistoryView
      :messages="messages"
      :is-loading="isLoading"
      :loading-text="'正在思考...'"
      :empty-title="getEmptyStateText()"
      :empty-hint="getEmptyHint()"
      @source-click="openFile"
      @file-click="handleFileClick"
    />

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
  SendOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons-vue';
import ConversationHistoryView from './ConversationHistoryView.vue';

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
  aiCreationData: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['conversationLoaded', 'creation-complete']);

// 响应式状态
const contextMode = ref('project'); // 'project' | 'file' | 'global'
const messages = ref([]);
const userInput = ref('');
const isLoading = ref(false);
const messagesContainer = ref(null);
const currentConversation = ref(null);
const creationProgress = ref(null); // AI创建进度数据

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
 * 打开文件
 */
const openFile = (source) => {
  if (!source) return;

  console.log('[ChatPanel] 打开文件:', source);

  // 获取文件路径
  const filePath = source.filePath || source.path || source.metadata?.filePath;

  if (!filePath) {
    antMessage.warning('无法获取文件路径');
    return;
  }

  // 触发事件通知父组件打开文件
  emit('open-file', {
    path: filePath,
    fileName: source.fileName || source.title,
    fileId: source.fileId || source.id
  });
};

/**
 * 处理文件附件点击
 */
const handleFileClick = (file) => {
  if (!file) return;

  console.log('[ChatPanel] 打开附件文件:', file);

  // 触发事件通知父组件打开文件
  emit('open-file', {
    path: file.path || file.filePath,
    fileName: file.name || file.fileName,
    fileId: file.id
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
  if (!window.electronAPI?.project) {
    console.error('[ChatPanel] Project API 不可用:', window.electronAPI);
    antMessage.error('Project API 不可用，请重启应用');
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

  // 检测创建文件的意图
  const inputLower = input.toLowerCase();
  const isCreateFileIntent =
    (inputLower.includes('创建') || inputLower.includes('生成') || inputLower.includes('做') || inputLower.includes('新建')) &&
    (inputLower.includes('文件') || inputLower.includes('ppt') || inputLower.includes('excel') ||
     inputLower.includes('word') || inputLower.includes('pdf') || inputLower.includes('项目'));

  // 特别检测PPT请求
  const isPPTRequest = inputLower.includes('ppt') || inputLower.includes('幻灯片') || inputLower.includes('演示文稿');

  if (isCreateFileIntent) {
    if (isPPTRequest) {
      antMessage.warning({
        content: '💡 提示：当前聊天面板不支持创建PPT文件。建议：\n1. 返回主页，在AI对话框中输入您的需求\n2. 或创建Markdown/Word文档替代',
        duration: 5,
      });
    } else {
      antMessage.info({
        content: '💡 提示：创建新文件请前往主页的"AI对话式创建"功能。\n当前聊天面板主要用于编辑现有文件和对话交流。',
        duration: 4,
      });
    }

    // 仍然继续对话，让AI提供建议
    console.log('[ChatPanel] 检测到创建文件意图，已提示用户，继续AI对话');
  }

  try {
    // 创建用户消息
    const userMessage = {
      id: `msg_${Date.now()}_user`,
      conversation_id: currentConversation.value?.id,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    // 确保 messages.value 是数组
    if (!Array.isArray(messages.value)) {
      console.warn('[ChatPanel] messages.value 不是数组，重新初始化为空数组');
      messages.value = [];
    }

    // 添加到消息列表
    messages.value.push(userMessage);

    // 如果没有当前对话，创建一个
    if (!currentConversation.value) {
      await createConversation();

      // 检查对话是否创建成功
      if (!currentConversation.value) {
        throw new Error('创建对话失败，无法发送消息');
      }
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

    // 获取项目信息和文件列表
    const project = await window.electronAPI.project.get(props.projectId);
    const projectInfo = project ? {
      name: project.name,
      description: project.description || '',
      type: project.project_type || 'general'
    } : null;
    const rawFileList = await getProjectFiles();

    // 清理文件列表，只保留可序列化的字段
    const fileList = Array.isArray(rawFileList) ? rawFileList.map(file => ({
      id: file.id,
      file_name: file.file_name,
      file_path: file.file_path,
      file_type: file.file_type,
      content: file.content,
      size: file.size
    })) : [];

    // 构建对话历史（最近10条）
    const conversationHistory = messages.value.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    // 清理 currentFile，只保留可序列化的字段
    const cleanCurrentFile = props.currentFile ? {
      id: props.currentFile.id,
      file_name: props.currentFile.file_name,
      file_path: props.currentFile.file_path,
      file_type: props.currentFile.file_type,
      content: props.currentFile.content,
      size: props.currentFile.size
    } : null;

    // 调用新的项目AI对话API
    const response = await window.electronAPI.project.aiChat({
      projectId: props.projectId,
      userMessage: input,
      conversationHistory: conversationHistory,
      contextMode: contextMode.value,
      currentFile: cleanCurrentFile,
      projectInfo: projectInfo,
      fileList: fileList
    });

    console.log('[ChatPanel] AI响应:', response);

    // 创建助手消息
    const assistantMessage = {
      id: `msg_${Date.now()}_assistant`,
      conversation_id: currentConversation.value.id,
      role: 'assistant',
      content: response.conversationResponse || '抱歉，我没有理解你的问题。',
      timestamp: Date.now(),
      fileOperations: response.fileOperations || [],
      hasFileOperations: response.hasFileOperations || false,
      ragSources: response.ragSources || []
    };

    // 确保 messages.value 是数组
    if (!Array.isArray(messages.value)) {
      console.warn('[ChatPanel] messages.value 不是数组（assistant），重新初始化为空数组');
      messages.value = [];
    }

    // 添加到消息列表
    messages.value.push(assistantMessage);

    // 保存助手消息到数据库（如果有对话）
    if (currentConversation.value && currentConversation.value.id) {
      await window.electronAPI.conversation.createMessage({
        conversation_id: currentConversation.value.id,
        role: 'assistant',
        content: assistantMessage.content,
        timestamp: Date.now(),
        metadata: {
          hasFileOperations: assistantMessage.hasFileOperations,
          fileOperationCount: assistantMessage.fileOperations.length
        }
      });
    } else {
      console.warn('[ChatPanel] 无法保存助手消息：当前对话不存在');
    }

    // 如果有文件操作成功执行，通知用户并刷新文件树
    if (response.hasFileOperations && response.fileOperations.length > 0) {
      // 兼容两种数据格式：ChatSkillBridge (success: boolean) 和原有格式 (status: 'success')
      const successCount = response.fileOperations.filter(op =>
        op.success === true || op.status === 'success'
      ).length;
      const errorCount = response.fileOperations.filter(op =>
        op.success === false || op.status === 'error'
      ).length;

      console.log('[ChatPanel] 文件操作统计:', {
        total: response.fileOperations.length,
        successCount,
        errorCount,
        operations: response.fileOperations
      });

      if (successCount > 0) {
        antMessage.success(`成功执行 ${successCount} 个文件操作`);
        // 触发文件树刷新事件（如果父组件有监听）
        console.log('[ChatPanel] 触发 files-changed 事件');
        emit('files-changed');
      }

      if (errorCount > 0) {
        antMessage.warning(`${errorCount} 个文件操作失败`);
      }
    }

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
 * 获取项目文件列表
 */
const getProjectFiles = async () => {
  try {
    if (!props.projectId) return [];

    const result = await window.electronAPI.project.getFiles(props.projectId);
    return result.files || [];
  } catch (error) {
    console.error('获取文件列表失败:', error);
    return [];
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
      id: `conv_${Date.now()}`, // 添加ID字段
      title: contextMode.value === 'project' ? '项目对话' : contextMode.value === 'file' ? '文件对话' : '新对话',
      project_id: contextMode.value === 'project' ? props.projectId : null,
      context_type: contextMode.value,
      context_data: contextMode.value === 'file' && props.currentFile
        ? { file_id: props.currentFile.id, file_name: props.currentFile.file_name }
        : null,
    };

    const result = await window.electronAPI.conversation.create(conversationData);

    // 提取对话数据（API返回 {success: true, data: {...}} 格式）
    if (result && result.success && result.data) {
      currentConversation.value = result.data;
      emit('conversationLoaded', currentConversation.value);
    } else {
      throw new Error(result?.error || '创建对话失败');
    }
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
      const result = await window.electronAPI.conversation.getByProject(props.projectId);

      // 提取对话数据（API返回 {success: true, data: [...]} 格式）
      let conversation = null;
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        conversation = result.data[0]; // 取第一个对话
      } else if (result && !result.success) {
        console.warn('[ChatPanel] 获取项目对话失败:', result.error);
      }

      if (conversation) {
        currentConversation.value = conversation;

        // 加载消息
        const loadedMessages = await window.electronAPI.conversation.getMessages(conversation.id);

        // 提取消息数组（API返回 {success: true, data: [...]} 格式）
        if (loadedMessages && loadedMessages.success && Array.isArray(loadedMessages.data)) {
          messages.value = loadedMessages.data;
        } else if (Array.isArray(loadedMessages)) {
          // 兼容直接返回数组的情况
          messages.value = loadedMessages;
        } else {
          messages.value = [];
        }

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

/**
 * 开始AI创建项目
 */
const startAICreation = async (createData) => {
  console.log('[ChatPanel] 开始AI创建项目:', createData);

  // 创建一个系统消息来展示创建过程
  const creationMessage = {
    id: `msg_creation_${Date.now()}`,
    role: 'system',
    type: 'creation',
    content: '正在使用AI创建项目...',
    timestamp: Date.now(),
    progress: {
      currentStage: '',
      stages: [],
      contentByStage: {},
      overallProgress: 0,
      status: 'running',
    },
  };

  messages.value.push(creationMessage);
  isLoading.value = true;

  try {
    // 导入projectStore
    const { useProjectStore } = await import('@/stores/project');
    const projectStore = useProjectStore();

    // 调用流式创建
    await projectStore.createProjectStream(createData, (progressUpdate) => {
      console.log('[ChatPanel] 收到创建进度更新:', progressUpdate);

      // 更新消息中的进度信息
      const message = messages.value.find(m => m.id === creationMessage.id);
      if (message) {
        if (progressUpdate.type === 'progress') {
          message.progress.currentStage = progressUpdate.currentStage;
          message.progress.stages = progressUpdate.stages || [];
          message.content = `正在 ${progressUpdate.currentStage}...`;

          // 计算总进度
          const completedStages = message.progress.stages.filter(s => s.status === 'completed').length;
          const totalStages = message.progress.stages.length || 1;
          message.progress.overallProgress = Math.round((completedStages / totalStages) * 100);
        } else if (progressUpdate.type === 'content') {
          if (!message.progress.contentByStage) {
            message.progress.contentByStage = {};
          }
          if (!message.progress.contentByStage[progressUpdate.currentStage]) {
            message.progress.contentByStage[progressUpdate.currentStage] = '';
          }
          message.progress.contentByStage[progressUpdate.currentStage] = progressUpdate.contentByStage[progressUpdate.currentStage] || '';
        } else if (progressUpdate.type === 'complete') {
          message.content = '✅ 项目创建完成！';
          message.progress.status = 'completed';
          message.progress.overallProgress = 100;
          message.result = progressUpdate.result;

          // 触发完成事件
          emit('creation-complete', progressUpdate.result);

          antMessage.success('项目创建成功！');
        } else if (progressUpdate.type === 'error') {
          message.content = `❌ 创建失败: ${progressUpdate.error}`;
          message.progress.status = 'error';
          message.error = progressUpdate.error;

          antMessage.error('项目创建失败: ' + progressUpdate.error);
        }

        // 滚动到底部
        nextTick(() => scrollToBottom());
      }
    });
  } catch (error) {
    console.error('[ChatPanel] AI创建失败:', error);

    const message = messages.value.find(m => m.id === creationMessage.id);
    if (message) {
      message.content = `❌ 创建失败: ${error.message}`;
      message.progress.status = 'error';
      message.error = error.message;
    }

    antMessage.error('创建项目失败: ' + error.message);
  } finally {
    isLoading.value = false;
  }
};

// 监听aiCreationData的变化
watch(() => props.aiCreationData, (newData) => {
  if (newData) {
    console.log('[ChatPanel] 检测到AI创建数据:', newData);
    startAICreation(newData);
  }
}, { immediate: true });

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
  justify-content: center;
}

.messages-container > * {
  width: 100%;
  max-width: 800px; /* 限制消息最大宽度，使其居中显示 */
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
