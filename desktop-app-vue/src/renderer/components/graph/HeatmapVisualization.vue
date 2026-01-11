<template>
  <div class="heatmap-visualization" ref="containerRef">
    <div ref="chartRef" class="heatmap-chart"></div>

    <!-- 控制面板 -->
    <div class="heatmap-controls">
      <a-card title="热力图设置" size="small">
        <a-form layout="vertical" size="small">
          <a-form-item label="热力图类型">
            <a-select v-model:value="heatmapType" @change="updateChart">
              <a-select-option value="relation">关系强度</a-select-option>
              <a-select-option value="activity">活跃度</a-select-option>
              <a-select-option value="similarity">相似度</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="颜色方案">
            <a-select v-model:value="colorScheme" @change="updateChart">
              <a-select-option value="blue">蓝色</a-select-option>
              <a-select-option value="green">绿色</a-select-option>
              <a-select-option value="red">红色</a-select-option>
              <a-select-option value="rainbow">彩虹</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="显示数量">
            <a-slider
              v-model:value="displayLimit"
              :min="10"
              :max="100"
              :step="10"
              :marks="{ 10: '10', 50: '50', 100: '100' }"
              @change="updateChart"
            />
          </a-form-item>

          <a-form-item>
            <a-checkbox v-model:checked="showLabels" @change="updateChart">
              显示标签
            </a-checkbox>
          </a-form-item>
        </a-form>
      </a-card>

      <a-card title="统计信息" size="small">
        <a-descriptions :column="1" size="small">
          <a-descriptions-item label="最大值">
            {{ maxValue.toFixed(2) }}
          </a-descriptions-item>
          <a-descriptions-item label="最小值">
            {{ minValue.toFixed(2) }}
          </a-descriptions-item>
          <a-descriptions-item label="平均值">
            {{ avgValue.toFixed(2) }}
          </a-descriptions-item>
        </a-descriptions>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import * as echarts from 'echarts';

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

const emit = defineEmits(['cell-click']);

const chartRef = ref(null);
const containerRef = ref(null);
let chartInstance = null;

const heatmapType = ref('relation');
const colorScheme = ref('blue');
const displayLimit = ref(50);
const showLabels = ref(true);

// 计算热力图数据
const heatmapData = computed(() => {
  const topNodes = props.nodes.slice(0, displayLimit.value);

  switch (heatmapType.value) {
    case 'relation':
      return calculateRelationHeatmap(topNodes);
    case 'activity':
      return calculateActivityHeatmap(topNodes);
    case 'similarity':
      return calculateSimilarityHeatmap(topNodes);
    default:
      return calculateRelationHeatmap(topNodes);
  }
});

// 统计值
const maxValue = computed(() => {
  if (heatmapData.value.data.length === 0) return 0;
  return Math.max(...heatmapData.value.data.map(d => d[2]));
});

const minValue = computed(() => {
  if (heatmapData.value.data.length === 0) return 0;
  return Math.min(...heatmapData.value.data.map(d => d[2]));
});

const avgValue = computed(() => {
  if (heatmapData.value.data.length === 0) return 0;
  const sum = heatmapData.value.data.reduce((acc, d) => acc + d[2], 0);
  return sum / heatmapData.value.data.length;
});

/**
 * 计算关系强度热力图
 */
const calculateRelationHeatmap = (nodes) => {
  const matrix = [];
  const xLabels = nodes.map(n => n.title || n.id);
  const yLabels = [...xLabels];

  nodes.forEach((sourceNode, i) => {
    nodes.forEach((targetNode, j) => {
      // 计算两个节点之间的关系强度
      const strength = calculateRelationStrength(sourceNode.id, targetNode.id);
      matrix.push([i, j, strength]);
    });
  });

  return {
    data: matrix,
    xLabels,
    yLabels,
  };
};

/**
 * 计算活跃度热力图
 */
const calculateActivityHeatmap = (nodes) => {
  const matrix = [];
  const xLabels = ['创建', '更新', '关联', '被引用'];
  const yLabels = nodes.map(n => n.title || n.id);

  nodes.forEach((node, i) => {
    // 创建活跃度
    const createActivity = node.created_at ? 1 : 0;
    matrix.push([0, i, createActivity]);

    // 更新活跃度
    const updateActivity = node.updated_at ? 1 : 0;
    matrix.push([1, i, updateActivity]);

    // 关联活跃度
    const outgoingCount = props.edges.filter(e => e.source_id === node.id).length;
    matrix.push([2, i, outgoingCount]);

    // 被引用活跃度
    const incomingCount = props.edges.filter(e => e.target_id === node.id).length;
    matrix.push([3, i, incomingCount]);
  });

  return {
    data: matrix,
    xLabels,
    yLabels,
  };
};

/**
 * 计算相似度热力图
 */
