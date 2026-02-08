<template>
  <div class="task-monitor-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <UnorderedListOutlined />
          任务监控
        </h1>
        <p class="page-description">实时监控任务执行状态、进度和性能</p>
      </div>
      <div class="header-right">
        <a-space>
          <a-button :loading="isLoading" @click="handleRefresh">
            <ReloadOutlined />
            刷新
          </a-button>
          <a-button type="primary" @click="$router.push('/cowork')">
            <TeamOutlined />
            返回团队
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-section">
      <a-row :gutter="16">
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="总任务数"
              :value="globalStats.totalTasks"
              :prefix="h(UnorderedListOutlined)"
              :value-style="{ color: '#1890ff' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="运行中"
              :value="runningTasks.length"
              :prefix="h(SyncOutlined, { spin: true })"
              :value-style="{ color: '#faad14' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="已完成"
              :value="completedTasks.length"
              :prefix="h(CheckCircleOutlined)"
              :value-style="{ color: '#52c41a' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="loading.stats">
            <a-statistic
              title="成功率"
              :value="successRate"
              suffix="%"
              :precision="1"
              :prefix="h(RiseOutlined)"
              :value-style="{
                color: successRate >= 80 ? '#52c41a' : '#faad14',
              }"
            />
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 主内容区 -->
    <a-card title="任务列表" :bordered="false" class="tasks-section">
      <!-- 筛选工具栏 -->
      <div class="filters-bar">
        <a-space wrap>
          <a-input-search
            v-model:value="searchQuery"
            placeholder="搜索任务名称..."
            style="width: 300px"
            allow-clear
            @search="handleSearch"
          />
          <a-select
            v-model:value="statusFilter"
            placeholder="筛选状态"
            style="width: 150px"
            allow-clear
            @change="handleFilterChange"
          >
            <a-select-option value="pending"> 待处理 </a-select-option>
            <a-select-option value="running"> 运行中 </a-select-option>
            <a-select-option value="paused"> 已暂停 </a-select-option>
            <a-select-option value="completed"> 已完成 </a-select-option>
            <a-select-option value="failed"> 失败 </a-select-option>
            <a-select-option value="cancelled"> 已取消 </a-select-option>
          </a-select>
          <a-select
            v-model:value="teamFilter"
            placeholder="筛选团队"
            style="width: 200px"
            allow-clear
            show-search
            :filter-option="filterTeamOption"
            @change="handleTeamFilterChange"
          >
            <a-select-option
              v-for="team in teams"
              :key="team.id"
              :value="team.id"
            >
              {{ team.name }}
            </a-select-option>
          </a-select>
        </a-space>
      </div>

      <!-- 任务表格 -->
      <a-table
        :columns="taskColumns"
        :data-source="filteredTasks"
        :loading="loading.tasks"
        :pagination="tablePagination"
        row-key="id"
        @change="handleTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <a @click="handleViewTaskDetail(record)">{{ record.name }}</a>
          </template>

          <template v-else-if="column.key === 'status'">
            <a-tag :color="getTaskStatusColor(record.status)">
              {{ getTaskStatusText(record.status) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'progress'">
            <div style="display: flex; align-items: center; gap: 8px">
              <a-progress
                :percent="record.progress || 0"
                :status="getProgressStatus(record)"
                size="small"
                style="flex: 1; max-width: 200px"
              />
              <span style="white-space: nowrap">
                {{ (record.progress || 0).toFixed(0) }}%
              </span>
            </div>
          </template>

          <template v-else-if="column.key === 'teamId'">
            <a-tag color="blue">
              {{ getTeamName(record.teamId) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'assignedTo'">
            <a-tag v-if="record.assignedTo" color="geekblue">
              {{ record.assignedTo }}
            </a-tag>
            <span v-else style="color: #8c8c8c">未分配</span>
          </template>

          <template v-else-if="column.key === 'duration'">
            {{ formatDuration(record.duration || 0) }}
          </template>

          <template v-else-if="column.key === 'createdAt'">
            {{ formatDate(record.createdAt) }}
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                v-if="record.status === 'running'"
                type="link"
                size="small"
                @click="handlePauseTask(record)"
              >
                <PauseCircleOutlined />
                暂停
              </a-button>
              <a-button
                v-if="record.status === 'paused'"
                type="link"
                size="small"
                @click="handleResumeTask(record)"
              >
                <PlayCircleOutlined />
                恢复
              </a-button>
              <a-button
                v-if="['pending', 'running', 'paused'].includes(record.status)"
                type="link"
                size="small"
                danger
                @click="handleCancelTask(record)"
              >
                <StopOutlined />
                取消
              </a-button>
              <a-button
                type="link"
                size="small"
                @click="handleViewTaskDetail(record)"
              >
                <EyeOutlined />
                详情
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>

      <!-- 空状态 -->
      <a-empty
        v-if="!loading.tasks && filteredTasks.length === 0"
        description="暂无任务"
        style="margin: 40px 0"
      />
    </a-card>

    <!-- 性能统计图表（可选） -->
    <a-card
      v-if="showCharts"
      title="性能统计"
      :bordered="false"
      class="charts-section"
      style="margin-top: 24px"
    >
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :md="12">
          <div ref="successRateChartRef" style="width: 100%; height: 300px" />
        </a-col>
        <a-col :xs="24" :md="12">
          <div ref="durationChartRef" style="width: 100%; height: 300px" />
        </a-col>
        <a-col :xs="24" :md="12">
          <div
            ref="completionTrendChartRef"
            style="width: 100%; height: 300px"
          />
        </a-col>
        <a-col :xs="24" :md="12">
          <div
            ref="teamPerformanceChartRef"
            style="width: 100%; height: 300px"
          />
        </a-col>
      </a-row>
    </a-card>

    <!-- 任务详情抽屉 -->
    <a-drawer
      v-model:open="taskDetailDrawerVisible"
      title="任务详情"
      placement="right"
      :width="800"
      :destroy-on-close="true"
    >
      <TaskDetailPanel
        v-if="currentTask"
        :task="currentTask"
        @refresh="handleRefreshTaskDetail"
        @pause="handlePauseTask"
        @resume="handleResumeTask"
        @cancel="handleCancelTask"
        @close="taskDetailDrawerVisible = false"
      />
    </a-drawer>
  </div>
</template>

<script setup>
import { h, ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import {
  UnorderedListOutlined,
  ReloadOutlined,
  TeamOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  RiseOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
  EyeOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons-vue";
import { init, graphic } from "../utils/echartsConfig";
import { useCoworkStore } from "../stores/cowork";
import TaskDetailPanel from "../components/cowork/TaskDetailPanel.vue";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { logger, createLogger } from "@/utils/logger";

const taskLogger = createLogger("task-monitor");
const router = useRouter();

// Store
const store = useCoworkStore();

// 状态
const taskDetailDrawerVisible = ref(false);
const searchQuery = ref("");
const statusFilter = ref(null);
const teamFilter = ref(null);
const showCharts = ref(true);
const successRateChartRef = ref(null);
const durationChartRef = ref(null);
const completionTrendChartRef = ref(null);
const teamPerformanceChartRef = ref(null);
let successRateChart = null;
let durationChart = null;
let completionTrendChart = null;
let teamPerformanceChart = null;

// 表格分页
const tablePagination = ref({
  current: 1,
  pageSize: 20,
  showSizeChanger: true,
  showQuickJumper: true,
  showTotal: (total) => `共 ${total} 条`,
});

// 表格列定义
const taskColumns = [
  {
    title: "任务名称",
    dataIndex: "name",
    key: "name",
    width: 200,
    ellipsis: true,
  },
  {
    title: "状态",
    dataIndex: "status",
    key: "status",
    width: 100,
  },
  {
    title: "进度",
    dataIndex: "progress",
    key: "progress",
    width: 250,
  },
  {
    title: "团队",
    dataIndex: "teamId",
    key: "teamId",
    width: 150,
  },
  {
    title: "执行者",
    dataIndex: "assignedTo",
    key: "assignedTo",
    width: 120,
  },
  {
    title: "耗时",
    dataIndex: "duration",
    key: "duration",
    width: 100,
  },
  {
    title: "创建时间",
    dataIndex: "createdAt",
    key: "createdAt",
    width: 150,
  },
  {
    title: "操作",
    key: "actions",
    width: 200,
    fixed: "right",
  },
];

// 从 Store 获取状态
const loading = computed(() => store.loading);
const globalStats = computed(() => store.globalStats);
const tasks = computed(() => store.tasks);
const teams = computed(() => store.teams);
const currentTask = computed(() => store.currentTask);
const filteredTasks = computed(() => store.filteredTasks);
const runningTasks = computed(() => store.runningTasks);
const completedTasks = computed(() => store.completedTasks);
const isLoading = computed(() => store.isLoading);

// 计算成功率
const successRate = computed(() => {
  const total =
    globalStats.value.completedTasks + globalStats.value.failedTasks;
  if (total === 0) {
    return 100;
  }
  return (globalStats.value.completedTasks / total) * 100;
});

// ==========================================
// 生命周期钩子
// ==========================================

let resizeTimer = null;
const handleResize = () => {
  if (resizeTimer) {
    clearTimeout(resizeTimer);
  }
  resizeTimer = setTimeout(() => {
    successRateChart?.resize();
    durationChart?.resize();
    completionTrendChart?.resize();
    teamPerformanceChart?.resize();
  }, 200);
};

onMounted(async () => {
  taskLogger.info("TaskMonitor 挂载");

  // 初始化事件监听
  store.initEventListeners();

  // 加载初始数据
  await loadInitialData();

  // 初始化图表
  await nextTick();
  initCharts();

  window.addEventListener("resize", handleResize);
});

onUnmounted(() => {
  taskLogger.info("TaskMonitor 卸载");

  window.removeEventListener("resize", handleResize);
  if (resizeTimer) {
    clearTimeout(resizeTimer);
  }

  // 清理事件监听
  store.cleanupEventListeners();

  // 销毁图表
  destroyCharts();
});

// ==========================================
// 数据加载
// ==========================================

async function loadInitialData() {
  try {
    // 并行加载任务列表、团队列表和统计信息
    await Promise.all([
      store.loadActiveTasks(),
      store.loadTeams(),
      store.loadStats(),
    ]);

    taskLogger.info("初始数据加载完成");
  } catch (error) {
    taskLogger.error("初始数据加载失败:", error);
    message.error("数据加载失败，请刷新页面重试");
  }
}

async function handleRefresh() {
  taskLogger.info("刷新数据");
  await loadInitialData();
  message.success("刷新成功");
}

// ==========================================
// 任务操作
// ==========================================

async function handleViewTaskDetail(task) {
  taskLogger.info("查看任务详情:", task.id);

  try {
    await store.loadTaskDetail(task.id);
    taskDetailDrawerVisible.value = true;
  } catch (error) {
    taskLogger.error("加载任务详情失败:", error);
    message.error("加载任务详情失败");
  }
}

async function handleRefreshTaskDetail() {
  if (!currentTask.value) {
    return;
  }

  try {
    await store.loadTaskDetail(currentTask.value.id);
    message.success("任务详情已刷新");
  } catch (error) {
    taskLogger.error("刷新任务详情失败:", error);
    message.error("刷新失败");
  }
}

async function handlePauseTask(task) {
  try {
    const result = await store.pauseTask(task.id);

    if (result.success) {
      message.success(`任务 "${task.name}" 已暂停`);
    } else {
      message.error(result.error || "暂停任务失败");
    }
  } catch (error) {
    taskLogger.error("暂停任务失败:", error);
    message.error("暂停任务失败: " + error.message);
  }
}

async function handleResumeTask(task) {
  try {
    const result = await store.resumeTask(task.id);

    if (result.success) {
      message.success(`任务 "${task.name}" 已恢复`);
    } else {
      message.error(result.error || "恢复任务失败");
    }
  } catch (error) {
    taskLogger.error("恢复任务失败:", error);
    message.error("恢复任务失败: " + error.message);
  }
}

async function handleCancelTask(task) {
  Modal.confirm({
    title: "确认取消任务",
    content: `确定要取消任务 "${task.name}" 吗？`,
    icon: h(ExclamationCircleOutlined),
    okText: "确认",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const result = await store.cancelTask(task.id, "用户主动取消");

        if (result.success) {
          message.success(`任务 "${task.name}" 已取消`);

          // 关闭详情抽屉（如果打开）
          if (currentTask.value && currentTask.value.id === task.id) {
            taskDetailDrawerVisible.value = false;
          }
        } else {
          message.error(result.error || "取消任务失败");
        }
      } catch (error) {
        taskLogger.error("取消任务失败:", error);
        message.error("取消任务失败: " + error.message);
      }
    },
  });
}

// ==========================================
// 筛选和搜索
// ==========================================

function handleSearch(value) {
  taskLogger.info("搜索任务:", value);
  store.setTaskFilters({ searchQuery: value });
}

function handleFilterChange(value) {
  taskLogger.info("筛选状态:", value);
  store.setTaskFilters({ status: value });
}

function handleTeamFilterChange(value) {
  taskLogger.info("筛选团队:", value);
  store.setTaskFilters({ teamId: value });
}

function filterTeamOption(input, option) {
  const teamName = teams.value.find((t) => t.id === option.value)?.name || "";
  return teamName.toLowerCase().includes(input.toLowerCase());
}

// 监听筛选条件变化
watch(searchQuery, (newValue) => {
  store.setTaskFilters({ searchQuery: newValue });
});

watch(statusFilter, (newValue) => {
  store.setTaskFilters({ status: newValue });
});

watch(teamFilter, (newValue) => {
  store.setTaskFilters({ teamId: newValue });
});

// ==========================================
// 表格操作
// ==========================================

function handleTableChange(pagination, filters, sorter) {
  tablePagination.value = pagination;

  // 根据 sorter 更新排序
  if (sorter && sorter.field) {
    store.setTaskFilters({
      sortField: sorter.field,
      sortOrder: sorter.order || null, // 'ascend' | 'descend' | null
    });
  }

  taskLogger.info("表格变化:", { pagination, filters, sorter });
}

// ==========================================
// 辅助函数
// ==========================================

function getTaskStatusColor(status) {
  const colors = {
    pending: "default",
    running: "processing",
    paused: "warning",
    completed: "success",
    failed: "error",
    cancelled: "default",
  };
  return colors[status] || "default";
}

function getTaskStatusText(status) {
  const texts = {
    pending: "待处理",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return texts[status] || status;
}

function getProgressStatus(task) {
  if (task.status === "failed") {
    return "exception";
  }
  if (task.status === "completed") {
    return "success";
  }
  if (task.status === "running") {
    return "active";
  }
  return "normal";
}

function getTeamName(teamId) {
  const team = teams.value.find((t) => t.id === teamId);
  return team ? team.name : teamId;
}

function formatDuration(ms) {
  if (!ms || ms === 0) {
    return "-";
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "-";
  }

  try {
    return formatDistanceToNow(new Date(timestamp), {
      locale: zhCN,
      addSuffix: true,
    });
  } catch (error) {
    return "-";
  }
}

// ==========================================
// 图表相关
// ==========================================

function initCharts() {
  if (!successRateChartRef.value || !durationChartRef.value) {
    return;
  }

  initSuccessRateChart();
  initDurationChart();
  if (completionTrendChartRef.value) {
    initCompletionTrendChart();
  }
  if (teamPerformanceChartRef.value) {
    initTeamPerformanceChart();
  }
}

function initSuccessRateChart() {
  successRateChart = init(successRateChartRef.value);

  const statusCounts = {
    completed: completedTasks.value.length,
    failed: globalStats.value.failedTasks || 0,
    running: runningTasks.value.length,
    pending:
      (globalStats.value.totalTasks || 0) -
      completedTasks.value.length -
      (globalStats.value.failedTasks || 0) -
      runningTasks.value.length,
  };

  successRateChart.setOption({
    title: { text: "任务状态分布", left: "center" },
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0 },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 6, borderColor: "#fff", borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: "bold" } },
        data: [
          {
            value: statusCounts.completed,
            name: "已完成",
            itemStyle: { color: "#52c41a" },
          },
          {
            value: statusCounts.failed,
            name: "失败",
            itemStyle: { color: "#ff4d4f" },
          },
          {
            value: statusCounts.running,
            name: "运行中",
            itemStyle: { color: "#1890ff" },
          },
          {
            value: statusCounts.pending,
            name: "待处理",
            itemStyle: { color: "#d9d9d9" },
          },
        ].filter((d) => d.value > 0),
      },
    ],
  });
}

