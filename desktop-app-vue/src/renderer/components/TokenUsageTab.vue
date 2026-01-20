<template>
  <div class="token-usage-tab">
    <a-spin :spinning="loading" tip="加载统计数据...">
      <!-- 顶部统计卡片 -->
      <a-row :gutter="16" class="stats-overview">
        <a-col :span="6">
          <a-card size="small" hoverable>
            <a-statistic
              title="总 Token 使用"
              :value="stats.totalTokens"
              suffix="tokens"
              :value-style="{ color: '#1890ff' }"
            >
              <template #prefix>
                <DatabaseOutlined />
              </template>
            </a-statistic>
            <div class="stat-detail">
              本周: {{ (stats.weekTokens ?? 0).toLocaleString() }}
            </div>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small" hoverable>
            <a-statistic
              title="总成本"
              :value="stats.totalCost"
              prefix="$"
              :precision="4"
              :value-style="{ color: '#52c41a' }"
            >
              <template #prefix>
                <DollarOutlined />
              </template>
            </a-statistic>
            <div class="stat-detail">
              本周: ${{ (stats.weekCost ?? 0).toFixed(4) }}
            </div>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small" hoverable>
            <a-statistic
              title="缓存命中率"
              :value="stats.cacheHitRate"
              suffix="%"
              :precision="1"
              :value-style="{ color: '#faad14' }"
            >
              <template #prefix>
                <ThunderboltOutlined />
              </template>
            </a-statistic>
            <div class="stat-detail">
              节省: {{ (stats.cachedTokens ?? 0).toLocaleString() }} tokens
            </div>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small" hoverable>
            <a-statistic
              title="平均成本/次"
              :value="stats.avgCostPerCall"
              prefix="$"
              :precision="5"
              :value-style="{ color: '#13c2c2' }"
            >
              <template #prefix>
                <LineChartOutlined />
              </template>
            </a-statistic>
            <div class="stat-detail">总调用: {{ stats.totalCalls }}</div>
          </a-card>
        </a-col>
      </a-row>

      <!-- 筛选工具栏 -->
      <a-card class="filter-toolbar" size="small">
        <a-space>
          <a-range-picker
            v-model:value="dateRange"
            :presets="datePresets"
            format="YYYY-MM-DD"
            @change="onDateRangeChange"
          />
          <a-select
            v-model:value="selectedProvider"
            placeholder="筛选提供商"
            style="width: 150px"
            @change="loadData"
          >
            <a-select-option value="all"> 全部提供商 </a-select-option>
            <a-select-option value="openai"> OpenAI </a-select-option>
            <a-select-option value="anthropic"> Anthropic </a-select-option>
            <a-select-option value="deepseek"> DeepSeek </a-select-option>
            <a-select-option value="volcengine"> 火山引擎 </a-select-option>
            <a-select-option value="ollama"> Ollama </a-select-option>
          </a-select>
          <a-button type="primary" @click="exportReport">
            <ExportOutlined /> 导出 CSV
          </a-button>
          <a-button @click="clearCache"> <ClearOutlined /> 清除缓存 </a-button>
        </a-space>
      </a-card>

      <!-- 时间序列图表 -->
      <a-card title="成本趋势" class="chart-card">
        <div ref="timeSeriesChart" style="height: 300px" />
      </a-card>

      <!-- 双列布局：提供商占比 + 模型成本排行 -->
      <a-row :gutter="16">
        <a-col :span="12">
          <a-card title="提供商占比" class="chart-card">
            <div ref="providerPieChart" style="height: 300px" />
          </a-card>
        </a-col>
        <a-col :span="12">
          <a-card title="热门模型成本排行" class="chart-card">
            <a-table
              :columns="modelColumns"
              :data-source="topModels"
              :pagination="false"
              size="small"
              :scroll="{ y: 260 }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'cost'">
                  <span style="color: #52c41a; font-weight: bold">
                    ${{ (record.cost ?? 0).toFixed(4) }}
                  </span>
                </template>
                <template v-else-if="column.key === 'tokens'">
                  {{ (record.tokens ?? 0).toLocaleString() }}
                </template>
                <template v-else-if="column.key === 'calls'">
                  {{ record.calls ?? 0 }}
                </template>
              </template>
            </a-table>
          </a-card>
        </a-col>
      </a-row>

      <!-- 预算管理 -->
      <a-card title="预算管理" class="budget-card">
        <a-row :gutter="16">
          <a-col :span="8">
            <div class="budget-item">
              <div class="budget-title">每日预算</div>
              <a-progress
                :percent="budgetProgress.daily"
                :status="getBudgetStatus(budgetProgress.daily)"
                :stroke-color="getBudgetColor(budgetProgress.daily)"
              />
              <div class="budget-detail">
                ${{ (budget.dailySpend ?? 0).toFixed(2) }} / ${{
                  (budget.dailyLimit ?? 0).toFixed(2)
                }}
              </div>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="budget-item">
              <div class="budget-title">每周预算</div>
              <a-progress
                :percent="budgetProgress.weekly"
                :status="getBudgetStatus(budgetProgress.weekly)"
                :stroke-color="getBudgetColor(budgetProgress.weekly)"
              />
              <div class="budget-detail">
                ${{ budget.weeklySpend.toFixed(2) }} / ${{
                  budget.weeklyLimit.toFixed(2)
                }}
              </div>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="budget-item">
              <div class="budget-title">每月预算</div>
              <a-progress
                :percent="budgetProgress.monthly"
                :status="getBudgetStatus(budgetProgress.monthly)"
                :stroke-color="getBudgetColor(budgetProgress.monthly)"
              />
              <div class="budget-detail">
                ${{ budget.monthlySpend.toFixed(2) }} / ${{
                  budget.monthlyLimit.toFixed(2)
                }}
              </div>
            </div>
          </a-col>
        </a-row>
        <a-divider />
        <a-button type="primary" @click="showBudgetModal = true">
          <SettingOutlined /> 设置预算限制
        </a-button>
      </a-card>
    </a-spin>

    <!-- 预算设置 Modal -->
    <a-modal
      v-model:open="showBudgetModal"
      title="设置预算限制"
      @ok="saveBudget"
      @cancel="showBudgetModal = false"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="每日限制 (USD)">
          <a-input-number
            v-model:value="budgetForm.dailyLimit"
            :min="0"
            :step="0.5"
            :precision="2"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="每周限制 (USD)">
          <a-input-number
            v-model:value="budgetForm.weeklyLimit"
            :min="0"
            :step="1"
            :precision="2"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="每月限制 (USD)">
          <a-input-number
            v-model:value="budgetForm.monthlyLimit"
            :min="0"
            :step="5"
            :precision="2"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="告警阈值">
          <a-slider
            v-model:value="budgetForm.warningThreshold"
            :min="0"
            :max="1"
            :step="0.05"
            :marks="{ 0.5: '50%', 0.8: '80%', 0.95: '95%', 1: '100%' }"
          />
        </a-form-item>
        <a-form-item label="桌面通知">
          <a-switch v-model:checked="budgetForm.desktopAlerts" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from "@/utils/logger";

