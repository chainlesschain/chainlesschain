<template>
  <a-card
    title="Token 使用趋势"
    class="chart-card"
  >
    <div class="chart-header">
      <a-radio-group
        :value="interval"
        size="small"
        @change="(e) => $emit('interval-change', e.target.value)"
      >
        <a-radio-button value="hour">
          按小时
        </a-radio-button>
        <a-radio-button value="day">
          按天
        </a-radio-button>
        <a-radio-button value="week">
          按周
        </a-radio-button>
      </a-radio-group>
    </div>

    <div
      v-if="loading && data.length === 0"
      class="chart-skeleton"
    >
      <a-skeleton
        active
        :paragraph="{ rows: 8 }"
      />
    </div>

    <div
      v-else-if="data.length > 0"
      ref="chartRef"
      class="chart-container"
    />

    <div
      v-else
      class="empty-state-container"
    >
      <a-empty
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        description="暂无趋势数据"
      >
        <template #description>
          <div class="empty-description">
            <p>当前时间范围内没有 LLM 调用记录</p>
            <p class="empty-hint">
              使用 AI 聊天功能后，数据将自动显示
            </p>
          </div>
        </template>
      </a-empty>
    </div>
  </a-card>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { Empty } from "ant-design-vue";
import { init } from "../../utils/echartsConfig";

const props = defineProps({
  data: {
    type: Array,
    default: () => [],
  },
  interval: {
    type: String,
    default: "day",
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["interval-change"]);

const chartRef = ref(null);
let chartInstance = null;

const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K";
  }
  return num.toString();
};

const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  if (props.interval === "hour") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  } else if (props.interval === "day") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  } else {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date - firstDay) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((days + firstDay.getDay() + 1) / 7);
    return `${date.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
  }
};

const renderChart = () => {
  if (!chartRef.value || props.data.length === 0) {return;}

  if (!chartInstance) {
    chartInstance = init(chartRef.value);
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
      data: props.data.map((d) => formatDate(d.timestamp)),
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
        data: props.data.map((d) => d.tokens),
        smooth: true,
        itemStyle: { color: "#1890ff" },
        areaStyle: { opacity: 0.3 },
      },
      {
        name: "调用次数",
        type: "line",
        yAxisIndex: 1,
        data: props.data.map((d) => d.calls),
        smooth: true,
        itemStyle: { color: "#52c41a" },
      },
      {
        name: "成本 (USD)",
        type: "line",
        yAxisIndex: 2,
        data: props.data.map((d) => d.costUsd),
        smooth: true,
        itemStyle: { color: "#faad14" },
      },
    ],
    // Animation
    animation: true,
    animationDuration: 500,
    animationEasing: "cubicOut",
  };

  chartInstance.setOption(option, true);
};

// Debounced resize handler
let resizeTimer = null;
const handleResize = () => {
  if (resizeTimer) {clearTimeout(resizeTimer);}
  resizeTimer = setTimeout(() => {
    chartInstance?.resize();
  }, 200);
};

watch(
  () => props.data,
  async () => {
    await nextTick();
    renderChart();
  },
  { deep: true },
);

watch(
  () => props.interval,
  async () => {
    await nextTick();
    renderChart();
  },
);

onMounted(() => {
  window.addEventListener("resize", handleResize);
  nextTick(() => {
    renderChart();
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  if (resizeTimer) {clearTimeout(resizeTimer);}
  chartInstance?.dispose();
});
</script>

<style lang="less" scoped>
.chart-card {
  margin-bottom: 16px;

  .chart-header {
    margin-bottom: 16px;
    text-align: right;
  }

  .chart-container {
    width: 100%;
    height: 400px;
    animation: chartFadeIn 0.4s ease-out;
  }

  .chart-skeleton {
    padding: 40px 20px;
  }

  .empty-state-container {
    padding: 60px 20px;
    text-align: center;
  }

  .empty-description {
    p {
      margin: 0;
      color: #8c8c8c;
      font-size: 14px;

      &:first-child {
        margin-bottom: 4px;
      }
    }
  }

  .empty-hint {
    color: #bfbfbf;
    font-size: 13px;
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
@media (max-width: 1199px) {
  .chart-card .chart-container {
    height: 350px;
  }
}

@media (max-width: 767px) {
  .chart-card .chart-container {
    height: 300px;
  }
}
</style>
