<template>
  <a-drawer
    v-model:open="visible"
    title="性能监控仪表板"
    placement="right"
    :width="700"
    :closable="true"
  >
    <a-tabs v-model:activeKey="activeTab">
      <!-- 概览标签页 -->
      <a-tab-pane key="overview" tab="概览">
        <a-row :gutter="[16, 16]">
          <!-- CPU使用率 -->
          <a-col :span="12">
            <a-card title="CPU使用率" size="small">
              <a-statistic
                :value="stats.cpu?.current || 0"
                suffix="%"
                :value-style="getCPUColor(stats.cpu?.current)"
              >
                <template #prefix>
                  <DashboardOutlined />
                </template>
              </a-statistic>
              <div class="stat-detail">
                <div>平均: {{ stats.cpu?.average?.toFixed(1) || 0 }}%</div>
                <div>峰值: {{ stats.cpu?.max || 0 }}%</div>
              </div>
            </a-card>
          </a-col>

          <!-- 内存使用 -->
          <a-col :span="12">
            <a-card title="内存使用" size="small">
              <a-statistic
                :value="formatBytes(stats.memory?.current || 0)"
                :value-style="getMemoryColor(stats.memory?.current)"
              >
                <template #prefix>
                  <DatabaseOutlined />
                </template>
              </a-statistic>
              <div class="stat-detail">
                <div>平均: {{ formatBytes(stats.memory?.average || 0) }}</div>
                <div>峰值: {{ formatBytes(stats.memory?.max || 0) }}</div>
              </div>
            </a-card>
          </a-col>

          <!-- 数据库查询 -->
          <a-col :span="12">
            <a-card title="数据库查询" size="small">
              <a-statistic :value="stats.queries?.total || 0">
                <template #prefix>
                  <TableOutlined />
                </template>
              </a-statistic>
              <div class="stat-detail">
                <div>慢查询: {{ stats.queries?.slow || 0 }}</div>
                <div>平均耗时: {{ stats.queries?.averageDuration?.toFixed(2) || 0 }}ms</div>
              </div>
            </a-card>
          </a-col>

          <!-- 运行时间 -->
          <a-col :span="12">
            <a-card title="运行时间" size="small">
              <a-statistic :value="uptime">
                <template #prefix>
                  <ClockCircleOutlined />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <!-- CPU & 内存趋势 -->
      <a-tab-pane key="trends" tab="趋势图">
        <div class="chart-container">
          <div ref="cpuChartRef" class="chart"></div>
          <div ref="memoryChartRef" class="chart"></div>
        </div>
      </a-tab-pane>

      <!-- 慢查询分析 -->
      <a-tab-pane key="queries" tab="慢查询">
        <a-table
          :columns="queryColumns"
          :data-source="slowQueries"
          :pagination="{ pageSize: 10 }"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'duration'">
              <a-tag :color="getDurationColor(record.duration)">
                {{ record.duration.toFixed(2) }}ms
              </a-tag>
            </template>
            <template v-else-if="column.key === 'query'">
              <a-tooltip :title="record.query">
                <div class="query-text">{{ truncate(record.query, 60) }}</div>
              </a-tooltip>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- P2P连接状态 -->
      <a-tab-pane key="p2p" tab="P2P连接">
        <a-descriptions bordered :column="2" size="small">
          <a-descriptions-item label="总连接数">
            {{ p2pStats.total || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="活跃连接">
            {{ p2pStats.currentActive || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="空闲连接">
            {{ p2pStats.currentIdle || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="连接复用率">
            {{ p2pStats.hitRate || '0%' }}
          </a-descriptions-item>
          <a-descriptions-item label="总命中数">
            {{ p2pStats.totalHits || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="总未命中">
            {{ p2pStats.totalMisses || 0 }}
          </a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <!-- 配置 -->
      <a-tab-pane key="config" tab="配置">
        <a-form layout="vertical">
          <a-form-item label="性能预设">
            <a-select v-model:value="selectedPreset" @change="handlePresetChange">
              <a-select-option value="low-end">低端设备模式</a-select-option>
              <a-select-option value="balanced">平衡模式</a-select-option>
              <a-select-option value="high-performance">高性能模式</a-select-option>
              <a-select-option value="extreme">极限性能模式</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="监控间隔">
            <a-slider
              v-model:value="monitorInterval"
              :min="500"
              :max="5000"
              :step="500"
              :marks="{ 500: '0.5s', 1000: '1s', 3000: '3s', 5000: '5s' }"
              @change="handleIntervalChange"
            />
          </a-form-item>

          <a-space>
            <a-button @click="handleRefresh">
              <template #icon><ReloadOutlined /></template>
              刷新数据
            </a-button>
            <a-button @click="handleReset">
              <template #icon><ClearOutlined /></template>
              重置统计
            </a-button>
            <a-button @click="handleExport">
              <template #icon><DownloadOutlined /></template>
              导出报告
            </a-button>
          </a-space>
        </a-form>
      </a-tab-pane>
    </a-tabs>
  </a-drawer>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as echarts from 'echarts';
import {
  DashboardOutlined,
  DatabaseOutlined,
  TableOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  ClearOutlined,
  DownloadOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:visible']);

const activeTab = ref('overview');
const stats = ref({});
const uptime = ref('0s');
const slowQueries = ref([]);
const p2pStats = ref({});
const selectedPreset = ref('balanced');
const monitorInterval = ref(1000);

const cpuChartRef = ref(null);
const memoryChartRef = ref(null);
let cpuChart = null;
let memoryChart = null;
let updateTimer = null;

const queryColumns = [
  { title: '查询', dataIndex: 'query', key: 'query' },
  { title: '耗时', dataIndex: 'duration', key: 'duration', width: 100 },
  { title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 180 },
];

/**
 * 初始化图表
 */
const initCharts = () => {
  if (cpuChartRef.value) {
    cpuChart = echarts.init(cpuChartRef.value);
    cpuChart.setOption({
      title: { text: 'CPU使用率', left: 'center' },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: [{ name: 'CPU', type: 'line', data: [], smooth: true }],
    });
  }

  if (memoryChartRef.value) {
    memoryChart = echarts.init(memoryChartRef.value);
    memoryChart.setOption({
      title: { text: '内存使用', left: 'center' },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value', axisLabel: { formatter: (value) => formatBytes(value) } },
      series: [{ name: '内存', type: 'line', data: [], smooth: true }],
    });
  }
};

/**
 * 更新数据
 */
const updateData = async () => {
  try {
    // 获取性能统计
    stats.value = await window.electronAPI.getPerformanceStats();

    // 获取慢查询
    slowQueries.value = await window.electronAPI.getSlowQueries(10);

    // 获取P2P统计
    p2pStats.value = await window.electronAPI.getP2PStats();

    // 格式化运行时间
    uptime.value = formatUptime(stats.value.uptime);

    // 更新图表
    updateCharts();
  } catch (error) {
    console.error('更新性能数据失败:', error);
  }
};

/**
 * 更新图表
 */
const updateCharts = () => {
  if (cpuChart && stats.value.cpu) {
    const times = Array.from({ length: 60 }, (_, i) => {
      const time = new Date(Date.now() - (59 - i) * 1000);
      return time.toLocaleTimeString();
    });

    cpuChart.setOption({
      xAxis: { data: times },
      series: [{ data: Array(60).fill(stats.value.cpu.current) }],
    });
  }

  if (memoryChart && stats.value.memory) {
    const times = Array.from({ length: 60 }, (_, i) => {
      const time = new Date(Date.now() - (59 - i) * 1000);
      return time.toLocaleTimeString();
    });

    memoryChart.setOption({
      xAxis: { data: times },
      series: [{ data: Array(60).fill(stats.value.memory.current) }],
    });
  }
};

/**
 * 工具函数
 */
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

const formatUptime = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

const truncate = (str, len) => {
  return str.length > len ? str.substring(0, len) + '...' : str;
};

const getCPUColor = (value) => {
  if (value > 80) return { color: '#f5222d' };
  if (value > 50) return { color: '#faad14' };
  return { color: '#52c41a' };
};

const getMemoryColor = (value) => {
  if (value > 500 * 1024 * 1024) return { color: '#f5222d' };
  if (value > 300 * 1024 * 1024) return { color: '#faad14' };
  return { color: '#52c41a' };
};

const getDurationColor = (duration) => {
  if (duration > 500) return 'red';
  if (duration > 200) return 'orange';
  if (duration > 100) return 'gold';
  return 'green';
};

/**
 * 事件处理
 */
const handleRefresh = () => {
  updateData();
};

const handleReset = async () => {
  await window.electronAPI.resetPerformanceStats();
  updateData();
};

const handleExport = async () => {
  const report = await window.electronAPI.exportPerformanceReport();
  // 下载报告
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `performance-report-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const handlePresetChange = async (preset) => {
  await window.electronAPI.setPerformancePreset(preset);
};

const handleIntervalChange = (interval) => {
  if (updateTimer) {
    clearInterval(updateTimer);
  }
  updateTimer = setInterval(updateData, interval);
};

// 生命周期
onMounted(() => {
  initCharts();
  updateData();

  // 定时更新
  updateTimer = setInterval(updateData, monitorInterval.value);
});

onUnmounted(() => {
  if (updateTimer) {
    clearInterval(updateTimer);
  }

  if (cpuChart) {
    cpuChart.dispose();
  }

  if (memoryChart) {
    memoryChart.dispose();
  }
});

// 监听可见性变化
watch(() => props.visible, (visible) => {
  if (visible) {
    updateData();
    setTimeout(initCharts, 100);
  }
});
</script>

<style scoped>
.stat-detail {
  margin-top: 12px;
  font-size: 12px;
  color: #8c8c8c;
}

.stat-detail > div {
  margin-bottom: 4px;
}

.chart-container {
  padding: 16px 0;
}

.chart {
  width: 100%;
  height: 250px;
  margin-bottom: 24px;
}

.query-text {
  font-family: monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
