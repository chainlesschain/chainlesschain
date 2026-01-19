<template>
  <div class="preview-panel">
    <!-- 头部工具栏 -->
    <div class="preview-header">
      <div class="header-left">
        <FileOutlined />
        <span class="file-name">{{ file?.file_name || '预览' }}</span>
        <a-tag
          v-if="fileType"
          :color="getFileTypeColor()"
        >
          {{ getFileTypeLabel() }}
        </a-tag>
      </div>
      <div class="header-right">
        <!-- 图片预览专用控制 -->
        <template v-if="fileType === 'image'">
          <a-tooltip title="放大">
            <a-button
              type="text"
              size="small"
              @click="handleZoomIn"
            >
              <ZoomInOutlined />
            </a-button>
          </a-tooltip>
          <a-tooltip title="缩小">
            <a-button
              type="text"
              size="small"
              @click="handleZoomOut"
            >
              <ZoomOutOutlined />
            </a-button>
          </a-tooltip>
          <a-tooltip title="重置">
            <a-button
              type="text"
              size="small"
              @click="handleZoomReset"
            >
              <ReloadOutlined />
            </a-button>
          </a-tooltip>
        </template>

        <!-- 通用控制 -->
        <a-tooltip title="在系统中打开">
          <a-button
            type="text"
            size="small"
            @click="handleOpenExternal"
          >
            <ExportOutlined />
          </a-button>
        </a-tooltip>
        <a-tooltip :title="isFullscreen ? '退出全屏 (ESC)' : '全屏 (F11)'">
          <a-button
            type="text"
            size="small"
            @click="toggleFullscreen"
          >
            <FullscreenExitOutlined v-if="isFullscreen" />
            <FullscreenOutlined v-else />
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- 预览内容区 -->
    <div
      ref="contentRef"
      class="preview-content"
    >
      <!-- 大文件预览（文本类型） -->
      <LargeFilePreview
        v-if="isLargeFile && ['markdown', 'code', 'csv', 'json'].includes(fileType)"
        :file="file"
        :project-id="projectId"
      />

      <!-- 图片预览 -->
      <div
        v-else-if="fileType === 'image'"
        class="image-preview"
      >
        <img
          :src="imageUrl"
          :alt="file?.file_name"
          :style="imageStyle"
          @error="handleImageError"
        >
      </div>

      <!-- Markdown 渲染预览 -->
      <div
        v-else-if="fileType === 'markdown'"
        class="markdown-preview"
        v-html="renderedMarkdown"
      />

      <!-- 代码预览（语法高亮） -->
      <div
        v-else-if="fileType === 'code'"
        class="code-preview"
      >
        <pre><code
:class="codeLanguageClass"
                   v-html="highlightedCode"
        /></pre>
      </div>

      <!-- CSV 表格预览 -->
      <div
        v-else-if="fileType === 'csv'"
        class="csv-preview"
      >
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
      <div
        v-else-if="fileType === 'json'"
        class="json-preview"
      >
        <pre><code
