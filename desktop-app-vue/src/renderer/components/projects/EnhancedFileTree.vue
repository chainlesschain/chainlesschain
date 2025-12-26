<template>
  <div class="enhanced-file-tree">
    <!-- 工具栏 -->
    <div class="tree-toolbar">
      <a-tooltip title="刷新">
        <a-button type="text" size="small" @click="handleRefresh">
          <ReloadOutlined />
        </a-button>
      </a-tooltip>
      <a-tooltip title="折叠全部">
        <a-button type="text" size="small" @click="handleCollapseAll">
          <ShrinkOutlined />
        </a-button>
      </a-tooltip>
      <a-tooltip title="新建文件">
        <a-button type="text" size="small" @click="handleNewFile">
          <FileAddOutlined />
        </a-button>
      </a-tooltip>
      <a-tooltip title="新建文件夹">
        <a-button type="text" size="small" @click="handleNewFolder">
          <FolderAddOutlined />
        </a-button>
      </a-tooltip>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="tree-loading">
      <a-spin size="small" />
      <span>加载中...</span>
    </div>

    <!-- 文件树 -->
    <a-tree
      v-else-if="treeData.length > 0"
      :tree-data="treeData"
      :selected-keys="selectedKeys"
      :expanded-keys="expandedKeys"
      :show-icon="true"
      @select="handleSelect"
      @expand="handleExpand"
      @right-click="handleRightClick"
    >
      <template #title="{ title, isLeaf, icon, filePath, key }">
        <div
          class="tree-node-title"
          :draggable="enableDrag"
          @dragstart="handleDragStart($event, { title, isLeaf, filePath, key, icon })"
          @dragover="handleDragOver($event, { title, isLeaf, filePath, key, icon })"
          @dragleave="handleDragLeave"
          @drop="handleDrop($event, { title, isLeaf, filePath, key, icon })"
        >
          <component :is="icon" class="node-icon" />
          <span class="node-label">{{ title }}</span>
          <a-tag
            v-if="gitStatus && filePath && gitStatus[filePath]"
            :color="getStatusColor(gitStatus[filePath])"
            size="small"
            class="git-status-tag"
          >
            {{ getStatusLabel(gitStatus[filePath]) }}
          </a-tag>
        </div>
      </template>
    </a-tree>

    <!-- 空状态 -->
    <div v-else class="tree-empty">
      <FolderOpenOutlined />
      <p>暂无文件</p>
      <a-button size="small" @click="handleNewFile">
        <FileAddOutlined />
        新建文件
      </a-button>
    </div>

    <!-- 右键菜单 -->
    <a-dropdown
      v-model:open="contextMenuVisible"
      :trigger="['contextmenu']"
      :x="contextMenuX"
      :y="contextMenuY"
    >
      <div style="position: fixed; pointer-events: none;"></div>
      <template #overlay>
        <a-menu @click="handleMenuClick">
          <!-- 新建操作 -->
          <a-menu-item key="newFile">
            <FileAddOutlined />
            新建文件
          </a-menu-item>
          <a-menu-item key="newFolder">
            <FolderAddOutlined />
            新建文件夹
          </a-menu-item>

          <a-menu-divider />

          <!-- 文件操作 -->
          <a-menu-item key="rename" :disabled="!contextNode">
            <EditOutlined />
            重命名
          </a-menu-item>
          <a-menu-item key="delete" :disabled="!contextNode">
            <DeleteOutlined />
            删除
          </a-menu-item>

          <a-menu-divider />

          <!-- 复制操作 -->
          <a-menu-item key="copy" :disabled="!contextNode">
            <CopyOutlined />
            复制
          </a-menu-item>
          <a-menu-item key="paste" :disabled="!clipboard">
            <SnippetsOutlined />
            粘贴
          </a-menu-item>

          <a-menu-divider />

          <!-- 其他操作 -->
          <a-menu-item key="copyPath" :disabled="!contextNode">
            <LinkOutlined />
            复制路径
          </a-menu-item>
          <a-menu-item key="reveal" :disabled="!contextNode">
            <FolderOpenOutlined />
            在文件管理器中显示
          </a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  FolderOutlined,
  FolderOpenOutlined,
  FolderAddOutlined,
  FileOutlined,
  FileTextOutlined,
  FileAddOutlined,
  CodeOutlined,
  PictureOutlined,
  FileMarkdownOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  Html5Outlined,
  ReloadOutlined,
  ShrinkOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  SnippetsOutlined,
  LinkOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  files: {
    type: Array,
    default: () => [],
  },
  currentFileId: {
    type: String,
    default: null,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  gitStatus: {
    type: Object,
    default: () => ({}),
  },
  enableDrag: {
    type: Boolean,
    default: true, // 启用拖拽功能
  },
  projectId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['select', 'refresh', 'new-file', 'new-folder', 'rename', 'delete', 'copy', 'paste', 'reveal']);

