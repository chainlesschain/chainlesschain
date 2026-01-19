<template>
  <div
    ref="containerRef"
    class="timeline-visualization"
  >
    <div
      ref="chartRef"
      class="timeline-chart"
    />

    <!-- 控制面板 -->
    <div class="timeline-controls">
      <a-space
        direction="vertical"
        style="width: 100%"
      >
        <a-card
          title="时间轴设置"
          size="small"
        >
          <a-form
            layout="vertical"
            size="small"
          >
            <a-form-item label="时间范围">
              <a-range-picker
                v-model:value="timeRange"
                :show-time="true"
                format="YYYY-MM-DD HH:mm"
                @change="handleTimeRangeChange"
              />
            </a-form-item>

            <a-form-item label="分组方式">
              <a-select
                v-model:value="groupBy"
                @change="updateChart"
              >
                <a-select-option value="day">
                  按天
                </a-select-option>
                <a-select-option value="week">
                  按周
                </a-select-option>
                <a-select-option value="month">
                  按月
                </a-select-option>
                <a-select-option value="year">
                  按年
                </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="显示类型">
              <a-checkbox-group
                v-model:value="displayTypes"
                :options="typeOptions"
                @change="updateChart"
              />
            </a-form-item>

            <a-form-item label="关系类型">
              <a-checkbox-group
                v-model:value="relationTypes"
                :options="relationOptions"
                @change="updateChart"
              />
            </a-form-item>
          </a-form>
        </a-card>

        <a-card
          title="统计信息"
          size="small"
        >
          <a-descriptions
            :column="1"
            size="small"
          >
            <a-descriptions-item label="总节点数">
              {{ filteredNodes.length }}
            </a-descriptions-item>
            <a-descriptions-item label="总关系数">
              {{ filteredEdges.length }}
            </a-descriptions-item>
            <a-descriptions-item label="时间跨度">
              {{ timeSpan }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </a-space>
    </div>

    <!-- 节点详情 -->
    <div
      v-if="selectedNode"
      class="node-detail"
    >
      <a-card
        :title="selectedNode.title"
        size="small"
      >
        <template #extra>
          <CloseOutlined @click="selectedNode = null" />
        </template>

        <a-descriptions
          :column="1"
          size="small"
        >
          <a-descriptions-item label="类型">
            {{ selectedNode.type }}
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatTime(selectedNode.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="更新时间">
            {{ formatTime(selectedNode.updated_at) }}
          </a-descriptions-item>
        </a-descriptions>

        <div class="detail-actions">
          <a-button
            type="link"
            size="small"
            @click="$emit('open-note', selectedNode.id)"
          >
            打开笔记
          </a-button>
        </div>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { init } from '../../utils/echartsConfig';
import dayjs from 'dayjs';
import { CloseOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
  edges: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['node-click', 'open-note']);

const chartRef = ref(null);
const containerRef = ref(null);
let chartInstance = null;

const timeRange = ref([]);
const groupBy = ref('month');
const displayTypes = ref(['note', 'document', 'conversation', 'web_clip']);
const relationTypes = ref(['link', 'tag', 'semantic', 'temporal']);
const selectedNode = ref(null);

const typeOptions = [
  { label: '笔记', value: 'note' },
  { label: '文档', value: 'document' },
  { label: '对话', value: 'conversation' },
  { label: '网页剪藏', value: 'web_clip' },
];

const relationOptions = [
  { label: '链接', value: 'link' },
  { label: '标签', value: 'tag' },
  { label: '语义', value: 'semantic' },
  { label: '时间', value: 'temporal' },
];

// 过滤节点
const filteredNodes = computed(() => {
  let nodes = props.nodes.filter(node => displayTypes.value.includes(node.type));

  if (timeRange.value && timeRange.value.length === 2) {
    const [start, end] = timeRange.value;
    nodes = nodes.filter(node => {
      const time = dayjs(node.created_at);
      return time.isAfter(start) && time.isBefore(end);
    });
  }

  return nodes;
});

// 过滤边
const filteredEdges = computed(() => {
  const nodeIds = new Set(filteredNodes.value.map(n => n.id));
  return props.edges.filter(edge =>
    nodeIds.has(edge.source_id) &&
    nodeIds.has(edge.target_id) &&
    relationTypes.value.includes(edge.relation_type)
  );
});

// 时间跨度
const timeSpan = computed(() => {
  if (filteredNodes.value.length === 0) {return '-';}

  const times = filteredNodes.value
    .map(n => dayjs(n.created_at))
    .filter(t => t.isValid())
    .sort((a, b) => a.valueOf() - b.valueOf());

  if (times.length === 0) {return '-';}

  const start = times[0];
  const end = times[times.length - 1];
  const days = end.diff(start, 'day');

  if (days === 0) {return '1天';}
  if (days < 30) {return `${days}天`;}
  if (days < 365) {return `${Math.floor(days / 30)}个月`;}
  return `${Math.floor(days / 365)}年`;
});

/**
 * 初始化图表
 */
const initChart = () => {
  if (!chartRef.value) {return;}

  chartInstance = init(chartRef.value);

  chartInstance.on('click', (params) => {
    if (params.componentType === 'series') {
      const node = filteredNodes.value.find(n => n.id === params.data.id);
      if (node) {
        selectedNode.value = node;
        emit('node-click', node);
      }
    }
  });

  updateChart();

  window.addEventListener('resize', handleResize);
};

/**
 * 更新图表
 */
const updateChart = () => {
  if (!chartInstance) {return;}

  const timelineData = prepareTimelineData();

  const option = {
    title: {
      text: '知识图谱时间轴',
      left: 'center',
    },
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        if (params.componentType === 'series') {
          return `<strong>${params.data.title}</strong><br/>
                  类型: ${params.data.type}<br/>
                  时间: ${formatTime(params.data.created_at)}<br/>
                  关联: ${params.data.relationCount}`;
        }
      },
    },
    grid: {
      left: '10%',
      right: '10%',
      bottom: '15%',
      top: '15%',
      containLabel: true,
    },
    xAxis: {
      type: 'time',
      name: '时间',
      axisLabel: {
        formatter: (value) => {
          return dayjs(value).format(getTimeFormat());
        },
      },
    },
    yAxis: {
      type: 'value',
      name: '节点数量',
    },
    series: [
      {
        name: '节点创建',
        type: 'scatter',
        data: timelineData.scatter,
        symbolSize: (data) => Math.min(10 + data[2] * 2, 30),
        itemStyle: {
          color: (params) => {
            const node = filteredNodes.value[params.dataIndex];
            return getNodeColor(node?.type);
          },
        },
        emphasis: {
          focus: 'self',
          itemStyle: {
            borderColor: '#333',
            borderWidth: 2,
          },
        },
      },
      {
        name: '累计数量',
        type: 'line',
        data: timelineData.line,
        smooth: true,
        lineStyle: {
          width: 2,
          color: '#5470c6',
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(84, 112, 198, 0.3)' },
            { offset: 1, color: 'rgba(84, 112, 198, 0.05)' },
          ]),
        },
      },
    ],
    dataZoom: [
      {
        type: 'slider',
        xAxisIndex: 0,
        start: 0,
        end: 100,
      },
      {
        type: 'inside',
        xAxisIndex: 0,
      },
    ],
    legend: {
      data: ['节点创建', '累计数量'],
      bottom: 10,
    },
  };

  chartInstance.setOption(option, true);
};

