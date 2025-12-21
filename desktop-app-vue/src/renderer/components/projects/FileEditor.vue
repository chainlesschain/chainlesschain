<template>
  <div class="file-editor">
    <!-- 编辑器头部 -->
    <div class="editor-header">
      <div class="header-left">
        <component :is="fileIcon" class="file-icon" />
        <span class="file-name">{{ file.file_name }}</span>
        <a-tag v-if="hasChanges" color="orange" size="small">
          未保存
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
            :disabled="!hasChanges"
            @click="handleSave"
          >
            <SaveOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip title="刷新">
          <a-button type="text" size="small" @click="handleRefresh">
            <ReloadOutlined />
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- 编辑器内容 -->
    <div class="editor-content">
      <!-- 简单文本编辑器 -->
      <textarea
        ref="editorRef"
        v-model="content"
        class="code-editor"
        :placeholder="`编辑 ${file.file_name}...`"
        spellcheck="false"
        @input="handleInput"
        @keydown="handleKeyDown"
      />
    </div>

    <!-- 编辑器状态栏 -->
    <div class="editor-footer">
      <div class="footer-left">
        <span class="status-item">
          行: {{ cursorPosition.line }} | 列: {{ cursorPosition.column }}
        </span>
        <span class="status-item">
          {{ fileSize }}
        </span>
        <span class="status-item">
          {{ fileExtension.toUpperCase() }}
        </span>
      </div>

      <div class="footer-right">
        <span v-if="lastSaved" class="status-item">
          上次保存: {{ lastSaved }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  SaveOutlined,
  ReloadOutlined,
  FileTextOutlined,
  CodeOutlined,
  FileMarkdownOutlined,
  Html5Outlined,
  CssOutlined,
} from '@ant-design/icons-vue';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

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
const autoSave = ref(false);
const cursorPosition = ref({ line: 1, column: 1 });
const lastSaved = ref('');
const autoSaveTimer = ref(null);

// 文件图标映射
const iconMap = {
  js: CodeOutlined,
  jsx: CodeOutlined,
  ts: CodeOutlined,
  tsx: CodeOutlined,
  vue: CodeOutlined,
  py: CodeOutlined,
  html: Html5Outlined,
  css: CssOutlined,
  scss: CssOutlined,
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
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

// 处理输入
const handleInput = () => {
  hasChanges.value = true;
  emit('change', content.value);

  // 更新光标位置
  updateCursorPosition();

  // 如果启用自动保存
  if (autoSave.value) {
    clearTimeout(autoSaveTimer.value);
    autoSaveTimer.value = setTimeout(() => {
      handleSave();
    }, 1000); // 1秒后自动保存
  }
};

// 更新光标位置
const updateCursorPosition = () => {
  if (!editorRef.value) return;

  const textarea = editorRef.value;
  const textBeforeCursor = content.value.substring(0, textarea.selectionStart);
  const lines = textBeforeCursor.split('\n');

  cursorPosition.value = {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
};

// 处理键盘快捷键
const handleKeyDown = (event) => {
  // Ctrl+S 保存
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault();
    handleSave();
    return;
  }

  // Tab键插入空格
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = event.target.selectionStart;
    const end = event.target.selectionEnd;
    const spaces = '  '; // 2个空格

    content.value = content.value.substring(0, start) + spaces + content.value.substring(end);

    // 恢复光标位置
    setTimeout(() => {
      event.target.selectionStart = event.target.selectionEnd = start + spaces.length;
    }, 0);

    handleInput();
  }
};

// 保存文件
const handleSave = () => {
  if (!hasChanges.value) return;

  // 更新文件内容
  props.file.content = content.value;

  hasChanges.value = false;
  lastSaved.value = formatDistanceToNow(new Date(), {
    addSuffix: true,
    locale: zhCN,
  });

  emit('save');
  message.success('文件已保存');
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
watch(() => props.file, (newFile) => {
  if (newFile) {
    content.value = newFile.content || '';
    hasChanges.value = false;
    cursorPosition.value = { line: 1, column: 1 };
  }
}, { immediate: true });

// 监听点击事件更新光标位置
const handleClick = () => {
  updateCursorPosition();
};

// 组件挂载
onMounted(() => {
  if (editorRef.value) {
    editorRef.value.addEventListener('click', handleClick);
    editorRef.value.addEventListener('keyup', updateCursorPosition);
  }
});

// 组件卸载
onUnmounted(() => {
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value);
  }

  if (editorRef.value) {
    editorRef.value.removeEventListener('click', handleClick);
    editorRef.value.removeEventListener('keyup', updateCursorPosition);
  }
});
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
}

.code-editor {
  width: 100%;
  height: 100%;
  padding: 16px;
  border: none;
  outline: none;
  resize: none;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  color: #1f2937;
  background: #ffffff;
  tab-size: 2;
}

.code-editor::placeholder {
  color: #9ca3af;
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

/* 滚动条样式 */
.code-editor::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.code-editor::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.code-editor::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
}

.code-editor::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
