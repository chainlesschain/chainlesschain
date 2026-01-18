<template>
  <div class="llm-performance-page">
    <div class="page-header">
      <h1>
        <BarChartOutlined />
        LLM 性能仪表板
      </h1>
      <p class="page-description">实时监控 Token 使用、成本分析和性能优化</p>
    </div>

    <!-- Budget Alert Banner -->
    <LLMBudgetAlertBanner
      :visible="showBudgetAlert"
      :budget-percent="maxBudgetPercent"
      :warning-threshold="budget.warningThreshold"
      :critical-threshold="budget.criticalThreshold"
      @dismiss="alertDismissed = true"
      @settings="goToBudgetSettings"
    />

    <!-- Welcome Card for First-time Users -->
    <LLMWelcomeCard
      :visible="showWelcomeCard"
      :generating-data="generatingTestData"
      :data-progress="testDataProgress"
      @dismiss="welcomeDismissed = true"
      @generate-data="generateTestData"
      @go-to-chat="goToChat"
    />

    <div class="page-content">
      <!-- Stats Overview -->
      <LLMStatsOverview
        :stats="stats"
        :loading="initialLoading"
        :period-comparison="periodComparison"
      />

      <!-- Recommendations -->
      <LLMRecommendations
        :recommendations="costRecommendations"
        :loading="loading"
      />

      <!-- Trend Prediction -->
      <LLMTrendPrediction
        :prediction="trendPrediction"
        :monthly-limit="budget.monthlyLimit"
        :time-range="timeRange"
      />

      <!-- Cache & Budget Details Row -->
      <a-row :gutter="[16, 16]" class="cache-budget-row">
        <a-col :xs="24" :sm="24" :md="12" :lg="12">
          <LLMCachePanel
            :stats="cacheStats"
            :loading="loading"
            :clearing="clearingCache"
            @clear-cache="clearExpiredCache"
          />
        </a-col>
        <a-col :xs="24" :sm="24" :md="12" :lg="12">
          <LLMBudgetPanel :budget="budget" :loading="loading" />
        </a-col>
      </a-row>

      <!-- Control Panel -->
      <LLMControlPanel
        :time-range="timeRange"
        :custom-date-range="customDateRange"
        :auto-refresh-enabled="autoRefreshEnabled"
        :auto-refresh-interval="autoRefreshInterval"
        :loading="loading"
        :exporting="exporting"
        :show-export-options="true"
        :generating-test-data="generatingTestData"
        @time-change="handleTimeRangeChange"
        @custom-date-change="handleCustomDateChange"
        @toggle-auto-refresh="toggleAutoRefresh"
        @interval-change="updateRefreshInterval"
        @refresh="refreshData"
        @export="openExportModal"
        @export-csv="() => exportData('csv')"
        @export-excel="() => exportData('excel')"
        @export-json="() => exportData('json')"
        @generate-test-data="generateTestData"
      />

      <!-- Token Trend Chart -->
      <LLMTokenTrendChart
        :data="timeSeriesData"
        :interval="trendInterval"
        :loading="loading"
        @interval-change="handleIntervalChange"
      />

      <!-- Distribution Charts -->
      <LLMDistributionCharts
        :token-distribution="tokenDistributionData"
        :period-data="periodComparisonData"
        :comparison-period="comparisonPeriod"
        :cost-by-provider="costBreakdown.byProvider"
        :cost-by-model="costBreakdown.byModel"
        :loading="loading"
        @comparison-change="handleComparisonPeriodChange"
      />

      <!-- Alert History -->
      <LLMAlertHistory
        :alerts="alertHistory"
        :loading="loadingAlertHistory"
        @dismiss-alert="dismissAlertFromHistory"
        @clear-history="clearAlertHistory"
      />

      <!-- Detailed Table -->
      <LLMDetailedTable
        :provider-data="costBreakdown.byProvider"
        :model-data="costBreakdown.byModel"
        :loading="loading"
      />
    </div>

    <!-- Export Modal -->
    <LLMExportModal
      :open="showExportModal"
      :current-date-range="getDateRange()"
      @close="showExportModal = false"
      @export="handleExport"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import { useRouter } from "vue-router";