// 响应式状态
const selectedKeys = ref([]);
const expandedKeys = ref([]);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextNode = ref(null);
const clipboard = ref(null);

// 文件图标映射
const fileIconMap = {
  js: CodeOutlined,
  jsx: CodeOutlined,
  ts: CodeOutlined,
  tsx: CodeOutlined,
  vue: CodeOutlined,
  py: CodeOutlined,
  java: CodeOutlined,
  html: Html5Outlined,
  css: CodeOutlined,
  md: FileMarkdownOutlined,
  markdown: FileMarkdownOutlined,
  txt: FileTextOutlined,
  json: CodeOutlined,
  xml: CodeOutlined,
  xlsx: FileExcelOutlined,
  xls: FileExcelOutlined,
  pdf: FilePdfOutlined,
  png: PictureOutlined,
  jpg: PictureOutlined,
  jpeg: PictureOutlined,
  gif: PictureOutlined,
  svg: PictureOutlined,
};

// 获取文件图标
const getFileIcon = (fileName, isFolder) => {
  if (isFolder) return FolderOutlined;

  const ext = fileName.split('.').pop()?.toLowerCase();
  return fileIconMap[ext] || FileOutlined;
};

// 构建树形数据
const treeData = computed(() => {
  if (!props.files || props.files.length === 0) return [];

  const buildTree = (items, parentPath = '') => {
    const tree = [];
    const folders = [];
    const files = [];

    items.forEach(file => {
      const isFolder = file.is_folder || file.type === 'folder';
      const node = {
        key: file.id || file.file_path,
        title: file.file_name || file.name,
        isLeaf: !isFolder,
        icon: getFileIcon(file.file_name || file.name, isFolder),
        filePath: file.file_path || file.path,
        children: [],
      };

      if (isFolder) {
        folders.push(node);
      } else {
        files.push(node);
      }
    });

    // 文件夹在前，文件在后
    return [...folders.sort((a, b) => a.title.localeCompare(b.title)), ...files.sort((a, b) => a.title.localeCompare(b.title))];
  };

  return buildTree(props.files);
});

// 监听当前文件变化
watch(() => props.currentFileId, (newId) => {
  if (newId) {
    selectedKeys.value = [newId];
  } else {
    selectedKeys.value = [];
  }
}, { immediate: true });

// 自动展开所有节点
watch(() => treeData.value, (newData) => {
  const getAllKeys = (nodes) => {
    let keys = [];
    nodes.forEach(node => {
      if (!node.isLeaf) {
        keys.push(node.key);
        if (node.children) {
          keys = keys.concat(getAllKeys(node.children));
        }
      }
    });
    return keys;
  };

  expandedKeys.value = getAllKeys(newData);
}, { immediate: true });

// 处理选择
const handleSelect = (keys, event) => {
  const { node } = event;
  if (node.isLeaf) {
    emit('select', {
      id: node.key,
      file_name: node.title,
      file_path: node.filePath,
    });
  }
};

// 处理展开/折叠
const handleExpand = (keys) => {
  expandedKeys.value = keys;
};

// 处理右键点击
const handleRightClick = ({ event, node }) => {
  event.preventDefault();
  contextNode.value = node;
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextMenuVisible.value = true;
};

