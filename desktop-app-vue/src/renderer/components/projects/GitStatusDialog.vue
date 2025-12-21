<template>
  <a-modal
    :open="visible"
    :title="title"
    :width="700"
    :footer="null"
    @cancel="handleClose"
  >
    <div class="git-status-dialog">
      <!-- 加载状态 -->
      <div v-if="loading" class="loading-container">
        <a-spin tip="加载Git状态..." />
      </div>

      <!-- Git状态内容 -->
      <div v-else-if="status" class="status-content">
        <!-- 分支信息 -->
        <div class="branch-info">
          <div class="info-item">
            <BranchesOutlined />
            <span class="label">当前分支:</span>
            <a-tag color="blue">{{ status.branch || 'main' }}</a-tag>
          </div>
          <div v-if="status.ahead || status.behind" class="info-item">
            <CloudOutlined />
            <span class="label">与远程:</span>
            <a-tag v-if="status.ahead" color="green">
              领先 {{ status.ahead }} 个提交
            </a-tag>
            <a-tag v-if="status.behind" color="orange">
              落后 {{ status.behind }} 个提交
            </a-tag>
          </div>
        </div>

        <!-- 已暂存的更改 -->
        <div v-if="status.staged && status.staged.length > 0" class="status-section">
          <div class="section-header">
            <h4>
              <CheckCircleOutlined style="color: #10b981" />
              已暂存的更改 ({{ status.staged.length }})
            </h4>
            <a-button size="small" @click="handleUnstageAll">
              取消暂存全部
            </a-button>
          </div>
          <div class="file-list">
            <div
              v-for="file in status.staged"
              :key="file.path"
              class="file-item staged"
            >
              <div class="file-info">
                <component :is="getFileIcon(file.status)" :style="{ color: getFileColor(file.status) }" />
                <span class="file-path">{{ file.path }}</span>
                <a-tag :color="getStatusColor(file.status)" size="small">
                  {{ getStatusText(file.status) }}
                </a-tag>
              </div>
              <div class="file-actions">
                <a-button type="text" size="small" @click="handleViewDiff(file)">
                  <EyeOutlined />
                  查看
                </a-button>
                <a-button type="text" size="small" @click="handleUnstageFile(file)">
                  <MinusCircleOutlined />
                  取消暂存
                </a-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 未暂存的更改 -->
        <div v-if="status.modified && status.modified.length > 0" class="status-section">
          <div class="section-header">
            <h4>
              <EditOutlined style="color: #f59e0b" />
              未暂存的更改 ({{ status.modified.length }})
            </h4>
            <a-button size="small" type="primary" @click="handleStageAll">
              暂存全部
            </a-button>
          </div>
          <div class="file-list">
            <div
              v-for="file in status.modified"
              :key="file.path || file"
              class="file-item modified"
            >
              <div class="file-info">
                <EditOutlined style="color: #f59e0b" />
                <span class="file-path">{{ file.path || file }}</span>
                <a-tag color="orange" size="small">已修改</a-tag>
              </div>
              <div class="file-actions">
                <a-button type="text" size="small" @click="handleViewDiff(file)">
                  <EyeOutlined />
                  查看
                </a-button>
                <a-button type="text" size="small" @click="handleStageFile(file)">
                  <PlusCircleOutlined />
                  暂存
                </a-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 未跟踪的文件 -->
        <div v-if="status.untracked && status.untracked.length > 0" class="status-section">
          <div class="section-header">
            <h4>
              <FileAddOutlined style="color: #3b82f6" />
              未跟踪的文件 ({{ status.untracked.length }})
            </h4>
            <a-button size="small" @click="handleAddAll">
              添加全部
            </a-button>
          </div>
          <div class="file-list">
            <div
              v-for="file in status.untracked"
              :key="file.path || file"
              class="file-item untracked"
            >
              <div class="file-info">
                <FileAddOutlined style="color: #3b82f6" />
                <span class="file-path">{{ file.path || file }}</span>
                <a-tag color="blue" size="small">新文件</a-tag>
              </div>
              <div class="file-actions">
                <a-button type="text" size="small" @click="handleAddFile(file)">
                  <PlusCircleOutlined />
                  添加
                </a-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 已删除的文件 -->
        <div v-if="status.deleted && status.deleted.length > 0" class="status-section">
          <div class="section-header">
            <h4>
              <DeleteOutlined style="color: #ef4444" />
              已删除的文件 ({{ status.deleted.length }})
            </h4>
          </div>
          <div class="file-list">
            <div
              v-for="file in status.deleted"
              :key="file.path || file"
              class="file-item deleted"
            >
              <div class="file-info">
                <DeleteOutlined style="color: #ef4444" />
                <span class="file-path">{{ file.path || file }}</span>
                <a-tag color="red" size="small">已删除</a-tag>
              </div>
              <div class="file-actions">
                <a-button type="text" size="small" @click="handleStageFile(file)">
                  <CheckOutlined />
                  确认删除
                </a-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 工作区干净 -->
        <div v-if="isClean" class="clean-state">
          <a-empty description="工作区干净，没有变更">
            <template #image>
              <CheckCircleOutlined style="font-size: 64px; color: #10b981" />
            </template>
          </a-empty>
        </div>

        <!-- 底部操作栏 -->
        <div v-if="!isClean" class="action-bar">
          <a-space>
            <a-button type="primary" @click="handleCommit" :disabled="!hasStaged">
              <CheckOutlined />
              提交更改
            </a-button>
            <a-button @click="handleRefresh">
              <ReloadOutlined />
              刷新
            </a-button>
            <a-button @click="handleClose">
              关闭
            </a-button>
          </a-space>
        </div>
      </div>

      <!-- 错误状态 -->
      <div v-else class="error-state">
        <a-empty description="无法获取Git状态">
          <template #image>
            <ExclamationCircleOutlined style="font-size: 64px; color: #ef4444" />
          </template>
          <a-button type="primary" @click="handleRefresh">
            重试
          </a-button>
        </a-empty>
      </div>
    </div>

    <!-- 差异对比Modal -->
    <a-modal
      v-model:open="showDiffModal"
      title="文件差异"
      :width="900"
      :footer="null"
    >
      <div class="diff-content">
        <pre>{{ currentDiff }}</pre>
      </div>
    </a-modal>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  BranchesOutlined,
  CloudOutlined,
  CheckCircleOutlined,
  EditOutlined,
  FileAddOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlusCircleOutlined,
  MinusCircleOutlined,
  CheckOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  projectId: {
    type: String,
    required: true,
  },
  repoPath: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    default: 'Git状态',
  },
});

