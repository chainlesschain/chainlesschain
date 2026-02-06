<template>
  <div class="excel-editor-container">
    <!-- 工具栏 -->
    <div class="excel-toolbar">
      <!-- 左侧：工作表标签 -->
      <div class="sheet-tabs">
        <a-tabs
          v-model:active-key="activeSheetIndex"
          type="editable-card"
          size="small"
          @edit="handleSheetEdit"
          @change="handleSheetChange"
        >
          <a-tab-pane
            v-for="(sheet, index) in sheets"
            :key="index"
            :tab="sheet.name"
            :closable="sheets.length > 1"
          />
        </a-tabs>
      </div>

      <!-- 右侧：操作按钮 -->
      <div class="toolbar-actions">
        <a-space>
          <!-- 插入行/列 -->
          <a-dropdown>
            <a-button size="small">
              <PlusOutlined />
              插入
            </a-button>
            <template #overlay>
              <a-menu @click="handleInsert">
                <a-menu-item key="row-before">
                  在上方插入行
                </a-menu-item>
                <a-menu-item key="row-after">
                  在下方插入行
                </a-menu-item>
                <a-menu-divider />
                <a-menu-item key="col-before">
                  在左侧插入列
                </a-menu-item>
                <a-menu-item key="col-after">
                  在右侧插入列
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>

          <!-- 删除行/列 -->
          <a-dropdown>
            <a-button
              size="small"
              danger
            >
              <DeleteOutlined />
              删除
            </a-button>
            <template #overlay>
              <a-menu @click="handleDelete">
                <a-menu-item key="row">
                  删除选中行
                </a-menu-item>
                <a-menu-item key="col">
                  删除选中列
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>

          <!-- 格式化 -->
          <a-dropdown>
            <a-button size="small">
              <FormatPainterOutlined />
              格式
            </a-button>
            <template #overlay>
              <a-menu @click="handleFormat">
                <a-menu-item key="bold">
                  <BoldOutlined />
                  粗体
                </a-menu-item>
                <a-menu-item key="italic">
                  <ItalicOutlined />
                  斜体
                </a-menu-item>
                <a-menu-divider />
                <a-menu-item key="align-left">
                  左对齐
                </a-menu-item>
                <a-menu-item key="align-center">
                  居中
                </a-menu-item>
                <a-menu-item key="align-right">
                  右对齐
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>

          <!-- 数据操作 -->
          <a-dropdown>
            <a-button size="small">
              <FunctionOutlined />
              数据
            </a-button>
            <template #overlay>
              <a-menu @click="handleDataOperation">
                <a-menu-item key="sort-asc">
                  升序排序
                </a-menu-item>
                <a-menu-item key="sort-desc">
                  降序排序
                </a-menu-item>
                <a-menu-divider />
                <a-menu-item key="filter">
                  筛选
                </a-menu-item>
                <a-menu-item key="sum">
                  求和
                </a-menu-item>
                <a-menu-item key="average">
                  平均值
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>

          <!-- 导出 -->
          <a-dropdown>
            <a-button
              size="small"
              type="primary"
            >
              <ExportOutlined />
              导出
            </a-button>
            <template #overlay>
              <a-menu @click="handleExport">
                <a-menu-item key="excel">
                  导出为Excel
                </a-menu-item>
                <a-menu-item key="csv">
                  导出为CSV
                </a-menu-item>
                <a-menu-item key="json">
                  导出为JSON
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </a-space>
      </div>
    </div>

    <!-- 表格编辑区 -->
    <div
      ref="spreadsheetRef"
      class="excel-spreadsheet"
    />

    <!-- 底部状态栏 -->
    <div class="excel-statusbar">
      <div class="status-left">
        <span v-if="selectedCell">
          选中单元格: {{ selectedCell }}
        </span>
      </div>
      <div class="status-right">
        <span>行: {{ currentSheet?.rows?.length || 0 }}</span>
        <a-divider type="vertical" />
        <span>列: {{ currentSheet?.columns?.length || 0 }}</span>
        <a-divider type="vertical" />
        <span
          v-if="hasUnsavedChanges"
          class="unsaved-indicator"
        >
          <EditOutlined />
          未保存
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import jspreadsheet from 'jspreadsheet-ce';
import {
  PlusOutlined,
  DeleteOutlined,
  FormatPainterOutlined,
  BoldOutlined,
  ItalicOutlined,
  FunctionOutlined,
  ExportOutlined,
  EditOutlined,
} from '@ant-design/icons-vue';
import 'jspreadsheet-ce/dist/jspreadsheet.css';

