<template>
  <div
    class="project-detail-page-wrapper"
    data-testid="project-detail-wrapper"
  >
    <!-- 性能监控面板（开发环境） -->
    <PerformanceMonitor v-if="isDevelopment" />

    <!-- 命令面板 -->
    <CommandPalette />

    <!-- 项目历史侧边栏 -->
    <ProjectSidebar />

    <!-- 主内容区 -->
    <div
      class="project-detail-page"
      data-testid="project-detail-page"
    >
      <!-- 顶部工具栏 - 使用FadeSlide过渡 -->
      <FadeSlide
        direction="down"
        :duration="300"
        appear
      >
        <div class="toolbar">
          <!-- 左侧：面包屑导航 -->
          <div
            class="toolbar-left"
            data-testid="toolbar-breadcrumb"
          >
            <a-breadcrumb>
              <a-breadcrumb-item>
                <a
                  data-testid="back-to-projects-link"
                  @click="handleBackToList"
                >
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
          <div
            v-if="currentFile"
            class="toolbar-center"
          >
            <a-radio-group
              v-model:value="viewMode"
              button-style="solid"
              size="small"
            >
              <a-radio-button value="auto">
                <EyeOutlined />
                自动
              </a-radio-button>
              <a-radio-button
                value="edit"
                :disabled="!fileTypeInfo?.isEditable"
              >
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
              v-if="currentFile"
              :file="currentFile"
              :project-id="projectId"
              @export-start="handleExportStart"
              @export-complete="handleExportComplete"
              @export-error="handleExportError"
            />

            <!-- 文件管理按钮 -->
            <a-button
              data-testid="file-manage-button"
              @click="showFileManageModal = true"
            >
              <FolderOpenOutlined />
              文件管理
            </a-button>

            <!-- 分享按钮 -->
            <a-button
              v-if="currentProject"
              data-testid="share-button"
              @click="showShareModal = true"
            >
              <ShareAltOutlined />
              分享
            </a-button>

            <!-- 编辑器面板开关 -->
            <a-button
              data-testid="toggle-editor-button"
              @click="toggleEditorPanel"
            >
              <CodeOutlined />
              {{ showEditorPanel ? "隐藏" : "显示" }} 编辑器
            </a-button>

            <!-- Git操作下拉菜单 -->
            <a-dropdown v-if="currentProject">
              <a-button data-testid="git-actions-button">
                <GitlabOutlined />
                Git操作
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu
                  data-testid="git-actions-menu"
                  @click="handleGitAction"
                >
                  <a-menu-item
                    key="status"
                    data-testid="git-status-item"
                  >
                    <InfoCircleOutlined />
                    查看状态
                  </a-menu-item>
                  <a-menu-item
                    key="history"
                    data-testid="git-history-item"
                  >
                    <HistoryOutlined />
                    提交历史
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item
                    key="commit"
                    data-testid="git-commit-item"
                  >
                    <CheckOutlined />
                    提交更改
                  </a-menu-item>
                  <a-menu-item
                    key="push"
                    data-testid="git-push-item"
                  >
                    <CloudUploadOutlined />
                    推送到远程
                  </a-menu-item>
                  <a-menu-item
                    key="pull"
                    data-testid="git-pull-item"
                  >
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
              data-testid="save-button"
              @click="handleSave"
            >
              <SaveOutlined />
              保存
            </a-button>

            <!-- 关闭按钮 -->
            <a-button
              data-testid="close-button"
              @click="handleBackToList"
            >
              <CloseOutlined />
              关闭
            </a-button>
          </div>
        </div>
      </FadeSlide>

      <!-- 加载状态 - 使用骨架屏优化 -->
      <div
        v-if="loading"
        class="loading-container"
        data-testid="loading-container"
      >
        <div class="skeleton-layout">
          <SkeletonLoader
            type="file-tree"
            :rows="15"
            style="width: 280px; margin-right: 16px"
          />
          <SkeletonLoader
            type="chat"
            :rows="8"
            style="flex: 1; margin-right: 16px"
          />
          <SkeletonLoader
            type="editor"
            style="width: 600px"
          />
        </div>
      </div>

      <!-- 项目不存在（排除AI创建模式） -->
      <div
        v-else-if="!currentProject && !isAICreatingMode"
        class="error-container"
        data-testid="error-container"
      >
        <div class="error-icon">
          <ExclamationCircleOutlined />
        </div>
        <h3>项目不存在</h3>
        <p>找不到ID为 {{ projectId }} 的项目</p>
        <a-button
          type="primary"
          data-testid="back-to-list-button"
          @click="handleBackToList"
        >
          <FolderOpenOutlined />
          返回项目列表
        </a-button>
      </div>

      <!-- 主内容区 -->
      <div
        v-else-if="currentProject || isAICreatingMode"
        class="content-container"
        data-testid="content-container"
      >
        <!-- 左侧：文件树管理器（AI创建模式下隐藏） -->
        <div
          v-if="!isAICreatingMode"
          class="file-explorer-panel"
          :style="{ width: fileExplorerWidth + 'px' }"
          data-testid="file-explorer-panel"
        >
          <div
            class="sidebar-header"
            data-testid="file-explorer-header"
          >
            <h3>
              <FolderOutlined />
              项目文件
            </h3>
            <a-tooltip>
              <template #title>
                <span v-if="useVirtualFileTree">使用虚拟滚动（高性能）</span>
                <span v-else>使用标准树（兼容模式）</span>
              </template>
              <a-switch
                v-model:checked="useVirtualFileTree"
                size="small"
                checked-children="虚拟"
                un-checked-children="标准"
                style="margin-left: 8px"
                data-testid="file-tree-mode-switch"
              />
            </a-tooltip>
            <a-button
              size="small"
              type="text"
              data-testid="refresh-files-button"
              @click="handleRefreshFiles"
            >
              <ReloadOutlined :spin="refreshing" />
            </a-button>
          </div>

          <div
            class="sidebar-content"
            data-testid="file-tree-container"
          >
            <!-- 动态组件：根据useVirtualFileTree切换 -->
            <component
              :is="useVirtualFileTree ? VirtualFileTree : EnhancedFileTree"
              :key="`filetree-${projectId}-${fileTreeKey}`"
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

        <!-- 拖拽手柄：文件树 <-> 对话面板（AI创建模式下隐藏） -->
        <ResizeHandle
          v-if="!isAICreatingMode"
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
            :ai-creation-data="aiCreationData"
            :auto-send-message="autoSendMessage"
            @close="showChatPanel = false"
            @creation-complete="handleAICreationComplete"
            @files-changed="handleRefreshFiles"
          />
        </div>

        <!-- 拖拽手柄：对话面板 <-> 编辑器面板（AI创建模式下隐藏） -->
        <ResizeHandle
          v-if="showEditorPanel && !isAICreatingMode"
          direction="vertical"
          :min-size="minPanelWidth"
          :max-size="maxEditorPanelWidth"
          @resize="handleEditorPanelResize"
        />

        <!-- 右侧：编辑器/预览面板（AI创建模式下隐藏） -->
        <div
          v-show="showEditorPanel && !isAICreatingMode"
          class="editor-preview-panel"
          :style="{ width: editorPanelWidth + 'px' }"
        >
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
                v-if="currentFile"
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
            :project-id="projectId"
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
          <div
            v-else
            class="empty-editor"
          >
            <div class="empty-icon">
              <FileTextOutlined />
            </div>
            <h3>选择一个文件开始编辑</h3>
            <p>从左侧文件树中选择一个文件</p>
          </div>
        </div>
      </div>

      <!-- 错误状态 -->
      <div
        v-else
        class="error-container"
      >
        <div class="error-icon">
          <ExclamationCircleOutlined />
        </div>
        <h3>项目不存在或已删除</h3>
        <a-button
          type="primary"
          @click="handleBackToList"
        >
          返回项目列表
        </a-button>
      </div>

      <!-- Git状态对话框 -->
      <GitStatusDialog
        :open="showGitStatusModal"
        :project-id="projectId"
        :repo-path="currentProject?.root_path || ''"
        @close="showGitStatusModal = false"
        @commit="handleShowCommitDialog"
        @refresh="handleRefreshFiles"
      />

      <!-- Git历史对话框 -->
      <GitHistoryDialog
        :open="showGitHistoryModal"
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
          <a-form-item
            label="提交信息"
            required
          >
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
        :open="showFileManageModal"
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
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
  defineAsyncComponent,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import { useProjectStore } from "@/stores/project";
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
} from "@ant-design/icons-vue";
import EnhancedFileTree from "@/components/projects/EnhancedFileTree.vue";
import VirtualFileTree from "@/components/projects/VirtualFileTree.vue";
import SimpleEditor from "@/components/projects/SimpleEditor.vue";
import CodeEditor from "@/components/editors/CodeEditor.vue";
import MarkdownEditor from "@/components/editors/MarkdownEditor.vue";
import WebDevEditor from "@/components/editors/WebDevEditor.vue";
import PreviewPanel from "@/components/projects/PreviewPanel.vue";