const emit = defineEmits(['close', 'commit', 'refresh']);

// 响应式状态
const loading = ref(false);
const status = ref(null);
const showDiffModal = ref(false);
const currentDiff = ref('');

// 计算属性
const isClean = computed(() => {
  if (!status.value) return true;

  const { staged, modified, untracked, deleted } = status.value;
  return (
    (!staged || staged.length === 0) &&
    (!modified || modified.length === 0) &&
    (!untracked || untracked.length === 0) &&
    (!deleted || deleted.length === 0)
  );
});

const hasStaged = computed(() => {
  return status.value?.staged && status.value.staged.length > 0;
});

// 获取文件状态图标
const getFileIcon = (statusType) => {
  const iconMap = {
    added: FileAddOutlined,
    modified: EditOutlined,
    deleted: DeleteOutlined,
  };
  return iconMap[statusType] || EditOutlined;
};

// 获取文件状态颜色
const getFileColor = (statusType) => {
  const colorMap = {
    added: '#10b981',
    modified: '#f59e0b',
    deleted: '#ef4444',
  };
  return colorMap[statusType] || '#6b7280';
};

// 获取状态标签颜色
const getStatusColor = (statusType) => {
  const colorMap = {
    added: 'green',
    modified: 'orange',
    deleted: 'red',
  };
  return colorMap[statusType] || 'default';
};

// 获取状态文本
const getStatusText = (statusType) => {
  const textMap = {
    added: '新增',
    modified: '修改',
    deleted: '删除',
  };
  return textMap[statusType] || '更改';
};

