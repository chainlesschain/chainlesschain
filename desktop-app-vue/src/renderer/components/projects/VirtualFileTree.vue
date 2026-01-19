<template>
  <div class="virtual-file-tree">
    <a-spin
      :spinning="loading"
      tip="加载中..."
    >
      <div class="tree-header">
        <div class="tree-search">
          <a-input
            v-model:value="searchText"
            placeholder="搜索文件..."
            allow-clear
            @change="handleSearch"
          >
            <template #prefix>
              <SearchOutlined />
            </template>
          </a-input>
        </div>
        <div class="tree-actions">
          <a-button
            type="primary"
            size="small"
            :loading="importing"
            @click="handleImportFiles"
          >
            <template #icon>
              <ImportOutlined />
            </template>
            导入文件
          </a-button>
        </div>
      </div>

      <div
        ref="scrollContainerRef"
        class="tree-scroll-container"
        @scroll="handleScroll"
      >
        <!-- 虚拟滚动占位容器 -->
        <div :style="{ height: totalHeight + 'px', position: 'relative' }">
          <!-- 只渲染可见区域的节点 -->
          <div
            v-for="item in visibleItems"
            :key="item.key"
            :style="{
              position: 'absolute',
              top: item.top + 'px',
              left: 0,
              right: 0,
              height: itemHeight + 'px',
            }"
            :class="[
              'tree-node',
              {
                'tree-node-selected': item.key === currentFileId,
                'tree-node-folder': !item.isLeaf,
              },
            ]"
            @click="handleNodeClick(item)"
            @contextmenu.prevent="handleContextMenu($event, item)"
          >
            <div
              class="tree-node-content"
              :style="{ paddingLeft: item.level * 20 + 'px' }"
            >
              <!-- 展开/收起图标 -->
              <span
                v-if="!item.isLeaf"
                class="tree-node-switcher"
                @click.stop="toggleExpand(item)"
              >
                <RightOutlined
                  v-if="!item.expanded"
                  class="tree-icon"
                />
                <DownOutlined
                  v-else
                  class="tree-icon"
                />
              </span>
              <span
                v-else
                class="tree-node-switcher-placeholder"
              />

              <!-- 文件/文件夹图标 -->
              <component
                :is="getFileIcon(item)"
                :class="['tree-node-icon', getIconColor(item)]"
              />

              <!-- 文件名 -->
              <span
                class="tree-node-title"
                :title="item.title"
              >
                {{ item.title }}
              </span>

              <!-- Git状态标记 -->
              <a-tag
                v-if="item.gitStatus"
                :color="getGitStatusColor(item.gitStatus)"
                size="small"
                class="git-status-tag"
              >
                {{ item.gitStatus }}
              </a-tag>
            </div>
          </div>
        </div>
      </div>

      <!-- 右键菜单 -->
      <a-dropdown
        v-model:open="contextMenuVisible"
        :trigger="['contextmenu']"
      >
        <div />
        <template #overlay>
          <a-menu @click="handleMenuClick">
            <a-menu-item
              v-if="contextNode?.isLeaf"
              key="open"
            >
              <FileOutlined />
              打开
            </a-menu-item>
            <a-menu-item key="download">
              <DownloadOutlined />
              下载
            </a-menu-item>
            <a-menu-item key="export">
              <ExportOutlined />
              导出到外部
            </a-menu-item>
            <a-menu-divider />
            <a-menu-item key="rename">
              <EditOutlined />
              重命名
            </a-menu-item>
            <a-menu-item
              key="delete"
              danger
            >
              <DeleteOutlined />
              删除
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </a-spin>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, onMounted, onUnmounted, onUpdated, nextTick, h } from 'vue';
import { message } from 'ant-design-vue';
import {
  SearchOutlined,
  RightOutlined,
  DownOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  FileOutlined,
  FileTextOutlined,
  FileImageOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  CodeOutlined,
  EditOutlined,
  DeleteOutlined,
  ImportOutlined,
  ExportOutlined,
  DownloadOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  files: {
    type: Array,
    default: () => [],
  },
  currentFileId: {
    type: String,
    default: '',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  gitStatus: {
    type: Object,
    default: () => ({}),
  },
  projectId: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['select', 'refresh']);

// 虚拟滚动参数
const itemHeight = 32; // 每个节点的高度（px）
const bufferSize = 5; // 上下缓冲区节点数量
const scrollContainerRef = ref(null);
const scrollTop = ref(0);
const containerHeight = ref(600);

// 状态
const searchText = ref('');
const filteredFiles = ref([]); // 搜索过滤后的文件列表
const expandedKeys = ref(new Set()); // 展开的节点key
const contextMenuVisible = ref(false);
const contextNode = ref(null);
const importing = ref(false);
const exporting = ref(false);

// 扁平化的树节点列表（用于虚拟滚动）
const flattenedNodes = ref([]);

// 构建树形结构并扁平化
const buildTree = () => {
  // 使用过滤后的文件列表或原始文件列表
  const filesToUse = filteredFiles.value.length > 0 ? filteredFiles.value : props.files;

  logger.info('[VirtualFileTree] 开始构建文件树，文件数量:', filesToUse?.length || 0);

  if (!filesToUse || filesToUse.length === 0) {
    flattenedNodes.value = [];
    return;
  }

  // 1. 构建树形结构
  const root = {};

  filesToUse.forEach((file) => {
    const filePath = file.file_path || file.path || file.file_name || '';
    const parts = filePath.split('/').filter(p => p);

    let current = root;
    let currentPath = '';

    // 处理路径中的每一层
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!current[part]) {
        const isLeaf = i === parts.length - 1;
        current[part] = {
          key: isLeaf ? file.id : `folder_${currentPath}`,
          title: part,
          isLeaf: isLeaf,
          level: i,
          filePath: currentPath,
          children: isLeaf ? null : {},
          fileData: isLeaf ? file : null,
          expanded: expandedKeys.value.has(isLeaf ? file.id : `folder_${currentPath}`),
        };
      }

      current = current[part].children || current[part];
    }
  });

  // 2. 扁平化树结构（递归遍历）
  const flattened = [];

  const traverse = (node, level = 0, top = 0) => {
    const item = {
      ...node,
      level,
      top,
    };
    flattened.push(item);

    let nextTop = top + itemHeight;

    // 如果节点展开且有子节点，递归处理
    if (node.expanded && node.children) {
      const childKeys = Object.keys(node.children).sort();
      for (const key of childKeys) {
        const child = node.children[key];
        nextTop = traverse(child, level + 1, nextTop);
      }
    }

    return nextTop;
  };

  // 遍历根节点
  let top = 0;
  const rootKeys = Object.keys(root).sort();
  for (const key of rootKeys) {
    top = traverse(root[key], 0, top);
  }

  // 强制创建新引用，确保响应式
  flattenedNodes.value = [...flattened];
  logger.info('[VirtualFileTree] 扁平化完成，节点数量:', flattenedNodes.value.length);
};

