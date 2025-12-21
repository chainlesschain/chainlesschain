<template>
  <div class="project-detail-page">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <!-- 左侧：面包屑导航 -->
      <div class="toolbar-left">
        <a-breadcrumb>
          <a-breadcrumb-item>
            <a @click="handleBackToList">
              <FolderOpenOutlined />
              我的项目
            </a>
          </a-breadcrumb-item>
          <a-breadcrumb-item v-if="currentProject">
            {{ currentProject.name }}
          </a-breadcrumb-item>
          <a-breadcrumb-item v-if="currentFile">
            {{ currentFile.file_name }}
          </a-breadcrumb-item>
        </a-breadcrumb>
      </div>

      <!-- 右侧：操作按钮 -->
      <div class="toolbar-right">
        <!-- Git操作下拉菜单 -->
        <a-dropdown v-if="currentProject">
          <a-button>
            <GitlabOutlined />
            Git操作
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleGitAction">
              <a-menu-item key="status">
                <InfoCircleOutlined />
                查看状态
              </a-menu-item>
              <a-menu-item key="commit">
                <CheckOutlined />
                提交更改
              </a-menu-item>
              <a-menu-item key="push">
                <CloudUploadOutlined />
                推送到远程
              </a-menu-item>
              <a-menu-item key="pull">
                <CloudDownloadOutlined />
                拉取最新
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>

        <!-- 保存按钮 -->
        <a-button
          type="primary"
          :disabled="!hasUnsavedChanges"
          :loading="saving"
          @click="handleSave"
        >
          <SaveOutlined />
          保存
        </a-button>

        <!-- 关闭按钮 -->
        <a-button @click="handleBackToList">
          <CloseOutlined />
          关闭
        </a-button>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" tip="加载项目中..." />
    </div>

    <!-- 主内容区 -->
    <div v-else-if="currentProject" class="content-container">
      <!-- 左侧：文件树 -->
      <div class="sidebar">
        <div class="sidebar-header">
          <h3>
            <FolderOutlined />
            项目文件
          </h3>
          <a-button size="small" type="text" @click="handleRefreshFiles">
            <ReloadOutlined :spin="refreshing" />
          </a-button>
        </div>

        <div class="sidebar-content">
          <FileTree
            :files="projectFiles"
            :current-file-id="currentFile?.id"
            :loading="refreshing"
            @select="handleSelectFile"
          />
        </div>
      </div>

      <!-- 右侧：文件编辑器 -->
      <div class="main-content">
        <FileEditor
          v-if="currentFile"
          :file="currentFile"
          :project-id="projectId"
          @change="handleFileChange"
          @save="handleSave"
        />

        <!-- 空状态 -->
        <div v-else class="empty-editor">
          <div class="empty-icon">
            <FileTextOutlined />
          </div>
          <h3>选择一个文件开始编辑</h3>
          <p>从左侧文件树中选择一个文件，或创建新文件</p>
        </div>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else class="error-container">
      <div class="error-icon">
        <ExclamationCircleOutlined />
      </div>
      <h3>项目不存在或已删除</h3>
      <a-button type="primary" @click="handleBackToList">
        返回项目列表
      </a-button>
    </div>

    <!-- Git状态Modal -->
    <a-modal
      v-model:open="showGitStatusModal"
      title="Git状态"
      :footer="null"
      width="600px"
    >
      <div v-if="gitStatus" class="git-status-content">
        <div v-if="gitStatus.modified && gitStatus.modified.length > 0" class="status-section">
          <h4><EditOutlined /> 已修改 ({{ gitStatus.modified.length }})</h4>
          <div class="file-list">
            <div v-for="file in gitStatus.modified" :key="file" class="file-item">
              {{ file }}
            </div>
          </div>
        </div>

        <div v-if="gitStatus.untracked && gitStatus.untracked.length > 0" class="status-section">
          <h4><FileAddOutlined /> 未跟踪 ({{ gitStatus.untracked.length }})</h4>
          <div class="file-list">
            <div v-for="file in gitStatus.untracked" :key="file" class="file-item">
              {{ file }}
            </div>
          </div>
        </div>

        <div v-if="!gitStatus.modified?.length && !gitStatus.untracked?.length" class="status-section">
          <a-empty description="工作区干净，没有变更" />
        </div>
      </div>
      <div v-else class="git-status-loading">
        <a-spin tip="加载Git状态..." />
      </div>
    </a-modal>

    <!-- Git提交Modal -->
    <a-modal
      v-model:open="showGitCommitModal"
      title="提交更改"
      :confirm-loading="committing"
      @ok="handleConfirmCommit"
    >
      <a-form layout="vertical">
        <a-form-item label="提交信息" required>
          <a-textarea
            v-model:value="commitMessage"
            placeholder="输入提交信息..."
            :rows="4"
            :maxlength="500"
            show-count
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useProjectStore } from '@/stores/project';
import {
  FolderOpenOutlined,
  FolderOutlined,
  FileTextOutlined,
  GitlabOutlined,
  DownOutlined,
  InfoCircleOutlined,
  CheckOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  SaveOutlined,
  CloseOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  FileAddOutlined,
} from '@ant-design/icons-vue';
import FileTree from '@/components/projects/FileTree.vue';
import FileEditor from '@/components/projects/FileEditor.vue';

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();

