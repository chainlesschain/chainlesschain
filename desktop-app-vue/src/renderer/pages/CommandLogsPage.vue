<template>
  <div class="command-logs-page">
    <a-page-header title="命令日志" sub-title="远程命令执行日志与统计分析">
      <template #extra>
        <a-space>
          <a-button @click="refreshData">
            <template #icon>
              <ReloadOutlined />
            </template>
            刷新
          </a-button>
          <a-button @click="exportLogs">
            <template #icon>
              <DownloadOutlined />
            </template>
            导出日志
          </a-button>
          <a-switch
            v-model:checked="autoRefresh"
            checked-children="自动"
            un-checked-children="手动"
            @change="toggleAutoRefresh"
          />
        </a-space>
      </template>
    </a-page-header>

    <div class="content">
      <!-- 统计卡片 -->
      <a-row :gutter="16" style="margin-bottom: 16px">
        <a-col :span="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="总命令数"
              :value="dashboard.realTime.totalCommands"
              :prefix="h(FileTextOutlined)"
            >
              <template #suffix>
                <span style="font-size: 12px; color: #888">条</span>
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="成功率"
              :value="dashboard.realTime.successRate"
              :prefix="h(CheckCircleOutlined)"
              :value-style="{ color: '#3f8600' }"
            >
              <template #suffix> % </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="失败命令"
              :value="dashboard.realTime.failureCount"
              :prefix="h(CloseCircleOutlined)"
              :value-style="{ color: '#cf1322' }"
            >
              <template #suffix>
                <span style="font-size: 12px; color: #888">条</span>
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="平均耗时"
              :value="dashboard.realTime.avgDuration"
              :prefix="h(ClockCircleOutlined)"
            >
              <template #suffix> ms </template>
            </a-statistic>
          </a-card>
        </a-col>
      </a-row>

      <!-- 图表区域 -->
      <a-row :gutter="16" style="margin-bottom: 16px">
        <!-- 命令执行趋势 -->
        <a-col :span="12">
          <a-card title="命令执行趋势" :loading="loading.trend">
            <div ref="trendChartRef" style="width: 100%; height: 300px" />
          </a-card>
        </a-col>

        <!-- 成功率统计 -->
        <a-col :span="12">
          <a-card title="命令状态分布" :loading="loading.stats">
            <div ref="statusChartRef" style="width: 100%; height: 300px" />
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="16" style="margin-bottom: 16px">
        <!-- 命令排行 -->
        <a-col :span="12">
          <a-card title="命令排行 TOP 10" :loading="loading.ranking">
            <div ref="rankingChartRef" style="width: 100%; height: 300px" />
          </a-card>
        </a-col>

        <!-- 设备活跃度 -->
        <a-col :span="12">
          <a-card title="设备活跃度" :loading="loading.activity">
            <div ref="activityChartRef" style="width: 100%; height: 300px" />
          </a-card>
        </a-col>
      </a-row>

      <!-- 日志列表 -->
      <a-card title="命令日志" :loading="loading.logs">
        <template #extra>
          <a-space>
            <a-input-search
              v-model:value="searchQuery"
              placeholder="搜索日志（设备/命令/错误）"
              style="width: 250px"
              @search="handleSearch"
            />
            <a-select
              v-model:value="filter.namespace"
              style="width: 120px"
              placeholder="命名空间"
              allow-clear
              @change="handleFilterChange"
            >
              <a-select-option value="ai"> AI 命令 </a-select-option>
              <a-select-option value="system"> 系统命令 </a-select-option>
            </a-select>
            <a-select
              v-model:value="filter.status"
              style="width: 100px"
              placeholder="状态"
              allow-clear
              @change="handleFilterChange"
            >
              <a-select-option value="success"> 成功 </a-select-option>
              <a-select-option value="failure"> 失败 </a-select-option>
              <a-select-option value="warning"> 警告 </a-select-option>
            </a-select>
          </a-space>
        </template>

        <a-table
          :columns="logColumns"
          :data-source="logs"
          :pagination="pagination"
          :loading="loading.logs"
          row-key="id"
          @change="handleTableChange"
        >
          <!-- 命令列 -->
          <template #command="{ record }">
            <a-space direction="vertical" size="small">
              <a-tag color="blue">
                {{ record.namespace }}
              </a-tag>
              <span style="font-weight: 500">{{ record.action }}</span>
            </a-space>
          </template>

          <!-- 状态列 -->
          <template #status="{ record }">
            <a-tag :color="getStatusColor(record.status)">
              {{ getStatusText(record.status) }}
            </a-tag>
          </template>

          <!-- 设备列 -->
          <template #device="{ record }">
            <a-tooltip :title="record.deviceDid">
              <span>{{ truncate(record.deviceDid, 20) }}</span>
            </a-tooltip>
          </template>

          <!-- 耗时列 -->
          <template #duration="{ record }">
            <a-tag :color="getDurationColor(record.duration)">
              {{ record.duration }}ms
            </a-tag>
          </template>

          <!-- 时间列 -->
          <template #timestamp="{ record }">
            {{ formatTimestamp(record.timestamp) }}
          </template>

          <!-- 操作列 -->
          <template #action="{ record }">
            <a-button type="link" size="small" @click="viewLogDetail(record)">
              查看详情
            </a-button>
          </template>
        </a-table>
      </a-card>
    </div>

    <!-- 日志详情对话框 -->
    <a-modal
      v-model:open="detailModal.visible"
      title="日志详情"
      width="800px"
      :footer="null"
    >
      <a-descriptions v-if="detailModal.log" bordered :column="2">
        <a-descriptions-item label="请求 ID" :span="2">
          {{ detailModal.log.requestId }}
        </a-descriptions-item>
        <a-descriptions-item label="设备 DID" :span="2">
          {{ detailModal.log.deviceDid }}
        </a-descriptions-item>
        <a-descriptions-item label="设备名称">
          {{ detailModal.log.deviceName || "未知" }}
        </a-descriptions-item>
        <a-descriptions-item label="命令">
          {{ detailModal.log.namespace }}.{{ detailModal.log.action }}
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="getStatusColor(detailModal.log.status)">
            {{ getStatusText(detailModal.log.status) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="日志级别">
          <a-tag :color="getLevelColor(detailModal.log.level)">
            {{ detailModal.log.level.toUpperCase() }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="执行耗时">
          {{ detailModal.log.duration }}ms
        </a-descriptions-item>
        <a-descriptions-item label="时间">
          {{ formatTimestamp(detailModal.log.timestamp) }}
        </a-descriptions-item>
        <a-descriptions-item label="参数" :span="2">
          <pre
            style="
              max-height: 200px;
              overflow: auto;
              background: #f5f5f5;
              padding: 8px;
              border-radius: 4px;
            "
            >{{ formatJSON(detailModal.log.params) }}</pre
          >
        </a-descriptions-item>
        <a-descriptions-item
          v-if="detailModal.log.result"
          label="结果"
          :span="2"
        >
          <pre
            style="
              max-height: 200px;
              overflow: auto;
              background: #f5f5f5;
              padding: 8px;
              border-radius: 4px;
            "
            >{{ formatJSON(detailModal.log.result) }}</pre
          >
        </a-descriptions-item>
        <a-descriptions-item
          v-if="detailModal.log.error"
          label="错误信息"
          :span="2"
        >
          <a-alert :message="detailModal.log.error" type="error" show-icon />
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>

    <!-- 导出对话框 -->
    <a-modal
      v-model:open="exportModal.visible"
      title="导出日志"
      :confirm-loading="exportModal.loading"
      @ok="handleExport"
    >
      <a-form layout="vertical">
        <a-form-item label="导出格式">
          <a-radio-group v-model:value="exportModal.format">
            <a-radio value="json"> JSON </a-radio>
            <a-radio value="csv"> CSV </a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="时间范围">
          <a-range-picker v-model:value="exportModal.timeRange" show-time />
        </a-form-item>
        <a-form-item label="最大条数">
          <a-input-number
            v-model:value="exportModal.limit"
            :min="1"
            :max="10000"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, h } from "vue";
import { message } from "ant-design-vue";
import {
  ReloadOutlined,
  DownloadOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons-vue";
import * as echarts from "echarts";
import dayjs from "dayjs";

// Refs
const loading = reactive({
  logs: false,
  stats: false,
  trend: false,
  ranking: false,
  activity: false,
});

const dashboard = ref({
  realTime: {
    totalCommands: 0,
    successCount: 0,
    failureCount: 0,
    warningCount: 0,
    successRate: 0,
    avgDuration: 0,
  },
  logStats: {},
  deviceActivity: [],
  commandRanking: [],
  trend: [],
  recentLogs: [],
});

const logs = ref([]);
const searchQuery = ref("");
const filter = reactive({
  namespace: undefined,
  status: undefined,
});

const pagination = reactive({
  current: 1,
  pageSize: 20,
  total: 0,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`,
});

const autoRefresh = ref(false);
let autoRefreshTimer = null;

const detailModal = reactive({
  visible: false,
  log: null,
});

const exportModal = reactive({
  visible: false,
  loading: false,
  format: "json",
  timeRange: null,
  limit: 1000,
});

// 表格列定义
const logColumns = [
  {
    title: "命令",
    dataIndex: "command",
    key: "command",
    slots: { customRender: "command" },
    width: 150,
  },
  {
    title: "状态",
    dataIndex: "status",
    key: "status",
    slots: { customRender: "status" },
    width: 100,
  },
  {
    title: "设备",
    dataIndex: "device",
    key: "device",
    slots: { customRender: "device" },
    width: 200,
  },
  {
    title: "耗时",
    dataIndex: "duration",
    key: "duration",
    slots: { customRender: "duration" },
    width: 100,
  },
  {
    title: "时间",
    dataIndex: "timestamp",
    key: "timestamp",
    slots: { customRender: "timestamp" },
    width: 180,
  },
  {
    title: "操作",
    key: "action",
    slots: { customRender: "action" },
    width: 100,
  },
];

// Chart refs
const trendChartRef = ref(null);
const statusChartRef = ref(null);
const rankingChartRef = ref(null);
const activityChartRef = ref(null);

let trendChart = null;
let statusChart = null;
let rankingChart = null;
let activityChart = null;

// API 调用
async function fetchDashboard() {
  loading.stats = true;
  loading.trend = true;
  loading.ranking = true;
  loading.activity = true;

  try {
    const result = await window.electron.ipcRenderer.invoke(
      "remote:logs:dashboard",
      { days: 7 },
    );

    if (result.success) {
      dashboard.value = result.data;

      // 更新图表
      updateTrendChart(result.data.trend);
      updateStatusChart(result.data.realTime);
      updateRankingChart(result.data.commandRanking);
      updateActivityChart(result.data.deviceActivity);
    } else {
      message.error("获取仪表盘数据失败: " + result.error);
    }
  } catch (error) {
    console.error("获取仪表盘数据失败:", error);
    message.error("获取仪表盘数据失败: " + error.message);
  } finally {
    loading.stats = false;
    loading.trend = false;
    loading.ranking = false;
    loading.activity = false;
  }
}

async function fetchLogs() {
  loading.logs = true;

  try {
    const options = {
      page: pagination.current,
      pageSize: pagination.pageSize,
      search: searchQuery.value || undefined,
      namespace: filter.namespace,
      status: filter.status,
    };

    const result = await window.electron.ipcRenderer.invoke(
      "remote:logs:query",
      options,
    );

    if (result.success) {
      logs.value = result.data.logs;
      pagination.total = result.data.total;
    } else {
      message.error("获取日志列表失败: " + result.error);
    }
  } catch (error) {
    console.error("获取日志列表失败:", error);
    message.error("获取日志列表失败: " + error.message);
  } finally {
    loading.logs = false;
  }
}

// 图表更新函数
function updateTrendChart(trendData) {
  if (!trendChart || !trendData || trendData.length === 0) {
    return;
  }

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    legend: {
      data: ["总命令数", "成功", "失败"],
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trendData.map((item) =>
        dayjs(item.periodStart).format("MM-DD HH:mm"),
      ),
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        name: "总命令数",
        type: "line",
        data: trendData.map((item) => item.totalCount),
        smooth: true,
        itemStyle: { color: "#1890ff" },
      },
      {
        name: "成功",
        type: "line",
        data: trendData.map((item) => item.successCount),
        smooth: true,
        itemStyle: { color: "#52c41a" },
      },
      {
        name: "失败",
        type: "line",
        data: trendData.map((item) => item.failureCount),
        smooth: true,
        itemStyle: { color: "#f5222d" },
      },
    ],
  };

  trendChart.setOption(option);
}

function updateStatusChart(realTimeStats) {
  if (!statusChart) {
    return;
  }

  const option = {
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: {c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      left: "left",
    },
    series: [
      {
        name: "命令状态",
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: true,
          formatter: "{b}: {c}",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 16,
            fontWeight: "bold",
          },
        },
        data: [
          {
            value: realTimeStats.successCount,
            name: "成功",
            itemStyle: { color: "#52c41a" },
          },
          {
            value: realTimeStats.failureCount,
            name: "失败",
            itemStyle: { color: "#f5222d" },
          },
          {
            value: realTimeStats.warningCount,
            name: "警告",
            itemStyle: { color: "#faad14" },
          },
        ],
      },
    ],
  };

  statusChart.setOption(option);
}

function updateRankingChart(rankingData) {
  if (!rankingChart || !rankingData || rankingData.length === 0) {
    return;
  }

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
    },
    yAxis: {
      type: "category",
      data: rankingData
        .map((item) => `${item.namespace}.${item.action}`)
        .reverse(),
    },
    series: [
      {
        name: "执行次数",
        type: "bar",
        data: rankingData.map((item) => item.count).reverse(),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "#83bff6" },
            { offset: 1, color: "#188df0" },
          ]),
        },
        label: {
          show: true,
          position: "right",
        },
      },
    ],
  };

  rankingChart.setOption(option);
}

function updateActivityChart(activityData) {
  if (!activityChart || !activityData || activityData.length === 0) {
    return;
  }

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: activityData.map((item) => truncate(item.deviceDid, 15)),
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        name: "命令数",
        type: "bar",
        data: activityData.map((item) => item.count),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#f093fb" },
            { offset: 1, color: "#4facfe" },
          ]),
        },
        label: {
          show: true,
          position: "top",
        },
      },
    ],
  };

  activityChart.setOption(option);
}

// 事件处理
function refreshData() {
  fetchDashboard();
  fetchLogs();
  message.success("数据已刷新");
}

function toggleAutoRefresh(enabled) {
  if (enabled) {
    autoRefreshTimer = setInterval(() => {
      fetchDashboard();
      fetchLogs();
    }, 10000); // 每10秒刷新
    message.info("已启用自动刷新（每10秒）");
  } else {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    message.info("已禁用自动刷新");
  }
}

function handleSearch() {
  pagination.current = 1;
  fetchLogs();
}

function handleFilterChange() {
  pagination.current = 1;
  fetchLogs();
}

function handleTableChange(pag) {
  pagination.current = pag.current;
  pagination.pageSize = pag.pageSize;
  fetchLogs();
}

function viewLogDetail(log) {
  detailModal.log = log;
  detailModal.visible = true;
}

function exportLogs() {
  exportModal.visible = true;
}

async function handleExport() {
  exportModal.loading = true;

  try {
    const options = {
      format: exportModal.format,
      limit: exportModal.limit,
    };

    if (exportModal.timeRange && exportModal.timeRange.length === 2) {
      options.startTime = exportModal.timeRange[0].valueOf();
      options.endTime = exportModal.timeRange[1].valueOf();
    }

    const result = await window.electron.ipcRenderer.invoke(
      "remote:logs:export",
      options,
    );

    if (result.success) {
      message.success(
        `已导出 ${result.data.count} 条日志到: ${result.data.filePath}`,
      );
      exportModal.visible = false;
    } else {
      message.error("导出失败: " + result.error);
    }
  } catch (error) {
    console.error("导出失败:", error);
    message.error("导出失败: " + error.message);
  } finally {
    exportModal.loading = false;
  }
}

// 工具函数
function getStatusColor(status) {
  const colors = {
    success: "success",
    failure: "error",
    warning: "warning",
  };
  return colors[status] || "default";
}

function getStatusText(status) {
  const texts = {
    success: "成功",
    failure: "失败",
    warning: "警告",
  };
  return texts[status] || status;
}

function getLevelColor(level) {
  const colors = {
    debug: "default",
    info: "processing",
    warn: "warning",
    error: "error",
  };
  return colors[level] || "default";
}

function getDurationColor(duration) {
  if (duration < 500) {
    return "success";
  }
  if (duration < 2000) {
    return "warning";
  }
  return "error";
}

function truncate(str, maxLen) {
  if (!str) {
    return "";
  }
  if (str.length <= maxLen) {
    return str;
  }
  return str.substring(0, maxLen) + "...";
}

function formatTimestamp(timestamp) {
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss");
}

function formatJSON(data) {
  if (!data) {
    return "";
  }
  if (typeof data === "string") {
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  }
  return JSON.stringify(data, null, 2);
}

// 生命周期
onMounted(() => {
  // 初始化图表
  trendChart = echarts.init(trendChartRef.value);
  statusChart = echarts.init(statusChartRef.value);
  rankingChart = echarts.init(rankingChartRef.value);
  activityChart = echarts.init(activityChartRef.value);

  // 响应式调整
  window.addEventListener("resize", () => {
    trendChart?.resize();
    statusChart?.resize();
    rankingChart?.resize();
    activityChart?.resize();
  });

  // 加载初始数据
  fetchDashboard();
  fetchLogs();
});

onUnmounted(() => {
  // 清理定时器
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }

  // 销毁图表
  trendChart?.dispose();
  statusChart?.dispose();
  rankingChart?.dispose();
  activityChart?.dispose();
});
</script>

<style scoped lang="scss">
.command-logs-page {
  padding: 20px;
  background: #f0f2f5;
  min-height: 100vh;

  .content {
    max-width: 1600px;
    margin: 0 auto;
  }

  :deep(.ant-card) {
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  :deep(.ant-statistic-title) {
    color: rgba(0, 0, 0, 0.45);
    font-size: 14px;
  }

  :deep(.ant-statistic-content) {
    font-size: 28px;
    font-weight: 500;
  }
}
</style>
