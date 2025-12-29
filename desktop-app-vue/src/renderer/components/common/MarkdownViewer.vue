<template>
  <div class="markdown-viewer">
    <div v-if="loading" class="loading">
      <a-spin />
    </div>
    <div v-else-if="error" class="error">
      <a-alert
        type="error"
        :message="error"
        show-icon
      />
    </div>
    <div
      v-else
      ref="contentRef"
      class="markdown-content"
      v-html="renderedContent"
      @click="handleClick"
    ></div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import DOMPurify from 'dompurify';

const props = defineProps({
  content: {
    type: String,
    default: '',
  },
  // 文档路径，从IPC加载
  docPath: {
    type: String,
    default: '',
  },
  // 是否启用链接跳转
  enableLinkNavigation: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['link-click', 'skill-link-click', 'tool-link-click']);

const contentRef = ref(null);
const loading = ref(false);
const error = ref('');
const markdownContent = ref('');

// 配置 marked 支持代码高亮
marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: true,
  mangle: false,
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (err) {
        console.error('Highlight error:', err);
      }
    }
    return hljs.highlightAuto(code).value;
  },
});

const renderedContent = computed(() => {
  const content = markdownContent.value || props.content;
  if (!content) return '';

  try {
    const rawHtml = marked.parse(content);
    // 使用DOMPurify清理HTML，防止XSS
    return DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['target'],
    });
  } catch (err) {
    console.error('Markdown parse error:', err);
    error.value = 'Markdown解析失败: ' + err.message;
    return '';
  }
});

// 从IPC加载文档
const loadDocFromPath = async () => {
  if (!props.docPath) return;

  loading.value = true;
  error.value = '';

  try {
    const result = await window.electron.ipcRenderer.invoke('skill:get-doc', props.docPath);
    if (result.success) {
      markdownContent.value = result.content;
    } else {
      error.value = result.error || '加载文档失败';
    }
  } catch (err) {
    console.error('Load doc error:', err);
    error.value = '加载文档失败: ' + err.message;
  } finally {
    loading.value = false;
  }
};

// 处理链接点击
const handleClick = (event) => {
  if (!props.enableLinkNavigation) return;

  const target = event.target;

  if (target.tagName === 'A') {
    event.preventDefault();
    const href = target.getAttribute('href');

    if (!href) return;

    // 内部锚点链接
    if (href.startsWith('#')) {
      const anchorId = href.substring(1);
      const anchorElement = contentRef.value?.querySelector(`[id="${anchorId}"]`);
      if (anchorElement) {
        anchorElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    // 技能链接 (skill:skill_id)
    if (href.startsWith('skill:')) {
      const skillId = href.substring(6);
      emit('skill-link-click', skillId);
      return;
    }

    // 工具链接 (tool:tool_id)
    if (href.startsWith('tool:')) {
      const toolId = href.substring(5);
      emit('tool-link-click', toolId);
      return;
    }

    // 外部链接
    if (href.startsWith('http://') || href.startsWith('https://')) {
      window.electron.shell.openExternal(href);
      return;
    }

    // 相对路径文档链接
    if (href.endsWith('.md')) {
      emit('link-click', href);
      return;
    }

    emit('link-click', href);
  }
};

// 监听props变化
watch(() => props.content, (newContent) => {
  if (newContent) {
    markdownContent.value = newContent;
  }
}, { immediate: true });

watch(() => props.docPath, () => {
  if (props.docPath) {
    loadDocFromPath();
  }
}, { immediate: true });

onMounted(() => {
  if (props.content) {
    markdownContent.value = props.content;
  } else if (props.docPath) {
    loadDocFromPath();
  }
});
</script>

<style scoped lang="scss">
.markdown-viewer {
  .loading {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 40px;
  }

  .error {
    padding: 16px;
  }

  .markdown-content {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    line-height: 1.6;
    color: #24292e;

    :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
      color: #1f2328;
    }

    :deep(h1) {
      font-size: 2em;
      border-bottom: 1px solid #d0d7de;
      padding-bottom: 0.3em;
    }

    :deep(h2) {
      font-size: 1.5em;
      border-bottom: 1px solid #d0d7de;
      padding-bottom: 0.3em;
    }

    :deep(h3) {
      font-size: 1.25em;
    }

    :deep(p) {
      margin-top: 0;
      margin-bottom: 16px;
    }

    :deep(code) {
      padding: 0.2em 0.4em;
      margin: 0;
      font-size: 85%;
      background-color: #f6f8fa;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
    }

    :deep(pre) {
      padding: 16px;
      overflow: auto;
      font-size: 85%;
      line-height: 1.45;
      background-color: #f6f8fa;
      border-radius: 6px;
      margin-bottom: 16px;

      code {
        padding: 0;
        background-color: transparent;
        border-radius: 0;
      }
    }

    :deep(table) {
      border-spacing: 0;
      border-collapse: collapse;
      margin-bottom: 16px;
      width: 100%;

      th, td {
        padding: 6px 13px;
        border: 1px solid #d0d7de;
      }

      th {
        font-weight: 600;
        background-color: #f6f8fa;
      }

      tr:nth-child(2n) {
        background-color: #f6f8fa;
      }
    }

    :deep(ul), :deep(ol) {
      padding-left: 2em;
      margin-bottom: 16px;

      li {
        margin-top: 0.25em;
      }
    }

    :deep(blockquote) {
      padding: 0 1em;
      color: #57606a;
      border-left: 0.25em solid #d0d7de;
      margin-bottom: 16px;

      > :first-child {
        margin-top: 0;
      }

      > :last-child {
        margin-bottom: 0;
      }
    }

    :deep(hr) {
      height: 0.25em;
      padding: 0;
      margin: 24px 0;
      background-color: #d0d7de;
      border: 0;
    }

    :deep(a) {
      color: #0969da;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }
}
</style>