/**
 * 准备时间轴数据
 */
const prepareTimelineData = () => {
  const scatter = [];
  const line = [];

  // 按时间排序节点
  const sortedNodes = [...filteredNodes.value]
    .filter(n => n.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // 散点数据
  sortedNodes.forEach((node, index) => {
    const time = new Date(node.created_at).getTime();
    const relationCount = filteredEdges.value.filter(
      e => e.source_id === node.id || e.target_id === node.id
    ).length;

    scatter.push({
      value: [time, index + 1, relationCount],
      id: node.id,
      title: node.title,
      type: node.type,
      created_at: node.created_at,
      relationCount,
    });
  });

  // 折线数据（累计）
  const grouped = groupNodesByTime(sortedNodes);
  let cumulative = 0;

  grouped.forEach(({ time, count }) => {
    cumulative += count;
    line.push([time, cumulative]);
  });

  return { scatter, line };
};

/**
 * 按时间分组节点
 */
const groupNodesByTime = (nodes) => {
  const groups = new Map();

  nodes.forEach(node => {
    const time = dayjs(node.created_at);
    let key;

    switch (groupBy.value) {
      case 'day':
        key = time.startOf('day').valueOf();
        break;
      case 'week':
        key = time.startOf('week').valueOf();
        break;
      case 'month':
        key = time.startOf('month').valueOf();
        break;
      case 'year':
        key = time.startOf('year').valueOf();
        break;
      default:
        key = time.startOf('day').valueOf();
    }

    groups.set(key, (groups.get(key) || 0) + 1);
  });

  return Array.from(groups.entries())
    .map(([time, count]) => ({ time, count }))
    .sort((a, b) => a.time - b.time);
};

/**
 * 获取时间格式
 */
const getTimeFormat = () => {
  switch (groupBy.value) {
    case 'day':
      return 'MM-DD';
    case 'week':
      return 'MM-DD';
    case 'month':
      return 'YYYY-MM';
    case 'year':
      return 'YYYY';
    default:
      return 'YYYY-MM-DD';
  }
};

/**
 * 获取节点颜色
 */
const getNodeColor = (type) => {
  const colors = {
    note: '#5470c6',
    document: '#91cc75',
    conversation: '#fac858',
    web_clip: '#ee6666',
  };
  return colors[type] || '#5470c6';
};

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  if (!timestamp) {return '-';}
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss');
};

/**
 * 处理时间范围变化
 */
const handleTimeRangeChange = () => {
  updateChart();
};

/**
 * 处理窗口大小变化
 */
const handleResize = () => {
  if (chartInstance) {
    chartInstance.resize();
  }
};

// 监听数据变化
watch(() => [props.nodes, props.edges], () => {
  updateChart();
}, { deep: true });

onMounted(() => {
  initChart();
});

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped>
.timeline-visualization {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
}

.timeline-chart {
  flex: 1;
  height: 100%;
}

.timeline-controls {
  width: 300px;
  padding: 16px;
  background: #fafafa;
  overflow-y: auto;
}

.node-detail {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 300px;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.detail-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

:deep(.ant-card) {
  margin-bottom: 16px;
}

:deep(.ant-card:last-child) {
  margin-bottom: 0;
}
</style>