const props = defineProps({
  file: {
    type: Object,
    required: true,
  },
  initialData: {
    type: Object,
    default: null,
  },
  readOnly: {
    type: Boolean,
    default: false,
  },
  autoSave: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['change', 'save']);

// 响应式状态
const spreadsheetRef = ref(null);
const spreadsheet = ref(null);
const sheets = ref([]);
const activeSheetIndex = ref(0);
const selectedCell = ref('');
const hasUnsavedChanges = ref(false);
const autoSaveTimer = ref(null);

// 计算属性
const currentSheet = computed(() => sheets.value[activeSheetIndex.value]);

// 初始化表格
const initSpreadsheet = async () => {
  try {
    // 加载数据
    let data = props.initialData;
    if (!data && props.file?.file_path) {
      // 从后端读取Excel文件
      const result = await window.electronAPI.file.readExcel(props.file.file_path);
      data = result;
    }

    if (data && data.sheets && data.sheets.length > 0) {
      sheets.value = data.sheets;
    } else {
      // 创建默认工作表
      sheets.value = [{
        name: 'Sheet1',
        id: 1,
        rows: Array(20).fill(null).map(() => ({
          values: Array(10).fill(null).map(() => ({ value: '' })),
        })),
        columns: Array(10).fill(null).map((_, i) => ({
          index: i,
          header: String.fromCharCode(65 + i),
          width: 100,
        })),
      }];
    }

    // 渲染当前工作表
    await renderSheet(activeSheetIndex.value);
  } catch (error) {
    logger.error('[ExcelEditor] Init error:', error);
    message.error('初始化Excel编辑器失败: ' + error.message);
  }
};

// 渲染工作表
const renderSheet = async (sheetIndex) => {
  await nextTick();

  if (!spreadsheetRef.value) {
    logger.error('[ExcelEditor] Spreadsheet ref not available');
    return;
  }

  const sheet = sheets.value[sheetIndex];
  if (!sheet) {
    logger.error('[ExcelEditor] Sheet not found:', sheetIndex);
    return;
  }

  // 验证sheet结构
  if (!sheet.rows || !Array.isArray(sheet.rows)) {
    logger.error('[ExcelEditor] Invalid sheet structure: rows missing or not an array');
    return;
  }

  if (!sheet.columns || !Array.isArray(sheet.columns)) {
    logger.error('[ExcelEditor] Invalid sheet structure: columns missing or not an array');
    return;
  }

  // 清除旧的表格实例
  if (spreadsheet.value) {
    try {
      jspreadsheet.destroy(spreadsheetRef.value);
    } catch (destroyError) {
      logger.warn('[ExcelEditor] Failed to destroy previous instance:', destroyError);
    }
    spreadsheet.value = null;
  }

  // 转换数据格式为jspreadsheet需要的格式
  const data = sheet.rows.map(row => {
    if (!row || !row.values || !Array.isArray(row.values)) {
      return Array(sheet.columns.length).fill('');
    }
    return row.values.map(cell => cell?.value ?? '');
  });

  const columns = sheet.columns.map(col => ({
    title: col?.header || col?.key || '',
    width: col?.width || 100,
  }));

  const worksheetConfig = {
    name: sheet.name || `Sheet${sheetIndex + 1}`,
    data: data.length > 0 ? data : [Array(columns.length).fill('')],
    columns,
    minDimensions: [10, 20],
    allowInsertRow: !props.readOnly,
    allowInsertColumn: !props.readOnly,
    allowDeleteRow: !props.readOnly,
    allowDeleteColumn: !props.readOnly,
    allowRenameColumn: !props.readOnly,
    editable: !props.readOnly,
    tableOverflow: true,
    tableHeight: 'calc(100vh - 300px)',
    tableWidth: '100%',
    onchange: handleCellChange,
    onselection: handleCellSelection,
    oninsertrow: handleRowInsert,
    ondeleterow: handleRowDelete,
    oninsertcolumn: handleColumnInsert,
    ondeletecolumn: handleColumnDelete,
  };

  // 创建jspreadsheet实例 - v5 API 使用worksheets
  try {
    logger.info('[ExcelEditor] Creating jspreadsheet with data:', {
      rows: data.length,
      cols: columns.length,
      readOnly: props.readOnly
    });

    spreadsheet.value = jspreadsheet(spreadsheetRef.value, {
      worksheets: [worksheetConfig],
    });

    logger.info('[ExcelEditor] jspreadsheet created successfully');
  } catch (error) {
    logger.error('[ExcelEditor] jspreadsheet init error:', error);
    logger.error('[ExcelEditor] Error stack:', error.stack);
    message.error('创建表格失败: ' + error.message);

    // 尝试使用最简单的配置作为fallback
    try {
      logger.info('[ExcelEditor] Attempting fallback initialization...');
      spreadsheet.value = jspreadsheet(spreadsheetRef.value, {
        worksheets: [{
          name: 'Sheet1',
          data: [['']],
          minDimensions: [10, 20],
        }],
      });
      logger.info('[ExcelEditor] Fallback initialization successful');
    } catch (fallbackError) {
      logger.error('[ExcelEditor] Fallback init also failed:', fallbackError);
    }
  }
};

// 获取当前工作表实例 - v5直接返回spreadsheet对象
const getCurrentWorksheet = () => {
  if (spreadsheet.value?.worksheets?.length) {
    return spreadsheet.value.worksheets[0];
  }
  return spreadsheet.value;
};

// 处理单元格变化
const handleCellChange = (instance, cell, x, y, value) => {
  hasUnsavedChanges.value = true;

  // 更新内部数据
  if (sheets.value[activeSheetIndex.value]?.rows[y]?.values[x]) {
    sheets.value[activeSheetIndex.value].rows[y].values[x].value = value;
  }

  emit('change', {
    sheet: activeSheetIndex.value,
    cell: { x, y },
    value,
  });

  // 自动保存
  if (props.autoSave) {
    scheduleAutoSave();
  }
};

// 处理单元格选择
const handleCellSelection = (instance, x1, y1, x2, y2) => {
  const colName = String.fromCharCode(65 + x1);
  selectedCell.value = `${colName}${y1 + 1}`;

  if (x1 !== x2 || y1 !== y2) {
    const colName2 = String.fromCharCode(65 + x2);
    selectedCell.value += `:${colName2}${y2 + 1}`;
  }
};

// 处理行插入
const handleRowInsert = (instance, y, numOfRows) => {
  hasUnsavedChanges.value = true;
  message.success(`已插入 ${numOfRows} 行`);
};

// 处理行删除
const handleRowDelete = (instance, y, numOfRows) => {
  hasUnsavedChanges.value = true;
  message.success(`已删除 ${numOfRows} 行`);
};

// 处理列插入
const handleColumnInsert = (instance, x, numOfColumns) => {
  hasUnsavedChanges.value = true;
  message.success(`已插入 ${numOfColumns} 列`);
};

// 处理列删除
const handleColumnDelete = (instance, x, numOfColumns) => {
  hasUnsavedChanges.value = true;
  message.success(`已删除 ${numOfColumns} 列`);
};

// 工作表标签操作
const handleSheetEdit = (targetKey, action) => {
  if (action === 'add') {
    addSheet();
  } else if (action === 'remove') {
    removeSheet(Number(targetKey));
  }
};

// 切换工作表
const handleSheetChange = (key) => {
  activeSheetIndex.value = Number(key);
  renderSheet(activeSheetIndex.value);
};

// 添加工作表
const addSheet = () => {
  const newSheet = {
    name: `Sheet${sheets.value.length + 1}`,
    id: sheets.value.length + 1,
    rows: Array(20).fill(null).map(() => ({
      values: Array(10).fill(null).map(() => ({ value: '' })),
    })),
    columns: Array(10).fill(null).map((_, i) => ({
      index: i,
      header: String.fromCharCode(65 + i),
      width: 100,
    })),
  };

  sheets.value.push(newSheet);
  activeSheetIndex.value = sheets.value.length - 1;
  renderSheet(activeSheetIndex.value);
  hasUnsavedChanges.value = true;
  message.success('已添加新工作表');
};

// 删除工作表
const removeSheet = (index) => {
  if (sheets.value.length === 1) {
    message.warning('至少需要保留一个工作表');
    return;
  }

  sheets.value.splice(index, 1);
  if (activeSheetIndex.value >= sheets.value.length) {
    activeSheetIndex.value = sheets.value.length - 1;
  }
  renderSheet(activeSheetIndex.value);
  hasUnsavedChanges.value = true;
  message.success('已删除工作表');
};

// 插入操作
const handleInsert = ({ key }) => {
  const worksheet = getCurrentWorksheet();
  if (!worksheet) {return;}

  switch (key) {
    case 'row-before':
      worksheet.insertRow(1, 0, true);
      break;
    case 'row-after':
      worksheet.insertRow(1, undefined, false);
      break;
    case 'col-before':
      worksheet.insertColumn(1, 0, true);
      break;
    case 'col-after':
      worksheet.insertColumn(1, undefined, false);
      break;
  }
};

// 删除操作
const handleDelete = ({ key }) => {
  const worksheet = getCurrentWorksheet();
  if (!worksheet) {return;}

  switch (key) {
    case 'row': {
      const selectedRows = worksheet.getSelectedRows();
      if (selectedRows.length > 0) {
        worksheet.deleteRow(selectedRows.length);
      } else {
        message.warning('请先选择要删除的行');
      }
      break;
    }
    case 'col': {
      const selectedCols = worksheet.getSelectedColumns();
      if (selectedCols.length > 0) {
        worksheet.deleteColumn(selectedCols.length);
      } else {
        message.warning('请先选择要删除的列');
      }
      break;
    }
  }
};

// 格式化操作
const handleFormat = ({ key }) => {
  const worksheet = getCurrentWorksheet();
  if (!worksheet) {return;}

  const selection = worksheet.getSelected();
  if (!selection) {
    message.warning('请先选择单元格');
    return;
  }

  switch (key) {
    case 'bold':
      worksheet.setStyle(selection, 'font-weight', 'bold');
      break;
    case 'italic':
      worksheet.setStyle(selection, 'font-style', 'italic');
      break;
    case 'align-left':
      worksheet.setStyle(selection, 'text-align', 'left');
      break;
    case 'align-center':
      worksheet.setStyle(selection, 'text-align', 'center');
      break;
    case 'align-right':
      worksheet.setStyle(selection, 'text-align', 'right');
      break;
  }

  hasUnsavedChanges.value = true;
};

// 数据操作
const handleDataOperation = ({ key }) => {
  const worksheet = getCurrentWorksheet();
  if (!worksheet) {return;}

  switch (key) {
    case 'sort-asc':
      worksheet.orderBy(0, 0);
      break;
    case 'sort-desc':
      worksheet.orderBy(0, 1);
      break;
    case 'sum':
      calculateSum();
      break;
    case 'average':
      calculateAverage();
      break;
  }
};

// 计算求和
const calculateSum = () => {
  const worksheet = getCurrentWorksheet();
  if (!worksheet) {return;}

  const selection = worksheet.getSelected();
  if (!selection) {
    message.warning('请先选择单元格范围');
    return;
  }

  const data = worksheet.getData();
  let sum = 0;
  let count = 0;

  for (let y = selection[1]; y <= selection[3]; y++) {
    for (let x = selection[0]; x <= selection[2]; x++) {
      const value = parseFloat(data[y][x]);
      if (!isNaN(value)) {
        sum += value;
        count++;
      }
    }
  }

  message.success(`求和结果: ${sum} (共${count}个数值)`);
};

// 计算平均值
const calculateAverage = () => {
  const worksheet = getCurrentWorksheet();
  if (!worksheet) {return;}

  const selection = worksheet.getSelected();
  if (!selection) {
    message.warning('请先选择单元格范围');
    return;
  }

  const data = worksheet.getData();
  let sum = 0;
  let count = 0;

  for (let y = selection[1]; y <= selection[3]; y++) {
    for (let x = selection[0]; x <= selection[2]; x++) {
      const value = parseFloat(data[y][x]);
      if (!isNaN(value)) {
        sum += value;
        count++;
      }
    }
  }

  const average = count > 0 ? sum / count : 0;
  message.success(`平均值: ${average.toFixed(2)} (共${count}个数值)`);
};

// 导出操作
const handleExport = async ({ key }) => {
  try {
    const data = getCurrentData();

    switch (key) {
      case 'excel':
        await exportToExcel(data);
        break;
      case 'csv':
        await exportToCSV(data);
        break;
      case 'json':
        await exportToJSON(data);
        break;
    }
  } catch (error) {
    logger.error('[ExcelEditor] Export error:', error);
    message.error('导出失败: ' + error.message);
  }
};

// 获取当前数据
const getCurrentData = () => {
  const worksheet = getCurrentWorksheet();
  if (!worksheet) {return null;}

  const data = worksheet.getData();
  const currentSheetData = { ...currentSheet.value };

  // 更新行数据
  currentSheetData.rows = data.map((row, rowIndex) => ({
    rowNumber: rowIndex + 1,
    values: row.map((value, colIndex) => ({
      col: colIndex + 1,
      value: value,
      type: typeof value === 'number' ? 'number' : 'string',
    })),
    height: 20,
  }));

  // 更新工作表
  sheets.value[activeSheetIndex.value] = currentSheetData;

  return {
    type: 'excel',
    sheets: sheets.value,
  };
};

// 导出为Excel
const exportToExcel = async (data) => {
  const result = await window.electronAPI.dialog.showSaveDialog({
    defaultPath: props.file?.file_name?.replace(/\.[^.]+$/, '.xlsx') || 'export.xlsx',
    filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
  });

  if (!result.canceled && result.filePath) {
    await window.electronAPI.file.writeExcel(result.filePath, data);
    message.success('导出成功: ' + result.filePath);
  }
};

// 导出为CSV
const exportToCSV = async (data) => {
  const result = await window.electronAPI.dialog.showSaveDialog({
    defaultPath: props.file?.file_name?.replace(/\.[^.]+$/, '.csv') || 'export.csv',
    filters: [{ name: 'CSV文件', extensions: ['csv'] }],
  });

  if (!result.canceled && result.filePath) {
    await window.electronAPI.file.writeExcel(result.filePath, data);
    message.success('导出成功: ' + result.filePath);
  }
};

// 导出为JSON
const exportToJSON = async (data) => {
  const jsonData = await window.electronAPI.file.excelToJSON(props.file.file_path);

  const result = await window.electronAPI.dialog.showSaveDialog({
    defaultPath: props.file?.file_name?.replace(/\.[^.]+$/, '.json') || 'export.json',
    filters: [{ name: 'JSON文件', extensions: ['json'] }],
  });

  if (!result.canceled && result.filePath) {
    await window.electronAPI.file.writeFile(result.filePath, JSON.stringify(jsonData, null, 2));
    message.success('导出成功: ' + result.filePath);
  }
};

// 自动保存
const scheduleAutoSave = () => {
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value);
  }

  autoSaveTimer.value = setTimeout(() => {
    saveChanges();
  }, 2000); // 2秒后自动保存
};

