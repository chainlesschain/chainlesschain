<template>
  <div class="performance-dashboard">
    <a-card
      title="性能监控"
      :bordered="false"
    >
      <template #extra>
        <a-space>
          <a-switch
            v-model:checked="isMonitoring"
            checked-children="监控中"
            un-checked-children="已停止"
            @change="handleToggleMonitoring"
          />
          <a-button
            size="small"
            @click="handleExport"
          >
            <ExportOutlined />
            导出数据
          </a-button>
          <a-button
            size="small"
            @click="handleClear"
          >
            <ClearOutlined />
            清空数据
          </a-button>
        </a-space>
      </template>

      <!-- 实时指标卡片 -->
      <a-row
        :gutter="[16, 16]"
        class="metrics-cards"
      >
        <!-- 内存使用 -->
        <a-col :span="6">
          <a-card
            size="small"
            class="metric-card"
          >
            <a-statistic
              title="内存使用"
              :value="currentMetrics.memory.percentage"
              :precision="1"
              suffix="%"
              :value-style="getValueStyle(currentMetrics.memory.percentage, 80)"
            >
              <template #prefix>
                <DatabaseOutlined />
              </template>
            </a-statistic>
            <div class="metric-detail">
              {{ formatBytes(currentMetrics.memory.used) }} /
              {{ formatBytes(currentMetrics.memory.total) }}
            </div>
          </a-card>
        </a-col>

        <!-- FPS -->
        <a-col :span="6">
          <a-card
            size="small"
            class="metric-card"
          >
            <a-statistic
              title="帧率 (FPS)"
              :value="currentMetrics.fps.current"
              :precision="0"
              suffix="fps"
              :value-style="getValueStyle(60 - currentMetrics.fps.current, 30)"
            >
              <template #prefix>
                <DashboardOutlined />
              </template>
            </a-statistic>
            <div class="metric-detail">
              平均: {{ currentMetrics.fps.average }} fps
            </div>
          </a-card>
        </a-col>

        <!-- 存储使用 -->
        <a-col :span="6">
          <a-card
            size="small"
            class="metric-card"
          >
            <a-statistic
              title="存储使用"
              :value="currentMetrics.storage.percentage"
              :precision="1"
              suffix="%"
              :value-style="getValueStyle(currentMetrics.storage.percentage, 80)"
            >
              <template #prefix>
                <HddOutlined />
              </template>
            </a-statistic>
            <div class="metric-detail">
              {{ formatBytes(currentMetrics.storage.used) }} /
              {{ formatBytes(currentMetrics.storage.total) }}
            </div>
          </a-card>
        </a-col>

        <!-- 网络状态 -->
        <a-col :span="6">
          <a-card
            size="small"
            class="metric-card"
          >
            <a-statistic
              title="网络速度"
              :value="currentMetrics.network.downlink || 0"
              :precision="1"
              suffix="Mbps"
            >
              <template #prefix>
                <WifiOutlined />
              </template>
            </a-statistic>
            <div class="metric-detail">
              {{ currentMetrics.network.effectiveType || 'N/A' }}
            </div>
          </a-card>
        </a-col>
      </a-row>

      <a-divider />

      <!-- 性能图表 -->
      <a-tabs v-model:active-key="activeTab">
        <!-- 内存趋势 -->
        <a-tab-pane
          key="memory"
          tab="内存趋势"
        >
          <div class="chart-container">
            <div class="chart-placeholder">
              <LineChartOutlined class="chart-icon" />
              <p>内存使用趋势图</p>
              <div class="chart-data">
                <div
                  v-for="(point, index) in memoryData"
                  :key="index"
                  class="data-point"
                  :style="{ height: `${point.value}%` }"
                  :title="`${point.value.toFixed(1)}%`"
                />
              </div>
            </div>
          </div>
        </a-tab-pane>

        <!-- FPS 趋势 -->
        <a-tab-pane
          key="fps"
          tab="FPS 趋势"
        >
          <div class="chart-container">
            <div class="chart-placeholder">
              <AreaChartOutlined class="chart-icon" />
              <p>帧率趋势图</p>
              <div class="chart-data">
                <div
                  v-for="(point, index) in fpsData"
                  :key="index"
                  class="data-point fps-point"
                  :style="{ height: `${(point.value / 60) * 100}%` }"
                  :title="`${point.value} fps`"
                />
              </div>
            </div>
          </div>
        </a-tab-pane>

        <!-- 性能报告 -->
        <a-tab-pane
          key="report"
          tab="性能报告"
        >
          <div class="performance-report">
            <a-descriptions
              :column="2"
              bordered
              size="small"
            >
              <a-descriptions-item label="监控状态">
                <a-tag :color="isMonitoring ? 'green' : 'red'">
                  {{ isMonitoring ? '运行中' : '已停止' }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="数据点数">
                {{ getTotalDataPoints() }}
              </a-descriptions-item>
              <a-descriptions-item label="内存峰值">
                {{ formatBytes(getMetricMax('memory')) }}
              </a-descriptions-item>
              <a-descriptions-item label="内存平均">
                {{ formatBytes(getMetricAvg('memory')) }}
              </a-descriptions-item>
              <a-descriptions-item label="FPS 最低">
                {{ getMetricMin('fps') }} fps
              </a-descriptions-item>
              <a-descriptions-item label="FPS 平均">
                {{ getMetricAvg('fps').toFixed(0) }} fps
              </a-descriptions-item>
              <a-descriptions-item label="存储峰值">
                {{ formatBytes(getMetricMax('storage')) }}
              </a-descriptions-item>
              <a-descriptions-item label="存储平均">
                {{ formatBytes(getMetricAvg('storage')) }}
              </a-descriptions-item>
            </a-descriptions>

            <div class="report-actions">
              <a-button
                type="primary"
                @click="handleGenerateReport"
              >
                <FileTextOutlined />
                生成详细报告
              </a-button>
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>

      <!-- 性能建议 -->
      <a-alert
        v-if="performanceWarnings.length > 0"
        type="warning"
        show-icon
        class="performance-warnings"
      >
        <template #message>
          <div class="warnings-title">
            性能警告
          </div>
        </template>
        <template #description>
          <ul class="warnings-list">
            <li
              v-for="(warning, index) in performanceWarnings"
              :key="index"
            >
              {{ warning }}
            </li>
          </ul>
        </template>
      </a-alert>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  DatabaseOutlined,
  DashboardOutlined,
  HddOutlined,
  WifiOutlined,
  ExportOutlined,
  ClearOutlined,
  LineChartOutlined,
  AreaChartOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';
import { usePerformanceMonitor } from '@/utils/performanceMonitor';

const {
  isMonitoring,
  currentMetrics,
  metrics,
  start,
  stop,
  getMetrics,
  getPerformanceReport,
  clear,
  exportData,
} = usePerformanceMonitor();

const activeTab = ref('memory');

// 内存数据
const memoryData = computed(() => {
  return getMetrics('memory', 60).map(m => ({
    value: m.value,
    timestamp: m.timestamp,
  }));
});

// FPS 数据
const fpsData = computed(() => {
  return getMetrics('fps', 60).map(m => ({
    value: m.value,
    timestamp: m.timestamp,
  }));
});

// 性能警告
const performanceWarnings = computed(() => {
  const warnings = [];

  if (currentMetrics.value.memory.percentage > 80) {
    warnings.push('内存使用率过高，建议关闭不必要的标签页或重启应用');
  }

  if (currentMetrics.value.fps.current < 30) {
    warnings.push('帧率过低，可能影响用户体验，建议检查后台任务');
  }

  if (currentMetrics.value.storage.percentage > 90) {
    warnings.push('存储空间不足，建议清理缓存或删除不必要的数据');
  }

  return warnings;
});

// 获取值样式（根据阈值改变颜色）
const getValueStyle = (value, threshold) => {
  if (value > threshold) {
    return { color: '#ff4d4f' };
  } else if (value > threshold * 0.7) {
    return { color: '#faad14' };
  }
  return { color: '#52c41a' };
};

// 格式化字节
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) {return '0 B';}
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// 获取总数据点数
const getTotalDataPoints = () => {
  return Object.values(metrics.value).reduce((sum, arr) => sum + arr.length, 0);
};

