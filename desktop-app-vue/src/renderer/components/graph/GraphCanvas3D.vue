<template>
  <div class="graph-canvas-3d" ref="containerRef">
    <div ref="chartRef" class="graph-chart"></div>

    <!-- 工具栏 -->
    <div class="graph-toolbar">
      <a-space>
        <a-tooltip title="重新布局">
          <a-button type="text" @click="refreshLayout">
            <template #icon><ReloadOutlined /></template>
          </a-button>
        </a-tooltip>

        <a-tooltip title="自动旋转">
          <a-button type="text" @click="toggleAutoRotate">
            <template #icon><SyncOutlined :spin="autoRotate" /></template>
          </a-button>
        </a-tooltip>

        <a-tooltip title="切换视角">
          <a-dropdown>
            <a-button type="text">
              <template #icon><EyeOutlined /></template>
            </a-button>
            <template #overlay>
              <a-menu @click="handleViewChange">
                <a-menu-item key="default">默认视角</a-menu-item>
                <a-menu-item key="top">俯视图</a-menu-item>
                <a-menu-item key="side">侧视图</a-menu-item>
                <a-menu-item key="front">正视图</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </a-tooltip>

        <a-tooltip title="返回2D">
          <a-button type="text" @click="$emit('switch-to-2d')">
            <template #icon><ArrowLeftOutlined /></template>
          </a-button>
        </a-tooltip>
      </a-space>
    </div>

    <!-- 性能指标 -->
    <div class="performance-stats">
      <a-space direction="vertical" size="small">
        <div>节点数: {{ nodes.length }}</div>
        <div>边数: {{ edges.length }}</div>
        <div>FPS: {{ fps }}</div>
      </a-space>
    </div>

    <!-- 节点详情面板 -->
    <div v-if="selectedNodeData" class="node-detail-panel">
      <a-card :title="selectedNodeData.title" size="small">
        <template #extra>
          <CloseOutlined @click="closeDetail" />
        </template>

        <a-descriptions :column="1" size="small">
          <a-descriptions-item label="类型">
            {{ getNodeTypeLabel(selectedNodeData.type) }}
          </a-descriptions-item>
          <a-descriptions-item label="关联数">
            {{ selectedNodeData.relationCount || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatTime(selectedNodeData.created_at) }}
          </a-descriptions-item>
        </a-descriptions>

        <div class="detail-actions">
          <a-button type="link" size="small" @click="openNote(selectedNodeData.id)">
            打开笔记
          </a-button>
        </div>
      </a-card>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import * as echarts from 'echarts';
import 'echarts-gl';
import {
  ReloadOutlined,
  SyncOutlined,
  EyeOutlined,
  ArrowLeftOutlined,
  CloseOutlined,
} from '@ant-design/icons-vue';
import { useGraphStore } from '../../stores/graph';
import { storeToRefs } from 'pinia';

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

const emit = defineEmits(['nodeClick', 'edgeClick', 'switchTo2d', 'openNote']);

const graphStore = useGraphStore();
const { selectedNode } = storeToRefs(graphStore);

const chartRef = ref(null);
const containerRef = ref(null);
let chartInstance = null;

const autoRotate = ref(false);
const fps = ref(0);

const selectedNodeData = computed(() => {
  if (!selectedNode.value) return null;
  return props.nodes.find(n => n.id === selectedNode.value);
});

// 节点类型颜色映射
const nodeTypeColors = {
  note: '#5470c6',
  document: '#91cc75',
  conversation: '#fac858',
  web_clip: '#ee6666',
};

// 关系类型颜色映射
const edgeTypeColors = {
  link: '#5470c6',
  tag: '#91cc75',
  semantic: '#fac858',
  temporal: '#ee6666',
};

/**
 * 初始化3D图表
 */
const initChart = () => {
  if (!chartRef.value) return;

  chartInstance = echarts.init(chartRef.value);

  // 监听点击事件
  chartInstance.on('click', (params) => {
    if (params.componentType === 'series' && params.seriesType === 'graph3D') {
      if (params.dataType === 'node') {
        graphStore.selectNode(params.data.id);
        emit('nodeClick', params.data);
      }
    }
  });

  updateChart();

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize);

  // FPS监控
  startFPSMonitor();
};

/**
 * 更新3D图表
 */
