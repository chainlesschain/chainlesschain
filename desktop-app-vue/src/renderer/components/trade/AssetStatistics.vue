<template>
  <div class="asset-statistics">
    <a-card>
      <template #title>
        <a-space>
          <pie-chart-outlined />
          <span>资产统计</span>
        </a-space>
      </template>
      <template #extra>
        <a-button @click="loadStatistics">
          <template #icon>
            <reload-outlined />
          </template>
          刷新
        </a-button>
      </template>

      <a-spin :spinning="loading">
        <!-- 概览统计 -->
        <a-row
          :gutter="[16, 16]"
          style="margin-bottom: 24px"
        >
          <a-col :span="6">
            <a-card
              size="small"
              hoverable
            >
              <a-statistic
                title="资产总数"
                :value="statistics.totalAssets"
                :value-style="{ color: '#1890ff' }"
              >
                <template #prefix>
                  <database-outlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card
              size="small"
              hoverable
            >
              <a-statistic
                title="总市值"
                :value="statistics.totalValue"
                :precision="2"
                :value-style="{ color: '#52c41a' }"
              >
                <template #prefix>
                  <dollar-outlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card
              size="small"
              hoverable
            >
              <a-statistic
                title="转账总次数"
                :value="statistics.totalTransfers"
                :value-style="{ color: '#faad14' }"
              >
                <template #prefix>
                  <swap-outlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :span="6">
            <a-card
              size="small"
              hoverable
            >
              <a-statistic
                title="持有人数"
                :value="statistics.totalHolders"
                :value-style="{ color: '#722ed1' }"
              >
                <template #prefix>
                  <team-outlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <!-- 图表区域 -->
        <a-row :gutter="[16, 16]">
          <!-- 资产类型分布 -->
          <a-col :span="12">
            <a-card
              title="资产类型分布"
              size="small"
            >
              <div
                ref="typeChartRef"
                style="width: 100%; height: 300px"
              />
            </a-card>
          </a-col>

          <!-- 持仓占比 -->
          <a-col :span="12">
            <a-card
              title="持仓占比 Top 10"
              size="small"
            >
              <div
                ref="holdingChartRef"
                style="width: 100%; height: 300px"
              />
            </a-card>
          </a-col>

          <!-- 资产增长趋势 -->
          <a-col :span="24">
            <a-card
              title="资产增长趋势"
              size="small"
            >
              <div
                ref="growthChartRef"
                style="width: 100%; height: 300px"
              />
            </a-card>
          </a-col>

          <!-- 转账活跃度 -->
          <a-col :span="12">
            <a-card
              title="转账活跃度"
              size="small"
            >
              <div
                ref="activityChartRef"
                style="width: 100%; height: 300px"
              />
            </a-card>
          </a-col>

          <!-- 资产创建趋势 -->
          <a-col :span="12">
            <a-card
              title="资产创建趋势"
              size="small"
            >
              <div
                ref="creationChartRef"
                style="width: 100%; height: 300px"
              />
            </a-card>
          </a-col>
        </a-row>
      </a-spin>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import { init, graphic } from '../../utils/echartsConfig';