import { BarChartOutlined } from "@ant-design/icons-vue";

// Import all sub-components
import {
  LLMBudgetAlertBanner,
  LLMWelcomeCard,
  LLMStatsOverview,
  LLMCachePanel,
  LLMBudgetPanel,
  LLMRecommendations,
  LLMTrendPrediction,
  LLMControlPanel,
  LLMTokenTrendChart,
  LLMDistributionCharts,
  LLMDetailedTable,
  LLMAlertHistory,
  LLMExportModal,
} from "@/components/llm-performance";

const router = useRouter();

// ============== State ==============

// Main stats
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

// Time series data
const timeSeriesData = ref([]);

// Cost breakdown
const costBreakdown = ref({
  byProvider: [],
  byModel: [],
});

// Cache stats
const cacheStats = ref({
  totalEntries: 0,
  expiredEntries: 0,
  totalHits: 0,
  totalTokensSaved: 0,
  totalCostSaved: 0,
  avgHitsPerEntry: 0,
  hitRate: 0,
});

// Budget
const budget = ref({
  dailyLimit: 0,
  weeklyLimit: 0,
  monthlyLimit: 0,
  dailySpend: 0,
  weeklySpend: 0,
  monthlySpend: 0,
  warningThreshold: 80,
  criticalThreshold: 95,
});

// Loading states
const loading = ref(false);
const initialLoading = ref(true);
const exporting = ref(false);
const clearingCache = ref(false);
const generatingTestData = ref(false);
const testDataProgress = ref(0);
const loadingAlertHistory = ref(false);

// Time controls
const timeRange = ref("7d");
const customDateRange = ref(null);
const trendInterval = ref("day");

// Auto refresh
const autoRefreshEnabled = ref(true);
const autoRefreshInterval = ref(60);
let refreshIntervalId = null;

// UI states
const welcomeDismissed = ref(false);
const alertDismissed = ref(false);
const showExportModal = ref(false);

// Analysis data
const costRecommendations = ref([]);
const trendPrediction = ref({
  enabled: false,
  monthlyPredicted: 0,
  dailyAverage: 0,
  daysUntilBudget: 0,
});

// Period comparison
const comparisonPeriod = ref("week");
const periodComparison = ref({
  callsChange: 0,
  tokensChange: 0,
  costChange: 0,
});
const periodComparisonData = ref({
  current: [],
  previous: [],
  labels: [],
});

// Token distribution
const tokenDistributionData = ref([]);

// Alert history (new feature)
const alertHistory = ref([]);

// ============== Computed ==============

const dailyBudgetPercent = computed(() => {
  if (budget.value.dailyLimit <= 0) return 0;
  return Math.min(
    100,
    (budget.value.dailySpend / budget.value.dailyLimit) * 100,
  );
});

const weeklyBudgetPercent = computed(() => {
  if (budget.value.weeklyLimit <= 0) return 0;
  return Math.min(
    100,
    (budget.value.weeklySpend / budget.value.weeklyLimit) * 100,
  );
});

const monthlyBudgetPercent = computed(() => {
  if (budget.value.monthlyLimit <= 0) return 0;
  return Math.min(
    100,
    (budget.value.monthlySpend / budget.value.monthlyLimit) * 100,
  );
});

const maxBudgetPercent = computed(() => {
  return Math.max(
    dailyBudgetPercent.value,
    weeklyBudgetPercent.value,
    monthlyBudgetPercent.value,
  );
});

const showBudgetAlert = computed(() => {
  if (alertDismissed.value) return false;
  return maxBudgetPercent.value >= budget.value.warningThreshold;
});

const isFirstTimeUser = computed(() => {
  return (
    !initialLoading.value &&
    stats.value.totalCalls === 0 &&
    stats.value.totalTokens === 0
  );
});

const showWelcomeCard = computed(() => {
  return isFirstTimeUser.value && !welcomeDismissed.value;
});