// 懒加载重型编辑器（优化：减少初始包大小约40%）
const ExcelEditor = defineAsyncComponent(
  () => import("@/components/editors/ExcelEditor.vue"),
);
const RichTextEditor = defineAsyncComponent(
  () => import("@/components/editors/RichTextEditor.vue"),
);
const PPTEditor = defineAsyncComponent(
  () => import("@/components/projects/PPTEditor.vue"),
);
import ChatPanel from "@/components/projects/ChatPanel.vue";
import GitStatusDialog from "@/components/projects/GitStatusDialog.vue";
import FileManageModal from "@/components/projects/FileManageModal.vue";
import ProjectShareDialog from "@/components/projects/ProjectShareDialog.vue";
import FileExportMenu from "@/components/projects/FileExportMenu.vue";
import GitHistoryDialog from "@/components/projects/GitHistoryDialog.vue";
import ProjectStatsPanel from "@/components/projects/ProjectStatsPanel.vue";
import ProjectFileList from "@/components/projects/ProjectFileList.vue";
import ProjectSidebar from "@/components/ProjectSidebar.vue";
import EditorPanelHeader from "@/components/projects/EditorPanelHeader.vue";
import ResizeHandle from "@/components/projects/ResizeHandle.vue";
import PerformanceMonitor from "@/components/projects/PerformanceMonitor.vue";
import CommandPalette from "@/components/common/CommandPalette.vue";
import FadeSlide from "@/components/common/transitions/FadeSlide.vue";
import SkeletonLoader from "@/components/common/SkeletonLoader.vue";
import {
  sanitizePath,
  validateFileSize,
  throttle,
  debounce,
  getFileTypeInfo,
  getCacheStats,
} from "@/utils/file-utils";
import { fileCacheManager } from "@/utils/indexeddb-cache";
import {
  fileWorker,
  syntaxWorker,
  workerManager,
} from "@/utils/worker-manager";

// 导入性能优化工具
import { getRequestBatcher, batchedRequest } from "@/utils/request-batcher";
import { getOptimisticUpdateManager } from "@/utils/optimistic-update-manager";
import {
  getIncrementalSyncManager,
  trackChange,
} from "@/utils/incremental-sync";
import {
  getIntelligentPrefetchManager,
  enableHoverPrefetch,
} from "@/utils/intelligent-prefetch";
import { getAccessibilityManager, announce } from "@/utils/accessibility";
import keyboardShortcuts from "@/utils/keyboard-shortcuts";

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
const commitMessage = ref("");
const resolvedProjectPath = ref("");
const aiCreationData = ref(null); // AI创建数据
const autoSendMessage = ref(""); // 自动发送的消息（从路由参数传入）
const fileTreeKey = ref(0); // 文件树刷新计数器

// 新增状态
const viewMode = ref("preview"); // 'auto' | 'edit' | 'preview' - 默认预览模式
const showChatPanel = ref(true); // 对话面板始终显示在中间
const showEditorPanel = ref(false); // 默认隐藏编辑器面板（右侧），用户可通过按钮打开
const fileContent = ref(""); // 文件内容

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
const useVirtualFileTree = ref(true); // 使用虚拟滚动文件树（性能优化）- 已启用

// 计算属性
const projectId = computed(() => route.params.id);
const isAICreatingMode = computed(() => {
  const id = route.params.id;
  return id === "ai-creating" || String(id).includes("ai-creating");
});
const currentProject = computed(() => projectStore.currentProject);
const isDevelopment = computed(() => {
  return process.env.NODE_ENV === "development";
});
const projectFiles = computed(() => {
  const files = projectStore.projectFiles;
  console.log("[ProjectDetail] projectFiles computed 执行");
  console.log("  文件数量:", files?.length || 0);
  console.log("  时间戳:", Date.now());

  if (!files || files.length === 0) {
    console.log("[ProjectDetail] 返回空数组");
    return [];
  }

  if (files.length > 0 && files.length <= 3) {
    console.log(
      "[ProjectDetail] 文件列表:",
      files.map((f) => f.file_name).join(", "),
    );
  } else if (files.length > 3) {
    console.log(
      "[ProjectDetail] 前3个文件:",
      files
        .slice(0, 3)
        .map((f) => f.file_name)
        .join(", "),
    );
  }

  // 🔑 关键：创建新数组引用确保响应式
  const newRef = [...files];
  console.log("[ProjectDetail] 创建新引用，长度:", newRef.length);
  return newRef;
});
const currentFile = computed(() => projectStore.currentFile);

// 文件类型信息（使用LRU缓存优化）
const fileTypeInfo = computed(() => {
  if (!currentFile.value?.file_name) {return null;}

  // 使用缓存的文件类型检测函数
  return getFileTypeInfo(
    currentFile.value.file_path || currentFile.value.file_name,
    currentFile.value.file_name,
  );
});

// 是否显示Excel编辑器
const shouldShowExcelEditor = computed(() => {
  if (!currentFile.value) {return false;}
  if (viewMode.value === "preview") {return false;}
  return fileTypeInfo.value?.isExcel;
});

// 是否显示Word编辑器
const shouldShowWordEditor = computed(() => {
  if (!currentFile.value) {return false;}
  if (viewMode.value === "preview") {return false;}
  return fileTypeInfo.value?.isWord;
});

// 是否显示代码编辑器
const shouldShowCodeEditor = computed(() => {
  if (!currentFile.value) {return false;}
  if (viewMode.value === "preview") {return false;}
  return fileTypeInfo.value?.isCode;
});

