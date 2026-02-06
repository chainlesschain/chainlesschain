<template>
  <div class="browser-control-page">
    <a-card title="浏览器自动化控制" :bordered="false" class="main-card">
      <!-- 浏览器控制栏 -->
      <div class="control-bar">
        <a-space size="middle">
          <a-button
            v-if="!browserStatus.isRunning"
            type="primary"
            @click="handleStartBrowser"
            :loading="loading.start"
          >
            <template #icon><PlayCircleOutlined /></template>
            启动浏览器
          </a-button>

          <a-button
            v-else
            danger
            @click="handleStopBrowser"
            :loading="loading.stop"
          >
            <template #icon><StopOutlined /></template>
            停止浏览器
          </a-button>

          <a-badge
            :status="browserStatus.isRunning ? 'processing' : 'default'"
            :text="browserStatus.isRunning ? '运行中' : '已停止'"
          />

          <a-statistic
            v-if="browserStatus.isRunning"
            title="运行时间"
            :value="uptimeFormatted"
            prefix=""
            :value-style="{ fontSize: '14px' }"
          />

          <a-statistic
            title="标签页"
            :value="tabs.length"
            prefix=""
            :value-style="{ fontSize: '14px' }"
          />
        </a-space>
      </div>

      <a-divider />

      <!-- URL 输入栏 -->
      <div class="url-bar" v-if="browserStatus.isRunning">
        <a-input-search
          v-model:value="urlInput"
          placeholder="输入网址，例如: https://www.google.com"
          enter-button="打开标签页"
          size="large"
          @search="handleOpenTab"
          :loading="loading.openTab"
        >
          <template #prefix>
            <GlobalOutlined />
          </template>
        </a-input-search>
      </div>

      <a-divider v-if="browserStatus.isRunning" />

      <!-- 标签页列表 -->
      <div class="tabs-section" v-if="browserStatus.isRunning && tabs.length > 0">
        <h3>标签页列表 ({{ tabs.length }})</h3>

        <a-list
          :data-source="tabs"
          :grid="{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3, xxl: 4 }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-card
                hoverable
                :class="{ 'active-tab': item.targetId === activeTargetId }"
              >
                <template #title>
                  <div class="tab-title">
                    <GlobalOutlined style="margin-right: 8px" />
                    <a-tooltip :title="item.title">
                      <span class="tab-title-text">{{ item.title || '未命名' }}</span>
                    </a-tooltip>
                  </div>
                </template>

                <template #extra>
                  <a-space>
                    <a-tooltip title="聚焦">
                      <a-button
                        type="text"
                        size="small"
                        @click="handleFocusTab(item.targetId)"
                      >
                        <EyeOutlined />
                      </a-button>
                    </a-tooltip>

                    <a-tooltip title="截图">
                      <a-button
                        type="text"
                        size="small"
                        @click="handleScreenshot(item.targetId)"
                        :loading="loading.screenshot === item.targetId"
                      >
                        <CameraOutlined />
                      </a-button>
                    </a-tooltip>

                    <a-tooltip title="关闭">
                      <a-button
                        type="text"
                        danger
                        size="small"
                        @click="handleCloseTab(item.targetId)"
                      >
                        <CloseOutlined />
                      </a-button>
                    </a-tooltip>
                  </a-space>
                </template>

                <div class="tab-content">
                  <a-typography-text
                    type="secondary"
                    :ellipsis="{ tooltip: true }"
                    style="font-size: 12px"
                  >
                    {{ item.url }}
                  </a-typography-text>
                  <div style="margin-top: 8px">
                    <a-tag color="blue">{{ item.profileName }}</a-tag>
                    <a-tag>{{ item.targetId }}</a-tag>
                  </div>
                </div>
              </a-card>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <!-- 空状态 -->
      <a-empty
        v-else-if="browserStatus.isRunning && tabs.length === 0"
        description="暂无标签页，请输入网址打开新标签页"
      >
        <a-button type="primary" @click="() => urlInput = 'https://www.google.com'">
          打开 Google
        </a-button>
      </a-empty>

      <a-empty
        v-else
        description="浏览器未启动，请点击上方按钮启动"
      />
    </a-card>

    <!-- Phase 2: 快照面板 -->
    <snapshot-panel
      v-if="browserStatus.isRunning && activeTargetId"
      :targetId="activeTargetId"
      class="mt-4"
      ref="snapshotPanelRef"
    />

    <!-- Phase 3: AI 控制面板 -->
    <ai-control-panel
      v-if="browserStatus.isRunning && activeTargetId"
      :targetId="activeTargetId"
      class="mt-4"
    />

    <!-- 截图预览模态框 -->
    <a-modal
      v-model:open="screenshotModal.visible"
      title="截图预览"
      width="80%"
      :footer="null"
    >
      <img
        v-if="screenshotModal.data"
        :src="`data:image/png;base64,${screenshotModal.data}`"
        style="width: 100%"
        alt="Screenshot"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  PlayCircleOutlined,
  StopOutlined,
  GlobalOutlined,
  CameraOutlined,
  CloseOutlined,
  EyeOutlined
} from '@ant-design/icons-vue';
import SnapshotPanel from '../components/browser/SnapshotPanel.vue';
import AIControlPanel from '../components/browser/AIControlPanel.vue';