// 监听文件列表变化 - 增强版
watch(
  () => props.files,
  async (newFiles, oldFiles) => {
    logger.info('[VirtualFileTree] 文件列表变化');
    logger.info('  旧长度:', oldFiles?.length || 0);
    logger.info('  新长度:', newFiles?.length || 0);
    logger.info('  引用改变:', newFiles !== oldFiles);

    buildTree();

    // 等待 DOM 更新
    await nextTick();
    logger.info('[VirtualFileTree] 树构建完成，节点数:', flattenedNodes.value.length);
  },
  { immediate: true, deep: true }
);

// 添加文件数量变化监听（备用）
watch(
  () => props.files?.length,
  (newLen, oldLen) => {
    if (newLen !== oldLen) {
      logger.info('[VirtualFileTree] 文件数量变化:', oldLen, '->', newLen);
      nextTick(() => buildTree());
    }
  }
);

// 监听展开状态变化
watch(
  () => expandedKeys.value.size,
  () => {
    buildTree();
  }
);

// 总高度
const totalHeight = computed(() => {
  return flattenedNodes.value.length * itemHeight;
});

// 可见区域的节点
const visibleItems = computed(() => {
  if (flattenedNodes.value.length === 0) {return [];}

  const startIndex = Math.max(0, Math.floor(scrollTop.value / itemHeight) - bufferSize);
  const endIndex = Math.min(
    flattenedNodes.value.length,
    Math.ceil((scrollTop.value + containerHeight.value) / itemHeight) + bufferSize
  );

  return flattenedNodes.value.slice(startIndex, endIndex);
});