function initDurationChart() {
  durationChart = init(durationChartRef.value);

  // 按耗时分段统计
  const buckets = {
    "<10s": 0,
    "10-30s": 0,
    "30s-1m": 0,
    "1-5m": 0,
    "5-30m": 0,
    ">30m": 0,
  };
  for (const task of tasks.value) {
    const ms = task.duration || 0;
    if (ms <= 0) {
      continue;
    }
    const sec = ms / 1000;
    if (sec < 10) {
      buckets["<10s"]++;
    } else if (sec < 30) {
      buckets["10-30s"]++;
    } else if (sec < 60) {
      buckets["30s-1m"]++;
    } else if (sec < 300) {
      buckets["1-5m"]++;
    } else if (sec < 1800) {
      buckets["5-30m"]++;
    } else {
      buckets[">30m"]++;
    }
  }

  durationChart.setOption({
    title: { text: "任务耗时分布", left: "center" },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "category",
      data: Object.keys(buckets),
      axisLabel: { fontSize: 12 },
    },
    yAxis: { type: "value", name: "任务数", minInterval: 1 },
    series: [
      {
        type: "bar",
        data: Object.values(buckets),
        itemStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#1890ff" },
            { offset: 1, color: "#69c0ff" },
          ]),
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: "50%",
      },
    ],
    grid: { left: 60, right: 20, bottom: 40, top: 50 },
  });
}

