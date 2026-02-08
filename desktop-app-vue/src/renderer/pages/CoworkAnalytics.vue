<template>
  <div class="cowork-analytics-page">
    <!-- Page Header -->
    <div class="page-header">
      <h1><BarChartOutlined /> Cowork 分析仪表板</h1>
      <p class="subtitle">多维度数据分析与可视化</p>
    </div>

    <!-- Time Range Filter -->
    <a-card class="filter-card" :bordered="false">
      <a-space>
        <a-range-picker
          v-model:value="dateRange"
          :presets="datePresets"
          @change="handleDateRangeChange"
        />
        <a-select
          v-model:value="selectedTeam"
          placeholder="选择团队"
          style="width: 200px"
          @change="handleTeamChange"
        >
          <a-select-option value="all"> 全部团队 </a-select-option>
          <a-select-option
            v-for="team in teams"
            :key="team.id"
            :value="team.id"
          >
            {{ team.name }}
          </a-select-option>
        </a-select>
        <a-button type="primary" @click="refreshData">
          <ReloadOutlined /> 刷新数据
        </a-button>
      </a-space>
    </a-card>

    <!-- KPI Cards -->
    <a-row :gutter="16" class="kpi-cards">
      <a-col :xs="24" :sm="12" :md="6">
        <a-card :loading="loading.stats">
          <a-statistic
            title="总任务数"
            :value="kpis.totalTasks"
            :prefix="h(FileTextOutlined)"
            :value-style="{ color: '#1890ff' }"
          />
          <div class="kpi-trend">
            <ArrowUpOutlined v-if="kpis.taskTrend > 0" style="color: #52c41a" />
            <ArrowDownOutlined v-else style="color: #ff4d4f" />
            <span>{{ Math.abs(kpis.taskTrend) }}% 相比上周</span>
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card :loading="loading.stats">
          <a-statistic
            title="成功率"
            :value="kpis.successRate"
            suffix="%"
            :prefix="h(CheckCircleOutlined)"
            :value-style="{ color: '#52c41a' }"
          />
          <div class="kpi-trend">
            <span>目标: ≥ 90%</span>
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card :loading="loading.stats">
          <a-statistic
            title="活跃代理"
            :value="kpis.activeAgents"
            :prefix="h(TeamOutlined)"
            :value-style="{ color: '#faad14' }"
          />
          <div class="kpi-trend">
            <span>总计: {{ kpis.totalAgents }}</span>
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card :loading="loading.stats">
          <a-statistic
            title="平均执行时间"
            :value="kpis.avgExecutionTime"
            suffix="分钟"
            :prefix="h(ClockCircleOutlined)"
            :value-style="{ color: '#722ed1' }"
          />
          <div class="kpi-trend">
            <span>中位数: {{ kpis.medianTime }}分</span>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Charts Row 1 -->
    <a-row :gutter="16" class="charts-row">
      <!-- Task Completion Trend -->
      <a-col :xs="24" :lg="12">
        <a-card title="任务完成趋势" :loading="loading.charts">
          <div ref="taskTrendChart" class="chart-container" />
        </a-card>
      </a-col>

      <!-- Task Status Distribution -->
      <a-col :xs="24" :lg="12">
        <a-card title="任务状态分布" :loading="loading.charts">
          <div ref="statusPieChart" class="chart-container" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Charts Row 2 -->
    <a-row :gutter="16" class="charts-row">
      <!-- Agent Utilization -->
      <a-col :xs="24" :lg="16">
        <a-card title="代理利用率热力图" :loading="loading.charts">
          <div ref="utilizationHeatmap" class="chart-container-large" />
        </a-card>
      </a-col>

      <!-- Skill Usage -->
      <a-col :xs="24" :lg="8">
        <a-card title="技能使用统计" :loading="loading.charts">
          <div ref="skillBarChart" class="chart-container" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Charts Row 3 -->
    <a-row :gutter="16" class="charts-row">
      <!-- Task Execution Timeline -->
      <a-col :xs="24">
        <a-card title="任务执行时间线（甘特图）" :loading="loading.charts">
          <div ref="ganttChart" class="chart-container-xlarge" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Charts Row 4 -->
    <a-row :gutter="16" class="charts-row">
      <!-- Priority vs Duration Scatter -->
      <a-col :xs="24" :lg="12">
        <a-card title="优先级 vs 执行时长" :loading="loading.charts">
          <div ref="scatterChart" class="chart-container" />
        </a-card>
      </a-col>

      <!-- Team Performance Ranking -->
      <a-col :xs="24" :lg="12">
        <a-card title="团队绩效排名" :loading="loading.charts">
          <div ref="performanceChart" class="chart-container" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Real-time Monitoring -->
    <a-row :gutter="16" class="charts-row">
      <a-col :xs="24">
        <a-card title="实时监控面板">
          <a-row :gutter="16">
            <a-col :xs="24" :md="8">
              <div class="gauge-wrapper">
                <h4>系统负载</h4>
                <div ref="loadGauge" class="gauge-chart" />
              </div>
            </a-col>
            <a-col :xs="24" :md="8">
              <div class="gauge-wrapper">
                <h4>任务队列</h4>
                <div ref="queueGauge" class="gauge-chart" />
              </div>
            </a-col>
            <a-col :xs="24" :md="8">
              <div class="gauge-wrapper">
                <h4>成功率</h4>
                <div ref="successGauge" class="gauge-chart" />
              </div>
            </a-col>
          </a-row>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, h } from "vue";
