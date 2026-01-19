<template>
  <div class="code-editor-container">
    <!-- 工具栏 -->
    <div class="code-toolbar">
      <div class="toolbar-left">
        <a-select
          v-model:value="language"
          style="width: 150px"
          size="small"
          @change="changeLanguage"
        >
          <a-select-option value="javascript">
            JavaScript
          </a-select-option>
          <a-select-option value="typescript">
            TypeScript
          </a-select-option>
          <a-select-option value="python">
            Python
          </a-select-option>
          <a-select-option value="java">
            Java
          </a-select-option>
          <a-select-option value="cpp">
            C++
          </a-select-option>
          <a-select-option value="c">
            C
          </a-select-option>
          <a-select-option value="html">
            HTML
          </a-select-option>
          <a-select-option value="css">
            CSS
          </a-select-option>
          <a-select-option value="json">
            JSON
          </a-select-option>
          <a-select-option value="markdown">
            Markdown
          </a-select-option>
          <a-select-option value="sql">
            SQL
          </a-select-option>
          <a-select-option value="yaml">
            YAML
          </a-select-option>
        </a-select>

        <a-select
          v-model:value="theme"
          style="width: 120px"
          size="small"
          @change="changeTheme"
        >
          <a-select-option value="vs">
            Light
          </a-select-option>
          <a-select-option value="vs-dark">
            Dark
          </a-select-option>
          <a-select-option value="hc-black">
            High Contrast
          </a-select-option>
        </a-select>

        <a-input-number
          v-model:value="fontSize"
          :min="10"
          :max="24"
          size="small"
          style="width: 80px"
          @change="changeFontSize"
        >
          <template #addonAfter>
            px
          </template>
        </a-input-number>
      </div>

      <div class="toolbar-spacer" />

      <div class="toolbar-right">
        <a-button
          size="small"
          @click="formatCode"
        >
          <FormatPainterOutlined />
          格式化
        </a-button>

        <a-button
          size="small"
          @click="toggleMinimap"
        >
          <PictureOutlined />
          {{ showMinimap ? '隐藏' : '显示' }}缩略图
        </a-button>

        <a-button
          v-if="canRun"
          type="primary"
          size="small"
          :loading="running"
          @click="runCode"
        >
          <PlayCircleOutlined />
          运行
        </a-button>

        <a-tag
          v-if="lineCount > 0"
          color="blue"
        >
          {{ lineCount }} 行
        </a-tag>

        <a-tag
          v-if="hasChanges"
          color="orange"
        >
          <ClockCircleOutlined />
          未保存
        </a-tag>

        <a-button
          type="primary"
          size="small"
          :disabled="!hasChanges"
          :loading="saving"
          @click="save"
        >
          <SaveOutlined />
          保存
        </a-button>
      </div>
    </div>

    <!-- Monaco编辑器 -->
    <div
      ref="editorRef"
      class="monaco-editor"
    />

    <!-- 输出面板 -->
    <div
      v-if="showOutput"
      class="output-panel"
    >
      <div class="output-header">
        <span>
          <CodeOutlined />
          输出
        </span>
        <div class="output-actions">
          <a-button
            type="text"
            size="small"
            @click="clearOutput"
          >
            <ClearOutlined />
            清空
          </a-button>
          <a-button
            type="text"
            size="small"
            @click="showOutput = false"
          >
            <CloseOutlined />
            关闭
          </a-button>
        </div>
      </div>
      <pre
        class="output-content"
        :class="{ error: outputError }"
      >{{ output }}</pre>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { message } from 'ant-design-vue';
import * as monaco from 'monaco-editor';
import {
  SaveOutlined,
  PlayCircleOutlined,
  FormatPainterOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  ClearOutlined,
  CloseOutlined,
  PictureOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  file: {
    type: Object,
    default: null,
  },
  initialContent: {
    type: String,
    default: '',
  },
  autoSave: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['change', 'save']);

// 状态
const editorRef = ref(null);
const editor = ref(null);
const language = ref('javascript');
const theme = ref('vs-dark');
const fontSize = ref(14);
const saving = ref(false);
const hasChanges = ref(false);
const output = ref('');
const showOutput = ref(false);
const outputError = ref(false);
const running = ref(false);
const showMinimap = ref(true);
const lineCount = ref(0);
let autoSaveTimer = null;

// 可运行的语言
const canRun = computed(() => {
  return ['python', 'javascript'].includes(language.value);
});

// 语言映射
const languageMap = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  html: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  vue: 'html',
  jsx: 'javascript',
  tsx: 'typescript',
};

// 初始化Monaco Editor
onMounted(() => {
  if (!editorRef.value) {return;}

  // 检测语言
  if (props.file?.file_name) {
    const ext = props.file.file_name.split('.').pop().toLowerCase();
    language.value = languageMap[ext] || 'javascript';
  }

  // 创建编辑器
  editor.value = monaco.editor.create(editorRef.value, {
    value: props.initialContent || '',
    language: language.value,
    theme: theme.value,
    fontSize: fontSize.value,
    automaticLayout: true,
    minimap: {
      enabled: showMinimap.value,
    },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    folding: true,
    bracketPairColorization: {
      enabled: true,
    },
    suggestOnTriggerCharacters: true,
    quickSuggestions: true,
    formatOnPaste: true,
    formatOnType: true,
  });

  // 监听内容变化
  editor.value.onDidChangeModelContent(() => {
    hasChanges.value = true;
    updateLineCount();
    emit('change', editor.value.getValue());

    if (props.autoSave) {
      scheduleAutoSave();
    }
  });

  // 初始化行数
  updateLineCount();

  // 添加快捷键
  editor.value.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    save();
  });

  editor.value.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR, () => {
    if (canRun.value) {
      runCode();
    }
  });
});