class="language-json"
                   v-html="highlightedJson"
        /></pre>
      </div>

      <!-- PDF 预览 -->
      <div
        v-else-if="fileType === 'pdf'"
        class="pdf-preview"
      >
        <VuePdfEmbed
          v-if="pdfUrl"
          :source="pdfUrl"
          class="pdf-viewer"
          @loaded="handlePdfLoaded"
          @loading-failed="handlePdfError"
        />
      </div>

      <!-- 视频预览 -->
      <div
        v-else-if="fileType === 'video'"
        class="video-preview"
      >
        <video
          :src="videoUrl"
          controls
          class="video-player"
        >
          您的浏览器不支持视频播放
        </video>
      </div>

      <!-- 音频预览 -->
      <div
        v-else-if="fileType === 'audio'"
        class="audio-preview"
      >
        <audio
          :src="audioUrl"
          controls
          class="audio-player"
        >
          您的浏览器不支持音频播放
        </audio>
      </div>

      <!-- Word文档预览 -->
      <div
        v-else-if="fileType === 'word'"
        class="office-preview word-preview"
      >
        <div
          v-if="officeContent"
          class="office-content"
          v-html="officeContent"
        />
      </div>

      <!-- Excel表格预览 -->
      <div
        v-else-if="fileType === 'excel'"
        class="office-preview excel-preview"
      >
        <div
          v-if="officeContent && officeContent.sheets"
          class="excel-sheets"
        >
          <a-tabs v-model:active-key="activeSheet">
            <a-tab-pane
              v-for="(sheet, index) in officeContent.sheets"
              :key="index"
              :tab="sheet.name"
            >
              <div class="excel-table-wrapper">
                <table class="excel-table">
                  <tbody>
                    <tr
                      v-for="(row, rowIndex) in sheet.data"
                      :key="rowIndex"
                    >
                      <td
                        v-for="(cell, colIndex) in row"
                        :key="colIndex"
                      >
                        {{ cell }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </a-tab-pane>
          </a-tabs>
        </div>
      </div>

      <!-- PowerPoint预览 -->
      <div
        v-else-if="fileType === 'powerpoint'"
        class="office-preview ppt-preview"
      >
        <div
          v-if="officeContent && officeContent.slides"
          class="ppt-slides"
        >
          <!-- 幻灯片导航 -->
          <div class="ppt-navigation">
            <a-button
              :disabled="currentSlide === 0"
              @click="previousSlide"
            >
              <LeftOutlined />
              上一页
            </a-button>
            <span class="slide-counter">
              {{ currentSlide + 1 }} / {{ officeContent.slides.length }}
            </span>
            <a-button
              :disabled="currentSlide === officeContent.slides.length - 1"
              @click="nextSlide"
            >
              下一页
              <RightOutlined />
            </a-button>
          </div>

          <!-- 幻灯片内容 -->
          <div class="ppt-slide-container">
            <div
              v-if="officeContent.slides[currentSlide]"
              class="ppt-slide"
            >
              <h2 class="slide-title">
                {{ officeContent.slides[currentSlide].title }}
              </h2>
              <div class="slide-content">
                <p
                  v-for="(line, index) in officeContent.slides[currentSlide].content"
                  :key="index"
                  class="slide-line"
                >
                  {{ line }}
                </p>
              </div>
            </div>
          </div>

          <!-- 幻灯片缩略图列表 -->
          <div class="ppt-thumbnails">
            <div
              v-for="(slide, index) in officeContent.slides"
              :key="index"
              :class="['thumbnail-item', { active: currentSlide === index }]"
              @click="currentSlide = index"
            >
              <div class="thumbnail-number">
                {{ index + 1 }}
              </div>
              <div class="thumbnail-title">
                {{ slide.title || '无标题' }}
              </div>
            </div>
          </div>
        </div>

        <!-- 如果没有幻灯片数据，显示提示 -->
        <div
          v-else
          class="ppt-preview-tip"
        >
          <FilePptOutlined class="ppt-icon" />
          <h3>PowerPoint 演示文稿</h3>
          <p class="file-info">
            {{ file?.file_name }}
          </p>
          <p class="tip-text">
            无法加载幻灯片内容
          </p>
          <a-space
            size="large"
            style="margin-top: 24px"
          >
            <a-button
              type="primary"
              size="large"
              @click="handleOpenExternal"
            >
              <ExportOutlined />
              用PowerPoint打开
            </a-button>
          </a-space>
        </div>
      </div>

      <!-- 压缩包预览 -->
      <ArchivePreview
        v-else-if="fileType === 'archive'"
        :file="file"
        :project-id="projectId"
      />

      <!-- 不支持预览的文件类型 -->
      <div
        v-else
        class="unsupported-preview"
      >
        <FileUnknownOutlined class="unsupported-icon" />
        <h3>无法预览此文件</h3>
        <p>文件类型: {{ file?.file_name?.split('.').pop()?.toUpperCase() || '未知' }}</p>
        <a-space>
          <a-button
            type="primary"
            @click="handleOpenExternal"
          >
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
      <div
        v-if="loading"
        class="loading-overlay"
      >
        <a-spin
          size="large"
          tip="加载中..."
        />
      </div>

      <!-- 错误状态 -->
      <div
        v-if="error"
        class="error-overlay"
      >
        <CloseCircleOutlined class="error-icon" />
        <h3>加载失败</h3>
        <p>{{ error }}</p>
        <a-button
          type="primary"
          @click="handleRetry"
        >
          重试
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  FileOutlined,
  FileUnknownOutlined,
  FilePptOutlined,
  ExportOutlined,
  DownloadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
  CloseCircleOutlined,
  LeftCircleOutlined,
  RightCircleOutlined,
  LeftOutlined,
  RightOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons-vue';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import Papa from 'papaparse';
import VuePdfEmbed from 'vue-pdf-embed';
import ArchivePreview from './ArchivePreview.vue';
import LargeFilePreview from './LargeFilePreview.vue';

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
const isFullscreen = ref(false);
const isLargeFile = ref(false);

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

// Office文件
const officeContent = ref(null);
const officeType = ref('');
const activeSheet = ref(0);
const currentSlide = ref(0); // PPT 当前幻灯片索引

/**
 * 文件类型检测
 */
const fileType = computed(() => {
  if (!props.file?.file_name) {return null;}

  const ext = props.file.file_name.split('.').pop().toLowerCase();

  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const codeExtensions = ['js', 'ts', 'jsx', 'tsx', 'vue', 'html', 'css', 'scss', 'less', 'xml', 'yml', 'yaml', 'txt'];
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
  const officeExtensions = {
    word: ['docx', 'doc'],
    excel: ['xlsx', 'xls'],
    powerpoint: ['pptx', 'ppt']
  };
  const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];

  if (ext === 'md') {return 'markdown';}
  if (ext === 'csv') {return 'csv';}
  if (ext === 'json') {return 'json';}
  if (ext === 'pdf') {return 'pdf';}
  if (imageExtensions.includes(ext)) {return 'image';}
  if (codeExtensions.includes(ext)) {return 'code';}
  if (videoExtensions.includes(ext)) {return 'video';}
  if (audioExtensions.includes(ext)) {return 'audio';}
  if (officeExtensions.word.includes(ext)) {return 'word';}
  if (officeExtensions.excel.includes(ext)) {return 'excel';}
  if (officeExtensions.powerpoint.includes(ext)) {return 'powerpoint';}
  if (archiveExtensions.includes(ext)) {return 'archive';}

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
    word: 'blue',
    excel: 'green',
    powerpoint: 'volcano',
    archive: 'gold',
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
    word: 'Word文档',
    excel: 'Excel表格',
    powerpoint: 'PowerPoint',
    archive: '压缩包',
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
  if (!props.file || !fileType.value) {return;}

  loading.value = true;
  error.value = null;
  isLargeFile.value = false;

  try {
    const filePath = props.file.file_path;

    // 检查是否是大文件（仅对文本类型）
    if (['markdown', 'code', 'csv', 'json'].includes(fileType.value)) {
      try {
        let fullPath = filePath;
        if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
          fullPath = `/data/projects/${props.projectId}/${filePath}`;
        }
        const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
        const sizeResult = await window.electronAPI.file.stat(resolvedPath);

        if (sizeResult.success && sizeResult.stats.size > 10 * 1024 * 1024) {
          // 文件大于10MB，使用大文件预览组件
          isLargeFile.value = true;
          loading.value = false;
          return;
        }
      } catch (err) {
        logger.warn('[PreviewPanel] 检查文件大小失败:', err);
      }
    }

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
      case 'word':
        await loadWord(filePath);
        break;
      case 'excel':
        await loadExcel(filePath);
        break;
      case 'powerpoint':
        await loadPowerPoint(filePath);
        break;
    }
  } catch (err) {
    logger.error('加载文件失败:', err);
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

  // 读取图片为base64
  const base64 = await window.electronAPI.file.readBinary(fullPath);

  // 根据文件扩展名确定 MIME 类型
  const ext = props.file.file_name.split('.').pop().toLowerCase();
  const mimeTypes = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon'
  };
  const mimeType = mimeTypes[ext] || 'image/png';

  // 创建 data URL
  imageUrl.value = `data:${mimeType};base64,${base64}`;
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
  // 检查内容是否为空（如果为空，可能是还在加载中，不抛出错误）
  if (!content || content.trim().length === 0) {
    // 清空数据，等待内容加载
    csvData.value = [];
    csvColumns.value = [];
    return;
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
    logger.warn('CSV 解析警告:', result.errors);
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
 * 加载Word文档
 */
const loadWord = async (filePath) => {
  // 构建完整路径
  let fullPath = filePath;
  if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
    fullPath = `/data/projects/${props.projectId}/${filePath}`;
  }

  logger.info('[PreviewPanel] 加载Word文档:', {
    原始路径: filePath,
    构建路径: fullPath,
    projectId: props.projectId,
    file对象: props.file
  });

  try {
    // 首先尝试解析路径
    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
    logger.info('[PreviewPanel] Word文档解析后路径:', resolvedPath);

    // 🔥 修复：从resolvedPath对象中提取path字符串
    const actualPath = resolvedPath?.path || resolvedPath;
    const result = await window.electronAPI.file.previewOffice(actualPath, 'word');
    logger.info('[PreviewPanel] Word预览结果:', result);

    if (result.success) {
      if (!result.data || !result.data.html) {
        logger.warn('[PreviewPanel] Word预览返回空内容:', result.data);
        throw new Error('Word文档内容为空');
      }
      officeContent.value = result.data.html;
      officeType.value = 'word';
      logger.info('[PreviewPanel] Word内容已设置，长度:', result.data.html.length);
    } else {
      throw new Error(result.error || 'Word文档预览失败');
    }
  } catch (err) {
    logger.error('[PreviewPanel] Word加载失败:', err);
    throw err;
  }
};

