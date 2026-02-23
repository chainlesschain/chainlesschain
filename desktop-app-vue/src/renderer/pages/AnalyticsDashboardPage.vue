<template>
  <div class="analytics-dashboard-page">
    <!-- Page Header -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <DashboardOutlined />
          Advanced Analytics Dashboard
        </h1>
        <p class="page-description">
          Unified view of AI usage, skill performance, errors, and system health
        </p>
      </div>
      <div class="header-right">
        <a-select
          v-model:value="store.selectedPeriod"
          style="width: 120px; margin-right: 12px"
          @change="handlePeriodChange"
        >
          <a-select-option value="1h">Last 1h</a-select-option>
          <a-select-option value="6h">Last 6h</a-select-option>
          <a-select-option value="24h">Last 24h</a-select-option>
          <a-select-option value="7d">Last 7d</a-select-option>
          <a-select-option value="30d">Last 30d</a-select-option>
        </a-select>

        <a-switch
          v-model:checked="store.autoRefresh"
          checked-children="Auto"
          un-checked-children="Manual"
          style="margin-right: 12px"
          @change="handleAutoRefreshToggle"
        />

        <a-button
          style="margin-right: 8px"
          @click="handleExportCSV"
        >
          <DownloadOutlined />
          CSV
        </a-button>
        <a-button @click="handleExportJSON">
          <DownloadOutlined />
          JSON
        </a-button>
        <a-button
          type="primary"
          style="margin-left: 8px"
          :loading="store.loading"
          @click="handleRefresh"
        >
          <ReloadOutlined />
          Refresh
        </a-button>
      </div>
    </div>

    <!-- Error Alert -->
    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      closable
      show-icon
      style="margin-bottom: 16px"
      @close="store.clearError()"
    />

    <!-- Row 1: KPI Stat Cards -->
    <a-row
      :gutter="[16, 16]"
      class="kpi-row"
    >
      <a-col
        :xs="12"
        :sm="8"
        :md="4"
      >
        <a-card
          class="kpi-card"
          hoverable
        >
          <a-skeleton
            :loading="store.loading && !store.hasData"
            active
            :paragraph="{ rows: 1 }"
          >
            <a-statistic
              title="AI Calls"
              :value="store.kpis?.totalAICalls || 0"
              :prefix="h(ApiOutlined)"
            />
          </a-skeleton>
        </a-card>
      </a-col>

      <a-col
        :xs="12"
        :sm="8"
        :md="4"
      >
        <a-card
          class="kpi-card"
          hoverable
        >
          <a-skeleton
            :loading="store.loading && !store.hasData"
            active
            :paragraph="{ rows: 1 }"
          >
            <a-statistic
              title="Total Tokens"
              :value="store.kpis?.totalTokens || 0"
              :prefix="h(ThunderboltOutlined)"
              :formatter="formatTokens"
            />
          </a-skeleton>
        </a-card>
      </a-col>

      <a-col
        :xs="12"
        :sm="8"
        :md="4"
      >
        <a-card
          class="kpi-card"
          hoverable
        >
          <a-skeleton
            :loading="store.loading && !store.hasData"
            active
            :paragraph="{ rows: 1 }"
          >
            <a-statistic
              title="Token Cost"
              :value="store.kpis?.tokenCost || 0"
              prefix="$"
              :precision="2"
              :value-style="{ color: (store.kpis?.tokenCost || 0) > 10 ? '#cf1322' : '#3f8600' }"
            />
          </a-skeleton>
        </a-card>
      </a-col>

      <a-col
        :xs="12"
        :sm="8"
        :md="4"
      >
        <a-card
          class="kpi-card"
          hoverable
        >
          <a-skeleton
            :loading="store.loading && !store.hasData"
            active
            :paragraph="{ rows: 1 }"
          >
            <a-statistic
              title="Skill Executions"
              :value="store.kpis?.skillExecutions || 0"
              :prefix="h(RocketOutlined)"
            />
          </a-skeleton>
        </a-card>
      </a-col>

      <a-col
        :xs="12"
        :sm="8"
        :md="4"
      >
        <a-card
          class="kpi-card"
          hoverable
        >
          <a-skeleton
            :loading="store.loading && !store.hasData"
            active
            :paragraph="{ rows: 1 }"
          >
            <a-statistic
              title="Errors"
              :value="store.kpis?.errorCount || 0"
              :prefix="h(WarningOutlined)"
              :value-style="{ color: (store.kpis?.errorCount || 0) > 0 ? '#cf1322' : '#3f8600' }"
            />
          </a-skeleton>
        </a-card>
      </a-col>

      <a-col
        :xs="12"
        :sm="8"
        :md="4"
      >
        <a-card
          class="kpi-card"
          hoverable
        >
          <a-skeleton
            :loading="store.loading && !store.hasData"
            active
            :paragraph="{ rows: 1 }"
          >
            <a-statistic
              title="Uptime"
              :value="store.formattedUptime"
              :prefix="h(ClockCircleOutlined)"
            />
          </a-skeleton>
        </a-card>
      </a-col>
    </a-row>

    <!-- Row 2: AI Performance Chart + Skill Usage Chart -->
    <a-row
      :gutter="[16, 16]"
      class="chart-row"
    >
      <a-col
        :xs="24"
        :md="14"
      >
        <AIPerformanceChart
          :data="store.aiTimeSeries"
          :loading="store.loading && !store.hasData"
        />
      </a-col>
      <a-col
        :xs="24"
        :md="10"
      >
        <SkillUsageChart
          :data="store.topSkills"
          :loading="store.loading && !store.hasData"
        />
      </a-col>
    </a-row>

    <!-- Row 3: Error Trend + Top Skills Table -->
    <a-row
      :gutter="[16, 16]"
      class="chart-row"
    >
      <a-col
        :xs="24"
        :md="12"
      >
        <a-card title="Error Trend">
          <div
            v-if="store.loading && store.errorTimeSeries.length === 0"
            class="chart-skeleton"
          >
            <a-skeleton
              active
              :paragraph="{ rows: 6 }"
            />
          </div>
          <div
            v-else-if="store.errorTimeSeries.length > 0"
            ref="errorChartRef"
            class="chart-container"
          />
          <a-empty
            v-else
            description="No error trend data"
          />
        </a-card>
      </a-col>
      <a-col
        :xs="24"
        :md="12"
      >
        <TopSkillsTable
          :data="store.topSkills"
          :loading="store.loading && !store.hasData"
        />
      </a-col>
    </a-row>

    <!-- Row 4: Model Cost Comparison -->
    <a-row
      :gutter="[16, 16]"
      class="chart-row"
    >
      <a-col :span="24">
        <a-card title="Model Cost Comparison">
          <div
            v-if="store.loading && store.topModels.length === 0"
            class="chart-skeleton"
          >
            <a-skeleton
              active
              :paragraph="{ rows: 6 }"
            />
          </div>
          <div
            v-else-if="store.topModels.length > 0"
            ref="modelChartRef"
            class="chart-container"
          />
          <a-empty
            v-else
            description="No model cost data"
          />
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted, onUnmounted, watch, nextTick } from 'vue';
import {
  DashboardOutlined,
  DownloadOutlined,
  ReloadOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  WarningOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import { useAnalyticsDashboardStore } from '../stores/analytics-dashboard';
import { init } from '../utils/echartsConfig';
import AIPerformanceChart from '../components/analytics/AIPerformanceChart.vue';
import SkillUsageChart from '../components/analytics/SkillUsageChart.vue';
import TopSkillsTable from '../components/analytics/TopSkillsTable.vue';

const store = useAnalyticsDashboardStore();

// Chart refs
const errorChartRef = ref<HTMLElement | null>(null);
const modelChartRef = ref<HTMLElement | null>(null);
let errorChartInstance: any = null;
let modelChartInstance: any = null;

// Token formatter for display
const formatTokens = (opts: any) => {
  const val = opts.value;
  if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
  return String(val);
};

// ==================== Event Handlers ====================

async function handlePeriodChange(period: string) {
  store.selectedPeriod = period;
  await store.refreshAll();
}

function handleAutoRefreshToggle(checked: boolean) {
  if (checked) {
    store.startRealtimeUpdates();
  } else {
    store.stopRealtimeUpdates();
  }
}

async function handleRefresh() {
  await store.refreshAll();
  message.success('Dashboard refreshed');
}

async function handleExportCSV() {
  const csv = await store.exportCSV();
  if (csv) {
    downloadFile(csv, `analytics-${store.selectedPeriod}.csv`, 'text/csv');
    message.success('CSV exported');
  }
}

async function handleExportJSON() {
  const data = await store.exportJSON();
  if (data) {
    downloadFile(
      JSON.stringify(data, null, 2),
      `analytics-${store.selectedPeriod}.json`,
      'application/json',
    );
    message.success('JSON exported');
  }
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== Error Trend Chart ====================

function renderErrorChart() {
  if (!errorChartRef.value || store.errorTimeSeries.length === 0) return;

  if (!errorChartInstance) {
    errorChartInstance = init(errorChartRef.value);
  }

  errorChartInstance.setOption(
    {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: 20,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: store.errorTimeSeries.map((d) => d.timestamp),
      },
      yAxis: {
        type: 'value',
        name: 'Errors',
      },
      series: [
        {
          name: 'Errors',
          type: 'line',
          data: store.errorTimeSeries.map((d) => d.value),
          smooth: true,
          itemStyle: { color: '#ff4d4f' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(255, 77, 79, 0.4)' },
                { offset: 1, color: 'rgba(255, 77, 79, 0.05)' },
              ],
            },
          },
        },
      ],
      animation: true,
      animationDuration: 500,
    },
    true,
  );
}