// ============== Methods ==============

const goToBudgetSettings = () => {
  router.push({ name: "Settings", query: { tab: "llm" } });
};

const goToChat = () => {
  router.push({ name: "Chat" });
};

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

const generateTestData = async () => {
  generatingTestData.value = true;
  testDataProgress.value = 0;

  try {
    const progressInterval = setInterval(() => {
      if (testDataProgress.value < 90) {
        testDataProgress.value += 10;
      }
    }, 200);

    const result = await window.electronAPI.invoke("llm:generate-test-data", {
      days: 14,
      recordsPerDay: 30,
      clear: false,
    });

    clearInterval(progressInterval);
    testDataProgress.value = 100;

    if (result && result.success) {
      message.success(`已生成 ${result.totalRecords || "示例"} 条测试数据`);
      welcomeDismissed.value = true;
      await refreshData();
    } else {
      throw new Error(result?.error || "生成失败");
    }
  } catch (error) {
    console.error("生成测试数据失败:", error);
    message.error("生成测试数据失败: " + error.message);
  } finally {
    generatingTestData.value = false;
    testDataProgress.value = 0;
  }
};

const refreshData = async () => {
  loading.value = true;
  try {
    const dateRange = getDateRange();

    // Fetch all data in parallel
    const [
      statsResult,
      timeSeriesResult,
      breakdownResult,
      cacheResult,
      budgetResult,
      alertHistoryResult,
    ] = await Promise.all([
      window.electronAPI.invoke("llm:get-usage-stats", dateRange),
      window.electronAPI.invoke("llm:get-time-series", {
        ...dateRange,
        interval: trendInterval.value,
      }),
      window.electronAPI.invoke("llm:get-cost-breakdown", dateRange),
      window.electronAPI.invoke("llm:get-cache-stats").catch(() => null),
      window.electronAPI.invoke("llm:get-budget").catch(() => null),
      window.electronAPI.invoke("llm:get-alert-history").catch(() => []),
    ]);

    if (statsResult) stats.value = statsResult;
    if (timeSeriesResult) timeSeriesData.value = timeSeriesResult;
    if (breakdownResult) costBreakdown.value = breakdownResult;
    if (cacheResult) cacheStats.value = cacheResult;
    if (budgetResult) budget.value = budgetResult;
    if (alertHistoryResult) alertHistory.value = alertHistoryResult;

    // Calculate derived data
    generateCostRecommendations();
    calculateTrendPrediction();
    calculateTokenDistribution();
    calculatePeriodComparison();

    message.success("数据已刷新");
  } catch (error) {
    console.error("刷新数据失败:", error);
    message.error("刷新数据失败: " + error.message);
  } finally {
    loading.value = false;
    initialLoading.value = false;
  }
};

const generateCostRecommendations = () => {
  const recommendations = [];

  if (stats.value.cacheHitRate < 30) {
    recommendations.push({
      type: "cache",
      priority: "high",
      title: "启用响应缓存",
      description:
        "当前缓存命中率较低，建议检查缓存配置并增加缓存策略覆盖范围。",
      savingsPercent: 20,
    });
  }

  if (costBreakdown.value.byModel.length > 0) {
    const expensiveModels = costBreakdown.value.byModel.filter(
      (m) => m.model.includes("gpt-4") || m.model.includes("claude-3-opus"),
    );
    if (
      expensiveModels.length > 0 &&
      expensiveModels.some((m) => m.cost_usd > 0.1)
    ) {
      recommendations.push({
        type: "model",
        priority: "medium",
        title: "考虑使用更经济的模型",
        description:
          "对于简单任务，可以使用 GPT-3.5-turbo 或 Claude-3-Haiku 替代高成本模型。",
        savingsPercent: 50,
      });
    }
  }

  if (stats.value.totalCalls > 0) {
    const compressionRate =
      stats.value.compressedCalls / stats.value.totalCalls;
    if (compressionRate < 0.5) {
      recommendations.push({
        type: "compression",
        priority: "low",
        title: "增加 Prompt 压缩",
        description:
          "当前压缩调用比例较低，启用 PromptCompressor 可以减少约 30-40% Token 消耗。",
        savingsPercent: 35,
      });
    }
  }

  const ollamaUsage = costBreakdown.value.byProvider.find(
    (p) => p.provider === "ollama",
  );
  const totalCost = stats.value.totalCostUsd;
  if (
    totalCost > 1 &&
    (!ollamaUsage || ollamaUsage.cost_usd / totalCost < 0.2)
  ) {
    recommendations.push({
      type: "model",
      priority: "medium",
      title: "使用本地 Ollama 模型",
      description:
        "对于不需要最新知识的任务，使用本地 Ollama 模型可以实现零成本运行。",
      savingsPercent: 80,
    });
  }

  costRecommendations.value = recommendations;
};