/**
 * 加载Excel表格
 */
const loadExcel = async (filePath) => {
  // 构建完整路径
  let fullPath = filePath;
  if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
    fullPath = `/data/projects/${props.projectId}/${filePath}`;
  }

  logger.info('[PreviewPanel] 加载Excel表格:', {
    原始路径: filePath,
    构建路径: fullPath,
    projectId: props.projectId
  });

  try {
    // 首先尝试解析路径
    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
    logger.info('[PreviewPanel] Excel解析后路径:', resolvedPath);

    // 🔥 修复：从resolvedPath对象中提取path字符串
    const actualPath = resolvedPath?.path || resolvedPath;
    const result = await window.electronAPI.file.previewOffice(actualPath, 'excel');
    logger.info('[PreviewPanel] Excel预览结果:', result);

    if (result.success) {
      if (!result.data || !result.data.sheets) {
        logger.warn('[PreviewPanel] Excel预览返回空内容:', result.data);
        throw new Error('Excel文档内容为空');
      }
      officeContent.value = result.data;
      officeType.value = 'excel';
      logger.info('[PreviewPanel] Excel内容已设置，工作表数量:', result.data.sheets.length);
    } else {
      throw new Error(result.error || 'Excel表格预览失败');
    }
  } catch (err) {
    logger.error('[PreviewPanel] Excel加载失败:', err);
    throw err;
  }
};

