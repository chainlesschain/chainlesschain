<template>
  <div class="preview-panel">
    <!-- 头部：预览模式和操作 -->
    <div class="preview-header">
      <div class="header-left">
        <h3 class="preview-title">
          <EyeOutlined />
          预览
        </h3>

        <a-radio-group v-model:value="previewMode" size="small" button-style="solid">
          <a-radio-button value="static">
            <GlobalOutlined />
            静态
          </a-radio-button>
          <a-radio-button value="dev">
            <ThunderboltOutlined />
            开发
          </a-radio-button>
          <a-radio-button value="explorer">
            <FolderOpenOutlined />
            文件夹
          </a-radio-button>
        </a-radio-group>
      </div>

      <div class="header-right">
        <a-tooltip v-if="serverUrl" title="在浏览器中打开">
          <a-button type="text" size="small" @click="handleOpenInBrowser">
            <ExportOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip v-if="serverUrl" title="刷新预览">
          <a-button type="text" size="small" @click="handleRefresh">
            <ReloadOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip v-if="isServerRunning" title="停止服务器">
          <a-button type="text" size="small" danger @click="handleStopServer">
            <StopOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip v-else title="启动预览">
          <a-button type="primary" size="small" @click="handleStartServer">
            <PlayCircleOutlined />
            启动
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- 预览内容区 -->
    <div class="preview-content">
      <!-- 文件管理器模式 -->
      <div v-if="previewMode === 'explorer'" class="explorer-mode">
        <div class="mode-icon">
          <FolderOpenOutlined />
        </div>
        <h3>在文件管理器中查看</h3>
        <p>点击下方按钮在系统文件管理器中打开项目文件夹</p>
        <a-button type="primary" size="large" @click="handleOpenExplorer">
          <FolderOpenOutlined />
          打开文件夹
        </a-button>
      </div>

      <!-- 服务器未启动状态 -->
      <div v-else-if="!isServerRunning" class="empty-state">
        <div class="empty-icon">
          <component :is="previewMode === 'static' ? GlobalOutlined : ThunderboltOutlined" />
        </div>
        <h3>{{ previewMode === 'static' ? '静态文件服务器' : '开发服务器' }}</h3>
        <p>{{ getModeDescription() }}</p>
        <a-button type="primary" size="large" :loading="starting" @click="handleStartServer">
          <PlayCircleOutlined v-if="!starting" />
          {{ starting ? '启动中...' : '启动预览' }}
        </a-button>
      </div>

      <!-- 启动中状态 -->
      <div v-else-if="starting" class="loading-state">
        <a-spin size="large" />
        <p>正在启动{{ previewMode === 'static' ? '静态' : '开发' }}服务器...</p>
      </div>

      <!-- 服务器运行中 - iframe 预览 -->
      <div v-else class="preview-iframe-container">
        <!-- 服务器信息栏 -->
        <div class="server-info-bar">
          <div class="server-info">
            <a-tag color="green">
              <CheckCircleOutlined />
              运行中
            </a-tag>
            <span class="server-url">{{ serverUrl }}</span>
            <a-tag>端口: {{ serverPort }}</a-tag>
          </div>
        </div>

        <!-- iframe 预览 -->
        <iframe
          ref="previewIframe"
          :key="iframeKey"
          :src="serverUrl"
          class="preview-iframe"
          frameborder="0"
          @load="handleIframeLoad"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  EyeOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  ExportOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
  projectPath: {
    type: String,
    default: null,
  },
});

// 响应式状态
const previewMode = ref('static'); // 'static' | 'dev' | 'explorer'
const isServerRunning = ref(false);
const serverUrl = ref('');
const serverPort = ref(null);
const starting = ref(false);
const iframeKey = ref(0);
const previewIframe = ref(null);

// 检查项目是否有本地路径
const hasValidPath = computed(() => {
  if (!props.projectPath) return false;
  // 检查是否是本地路径
  return (
    /^[a-zA-Z]:[/\\]/.test(props.projectPath) || // Windows路径
    (props.projectPath.startsWith('/') && !props.projectPath.startsWith('/data/projects/')) // Unix路径
  );
});

/**
 * 获取模式描述
 */
const getModeDescription = () => {
  if (previewMode.value === 'static') {
    return '快速预览 HTML、CSS、JS 静态文件';
  } else if (previewMode.value === 'dev') {
    return '启动开发服务器（npm run dev），支持热重载';
  }
  return '';
};

/**
 * 启动服务器
 */