// 滚动处理
const handleScroll = (e) => {
  scrollTop.value = e.target.scrollTop;
};

// 切换展开/收起
const toggleExpand = (item) => {
  if (item.isLeaf) {return;}

  if (expandedKeys.value.has(item.key)) {
    expandedKeys.value.delete(item.key);
  } else {
    expandedKeys.value.add(item.key);
  }

  // 触发响应式更新
  expandedKeys.value = new Set(expandedKeys.value);
};

// 节点点击
const handleNodeClick = (item) => {
  if (item.isLeaf && item.fileData) {
    emit('select', item.fileData);
  } else {
    toggleExpand(item);
  }
};

// 右键菜单
const handleContextMenu = (e, item) => {
  e.preventDefault();
  contextNode.value = item;
  contextMenuVisible.value = true;
};

const handleMenuClick = ({ key }) => {
  logger.info('Menu clicked:', key, contextNode.value);
  contextMenuVisible.value = false;

  switch (key) {
    case 'open':
      if (contextNode.value?.fileData) {
        emit('select', contextNode.value.fileData);
      }
      break;
    case 'download':
      handleDownloadFile(contextNode.value);
      break;
    case 'export':
      handleExportFile(contextNode.value);
      break;
    case 'rename':
      handleRenameFile(contextNode.value);
      break;
    case 'delete':
      handleDeleteFile(contextNode.value);
      break;
  }
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

    logger.info('[VirtualFileTree] 选择的文件:', result.filePaths);

    // 批量导入文件
    const importResult = await window.electron.project.importFiles({
      projectId: props.projectId,
      externalPaths: result.filePaths,
      targetDirectory: `/data/projects/${props.projectId}/` // 默认导入到项目根目录
    });

    logger.info('[VirtualFileTree] 导入结果:', importResult);

    if (importResult.success) {
      message.success(`成功导入 ${importResult.successCount}/${importResult.totalCount} 个文件`);

      // 刷新文件列表
      emit('refresh');
    } else {
      message.error('文件导入失败');
    }
  } catch (error) {
    logger.error('[VirtualFileTree] 导入文件失败:', error);
    message.error(`导入失败: ${error.message}`);
  } finally {
    importing.value = false;
  }
};

// 导出文件到外部
const handleExportFile = async (node) => {
  try {
    exporting.value = true;

    // 选择导出目录
    const result = await window.electron.project.selectExportDirectory();

    if (result.canceled || !result.path) {
      exporting.value = false;
      return;
    }

    logger.info('[VirtualFileTree] 导出节点:', node);
    logger.info('[VirtualFileTree] 导出到:', result.path);

    // 构建完整的项目路径
    const projectPath = `/data/projects/${props.projectId}/${node.filePath}`;
    const targetPath = `${result.path}\\${node.title}`;

    logger.info('[VirtualFileTree] 项目路径:', projectPath);
    logger.info('[VirtualFileTree] 目标路径:', targetPath);

    // 导出文件
    const exportResult = await window.electron.project.exportFile({
      projectPath: projectPath,
      targetPath: targetPath,
      isDirectory: !node.isLeaf
    });

    logger.info('[VirtualFileTree] 导出结果:', exportResult);

    if (exportResult.success) {
      message.success(`成功导出: ${node.title}`);
    } else {
      message.error(`文件导出失败: ${exportResult.error || '未知错误'}`);
    }
  } catch (error) {
    logger.error('[VirtualFileTree] 导出文件失败:', error);
    message.error(`导出失败: ${error.message}`);
  } finally {
    exporting.value = false;
  }
};

