<template>
  <div class="markdown-editor-container">
    <!-- 工具栏 -->
    <div class="markdown-toolbar">
      <div class="toolbar-left">
        <a-radio-group
          v-model:value="viewMode"
          button-style="solid"
          size="small"
        >
          <a-radio-button value="edit">
            <EditOutlined />
            编辑
          </a-radio-button>
          <a-radio-button value="split">
            <ColumnWidthOutlined />
            分屏
          </a-radio-button>
          <a-radio-button value="preview">
            <EyeOutlined />
            预览
          </a-radio-button>
        </a-radio-group>

        <a-divider type="vertical" />

        <a-button-group size="small">
          <a-button
            title="粗体"
            @click="insertFormat('**', '**')"
          >
            <BoldOutlined />
          </a-button>
          <a-button
            title="斜体"
            @click="insertFormat('*', '*')"
          >
            <ItalicOutlined />
          </a-button>
          <a-button
            title="删除线"
            @click="insertFormat('~~', '~~')"
          >
            <StrikethroughOutlined />
          </a-button>
          <a-button
            title="行内代码"
            @click="insertFormat('`', '`')"
          >
            <CodeOutlined />
          </a-button>
        </a-button-group>

        <a-divider type="vertical" />

        <a-button-group size="small">
          <a-button
            title="标题1"
            @click="insertHeading(1)"
          >
            H1
          </a-button>
          <a-button
            title="标题2"
            @click="insertHeading(2)"
          >
            H2
          </a-button>
          <a-button
            title="标题3"
            @click="insertHeading(3)"
          >
            H3
          </a-button>
        </a-button-group>

        <a-divider type="vertical" />

        <a-button-group size="small">
          <a-button
            title="无序列表"
            @click="insertList('ul')"
          >
            <UnorderedListOutlined />
          </a-button>
          <a-button
            title="有序列表"
            @click="insertList('ol')"
          >
            <OrderedListOutlined />
          </a-button>
          <a-button
            title="引用"
            @click="insertQuote()"
          >
            <MessageOutlined />
          </a-button>
          <a-button
            title="代码块"
            @click="insertCodeBlock()"
          >
            <FileTextOutlined />
          </a-button>
        </a-button-group>

        <a-divider type="vertical" />

        <a-button
          size="small"
          title="插入链接"
          @click="insertLink()"
        >
          <LinkOutlined />
        </a-button>
        <a-button
          size="small"
          title="插入图片"
          @click="insertImage()"
        >
          <PictureOutlined />
        </a-button>
        <a-button
          size="small"
          title="插入表格"
          @click="insertTable()"
        >
          <TableOutlined />
        </a-button>
      </div>

      <div class="toolbar-spacer" />

      <div class="toolbar-right">
        <a-dropdown>
          <a-button size="small">
            <ExportOutlined />
            导出
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleExport">
              <a-menu-item key="html">
                导出HTML
              </a-menu-item>
              <a-menu-item key="pdf">
                导出PDF
              </a-menu-item>
              <a-menu-item key="word">
                导出Word
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>

        <a-tag
          v-if="wordCount > 0"
          color="blue"
        >
          {{ wordCount }} 字
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

    <!-- 编辑和预览区域 -->
    <div class="markdown-content">
      <!-- 编辑器 -->
      <div
        v-show="viewMode === 'edit' || viewMode === 'split'"
        class="editor-pane"
      >
        <textarea
          ref="editorRef"
          v-model="content"
          class="markdown-textarea"
          placeholder="在此输入Markdown内容..."
          @input="handleInput"
          @keydown="handleKeydown"
        />
      </div>

      <!-- 预览 -->
      <div
        v-show="viewMode === 'preview' || viewMode === 'split'"
        class="preview-pane"
      >
        <div
          class="markdown-preview"
          v-html="renderedHTML"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { message } from 'ant-design-vue';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import {
  EditOutlined,
  EyeOutlined,
  ColumnWidthOutlined,
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  CodeOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  MessageOutlined,
  FileTextOutlined,
  LinkOutlined,
  PictureOutlined,
  TableOutlined,
  ExportOutlined,
  DownOutlined,
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
const content = ref(props.initialContent || '');
const viewMode = ref('split');
const saving = ref(false);
const hasChanges = ref(false);
let autoSaveTimer = null;

// 配置marked
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (err) {
        console.error('Highlight error:', err);
      }
    }
    return code;
  },
  breaks: true,
  gfm: true,
});

// 计算属性
const renderedHTML = computed(() => {
  try {
    return marked(content.value || '');
  } catch (error) {
    console.error('Markdown render error:', error);
    return '<p>Markdown渲染错误</p>';
  }
});

const wordCount = computed(() => {
  return content.value.replace(/\s/g, '').length;
});