// 处理菜单点击
const handleMenuClick = ({ key }) => {
  contextMenuVisible.value = false;

  switch (key) {
    case 'newFile':
      handleNewFile();
      break;
    case 'newFolder':
      handleNewFolder();
      break;
    case 'rename':
      handleRename();
      break;
    case 'delete':
      handleDelete();
      break;
    case 'copy':
      handleCopy();
      break;
    case 'paste':
      handlePaste();
      break;
    case 'copyPath':
      handleCopyPath();
      break;
    case 'reveal':
      handleReveal();
      break;
  }
};

// 刷新
const handleRefresh = () => {
  emit('refresh');
};

// 折叠全部
const handleCollapseAll = () => {
  expandedKeys.value = [];
};

// 新建文件
const handleNewFile = () => {
  emit('new-file', contextNode.value);
  message.info('新建文件功能需要IPC支持');
};

// 新建文件夹
const handleNewFolder = () => {
  emit('new-folder', contextNode.value);
  message.info('新建文件夹功能需要IPC支持');
};

// 重命名
const handleRename = () => {
  if (!contextNode.value) return;
  emit('rename', contextNode.value);
  message.info('重命名功能需要IPC支持');
};

// 删除
const handleDelete = () => {
  if (!contextNode.value) return;
  emit('delete', contextNode.value);
};

// 复制
const handleCopy = () => {
  if (!contextNode.value) return;
  clipboard.value = contextNode.value;
  message.success('已复制到剪贴板');
};

// 粘贴
const handlePaste = () => {
  if (!clipboard.value) return;
  emit('paste', { source: clipboard.value, target: contextNode.value });
  message.info('粘贴功能需要IPC支持');
};

// 复制路径
const handleCopyPath = () => {
  if (!contextNode.value) return;
  navigator.clipboard.writeText(contextNode.value.filePath || '');
  message.success('路径已复制到剪贴板');
};

// 在文件管理器中显示
const handleReveal = () => {
  if (!contextNode.value) return;
  emit('reveal', contextNode.value);
  message.info('在文件管理器中显示功能需要IPC支持');
};

// 拖拽状态
const draggedNode = ref(null);

// 拖拽处理
const handleDragStart = (event, node) => {
  if (!props.enableDrag) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', JSON.stringify(node));
  draggedNode.value = node;
};

const handleDragOver = (event, node) => {
  if (!props.enableDrag) return;
  event.preventDefault();

  // 只允许拖拽到文件夹上
  if (!node.isLeaf) {
    event.dataTransfer.dropEffect = 'move';
    // 添加拖拽悬停样式
    event.currentTarget.style.backgroundColor = 'rgba(52, 152, 219, 0.1)';
  } else {
    event.dataTransfer.dropEffect = 'none';
  }
};

const handleDragLeave = (event) => {
  if (!props.enableDrag) return;
  // 移除拖拽悬停样式
  event.currentTarget.style.backgroundColor = '';
};

const handleDrop = async (event, targetNode) => {
  if (!props.enableDrag) return;
  event.preventDefault();

  // 移除拖拽悬停样式
  event.currentTarget.style.backgroundColor = '';

  try {
    // 检查是否是外部文件
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      // 从外部拖入文件
      await handleExternalFileDrop(files, targetNode);
      return;
    }

    // 项目内文件移动
    const sourceData = JSON.parse(event.dataTransfer.getData('text/plain'));

    // 不能拖拽到自己或者拖拽到文件上
    if (sourceData.key === targetNode.key || targetNode.isLeaf) {
      message.warning('无效的拖拽操作');
      return;
    }

    // 调用IPC移动文件
    const projectId = getCurrentProjectId(); // 需要从父组件获取
    const targetPath = targetNode.isLeaf ?
      path.dirname(targetNode.filePath) :
      targetNode.filePath;

    const newFilePath = `${targetPath}/${sourceData.title}`;

    const result = await window.electronAPI.invoke('project:move-file', {
      projectId: projectId,
      fileId: sourceData.key,
      sourcePath: sourceData.filePath,
      targetPath: newFilePath
    });

    if (result.success) {
      message.success('文件移动成功');
      emit('refresh'); // 刷新文件树
    }
  } catch (error) {
    console.error('拖拽失败:', error);
    message.error('拖拽操作失败: ' + error.message);
  } finally {
    draggedNode.value = null;
  }
};