// 重命名文件
const handleRenameFile = async (node) => {
  if (!node) {
    message.warning('请选择要重命名的文件或文件夹');
    return;
  }

  try {
    // 使用 Modal 输入新名称
    const { Modal } = await import('ant-design-vue');

    Modal.confirm({
      title: '重命名',
      content: h('div', [
        h('p', { style: { marginBottom: '8px' } }, `当前名称: ${node.title}`),
        h('input', {
          id: 'rename-input',
          type: 'text',
          value: node.title,
          placeholder: '请输入新名称',
          style: {
            width: '100%',
            padding: '8px',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            fontSize: '14px'
          },
          onMounted: () => {
            // 自动聚焦并选中文件名（不包括扩展名）
            nextTick(() => {
              const input = document.getElementById('rename-input');
              if (input) {
                input.focus();
                const lastDotIndex = node.title.lastIndexOf('.');
                if (lastDotIndex > 0) {
                  input.setSelectionRange(0, lastDotIndex);
                } else {
                  input.select();
                }
              }
            });
          }
        })
      ]),
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        const input = document.getElementById('rename-input');
        const newName = input?.value?.trim();

        if (!newName) {
          message.warning('文件名不能为空');
          return Promise.reject();
        }

        if (newName === node.title) {
          message.info('文件名未改变');
          return;
        }

        // 验证文件名
        const invalidChars = /[<>:"/\\|?*]/;
        if (invalidChars.test(newName)) {
          message.error('文件名包含非法字符: < > : " / \\ | ? *');
          return Promise.reject();
        }

        try {
          // 调用后端 API 重命名文件
          if (node.fileData?.id) {
            const result = await window.electron.project.updateFile({
              fileId: node.fileData.id,
              projectId: props.projectId,
              title: newName,
              path: node.filePath.replace(node.title, newName)
            });

            if (result.success) {
              message.success('重命名成功');
              // 刷新文件列表
              emit('refresh');
            } else {
              message.error(`重命名失败: ${result.error || '未知错误'}`);
              return Promise.reject();
            }
          } else {
            message.error('无法获取文件信息');
            return Promise.reject();
          }
        } catch (error) {
          logger.error('[VirtualFileTree] 重命名失败:', error);

          let errorMessage = '重命名失败';
          if (error.message) {
            if (error.message.includes('exist')) {
              errorMessage = '文件名已存在';
            } else if (error.message.includes('permission')) {
              errorMessage = '没有权限重命名此文件';
            } else if (error.message.includes('not found')) {
              errorMessage = '文件不存在';
            } else {
              errorMessage = `重命名失败: ${error.message}`;
            }
          }

          message.error(errorMessage);
          return Promise.reject();
        }
      }
    });
  } catch (error) {
    logger.error('[VirtualFileTree] 打开重命名对话框失败:', error);
    message.error('打开重命名对话框失败');
  }
};

