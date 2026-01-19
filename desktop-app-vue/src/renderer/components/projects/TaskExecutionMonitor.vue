<template>
  <div class="task-execution-monitor">
    <!-- 任务标题和进度 -->
    <div class="task-header">
      <div class="task-title-row">
        <h3 class="task-title">
          {{ taskPlan.task_title }}
        </h3>
        <a-tag
          :color="getStatusColor(taskPlan.status)"
          class="status-tag"
        >
          {{ getStatusText(taskPlan.status) }}
        </a-tag>
      </div>

      <div class="progress-section">
        <a-progress
          :percent="taskPlan.progress_percentage"
          :status="getProgressStatus(taskPlan.status)"
          :show-info="true"
        />
        <div class="progress-info">
          <span class="step-counter">步骤 {{ taskPlan.current_step }}/{{ taskPlan.total_steps }}</span>
          <span
            v-if="duration"
            class="duration"
          >{{ duration }}</span>
        </div>
      </div>
    </div>

    <!-- 对话式展示区域 -->
    <div class="conversation-display">
      <!-- AI回复消息 -->
      <div class="ai-message">
        <div class="message-content">
          {{ taskPlan.ai_response || '这个要求非常清晰！我这就帮你将PPT的第1页内容整体和机构附件保持一致。' }}
        </div>

        <!-- 步骤折叠面板 -->
        <div class="steps-collapse-panel">
          <div
            class="steps-header"
            @click="toggleAllSteps"
          >
            <CaretRightOutlined :class="['collapse-icon', { expanded: allStepsExpanded }]" />
            <span class="steps-count">{{ taskPlan.total_steps || taskPlan.subtasks?.length || 0 }}个步骤</span>
          </div>

          <!-- 展开后的步骤列表 -->
          <transition name="slide">
            <div
              v-show="allStepsExpanded"
              class="steps-list"
            >
              <div
                v-for="subtask in taskPlan.subtasks"
                :key="subtask.id"
                :class="['step-item', `status-${subtask.status}`]"
              >
                <div class="step-icon">
                  <CheckCircleOutlined
                    v-if="subtask.status === 'completed'"
                    style="color: #52c41a;"
                  />
                  <LoadingOutlined
                    v-else-if="subtask.status === 'in_progress'"
                    spin
                    style="color: #1677FF;"
                  />
                  <ClockCircleOutlined
                    v-else
                    style="color: #d9d9d9;"
                  />
                </div>
                <div class="step-content">
                  <div class="step-title">
                    {{ subtask.title }}
                  </div>
                  <div
                    v-if="subtask.description"
                    class="step-description"
                  >
                    {{ subtask.description }}
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>

        <!-- 附件文件展示 -->
        <div
          v-if="completedFiles.length > 0"
          class="attachments-section"
        >
          <div
            v-for="file in completedFiles"
            :key="file.path"
            class="attachment-card"
            @click="handleFileClick(file.path, file.subtask)"
          >
            <div class="file-icon-wrapper">
              <FileIcon
                :filename="file.name"
                size="large"
              />
            </div>
            <div class="file-info">
              <div class="file-name">
                {{ file.name }}
              </div>
              <div
                v-if="file.hint"
                class="file-hint"
              >
                {{ file.hint }}
              </div>
            </div>
            <div class="file-actions">
              <a-button
                type="text"
                size="small"
                @click.stop="handleContinueEdit(file)"
              >
                根据这个来改
              </a-button>
            </div>
          </div>
        </div>
      </div>

      <!-- AI建议的后续问题 -->
      <div
        v-if="suggestedQuestions.length > 0"
        class="ai-suggestions"
      >
        <div class="suggestions-label">
          对第1页进行变更：
        </div>
        <div class="suggestions-list">
          <div
            v-for="(question, index) in suggestedQuestions"
            :key="index"
            class="suggestion-item"
            @click="handleSuggestionClick(question)"
          >
            <span class="suggestion-text">{{ question }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 原有的子任务列表（可选，用于详细调试） -->
    <div
      v-if="showDetailedView"
      class="subtasks-container"
    >
      <div
        v-for="subtask in taskPlan.subtasks"
        :key="subtask.id"
        :class="['subtask-item', `status-${subtask.status}`]"
      >
        <!-- 子任务头部 -->
        <div
          class="subtask-header"
          @click="toggleSubtask(subtask.id)"
        >
          <div class="subtask-left">
            <a-badge
              :status="getBadgeStatus(subtask.status)"
              :text="`步骤 ${subtask.step}`"
            />
            <span class="subtask-title">{{ subtask.title }}</span>
          </div>

          <div class="subtask-right">
            <span
              v-if="subtask.tool"
              class="subtask-tool"
            >
              <ToolOutlined /> {{ getToolLabel(subtask.tool) }}
            </span>
            <CaretDownOutlined
              :class="['expand-icon', { expanded: expandedSubtasks.has(subtask.id) }]"
            />
          </div>
        </div>

        <!-- 子任务详情（可展开） -->
        <transition name="slide">
          <div
            v-show="expandedSubtasks.has(subtask.id)"
            class="subtask-details"
          >
            <!-- 描述 -->
            <div
              v-if="subtask.description"
              class="subtask-description"
            >
              {{ subtask.description }}
            </div>

            <!-- 执行中的命令 -->
            <div
              v-if="subtask.status === 'in_progress' && subtask.command"
              class="executing-command"
            >
              <div class="command-label">
                <LoadingOutlined spin /> 正在执行
              </div>
              <div class="command-box">
                <pre class="command-text">{{ subtask.command }}</pre>
                <a-button
                  size="small"
                  type="text"
                  class="copy-btn"
                  @click="copyCommand(subtask.command)"
                >
                  <CopyOutlined />
                </a-button>
              </div>
            </div>

            <!-- 完成后的结果文件 -->
            <div
              v-if="subtask.status === 'completed' && subtask.output_files?.length"
              class="output-files"
            >
              <div class="output-label">
                <CheckCircleOutlined style="color: #52c41a;" /> 输出文件
              </div>
              <div class="files-list">
                <div
                  v-for="file in subtask.output_files"
                  :key="file"
                  class="file-item"
                  @click="handleFileClick(file, subtask)"
                >
                  <FileIcon :filename="file" />
                  <span class="file-name">{{ file }}</span>
                  <EyeOutlined class="preview-icon" />
                </div>
              </div>
            </div>

            <!-- 执行结果 -->
            <div
              v-if="subtask.result && subtask.status === 'completed'"
              class="subtask-result"
            >
              <div class="result-label">
                执行结果
              </div>
              <div class="result-content">
                <template v-if="typeof subtask.result === 'string'">
                  {{ subtask.result }}
                </template>
                <template v-else-if="subtask.result.type === 'text'">
                  <pre class="result-text">{{ subtask.result.content }}</pre>
                </template>
                <template v-else>
                  <pre class="result-json">{{ JSON.stringify(subtask.result, null, 2) }}</pre>
                </template>
              </div>
            </div>

            <!-- 错误信息 -->
            <div
              v-if="subtask.status === 'failed' && subtask.error"
              class="subtask-error"
            >
              <CloseCircleOutlined style="color: #ff4d4f;" />
              <span class="error-message">{{ subtask.error }}</span>
            </div>

            <!-- 时间信息 -->
            <div
              v-if="subtask.started_at"
              class="subtask-time"
            >
              <ClockCircleOutlined />
              <span v-if="subtask.completed_at">
                耗时: {{ formatDuration(subtask.completed_at - subtask.started_at) }}
              </span>
              <span v-else>
                开始于: {{ formatTime(subtask.started_at) }}
              </span>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div
      v-if="showActions"
      class="task-footer"
    >
      <a-space>
        <a-button
          v-if="taskPlan.status === 'in_progress'"
          danger
          @click="handleCancel"
        >
          <StopOutlined /> 取消任务
        </a-button>

        <a-button
          v-if="taskPlan.status === 'completed'"
          type="primary"
          @click="handleViewResults"
        >
          <FolderOpenOutlined /> 查看结果
        </a-button>

        <a-button
          v-if="taskPlan.status === 'failed'"
          @click="handleRetry"
        >
          <ReloadOutlined /> 重试
        </a-button>

        <a-button @click="handleClose">
          关闭
        </a-button>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  ToolOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  ClockCircleOutlined,
  StopOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import FileIcon from './FileIcon.vue';

const props = defineProps({
  taskPlan: {
    type: Object,
    required: true
  },
  showActions: {
    type: Boolean,
    default: true
  },
  showDetailedView: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['cancel', 'close', 'viewResults', 'retry', 'fileClick', 'continueEdit', 'suggestionClick']);

// 展开的子任务
const expandedSubtasks = ref(new Set());

// 所有步骤展开状态
const allStepsExpanded = ref(false);

// 已完成的文件列表
const completedFiles = computed(() => {
  const files = [];
  props.taskPlan.subtasks?.forEach(subtask => {
    if (subtask.status === 'completed' && subtask.output_files?.length) {
      subtask.output_files.forEach(filePath => {
        const fileName = filePath.split('/').pop();
        files.push({
          path: filePath,
          name: fileName,
          subtask: subtask,
          hint: getFileHint(fileName)
        });
      });
    }
  });
  return files;
});

// AI建议的后续问题
const suggestedQuestions = computed(() => {
  // 可以从taskPlan中获取，或者根据任务类型生成
  return props.taskPlan.suggested_questions || [
    '<附件有几页也要有几页 不是第一页 全部要可编辑>'
  ];
});

// 获取文件提示文本
const getFileHint = (fileName) => {
  const ext = fileName.split('.').pop().toLowerCase();
  const hints = {
    'pptx': '可编辑PPT制作指南(修改版1)',
    'docx': '可编辑文档',
    'xlsx': '可编辑表格',
    'pdf': 'PDF文档',
    'html': '网页文件'
  };
  return hints[ext] || '';
};

// 切换所有步骤展开状态
const toggleAllSteps = () => {
  allStepsExpanded.value = !allStepsExpanded.value;
};

// 处理继续编辑
const handleContinueEdit = (file) => {
  emit('continueEdit', { file, taskPlan: props.taskPlan });
  message.info(`继续编辑：${file.name}`);
};

// 处理建议点击
const handleSuggestionClick = (question) => {
  emit('suggestionClick', { question, taskPlan: props.taskPlan });
  message.info(`已选择建议：${question}`);
};

// 计算持续时间
const duration = computed(() => {
  if (!props.taskPlan.started_at) {return null;}

  const endTime = props.taskPlan.completed_at || Date.now();
  const ms = endTime - props.taskPlan.started_at;
  return formatDuration(ms);
});

// 格式化持续时间
const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
};

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

// 获取状态颜色
const getStatusColor = (status) => {
  const colors = {
    pending: 'default',
    in_progress: 'processing',
    completed: 'success',
    failed: 'error',
    cancelled: 'warning'
  };
  return colors[status] || 'default';
};

// 获取状态文本
const getStatusText = (status) => {
  const texts = {
    pending: '等待中',
    in_progress: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
  };
  return texts[status] || status;
};

// 获取进度条状态
const getProgressStatus = (status) => {
  if (status === 'completed') {return 'success';}
  if (status === 'failed') {return 'exception';}
  if (status === 'in_progress') {return 'active';}
  return 'normal';
};

// 获取Badge状态
const getBadgeStatus = (status) => {
  const statusMap = {
    pending: 'default',
    in_progress: 'processing',
    completed: 'success',
    failed: 'error'
  };
  return statusMap[status] || 'default';
};

// 获取工具标签
const getToolLabel = (tool) => {
  const labels = {
    'web-engine': '网页',
    'document-engine': '文档',
    'data-engine': '数据',
    'ppt-engine': 'PPT',
    'code-engine': '代码',
    'image-engine': '图像'
  };
  return labels[tool] || tool;
};

// 切换子任务展开状态
const toggleSubtask = (subtaskId) => {
  if (expandedSubtasks.value.has(subtaskId)) {
    expandedSubtasks.value.delete(subtaskId);
  } else {
    expandedSubtasks.value.add(subtaskId);
  }
};

// 复制命令
const copyCommand = (command) => {
  navigator.clipboard.writeText(command).then(() => {
    message.success('命令已复制到剪贴板');
  }).catch(() => {
    message.error('复制失败');
  });
};

// 处理文件点击
const handleFileClick = (file, subtask) => {
  emit('fileClick', { file, subtask, taskPlan: props.taskPlan });
};

// 处理取消
const handleCancel = () => {
  emit('cancel', props.taskPlan.id);
};

// 处理关闭
const handleClose = () => {
  emit('close');
};

// 处理查看结果
const handleViewResults = () => {
  emit('viewResults', props.taskPlan);
};

// 处理重试
const handleRetry = () => {
  emit('retry', props.taskPlan);
};

// 监听任务状态变化，自动展开进行中的子任务
watch(() => props.taskPlan.subtasks, (newSubtasks) => {
  newSubtasks.forEach(subtask => {
    if (subtask.status === 'in_progress' && !expandedSubtasks.value.has(subtask.id)) {
      expandedSubtasks.value.add(subtask.id);
    }
  });
}, { deep: true });

// 初始化时展开第一个子任务
onMounted(() => {
  if (props.taskPlan.subtasks?.length > 0) {
    expandedSubtasks.value.add(props.taskPlan.subtasks[0].id);
  }
});
</script>

<style scoped lang="scss">
.task-execution-monitor {
  background: #ffffff;
  border-radius: 8px;
  border: 1px solid #e8e8e8;
  overflow: hidden;
}

/* 对话式展示区域 */
.conversation-display {
  margin-bottom: 24px;
}

.ai-message {
  background: #F5F7FA;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;

  .message-content {
    font-size: 15px;
    color: #333333;
    line-height: 1.6;
    margin-bottom: 16px;
  }
}

/* 步骤折叠面板 */
.steps-collapse-panel {
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;

  .steps-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
    transition: all 0.3s;

    &:hover {
      background: #F9FAFB;
    }

    .collapse-icon {
      font-size: 14px;
      color: #666666;
      transition: transform 0.3s;

      &.expanded {
        transform: rotate(90deg);
      }
    }

    .steps-count {
      font-size: 14px;
      color: #333333;
      font-weight: 500;
    }
  }

  .steps-list {
    border-top: 1px solid #E5E7EB;
    padding: 12px 0;

    .step-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      transition: background 0.2s;

      &:hover {
        background: #F9FAFB;
      }

      .step-icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        margin-top: 2px;
      }

      .step-content {
        flex: 1;

        .step-title {
          font-size: 14px;
          color: #333333;
          font-weight: 500;
          margin-bottom: 4px;
        }

        .step-description {
          font-size: 13px;
          color: #666666;
          line-height: 1.5;
        }
      }

      &.status-completed {
        opacity: 0.8;
      }

      &.status-in_progress {
        background: #F0F9FF;
      }
    }
  }
}