/**
 * 加载PowerPoint
 */
const loadPowerPoint = async (filePath) => {
  // 构建完整路径
  let fullPath = filePath;
  if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
    fullPath = `/data/projects/${props.projectId}/${filePath}`;
  }

  logger.info('[PreviewPanel] 加载PowerPoint:', {
    原始路径: filePath,
    构建路径: fullPath,
    projectId: props.projectId
  });

  try {
    // 首先尝试解析路径
    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
    logger.info('[PreviewPanel] PowerPoint解析后路径:', resolvedPath);

    // 🔥 修复：从resolvedPath对象中提取path字符串
    const actualPath = resolvedPath?.path || resolvedPath;
    const result = await window.electronAPI.file.previewOffice(actualPath, 'powerpoint');
    logger.info('[PreviewPanel] PowerPoint预览结果:', result);

    if (result.success) {
      if (!result.data || !result.data.slides) {
        logger.warn('[PreviewPanel] PowerPoint预览返回空内容:', result.data);
        throw new Error('PowerPoint文档内容为空');
      }
      officeContent.value = result.data;
      officeType.value = 'powerpoint';
      currentSlide.value = 0; // 重置到第一张幻灯片
      logger.info('[PreviewPanel] PowerPoint内容已设置，幻灯片数量:', result.data.slides.length);
    } else {
      throw new Error(result.error || 'PowerPoint预览失败');
    }
  } catch (err) {
    logger.error('[PreviewPanel] PowerPoint加载失败:', err);
    throw err;
  }
};

