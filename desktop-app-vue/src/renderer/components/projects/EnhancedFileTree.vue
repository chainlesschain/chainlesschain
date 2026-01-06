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
      <a-tooltip title="导入文件">
        <a-button type="text" size="small" @click="handleImportFiles" :loading="importing">
          <ImportOutlined />
        </a-button>
      </a-tooltip>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="tree-loading">
      <a-spin size="small" />
      <span>加载中...</span>
    </div>

    <!-- 文件树 -->
    <div
      v-else-if="treeData.length > 0"
      class="tree-container"
      @contextmenu="handleEmptySpaceRightClick"
    >
      <a-tree
        :tree-data="treeData"
        :selected-keys="selectedKeys"
        :expanded-keys="expandedKeys"
        :show-icon="false"
        @select="handleSelect"
        @expand="handleExpand"
      >
      <template #title="{ title, isLeaf, dataRef }">
        <div
          class="tree-node-title"
          :draggable="enableDrag"
          @dragstart="handleDragStart($event, dataRef)"
          @dragover="handleDragOver($event, dataRef)"
          @dragleave="handleDragLeave"
          @drop="handleDrop($event, dataRef)"
          @contextmenu.prevent="handleNodeContextMenu($event, dataRef)"
        >
          <component :is="dataRef.icon" class="node-icon" v-if="dataRef.icon" />
          <span class="node-label">{{ title }}</span>
          <a-tag
            v-if="gitStatus && dataRef.filePath && gitStatus[dataRef.filePath]"
            :color="getStatusColor(gitStatus[dataRef.filePath])"
            size="small"
            class="git-status-tag"
          >
            {{ getStatusLabel(gitStatus[dataRef.filePath]) }}
          </a-tag>
        </div>
      </template>
      </a-tree>
    </div>

    <!-- 空状态 -->
    <div v-else class="tree-empty">
      <FolderOpenOutlined />
      <p>暂无文件</p>
    </div>

    <!-- 点击外部关闭菜单的遮罩（必须在菜单之前渲染） -->
    <div
      v-show="contextMenuVisible"
      class="context-menu-backdrop"
      @click="contextMenuVisible = false"
      @contextmenu.prevent="contextMenuVisible = false"
    ></div>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div
        v-show="contextMenuVisible"
        class="context-menu-wrapper"
        :style="{
          position: 'fixed',
          left: contextMenuX + 'px',
          top: contextMenuY + 'px',
          zIndex: 10000
        }"
        @click.stop
        @contextmenu.prevent
      >
        <a-menu @click="handleMenuClick" mode="vertical" style="min-width: 200px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); background: white;">
            <!-- 新建操作（空白处和节点右键都显示） -->
            <a-menu-item key="newFile">
              <FileAddOutlined />
              新建文件
            </a-menu-item>
            <a-menu-item key="newFolder">
              <FolderAddOutlined />
              新建文件夹
            </a-menu-item>

            <!-- 以下选项仅在节点右键时显示 -->
            <template v-if="!isEmptySpaceContext">
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
              <a-menu-item key="cut" :disabled="!contextNode">
                <ScissorOutlined />
                剪切
              </a-menu-item>
              <a-menu-item key="paste" :disabled="!clipboard">
                <SnippetsOutlined />
                粘贴{{ clipboard ? ` (${clipboard.operation === 'cut' ? '移动' : '复制'})` : '' }}
              </a-menu-item>

              <a-menu-divider />

              <!-- 打开方式 -->
              <a-menu-item key="openDefault" :disabled="!contextNode || !contextNode.isLeaf">
                <FileOutlined />
                打开
              </a-menu-item>
              <a-menu-item key="openWith" :disabled="!contextNode || !contextNode.isLeaf">
                <FolderOpenOutlined />
                打开方式...
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

              <a-menu-divider />

              <!-- 导入导出操作 -->
              <a-menu-item key="export" :disabled="!contextNode">
                <ExportOutlined />
                导出到外部
              </a-menu-item>
            </template>
        </a-menu>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, h, nextTick, onMounted, onUpdated } from 'vue';