// 状态管理
const browserStatus = reactive({
  isRunning: false,
  uptime: 0,
  cdpPort: 0,
  contextsCount: 0,
  tabsCount: 0,
  pid: null
});

const tabs = ref([]);
const urlInput = ref('https://www.google.com');
const activeTargetId = ref(null);

const loading = reactive({
  start: false,
  stop: false,
  openTab: false,
  screenshot: null
});

const screenshotModal = reactive({
  visible: false,
  data: null
});

// Phase 2: 快照面板引用
const snapshotPanelRef = ref(null);

// 计算属性
const uptimeFormatted = computed(() => {
  const seconds = Math.floor(browserStatus.uptime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
});

// 定时更新运行时间
let uptimeInterval = null;

// 方法
const handleStartBrowser = async () => {
  loading.start = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:start', {
      headless: false,
      channel: 'chrome' // 或 'msedge'
    });

    if (result.success) {
      message.success('浏览器启动成功');

      // 创建默认 Profile
      await window.electron.ipcRenderer.invoke('browser:createContext', 'default', {});

      // 更新状态
      await refreshStatus();

      // 开始定时更新运行时间
      uptimeInterval = setInterval(() => {
        refreshStatus();
      }, 1000);
    }
  } catch (error) {
    message.error('启动失败: ' + error.message);
    console.error('Start browser error:', error);
  } finally {
    loading.start = false;
  }
};

const handleStopBrowser = async () => {
  loading.stop = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:stop');

    if (result.success) {
      message.success('浏览器已停止');
      tabs.value = [];
      activeTargetId.value = null;

      // 停止定时器
      if (uptimeInterval) {
        clearInterval(uptimeInterval);
        uptimeInterval = null;
      }

      await refreshStatus();
    }
  } catch (error) {
    message.error('停止失败: ' + error.message);
    console.error('Stop browser error:', error);
  } finally {
    loading.stop = false;
  }
};

const handleOpenTab = async () => {
  if (!urlInput.value.trim()) {
    message.warning('请输入网址');
    return;
  }

  // 自动补全协议
  let url = urlInput.value.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  loading.openTab = true;
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:openTab',
      'default',
      url,
      { waitUntil: 'domcontentloaded' }
    );

    if (result.success) {
      message.success('标签页已打开');
      activeTargetId.value = result.targetId;
      await refreshTabs();
    }
  } catch (error) {
    message.error('打开失败: ' + error.message);
    console.error('Open tab error:', error);
  } finally {
    loading.openTab = false;
  }
};

const handleCloseTab = async (targetId) => {
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:closeTab', targetId);

    if (result.success) {
      message.success('标签页已关闭');
      if (activeTargetId.value === targetId) {
        activeTargetId.value = null;
      }
      await refreshTabs();
    }
  } catch (error) {
    message.error('关闭失败: ' + error.message);
    console.error('Close tab error:', error);
  }
};

const handleFocusTab = async (targetId) => {
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:focusTab', targetId);

    if (result.success) {
      message.success('已聚焦到标签页');
      activeTargetId.value = targetId;
    }
  } catch (error) {
    message.error('聚焦失败: ' + error.message);
    console.error('Focus tab error:', error);
  }
};

const handleScreenshot = async (targetId) => {
  loading.screenshot = targetId;
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:screenshot', targetId, {
      type: 'png',
      fullPage: false
    });

    screenshotModal.data = result.screenshot;
    screenshotModal.visible = true;

    message.success('截图成功');
  } catch (error) {
    message.error('截图失败: ' + error.message);
    console.error('Screenshot error:', error);
  } finally {
    loading.screenshot = null;
  }
};

const refreshStatus = async () => {
  try {
    const status = await window.electron.ipcRenderer.invoke('browser:getStatus');
    Object.assign(browserStatus, status);
  } catch (error) {
    console.error('Refresh status error:', error);
  }
};

const refreshTabs = async () => {
  try {
    const tabsList = await window.electron.ipcRenderer.invoke('browser:listTabs', 'default');
    tabs.value = tabsList;
  } catch (error) {
    console.error('Refresh tabs error:', error);
  }
};

// 生命周期
onMounted(async () => {
  // 初始状态检查
  await refreshStatus();

  if (browserStatus.isRunning) {
    await refreshTabs();

    // 开始定时更新
    uptimeInterval = setInterval(() => {
      refreshStatus();
    }, 1000);
  }
});

onUnmounted(() => {
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
  }
});
</script>

<style scoped lang="less">
.browser-control-page {
  padding: 24px;
  min-height: 100vh;
  background: #f0f2f5;

  .main-card {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .control-bar {
    margin-bottom: 16px;
  }

  .url-bar {
    margin-bottom: 16px;
  }

  .tabs-section {
    h3 {
      margin-bottom: 16px;
      font-size: 16px;
      font-weight: 600;
    }

    .active-tab {
      border: 2px solid #1890ff;
      box-shadow: 0 4px 12px rgba(24, 144, 255, 0.3);
    }

    .tab-title {
      display: flex;
      align-items: center;
      overflow: hidden;

      .tab-title-text {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .tab-content {
      min-height: 60px;
    }
  }
}

:deep(.ant-statistic-title) {
  font-size: 12px;
  margin-bottom: 0;
}
</style>
