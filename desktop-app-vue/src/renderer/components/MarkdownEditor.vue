<template>
  <div class="markdown-editor-container">
    <div class="editor-toolbar">
      <a-space>
        <a-tooltip title="粗体 (Ctrl+B)">
          <a-button
            size="small"
            @click="insertBold"
          >
            <template #icon>
              <BoldOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-tooltip title="斜体 (Ctrl+I)">
          <a-button
            size="small"
            @click="insertItalic"
          >
            <template #icon>
              <ItalicOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-tooltip title="代码 (Ctrl+`)">
          <a-button
            size="small"
            @click="insertCode"
          >
            <template #icon>
              <CodeOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-divider type="vertical" />
        <a-tooltip title="标题1">
          <a-button
            size="small"
            @click="insertHeading(1)"
          >
            H1
          </a-button>
        </a-tooltip>
        <a-tooltip title="标题2">
          <a-button
            size="small"
            @click="insertHeading(2)"
          >
            H2
          </a-button>
        </a-tooltip>
        <a-tooltip title="标题3">
          <a-button
            size="small"
            @click="insertHeading(3)"
          >
            H3
          </a-button>
        </a-tooltip>
        <a-divider type="vertical" />
        <a-tooltip title="无序列表">
          <a-button
            size="small"
            @click="insertList('bullet')"
          >
            <template #icon>
              <UnorderedListOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-tooltip title="有序列表">
          <a-button
            size="small"
            @click="insertList('ordered')"
          >
            <template #icon>
              <OrderedListOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-tooltip title="任务列表">
          <a-button
            size="small"
            @click="insertTaskList"
          >
            <template #icon>
              <CheckSquareOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-divider type="vertical" />
        <a-tooltip title="插入链接">
          <a-button
            size="small"
            @click="insertLink"
          >
            <template #icon>
              <LinkOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-tooltip title="插入图片">
          <a-button
            size="small"
            @click="insertImage"
          >
            <template #icon>
              <PictureOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-tooltip title="插入表格">
          <a-button
            size="small"
            @click="insertTable"
          >
            <template #icon>
              <TableOutlined />
            </template>
          </a-button>
        </a-tooltip>
        <a-divider type="vertical" />
        <a-tooltip title="语音输入">
          <EnhancedVoiceInput
            @result="handleVoiceResult"
            @partial="handleVoicePartial"
          />
        </a-tooltip>
        <a-divider type="vertical" />
        <a-button-group size="small">
          <a-button
            :type="mode === 'edit' ? 'primary' : 'default'"
            @click="mode = 'edit'"
          >
            编辑
          </a-button>
          <a-button
            :type="mode === 'split' ? 'primary' : 'default'"
            @click="mode = 'split'"
          >
            分屏
          </a-button>
          <a-button
            :type="mode === 'preview' ? 'primary' : 'default'"
            @click="mode = 'preview'"
          >
            预览
          </a-button>
        </a-button-group>
      </a-space>
    </div>

    <div
      class="editor-content"
      :class="`mode-${mode}`"
    >
      <!-- 编辑区域 -->
      <div
        v-show="mode === 'edit' || mode === 'split'"
        class="editor-pane"
      >
        <div
          ref="editorRef"
          class="milkdown-editor"
        />
      </div>

      <!-- 预览区域 -->
      <div
        v-show="mode === 'preview' || mode === 'split'"
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
import { logger, createLogger } from '@/utils/logger';

import { ref, onMounted, watch, computed, onBeforeUnmount } from 'vue';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { nord } from '@milkdown/theme-nord';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import {
  BoldOutlined,
  ItalicOutlined,
  CodeOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  CheckSquareOutlined,
  LinkOutlined,
  PictureOutlined,
  TableOutlined,
} from '@ant-design/icons-vue';
import MarkdownIt from 'markdown-it';
import EnhancedVoiceInput from './common/EnhancedVoiceInput.vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  placeholder: {
    type: String,
    default: '开始写作...',
  },
  autofocus: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'change', 'save']);

const editorRef = ref(null);
const mode = ref('split'); // 'edit', 'split', 'preview'
let milkdownEditor = null;
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// 渲染后的HTML
const renderedHTML = computed(() => {
  return md.render(props.modelValue || '');
});

// 初始化编辑器
onMounted(async () => {
  try {
    milkdownEditor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, editorRef.value);
        ctx.set(defaultValueCtx, props.modelValue || '');

        // 监听内容变化
        ctx.get(listenerCtx).markdownUpdated((ctx, markdown) => {
          emit('update:modelValue', markdown);
          emit('change', markdown);
        });
      })
      .use(nord)
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .create();

    logger.info('[MarkdownEditor] 编辑器初始化成功');
  } catch (error) {
    logger.error('[MarkdownEditor] 初始化失败:', error);
  }
});

// 监听外部值变化
watch(() => props.modelValue, (newValue) => {
  if (milkdownEditor && newValue !== getEditorContent()) {
    updateEditorContent(newValue);
  }
});

// 清理
onBeforeUnmount(() => {
  if (milkdownEditor) {
    milkdownEditor.destroy();
  }
});

// 获取编辑器内容
function getEditorContent() {
  if (!milkdownEditor) {return '';}
  return milkdownEditor.action((ctx) => {
    const view = ctx.get(rootCtx);
    // TODO: 获取实际内容
    return props.modelValue;
  });
}

