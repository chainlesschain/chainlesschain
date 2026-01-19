<template>
  <div class="transaction-statistics">
    <a-card>
      <template #title>
        <a-space>
          <bar-chart-outlined />
          <span>交易统计</span>
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-range-picker
            v-model:value="dateRange"
            style="width: 280px"
            @change="loadStatistics"
          />
          <a-button @click="loadStatistics">
            <template #icon>
              <reload-outlined />
            </template>
            刷新
          </a-button>
        </a-space>
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
                title="总交易数"
                :value="statistics.totalTransactions"
                :value-style="{ color: '#1890ff' }"
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
                title="总交易额"
                :value="statistics.totalVolume"
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
                title="成功率"
                :value="statistics.successRate"
                suffix="%"
                :precision="1"
                :value-style="{ color: '#faad14' }"
              >
                <template #prefix>
                  <check-circle-outlined />
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
                title="平均金额"
                :value="statistics.averageAmount"
                :precision="2"
                :value-style="{ color: '#722ed1' }"
              >
                <template #prefix>
                  <calculator-outlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <!-- 图表区域 -->
        <a-row :gutter="[16, 16]">
          <!-- 交易趋势图 -->
          <a-col :span="12">
            <a-card
              title="交易趋势"
              size="small"
            >
              <div
                ref="trendChartRef"
                style="width: 100%; height: 300px"
              />
            </a-card>
          </a-col>

          <!-- 交易类型分布 -->
          <a-col :span="12">
            <a-card
              title="交易类型分布"
              size="small"
            >
              <div
                ref="typeChartRef"
                style="width: 100%; height: 300px"
              />
            </a-card>
          </a-col>

          <!-- 交易状态分布 -->
          <a-col :span="12">
            <a-card
              title="交易状态分布"
              size="small"
            >
              <div
                ref="statusChartRef"
                style="width: 100%; height: 300px"
              />
            </a-card>
          </a-col>

          <!-- 热门资产 -->
          <a-col :span="12">
            <a-card
              title="热门交易资产 Top 10"
              size="small"
            >
              <div
                ref="assetsChartRef"
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
import { init } from '../../utils/echartsConfig';
import {
  BarChartOutlined,
  ReloadOutlined,
  SwapOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  CalculatorOutlined,
} from '@ant-design/icons-vue';

// 图表引用
const trendChartRef = ref(null);
const typeChartRef = ref(null);
const statusChartRef = ref(null);
const assetsChartRef = ref(null);

let trendChart = null;
let typeChart = null;
let statusChart = null;
let assetsChart = null;

// 状态
const loading = ref(false);
const dateRange = ref([]);

const statistics = reactive({
  totalTransactions: 0,
  totalVolume: 0,
  successRate: 0,
  averageAmount: 0,
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

    const filters = {
      startDate: dateRange.value[0]?.valueOf(),
      endDate: dateRange.value[1]?.valueOf(),
    };

    // 调用IPC获取统计数据（这里应该有API）
    // 暂时使用模拟数据
    const data = await getMockStatistics();

    // 更新统计数据
    statistics.totalTransactions = data.totalTransactions;
    statistics.totalVolume = data.totalVolume;
    statistics.successRate = data.successRate;
    statistics.averageAmount = data.averageAmount;

    logger.info('[TransactionStatistics] 统计数据已加载');

    // 渲染图表
    await nextTick();
    renderCharts(data);
  } catch (error) {
    logger.error('[TransactionStatistics] 加载统计失败:', error);
    message.error(error.message || '加载统计失败');
  } finally {
    loading.value = false;
  }
};

