<template>
  <div class="preview-panel">
    <!-- 头部工具栏 -->
    <div class="preview-header">
      <div class="header-left">
        <FileOutlined />
        <span class="file-name">{{ file?.file_name || '预览' }}</span>
        <a-tag v-if="fileType" :color="getFileTypeColor()">
          {{ getFileTypeLabel() }}
        </a-tag>
      </div>
      <div class="header-right">
        <!-- 图片预览专用控制 -->
        <template v-if="fileType === 'image'">
          <a-tooltip title="放大">
            <a-button type="text" size="small" @click="handleZoomIn">
              <ZoomInOutlined />
            </a-button>
          </a-tooltip>
          <a-tooltip title="缩小">
            <a-button type="text" size="small" @click="handleZoomOut">
              <ZoomOutOutlined />
            </a-button>
          </a-tooltip>
          <a-tooltip title="重置">
            <a-button type="text" size="small" @click="handleZoomReset">
              <ReloadOutlined />
            </a-button>
          </a-tooltip>
        </template>

        <!-- 通用控制 -->
        <a-tooltip title="在系统中打开">
          <a-button type="text" size="small" @click="handleOpenExternal">
            <ExportOutlined />
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- 预览内容区 -->
    <div class="preview-content" ref="contentRef">
      <!-- 图片预览 -->
      <div v-if="fileType === 'image'" class="image-preview">
        <img
          :src="imageUrl"
          :alt="file?.file_name"
          :style="imageStyle"
          @error="handleImageError"
        />
      </div>

      <!-- Markdown 渲染预览 -->
      <div v-else-if="fileType === 'markdown'" class="markdown-preview" v-html="renderedMarkdown"></div>

      <!-- 代码预览（语法高亮） -->
      <div v-else-if="fileType === 'code'" class="code-preview">
        <pre><code :class="codeLanguageClass" v-html="highlightedCode"></code></pre>
      </div>

      <!-- CSV 表格预览 -->
      <div v-else-if="fileType === 'csv'" class="csv-preview">
        <a-table
          :columns="csvColumns"
          :data-source="csvData"
          :pagination="csvPagination"
          :scroll="{ x: 'max-content', y: 'calc(100vh - 250px)' }"
          size="small"
          bordered
        />
      </div>

      <!-- JSON 格式化预览 -->
      <div v-else-if="fileType === 'json'" class="json-preview">
        <pre><code class="language-json" v-html="highlightedJson"></code></pre>
      </div>

      <!-- PDF 预览 -->
      <div v-else-if="fileType === 'pdf'" class="pdf-preview">
        <VuePdfEmbed
          v-if="pdfUrl"
          :source="pdfUrl"
          class="pdf-viewer"
          @loaded="handlePdfLoaded"
          @loading-failed="handlePdfError"
        />
      </div>

      <!-- 视频预览 -->
      <div v-else-if="fileType === 'video'" class="video-preview">
        <video :src="videoUrl" controls class="video-player">
          您的浏览器不支持视频播放
        </video>
      </div>

      <!-- 音频预览 -->
      <div v-else-if="fileType === 'audio'" class="audio-preview">
        <audio :src="audioUrl" controls class="audio-player">
          您的浏览器不支持音频播放
        </audio>
      </div>

      <!-- 不支持预览的文件类型 -->
      <div v-else class="unsupported-preview">
        <FileUnknownOutlined class="unsupported-icon" />
        <h3>无法预览此文件</h3>
        <p>文件类型: {{ file?.file_name?.split('.').pop()?.toUpperCase() || '未知' }}</p>
        <a-space>
          <a-button type="primary" @click="handleOpenExternal">
            <ExportOutlined />
            在系统中打开
          </a-button>
          <a-button @click="handleDownload">
            <DownloadOutlined />
            下载文件
          </a-button>
        </a-space>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-overlay">
        <a-spin size="large" tip="加载中..." />
      </div>

      <!-- 错误状态 -->
      <div v-if="error" class="error-overlay">
        <CloseCircleOutlined class="error-icon" />
        <h3>加载失败</h3>
        <p>{{ error }}</p>
        <a-button type="primary" @click="handleRetry">重试</a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  FileOutlined,
  FileUnknownOutlined,
  ExportOutlined,
  DownloadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import Papa from 'papaparse';
import VuePdfEmbed from 'vue-pdf-embed';

