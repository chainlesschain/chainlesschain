<template>
  <div class="performance-dashboard">
    <a-spin :spinning="loading" tip="加载性能数据...">
      <!-- 顶部统计卡片 -->
      <a-row :gutter="16" class="metrics-overview">
        <a-col :span="6">
          <a-card size="small" hoverable>
            <a-statistic
              title="CPU 使用率"
              :value="metrics.cpu.usage"
              suffix="%"
              :precision="1"
              :value-style="getMetricColor(metrics.cpu.usage, 70, 90)"
            >
              <template #prefix>
                <DashboardOutlined />
              </template>
            </a-statistic>
            <div class="stat-detail">
              进程: {{ metrics.cpu.processUsage?.toFixed(1) || 0 }}%
            </div>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small" hoverable>
            <a-statistic
              title="内存使用"
              :value="metrics.memory.usedMB"
              suffix="MB"
              :precision="0"
              :value-style="getMetricColor(metrics.memory.usagePercent, 70, 85)"
            >
              <template #prefix>
                <CloudOutlined />
              </template>
            </a-statistic>
            <div class="stat-detail">总计: {{ metrics.memory.totalMB }} MB</div>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small" hoverable>
            <a-statistic
              title="数据库查询 (P95)"
              :value="metrics.database.p95"
              suffix="ms"
              :precision="0"
              :value-style="getMetricColor(metrics.database.p95, 100, 200)"
            >
              <template #prefix>
                <DatabaseOutlined />
              </template>
            </a-statistic>
            <div class="stat-detail">
              慢查询: {{ metrics.database.slowQueryCount }}
            </div>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small" hoverable>
            <a-statistic
              title="IPC 延迟 (P95)"
              :value="metrics.ipc.p95"
              suffix="ms"
              :precision="0"
              :value-style="getMetricColor(metrics.ipc.p95, 50, 100)"
            >
              <template #prefix>
                <ApiOutlined />
              </template>
            </a-statistic>
            <div class="stat-detail">
              活跃请求: {{ metrics.ipc.activeRequests }}
            </div>
          </a-card>
        </a-col>
      </a-row>

      <!-- 操作按钮 -->
      <a-card size="small" class="action-toolbar">
        <a-space>
          <a-button @click="loadMetrics">
            <ReloadOutlined :spin="loading" /> 刷新
          </a-button>
          <a-button @click="clearHistory">
            <ClearOutlined /> 清除历史
          </a-button>
          <a-button type="primary" @click="exportReport">
            <ExportOutlined /> 导出报告
          </a-button>
          <a-switch
            v-model:checked="autoRefresh"
            checked-children="自动刷新"
            un-checked-children="手动刷新"
            @change="onAutoRefreshChange"
          />
        </a-space>
      </a-card>

      <!-- Tab 页签 -->
      <a-tabs v-model:active-key="activeTab" class="performance-tabs">
        <!-- CPU & 内存监控 -->
        <a-tab-pane key="system" tab="系统资源">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-card title="CPU 使用趋势" size="small">
                <div ref="cpuChart" style="height: 300px" />
              </a-card>
            </a-col>
            <a-col :span="12">
              <a-card title="内存使用趋势" size="small">
                <div ref="memoryChart" style="height: 300px" />
              </a-card>
            </a-col>
          </a-row>
        </a-tab-pane>

        <!-- 数据库性能 -->
        <a-tab-pane key="database" tab="数据库性能">
          <a-card title="慢查询列表" size="small">
            <a-table
              :columns="slowQueryColumns"
              :data-source="slowQueries"
              :pagination="{ pageSize: 10 }"
              size="small"
              :scroll="{ x: true }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'duration'">
                  <a-tag :color="getDurationColor(record.duration)">
                    {{ record.duration }} ms
                  </a-tag>
                </template>
                <template v-else-if="column.key === 'query'">
                  <a-typography-text
                    :ellipsis="{ tooltip: record.query }"
                    style="max-width: 400px"
                  >
                    {{ record.query }}
                  </a-typography-text>
                </template>
                <template v-else-if="column.key === 'timestamp'">
                  {{ formatTime(record.timestamp) }}
                </template>
              </template>
            </a-table>
          </a-card>

          <a-card title="索引优化建议" size="small" style="margin-top: 16px">
            <a-list :data-source="indexSuggestions" size="small">
              <template #renderItem="{ item }">
                <a-list-item>
                  <template #actions>
                    <a-button
                      type="link"
                      size="small"
                      @click="applyIndexSuggestion(item)"
                    >
                      应用
                    </a-button>
                  </template>
                  <a-list-item-meta>
                    <template #title>
                      为表 <code>{{ item.table }}</code> 添加索引
                    </template>
                    <template #description>
                      字段: <code>{{ item.columns.join(", ") }}</code>
                      <br />
                      原因: {{ item.reason }}
                      <br />
                      预计改善: {{ item.impact }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>

            <a-button
              v-if="indexSuggestions.length > 0"
              type="primary"
              block
              style="margin-top: 12px"
              @click="applyAllIndexSuggestions"
            >
              应用所有建议
            </a-button>
            <a-empty
              v-else
              description="暂无索引优化建议"
              :image="Empty.PRESENTED_IMAGE_SIMPLE"
            />
          </a-card>
        </a-tab-pane>

        <!-- IPC 性能 -->
        <a-tab-pane key="ipc" tab="IPC 调用">
          <a-card title="慢 IPC 调用" size="small">
            <a-table
              :columns="slowIPCColumns"
              :data-source="slowIPCCalls"
              :pagination="{ pageSize: 10 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'duration'">
                  <a-tag :color="getDurationColor(record.duration)">
                    {{ record.duration }} ms
                  </a-tag>
                </template>
                <template v-else-if="column.key === 'timestamp'">
                  {{ formatTime(record.timestamp) }}
                </template>
              </template>
            </a-table>
          </a-card>

          <a-card title="活跃 IPC 请求" size="small" style="margin-top: 16px">
            <a-table
              :columns="activeIPCColumns"
              :data-source="activeIPCRequests"
              :pagination="false"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'elapsed'">
                  {{ record.elapsed }} ms
                </template>
                <template v-else-if="column.key === 'startedAt'">
                  {{ formatTime(record.startedAt) }}
                </template>
              </template>
            </a-table>
            <a-empty
              v-if="activeIPCRequests.length === 0"
              description="当前无活跃请求"
              :image="Empty.PRESENTED_IMAGE_SIMPLE"
            />
          </a-card>
        </a-tab-pane>

        <!-- AI 引擎性能 -->
        <a-tab-pane key="ai" tab="AI 引擎">
          <a-row :gutter="16">
            <a-col :span="6">
              <a-card size="small">
                <a-statistic
                  title="意图识别延迟 (P95)"
                  :value="aiMetrics.intent_recognition.p95"
                  suffix="ms"
                  :value-style="
                    getAIMetricColor(
                      'intent_recognition',
                      aiMetrics.intent_recognition.p95,
                    )
                  "
                />
                <div class="metric-threshold">
                  阈值: {{ aiThresholds.intent_recognition.acceptable }} ms
                </div>
              </a-card>
            </a-col>
            <a-col :span="6">
              <a-card size="small">
                <a-statistic
                  title="知识检索延迟 (P95)"
                  :value="aiMetrics.knowledge_retrieval.p95"
                  suffix="ms"
                  :value-style="
                    getAIMetricColor(
                      'knowledge_retrieval',
                      aiMetrics.knowledge_retrieval.p95,
                    )
                  "
                />
                <div class="metric-threshold">
                  阈值: {{ aiThresholds.knowledge_retrieval.acceptable }} ms
                </div>
              </a-card>
            </a-col>
            <a-col :span="6">
              <a-card size="small">
                <a-statistic
                  title="响应生成延迟 (P95)"
                  :value="aiMetrics.response_generation.p95"
                  suffix="ms"
                  :value-style="
                    getAIMetricColor(
                      'response_generation',
                      aiMetrics.response_generation.p95,
                    )
                  "
                />
                <div class="metric-threshold">
                  阈值: {{ aiThresholds.response_generation.acceptable }} ms
                </div>
              </a-card>
            </a-col>
            <a-col :span="6">
              <a-card size="small">
                <a-statistic
                  title="总响应时间 (P95)"
                  :value="aiMetrics.total_response_time.p95"
                  suffix="ms"
                  :value-style="
                    getAIMetricColor(
                      'total_response_time',
                      aiMetrics.total_response_time.p95,
                    )
                  "
                />
                <div class="metric-threshold">
                  阈值: {{ aiThresholds.total_response_time.acceptable }} ms
                </div>
              </a-card>
            </a-col>
          </a-row>

          <a-card title="AI 引擎性能趋势" size="small" style="margin-top: 16px">
            <div ref="aiPerformanceChart" style="height: 400px" />
          </a-card>
        </a-tab-pane>
      </a-tabs>
    </a-spin>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, onMounted, onUnmounted } from "vue";