// ==================== Model Cost Chart ====================

function renderModelChart() {
  if (!modelChartRef.value || store.topModels.length === 0) return;

  if (!modelChartInstance) {
    modelChartInstance = init(modelChartRef.value);
  }

  const models = store.topModels;

  modelChartInstance.setOption(
    {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: 20,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: models.map((m) => m.name),
        axisLabel: {
          rotate: 30,
          fontSize: 11,
        },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Calls',
          position: 'left',
        },
        {
          type: 'value',
          name: 'Cost ($)',
          position: 'right',
          axisLabel: { formatter: (v: number) => `$${v.toFixed(2)}` },
        },
      ],
      series: [
        {
          name: 'Calls',
          type: 'bar',
          yAxisIndex: 0,
          data: models.map((m) => m.calls || 0),
          itemStyle: { color: '#1890ff' },
        },
        {
          name: 'Cost',
          type: 'bar',
          yAxisIndex: 1,
          data: models.map((m) => m.totalCost || 0),
          itemStyle: { color: '#faad14' },
        },
      ],
      animation: true,
      animationDuration: 500,
    },
    true,
  );
}

// ==================== Resize Handling ====================

let resizeTimer: ReturnType<typeof setTimeout> | null = null;

function handleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    errorChartInstance?.resize();
    modelChartInstance?.resize();
  }, 200);
}

