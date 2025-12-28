<template>
  <div class="simple-editor">
    <!-- 编辑器头部 -->
    <div class="editor-header">
      <div class="header-left">
        <EditOutlined />
        <span class="file-name">{{ file?.file_name || '编辑器' }}</span>
        <a-tag v-if="languageLabel" color="blue">{{ languageLabel }}</a-tag>
        <a-tag v-if="hasUnsavedChanges" color="orange">
          <ClockCircleOutlined />
          未保存
        </a-tag>
        <a-tag v-else-if="file" color="green">
          <CheckOutlined />
          已保存
        </a-tag>
      </div>
      <div class="header-right">
        <a-tooltip title="保存 (Ctrl+S)">
          <a-button
            type="primary"
            size="small"
            :disabled="!hasUnsavedChanges"
            :loading="saving"
            @click="handleSave"
          >
            <SaveOutlined v-if="!saving" />
            保存
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- CodeMirror 编辑器容器 -->
    <div ref="editorRef" class="editor-container"></div>

    <!-- 底部状态栏 -->
    <div class="editor-footer">
      <div class="footer-left">
        <span class="status-text">行: {{ cursorLine }}</span>
        <span class="status-text">列: {{ cursorColumn }}</span>
        <span class="status-text">{{ lineCount }} 行</span>
        <span class="status-text">{{ charCount }} 字符</span>
      </div>
      <div class="footer-right">
        <span v-if="autoSaveEnabled" class="status-text">
          <CheckCircleOutlined />
          自动保存
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import {
  EditOutlined,
  SaveOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';

const props = defineProps({
  file: {
    type: Object,
    default: null,
  },
  content: {
    type: String,
    default: '',
  },
  autoSave: {
    type: Boolean,
    default: true,
  },
  autoSaveDelay: {
    type: Number,
    default: 500, // 500ms
  },
});

const emit = defineEmits(['change', 'save']);

// 状态
const editorRef = ref(null);
const editorView = ref(null);
const hasUnsavedChanges = ref(false);
const saving = ref(false);
const cursorLine = ref(1);
const cursorColumn = ref(1);
const lineCount = ref(0);
const charCount = ref(0);
const autoSaveTimer = ref(null);

// 语言配置
const languageCompartment = new Compartment();

/**
 * 获取语言标签
 */
const languageLabel = computed(() => {
  if (!props.file?.file_name) return null;

  const ext = props.file.file_name.split('.').pop().toLowerCase();

  const labelMap = {
    js: 'JavaScript',
    jsx: 'JSX',
    ts: 'TypeScript',
    tsx: 'TSX',
    vue: 'Vue',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    json: 'JSON',
    md: 'Markdown',
    txt: 'Text',
    xml: 'XML',
    yml: 'YAML',
    yaml: 'YAML',
  };

  return labelMap[ext] || ext.toUpperCase();
});

/**
 * 是否启用自动保存
 */
const autoSaveEnabled = computed(() => props.autoSave);

/**
 * 根据文件扩展名获取语言支持
 */
const getLanguageSupport = (fileName) => {
  if (!fileName) return [];

  const ext = fileName.split('.').pop().toLowerCase();

  switch (ext) {
    case 'js':
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'vue':
      // Vue 文件使用 HTML 语法（简化处理）
      return [html()];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
    case 'less':
      return [css()];
    case 'json':
      return [json()];
    case 'md':
      return [markdown()];
    default:
      return [];
  }
};

/**
 * 初始化编辑器
 */
const initEditor = () => {
  if (!editorRef.value) return;

  // 销毁旧编辑器
  if (editorView.value) {
    editorView.value.destroy();
  }

  // 获取语言支持
  const languageSupport = getLanguageSupport(props.file?.file_name);

  // 创建编辑器状态
  // 确保 doc 是字符串类型
  const docContent = typeof props.content === 'string' ? props.content : String(props.content || '');
  const state = EditorState.create({
    doc: docContent,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        {
          key: 'Ctrl-s',
          mac: 'Cmd-s',
          run: () => {
            handleSave();
            return true;
          },
        },
      ]),
      languageCompartment.of(languageSupport),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          handleContentChange(update.state.doc.toString());
          updateCursorPosition(update.state);
          updateStats(update.state);
        }
        if (update.selectionSet) {
          updateCursorPosition(update.state);
        }
      }),
      EditorView.lineWrapping, // 启用自动换行
    ],
  });

  // 创建编辑器视图
  editorView.value = new EditorView({
    state,
    parent: editorRef.value,
  });

  // 初始化统计信息
  updateCursorPosition(state);
  updateStats(state);
};