// 处理输入
const handleInput = () => {
  hasChanges.value = true;
  emit('change', content.value);

  if (props.autoSave) {
    scheduleAutoSave();
  }
};

// 处理键盘事件
const handleKeydown = (e) => {
  // Ctrl+S 保存
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    save();
  }

  // Tab键插入4个空格
  if (e.key === 'Tab') {
    e.preventDefault();
    insertText('    ');
  }
};

// 插入文本
const insertText = (text, offset = 0) => {
  const textarea = editorRef.value;
  if (!textarea) {return;}

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;

  content.value = content.value.substring(0, start) + text + content.value.substring(end);

  // 设置光标位置
  setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(start + text.length + offset, start + text.length + offset);
  }, 0);

  hasChanges.value = true;
};

// 插入格式
const insertFormat = (before, after) => {
  const textarea = editorRef.value;
  if (!textarea) {return;}

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = content.value.substring(start, end);

  if (selectedText) {
    // 有选中文本，包裹它
    const newText = before + selectedText + after;
    content.value = content.value.substring(0, start) + newText + content.value.substring(end);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  } else {
    // 无选中文本，插入并定位光标
    const newText = before + '文本' + after;
    content.value = content.value.substring(0, start) + newText + content.value.substring(end);

    setTimeout(() => {
      textarea.focus();
      const cursorPos = start + before.length;
      textarea.setSelectionRange(cursorPos, cursorPos + 2);
    }, 0);
  }

  hasChanges.value = true;
};

// 插入标题
const insertHeading = (level) => {
  const prefix = '#'.repeat(level) + ' ';
  insertLinePrefix(prefix);
};

// 插入列表
const insertList = (type) => {
  const prefix = type === 'ol' ? '1. ' : '- ';
  insertLinePrefix(prefix);
};

// 插入引用
const insertQuote = () => {
  insertLinePrefix('> ');
};

// 插入代码块
const insertCodeBlock = () => {
  const codeBlock = '\n```javascript\n// 代码\n```\n';
  insertText(codeBlock, -5);
};

// 插入链接
const insertLink = () => {
  insertFormat('[', '](https://)');
};

// 插入图片
const insertImage = () => {
  insertFormat('![', '](https://)');
};

// 插入表格
const insertTable = () => {
  const table = '\n| 列1 | 列2 | 列3 |\n|-----|-----|-----|\n| 内容 | 内容 | 内容 |\n';
  insertText(table);
};

// 插入行前缀
const insertLinePrefix = (prefix) => {
  const textarea = editorRef.value;
  if (!textarea) {return;}

  const start = textarea.selectionStart;
  const lines = content.value.split('\n');
  let currentLine = 0;
  let charCount = 0;

  // 找到当前行
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= start) {
      currentLine = i;
      break;
    }
    charCount += lines[i].length + 1; // +1 for \n
  }

  // 插入前缀
  lines[currentLine] = prefix + lines[currentLine];
  content.value = lines.join('\n');

  // 设置光标位置
  setTimeout(() => {
    textarea.focus();
    const newPos = charCount + prefix.length;
    textarea.setSelectionRange(newPos, newPos);
  }, 0);

  hasChanges.value = true;
};