// 加载Git状态
const loadStatus = async () => {
  loading.value = true;
  try {
    const result = await window.electronAPI.project.gitStatus(props.repoPath);
    status.value = result;
  } catch (error) {
    console.error('Load git status failed:', error);
    message.error('获取Git状态失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

// 暂存文件
const handleStageFile = async (file) => {
  try {
    const filePath = file.path || file;
    await window.electronAPI.project.gitAdd(props.repoPath, filePath);
    message.success(`已暂存: ${filePath}`);
    await loadStatus();
  } catch (error) {
    console.error('Stage file failed:', error);
    message.error('暂存失败：' + error.message);
  }
};

// 暂存全部
const handleStageAll = async () => {
  try {
    await window.electronAPI.project.gitAdd(props.repoPath, '.');
    message.success('已暂存全部更改');
    await loadStatus();
  } catch (error) {
    console.error('Stage all failed:', error);
    message.error('暂存失败：' + error.message);
  }
};

// 取消暂存文件
const handleUnstageFile = async (file) => {
  try {
    const filePath = file.path || file;
    await window.electronAPI.project.gitUnstage(props.repoPath, filePath);
    message.success(`已取消暂存: ${filePath}`);
    await loadStatus();
  } catch (error) {
    console.error('Unstage file failed:', error);
    message.error('取消暂存失败：' + error.message);
  }
};

// 取消暂存全部
const handleUnstageAll = async () => {
  try {
    await window.electronAPI.project.gitUnstage(props.repoPath, '.');
    message.success('已取消暂存全部');
    await loadStatus();
  } catch (error) {
    console.error('Unstage all failed:', error);
    message.error('取消暂存失败：' + error.message);
  }
};

// 添加文件
const handleAddFile = async (file) => {
  await handleStageFile(file);
};

// 添加全部
const handleAddAll = async () => {
  await handleStageAll();
};

// 查看差异
const handleViewDiff = async (file) => {
  try {
    const filePath = file.path || file;
    const diff = await window.electronAPI.project.gitDiff(props.repoPath, filePath);
    currentDiff.value = diff || '没有差异';
    showDiffModal.value = true;
  } catch (error) {
    console.error('View diff failed:', error);
    message.error('查看差异失败：' + error.message);
  }
};

// 提交更改
const handleCommit = () => {
  emit('commit');
};

// 刷新
const handleRefresh = async () => {
  await loadStatus();
  emit('refresh');
};

// 关闭
const handleClose = () => {
  emit('close');
};

// 监听visible变化
watch(() => props.visible, (newVal) => {
  if (newVal) {
    loadStatus();
  }
}, { immediate: true });
</script>

<style scoped>
.git-status-dialog {
  max-height: 600px;
  overflow-y: auto;
}

/* 加载状态 */
.loading-container {
  padding: 60px;
  text-align: center;
}

/* 分支信息 */
.branch-info {
  background: #f9fafb;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.info-item:last-child {
  margin-bottom: 0;
}

.info-item :deep(.anticon) {
  font-size: 16px;
  color: #667eea;
}

.label {
  font-size: 14px;
  color: #6b7280;
  min-width: 80px;
}

/* 状态区块 */
.status-section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid #e5e7eb;
}

.section-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-header h4 :deep(.anticon) {
  font-size: 18px;
}

/* 文件列表 */
.file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: #f9fafb;
  border-radius: 6px;
  border-left: 3px solid transparent;
  transition: all 0.3s;
}

.file-item:hover {
  background: #f3f4f6;
}

.file-item.staged {
  border-left-color: #10b981;
}

.file-item.modified {
  border-left-color: #f59e0b;
}

.file-item.untracked {
  border-left-color: #3b82f6;
}

.file-item.deleted {
  border-left-color: #ef4444;
}

.file-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.file-info :deep(.anticon) {
  font-size: 16px;
  flex-shrink: 0;
}

.file-path {
  flex: 1;
  font-size: 13px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 干净状态 */
.clean-state {
  padding: 40px;
  text-align: center;
}

/* 错误状态 */
.error-state {
  padding: 40px;
  text-align: center;
}

/* 操作栏 */
.action-bar {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
}

/* 差异内容 */
.diff-content {
  max-height: 500px;
  overflow: auto;
  background: #1e1e1e;
  padding: 16px;
  border-radius: 6px;
}

.diff-content pre {
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* 滚动条样式 */
.git-status-dialog::-webkit-scrollbar {
  width: 8px;
}

.git-status-dialog::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.git-status-dialog::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
}

.git-status-dialog::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