const calculateSimilarityHeatmap = (nodes) => {
  const matrix = [];
  const xLabels = nodes.map(n => n.title || n.id);
  const yLabels = [...xLabels];

  nodes.forEach((node1, i) => {
    nodes.forEach((node2, j) => {
      // 计算两个节点的相似度
      const similarity = calculateNodeSimilarity(node1, node2);
      matrix.push([i, j, similarity]);
    });
  });

  return {
    data: matrix,
    xLabels,
    yLabels,
  };
};

/**
 * 计算关系强度
 */
const calculateRelationStrength = (sourceId, targetId) => {
  if (sourceId === targetId) return 0;

  const directEdges = props.edges.filter(
    e => (e.source_id === sourceId && e.target_id === targetId) ||
         (e.source_id === targetId && e.target_id === sourceId)
  );

  if (directEdges.length === 0) return 0;

  // 计算加权强度
  return directEdges.reduce((sum, edge) => sum + (edge.weight || 1), 0);
};

/**
 * 计算节点相似度
 */
const calculateNodeSimilarity = (node1, node2) => {
  if (node1.id === node2.id) return 1;

  // 基于共同邻居的相似度
  const neighbors1 = new Set();
  const neighbors2 = new Set();

  props.edges.forEach(edge => {
    if (edge.source_id === node1.id) neighbors1.add(edge.target_id);
    if (edge.target_id === node1.id) neighbors1.add(edge.source_id);
    if (edge.source_id === node2.id) neighbors2.add(edge.target_id);
    if (edge.target_id === node2.id) neighbors2.add(edge.source_id);
  });

  const intersection = new Set([...neighbors1].filter(x => neighbors2.has(x)));
  const union = new Set([...neighbors1, ...neighbors2]);

  if (union.size === 0) return 0;

  // Jaccard 相似度
  return intersection.size / union.size;
};

/**
 * 获取颜色方案
 */
const getColorScheme = () => {
  const schemes = {
    blue: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
    green: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
    red: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
    rainbow: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
  };

  return schemes[colorScheme.value] || schemes.blue;
};

/**
 * 初始化图表
 */
const initChart = () => {
  if (!chartRef.value) return;

  chartInstance = echarts.init(chartRef.value);

  chartInstance.on('click', (params) => {
    if (params.componentType === 'series') {
      const [x, y, value] = params.data;
      emit('cell-click', {
        x: heatmapData.value.xLabels[x],
        y: heatmapData.value.yLabels[y],
        value,
      });
    }
  });

  updateChart();

  window.addEventListener('resize', handleResize);
};

/**
 * 更新图表
 */
const updateChart = () => {
  if (!chartInstance) return;

  const { data, xLabels, yLabels } = heatmapData.value;

  const option = {
    title: {
      text: getHeatmapTitle(),
      left: 'center',
    },
    tooltip: {
      position: 'top',
      formatter: (params) => {
        const [x, y, value] = params.data;
        return `${yLabels[y]} → ${xLabels[x]}<br/>值: ${value.toFixed(2)}`;
      },
    },
    grid: {
      left: '15%',
      right: '10%',
      bottom: '15%',
      top: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      splitArea: {
        show: true,
      },
      axisLabel: {
        show: showLabels.value,
        rotate: 45,
        interval: 0,
        formatter: (value) => {
          return value.length > 10 ? value.substring(0, 10) + '...' : value;
        },
      },
    },
    yAxis: {
      type: 'category',
      data: yLabels,
      splitArea: {
        show: true,
      },
      axisLabel: {
        show: showLabels.value,
        formatter: (value) => {
          return value.length > 15 ? value.substring(0, 15) + '...' : value;
        },
      },
    },
    visualMap: {
      min: minValue.value,
      max: maxValue.value,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: '5%',
      inRange: {
        color: getColorScheme(),
      },
    },
    series: [
      {
        name: getHeatmapTitle(),
        type: 'heatmap',
        data: data,
        label: {
          show: showLabels.value && displayLimit.value <= 20,
          formatter: (params) => params.data[2].toFixed(1),
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };

  chartInstance.setOption(option, true);
};

/**
 * 获取热力图标题
 */
const getHeatmapTitle = () => {
  const titles = {
    relation: '节点关系强度热力图',
    activity: '节点活跃度热力图',
    similarity: '节点相似度热力图',
  };
  return titles[heatmapType.value] || '热力图';
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
.heatmap-visualization {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
}

.heatmap-chart {
  flex: 1;
  height: 100%;
}

.heatmap-controls {
  width: 300px;
  padding: 16px;
  background: #fafafa;
  overflow-y: auto;
}

:deep(.ant-card) {
  margin-bottom: 16px;
}

:deep(.ant-card:last-child) {
  margin-bottom: 0;
}
</style>