import {
  PieChartOutlined,
  ReloadOutlined,
  DatabaseOutlined,
  DollarOutlined,
  SwapOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue';

// 图表引用
const typeChartRef = ref(null);
const holdingChartRef = ref(null);
const growthChartRef = ref(null);
const activityChartRef = ref(null);
const creationChartRef = ref(null);

let typeChart = null;
let holdingChart = null;
let growthChart = null;
let activityChart = null;
let creationChart = null;

// 状态
const loading = ref(false);

const statistics = reactive({
  totalAssets: 0,
  totalValue: 0,
  totalTransfers: 0,
  totalHolders: 0,
});

// 加载统计数据
const loadStatistics = async () => {
  try {
    loading.value = true;

    // 获取当前用户DID
    const currentIdentity = await window.electronAPI.did.getCurrentIdentity();
    const userDid = currentIdentity?.did;

    if (!userDid) {
      message.warning('请先创建DID身份');
      return;
    }

    // 调用IPC获取统计数据（这里应该有API）
    // 暂时使用模拟数据
    const data = getMockStatistics();

    // 更新统计数据
    statistics.totalAssets = data.totalAssets;
    statistics.totalValue = data.totalValue;
    statistics.totalTransfers = data.totalTransfers;
    statistics.totalHolders = data.totalHolders;

    logger.info('[AssetStatistics] 统计数据已加载');

    // 渲染图表
    await nextTick();
    renderCharts(data);
  } catch (error) {
    logger.error('[AssetStatistics] 加载统计失败:', error);
    message.error(error.message || '加载统计失败');
  } finally {
    loading.value = false;
  }
};

// 模拟统计数据
const getMockStatistics = () => {
  return {
    totalAssets: 156,
    totalValue: 1234567.89,
    totalTransfers: 8920,
    totalHolders: 432,
    typeDistribution: [
      { name: 'Token', value: 89 },
      { name: 'NFT', value: 45 },
      { name: 'Knowledge', value: 12 },
      { name: 'Service', value: 10 },
    ],
    topHoldings: [
      { name: 'CNY', value: 450000 },
      { name: 'USD', value: 280000 },
      { name: 'BTC', value: 150000 },
      { name: 'ETH', value: 128000 },
      { name: 'USDT', value: 98000 },
      { name: 'SOL', value: 45000 },
      { name: 'DOGE', value: 32000 },
      { name: 'ADA', value: 28000 },
      { name: 'DOT', value: 15000 },
      { name: 'LINK', value: 8000 },
    ],
    growthTrend: {
      dates: ['01-15', '01-16', '01-17', '01-18', '01-19', '01-20', '01-21'],
      counts: [120, 125, 132, 138, 145, 150, 156],
    },
    transferActivity: {
      hours: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      counts: [12, 8, 5, 3, 2, 4, 8, 15, 25, 32, 28, 30, 35, 33, 38, 42, 45, 48, 40, 35, 28, 22, 18, 15],
    },
    creationTrend: {
      months: ['9月', '10月', '11月', '12月', '1月'],
      counts: [15, 23, 28, 35, 55],
    },
  };
};

// 渲染图表
const renderCharts = (data) => {
  renderTypeChart(data.typeDistribution);
  renderHoldingChart(data.topHoldings);
  renderGrowthChart(data.growthTrend);
  renderActivityChart(data.transferActivity);
  renderCreationChart(data.creationTrend);
};

// 渲染资产类型分布图
const renderTypeChart = (data) => {
  if (!typeChartRef.value) {return;}

  if (!typeChart) {
    typeChart = init(typeChartRef.value);
  }

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{a} <br/>{b}: {c} ({d}%)',
    },
    legend: {
      bottom: 10,
      left: 'center',
    },
    series: [
      {
        name: '资产类型',
        type: 'pie',
        radius: '65%',
        data: data,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
    color: ['#5470c6', '#91cc75', '#fac858', '#ee6666'],
  };

  typeChart.setOption(option);
};

// 渲染持仓占比图
const renderHoldingChart = (data) => {
  if (!holdingChartRef.value) {return;}

  if (!holdingChart) {
    holdingChart = init(holdingChartRef.value);
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
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
      data: data.map(item => item.name),
    },
    series: [
      {
        name: '持仓价值',
        type: 'bar',
        data: data.map(item => item.value),
        itemStyle: {
          color: '#1890ff',
        },
      },
    ],
  };

  holdingChart.setOption(option);
};

// 渲染资产增长趋势图
const renderGrowthChart = (data) => {
  if (!growthChartRef.value) {return;}

  if (!growthChart) {
    growthChart = init(growthChartRef.value);
  }

  const option = {
    tooltip: {
      trigger: 'axis',
    },
    xAxis: {
      type: 'category',
      data: data.dates,
    },
    yAxis: {
      type: 'value',
      name: '资产数量',
    },
    series: [
      {
        name: '资产总数',
        type: 'line',
        data: data.counts,
        smooth: true,
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(24, 144, 255, 0.5)' },
            { offset: 1, color: 'rgba(24, 144, 255, 0.05)' },
          ]),
        },
        itemStyle: {
          color: '#1890ff',
        },
      },
    ],
  };

  growthChart.setOption(option);
};

// 渲染转账活跃度图
const renderActivityChart = (data) => {
  if (!activityChartRef.value) {return;}

  if (!activityChart) {
    activityChart = init(activityChartRef.value);
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
    },
    xAxis: {
      type: 'category',
      data: data.hours,
    },
    yAxis: {
      type: 'value',
      name: '转账次数',
    },
    series: [
      {
        name: '转账活跃度',
        type: 'bar',
        data: data.counts,
        itemStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#83bff6' },
            { offset: 0.5, color: '#188df0' },
            { offset: 1, color: '#188df0' },
          ]),
        },
      },
    ],
  };

  activityChart.setOption(option);
};

// 渲染资产创建趋势图
const renderCreationChart = (data) => {
  if (!creationChartRef.value) {return;}

  if (!creationChart) {
    creationChart = init(creationChartRef.value);
  }

  const option = {
    tooltip: {
      trigger: 'axis',
    },
    xAxis: {
      type: 'category',
      data: data.months,
    },
    yAxis: {
      type: 'value',
      name: '创建数量',
    },
    series: [
      {
        name: '新增资产',
        type: 'bar',
        data: data.counts,
        itemStyle: {
          color: '#52c41a',
        },
      },
    ],
  };

  creationChart.setOption(option);
};

// 窗口调整时重新渲染图表
const handleResize = () => {
  typeChart?.resize();
  holdingChart?.resize();
  growthChart?.resize();
  activityChart?.resize();
  creationChart?.resize();
};

// 生命周期
onMounted(() => {
  loadStatistics();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  typeChart?.dispose();
  holdingChart?.dispose();
  growthChart?.dispose();
  activityChart?.dispose();
  creationChart?.dispose();
});
</script>

<style scoped>
.asset-statistics {
  padding: 20px;
}
</style>