import { message, Modal, Input } from 'ant-design-vue';
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
  ScissorOutlined,
  SnippetsOutlined,
  LinkOutlined,
  ImportOutlined,
  ExportOutlined,
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
const isEmptySpaceContext = ref(false); // 标记是否为空白处右键
const importing = ref(false); // 导入状态
const exporting = ref(false); // 导出状态

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
  doc: FileTextOutlined,
  docx: FileTextOutlined,
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
  console.log('[EnhancedFileTree] ========== treeData computed 执行 ==========');
  console.log('[EnhancedFileTree] props.files:', props.files?.length || 0);
  console.log('[EnhancedFileTree] 时间戳:', Date.now());

  if (!props.files || props.files.length === 0) {
    console.log('[EnhancedFileTree] 文件列表为空，返回空数组');
    return [];
  }

  console.log('[EnhancedFileTree] 文件数量:', props.files.length);

  console.log('[FileTree] 前3个文件对象:');
  props.files.slice(0, 3).forEach((file, idx) => {
    console.log(`[FileTree] [${idx}]:`, {
      id: file.id,
      file_name: file.file_name,
      file_path: file.file_path,
      is_folder: file.is_folder,
      file_type: file.file_type
    });
  });

  // 构建树形结构
  const root = {};
  let validFileCount = 0;
  let skippedFileCount = 0;

  props.files.forEach((file, index) => {
    const filePath = file.file_path || file.path || file.file_name || '';
    const parts = filePath.split('/').filter(p => p);

    // 特殊处理根目录文件（路径为空但有文件名）
    if (parts.length === 0 && file.file_name) {
      parts.push(file.file_name);
    }

    // 如果仍然没有路径，跳过该文件
    if (parts.length === 0) {
      skippedFileCount++;
      console.warn(`[FileTree] ⏭️  跳过文件 [${index}] (路径为空):`, file);
      return;
    }

    validFileCount++;

    let current = root;

    // 构建路径层级
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');

      if (!current[part]) {
        current[part] = {
          name: part,
          path: currentPath,
          isFolder: !isLast || file.is_folder,
          children: {},
          fileData: isLast ? file : null
        };
      }

      current = current[part].children;
    }
  });

  // 将对象结构转换为 Ant Design Tree 需要的数组结构
  const convertToTreeNodes = (obj) => {
    const nodes = [];

    Object.keys(obj).forEach(key => {
      const item = obj[key];
      const isFolder = item.isFolder || Object.keys(item.children).length > 0;

      const node = {
        key: item.fileData?.id || `node_${item.path}` || `temp_${Math.random().toString(36).substring(7)}`,
        title: item.name,
        isLeaf: !isFolder,
        icon: getFileIcon(item.name, isFolder),
        filePath: item.path,
        fileData: item.fileData || null, // 保留完整文件数据对象
        fileType: item.fileData?.file_type || (isFolder ? 'folder' : ''), // 添加文件类型标记
        children: isFolder ? convertToTreeNodes(item.children) : []
      };

      if (isFolder) {
        nodes.unshift(node); // 文件夹放在前面
      } else {
        nodes.push(node); // 文件放在后面
      }
    });

    // 排序：文件夹按名称排序，文件也按名称排序
    const folders = nodes.filter(n => !n.isLeaf).sort((a, b) => a.title.localeCompare(b.title));
    const files = nodes.filter(n => n.isLeaf).sort((a, b) => a.title.localeCompare(b.title));

    return [...folders, ...files];
  };

  const result = convertToTreeNodes(root);

  console.log('[EnhancedFileTree] 树构建完成，节点数:', result.length);
  console.log('[EnhancedFileTree] ========== treeData computed 结束 ==========');

  return result;
});

