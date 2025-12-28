<template>
  <div class="rich-text-editor-container">
    <!-- 工具栏 -->
    <div class="editor-toolbar">
      <div class="toolbar-group">
        <a-button-group size="small">
          <a-button @click="execCommand('bold')" :type="isActive('bold') ? 'primary' : 'default'">
            <BoldOutlined />
          </a-button>
          <a-button @click="execCommand('italic')" :type="isActive('italic') ? 'primary' : 'default'">
            <ItalicOutlined />
          </a-button>
          <a-button @click="execCommand('underline')" :type="isActive('underline') ? 'primary' : 'default'">
            <UnderlineOutlined />
          </a-button>
          <a-button @click="execCommand('strikeThrough')" :type="isActive('strikeThrough') ? 'primary' : 'default'">
            <StrikethroughOutlined />
          </a-button>
        </a-button-group>
      </div>

      <a-divider type="vertical" />

      <div class="toolbar-group">
        <a-select v-model:value="currentFontSize" size="small" style="width: 80px" @change="changeFontSize">
          <a-select-option :value="10">10</a-select-option>
          <a-select-option :value="12">12</a-select-option>
          <a-select-option :value="14">14</a-select-option>
          <a-select-option :value="16">16</a-select-option>
          <a-select-option :value="18">18</a-select-option>
          <a-select-option :value="20">20</a-select-option>
          <a-select-option :value="24">24</a-select-option>
          <a-select-option :value="28">28</a-select-option>
          <a-select-option :value="32">32</a-select-option>
        </a-select>
      </div>

      <a-divider type="vertical" />

      <div class="toolbar-group">
        <a-button-group size="small">
          <a-button @click="execCommand('justifyLeft')">
            <AlignLeftOutlined />
          </a-button>
          <a-button @click="execCommand('justifyCenter')">
            <AlignCenterOutlined />
          </a-button>
          <a-button @click="execCommand('justifyRight')">
            <AlignRightOutlined />
          </a-button>
        </a-button-group>
      </div>

      <a-divider type="vertical" />

      <div class="toolbar-group">
        <a-button-group size="small">
          <a-button @click="execCommand('insertOrderedList')">
            <OrderedListOutlined />
          </a-button>
          <a-button @click="execCommand('insertUnorderedList')">
            <UnorderedListOutlined />
          </a-button>
        </a-button-group>
      </div>

      <a-divider type="vertical" />

      <div class="toolbar-group">
        <a-dropdown>
          <a-button size="small">
            <FileTextOutlined />
            格式
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleFormat">
              <a-menu-item key="h1">标题 1</a-menu-item>
              <a-menu-item key="h2">标题 2</a-menu-item>
              <a-menu-item key="h3">标题 3</a-menu-item>
              <a-menu-divider />
              <a-menu-item key="p">正文</a-menu-item>
              <a-menu-item key="blockquote">引用</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>

      <a-divider type="vertical" />

      <div class="toolbar-group">
        <a-dropdown>
          <a-button size="small">
            <ExportOutlined />
            导出
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleExport">
              <a-menu-item key="word">导出为Word</a-menu-item>
              <a-menu-item key="markdown">导出为Markdown</a-menu-item>
              <a-menu-item key="html">导出为HTML</a-menu-item>
              <a-menu-item key="pdf">导出为PDF</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>

      <div class="toolbar-spacer"></div>

      <div class="toolbar-group">
        <a-tag v-if="wordCount > 0" color="blue">{{ wordCount }} 字</a-tag>
        <a-tag v-if="hasUnsavedChanges" color="orange">
          <ClockCircleOutlined />
          未保存
        </a-tag>
        <a-button
          type="primary"
          size="small"
          :disabled="!hasUnsavedChanges"
          :loading="saving"
          @click="handleSave"
        >
          <SaveOutlined />
          保存
        </a-button>
      </div>
    </div>

    <!-- 编辑区域 -->
    <div
      ref="editorRef"
      class="editor-content"
      contenteditable="true"
      @input="handleInput"
      @keydown="handleKeydown"
      @paste="handlePaste"
    ></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  StrikethroughOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  FileTextOutlined,
  DownOutlined,
  ExportOutlined,
  SaveOutlined,
  ClockCircleOutlined,
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
const hasUnsavedChanges = ref(false);
const saving = ref(false);
const currentFontSize = ref(14);
const wordCount = ref(0);
let autoSaveTimer = null;

