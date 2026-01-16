<template>
  <div class="llm-performance-page">
    <div class="page-header">
      <h1>
        <BarChartOutlined />
        LLM 性能仪表板
      </h1>
      <p class="page-description">实时监控 Token 使用、成本分析和性能优化</p>
    </div>

    <div class="page-content">
      <!-- 统计概览 -->
      <a-row :gutter="16" class="stats-row">
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="总调用次数"
              :value="stats.totalCalls"
              :prefix="h(ApiOutlined)"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="总 Token 消耗"
              :value="stats.totalTokens"
              :prefix="h(ThunderboltOutlined)"
              :formatter="formatTokens"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="总成本"
              :value="stats.totalCostUsd"
              prefix="$"
              :precision="4"
              :value-style="{
                color: stats.totalCostUsd > 10 ? '#cf1322' : '#3f8600',
              }"
            />
            <div class="sub-value">
              ¥{{ (stats.totalCostCny || 0).toFixed(2) }}
            </div>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="缓存命中率"
              :value="stats.cacheHitRate"
              suffix="%"
              :precision="2"
              :prefix="h(RocketOutlined)"
              :value-style="{
                color: stats.cacheHitRate > 50 ? '#3f8600' : '#cf1322',
              }"
            />
          </a-card>
        </a-col>
      </a-row>

      <!-- 优化效果统计 -->
      <a-row :gutter="16" class="optimization-row">
        <a-col :span="8">
          <a-card>
            <a-statistic
              title="压缩调用次数"
              :value="stats.compressedCalls"
              :prefix="h(CompressOutlined)"
              :value-style="{ color: '#1890ff' }"
            />
            <div class="stat-desc">节省约 30-40% Tokens</div>
          </a-card>
        </a-col>
        <a-col :span="8">
          <a-card>
            <a-statistic
              title="平均响应时间"
              :value="stats.avgResponseTime"
              suffix="ms"
              :prefix="h(ClockCircleOutlined)"
              :value-style="{
                color: stats.avgResponseTime < 1000 ? '#3f8600' : '#cf1322',
              }"
            />
          </a-card>
        </a-col>
        <a-col :span="8">
          <a-card>
            <a-statistic
              title="缓存节省成本"
              :value="cachedSavings"
              prefix="$"
              :precision="4"
              :prefix-icon="h(DollarOutlined)"
              :value-style="{ color: '#52c41a' }"
            />
            <div class="stat-desc">预计节省</div>
          </a-card>
        </a-col>
      </a-row>

      <!-- 控制面板 -->
      <a-card title="时间范围与操作" class="controls-card">
        <a-space size="middle" wrap>
          <a-radio-group
            v-model:value="timeRange"
            @change="handleTimeRangeChange"
            button-style="solid"
          >
            <a-radio-button value="24h">过去 24 小时</a-radio-button>
            <a-radio-button value="7d">过去 7 天</a-radio-button>
            <a-radio-button value="30d">过去 30 天</a-radio-button>
            <a-radio-button value="custom">自定义</a-radio-button>
          </a-radio-group>

          <a-range-picker
            v-if="timeRange === 'custom'"
            v-model:value="customDateRange"
            @change="handleCustomDateChange"
            :show-time="{ format: 'HH:mm' }"
            format="YYYY-MM-DD HH:mm"
          />

          <a-button type="primary" @click="refreshData" :loading="loading">
            <template #icon><ReloadOutlined /></template>
            刷新数据
          </a-button>

          <a-button @click="exportData" :loading="exporting">
            <template #icon><DownloadOutlined /></template>
            导出报告
          </a-button>
        </a-space>
      </a-card>

      <!-- Token 使用趋势图 -->
      <a-card title="Token 使用趋势" class="chart-card">
        <div class="chart-header">
          <a-radio-group
            v-model:value="trendInterval"
            @change="handleIntervalChange"
            size="small"
          >
            <a-radio-button value="hour">按小时</a-radio-button>
            <a-radio-button value="day">按天</a-radio-button>
            <a-radio-button value="week">按周</a-radio-button>
          </a-radio-group>
        </div>
        <div ref="tokenTrendChart" class="chart-container"></div>
        <a-empty
          v-if="timeSeriesData.length === 0 && !loading"
          description="暂无数据"
        />
      </a-card>

      <!-- 成本分解可视化 -->
      <a-row :gutter="16">
        <a-col :span="12">
          <a-card title="按提供商成本分布" class="chart-card">
            <div ref="providerCostChart" class="chart-container-small"></div>
            <a-empty
              v-if="costBreakdown.byProvider.length === 0 && !loading"
              description="暂无数据"
            />
          </a-card>
        </a-col>
        <a-col :span="12">
          <a-card title="按模型成本分布（Top 10）" class="chart-card">
            <div ref="modelCostChart" class="chart-container-small"></div>
            <a-empty
              v-if="costBreakdown.byModel.length === 0 && !loading"
              description="暂无数据"
            />
          </a-card>
        </a-col>
      </a-row>

      <!-- 详细数据表格 -->
      <a-card title="详细统计" class="details-card">
        <a-tabs v-model:activeKey="activeTab">
          <a-tab-pane key="provider" tab="按提供商">
            <a-table
              :columns="providerColumns"
              :data-source="costBreakdown.byProvider"
              :pagination="{ pageSize: 10 }"
              :loading="loading"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'cost_usd'">
                  <a-tag color="green">${{ record.cost_usd.toFixed(4) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'tokens'">
                  {{ formatNumber(record.tokens) }}
                </template>
              </template>
            </a-table>
          </a-tab-pane>

          <a-tab-pane key="model" tab="按模型">
            <a-table
              :columns="modelColumns"
              :data-source="costBreakdown.byModel"
              :pagination="{ pageSize: 10 }"
              :loading="loading"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'cost_usd'">
                  <a-tag color="green">${{ record.cost_usd.toFixed(4) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'tokens'">
                  {{ formatNumber(record.tokens) }}
                </template>
              </template>
            </a-table>
          </a-tab-pane>
        </a-tabs>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, h, nextTick } from "vue";
import { message } from "ant-design-vue";
import * as echarts from "echarts";
import {
  BarChartOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  CompressOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  ReloadOutlined,
  DownloadOutlined,
} from "@ant-design/icons-vue";

// 状态
const stats = ref({
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  totalCostCny: 0,
  cachedCalls: 0,
  compressedCalls: 0,
  cacheHitRate: 0,
  avgResponseTime: 0,
});

const timeSeriesData = ref([]);
const costBreakdown = ref({
  byProvider: [],
  byModel: [],
});

const loading = ref(false);
const exporting = ref(false);
const timeRange = ref("7d");
const customDateRange = ref(null);
const trendInterval = ref("day");
const activeTab = ref("provider");

// Chart 实例
let tokenTrendChartInstance = null;
let providerCostChartInstance = null;
let modelCostChartInstance = null;

const tokenTrendChart = ref(null);
const providerCostChart = ref(null);
const modelCostChart = ref(null);

// 计算属性
const cachedSavings = computed(() => {
  // 假设缓存节省 50% 成本
  return ((stats.value.totalCostUsd * stats.value.cacheHitRate) / 100) * 0.5;
});

// 表格列定义
const providerColumns = [
  { title: "提供商", dataIndex: "provider", key: "provider" },
  {
    title: "调用次数",
    dataIndex: "calls",
    key: "calls",
    sorter: (a, b) => a.calls - b.calls,
  },
  {
    title: "Tokens",
    dataIndex: "tokens",
    key: "tokens",
    sorter: (a, b) => a.tokens - b.tokens,
  },
  {
    title: "成本 (USD)",
    dataIndex: "cost_usd",
    key: "cost_usd",
    sorter: (a, b) => a.cost_usd - b.cost_usd,
  },
];

const modelColumns = [
  { title: "提供商", dataIndex: "provider", key: "provider", width: "25%" },
  { title: "模型", dataIndex: "model", key: "model", width: "30%" },
  {
    title: "调用次数",
    dataIndex: "calls",
    key: "calls",
    width: "15%",
    sorter: (a, b) => a.calls - b.calls,
  },
  {
    title: "Tokens",
    dataIndex: "tokens",
    key: "tokens",
    width: "15%",
    sorter: (a, b) => a.tokens - b.tokens,
  },
  {
    title: "成本 (USD)",
    dataIndex: "cost_usd",
    key: "cost_usd",
    width: "15%",
    sorter: (a, b) => a.cost_usd - b.cost_usd,
  },
];

/**
 * 获取时间范围
 */
const getDateRange = () => {
  const now = Date.now();
  switch (timeRange.value) {
    case "24h":
      return { startDate: now - 24 * 60 * 60 * 1000, endDate: now };
    case "7d":
      return { startDate: now - 7 * 24 * 60 * 60 * 1000, endDate: now };
    case "30d":
      return { startDate: now - 30 * 24 * 60 * 60 * 1000, endDate: now };
    case "custom":
      if (customDateRange.value && customDateRange.value.length === 2) {
        return {
          startDate: customDateRange.value[0].valueOf(),
          endDate: customDateRange.value[1].valueOf(),
        };
      }
      return { startDate: now - 7 * 24 * 60 * 60 * 1000, endDate: now };
    default:
      return { startDate: now - 7 * 24 * 60 * 60 * 1000, endDate: now };
  }
};

/**
 * 刷新数据
 */
const refreshData = async () => {
  loading.value = true;
  try {
    const dateRange = getDateRange();

    // 获取总体统计
    const statsResult = await window.electronAPI.invoke(
      "llm:get-usage-stats",
      dateRange,
    );
    if (statsResult) {
      stats.value = statsResult;
    }

    // 获取时间序列数据
    const timeSeriesResult = await window.electronAPI.invoke(
      "llm:get-time-series",
      {
        ...dateRange,
        interval: trendInterval.value,
      },
    );
    if (timeSeriesResult) {
      timeSeriesData.value = timeSeriesResult;
      await nextTick();
      renderTokenTrendChart();
    }

    // 获取成本分解
    const breakdownResult = await window.electronAPI.invoke(
      "llm:get-cost-breakdown",
      dateRange,
    );
    if (breakdownResult) {
      costBreakdown.value = breakdownResult;
      await nextTick();
      renderProviderCostChart();
      renderModelCostChart();
    }

    message.success("数据已刷新");
  } catch (error) {
    console.error("刷新数据失败:", error);
    message.error("刷新数据失败: " + error.message);
  } finally {
    loading.value = false;
  }
};

/**
 * 渲染 Token 趋势图
 */
const renderTokenTrendChart = () => {
  if (!tokenTrendChart.value || timeSeriesData.value.length === 0) return;

  if (!tokenTrendChartInstance) {
    tokenTrendChartInstance = echarts.init(tokenTrendChart.value);
  }

  const option = {
    title: {
      text: "Token 使用趋势",
      left: "center",
      textStyle: { fontSize: 14, fontWeight: "normal" },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    legend: {
      data: ["Tokens", "调用次数", "成本 (USD)"],
      top: 30,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: 80,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: timeSeriesData.value.map((d) => formatDate(d.timestamp)),
    },
    yAxis: [
      {
        type: "value",
        name: "Tokens",
        position: "left",
        axisLabel: { formatter: (value) => formatNumber(value) },
      },
      {
        type: "value",
        name: "调用次数",
        position: "right",
        offset: 0,
      },
      {
        type: "value",
        name: "成本 (USD)",
        position: "right",
        offset: 60,
        axisLabel: { formatter: (value) => "$" + value.toFixed(4) },
      },
    ],
    series: [
      {
        name: "Tokens",
        type: "line",
        yAxisIndex: 0,
        data: timeSeriesData.value.map((d) => d.tokens),
        smooth: true,
        itemStyle: { color: "#1890ff" },
        areaStyle: { opacity: 0.3 },
      },
      {
        name: "调用次数",
        type: "line",
        yAxisIndex: 1,
        data: timeSeriesData.value.map((d) => d.calls),
        smooth: true,
        itemStyle: { color: "#52c41a" },
      },
      {
        name: "成本 (USD)",
        type: "line",
        yAxisIndex: 2,
        data: timeSeriesData.value.map((d) => d.costUsd),
        smooth: true,
        itemStyle: { color: "#faad14" },
      },
    ],
  };

  tokenTrendChartInstance.setOption(option);
};

/**
 * 渲染提供商成本饼图
 */
const renderProviderCostChart = () => {
  if (!providerCostChart.value || costBreakdown.value.byProvider.length === 0)
    return;

  if (!providerCostChartInstance) {
    providerCostChartInstance = echarts.init(providerCostChart.value);
  }

  const option = {
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: ${c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      left: "left",
    },
    series: [
      {
        name: "成本分布",
        type: "pie",
        radius: "60%",
        data: costBreakdown.value.byProvider.map((item) => ({
          value: item.cost_usd,
          name: item.provider,
        })),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };

  providerCostChartInstance.setOption(option);
};

/**
 * 渲染模型成本柱状图
 */
const renderModelCostChart = () => {
  if (!modelCostChart.value || costBreakdown.value.byModel.length === 0) return;

  if (!modelCostChartInstance) {
    modelCostChartInstance = echarts.init(modelCostChart.value);
  }

  const topModels = costBreakdown.value.byModel.slice(0, 10);

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
      name: "成本 (USD)",
      axisLabel: { formatter: (value) => "$" + value.toFixed(4) },
    },
    yAxis: {
      type: "category",
      data: topModels.map((item) => `${item.provider}/${item.model}`).reverse(),
    },
    series: [
      {
        name: "成本",
        type: "bar",
        data: topModels.map((item) => item.cost_usd).reverse(),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "#83bff6" },
            { offset: 0.5, color: "#188df0" },
            { offset: 1, color: "#188df0" },
          ]),
        },
        label: {
          show: true,
          position: "right",
          formatter: (params) => "$" + params.value.toFixed(4),
        },
      },
    ],
  };

  modelCostChartInstance.setOption(option);
};