import { message } from "ant-design-vue";
import {
  BarChartOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from "@ant-design/icons-vue";
import * as echarts from "echarts";
import dayjs from "dayjs";
import { useCoworkStore } from "@/stores/cowork";
import { logger, createLogger } from "@/utils/logger";

const analyticsLogger = createLogger("cowork-analytics");

// Store
const coworkStore = useCoworkStore();

// Refs
const dateRange = ref([dayjs().subtract(7, "day"), dayjs()]);
const selectedTeam = ref("all");
const teams = computed(() => coworkStore.teams);

// Chart refs
const taskTrendChart = ref(null);
const statusPieChart = ref(null);
const utilizationHeatmap = ref(null);
const skillBarChart = ref(null);
const ganttChart = ref(null);
const scatterChart = ref(null);
const performanceChart = ref(null);
const loadGauge = ref(null);
const queueGauge = ref(null);
const successGauge = ref(null);

// ECharts instances
const charts = ref({});

// Loading states
const loading = ref({
  stats: false,
  charts: false,
});

// KPIs
const kpis = ref({
  totalTasks: 0,
  successRate: 0,
  activeAgents: 0,
  totalAgents: 0,
  avgExecutionTime: 0,
  medianTime: 0,
  taskTrend: 0,
});

// Date presets
const datePresets = computed(() => [
  { label: "最近7天", value: [dayjs().subtract(7, "day"), dayjs()] },
  { label: "最近30天", value: [dayjs().subtract(30, "day"), dayjs()] },
  { label: "最近90天", value: [dayjs().subtract(90, "day"), dayjs()] },
  { label: "本月", value: [dayjs().startOf("month"), dayjs()] },
  {
    label: "上月",
    value: [
      dayjs().subtract(1, "month").startOf("month"),
      dayjs().subtract(1, "month").endOf("month"),
    ],
  },
]);

// ==========================================
// Lifecycle
// ==========================================

onMounted(async () => {
  await initializeAnalytics();
  startRealtimeMonitoring();
});

onUnmounted(() => {
  stopRealtimeMonitoring();
  disposeAllCharts();
});

// ==========================================
// Initialization
// ==========================================

async function initializeAnalytics() {
  try {
    loading.value.stats = true;
    loading.value.charts = true;

    // Load data
    await loadAnalyticsData();

    // Initialize charts
    await initializeCharts();

    loading.value.stats = false;
    loading.value.charts = false;
  } catch (error) {
    analyticsLogger.error("Failed to initialize analytics:", error);
    message.error("分析数据加载失败");
  }
}

async function loadAnalyticsData() {
  try {
    // Get date range
    const startDate = dateRange.value[0].valueOf();
    const endDate = dateRange.value[1].valueOf();

    // Query analytics data
    const result = await window.electronAPI.invoke("cowork:get-analytics", {
      startDate,
      endDate,
      teamId: selectedTeam.value === "all" ? null : selectedTeam.value,
    });

    if (result.success) {
      updateKPIs(result.data);
    }
  } catch (error) {
    analyticsLogger.error("Failed to load analytics data:", error);
    throw error;
  }
}

function updateKPIs(data) {
  kpis.value = {
    totalTasks: data.totalTasks || 0,
    successRate: data.successRate || 0,
    activeAgents: data.activeAgents || 0,
    totalAgents: data.totalAgents || 0,
    avgExecutionTime: data.avgExecutionTime || 0,
    medianTime: data.medianTime || 0,
    taskTrend: data.taskTrend || 0,
  };
}

// ==========================================
// Chart Initialization
// ==========================================

async function initializeCharts() {
  // Initialize all charts
  initTaskTrendChart();
  initStatusPieChart();
  initUtilizationHeatmap();
  initSkillBarChart();
  initGanttChart();
  initScatterChart();
  initPerformanceChart();
  initGaugeCharts();

  // Handle window resize
  window.addEventListener("resize", handleResize);
}

function initTaskTrendChart() {
  if (!taskTrendChart.value) {
    return;
  }

  const chart = echarts.init(taskTrendChart.value);
  charts.value.taskTrend = chart;

  // Sample data - replace with real data from API
  const dates = Array.from({ length: 30 }, (_, i) =>
    dayjs()
      .subtract(29 - i, "day")
      .format("MM-DD"),
  );

  const completedData = Array.from({ length: 30 }, () =>
    Math.floor(Math.random() * 20 + 10),
  );

  const failedData = Array.from({ length: 30 }, () =>
    Math.floor(Math.random() * 5),
  );

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
      },
    },
    legend: {
      data: ["已完成", "失败", "成功率"],
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: dates,
    },
    yAxis: [
      {
        type: "value",
        name: "任务数",
      },
      {
        type: "value",
        name: "成功率 (%)",
        min: 0,
        max: 100,
      },
    ],
    series: [
      {
        name: "已完成",
        type: "bar",
        data: completedData,
        itemStyle: {
          color: "#52c41a",
        },
      },
      {
        name: "失败",
        type: "bar",
        data: failedData,
        itemStyle: {
          color: "#ff4d4f",
        },
      },
      {
        name: "成功率",
        type: "line",
        yAxisIndex: 1,
        data: completedData.map((c, i) =>
          Math.round((c / (c + failedData[i])) * 100),
        ),
        itemStyle: {
          color: "#1890ff",
        },
      },
    ],
  };

  chart.setOption(option);
}