function initCompletionTrendChart() {
  completionTrendChart = init(completionTrendChartRef.value);

  // Group completed tasks by date (last 14 days)
  const now = new Date();
  const days = 14;
  const dateMap = {};
  const dateLabels = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    dateMap[key] = 0;
    dateLabels.push(key);
  }

  for (const task of tasks.value) {
    if (task.status === "completed" && task.completedAt) {
      const d = new Date(task.completedAt);
      const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (key in dateMap) {
        dateMap[key]++;
      }
    }
  }

  completionTrendChart.setOption({
    title: { text: "完成趋势（近14天）", left: "center" },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: dateLabels, boundaryGap: false },
    yAxis: { type: "value", name: "完成数", minInterval: 1 },
    series: [
      {
        type: "line",
        data: dateLabels.map((k) => dateMap[k]),
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { color: "#52c41a", width: 2 },
        itemStyle: { color: "#52c41a" },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(82, 196, 26, 0.3)" },
            { offset: 1, color: "rgba(82, 196, 26, 0.05)" },
          ]),
        },
      },
    ],
    grid: { left: 60, right: 20, bottom: 40, top: 50 },
  });
}

function initTeamPerformanceChart() {
  teamPerformanceChart = init(teamPerformanceChartRef.value);

  // Cross-reference teams and tasks
  const teamNames = [];
  const completedCounts = [];
  const failedCounts = [];
  const runningCounts = [];

  for (const team of teams.value) {
    teamNames.push(team.name);
    const teamTasks = tasks.value.filter((t) => t.teamId === team.id);
    completedCounts.push(
      teamTasks.filter((t) => t.status === "completed").length,
    );
    failedCounts.push(teamTasks.filter((t) => t.status === "failed").length);
    runningCounts.push(teamTasks.filter((t) => t.status === "running").length);
  }

  teamPerformanceChart.setOption({
    title: { text: "团队任务统计", left: "center" },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { bottom: 0, data: ["已完成", "失败", "运行中"] },
    xAxis: {
      type: "category",
      data: teamNames,
      axisLabel: { rotate: teamNames.length > 5 ? 30 : 0, fontSize: 12 },
    },
    yAxis: { type: "value", name: "任务数", minInterval: 1 },
    series: [
      {
        name: "已完成",
        type: "bar",
        stack: "total",
        data: completedCounts,
        itemStyle: { color: "#52c41a" },
      },
      {
        name: "失败",
        type: "bar",
        stack: "total",
        data: failedCounts,
        itemStyle: { color: "#ff4d4f" },
      },
      {
        name: "运行中",
        type: "bar",
        stack: "total",
        data: runningCounts,
        itemStyle: { color: "#faad14" },
      },
    ],
    grid: { left: 60, right: 20, bottom: 60, top: 50 },
  });
}