import { message, Empty } from "ant-design-vue";
import dayjs from "dayjs";
import { init } from "../utils/echartsConfig";
import {
  DashboardOutlined,
  CloudOutlined,
  DatabaseOutlined,
  ApiOutlined,
  ReloadOutlined,
  ClearOutlined,
  ExportOutlined,
} from "@ant-design/icons-vue";

// 数据
const loading = ref(false);
const activeTab = ref("system");
const autoRefresh = ref(true);
let refreshInterval = null;

const metrics = reactive({
  cpu: { usage: 0, processUsage: 0 },
  memory: { usedMB: 0, totalMB: 0, usagePercent: 0 },
  database: { p95: 0, slowQueryCount: 0 },
  ipc: { p95: 0, activeRequests: 0 },
});

const aiMetrics = reactive({
  intent_recognition: { p95: 0 },
  knowledge_retrieval: { p95: 0 },
  response_generation: { p95: 0 },
  total_response_time: { p95: 0 },
});

const aiThresholds = {
  intent_recognition: { target: 1000, acceptable: 1500 },
  knowledge_retrieval: { target: 1500, acceptable: 2000 },
  response_generation: { target: 3000, acceptable: 4000 },
  total_response_time: { target: 6000, acceptable: 8000 },
};

const slowQueries = ref([]);
const slowIPCCalls = ref([]);
const activeIPCRequests = ref([]);
const indexSuggestions = ref([]);