// ==================== Watchers ====================

watch(
  () => store.errorTimeSeries,
  async () => {
    await nextTick();
    renderErrorChart();
  },
  { deep: true },
);

watch(
  () => store.topModels,
  async () => {
    await nextTick();
    renderModelChart();
  },
  { deep: true },
);

// ==================== Lifecycle ====================

onMounted(async () => {
  window.addEventListener('resize', handleResize);

  // Fetch initial data
  await store.refreshAll();

  // Start real-time updates if auto-refresh is enabled
  if (store.autoRefresh) {
    store.startRealtimeUpdates();
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  if (resizeTimer) clearTimeout(resizeTimer);
  store.stopRealtimeUpdates();
  errorChartInstance?.dispose();
  modelChartInstance?.dispose();
});
</script>

<style lang="less" scoped>
.analytics-dashboard-page {
  padding: 24px;
  max-width: 1600px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;

  .header-left {
    h1 {
      margin: 0 0 4px 0;
      font-size: 24px;
      font-weight: 600;
    }

    .page-description {
      color: #8c8c8c;
      margin: 0;
      font-size: 14px;
    }
  }

  .header-right {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
}

.kpi-row {
  margin-bottom: 16px;

  .kpi-card {
    text-align: center;
    transition: box-shadow 0.3s ease;

    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
  }
}

.chart-row {
  margin-bottom: 16px;
}

.chart-container {
  width: 100%;
  height: 350px;
  animation: chartFadeIn 0.4s ease-out;
}

.chart-skeleton {
  padding: 40px 20px;
}

@keyframes chartFadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

// Mobile responsiveness
@media (max-width: 767px) {
  .analytics-dashboard-page {
    padding: 12px;
  }

  .page-header {
    flex-direction: column;
  }

  .chart-container {
    height: 280px;
  }
}
</style>
