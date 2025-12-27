<template>
  <div class="project-detail-page-wrapper">
    <!-- 项目历史侧边栏 -->
    <ProjectSidebar />

    <!-- 主内容区 -->
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
        <!-- 文件导出菜单 -->
        <FileExportMenu
          v-if="currentFile && hasValidPath"
          :file="currentFile"
          :project-id="projectId"
          @export-start="handleExportStart"
          @export-complete="handleExportComplete"
          @export-error="handleExportError"
        />

        <!-- 文件管理按钮 -->
        <a-button v-if="hasValidPath" @click="showFileManageModal = true">
          <FolderOpenOutlined />
          文件管理
        </a-button>

        <!-- 分享按钮 -->
        <a-button v-if="currentProject" @click="showShareModal = true">
          <ShareAltOutlined />
          分享
        </a-button>

        <!-- 编辑器面板开关 -->
        <a-button v-if="hasValidPath" @click="toggleEditorPanel">
          <CodeOutlined />
          {{ showEditorPanel ? '隐藏' : '显示' }} 编辑器
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
      <!-- 有本地路径：显示四栏布局（文件树 | 对话历史+输入 | 编辑器/预览） -->
      <template v-if="hasValidPath">
        <!-- 左侧：文件树管理器 -->
        <div class="file-explorer-panel" :style="{ width: fileExplorerWidth + 'px' }">
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
            <EnhancedFileTree
              :files="projectFiles"
              :current-file-id="currentFile?.id"
              :loading="refreshing"
              :git-status="gitStatus"
              :project-id="currentProject?.id"
              :enable-drag="true"
              @select="handleSelectFile"
              @refresh="handleRefreshFiles"
            />
          </div>
        </div>

        <!-- 拖拽手柄：文件树 <-> 对话面板 -->
        <ResizeHandle
          direction="vertical"
          :min-size="minPanelWidth"
          :max-size="maxFileExplorerWidth"
          @resize="handleFileExplorerResize"
        />

        <!-- 中间：对话历史和输入区域 -->
        <div class="conversation-panel">
          <ChatPanel
            :project-id="projectId"
            :current-file="currentFile"
            @close="showChatPanel = false"
          />
        </div>

        <!-- 拖拽手柄：对话面板 <-> 编辑器面板 -->
        <ResizeHandle
          v-if="showEditorPanel"
          direction="vertical"
          :min-size="minPanelWidth"
          :max-size="maxEditorPanelWidth"
          @resize="handleEditorPanelResize"
        />

        <!-- 右侧：编辑器/预览面板 -->
        <div v-show="showEditorPanel" class="editor-preview-panel" :style="{ width: editorPanelWidth + 'px' }">
          <!-- 编辑器头部 -->
          <EditorPanelHeader
            v-if="currentFile"
            :file="currentFile"
            :has-unsaved-changes="hasUnsavedChanges"
            :is-saving="saving"
            :view-mode="viewMode"
            :can-edit="fileTypeInfo?.isEditable || false"
            @save="handleSave"
            @close="toggleEditorPanel"
            @view-mode-change="handleViewModeChange"
            @export="handleExport"
          >
            <template #export-menu>
              <FileExportMenu
                v-if="currentFile && hasValidPath"
                :file="currentFile"
                :project-id="projectId"
                @export-start="handleExportStart"
                @export-complete="handleExportComplete"
                @export-error="handleExportError"
              />
            </template>
          </EditorPanelHeader>

          <!-- Excel编辑器 -->
          <ExcelEditor
            v-if="shouldShowExcelEditor"
            ref="excelEditorRef"
            :file="currentFile"
            :auto-save="true"
            @change="handleExcelChange"
            @save="handleExcelSave"
          />

          <!-- Word/富文本编辑器 -->
          <RichTextEditor
            v-else-if="shouldShowWordEditor"
            ref="wordEditorRef"
            :file="currentFile"
            :initial-content="fileContent"
            :auto-save="true"
            @change="handleWordChange"
            @save="handleWordSave"
          />

          <!-- 代码编辑器 -->
          <CodeEditor
            v-else-if="shouldShowCodeEditor"
            ref="codeEditorRef"
            :file="currentFile"
            :initial-content="fileContent"
            :auto-save="true"
            @change="handleCodeChange"
            @save="handleCodeSave"
          />

          <!-- Markdown编辑器 -->
          <MarkdownEditor
            v-else-if="shouldShowMarkdownEditor"
            ref="markdownEditorRef"
            :file="currentFile"
            :initial-content="fileContent"
            :auto-save="true"
            @change="handleMarkdownChange"
            @save="handleMarkdownSave"
          />

          <!-- Web开发编辑器 -->
          <WebDevEditor
            v-else-if="shouldShowWebEditor"
            ref="webEditorRef"
            @save="handleWebSave"
          />

          <!-- PPT编辑器 -->
          <PPTEditor
            v-else-if="shouldShowPPTEditor"
            ref="pptEditorRef"
            :file="currentFile"
            :auto-save="true"
            @change="handlePPTChange"
            @save="handlePPTSave"
          />

          <!-- 文本编辑模式 -->
          <SimpleEditor
            v-else-if="shouldShowEditor"
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
            :project-id="projectId"
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
                  {{ projectFiles.length || 0 }} 个文件
                </a-descriptions-item>
              </a-descriptions>
            </div>

            <!-- 项目统计面板 -->
            <ProjectStatsPanel v-if="currentProject && resolvedProjectPath" :project-id="currentProject.id" />

            <!-- 桌面版提示：项目文件位置 -->
            <div class="info-alert" v-if="currentProject.root_path && resolvedProjectPath">
              <a-alert
                message="项目文件位置"
                :description="`项目文件存储在本地：${resolvedProjectPath}`"
                type="success"
                show-icon
              />
            </div>

            <!-- 文件管理器区域 -->
            <div class="info-section file-manager-section">
              <div class="section-header">
                <h3>
                  <FolderOpenOutlined />
                  项目文件
                </h3>
                <div class="section-actions">
                  <a-button size="small" @click="handleRefreshFiles">
                    <ReloadOutlined :spin="refreshing" />
                    刷新
                  </a-button>
                  <a-button size="small" type="primary" @click="showFileManageModal = true">
                    <FolderOpenOutlined />
                    文件管理
                  </a-button>
                </div>
              </div>

              <!-- 文件树和列表视图切换 -->
              <div class="file-view-container">
                <a-tabs v-model:activeKey="fileViewMode">
                  <a-tab-pane key="tree" tab="树形视图">
                    <div class="file-tree-wrapper">
                      <EnhancedFileTree
                        :files="projectFiles"
                        :current-file-id="currentFile?.id"
                        :loading="refreshing"
                        :git-status="gitStatus"
                        :project-id="currentProject?.id"
                        :enable-drag="true"
                        @select="handleSelectFileFromInfo"
                        @refresh="handleRefreshFiles"
                      />
                    </div>
                  </a-tab-pane>
                  <a-tab-pane key="list" tab="列表视图">
                    <ProjectFileList
                      :files="projectFiles"
                      :loading="refreshing"
                      @file-click="handleSelectFileFromInfo"
                      @file-preview="handleFilePreviewFromInfo"
                      @file-download="handleFileDownloadFromInfo"
                      @file-delete="handleFileDeleteFromModal"
                    />
                  </a-tab-pane>
                </a-tabs>
              </div>
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

    <!-- 文件管理Modal -->
    <FileManageModal
      :visible="showFileManageModal"
      :files="projectFiles"
      :project-id="projectId"
      :loading="refreshing"
      @close="showFileManageModal = false"
      @file-click="handleFileClickFromModal"
      @file-preview="handleFilePreviewFromModal"
      @file-download="handleFileDownloadFromModal"
      @file-delete="handleFileDeleteFromModal"
    />

    <!-- 分享项目对话框 -->
    <ProjectShareDialog
      v-model:open="showShareModal"
      :project="currentProject"
      @share-success="handleShareSuccess"
    />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
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
  ShareAltOutlined,
  CodeOutlined,
} from '@ant-design/icons-vue';
import EnhancedFileTree from '@/components/projects/EnhancedFileTree.vue';
import SimpleEditor from '@/components/projects/SimpleEditor.vue';
import ExcelEditor from '@/components/editors/ExcelEditor.vue';
import RichTextEditor from '@/components/editors/RichTextEditor.vue';
import CodeEditor from '@/components/editors/CodeEditor.vue';
import MarkdownEditor from '@/components/editors/MarkdownEditor.vue';
import WebDevEditor from '@/components/editors/WebDevEditor.vue';
import PPTEditor from '@/components/editors/PPTEditor.vue';
import PreviewPanel from '@/components/projects/PreviewPanel.vue';
import ChatPanel from '@/components/projects/ChatPanel.vue';
import GitStatusDialog from '@/components/projects/GitStatusDialog.vue';
import FileManageModal from '@/components/projects/FileManageModal.vue';
import ProjectShareDialog from '@/components/projects/ProjectShareDialog.vue';
import FileExportMenu from '@/components/projects/FileExportMenu.vue';
import GitHistoryDialog from '@/components/projects/GitHistoryDialog.vue';
import ProjectStatsPanel from '@/components/projects/ProjectStatsPanel.vue';
import ProjectFileList from '@/components/projects/ProjectFileList.vue';
import ProjectSidebar from '@/components/ProjectSidebar.vue';
import EditorPanelHeader from '@/components/projects/EditorPanelHeader.vue';
import ResizeHandle from '@/components/projects/ResizeHandle.vue';

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
const showChatPanel = ref(true); // 对话面板始终显示在中间
const showEditorPanel = ref(true); // 默认显示编辑器面板（右侧）
const fileContent = ref(''); // 文件内容
const fileViewMode = ref('tree'); // 'tree' | 'list' 文件视图模式

