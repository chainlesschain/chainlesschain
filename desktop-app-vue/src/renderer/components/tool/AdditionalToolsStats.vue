<template>
  <div class="additional-tools-stats">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="title">
        <h3>Additional Tools V3 统计仪表板</h3>
        <span class="subtitle">专业领域工具使用情况分析</span>
      </div>
      <a-space>
        <a-switch
          v-model:checked="autoRefresh"
          checked-children="自动刷新"
          un-checked-children="手动刷新"
          @change="handleAutoRefreshChange"
        />
        <a-button @click="handleRefresh" :loading="loading" type="primary">
          <template #icon><ReloadOutlined /></template>
          刷新数据
        </a-button>
      </a-space>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading && !overview.totalTools" class="loading-container">
      <a-spin size="large" tip="加载统计数据中..."></a-spin>
    </div>

    <!-- 统计数据 -->
    <div v-else class="stats-container">
      <a-space direction="vertical" :size="24" style="width: 100%">
        <!-- 概览卡片 -->
        <a-row :gutter="16">
          <a-col :xs="24" :sm="12" :md="8" :lg="4" :xl="4">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="总工具数"
                :value="overview.totalTools"
                :value-style="{ color: '#3f8600', fontSize: '28px' }"
              >
                <template #prefix><ToolOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8" :lg="4" :xl="4">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="已启用"
                :value="overview.enabledTools"
                :value-style="{ color: '#1890ff', fontSize: '28px' }"
              >
                <template #prefix><CheckCircleOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8" :lg="5" :xl="5">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="总调用次数"
                :value="overview.totalInvocations"
                :value-style="{ color: '#cf1322', fontSize: '28px' }"
              >
                <template #prefix><ThunderboltOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8" :lg="5" :xl="5">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="成功率"
                :value="overview.successRate"
                :value-style="{ color: getSuccessRateColor(overview.successRate), fontSize: '28px' }"
              >
                <template #prefix><CheckSquareOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :md="8" :lg="6" :xl="6">
            <a-card size="small" class="stat-card">
              <a-statistic
                title="平均响应时间"
                :value="overview.avgExecutionTime"
                suffix="ms"
                :precision="2"
                :value-style="{ color: '#722ed1', fontSize: '28px' }"
              >
                <template #prefix><ClockCircleOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <!-- 图表区域 -->
        <a-row :gutter="16">
          <!-- 使用排行 Top 10 -->
          <a-col :xs="24" :lg="12">
            <a-card title="使用次数排行 Top 10" size="small" class="chart-card">
              <div ref="usageChartRef" style="width: 100%; height: 350px"></div>
            </a-card>
          </a-col>

          <!-- 成功率排行 Top 10 -->
          <a-col :xs="24" :lg="12">
            <a-card title="成功率排行 Top 10" size="small" class="chart-card">
              <div ref="successRateChartRef" style="width: 100%; height: 350px"></div>
            </a-card>
          </a-col>
        </a-row>

        <!-- 分类统计 & 性能分布 -->
        <a-row :gutter="16">
          <!-- 分类统计 -->
          <a-col :xs="24" :lg="14">
            <a-card title="分类统计" size="small" class="chart-card">
              <a-table
                :columns="categoryColumns"
                :data-source="categoryStats"
                :pagination="false"
                size="small"
                :scroll="{ y: 300 }"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'category'">
                    <a-tag :color="getCategoryColor(record.category)">
                      {{ getCategoryName(record.category) }}
                    </a-tag>
                  </template>
                  <template v-if="column.key === 'successRate'">
                    <span :style="{ color: getSuccessRateColor(record.successRate + '%') }">
                      {{ record.successRate }}%
                    </span>
                  </template>
                </template>
              </a-table>
            </a-card>
          </a-col>

          <!-- 性能分布 -->
          <a-col :xs="24" :lg="10">
            <a-card title="性能分布" size="small" class="chart-card">
              <div ref="performanceChartRef" style="width: 100%; height: 300px"></div>
            </a-card>
          </a-col>
        </a-row>

        <!-- 7天使用趋势 -->
        <a-row :gutter="16">
          <a-col :span="24">
            <a-card title="7天使用趋势" size="small" class="chart-card">
              <div ref="trendChartRef" style="width: 100%; height: 300px"></div>
            </a-card>
          </a-col>
        </a-row>

        <!-- 最近使用 -->
        <a-row :gutter="16">
          <a-col :span="24">
            <a-card title="最近使用" size="small" class="chart-card">
              <a-list
                :data-source="recentTools"
                :pagination="{ pageSize: 10, showSizeChanger: false }"
                size="small"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <strong>{{ item.display_name || item.name }}</strong>
                      </template>
                      <template #description>
                        <a-space>
                          <a-tag>{{ getCategoryName(item.category) }}</a-tag>
                          <span style="color: #8c8c8c">{{ item.timeSinceLastUse }}</span>
                          <span style="color: #8c8c8c">
                            调用 {{ item.usage_count }} 次 |
                            成功率 {{ getToolSuccessRate(item) }}%
                          </span>
                        </a-space>
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
                <template #emptyText>
                  <a-empty description="暂无使用记录" />
                </template>
              </a-list>
            </a-card>
          </a-col>
        </a-row>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts';