/**
 * PDF 加载完成
 */
const handlePdfLoaded = () => {
  logger.info('[PreviewPanel] PDF 加载完成');
};

/**
 * PDF 加载失败
 */
const handlePdfError = (err) => {
  error.value = 'PDF 加载失败';
  logger.error('[PreviewPanel] PDF 加载失败:', err);
};

/**
 * 在系统中打开文件
 */
const handleOpenExternal = async () => {
  if (!props.file?.file_path) {return;}

  try {
    const resolvedPath = await window.electronAPI.project.resolvePath(props.file.file_path);
    await window.electronAPI.shell.openPath(resolvedPath);
    message.success('已在系统中打开');
  } catch (err) {
    logger.error('打开文件失败:', err);
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

/**
 * PPT 导航 - 上一张幻灯片
 */
const previousSlide = () => {
  if (currentSlide.value > 0) {
    currentSlide.value--;
  }
};

/**
 * PPT 导航 - 下一张幻灯片
 */
const nextSlide = () => {
  if (officeContent.value?.slides && currentSlide.value < officeContent.value.slides.length - 1) {
    currentSlide.value++;
  }
};

/**
 * 切换全屏模式
 */
const toggleFullscreen = () => {
  const panel = document.querySelector('.preview-panel');

  if (!isFullscreen.value) {
    // 进入全屏
    if (panel.requestFullscreen) {
      panel.requestFullscreen();
    } else if (panel.webkitRequestFullscreen) {
      panel.webkitRequestFullscreen();
    } else if (panel.mozRequestFullScreen) {
      panel.mozRequestFullScreen();
    } else if (panel.msRequestFullscreen) {
      panel.msRequestFullscreen();
    }
    isFullscreen.value = true;
  } else {
    // 退出全屏
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
    isFullscreen.value = false;
  }
};

/**
 * 处理键盘快捷键
 */
const handleKeyDown = (event) => {
  // F11 全屏切换
  if (event.key === 'F11') {
    event.preventDefault();
    toggleFullscreen();
  }
  // ESC 退出全屏
  if (event.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false;
  }
};

/**
 * 监听全屏状态变化
 */
const handleFullscreenChange = () => {
  const isCurrentlyFullscreen = !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
  isFullscreen.value = isCurrentlyFullscreen;
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
  // 🔥 修复：不要在这里调用 loadFileContent()，因为 watch 的 immediate: true 已经会调用
  // loadFileContent(); // ← 移除这行，避免重复调用

  // 添加键盘事件监听
  window.addEventListener('keydown', handleKeyDown);

  // 添加全屏状态变化监听
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange', handleFullscreenChange);
  document.addEventListener('MSFullscreenChange', handleFullscreenChange);
});

onUnmounted(() => {
  // 移除键盘事件监听
  window.removeEventListener('keydown', handleKeyDown);

  // 移除全屏状态变化监听
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
  document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
});
</script>

<style scoped>
.preview-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  position: relative;
}

/* 全屏模式 */
.preview-panel:fullscreen {
  width: 100vw;
  height: 100vh;
}

.preview-panel:-webkit-full-screen {
  width: 100vw;
  height: 100vh;
}

.preview-panel:-moz-full-screen {
  width: 100vw;
  height: 100vh;
}

.preview-panel:-ms-fullscreen {
  width: 100vw;
  height: 100vh;
}

/* 全屏时工具栏默认隐藏 */
.preview-panel:fullscreen .preview-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.preview-panel:-webkit-full-screen .preview-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.preview-panel:-moz-full-screen .preview-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.preview-panel:-ms-fullscreen .preview-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  opacity: 0;
  transition: opacity 0.3s ease;
}

/* 全屏时悬停显示工具栏 */
.preview-panel:fullscreen:hover .preview-header,
.preview-panel:-webkit-full-screen:hover .preview-header,
.preview-panel:-moz-full-screen:hover .preview-header,
.preview-panel:-ms-fullscreen:hover .preview-header {
  opacity: 1;
}