// 删除文件
const handleDeleteFile = async (node) => {
  if (!node) {
    message.warning('请选择要删除的文件或文件夹');
    return;
  }

  try {
    const { Modal } = await import('ant-design-vue');

    Modal.confirm({
      title: '确认删除',
      content: h('div', [
        h('p', { style: { color: '#ff4d4f', marginBottom: '8px' } }, '⚠️ 此操作不可恢复！'),
        h('p', `确定要删除 "${node.title}" 吗？`),
        node.isLeaf ? null : h('p', { style: { color: '#faad14', marginTop: '8px' } }, '注意：这将删除文件夹及其所有内容')
      ]),
      okText: '确定删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          if (!node.fileData?.id) {
            message.error('无法获取文件信息');
            return Promise.reject();
          }

          // 调用后端 API 删除文件
          const result = await window.electron.project.deleteFile(
            props.projectId,
            node.fileData.id
          );

          if (result.success) {
            message.success(`已删除: ${node.title}`);
            // 刷新文件列表
            emit('refresh');
          } else {
            message.error(`删除失败: ${result.error || '未知错误'}`);
            return Promise.reject();
          }
        } catch (error) {
          logger.error('[VirtualFileTree] 删除失败:', error);

          let errorMessage = '删除失败';
          if (error.message) {
            if (error.message.includes('permission')) {
              errorMessage = '没有权限删除此文件';
            } else if (error.message.includes('not found')) {
              errorMessage = '文件不存在';
            } else if (error.message.includes('in use')) {
              errorMessage = '文件正在使用中，无法删除';
            } else {
              errorMessage = `删除失败: ${error.message}`;
            }
          }

          message.error(errorMessage);
          return Promise.reject();
        }
      }
    });
  } catch (error) {
    logger.error('[VirtualFileTree] 打开删除确认对话框失败:', error);
    message.error('打开删除确认对话框失败');
  }
};

