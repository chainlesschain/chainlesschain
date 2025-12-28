<template>
  <div class="virtual-file-tree">
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
      <a-tooltip>
        <template #title>
          <div>已加载: {{ flattenedNodes.length }} / {{ totalFileCount }} 个节点</div>
        </template>
        <a-badge :count="flattenedNodes.length" :overflow-count="9999" style="margin-left: auto;">
          <FileOutlined />
        </a-badge>
      </a-tooltip>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="tree-loading">
      <a-spin size="small" />
      <span>加载中...</span>
    </div>

    <!-- 虚拟滚动文件树 -->
    <div
      v-else-if="flattenedNodes.length > 0"
      ref="scrollContainerRef"
      class="virtual-scroll-container"
      @scroll="handleScroll"
      @contextmenu="handleEmptySpaceRightClick"
    >
      <!-- 虚拟滚动占位 -->
      <div :style="{ height: totalHeight + 'px', position: 'relative' }">
        <!-- 只渲染可见节点 -->
        <div
          v-for="node in visibleNodes"
          :key="node.key"
          :style="{
            position: 'absolute',
            top: node.offsetTop + 'px',
            left: '0',
            right: '0',
            height: itemHeight + 'px'
          }"
          :class="[
            'tree-node',
            { 'tree-node-selected': selectedKeys.includes(node.key) },
            { 'tree-node-hover': hoverKey === node.key }
          ]"
          @click="handleNodeClick(node)"
          @contextmenu.prevent="handleRightClick($event, node)"
          @mouseenter="hoverKey = node.key"
          @mouseleave="hoverKey = null"
        >
          <!-- 缩进 -->
          <span :style="{ width: (node.level * 20) + 'px', display: 'inline-block' }"></span>

          <!-- 展开/折叠图标 -->
          <span class="expand-icon" @click.stop="handleToggleExpand(node)">
            <RightOutlined v-if="!node.isLeaf && !node.expanded" />
            <DownOutlined v-else-if="!node.isLeaf && node.expanded" />
            <span v-else style="width: 14px; display: inline-block;"></span>
          </span>

          <!-- 文件图标 -->
          <component :is="node.icon" class="node-icon" />

          <!-- 文件名 -->
          <span class="node-label">{{ node.title }}</span>

          <!-- Git状态标签 -->
          <a-tag
            v-if="gitStatus && node.filePath && gitStatus[node.filePath]"
            :color="getStatusColor(gitStatus[node.filePath])"
            size="small"
            class="git-status-tag"
          >
            {{ getStatusLabel(gitStatus[node.filePath]) }}
          </a-tag>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="tree-empty">
      <FolderOpenOutlined />
      <p>暂无文件</p>
    </div>

    <!-- 右键菜单 (保持原有实现) -->
    <div
      v-if="contextMenuVisible"
      class="context-menu-wrapper"
      :style="{
        position: 'fixed',
        left: contextMenuX + 'px',
        top: contextMenuY + 'px',
        zIndex: 9999
      }"
      @click.stop
    >
      <a-menu @click="handleMenuClick" mode="vertical" style="min-width: 200px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);">
        <a-menu-item key="newFile">
          <FileAddOutlined />
          新建文件
        </a-menu-item>
        <a-menu-item key="newFolder">
          <FolderAddOutlined />
          新建文件夹
        </a-menu-item>

        <template v-if="contextNode && !isEmptySpaceContext">
          <a-menu-divider />
          <a-menu-item key="open">
            <FolderOpenOutlined />
            打开
          </a-menu-item>
          <a-menu-item key="rename">
            <EditOutlined />
            重命名
          </a-menu-item>
          <a-menu-item key="copy">
            <CopyOutlined />
            复制
          </a-menu-item>
          <a-menu-item key="delete" danger>
            <DeleteOutlined />
            删除
          </a-menu-item>
          <a-menu-divider />
          <a-menu-item key="reveal">
            <FolderOpenOutlined />
            在文件管理器中显示
          </a-menu-item>
        </template>
      </a-menu>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import {
  ReloadOutlined,
  ShrinkOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  FileOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  RightOutlined,
  DownOutlined,
  EditOutlined,
  CopyOutlined,
  DeleteOutlined,
  CodeOutlined,
  Html5Outlined,
  FileMarkdownOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  PictureOutlined
} from '@ant-design/icons-vue';

// Props
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
    default: true,
  },
  projectId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['select', 'refresh', 'new-file', 'new-folder', 'rename', 'delete', 'copy', 'paste', 'reveal']);

