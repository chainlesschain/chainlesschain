<template>
  <a-modal
    v-model:open="modalVisible"
    title="文件"
    :width="680"
    :footer="null"
    class="file-selection-modal"
    @cancel="handleClose"
  >
    <!-- 标签栏 -->
    <a-tabs v-model:activeKey="activeTab" class="file-tabs">
      <a-tab-pane key="all" tab="全部" />
      <a-tab-pane key="ppt" tab="PPT" />
      <a-tab-pane key="word" tab="文档" />
      <a-tab-pane key="excel" tab="文档" />
      <a-tab-pane key="image" tab="图片" />
    </a-tabs>

    <!-- 文件列表 -->
    <div class="file-list">
      <div
        v-for="file in filteredFiles"
        :key="file.id"
        class="file-item"
        :class="{ 'is-selected': selectedFileIds.includes(file.id) }"
        @click="handleFileClick(file)"
      >
        <!-- 文件图标 -->
        <div class="file-icon-wrapper">
          <div class="file-icon" :class="`file-type-${file.type}`">
            <component :is="getFileIcon(file.type)" />
          </div>
        </div>

        <!-- 文件信息 -->
        <div class="file-info">
          <div class="file-name">{{ file.name }}</div>
          <div class="file-meta">{{ file.date }}</div>
        </div>

        <!-- 操作按钮 -->
        <div class="file-actions">
          <a-tooltip title="收藏">
            <a-button
              type="text"
              size="small"
              :icon="h(StarOutlined)"
              @click.stop="handleToggleFavorite(file)"
            />
          </a-tooltip>
          <a-tooltip title="下载">
            <a-button
              type="text"
              size="small"
              :icon="h(DownloadOutlined)"
              @click.stop="handleDownload(file)"
            />
          </a-tooltip>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="filteredFiles.length === 0" class="empty-state">
        <InboxOutlined class="empty-icon" />
        <div class="empty-text">暂无文件</div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="modal-footer">
      <a-button @click="handleClose">取消</a-button>
      <a-button
        type="primary"
        :disabled="selectedFileIds.length === 0"
        @click="handleConfirm"
      >
        确定选择 ({{ selectedFileIds.length }})
      </a-button>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, h } from 'vue';
import {
  FileTextOutlined,
  FilePptOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  StarOutlined,
  DownloadOutlined,
  InboxOutlined
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  files: {
    type: Array,
    default: () => []
  },
  multiple: {
    type: Boolean,
    default: false
  }
});

// Emits
const emit = defineEmits(['update:open', 'select', 'favorite', 'download']);

// State
const visible = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val)
});

const activeTab = ref('all');
const selectedFileIds = ref([]);

// Computed
const filteredFiles = computed(() => {
  if (activeTab.value === 'all') {
    return props.files;
  }
  return props.files.filter(file => {
    const typeMap = {
      ppt: ['ppt', 'pptx'],
      word: ['doc', 'docx'],
      excel: ['xls', 'xlsx', 'csv'],
      image: ['png', 'jpg', 'jpeg', 'gif', 'svg']
    };
    return typeMap[activeTab.value]?.includes(file.type.toLowerCase());
  });
});

// Methods
const getFileIcon = (type) => {
  const iconMap = {
    ppt: FilePptOutlined,
    pptx: FilePptOutlined,
    doc: FileWordOutlined,
    docx: FileWordOutlined,
    xls: FileExcelOutlined,
    xlsx: FileExcelOutlined,
    csv: FileExcelOutlined,
    png: FileImageOutlined,
    jpg: FileImageOutlined,
    jpeg: FileImageOutlined,
    gif: FileImageOutlined,
    svg: FileImageOutlined
  };
  return iconMap[type.toLowerCase()] || FileTextOutlined;
};

const handleFileClick = (file) => {
  if (props.multiple) {
    const index = selectedFileIds.value.indexOf(file.id);
    if (index > -1) {
      selectedFileIds.value.splice(index, 1);
    } else {
      selectedFileIds.value.push(file.id);
    }
  } else {
    selectedFileIds.value = [file.id];
  }
};

const handleToggleFavorite = (file) => {
  emit('favorite', file);
};

const handleDownload = (file) => {
  emit('download', file);
};

const handleConfirm = () => {
  const selectedFiles = props.files.filter(f => selectedFileIds.value.includes(f.id));
  emit('select', selectedFiles);
  handleClose();
};

const handleClose = () => {
  selectedFileIds.value = [];
  visible.value = false;
};
</script>

<style lang="scss" scoped>
.file-selection-modal {
  :deep(.ant-modal-body) {
    padding: 0;
  }

  .file-tabs {
    padding: 0 24px;
    border-bottom: 1px solid #f0f0f0;

    :deep(.ant-tabs-nav) {
      margin-bottom: 0;
    }

    :deep(.ant-tabs-tab) {
      padding: 12px 16px;
      font-size: 14px;
    }
  }

  .file-list {
    max-height: 480px;
    overflow-y: auto;
    padding: 16px 24px;

    .file-item {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      margin-bottom: 8px;
      background: #ffffff;
      border: 1px solid #f0f0f0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        border-color: #1677FF;
        background: #f5f9ff;

        .file-actions {
          opacity: 1;
        }
      }

      &.is-selected {
        border-color: #1677FF;
        background: #e6f4ff;
      }

      .file-icon-wrapper {
        flex-shrink: 0;
        margin-right: 12px;

        .file-icon {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          font-size: 20px;

          &.file-type-ppt,
          &.file-type-pptx {
            background: #fff3e6;
            color: #ff8c00;
          }

          &.file-type-doc,
          &.file-type-docx {
            background: #e6f4ff;
            color: #1677ff;
          }

          &.file-type-xls,
          &.file-type-xlsx,
          &.file-type-csv {
            background: #e6fffb;
            color: #13c2c2;
          }

          &.file-type-png,
          &.file-type-jpg,
          &.file-type-jpeg,
          &.file-type-gif,
          &.file-type-svg {
            background: #f6ffed;
            color: #52c41a;
          }
        }
      }

      .file-info {
        flex: 1;
        min-width: 0;

        .file-name {
          font-size: 14px;
          font-weight: 500;
          color: #333;
          margin-bottom: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .file-meta {
          font-size: 12px;
          color: #999;
        }
      }

      .file-actions {
        flex-shrink: 0;
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.2s ease;

        .ant-btn {
          color: #666;

          &:hover {
            color: #1677FF;
          }
        }
      }
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;

      .empty-icon {
        font-size: 64px;
        color: #d9d9d9;
        margin-bottom: 16px;
      }

      .empty-text {
        font-size: 14px;
        color: #999;
      }
    }
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid #f0f0f0;
  }
}
</style>