/**
 * 时间范围变化
 */
const handleTimeRangeChange = () => {
  refreshData();
};

/**
 * 自定义时间范围变化
 */
const handleCustomDateChange = () => {
  if (customDateRange.value && customDateRange.value.length === 2) {
    refreshData();
  }
};

/**
 * 时间间隔变化
 */
const handleIntervalChange = () => {
  refreshData();
};

/**
 * 导出数据
 */
const exportData = async () => {
  exporting.value = true;
  try {
    const dateRange = getDateRange();
    const result = await window.electronAPI.invoke(
      "llm:export-cost-report",
      dateRange,
    );
    if (result.success) {
      message.success("报告已导出: " + result.filePath);
    } else {
      message.error("导出失败: " + result.error);
    }
  } catch (error) {
    console.error("导出失败:", error);
    message.error("导出失败: " + error.message);
  } finally {
    exporting.value = false;
  }
};

/**
 * 格式化数字
 */
const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K";
  }
  return num.toString();
};

/**
 * 格式化 Tokens
 */
const formatTokens = (value) => {
  return formatNumber(value);
};

/**
 * 格式化日期
 */
const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  if (trendInterval.value === "hour") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  } else if (trendInterval.value === "day") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  } else {
    // 计算周数
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date - firstDay) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((days + firstDay.getDay() + 1) / 7);
    return `${date.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
  }
};

/**
 * 窗口大小变化处理
 */
const handleResize = () => {
  tokenTrendChartInstance?.resize();
  providerCostChartInstance?.resize();
  modelCostChartInstance?.resize();
};

// 生命周期
onMounted(() => {
  refreshData();

  // 监听窗口大小变化
  window.addEventListener("resize", handleResize);

  // 每 60 秒自动刷新
  const refreshInterval = setInterval(() => {
    refreshData();
  }, 60000);

  onUnmounted(() => {
    window.removeEventListener("resize", handleResize);
    clearInterval(refreshInterval);

    // 销毁图表实例
    tokenTrendChartInstance?.dispose();
    providerCostChartInstance?.dispose();
    modelCostChartInstance?.dispose();
  });
});
</script>

<style lang="less" scoped>
.llm-performance-page {
  padding: 24px;
  min-height: 100vh;
  background: #f5f7fa;

  .page-header {
    margin-bottom: 24px;

    h1 {
      font-size: 28px;
      font-weight: 600;
      color: #1a202c;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .page-description {
      font-size: 14px;
      color: #718096;
      margin: 0;
    }
  }

  .page-content {
    .stats-row,
    .optimization-row {
      margin-bottom: 16px;
    }

    .sub-value {
      font-size: 12px;
      color: #8c8c8c;
      margin-top: 4px;
    }

    .stat-desc {
      font-size: 12px;
      color: #8c8c8c;
      margin-top: 4px;
    }

    .controls-card {
      margin-bottom: 16px;
    }

    .chart-card {
      margin-bottom: 16px;

      .chart-header {
        margin-bottom: 16px;
        text-align: right;
      }

      .chart-container {
        width: 100%;
        height: 400px;
      }

      .chart-container-small {
        width: 100%;
        height: 350px;
      }
    }

    .details-card {
      margin-bottom: 16px;
    }
  }
}

:deep(.ant-card) {
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

:deep(.ant-statistic-title) {
  font-size: 14px;
  color: #718096;
}

:deep(.ant-statistic-content) {
  font-size: 24px;
  font-weight: 600;
}
</style>
