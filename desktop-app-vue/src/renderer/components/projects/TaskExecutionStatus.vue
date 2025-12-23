<template>
  <div class="task-execution-status">
    <!-- 步骤列表 (可折叠) -->
    <div v-if="steps.length > 0" class="steps-container">
      <div
        class="steps-header"
        @click="toggleStepsExpanded"
      >
        <span class="steps-icon">
          <RightOutlined :class="{ 'expanded': stepsExpanded }" />
        </span>
        <span class="steps-title">{{ steps.length }} 个步骤</span>
      </div>

      <div v-show="stepsExpanded" class="steps-list">
        <div
          v-for="(step, index) in steps"
          :key="step.id || index"
          :class="['step-item', `status-${step.status}`]"
        >
          <div class="step-icon">
            <CheckCircleOutlined v-if="step.status === 'completed'" />
            <LoadingOutlined v-else-if="step.status === 'running'" spin />
            <ClockCircleOutlined v-else />
          </div>
          <div class="step-content">
            <div class="step-title">{{ step.title }}</div>
            <div v-if="step.description" class="step-description">
              {{ step.description }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 当前正在执行的任务 -->
    <div v-if="currentTask" class="current-task">
      <div class="task-icon">
        <LoadingOutlined spin />
      </div>
      <div class="task-content">
        <div class="task-title">{{ currentTask.title }}</div>
        <div v-if="currentTask.progress !== undefined" class="task-progress">
          <a-progress
            :percent="currentTask.progress"
            :show-info="false"
            size="small"
          />
        </div>
      </div>
    </div>

    <!-- 正在思考状态 -->
    <div v-if="thinking" class="thinking-status">
      <span class="thinking-icon">
        <LoadingOutlined spin />
      </span>
      <span class="thinking-text">正在思考...</span>
    </div>

    <!-- 生成的文件列表 -->
    <div v-if="generatedFiles.length > 0" class="generated-files">
      <div class="files-header">
        <FileOutlined />
        <span>{{ action }}文件</span>
      </div>
      <div class="files-list">
        <div
          v-for="file in generatedFiles"
          :key="file.id || file.path"
          class="file-item"
          @click="$emit('file-click', file)"
        >
          <div class="file-icon">
            <component :is="getFileIcon(file.type)" />
          </div>
          <div class="file-info">
            <div class="file-name">{{ file.name }}</div>
            <div v-if="file.description" class="file-description">
              {{ file.description }}
            </div>
          </div>
          <div class="file-actions">
            <a-button
              type="text"
              size="small"
              @click.stop="$emit('file-preview', file)"
            >
              <EyeOutlined />
            </a-button>
            <a-button
              type="text"
              size="small"
              @click.stop="$emit('file-download', file)"
            >
              <DownloadOutlined />
            </a-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import {
  RightOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  FileOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileWordOutlined,
  CodeOutlined,
  EyeOutlined,
  DownloadOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  steps: {
    type: Array,
    default: () => [],
    // 每个step: { id, title, description, status: 'pending'|'running'|'completed' }
  },
  currentTask: {
    type: Object,
    default: null,
    // { title, progress }
  },
  thinking: {
    type: Boolean,
    default: false,
  },
  generatedFiles: {
    type: Array,
    default: () => [],
    // 每个file: { id, name, path, type, description }
  },
  action: {
    type: String,
    default: '文件', // '生成', '修改', '完成'等
  },
});

const emit = defineEmits(['file-click', 'file-preview', 'file-download']);

const stepsExpanded = ref(true);

const toggleStepsExpanded = () => {
  stepsExpanded.value = !stepsExpanded.value;
};

const getFileIcon = (type) => {
  const iconMap = {
    'text': FileTextOutlined,
    'code': CodeOutlined,
    'image': FileImageOutlined,
    'pdf': FilePdfOutlined,
    'excel': FileExcelOutlined,
    'ppt': FilePptOutlined,
    'word': FileWordOutlined,
    'html': CodeOutlined,
    'md': FileTextOutlined,
  };
  return iconMap[type] || FileOutlined;
};
</script>

<style scoped lang="scss">
.task-execution-status {
  padding: 12px;
  background: #f5f7fa;
  border-radius: 8px;
  margin: 8px 0;
}

/* 步骤容器 */
.steps-container {
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }
}

.steps-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.2s;

  &:hover {
    background: rgba(0, 0, 0, 0.02);
  }

  .steps-icon {
    display: flex;
    align-items: center;
    color: #666;
    transition: transform 0.2s;

    .expanded {
      transform: rotate(90deg);
    }
  }

  .steps-title {
    font-size: 14px;
    font-weight: 500;
    color: #333;
  }
}

.steps-list {
  padding: 8px 0 8px 24px;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: white;

  &:last-child {
    margin-bottom: 0;
  }

  &.status-completed {
    .step-icon {
      color: #52c41a;
    }
  }

  &.status-running {
    .step-icon {
      color: #1677ff;
    }
    background: #e6f7ff;
  }

  &.status-pending {
    .step-icon {
      color: #d9d9d9;
    }
  }

  .step-icon {
    font-size: 16px;
    padding-top: 2px;
  }

  .step-content {
    flex: 1;

    .step-title {
      font-size: 14px;
      color: #333;
      margin-bottom: 4px;
    }

    .step-description {
      font-size: 12px;
      color: #666;
      line-height: 1.5;
    }
  }
}

/* 当前任务 */
.current-task {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: white;
  border-radius: 6px;
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }

  .task-icon {
    font-size: 18px;
    color: #1677ff;
  }

  .task-content {
    flex: 1;

    .task-title {
      font-size: 14px;
      color: #333;
      margin-bottom: 8px;
    }

    .task-progress {
      :deep(.ant-progress-line) {
        margin: 0;
      }
    }
  }
}

/* 思考状态 */
.thinking-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: white;
  border-radius: 6px;

  .thinking-icon {
    font-size: 16px;
    color: #1677ff;
  }

  .thinking-text {
    font-size: 14px;
    color: #666;
  }
}

/* 生成的文件 */
.generated-files {
  background: white;
  border-radius: 6px;
  padding: 12px;

  .files-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #f0f0f0;
    font-size: 14px;
    font-weight: 500;
    color: #333;

    .anticon {
      font-size: 16px;
      color: #1677ff;
    }
  }

  .files-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: 6px;
    background: #fafafa;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: #f0f0f0;

      .file-actions {
        opacity: 1;
      }
    }

    .file-icon {
      font-size: 20px;
      color: #1677ff;
    }

    .file-info {
      flex: 1;
      min-width: 0;

      .file-name {
        font-size: 13px;
        color: #333;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .file-description {
        font-size: 12px;
        color: #999;
        margin-top: 2px;
      }
    }

    .file-actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;

      .ant-btn {
        padding: 4px;
      }
    }
  }
}
</style>