// 保存
const save = async () => {
  if (!hasChanges.value) {return;}

  if (!props.file?.file_path) {
    message.warning('文件路径不存在，无法保存');
    return;
  }

  saving.value = true;
  try {
    console.log('[MarkdownEditor] 保存文件:', props.file.file_path);
    console.log('[MarkdownEditor] 内容长度:', content.value?.length);

    const result = await window.electronAPI.file.writeContent(props.file.file_path, content.value);

    if (result.success) {
      hasChanges.value = false;
      emit('save', content.value);
      message.success('已保存');
      console.log('[MarkdownEditor] 保存成功');
    } else {
      throw new Error(result.error || '保存失败');
    }
  } catch (error) {
    console.error('[MarkdownEditor] 保存失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 导出
const handleExport = async ({ key }) => {
  try {
    switch (key) {
      case 'html':
        await exportHTML();
        break;
      case 'pdf':
        await exportPDF();
        break;
      case 'word':
        await exportWord();
        break;
    }
  } catch (error) {
    console.error('[MarkdownEditor] 导出失败:', error);
    message.error('导出失败: ' + error.message);
  }
};

// 导出HTML
const exportHTML = async () => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${props.file?.file_name || 'Markdown文档'}</title>
  <style>
    body {
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
    }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    pre {
      background: #f4f4f4;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
    }
    blockquote {
      border-left: 4px solid #ddd;
      padding-left: 20px;
      margin: 20px 0;
      color: #666;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 20px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 10px;
      text-align: left;
    }
    th {
      background: #f4f4f4;
    }
  </style>
</head>
<body>
  ${renderedHTML.value}
</body>
</html>`;

  const result = await window.electronAPI.dialog.showSaveDialog({
    defaultPath: props.file?.file_name?.replace('.md', '.html') || 'document.html',
    filters: [{ name: 'HTML文件', extensions: ['html'] }],
  });

  if (!result.canceled && result.filePath) {
    await window.electronAPI.file.writeContent(result.filePath, html);
    message.success('导出成功: ' + result.filePath);
  }
};

// 导出PDF
const exportPDF = async () => {
  console.log('[MarkdownEditor] 🔄 开始导出PDF...');
  console.log('[MarkdownEditor] 文件名:', props.file?.file_name);
  console.log('[MarkdownEditor] 内容长度:', content.value?.length, '字符');

  try {
    console.log('[MarkdownEditor] 📂 打开保存对话框...');
    const result = await window.electronAPI.dialog.showSaveDialog({
      defaultPath: props.file?.file_name?.replace('.md', '.pdf') || 'document.pdf',
      filters: [{ name: 'PDF文档', extensions: ['pdf'] }],
    });

    console.log('[MarkdownEditor] 对话框结果:', { canceled: result.canceled, filePath: result.filePath });

    if (result.canceled) {
      console.log('[MarkdownEditor] ❌ 用户取消导出');
      return;
    }

    if (!result.filePath) {
      console.error('[MarkdownEditor] ❌ 未获取到文件路径');
      message.error('未选择保存路径');
      return;
    }

    console.log('[MarkdownEditor] 📝 准备转换内容...');
    console.log('[MarkdownEditor] Markdown内容:', content.value?.substring(0, 100) + '...');

    message.loading({ content: '正在生成PDF...', key: 'pdf-export' });

    // 调用PDF转换API
    const pdfResult = await window.electronAPI.pdf.markdownToPDF({
      markdown: content.value,
      outputPath: result.filePath,
      title: props.file?.file_name || 'Markdown文档',
      options: {
        format: 'A4',
        margin: {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm'
        },
        printBackground: true,
        preferCSSPageSize: false
      }
    });

    console.log('[MarkdownEditor] PDF转换结果:', pdfResult);

    if (pdfResult.success) {
      message.success({
        content: `PDF导出成功: ${result.filePath}`,
        key: 'pdf-export',
        duration: 3
      });
      console.log('[MarkdownEditor] ✅ PDF导出成功');
    } else {
      const errorMsg = pdfResult.error || '未知错误';
      console.error('[MarkdownEditor] ❌ PDF转换失败:', errorMsg);
      message.error({
        content: `PDF导出失败: ${errorMsg}`,
        key: 'pdf-export',
        duration: 3
      });
    }
  } catch (error) {
    console.error('[MarkdownEditor] ❌ PDF导出异常:', error);
    console.error('[MarkdownEditor] 错误堆栈:', error.stack);

    let errorMessage = 'PDF导出失败';
    if (error.message) {
      if (error.message.includes('not available')) {
        errorMessage = 'PDF转换服务不可用，请检查系统配置';
      } else if (error.message.includes('permission')) {
        errorMessage = '没有权限写入文件，请检查文件路径';
      } else if (error.message.includes('disk')) {
        errorMessage = '磁盘空间不足';
      } else {
        errorMessage = `PDF导出失败: ${error.message}`;
      }
    }

    message.error({
      content: errorMessage,
      key: 'pdf-export',
      duration: 3
    });
  }
};

// 导出Word
const exportWord = async () => {
  console.log('[MarkdownEditor] 🔄 开始导出Word...');
  console.log('[MarkdownEditor] 文件名:', props.file?.file_name);
  console.log('[MarkdownEditor] 内容长度:', content.value?.length, '字符');

  try {
    console.log('[MarkdownEditor] 📂 打开保存对话框...');
    const result = await window.electronAPI.dialog.showSaveDialog({
      defaultPath: props.file?.file_name?.replace('.md', '.docx') || 'document.docx',
      filters: [{ name: 'Word文档', extensions: ['docx'] }],
    });

    console.log('[MarkdownEditor] 对话框结果:', { canceled: result.canceled, filePath: result.filePath });

    if (result.canceled) {
      console.log('[MarkdownEditor] ❌ 用户取消了导出');
      return;
    }

    if (!result.filePath) {
      console.error('[MarkdownEditor] ❌ 没有选择文件路径');
      message.error('请选择保存位置');
      return;
    }

    console.log('[MarkdownEditor] ✅ 用户选择路径:', result.filePath);
    console.log('[MarkdownEditor] 📝 调用 markdownToWord IPC...');

    const exportResult = await window.electronAPI.file.markdownToWord(
      content.value,
      result.filePath,
      { title: props.file?.file_name || 'Document' }
    );

    console.log('[MarkdownEditor] IPC返回结果:', exportResult);

    if (exportResult && exportResult.success) {
      console.log('[MarkdownEditor] ✅ 导出成功!');
      message.success('导出成功: ' + result.filePath);
    } else {
      console.error('[MarkdownEditor] ❌ 导出失败:', exportResult);
      message.error('导出失败: ' + (exportResult?.error || '未知错误'));
    }
  } catch (error) {
    console.error('[MarkdownEditor] ❌ 导出过程发生异常:', error);
    console.error('[MarkdownEditor] 错误堆栈:', error.stack);
    message.error('导出失败: ' + error.message);
  }
};

// 计划自动保存
const scheduleAutoSave = () => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = setTimeout(save, 2000);
};

// 监听 initialContent 变化（主要加载方式）
watch(() => props.initialContent, (newContent) => {
  if (newContent !== undefined && newContent !== content.value) {
    console.log('[MarkdownEditor] initialContent 变化，更新内容，长度:', newContent?.length);
    content.value = newContent || '';
    hasChanges.value = false;
  }
}, { immediate: true });

// 监听文件变化（作为备用加载方式）
watch(() => props.file?.id, async (newId, oldId) => {
  if (newId && newId !== oldId && props.file?.file_path) {
    // 只有在 initialContent 为空时才尝试直接读取文件
    if (!props.initialContent) {
      try {
        console.log('[MarkdownEditor] 文件变化，直接读取:', props.file.file_path);
        const result = await window.electronAPI.file.readContent(props.file.file_path);
        if (result.success) {
          content.value = result.content || '';
          hasChanges.value = false;
        }
      } catch (error) {
        console.error('[MarkdownEditor] 读取文件失败:', error);
        message.error('读取文件失败: ' + error.message);
      }
    }
  }
});

// 组件挂载
onMounted(() => {
  console.log('[MarkdownEditor] 组件挂载，initialContent 长度:', props.initialContent?.length);
  if (props.initialContent) {
    content.value = props.initialContent;
  }
});

// 组件卸载
onBeforeUnmount(() => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
});

// 暴露方法
defineExpose({
  save,
  getContent: () => content.value,
  setContent: (newContent) => {
    content.value = newContent;
    hasChanges.value = true;
  },
});
</script>

<style scoped lang="scss">
.markdown-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.markdown-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
  flex-wrap: wrap;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-spacer {
  flex: 1;
  min-width: 20px;
}

.markdown-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-pane,
.preview-pane {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}

.editor-pane {
  border-right: 1px solid #e8e8e8;
}

.markdown-textarea {
  width: 100%;
  height: 100%;
  padding: 20px;
  border: none;
  outline: none;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  background: #fff;
  color: #333;
}

.markdown-preview {
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #333;

  :deep(h1) {
    font-size: 32px;
    font-weight: 600;
    margin: 24px 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #eaecef;
  }

  :deep(h2) {
    font-size: 24px;
    font-weight: 600;
    margin: 20px 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid #eaecef;
  }

  :deep(h3) {
    font-size: 20px;
    font-weight: 600;
    margin: 16px 0 8px;
  }

  :deep(p) {
    margin: 12px 0;
  }

  :deep(code) {
    background: #f6f8fa;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 13px;
    color: #e83e8c;
  }

  :deep(pre) {
    background: #282c34;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 16px 0;

    code {
      background: none;
      padding: 0;
      color: #abb2bf;
      font-size: 13px;
      line-height: 1.5;
    }
  }

  :deep(blockquote) {
    border-left: 4px solid #1677ff;
    padding-left: 20px;
    margin: 16px 0;
    color: #666;
    background: #f6f8fa;
    padding: 12px 20px;
    border-radius: 0 6px 6px 0;
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 28px;
    margin: 12px 0;
  }

  :deep(li) {
    margin: 6px 0;
  }

  :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 16px 0;
    border: 1px solid #e8e8e8;
  }

  :deep(th),
  :deep(td) {
    border: 1px solid #e8e8e8;
    padding: 10px 12px;
    text-align: left;
  }

  :deep(th) {
    background: #fafafa;
    font-weight: 600;
  }

  :deep(tr:hover) {
    background: #f5f5f5;
  }

  :deep(a) {
    color: #1677ff;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    margin: 12px 0;
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid #e8e8e8;
    margin: 24px 0;
  }
}

/* 滚动条样式 */
.editor-pane::-webkit-scrollbar,
.preview-pane::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.editor-pane::-webkit-scrollbar-track,
.preview-pane::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.editor-pane::-webkit-scrollbar-thumb,
.preview-pane::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;

  &:hover {
    background: #a8a8a8;
  }
}
</style>