/* 全屏时内容区占满 */
.preview-panel:fullscreen .preview-content,
.preview-panel:-webkit-full-screen .preview-content,
.preview-panel:-moz-full-screen .preview-content,
.preview-panel:-ms-fullscreen .preview-content {
  height: 100vh;
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

/* Office文件预览 */
.office-preview {
  height: 100%;
  overflow: auto;
  background: #fff;
  padding: 20px;
}

/* Word文档预览 */
.word-preview .office-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 40px;
  background: #fff;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  min-height: 100%;
}

.word-preview .office-content :deep(p) {
  margin-bottom: 1em;
  line-height: 1.6;
}

.word-preview .office-content :deep(table) {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}

.word-preview .office-content :deep(td),
.word-preview .office-content :deep(th) {
  border: 1px solid #ddd;
  padding: 8px;
}

/* Excel表格预览 */
.excel-preview {
  height: 100%;
  padding: 0;
}

.excel-table-wrapper {
  overflow: auto;
  max-height: calc(100vh - 200px);
}

.excel-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}

.excel-table td {
  border: 1px solid #d9d9d9;
  padding: 8px 12px;
  min-width: 100px;
  white-space: nowrap;
}

.excel-table tr:nth-child(even) {
  background: #fafafa;
}

/* PowerPoint预览 */
.ppt-preview {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f0f0;
}

/* 🔥 新增：PPT预览提示样式 */
.ppt-preview-tip {
  text-align: center;
  padding: 60px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  max-width: 500px;
}

.ppt-preview-tip .ppt-icon {
  font-size: 80px;
  color: #d35400;
  margin-bottom: 24px;
}

.ppt-preview-tip h3 {
  font-size: 24px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 8px;
}

.ppt-preview-tip .file-info {
  font-size: 14px;
  color: #8c8c8c;
  margin-bottom: 24px;
  word-break: break-all;
}

.ppt-preview-tip .tip-text {
  font-size: 14px;
  color: #595959;
  margin: 8px 0;
  line-height: 1.6;
}

.ppt-slide {
  background: #fff;
  padding: 60px;
  min-height: 500px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.ppt-slide h3 {
  font-size: 32px;
  margin-bottom: 30px;
  color: #262626;
}

.slide-content {
  width: 100%;
}

.slide-item {
  margin: 15px 0;
  font-size: 18px;
  color: #595959;
  text-align: left;
}

.custom-slick-arrow {
  font-size: 32px;
  color: #1890ff;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  z-index: 2;
}

.custom-slick-arrow:hover {
  color: #40a9ff;
}

/* PPT 幻灯片显示 */
.ppt-slides {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.ppt-navigation {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 16px;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
}

.slide-counter {
  font-size: 14px;
  color: #595959;
  font-weight: 500;
  min-width: 80px;
  text-align: center;
}

.ppt-slide-container {
  flex: 1;
  overflow-y: auto;
  padding: 40px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.ppt-slide {
  background: #fff;
  padding: 60px;
  min-height: 500px;
  width: 100%;
  max-width: 900px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.slide-title {
  font-size: 32px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 40px;
  text-align: center;
  padding-bottom: 20px;
  border-bottom: 2px solid #e8e8e8;
}

.slide-content {
  font-size: 16px;
  line-height: 1.8;
  color: #595959;
}

.slide-line {
  margin: 12px 0;
  padding-left: 20px;
}

.slide-line:before {
  content: '•';
  margin-right: 12px;
  color: #1890ff;
  font-weight: bold;
}

.ppt-thumbnails {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border-top: 1px solid #e8e8e8;
  overflow-x: auto;
  overflow-y: hidden;
}

.thumbnail-item {
  flex-shrink: 0;
  width: 120px;
  padding: 12px;
  background: #fafafa;
  border: 2px solid #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s;
}

.thumbnail-item:hover {
  border-color: #1890ff;
  background: #e6f7ff;
}

.thumbnail-item.active {
  border-color: #1890ff;
  background: #e6f7ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.2);
}

.thumbnail-number {
  font-size: 12px;
  font-weight: 600;
  color: #1890ff;
  margin-bottom: 6px;
}

.thumbnail-title {
  font-size: 12px;
  color: #595959;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
