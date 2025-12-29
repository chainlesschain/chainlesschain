<template>
  <a-modal
    :open="visible"
    :title="title"
    :width="900"
    :footer="null"
    @cancel="handleClose"
  >
    <div class="git-history-dialog">
      <!-- 加载状态 -->
      <div v-if="loading" class="loading-container">
        <a-spin tip="加载提交历史..." />
      </div>

      <!-- 提交历史列表 -->
      <div v-else-if="commits && commits.length > 0" class="history-content">
        <!-- 工具栏 -->
        <div class="toolbar">
          <a-space>
            <a-button size="small" @click="handleRefresh">
              <ReloadOutlined />
              刷新
            </a-button>
            <a-select
              v-model:value="branchFilter"
              placeholder="选择分支"
              style="width: 150px"
              size="small"
              @change="handleBranchChange"
            >
              <a-select-option value="all">全部分支</a-select-option>
              <a-select-option value="current">当前分支</a-select-option>
            </a-select>
            <a-input-search
              v-model:value="searchKeyword"
              placeholder="搜索提交..."
              style="width: 200px"
              size="small"
              @search="handleSearch"
            />
          </a-space>
        </div>

        <!-- 提交列表 -->
        <div class="commits-list">
          <a-timeline>
            <a-timeline-item
              v-for="commit in filteredCommits"
              :key="commit.oid || commit.sha"
              :color="getCommitColor(commit)"
            >
              <template #dot>
                <component :is="getCommitIcon(commit)" />
              </template>

              <div class="commit-item">
                <!-- 提交头部 -->
                <div class="commit-header">
                  <div class="commit-title">
                    <h4>{{ commit.message || commit.commit.message }}</h4>
                    <a-tag v-if="commit.isHead" color="blue" size="small">
                      HEAD
                    </a-tag>
                    <a-tag v-if="commit.isMerge" color="purple" size="small">
                      MERGE
                    </a-tag>
                  </div>
                  <div class="commit-meta">
                    <a-tooltip :title="formatFullDate(commit.timestamp || commit.commit.author.timestamp)">
                      <span class="meta-item">
                        <ClockCircleOutlined />
                        {{ formatRelativeTime(commit.timestamp || commit.commit.author.timestamp) }}
                      </span>
                    </a-tooltip>
                    <span class="meta-item">
                      <UserOutlined />
                      {{ commit.author || commit.commit.author.name }}
                    </span>
                    <span class="meta-item sha">
                      <CodeOutlined />
                      {{ formatSha(commit.oid || commit.sha) }}
                    </span>
                  </div>
                </div>

                <!-- 提交详情（可展开） -->
                <div v-if="expandedCommit === (commit.oid || commit.sha)" class="commit-details">
                  <a-descriptions bordered size="small" :column="1">
                    <a-descriptions-item label="提交哈希">
                      {{ commit.oid || commit.sha }}
                    </a-descriptions-item>
                    <a-descriptions-item label="作者">
                      {{ commit.author || commit.commit.author.name }}
                      <{{ commit.email || commit.commit.author.email }}>
                    </a-descriptions-item>
                    <a-descriptions-item label="提交时间">
                      {{ formatFullDate(commit.timestamp || commit.commit.author.timestamp) }}
                    </a-descriptions-item>
                    <a-descriptions-item v-if="commit.parent" label="父提交">
                      {{ formatSha(commit.parent) }}
                    </a-descriptions-item>
                  </a-descriptions>

                  <!-- 变更文件列表 -->
                  <div v-if="commitFiles[commit.oid || commit.sha]" class="changed-files">
                    <h5>变更文件 ({{ commitFiles[commit.oid || commit.sha].length }})</h5>
                    <div class="files-list">
                      <div
                        v-for="file in commitFiles[commit.oid || commit.sha]"
                        :key="file.path"
                        class="file-item"
                      >
                        <component :is="getFileStatusIcon(file.status)" />
                        <span class="file-path">{{ file.path }}</span>
                        <a-tag :color="getFileStatusColor(file.status)" size="small">
                          {{ file.status }}
                        </a-tag>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 操作按钮 -->
                <div class="commit-actions">
                  <a-button
                    type="text"
                    size="small"
                    @click="toggleCommitDetails(commit.oid || commit.sha)"
                  >
                    {{ expandedCommit === (commit.oid || commit.sha) ? '收起' : '展开' }}
                    <DownOutlined v-if="expandedCommit !== (commit.oid || commit.sha)" />
                    <UpOutlined v-else />
                  </a-button>
                  <a-button type="text" size="small" @click="handleViewCommit(commit)">
                    <EyeOutlined />
                    查看详情
                  </a-button>
                  <a-button type="text" size="small" @click="handleCopyHash(commit.oid || commit.sha)">
                    <CopyOutlined />
                    复制哈希
                  </a-button>
                  <a-button
                    v-if="canCheckout(commit)"
                    type="text"
                    size="small"
                    danger
                    @click="handleCheckout(commit)"
                  >
                    <RollbackOutlined />
                    回退到此版本
                  </a-button>
                </div>
              </div>
            </a-timeline-item>
          </a-timeline>
        </div>

        <!-- 加载更多 -->
        <div v-if="hasMore" class="load-more">
          <a-button block @click="handleLoadMore" :loading="loadingMore">
            加载更多
          </a-button>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <a-empty description="暂无提交历史">
          <template #image>
            <HistoryOutlined style="font-size: 64px; color: #d1d5db" />
          </template>
        </a-empty>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  ReloadOutlined,
  ClockCircleOutlined,
  UserOutlined,
  CodeOutlined,
  DownOutlined,
  UpOutlined,
  EyeOutlined,
  CopyOutlined,
  RollbackOutlined,
  HistoryOutlined,
  CheckCircleOutlined,
  BranchesOutlined,
  FileAddOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { formatDistanceToNow, format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  projectId: {
    type: String,
    default: '',
  },
  repoPath: {
    type: String,
    default: '',
  },
  title: {
    type: String,
    default: 'Git提交历史',
  },
});