// 保存更改
const saveChanges = async () => {
  try {
    const data = getCurrentData();
    await window.electronAPI.file.writeExcel(props.file.file_path, data);

    hasUnsavedChanges.value = false;
    emit('save', data);
    message.success('已保存');
  } catch (error) {
    logger.error('[ExcelEditor] Save error:', error);
    message.error('保存失败: ' + error.message);
  }
};

// 组件挂载
onMounted(() => {
  initSpreadsheet();
});

// 组件卸载
onBeforeUnmount(() => {
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value);
  }

  if (spreadsheet.value) {
    jspreadsheet.destroy(spreadsheetRef.value);
  }
});

// 监听文件变化
watch(() => props.file, () => {
  initSpreadsheet();
}, { deep: true });

// 暴露方法
defineExpose({
  save: saveChanges,
  getData: getCurrentData,
});
</script>

<style scoped>
.excel-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.excel-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.sheet-tabs {
  flex: 1;
  min-width: 0;
}

.sheet-tabs :deep(.ant-tabs) {
  margin: 0;
}

.sheet-tabs :deep(.ant-tabs-nav) {
  margin: 0;
}

.toolbar-actions {
  flex-shrink: 0;
  margin-left: 16px;
}

.excel-spreadsheet {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

/* jspreadsheet样式覆盖 */
.excel-spreadsheet :deep(.jexcel_container) {
  border: 1px solid #d9d9d9;
}

.excel-spreadsheet :deep(.jexcel thead td) {
  background: #fafafa;
  font-weight: 600;
}

.excel-spreadsheet :deep(.jexcel tbody tr:hover) {
  background: #f5f5f5;
}

.excel-statusbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid #e8e8e8;
  background: #fafafa;
  font-size: 12px;
  color: #666;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unsaved-indicator {
  color: #faad14;
  font-weight: 500;
}
</style>
