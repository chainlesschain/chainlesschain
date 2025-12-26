<template>
  <div class="large-file-preview">
    <!-- 文件信息栏 -->
    <div class="file-info-bar">
      <div class="info-left">
        <FileTextOutlined class="file-icon" />
        <span class="file-size">{{ formatSize(fileInfo.size) }}</span>
        <a-tag color="orange">大文件</a-tag>
        <span v-if="fileInfo.estimatedLines" class="line-count">
          约 {{ fileInfo.estimatedLines.toLocaleString() }} 行
        </span>
      </div>
      <div class="info-right">
        <a-input-search
          v-model:value="searchQuery"
          placeholder="搜索内容..."
          style="width: 300px"
          @search="handleSearch"
          :loading="searching"
        >
          <template #enterButton>
            <SearchOutlined />
          </template>
        </a-input-search>
      </div>
    </div>

    <!-- 搜索结果 -->
    <div v-if="searchResults.length > 0" class="search-results">
      <div class="results-header">
        <span>找到 {{ searchResults.length }} 个匹配项</span>
        <a-button size="small" @click="clearSearch">清除</a-button>
      </div>
      <div class="results-list">
        <div
          v-for="(result, index) in searchResults"
          :key="index"
          class="result-item"
          @click="jumpToLine(result.lineNumber)"
        >
          <span class="result-line-number">行 {{ result.lineNumber }}</span>
          <span class="result-content">{{ truncate(result.line, 80) }}</span>
        </div>
      </div>
    </div>

    <!-- 虚拟滚动容器 -->
    <div ref="scrollContainer" class="scroll-container" @scroll="handleScroll">
      <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.index"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRow.start}px)`,
          }"
          class="line-row"
        >
          <span class="line-number">{{ virtualRow.index + 1 }}</span>
          <span class="line-content">{{ virtualRow.content }}</span>
        </div>
      </div>

      <!-- 加载指示器 -->
      <div v-if="loading" class="loading-indicator">
        <a-spin size="small" />
        <span>加载中...</span>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="status-bar">
      <span>当前显示: {{ loadedLines.length }} 行</span>
      <span>滚动位置: 第 {{ currentTopLine }} 行</span>
      <a-button size="small" @click="jumpToTop">
        <VerticalAlignTopOutlined />
        顶部
      </a-button>
      <a-button size="small" @click="jumpToBottom">
        <VerticalAlignBottomOutlined />
        底部
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  FileTextOutlined,
  SearchOutlined,
  VerticalAlignTopOutlined,
  VerticalAlignBottomOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  projectId: {
    type: String,
    default: '',
  },
});

// 状态
const loading = ref(false);
const searching = ref(false);
const fileInfo = ref({
  size: 0,
  estimatedLines: 0,
});
const loadedLines = ref([]);
const scrollContainer = ref(null);
const searchQuery = ref('');
const searchResults = ref([]);

// 虚拟滚动配置
const LINE_HEIGHT = 24; // 每行高度（像素）
const BUFFER_SIZE = 10; // 缓冲区行数
const LOAD_CHUNK_SIZE = 100; // 每次加载行数

// 滚动状态
const scrollTop = ref(0);
const containerHeight = ref(600);

/**
 * 计算虚拟滚动的可见行
 */
const virtualRows = computed(() => {
  if (loadedLines.value.length === 0) return [];

  const startIndex = Math.floor(scrollTop.value / LINE_HEIGHT);
  const endIndex = Math.min(
    loadedLines.value.length - 1,
    Math.ceil((scrollTop.value + containerHeight.value) / LINE_HEIGHT)
  );

  const visibleRows = [];
  for (let i = Math.max(0, startIndex - BUFFER_SIZE); i <= endIndex + BUFFER_SIZE; i++) {
    if (i < loadedLines.value.length) {
      visibleRows.push({
        index: i,
        content: loadedLines.value[i].content,
        start: i * LINE_HEIGHT,
      });
    }
  }

  return visibleRows;
});

