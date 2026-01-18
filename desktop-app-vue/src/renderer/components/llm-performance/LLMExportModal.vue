<template>
  <a-modal
    v-model:open="visible"
    title="导出报告"
    :footer="null"
    :width="500"
    @cancel="$emit('close')"
  >
    <div class="export-modal-content">
      <a-form layout="vertical">
        <!-- Export Format -->
        <a-form-item label="导出格式">
          <a-radio-group v-model:value="exportFormat" button-style="solid">
            <a-radio-button value="csv">
              <FileTextOutlined /> CSV
            </a-radio-button>
            <a-radio-button value="excel">
              <FileExcelOutlined /> Excel
            </a-radio-button>
            <a-radio-button value="json">
              <CodeOutlined /> JSON
            </a-radio-button>
          </a-radio-group>
        </a-form-item>

        <!-- Date Range -->
        <a-form-item label="时间范围">
          <a-radio-group v-model:value="dateRangeType" class="date-range-group">
            <a-radio value="current">当前选择的时间范围</a-radio>
            <a-radio value="custom">自定义时间范围</a-radio>
          </a-radio-group>
          <a-range-picker
            v-if="dateRangeType === 'custom'"
            v-model:value="customDateRange"
            style="width: 100%; margin-top: 8px"
            :show-time="{ format: 'HH:mm' }"
            format="YYYY-MM-DD HH:mm"
          />
        </a-form-item>

        <!-- Content Selection -->
        <a-form-item label="导出内容">
          <a-checkbox-group
            v-model:value="exportSections"
            class="section-checkboxes"
          >
            <a-row :gutter="[8, 8]">
              <a-col :span="12">
                <a-checkbox value="summary">
                  <BarChartOutlined /> 统计概览
                </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="provider">
                  <CloudOutlined /> 按提供商分组
                </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="model">
                  <RobotOutlined /> 按模型分组
                </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="timeseries">
                  <LineChartOutlined /> 时间序列数据
                </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="alerts">
                  <AlertOutlined /> 告警历史
                </a-checkbox>
              </a-col>
              <a-col :span="12">
                <a-checkbox value="cache">
                  <DatabaseOutlined /> 缓存统计
                </a-checkbox>
              </a-col>
            </a-row>
          </a-checkbox-group>
        </a-form-item>

        <!-- Excel-specific options -->
        <a-form-item v-if="exportFormat === 'excel'" label="Excel 选项">
          <a-checkbox v-model:checked="excelOptions.multiSheet">
            分多个工作表导出
          </a-checkbox>
          <a-checkbox
            v-model:checked="excelOptions.includeCharts"
            style="margin-left: 16px"
          >
            包含图表
          </a-checkbox>
        </a-form-item>
      </a-form>

      <a-divider />

      <!-- Preview -->
      <div class="export-preview">
        <h4>导出预览</h4>
        <div class="preview-info">
          <a-descriptions size="small" :column="1" bordered>
            <a-descriptions-item label="格式">
              {{ formatLabel }}
            </a-descriptions-item>
            <a-descriptions-item label="内容">
              {{ exportSections.length }} 个部分
            </a-descriptions-item>
            <a-descriptions-item label="预计大小">
              {{ estimatedSize }}
            </a-descriptions-item>
          </a-descriptions>
        </div>
      </div>

      <div class="export-actions">
        <a-button @click="$emit('close')">取消</a-button>
        <a-button
          type="primary"
          :loading="exporting"
          @click="handleExport"
          :disabled="exportSections.length === 0"
        >
          <DownloadOutlined />
          {{ exporting ? "导出中..." : "开始导出" }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import {
  FileTextOutlined,
  FileExcelOutlined,
  CodeOutlined,
  BarChartOutlined,
  CloudOutlined,
  RobotOutlined,
  LineChartOutlined,
  AlertOutlined,
  DatabaseOutlined,
  DownloadOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  currentDateRange: {
    type: Object,
    default: () => ({ startDate: null, endDate: null }),
  },
});

const emit = defineEmits(["close", "export"]);

const visible = ref(false);
const exportFormat = ref("excel");
const dateRangeType = ref("current");
const customDateRange = ref(null);
const exportSections = ref(["summary", "provider", "model", "timeseries"]);
const exporting = ref(false);

const excelOptions = ref({
  multiSheet: true,
  includeCharts: false,
});

// Sync visible with open prop
watch(
  () => props.open,
  (newVal) => {
    visible.value = newVal;
  },
);

watch(visible, (newVal) => {
  if (!newVal) {
    emit("close");
  }
});

const formatLabel = computed(() => {
  const labels = {
    csv: "CSV (逗号分隔)",
    excel: "Excel 工作簿 (.xlsx)",
    json: "JSON 数据",
  };
  return labels[exportFormat.value];
});

const estimatedSize = computed(() => {
  // Rough estimate based on sections selected
  const baseSize = 5; // KB
  const sectionSize = exportSections.value.length * 10;
  const total = baseSize + sectionSize;

  if (exportFormat.value === "json") {
    return `~${total} KB`;
  } else if (exportFormat.value === "excel") {
    return `~${Math.round(total * 1.5)} KB`;
  }
  return `~${total} KB`;
});

const handleExport = async () => {
  exporting.value = true;

  const exportConfig = {
    format: exportFormat.value,
    dateRange:
      dateRangeType.value === "current"
        ? props.currentDateRange
        : {
            startDate: customDateRange.value?.[0]?.valueOf(),
            endDate: customDateRange.value?.[1]?.valueOf(),
          },
    sections: exportSections.value,
    options: exportFormat.value === "excel" ? excelOptions.value : {},
  };

  try {
    emit("export", exportConfig);
  } finally {
    // The parent will handle closing and resetting exporting state
    setTimeout(() => {
      exporting.value = false;
    }, 500);
  }
};
</script>

<style lang="less" scoped>
.export-modal-content {
  .date-range-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-checkboxes {
    width: 100%;
  }

  .export-preview {
    h4 {
      font-size: 14px;
      font-weight: 500;
      color: #262626;
      margin-bottom: 12px;
    }

    .preview-info {
      background: #fafafa;
      border-radius: 8px;
      padding: 12px;
    }
  }

  .export-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 16px;
  }
}

// Mobile responsiveness
@media (max-width: 767px) {
  .export-modal-content {
    .export-actions {
      flex-direction: column;

      button {
        width: 100%;
      }
    }
  }
}
</style>
