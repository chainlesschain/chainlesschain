<template>
  <div class="git-status">
    <a-card
      title="Git 同步状态"
      size="small"
    >
      <template v-if="!enabled">
        <a-empty description="Git同步未启用">
          <a-button
            type="primary"
            @click="$emit('open-settings')"
          >
            前往设置
          </a-button>
        </a-empty>
      </template>

      <template v-else>
        <!-- 状态概览 -->
        <div class="status-overview">
          <a-descriptions
            :column="2"
            size="small"
          >
            <a-descriptions-item label="分支">
              <a-tag color="blue">
                {{ status.branch || 'main' }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="最后同步">
              {{ formatDate(status.lastSync) }}
            </a-descriptions-item>
            <a-descriptions-item label="未提交">
              <a-badge
                :count="changeCount"
                :number-style="{ backgroundColor: '#52c41a' }"
              />
            </a-descriptions-item>
            <a-descriptions-item label="状态">
              <a-tag :color="statusColor">
                {{ statusText }}
              </a-tag>
            </a-descriptions-item>
          </a-descriptions>
        </div>

        <!-- 更改列表 -->
        <div
          v-if="hasChanges"
          class="changes-list"
        >
          <a-divider>未提交的更改</a-divider>

          <div v-if="status.modified && status.modified.length > 0">
            <div class="change-group">
              <div class="change-title">
                <a-tag color="orange">
                  修改
                </a-tag>
                <span>{{ status.modified.length }} 个文件</span>
              </div>
              <div class="file-list">
                <div
                  v-for="file in status.modified.slice(0, 5)"
                  :key="file"
                  class="file-item"
                >
                  <file-text-outlined />
                  <span>{{ file }}</span>
                </div>
                <div
                  v-if="status.modified.length > 5"
                  class="more-files"
                >
                  ...还有 {{ status.modified.length - 5 }} 个文件
                </div>
              </div>
            </div>
          </div>

          <div v-if="status.untracked && status.untracked.length > 0">
            <div class="change-group">
              <div class="change-title">
                <a-tag color="green">
                  新增
                </a-tag>
                <span>{{ status.untracked.length }} 个文件</span>
              </div>
              <div class="file-list">
                <div
                  v-for="file in status.untracked.slice(0, 5)"
                  :key="file"
                  class="file-item"
                >
                  <plus-outlined />
                  <span>{{ file }}</span>
                </div>
                <div
                  v-if="status.untracked.length > 5"
                  class="more-files"
                >
                  ...还有 {{ status.untracked.length - 5 }} 个文件
                </div>
              </div>
            </div>
          </div>

          <div v-if="status.deleted && status.deleted.length > 0">
            <div class="change-group">
              <div class="change-title">
                <a-tag color="red">
                  删除
                </a-tag>
                <span>{{ status.deleted.length }} 个文件</span>
              </div>
              <div class="file-list">
                <div
                  v-for="file in status.deleted.slice(0, 5)"
                  :key="file"
                  class="file-item"
                >
                  <minus-outlined />
                  <span>{{ file }}</span>
                </div>
                <div
                  v-if="status.deleted.length > 5"
                  class="more-files"
                >
                  ...还有 {{ status.deleted.length - 5 }} 个文件
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="actions">
          <a-space>
            <a-button
              type="primary"
              :loading="syncing"
              :disabled="!hasChanges"
              @click="handleSync"
            >
              <sync-outlined />
              同步到Git
            </a-button>
            <a-button
              :loading="loading"
              @click="handleRefresh"
            >
              <reload-outlined />
              刷新
            </a-button>
            <a-dropdown>
              <template #overlay>
                <a-menu>
                  <a-menu-item
                    key="push"
                    @click="handlePush"
                  >
                    <upload-outlined />
                    推送
                  </a-menu-item>
                  <a-menu-item
                    key="pull"
                    @click="handlePull"
                  >
                    <download-outlined />
                    拉取
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item
                    key="log"
                    @click="showLog = true"
                  >
                    <history-outlined />
                    提交历史
                  </a-menu-item>
                </a-menu>
              </template>
              <a-button>
                更多
                <down-outlined />
              </a-button>
            </a-dropdown>
          </a-space>
        </div>

        <!-- 同步进度 -->
        <div
          v-if="progress"
          class="progress"
        >
          <a-progress
            :percent="progress.percent"
            :status="progress.status"
          />
          <div class="progress-text">
            {{ progress.text }}
          </div>
        </div>
      </template>
    </a-card>

    <!-- 提交历史对话框 -->
    <a-modal
      v-model:open="showLog"
      title="提交历史"
      width="700px"
      :footer="null"
    >
      <a-timeline>
        <a-timeline-item
          v-for="commit in commits"
          :key="commit.sha"
          color="blue"
        >
          <div class="commit-item">
            <div class="commit-message">
              {{ commit.message }}
            </div>
            <div class="commit-meta">
              <a-tag size="small">
                {{ commit.author.name }}
              </a-tag>
              <span class="commit-time">{{ formatDate(commit.timestamp) }}</span>
              <code class="commit-sha">{{ commit.sha.substring(0, 7) }}</code>
            </div>
          </div>
        </a-timeline-item>
      </a-timeline>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  SyncOutlined,
  ReloadOutlined,
  UploadOutlined,
  DownloadOutlined,
  HistoryOutlined,
  DownOutlined,
  FileTextOutlined,
  PlusOutlined,
  MinusOutlined,
} from '@ant-design/icons-vue';

