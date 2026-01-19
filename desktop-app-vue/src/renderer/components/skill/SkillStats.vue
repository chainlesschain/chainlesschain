<template>
  <div class="skill-stats">
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
              title="总技能数"
              :value="stats.totalSkills"
              :value-style="{ color: '#3f8600' }"
            >
              <template #prefix>
                <AppstoreOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card size="small">
            <a-statistic
              title="启用技能"
              :value="stats.enabledSkills"
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
              title="平均成功率"
              :value="stats.avgSuccessRate"
              suffix="%"
              :precision="1"
              :value-style="{ color: '#722ed1' }"
            >
              <template #prefix>
                <RiseOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
      </a-row>

      <!-- 图表区域 -->
      <a-row :gutter="16">
        <!-- 分类分布饼图 -->
        <a-col :span="8">
          <a-card
            title="技能分类分布"
            size="small"
          >
            <div
              ref="categoryChartRef"
              style="width: 100%; height: 300px"
            />
          </a-card>
        </a-col>

        <!-- 使用次数Top 10柱状图 -->
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

      <!-- 成功率趋势折线图 -->
      <a-row :gutter="16">
        <a-col :span="24">
          <a-card
            title="成功率趋势（最近7天）"
            size="small"
          >
            <div
              ref="trendChartRef"
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
  AppstoreOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  RiseOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  skills: {
    type: Array,
    default: () => [],
  },
  skillStats: {
    type: Array,
    default: () => [],
  },
});

// 统计数据
const stats = ref({
  totalSkills: 0,
  enabledSkills: 0,
  totalUsage: 0,
  avgSuccessRate: 0,
});

// 图表实例
const categoryChartRef = ref(null);
const usageChartRef = ref(null);
const trendChartRef = ref(null);
let categoryChart = null;
let usageChart = null;
let trendChart = null;

// 计算统计数据
const calculateStats = () => {
  stats.value.totalSkills = props.skills.length;
  stats.value.enabledSkills = props.skills.filter(s => s.enabled === 1).length;
  stats.value.totalUsage = props.skills.reduce((sum, s) => sum + (s.usage_count || 0), 0);

  // 计算平均成功率
  const skillsWithUsage = props.skills.filter(s => s.usage_count > 0);
  if (skillsWithUsage.length > 0) {
    const avgRate = skillsWithUsage.reduce((sum, s) => {
      return sum + ((s.success_count || 0) / s.usage_count) * 100;
    }, 0) / skillsWithUsage.length;
    stats.value.avgSuccessRate = avgRate;
  } else {
    stats.value.avgSuccessRate = 0;
  }
};

// 初始化分类分布饼图
const initCategoryChart = () => {
  if (!categoryChartRef.value) {return;}

  categoryChart = echarts.init(categoryChartRef.value);

  // 统计各分类的技能数量
  const categoryCount = {};
  props.skills.forEach(skill => {
    const cat = skill.category || 'other';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });

  const data = Object.entries(categoryCount).map(([name, value]) => ({
    name: getCategoryName(name),
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
      textStyle: { fontSize: 12 },
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: false,
          position: 'center',
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 16,
            fontWeight: 'bold',
          },
        },
        labelLine: {
          show: false,
        },
        data,
      },
    ],
  };

  categoryChart.setOption(option);
};

// 初始化使用次数柱状图
const initUsageChart = () => {
  if (!usageChartRef.value) {return;}

  usageChart = echarts.init(usageChartRef.value);

  // Top 10 使用次数
  const sorted = [...props.skills]
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
      boundaryGap: [0, 0.01],
    },
    yAxis: {
      type: 'category',
      data: sorted.map(s => s.display_name || s.name),
      axisLabel: { fontSize: 12 },
    },
    series: [
      {
        name: '调用次数',
        type: 'bar',
        data: sorted.map(s => s.usage_count || 0),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#83bff6' },
            { offset: 0.5, color: '#188df0' },
            { offset: 1, color: '#188df0' },
          ]),
        },
      },
    ],
  };

  usageChart.setOption(option);
};

// 初始化趋势图
const initTrendChart = () => {
  if (!trendChartRef.value) {return;}

  trendChart = echarts.init(trendChartRef.value);

  // 获取最近7天的日期
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }

  // 从 skillStats 中提取数据（按日期聚合）
  const successRateByDate = {};
  dates.forEach(date => {
    const dayStats = props.skillStats.filter(s => s.stat_date === date);
    if (dayStats.length > 0) {
      const totalInvoke = dayStats.reduce((sum, s) => sum + (s.invoke_count || 0), 0);
      const totalSuccess = dayStats.reduce((sum, s) => sum + (s.success_count || 0), 0);
      successRateByDate[date] = totalInvoke > 0 ? (totalSuccess / totalInvoke) * 100 : 0;
    } else {
      successRateByDate[date] = 0;
    }
  });

  const option = {
    tooltip: {
      trigger: 'axis',
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates.map(d => d.substring(5)), // 只显示 MM-DD
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: '{value}%',
      },
    },
    series: [
      {
        name: '成功率',
        type: 'line',
        smooth: true,
        data: dates.map(d => successRateByDate[d]?.toFixed(1) || 0),
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(58,77,233,0.8)' },
            { offset: 1, color: 'rgba(58,77,233,0.1)' },
          ]),
        },
        itemStyle: {
          color: '#3a4de9',
        },
      },
    ],
  };

  trendChart.setOption(option);
};

// 获取分类名称
const getCategoryName = (category) => {
  const nameMap = {
    code: '代码开发',
    web: 'Web开发',
    data: '数据处理',
    content: '内容创作',
    document: '文档处理',
    media: '媒体处理',
    ai: 'AI功能',
    system: '系统操作',
    network: '网络请求',
    automation: '自动化',
    project: '项目管理',
    template: '模板应用',
  };
  return nameMap[category] || category;
};

// 响应式调整
const handleResize = () => {
  categoryChart?.resize();
  usageChart?.resize();
  trendChart?.resize();
};

// 监听数据变化
watch(
  () => [props.skills, props.skillStats],
  () => {
    calculateStats();
    initCategoryChart();
    initUsageChart();
    initTrendChart();
  },
  { deep: true }
);

onMounted(() => {
  calculateStats();
  initCategoryChart();
  initUsageChart();
  initTrendChart();

  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  categoryChart?.dispose();
  usageChart?.dispose();
  trendChart?.dispose();
});
</script>

<style scoped>
.skill-stats {
  padding: 16px;
}
</style>