function initStatusPieChart() {
  if (!statusPieChart.value) {
    return;
  }

  const chart = echarts.init(statusPieChart.value);
  charts.value.statusPie = chart;

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
        name: "任务状态",
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: false,
          position: "center",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 20,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
        data: [
          { value: 48, name: "已完成", itemStyle: { color: "#52c41a" } },
          { value: 12, name: "运行中", itemStyle: { color: "#1890ff" } },
          { value: 5, name: "失败", itemStyle: { color: "#ff4d4f" } },
          { value: 8, name: "等待中", itemStyle: { color: "#faad14" } },
        ],
      },
    ],
  };

  chart.setOption(option);
}

function initUtilizationHeatmap() {
  if (!utilizationHeatmap.value) {
    return;
  }

  const chart = echarts.init(utilizationHeatmap.value);
  charts.value.heatmap = chart;

  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  const data = [];
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 24; j++) {
      data.push([j, i, Math.floor(Math.random() * 100)]);
    }
  }

  const option = {
    tooltip: {
      position: "top",
      formatter: (params) => {
        return `${days[params.data[1]]} ${hours[params.data[0]]}<br/>利用率: ${params.data[2]}%`;
      },
    },
    grid: {
      height: "70%",
      top: "10%",
    },
    xAxis: {
      type: "category",
      data: hours,
      splitArea: {
        show: true,
      },
    },
    yAxis: {
      type: "category",
      data: days,
      splitArea: {
        show: true,
      },
    },
    visualMap: {
      min: 0,
      max: 100,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: "0%",
      inRange: {
        color: ["#e8f5e9", "#66bb6a", "#2e7d32"],
      },
    },
    series: [
      {
        name: "利用率",
        type: "heatmap",
        data: data,
        label: {
          show: false,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };

  chart.setOption(option);
}

function initSkillBarChart() {
  if (!skillBarChart.value) {
    return;
  }

  const chart = echarts.init(skillBarChart.value);
  charts.value.skillBar = chart;

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
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
      data: ["Excel", "Word", "PPT", "数据分析", "PDF", "图像处理"],
    },
    series: [
      {
        name: "使用次数",
        type: "bar",
        data: [85, 62, 48, 95, 38, 52],
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "#1890ff" },
            { offset: 1, color: "#52c41a" },
          ]),
        },
        label: {
          show: true,
          position: "right",
        },
      },
    ],
  };

  chart.setOption(option);
}

