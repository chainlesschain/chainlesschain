<template>
  <div class="preview-frame">
    <!-- 预览工具栏 -->
    <div class="preview-toolbar">
      <a-space>
        <span class="toolbar-title">
          <EyeOutlined />
          预览
        </span>
        <a-divider type="vertical" />
        <a-tooltip :title="`当前设备: ${deviceInfo.name}`">
          <a-tag :color="deviceInfo.color">
            <component :is="deviceInfo.icon" />
            {{ deviceInfo.width }} x {{ deviceInfo.height }}
          </a-tag>
        </a-tooltip>
        <a-tooltip title="旋转设备">
          <a-button size="small" @click="handleRotate">
            <ReloadOutlined />
          </a-button>
        </a-tooltip>
        <a-tooltip title="重置缩放">
          <a-button size="small" @click="handleResetZoom">
            <ZoomOutOutlined />
          </a-button>
        </a-tooltip>
      </a-space>
    </div>

    <!-- 预览容器 -->
    <div ref="previewContainerRef" class="preview-container">
      <div
        class="preview-wrapper"
        :style="previewWrapperStyle"
      >
        <!-- srcdoc 模式 -->
        <iframe
          v-if="mode === 'srcdoc'"
          ref="previewIframeRef"
          class="preview-iframe"
          :style="iframeStyle"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          @load="handleIframeLoad"
        ></iframe>

        <!-- server 模式 -->
        <iframe
          v-else-if="mode === 'server' && serverUrl"
          ref="serverIframeRef"
          class="preview-iframe"
          :src="serverUrl"
          :style="iframeStyle"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          @load="handleIframeLoad"
        ></iframe>

        <!-- 加载中 -->
        <div v-else class="loading-placeholder">
          <a-spin size="large" />
          <p>等待服务器启动...</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import {
  EyeOutlined,
  ReloadOutlined,
  ZoomOutOutlined,
  MobileOutlined,
  TabletOutlined,
  DesktopOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  html: {
    type: String,
    default: '',
  },
  css: {
    type: String,
    default: '',
  },
  js: {
    type: String,
    default: '',
  },
  mode: {
    type: String,
    default: 'srcdoc', // 'srcdoc' | 'server'
  },
  device: {
    type: String,
    default: 'desktop', // 'mobile' | 'tablet' | 'desktop'
  },
  serverUrl: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['console-log', 'error']);

// 设备预设
const devicePresets = {
  mobile: {
    name: '手机',
    icon: MobileOutlined,
    width: 375,
    height: 667,
    color: 'blue',
  },
  tablet: {
    name: '平板',
    icon: TabletOutlined,
    width: 768,
    height: 1024,
    color: 'green',
  },
  desktop: {
    name: '桌面',
    icon: DesktopOutlined,
    width: 1440,
    height: 900,
    color: 'purple',
  },
};

// 状态
const previewIframeRef = ref(null);
const serverIframeRef = ref(null);
const previewContainerRef = ref(null);
const rotation = ref(0);
const scale = ref(1);

// 当前设备信息
const deviceInfo = computed(() => devicePresets[props.device] || devicePresets.desktop);

// 预览容器样式
const previewWrapperStyle = computed(() => ({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'auto',
  padding: '20px',
}));

// iframe 样式
const iframeStyle = computed(() => {
  const width = rotation.value % 180 === 0 ? deviceInfo.value.width : deviceInfo.value.height;
  const height = rotation.value % 180 === 0 ? deviceInfo.value.height : deviceInfo.value.width;

  return {
    width: `${width}px`,
    height: `${height}px`,
    border: '1px solid #3e3e42',
    borderRadius: '4px',
    background: 'white',
    transform: `rotate(${rotation.value}deg) scale(${scale.value})`,
    transformOrigin: 'center center',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  };
});

// 生成预览 HTML
const generatePreviewHTML = () => {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${props.css}</style>
</head>
<body>
  ${props.html}
  <script>
    // Console 拦截
    (function() {
      const methods = ['log', 'error', 'warn', 'info'];
      methods.forEach(method => {
        const original = console[method];
        console[method] = function(...args) {
          // 发送到父窗口
          window.parent.postMessage({
            type: 'console',
            method: method,
            args: args.map(arg => {
              try {
                return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
              } catch (e) {
                return String(arg);
              }
            }),
            timestamp: Date.now()
          }, '*');

          // 调用原始方法
          original.apply(console, args);
        };
      });

      // 错误捕获
      window.onerror = function(message, source, lineno, colno, error) {
        window.parent.postMessage({
          type: 'console',
          method: 'error',
          args: [\`Error: \${message} at \${source}:\${lineno}:\${colno}\`],
          timestamp: Date.now()
        }, '*');
        return false;
      };

      // 未处理的 Promise 错误
      window.addEventListener('unhandledrejection', function(event) {
        window.parent.postMessage({
          type: 'console',
          method: 'error',
          args: [\`Unhandled Promise Rejection: \${event.reason}\`],
          timestamp: Date.now()
        }, '*');
      });
    })();

    ${props.js}
  <\/script>
</body>
</html>`;
};

// 更新预览
const updatePreview = () => {
  if (props.mode === 'srcdoc' && previewIframeRef.value) {
    const previewHTML = generatePreviewHTML();
    previewIframeRef.value.srcdoc = previewHTML;
  }
};

// iframe 加载完成
const handleIframeLoad = () => {
  console.log('Preview iframe loaded');
};

// 旋转设备
const handleRotate = () => {
  rotation.value = (rotation.value + 90) % 360;
};

// 重置缩放
const handleResetZoom = () => {
  scale.value = 1;
  rotation.value = 0;
};

// 刷新预览
const refresh = () => {
  updatePreview();
};

// 监听 postMessage
const handleMessage = (event) => {
  if (event.data.type === 'console') {
    emit('console-log', {
      id: Date.now() + Math.random(),
      method: event.data.method,
      args: event.data.args,
      timestamp: new Date(event.data.timestamp).toLocaleTimeString(),
    });
  }
};

// 监听代码变化
watch(
  () => [props.html, props.css, props.js],
  () => {
    if (props.mode === 'srcdoc') {
      updatePreview();
    }
  },
  { deep: true }
);

// 监听模式变化
watch(
  () => props.mode,
  () => {
    nextTick(() => {
      updatePreview();
    });
  }
);

// 生命周期
onMounted(() => {
  window.addEventListener('message', handleMessage);
  nextTick(() => {
    updatePreview();
  });
});

onUnmounted(() => {
  window.removeEventListener('message', handleMessage);
});

// 暴露方法
defineExpose({
  refresh,
  rotate: handleRotate,
  resetZoom: handleResetZoom,
});
</script>

<style scoped>
.preview-frame {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #252526;
}

/* 预览工具栏 */
.preview-toolbar {
  padding: 8px 12px;
  background: #2d2d30;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}

.toolbar-title {
  color: #cccccc;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 预览容器 */
.preview-container {
  flex: 1;
  overflow: auto;
  background: #1e1e1e;
}

.preview-wrapper {
  min-height: 100%;
}

.preview-iframe {
  display: block;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* 加载占位符 */
.loading-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #cccccc;
  gap: 16px;
}

.loading-placeholder p {
  margin: 0;
  font-size: 14px;
}

/* 滚动条样式 */
.preview-container::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

.preview-container::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.preview-container::-webkit-scrollbar-thumb {
  background: #424242;
  border-radius: 6px;
}

.preview-container::-webkit-scrollbar-thumb:hover {
  background: #4e4e4e;
}
</style>
