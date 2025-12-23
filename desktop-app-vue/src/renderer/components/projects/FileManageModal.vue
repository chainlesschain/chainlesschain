<template>
  <a-modal
    :open="visible"
    title="文件"
    :width="720"
    :footer="null"
    @cancel="handleClose"
  >
    <!-- 头部：文件类型筛选 -->
    <div class="modal-header">
      <a-tabs v-model:activeKey="activeTab" @change="handleTabChange">
        <a-tab-pane key="all" tab="全部" />
        <a-tab-pane key="ppt" tab="PPT" />
        <a-tab-pane key="web" tab="网页" />
        <a-tab-pane key="doc" tab="文档" />
        <a-tab-pane key="excel" tab="Excel" />
        <a-tab-pane key="code" tab="代码" />
        <a-tab-pane key="image" tab="图片" />
      </a-tabs>
    </div>

    <!-- 文件列表 -->
    <div class="files-list">
      <!-- 加载状态 -->
      <div v-if="loading" class="loading-container">
        <a-spin tip="加载中..." />
      </div>

      <!-- 空状态 -->
      <div v-else-if="filteredFiles.length === 0" class="empty-state">
        <FileTextOutlined class="empty-icon" />
        <p>{{ emptyText }}</p>
      </div>

      <!-- 文件项 -->
      <div v-else class="files-grid">
        <div
          v-for="file in filteredFiles"
          :key="file.id"
          class="file-card"
          @click="handleFileClick(file)"
        >
          <div class="file-preview">
            <!-- 图标或缩略图 -->
            <component
              :is="getFileIcon(file)"
              class="file-icon"
              :style="{ color: getFileColor(file) }"
            />
          </div>

          <div class="file-info">
            <div class="file-name" :title="file.file_name">
              {{ file.file_name }}
            </div>
            <div class="file-meta">
              <span>{{ formatDate(file.updated_at || file.created_at) }}</span>
            </div>
          </div>

          <div class="file-actions" @click.stop>
            <a-dropdown>
              <a-button type="text" size="small">
                <EllipsisOutlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item key="preview" @click="handleFilePreview(file)">
                    <EyeOutlined />
                    预览
                  </a-menu-item>
                  <a-menu-item key="download" @click="handleFileDownload(file)">
                    <DownloadOutlined />
                    下载
                  </a-menu-item>
                  <a-menu-item key="star" @click="handleFileStar(file)">
                    <StarOutlined />
                    收藏
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item key="delete" danger @click="handleFileDelete(file)">
                    <DeleteOutlined />
                    删除
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileImageOutlined,
  CodeOutlined,
  Html5Outlined,
  EyeOutlined,
  DownloadOutlined,
  StarOutlined,
  DeleteOutlined,
  EllipsisOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  files: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  projectId: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['close', 'file-click', 'file-preview', 'file-download', 'file-delete']);

const activeTab = ref('all');

// 过滤文件
const filteredFiles = computed(() => {
  if (activeTab.value === 'all') {
    return props.files;
  }

  return props.files.filter(file => {
    const ext = getFileExtension(file.file_name);
    return getFileCategory(ext) === activeTab.value;
  });
});

// 空状态文本
const emptyText = computed(() => {
  if (activeTab.value === 'all') {
    return '暂无文件';
  }
  return `暂无${getTabName(activeTab.value)}文件`;
});