// 显式监听 props.files 变化
watch(
  () => props.files,
  (newFiles, oldFiles) => {
    console.log('[EnhancedFileTree] Files prop 变化');
    console.log('  旧:', oldFiles?.length || 0);
    console.log('  新:', newFiles?.length || 0);
    console.log('  引用:', newFiles !== oldFiles ? '已改变' : '相同');

    // 强制 treeData computed 重新计算
    if (newFiles && newFiles.length > 0) {
      nextTick(() => {
        console.log('[EnhancedFileTree] 触发 treeData 重新计算');
        const _ = treeData.value;  // 访问 computed 强制计算
      });
    }
  },
  { immediate: true, deep: true }
);

// 文件数量变化监听（备用）
watch(
  () => props.files?.length,
  (newLen, oldLen) => {
    if (newLen !== oldLen) {
      console.log('[EnhancedFileTree] 文件数量变化:', oldLen, '->', newLen);
    }
  }
);

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

// 处理节点右键点击（直接在模板上绑定 contextmenu 事件）
const handleNodeContextMenu = (event, node) => {
  event.preventDefault();
  event.stopPropagation(); // 阻止事件冒泡到容器
  contextNode.value = node;
  isEmptySpaceContext.value = false; // 这是节点右键
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextMenuVisible.value = true;
};

// 处理空白处右键点击
const handleEmptySpaceRightClick = (event) => {
  // 检查点击的目标是否是树节点
  const target = event.target;
  const isTreeNode = target.closest('.tree-node-title') ||
                     target.closest('.ant-tree-node-content-wrapper') ||
                     target.classList.contains('ant-tree-treenode');

  // 如果点击的是节点，不处理（节点的 contextmenu 事件会处理）
  if (isTreeNode) {
    return;
  }

  event.preventDefault();
  contextNode.value = null; // 清空当前节点
  isEmptySpaceContext.value = true; // 这是空白处右键
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
    case 'cut':
      handleCut();
      break;
    case 'paste':
      handlePaste();
      break;
    case 'openDefault':
      handleOpenDefault();
      break;
    case 'openWith':
      handleOpenWith();
      break;
    case 'copyPath':
      handleCopyPath();
      break;
    case 'reveal':
      handleReveal();
      break;
    case 'export':
      handleExport();
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
const handleNewFile = async () => {
  let fileName = 'newfile.md';

  Modal.confirm({
    title: '新建文件',
    content: h('div', [
      h('p', { style: { marginBottom: '8px' } }, '请输入文件名：'),
      h(Input, {
        defaultValue: fileName,
        placeholder: '请输入文件名',
        onInput: (e) => {
          fileName = e.target.value;
        },
        onKeydown: (e) => {
          if (e.key === 'Enter') {
            Modal.destroyAll();
            createFile();
          }
        }
      })
    ]),
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      await createFile();
    }
  });

  const createFile = async () => {
    if (!fileName || !fileName.trim()) {
      message.warning('请输入文件名');
      return;
    }

    try {
      // 计算文件路径
      const parentPath = contextNode.value?.filePath || '';
      const filePath = parentPath ? `${parentPath}/${fileName.trim()}` : fileName.trim();

      await window.electronAPI.file.createFile({
        projectId: props.projectId,
        filePath,
        content: ''
      });

      message.success('文件创建成功');
      emit('refresh');
    } catch (error) {
      console.error('创建文件失败:', error);
      message.error('创建文件失败：' + error.message);
    }
  };
};

// 新建文件夹
const handleNewFolder = async () => {
  let folderName = 'newfolder';

  Modal.confirm({
    title: '新建文件夹',
    content: h('div', [
      h('p', { style: { marginBottom: '8px' } }, '请输入文件夹名：'),
      h(Input, {
        defaultValue: folderName,
        placeholder: '请输入文件夹名',
        onInput: (e) => {
          folderName = e.target.value;
        },
        onKeydown: (e) => {
          if (e.key === 'Enter') {
            Modal.destroyAll();
            createFolder();
          }
        }
      })
    ]),
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      await createFolder();
    }
  });

  const createFolder = async () => {
    if (!folderName || !folderName.trim()) {
      message.warning('请输入文件夹名');
      return;
    }

    try {
      // 计算文件夹路径
      const parentPath = contextNode.value?.filePath || '';
      const folderPath = parentPath ? `${parentPath}/${folderName.trim()}` : folderName.trim();

      await window.electronAPI.file.createFolder({
        projectId: props.projectId,
        folderPath
      });

      message.success('文件夹创建成功');
      emit('refresh');
    } catch (error) {
      console.error('创建文件夹失败:', error);
      message.error('创建文件夹失败：' + error.message);
    }
  };
};

