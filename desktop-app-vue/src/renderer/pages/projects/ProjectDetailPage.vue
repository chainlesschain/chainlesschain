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

      <!-- 中间：视图模式切换 -->
      <div v-if="currentFile && hasValidPath" class="toolbar-center">
        <a-radio-group v-model:value="viewMode" button-style="solid" size="small">
          <a-radio-button value="auto">
            <EyeOutlined />
            自动
          </a-radio-button>
          <a-radio-button value="edit" :disabled="!fileTypeInfo?.isEditable">
            <EditOutlined />
            编辑
          </a-radio-button>
          <a-radio-button value="preview">
            <FileSearchOutlined />
            预览
          </a-radio-button>
        </a-radio-group>
      </div>

      <!-- 右侧：操作按钮 -->
      <div class="toolbar-right">
        <!-- AI助手开关 -->
        <a-button v-if="hasValidPath" @click="toggleChatPanel">
          <CommentOutlined />
          {{ showChatPanel ? '隐藏' : '显示' }} AI助手
        </a-button>

        <!-- Git操作下拉菜单 - 仅当有有效路径时显示 -->
        <a-dropdown v-if="currentProject && hasValidPath">
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
              <a-menu-item key="history">
                <HistoryOutlined />
                提交历史
              </a-menu-item>
              <a-menu-divider />
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

    <!-- 项目不存在 -->
    <div v-else-if="!currentProject" class="error-container">
      <div class="error-icon">
        <ExclamationCircleOutlined />
      </div>
      <h3>项目不存在</h3>
      <p>找不到ID为 {{ projectId }} 的项目</p>
      <a-button type="primary" @click="handleBackToList">
        <FolderOpenOutlined />
        返回项目列表
      </a-button>
    </div>

    <!-- 主内容区 -->
    <div v-else-if="currentProject" class="content-container">
      <!-- 有本地路径：显示三栏布局（文件树 | 编辑器/预览 | AI助手） -->
      <template v-if="hasValidPath">
        <!-- 左侧：文件树 -->
        <div class="left-sidebar">
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

        <!-- 中间：编辑器/预览面板 -->
        <div class="main-content">
          <!-- 编辑模式 -->
          <SimpleEditor
            v-if="shouldShowEditor"
            ref="editorRef"
            :file="currentFile"
            :content="fileContent"
            :auto-save="true"
            @change="handleContentChange"
            @save="handleFileSave"
          />

          <!-- 预览模式 -->
          <PreviewPanel
            v-else-if="shouldShowPreview"
            :file="currentFile"
            :project-path="resolvedProjectPath"
            :content="fileContent"
          />

          <!-- 空状态 -->
          <div v-else class="empty-editor">
            <div class="empty-icon">
              <FileTextOutlined />
            </div>
            <h3>选择一个文件开始编辑</h3>
            <p>从左侧文件树中选择一个文件</p>
          </div>
        </div>

        <!-- 右侧：AI助手面板 -->
        <div v-show="showChatPanel" class="right-sidebar">
          <ChatPanel
            :project-id="projectId"
            :current-file="currentFile"
            :project-files="projectFiles"
            @close="showChatPanel = false"
          />
        </div>
      </template>

      <!-- 无本地路径：显示项目信息 -->
      <div v-else class="project-info-container">
        <div class="project-info-card">
          <div class="info-header">
            <h2>{{ currentProject.name }}</h2>
            <a-tag :color="getProjectTypeColor(currentProject.project_type)">
              {{ getProjectTypeText(currentProject.project_type) }}
            </a-tag>
          </div>

          <div class="info-content">
            <div class="info-section">
              <h3>项目描述</h3>
              <p>{{ currentProject.description || '暂无描述' }}</p>
            </div>

            <div class="info-section">
              <h3>项目信息</h3>
              <a-descriptions :column="2" bordered>
                <a-descriptions-item label="项目状态">
                  <a-tag :color="getStatusColor(currentProject.status)">
                    {{ getStatusText(currentProject.status) }}
                  </a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="创建时间">
                  {{ formatDate(currentProject.created_at) }}
                </a-descriptions-item>
                <a-descriptions-item label="最后更新">
                  {{ formatDate(currentProject.updated_at) }}
                </a-descriptions-item>
                <a-descriptions-item label="文件数量">
                  {{ currentProject.file_count || 0 }} 个文件
                </a-descriptions-item>
              </a-descriptions>
            </div>

            <!-- 桌面版提示：项目文件位置 -->
            <div class="info-alert" v-if="currentProject.root_path && resolvedProjectPath">
              <a-alert
                message="项目文件位置"
                :description="`项目文件存储在本地：${resolvedProjectPath}`"
                type="success"
                show-icon
              />
            </div>
          </div>
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

    <!-- Git状态对话框 -->
    <GitStatusDialog
      :visible="showGitStatusModal"
      :project-id="projectId"
      :repo-path="currentProject?.root_path || ''"
      @close="showGitStatusModal = false"
      @commit="handleShowCommitDialog"
      @refresh="handleRefreshFiles"
    />

    <!-- Git历史对话框 -->
    <GitHistoryDialog
      :visible="showGitHistoryModal"
      :project-id="projectId"
      :repo-path="currentProject?.root_path || ''"
      @close="showGitHistoryModal = false"
      @refresh="handleRefreshFiles"
    />

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
  HistoryOutlined,
  EyeOutlined,
  FileSearchOutlined,
  CommentOutlined,
} from '@ant-design/icons-vue';
import FileTree from '@/components/projects/FileTree.vue';
import SimpleEditor from '@/components/projects/SimpleEditor.vue';
import PreviewPanel from '@/components/projects/PreviewPanel.vue';
import ChatPanel from '@/components/projects/ChatPanel.vue';
import GitStatusDialog from '@/components/projects/GitStatusDialog.vue';
import GitHistoryDialog from '@/components/projects/GitHistoryDialog.vue';

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
const showGitHistoryModal = ref(false);
const showGitCommitModal = ref(false);
const commitMessage = ref('');
const resolvedProjectPath = ref('');