function initGanttChart() {
  if (!ganttChart.value) {
    return;
  }

  const chart = echarts.init(ganttChart.value);
  charts.value.gantt = chart;

  const tasks = [
    { name: "任务A", start: 0, duration: 5, agent: "Agent-1" },
    { name: "任务B", start: 2, duration: 4, agent: "Agent-2" },
    { name: "任务C", start: 5, duration: 3, agent: "Agent-1" },
    { name: "任务D", start: 6, duration: 6, agent: "Agent-3" },
    { name: "任务E", start: 8, duration: 4, agent: "Agent-2" },
  ];

  const option = {
    tooltip: {
      formatter: (params) => {
        const task = tasks[params.dataIndex];
        return `${task.name}<br/>代理: ${task.agent}<br/>开始: ${task.start}h<br/>时长: ${task.duration}h`;
      },
    },
    grid: {
      left: "10%",
      right: "5%",
      bottom: "5%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "时间 (小时)",
      max: 12,
    },
    yAxis: {
      type: "category",
      data: tasks.map((t) => t.name),
    },
    series: [
      {
        type: "custom",
        renderItem: (params, api) => {
          const categoryIndex = api.value(0);
          const start = api.coord([api.value(1), categoryIndex]);
          const end = api.coord([api.value(2), categoryIndex]);
          const height = api.size([0, 1])[1] * 0.6;

          return {
            type: "rect",
            shape: {
              x: start[0],
              y: start[1] - height / 2,
              width: end[0] - start[0],
              height: height,
            },
            style: api.style({
              fill: api.visual("color"),
            }),
          };
        },
        encode: {
          x: [1, 2],
          y: 0,
        },
        data: tasks.map((task, index) => [
          index,
          task.start,
          task.start + task.duration,
        ]),
      },
    ],
  };

  chart.setOption(option);
}

function initScatterChart() {
  if (!scatterChart.value) {
    return;
  }

  const chart = echarts.init(scatterChart.value);
  charts.value.scatter = chart;

  const priorities = { low: 1, medium: 2, high: 3, critical: 4 };
  const data = Array.from({ length: 50 }, () => [
    Math.floor(Math.random() * 4) + 1,
    Math.floor(Math.random() * 120) + 10,
  ]);

  const option = {
    tooltip: {
      formatter: (params) => {
        const priorityNames = ["", "低", "中", "高", "紧急"];
        return `优先级: ${priorityNames[params.data[0]]}<br/>执行时长: ${params.data[1]}分钟`;
      },
    },
    grid: {
      left: "3%",
      right: "7%",
      bottom: "7%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "优先级",
      min: 0,
      max: 5,
      axisLabel: {
        formatter: (value) => {
          const names = ["", "低", "中", "高", "紧急"];
          return names[value] || "";
        },
      },
    },
    yAxis: {
      type: "value",
      name: "执行时长 (分钟)",
    },
    series: [
      {
        type: "scatter",
        symbolSize: 10,
        data: data,
        itemStyle: {
          color: (params) => {
            const colors = ["", "#52c41a", "#1890ff", "#faad14", "#ff4d4f"];
            return colors[params.data[0]];
          },
        },
      },
    ],
  };

  chart.setOption(option);
}

function initPerformanceChart() {
  if (!performanceChart.value) {
    return;
  }

  const chart = echarts.init(performanceChart.value);
  charts.value.performance = chart;

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
    },
    legend: {},
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
      data: ["销售团队", "研发团队", "设计团队", "运营团队", "财务团队"],
    },
    series: [
      {
        name: "完成任务",
        type: "bar",
        stack: "total",
        data: [48, 52, 35, 42, 28],
        itemStyle: { color: "#52c41a" },
      },
      {
        name: "失败任务",
        type: "bar",
        stack: "total",
        data: [2, 3, 5, 2, 2],
        itemStyle: { color: "#ff4d4f" },
      },
    ],
  };

  chart.setOption(option);
}

function initGaugeCharts() {
  initGaugeChart(loadGauge, {
    title: "系统负载",
    value: 65,
    max: 100,
    color: [
      [0.6, "#52c41a"],
      [0.8, "#faad14"],
      [1, "#ff4d4f"],
    ],
  });

  initGaugeChart(queueGauge, {
    title: "任务队列",
    value: 12,
    max: 50,
    color: [
      [0.6, "#52c41a"],
      [0.8, "#faad14"],
      [1, "#ff4d4f"],
    ],
  });

  initGaugeChart(successGauge, {
    title: "成功率",
    value: 92,
    max: 100,
    color: [
      [0.8, "#ff4d4f"],
      [0.9, "#faad14"],
      [1, "#52c41a"],
    ],
  });
}