// 图表实例
const cpuChart = ref(null);
const memoryChart = ref(null);
const aiPerformanceChart = ref(null);
let cpuChartInstance = null;
let memoryChartInstance = null;
let aiPerformanceChartInstance = null;

// 历史数据（用于绘制趋势图）
const cpuHistory = ref([]);
const memoryHistory = ref([]);

// 表格列定义
const slowQueryColumns = [
  { title: "查询语句", dataIndex: "query", key: "query", ellipsis: true },
  { title: "耗时", dataIndex: "duration", key: "duration", width: 100 },
  { title: "时间", dataIndex: "timestamp", key: "timestamp", width: 180 },
];

const slowIPCColumns = [
  { title: "IPC 通道", dataIndex: "channel", key: "channel" },
  { title: "耗时", dataIndex: "duration", key: "duration", width: 100 },
  { title: "时间", dataIndex: "timestamp", key: "timestamp", width: 180 },
];

const activeIPCColumns = [
  { title: "IPC 通道", dataIndex: "channel", key: "channel" },
  { title: "已运行", dataIndex: "elapsed", key: "elapsed", width: 100 },
  { title: "开始时间", dataIndex: "startedAt", key: "startedAt", width: 180 },
];

// 方法
function getMetricColor(value, warningThreshold, errorThreshold) {
  if (value >= errorThreshold) {
    return { color: "#ff4d4f" };
  }
  if (value >= warningThreshold) {
    return { color: "#faad14" };
  }
  return { color: "#52c41a" };
}

function getAIMetricColor(metric, value) {
  const thresholds = aiThresholds[metric];
  if (value >= thresholds.acceptable) {
    return { color: "#ff4d4f" };
  }
  if (value >= thresholds.target) {
    return { color: "#faad14" };
  }
  return { color: "#52c41a" };
}

function getDurationColor(duration) {
  if (duration >= 200) {
    return "red";
  }
  if (duration >= 100) {
    return "orange";
  }
  return "green";
}

function formatTime(timestamp) {
  return dayjs(timestamp).format("HH:mm:ss");
}