const handleStartServer = async () => {
  if (!hasValidPath.value) {
    message.error('项目没有本地路径，无法启动预览');
    return;
  }

  starting.value = true;

  try {
    if (previewMode.value === 'static') {
      // 启动静态服务器
      const result = await window.electron.invoke('preview:start-static',
        props.projectId,
        props.projectPath,
        { spa: false }
      );

      serverUrl.value = result.url;
      serverPort.value = result.port;
      isServerRunning.value = true;

      message.success(`静态服务器已启动: ${result.url}`);
    } else if (previewMode.value === 'dev') {
      // 启动开发服务器
      const result = await window.electron.invoke('preview:start-dev',
        props.projectId,
        props.projectPath,
        'npm run dev'
      );

      serverUrl.value = result.url;
      serverPort.value = result.port;
      isServerRunning.value = true;

      message.success(`开发服务器已启动: ${result.url}`);
    }

    // 刷新 iframe
    iframeKey.value++;
  } catch (error) {
    console.error('启动服务器失败:', error);
    message.error('启动服务器失败: ' + error.message);
  } finally {
    starting.value = false;
  }
};

/**
 * 停止服务器
 */
const handleStopServer = async () => {
  try {
    if (previewMode.value === 'static') {
      await window.electron.invoke('preview:stop-static', props.projectId);
      message.success('静态服务器已停止');
    } else if (previewMode.value === 'dev') {
      await window.electron.invoke('preview:stop-dev', props.projectId);
      message.success('开发服务器已停止');
    }

    isServerRunning.value = false;
    serverUrl.value = '';
    serverPort.value = null;
  } catch (error) {
    console.error('停止服务器失败:', error);
    message.error('停止服务器失败: ' + error.message);
  }
};

/**
 * 打开文件管理器
 */
const handleOpenExplorer = async () => {
  if (!hasValidPath.value) {
    message.error('项目没有本地路径');
    return;
  }

  try {
    await window.electron.invoke('preview:open-explorer', props.projectPath);
    message.success('已在文件管理器中打开');
  } catch (error) {
    console.error('打开文件管理器失败:', error);
    message.error('打开文件管理器失败');
  }
};

/**
 * 在外部浏览器中打开
 */
const handleOpenInBrowser = async () => {
  if (!serverUrl.value) return;

  try {
    await window.electron.invoke('preview:open-browser', serverUrl.value);
    message.success('已在浏览器中打开');
  } catch (error) {
    console.error('打开浏览器失败:', error);
    message.error('打开浏览器失败');
  }
};

/**
 * 刷新预览
 */
const handleRefresh = () => {
  if (previewIframe.value) {
    previewIframe.value.src = previewIframe.value.src;
    message.info('预览已刷新');
  }
};

/**
 * iframe 加载完成
 */
const handleIframeLoad = () => {
  console.log('[PreviewPanel] iframe 加载完成');
};

// 监听预览模式变化
watch(previewMode, (newMode, oldMode) => {
  // 切换模式时停止旧服务器
  if (isServerRunning.value && oldMode !== 'explorer' && newMode !== 'explorer') {
    handleStopServer();
  }
});

// 监听来自主进程的开发服务器就绪事件
if (window.electron?.on) {
  window.electron.on('preview:dev-server-ready', (data) => {
    if (data.projectId === props.projectId) {
      serverUrl.value = data.url;
      serverPort.value = data.port;
      isServerRunning.value = true;
      starting.value = false;
      iframeKey.value++;
    }
  });
}

// 组件卸载时停止服务器
onUnmounted(() => {
  if (isServerRunning.value) {
    handleStopServer();
  }
});
</script>

<style scoped>
.preview-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f9fafb;
}

/* 头部 */
.preview-header {
  padding: 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.preview-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 预览内容区 */
.preview-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 文件管理器模式 */
.explorer-mode {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 40px;
  background: white;
}

.mode-icon {
  font-size: 64px;
  color: #667eea;
  margin-bottom: 24px;
}

.explorer-mode h3 {
  margin: 0 0 12px 0;
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
}

.explorer-mode p {
  margin: 0 0 24px 0;
  color: #6b7280;
  text-align: center;
}

/* 空状态 */
.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 40px;
  background: white;
}

.empty-icon {
  font-size: 64px;
  color: #9ca3af;
  margin-bottom: 24px;
  opacity: 0.5;
}

.empty-state h3 {
  margin: 0 0 12px 0;
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
}

.empty-state p {
  margin: 0 0 24px 0;
  color: #6b7280;
  text-align: center;
  max-width: 400px;
}

/* 加载状态 */
.loading-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 40px;
  background: white;
}

.loading-state p {
  margin-top: 16px;
  color: #6b7280;
  font-size: 14px;
}

/* iframe 容器 */
.preview-iframe-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: white;
}

.server-info-bar {
  padding: 12px 16px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.server-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.server-url {
  color: #667eea;
  font-family: 'Consolas', 'Monaco', monospace;
  font-weight: 500;
}

/* iframe 预览 */
.preview-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}
</style>
