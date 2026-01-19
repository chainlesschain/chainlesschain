<template>
  <div class="simple-editor">
    <!-- 编辑器头部 -->
    <div class="editor-header">
      <div class="header-left">
        <EditOutlined />
        <span class="file-name">{{ file?.file_name || '编辑器' }}</span>
        <a-tag
          v-if="languageLabel"
          color="blue"
        >
          {{ languageLabel }}
        </a-tag>
        <a-tag
          v-if="hasUnsavedChanges"
          color="orange"
        >
          <ClockCircleOutlined />
          未保存
        </a-tag>
        <a-tag
          v-else-if="file"
          color="green"
        >
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
    <div
      ref="editorRef"
      class="editor-container"
    />

    <!-- 底部状态栏 -->
    <div class="editor-footer">
      <div class="footer-left">
        <span class="status-text">行: {{ cursorLine }}</span>
        <span class="status-text">列: {{ cursorColumn }}</span>
        <span class="status-text">{{ lineCount }} 行</span>
        <span class="status-text">{{ charCount }} 字符</span>
      </div>
      <div class="footer-right">
        <span
          v-if="autoSaveEnabled"
          class="status-text"
        >
          <CheckCircleOutlined />
          自动保存
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

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
const isSettingContent = ref(false); // 防止并发 setContent 调用
const setContentTimer = ref(null); // 防抖定时器

// 语言配置
const languageCompartment = new Compartment();

/**
 * 获取语言标签
 */
const languageLabel = computed(() => {
  if (!props.file?.file_name) {return null;}

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
  if (!fileName) {return [];}

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
  if (!editorRef.value) {return;}

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
  if (!editorView.value || saving.value || !hasUnsavedChanges.value) {return;}

  saving.value = true;

  try {
    const content = editorView.value.state.doc.toString();
    emit('save', content);

    // 假设父组件处理保存逻辑
    await new Promise((resolve) => setTimeout(resolve, 200)); // 模拟保存延迟

    hasUnsavedChanges.value = false;
    message.success('保存成功');
  } catch (error) {
    logger.error('保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

/**
 * 设置编辑器内容（带防抖和锁机制）
 */
const setContent = (newContent) => {
  // 如果编辑器未就绪，直接返回
  if (!editorView.value) {
    logger.warn('[SimpleEditor] 编辑器未就绪，跳过 setContent');
    return;
  }

  // 如果正在设置内容，跳过本次调用（防止并发）
  if (isSettingContent.value) {
    logger.info('[SimpleEditor] 正在设置内容，跳过重复调用');
    return;
  }

  // 清除之前的防抖定时器
  if (setContentTimer.value) {
    clearTimeout(setContentTimer.value);
  }

  // 使用防抖，等待 20ms 后执行
  setContentTimer.value = setTimeout(() => {
    isSettingContent.value = true;

    try {
      // 确保内容是字符串类型
      const contentStr = typeof newContent === 'string' ? newContent : String(newContent || '');

      // 再次检查编辑器是否存在（异步后可能已销毁）
      if (!editorView.value) {
        logger.warn('[SimpleEditor] 编辑器已销毁，取消 setContent');
        return;
      }

      // 获取当前编辑器内容
      const currentContent = editorView.value.state.doc.toString();

      // 如果内容相同，直接返回（避免不必要的更新）
      if (currentContent === contentStr) {
        logger.info('[SimpleEditor] 内容未变化，跳过更新');
        return;
      }

      // 使用最新的state创建事务（避免状态不一致）
      // 不要预先获取state，而是在创建事务时使用最新的
      editorView.value.dispatch({
        changes: {
          from: 0,
          to: editorView.value.state.doc.length,
          insert: contentStr,
        },
      });

      hasUnsavedChanges.value = false;
      logger.info('[SimpleEditor] setContent 成功，内容长度:', contentStr.length);
    } catch (error) {
      logger.error('[SimpleEditor] setContent 失败:', error);
      logger.error('[SimpleEditor] 错误详情:', {
        message: error.message,
        stack: error.stack,
        editorExists: !!editorView.value,
        contentType: typeof newContent,
      });
      // 静默失败，避免中断用户操作
    } finally {
      // 释放锁
      isSettingContent.value = false;
    }
  }, 20);
};

/**
 * 更新语言支持
 */
const updateLanguage = (fileName) => {
  if (!editorView.value) {return;}

  const languageSupport = getLanguageSupport(fileName);
  editorView.value.dispatch({
    effects: languageCompartment.reconfigure(languageSupport),
  });
};

// 监听文件变化
watch(
  () => props.file,
  (newFile, oldFile) => {
    // 文件切换时重新初始化编辑器
    if (newFile && newFile.id !== oldFile?.id) {
      logger.info('[SimpleEditor] 文件切换，重新初始化编辑器:', newFile.file_name);

      // 清理之前的定时器和状态
      if (setContentTimer.value) {
        clearTimeout(setContentTimer.value);
      }
      isSettingContent.value = false;
      hasUnsavedChanges.value = false;

      // 使用 nextTick 确保 DOM 更新完成后再重新初始化
      nextTick(() => {
        // 重新初始化编辑器（会自动使用 props.content）
        initEditor();
      });
    }
  }
);

// 监听内容变化（外部更新）
watch(
  () => props.content,
  (newContent, oldContent) => {
    // 只在以下条件下更新内容：
    // 1. 编辑器已就绪
    // 2. 没有未保存的更改（避免覆盖用户编辑）
    // 3. 内容确实发生变化
    // 4. 不是文件切换导致的（文件切换会重新初始化编辑器）
    if (
      editorView.value &&
      !hasUnsavedChanges.value &&
      newContent !== oldContent &&
      !isSettingContent.value
    ) {
      logger.info('[SimpleEditor] 外部内容变化，更新编辑器');
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
  // 清理所有定时器
  if (setContentTimer.value) {
    clearTimeout(setContentTimer.value);
  }
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value);
  }

  // 销毁编辑器
  if (editorView.value) {
    editorView.value.destroy();
  }
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
