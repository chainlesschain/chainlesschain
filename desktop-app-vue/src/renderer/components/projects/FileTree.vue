<template>
  <div class="file-tree">
    <!-- 搜索框 -->
    <div class="tree-search">
      <a-input
        v-model:value="searchQuery"
        placeholder="搜索文件..."
        allow-clear
        size="small"
        @change="handleSearchChange"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>
    </div>

    <!-- 搜索结果统计 -->
    <div
      v-if="searchQuery && filteredTreeData.length > 0"
      class="search-stats"
    >
      找到 <strong>{{ searchResultCount }}</strong> 个文件
    </div>

    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="tree-loading"
    >
      <a-spin size="small" />
      <span>加载中...</span>
    </div>

    <!-- 文件树 -->
    <a-tree
      v-else-if="filteredTreeData.length > 0"
      :tree-data="filteredTreeData"
      :selected-keys="selectedKeys"
      :expanded-keys="expandedKeys"
      @select="handleSelect"
      @expand="handleExpand"
    >
      <template #title="{ title, isLeaf, icon, filePath }">
        <div class="tree-node-title">
          <component
            :is="icon"
            class="node-icon"
          />
          <span v-html="highlightText(title, searchQuery)" />
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
    <div
      v-else-if="!searchQuery"
      class="tree-empty"
    >
      <FolderOpenOutlined />
      <p>暂无文件</p>
    </div>

    <!-- 搜索无结果 -->
    <div
      v-else
      class="tree-empty"
    >
      <FileSearchOutlined />
      <p>未找到匹配的文件</p>
      <span class="empty-hint">尝试使用不同的关键词</span>
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
  SearchOutlined,
  FileSearchOutlined,
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
const searchQuery = ref(''); // 搜索关键词

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

/**
 * 过滤树形数据（搜索功能）
 */
const filteredTreeData = computed(() => {
  if (!searchQuery.value || !searchQuery.value.trim()) {
    return treeData.value;
  }

  const query = searchQuery.value.toLowerCase().trim();

  // 递归过滤树节点
  const filterTree = (nodes) => {
    return nodes
      .map(node => {
        // 检查当前节点是否匹配
        const titleMatch = node.title.toLowerCase().includes(query);

        // 如果是文件夹，递归过滤子节点
        if (!node.isLeaf && node.children) {
          const filteredChildren = filterTree(node.children);

          // 如果有匹配的子节点或当前节点匹配，保留该节点
          if (filteredChildren.length > 0 || titleMatch) {
            return {
              ...node,
              children: filteredChildren
            };
          }
          return null;
        }

        // 如果是文件且匹配，保留该节点
        if (node.isLeaf && titleMatch) {
          return node;
        }

        return null;
      })
      .filter(Boolean);
  };

  const filtered = filterTree(treeData.value);

  // 搜索时自动展开所有匹配的节点
  if (filtered.length > 0) {
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
    expandedKeys.value = getAllKeys(filtered);
  }

  return filtered;
});

/**
 * 计算搜索结果数量
 */
const searchResultCount = computed(() => {
  const countFiles = (nodes) => {
    let count = 0;
    nodes.forEach(node => {
      if (node.isLeaf) {
        count++;
      }
      if (node.children) {
        count += countFiles(node.children);
      }
    });
    return count;
  };
  return countFiles(filteredTreeData.value);
});

/**
 * 高亮搜索关键词
 */
const highlightText = (text, query) => {
  if (!query || !query.trim()) {
    return text;
  }

  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return text.replace(regex, '<mark class="search-highlight">$1</mark>');
};

/**
 * 转义正则表达式特殊字符
 */
const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * 处理搜索输入变化
 */
const handleSearchChange = () => {
  // 搜索时的逻辑已在 computed 中处理
  console.log('[FileTree] 搜索:', searchQuery.value);
};

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
  display: flex;
  flex-direction: column;
}

/* 搜索框 */
.tree-search {
  padding: 12px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

/* 搜索统计 */
.search-stats {
  padding: 8px 12px;
  font-size: 12px;
  color: #666;
  background: #f5f5f5;
  border-bottom: 1px solid #e8e8e8;
}

.search-stats strong {
  color: #1890ff;
  font-weight: 600;
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
  opacity: 0.5;
}

.tree-empty p {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #6b7280;
}

.empty-hint {
  font-size: 12px;
  color: #9ca3af;
}

/* 搜索高亮 */
.tree-node-title :deep(mark.search-highlight) {
  background: #fff566;
  padding: 2px 4px;
  border-radius: 2px;
  font-weight: 600;
  color: #000;
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
