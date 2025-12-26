<template>
  <div class="editor-panel-header">
    <!-- 左侧：文件信息 -->
    <div class="file-info">
      <component :is="getFileIcon()" class="file-icon" />
      <span class="file-name">{{ displayFileName }}</span>
      <span v-if="hasUnsavedChanges" class="unsaved-indicator" title="有未保存的更改">●</span>
      <a-tag v-if="fileType" size="small" class="file-type-tag">
        {{ fileType }}
      </a-tag>
    </div>

    <!-- 右侧：操作按钮 -->
    <div class="header-actions">
      <!-- 视图模式切换 -->
      <a-radio-group
        v-if="showViewMode"
        v-model:value="localViewMode"
        size="small"
        button-style="solid"
        @change="handleViewModeChange"
      >
        <a-radio-button value="auto" :disabled="!canEdit">
          <EyeOutlined />
          自动
        </a-radio-button>
        <a-radio-button value="edit" :disabled="!canEdit">
          <EditOutlined />
          编辑
        </a-radio-button>
        <a-radio-button value="preview">
          <FileSearchOutlined />
          预览
        </a-radio-button>
      </a-radio-group>

      <!-- 保存按钮 -->
      <a-tooltip title="保存 (Ctrl+S)">
        <a-button
          size="small"
          type="primary"
          :disabled="!hasUnsavedChanges || isSaving"
          :loading="isSaving"
          @click="handleSave"
        >
          <SaveOutlined v-if="!isSaving" />
          {{ isSaving ? '保存中' : '保存' }}
        </a-button>
      </a-tooltip>

      <!-- 文件导出菜单 -->
      <slot name="export-menu">
        <a-dropdown v-if="showExport" placement="bottomRight">
          <a-button size="small">
            <ExportOutlined />
            导出
          </a-button>
          <template #overlay>
            <a-menu @click="handleExportClick">
              <a-menu-item key="pdf">
                <FilePdfOutlined />
                导出为 PDF
              </a-menu-item>
              <a-menu-item key="markdown">
                <FileMarkdownOutlined />
                导出为 Markdown
              </a-menu-item>
              <a-menu-item key="html">
                <Html5Outlined />
                导出为 HTML
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item key="copy">
                <CopyOutlined />
                复制内容
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </slot>

      <!-- 关闭面板按钮 -->
      <a-tooltip title="关闭编辑器">
        <a-button size="small" type="text" @click="handleClose">
          <CloseOutlined />
        </a-button>
      </a-tooltip>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  FileTextOutlined,
  FileExcelOutlined,
  FileWordOutlined,
  FilePptOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileMarkdownOutlined,
  FileZipOutlined,
  CodeOutlined,
  Html5Outlined,
  SaveOutlined,
  EditOutlined,
  EyeOutlined,
  FileSearchOutlined,
  CloseOutlined,
  ExportOutlined,
  CopyOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  // 当前文件信息
  file: {
    type: Object,
    default: null,
  },
  // 文件名（如果没有file对象）
  fileName: {
    type: String,
    default: '',
  },
  // 是否有未保存的更改
  hasUnsavedChanges: {
    type: Boolean,
    default: false,
  },
  // 是否正在保存
  isSaving: {
    type: Boolean,
    default: false,
  },
  // 视图模式
  viewMode: {
    type: String,
    default: 'auto', // 'auto' | 'edit' | 'preview'
  },
  // 是否可编辑
  canEdit: {
    type: Boolean,
    default: true,
  },
  // 是否显示视图模式切换
  showViewMode: {
    type: Boolean,
    default: true,
  },
  // 是否显示导出按钮
  showExport: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['save', 'close', 'view-mode-change', 'export']);

// 本地视图模式状态
const localViewMode = ref(props.viewMode);

// 监听props变化
watch(() => props.viewMode, (newVal) => {
  localViewMode.value = newVal;
});

// 显示的文件名
const displayFileName = computed(() => {
  if (props.file) {
    return props.file.file_name || props.file.name || '未命名文件';
  }
  return props.fileName || '未命名文件';
});