import { ref, reactive, onMounted, onUnmounted, computed } from "vue";
import { message } from "ant-design-vue";
import dayjs from "dayjs";
import { init } from "../utils/echartsConfig";
import {
  DatabaseOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  LineChartOutlined,
  ExportOutlined,
  ClearOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";

// 数据
const loading = ref(false);
const dateRange = ref([dayjs().subtract(7, "day"), dayjs()]);
const selectedProvider = ref("all");
const showBudgetModal = ref(false);

const stats = reactive({
  totalTokens: 0,
  totalCost: 0,
  weekTokens: 0,
  weekCost: 0,
  cacheHitRate: 0,
  cachedTokens: 0,
  avgCostPerCall: 0,
  totalCalls: 0,
});

const budget = reactive({
  dailyLimit: 1.0,
  weeklyLimit: 5.0,
  monthlyLimit: 20.0,
  dailySpend: 0,
  weeklySpend: 0,
  monthlySpend: 0,
});

const budgetForm = reactive({
  dailyLimit: 1.0,
  weeklyLimit: 5.0,
  monthlyLimit: 20.0,
  warningThreshold: 0.8,
  desktopAlerts: true,
});

const topModels = ref([]);

// ECharts 实例
const timeSeriesChart = ref(null);
const providerPieChart = ref(null);
let timeSeriesInstance = null;
let providerPieInstance = null;

// 日期预设
const datePresets = [
  { label: "今天", value: [dayjs(), dayjs()] },
  { label: "最近7天", value: [dayjs().subtract(7, "day"), dayjs()] },
  { label: "最近30天", value: [dayjs().subtract(30, "day"), dayjs()] },
  { label: "本月", value: [dayjs().startOf("month"), dayjs()] },
];

// 表格列定义
const modelColumns = [
  { title: "排名", dataIndex: "rank", key: "rank", width: 60 },
  { title: "提供商", dataIndex: "provider", key: "provider", width: 100 },
  { title: "模型", dataIndex: "model", key: "model", ellipsis: true },
  { title: "Token 数", dataIndex: "tokens", key: "tokens", width: 100 },
  { title: "调用次数", dataIndex: "calls", key: "calls", width: 80 },
  { title: "成本", dataIndex: "cost", key: "cost", width: 100 },
];

// 计算属性
const budgetProgress = computed(() => ({
  daily:
    budget.dailyLimit > 0
      ? Math.min((budget.dailySpend / budget.dailyLimit) * 100, 100)
      : 0,
  weekly:
    budget.weeklyLimit > 0
      ? Math.min((budget.weeklySpend / budget.weeklyLimit) * 100, 100)
      : 0,
  monthly:
    budget.monthlyLimit > 0
      ? Math.min((budget.monthlySpend / budget.monthlyLimit) * 100, 100)
      : 0,
}));

// 方法
function getBudgetStatus(percent) {
  if (percent >= 95) {
    return "exception";
  }
  if (percent >= 80) {
    return "normal";
  }
  return "active";
}

function getBudgetColor(percent) {
  if (percent >= 95) {
    return "#ff4d4f";
  }
  if (percent >= 80) {
    return "#faad14";
  }
  return "#52c41a";
}

async function loadData() {
  loading.value = true;
  try {
    const startDate = dateRange.value[0].valueOf();
    const endDate = dateRange.value[1].valueOf();

    // 获取使用统计
    const usageStats = await window.electronAPI.llm.getUsageStats({
      startDate,
      endDate,
      provider:
        selectedProvider.value === "all" ? undefined : selectedProvider.value,
    });

    // 更新统计数据
    Object.assign(stats, {
      totalTokens: usageStats.totalTokens || 0,
      totalCost: usageStats.totalCost || 0,
      weekTokens: usageStats.weekTokens || 0,
      weekCost: usageStats.weekCost || 0,
      cacheHitRate: usageStats.cacheHitRate || 0,
      cachedTokens: usageStats.cachedTokens || 0,
      avgCostPerCall: usageStats.avgCostPerCall || 0,
      totalCalls: usageStats.totalCalls || 0,
    });

    // 获取时间序列数据
    const timeSeriesData = await window.electronAPI.llm.getTimeSeries({
      startDate,
      endDate,
      interval: "day",
    });

    renderTimeSeriesChart(timeSeriesData);

    // 获取成本分解
    const costBreakdown = await window.electronAPI.llm.getCostBreakdown({
      startDate,
      endDate,
    });

    renderProviderPieChart(costBreakdown.byProvider || []);
    topModels.value = (costBreakdown.byModel || [])
      .slice(0, 10)
      .map((item, index) => ({
        rank: index + 1,
        ...item,
      }));

    // 获取预算
    const budgetData = await window.electronAPI.llm.getBudget();
    if (budgetData) {
      Object.assign(budget, {
        dailyLimit: budgetData.dailyLimit ?? 1.0,
        weeklyLimit: budgetData.weeklyLimit ?? 5.0,
        monthlyLimit: budgetData.monthlyLimit ?? 20.0,
        dailySpend: budgetData.dailySpend ?? 0,
        weeklySpend: budgetData.weeklySpend ?? 0,
        monthlySpend: budgetData.monthlySpend ?? 0,
      });
      Object.assign(budgetForm, {
        dailyLimit: budgetData.dailyLimit ?? 1.0,
        weeklyLimit: budgetData.weeklyLimit ?? 5.0,
        monthlyLimit: budgetData.monthlyLimit ?? 20.0,
        warningThreshold: budgetData.warningThreshold ?? 0.8,
        desktopAlerts: budgetData.desktopAlerts !== false,
      });
    }
  } catch (error) {
    logger.error("加载统计数据失败:", error);
    message.error("加载统计数据失败: " + error.message);
  } finally {
    loading.value = false;
  }
}

function renderTimeSeriesChart(data) {
  if (!timeSeriesInstance) {
    return;
  }

  const dates = data.map((item) => dayjs(item.date).format("MM-DD"));
  const tokens = data.map((item) => item.tokens);
  const costs = data.map((item) => item.cost);

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    legend: {
      data: ["Token 数", "成本 (USD)"],
    },
    xAxis: {
      type: "category",
      data: dates,
    },
    yAxis: [
      {
        type: "value",
        name: "Tokens",
        position: "left",
      },
      {
        type: "value",
        name: "成本 ($)",
        position: "right",
        axisLabel: {
          formatter: "${value}",
        },
      },
    ],
    series: [
      {
        name: "Token 数",
        type: "bar",
        data: tokens,
        itemStyle: { color: "#1890ff" },
      },
      {
        name: "成本 (USD)",
        type: "line",
        yAxisIndex: 1,
        data: costs,
        itemStyle: { color: "#52c41a" },
      },
    ],
  };

  timeSeriesInstance.setOption(option);
}

