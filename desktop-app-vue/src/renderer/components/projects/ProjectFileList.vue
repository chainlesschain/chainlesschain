<template>
  <div class="project-file-list">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <a-spin tip="加载中..." />
    </div>

    <!-- 空状态 -->
    <div v-else-if="fileList.length === 0" class="empty-state">
      <FolderOpenOutlined class="empty-icon" />
      <p>暂无文件</p>
    </div>

    <!-- 文件列表表格 -->
    <a-table
      v-else
      :columns="columns"
      :data-source="fileList"
      :pagination="false"
      :row-key="record => record.id"
      size="small"
      class="file-table"
    >
      <!-- 文件名列 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <div class="file-name-cell" @click="handleFileClick(record)">
            <component :is="getFileIcon(record)" class="file-icon" :style="{ color: getFileColor(record) }" />
            <span class="file-name" :title="record.file_name">{{ record.file_name }}</span>
            <a-tag v-if="record.is_folder" size="small" color="blue">文件夹</a-tag>
          </div>
        </template>

        <!-- 文件路径列 -->
        <template v-else-if="column.key === 'path'">
          <span class="file-path" :title="record.file_path">
            {{ getDisplayPath(record.file_path) }}
          </span>
        </template>

        <!-- 文件大小列 -->
        <template v-else-if="column.key === 'size'">
          <span>{{ formatFileSize(record.file_size) }}</span>
        </template>

        <!-- 修改时间列 -->
        <template v-else-if="column.key === 'updated'">
          <span>{{ formatDate(record.updated_at || record.created_at) }}</span>
        </template>

        <!-- 操作列 -->
        <template v-else-if="column.key === 'actions'">
          <div class="action-buttons">
            <a-tooltip title="打开">
              <a-button type="text" size="small" @click="handleFileClick(record)">
                <FolderOpenOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="预览">
              <a-button type="text" size="small" @click="handleFilePreview(record)">
                <EyeOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="下载">
              <a-button type="text" size="small" @click="handleFileDownload(record)">
                <DownloadOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="删除">
              <a-button type="text" size="small" danger @click="handleFileDelete(record)">
                <DeleteOutlined />
              </a-button>
            </a-tooltip>
          </div>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  FolderOpenOutlined,
  FolderOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  CodeOutlined,
  Html5Outlined,
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  files: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['file-click', 'file-preview', 'file-download', 'file-delete']);

// 表格列定义
const columns = [
  {
    title: '文件名',
    key: 'name',
    dataIndex: 'file_name',
    width: '35%',
  },
  {
    title: '路径',
    key: 'path',
    dataIndex: 'file_path',
    width: '30%',
    ellipsis: true,
  },
  {
    title: '大小',
    key: 'size',
    dataIndex: 'file_size',
    width: '10%',
    align: 'right',
  },
  {
    title: '修改时间',
    key: 'updated',
    dataIndex: 'updated_at',
    width: '15%',
  },
  {
    title: '操作',
    key: 'actions',
    width: '10%',
    align: 'center',
  },
];

// 文件列表（扁平化）
const fileList = computed(() => {
  return props.files || [];
});

// 获取文件扩展名
const getFileExtension = (fileName) => {
  if (!fileName) return '';
  const parts = fileName.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

// 获取文件图标
const getFileIcon = (file) => {
  if (file.is_folder) {
    return FolderOutlined;
  }

  const ext = getFileExtension(file.file_name);
  const iconMap = {
    ppt: FilePptOutlined,
    pptx: FilePptOutlined,
    doc: FileWordOutlined,
    docx: FileWordOutlined,
    pdf: FilePdfOutlined,
    xls: FileExcelOutlined,
    xlsx: FileExcelOutlined,
    csv: FileExcelOutlined,
    html: Html5Outlined,
    htm: Html5Outlined,
    md: FileMarkdownOutlined,
    txt: FileTextOutlined,
    js: CodeOutlined,
    ts: CodeOutlined,
    jsx: CodeOutlined,
    tsx: CodeOutlined,
    vue: CodeOutlined,
    py: CodeOutlined,
    java: CodeOutlined,
    cpp: CodeOutlined,
    c: CodeOutlined,
    go: CodeOutlined,
    rs: CodeOutlined,
    png: FileImageOutlined,
    jpg: FileImageOutlined,
    jpeg: FileImageOutlined,
    gif: FileImageOutlined,
    svg: FileImageOutlined,
  };
  return iconMap[ext] || FileTextOutlined;
};

// 获取文件颜色
const getFileColor = (file) => {
  if (file.is_folder) {
    return '#667eea';
  }

  const ext = getFileExtension(file.file_name);
  const colorMap = {
    ppt: '#d35400',
    pptx: '#d35400',
    doc: '#2980b9',
    docx: '#2980b9',
    pdf: '#e74c3c',
    xls: '#27ae60',
    xlsx: '#27ae60',
    csv: '#27ae60',
    html: '#e67e22',
    htm: '#e67e22',
    md: '#9b59b6',
    txt: '#7f8c8d',
    js: '#f39c12',
    ts: '#3498db',
    jsx: '#f39c12',
    tsx: '#3498db',
    vue: '#42b983',
    py: '#3498db',
    java: '#e74c3c',
    png: '#1abc9c',
    jpg: '#1abc9c',
    jpeg: '#1abc9c',
    gif: '#1abc9c',
    svg: '#1abc9c',
  };
  return colorMap[ext] || '#95a5a6';
};

// 获取显示路径（只显示相对路径）
const getDisplayPath = (fullPath) => {
  if (!fullPath) return '-';
  // 移除 /data/projects/{projectId}/ 前缀
  const parts = fullPath.split('/');
  if (parts.length > 3 && parts[1] === 'data' && parts[2] === 'projects') {
    return parts.slice(4).join('/') || '/';
  }
  return fullPath;
};

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '-';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) {
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } else if (days > 0) {
    return `${days}天前`;
  } else if (hours > 0) {
    return `${hours}小时前`;
  } else if (minutes > 0) {
    return `${minutes}分钟前`;
  } else {
    return '刚刚';
  }
};

// 事件处理
const handleFileClick = (file) => {
  emit('file-click', file.id);
};

const handleFilePreview = (file) => {
  emit('file-preview', file);
};

const handleFileDownload = (file) => {
  emit('file-download', file);
};

const handleFileDelete = (file) => {
  emit('file-delete', file);
};
</script>

<style scoped lang="scss">
.project-file-list {
  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 60px 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
    color: #999;

    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
      color: #d9d9d9;
    }

    p {
      margin: 0;
      font-size: 14px;
    }
  }

  .file-table {
    :deep(.ant-table) {
      background: transparent;
    }

    :deep(.ant-table-tbody > tr) {
      cursor: pointer;
      transition: background-color 0.3s;

      &:hover {
        background-color: #f5f7fa;
      }
    }

    .file-name-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;

      .file-icon {
        font-size: 18px;
        flex-shrink: 0;
      }

      .file-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &:hover {
        .file-name {
          color: #667eea;
          text-decoration: underline;
        }
      }
    }

    .file-path {
      color: #6b7280;
      font-size: 12px;
    }

    .action-buttons {
      display: flex;
      justify-content: center;
      gap: 4px;

      .ant-btn {
        padding: 0 4px;

        &:hover {
          background: #f3f4f6;
        }
      }
    }
  }
}
</style>