// 新增状态
const viewMode = ref('auto'); // 'auto' | 'edit' | 'preview'
const showChatPanel = ref(true); // 默认显示AI助手
const fileContent = ref(''); // 文件内容
const editorRef = ref(null);

// 计算属性
const projectId = computed(() => route.params.id);
const currentProject = computed(() => projectStore.currentProject);
const projectFiles = computed(() => projectStore.projectFiles);
const currentFile = computed(() => projectStore.currentFile);

// 检查项目是否有有效的本地路径
const hasValidPath = computed(() => {
  if (!currentProject.value || !currentProject.value.root_path) {
    return false;
  }
  const path = currentProject.value.root_path;
  // 桌面版：所有项目都视为本地项目（包括 /data/projects/ 路径）
  // 检查是否是有效路径（Windows路径、Unix路径或相对路径）
  return path && (
    /^[a-zA-Z]:[/\\]/.test(path) || // Windows路径
    path.startsWith('/') // Unix路径（包括 /data/projects/）
  );
});

// 文件类型信息
const fileTypeInfo = computed(() => {
  if (!currentFile.value?.file_name) return null;

  const fileName = currentFile.value.file_name;
  const ext = fileName.split('.').pop().toLowerCase();

  // 可编辑文本文件
  const editableExtensions = ['js', 'ts', 'vue', 'jsx', 'tsx', 'html', 'css', 'scss', 'less', 'json', 'md', 'txt', 'xml', 'yml', 'yaml'];
  // 图片文件
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  // 文档文件
  const documentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
  // 数据文件
  const dataExtensions = ['csv'];
  // 视频文件
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
  // 音频文件
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

  return {
    extension: ext,
    isEditable: editableExtensions.includes(ext),
    isImage: imageExtensions.includes(ext),
    isDocument: documentExtensions.includes(ext),
    isData: dataExtensions.includes(ext),
    isVideo: videoExtensions.includes(ext),
    isAudio: audioExtensions.includes(ext),
    isCode: ['js', 'ts', 'vue', 'jsx', 'tsx'].includes(ext),
    isMarkdown: ext === 'md',
  };
});

// 是否显示编辑器
const shouldShowEditor = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'edit') return fileTypeInfo.value?.isEditable;
  if (viewMode.value === 'preview') return false;
  if (viewMode.value === 'auto') return fileTypeInfo.value?.isEditable;
  return false;
});

// 是否显示预览
const shouldShowPreview = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return true;
  if (viewMode.value === 'auto') return !fileTypeInfo.value?.isEditable;
  return false;
});