/* 附件文件展示 */
.attachments-section {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .attachment-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: #FFFFFF;
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s;

    &:hover {
      border-color: #1677FF;
      box-shadow: 0 4px 12px rgba(22, 119, 255, 0.1);
      transform: translateY(-2px);
    }

    .file-icon-wrapper {
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
    }

    .file-info {
      flex: 1;

      .file-name {
        font-size: 14px;
        color: #333333;
        font-weight: 500;
        margin-bottom: 4px;
      }

      .file-hint {
        font-size: 13px;
        color: #999999;
      }
    }

    .file-actions {
      flex-shrink: 0;

      .ant-btn {
        color: #1677FF;
        font-size: 13px;

        &:hover {
          color: #4096FF;
          background: #F0F9FF;
        }
      }
    }
  }
}

/* AI建议的后续问题 */
.ai-suggestions {
  background: #FFFBF0;
  border: 1px solid #FFE7BA;
  border-radius: 8px;
  padding: 16px;

  .suggestions-label {
    font-size: 13px;
    color: #666666;
    margin-bottom: 12px;
  }

  .suggestions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .suggestion-item {
      padding: 12px;
      background: #FFFFFF;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.3s;

      &:hover {
        border-color: #FAAD14;
        background: #FFF7E6;
        transform: translateX(4px);
      }

      .suggestion-text {
        font-size: 14px;
        color: #333333;
      }
    }
  }
}

