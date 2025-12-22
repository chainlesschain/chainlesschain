<template>
  <div class="monaco-editor-container">
    <div ref="editorContainer" class="editor"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as monaco from 'monaco-editor';

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  file: {
    type: Object,
    default: null,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  autoSave: {
    type: Boolean,
    default: true,
  },
  autoSaveDelay: {
    type: Number,
    default: 1000,
  },
});

const emit = defineEmits(['update:modelValue', 'save', 'change']);

const editorContainer = ref(null);
let editor = null;
let autoSaveTimer = null;

/**
 * 根据文件类型确定 Monaco 语言
 */
const getLanguage = () => {
  if (!props.file) return 'plaintext';

  const ext = props.file.file_name?.split('.').pop()?.toLowerCase() || '';
  const languageMap = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    vue: 'html',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    xml: 'xml',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    sh: 'shell',
    bash: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    sql: 'sql',
    txt: 'plaintext',
  };

  return languageMap[ext] || 'plaintext';
};

/**
 * 初始化编辑器
 */
const initEditor = () => {
  if (!editorContainer.value) return;

  editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue || '',
    language: getLanguage(),
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 14,
    tabSize: 2,
    minimap: {
      enabled: true,
    },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    readOnly: props.readonly,
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    glyphMargin: true,
    folding: true,
    bracketPairColorization: {
      enabled: true,
    },
    autoClosingBrackets: 'always',
    autoClosingQuotes: 'always',
    formatOnPaste: true,
    formatOnType: true,
  });

  // 监听内容变化
  editor.onDidChangeModelContent(() => {
    const value = editor.getValue();
    emit('update:modelValue', value);
    emit('change', value);

    // 自动保存
    if (props.autoSave) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        emit('save', value);
      }, props.autoSaveDelay);
    }
  });

  // 添加保存快捷键 (Ctrl+S / Cmd+S)
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    const value = editor.getValue();
    emit('save', value);
  });

  // 添加格式化快捷键 (Shift+Alt+F)
  editor.addCommand(
    monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
    () => {
      editor.getAction('editor.action.formatDocument').run();
    }
  );
};

/**
 * 更新编辑器语言
 */
const updateLanguage = () => {
  if (!editor) return;
  const model = editor.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, getLanguage());
  }
};

/**
 * 设置编辑器内容
 */
const setContent = (content) => {
  if (!editor) return;
  const currentPosition = editor.getPosition();
  editor.setValue(content || '');
  // 恢复光标位置
  if (currentPosition) {
    editor.setPosition(currentPosition);
  }
};

// 监听文件变化
watch(
  () => props.file,
  (newFile, oldFile) => {
    if (newFile?.id !== oldFile?.id) {
      updateLanguage();
    }
  }
);

// 监听外部内容变化
watch(
  () => props.modelValue,
  (newValue) => {
    if (editor && newValue !== editor.getValue()) {
      setContent(newValue);
    }
  }
);

// 监听只读状态
watch(
  () => props.readonly,
  (newReadonly) => {
    if (editor) {
      editor.updateOptions({ readOnly: newReadonly });
    }
  }
);

onMounted(async () => {
  await nextTick();
  initEditor();
});

onBeforeUnmount(() => {
  clearTimeout(autoSaveTimer);
  if (editor) {
    editor.dispose();
    editor = null;
  }
});

// 暴露方法给父组件
defineExpose({
  getEditor: () => editor,
  focus: () => editor?.focus(),
  getValue: () => editor?.getValue(),
  setValue: (value) => setContent(value),
  formatDocument: () => editor?.getAction('editor.action.formatDocument').run(),
});
</script>

<style scoped>
.monaco-editor-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor {
  flex: 1;
  min-height: 0;
}
</style>