// 获取本地项目路径（将相对路径转换为绝对路径显示）
const getLocalProjectPath = async (path) => {
  if (!path) return '未知路径';

  try {
    // 调用后端 API 解析路径
    const resolvedPath = await window.electronAPI.project.resolvePath(path);
    return resolvedPath;
  } catch (error) {
    console.error('解析项目路径失败:', error);
    // 降级：如果 API 调用失败，返回原路径
    return path;
  }
};

// 切换AI助手面板
const toggleChatPanel = () => {
  showChatPanel.value = !showChatPanel.value;
};

// 加载文件内容
const loadFileContent = async (file) => {
  if (!file || !file.file_path) {
    fileContent.value = '';
    return;
  }

  try {
    // 只为可编辑和可预览的文件加载内容
    if (fileTypeInfo.value && (fileTypeInfo.value.isEditable || fileTypeInfo.value.isMarkdown || fileTypeInfo.value.isData)) {
      const content = await window.electronAPI.file.readContent(file.file_path);
      fileContent.value = content || '';
    } else {
      fileContent.value = '';
    }
  } catch (error) {
    console.error('加载文件内容失败:', error);
    message.error('加载文件失败: ' + error.message);
    fileContent.value = '';
  }
};

// 处理编辑器内容变化
const handleContentChange = (newContent) => {
  fileContent.value = newContent;
  hasUnsavedChanges.value = true;
};

// 处理文件保存（从编辑器触发）
const handleFileSave = async (content) => {
  if (!currentFile.value) return;

  saving.value = true;
  try {
    // 保存文件内容到磁盘
    await window.electronAPI.file.writeContent(currentFile.value.file_path, content || fileContent.value);

    // 更新store
    currentFile.value.content = content || fileContent.value;
    hasUnsavedChanges.value = false;

    message.success('文件已保存');
  } catch (error) {
    console.error('保存文件失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

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
    case 'history':
      showGitHistoryModal.value = true;
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
};

// 显示提交对话框（从GitStatusDialog触发）
const handleShowCommitDialog = () => {
  showGitStatusModal.value = false;
  showGitCommitModal.value = true;
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

    // 解析项目路径
    if (currentProject.value?.root_path) {
      resolvedProjectPath.value = await getLocalProjectPath(currentProject.value.root_path);
    }
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

// 监听当前文件变化，加载文件内容
watch(() => currentFile.value, async (newFile) => {
  if (newFile) {
    await loadFileContent(newFile);
  } else {
    fileContent.value = '';
  }
}, { immediate: false });

// 辅助函数
const getProjectTypeColor = (type) => {
  const colors = {
    web: 'blue',
    document: 'green',
    data: 'purple',
    app: 'orange'
  };
  return colors[type] || 'default';
};

const getProjectTypeText = (type) => {
  const texts = {
    web: 'Web应用',
    document: '文档项目',
    data: '数据分析',
    app: '应用程序'
  };
  return texts[type] || type;
};

const getStatusColor = (status) => {
  const colors = {
    draft: 'default',
    active: 'success',
    completed: 'blue',
    archived: 'warning'
  };
  return colors[status] || 'default';
};

const getStatusText = (status) => {
  const texts = {
    draft: '草稿',
    active: '进行中',
    completed: '已完成',
    archived: '已归档'
  };
  return texts[status] || status;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};
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
  gap: 16px;
}

.toolbar-left {
  flex: 0 0 auto;
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

.toolbar-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.toolbar-right {
  flex: 0 0 auto;
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

/* 左侧边栏 - 文件树 */
.left-sidebar {
  width: 200px;
  background: white;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
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

/* 主编辑区 - 编辑器/预览 */
.main-content {
  flex: 1;
  background: white;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 右侧边栏 - AI助手 */
.right-sidebar {
  width: 300px;
  background: white;
  border-left: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
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

/* 项目信息容器样式 */
.project-info-container {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  background: #f5f5f5;
}

.project-info-card {
  max-width: 900px;
  margin: 0 auto;
  background: white;
  border-radius: 8px;
  padding: 32px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.info-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e8e8e8;
}

.info-header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.info-section h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #333;
}

.info-section p {
  color: #666;
  line-height: 1.6;
  margin: 0;
}

.info-alert {
  margin-top: 16px;
}