/* 幻灯片过渡动画 */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
  max-height: 500px;
  overflow: hidden;
}

.slide-enter-from,
.slide-leave-to {
  max-height: 0;
  opacity: 0;
}

/* 任务头部 */
.task-header {
  padding: 20px 24px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
}

.task-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.task-title {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  color: #262626;
}

.status-tag {
  font-size: 14px;
}

.progress-section {
  .progress-info {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 13px;
    color: #8c8c8c;
  }

  .step-counter {
    font-weight: 500;
  }
}

/* 子任务容器 */
.subtasks-container {
  padding: 16px 0;
}

.subtask-item {
  border-bottom: 1px solid #f0f0f0;

  &:last-child {
    border-bottom: none;
  }

  &.status-in_progress {
    background: #f6ffed;
  }

  &.status-completed {
    .subtask-header {
      opacity: 0.7;
    }
  }

  &.status-failed {
    background: #fff1f0;
  }
}

/* 子任务头部 */
.subtask-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  cursor: pointer;
  transition: background-color 0.3s;

  &:hover {
    background: #fafafa;
  }
}

.subtask-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.subtask-title {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
}

.subtask-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.subtask-tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #8c8c8c;
  padding: 2px 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.expand-icon {
  color: #8c8c8c;
  transition: transform 0.3s;

  &.expanded {
    transform: rotate(180deg);
  }
}