// 面板宽度状态
const fileExplorerWidth = ref(280); // 文件树宽度
const editorPanelWidth = ref(600); // 编辑器面板宽度
const minPanelWidth = 200; // 最小宽度
const maxFileExplorerWidth = 500; // 文件树最大宽度
const maxEditorPanelWidth = 1000; // 编辑器最大宽度
const editorRef = ref(null);
const excelEditorRef = ref(null); // Excel编辑器引用
const wordEditorRef = ref(null); // Word编辑器引用
const codeEditorRef = ref(null); // 代码编辑器引用
const markdownEditorRef = ref(null); // Markdown编辑器引用
const webEditorRef = ref(null); // Web开发编辑器引用
const pptEditorRef = ref(null); // PPT编辑器引用
const gitStatus = ref({}); // Git 状态
let gitStatusInterval = null; // Git 状态轮询定时器
const showFileManageModal = ref(false); // 文件管理Modal
const showShareModal = ref(false); // 分享Modal

// 计算属性
const projectId = computed(() => route.params.id);
const currentProject = computed(() => projectStore.currentProject);
const projectFiles = computed(() => projectStore.projectFiles);
const currentFile = computed(() => projectStore.currentFile);

// 检查项目是否有有效的本地路径
const hasValidPath = computed(() => {
  if (!currentProject.value) {
    return false;
  }

  // 如果有文件，即使没有 root_path 也显示文件树
  if (projectFiles.value && projectFiles.value.length > 0) {
    console.log('[ProjectDetail] 有文件，显示文件树，文件数量:', projectFiles.value.length);
    return true;
  }

  // 检查是否有有效的 root_path
  if (!currentProject.value.root_path) {
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
  // Excel文件
  const excelExtensions = ['xlsx', 'xls', 'csv'];
  // Word文件
  const wordExtensions = ['docx', 'doc'];
  // PPT文件
  const pptExtensions = ['pptx', 'ppt'];
  // 图片文件
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  // PDF文件
  const pdfExtensions = ['pdf'];
  // 视频文件
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
  // 音频文件
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

  return {
    extension: ext,
    isEditable: editableExtensions.includes(ext),
    isExcel: excelExtensions.includes(ext),
    isWord: wordExtensions.includes(ext),
    isPPT: pptExtensions.includes(ext),
    isPDF: pdfExtensions.includes(ext),
    isImage: imageExtensions.includes(ext),
    isVideo: videoExtensions.includes(ext),
    isAudio: audioExtensions.includes(ext),
    isCode: ['js', 'ts', 'vue', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c'].includes(ext),
    isMarkdown: ext === 'md',
  };
});

// 是否显示Excel编辑器
const shouldShowExcelEditor = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return false;
  return fileTypeInfo.value?.isExcel;
});