const emit = defineEmits(['open-settings']);

const loading = ref(false);
const syncing = ref(false);
const enabled = ref(false);
const status = ref({});
const commits = ref([]);
const showLog = ref(false);
const progress = ref(null);

const changeCount = computed(() => {
  return (
    (status.value.modified?.length || 0) +
    (status.value.untracked?.length || 0) +
    (status.value.deleted?.length || 0)
  );
});

const hasChanges = computed(() => changeCount.value > 0);

const statusColor = computed(() => {
  if (!enabled.value) {return 'default';}
  if (hasChanges.value) {return 'warning';}
  return 'success';
});

const statusText = computed(() => {
  if (!enabled.value) {return '未启用';}
  if (hasChanges.value) {return '有未提交的更改';}
  return '已同步';
});

// 格式化日期
function formatDate(date) {
  if (!date) {return '从未';}

  const d = new Date(date);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) {return '刚刚';}
  if (diff < 3600000) {return `${Math.floor(diff / 60000)} 分钟前`;}
  if (diff < 86400000) {return `${Math.floor(diff / 3600000)} 小时前`;}
  if (diff < 604800000) {return `${Math.floor(diff / 86400000)} 天前`;}

  return d.toLocaleString('zh-CN');
}

// 刷新状态
async function handleRefresh() {
  loading.value = true;
  try {
    const result = await window.electronAPI.git.status();

    enabled.value = result.enabled || false;

    if (result.enabled) {
      status.value = result;
    }
  } catch (error) {
    message.error('获取状态失败: ' + error.message);
  } finally {
    loading.value = false;
  }
}

// 同步
async function handleSync() {
  syncing.value = true;
  progress.value = {
    percent: 0,
    status: 'active',
    text: '正在导出Markdown...',
  };

  try {
    progress.value.percent = 30;
    progress.value.text = '正在提交更改...';

    const result = await window.electronAPI.git.sync();

    progress.value.percent = 100;
    progress.value.status = 'success';
    progress.value.text = '同步完成';

    message.success(`同步成功！提交了 ${result.filesCount} 个文件`);

    setTimeout(() => {
      progress.value = null;
      handleRefresh();
    }, 2000);
  } catch (error) {
    progress.value.status = 'exception';
    progress.value.text = '同步失败';
    message.error('同步失败: ' + error.message);

    setTimeout(() => {
      progress.value = null;
    }, 2000);
  } finally {
    syncing.value = false;
  }
}