// 是否显示Markdown编辑器
const shouldShowMarkdownEditor = computed(() => {
  if (!currentFile.value) {return false;}
  if (viewMode.value === "preview") {return false;}
  return fileTypeInfo.value?.isMarkdown;
});

// 是否显示Web开发编辑器
const shouldShowWebEditor = computed(() => {
  if (!currentFile.value) {return false;}
  if (viewMode.value === "preview") {return false;}
  // 当打开HTML文件且项目包含CSS/JS时使用Web开发编辑器
  const ext = currentFile.value.file_name?.split(".").pop()?.toLowerCase();
  return ext === "html";
});

// 是否显示PPT编辑器
const shouldShowPPTEditor = computed(() => {
  if (!currentFile.value) {return false;}
  // PPT文件在auto和edit模式下使用编辑器
  if (viewMode.value === "auto" || viewMode.value === "edit") {
    return fileTypeInfo.value?.isPPT;
  }
  return false;
});

// 是否显示文本编辑器
const shouldShowEditor = computed(() => {
  if (!currentFile.value) {return false;}
  // 专用编辑器的文件不使用文本编辑器
  if (
    fileTypeInfo.value?.isExcel ||
    fileTypeInfo.value?.isWord ||
    fileTypeInfo.value?.isCode ||
    fileTypeInfo.value?.isMarkdown ||
    fileTypeInfo.value?.isPPT
  ) {
    return false;
  }
  if (viewMode.value === "edit") {return fileTypeInfo.value?.isEditable;}
  if (viewMode.value === "preview") {return false;}
  if (viewMode.value === "auto") {return fileTypeInfo.value?.isEditable;}
  return false;
});

// 是否显示预览
const shouldShowPreview = computed(() => {
  if (!currentFile.value) {return false;}
  if (viewMode.value === "preview") {return true;}
  if (viewMode.value === "auto") {
    // 如果是专用编辑器文件或可编辑文件，则不显示预览
    if (
      fileTypeInfo.value?.isExcel ||
      fileTypeInfo.value?.isWord ||
      fileTypeInfo.value?.isPPT ||
      fileTypeInfo.value?.isEditable
    ) {
      return false;
    }
    return true;
  }
  return false;
});

// 初始化优化管理器实例
const requestBatcher = getRequestBatcher({
  batchWindow: 50,
  maxBatchSize: 10,
  enableCache: true,
  enableDeduplication: true,
});

const optimisticManager = getOptimisticUpdateManager({
  enableUndoRedo: true,
  enableOfflineQueue: true,
});

const syncManager = getIncrementalSyncManager({
  syncInterval: 30000, // 30秒自动同步一次
  enableAutoSync: true,
  enableWebSocket: false, // 根据需要启用WebSocket
});

const prefetchManager = getIntelligentPrefetchManager({
  enableHoverPrefetch: true,
  enableViewportPrefetch: true,
  enableIdlePrefetch: true,
  networkAware: true,
});

const a11yManager = getAccessibilityManager({
  enableAnnouncements: true,
  enableFocusTrap: true,
  autoFocus: true,
});

