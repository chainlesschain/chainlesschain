<template>
  <a-card
    title="时间范围与操作"
    class="controls-card"
  >
    <div class="controls-wrapper">
      <div class="controls-row">
        <a-radio-group
          :value="timeRange"
          button-style="solid"
          class="time-range-group"
          @change="(e) => $emit('time-change', e.target.value)"
        >
          <a-radio-button value="24h">
            过去 24 小时
          </a-radio-button>
          <a-radio-button value="7d">
            过去 7 天
          </a-radio-button>
          <a-radio-button value="30d">
            过去 30 天
          </a-radio-button>
          <a-radio-button value="custom">
            自定义
          </a-radio-button>
        </a-radio-group>

        <a-range-picker
          v-if="timeRange === 'custom'"
          :value="customDateRange"
          :show-time="{ format: 'HH:mm' }"
          format="YYYY-MM-DD HH:mm"
          class="custom-date-picker"
          @change="(dates) => $emit('custom-date-change', dates)"
        />
      </div>

      <a-divider
        type="vertical"
        class="controls-divider"
      />

      <div class="controls-row auto-refresh-row">
        <span class="auto-refresh-label">
          <SyncOutlined :spin="autoRefreshEnabled" />
          自动刷新
        </span>
        <a-switch
          :checked="autoRefreshEnabled"
          @change="(enabled) => $emit('toggle-auto-refresh', enabled)"
        />
        <a-select
          :value="autoRefreshInterval"
          :disabled="!autoRefreshEnabled"
          style="width: 100px"
          size="small"
          @change="(value) => $emit('interval-change', value)"
        >
          <a-select-option :value="30">
            30 秒
          </a-select-option>
          <a-select-option :value="60">
            60 秒
          </a-select-option>
          <a-select-option :value="120">
            2 分钟
          </a-select-option>
          <a-select-option :value="300">
            5 分钟
          </a-select-option>
        </a-select>
      </div>

      <a-divider
        type="vertical"
        class="controls-divider"
      />

      <div class="controls-row action-row">
        <a-button
          type="primary"
          :loading="loading"
          @click="$emit('refresh')"
        >
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新数据
        </a-button>

        <a-button
          :loading="exporting"
          @click="$emit('export')"
        >
          <template #icon>
            <DownloadOutlined />
          </template>
          导出报告
        </a-button>

        <a-dropdown v-if="showExportOptions">
          <template #overlay>
            <a-menu @click="handleExportMenuClick">
              <a-menu-item key="csv">
                <FileTextOutlined /> 导出 CSV
              </a-menu-item>
              <a-menu-item key="excel">
                <FileExcelOutlined /> 导出 Excel
              </a-menu-item>
              <a-menu-item key="json">
                <CodeOutlined /> 导出 JSON
              </a-menu-item>
            </a-menu>
          </template>
          <a-button>
            <MoreOutlined />
          </a-button>
        </a-dropdown>

        <a-tooltip title="生成30天的测试数据以预览仪表板功能（仅用于开发测试）">
          <a-button
            :loading="generatingTestData"
            @click="$emit('generate-test-data')"
          >
            <template #icon>
              <ExperimentOutlined />
            </template>
            {{ generatingTestData ? "生成中..." : "生成测试数据" }}
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- Keyboard shortcuts hint -->
    <div
      v-if="showKeyboardHints"
      class="keyboard-hints"
    >
      <a-tag>R - 刷新</a-tag>
      <a-tag>E - 导出</a-tag>
      <a-tag>G - 生成测试数据</a-tag>
      <a-tag>1-4 - 切换时间</a-tag>
    </div>
  </a-card>
</template>

<script setup>
import { onMounted, onUnmounted } from "vue";
import {
  SyncOutlined,
  ReloadOutlined,
  DownloadOutlined,
  MoreOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  CodeOutlined,
  ExperimentOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  timeRange: {
    type: String,
    default: "7d",
  },
  customDateRange: {
    type: Array,
    default: null,
  },
  autoRefreshEnabled: {
    type: Boolean,
    default: true,
  },
  autoRefreshInterval: {
    type: Number,
    default: 60,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  exporting: {
    type: Boolean,
    default: false,
  },
  showExportOptions: {
    type: Boolean,
    default: true,
  },
  showKeyboardHints: {
    type: Boolean,
    default: false,
  },
  generatingTestData: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "time-change",
  "custom-date-change",
  "toggle-auto-refresh",
  "interval-change",
  "refresh",
  "export",
  "export-csv",
  "export-excel",
  "export-json",
  "generate-test-data",
]);

const handleExportMenuClick = ({ key }) => {
  emit(`export-${key}`);
};

// Keyboard shortcuts
const handleKeydown = (event) => {
  // Skip if user is typing in an input
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") {
    return;
  }

  switch (event.key.toLowerCase()) {
    case "r":
      emit("refresh");
      break;
    case "e":
      emit("export");
      break;
    case "g":
      emit("generate-test-data");
      break;
    case "1":
      emit("time-change", "24h");
      break;
    case "2":
      emit("time-change", "7d");
      break;
    case "3":
      emit("time-change", "30d");
      break;
    case "4":
      emit("time-change", "custom");
      break;
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<style lang="less" scoped>
.controls-card {
  margin-bottom: 16px;

  .controls-wrapper {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .controls-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .controls-divider {
    height: 24px;
    margin: 0 8px;
  }

  .auto-refresh-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #595959;
    font-size: 14px;
  }

  .keyboard-hints {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed #e8e8e8;

    :deep(.ant-tag) {
      margin-right: 8px;
      font-size: 11px;
      background: #f5f5f5;
      border-color: #d9d9d9;
    }
  }
}

// Mobile responsiveness
@media (max-width: 1199px) {
  .controls-card {
    .controls-wrapper {
      flex-direction: column;
      align-items: flex-start;
    }

    .controls-divider {
      display: none;
    }

    .controls-row {
      width: 100%;
      flex-wrap: wrap;
    }

    .time-range-group {
      width: 100%;

      :deep(.ant-radio-button-wrapper) {
        flex: 1;
        text-align: center;
      }
    }

    .custom-date-picker {
      width: 100%;
      margin-top: 8px;
    }

    .action-row {
      width: 100%;

      button {
        flex: 1;
      }
    }
  }
}

@media (max-width: 767px) {
  .controls-card {
    .auto-refresh-row {
      justify-content: space-between;
    }
  }
}
</style>
