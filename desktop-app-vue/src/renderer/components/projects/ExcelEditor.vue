<template>
  <div class="excel-editor">
    <!-- 编辑器头部 -->
    <div class="editor-header">
      <div class="header-left">
        <FileExcelOutlined class="file-icon" />
        <span class="file-name">{{ file.file_name }}</span>
        <a-tag v-if="hasChanges" color="orange" size="small">
          未保存
        </a-tag>
        <a-tag v-if="saving" color="blue" size="small">
          <LoadingOutlined />
          保存中...
        </a-tag>
      </div>

      <div class="header-right">
        <a-tooltip title="自动保存">
          <a-switch
            v-model:checked="autoSave"
            size="small"
            checked-children="自动"
            un-checked-children="手动"
          />
        </a-tooltip>

        <a-tooltip title="保存 (Ctrl+S)">
          <a-button
            type="text"
            size="small"
            :disabled="!hasChanges || saving"
            @click="handleSave"
          >
            <SaveOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip title="下载Excel文件">
          <a-button type="text" size="small" @click="handleDownload">
            <DownloadOutlined />
          </a-button>
        </a-tooltip>

        <a-tooltip title="全屏">
          <a-button type="text" size="small" @click="toggleFullscreen">
            <FullscreenOutlined v-if="!isFullscreen" />
            <FullscreenExitOutlined v-else />
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- Excel工具栏 -->
    <div class="excel-toolbar">
      <a-tabs v-model:activeKey="activeTab" size="small">
        <a-tab-pane key="home" tab="开始">
          <div class="toolbar-group">
            <a-button-group size="small">
              <a-button @click="handleFormat('bold')">
                <BoldOutlined />
              </a-button>
              <a-button @click="handleFormat('italic')">
                <ItalicOutlined />
              </a-button>
              <a-button @click="handleFormat('underline')">
                <UnderlineOutlined />
              </a-button>
            </a-button-group>

            <a-divider type="vertical" />

            <a-select
              v-model:value="fontSize"
              size="small"
              style="width: 80px"
              @change="handleFontSizeChange"
            >
              <a-select-option :value="10">10</a-select-option>
              <a-select-option :value="12">12</a-select-option>
              <a-select-option :value="14">14</a-select-option>
              <a-select-option :value="16">16</a-select-option>
              <a-select-option :value="18">18</a-select-option>
            </a-select>

            <a-divider type="vertical" />

            <a-button-group size="small">
              <a-button @click="handleAlign('left')">
                <AlignLeftOutlined />
              </a-button>
              <a-button @click="handleAlign('center')">
                <AlignCenterOutlined />
              </a-button>
              <a-button @click="handleAlign('right')">
                <AlignRightOutlined />
              </a-button>
            </a-button-group>
          </div>
        </a-tab-pane>

        <a-tab-pane key="insert" tab="插入">
          <div class="toolbar-group">
            <a-button size="small" @click="insertRow">
              插入行
            </a-button>
            <a-button size="small" @click="insertColumn">
              插入列
            </a-button>
            <a-button size="small" @click="insertChart">
              <BarChartOutlined />
              图表
            </a-button>
          </div>
        </a-tab-pane>

        <a-tab-pane key="data" tab="数据">
          <div class="toolbar-group">
            <a-button size="small" @click="sortAscending">
              <SortAscendingOutlined />
              升序
            </a-button>
            <a-button size="small" @click="sortDescending">
              <SortDescendingOutlined />
              降序
            </a-button>
            <a-button size="small" @click="showFilter">
              <FilterOutlined />
              筛选
            </a-button>
          </div>
        </a-tab-pane>

        <a-tab-pane key="formula" tab="公式">
          <div class="toolbar-group">
            <a-button size="small" @click="insertFormula('SUM')">
              Σ SUM
            </a-button>
            <a-button size="small" @click="insertFormula('AVERAGE')">
              AVERAGE
            </a-button>
            <a-button size="small" @click="insertFormula('COUNT')">
              COUNT
            </a-button>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- Excel表格区域 -->
    <div class="excel-content" ref="excelContainer">
      <div id="spreadsheet-container" class="spreadsheet-container"></div>
    </div>

    <!-- 状态栏 -->
    <div class="editor-footer">
      <div class="footer-left">
        <span class="status-item">
          工作表: {{ activeSheet }}
        </span>
        <span class="status-item">
          单元格: {{ selectedCell }}
        </span>
      </div>

      <div class="footer-right">
        <span v-if="lastSaved" class="status-item">
          上次保存: {{ lastSaved }}
        </span>
        <a-button type="link" size="small" @click="showHelp">
          帮助
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import DOMPurify from 'dompurify';
import {
  FileExcelOutlined,
  SaveOutlined,
  DownloadOutlined,
  LoadingOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  BarChartOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  FilterOutlined,
} from '@ant-design/icons-vue';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
// 动态导入 jspreadsheet-ce
let jspreadsheet = null;

