<template>
  <div class="project-stats-panel">
    <a-card
      title="项目统计"
      :bordered="false"
      :loading="loading"
    >
      <template #extra>
        <a-button
          type="link"
          size="small"
          @click="refreshStats"
        >
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新
        </a-button>
      </template>

      <!-- 基础统计 -->
      <a-row
        :gutter="16"
        class="stats-row"
      >
        <a-col :span="6">
          <a-statistic
            title="文件数量"
            :value="stats.file_count || 0"
            suffix="个"
          >
            <template #prefix>
              <FileOutlined style="color: #1890ff" />
            </template>
          </a-statistic>
        </a-col>

        <a-col :span="6">
          <a-statistic
            title="总大小"
            :value="totalSizeMB"
            suffix="MB"
          >
            <template #prefix>
              <DatabaseOutlined style="color: #52c41a" />
            </template>
          </a-statistic>
        </a-col>

        <a-col :span="6">
          <a-statistic
            title="代码行数"
            :value="stats.code_lines || 0"
            suffix="行"
          >
            <template #prefix>
              <CodeOutlined style="color: #fa8c16" />
            </template>
          </a-statistic>
        </a-col>

        <a-col :span="6">
          <a-statistic
            title="注释行数"
            :value="stats.comment_lines || 0"
            suffix="行"
          >
            <template #prefix>
              <CommentOutlined style="color: #722ed1" />
            </template>
          </a-statistic>
        </a-col>
      </a-row>

      <a-divider />

      <!-- ECharts图表 -->
      <div
        ref="chartRef"
        style="height: 300px"
      />

      <!-- 最后更新时间 -->
      <div
        v-if="stats.last_updated_at"
        class="last-update"
      >
        <a-text
          type="secondary"
          style="font-size: 12px"
        >
          最后更新: {{ formatTime(stats.last_updated_at) }}
        </a-text>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  FileOutlined,
  DatabaseOutlined,
  CodeOutlined,
  CommentOutlined,
  ReloadOutlined
} from '@ant-design/icons-vue';
import { init } from '../../utils/echartsConfig';

const props = defineProps({
  projectId: {
    type: String,
    required: true
  }
});

const stats = ref({
  file_count: 0,
  total_size_kb: 0,
  code_lines: 0,
  comment_lines: 0,
  blank_lines: 0,
  last_updated_at: null
});

const loading = ref(false);
const chartRef = ref(null);
let chartInstance = null;
let refreshTimer = null;

const totalSizeMB = computed(() => {
  return ((stats.value.total_size_kb || 0) / 1024).toFixed(2);
});

const loadStats = async () => {
  try {
    loading.value = true;
    const result = await window.electron.ipcRenderer.invoke('project:stats:get', props.projectId);

    if (result) {
      stats.value = result;
      updateChart();
    }
  } catch (error) {
    logger.error('加载统计数据失败:', error);
  } finally {
    loading.value = false;
  }
};

const refreshStats = async () => {
  try {
    loading.value = true;
    await window.electron.ipcRenderer.invoke('project:stats:update', props.projectId);
    await loadStats();
  } catch (error) {
    logger.error('刷新统计数据失败:', error);
  } finally {
    loading.value = false;
  }
};

const updateChart = () => {
  if (!chartInstance && chartRef.value) {
    chartInstance = init(chartRef.value);
  }

  if (!chartInstance) {return;}

  const total = (stats.value.code_lines || 0) +
                (stats.value.comment_lines || 0) +
                (stats.value.blank_lines || 0);

  if (total === 0) {
    const option = {
      title: {
        text: '暂无代码统计数据',
        left: 'center',
        top: 'center',
        textStyle: {
          color: '#999',
          fontSize: 14
        }
      }
    };
    chartInstance.setOption(option);
    return;
  }

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{a} <br/>{b}: {c} ({d}%)'
    },
    legend: {
      orient: 'vertical',
      left: 'left',
      data: ['代码行', '注释行', '空行']
    },
    series: [
      {
        name: '代码组成',
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: '#fff',
          borderWidth: 2
        },
        label: {
          show: false,
          position: 'center'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 20,
            fontWeight: 'bold'
          }
        },
        labelLine: {
          show: false
        },
        data: [
          {
            value: stats.value.code_lines || 0,
            name: '代码行',
            itemStyle: { color: '#1890ff' }
          },
          {
            value: stats.value.comment_lines || 0,
            name: '注释行',
            itemStyle: { color: '#52c41a' }
          },
          {
            value: stats.value.blank_lines || 0,
            name: '空行',
            itemStyle: { color: '#d9d9d9' }
          }
        ]
      }
    ]
  };

  chartInstance.setOption(option);
};

const formatTime = (timestamp) => {
  if (!timestamp) {return '';}
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

onMounted(() => {
  loadStats();

  // 每30秒刷新一次
  refreshTimer = setInterval(loadStats, 30000);

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    if (chartInstance) {
      chartInstance.resize();
    }
  });
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
});

watch(() => props.projectId, () => {
  loadStats();
});
</script>

<style scoped>
.project-stats-panel {
  margin-top: 16px;
}

.stats-row {
  margin-bottom: 16px;
}

.last-update {
  text-align: right;
  margin-top: 16px;
}
</style>