// 重命名
const handleRename = async () => {
  if (!contextNode.value) return;

  const currentName = contextNode.value.title;
  let newName = currentName;

  Modal.confirm({
    title: '重命名',
    content: h('div', [
      h('p', { style: { marginBottom: '8px' } }, '请输入新名称：'),
      h(Input, {
        defaultValue: currentName,
        placeholder: '请输入新名称',
        onInput: (e) => {
          newName = e.target.value;
        },
        onKeydown: (e) => {
          if (e.key === 'Enter') {
            Modal.destroyAll();
            performRename();
          }
        }
      })
    ]),
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      await performRename();
    }
  });

  const performRename = async () => {
    if (!newName || !newName.trim()) {
      message.warning('请输入新名称');
      return;
    }

    if (newName.trim() === currentName) {
      return; // 名称未改变，不执行操作
    }

    try {
      await window.electronAPI.file.renameItem({
        projectId: props.projectId,
        oldPath: contextNode.value.filePath,
        newName: newName.trim()
      });

      message.success('重命名成功');
      emit('refresh');
    } catch (error) {
      console.error('重命名失败:', error);
      message.error('重命名失败：' + error.message);
    }
  };
};

// 删除
const handleDelete = async () => {
  if (!contextNode.value) return;

  Modal.confirm({
    title: '确认删除',
    content: `确定要删除 "${contextNode.value.title}" 吗？`,
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.file.deleteItem({
          projectId: props.projectId,
          filePath: contextNode.value.filePath
        });

        message.success('删除成功');
        emit('refresh');
      } catch (error) {
        console.error('删除失败:', error);
        message.error('删除失败：' + error.message);
      }
    }
  });
};

// 复制（同时复制到系统剪贴板）
const handleCopy = async () => {
  if (!contextNode.value) return;

  // 内部剪贴板（用于项目内部复制粘贴）
  clipboard.value = {
    node: contextNode.value,
    operation: 'copy'
  };

  try {
    // 复制到系统剪贴板（用于跨项目/跨应用复制粘贴）
    const fullPath = `/data/projects/${props.projectId}/${contextNode.value.filePath}`;

    // 调用Electron API将文件路径写入系统剪贴板
    await window.electronAPI.file.copyToSystemClipboard({
      projectId: props.projectId,
      filePath: contextNode.value.filePath,
      fullPath: fullPath,
      isDirectory: !contextNode.value.isLeaf,
      fileName: contextNode.value.title
    });

    console.log('[EnhancedFileTree] 已复制文件到系统剪贴板:', contextNode.value.title);
    message.success(`已复制: ${contextNode.value.title}（可粘贴到任何位置）`);
  } catch (error) {
    console.error('[EnhancedFileTree] 复制到系统剪贴板失败:', error);
    // 即使系统剪贴板失败，内部剪贴板仍然可用
    message.success(`已复制: ${contextNode.value.title}（仅限项目内粘贴）`);
  }
};

// 剪切（同时复制到系统剪贴板）
const handleCut = async () => {
  if (!contextNode.value) return;

  // 内部剪贴板
  clipboard.value = {
    node: contextNode.value,
    operation: 'cut'
  };

  try {
    // 复制到系统剪贴板（标记为剪切）
    const fullPath = `/data/projects/${props.projectId}/${contextNode.value.filePath}`;

    await window.electronAPI.file.cutToSystemClipboard({
      projectId: props.projectId,
      filePath: contextNode.value.filePath,
      fullPath: fullPath,
      isDirectory: !contextNode.value.isLeaf,
      fileName: contextNode.value.title
    });

    console.log('[EnhancedFileTree] 已剪切文件到系统剪贴板:', contextNode.value.title);
    message.success(`已剪切: ${contextNode.value.title}（可移动到任何位置）`);
  } catch (error) {
    console.error('[EnhancedFileTree] 剪切到系统剪贴板失败:', error);
    message.success(`已剪切: ${contextNode.value.title}（仅限项目内移动）`);
  }
};

