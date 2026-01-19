<template>
  <div class="file-editor">
    <!-- 编辑器头部 -->
    <div class="editor-header">
      <div class="header-left">
        <component
          :is="fileIcon"
          class="file-icon"
        />
        <span class="file-name">{{ file.file_name }}</span>
        <a-tag
          v-if="hasChanges"
          color="orange"
          size="small"
        >
          未保存
        </a-tag>
        <a-tag
          v-if="saving"
          color="blue"
          size="small"
        >
          <LoadingOutlined />
          保存中...
        </a-tag>
      </div>

      <div class="header-right">
        <a-tooltip title="自动保存">
          <a-switch
            v-model:checked="autoSave"
            size="small"
            checked-children="自动"
            un-checked-children="手动"
          />
        </a-tooltip>

        <a-tooltip title="保存 (Ctrl+S)">
          <a-button
            type="text"
            size="small"
            :disabled="!hasChanges || saving"
            @click="handleSave"
          >
            <SaveOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip title="刷新">
          <a-button
            type="text"
            size="small"
            @click="handleRefresh"
          >
            <ReloadOutlined />
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- 编辑器内容 - Monaco Editor -->
    <div class="editor-content">
      <MonacoEditor
        ref="editorRef"
        v-model="content"
        :file="file"
        :auto-save="autoSave"
        :auto-save-delay="1000"
        @change="handleChange"
        @save="handleSave"
      />
    </div>

    <!-- 状态栏 -->
    <div class="editor-footer">
      <div class="footer-left">
        <span class="status-item">
          {{ fileSize }}
        </span>
        <span class="status-item">
          {{ fileExtension.toUpperCase() }}
        </span>
      </div>

      <div class="footer-right">
        <span
          v-if="lastSaved"
          class="status-item"
        >
          上次保存: {{ lastSaved }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  SaveOutlined,
  ReloadOutlined,
  LoadingOutlined,
  FileTextOutlined,
  CodeOutlined,
  FileMarkdownOutlined,
  Html5Outlined,
} from '@ant-design/icons-vue';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import MonacoEditor from './MonacoEditor.vue';

const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  projectId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['change', 'save']);

// 响应式状态
const editorRef = ref(null);
const content = ref('');
const hasChanges = ref(false);
const autoSave = ref(true); // 默认启用自动保存
const lastSaved = ref('');
const saving = ref(false);

// 文件图标映射
const iconMap = {
  js: CodeOutlined,
  jsx: CodeOutlined,
  ts: CodeOutlined,
  tsx: CodeOutlined,
  vue: CodeOutlined,
  py: CodeOutlined,
  html: Html5Outlined,
  css: CodeOutlined,
  scss: CodeOutlined,
  md: FileMarkdownOutlined,
  txt: FileTextOutlined,
};

// 计算属性
const fileExtension = computed(() => {
  const parts = props.file.file_name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'txt';
});

const fileIcon = computed(() => {
  return iconMap[fileExtension.value] || FileTextOutlined;
});

const fileSize = computed(() => {
  const bytes = new Blob([content.value]).size;
  if (bytes < 1024) {return `${bytes} B`;}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

// 处理内容变化
const handleChange = (newContent) => {
  hasChanges.value = true;
  emit('change', newContent);
};

// 保存文件（使用 file-sync IPC 进行双向同步）
const handleSave = async () => {
  if (!hasChanges.value || saving.value) {return;}

  saving.value = true;

  try {
    // 调用 file-sync:save IPC，实现数据库和文件系统的双向同步
    await window.electron.ipcRenderer.invoke('file-sync:save', props.file.id, content.value, props.projectId);

    // 更新文件内容
    props.file.content = content.value;

    hasChanges.value = false;
    lastSaved.value = formatDistanceToNow(new Date(), {
      addSuffix: true,
      locale: zhCN,
    });

    emit('save');
    message.success('文件已保存');
  } catch (error) {
    logger.error('保存文件失败:', error);
    message.error('保存文件失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 刷新文件
const handleRefresh = () => {
  if (hasChanges.value) {
    message.warning('有未保存的更改，请先保存');
    return;
  }

  content.value = props.file.content || '';
  message.success('文件已刷新');
};

// 监听文件变化
watch(
  () => props.file,
  (newFile) => {
    if (newFile) {
      content.value = newFile.content || '';
      hasChanges.value = false;
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.file-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

/* 编辑器头部 */
.editor-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f9fafb;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-icon {
  font-size: 18px;
  color: #667eea;
}

.file-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 编辑器内容 */
.editor-content {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
}

/* 编辑器状态栏 */
.editor-footer {
  padding: 6px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f9fafb;
  font-size: 12px;
  color: #6b7280;
}

.footer-left,
.footer-right {
  display: flex;
  gap: 16px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