function initGaugeChart(ref, config) {
  if (!ref.value) {
    return;
  }

  const chart = echarts.init(ref.value);

  const option = {
    series: [
      {
        type: "gauge",
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: config.max,
        splitNumber: 4,
        axisLine: {
          lineStyle: {
            width: 6,
            color: config.color,
          },
        },
        pointer: {
          itemStyle: {
            color: "auto",
          },
        },
        axisTick: {
          distance: -30,
          length: 8,
          lineStyle: {
            color: "#fff",
            width: 2,
          },
        },
        splitLine: {
          distance: -30,
          length: 30,
          lineStyle: {
            color: "#fff",
            width: 4,
          },
        },
        axisLabel: {
          color: "auto",
          distance: 40,
          fontSize: 12,
        },
        detail: {
          valueAnimation: true,
          formatter: "{value}",
          color: "auto",
          fontSize: 20,
        },
        data: [
          {
            value: config.value,
          },
        ],
      },
    ],
  };

  chart.setOption(option);
  charts.value[config.title] = chart;
}

// ==========================================
// Real-time Monitoring
// ==========================================

let realtimeInterval = null;

function startRealtimeMonitoring() {
  // Update gauges every 3 seconds
  realtimeInterval = setInterval(() => {
    updateRealtimeData();
  }, 3000);
}

function stopRealtimeMonitoring() {
  if (realtimeInterval) {
    clearInterval(realtimeInterval);
    realtimeInterval = null;
  }
}

function updateRealtimeData() {
  // Simulate real-time data updates
  const loadValue = Math.floor(Math.random() * 40 + 50);
  const queueValue = Math.floor(Math.random() * 20 + 5);
  const successValue = Math.floor(Math.random() * 10 + 88);

  if (charts.value["系统负载"]) {
    charts.value["系统负载"].setOption({
      series: [{ data: [{ value: loadValue }] }],
    });
  }

  if (charts.value["任务队列"]) {
    charts.value["任务队列"].setOption({
      series: [{ data: [{ value: queueValue }] }],
    });
  }

  if (charts.value["成功率"]) {
    charts.value["成功率"].setOption({
      series: [{ data: [{ value: successValue }] }],
    });
  }
}

// ==========================================
// Event Handlers
// ==========================================

function handleDateRangeChange() {
  refreshData();
}

function handleTeamChange() {
  refreshData();
}

async function refreshData() {
  await loadAnalyticsData();
  // Refresh all charts
  Object.values(charts.value).forEach((chart) => {
    if (chart && chart.resize) {
      chart.resize();
    }
  });
}

function handleResize() {
  Object.values(charts.value).forEach((chart) => {
    if (chart && chart.resize) {
      chart.resize();
    }
  });
}

function disposeAllCharts() {
  Object.values(charts.value).forEach((chart) => {
    if (chart && chart.dispose) {
      chart.dispose();
    }
  });
  charts.value = {};
}
</script>

<style scoped lang="scss">
.cowork-analytics-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: 100vh;

  .page-header {
    margin-bottom: 24px;

    h1 {
      font-size: 28px;
      font-weight: 600;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 12px;

      :deep(.anticon) {
        color: #1890ff;
      }
    }

    .subtitle {
      color: #8c8c8c;
      margin-top: 8px;
      margin-bottom: 0;
    }
  }

  .filter-card {
    margin-bottom: 24px;
  }

  .kpi-cards {
    margin-bottom: 24px;

    .kpi-trend {
      margin-top: 8px;
      font-size: 12px;
      color: #8c8c8c;
      display: flex;
      align-items: center;
      gap: 4px;
    }
  }

  .charts-row {
    margin-bottom: 24px;
  }

  .chart-container {
    width: 100%;
    height: 300px;
  }

  .chart-container-large {
    width: 100%;
    height: 400px;
  }

  .chart-container-xlarge {
    width: 100%;
    height: 500px;
  }

  .gauge-wrapper {
    text-align: center;

    h4 {
      font-weight: 600;
      margin-bottom: 16px;
    }

    .gauge-chart {
      width: 100%;
      height: 250px;
    }
  }
}
</style>