// 粘贴（支持系统剪贴板）
const handlePaste = async () => {
  try {
    // 1. 首先尝试从系统剪贴板粘贴
    let systemClipboardResult = null;
    try {
      systemClipboardResult = await window.electronAPI.file.pasteFromSystemClipboard();
      console.log('[EnhancedFileTree] 系统剪贴板内容:', systemClipboardResult);
    } catch (error) {
      console.log('[EnhancedFileTree] 系统剪贴板为空或读取失败:', error);
    }

    // 确定目标路径
    let targetPath = '';
    if (contextNode.value) {
      if (contextNode.value.isLeaf) {
        // 如果右键点击的是文件，粘贴到其父目录
        const parts = contextNode.value.filePath.split('/');
        parts.pop();
        targetPath = parts.join('/');
      } else {
        // 如果是文件夹，粘贴到这个文件夹
        targetPath = contextNode.value.filePath;
      }
    }

    // 2. 如果系统剪贴板有内容，优先从系统剪贴板粘贴
    if (systemClipboardResult && systemClipboardResult.hasFiles) {
      console.log('[EnhancedFileTree] 从系统剪贴板粘贴文件:', systemClipboardResult);

      const result = await window.electronAPI.file.importFromSystemClipboard({
        projectId: props.projectId,
        targetPath: targetPath,
        clipboardData: systemClipboardResult
      });

      if (result.success) {
        message.success(`已从系统剪贴板粘贴 ${result.count} 个文件`);
        emit('refresh');
        return;
      }
    }

    // 3. 否则使用内部剪贴板
    if (!clipboard.value) {
      message.warning('剪贴板为空，请先复制或剪切文件');
      return;
    }

    const { node, operation } = clipboard.value;

    console.log('[EnhancedFileTree] 内部剪贴板粘贴操作:', {
      operation,
      sourcePath: node.filePath,
      targetPath,
      isEmptySpace: isEmptySpaceContext.value
    });

    // 检查是否粘贴到自己
    if (node.filePath === targetPath) {
      message.warning('不能粘贴到相同位置');
      return;
    }

    // 检查是否粘贴到自己的子目录（防止循环）
    if (targetPath.startsWith(node.filePath + '/')) {
      message.warning('不能粘贴到自己的子目录');
      return;
    }

    if (operation === 'copy') {
      // 复制操作
      await window.electronAPI.file.copyItem({
        projectId: props.projectId,
        sourcePath: node.filePath,
        targetPath
      });
      message.success(`已复制 "${node.title}" 到 "${targetPath || '根目录'}"`);
    } else if (operation === 'cut') {
      // 剪切操作（移动）
      await window.electronAPI.file.moveItem({
        projectId: props.projectId,
        sourcePath: node.filePath,
        targetPath
      });
      message.success(`已移动 "${node.title}" 到 "${targetPath || '根目录'}"`);
      clipboard.value = null; // 剪切后清空剪贴板
    }

    emit('refresh');
  } catch (error) {
    console.error('[EnhancedFileTree] 粘贴失败:', error);
    message.error('粘贴失败：' + error.message);
  }
};

// 用默认程序打开文件
const handleOpenDefault = async () => {
  if (!contextNode.value || !contextNode.value.isLeaf) return;

  try {
    await window.electronAPI.file.openWithDefault({
      projectId: props.projectId,
      filePath: contextNode.value.filePath
    });
    message.success('文件已打开');
  } catch (error) {
    console.error('打开文件失败:', error);
    message.error('打开文件失败：' + error.message);
  }
};