const calculateTrendPrediction = () => {
  if (timeSeriesData.value.length < 3) {
    trendPrediction.value.enabled = false;
    return;
  }

  const costs = timeSeriesData.value.map((d) => d.costUsd || 0);
  const dailyAvg = costs.reduce((a, b) => a + b, 0) / costs.length;

  const today = new Date();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const monthlyPredicted = dailyAvg * daysInMonth;

  let daysUntilBudget = 0;
  if (budget.value.monthlyLimit > 0 && dailyAvg > 0) {
    const remainingBudget =
      budget.value.monthlyLimit - budget.value.monthlySpend;
    daysUntilBudget = Math.floor(remainingBudget / dailyAvg);
    if (daysUntilBudget < 0) daysUntilBudget = 0;
  }

  trendPrediction.value = {
    enabled: true,
    monthlyPredicted,
    dailyAverage: dailyAvg,
    daysUntilBudget,
  };
};

const calculateTokenDistribution = () => {
  if (stats.value.totalInputTokens > 0 || stats.value.totalOutputTokens > 0) {
    tokenDistributionData.value = [
      { name: "输入 Tokens", value: stats.value.totalInputTokens || 0 },
      { name: "输出 Tokens", value: stats.value.totalOutputTokens || 0 },
    ];
  }
};

const calculatePeriodComparison = async () => {
  try {
    const now = Date.now();
    let currentStart, currentEnd, previousStart, previousEnd;

    if (comparisonPeriod.value === "week") {
      const dayOfWeek = new Date().getDay();
      const weekStart = now - dayOfWeek * 24 * 60 * 60 * 1000;
      currentStart = weekStart;
      currentEnd = now;
      previousStart = weekStart - 7 * 24 * 60 * 60 * 1000;
      previousEnd = weekStart;
    } else {
      const today = new Date();
      const monthStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        1,
      ).getTime();
      currentStart = monthStart;
      currentEnd = now;
      const prevMonthStart = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1,
      ).getTime();
      previousStart = prevMonthStart;
      previousEnd = monthStart;
    }

    const [currentStats, previousStats, currentSeries, previousSeries] =
      await Promise.all([
        window.electronAPI.invoke("llm:get-usage-stats", {
          startDate: currentStart,
          endDate: currentEnd,
        }),
        window.electronAPI.invoke("llm:get-usage-stats", {
          startDate: previousStart,
          endDate: previousEnd,
        }),
        window.electronAPI.invoke("llm:get-time-series", {
          startDate: currentStart,
          endDate: currentEnd,
          interval: "day",
        }),
        window.electronAPI.invoke("llm:get-time-series", {
          startDate: previousStart,
          endDate: previousEnd,
          interval: "day",
        }),
      ]);

    if (previousStats && currentStats) {
      periodComparison.value = {
        callsChange:
          previousStats.totalCalls > 0
            ? ((currentStats.totalCalls - previousStats.totalCalls) /
                previousStats.totalCalls) *
              100
            : 0,
        tokensChange:
          previousStats.totalTokens > 0
            ? ((currentStats.totalTokens - previousStats.totalTokens) /
                previousStats.totalTokens) *
              100
            : 0,
        costChange:
          previousStats.totalCostUsd > 0
            ? ((currentStats.totalCostUsd - previousStats.totalCostUsd) /
                previousStats.totalCostUsd) *
              100
            : 0,
      };
    }

    if (currentSeries && previousSeries) {
      periodComparisonData.value = {
        current: currentSeries.map((d) => d.costUsd || 0),
        previous: previousSeries.map((d) => d.costUsd || 0),
        labels: currentSeries.map((_, i) => `Day ${i + 1}`),
      };
    }
  } catch (error) {
    console.warn("计算周期对比失败:", error);
  }
};