const emit = defineEmits(['close', 'refresh']);

// 响应式状态
const loading = ref(false);
const loadingMore = ref(false);
const commits = ref([]);
const commitFiles = ref({});
const expandedCommit = ref(null);
const branchFilter = ref('current');
const searchKeyword = ref('');
const currentPage = ref(1);
const pageSize = ref(20);
const hasMore = ref(false);

// 计算属性
const filteredCommits = computed(() => {
  let result = commits.value;

  // 关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(commit => {
      const message = commit.message || commit.commit?.message || '';
      const author = commit.author || commit.commit?.author?.name || '';
      return (
        message.toLowerCase().includes(keyword) ||
        author.toLowerCase().includes(keyword)
      );
    });
  }

  return result;
});

// 获取提交颜色
const getCommitColor = (commit) => {
  if (commit.isHead) return 'blue';
  if (commit.isMerge) return 'purple';
  return 'green';
};

// 获取提交图标
const getCommitIcon = (commit) => {
  if (commit.isHead) return CheckCircleOutlined;
  if (commit.isMerge) return BranchesOutlined;
  return CodeOutlined;
};

// 获取文件状态图标
const getFileStatusIcon = (status) => {
  const iconMap = {
    added: FileAddOutlined,
    modified: EditOutlined,
    deleted: DeleteOutlined,
  };
  return iconMap[status] || EditOutlined;
};

// 获取文件状态颜色
const getFileStatusColor = (status) => {
  const colorMap = {
    added: 'green',
    modified: 'orange',
    deleted: 'red',
  };
  return colorMap[status] || 'default';
};

// 格式化SHA
const formatSha = (sha) => {
  return sha ? sha.substring(0, 7) : '';
};

// 格式化相对时间
const formatRelativeTime = (timestamp) => {
  try {
    const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: zhCN,
    });
  } catch {
    return '未知时间';
  }
};

// 格式化完整日期
const formatFullDate = (timestamp) => {
  try {
    const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
    return format(date, 'yyyy-MM-dd HH:mm:ss', { locale: zhCN });
  } catch {
    return '未知时间';
  }
};

