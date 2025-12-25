<template>
  <div class="webide-page">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <a-space>
        <a-button type="primary" @click="handleSave">
          <SaveOutlined />
          保存
        </a-button>
        <a-button @click="handleExport">
          <ExportOutlined />
          导出
        </a-button>
        <a-divider type="vertical" />
        <a-select v-model:value="previewMode" style="width: 140px" @change="handlePreviewModeChange">
          <a-select-option value="srcdoc">
            <ThunderboltOutlined />
            实时预览
          </a-select-option>
          <a-select-option value="server">
            <GlobalOutlined />
            服务器模式
          </a-select-option>
        </a-select>
        <a-select v-model:value="currentDevice" style="width: 120px">
          <a-select-option value="desktop">
            <DesktopOutlined />
            桌面
          </a-select-option>
          <a-select-option value="tablet">
            <TabletOutlined />
            平板
          </a-select-option>
          <a-select-option value="mobile">
            <MobileOutlined />
            手机
          </a-select-option>
        </a-select>
        <a-tooltip title="刷新预览">
          <a-button @click="handleRefreshPreview">
            <ReloadOutlined />
          </a-button>
        </a-tooltip>
        <a-tooltip title="清空控制台">
          <a-button @click="handleClearConsole">
            <ClearOutlined />
          </a-button>
        </a-tooltip>
      </a-space>

      <a-space style="margin-left: auto">
        <a-tag v-if="serverRunning" color="success">
          <PlayCircleOutlined />
          服务器运行中: {{ serverUrl }}
        </a-tag>
        <a-tag v-else-if="previewMode === 'server'" color="warning">
          <PauseCircleOutlined />
          服务器未启动
        </a-tag>
        <a-button
          v-if="showDevTools"
          type="text"
          @click="toggleDevTools"
        >
          <CloseOutlined />
          隐藏开发工具
        </a-button>
        <a-button
          v-else
          type="text"
          @click="toggleDevTools"
        >
          <CodeOutlined />
          显示开发工具
        </a-button>
      </a-space>
    </div>

    <!-- 主体区域 -->
    <div class="content-area">
      <a-row :gutter="0" style="height: 100%">
        <!-- 编辑器区域 35% -->
        <a-col :span="8" class="editor-column">
          <EditorPanel
            v-model:htmlCode="htmlCode"
            v-model:cssCode="cssCode"
            v-model:jsCode="jsCode"
            @change="handleCodeChange"
          />
        </a-col>

        <!-- 预览区域 -->
        <a-col :span="showDevTools ? 12 : 16" class="preview-column">
          <PreviewFrame
            ref="previewFrameRef"
            :html="htmlCode"
            :css="cssCode"
            :js="jsCode"
            :mode="previewMode"
            :device="currentDevice"
            :server-url="serverUrl"
            @console-log="handleConsoleLog"
            @error="handlePreviewError"
          />
        </a-col>

        <!-- 开发工具区域 20% (可折叠) -->
        <a-col v-if="showDevTools" :span="4" class="devtools-column">
          <ConsolePanel
            ref="consolePanelRef"
            :logs="consoleLogs"
          />
        </a-col>
      </a-row>
    </div>

    <!-- 底部状态栏 -->
    <div class="statusbar">
      <a-space>
        <span class="status-item">
          <FileTextOutlined />
          {{ currentLanguage }}
        </span>
        <a-divider type="vertical" />
        <span class="status-item">
          <EyeOutlined />
          预览模式: {{ previewMode === 'srcdoc' ? '实时' : '服务器' }}
        </span>
        <a-divider type="vertical" />
        <span v-if="serverRunning" class="status-item">
          <LinkOutlined />
          {{ serverUrl }}
        </span>
        <a-divider type="vertical" />
        <span class="status-item">
          <ClockCircleOutlined />
          最后更新: {{ lastUpdateTime }}
        </span>
      </a-space>

      <a-space style="margin-left: auto">
        <span class="status-item">控制台日志: {{ consoleLogs.length }}</span>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  SaveOutlined,
  ExportOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  DesktopOutlined,
  TabletOutlined,
  MobileOutlined,
  ReloadOutlined,
  ClearOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CloseOutlined,
  CodeOutlined,
  FileTextOutlined,
  EyeOutlined,
  LinkOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';
import { debounce } from 'lodash-es';
import EditorPanel from '../../components/webide/EditorPanel.vue';
import PreviewFrame from '../../components/webide/PreviewFrame.vue';
import ConsolePanel from '../../components/webide/ConsolePanel.vue';