const updateChart = () => {
  if (!chartInstance) return;

  const option = {
    tooltip: {
      formatter: (params) => {
        if (params.dataType === 'node') {
          return `<strong>${params.data.title}</strong><br/>
                  类型: ${getNodeTypeLabel(params.data.type)}<br/>
                  关联: ${params.data.relationCount || 0}`;
        } else if (params.dataType === 'edge') {
          return `${params.data.source_title} → ${params.data.target_title}<br/>
                  类型: ${getEdgeTypeLabel(params.data.type)}<br/>
                  权重: ${params.data.weight.toFixed(2)}`;
        }
      },
    },
    backgroundColor: '#000',
    grid3D: {
      boxWidth: 200,
      boxHeight: 200,
      boxDepth: 200,
      viewControl: {
        autoRotate: autoRotate.value,
        autoRotateSpeed: 10,
        distance: 300,
        minDistance: 100,
        maxDistance: 500,
      },
      light: {
        main: {
          intensity: 1.2,
          shadow: true,
        },
        ambient: {
          intensity: 0.3,
        },
      },
    },
    series: [
      {
        type: 'graph3D',
        data: formatNodes3D(props.nodes),
        links: formatEdges3D(props.edges),
        itemStyle: {
          opacity: 0.8,
        },
        lineStyle: {
          width: 2,
          opacity: 0.6,
        },
        emphasis: {
          itemStyle: {
            opacity: 1,
          },
          lineStyle: {
            width: 4,
            opacity: 1,
          },
          label: {
            show: true,
            formatter: '{b}',
            fontSize: 16,
            color: '#fff',
          },
        },
        label: {
          show: true,
          formatter: '{b}',
          fontSize: 12,
          color: '#fff',
          distance: 5,
        },
      },
    ],
  };

  chartInstance.setOption(option, true);
};

/**
 * 格式化3D节点数据
 */
const formatNodes3D = (nodes) => {
  return nodes.map((node, index) => {
    // 使用球面坐标分布节点
    const phi = Math.acos(-1 + (2 * index) / nodes.length);
    const theta = Math.sqrt(nodes.length * Math.PI) * phi;
    const radius = 100;

    return {
      id: node.id,
      name: node.title,
      title: node.title,
      type: node.type,
      created_at: node.created_at,
      relationCount: props.edges.filter(
        e => e.source_id === node.id || e.target_id === node.id
      ).length,
      value: [
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(phi),
      ],
      symbolSize: Math.min(20 + (node.importance || 0) * 3, 40),
      itemStyle: {
        color: nodeTypeColors[node.type] || nodeTypeColors.note,
      },
    };
  });
};

/**
 * 格式化3D边数据
 */
const formatEdges3D = (edges) => {
  return edges.map(edge => ({
    source: edge.source_id,
    target: edge.target_id,
    type: edge.relation_type,
    weight: edge.weight,
    source_title: props.nodes.find(n => n.id === edge.source_id)?.title || '',
    target_title: props.nodes.find(n => n.id === edge.target_id)?.title || '',
    lineStyle: {
      width: Math.max(1, edge.weight * 2),
      color: edgeTypeColors[edge.relation_type] || edgeTypeColors.link,
      opacity: 0.6,
    },
  }));
};

/**
 * 刷新布局
 */
const refreshLayout = () => {
  updateChart();
};

/**
 * 切换自动旋转
 */
const toggleAutoRotate = () => {
  autoRotate.value = !autoRotate.value;
  updateChart();
};

/**
 * 切换视角
 */
const handleViewChange = ({ key }) => {
  if (!chartInstance) return;

  const viewAngles = {
    default: { alpha: 40, beta: 40 },
    top: { alpha: 0, beta: 0 },
    side: { alpha: 90, beta: 0 },
    front: { alpha: 0, beta: 90 },
  };

  const angle = viewAngles[key];
  if (angle) {
    chartInstance.setOption({
      grid3D: {
        viewControl: {
          alpha: angle.alpha,
          beta: angle.beta,
        },
      },
    });
  }
};

/**
 * 关闭详情面板
 */
const closeDetail = () => {
  graphStore.clearSelection();
};

/**
 * 打开笔记
 */
const openNote = (noteId) => {
  emit('openNote', noteId);
};

/**
 * 获取节点类型标签
 */
const getNodeTypeLabel = (type) => {
  const labels = {
    note: '笔记',
    document: '文档',
    conversation: '对话',
    web_clip: '网页剪藏',
  };
  return labels[type] || type;
};

/**
 * 获取边类型标签
 */
const getEdgeTypeLabel = (type) => {
  const labels = {
    link: '链接',
    tag: '标签',
    semantic: '语义',
    temporal: '时间',
  };
  return labels[type] || type;
};

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-CN');
};

/**
 * 处理窗口大小变化
 */
const handleResize = () => {
  if (chartInstance) {
    chartInstance.resize();
  }
};

/**
 * FPS监控
 */
let fpsFrames = 0;
let fpsLastTime = performance.now();

const startFPSMonitor = () => {
  const measureFPS = () => {
    fpsFrames++;
    const currentTime = performance.now();

    if (currentTime >= fpsLastTime + 1000) {
      fps.value = Math.round((fpsFrames * 1000) / (currentTime - fpsLastTime));
      fpsFrames = 0;
      fpsLastTime = currentTime;
    }

    requestAnimationFrame(measureFPS);
  };

  requestAnimationFrame(measureFPS);
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
.graph-canvas-3d {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
}

.graph-chart {
  width: 100%;
  height: 100%;
}

.graph-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
  padding: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 10;
}

.performance-stats {
  position: absolute;
  bottom: 16px;
  right: 16px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  color: #333;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 10;
}

.node-detail-panel {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 300px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  border-radius: 4px;
}

.detail-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

:deep(.ant-card-head) {
  cursor: pointer;
}

:deep(.ant-card-extra) {
  cursor: pointer;
}
</style>