/**
 * 更新光标位置
 */
const updateCursorPosition = (state) => {
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.head);
  cursorLine.value = line.number;
  cursorColumn.value = selection.head - line.from + 1;
};

/**
 * 更新统计信息
 */
const updateStats = (state) => {
  lineCount.value = state.doc.lines;
  charCount.value = state.doc.length;
};

/**
 * 处理内容变化
 */
const handleContentChange = (newContent) => {
  hasUnsavedChanges.value = true;
  emit('change', newContent);

  // 自动保存
  if (autoSaveEnabled.value) {
    clearTimeout(autoSaveTimer.value);
    autoSaveTimer.value = setTimeout(() => {
      handleSave();
    }, props.autoSaveDelay);
  }
};

/**
 * 保存文件
 */
const handleSave = async () => {
  if (!editorView.value || saving.value || !hasUnsavedChanges.value) return;

  saving.value = true;

  try {
    const content = editorView.value.state.doc.toString();
    emit('save', content);

    // 假设父组件处理保存逻辑
    await new Promise((resolve) => setTimeout(resolve, 200)); // 模拟保存延迟

    hasUnsavedChanges.value = false;
    message.success('保存成功');
  } catch (error) {
    console.error('保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

/**
 * 设置编辑器内容
 */
const setContent = (newContent) => {
  if (!editorView.value) return;

  try {
    // 确保内容是字符串类型
    const contentStr = typeof newContent === 'string' ? newContent : String(newContent || '');

    // 获取当前编辑器状态快照
    const currentState = editorView.value.state;

    // 创建基于当前状态的事务
    const transaction = currentState.update({
      changes: {
        from: 0,
        to: currentState.doc.length,
        insert: contentStr,
      },
    });

    editorView.value.dispatch(transaction);
    hasUnsavedChanges.value = false;
  } catch (error) {
    console.error('[SimpleEditor] setContent 失败:', error);
    // 静默失败，避免中断用户操作
  }
};

/**
 * 更新语言支持
 */
const updateLanguage = (fileName) => {
  if (!editorView.value) return;

  const languageSupport = getLanguageSupport(fileName);
  editorView.value.dispatch({
    effects: languageCompartment.reconfigure(languageSupport),
  });
};

// 监听文件变化
watch(
  () => props.file,
  (newFile, oldFile) => {
    if (newFile && newFile.id !== oldFile?.id) {
      // 使用 nextTick 确保编辑器状态稳定后再更新
      nextTick(() => {
        setContent(props.content);
        updateLanguage(newFile.file_name);
      });
    }
  }
);

// 监听内容变化（外部更新）
watch(
  () => props.content,
  (newContent, oldContent) => {
    // 只在编辑器就绪、无未保存更改、且内容确实改变时更新
    if (editorView.value && !hasUnsavedChanges.value && newContent !== oldContent) {
      nextTick(() => {
        setContent(newContent);
      });
    }
  }
);

onMounted(() => {
  initEditor();
});

onUnmounted(() => {
  if (editorView.value) {
    editorView.value.destroy();
  }
  clearTimeout(autoSaveTimer.value);
});

// 暴露方法给父组件
defineExpose({
  save: handleSave,
  getContent: () => editorView.value?.state.doc.toString() || '',
  setContent,
});
</script>

<style scoped>
.simple-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

/* 编辑器头部 */
.editor-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  background: #fafafa;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #262626;
}

.file-name {
  font-weight: 500;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 编辑器容器 */
.editor-container {
  flex: 1;
  overflow: auto;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
}

/* CodeMirror 样式覆盖 */
.editor-container :deep(.cm-editor) {
  height: 100%;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
}

.editor-container :deep(.cm-scroller) {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.editor-container :deep(.cm-gutters) {
  background: #f5f5f5;
  border-right: 1px solid #e8e8e8;
  color: #8c8c8c;
}

.editor-container :deep(.cm-activeLineGutter) {
  background: #e6f7ff;
}

.editor-container :deep(.cm-activeLine) {
  background: #f0f9ff;
}

.editor-container :deep(.cm-selectionBackground) {
  background: #b3d8ff !important;
}

.editor-container :deep(.cm-cursor) {
  border-left-color: #1890ff;
}

/* 编辑器底部状态栏 */
.editor-footer {
  padding: 8px 16px;
  border-top: 1px solid #e8e8e8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  background: #fafafa;
  font-size: 12px;
  color: #8c8c8c;
}

.footer-left,
.footer-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-text {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