// 选择程序打开文件
const handleOpenWith = async () => {
  if (!contextNode.value || !contextNode.value.isLeaf) return;

  try {
    await window.electronAPI.file.openWith({
      projectId: props.projectId,
      filePath: contextNode.value.filePath
    });
    // 注意：Windows 会显示"打开方式"对话框，用户可以选择程序
    // macOS 和 Linux 的行为可能不同
  } catch (error) {
    console.error('打开"打开方式"对话框失败:', error);
    message.error(error.message || '打开失败');
  }
};

// 复制路径
const handleCopyPath = () => {
  if (!contextNode.value) return;
  navigator.clipboard.writeText(contextNode.value.filePath || '');
  message.success('路径已复制到剪贴板');
};

// 在文件管理器中显示
const handleReveal = async () => {
  if (!contextNode.value) return;

  try {
    await window.electronAPI.file.revealInExplorer({
      projectId: props.projectId,
      filePath: contextNode.value.filePath
    });
    message.success('已在文件管理器中显示');
  } catch (error) {
    console.error('打开文件管理器失败:', error);
    message.error('打开文件管理器失败：' + error.message);
  }
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

// 导入文件
const handleImportFiles = async () => {
  try {
    importing.value = true;

    // 选择要导入的文件
    const result = await window.electron.project.selectImportFiles({
      allowDirectory: true
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      importing.value = false;
      return;
    }

    console.log('[EnhancedFileTree] 选择的文件:', result.filePaths);

    // 批量导入文件
    const importResult = await window.electron.project.importFiles({
      projectId: props.projectId,
      externalPaths: result.filePaths,
      targetDirectory: `/data/projects/${props.projectId}/`
    });

    console.log('[EnhancedFileTree] 导入结果:', importResult);

    if (importResult.success) {
      message.success(`成功导入 ${importResult.successCount}/${importResult.totalCount} 个文件`);
      emit('refresh');
    } else {
      message.error('文件导入失败');
    }
  } catch (error) {
    console.error('[EnhancedFileTree] 导入文件失败:', error);
    message.error(`导入失败: ${error.message}`);
  } finally {
    importing.value = false;
  }
};

// 导出文件到外部
const handleExport = async () => {
  if (!contextNode.value) return;

  try {
    exporting.value = true;

    // 选择导出目录
    const result = await window.electron.project.selectExportDirectory();

    if (result.canceled || !result.path) {
      exporting.value = false;
      return;
    }

    console.log('[EnhancedFileTree] 导出节点:', contextNode.value);
    console.log('[EnhancedFileTree] 导出到:', result.path);

    // 构建完整的项目路径
    const projectPath = `/data/projects/${props.projectId}/${contextNode.value.filePath}`;
    const targetPath = `${result.path}\\${contextNode.value.title}`;

    console.log('[EnhancedFileTree] 项目路径:', projectPath);
    console.log('[EnhancedFileTree] 目标路径:', targetPath);

    // 导出文件
    const exportResult = await window.electron.project.exportFile({
      projectPath: projectPath,
      targetPath: targetPath,
      isDirectory: !contextNode.value.isLeaf
    });

    console.log('[EnhancedFileTree] 导出结果:', exportResult);

    if (exportResult.success) {
      message.success(`成功导出: ${contextNode.value.title}`);
    } else {
      message.error(`文件导出失败: ${exportResult.error || '未知错误'}`);
    }
  } catch (error) {
    console.error('[EnhancedFileTree] 导出文件失败:', error);
    message.error(`导出失败: ${error.message}`);
  } finally {
    exporting.value = false;
  }
};

// 生命周期
onMounted(() => {
  // 组件已挂载
});

onUpdated(() => {
  // 组件已更新
});
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

/* 树容器 */
.tree-container {
  flex: 1;
  overflow-y: auto;
  background: transparent;
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

/* 右键菜单遮罩 */
.context-menu-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9998;
  background: transparent;
}

/* 右键菜单包装器 */
.context-menu-wrapper {
  position: fixed;
  z-index: 10000;
}
</style>
