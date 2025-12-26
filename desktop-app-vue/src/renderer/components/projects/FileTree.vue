<template>
  <div class="file-tree">
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
      @select="handleSelect"
      @expand="handleExpand"
    >
      <template #title="{ title, isLeaf, icon, filePath }">
        <div class="tree-node-title">
          <component :is="icon" class="node-icon" />
          <span>{{ title }}</span>
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  FolderOutlined,
  FolderOpenOutlined,
  FileOutlined,
  FileTextOutlined,
  CodeOutlined,
  PictureOutlined,
  FileMarkdownOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  Html5Outlined,
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
});

const emit = defineEmits(['select']);

// 响应式状态
const selectedKeys = ref([]);
const expandedKeys = ref([]);

// 文件图标映射
const fileIconMap = {
  // 代码文件
  js: CodeOutlined,
  jsx: CodeOutlined,
  ts: CodeOutlined,
  tsx: CodeOutlined,
  vue: CodeOutlined,
  py: CodeOutlined,
  java: CodeOutlined,
  cpp: CodeOutlined,
  c: CodeOutlined,
  go: CodeOutlined,
  rs: CodeOutlined,
  php: CodeOutlined,
  rb: CodeOutlined,

  // Web文件
  html: Html5Outlined,
  htm: Html5Outlined,
  css: CodeOutlined,
  scss: CodeOutlined,
  sass: CodeOutlined,
  less: CodeOutlined,

  // 文档文件
  md: FileMarkdownOutlined,
  markdown: FileMarkdownOutlined,
  txt: FileTextOutlined,
  doc: FileTextOutlined,
  docx: FileTextOutlined,
  pdf: FilePdfOutlined,
  xls: FileExcelOutlined,
  xlsx: FileExcelOutlined,

  // 图片文件
  jpg: PictureOutlined,
  jpeg: PictureOutlined,
  png: PictureOutlined,
  gif: PictureOutlined,
  svg: PictureOutlined,
  ico: PictureOutlined,

  // 配置文件
  json: FileTextOutlined,
  yaml: FileTextOutlined,
  yml: FileTextOutlined,
  xml: FileTextOutlined,
  ini: FileTextOutlined,
  toml: FileTextOutlined,
};

// 获取文件扩展名
const getFileExtension = (filename) => {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

// 获取文件图标
const getFileIcon = (filename, isLeaf) => {
  if (!isLeaf) {
    return FolderOutlined;
  }

  const ext = getFileExtension(filename);
  return fileIconMap[ext] || FileOutlined;
};

// 构建树形结构
const buildTree = (files) => {
  // 按路径分组
  const tree = {};

  files.forEach(file => {
    const filePath = file.file_path || file.file_name || 'untitled';
    console.log('[FileTree] 处理文件:', filePath, 'file对象:', file);
    // 支持 Windows 和 Unix 路径分隔符
    const parts = filePath.split(/[\\/]/);
    let current = tree;

    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = {
          name: part,
          isLeaf: index === parts.length - 1,
          fileId: index === parts.length - 1 ? file.id : null,
          children: {},
        };
      }
      current = current[part].children;
    });
  });

  // 转换为ant-design-vue树形数据格式
  const convertToTreeData = (obj, path = '') => {
    return Object.keys(obj).map(key => {
      const node = obj[key];
      const currentPath = path ? `${path}/${key}` : key;
      const isLeaf = node.isLeaf;

      const treeNode = {
        key: node.fileId || currentPath,
        title: node.name,
        isLeaf,
        icon: getFileIcon(node.name, isLeaf),
        fileId: node.fileId,
        filePath: isLeaf ? currentPath : null, // 添加文件路径用于 Git 状态匹配
      };

      if (!isLeaf && Object.keys(node.children).length > 0) {
        treeNode.children = convertToTreeData(node.children, currentPath);
      }

      return treeNode;
    });
  };

  return convertToTreeData(tree);
};

// Git 状态颜色映射
const getStatusColor = (status) => {
  const colorMap = {
    untracked: 'green',
    modified: 'orange',
    deleted: 'red',
    added: 'blue',
    staged: 'cyan',
  };
  return colorMap[status] || 'default';
};

// Git 状态标签映射
const getStatusLabel = (status) => {
  const labelMap = {
    untracked: 'U',
    modified: 'M',
    deleted: 'D',
    added: 'A',
    staged: 'S',
  };
  return labelMap[status] || '?';
};

// 计算树形数据
const treeData = computed(() => {
  console.log('[FileTree] 接收到 files prop:', props.files?.length || 0, 'files');
  if (!props.files || props.files.length === 0) {
    console.log('[FileTree] 没有文件，显示空状态');
    return [];
  }
  console.log('[FileTree] 构建树形结构...');
  const tree = buildTree(props.files);
  console.log('[FileTree] 树形数据:', tree);
  return tree;
});

// 处理节点选择
const handleSelect = (keys, { node }) => {
  if (node.isLeaf && node.fileId) {
    selectedKeys.value = [node.fileId];
    emit('select', node.fileId);
  }
};

// 处理节点展开/收起
const handleExpand = (keys) => {
  expandedKeys.value = keys;
};

// 监听当前文件变化
watch(() => props.currentFileId, (newFileId) => {
  if (newFileId) {
    selectedKeys.value = [newFileId];
  } else {
    selectedKeys.value = [];
  }
}, { immediate: true });

// 初始化时展开所有文件夹
watch(treeData, (newTreeData) => {
  if (newTreeData.length > 0) {
    const getAllFolderKeys = (nodes) => {
      let keys = [];
      nodes.forEach(node => {
        if (!node.isLeaf) {
          keys.push(node.key);
          if (node.children) {
            keys = keys.concat(getAllFolderKeys(node.children));
          }
        }
      });
      return keys;
    };

    expandedKeys.value = getAllFolderKeys(newTreeData);
  }
}, { immediate: true });
</script>

<style scoped>
.file-tree {
  height: 100%;
  overflow-y: auto;
}

/* 加载状态 */
.tree-loading {
  padding: 20px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #6b7280;
  font-size: 14px;
}

/* 树节点 */
.tree-node-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.node-icon {
  font-size: 16px;
  color: #667eea;
}

.git-status-tag {
  margin-left: auto;
  font-size: 11px;
  padding: 0 4px;
  min-width: 20px;
  text-align: center;
  font-weight: bold;
}

/* 自定义树样式 */
.file-tree :deep(.ant-tree) {
  background: transparent;
  font-size: 14px;
}

.file-tree :deep(.ant-tree-node-content-wrapper) {
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.3s;
}

.file-tree :deep(.ant-tree-node-content-wrapper:hover) {
  background: #f3f4f6;
}

.file-tree :deep(.ant-tree-node-selected .ant-tree-node-content-wrapper) {
  background: #ede9fe;
  color: #667eea;
}

.file-tree :deep(.ant-tree-treenode) {
  padding: 2px 0;
}

.file-tree :deep(.ant-tree-switcher) {
  color: #9ca3af;
}

/* 空状态 */
.tree-empty {
  padding: 40px 20px;
  text-align: center;
  color: #9ca3af;
}

.tree-empty :deep(.anticon) {
  font-size: 48px;
  margin-bottom: 12px;
  display: block;
}

.tree-empty p {
  margin: 0;
  font-size: 14px;
}

/* 滚动条样式 */
.file-tree::-webkit-scrollbar {
  width: 6px;
}

.file-tree::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.file-tree::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.file-tree::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