import { message } from 'ant-design-vue';
import {
  ToolOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';

// 加载状态
const loading = ref(true);

// 自动刷新
const autoRefresh = ref(false);
let refreshTimer = null;

// 统计数据
const overview = ref({
  totalTools: 0,
  enabledTools: 0,
  totalInvocations: 0,
  totalSuccesses: 0,
  successRate: '0%',
  avgExecutionTime: 0,
});

const rankings = ref({
  mostUsed: [],
  highestSuccessRate: [],
  fastest: [],
});

const categoryStats = ref([]);
const recentTools = ref([]);
const dailyStats = ref([]);
const performanceMetrics = ref({
  tools: [],
  distribution: { excellent: 0, good: 0, fair: 0, slow: 0 },
});

// 图表引用
const usageChartRef = ref(null);
const successRateChartRef = ref(null);
const performanceChartRef = ref(null);
const trendChartRef = ref(null);

let usageChart = null;
let successRateChart = null;
let performanceChart = null;
let trendChart = null;

// 分类统计表格列
const categoryColumns = [
  {
    title: '分类',
    dataIndex: 'category',
    key: 'category',
    width: 120,
  },
  {
    title: '工具数',
    dataIndex: 'toolCount',
    key: 'toolCount',
    width: 80,
  },
  {
    title: '使用次数',
    dataIndex: 'totalUsage',
    key: 'totalUsage',
    width: 100,
  },
  {
    title: '成功率',
    dataIndex: 'successRate',
    key: 'successRate',
    width: 90,
  },
  {
    title: '平均响应时间',
    dataIndex: 'avgTime',
    key: 'avgTime',
    width: 120,
    customRender: ({ text }) => `${text.toFixed(2)}ms`,
  },
];

// 加载统计数据
const loadDashboardData = async () => {
  loading.value = true;
  try {
    const result = await window.electronAPI.tool.getAdditionalV3Dashboard();

    if (result.success) {
      const data = result.data;

      // 设置概览数据
      overview.value = data.overview;

      // 设置排行榜数据
      rankings.value = data.rankings;

      // 设置分类统计
      categoryStats.value = data.categoryStats;

      // 设置最近使用
      recentTools.value = data.recentTools;

      // 设置每日统计
      dailyStats.value = data.dailyStats;

      // 设置性能指标
      performanceMetrics.value = data.performanceMetrics;

      // 初始化图表
      await initCharts();
    } else {
      message.error('加载统计数据失败: ' + result.error);
    }
  } catch (error) {
    console.error('[AdditionalToolsStats] 加载数据失败:', error);
    message.error('加载统计数据失败');
  } finally {
    loading.value = false;
  }
};

// 初始化所有图表
const initCharts = async () => {
  await Promise.all([
    initUsageChart(),
    initSuccessRateChart(),
    initPerformanceChart(),
    initTrendChart(),
  ]);
};

// 使用次数柱状图
const initUsageChart = () => {
  if (!usageChartRef.value) return;

  usageChart = echarts.init(usageChartRef.value);

  const data = rankings.value.mostUsed.slice(0, 10);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const item = params[0];
        return `${item.name}<br/>调用次数: ${item.value}`;
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
      name: '调用次数',
    },
    yAxis: {
      type: 'category',
      data: data.map(t => t.display_name || t.name),
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: '调用次数',
        type: 'bar',
        data: data.map(t => t.usage_count),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#667eea' },
            { offset: 1, color: '#764ba2' },
          ]),
        },
        label: {
          show: true,
          position: 'right',
          formatter: '{c}',
        },
      },
    ],
  };

  usageChart.setOption(option);
};

// 成功率柱状图
const initSuccessRateChart = () => {
  if (!successRateChartRef.value) return;

  successRateChart = echarts.init(successRateChartRef.value);

  const data = rankings.value.highestSuccessRate.slice(0, 10);

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const item = params[0];
        return `${item.name}<br/>成功率: ${item.value}%`;
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
      name: '成功率(%)',
      max: 100,
    },
    yAxis: {
      type: 'category',
      data: data.map(t => t.display_name || t.name),
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: '成功率',
        type: 'bar',
        data: data.map(t => t.success_rate),
        itemStyle: {
          color: (params) => {
            const rate = params.value;
            if (rate >= 90) return '#52c41a';
            if (rate >= 70) return '#1890ff';
            if (rate >= 50) return '#faad14';
            return '#f5222d';
          },
        },
        label: {
          show: true,
          position: 'right',
          formatter: '{c}%',
        },
      },
    ],
  };

  successRateChart.setOption(option);
};

