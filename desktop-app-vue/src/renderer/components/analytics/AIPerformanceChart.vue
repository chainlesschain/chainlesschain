<template>
  <a-card
    title="AI Token Usage Trend"
    class="ai-performance-chart"
  >
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
        description="No AI usage data yet"
      >
        <template #description>
          <div class="empty-description">
            <p>No AI performance data available for this period</p>
            <p class="empty-hint">
              Data will appear after AI chat interactions are recorded
            </p>
          </div>
        </template>
      </a-empty>
    </div>
  </a-card>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Empty } from 'ant-design-vue';
import { init } from '../../utils/echartsConfig';

const props = defineProps({
  data: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const chartRef = ref(null);
let chartInstance = null;

const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return String(num);
};

const renderChart = () => {
  if (!chartRef.value || props.data.length === 0) return;

  if (!chartInstance) {
    chartInstance = init(chartRef.value);
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params) => {
        if (!params || params.length === 0) return '';
        const point = params[0];
        return `
          <div style="font-weight: 600; margin-bottom: 4px">${point.axisValue}</div>
          <div>${point.marker} Tokens: ${formatNumber(point.value)}</div>
        `;
      },
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
      boundaryGap: false,
      data: props.data.map((d) => d.timestamp),
      axisLabel: {
        fontSize: 11,
        rotate: props.data.length > 12 ? 30 : 0,
      },
    },
    yAxis: {
      type: 'value',
      name: 'Tokens',
      axisLabel: {
        formatter: (value) => formatNumber(value),
      },
    },
    series: [
      {
        name: 'Tokens',
        type: 'line',
        data: props.data.map((d) => d.value),
        smooth: true,
        showSymbol: props.data.length <= 30,
        symbolSize: 6,
        itemStyle: { color: '#1890ff' },
        lineStyle: { width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(24, 144, 255, 0.35)' },
              { offset: 1, color: 'rgba(24, 144, 255, 0.05)' },
            ],
          },
        },
      },
    ],
    animation: true,
    animationDuration: 500,
    animationEasing: 'cubicOut',
  };

  chartInstance.setOption(option, true);
};

// Debounced resize handler
let resizeTimer = null;
const handleResize = () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    chartInstance?.resize();
  }, 200);
};

// Use ResizeObserver for responsive resizing
let resizeObserver = null;

watch(
  () => props.data,
  async () => {
    await nextTick();
    renderChart();
  },
  { deep: true },
);

onMounted(() => {
  window.addEventListener('resize', handleResize);

  // Set up ResizeObserver for more granular resize detection
  if (chartRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(chartRef.value);
  }

  nextTick(() => {
    renderChart();
  });
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  if (resizeTimer) clearTimeout(resizeTimer);

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  chartInstance?.dispose();
  chartInstance = null;
});
</script>

<style lang="less" scoped>
.ai-performance-chart {
  margin-bottom: 16px;

  .chart-container {
    width: 100%;
    height: 380px;
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

@media (max-width: 1199px) {
  .ai-performance-chart .chart-container {
    height: 320px;
  }
}

@media (max-width: 767px) {
  .ai-performance-chart .chart-container {
    height: 260px;
  }
}
</style>