function updateCharts() {
  if (successRateChart) {
    initSuccessRateChart();
  }
  if (durationChart) {
    initDurationChart();
  }
  if (completionTrendChart) {
    initCompletionTrendChart();
  }
  if (teamPerformanceChart) {
    initTeamPerformanceChart();
  }
}

function destroyCharts() {
  if (successRateChart) {
    successRateChart.dispose();
    successRateChart = null;
  }
  if (durationChart) {
    durationChart.dispose();
    durationChart = null;
  }
  if (completionTrendChart) {
    completionTrendChart.dispose();
    completionTrendChart = null;
  }
  if (teamPerformanceChart) {
    teamPerformanceChart.dispose();
    teamPerformanceChart = null;
  }
}

// 数据变化时更新图表
watch([tasks, globalStats, teams], () => {
  if (showCharts.value) {
    nextTick(() => updateCharts());
  }
});
</script>

<style scoped lang="scss">
.task-monitor-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 12px;

        :deep(.anticon) {
          font-size: 28px;
          color: #1890ff;
        }
      }

      .page-description {
        color: #8c8c8c;
        margin: 0;
        font-size: 14px;
      }
    }

    .header-right {
      display: flex;
      gap: 12px;
    }
  }

  .stats-section {
    margin-bottom: 24px;

    .ant-card {
      border-radius: 8px;
    }
  }

  .tasks-section {
    border-radius: 8px;

    :deep(.ant-card-head) {
      font-weight: 600;
      font-size: 16px;
    }

    .filters-bar {
      margin-bottom: 16px;
    }
  }

  .charts-section {
    border-radius: 8px;
  }
}

// 响应式调整
@media (max-width: 768px) {
  .task-monitor-page {
    padding: 16px;

    .page-header {
      flex-direction: column;
      gap: 16px;

      .header-right {
        width: 100%;

        :deep(.ant-space) {
          width: 100%;
          justify-content: flex-end;
        }
      }
    }

    .filters-bar {
      :deep(.ant-space) {
        width: 100%;
        flex-direction: column;

        > * {
          width: 100% !important;
        }
      }
    }

    .tasks-section {
      :deep(.ant-table) {
        .ant-table-thead > tr > th,
        .ant-table-tbody > tr > td {
          padding: 8px;
          font-size: 12px;
        }
      }
    }
  }
}
</style>