const props = defineProps({
  file: {
    type: Object,
    default: null,
  },
  projectPath: {
    type: String,
    default: '',
  },
  content: {
    type: String,
    default: '',
  },
  projectId: {
    type: String,
    default: '',
  },
});

// 状态
const loading = ref(false);
const error = ref(null);
const contentRef = ref(null);

// 图片预览
const imageUrl = ref('');
const imageZoom = ref(1);
const imageRotate = ref(0);

// Markdown
const renderedMarkdown = ref('');

// 代码高亮
const highlightedCode = ref('');
const codeLanguageClass = ref('');

// CSV
const csvData = ref([]);
const csvColumns = ref([]);
const csvPagination = ref({ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` });

// JSON
const highlightedJson = ref('');

// PDF
const pdfUrl = ref('');

// 视频/音频
const videoUrl = ref('');
const audioUrl = ref('');

/**
 * 文件类型检测
 */
const fileType = computed(() => {
  if (!props.file?.file_name) return null;

  const ext = props.file.file_name.split('.').pop().toLowerCase();

  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const codeExtensions = ['js', 'ts', 'jsx', 'tsx', 'vue', 'html', 'css', 'scss', 'less', 'xml', 'yml', 'yaml', 'txt'];
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

  if (ext === 'md') return 'markdown';
  if (ext === 'csv') return 'csv';
  if (ext === 'json') return 'json';
  if (ext === 'pdf') return 'pdf';
  if (imageExtensions.includes(ext)) return 'image';
  if (codeExtensions.includes(ext)) return 'code';
  if (videoExtensions.includes(ext)) return 'video';
  if (audioExtensions.includes(ext)) return 'audio';

  return 'unsupported';
});

/**
 * 获取文件类型标签颜色
 */
const getFileTypeColor = () => {
  const colorMap = {
    image: 'green',
    markdown: 'blue',
    code: 'purple',
    csv: 'orange',
    json: 'cyan',
    pdf: 'red',
    video: 'magenta',
    audio: 'geekblue',
    unsupported: 'default',
  };
  return colorMap[fileType.value] || 'default';
};

/**
 * 获取文件类型标签文本
 */
const getFileTypeLabel = () => {
  const labelMap = {
    image: '图片',
    markdown: 'Markdown',
    code: '代码',
    csv: 'CSV表格',
    json: 'JSON',
    pdf: 'PDF',
    video: '视频',
    audio: '音频',
    unsupported: '不支持',
  };
  return labelMap[fileType.value] || '未知';
};

/**
 * 图片缩放控制
 */
const imageStyle = computed(() => ({
  transform: `scale(${imageZoom.value}) rotate(${imageRotate.value}deg)`,
  transition: 'transform 0.3s ease',
}));

const handleZoomIn = () => {
  imageZoom.value = Math.min(imageZoom.value + 0.25, 5);
};

const handleZoomOut = () => {
  imageZoom.value = Math.max(imageZoom.value - 0.25, 0.25);
};

const handleZoomReset = () => {
  imageZoom.value = 1;
  imageRotate.value = 0;
};

const handleImageError = () => {
  error.value = '图片加载失败';
};

/**
 * 加载文件内容
 */
const loadFileContent = async () => {
  if (!props.file || !fileType.value) return;

  loading.value = true;
  error.value = null;

  try {
    const filePath = props.file.file_path;

    // 根据文件类型加载不同内容
    switch (fileType.value) {
      case 'image':
        await loadImage(filePath);
        break;
      case 'markdown':
        await loadMarkdown(props.content || '');
        break;
      case 'code':
        await loadCode(props.content || '', props.file.file_name);
        break;
      case 'csv':
        await loadCsv(props.content || '');
        break;
      case 'json':
        await loadJson(props.content || '');
        break;
      case 'pdf':
        await loadPdf(filePath);
        break;
      case 'video':
        await loadVideo(filePath);
        break;
      case 'audio':
        await loadAudio(filePath);
        break;
    }
  } catch (err) {
    console.error('加载文件失败:', err);
    error.value = err.message || '加载文件失败';
  } finally {
    loading.value = false;
  }
};

/**
 * 加载图片
 */
const loadImage = async (filePath) => {
  // 构建完整路径
  let fullPath = filePath;
  if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
    fullPath = `/data/projects/${props.projectId}/${filePath}`;
  }

  // 解析路径
  const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
  imageUrl.value = `file://${resolvedPath}`;
  imageZoom.value = 1;
  imageRotate.value = 0;
};

/**
 * 加载 Markdown
 */
const loadMarkdown = async (content) => {
  // 配置 marked
  marked.setOptions({
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true,
  });

  renderedMarkdown.value = marked(content);
};

/**
 * 加载代码（语法高亮）
 */
const loadCode = async (content, fileName) => {
  const ext = fileName.split('.').pop().toLowerCase();

  // 语言映射
  const langMap = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    vue: 'html',
    htm: 'html',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    xml: 'xml',
    yml: 'yaml',
    yaml: 'yaml',
    txt: 'plaintext',
  };

  const language = langMap[ext] || 'plaintext';
  codeLanguageClass.value = `language-${language}`;

  if (language && hljs.getLanguage(language)) {
    highlightedCode.value = hljs.highlight(content, { language }).value;
  } else {
    highlightedCode.value = hljs.highlightAuto(content).value;
  }
};

