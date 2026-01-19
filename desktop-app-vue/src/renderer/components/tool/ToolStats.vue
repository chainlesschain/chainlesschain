<template>
  <div class="tool-stats">
    <a-space
      direction="vertical"
      :size="16"
      style="width: 100%"
    >
      <!-- 统计卡片 -->
      <a-row :gutter="16">
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="总工具数"
              :value="stats.totalTools"
              :value-style="{ color: '#3f8600' }"
            >
              <template #prefix>
                <ToolOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="启用工具"
              :value="stats.enabledTools"
              :value-style="{ color: '#1890ff' }"
            >
              <template #prefix>
                <CheckCircleOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="总调用次数"
              :value="stats.totalUsage"
              :value-style="{ color: '#cf1322' }"
            >
              <template #prefix>
                <ThunderboltOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="平均执行时间"
              :value="stats.avgExecutionTime"
              suffix="ms"
              :precision="2"
              :value-style="{ color: '#722ed1' }"
            >
              <template #prefix>
                <ClockCircleOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
      </a-row>

      <!-- 图表区域 -->
      <a-row :gutter="16">
        <!-- 工具类型分布 -->
        <a-col :span="8">
          <a-card
            title="工具类型分布"
            size="small"
          >
            <div
              ref="typeChartRef"
              style="width: 100%; height: 300px"
            />
          </a-card>
        </a-col>

        <!-- 使用次数Top 10 -->
        <a-col :span="16">
          <a-card
            title="使用次数 Top 10"
            size="small"
          >
            <div
              ref="usageChartRef"
              style="width: 100%; height: 300px"
            />
          </a-card>
        </a-col>
      </a-row>

      <!-- 执行时间对比 -->
      <a-row :gutter="16">
        <a-col :span="12">
          <a-card
            title="平均执行时间对比（Top 10）"
            size="small"
          >
            <div
              ref="timeChartRef"
              style="width: 100%; height: 300px"
            />
          </a-card>
        </a-col>

        <!-- 成功率对比 -->
        <a-col :span="12">
          <a-card
            title="成功率对比（Top 10）"
            size="small"
          >
            <div
              ref="successRateChartRef"
              style="width: 100%; height: 300px"
            />
          </a-card>
        </a-col>
      </a-row>
    </a-space>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';
import {
  ToolOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  tools: {
    type: Array,
    default: () => [],
  },
  toolStats: {
    type: Array,
    default: () => [],
  },
});

// 统计数据
const stats = ref({
  totalTools: 0,
  enabledTools: 0,
  totalUsage: 0,
  avgExecutionTime: 0,
});

// 图表引用
const typeChartRef = ref(null);
const usageChartRef = ref(null);
const timeChartRef = ref(null);
const successRateChartRef = ref(null);

let typeChart = null;
let usageChart = null;
let timeChart = null;
let successRateChart = null;

// 计算统计数据
const calculateStats = () => {
  stats.value.totalTools = props.tools.length;
  stats.value.enabledTools = props.tools.filter(t => t.enabled === 1).length;
  stats.value.totalUsage = props.tools.reduce((sum, t) => sum + (t.usage_count || 0), 0);

  // 计算平均执行时间
  const toolsWithTime = props.tools.filter(t => t.avg_execution_time > 0);
  if (toolsWithTime.length > 0) {
    stats.value.avgExecutionTime =
      toolsWithTime.reduce((sum, t) => sum + t.avg_execution_time, 0) / toolsWithTime.length;
  } else {
    stats.value.avgExecutionTime = 0;
  }
};

// 初始化工具类型分布饼图
const initTypeChart = () => {
  if (!typeChartRef.value) {return;}

  typeChart = echarts.init(typeChartRef.value);

  // 统计各类型的工具数量
  const typeCount = {};
  props.tools.forEach(tool => {
    const type = tool.tool_type || 'function';
    typeCount[type] = (typeCount[type] || 0) + 1;
  });

  const data = Object.entries(typeCount).map(([name, value]) => ({
    name: getTypeName(name),
    value,
  }));

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
    },
    legend: {
      orient: 'vertical',
      left: 'left',
    },
    series: [
      {
        type: 'pie',
        radius: '50%',
        data,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };

  typeChart.setOption(option);
};