// 虚拟滚动配置
const itemHeight = 28; // 每个节点的高度(px)
const overscan = 5; // 上下额外渲染的节点数量

// 响应式状态
const scrollContainerRef = ref(null);
const selectedKeys = ref([]);
const expandedKeys = ref(new Set());
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextNode = ref(null);
const isEmptySpaceContext = ref(false);
const hoverKey = ref(null);
const scrollTop = ref(0);
const containerHeight = ref(600);

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

// 节点缓存（用于快速查找和懒加载）
const nodeCache = ref(new Map());
const rootNodes = ref([]);
const totalFileCount = ref(0);

/**
 * 构建树形结构（懒加载友好）
 */
const buildTreeStructure = () => {
  console.log('[VirtualTree] 开始构建树结构，文件数:', props.files.length);

  if (!props.files || props.files.length === 0) {
    nodeCache.value.clear();
    rootNodes.value = [];
    totalFileCount.value = 0;
    return;
  }

  totalFileCount.value = props.files.length;

  const root = {};
  const pathToNodeMap = new Map();

  props.files.forEach((file) => {
    const filePath = file.file_path || file.path || file.file_name || '';
    const parts = filePath.split('/').filter(p => p);

    if (parts.length === 0 && file.file_name) {
      parts.push(file.file_name);
    }

    if (parts.length === 0) return;

    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!current[part]) {
        const isFolder = !isLast || file.is_folder;
        const node = {
          key: file.id || `node_${currentPath}`,
          title: part,
          path: currentPath,
          isLeaf: !isFolder,
          isFolder: isFolder,
          level: i,
          icon: getFileIcon(part, isFolder),
          fileData: isLast ? file : null,
          children: {},
          childrenLoaded: false, // 懒加载标记
        };

        current[part] = node;
        pathToNodeMap.set(currentPath, node);
      }

      current = current[part].children;
    }
  });

  // 转换为数组结构
  const convertToArray = (obj) => {
    return Object.values(obj).map(node => ({
      ...node,
      children: node.isFolder ? [] : undefined, // 懒加载：初始不加载子节点
      childrenKeys: node.isFolder ? Object.keys(node.children) : [], // 保存子节点的key用于懒加载
      _childrenData: node.children, // 保存原始children数据
    }));
  };

  rootNodes.value = convertToArray(root);

  // 缓存所有节点
  nodeCache.value.clear();
  rootNodes.value.forEach(node => cacheNode(node));

  console.log('[VirtualTree] 树结构构建完成，根节点数:', rootNodes.value.length);
};

// 缓存节点
const cacheNode = (node) => {
  nodeCache.value.set(node.key, node);
  if (node.children && node.children.length > 0) {
    node.children.forEach(child => cacheNode(child));
  }
};

/**
 * 懒加载子节点
 */
const loadChildren = (node) => {
  if (node.childrenLoaded || node.isLeaf) return;

  console.log('[VirtualTree] 懒加载子节点:', node.title);

  const convertToArray = (obj) => {
    return Object.values(obj).map(childNode => ({
      ...childNode,
      level: node.level + 1,
      children: childNode.isFolder ? [] : undefined,
      childrenKeys: childNode.isFolder ? Object.keys(childNode.children) : [],
      _childrenData: childNode.children,
    }));
  };

  node.children = convertToArray(node._childrenData);
  node.childrenLoaded = true;

  // 缓存新加载的子节点
  node.children.forEach(child => cacheNode(child));
};

/**
 * 扁平化可见节点（用于虚拟滚动）
 */
const flattenedNodes = computed(() => {
  const result = [];

  const flatten = (nodes, level = 0) => {
    nodes.forEach(node => {
      const nodeWithLevel = { ...node, level, expanded: expandedKeys.value.has(node.key) };
      result.push(nodeWithLevel);

      if (nodeWithLevel.expanded && !nodeWithLevel.isLeaf) {
        // 懒加载子节点
        if (!node.childrenLoaded) {
          loadChildren(node);
        }
        if (node.children && node.children.length > 0) {
          flatten(node.children, level + 1);
        }
      }
    });
  };

  flatten(rootNodes.value);

  console.log('[VirtualTree] 扁平化节点数:', result.length);
  return result;
});

// 总高度
const totalHeight = computed(() => flattenedNodes.value.length * itemHeight);

/**
 * 计算可见节点（虚拟滚动核心）
 */