/**
 * 加载 CSV
 */
const loadCsv = async (content) => {
  // 检查内容是否为空
  if (!content || content.trim().length === 0) {
    throw new Error('CSV 文件为空');
  }

  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    delimiter: '', // 自动检测
    delimitersToGuess: [',', '\t', '|', ';', Papa.RECORD_SEP, Papa.UNIT_SEP],
  });

  // 检查是否有严重错误（忽略分隔符检测警告）
  const criticalErrors = result.errors.filter(err => err.type !== 'Delimiter');
  if (criticalErrors.length > 0) {
    console.warn('CSV 解析警告:', result.errors);
    // 不抛出错误，继续显示可解析的部分
  }

  // 如果没有解析到数据，尝试作为纯文本显示
  if (!result.data || result.data.length === 0) {
    throw new Error('CSV 文件无法解析，没有找到有效数据');
  }

  csvData.value = result.data.map((row, index) => ({
    key: index,
    ...row,
  }));

  // 生成列定义
  if (result.meta.fields && result.meta.fields.length > 0) {
    csvColumns.value = result.meta.fields.map((field) => ({
      title: field,
      dataIndex: field,
      key: field,
      ellipsis: true,
      width: 150,
    }));
  } else {
    // 如果没有字段名，从第一行数据生成
    const firstRow = result.data[0];
    if (firstRow) {
      csvColumns.value = Object.keys(firstRow).map((key) => ({
        title: key,
        dataIndex: key,
        key: key,
        ellipsis: true,
        width: 150,
      }));
    }
  }
};

/**
 * 加载 JSON
 */
const loadJson = async (content) => {
  try {
    const parsed = JSON.parse(content);
    const formatted = JSON.stringify(parsed, null, 2);
    highlightedJson.value = hljs.highlight(formatted, { language: 'json' }).value;
  } catch (err) {
    throw new Error('JSON 格式错误: ' + err.message);
  }
};

/**
 * 加载 PDF
 */
const loadPdf = async (filePath) => {
  // 构建完整路径
  let fullPath = filePath;
  if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
    fullPath = `/data/projects/${props.projectId}/${filePath}`;
  }

  const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
  pdfUrl.value = `file://${resolvedPath}`;
};

/**
 * 加载视频
 */
const loadVideo = async (filePath) => {
  // 构建完整路径
  let fullPath = filePath;
  if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
    fullPath = `/data/projects/${props.projectId}/${filePath}`;
  }

  const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
  videoUrl.value = `file://${resolvedPath}`;
};

/**
 * 加载音频
 */
const loadAudio = async (filePath) => {
  // 构建完整路径
  let fullPath = filePath;
  if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
    fullPath = `/data/projects/${props.projectId}/${filePath}`;
  }

  const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
  audioUrl.value = `file://${resolvedPath}`;
};

/**
 * PDF 加载完成
 */
const handlePdfLoaded = () => {
  console.log('[PreviewPanel] PDF 加载完成');
};

/**
 * PDF 加载失败
 */
const handlePdfError = (err) => {
  error.value = 'PDF 加载失败';
  console.error('[PreviewPanel] PDF 加载失败:', err);
};

/**
 * 在系统中打开文件
 */
const handleOpenExternal = async () => {
  if (!props.file?.file_path) return;

  try {
    const resolvedPath = await window.electronAPI.project.resolvePath(props.file.file_path);
    await window.electronAPI.shell.openPath(resolvedPath);
    message.success('已在系统中打开');
  } catch (err) {
    console.error('打开文件失败:', err);
    message.error('打开文件失败');
  }
};