// 初始化使用次数柱状图
const initUsageChart = () => {
  if (!usageChartRef.value) {return;}

  usageChart = echarts.init(usageChartRef.value);

  const sorted = [...props.tools]
    .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
    .slice(0, 10);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
    },
    yAxis: {
      type: 'category',
      data: sorted.map(t => t.display_name || t.name),
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: '调用次数',
        type: 'bar',
        data: sorted.map(t => t.usage_count || 0),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#667eea' },
            { offset: 1, color: '#764ba2' },
          ]),
        },
      },
    ],
  };

  usageChart.setOption(option);
};

// 初始化执行时间对比图
const initTimeChart = () => {
  if (!timeChartRef.value) {return;}

  timeChart = echarts.init(timeChartRef.value);

  const sorted = [...props.tools]
    .filter(t => t.avg_execution_time > 0)
    .sort((a, b) => b.avg_execution_time - a.avg_execution_time)
    .slice(0, 10);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: '{b0}: {c0} ms',
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: sorted.map(t => t.display_name || t.name),
      axisLabel: {
        interval: 0,
        rotate: 30,
        fontSize: 10,
      },
    },
    yAxis: {
      type: 'value',
      name: '执行时间(ms)',
    },
    series: [
      {
        name: '平均执行时间',
        type: 'bar',
        data: sorted.map(t => t.avg_execution_time.toFixed(2)),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#f093fb' },
            { offset: 1, color: '#f5576c' },
          ]),
        },
      },
    ],
  };

  timeChart.setOption(option);
};

// 初始化成功率对比图
const initSuccessRateChart = () => {
  if (!successRateChartRef.value) {return;}

  successRateChart = echarts.init(successRateChartRef.value);

  const sorted = [...props.tools]
    .filter(t => t.usage_count > 0)
    .map(t => ({
      ...t,
      successRate: ((t.success_count || 0) / t.usage_count) * 100,
    }))
    .sort((a, b) => b.usage_count - a.usage_count)
    .slice(0, 10);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: '{b0}: {c0}%',
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: sorted.map(t => t.display_name || t.name),
      axisLabel: {
        interval: 0,
        rotate: 30,
        fontSize: 10,
      },
    },
    yAxis: {
      type: 'value',
      name: '成功率(%)',
      max: 100,
    },
    series: [
      {
        name: '成功率',
        type: 'bar',
        data: sorted.map(t => t.successRate.toFixed(1)),
        itemStyle: {
          color: (params) => {
            const rate = params.value;
            if (rate >= 90) {return '#52c41a';}
            if (rate >= 70) {return '#1890ff';}
            if (rate >= 50) {return '#faad14';}
            return '#f5222d';
          },
        },
      },
    ],
  };

  successRateChart.setOption(option);
};

// 获取类型名称
const getTypeName = (type) => {
  const nameMap = {
    function: '函数',
    api: 'API',
    command: '命令',
    script: '脚本',
  };
  return nameMap[type] || type;
};

// 响应式调整
const handleResize = () => {
  typeChart?.resize();
  usageChart?.resize();
  timeChart?.resize();
  successRateChart?.resize();
};

// 监听数据变化
watch(
  () => [props.tools, props.toolStats],
  () => {
    calculateStats();
    initTypeChart();
    initUsageChart();
    initTimeChart();
    initSuccessRateChart();
  },
  { deep: true }
);

onMounted(() => {
  calculateStats();
  initTypeChart();
  initUsageChart();
  initTimeChart();
  initSuccessRateChart();

  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  typeChart?.dispose();
  usageChart?.dispose();
  timeChart?.dispose();
  successRateChart?.dispose();
});
</script>

<style scoped>
.tool-stats {
  padding: 16px;
}
</style>