// 获取本地项目路径（将相对路径转换为绝对路径显示）
const getLocalProjectPath = async (path) => {
  if (!path) {return "未知路径";}

  try {
    // 调用后端 API 解析路径
    const resolvedPath = await window.electronAPI.project.resolvePath(path);

    // 如果返回的是对象，提取path属性；否则直接返回
    if (resolvedPath && typeof resolvedPath === "object" && resolvedPath.path) {
      return resolvedPath.path;
    }

    return resolvedPath;
  } catch (error) {
    console.error("解析项目路径失败:", error);
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

// 处理文件树面板调整大小（添加节流优化）
const handleFileExplorerResize = throttle((delta) => {
  const newWidth = fileExplorerWidth.value + delta;
  if (newWidth >= minPanelWidth && newWidth <= maxFileExplorerWidth) {
    fileExplorerWidth.value = newWidth;
  }
}, 16); // 60fps

// 处理编辑器面板调整大小（添加节流优化）
const handleEditorPanelResize = throttle((delta) => {
  const newWidth = editorPanelWidth.value - delta; // 注意：向左拖拽时delta为正，需要减小宽度
  if (newWidth >= minPanelWidth && newWidth <= maxEditorPanelWidth) {
    editorPanelWidth.value = newWidth;
  }
}, 16); // 60fps

// 刷新 Git 状态
const refreshGitStatus = async () => {
  if (!currentProject.value?.root_path) {
    return;
  }

  try {
    const status = await window.electronAPI.project.gitStatus(
      currentProject.value.root_path,
    );
    if (status) {
      gitStatus.value = status;
    }
  } catch (error) {
    console.error("[ProjectDetail] 获取 Git 状态失败:", error);
    // 不显示错误消息，因为可能项目不是 Git 仓库
  }
};

// 加载文件内容（优化：使用IndexedDB缓存和Web Workers）
const loadFileContent = async (file) => {
  if (!file || !file.file_path) {
    fileContent.value = "";
    return;
  }

  try {
    // 为可编辑、可预览和PPT文件加载内容
    const shouldLoadContent =
      fileTypeInfo.value &&
      (fileTypeInfo.value.isEditable ||
        fileTypeInfo.value.isMarkdown ||
        fileTypeInfo.value.isData ||
        fileTypeInfo.value.isPPT ||
        fileTypeInfo.value.isExcel ||
        fileTypeInfo.value.isWord);

    if (shouldLoadContent) {
      // 检查项目信息是否完整
      if (!currentProject.value || !currentProject.value.root_path) {
        throw new Error("项目信息不完整，缺少 root_path");
      }

      // 【优化1: 尝试从IndexedDB缓存获取】
      const cachedContent = await fileCacheManager.getCachedFileContent(
        projectId.value,
        file.file_path,
      );

      if (cachedContent) {
        console.log("[ProjectDetail] 从缓存加载文件内容:", file.file_path);
        fileContent.value = cachedContent.content;
        return;
      }

      // 【修复1: 使用sanitizePath进行路径安全验证】
      let fullPath;
      const isAbsolutePath = /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(file.file_path);

      if (isAbsolutePath) {
        // 如果已经是绝对路径，直接使用
        fullPath = file.file_path;
      } else {
        // 如果是相对路径，使用安全的路径拼接函数
        try {
          fullPath = sanitizePath(
            currentProject.value.root_path,
            file.file_path,
          );
        } catch (pathError) {
          throw new Error(`路径验证失败: ${pathError.message}`);
        }
      }

      console.log(
        "[ProjectDetail] 项目根路径:",
        currentProject.value.root_path,
      );
      console.log("[ProjectDetail] 文件相对路径:", file.file_path);
      console.log("[ProjectDetail] 完整路径（已验证）:", fullPath);

      // 【修复2: 添加文件大小检查】
      try {
        const fileStats = await window.electronAPI.file.stat(fullPath);
        if (fileStats && fileStats.success && fileStats.stats) {
          const extension = file.file_name?.split(".").pop();
          const sizeValidation = validateFileSize(
            fileStats.stats.size,
            extension,
          );

          if (!sizeValidation.isValid) {
            message.warning(sizeValidation.message);
            fileContent.value = `文件过大，无法在编辑器中打开。\n\n${sizeValidation.message}\n\n建议使用外部编辑器打开此文件。`;
            return;
          }
        }
      } catch (statsError) {
        console.warn(
          "[ProjectDetail] 无法获取文件大小，跳过大小检查:",
          statsError,
        );
        // 继续加载，不因为无法获取文件大小而失败
      }

      const result = await window.electronAPI.file.readContent(fullPath);

      // 正确处理 IPC 返回的对象 { success: true, content: '...' }
      if (result && result.success) {
        // 确保 content 是字符串类型
        const content =
          typeof result.content === "string"
            ? result.content
            : String(result.content || "");
        fileContent.value = content;
        console.log(
          "[ProjectDetail] 文件内容加载成功，长度:",
          fileContent.value.length,
        );

        // 【优化2: 缓存到IndexedDB】
        try {
          await fileCacheManager.cacheFileContent(
            projectId.value,
            file.file_path,
            content,
            {
              fileName: file.file_name,
              fileType: fileTypeInfo.value?.extension,
              size: content.length,
            },
          );
        } catch (cacheError) {
          console.warn("[ProjectDetail] 缓存文件内容失败:", cacheError);
          // 不影响主流程
        }

        // 【优化3: 使用Web Worker解析文件（异步，不阻塞）】
        if (fileTypeInfo.value?.isCode || fileTypeInfo.value?.isMarkdown) {
          try {
            const parseResult = await fileWorker.parseFile(
              content,
              fileTypeInfo.value.isMarkdown ? "markdown" : "code",
              { language: fileTypeInfo.value.extension },
            );

            if (parseResult.success) {
              console.log(
                "[ProjectDetail] 文件解析完成:",
                parseResult.metadata,
              );
              // 可以将解析结果用于代码导航、大纲等功能
            }
          } catch (workerError) {
            console.warn("[ProjectDetail] Worker解析失败:", workerError);
            // 不影响主流程
          }
        }
      } else {
        throw new Error(result?.error || "读取文件失败");
      }
    } else {
      fileContent.value = "";
    }
  } catch (error) {
    console.error("[ProjectDetail] 加载文件内容失败:", error);
    console.error("[ProjectDetail] 错误详情:", {
      projectId: projectId.value,
      projectRootPath: currentProject.value?.root_path,
      fileRelativePath: file.file_path,
      fileName: file.file_name,
      error: error.message,
    });

    // 提供更有用的错误消息
    let errorMsg = "加载文件失败: " + error.message;
    if (!currentProject.value?.root_path) {
      errorMsg += "\n提示：项目缺少 root_path 配置，请检查项目设置";
    }

    message.error(errorMsg);
    fileContent.value = "";
  }
};

// 处理编辑器内容变化
const handleContentChange = (newContent) => {
  // 确保内容是字符串类型
  fileContent.value =
    typeof newContent === "string" ? newContent : String(newContent || "");
  hasUnsavedChanges.value = true;
};

// 处理文件保存（从编辑器触发）
const handleFileSave = async (content) => {
  if (!currentFile.value) {return;}

  saving.value = true;
  try {
    // 保存文件内容到磁盘
    await window.electronAPI.file.writeContent(
      currentFile.value.file_path,
      content || fileContent.value,
    );

    // 更新store
    currentFile.value.content = content || fileContent.value;
    hasUnsavedChanges.value = false;

    message.success("文件已保存");
  } catch (error) {
    console.error("保存文件失败:", error);
    message.error("保存失败: " + error.message);
  } finally {
    saving.value = false;
  }
};

// 处理Excel内容变化
const handleExcelChange = (changeData) => {
  hasUnsavedChanges.value = true;
  console.log("[ProjectDetail] Excel数据变化:", changeData);
};

// 处理Excel保存
const handleExcelSave = async (data) => {
  if (!currentFile.value) {return;}

  saving.value = true;
  try {
    console.log("[ProjectDetail] 保存Excel文件:", currentFile.value.file_path);

    hasUnsavedChanges.value = false;
    message.success("Excel文件已保存");
  } catch (error) {
    console.error("保存Excel文件失败:", error);
    message.error("保存失败: " + error.message);
  } finally {
    saving.value = false;
  }
};

// 处理Word内容变化
const handleWordChange = (changeData) => {
  hasUnsavedChanges.value = true;
  console.log("[ProjectDetail] Word内容变化:", changeData);
};

// 处理Word保存
const handleWordSave = async (data) => {
  if (!currentFile.value) {return;}

  saving.value = true;
  try {
    console.log("[ProjectDetail] 保存Word文件:", currentFile.value.file_path);

    hasUnsavedChanges.value = false;
    message.success("Word文档已保存");
  } catch (error) {
    console.error("保存Word文件失败:", error);
    message.error("保存失败: " + error.message);
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
  message.success("代码已保存");
};

// 处理Markdown变化
const handleMarkdownChange = (content) => {
  console.log("[ProjectDetail] Markdown内容变化，长度:", content?.length);
  hasUnsavedChanges.value = true;
  // 更新 fileContent 以保持同步
  fileContent.value = content;
};

// 处理Markdown保存
const handleMarkdownSave = async (content) => {
  console.log("[ProjectDetail] Markdown保存完成，长度:", content?.length);
  hasUnsavedChanges.value = false;
  // 更新 fileContent
  fileContent.value = content;
  // 不需要再显示消息，MarkdownEditor 已经显示了
};

// 处理Web保存
const handleWebSave = async (data) => {
  hasUnsavedChanges.value = false;
  message.success("Web项目已保存");
};

// 处理PPT变化
const handlePPTChange = (slides) => {
  hasUnsavedChanges.value = true;
};

// 处理PPT保存
const handlePPTSave = async (slides) => {
  hasUnsavedChanges.value = false;
  message.success("PPT已保存");
};

// 返回项目列表
const handleBackToList = () => {
  if (hasUnsavedChanges.value) {
    Modal.confirm({
      title: "有未保存的更改",
      content: "确定要离开吗？未保存的更改将会丢失。",
      okText: "离开",
      okType: "danger",
      cancelText: "取消",
      onOk: () => {
        router.push("/projects");
      },
    });
  } else {
    router.push("/projects");
  }
};

/**
 * 统一的文件加载函数，确保响应式和时序正确
 * @param {string} targetProjectId - 目标项目ID
 * @param {boolean} forceRerender - 是否强制重新渲染（默认false）
 */
const loadFilesWithSync = async (targetProjectId, forceRerender = false) => {
  console.log(
    "[ProjectDetail] loadFilesWithSync 开始, projectId:",
    targetProjectId,
    "forceRerender:",
    forceRerender,
  );

  // 1. 加载文件
  await projectStore.loadProjectFiles(targetProjectId);
  console.log("[ProjectDetail]   ✓ Store 已更新");

  // 2. 单次 nextTick 让 Vue 响应式自然传播（避免过度更新）
  await nextTick();
  console.log("[ProjectDetail]   ✓ 响应式已传播");

  // 3. 仅在必要时强制重新渲染（避免编辑器状态冲突）
  if (forceRerender) {
    fileTreeKey.value++;
    console.log("[ProjectDetail]   ✓ Key 已更新:", fileTreeKey.value);
    await nextTick();
  }

  console.log("[ProjectDetail] loadFilesWithSync 完成");
};

// 根据文件数量自动选择文件树模式
const updateFileTreeMode = () => {
  const fileCount = projectFiles.value?.length || 0;
  // 超过300个文件时使用虚拟滚动（优化：降低阈值以防止中大型项目卡顿）
  const shouldUseVirtual = fileCount > 300;

  if (shouldUseVirtual !== useVirtualFileTree.value) {
    useVirtualFileTree.value = shouldUseVirtual;
    console.log(
      `[ProjectDetail] 文件数量: ${fileCount}，切换到 ${shouldUseVirtual ? "虚拟" : "标准"}模式`,
    );
  }
};

// 刷新文件列表
const handleRefreshFiles = async () => {
  refreshing.value = true;
  try {
    console.log("[ProjectDetail] ===== 开始刷新文件列表 =====");
    console.log("[ProjectDetail] 项目ID:", projectId.value);

    // 手动刷新时强制重新渲染文件树
    await loadFilesWithSync(projectId.value, true);

    message.success("文件列表已刷新");
    console.log("[ProjectDetail] ===== 刷新完成 =====");
  } catch (error) {
    console.error("[ProjectDetail] ===== 刷新失败 =====");
    console.error("Refresh files failed:", error);
    message.error("刷新失败：" + error.message);
  } finally {
    refreshing.value = false;
  }
};

// 选择文件
const handleSelectFile = async (fileData) => {
  // 兼容两种调用方式：对象 { id, file_name, file_path } 或直接传 fileId
  const fileId = typeof fileData === "object" ? fileData.id : fileData;
  if (hasUnsavedChanges.value) {
    Modal.confirm({
      title: "有未保存的更改",
      content: "确定要切换文件吗？未保存的更改将会丢失。",
      okText: "切换",
      okType: "danger",
      cancelText: "取消",
      onOk: () => {
        selectFile(fileId);
      },
    });
  } else {
    selectFile(fileId);
  }
};

const selectFile = async (fileId) => {
  console.log("[ProjectDetail] 选择文件, fileId:", fileId);
  const file = projectFiles.value.find((f) => f.id === fileId);

  if (file) {
    console.log("[ProjectDetail] 找到文件:", file);

    // 使用乐观更新选择文件
    await optimisticManager.update({
      entity: `file-select:${fileId}`,

      // 立即更新UI
      mutation: async () => {
        projectStore.currentFile = file;
        hasUnsavedChanges.value = false;

        // 如果编辑器面板被隐藏，则显示它
        if (!showEditorPanel.value) {
          showEditorPanel.value = true;
        }
      },

      // 跟踪文件访问（用于智能预取）
      apiCall: async () => {
        // 记录文件访问历史
        trackChange(`file:${fileId}`, "access", {
          lastAccessed: Date.now(),
        });

        return { success: true };
      },

      rollback: async () => {
        // 如果失败，不做任何回滚（因为只是选择文件）
      },

      onSuccess: () => {
        announce(`已打开文件 ${file.file_name}`, "polite");

        // 启用智能预取：预加载相邻文件
        prefetchAdjacentFiles(fileId);
      },

      onFailure: (error) => {
        console.error("选择文件失败:", error);
      },
    });
  } else {
    console.warn(
      "[ProjectDetail] 未找到文件, fileId:",
      fileId,
      "可用文件:",
      projectFiles.value,
    );
  }
};

// 智能预取相邻文件
const prefetchAdjacentFiles = (currentFileId) => {
  const currentIndex = projectFiles.value.findIndex(
    (f) => f.id === currentFileId,
  );
  if (currentIndex === -1) {return;}

  // 预取前后各2个文件
  const filesToPrefetch = [
    projectFiles.value[currentIndex - 2],
    projectFiles.value[currentIndex - 1],
    projectFiles.value[currentIndex + 1],
    projectFiles.value[currentIndex + 2],
  ].filter(Boolean);

  filesToPrefetch.forEach((file) => {
    if (file && file.file_path) {
      const fullPath = file.file_path;
      prefetchManager.prefetch(fullPath, {
        type: "fetch",
        priority: "low",
      });
    }
  });
};

// 文件内容变化
const handleFileChange = (content) => {
  hasUnsavedChanges.value = true;
};

// 保存文件 - 使用乐观更新
const handleSave = async () => {
  if (!currentFile.value) {return;}

  saving.value = true;

  await optimisticManager.update({
    entity: `file:${currentFile.value.id}`,

    // 立即更新本地UI
    mutation: async () => {
      hasUnsavedChanges.value = false;
    },

    // 后台保存
    apiCall: async () => {
      await projectStore.updateFile(
        currentFile.value.id,
        currentFile.value.content,
      );

      // 跟踪变更用于增量同步
      trackChange(`file:${currentFile.value.id}`, "update", {
        content: currentFile.value.content,
        updatedAt: Date.now(),
      });

      // 触发增量同步
      await syncManager.syncNow();

      return { success: true };
    },

    // 失败时回滚
    rollback: async () => {
      hasUnsavedChanges.value = true;
    },

    onSuccess: () => {
      message.success("文件已保存");
      announce("文件已保存", "polite");
    },

    onFailure: (error) => {
      console.error("Save file failed:", error);
      message.error("保存失败：" + error.message);
    },
  });

  saving.value = false;
};

// 处理视图模式变化
const handleViewModeChange = (mode) => {
  viewMode.value = mode;
  console.log("视图模式已切换为:", mode);
};

// 处理导出
const handleExport = (exportType) => {
  console.log("导出类型:", exportType);
  message.info(`导出功能开发中: ${exportType}`);
  // 这里可以根据exportType调用不同的导出方法
  // 比如调用FileExportMenu中已有的导出功能
};

// 检查 Git 是否已初始化
const checkGitInitialized = async () => {
  if (!currentProject.value?.root_path) {
    return false;
  }

  try {
    // 检查项目目录中是否存在 .git 文件夹
    const exists = await window.electronAPI.file.exists(
      currentProject.value.root_path + "/.git",
    );
    return exists;
  } catch (error) {
    console.error("检查 Git 初始化状态失败:", error);
    return false;
  }
};

// 初始化 Git 仓库
const initializeGitRepo = async () => {
  try {
    await projectStore.initGit(projectId.value);
    message.success("Git 仓库初始化成功");
    return true;
  } catch (error) {
    console.error("Git 初始化失败:", error);
    message.error("Git 初始化失败：" + error.message);
    return false;
  }
};

// Git操作
const handleGitAction = async ({ key }) => {
  // 对于需要 Git 仓库的操作，先检查是否已初始化
  const needsGitInit = ["commit", "push", "pull", "history", "status"];

  if (needsGitInit.includes(key)) {
    const isInitialized = await checkGitInitialized();

    if (!isInitialized) {
      // 显示确认对话框
      Modal.confirm({
        title: "Git 仓库未初始化",
        content: "当前项目还未初始化 Git 仓库，是否立即初始化？",
        okText: "立即初始化",
        cancelText: "取消",
        onOk: async () => {
          const success = await initializeGitRepo();
          if (success) {
            // 初始化成功后，继续执行原操作
            await executeGitAction(key);
          }
        },
      });
      return;
    }
  }

  // 执行 Git 操作
  await executeGitAction(key);
};

// 执行具体的 Git 操作
const executeGitAction = async (key) => {
  switch (key) {
    case "status":
      await showGitStatus();
      break;
    case "history":
      showGitHistoryModal.value = true;
      break;
    case "commit":
      showGitCommitModal.value = true;
      break;
    case "push":
      await handleGitPush();
      break;
    case "pull":
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
    message.warning("请输入提交信息");
    return;
  }

  committing.value = true;
  try {
    const repoPath = currentProject.value.root_path;
    await projectStore.gitCommit(projectId.value, commitMessage.value);

    message.success("提交成功");
    showGitCommitModal.value = false;
    commitMessage.value = "";
  } catch (error) {
    console.error("Git commit failed:", error);
    message.error("提交失败：" + error.message);
  } finally {
    committing.value = false;
  }
};

// Git推送
const handleGitPush = async () => {
  try {
    const repoPath = currentProject.value.root_path;
    await projectStore.gitPush(repoPath);
    message.success("推送成功");
  } catch (error) {
    console.error("Git push failed:", error);
    message.error("推送失败：" + error.message);
  }
};

// Git拉取
const handleGitPull = async () => {
  try {
    const repoPath = currentProject.value.root_path;
    await projectStore.gitPull(repoPath);
    message.success("拉取成功");
    await handleRefreshFiles();
  } catch (error) {
    console.error("Git pull failed:", error);
    message.error("拉取失败：" + error.message);
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
  viewMode.value = "preview";
  handleSelectFile(file.id);
  showFileManageModal.value = false;
};

// 从文件管理Modal下载文件
const handleFileDownloadFromModal = async (file) => {
  try {
    // TODO: 实现文件下载功能
    // 调用Electron API下载文件到用户指定位置
    await window.electronAPI.file.saveAs(file.file_path);
    message.success("文件下载成功");
  } catch (error) {
    console.error("Download file failed:", error);
    message.error("下载失败：" + error.message);
  }
};

// 从文件管理Modal删除文件
const handleFileDeleteFromModal = async (file) => {
  Modal.confirm({
    title: "确认删除",
    content: `确定要删除文件 "${file.file_name}" 吗？此操作不可恢复。`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    onOk: async () => {
      try {
        // TODO: 实现文件删除功能
        await window.electronAPI.project.deleteFile(projectId.value, file.id);
        message.success("文件已删除");
        // 刷新文件列表
        await handleRefreshFiles();
      } catch (error) {
        console.error("Delete file failed:", error);
        message.error("删除失败：" + error.message);
      }
    },
  });
};

// ==================== 从项目信息面板处理文件操作 ====================

// 从项目信息面板选择文件（已废弃，保留兼容性）
const handleSelectFileFromInfo = (fileId) => {
  handleSelectFile(fileId);
};

// 从项目信息面板预览文件
const handleFilePreviewFromInfo = (file) => {
  projectStore.currentFile = file;
  viewMode.value = "preview";
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

    message.success(
      shareType === "public" ? "项目已设置为公开访问" : "项目已设置为私密访问",
    );
  } catch (error) {
    console.error("Update share type failed:", error);
    message.error("更新分享设置失败：" + error.message);
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
    console.error("Update share data failed:", error);
  }
};

// 处理导出开始
const handleExportStart = ({ exportType, fileName }) => {
  console.log("Export started:", exportType, fileName);
};

// 处理导出完成
const handleExportComplete = async (result) => {
  console.log("Export completed:", result);
  // 可以在这里添加额外的处理，比如显示文件或打开目录
};

// 处理导出错误
const handleExportError = ({ exportType, error }) => {
  console.error("Export error:", exportType, error);
};

// 处理AI创建完成
const handleAICreationComplete = async (result) => {
  console.log("[ProjectDetail] AI创建完成:", result);
  // 清空AI创建数据
  aiCreationData.value = null;

  // 如果当前是ai-creating模式，需要跳转到真实的项目详情页
  if (isAICreatingMode.value) {
    router.replace(`/projects/${result.projectId}`);
  } else {
    // 刷新项目信息和文件列表
    await projectStore.fetchProjectById(result.projectId);
    await loadFilesWithSync(result.projectId);
    console.log("[ProjectDetail] AI创建完成，文件树已刷新");
  }
};

// 注册键盘快捷键
const registerShortcuts = () => {
  console.log("[ProjectDetail] 注册键盘快捷键");

  // 设置作用域
  keyboardShortcuts.setScope("project-detail");

  // 监听快捷键事件
  window.addEventListener("shortcut-save", handleSave);
  window.addEventListener("shortcut-undo", async () => {
    if (optimisticManager.canUndo()) {
      await optimisticManager.undo();
      message.info("已撤销");
      announce("操作已撤销", "polite");
    }
  });
  window.addEventListener("shortcut-redo", async () => {
    if (optimisticManager.canRedo()) {
      await optimisticManager.redo();
      message.info("已重做");
      announce("操作已重做", "polite");
    }
  });
  window.addEventListener("shortcut-toggle-sidebar", toggleChatPanel);
};

// 清理快捷键
const cleanupShortcuts = () => {
  window.removeEventListener("shortcut-save", handleSave);
  keyboardShortcuts.setScope("global");
};

// 组件挂载时加载项目
onMounted(async () => {
  loading.value = true;

  try {
    // 注册键盘快捷键
    registerShortcuts();
    // 🔥 检查是否是AI创建模式（projectId为'ai-creating'）
    if (isAICreatingMode.value) {
      console.log("[ProjectDetail] 检测到AI创建模式，开始自动创建项目");

      // 如果有 createData 参数，解析并保存
      if (route.query.createData) {
        try {
          aiCreationData.value = JSON.parse(route.query.createData);
          console.log("[ProjectDetail] AI创建数据:", aiCreationData.value);

          // 🔥 自动创建项目（使用快速创建方法，不调用后端）
          const createData = {
            name: aiCreationData.value.name || "新项目",
            projectType: aiCreationData.value.projectType || "document",
            userId: aiCreationData.value.userId,
            status: "draft",
          };

          console.log("[ProjectDetail] 创建项目参数:", createData);
          const createdProject =
            await window.electronAPI.project.createQuick(createData);
          console.log("[ProjectDetail] 项目创建成功:", createdProject);

          // 添加到项目列表
          projectStore.projects.unshift(createdProject);

          // 🔥 保存用户输入，准备自动发送
          const userPrompt = aiCreationData.value.userPrompt;

          // 🔥 清空aiCreationData，避免重复触发AI创建
          aiCreationData.value = null;

          // 🔥 跳转到真实项目ID，并传递用户prompt以便ChatPanel自动发送
          console.log("[ProjectDetail] 跳转到真实项目:", createdProject.id);
          router.replace({
            path: `/projects/${createdProject.id}`,
            query: {
              autoSendMessage: userPrompt, // 传递给ChatPanel自动发送
            },
          });

          loading.value = false;
          return;
        } catch (error) {
          console.error("[ProjectDetail] 自动创建项目失败:", error);
          message.error("创建项目失败: " + error.message);
          // 失败时返回项目列表
          router.push("/projects");
          loading.value = false;
          return;
        }
      } else {
        // 没有 createData 参数，显示空的ChatPanel让用户手动输入
        console.log("[ProjectDetail] AI创建模式，等待用户输入创建请求");
        loading.value = false;
        return;
      }
    }

    // 加载项目详情
    await projectStore.fetchProjectById(projectId.value);

    if (!currentProject.value) {
      loading.value = false;
      return;
    }

    // 加载项目文件（使用统一的加载函数）
    await loadFilesWithSync(projectId.value);
    updateFileTreeMode(); // 根据文件数量选择最佳模式
    console.log("[ProjectDetail] 初始文件树已加载");

    // 无障碍通知：项目已加载
    announce(
      `项目 ${currentProject.value.name} 已加载，包含 ${projectFiles.value.length} 个文件`,
      "polite",
    );

    // 🔥 检查是否有自动发送消息的请求
    if (route.query.autoSendMessage) {
      autoSendMessage.value = route.query.autoSendMessage;
      console.log("[ProjectDetail] 检测到自动发送消息:", autoSendMessage.value);

      // 🔄 延迟清除query参数，等ChatPanel处理完并保存到conversation（2秒足够）
      setTimeout(() => {
        console.log("[ProjectDetail] 清除autoSendMessage query参数");
        // 🔥 使用 replaceState 代替 router.replace，避免触发页面重新加载
        const url = new URL(window.location.href);
        url.searchParams.delete("autoSendMessage");
        window.history.replaceState({}, "", url.toString());
      }, 2000);
    }

    // 解析项目路径
    if (currentProject.value?.root_path) {
      resolvedProjectPath.value = await getLocalProjectPath(
        currentProject.value.root_path,
      );
    }

    // 初始化 Git 状态
    await refreshGitStatus();
    // 每 10 秒刷新一次 Git 状态
    gitStatusInterval = setInterval(() => {
      refreshGitStatus().catch((err) => {
        console.error("[ProjectDetail] Git status interval error:", err);
      });
    }, 30000); // 优化：从10秒增加到30秒，减少资源消耗

    // 启动项目统计收集
    if (resolvedProjectPath.value) {
      try {
        await window.electronAPI.project.startStats(
          projectId.value,
          resolvedProjectPath.value,
        );
        console.log("[ProjectDetail] 项目统计收集已启动");
      } catch (error) {
        console.error("[ProjectDetail] 启动统计收集失败:", error);
      }
    }

    // 启动文件系统监听（chokidar）
    if (currentProject.value?.root_path) {
      try {
        await window.electronAPI.project.watchProject(
          projectId.value,
          currentProject.value.root_path,
        );
        console.log("[ProjectDetail] 文件系统监听已启动");
      } catch (error) {
        console.error("[ProjectDetail] 启动文件监听失败:", error);
      }
    }

    // 监听文件变化事件 - 实现自动刷新
    window.electronAPI.onFileReloaded?.((event) => {
      console.log("[ProjectDetail] 检测到文件内容更新:", event);
      // 如果更新的文件是当前打开的文件，自动重新加载
      if (currentFile.value && currentFile.value.id === event.fileId) {
        selectFile(currentFile.value.id);
      }
      // 刷新文件列表（使用统一的加载函数）
      loadFilesWithSync(projectId.value).catch((err) => {
        console.error("[ProjectDetail] 文件更新后刷新失败:", err);
      });
    });

    window.electronAPI.onFileAdded?.((event) => {
      console.log("[ProjectDetail] 检测到新文件添加:", event);
      message.info(`新文件已添加: ${event.relativePath}`);
      // 刷新文件列表（使用统一的加载函数）
      loadFilesWithSync(projectId.value).catch((err) => {
        console.error("[ProjectDetail] 文件添加后刷新失败:", err);
      });
    });

    window.electronAPI.onFileDeleted?.((event) => {
      console.log("[ProjectDetail] 检测到文件删除:", event);
      message.info(`文件已删除: ${event.relativePath}`);
      // 如果删除的是当前打开的文件，关闭编辑器
      if (currentFile.value && currentFile.value.id === event.fileId) {
        projectStore.setCurrentFile(null);
        fileContent.value = "";
      }
      // 刷新文件列表（使用统一的加载函数）
      loadFilesWithSync(projectId.value).catch((err) => {
        console.error("[ProjectDetail] 文件删除后刷新失败:", err);
      });
    });

    window.electronAPI.onFileSyncConflict?.((event) => {
      console.warn("[ProjectDetail] 检测到文件同步冲突:", event);
      message.warning(`文件 "${event.fileName}" 存在同步冲突，请手动解决`);
    });

    // 监听文件列表更新事件（新增、删除、重命名、移动等操作）
    window.electronAPI.project.onFilesUpdated?.((event) => {
      console.log("[ProjectDetail] 检测到文件列表更新:", event);
      // 只刷新当前项目的文件列表（使用统一的加载函数）
      if (event.projectId === projectId.value) {
        loadFilesWithSync(projectId.value).catch((err) => {
          console.error("[ProjectDetail] 刷新文件列表失败:", err);
        });
      }
    });
  } catch (error) {
    console.error("Load project failed:", error);
    message.error("加载项目失败：" + error.message);
  } finally {
    loading.value = false;
  }
});

// 组件卸载时清理定时器
onUnmounted(async () => {
  // 清理快捷键
  cleanupShortcuts();

  if (gitStatusInterval) {
    clearInterval(gitStatusInterval);
    gitStatusInterval = null;
  }

  // 停止项目统计收集
  if (projectId.value) {
    try {
      await window.electronAPI.project.stopStats(projectId.value);
      console.log("[ProjectDetail] 项目统计收集已停止");
    } catch (error) {
      console.error("[ProjectDetail] 停止统计收集失败:", error);
    }
  }

  // 停止文件系统监听
  if (projectId.value) {
    try {
      await window.electronAPI.project.stopWatchProject(projectId.value);
      console.log("[ProjectDetail] 文件系统监听已停止");
    } catch (error) {
      console.error("[ProjectDetail] 停止文件监听失败:", error);
    }
  }

  // 清理文件同步事件监听器
  if (window.electronAPI) {
    window.electronAPI.offFileReloaded?.(() => {});
    window.electronAPI.offFileAdded?.(() => {});
    window.electronAPI.offFileDeleted?.(() => {});
    window.electronAPI.offFileSyncConflict?.(() => {});
  }
  if (window.electronAPI.project) {
    window.electronAPI.project.offFilesUpdated?.(() => {});
  }

  // 【优化: 清理Web Workers】
  try {
    fileWorker.destroy();
    syntaxWorker.destroy();
    console.log("[ProjectDetail] Web Workers已清理");
  } catch (error) {
    console.warn("[ProjectDetail] 清理Workers失败:", error);
  }

  // 【优化: 关闭IndexedDB连接】
  try {
    fileCacheManager.close();
    console.log("[ProjectDetail] IndexedDB连接已关闭");
  } catch (error) {
    console.warn("[ProjectDetail] 关闭IndexedDB失败:", error);
  }
});

// 监听路由变化
watch(
  () => route.params.id,
  async (newId, oldId) => {
    if (newId && newId !== oldId) {
      console.log("[ProjectDetail] 路由变化，切换项目:", { oldId, newId });
      loading.value = true;

      try {
        // 1. 停止旧项目的文件监听
        if (oldId && oldId !== "ai-creating") {
          try {
            await window.electronAPI.project.stopWatchProject(oldId);
            console.log("[ProjectDetail] 已停止旧项目文件监听:", oldId);
          } catch (error) {
            console.error("[ProjectDetail] 停止旧项目监听失败:", error);
          }
        }

        // 2. 清空当前状态
        projectStore.setCurrentFile(null);
        fileContent.value = "";
        gitStatus.value = {};
        resolvedProjectPath.value = "";

        // 🔥 检查是否是AI创建模式
        if (newId === "ai-creating") {
          console.log("[ProjectDetail] Watch检测到AI创建模式，跳过项目加载");
          loading.value = false;
          return;
        }

        // 3. 加载新项目
        await projectStore.fetchProjectById(newId);
        console.log(
          "[ProjectDetail] 项目数据已加载:",
          currentProject.value?.name,
        );

        // 4. 加载项目文件（使用统一的加载函数）
        await loadFilesWithSync(newId);
        console.log(
          "[ProjectDetail] 项目文件已加载，数量:",
          projectStore.projectFiles?.length || 0,
        );

        // 5. 解析项目路径
        if (currentProject.value?.root_path) {
          resolvedProjectPath.value = await getLocalProjectPath(
            currentProject.value.root_path,
          );
          console.log(
            "[ProjectDetail] 项目路径已解析:",
            resolvedProjectPath.value,
          );
        }

        // 6. 启动新项目的文件监听
        if (currentProject.value?.root_path) {
          try {
            await window.electronAPI.project.watchProject(
              newId,
              currentProject.value.root_path,
            );
            console.log("[ProjectDetail] 已启动新项目文件监听");
          } catch (error) {
            console.error("[ProjectDetail] 启动新项目监听失败:", error);
          }
        }

        // 7. 刷新Git状态
        await refreshGitStatus();
      } catch (error) {
        console.error("[ProjectDetail] 切换项目失败:", error);
        message.error("切换项目失败：" + error.message);
      } finally {
        loading.value = false;
      }
    }
  },
);

// 清理编辑器实例（避免内存泄漏）
const cleanupEditorInstances = () => {
  try {
    console.log("[ProjectDetail] 清理编辑器实例...");

    // 清理各类编辑器实例
    if (excelEditorRef.value?.destroy) {
      console.log("[ProjectDetail] 清理Excel编辑器");
      excelEditorRef.value.destroy();
    }
    if (wordEditorRef.value?.destroy) {
      console.log("[ProjectDetail] 清理Word编辑器");
      wordEditorRef.value.destroy();
    }
    if (codeEditorRef.value?.dispose) {
      // Monaco Editor使用dispose方法
      console.log("[ProjectDetail] 清理代码编辑器");
      codeEditorRef.value.dispose();
    }
    if (markdownEditorRef.value?.destroy) {
      console.log("[ProjectDetail] 清理Markdown编辑器");
      markdownEditorRef.value.destroy();
    }
    if (webEditorRef.value?.destroy) {
      console.log("[ProjectDetail] 清理Web编辑器");
      webEditorRef.value.destroy();
    }
    if (pptEditorRef.value?.destroy) {
      console.log("[ProjectDetail] 清理PPT编辑器");
      pptEditorRef.value.destroy();
    }
    if (editorRef.value?.destroy) {
      console.log("[ProjectDetail] 清理简单编辑器");
      editorRef.value.destroy();
    }

    console.log("[ProjectDetail] ✓ 编辑器实例清理完成");
  } catch (error) {
    console.warn("[ProjectDetail] 清理编辑器实例时出错:", error);
  }
};

// 监听当前文件变化，加载文件内容
watch(
  () => currentFile.value,
  async (newFile, oldFile) => {
    // 切换文件前清理旧编辑器实例
    if (oldFile && oldFile !== newFile) {
      cleanupEditorInstances();
    }

    if (newFile) {
      // Office文件（PPT/Excel/Word）默认使用预览模式
      // 用户可以通过"用本地应用打开"功能进行编辑
      // 不再自动切换到编辑模式，保持预览模式的简洁体验

      await loadFileContent(newFile);
    } else {
      fileContent.value = "";
    }
  },
  { immediate: false },
);

// 辅助函数
const getProjectTypeColor = (type) => {
  const colors = {
    web: "blue",
    document: "green",
    data: "purple",
    app: "orange",
  };
  return colors[type] || "default";
};

const getProjectTypeText = (type) => {
  const texts = {
    web: "Web应用",
    document: "文档项目",
    data: "数据分析",
    app: "应用程序",
  };
  return texts[type] || type;
};

const getStatusColor = (status) => {
  const colors = {
    draft: "default",
    active: "success",
    completed: "blue",
    archived: "warning",
  };
  return colors[status] || "default";
};

const getStatusText = (status) => {
  const texts = {
    draft: "草稿",
    active: "进行中",
    completed: "已完成",
    archived: "已归档",
  };
  return texts[status] || status;
};

const formatDate = (timestamp) => {
  if (!timestamp) {return "-";}
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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
  /* CSS Containment - 布局和样式隔离 */
  contain: layout style;
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
  /* CSS Containment - 完整隔离（静态元素） */
  contain: layout style paint;
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
  padding: 24px;
}

.skeleton-layout {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 16px;
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
  /* CSS Containment - 完整隔离（独立面板） */
  contain: layout style paint;
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
  /* CSS Containment - 完整隔离（独立面板） */
  contain: layout style paint;
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
  /* CSS Containment - 完整隔离（独立面板） */
  contain: layout style paint;
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
  font-family: "Courier New", monospace;
}

.git-status-loading {
  padding: 40px;
  text-align: center;
}
</style>

/* 项目信息容器样式 */ .project-info-container { flex: 1; padding: 24px;
overflow-y: auto; background: #f5f5f5; } .project-info-card { max-width: 900px;
margin: 0 auto; background: white; border-radius: 8px; padding: 32px;
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); } .info-header { display: flex;
align-items: center; gap: 16px; margin-bottom: 32px; padding-bottom: 16px;
border-bottom: 1px solid #e8e8e8; } .info-header h2 { margin: 0; font-size:
24px; font-weight: 600; } .info-content { display: flex; flex-direction: column;
gap: 24px; } .info-section h3 { font-size: 16px; font-weight: 600;
margin-bottom: 12px; color: #333; } .info-section p { color: #666; line-height:
1.6; margin: 0; } .info-alert { margin-top: 16px; } /* 文件管理器区域 */
.file-manager-section { background: #f9fafb; border-radius: 8px; padding: 20px;
border: 1px solid #e5e7eb; } .section-header { display: flex; justify-content:
space-between; align-items: center; margin-bottom: 16px; } .section-header h3 {
display: flex; align-items: center; gap: 8px; margin: 0; } .section-actions {
display: flex; gap: 8px; } .file-view-container { background: white;
border-radius: 6px; padding: 16px; min-height: 300px; max-height: 600px;
overflow-y: auto; } .file-tree-wrapper { min-height: 250px; }