async function loadMetrics() {
  loading.value = true;
  try {
    // 获取性能指标
    const metricsData = await window.electronAPI.invoke(
      "performance:getMetrics",
    );

    if (metricsData?.success) {
      const data = metricsData.data;

      // 更新CPU和内存
      const cpuData = await window.electronAPI.invoke(
        "performance:getCPUMetrics",
      );
      const memoryData = await window.electronAPI.invoke(
        "performance:getMemoryMetrics",
      );

      if (cpuData?.success) {
        metrics.cpu = {
          usage: cpuData.data.systemUsage || 0,
          processUsage: cpuData.data.processUsage || 0,
        };
      }

      if (memoryData?.success) {
        metrics.memory = {
          usedMB: Math.round(memoryData.data.used / 1024 / 1024),
          totalMB: Math.round(memoryData.data.total / 1024 / 1024),
          usagePercent: memoryData.data.usagePercent || 0,
        };
      }

      // 更新数据库和IPC指标
      metrics.database = {
        p95: data.database?.p95 || 0,
        slowQueryCount: data.database?.slowQueries?.length || 0,
      };

      metrics.ipc = {
        p95: data.ipc?.p95 || 0,
        activeRequests: data.ipc?.activeRequests || 0,
      };

      // 更新AI引擎指标
      if (data.ai) {
        aiMetrics.intent_recognition.p95 = data.ai.intent_recognition?.p95 || 0;
        aiMetrics.knowledge_retrieval.p95 =
          data.ai.knowledge_retrieval?.p95 || 0;
        aiMetrics.response_generation.p95 =
          data.ai.response_generation?.p95 || 0;
        aiMetrics.total_response_time.p95 =
          data.ai.total_response_time?.p95 || 0;
      }

      // 记录历史数据
      const now = Date.now();
      cpuHistory.value.push({ time: now, value: metrics.cpu.usage });
      memoryHistory.value.push({
        time: now,
        value: metrics.memory.usagePercent,
      });

      // 只保留最近100个数据点
      if (cpuHistory.value.length > 100) {
        cpuHistory.value.shift();
      }
      if (memoryHistory.value.length > 100) {
        memoryHistory.value.shift();
      }

      // 更新图表
      renderCPUChart();
      renderMemoryChart();
      renderAIPerformanceChart();
    }

    // 获取慢查询
    const slowQueriesData = await window.electronAPI.invoke(
      "performance:getSlowQueries",
      50,
    );
    if (slowQueriesData?.success) {
      slowQueries.value = (slowQueriesData.data || []).map((item, index) => ({
        key: index,
        ...item,
      }));
    }

    // 获取慢IPC调用
    const slowIPCData = await window.electronAPI.invoke(
      "performance:getSlowIPCCalls",
      50,
    );
    if (slowIPCData?.success) {
      slowIPCCalls.value = (slowIPCData.data || []).map((item, index) => ({
        key: index,
        ...item,
      }));
    }

    // 获取活跃IPC请求
    const activeIPCData = await window.electronAPI.invoke(
      "performance:getActiveIPCRequests",
    );
    if (activeIPCData?.success) {
      activeIPCRequests.value = (activeIPCData.data || []).map(
        (item, index) => ({
          key: index,
          ...item,
        }),
      );
    }

    // 获取索引建议
    const indexData = await window.electronAPI.invoke(
      "db-performance:get-index-suggestions",
    );
    if (indexData?.success) {
      indexSuggestions.value = indexData.data || [];
    }
  } catch (error) {
    logger.error("加载性能数据失败:", error);
    message.error("加载性能数据失败: " + error.message);
  } finally {
    loading.value = false;
  }
}

function renderCPUChart() {
  if (!cpuChartInstance) {
    return;
  }

  const times = cpuHistory.value.map((item) =>
    dayjs(item.time).format("HH:mm:ss"),
  );
  const values = cpuHistory.value.map((item) => item.value);

  const option = {
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: times, boundaryGap: false },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" },
    },
    series: [
      {
        name: "CPU 使用率",
        type: "line",
        data: values,
        smooth: true,
        areaStyle: { color: "rgba(24, 144, 255, 0.2)" },
        itemStyle: { color: "#1890ff" },
      },
    ],
  };

  cpuChartInstance.setOption(option);
}

function renderMemoryChart() {
  if (!memoryChartInstance) {
    return;
  }

  const times = memoryHistory.value.map((item) =>
    dayjs(item.time).format("HH:mm:ss"),
  );
  const values = memoryHistory.value.map((item) => item.value);

  const option = {
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: times, boundaryGap: false },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" },
    },
    series: [
      {
        name: "内存使用率",
        type: "line",
        data: values,
        smooth: true,
        areaStyle: { color: "rgba(82, 196, 26, 0.2)" },
        itemStyle: { color: "#52c41a" },
      },
    ],
  };

  memoryChartInstance.setOption(option);
}