/**
 * 计算总高度（用于滚动条）
 */
const totalHeight = computed(() => {
  return loadedLines.value.length * LINE_HEIGHT;
});

/**
 * 当前顶部行号
 */
const currentTopLine = computed(() => {
  return Math.floor(scrollTop.value / LINE_HEIGHT) + 1;
});

/**
 * 加载文件信息
 */
const loadFileInfo = async () => {
  try {
    let fullPath = props.file.file_path;
    if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
      fullPath = `/data/projects/${props.projectId}/${fullPath}`;
    }

    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
    const result = await window.electronAPI.largeFile.getInfo(resolvedPath);

    if (result.success) {
      fileInfo.value = result.data;
    }
  } catch (err) {
    console.error('[Large File Preview] 加载文件信息失败:', err);
    message.error('加载文件信息失败');
  }
};

/**
 * 加载初始内容
 */
const loadInitialContent = async () => {
  loading.value = true;

  try {
    let fullPath = props.file.file_path;
    if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
      fullPath = `/data/projects/${props.projectId}/${fullPath}`;
    }

    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
    const result = await window.electronAPI.largeFile.readLines(resolvedPath, 0, LOAD_CHUNK_SIZE);

    if (result.success) {
      loadedLines.value = result.data.lines;
    } else {
      throw new Error(result.error || '加载文件内容失败');
    }
  } catch (err) {
    console.error('[Large File Preview] 加载内容失败:', err);
    message.error(err.message || '加载文件内容失败');
  } finally {
    loading.value = false;
  }
};

/**
 * 加载更多内容（向下滚动）
 */
const loadMoreContent = async () => {
  if (loading.value) return;

  loading.value = true;

  try {
    let fullPath = props.file.file_path;
    if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
      fullPath = `/data/projects/${props.projectId}/${fullPath}`;
    }

    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
    const startLine = loadedLines.value.length;
    const result = await window.electronAPI.largeFile.readLines(resolvedPath, startLine, LOAD_CHUNK_SIZE);

    if (result.success && result.data.lines.length > 0) {
      loadedLines.value = [...loadedLines.value, ...result.data.lines];
    }
  } catch (err) {
    console.error('[Large File Preview] 加载更多内容失败:', err);
  } finally {
    loading.value = false;
  }
};

/**
 * 处理滚动事件
 */
const handleScroll = (event) => {
  scrollTop.value = event.target.scrollTop;

  // 接近底部时加载更多
  const scrollHeight = event.target.scrollHeight;
  const clientHeight = event.target.clientHeight;
  const scrollPosition = scrollTop.value + clientHeight;

  if (scrollHeight - scrollPosition < 1000) {
    // 距离底部1000px时加载更多
    loadMoreContent();
  }
};

/**
 * 搜索功能
 */
const handleSearch = async () => {
  if (!searchQuery.value.trim()) {
    message.warning('请输入搜索关键词');
    return;
  }

  searching.value = true;
  searchResults.value = [];

  try {
    let fullPath = props.file.file_path;
    if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
      fullPath = `/data/projects/${props.projectId}/${fullPath}`;
    }

    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
    const result = await window.electronAPI.largeFile.search(resolvedPath, searchQuery.value, {
      maxResults: 100,
      caseSensitive: false,
    });

    if (result.success) {
      searchResults.value = result.data.results;
      if (searchResults.value.length === 0) {
        message.info('未找到匹配项');
      } else {
        message.success(`找到 ${searchResults.value.length} 个匹配项`);
      }
    }
  } catch (err) {
    console.error('[Large File Preview] 搜索失败:', err);
    message.error('搜索失败');
  } finally {
    searching.value = false;
  }
};

/**
 * 清除搜索
 */
const clearSearch = () => {
  searchQuery.value = '';
  searchResults.value = [];
};

/**
 * 跳转到指定行
 */