// 推送
async function handlePush() {
  try {
    await window.electronAPI.git.push();
    message.success('推送成功');
    handleRefresh();
  } catch (error) {
    message.error('推送失败: ' + error.message);
  }
}

// 拉取
async function handlePull() {
  try {
    await window.electronAPI.git.pull();
    message.success('拉取成功');
    handleRefresh();
  } catch (error) {
    message.error('拉取失败: ' + error.message);
  }
}

// 加载提交历史
async function loadCommits() {
  if (!enabled.value) {
    commits.value = [];
    return;
  }
  try {
    commits.value = await window.electronAPI.git.getLog(20);
  } catch (error) {
    message.error('加载提交历史失败: ' + error.message);
  }
}

// 监听事件
let unsubscribers = [];
let refreshTimer = null;

onMounted(async () => {
  await handleRefresh();
  if (enabled.value) {
    loadCommits();
  }

  // 监听Git事件
  unsubscribers = [
    window.electronAPI.git.on('git:committed', () => {
      handleRefresh();
      loadCommits();
    }),
    window.electronAPI.git.on('git:pushed', () => {
      message.success('推送完成');
      handleRefresh();
    }),
    window.electronAPI.git.on('git:pulled', () => {
      message.success('拉取完成');
      handleRefresh();
    }),
    window.electronAPI.git.on('git:auto-synced', (data) => {
      message.info(`自动同步完成：${data.filesCount} 个文件`);
      handleRefresh();
    }),
  ];

  // 监听Git热重载事件
  if (window.electronAPI.git.onStatusChanged) {
    unsubscribers.push(
      window.electronAPI.git.onStatusChanged((data) => {
        console.log('[GitStatus] Git状态已变化:', data);
        // 更新状态
        if (data.current) {
          status.value = data.current;
          enabled.value = true;
        }
      })
    );
  }

  if (window.electronAPI.git.onFileChanged) {
    unsubscribers.push(
      window.electronAPI.git.onFileChanged((data) => {
        console.log('[GitStatus] 文件已变化:', data);
        // 文件变化时可以显示通知（可选）
        // message.info(`文件${data.type}: ${data.path}`);
      })
    );
  }

  if (window.electronAPI.git.onHotReloadError) {
    unsubscribers.push(
      window.electronAPI.git.onHotReloadError((error) => {
        console.error('[GitStatus] Git热重载错误:', error);
        message.error('Git热重载错误: ' + error.message);
      })
    );
  }

  // 定期刷新状态（作为备用，热重载失败时仍能更新）
  refreshTimer = setInterval(handleRefresh, 30000); // 每30秒刷新一次
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  unsubscribers.forEach((unsub) => {
    if (typeof unsub === 'function') {
      unsub();
    }
  });
  unsubscribers = [];
});
</script>

<style scoped>
.git-status {
  height: 100%;
}

.status-overview {
  margin-bottom: 16px;
}

.changes-list {
  margin: 16px 0;
}

.change-group {
  margin-bottom: 12px;
}

.change-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 500;
}

.file-list {
  padding-left: 16px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
  color: #666;
}

.more-files {
  padding: 4px 0;
  font-size: 12px;
  color: #999;
  font-style: italic;
}

.actions {
  margin-top: 16px;
}

.progress {
  margin-top: 16px;
}

.progress-text {
  margin-top: 8px;
  font-size: 13px;
  color: #666;
  text-align: center;
}

.commit-item {
  padding: 4px 0;
}

.commit-message {
  font-size: 14px;
  margin-bottom: 4px;
}

.commit-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #999;
}

.commit-sha {
  font-family: 'Courier New', monospace;
  background: #f5f5f5;
  padding: 2px 4px;
  border-radius: 3px;
}

.commit-time {
  flex: 1;
}
</style>