const visibleNodes = computed(() => {
  const startIndex = Math.max(0, Math.floor(scrollTop.value / itemHeight) - overscan);
  const endIndex = Math.min(
    flattenedNodes.value.length,
    Math.ceil((scrollTop.value + containerHeight.value) / itemHeight) + overscan
  );

  const visible = flattenedNodes.value.slice(startIndex, endIndex).map((node, index) => ({
    ...node,
    offsetTop: (startIndex + index) * itemHeight,
  }));

  return visible;
});

// 滚动处理
const handleScroll = (event) => {
  scrollTop.value = event.target.scrollTop;
};

// 更新容器高度
const updateContainerHeight = () => {
  if (scrollContainerRef.value) {
    containerHeight.value = scrollContainerRef.value.clientHeight;
  }
};

// 节点点击
const handleNodeClick = (node) => {
  if (node.isLeaf) {
    selectedKeys.value = [node.key];
    emit('select', node.fileData);
  } else {
    handleToggleExpand(node);
  }
};

// 展开/折叠
const handleToggleExpand = (node) => {
  if (node.isLeaf) return;

  if (expandedKeys.value.has(node.key)) {
    expandedKeys.value.delete(node.key);
  } else {
    expandedKeys.value.add(node.key);
  }
  // 触发重新计算
  expandedKeys.value = new Set(expandedKeys.value);
};

// 折叠全部
const handleCollapseAll = () => {
  expandedKeys.value.clear();
  expandedKeys.value = new Set();
};

// 刷新
const handleRefresh = () => {
  emit('refresh');
};

// 新建文件
const handleNewFile = () => {
  emit('new-file');
};

// 新建文件夹
const handleNewFolder = () => {
  emit('new-folder');
};

// 右键菜单
const handleRightClick = (event, node) => {
  event.preventDefault();
  contextMenuVisible.value = true;
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextNode.value = node;
  isEmptySpaceContext.value = false;
};

const handleEmptySpaceRightClick = (event) => {
  event.preventDefault();
  contextMenuVisible.value = true;
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextNode.value = null;
  isEmptySpaceContext.value = true;
};

const handleMenuClick = ({ key }) => {
  contextMenuVisible.value = false;

  switch (key) {
    case 'newFile':
      emit('new-file', contextNode.value);
      break;
    case 'newFolder':
      emit('new-folder', contextNode.value);
      break;
    case 'open':
      if (contextNode.value) {
        emit('select', contextNode.value.fileData);
      }
      break;
    case 'rename':
      emit('rename', contextNode.value);
      break;
    case 'copy':
      emit('copy', contextNode.value);
      break;
    case 'delete':
      emit('delete', contextNode.value);
      break;
    case 'reveal':
      emit('reveal', contextNode.value);
      break;
  }
};

// Git状态相关
const getStatusColor = (status) => {
  const colorMap = {
    'M': 'orange',
    'A': 'green',
    'D': 'red',
    'U': 'purple',
    '??': 'blue'
  };
  return colorMap[status] || 'default';
};

const getStatusLabel = (status) => {
  const labelMap = {
    'M': '已修改',
    'A': '新增',
    'D': '已删除',
    'U': '未跟踪',
    '??': '未跟踪'
  };
  return labelMap[status] || status;
};

// 监听文件变化
watch(() => props.files, () => {
  buildTreeStructure();
}, { deep: true, immediate: true });

// 监听当前文件变化
watch(() => props.currentFileId, (newId) => {
  if (newId) {
    selectedKeys.value = [newId];
  }
});

// 生命周期
onMounted(() => {
  updateContainerHeight();
  window.addEventListener('resize', updateContainerHeight);
  document.addEventListener('click', () => {
    contextMenuVisible.value = false;
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateContainerHeight);
});
</script>

<style scoped lang="scss">
.virtual-file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.tree-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid #f0f0f0;
}

.tree-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: #999;
}

.virtual-scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.tree-node {
  display: flex;
  align-items: center;
  padding: 0 8px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;

  &:hover, &.tree-node-hover {
    background-color: #f5f5f5;
  }

  &.tree-node-selected {
    background-color: #e6f7ff;
  }
}

.expand-icon {
  width: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #666;

  &:hover {
    color: #1890ff;
  }
}

.node-icon {
  margin: 0 8px;
  color: #666;
}

.node-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.git-status-tag {
  margin-left: 8px;
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #999;

  .anticon {
    font-size: 48px;
    margin-bottom: 16px;
  }
}

.context-menu-wrapper {
  position: fixed;
  z-index: 9999;
}
</style>