// 获取文件扩展名
const getFileExtension = (fileName) => {
  if (!fileName) return '';
  const parts = fileName.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

// 获取文件类别
const getFileCategory = (ext) => {
  const categoryMap = {
    'ppt': ['ppt', 'pptx'],
    'web': ['html', 'htm'],
    'doc': ['doc', 'docx', 'pdf', 'txt', 'md'],
    'excel': ['xls', 'xlsx', 'csv'],
    'code': ['js', 'ts', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'vue', 'jsx', 'tsx'],
    'image': ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'],
  };

  for (const [category, extensions] of Object.entries(categoryMap)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }
  return 'other';
};

// 获取Tab名称
const getTabName = (tab) => {
  const names = {
    'all': '全部',
    'ppt': 'PPT',
    'web': '网页',
    'doc': '文档',
    'excel': 'Excel',
    'code': '代码',
    'image': '图片',
  };
  return names[tab] || tab;
};

// 获取文件图标
const getFileIcon = (file) => {
  const ext = getFileExtension(file.file_name);
  const iconMap = {
    'ppt': FilePptOutlined,
    'pptx': FilePptOutlined,
    'doc': FileWordOutlined,
    'docx': FileWordOutlined,
    'pdf': FilePdfOutlined,
    'xls': FileExcelOutlined,
    'xlsx': FileExcelOutlined,
    'html': Html5Outlined,
    'htm': Html5Outlined,
    'md': FileTextOutlined,
    'txt': FileTextOutlined,
    'js': CodeOutlined,
    'ts': CodeOutlined,
    'py': CodeOutlined,
    'png': FileImageOutlined,
    'jpg': FileImageOutlined,
    'jpeg': FileImageOutlined,
    'gif': FileImageOutlined,
    'svg': FileImageOutlined,
  };
  return iconMap[ext] || FileTextOutlined;
};

// 获取文件颜色
const getFileColor = (file) => {
  const ext = getFileExtension(file.file_name);
  const colorMap = {
    'ppt': '#d35400',
    'pptx': '#d35400',
    'doc': '#2980b9',
    'docx': '#2980b9',
    'pdf': '#e74c3c',
    'xls': '#27ae60',
    'xlsx': '#27ae60',
    'html': '#e67e22',
    'htm': '#e67e22',
    'md': '#9b59b6',
    'txt': '#7f8c8d',
    'js': '#f39c12',
    'ts': '#3498db',
    'py': '#3498db',
    'png': '#1abc9c',
    'jpg': '#1abc9c',
  };
  return colorMap[ext] || '#95a5a6';
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${date.getMonth() + 1}-${date.getDate()}`;
  } else if (hours > 0) {
    return `${hours}小时前`;
  } else if (minutes > 0) {
    return `${minutes}分钟前`;
  } else {
    return '刚刚';
  }
};

// 事件处理
const handleClose = () => {
  emit('close');
};

const handleTabChange = (key) => {
  activeTab.value = key;
};

const handleFileClick = (file) => {
  emit('file-click', file);
};

const handleFilePreview = (file) => {
  emit('file-preview', file);
};

const handleFileDownload = (file) => {
  emit('file-download', file);
};

const handleFileStar = (file) => {
  message.success('收藏功能开发中');
};

const handleFileDelete = (file) => {
  emit('file-delete', file);
};
</script>

<style scoped lang="scss">
.modal-header {
  margin-bottom: 16px;

  :deep(.ant-tabs-nav) {
    margin-bottom: 0;
  }

  :deep(.ant-tabs-tab) {
    padding: 8px 16px;
  }
}

.files-list {
  max-height: 500px;
  overflow-y: auto;

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

  .files-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
    padding: 8px 0;
  }

  .file-card {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 12px;
    border: 1px solid #f0f0f0;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    background: #fff;

    &:hover {
      border-color: #1677ff;
      box-shadow: 0 2px 8px rgba(22, 119, 255, 0.15);

      .file-actions {
        opacity: 1;
      }
    }

    .file-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 60px;
      margin-bottom: 12px;

      .file-icon {
        font-size: 36px;
      }
    }

    .file-info {
      flex: 1;

      .file-name {
        font-size: 13px;
        color: #333;
        margin-bottom: 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.4;
      }

      .file-meta {
        font-size: 12px;
        color: #999;

        span {
          margin-right: 12px;

          &:last-child {
            margin-right: 0;
          }
        }
      }
    }

    .file-actions {
      position: absolute;
      top: 8px;
      right: 8px;
      opacity: 0;
      transition: opacity 0.2s;

      .ant-btn {
        background: rgba(255, 255, 255, 0.9);

        &:hover {
          background: #fff;
        }
      }
    }
  }
}
</style>