// 清理
onBeforeUnmount(() => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  if (editor.value) {
    editor.value.dispose();
  }
});

// 切换语言
const changeLanguage = (newLang) => {
  if (editor.value) {
    monaco.editor.setModelLanguage(editor.value.getModel(), newLang);
  }
};

// 切换主题
const changeTheme = (newTheme) => {
  monaco.editor.setTheme(newTheme);
};

// 修改字体大小
const changeFontSize = (size) => {
  if (editor.value) {
    editor.value.updateOptions({ fontSize: size });
  }
};

// 切换缩略图
const toggleMinimap = () => {
  showMinimap.value = !showMinimap.value;
  if (editor.value) {
    editor.value.updateOptions({
      minimap: { enabled: showMinimap.value },
    });
  }
};

// 更新行数
const updateLineCount = () => {
  if (editor.value) {
    const model = editor.value.getModel();
    lineCount.value = model ? model.getLineCount() : 0;
  }
};

// 格式化代码
const formatCode = () => {
  if (editor.value) {
    editor.value.getAction('editor.action.formatDocument').run();
    message.success('代码已格式化');
  }
};

// 保存
const save = async () => {
  if (!hasChanges.value) {return;}

  saving.value = true;
  try {
    const code = editor.value.getValue();

    if (props.file?.file_path) {
      await window.electronAPI.file.writeContent(props.file.file_path, code);
    }

    hasChanges.value = false;
    emit('save', code);
    message.success('已保存');
  } catch (error) {
    logger.error('[CodeEditor] 保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 运行代码
const runCode = async () => {
  const code = editor.value.getValue();

  if (!code.trim()) {
    message.warning('代码为空');
    return;
  }

  running.value = true;
  showOutput.value = true;
  output.value = '执行中...\n';
  outputError.value = false;

  try {
    if (language.value === 'python') {
      // 执行Python代码
      const result = await window.electronAPI.code.executePython(code);

      if (result.success) {
        output.value = result.stdout || '执行完成（无输出）';
        if (result.stderr) {
          output.value += '\n\n--- 错误/警告 ---\n' + result.stderr;
        }
      } else {
        output.value = 'Error: ' + (result.error || result.stderr || '执行失败');
        outputError.value = true;
      }
    } else if (language.value === 'javascript') {
      // 执行JavaScript代码（沙箱模式）
      try {
        // 创建一个简单的控制台重定向
        const logs = [];
        const sandboxConsole = {
          log: (...args) => logs.push(args.join(' ')),
          error: (...args) => logs.push('ERROR: ' + args.join(' ')),
          warn: (...args) => logs.push('WARN: ' + args.join(' ')),
        };

        // 使用Function构造器创建沙箱
        const func = new Function('console', code);
        func(sandboxConsole);

        output.value = logs.length > 0 ? logs.join('\n') : '执行完成（无输出）';
      } catch (error) {
        output.value = 'Error: ' + error.message;
        outputError.value = true;
      }
    }
  } catch (error) {
    output.value = 'Error: ' + error.message;
    outputError.value = true;
    message.error('执行失败');
  } finally {
    running.value = false;
  }
};

// 清空输出
const clearOutput = () => {
  output.value = '';
  outputError.value = false;
};

// 计划自动保存
const scheduleAutoSave = () => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = setTimeout(save, 2000);
};

// 监听文件变化
watch(() => props.file, async () => {
  if (editor.value && props.file?.file_path) {
    try {
      const result = await window.electronAPI.file.readContent(props.file.file_path);
      if (result.success) {
        editor.value.setValue(result.content || '');
        hasChanges.value = false;
      }
    } catch (error) {
      logger.error('[CodeEditor] 读取文件失败:', error);
    }
  }
}, { deep: true });

// 暴露方法
defineExpose({
  save,
  getValue: () => editor.value?.getValue(),
  setValue: (value) => editor.value?.setValue(value),
  formatCode,
});
</script>

<style scoped lang="scss">
.code-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
}

.code-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #3e3e42;
  background: #2d2d30;
  flex-wrap: wrap;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-spacer {
  flex: 1;
}

.monaco-editor {
  flex: 1;
  min-height: 0;
}

.output-panel {
  height: 250px;
  border-top: 1px solid #3e3e42;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
}

.output-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #2d2d30;
  border-bottom: 1px solid #3e3e42;
  color: #cccccc;

  span {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
  }
}

.output-actions {
  display: flex;
  gap: 4px;

  :deep(.ant-btn) {
    color: #cccccc;

    &:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
    }
  }
}

.output-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  background: #1e1e1e;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-wrap: break-word;

  &.error {
    color: #f48771;
  }
}

/* 滚动条样式 */
.output-content::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.output-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.output-content::-webkit-scrollbar-thumb {
  background: #424242;
  border-radius: 5px;

  &:hover {
    background: #4e4e4e;
  }
}

/* Monaco Editor自定义样式 */
:deep(.monaco-editor) {
  .margin,
  .monaco-editor-background {
    background-color: #1e1e1e !important;
  }
}
</style>