/**
 * 下载文件
 */
const handleDownload = async () => {
  // TODO: 实现文件下载功能
  message.info('下载功能开发中');
};

/**
 * 重试加载
 */
const handleRetry = () => {
  loadFileContent();
};

// 监听文件变化
watch(() => props.file, () => {
  loadFileContent();
}, { immediate: true });

// 监听内容变化
watch(() => props.content, () => {
  if (props.file && ['markdown', 'code', 'csv', 'json'].includes(fileType.value)) {
    loadFileContent();
  }
});

onMounted(() => {
  loadFileContent();
});
</script>

<style scoped>
.preview-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

/* 头部工具栏 */
.preview-header {
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
  gap: 4px;
}

/* 预览内容区 */
.preview-content {
  flex: 1;
  overflow: auto;
  position: relative;
}

/* 图片预览 */
.image-preview {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #f5f5f5;
  padding: 20px;
}

.image-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  cursor: zoom-in;
}

/* Markdown 预览 */
.markdown-preview {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
  line-height: 1.6;
  color: #262626;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}

.markdown-preview :deep(h1) {
  font-size: 2em;
  border-bottom: 1px solid #e8e8e8;
  padding-bottom: 0.3em;
}

.markdown-preview :deep(h2) {
  font-size: 1.5em;
  border-bottom: 1px solid #e8e8e8;
  padding-bottom: 0.3em;
}

.markdown-preview :deep(p) {
  margin-bottom: 16px;
}

.markdown-preview :deep(code) {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}

.markdown-preview :deep(pre) {
  background: #f6f8fa;
  padding: 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin-bottom: 16px;
}

.markdown-preview :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown-preview :deep(blockquote) {
  border-left: 4px solid #d9d9d9;
  padding-left: 16px;
  margin: 16px 0;
  color: #8c8c8c;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 16px;
}

.markdown-preview :deep(table th),
.markdown-preview :deep(table td) {
  border: 1px solid #e8e8e8;
  padding: 8px 12px;
}

.markdown-preview :deep(table th) {
  background: #fafafa;
  font-weight: 600;
}

/* 代码预览 */
.code-preview {
  height: 100%;
  overflow: auto;
}

.code-preview pre {
  margin: 0;
  padding: 16px;
  background: #f6f8fa;
  min-height: 100%;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.code-preview code {
  display: block;
}

/* CSV 表格预览 */
.csv-preview {
  padding: 16px;
  height: 100%;
  overflow: auto;
}

/* JSON 预览 */
.json-preview {
  height: 100%;
  overflow: auto;
}

.json-preview pre {
  margin: 0;
  padding: 16px;
  background: #f6f8fa;
  min-height: 100%;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.5;
}

/* PDF 预览 */
.pdf-preview {
  height: 100%;
  overflow: auto;
  background: #525659;
}

.pdf-viewer {
  width: 100%;
  height: 100%;
}

/* 视频预览 */
.video-preview {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #000;
  padding: 20px;
}

.video-player {
  max-width: 100%;
  max-height: 100%;
}

/* 音频预览 */
.audio-preview {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px;
}

.audio-player {
  width: 100%;
  max-width: 600px;
}

/* 不支持预览 */
.unsupported-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 40px;
  text-align: center;
}

.unsupported-icon {
  font-size: 64px;
  color: #bfbfbf;
  margin-bottom: 24px;
}

.unsupported-preview h3 {
  margin: 0 0 12px 0;
  font-size: 18px;
  font-weight: 500;
  color: #262626;
}

.unsupported-preview p {
  margin: 0 0 24px 0;
  color: #8c8c8c;
}

/* 加载状态 */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(255, 255, 255, 0.9);
  z-index: 10;
}

/* 错误状态 */
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: rgba(255, 255, 255, 0.95);
  z-index: 10;
  text-align: center;
  padding: 40px;
}

.error-icon {
  font-size: 64px;
  color: #ff4d4f;
  margin-bottom: 24px;
}

.error-overlay h3 {
  margin: 0 0 12px 0;
  font-size: 18px;
  font-weight: 500;
  color: #262626;
}

.error-overlay p {
  margin: 0 0 24px 0;
  color: #8c8c8c;
  max-width: 400px;
}
</style>