// 是否显示Word编辑器
const shouldShowWordEditor = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return false;
  return fileTypeInfo.value?.isWord;
});

// 是否显示代码编辑器
const shouldShowCodeEditor = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return false;
  return fileTypeInfo.value?.isCode;
});

// 是否显示Markdown编辑器
const shouldShowMarkdownEditor = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return false;
  return fileTypeInfo.value?.isMarkdown;
});

// 是否显示Web开发编辑器
const shouldShowWebEditor = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return false;
  // 当打开HTML文件且项目包含CSS/JS时使用Web开发编辑器
  const ext = currentFile.value.file_name?.split('.').pop()?.toLowerCase();
  return ext === 'html';
});

// 是否显示PPT编辑器
const shouldShowPPTEditor = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return false;
  return fileTypeInfo.value?.isPPT;
});

// 是否显示文本编辑器
const shouldShowEditor = computed(() => {
  if (!currentFile.value) return false;
  // 专用编辑器的文件不使用文本编辑器
  if (fileTypeInfo.value?.isExcel ||
      fileTypeInfo.value?.isWord ||
      fileTypeInfo.value?.isCode ||
      fileTypeInfo.value?.isMarkdown ||
      fileTypeInfo.value?.isPPT) {
    return false;
  }
  if (viewMode.value === 'edit') return fileTypeInfo.value?.isEditable;
  if (viewMode.value === 'preview') return false;
  if (viewMode.value === 'auto') return fileTypeInfo.value?.isEditable;
  return false;
});