const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  projectId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['change', 'save']);

// 响应式状态
const excelContainer = ref(null);
const spreadsheetInstance = ref(null);
const hasChanges = ref(false);
const autoSave = ref(true);
const lastSaved = ref('');
const saving = ref(false);
const isFullscreen = ref(false);
const activeTab = ref('home');
const fontSize = ref(12);
const activeSheet = ref('Sheet1');
const selectedCell = ref('A1');

// 初始化Excel编辑器
onMounted(async () => {
  try {
    // 动态加载 jspreadsheet 库
    if (!window.jspreadsheet) {
      // 如果使用 CDN，在 index.html 中添加：
      // <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/jspreadsheet-ce/dist/jspreadsheet.min.css" />
      // <script src="https://cdn.jsdelivr.net/npm/jspreadsheet-ce/dist/index.min.js"></script>
      logger.warn('jspreadsheet not loaded, using basic table');
      initBasicTable();
    } else {
      jspreadsheet = window.jspreadsheet;
      initJspreadsheet();
    }

    // 监听键盘快捷键
    document.addEventListener('keydown', handleKeydown);
  } catch (error) {
    logger.error('初始化Excel编辑器失败:', error);
    message.error('初始化失败，使用基本编辑模式');
    initBasicTable();
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (spreadsheetInstance.value && spreadsheetInstance.value.destroy) {
    spreadsheetInstance.value.destroy();
  }
});

// 初始化jspreadsheet
const initJspreadsheet = () => {
  const container = document.getElementById('spreadsheet-container');
  if (!container) return;

  // 解析Excel数据或创建空表格
  const data = parseExcelData(props.file.content);

  spreadsheetInstance.value = jspreadsheet(container, {
    data: data,
    columns: generateColumns(data[0]?.length || 10),
    minDimensions: [10, 20],
    tableOverflow: true,
    tableWidth: '100%',
    tableHeight: '100%',
    allowInsertRow: true,
    allowInsertColumn: true,
    allowDeleteRow: true,
    allowDeleteColumn: true,
    allowRenameColumn: true,
    csvFileName: props.file.file_name,
    onchange: handleCellChange,
    onselection: handleCellSelection,
  });
};

// 初始化基本表格（降级方案）
const initBasicTable = () => {
  const container = document.getElementById('spreadsheet-container');
  if (!container) return;

  const data = parseExcelData(props.file.content);
  let html = '<table class="basic-excel-table"><thead><tr>';

  // 生成表头
  const colCount = data[0]?.length || 10;
  for (let i = 0; i < colCount; i++) {
    html += `<th>${String.fromCharCode(65 + i)}</th>`;
  }
  html += '</tr></thead><tbody>';

  // 生成数据行
  data.forEach((row, rowIndex) => {
    html += '<tr>';
    for (let i = 0; i < colCount; i++) {
      html += `<td contenteditable="true" data-row="${rowIndex}" data-col="${i}">${row[i] || ''}</td>`;
    }
    html += '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = DOMPurify.sanitize(html);

  // 监听单元格编辑
  container.querySelectorAll('td').forEach(cell => {
    cell.addEventListener('input', () => {
      hasChanges.value = true;
    });
  });
};

// 解析Excel数据
const parseExcelData = (content) => {
  if (!content) {
    // 返回默认的空表格数据
    return Array(20).fill(null).map(() => Array(10).fill(''));
  }

  try {
    // 如果是JSON格式
    if (typeof content === 'object') {
      return content.data || content;
    }

    // 如果是CSV格式
    if (typeof content === 'string') {
      const rows = content.split('\n');
      return rows.map(row => row.split(','));
    }

    return Array(20).fill(null).map(() => Array(10).fill(''));
  } catch (error) {
    logger.error('解析Excel数据失败:', error);
    return Array(20).fill(null).map(() => Array(10).fill(''));
  }
};

// 生成列配置
const generateColumns = (count) => {
  return Array(count).fill(null).map((_, i) => ({
    type: 'text',
    title: String.fromCharCode(65 + i),
    width: 100,
  }));
};

// 处理单元格变化
const handleCellChange = (instance, cell, x, y, value) => {
  hasChanges.value = true;
  emit('change', getSpreadsheetData());
};

// 处理单元格选择
const handleCellSelection = (instance, x1, y1, x2, y2) => {
  const col = String.fromCharCode(65 + x1);
  const row = y1 + 1;
  selectedCell.value = `${col}${row}`;
};

// 获取表格数据
const getSpreadsheetData = () => {
  if (spreadsheetInstance.value && spreadsheetInstance.value.getData) {
    return spreadsheetInstance.value.getData();
  }

  // 降级方案：从DOM中提取数据
  const container = document.getElementById('spreadsheet-container');
  if (!container) return [];

  const rows = container.querySelectorAll('tbody tr');
  return Array.from(rows).map(row => {
    const cells = row.querySelectorAll('td');
    return Array.from(cells).map(cell => cell.textContent);
  });
};

// 格式化操作
const handleFormat = (format) => {
  message.info(`应用格式: ${format}`);
  // 实现格式化逻辑
};

const handleFontSizeChange = (size) => {
  message.info(`字体大小: ${size}`);
  // 实现字体大小更改
};

const handleAlign = (align) => {
  message.info(`对齐方式: ${align}`);
  // 实现对齐操作
};

// 插入操作
const insertRow = () => {
  if (spreadsheetInstance.value && spreadsheetInstance.value.insertRow) {
    spreadsheetInstance.value.insertRow();
    hasChanges.value = true;
  }
  message.success('已插入新行');
};

const insertColumn = () => {
  if (spreadsheetInstance.value && spreadsheetInstance.value.insertColumn) {
    spreadsheetInstance.value.insertColumn();
    hasChanges.value = true;
  }
  message.success('已插入新列');
};

const insertChart = () => {
  message.info('图表功能开发中');
};

// 数据操作
const sortAscending = () => {
  message.info('升序排序');
};

const sortDescending = () => {
  message.info('降序排序');
};

const showFilter = () => {
  message.info('筛选功能');
};

// 公式操作
const insertFormula = (formula) => {
  message.info(`插入公式: ${formula}`);
};

// 保存文件
const handleSave = async () => {
  if (!hasChanges.value || saving.value) return;

  saving.value = true;

  try {
    const data = getSpreadsheetData();
    const content = JSON.stringify({ data, activeSheet: activeSheet.value });

    await window.electron.ipcRenderer.invoke('file-sync:save', props.file.id, content, props.projectId);

    props.file.content = content;
    hasChanges.value = false;
    lastSaved.value = formatDistanceToNow(new Date(), {
      addSuffix: true,
      locale: zhCN,
    });

    emit('save');
    message.success('文件已保存');
  } catch (error) {
    logger.error('保存文件失败:', error);
    message.error('保存文件失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 下载Excel文件
const handleDownload = () => {
  try {
    const data = getSpreadsheetData();
    const csv = data.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = props.file.file_name.replace(/\.[^/.]+$/, '.csv');
    a.click();
    URL.revokeObjectURL(url);
    message.success('文件已下载');
  } catch (error) {
    logger.error('下载失败:', error);
    message.error('下载失败');
  }
};

// 全屏切换
const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
  const container = excelContainer.value;

  if (isFullscreen.value) {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
};

// 键盘快捷键
const handleKeydown = (e) => {
  // Ctrl+S 保存
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    handleSave();
  }
};

// 帮助
const showHelp = () => {
  message.info('Excel编辑器帮助：支持单元格编辑、公式、格式化等功能');
};

// 监听文件变化
watch(
  () => props.file,
  (newFile) => {
    if (newFile && spreadsheetInstance.value) {
      const data = parseExcelData(newFile.content);
      if (spreadsheetInstance.value.setData) {
        spreadsheetInstance.value.setData(data);
      }
      hasChanges.value = false;
    }
  }
);
</script>

<style scoped lang="scss">
.excel-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;

  &:fullscreen {
    .excel-content {
      height: calc(100vh - 180px);
    }
  }
}

.editor-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f9fafb;

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;

    .file-icon {
      font-size: 18px;
      color: #27ae60;
    }

    .file-name {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
    }
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.excel-toolbar {
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;

  :deep(.ant-tabs-nav) {
    margin-bottom: 0;
    padding: 0 16px;
  }

  :deep(.ant-tabs-content) {
    padding: 8px 16px;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.excel-content {
  flex: 1;
  overflow: auto;
  position: relative;
  min-height: 0;

  .spreadsheet-container {
    width: 100%;
    height: 100%;
    padding: 16px;

    :deep(.jexcel) {
      width: 100% !important;
      height: 100% !important;
    }
  }

  // 基本表格样式（降级方案）
  .basic-excel-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;

    th,
    td {
      border: 1px solid #d0d5dd;
      padding: 8px;
      text-align: left;
      min-width: 80px;
    }

    th {
      background: #f9fafb;
      font-weight: 600;
      color: #374151;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    td {
      background: #ffffff;

      &:focus {
        outline: 2px solid #1677ff;
        outline-offset: -2px;
      }
    }

    tr:hover td {
      background: #f9fafb;
    }
  }
}

.editor-footer {
  padding: 6px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f9fafb;
  font-size: 12px;
  color: #6b7280;

  .footer-left,
  .footer-right {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}
</style>