function renderAIPerformanceChart() {
  if (!aiPerformanceChartInstance) {
    return;
  }

  const option = {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { data: ["P95 延迟", "目标阈值", "可接受阈值"] },
    xAxis: {
      type: "category",
      data: ["意图识别", "知识检索", "响应生成", "总响应时间"],
    },
    yAxis: { type: "value", name: "延迟 (ms)" },
    series: [
      {
        name: "P95 延迟",
        type: "bar",
        data: [
          aiMetrics.intent_recognition.p95,
          aiMetrics.knowledge_retrieval.p95,
          aiMetrics.response_generation.p95,
          aiMetrics.total_response_time.p95,
        ],
        itemStyle: { color: "#1890ff" },
      },
      {
        name: "目标阈值",
        type: "line",
        data: [
          aiThresholds.intent_recognition.target,
          aiThresholds.knowledge_retrieval.target,
          aiThresholds.response_generation.target,
          aiThresholds.total_response_time.target,
        ],
        itemStyle: { color: "#52c41a" },
        lineStyle: { type: "dashed" },
      },
      {
        name: "可接受阈值",
        type: "line",
        data: [
          aiThresholds.intent_recognition.acceptable,
          aiThresholds.knowledge_retrieval.acceptable,
          aiThresholds.response_generation.acceptable,
          aiThresholds.total_response_time.acceptable,
        ],
        itemStyle: { color: "#faad14" },
        lineStyle: { type: "dashed" },
      },
    ],
  };

  aiPerformanceChartInstance.setOption(option);
}

async function clearHistory() {
  try {
    await window.electronAPI.invoke("performance:clearHistory");
    cpuHistory.value = [];
    memoryHistory.value = [];
    message.success("历史数据已清除");
    await loadMetrics();
  } catch (error) {
    logger.error("清除历史失败:", error);
    message.error("清除历史失败: " + error.message);
  }
}

async function exportReport() {
  try {
    const result = await window.electronAPI.invoke("performance:exportReport");
    if (result?.success) {
      message.success("性能报告已导出");
      logger.info("Report:", result.data);
    }
  } catch (error) {
    logger.error("导出报告失败:", error);
    message.error("导出报告失败: " + error.message);
  }
}

async function applyIndexSuggestion(suggestion) {
  try {
    const result = await window.electronAPI.invoke(
      "db-performance:apply-index-suggestion",
      suggestion,
    );
    if (result?.success) {
      message.success("索引已应用");
      await loadMetrics();
    }
  } catch (error) {
    logger.error("应用索引失败:", error);
    message.error("应用索引失败: " + error.message);
  }
}

async function applyAllIndexSuggestions() {
  try {
    const result = await window.electronAPI.invoke(
      "db-performance:apply-all-index-suggestions",
    );
    if (result?.success) {
      message.success(`已应用 ${result.data.appliedCount} 个索引建议`);
      await loadMetrics();
    }
  } catch (error) {
    logger.error("批量应用索引失败:", error);
    message.error("批量应用索引失败: " + error.message);
  }
}

function onAutoRefreshChange(checked) {
  if (checked) {
    // 启动自动刷新（每 5 秒）
    refreshInterval = setInterval(loadMetrics, 5000);
  } else {
    // 停止自动刷新
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }
}

// 生命周期
onMounted(() => {
  // 初始化 ECharts
  cpuChartInstance = init(cpuChart.value);
  memoryChartInstance = init(memoryChart.value);
  aiPerformanceChartInstance = init(aiPerformanceChart.value);

  // 加载数据
  loadMetrics();

  // 启动自动刷新
  if (autoRefresh.value) {
    refreshInterval = setInterval(loadMetrics, 5000);
  }

  // 监听窗口大小变化
  window.addEventListener("resize", () => {
    cpuChartInstance?.resize();
    memoryChartInstance?.resize();
    aiPerformanceChartInstance?.resize();
  });
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  cpuChartInstance?.dispose();
  memoryChartInstance?.dispose();
  aiPerformanceChartInstance?.dispose();
});
</script>

<style scoped>
.performance-dashboard {
  padding: 16px;
}

.metrics-overview {
  margin-bottom: 16px;
}

.stat-detail {
  margin-top: 8px;
  font-size: 12px;
  color: #999;
}

.metric-threshold {
  margin-top: 8px;
  font-size: 11px;
  color: #666;
  text-align: center;
}

.action-toolbar {
  margin-bottom: 16px;
}

.performance-tabs :deep(.ant-tabs-content) {
  padding-top: 16px;
}
</style>
