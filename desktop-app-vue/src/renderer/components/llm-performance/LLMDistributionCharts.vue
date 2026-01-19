<template>
  <div class="distribution-charts">
    <!-- Token Distribution & Period Comparison Row -->
    <a-row :gutter="[16, 16]">
      <a-col
        :xs="24"
        :sm="24"
        :md="12"
        :lg="12"
      >
        <a-card
          title="Token 类型分布"
          class="chart-card"
        >
          <template #extra>
            <a-tooltip title="显示输入和输出 Token 的比例分布">
              <QuestionCircleOutlined style="color: #8c8c8c" />
            </a-tooltip>
          </template>
          <div
            v-if="loading && !tokenDistribution.length"
            class="chart-skeleton"
          >
            <a-skeleton
              active
              :paragraph="{ rows: 6 }"
            />
          </div>
          <div
            v-else-if="tokenDistribution.length > 0"
            ref="tokenDistributionRef"
            class="chart-container-small"
          />
          <div
            v-else
            class="empty-state-container-small"
          >
            <a-empty :image="Empty.PRESENTED_IMAGE_SIMPLE">
              <template #description>
                <span class="empty-hint">尚无 Token 分布数据</span>
              </template>
            </a-empty>
          </div>
        </a-card>
      </a-col>

      <a-col
        :xs="24"
        :sm="24"
        :md="12"
        :lg="12"
      >
        <a-card
          title="周期对比"
          class="chart-card"
        >
          <template #extra>
            <a-select
              :value="comparisonPeriod"
              size="small"
              style="width: 120px"
              @change="(value) => $emit('comparison-change', value)"
            >
              <a-select-option value="week">
                本周 vs 上周
              </a-select-option>
              <a-select-option value="month">
                本月 vs 上月
              </a-select-option>
            </a-select>
          </template>
          <div
            v-if="loading && !periodData.current.length"
            class="chart-skeleton"
          >
            <a-skeleton
              active
              :paragraph="{ rows: 6 }"
            />
          </div>
          <div
            v-else-if="periodData.current.length > 0"
            ref="periodComparisonRef"
            class="chart-container-small"
          />
          <div
            v-else
            class="empty-state-container-small"
          >
            <a-empty :image="Empty.PRESENTED_IMAGE_SIMPLE">
              <template #description>
                <span class="empty-hint">需要更多数据进行周期对比</span>
              </template>
            </a-empty>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Cost Breakdown Row -->
    <a-row :gutter="[16, 16]">
      <a-col
        :xs="24"
        :sm="24"
        :md="12"
        :lg="12"
      >
        <a-card
          title="按提供商成本分布"
          class="chart-card"
        >
          <div
            v-if="loading && !costByProvider.length"
            class="chart-skeleton"
          >
            <a-skeleton
              active
              :paragraph="{ rows: 6 }"
            />
          </div>
          <div
            v-else-if="costByProvider.length > 0"
            ref="providerCostRef"
            class="chart-container-small"
          />
          <div
            v-else
            class="empty-state-container-small"
          >
            <a-empty :image="Empty.PRESENTED_IMAGE_SIMPLE">
              <template #description>
                <span class="empty-hint">尚无提供商成本数据</span>
              </template>
            </a-empty>
          </div>
        </a-card>
      </a-col>

      <a-col
        :xs="24"
        :sm="24"
        :md="12"
        :lg="12"
      >
        <a-card
          title="按模型成本分布（Top 10）"
          class="chart-card"
        >
          <div
            v-if="loading && !costByModel.length"
            class="chart-skeleton"
          >
            <a-skeleton
              active
              :paragraph="{ rows: 6 }"
            />
          </div>
          <div
            v-else-if="costByModel.length > 0"
            ref="modelCostRef"
            class="chart-container-small"
          />
          <div
            v-else
            class="empty-state-container-small"
          >
            <a-empty :image="Empty.PRESENTED_IMAGE_SIMPLE">
              <template #description>
                <span class="empty-hint">尚无模型成本数据</span>
              </template>
            </a-empty>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { Empty } from "ant-design-vue";
import { QuestionCircleOutlined } from "@ant-design/icons-vue";
import { init } from "../../utils/echartsConfig";

const props = defineProps({
  tokenDistribution: {
    type: Array,
    default: () => [],
  },
  periodData: {
    type: Object,
    default: () => ({
      current: [],
      previous: [],
      labels: [],
    }),
  },
  comparisonPeriod: {
    type: String,
    default: "week",
  },
  costByProvider: {
    type: Array,
    default: () => [],
  },
  costByModel: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["comparison-change"]);

const tokenDistributionRef = ref(null);
const periodComparisonRef = ref(null);
const providerCostRef = ref(null);
const modelCostRef = ref(null);

let tokenDistributionChart = null;
let periodComparisonChart = null;
let providerCostChart = null;
let modelCostChart = null;

const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K";
  }
  return num.toString();
};