// 文件类型
const fileType = computed(() => {
  const fileName = displayFileName.value;
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext || ext === fileName.toLowerCase()) return null;

  const typeMap = {
    js: 'JavaScript',
    ts: 'TypeScript',
    jsx: 'JSX',
    tsx: 'TSX',
    vue: 'Vue',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    json: 'JSON',
    md: 'Markdown',
    txt: 'Text',
    py: 'Python',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    go: 'Go',
    rs: 'Rust',
    xml: 'XML',
    yml: 'YAML',
    yaml: 'YAML',
    sql: 'SQL',
    sh: 'Shell',
    bat: 'Batch',
    ps1: 'PowerShell',
    php: 'PHP',
    rb: 'Ruby',
    swift: 'Swift',
    kt: 'Kotlin',
    xlsx: 'Excel',
    xls: 'Excel',
    docx: 'Word',
    doc: 'Word',
    pptx: 'PowerPoint',
    ppt: 'PowerPoint',
    pdf: 'PDF',
    zip: 'ZIP',
    rar: 'RAR',
    '7z': '7-Zip',
    png: 'PNG',
    jpg: 'JPG',
    jpeg: 'JPEG',
    gif: 'GIF',
    svg: 'SVG',
    webp: 'WebP',
  };

  return typeMap[ext] || ext.toUpperCase();
});

// 获取文件图标
const getFileIcon = () => {
  const fileName = displayFileName.value;
  const ext = fileName.split('.').pop()?.toLowerCase();

  // 根据文件扩展名返回对应的图标
  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return FileExcelOutlined;
  } else if (['docx', 'doc'].includes(ext)) {
    return FileWordOutlined;
  } else if (['pptx', 'ppt'].includes(ext)) {
    return FilePptOutlined;
  } else if (['pdf'].includes(ext)) {
    return FilePdfOutlined;
  } else if (['md', 'markdown'].includes(ext)) {
    return FileMarkdownOutlined;
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return FileZipOutlined;
  } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) {
    return FileImageOutlined;
  } else if (['html', 'htm'].includes(ext)) {
    return Html5Outlined;
  } else if (['js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'json', 'xml', 'yml', 'yaml'].includes(ext)) {
    return CodeOutlined;
  }

  return FileTextOutlined;
};

// 处理保存
const handleSave = () => {
  emit('save');
};

// 处理关闭
const handleClose = () => {
  emit('close');
};

// 处理视图模式变化
const handleViewModeChange = () => {
  emit('view-mode-change', localViewMode.value);
};

// 处理导出点击
const handleExportClick = ({ key }) => {
  emit('export', key);
};
</script>

<style scoped>
.editor-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  min-height: 48px;
  flex-shrink: 0;
}

/* 文件信息 */
.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.file-icon {
  flex-shrink: 0;
  font-size: 16px;
  color: #6b7280;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unsaved-indicator {
  flex-shrink: 0;
  color: #ef4444;
  font-size: 20px;
  line-height: 1;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.file-type-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 0 6px;
  line-height: 18px;
  border-radius: 4px;
}

/* 操作按钮区域 */
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.header-actions :deep(.ant-radio-group) {
  flex-shrink: 0;
}

.header-actions :deep(.ant-radio-button-wrapper) {
  padding: 0 10px;
  height: 28px;
  line-height: 26px;
  font-size: 12px;
}

.header-actions :deep(.ant-btn-sm) {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

/* 响应式：小屏幕隐藏部分按钮文字 */
@media (max-width: 1200px) {
  .header-actions :deep(.ant-radio-button-wrapper span:not(.anticon)) {
    display: none;
  }

  .file-type-tag {
    display: none;
  }
}

/* 深色主题适配（可选） */
.dark .editor-panel-header {
  background: #1f2937;
  border-bottom-color: #374151;
}

.dark .file-icon {
  color: #9ca3af;
}

.dark .file-name {
  color: #f3f4f6;
}
</style>