const jumpToLine = async (lineNumber) => {
  // 确保该行已加载
  if (lineNumber > loadedLines.value.length) {
    loading.value = true;
    try {
      let fullPath = props.file.file_path;
      if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
        fullPath = `/data/projects/${props.projectId}/${fullPath}`;
      }

      const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
      const result = await window.electronAPI.largeFile.readLines(
        resolvedPath,
        0,
        lineNumber + BUFFER_SIZE
      );

      if (result.success) {
        loadedLines.value = result.data.lines;
      }
    } catch (err) {
      console.error('[Large File Preview] 跳转失败:', err);
    } finally {
      loading.value = false;
    }
  }

  // 滚动到目标行
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = (lineNumber - 1) * LINE_HEIGHT;
  }
};

/**
 * 跳转到顶部
 */
const jumpToTop = () => {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = 0;
  }
};

/**
 * 跳转到底部
 */
const jumpToBottom = async () => {
  // 加载到文件末尾
  loading.value = true;
  try {
    let fullPath = props.file.file_path;
    if (!fullPath.startsWith('/data/projects/') && props.projectId && !fullPath.includes(props.projectId)) {
      fullPath = `/data/projects/${props.projectId}/${fullPath}`;
    }

    const resolvedPath = await window.electronAPI.project.resolvePath(fullPath);
    const result = await window.electronAPI.largeFile.getTail(resolvedPath, LOAD_CHUNK_SIZE * 2);

    if (result.success) {
      loadedLines.value = result.data;
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
      }
    }
  } catch (err) {
    console.error('[Large File Preview] 跳转到底部失败:', err);
  } finally {
    loading.value = false;
  }
};

/**
 * 格式化文件大小
 */
const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

/**
 * 截断文本
 */
const truncate = (text, maxLength) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

/**
 * 更新容器高度
 */
const updateContainerHeight = () => {
  if (scrollContainer.value) {
    containerHeight.value = scrollContainer.value.clientHeight;
  }
};

onMounted(async () => {
  await loadFileInfo();
  await loadInitialContent();
  updateContainerHeight();

  window.addEventListener('resize', updateContainerHeight);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateContainerHeight);
});
</script>

<style scoped>
.large-file-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

/* 文件信息栏 */
.file-info-bar {
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fafafa;
}

.info-left {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #595959;
}

.file-icon {
  font-size: 20px;
  color: #1890ff;
}

.file-size,
.line-count {
  font-weight: 500;
}

/* 搜索结果 */
.search-results {
  max-height: 200px;
  overflow-y: auto;
  border-bottom: 1px solid #e8e8e8;
  background: #fff8e6;
}

.results-header {
  padding: 8px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  background: #fffbe6;
  border-bottom: 1px solid #ffe58f;
}

.results-list {
  max-height: 160px;
  overflow-y: auto;
}

.result-item {
  padding: 6px 16px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  font-size: 13px;
  border-bottom: 1px solid #f0f0f0;
}

.result-item:hover {
  background: #fafafa;
}

.result-line-number {
  color: #8c8c8c;
  font-weight: 500;
  min-width: 60px;
}

.result-content {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 虚拟滚动容器 */
.scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
  background: #fafafa;
}

.line-row {
  display: flex;
  height: 24px;
  line-height: 24px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  border-bottom: 1px solid #f0f0f0;
  background: #fff;
}

.line-row:hover {
  background: #f5f5f5;
}

.line-number {
  min-width: 60px;
  padding: 0 12px;
  text-align: right;
  color: #8c8c8c;
  background: #fafafa;
  border-right: 1px solid #e8e8e8;
  user-select: none;
}

.line-content {
  padding: 0 12px;
  white-space: pre;
  flex: 1;
}

/* 加载指示器 */
.loading-indicator {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  z-index: 10;
}

/* 底部状态栏 */
.status-bar {
  padding: 8px 16px;
  border-top: 1px solid #e8e8e8;
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: #595959;
  background: #fafafa;
}

.status-bar span {
  margin-right: auto;
}
</style>