// 加载提交历史
const loadCommits = async (append = false) => {
  if (append) {
    loadingMore.value = true;
  } else {
    loading.value = true;
  }

  try {
    const result = await window.electronAPI.project.gitLog(
      props.repoPath,
      currentPage.value,
      pageSize.value
    );

    if (append) {
      commits.value = [...commits.value, ...(result.commits || [])];
    } else {
      commits.value = result.commits || [];
    }

    hasMore.value = result.hasMore || false;
  } catch (error) {
    console.error('Load git history failed:', error);
    message.error('加载提交历史失败：' + error.message);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

// 切换提交详情
const toggleCommitDetails = async (sha) => {
  if (expandedCommit.value === sha) {
    expandedCommit.value = null;
  } else {
    expandedCommit.value = sha;

    // 加载变更文件（如果还未加载）
    if (!commitFiles.value[sha]) {
      try {
        const files = await window.electronAPI.project.gitShowCommit(props.repoPath, sha);
        commitFiles.value[sha] = files;
      } catch (error) {
        console.error('Load commit files failed:', error);
      }
    }
  }
};

// 查看提交详情
const handleViewCommit = (commit) => {
  toggleCommitDetails(commit.oid || commit.sha);
};

// 复制哈希
const handleCopyHash = async (sha) => {
  try {
    await navigator.clipboard.writeText(sha);
    message.success('已复制提交哈希');
  } catch (error) {
    message.error('复制失败');
  }
};

// 能否回退
const canCheckout = (commit) => {
  return !commit.isHead; // 不是当前HEAD才能回退
};

// 回退到指定版本
const handleCheckout = (commit) => {
  const sha = commit.oid || commit.sha;

  Modal.confirm({
    title: '确认回退',
    content: `确定要回退到提交 ${formatSha(sha)} 吗？这将重置工作区到该版本。`,
    okText: '确认回退',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await window.electronAPI.project.gitCheckout(props.repoPath, sha);
        message.success('已回退到指定版本');
        await loadCommits();
        emit('refresh');
      } catch (error) {
        console.error('Checkout failed:', error);
        message.error('回退失败：' + error.message);
      }
    },
  });
};

// 分支筛选变化
const handleBranchChange = () => {
  currentPage.value = 1;
  loadCommits();
};

// 搜索
const handleSearch = () => {
  // 搜索逻辑在computed中实现
};

// 刷新
const handleRefresh = () => {
  currentPage.value = 1;
  loadCommits();
  emit('refresh');
};

// 加载更多
const handleLoadMore = () => {
  currentPage.value++;
  loadCommits(true);
};

// 关闭
const handleClose = () => {
  emit('close');
};

// 监听visible变化
watch(() => props.open, (newVal) => {
  if (newVal) {
    currentPage.value = 1;
    expandedCommit.value = null;
    commitFiles.value = {};
    loadCommits();
  }
}, { immediate: true });
</script>

<style scoped>
.git-history-dialog {
  max-height: 700px;
  overflow-y: auto;
}

/* 加载状态 */
.loading-container {
  padding: 60px;
  text-align: center;
}

/* 工具栏 */
.toolbar {
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

/* 提交列表 */
.commits-list {
  margin-top: 20px;
}

.commits-list :deep(.ant-timeline-item-tail) {
  border-left: 2px solid #e5e7eb;
}

.commits-list :deep(.ant-timeline-item-head) {
  background: white;
  border-width: 2px;
}

/* 提交项 */
.commit-item {
  background: #f9fafb;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 8px;
  border: 1px solid #e5e7eb;
  transition: all 0.3s;
}

.commit-item:hover {
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* 提交头部 */
.commit-header {
  margin-bottom: 12px;
}

.commit-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.commit-title h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  flex: 1;
}

.commit-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #6b7280;
}

.meta-item :deep(.anticon) {
  font-size: 14px;
}

.meta-item.sha {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  color: #667eea;
}

/* 提交详情 */
.commit-details {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}

.changed-files {
  margin-top: 16px;
}

.changed-files h5 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.files-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: white;
  border-radius: 4px;
  font-size: 13px;
}

.file-item :deep(.anticon) {
  font-size: 14px;
}

.file-path {
  flex: 1;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 提交操作 */
.commit-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 加载更多 */
.load-more {
  margin-top: 16px;
}

/* 空状态 */
.empty-state {
  padding: 60px 40px;
  text-align: center;
}

/* 滚动条样式 */
.git-history-dialog::-webkit-scrollbar {
  width: 8px;
}

.git-history-dialog::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.git-history-dialog::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
}

.git-history-dialog::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