// 响应式状态
const loading = ref(true);
const saving = ref(false);
const refreshing = ref(false);
const committing = ref(false);
const hasUnsavedChanges = ref(false);
const showGitStatusModal = ref(false);
const showGitCommitModal = ref(false);
const commitMessage = ref('');
const gitStatus = ref(null);

// 计算属性
const projectId = computed(() => route.params.id);
const currentProject = computed(() => projectStore.currentProject);
const projectFiles = computed(() => projectStore.projectFiles);
const currentFile = computed(() => projectStore.currentFile);

// 返回项目列表
const handleBackToList = () => {
  if (hasUnsavedChanges.value) {
    Modal.confirm({
      title: '有未保存的更改',
      content: '确定要离开吗？未保存的更改将会丢失。',
      okText: '离开',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        router.push('/projects');
      },
    });
  } else {
    router.push('/projects');
  }
};

// 刷新文件列表
const handleRefreshFiles = async () => {
  refreshing.value = true;
  try {
    await projectStore.loadProjectFiles(projectId.value);
    message.success('文件列表已刷新');
  } catch (error) {
    console.error('Refresh files failed:', error);
    message.error('刷新失败：' + error.message);
  } finally {
    refreshing.value = false;
  }
};

// 选择文件
const handleSelectFile = async (fileId) => {
  if (hasUnsavedChanges.value) {
    Modal.confirm({
      title: '有未保存的更改',
      content: '确定要切换文件吗？未保存的更改将会丢失。',
      okText: '切换',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        selectFile(fileId);
      },
    });
  } else {
    selectFile(fileId);
  }
};

const selectFile = (fileId) => {
  const file = projectFiles.value.find(f => f.id === fileId);
  if (file) {
    projectStore.currentFile = file;
    hasUnsavedChanges.value = false;
  }
};

// 文件内容变化
const handleFileChange = (content) => {
  hasUnsavedChanges.value = true;
};

// 保存文件
const handleSave = async () => {
  if (!currentFile.value) return;

  saving.value = true;
  try {
    await projectStore.updateFile(currentFile.value.id, currentFile.value.content);
    hasUnsavedChanges.value = false;
    message.success('文件已保存');
  } catch (error) {
    console.error('Save file failed:', error);
    message.error('保存失败：' + error.message);
  } finally {
    saving.value = false;
  }
};

// Git操作
const handleGitAction = async ({ key }) => {
  switch (key) {
    case 'status':
      await showGitStatus();
      break;
    case 'commit':
      showGitCommitModal.value = true;
      break;
    case 'push':
      await handleGitPush();
      break;
    case 'pull':
      await handleGitPull();
      break;
  }
};