// 是否显示预览
const shouldShowPreview = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return true;
  if (viewMode.value === 'auto') {
    // 如果是专用编辑器文件或可编辑文件，则不显示预览
    if (fileTypeInfo.value?.isExcel ||
        fileTypeInfo.value?.isWord ||
        fileTypeInfo.value?.isPPT ||
        fileTypeInfo.value?.isEditable) {
      return false;
    }
    return true;
  }
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

const toggleEditorPanel = () => {
  showEditorPanel.value = !showEditorPanel.value;
};

// 处理文件树面板调整大小
const handleFileExplorerResize = (delta) => {
  const newWidth = fileExplorerWidth.value + delta;
  if (newWidth >= minPanelWidth && newWidth <= maxFileExplorerWidth) {
    fileExplorerWidth.value = newWidth;
  }
};

// 处理编辑器面板调整大小
const handleEditorPanelResize = (delta) => {
  const newWidth = editorPanelWidth.value - delta; // 注意：向左拖拽时delta为正，需要减小宽度
  if (newWidth >= minPanelWidth && newWidth <= maxEditorPanelWidth) {
    editorPanelWidth.value = newWidth;
  }
};

// 刷新 Git 状态
const refreshGitStatus = async () => {
  if (!currentProject.value?.root_path || !hasValidPath.value) {
    return;
  }

  try {
    const status = await window.electronAPI.project.gitStatus(currentProject.value.root_path);
    if (status) {
      gitStatus.value = status;
    }
  } catch (error) {
    console.error('[ProjectDetail] 获取 Git 状态失败:', error);
    // 不显示错误消息，因为可能项目不是 Git 仓库
  }
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
      // 构建完整的文件路径：/data/projects/{projectId}/{file_path}
      let fullPath = file.file_path;
      if (!fullPath.startsWith('/data/projects/') && !fullPath.includes(projectId.value)) {
        // 如果路径不包含项目ID，则拼接
        fullPath = `/data/projects/${projectId.value}/${file.file_path}`;
      }

      console.log('[ProjectDetail] 读取文件:', fullPath);
      const content = await window.electronAPI.file.readContent(fullPath);
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

// 处理Excel内容变化
const handleExcelChange = (changeData) => {
  hasUnsavedChanges.value = true;
  console.log('[ProjectDetail] Excel数据变化:', changeData);
};

// 处理Excel保存
const handleExcelSave = async (data) => {
  if (!currentFile.value) return;

  saving.value = true;
  try {
    console.log('[ProjectDetail] 保存Excel文件:', currentFile.value.file_path);

    hasUnsavedChanges.value = false;
    message.success('Excel文件已保存');
  } catch (error) {
    console.error('保存Excel文件失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 处理Word内容变化
const handleWordChange = (changeData) => {
  hasUnsavedChanges.value = true;
  console.log('[ProjectDetail] Word内容变化:', changeData);
};

// 处理Word保存
const handleWordSave = async (data) => {
  if (!currentFile.value) return;

  saving.value = true;
  try {
    console.log('[ProjectDetail] 保存Word文件:', currentFile.value.file_path);

    hasUnsavedChanges.value = false;
    message.success('Word文档已保存');
  } catch (error) {
    console.error('保存Word文件失败:', error);
    message.error('保存失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 处理代码变化
const handleCodeChange = (code) => {
  hasUnsavedChanges.value = true;
};

// 处理代码保存
const handleCodeSave = async (code) => {
  hasUnsavedChanges.value = false;
  message.success('代码已保存');
};

// 处理Markdown变化
const handleMarkdownChange = (content) => {
  hasUnsavedChanges.value = true;
};

// 处理Markdown保存
const handleMarkdownSave = async (content) => {
  hasUnsavedChanges.value = false;
  message.success('Markdown已保存');
};

// 处理Web保存
const handleWebSave = async (data) => {
  hasUnsavedChanges.value = false;
  message.success('Web项目已保存');
};

// 处理PPT变化
const handlePPTChange = (slides) => {
  hasUnsavedChanges.value = true;
};

// 处理PPT保存
const handlePPTSave = async (slides) => {
  hasUnsavedChanges.value = false;
  message.success('PPT已保存');
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
const handleSelectFile = async (fileData) => {
  // 兼容两种调用方式：对象 { id, file_name, file_path } 或直接传 fileId
  const fileId = typeof fileData === 'object' ? fileData.id : fileData;
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
  console.log('[ProjectDetail] 选择文件, fileId:', fileId);
  const file = projectFiles.value.find(f => f.id === fileId);
  if (file) {
    console.log('[ProjectDetail] 找到文件:', file);
    projectStore.currentFile = file;
    hasUnsavedChanges.value = false;
    // 如果编辑器面板被隐藏，则显示它
    if (!showEditorPanel.value) {
      showEditorPanel.value = true;
    }
  } else {
    console.warn('[ProjectDetail] 未找到文件, fileId:', fileId, '可用文件:', projectFiles.value);
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

// 处理视图模式变化
const handleViewModeChange = (mode) => {
  viewMode.value = mode;
  console.log('视图模式已切换为:', mode);
};

// 处理导出
const handleExport = (exportType) => {
  console.log('导出类型:', exportType);
  message.info(`导出功能开发中: ${exportType}`);
  // 这里可以根据exportType调用不同的导出方法
  // 比如调用FileExportMenu中已有的导出功能
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

// ==================== 文件管理Modal事件处理 ====================

// 从文件管理Modal点击文件
const handleFileClickFromModal = (file) => {
  showFileManageModal.value = false;
  handleSelectFile(file.id);
};

// 从文件管理Modal预览文件
const handleFilePreviewFromModal = (file) => {
  // 切换到预览模式
  viewMode.value = 'preview';
  handleSelectFile(file.id);
  showFileManageModal.value = false;
};

// 从文件管理Modal下载文件
const handleFileDownloadFromModal = async (file) => {
  try {
    // TODO: 实现文件下载功能
    // 调用Electron API下载文件到用户指定位置
    await window.electronAPI.file.saveAs(file.file_path);
    message.success('文件下载成功');
  } catch (error) {
    console.error('Download file failed:', error);
    message.error('下载失败：' + error.message);
  }
};

// 从文件管理Modal删除文件
const handleFileDeleteFromModal = async (file) => {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除文件 "${file.file_name}" 吗？此操作不可恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        // TODO: 实现文件删除功能
        await window.electronAPI.project.deleteFile(projectId.value, file.id);
        message.success('文件已删除');
        // 刷新文件列表
        await handleRefreshFiles();
      } catch (error) {
        console.error('Delete file failed:', error);
        message.error('删除失败：' + error.message);
      }
    },
  });
};

// ==================== 从项目信息面板处理文件操作 ====================

// 从项目信息面板选择文件
const handleSelectFileFromInfo = (fileId) => {
  // 如果项目有本地路径，切换到文件编辑视图
  if (hasValidPath.value) {
    handleSelectFile(fileId);
  } else {
    // 如果没有本地路径，显示预览
    const file = projectFiles.value.find(f => f.id === fileId);
    if (file) {
      projectStore.currentFile = file;
      viewMode.value = 'preview';
    }
  }
};

// 从项目信息面板预览文件
const handleFilePreviewFromInfo = (file) => {
  projectStore.currentFile = file;
  viewMode.value = 'preview';
};

// 从项目信息面板下载文件
const handleFileDownloadFromInfo = async (file) => {
  await handleFileDownloadFromModal(file);
};

// ==================== 分享Modal事件处理 ====================

// 更新分享类型
const handleUpdateShareType = async (shareType) => {
  try {
    // 更新项目的分享类型
    await projectStore.updateProject(projectId.value, {
      share_type: shareType,
    });

    message.success(shareType === 'public' ? '项目已设置为公开访问' : '项目已设置为私密访问');
  } catch (error) {
    console.error('Update share type failed:', error);
    message.error('更新分享设置失败：' + error.message);
  }
};

// 处理分享成功
const handleShareSuccess = async (shareData) => {
  try {
    // 更新本地项目数据
    if (currentProject.value) {
      await projectStore.updateProject(projectId.value, {
        share_mode: shareData.shareMode,
        share_token: shareData.shareToken,
        share_link: shareData.shareLink,
      });
    }
  } catch (error) {
    console.error('Update share data failed:', error);
  }
};

// 处理导出开始
const handleExportStart = ({ exportType, fileName }) => {
  console.log('Export started:', exportType, fileName);
};

// 处理导出完成
const handleExportComplete = async (result) => {
  console.log('Export completed:', result);
  // 可以在这里添加额外的处理，比如显示文件或打开目录
};

// 处理导出错误
const handleExportError = ({ exportType, error }) => {
  console.error('Export error:', exportType, error);
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

    // 初始化 Git 状态
    if (hasValidPath.value) {
      await refreshGitStatus();
      // 每 10 秒刷新一次 Git 状态
      gitStatusInterval = setInterval(() => {
        refreshGitStatus().catch(err => {
          console.error('[ProjectDetail] Git status interval error:', err);
        });
      }, 10000);
    }

    // 启动项目统计收集
    if (hasValidPath.value && resolvedProjectPath.value) {
      try {
        await window.electron.invoke('project:stats:start', projectId.value, resolvedProjectPath.value);
        console.log('[ProjectDetail] 项目统计收集已启动');
      } catch (error) {
        console.error('[ProjectDetail] 启动统计收集失败:', error);
      }
    }
  } catch (error) {
    console.error('Load project failed:', error);
    message.error('加载项目失败：' + error.message);
  } finally {
    loading.value = false;
  }
});

// 组件卸载时清理定时器
onUnmounted(async () => {
  if (gitStatusInterval) {
    clearInterval(gitStatusInterval);
    gitStatusInterval = null;
  }

  // 停止项目统计收集
  if (projectId.value) {
    try {
      await window.electron.invoke('project:stats:stop', projectId.value);
      console.log('[ProjectDetail] 项目统计收集已停止');
    } catch (error) {
      console.error('[ProjectDetail] 停止统计收集失败:', error);
    }
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
.project-detail-page-wrapper {
  display: flex;
  min-height: 100%;
  padding: 0;
  margin: -24px; /* 抵消 layout-content 的 padding */
  height: calc(100vh - 56px - 40px); /* 减去 header 和 tabs-bar 的高度 */
  overflow: hidden;
}

.project-detail-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  overflow: hidden;
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

/* 左侧：文件管理器面板 */
.file-explorer-panel {
  /* width由内联样式动态设置 */
  min-width: 200px;
  max-width: 500px;
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

/* 中间：对话面板 - 主要区域，弹性扩展 */
.conversation-panel {
  flex: 1;
  min-width: 400px;
  background: white;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 右侧：编辑/预览面板 - 可调整大小，可折叠 */
.editor-preview-panel {
  /* width由内联样式动态设置 */
  min-width: 200px;
  max-width: 1000px;
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

/* 文件管理器区域 */
.file-manager-section {
  background: #f9fafb;
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e5e7eb;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.section-actions {
  display: flex;
  gap: 8px;
}

.file-view-container {
  background: white;
  border-radius: 6px;
  padding: 16px;
  min-height: 300px;
  max-height: 600px;
  overflow-y: auto;
}

.file-tree-wrapper {
  min-height: 250px;
}