const renderTokenDistributionChart = () => {
  if (!tokenDistributionRef.value || props.tokenDistribution.length === 0)
    {return;}

  if (!tokenDistributionChart) {
    tokenDistributionChart = init(tokenDistributionRef.value);
  }

  const total = props.tokenDistribution.reduce((a, b) => a + b.value, 0);

  const option = {
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        const percent = ((params.value / total) * 100).toFixed(1);
        return `${params.name}<br/>${formatNumber(params.value)} (${percent}%)`;
      },
    },
    legend: {
      orient: "horizontal",
      bottom: 10,
    },
    series: [
      {
        name: "Token 分布",
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
          position: "center",
          formatter: () => `${formatNumber(total)}\n总计`,
          fontSize: 16,
          fontWeight: "bold",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 18,
            fontWeight: "bold",
          },
        },
        labelLine: {
          show: false,
        },
        data: props.tokenDistribution.map((item, index) => ({
          ...item,
          itemStyle: {
            color: index === 0 ? "#1890ff" : "#52c41a",
          },
        })),
      },
    ],
    animation: true,
    animationDuration: 500,
  };

  tokenDistributionChart.setOption(option);
};

const renderPeriodComparisonChart = () => {
  if (!periodComparisonRef.value || props.periodData.current.length === 0)
    {return;}

  if (!periodComparisonChart) {
    periodComparisonChart = init(periodComparisonRef.value);
  }

  const periodLabel = props.comparisonPeriod === "week" ? "周" : "月";

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        let result = params[0].axisValue + "<br/>";
        params.forEach((param) => {
          result += `${param.marker} ${param.seriesName}: $${param.value.toFixed(4)}<br/>`;
        });
        return result;
      },
    },
    legend: {
      data: [`本${periodLabel}`, `上${periodLabel}`],
      bottom: 10,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: 50,
      top: 30,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: props.periodData.labels,
    },
    yAxis: {
      type: "value",
      name: "成本 (USD)",
      axisLabel: { formatter: (v) => "$" + v.toFixed(4) },
    },
    series: [
      {
        name: `本${periodLabel}`,
        type: "bar",
        data: props.periodData.current,
        itemStyle: { color: "#1890ff" },
      },
      {
        name: `上${periodLabel}`,
        type: "bar",
        data: props.periodData.previous,
        itemStyle: { color: "#bfbfbf" },
      },
    ],
    animation: true,
    animationDuration: 500,
  };

  periodComparisonChart.setOption(option);
};

const renderProviderCostChart = () => {
  if (!providerCostRef.value || props.costByProvider.length === 0) {return;}

  if (!providerCostChart) {
    providerCostChart = init(providerCostRef.value);
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
        data: props.costByProvider.map((item) => ({
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
    animation: true,
    animationDuration: 500,
  };

  providerCostChart.setOption(option);
};

const renderModelCostChart = () => {
  if (!modelCostRef.value || props.costByModel.length === 0) {return;}

  if (!modelCostChart) {
    modelCostChart = init(modelCostRef.value);
  }

  const topModels = props.costByModel.slice(0, 10);

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
    animation: true,
    animationDuration: 500,
  };

  modelCostChart.setOption(option);
};

const renderAllCharts = () => {
  renderTokenDistributionChart();
  renderPeriodComparisonChart();
  renderProviderCostChart();
  renderModelCostChart();
};

// Debounced resize handler
let resizeTimer = null;
const handleResize = () => {
  if (resizeTimer) {clearTimeout(resizeTimer);}
  resizeTimer = setTimeout(() => {
    tokenDistributionChart?.resize();
    periodComparisonChart?.resize();
    providerCostChart?.resize();
    modelCostChart?.resize();
  }, 200);
};

// Watch for data changes
watch(
  () => props.tokenDistribution,
  async () => {
    await nextTick();
    renderTokenDistributionChart();
  },
  { deep: true },
);

watch(
  () => props.periodData,
  async () => {
    await nextTick();
    renderPeriodComparisonChart();
  },
  { deep: true },
);

watch(
  () => props.costByProvider,
  async () => {
    await nextTick();
    renderProviderCostChart();
  },
  { deep: true },
);

watch(
  () => props.costByModel,
  async () => {
    await nextTick();
    renderModelCostChart();
  },
  { deep: true },
);

onMounted(() => {
  window.addEventListener("resize", handleResize);
  nextTick(() => {
    renderAllCharts();
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  if (resizeTimer) {clearTimeout(resizeTimer);}
  tokenDistributionChart?.dispose();
  periodComparisonChart?.dispose();
  providerCostChart?.dispose();
  modelCostChart?.dispose();
});
</script>

<style lang="less" scoped>
.distribution-charts {
  .chart-card {
    margin-bottom: 16px;

    .chart-container-small {
      width: 100%;
      height: 350px;
      animation: chartFadeIn 0.4s ease-out;
    }

    .chart-skeleton {
      padding: 40px 20px;
    }

    .empty-state-container-small {
      padding: 40px 20px;
      text-align: center;
    }

    .empty-hint {
      color: #bfbfbf;
      font-size: 13px;
    }
  }
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
  .distribution-charts {
    .chart-card .chart-container-small {
      height: 280px;
    }
  }
}
</style>