// 查看Git状态
const showGitStatus = async () => {
  showGitStatusModal.value = true;
  gitStatus.value = null;

  try {
    const repoPath = currentProject.value.root_path;
    if (!repoPath) {
      message.warning('项目未配置Git仓库路径');
      return;
    }

    const status = await projectStore.gitStatus(repoPath);
    gitStatus.value = status;
  } catch (error) {
    console.error('Get git status failed:', error);
    message.error('获取Git状态失败：' + error.message);
  }
};

// 确认提交
const handleConfirmCommit = async () => {
  if (!commitMessage.value.trim()) {
    message.warning('请输入提交信息');
    return;
  }

  committing.value = true;
  try {
    const repoPath = currentProject.value.root_path;
    await projectStore.gitCommit(projectId.value, commitMessage.value);

    message.success('提交成功');
    showGitCommitModal.value = false;
    commitMessage.value = '';
  } catch (error) {
    console.error('Git commit failed:', error);
    message.error('提交失败：' + error.message);
  } finally {
    committing.value = false;
  }
};

// Git推送
const handleGitPush = async () => {
  try {
    const repoPath = currentProject.value.root_path;
    await projectStore.gitPush(repoPath);
    message.success('推送成功');
  } catch (error) {
    console.error('Git push failed:', error);
    message.error('推送失败：' + error.message);
  }
};

// Git拉取
const handleGitPull = async () => {
  try {
    const repoPath = currentProject.value.root_path;
    await projectStore.gitPull(repoPath);
    message.success('拉取成功');
    await handleRefreshFiles();
  } catch (error) {
    console.error('Git pull failed:', error);
    message.error('拉取失败：' + error.message);
  }
};

// 组件挂载时加载项目
onMounted(async () => {
  loading.value = true;

  try {
    // 加载项目详情
    await projectStore.fetchProjectById(projectId.value);

    if (!currentProject.value) {
      loading.value = false;
      return;
    }

    // 加载项目文件
    await projectStore.loadProjectFiles(projectId.value);
  } catch (error) {
    console.error('Load project failed:', error);
    message.error('加载项目失败：' + error.message);
  } finally {
    loading.value = false;
  }
});

// 监听路由变化
watch(() => route.params.id, async (newId) => {
  if (newId && newId !== projectId.value) {
    loading.value = true;
    await projectStore.fetchProjectById(newId);
    await projectStore.loadProjectFiles(newId);
    loading.value = false;
  }
});
</script>

<style scoped>
.project-detail-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

/* 工具栏 */
.toolbar {
  background: white;
  padding: 12px 24px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.toolbar-left {
  flex: 1;
}

.toolbar-left :deep(.ant-breadcrumb) {
  font-size: 14px;
}

.toolbar-left :deep(.ant-breadcrumb a) {
  color: #667eea;
  transition: all 0.3s;
}

.toolbar-left :deep(.ant-breadcrumb a:hover) {
  color: #764ba2;
}

.toolbar-right {
  display: flex;
  gap: 12px;
}

/* 加载状态 */
.loading-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
}

/* 主内容区 */
.content-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 侧边栏 */
.sidebar {
  width: 280px;
  background: white;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

/* 主编辑区 */
.main-content {
  flex: 1;
  background: white;
  overflow: hidden;
}

/* 空编辑器状态 */
.empty-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
}

.empty-icon {
  font-size: 80px;
  color: #d1d5db;
  margin-bottom: 24px;
}

.empty-editor h3 {
  font-size: 20px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 8px 0;
}

.empty-editor p {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}

/* 错误状态 */
.error-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: white;
}

.error-icon {
  font-size: 80px;
  color: #ef4444;
  margin-bottom: 24px;
}

.error-container h3 {
  font-size: 20px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 24px 0;
}

/* Git状态Modal */
.git-status-content {
  max-height: 400px;
  overflow-y: auto;
}

.status-section {
  margin-bottom: 24px;
}

.status-section:last-child {
  margin-bottom: 0;
}

.status-section h4 {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 12px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-list {
  background: #f9fafb;
  border-radius: 6px;
  padding: 12px;
}

.file-item {
  padding: 6px 8px;
  font-size: 13px;
  color: #6b7280;
  font-family: 'Courier New', monospace;
}

.git-status-loading {
  padding: 40px;
  text-align: center;
}
</style>