// 更新编辑器内容
function updateEditorContent(content) {
  if (!milkdownEditor) {return;}
  milkdownEditor.action((ctx) => {
    ctx.set(defaultValueCtx, content);
  });
}

// 工具栏功能
function insertBold() {
  insertMarkdown('**粗体文本**', 2, 6);
}

function insertItalic() {
  insertMarkdown('*斜体文本*', 1, 5);
}

function insertCode() {
  insertMarkdown('`代码`', 1, 3);
}

function insertHeading(level) {
  const prefix = '#'.repeat(level) + ' ';
  insertMarkdown(prefix + '标题文本\n', prefix.length, prefix.length + 4);
}

function insertList(type) {
  const prefix = type === 'bullet' ? '- ' : '1. ';
  insertMarkdown(prefix + '列表项\n', prefix.length, prefix.length + 3);
}

function insertTaskList() {
  insertMarkdown('- [ ] 任务项\n', 6, 9);
}

function insertLink() {
  insertMarkdown('[链接文本](https://example.com)', 1, 5);
}

function insertImage() {
  insertMarkdown('![图片描述](image-url.jpg)', 2, 6);
}

function insertTable() {
  const table = `
| 列1 | 列2 | 列3 |
|-----|-----|-----|
| 内容 | 内容 | 内容 |
`;
  insertMarkdown(table, 2, 4);
}

// 插入Markdown文本 (简化实现)
function insertMarkdown(text, selStart, selEnd) {
  const currentValue = props.modelValue || '';
  const newValue = currentValue + '\n' + text;
  emit('update:modelValue', newValue);
  emit('change', newValue);
}

// 快捷键处理
function handleKeyDown(event) {
  if (event.ctrlKey || event.metaKey) {
    switch (event.key.toLowerCase()) {
      case 'b':
        event.preventDefault();
        insertBold();
        break;
      case 'i':
        event.preventDefault();
        insertItalic();
        break;
      case '`':
        event.preventDefault();
        insertCode();
        break;
      case 's':
        event.preventDefault();
        emit('save');
        break;
    }
  }
}

// 语音输入处理
function handleVoiceResult(text) {
  const currentValue = props.modelValue || '';
  const newValue = currentValue + (currentValue ? '\n\n' : '') + text;
  emit('update:modelValue', newValue);
  emit('change', newValue);
}

function handleVoicePartial(text) {
  // 可以在这里显示临时的语音识别结果
  logger.info('语音识别中:', text);
}

// 暴露方法给父组件
defineExpose({
  getContent: () => props.modelValue,
  setContent: (content) => {
    emit('update:modelValue', content);
  },
  insertText: insertMarkdown,
});
</script>

<style scoped>
.markdown-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  overflow: hidden;
}

.editor-toolbar {
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #d9d9d9;
}

.editor-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.mode-edit .editor-pane {
  width: 100%;
}

.mode-preview .preview-pane {
  width: 100%;
}

.mode-split .editor-pane,
.mode-split .preview-pane {
  width: 50%;
}

.editor-pane,
.preview-pane {
  overflow-y: auto;
  height: 100%;
}

.editor-pane {
  border-right: 1px solid #d9d9d9;
  background: #fff;
}

.milkdown-editor {
  height: 100%;
  padding: 16px;
}

/* Milkdown主题覆盖 */
.milkdown-editor :deep(.milkdown) {
  min-height: 100%;
}

.milkdown-editor :deep(.editor) {
  outline: none;
}

.preview-pane {
  background: #fff;
  padding: 16px;
}

.markdown-preview {
  max-width: 800px;
  margin: 0 auto;
  font-size: 14px;
  line-height: 1.6;
  color: #333;
}

/* Markdown预览样式 */
.markdown-preview :deep(h1) {
  font-size: 2em;
  font-weight: 600;
  margin-top: 24px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eaecef;
}

.markdown-preview :deep(h2) {
  font-size: 1.5em;
  font-weight: 600;
  margin-top: 24px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eaecef;
}

.markdown-preview :deep(h3) {
  font-size: 1.25em;
  font-weight: 600;
  margin-top: 16px;
  margin-bottom: 8px;
}

.markdown-preview :deep(p) {
  margin: 8px 0;
}

.markdown-preview :deep(code) {
  padding: 2px 6px;
  background: #f6f8fa;
  border-radius: 3px;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 0.9em;
}

.markdown-preview :deep(pre) {
  padding: 16px;
  background: #f6f8fa;
  border-radius: 4px;
  overflow-x: auto;
}

.markdown-preview :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown-preview :deep(blockquote) {
  margin: 16px 0;
  padding-left: 16px;
  border-left: 4px solid #dfe2e5;
  color: #6a737d;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-left: 2em;
  margin: 8px 0;
}

.markdown-preview :deep(li) {
  margin: 4px 0;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
}

.markdown-preview :deep(table th),
.markdown-preview :deep(table td) {
  border: 1px solid #dfe2e5;
  padding: 8px 13px;
}

.markdown-preview :deep(table th) {
  background: #f6f8fa;
  font-weight: 600;
}

.markdown-preview :deep(a) {
  color: #0366d6;
  text-decoration: none;
}

.markdown-preview :deep(a:hover) {
  text-decoration: underline;
}

.markdown-preview :deep(img) {
  max-width: 100%;
  height: auto;
}

.markdown-preview :deep(hr) {
  border: none;
  border-top: 1px solid #eaecef;
  margin: 24px 0;
}
</style>
