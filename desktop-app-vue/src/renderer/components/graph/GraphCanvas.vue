<template>
  <div
    ref="containerRef"
    class="graph-canvas"
  >
    <div
      ref="chartRef"
      class="graph-chart"
    />

    <!-- 工具栏 -->
    <div class="graph-toolbar">
      <a-space>
        <a-tooltip title="重新布局">
          <a-button
            type="text"
            @click="refreshLayout"
          >
            <template #icon>
              <ReloadOutlined />
            </template>
          </a-button>
        </a-tooltip>

        <a-tooltip title="缩放适应">
          <a-button
            type="text"
            @click="fitView"
          >
            <template #icon>
              <CompressOutlined />
            </template>
          </a-button>
        </a-tooltip>

        <a-dropdown>
          <template #overlay>
            <a-menu @click="handleLayoutChange">
              <a-menu-item key="force">
                <ApartmentOutlined /> 力导向布局
              </a-menu-item>
              <a-menu-item key="circular">
                <RadarChartOutlined /> 环形布局
              </a-menu-item>
              <a-menu-item key="hierarchical">
                <NodeIndexOutlined /> 层级布局
              </a-menu-item>
            </a-menu>
          </template>
          <a-button type="text">
            <template #icon>
              <BranchesOutlined />
            </template>
            布局
          </a-button>
        </a-dropdown>
      </a-space>
    </div>

    <!-- 节点详情面板 -->
    <div
      v-if="selectedNodeData"
      class="node-detail-panel"
    >
      <a-card
        :title="selectedNodeData.title"
        size="small"
      >
        <template #extra>
          <CloseOutlined @click="closeDetail" />
        </template>

        <a-descriptions
          :column="1"
          size="small"
        >
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
          <a-button
            type="link"
            size="small"
            @click="openNote(selectedNodeData.id)"
          >
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
import {
  ReloadOutlined,
  CompressOutlined,
  BranchesOutlined,
  ApartmentOutlined,
  RadarChartOutlined,
  NodeIndexOutlined,
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
  layout: {
    type: String,
    default: 'force',
  },
});

const emit = defineEmits(['nodeClick', 'edgeClick', 'nodeHover']);

const graphStore = useGraphStore();
const { selectedNode } = storeToRefs(graphStore);

const chartRef = ref(null);
const containerRef = ref(null);
let chartInstance = null;

const selectedNodeData = computed(() => {
  if (!selectedNode.value) {return null;}
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
 * 初始化图表
 */
const initChart = () => {
  if (!chartRef.value) {return;}

  chartInstance = echarts.init(chartRef.value);

  // 监听点击事件
  chartInstance.on('click', (params) => {
    if (params.dataType === 'node') {
      graphStore.selectNode(params.data.id);
      emit('nodeClick', params.data);
    } else if (params.dataType === 'edge') {
      emit('edgeClick', params.data);
    }
  });

  // 监听悬停事件
  chartInstance.on('mouseover', (params) => {
    if (params.dataType === 'node') {
      graphStore.hoverNode(params.data.id);
      emit('nodeHover', params.data);
    }
  });

  chartInstance.on('mouseout', () => {
    graphStore.hoverNode(null);
  });

  updateChart();

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize);
};

/**
 * 更新图表
 */
const updateChart = () => {
  if (!chartInstance) {return;}

  const option = {
    tooltip: {
      trigger: 'item',
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
    series: [
      {
        type: 'graph',
        layout: props.layout === 'force' ? 'force' : props.layout,
        data: formatNodes(),
        links: formatEdges(),
        roam: true, // 允许缩放和平移
        label: {
          show: true,
          position: 'right',
          formatter: '{b}',
          fontSize: 12,
        },
        labelLayout: {
          hideOverlap: true,
        },
        emphasis: {
          focus: 'adjacency',
          label: {
            fontSize: 14,
            fontWeight: 'bold',
          },
          lineStyle: {
            width: 3,
          },
        },
        force: {
          repulsion: 300,
          edgeLength: 150,
          gravity: 0.1,
          friction: 0.6,
        },
        circular: {
          rotateLabel: true,
        },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 8],
        lineStyle: {
          color: 'source',
          curveness: 0.1,
        },
      },
    ],
  };

  chartInstance.setOption(option, true);
};

/**
 * 格式化节点数据
 */
const formatNodes = () => {
  return props.nodes.map(node => ({
    id: node.id,
    name: node.title,
    title: node.title,
    type: node.type,
    created_at: node.created_at,
    relationCount: props.edges.filter(
      e => e.source === node.id || e.target === node.id
    ).length,
    symbolSize: Math.min(30 + (node.importance || 0) * 5, 60),
    itemStyle: {
      color: nodeTypeColors[node.type] || nodeTypeColors.note,
    },
  }));
};

/**
 * 格式化边数据
 */
const formatEdges = () => {
  return props.edges.map(edge => ({
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
 * 适应视图
 */
const fitView = () => {
  if (!chartInstance) {return;}
  chartInstance.resize();
};

/**
 * 切换布局
 */
const handleLayoutChange = ({ key }) => {
  graphStore.setLayout(key);
  emit('update:layout', key);
  updateChart();
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
  // 触发打开笔记事件，由父组件处理
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
  if (!timestamp) {return '-';}
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

// 监听数据变化
watch(() => [props.nodes, props.edges], () => {
  updateChart();
}, { deep: true });

watch(() => props.layout, () => {
  updateChart();
});

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
.graph-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: #f5f5f5;
}

.graph-chart {
  width: 100%;
  height: 100%;
}

.graph-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  background: white;
  border-radius: 4px;
  padding: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
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