const clearExpiredCache = async () => {
  clearingCache.value = true;
  try {
    const result = await window.electronAPI.invoke("llm:clear-cache", {
      expiredOnly: true,
    });
    if (result && result.success) {
      message.success(`已清理 ${result.clearedCount || 0} 条过期缓存`);
      const cacheResult = await window.electronAPI.invoke(
        "llm:get-cache-stats",
      );
      if (cacheResult) cacheStats.value = cacheResult;
    } else {
      message.warning("没有需要清理的过期缓存");
    }
  } catch (error) {
    console.error("清理缓存失败:", error);
    message.error("清理缓存失败: " + error.message);
  } finally {
    clearingCache.value = false;
  }
};

const handleTimeRangeChange = (value) => {
  timeRange.value = value;
  refreshData();
};

const handleCustomDateChange = (dates) => {
  customDateRange.value = dates;
  if (dates && dates.length === 2) {
    refreshData();
  }
};

const handleIntervalChange = (value) => {
  trendInterval.value = value;
  refreshData();
};

const handleComparisonPeriodChange = (value) => {
  comparisonPeriod.value = value;
  calculatePeriodComparison();
};

const openExportModal = () => {
  showExportModal.value = true;
};

const exportData = async (format = "csv") => {
  exporting.value = true;
  try {
    const dateRange = getDateRange();
    const result = await window.electronAPI.invoke("llm:export-cost-report", {
      ...dateRange,
      format,
    });
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

const handleExport = async (config) => {
  exporting.value = true;
  try {
    const result = await window.electronAPI.invoke("llm:export-cost-report", {
      ...config.dateRange,
      format: config.format,
      sections: config.sections,
      options: config.options,
    });
    if (result.success) {
      message.success("报告已导出: " + result.filePath);
      showExportModal.value = false;
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

const dismissAlertFromHistory = async (alertId) => {
  try {
    await window.electronAPI.invoke("llm:dismiss-alert", alertId);
    alertHistory.value = alertHistory.value.map((a) =>
      a.id === alertId ? { ...a, dismissed: true } : a,
    );
  } catch (error) {
    console.error("忽略告警失败:", error);
  }
};

const clearAlertHistory = async () => {
  try {
    await window.electronAPI.invoke("llm:clear-alert-history");
    alertHistory.value = [];
    message.success("告警历史已清除");
  } catch (error) {
    console.error("清除告警历史失败:", error);
  }
};

const startAutoRefresh = () => {
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  if (autoRefreshEnabled.value) {
    refreshIntervalId = setInterval(() => {
      refreshData();
    }, autoRefreshInterval.value * 1000);
  }
};

const stopAutoRefresh = () => {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
};

const toggleAutoRefresh = (enabled) => {
  autoRefreshEnabled.value = enabled;
  if (enabled) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
};

const updateRefreshInterval = (seconds) => {
  autoRefreshInterval.value = seconds;
  if (autoRefreshEnabled.value) {
    startAutoRefresh();
  }
};

// ============== Lifecycle ==============

onMounted(() => {
  refreshData();
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
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
    .cache-budget-row {
      margin-bottom: 16px;
    }
  }
}

// Mobile responsiveness
@media (max-width: 768px) {
  .llm-performance-page {
    padding: 12px;

    .page-header h1 {
      font-size: 22px;
    }
  }
}

:deep(.ant-card) {
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}
</style>