// 性能分布饼图
const initPerformanceChart = () => {
  if (!performanceChartRef.value) return;

  performanceChart = echarts.init(performanceChartRef.value);

  const dist = performanceMetrics.value.distribution;

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
        radius: '60%',
        data: [
          { value: dist.excellent, name: '优秀 (<10ms)', itemStyle: { color: '#52c41a' } },
          { value: dist.good, name: '良好 (10-50ms)', itemStyle: { color: '#1890ff' } },
          { value: dist.fair, name: '一般 (50-100ms)', itemStyle: { color: '#faad14' } },
          { value: dist.slow, name: '较慢 (>100ms)', itemStyle: { color: '#f5222d' } },
        ],
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

  performanceChart.setOption(option);
};

// 7天使用趋势折线图
const initTrendChart = () => {
  if (!trendChartRef.value) return;

  trendChart = echarts.init(trendChartRef.value);

  const data = dailyStats.value;

  const option = {
    tooltip: {
      trigger: 'axis',
    },
    legend: {
      data: ['调用次数', '成功次数', '失败次数'],
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
      data: data.map(d => d.date),
    },
    yAxis: {
      type: 'value',
    },
    series: [
      {
        name: '调用次数',
        type: 'line',
        data: data.map(d => d.invokes),
        smooth: true,
        itemStyle: { color: '#1890ff' },
      },
      {
        name: '成功次数',
        type: 'line',
        data: data.map(d => d.success),
        smooth: true,
        itemStyle: { color: '#52c41a' },
      },
      {
        name: '失败次数',
        type: 'line',
        data: data.map(d => d.failure),
        smooth: true,
        itemStyle: { color: '#f5222d' },
      },
    ],
  };

  trendChart.setOption(option);
};

// 辅助函数
const getCategoryColor = (category) => {
  const colorMap = {
    blockchain: 'blue',
    finance: 'green',
    crm: 'orange',
    project: 'purple',
    code: 'cyan',
    simulation: 'magenta',
    analysis: 'geekblue',
    management: 'lime',
    general: 'default',
  };
  return colorMap[category] || 'default';
};

const getCategoryName = (category) => {
  const nameMap = {
    blockchain: '区块链',
    finance: '财务',
    crm: 'CRM',
    project: '项目管理',
    code: '代码生成',
    simulation: '模拟仿真',
    analysis: '分析',
    management: '管理',
    general: '通用',
  };
  return nameMap[category] || category;
};

const getSuccessRateColor = (rateStr) => {
  const rate = parseFloat(rateStr);
  if (rate >= 90) return '#52c41a';
  if (rate >= 70) return '#1890ff';
  if (rate >= 50) return '#faad14';
  return '#f5222d';
};

const getToolSuccessRate = (tool) => {
  if (!tool.usage_count || tool.usage_count === 0) return 0;
  return ((tool.success_count / tool.usage_count) * 100).toFixed(1);
};

// 手动刷新
const handleRefresh = async () => {
  await loadDashboardData();
  message.success('数据已刷新');
};

// 自动刷新切换
const handleAutoRefreshChange = (checked) => {
  if (checked) {
    // 启动自动刷新，每30秒刷新一次
    refreshTimer = setInterval(async () => {
      await loadDashboardData();
    }, 30000);
    message.info('已启用自动刷新（每30秒）');
  } else {
    // 停止自动刷新
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    message.info('已关闭自动刷新');
  }
};

// 响应式调整
const handleResize = () => {
  usageChart?.resize();
  successRateChart?.resize();
  performanceChart?.resize();
  trendChart?.resize();
};

// 生命周期
onMounted(async () => {
  await loadDashboardData();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);

  // 清理自动刷新定时器
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  // 销毁图表
  usageChart?.dispose();
  successRateChart?.dispose();
  performanceChart?.dispose();
  trendChart?.dispose();
});

// 暴露刷新方法供父组件调用
defineExpose({
  refresh: loadDashboardData,
});
</script>

<style scoped lang="scss">
.additional-tools-stats {
  padding: 0;

  .toolbar {
    background: #fff;
    padding: 16px 24px;
    border-radius: 8px;
    margin-bottom: 16px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    display: flex;
    justify-content: space-between;
    align-items: center;

    .title {
      h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #262626;
      }

      .subtitle {
        display: block;
        margin-top: 4px;
        font-size: 13px;
        color: #8c8c8c;
      }
    }
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
    background: #fff;
    border-radius: 8px;
  }

  .stats-container {
    .stat-card {
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
      transition: all 0.3s;

      &:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        transform: translateY(-2px);
      }

      :deep(.ant-statistic-title) {
        font-size: 13px;
        color: #8c8c8c;
        margin-bottom: 4px;
      }

      :deep(.ant-statistic-content) {
        .ant-statistic-content-prefix {
          font-size: 22px;
          margin-right: 8px;
        }
      }
    }

    .chart-card {
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
      margin-bottom: 16px;

      :deep(.ant-card-head-title) {
        font-size: 15px;
        font-weight: 600;
      }
    }
  }
}

// 响应式适配
@media (max-width: 768px) {
  .additional-tools-stats {
    .stat-card {
      margin-bottom: 12px;
    }

    .chart-card {
      :deep(.ant-card-body) {
        padding: 12px;
      }
    }
  }
}
</style>