function renderProviderPieChart(data) {
  if (!providerPieInstance) {
    return;
  }

  const pieData = data.map((item) => ({
    name: item.provider,
    value: item.cost,
  }));

  const option = {
    tooltip: {
      trigger: "item",
      formatter: "{b}: ${c} ({d}%)",
    },
    legend: {
      orient: "vertical",
      left: "left",
    },
    series: [
      {
        name: "提供商成本",
        type: "pie",
        radius: "50%",
        data: pieData,
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

  providerPieInstance.setOption(option);
}

function onDateRangeChange() {
  loadData();
}

async function exportReport() {
  try {
    const startDate = dateRange.value[0].valueOf();
    const endDate = dateRange.value[1].valueOf();

    const result = await window.electronAPI.llm.exportCostReport({
      startDate,
      endDate,
      format: "csv",
    });

    message.success(`报告已导出: ${result.filePath}`);
  } catch (error) {
    logger.error("导出报告失败:", error);
    message.error("导出报告失败: " + error.message);
  }
}

async function clearCache() {
  try {
    const result = await window.electronAPI.llm.clearCache();
    message.success(`已清除 ${result.deletedCount} 条缓存`);
    await loadData();
  } catch (error) {
    logger.error("清除缓存失败:", error);
    message.error("清除缓存失败: " + error.message);
  }
}

async function saveBudget() {
  try {
    await window.electronAPI.llm.setBudget("default", budgetForm);
    message.success("预算设置已保存");
    showBudgetModal.value = false;
    await loadData();
  } catch (error) {
    logger.error("保存预算失败:", error);
    message.error("保存预算失败: " + error.message);
  }
}

// 生命周期
onMounted(() => {
  // 初始化 ECharts
  timeSeriesInstance = init(timeSeriesChart.value);
  providerPieInstance = init(providerPieChart.value);

  // 加载数据
  loadData();

  // 监听窗口大小变化
  window.addEventListener("resize", () => {
    timeSeriesInstance?.resize();
    providerPieInstance?.resize();
  });
});

onUnmounted(() => {
  timeSeriesInstance?.dispose();
  providerPieInstance?.dispose();
});
</script>

<style scoped>
.token-usage-tab {
  padding: 16px;
}

.stats-overview {
  margin-bottom: 16px;
}

.stat-detail {
  margin-top: 8px;
  font-size: 12px;
  color: #999;
}

.filter-toolbar {
  margin-bottom: 16px;
}

.chart-card {
  margin-bottom: 16px;
}

.budget-card {
  margin-bottom: 16px;
}

.budget-item {
  text-align: center;
}

.budget-title {
  font-weight: bold;
  margin-bottom: 8px;
}

.budget-detail {
  margin-top: 8px;
  font-size: 12px;
  color: #666;
}
</style>