// 模拟统计数据
const getMockStatistics = () => {
  return {
    totalTransactions: 1234,
    totalVolume: 567890.50,
    successRate: 95.8,
    averageAmount: 460.25,
    trendData: {
      dates: ['01-15', '01-16', '01-17', '01-18', '01-19', '01-20', '01-21'],
      transactions: [120, 132, 101, 134, 145, 156, 168],
      volumes: [55000, 58000, 46000, 61000, 66000, 71000, 77000],
    },
    typeDistribution: [
      { name: '资产交易', value: 450 },
      { name: '订单购买', value: 320 },
      { name: '合约执行', value: 280 },
      { name: '托管释放', value: 184 },
    ],
    statusDistribution: [
      { name: '已完成', value: 1083 },
      { name: '进行中', value: 89 },
      { name: '已取消', value: 42 },
      { name: '失败', value: 20 },
    ],
    topAssets: [
      { name: 'CNY', value: 450 },
      { name: 'USD', value: 280 },
      { name: 'BTC', value: 156 },
      { name: 'ETH', value: 128 },
      { name: 'USDT', value: 98 },
    ],
  };
};

// 渲染图表
const renderCharts = (data) => {
  renderTrendChart(data.trendData);
  renderTypeChart(data.typeDistribution);
  renderStatusChart(data.statusDistribution);
  renderAssetsChart(data.topAssets);
};

// 渲染交易趋势图
const renderTrendChart = (data) => {
  if (!trendChartRef.value) {return;}

  if (!trendChart) {
    trendChart = init(trendChartRef.value);
  }

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
    },
    legend: {
      data: ['交易数', '交易额'],
    },
    xAxis: {
      type: 'category',
      data: data.dates,
    },
    yAxis: [
      {
        type: 'value',
        name: '交易数',
        position: 'left',
      },
      {
        type: 'value',
        name: '交易额',
        position: 'right',
      },
    ],
    series: [
      {
        name: '交易数',
        type: 'bar',
        data: data.transactions,
        itemStyle: {
          color: '#1890ff',
        },
      },
      {
        name: '交易额',
        type: 'line',
        yAxisIndex: 1,
        data: data.volumes,
        smooth: true,
        itemStyle: {
          color: '#52c41a',
        },
      },
    ],
  };

  trendChart.setOption(option);
};

// 渲染交易类型分布图
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
        name: '交易类型',
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
        data: data,
      },
    ],
  };

  typeChart.setOption(option);
};

// 渲染交易状态分布图
const renderStatusChart = (data) => {
  if (!statusChartRef.value) {return;}

  if (!statusChart) {
    statusChart = init(statusChartRef.value);
  }

  const option = {
    tooltip: {
      trigger: 'item',
    },
    legend: {
      bottom: 10,
      left: 'center',
    },
    series: [
      {
        name: '交易状态',
        type: 'pie',
        radius: '60%',
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
  };

  statusChart.setOption(option);
};

// 渲染热门资产图
const renderAssetsChart = (data) => {
  if (!assetsChartRef.value) {return;}

  if (!assetsChart) {
    assetsChart = init(assetsChartRef.value);
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
      data: data.map(item => item.name),
    },
    yAxis: {
      type: 'value',
    },
    series: [
      {
        name: '交易次数',
        type: 'bar',
        data: data.map(item => item.value),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#83bff6' },
            { offset: 0.5, color: '#188df0' },
            { offset: 1, color: '#188df0' },
          ]),
        },
        emphasis: {
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#2378f7' },
              { offset: 0.7, color: '#2378f7' },
              { offset: 1, color: '#83bff6' },
            ]),
          },
        },
      },
    ],
  };

  assetsChart.setOption(option);
};

// 窗口调整时重新渲染图表
const handleResize = () => {
  trendChart?.resize();
  typeChart?.resize();
  statusChart?.resize();
  assetsChart?.resize();
};

// 生命周期
onMounted(() => {
  loadStatistics();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  trendChart?.dispose();
  typeChart?.dispose();
  statusChart?.dispose();
  assetsChart?.dispose();
});
</script>

<style scoped>
.transaction-statistics {
  padding: 20px;
}
</style>