// 获取指标最大值
const getMetricMax = (type) => {
  const data = metrics.value[type] || [];
  if (data.length === 0) {return 0;}
  return Math.max(...data.map(m => m.metadata?.used || m.value || 0));
};

// 获取指标最小值
const getMetricMin = (type) => {
  const data = metrics.value[type] || [];
  if (data.length === 0) {return 0;}
  return Math.min(...data.map(m => m.value || 0));
};

// 获取指标平均值
const getMetricAvg = (type) => {
  const data = metrics.value[type] || [];
  if (data.length === 0) {return 0;}
  const values = data.map(m => m.metadata?.used || m.value || 0);
  return values.reduce((a, b) => a + b, 0) / values.length;
};

// 切换监控
const handleToggleMonitoring = (checked) => {
  if (checked) {
    start();
    message.success('性能监控已启动');
  } else {
    stop();
    message.info('性能监控已停止');
  }
};

// 导出数据
const handleExport = () => {
  const data = exportData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `performance-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  message.success('性能数据已导出');
};

// 清空数据
const handleClear = () => {
  clear();
  message.success('性能数据已清空');
};

// 生成详细报告
const handleGenerateReport = () => {
  const report = getPerformanceReport();
  logger.info('Performance Report:', report);
  message.success('详细报告已生成，请查看控制台');
};

onMounted(() => {
  if (!isMonitoring.value) {
    start();
  }
});
</script>

<style scoped>
.performance-dashboard {
  max-width: 1400px;
  margin: 0 auto;
}

.metrics-cards {
  margin-bottom: 24px;
}

.metric-card {
  text-align: center;
}

.metric-detail {
  margin-top: 8px;
  font-size: 12px;
  color: #8c8c8c;
}

.chart-container {
  min-height: 300px;
}

.chart-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  background: #fafafa;
  border-radius: 8px;
  padding: 24px;
}

.chart-icon {
  font-size: 48px;
  color: #d9d9d9;
  margin-bottom: 16px;
}

.chart-placeholder p {
  color: #8c8c8c;
  margin-bottom: 24px;
}

.chart-data {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 150px;
  width: 100%;
  max-width: 600px;
}

.data-point {
  flex: 1;
  background: linear-gradient(180deg, #1890ff 0%, #096dd9 100%);
  border-radius: 2px 2px 0 0;
  min-height: 2px;
  transition: all 0.3s;
  cursor: pointer;
}

.data-point:hover {
  opacity: 0.8;
}

.fps-point {
  background: linear-gradient(180deg, #52c41a 0%, #389e0d 100%);
}

.performance-report {
  padding: 16px 0;
}

.report-actions {
  margin-top: 24px;
  text-align: center;
}

.performance-warnings {
  margin-top: 24px;
}

.warnings-title {
  font-weight: 500;
  margin-bottom: 8px;
}

.warnings-list {
  margin: 0;
  padding-left: 20px;
}

.warnings-list li {
  margin: 4px 0;
}
</style>