// 下载文件
const handleDownloadFile = async (node) => {
  if (!node) {
    message.warning('请选择要下载的文件或文件夹');
    return;
  }

  try {
    // 使用浏览器的下载功能
    if (node.fileData?.content) {
      // 如果文件内容在内存中，直接下载
      const blob = new Blob([node.fileData.content], {
        type: node.fileData.mimeType || 'application/octet-stream'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = node.title;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      message.success(`已下载: ${node.title}`);
    } else {
      // 否则，使用导出功能
      message.info('正在准备下载...');

      // 获取用户的下载目录
      const result = await window.electron.project.selectExportDirectory();

      if (result.canceled || !result.path) {
        return;
      }

      // 构建完整的项目路径
      const projectPath = `/data/projects/${props.projectId}/${node.filePath}`;
      const targetPath = `${result.path}\\${node.title}`;

      // 导出文件到下载目录
      const exportResult = await window.electron.project.exportFile({
        projectPath: projectPath,
        targetPath: targetPath,
        isDirectory: !node.isLeaf
      });

      if (exportResult.success) {
        message.success(`已下载到: ${result.path}`);
      } else {
        message.error(`下载失败: ${exportResult.error || '未知错误'}`);
      }
    }
  } catch (error) {
    logger.error('[VirtualFileTree] 下载失败:', error);

    let errorMessage = '下载失败';
    if (error.message) {
      if (error.message.includes('permission')) {
        errorMessage = '没有权限访问此文件';
      } else if (error.message.includes('not found')) {
        errorMessage = '文件不存在';
      } else if (error.message.includes('too large')) {
        errorMessage = '文件过大，无法下载';
      } else {
        errorMessage = `下载失败: ${error.message}`;
      }
    }

    message.error(errorMessage);
  }
};

// 搜索
const handleSearch = () => {
  try {
    const query = searchText.value.trim().toLowerCase();
    logger.info('[VirtualFileTree] 搜索:', query);

    if (!query) {
      // 清空搜索，显示所有文件
      filteredFiles.value = [];
      buildTree();
      return;
    }

    // 搜索匹配的文件
    const matches = props.files.filter(file => {
      const fileName = (file.file_name || file.title || '').toLowerCase();
      const filePath = (file.file_path || file.path || '').toLowerCase();
      const content = (file.content || '').toLowerCase();

      // 匹配文件名、路径或内容
      return fileName.includes(query) ||
             filePath.includes(query) ||
             content.includes(query);
    });

    logger.info('[VirtualFileTree] 搜索结果:', matches.length, '个文件');

    if (matches.length === 0) {
      message.info('未找到匹配的文件');
    } else {
      message.success(`找到 ${matches.length} 个匹配的文件`);
    }

    filteredFiles.value = matches;

    // 自动展开所有包含搜索结果的文件夹
    if (matches.length > 0) {
      const pathsToExpand = new Set();
      matches.forEach(file => {
        const filePath = file.file_path || file.path || file.file_name || '';
        const parts = filePath.split('/').filter(p => p);

        // 添加所有父路径到展开列表
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
          pathsToExpand.add(`folder_${currentPath}`);
        }
      });

      expandedKeys.value = pathsToExpand;
    }

    // 重新构建树
    buildTree();
  } catch (error) {
    logger.error('[VirtualFileTree] 搜索失败:', error);
    message.error('搜索失败: ' + (error.message || '未知错误'));
  }
};

// 获取文件图标
const getFileIcon = (item) => {
  if (!item.isLeaf) {
    return item.expanded ? FolderOpenOutlined : FolderOutlined;
  }

  const ext = item.title.split('.').pop()?.toLowerCase();
  const iconMap = {
    md: FileTextOutlined,
    txt: FileTextOutlined,
    doc: FileTextOutlined,
    docx: FileTextOutlined,
    pdf: FilePdfOutlined,
    png: FileImageOutlined,
    jpg: FileImageOutlined,
    jpeg: FileImageOutlined,
    gif: FileImageOutlined,
    svg: FileImageOutlined,
    xls: FileExcelOutlined,
    xlsx: FileExcelOutlined,
    js: CodeOutlined,
    ts: CodeOutlined,
    vue: CodeOutlined,
    jsx: CodeOutlined,
    tsx: CodeOutlined,
    html: CodeOutlined,
    css: CodeOutlined,
    json: CodeOutlined,
  };

  return iconMap[ext] || FileOutlined;
};

const getIconColor = (item) => {
  if (!item.isLeaf) {return 'folder-icon';}

  const ext = item.title.split('.').pop()?.toLowerCase();
  const colorMap = {
    md: 'text-blue-500',
    js: 'text-yellow-500',
    ts: 'text-blue-600',
    vue: 'text-green-500',
    html: 'text-orange-500',
    css: 'text-blue-400',
    json: 'text-gray-500',
  };

  return colorMap[ext] || 'file-icon';
};

const getGitStatusColor = (status) => {
  const colorMap = {
    modified: 'orange',
    added: 'green',
    deleted: 'red',
    untracked: 'blue',
  };
  return colorMap[status] || 'default';
};

// 获取容器高度
const updateContainerHeight = () => {
  if (scrollContainerRef.value) {
    containerHeight.value = scrollContainerRef.value.clientHeight;
  }
};

onMounted(() => {
  logger.info('[VirtualFileTree] onMounted, files:', props.files?.length || 0);
  updateContainerHeight();
  window.addEventListener('resize', updateContainerHeight);
});

onUpdated(() => {
  logger.info('[VirtualFileTree] onUpdated, files:', props.files?.length || 0);
});

onUnmounted(() => {
  logger.info('[VirtualFileTree] onUnmounted');
  window.removeEventListener('resize', updateContainerHeight);
});
</script>

<style scoped lang="scss">
.virtual-file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.tree-header {
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.tree-search {
  padding: 8px;
}

.tree-actions {
  padding: 0 8px 8px 8px;
  display: flex;
  gap: 8px;
}

.tree-scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: #f1f1f1;
  }

  &::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 3px;

    &:hover {
      background: #555;
    }
  }
}

.tree-node {
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: #f5f5f5;
  }

  &.tree-node-selected {
    background-color: #e6f7ff;
  }
}

.tree-node-content {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 4px;
}

.tree-node-switcher {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  .tree-icon {
    font-size: 10px;
    color: #666;
  }

  &:hover .tree-icon {
    color: #1890ff;
  }
}

.tree-node-switcher-placeholder {
  width: 16px;
  display: inline-block;
  flex-shrink: 0;
}

.tree-node-icon {
  font-size: 16px;
  flex-shrink: 0;

  &.folder-icon {
    color: #faad14;
  }

  &.file-icon {
    color: #8c8c8c;
  }
}

.tree-node-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #262626;
}

.git-status-tag {
  margin-left: auto;
  font-size: 10px;
  padding: 0 4px;
  height: 18px;
  line-height: 18px;
}
</style>