// 处理外部文件拖入
const handleExternalFileDrop = async (files, targetNode) => {
  const projectId = getCurrentProjectId();
  const targetPath = targetNode.isLeaf ?
    path.dirname(targetNode.filePath) :
    targetNode.filePath;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const newFilePath = `${targetPath}/${file.name}`;

    try {
      const result = await window.electronAPI.invoke('project:import-file', {
        projectId: projectId,
        externalPath: file.path,
        targetPath: newFilePath
      });

      if (result.success) {
        message.success(`文件 ${file.name} 导入成功`);
      }
    } catch (error) {
      console.error(`导入文件 ${file.name} 失败:`, error);
      message.error(`导入文件 ${file.name} 失败: ` + error.message);
    }
  }

  // 刷新文件树
  emit('refresh');
};

// 获取当前项目ID（需要从父组件传入或从store获取）
const getCurrentProjectId = () => {
  // TODO: 实际应从父组件props传入或从store获取
  return props.projectId || window.electronAPI.getCurrentProject?.()?.id;
};

// Git状态颜色
const getStatusColor = (status) => {
  const colorMap = {
    modified: 'orange',
    added: 'green',
    deleted: 'red',
    untracked: 'blue',
    renamed: 'purple',
  };
  return colorMap[status] || 'default';
};

// Git状态标签
const getStatusLabel = (status) => {
  const labelMap = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    untracked: 'U',
    renamed: 'R',
  };
  return labelMap[status] || '?';
};
</script>

<style scoped>
.enhanced-file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

/* 工具栏 */
.tree-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.tree-toolbar :deep(.ant-btn) {
  color: #6b7280;
}

.tree-toolbar :deep(.ant-btn:hover) {
  color: #374151;
  background: #e5e7eb;
}

/* 加载状态 */
.tree-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: #9ca3af;
}

/* 空状态 */
.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  color: #9ca3af;
}

.tree-empty :deep(.anticon) {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.3;
}

.tree-empty p {
  margin: 0 0 16px 0;
  font-size: 14px;
}

/* 文件树 */
.enhanced-file-tree :deep(.ant-tree) {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  background: transparent;
}

.enhanced-file-tree :deep(.ant-tree-node-content-wrapper) {
  border-radius: 4px;
  transition: background-color 0.2s;
}

.enhanced-file-tree :deep(.ant-tree-node-content-wrapper:hover) {
  background: #f3f4f6;
}

.enhanced-file-tree :deep(.ant-tree-node-selected .ant-tree-node-content-wrapper) {
  background: #dbeafe !important;
}

.enhanced-file-tree :deep(.ant-tree-switcher) {
  color: #6b7280;
}

/* 节点标题 */
.tree-node-title {
  display: flex;
  align-items: center;
  gap: 6px;
  user-select: none;
  width: 100%;
}

.node-icon {
  flex-shrink: 0;
  font-size: 14px;
  color: #6b7280;
}

.node-label {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-status-tag {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 4px;
  line-height: 16px;
  min-width: 20px;
  text-align: center;
}

/* 滚动条 */
.enhanced-file-tree :deep(.ant-tree)::-webkit-scrollbar {
  width: 6px;
}

.enhanced-file-tree :deep(.ant-tree)::-webkit-scrollbar-track {
  background: transparent;
}

.enhanced-file-tree :deep(.ant-tree)::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 3px;
}

.enhanced-file-tree :deep(.ant-tree)::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

/* 拖拽效果 */
.tree-node-title[draggable="true"] {
  cursor: move;
}

.tree-node-title[draggable="true"]:active {
  opacity: 0.6;
}
</style>