// 初始化编辑器
const initEditor = async () => {
  if (!editorRef.value) return;

  try {
    let content = props.initialContent;

    // 如果是Word文件，先读取内容
    if (props.file?.file_path && isWordFile(props.file.file_name)) {
      // 构建完整的文件路径
      let fullPath = props.file.file_path;

      // 如果路径不是绝对路径，需要获取项目根路径
      if (!fullPath.startsWith('/') && !fullPath.match(/^[a-zA-Z]:[/\\]/)) {
        // 尝试从URL获取项目ID
        const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
        const projectId = window.location.hash.match(/\/projects\/([^/?]+)/)?.[1];

        if (projectId && !fullPath.includes(projectId)) {
          // 拼接完整路径：/data/projects/{projectId}/{file_path}
          fullPath = `/data/projects/${projectId}/${fullPath}`;
        }
      }

      console.log('[RichTextEditor] 读取Word文件:', fullPath);
      const result = await window.electronAPI.file.readWord(fullPath);
      if (result.success) {
        content = result.html;
        console.log('[RichTextEditor] Word内容加载成功，HTML长度:', content?.length || 0);
      } else {
        console.error('[RichTextEditor] Word读取失败:', result.error);
        message.error('读取Word文件失败: ' + (result.error || '未知错误'));
      }
    }

    // 异步操作后再次检查 DOM 是否仍然有效（防止组件在加载期间被卸载）
    if (!editorRef.value) {
      console.warn('[RichTextEditor] 编辑器 DOM 已卸载，取消内容设置');
      return;
    }

    editorRef.value.innerHTML = content || '<p>开始编辑...</p>';
    updateWordCount();
  } catch (error) {
    console.error('[RichTextEditor] 初始化失败:', error);
    message.error('初始化编辑器失败: ' + error.message);
  }
};

// 判断是否是Word文件
const isWordFile = (fileName) => {
  if (!fileName) return false;
  const ext = fileName.split('.').pop().toLowerCase();
  return ['docx', 'doc'].includes(ext);
};

// 执行编辑命令
const execCommand = (command, value = null) => {
  document.execCommand(command, false, value);
  editorRef.value?.focus();
  hasUnsavedChanges.value = true;
};

// 检查命令状态
const isActive = (command) => {
  return document.queryCommandState(command);
};

// 修改字体大小
const changeFontSize = (size) => {
  execCommand('fontSize', 7);
  // 查找所有font标签并设置size
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = size + 'px';
    range.surroundContents(span);
  }
  hasUnsavedChanges.value = true;
};

// 处理格式
const handleFormat = ({ key }) => {
  switch (key) {
    case 'h1':
    case 'h2':
    case 'h3':
      execCommand('formatBlock', `<${key}>`);
      break;
    case 'p':
      execCommand('formatBlock', '<p>');
      break;
    case 'blockquote':
      execCommand('formatBlock', '<blockquote>');
      break;
  }
};

// 处理输入
const handleInput = () => {
  hasUnsavedChanges.value = true;
  updateWordCount();

  emit('change', {
    html: editorRef.value?.innerHTML,
    text: editorRef.value?.innerText,
  });

  // 自动保存
  if (props.autoSave) {
    scheduleAutoSave();
  }
};

// 处理键盘事件
const handleKeydown = (e) => {
  // Ctrl+S 保存
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    handleSave();
  }

  // Ctrl+B 粗体
  if (e.ctrlKey && e.key === 'b') {
    e.preventDefault();
    execCommand('bold');
  }

  // Ctrl+I 斜体
  if (e.ctrlKey && e.key === 'i') {
    e.preventDefault();
    execCommand('italic');
  }

  // Ctrl+U 下划线
  if (e.ctrlKey && e.key === 'u') {
    e.preventDefault();
    execCommand('underline');
  }
};

// 处理粘贴
const handlePaste = (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
};

// 更新字数统计
const updateWordCount = () => {
  if (!editorRef.value) return;
  const text = editorRef.value.innerText || '';
  wordCount.value = text.replace(/\s/g, '').length;
};

// 计划自动保存
const scheduleAutoSave = () => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }

  autoSaveTimer = setTimeout(() => {
    handleSave();
  }, 2000);
};

