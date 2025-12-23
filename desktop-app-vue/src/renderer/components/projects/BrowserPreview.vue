<template>
  <div class="browser-preview-wrapper">
    <!-- 浏览器工具栏 -->
    <div class="browser-toolbar">
      <div class="toolbar-left">
        <!-- 导航按钮 -->
        <a-button-group size="small">
          <a-button :disabled="!canGoBack" @click="handleBack">
            <ArrowLeftOutlined />
          </a-button>
          <a-button :disabled="!canGoForward" @click="handleForward">
            <ArrowRightOutlined />
          </a-button>
          <a-button @click="handleRefresh" :loading="loading">
            <ReloadOutlined />
          </a-button>
        </a-button-group>

        <!-- 地址栏 -->
        <div class="address-bar">
          <span class="address-icon">
            <GlobalOutlined />
          </span>
          <input
            v-model="addressInput"
            class="address-input"
            :placeholder="placeholder"
            @keydown.enter="handleAddressEnter"
            @blur="handleAddressBlur"
          />
          <span v-if="isSecure" class="secure-icon">
            <LockOutlined />
          </span>
        </div>
      </div>

      <div class="toolbar-right">
        <!-- 缩放控制 -->
        <div class="zoom-control">
          <a-button-group size="small">
            <a-button @click="handleZoomOut" :disabled="zoomLevel <= 50">
              <MinusOutlined />
            </a-button>
            <a-dropdown :trigger="['click']">
              <a-button class="zoom-display">
                {{ zoomLevel }}%
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="handleZoomSelect">
                  <a-menu-item key="50">50%</a-menu-item>
                  <a-menu-item key="75">75%</a-menu-item>
                  <a-menu-item key="100">100%</a-menu-item>
                  <a-menu-item key="125">125%</a-menu-item>
                  <a-menu-item key="150">150%</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
            <a-button @click="handleZoomIn" :disabled="zoomLevel >= 150">
              <PlusOutlined />
            </a-button>
          </a-button-group>
        </div>

        <!-- 在新窗口打开 -->
        <a-tooltip title="在浏览器中打开">
          <a-button size="small" @click="handleOpenInBrowser">
            <ExportOutlined />
          </a-button>
        </a-tooltip>

        <!-- 更多操作 -->
        <a-dropdown :trigger="['click']">
          <a-button size="small">
            <EllipsisOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleMoreAction">
              <a-menu-item key="screenshot">
                <CameraOutlined />
                截图
              </a-menu-item>
              <a-menu-item key="share">
                <ShareAltOutlined />
                分享
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item key="devtools">
                <CodeOutlined />
                开发者工具
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>

    <!-- 预览内容区域 -->
    <div class="preview-content" :style="{ transform: `scale(${zoomLevel / 100})` }">
      <!-- 加载状态 -->
      <div v-if="loading" class="loading-overlay">
        <a-spin size="large" tip="加载中..." />
      </div>

      <!-- iframe预览 -->
      <iframe
        v-if="previewType === 'iframe'"
        ref="iframeRef"
        :src="currentUrl"
        class="preview-iframe"
        sandbox="allow-scripts allow-same-origin allow-forms"
        @load="handleIframeLoad"
      ></iframe>

      <!-- HTML内容预览 -->
      <div
        v-else-if="previewType === 'html'"
        class="preview-html"
        v-html="htmlContent"
      ></div>

      <!-- 图片预览 -->
      <div v-else-if="previewType === 'image'" class="preview-image">
        <img :src="imageUrl" :alt="title" @load="handleImageLoad" />
      </div>

      <!-- PDF预览 -->
      <div v-else-if="previewType === 'pdf'" class="preview-pdf">
        <embed :src="pdfUrl" type="application/pdf" width="100%" height="100%" />
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="error-state">
        <div class="error-icon">
          <ExclamationCircleOutlined />
        </div>
        <h3>加载失败</h3>
        <p>{{ errorMessage }}</p>
        <a-button type="primary" @click="handleRetry">
          <ReloadOutlined />
          重试
        </a-button>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="empty-icon">
          <GlobalOutlined />
        </div>
        <h3>预览区域</h3>
        <p>在左侧选择文件或输入URL开始预览</p>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="browser-statusbar" v-if="showStatusbar">
      <div class="status-left">
        <span class="status-item">
          <ClockCircleOutlined />
          加载时间: {{ loadTime }}ms
        </span>
        <span class="status-item" v-if="fileSize">
          <FileOutlined />
          大小: {{ formatFileSize(fileSize) }}
        </span>
      </div>
      <div class="status-right">
        <span class="status-item">
          {{ currentUrl || '未加载' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  GlobalOutlined,
  LockOutlined,
  MinusOutlined,
  PlusOutlined,
  DownOutlined,
  ExportOutlined,
  EllipsisOutlined,
  CameraOutlined,
  ShareAltOutlined,
  CodeOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  FileOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  // 预览类型: iframe | html | image | pdf
  previewType: {
    type: String,
    default: 'iframe',
    validator: (value) => ['iframe', 'html', 'image', 'pdf'].includes(value),
  },
  // URL地址
  url: {
    type: String,
    default: '',
  },
  // HTML内容
  htmlContent: {
    type: String,
    default: '',
  },
  // 图片URL
  imageUrl: {
    type: String,
    default: '',
  },
  // PDF URL
  pdfUrl: {
    type: String,
    default: '',
  },
  // 标题
  title: {
    type: String,
    default: '预览',
  },
  // 占位符
  placeholder: {
    type: String,
    default: '输入URL或选择文件...',
  },
  // 默认缩放级别
  defaultZoom: {
    type: Number,
    default: 100,
    validator: (value) => value >= 50 && value <= 150,
  },
  // 是否显示状态栏
  showStatusbar: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits([
  'load',
  'error',
  'navigate',
  'zoom-change',
  'screenshot',
  'share',
  'open-devtools',
]);

// 响应式状态
const iframeRef = ref(null);
const addressInput = ref(props.url);
const currentUrl = ref(props.url);
const zoomLevel = ref(props.defaultZoom);
const loading = ref(false);
const error = ref(false);
const errorMessage = ref('');
const loadTime = ref(0);
const fileSize = ref(0);

// 浏览历史
const history = ref([]);
const historyIndex = ref(-1);

// 计算属性
const canGoBack = computed(() => historyIndex.value > 0);
const canGoForward = computed(() => historyIndex.value < history.value.length - 1);
const isSecure = computed(() => currentUrl.value.startsWith('https://'));

// 监听URL变化
watch(() => props.url, (newUrl) => {
  if (newUrl) {
    loadUrl(newUrl);
  }
});

// 加载URL
const loadUrl = async (url) => {
  if (!url) return;

  loading.value = true;
  error.value = false;
  const startTime = Date.now();

  try {
    currentUrl.value = url;
    addressInput.value = url;

    // 添加到历史记录
    if (historyIndex.value < history.value.length - 1) {
      history.value = history.value.slice(0, historyIndex.value + 1);
    }
    history.value.push(url);
    historyIndex.value = history.value.length - 1;

    // 等待加载完成
    await nextTick();

  } catch (err) {
    error.value = true;
    errorMessage.value = err.message || '加载失败';
    emit('error', err);
  } finally {
    loadTime.value = Date.now() - startTime;
  }
};

// iframe加载完成
const handleIframeLoad = () => {
  loading.value = false;
  emit('load', {
    url: currentUrl.value,
    loadTime: loadTime.value,
  });
};

// 图片加载完成
const handleImageLoad = (e) => {
  loading.value = false;
  fileSize.value = e.target.naturalWidth * e.target.naturalHeight * 4; // 估算大小
  emit('load', {
    url: props.imageUrl,
    loadTime: loadTime.value,
  });
};

// 处理地址栏回车
const handleAddressEnter = () => {
  if (addressInput.value) {
    loadUrl(addressInput.value);
  }
};

// 处理地址栏失焦
const handleAddressBlur = () => {
  addressInput.value = currentUrl.value;
};

// 后退
const handleBack = () => {
  if (canGoBack.value) {
    historyIndex.value--;
    const url = history.value[historyIndex.value];
    currentUrl.value = url;
    addressInput.value = url;
    emit('navigate', { direction: 'back', url });
  }
};

// 前进
const handleForward = () => {
  if (canGoForward.value) {
    historyIndex.value++;
    const url = history.value[historyIndex.value];
    currentUrl.value = url;
    addressInput.value = url;
    emit('navigate', { direction: 'forward', url });
  }
};

// 刷新
const handleRefresh = () => {
  if (currentUrl.value) {
    loadUrl(currentUrl.value);
  } else if (iframeRef.value) {
    iframeRef.value.contentWindow?.location.reload();
  }
};

// 重试
const handleRetry = () => {
  error.value = false;
  handleRefresh();
};

// 缩小
const handleZoomOut = () => {
  zoomLevel.value = Math.max(50, zoomLevel.value - 10);
  emit('zoom-change', zoomLevel.value);
};

// 放大
const handleZoomIn = () => {
  zoomLevel.value = Math.min(150, zoomLevel.value + 10);
  emit('zoom-change', zoomLevel.value);
};

// 选择缩放级别
const handleZoomSelect = ({ key }) => {
  zoomLevel.value = parseInt(key);
  emit('zoom-change', zoomLevel.value);
};

// 在浏览器中打开
const handleOpenInBrowser = () => {
  if (currentUrl.value) {
    window.open(currentUrl.value, '_blank');
  } else {
    message.warning('没有可打开的URL');
  }
};

// 更多操作
const handleMoreAction = ({ key }) => {
  switch (key) {
    case 'screenshot':
      emit('screenshot');
      message.info('截图功能开发中...');
      break;
    case 'share':
      emit('share');
      message.info('分享功能开发中...');
      break;
    case 'devtools':
      emit('open-devtools');
      message.info('开发者工具功能开发中...');
      break;
  }
};

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// 暴露方法
defineExpose({
  reload: handleRefresh,
  goBack: handleBack,
  goForward: handleForward,
  setZoom: (level) => {
    zoomLevel.value = level;
  },
  getIframe: () => iframeRef.value,
});
</script>

<style scoped lang="scss">
.browser-preview-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F5F5;
}

.browser-toolbar {
  background: white;
  border-bottom: 1px solid #E5E7EB;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.address-bar {
  flex: 1;
  display: flex;
  align-items: center;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  padding: 0 12px;
  height: 36px;
  transition: all 0.2s;

  &:focus-within {
    background: white;
    border-color: #1677FF;
    box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.1);
  }

  .address-icon {
    color: #9CA3AF;
    display: flex;
    align-items: center;
    margin-right: 8px;
  }

  .address-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 14px;
    color: #333;

    &::placeholder {
      color: #9CA3AF;
    }
  }

  .secure-icon {
    color: #52C41A;
    display: flex;
    align-items: center;
    margin-left: 8px;
  }
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.zoom-control {
  .zoom-display {
    min-width: 80px;
  }
}

.preview-content {
  flex: 1;
  position: relative;
  overflow: auto;
  transform-origin: top left;
  transition: transform 0.3s;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}

.preview-html {
  width: 100%;
  height: 100%;
  padding: 20px;
  background: white;
  overflow: auto;
}

.preview-image {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F9FAFB;
  padding: 20px;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}

.preview-pdf {
  width: 100%;
  height: 100%;
}

.error-state,
.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
  background: white;

  .error-icon,
  .empty-icon {
    font-size: 64px;
    margin-bottom: 24px;
  }

  .error-icon {
    color: #FF4D4F;
  }

  .empty-icon {
    color: #D1D5DB;
  }

  h3 {
    font-size: 20px;
    font-weight: 600;
    color: #374151;
    margin: 0 0 8px 0;
  }

  p {
    font-size: 14px;
    color: #6B7280;
    margin: 0 0 24px 0;
  }
}

.browser-statusbar {
  background: white;
  border-top: 1px solid #E5E7EB;
  padding: 6px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #6B7280;
  flex-shrink: 0;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 6px;

  .anticon {
    font-size: 12px;
  }
}
</style>