// 状态
const htmlCode = ref(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hello Web IDE</title>
</head>
<body>
  <div class="container">
    <h1>欢迎使用 Web IDE</h1>
    <p>开始编写你的 HTML、CSS 和 JavaScript 代码吧！</p>
    <button id="testBtn">点击我</button>
  </div>
</body>
</html>`);

const cssCode = ref(`body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 0;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.container {
  background: white;
  padding: 40px;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
  text-align: center;
  max-width: 600px;
}

h1 {
  color: #333;
  margin-bottom: 16px;
}

p {
  color: #666;
  margin-bottom: 24px;
  line-height: 1.6;
}

button {
  background: #667eea;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.3s;
}

button:hover {
  background: #5568d3;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}`);

const jsCode = ref(`// 欢迎使用 Web IDE
console.log('Web IDE Ready!');

const btn = document.getElementById('testBtn');
if (btn) {
  btn.addEventListener('click', () => {
    console.log('按钮被点击了！');
    alert('Hello from Web IDE!');
  });
}`);

const previewMode = ref('srcdoc');
const currentDevice = ref('desktop');
const currentLanguage = ref('HTML');
const showDevTools = ref(true);
const serverRunning = ref(false);
const serverUrl = ref('');
const consoleLogs = ref([]);
const lastUpdateTime = ref('--:--:--');

const previewFrameRef = ref(null);
const consolePanelRef = ref(null);

// 代码变化处理（防抖）
const handleCodeChange = debounce(() => {
  updateLastUpdateTime();
}, 300);

// 更新最后更新时间
const updateLastUpdateTime = () => {
  const now = new Date();
  lastUpdateTime.value = now.toLocaleTimeString();
};

// 保存项目
const handleSave = async () => {
  try {
    message.loading({ content: '保存中...', key: 'save' });

    // TODO: 实现保存到数据库
    // const result = await window.electronAPI.webIDE.saveProject({
    //   html: htmlCode.value,
    //   css: cssCode.value,
    //   js: jsCode.value,
    //   name: 'Untitled',
    //   createdAt: Date.now()
    // });

    setTimeout(() => {
      message.success({ content: '保存成功！', key: 'save', duration: 2 });
    }, 500);
  } catch (error) {
    console.error('保存失败:', error);
    message.error({ content: '保存失败: ' + error.message, key: 'save', duration: 3 });
  }
};

// 导出HTML
const handleExport = async () => {
  try {
    message.loading({ content: '导出中...', key: 'export' });

    // TODO: 实现导出功能
    // const result = await window.electronAPI.webIDE.exportHTML({
    //   html: htmlCode.value,
    //   css: cssCode.value,
    //   js: jsCode.value
    // });

    setTimeout(() => {
      message.success({ content: '导出成功！', key: 'export', duration: 2 });
    }, 500);
  } catch (error) {
    console.error('导出失败:', error);
    message.error({ content: '导出失败: ' + error.message, key: 'export', duration: 3 });
  }
};

// 切换预览模式
const handlePreviewModeChange = async (mode) => {
  if (mode === 'server' && !serverRunning.value) {
    await startDevServer();
  } else if (mode === 'srcdoc' && serverRunning.value) {
    await stopDevServer();
  }
};

// 启动开发服务器
const startDevServer = async () => {
  try {
    message.loading({ content: '启动服务器...', key: 'server' });

    // TODO: 实现服务器启动
    // const result = await window.electronAPI.webIDE.startDevServer({
    //   html: htmlCode.value,
    //   css: cssCode.value,
    //   js: jsCode.value,
    //   port: 3000
    // });

    // 模拟响应
    setTimeout(() => {
      serverRunning.value = true;
      serverUrl.value = 'http://localhost:3000';
      message.success({ content: '服务器启动成功！', key: 'server', duration: 2 });
    }, 1000);
  } catch (error) {
    console.error('启动服务器失败:', error);
    message.error({ content: '启动失败: ' + error.message, key: 'server', duration: 3 });
  }
};

// 停止开发服务器
const stopDevServer = async () => {
  try {
    // TODO: 实现服务器停止
    // await window.electronAPI.webIDE.stopDevServer();

    serverRunning.value = false;
    serverUrl.value = '';
    message.info('服务器已停止');
  } catch (error) {
    console.error('停止服务器失败:', error);
    message.error('停止失败: ' + error.message);
  }
};

// 刷新预览
const handleRefreshPreview = () => {
  if (previewFrameRef.value) {
    previewFrameRef.value.refresh();
  }
  message.success('预览已刷新');
};

// 清空控制台
const handleClearConsole = () => {
  consoleLogs.value = [];
  if (consolePanelRef.value) {
    consolePanelRef.value.clear();
  }
  message.info('控制台已清空');
};

// 切换开发工具面板
const toggleDevTools = () => {
  showDevTools.value = !showDevTools.value;
};

// 处理控制台日志
const handleConsoleLog = (log) => {
  consoleLogs.value.push(log);

  // 限制日志数量
  if (consoleLogs.value.length > 1000) {
    consoleLogs.value.shift();
  }
};

// 处理预览错误
const handlePreviewError = (error) => {
  message.error('预览错误: ' + error.message);
  handleConsoleLog({
    id: Date.now() + Math.random(),
    method: 'error',
    args: [error.message],
    timestamp: new Date().toLocaleTimeString()
  });
};

// 初始化
onMounted(() => {
  updateLastUpdateTime();
  message.info('Web IDE 已就绪');
});

// 清理
onUnmounted(() => {
  if (serverRunning.value) {
    stopDevServer();
  }
});
</script>

<style scoped>
.webide-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1e1e1e;
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #2d2d30;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}

/* 主体区域 */
.content-area {
  flex: 1;
  overflow: hidden;
}

.editor-column,
.preview-column,
.devtools-column {
  height: 100%;
  overflow: hidden;
}

.editor-column {
  border-right: 1px solid #3e3e42;
}

.preview-column {
  border-right: 1px solid #3e3e42;
}

/* 底部状态栏 */
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: #007acc;
  color: white;
  font-size: 12px;
  flex-shrink: 0;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