/* 子任务详情 */
.subtask-details {
  padding: 0 24px 16px 24px;
  margin-left: 40px;
}

.subtask-description {
  margin-bottom: 12px;
  padding: 12px;
  background: #fafafa;
  border-radius: 4px;
  font-size: 14px;
  color: #595959;
  line-height: 1.6;
}

/* 执行命令 */
.executing-command {
  margin-bottom: 12px;
}

.command-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #1890ff;
}

.command-box {
  position: relative;
  background: #262626;
  border-radius: 4px;
  padding: 12px 40px 12px 12px;

  .copy-btn {
    position: absolute;
    right: 8px;
    top: 8px;
    color: #ffffff;
    opacity: 0.6;

    &:hover {
      opacity: 1;
    }
  }
}

.command-text {
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  color: #52c41a;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 输出文件 */
.output-files {
  margin-bottom: 12px;
}

.output-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #52c41a;
}

.files-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fafafa;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    background: #f0f0f0;
    border-color: #1890ff;

    .preview-icon {
      opacity: 1;
    }
  }
}

.file-name {
  flex: 1;
  font-size: 14px;
  color: #262626;
}

.preview-icon {
  color: #1890ff;
  opacity: 0;
  transition: opacity 0.3s;
}

/* 执行结果 */
.subtask-result {
  margin-bottom: 12px;
}

.result-label {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #8c8c8c;
}

.result-content {
  padding: 12px;
  background: #fafafa;
  border-radius: 4px;
  max-height: 300px;
  overflow: auto;
}

.result-text,
.result-json {
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  color: #262626;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 错误信息 */
.subtask-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  border-radius: 4px;
  margin-bottom: 12px;
}

.error-message {
  font-size: 14px;
  color: #ff4d4f;
  line-height: 1.6;
}

/* 时间信息 */
.subtask-time {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 8px;
}

/* 底部操作栏 */
.task-footer {
  padding: 16px 24px;
  background: #fafafa;
  border-top: 1px solid #e8e8e8;
  display: flex;
  justify-content: flex-end;
}

/* 动画 */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
  max-height: 1000px;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-top: 0;
  margin-bottom: 0;
}

/* 滚动条 */
.result-content {
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: #d9d9d9;
    border-radius: 3px;

    &:hover {
      background: #bfbfbf;
    }
  }

  &::-webkit-scrollbar-track {
    background: #f5f5f5;
  }
}
</style>
