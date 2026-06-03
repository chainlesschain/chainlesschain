<template>
  <a-card
    title="Skill Usage Distribution"
    class="skill-usage-chart"
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
        description="No skill usage data yet"
      >
        <template #description>
          <div class="empty-description">
            <p>No skill execution data available for this period</p>
            <p class="empty-hint">
              Execute skills via /skill commands to see usage data
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

// Color palette for the donut chart
const COLORS = [
  '#1890ff',
  '#52c41a',
  '#faad14',
  '#ff4d4f',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
  '#fa8c16',
  '#2f54eb',
  '#a0d911',
];

const renderChart = () => {
  if (!chartRef.value || props.data.length === 0) {return;}

  if (!chartInstance) {
    chartInstance = init(chartRef.value);
  }

  const chartData = props.data.map((item, index) => ({
    name: item.name || `Skill ${index + 1}`,
    value: item.count || item.calls || item.totalExecutions || 0,
    itemStyle: { color: COLORS[index % COLORS.length] },
  }));

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        return `
          <div style="font-weight: 600; margin-bottom: 4px">${params.name}</div>
          <div>${params.marker} Executions: ${params.value} (${params.percent}%)</div>
        `;
      },
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: '5%',
      top: 'middle',
      textStyle: {
        fontSize: 12,
      },
      pageIconSize: 12,
      formatter: (name) => {
        // Truncate long skill names for the legend
        return name.length > 18 ? name.substring(0, 16) + '...' : name;
      },
    },
    series: [
      {
        name: 'Skill Usage',
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['35%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: false,
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold',
          },
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.2)',
          },
        },
        data: chartData,
      },
    ],
    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicOut',
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

// ResizeObserver for more accurate resize detection
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
  if (resizeTimer) {clearTimeout(resizeTimer);}

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  chartInstance?.dispose();
  chartInstance = null;
});
</script>

<style lang="less" scoped>
.skill-usage-chart {
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
  .skill-usage-chart .chart-container {
    height: 320px;
  }
}

@media (max-width: 767px) {
  .skill-usage-chart .chart-container {
    height: 280px;
  }
}
</style>