// 保存
const handleSave = async () => {
  if (!hasUnsavedChanges.value) return;

  saving.value = true;
  try {
    const html = editorRef.value?.innerHTML || '';
    const text = editorRef.value?.innerText || '';

    if (props.file?.file_path && isWordFile(props.file.file_name)) {
      // 构建完整的文件路径
      let fullPath = props.file.file_path;

      // 如果路径不是绝对路径，需要获取项目根路径
      if (!fullPath.startsWith('/') && !fullPath.match(/^[a-zA-Z]:[/\\]/)) {
        const projectId = window.location.hash.match(/\/projects\/([^/?]+)/)?.[1];
        if (projectId && !fullPath.includes(projectId)) {
          fullPath = `/data/projects/${projectId}/${fullPath}`;
        }
      }

      console.log('[RichTextEditor] 保存Word文件:', fullPath);
      // 保存为Word文件
      await window.electronAPI.file.writeWord(fullPath, {
        html,
        text,
      });
    } else {
      // 保存为HTML文件
      await window.electronAPI.file.writeContent(props.file?.file_path || 'document.html', html);
    }

    hasUnsavedChanges.value = false;
    emit('save', { html, text });
    message.success('已保存');
  } catch (error) {
    console.error('[RichTextEditor] 保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 导出
const handleExport = async ({ key }) => {
  try {
    const html = editorRef.value?.innerHTML || '';
    const text = editorRef.value?.innerText || '';

    switch (key) {
      case 'word':
        await exportToWord(html);
        break;
      case 'markdown':
        await exportToMarkdown(html);
        break;
      case 'html':
        await exportToHTML(html);
        break;
      case 'pdf':
        message.info('PDF导出功能开发中...');
        break;
    }
  } catch (error) {
    console.error('[RichTextEditor] 导出失败:', error);
    message.error('导出失败: ' + error.message);
  }
};

// 导出为Word
const exportToWord = async (html) => {
  const result = await window.electronAPI.dialog.showSaveDialog({
    defaultPath: props.file?.file_name?.replace(/\.[^.]+$/, '.docx') || 'document.docx',
    filters: [{ name: 'Word文档', extensions: ['docx'] }],
  });

  if (!result.canceled && result.filePath) {
    await window.electronAPI.file.htmlToWord(html, result.filePath, {
      title: props.file?.file_name || 'Document',
    });
    message.success('导出成功: ' + result.filePath);
  }
};

// 导出为Markdown
const exportToMarkdown = async (html) => {
  // 简单的HTML to Markdown转换
  let markdown = html
    .replace(/<h1>(.*?)<\/h1>/g, '# $1\n\n')
    .replace(/<h2>(.*?)<\/h2>/g, '## $1\n\n')
    .replace(/<h3>(.*?)<\/h3>/g, '### $1\n\n')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<b>(.*?)<\/b>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<i>(.*?)<\/i>/g, '*$1*')
    .replace(/<p>(.*?)<\/p>/g, '$1\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '');

  const result = await window.electronAPI.dialog.showSaveDialog({
    defaultPath: props.file?.file_name?.replace(/\.[^.]+$/, '.md') || 'document.md',
    filters: [{ name: 'Markdown文件', extensions: ['md'] }],
  });

  if (!result.canceled && result.filePath) {
    await window.electronAPI.file.writeContent(result.filePath, markdown);
    message.success('导出成功: ' + result.filePath);
  }
};

// 导出为HTML
const exportToHTML = async (html) => {
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${props.file?.file_name || 'Document'}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;

  const result = await window.electronAPI.dialog.showSaveDialog({
    defaultPath: props.file?.file_name?.replace(/\.[^.]+$/, '.html') || 'document.html',
    filters: [{ name: 'HTML文件', extensions: ['html'] }],
  });

  if (!result.canceled && result.filePath) {
    await window.electronAPI.file.writeContent(result.filePath, fullHtml);
    message.success('导出成功: ' + result.filePath);
  }
};

// 组件挂载
onMounted(() => {
  initEditor();
});

// 组件卸载
onBeforeUnmount(() => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
});

// 监听文件变化
watch(() => props.file, () => {
  initEditor();
}, { deep: true });

// 暴露方法
defineExpose({
  save: handleSave,
  getContent: () => ({
    html: editorRef.value?.innerHTML,
    text: editorRef.value?.innerText,
  }),
});
</script>

<style scoped>
.rich-text-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-spacer {
  flex: 1;
}

.editor-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  outline: none;
  line-height: 1.8;
  font-size: 14px;
  font-family: 'Microsoft YaHei', Arial, sans-serif;
}

.editor-content:focus {
  outline: none;
}

/* 编辑器内容样式 */
.editor-content :deep(h1) {
  font-size: 32px;
  font-weight: bold;
  margin: 24px 0 16px;
  line-height: 1.3;
}

.editor-content :deep(h2) {
  font-size: 24px;
  font-weight: bold;
  margin: 20px 0 12px;
  line-height: 1.3;
}

.editor-content :deep(h3) {
  font-size: 18px;
  font-weight: bold;
  margin: 16px 0 8px;
  line-height: 1.3;
}

.editor-content :deep(p) {
  margin: 8px 0;
}

.editor-content :deep(blockquote) {
  border-left: 4px solid #1677ff;
  padding-left: 16px;
  margin: 16px 0;
  color: #666;
}

.editor-content :deep(ul),
.editor-content :deep(ol) {
  padding-left: 24px;
  margin: 12px 0;
}

.editor-content :deep(li) {
  margin: 4px 0;
}

/* 滚动条 */
.editor-content::-webkit-scrollbar {
  width: 8px;
}

.editor-content::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}

.editor-content::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}
</style>
