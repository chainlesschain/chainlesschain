<template>
  <div class="skill-dependency-graph">
    <a-card
      title="技能-工具依赖关系图"
      size="small"
    >
      <template #extra>
        <a-space>
          <a-select
            v-model:value="layoutType"
            style="width: 120px"
            @change="updateLayout"
          >
            <a-select-option value="force">
              力导向图
            </a-select-option>
            <a-select-option value="circular">
              环形布局
            </a-select-option>
          </a-select>
          <a-button
            size="small"
            @click="resetZoom"
          >
            <template #icon>
              <ZoomInOutlined />
            </template>
            重置缩放
          </a-button>
        </a-space>
      </template>

      <div
        ref="graphRef"
        style="width: 100%; height: 600px"
      />

      <div class="graph-legend">
        <a-space>
          <span><span class="legend-dot skill-node" />技能节点</span>
          <span><span class="legend-dot tool-node" />工具节点</span>
        </a-space>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';
import { ZoomInOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  skills: {
    type: Array,
    default: () => [],
  },
  tools: {
    type: Array,
    default: () => [],
  },
  skillTools: {
    type: Array,
    default: () => [],
  },
});

const graphRef = ref(null);
const layoutType = ref('force');
let graph = null;

// 构建图数据
const buildGraphData = () => {
  const nodes = [];
  const links = [];

  // 添加技能节点
  props.skills.forEach(skill => {
    nodes.push({
      id: skill.id,
      name: skill.display_name || skill.name,
      symbolSize: 40,
      category: 'skill',
      itemStyle: {
        color: '#5470c6',
      },
      label: {
        show: true,
      },
    });
  });

  // 添加工具节点
  props.tools.forEach(tool => {
    nodes.push({
      id: tool.id,
      name: tool.display_name || tool.name,
      symbolSize: 30,
      category: 'tool',
      itemStyle: {
        color: '#91cc75',
      },
      label: {
        show: true,
      },
    });
  });

  // 添加关联边
  props.skillTools.forEach(st => {
    links.push({
      source: st.skill_id,
      target: st.tool_id,
      lineStyle: {
        width: st.priority ? st.priority : 1,
      },
    });
  });

  return { nodes, links };
};

// 初始化图表
const initGraph = () => {
  if (!graphRef.value) {return;}

  graph = echarts.init(graphRef.value);

  const { nodes, links } = buildGraphData();

  const option = {
    tooltip: {
      formatter: (params) => {
        if (params.dataType === 'node') {
          return `
            <b>${params.data.name}</b><br/>
            类型: ${params.data.category === 'skill' ? '技能' : '工具'}<br/>
            ID: ${params.data.id}
          `;
        } else if (params.dataType === 'edge') {
          return `
            ${params.data.source} → ${params.data.target}
          `;
        }
      },
    },
    legend: [
      {
        data: [
          {
            name: '技能',
            icon: 'circle',
            itemStyle: { color: '#5470c6' },
          },
          {
            name: '工具',
            icon: 'circle',
            itemStyle: { color: '#91cc75' },
          },
        ],
        orient: 'vertical',
        left: 10,
        top: 20,
      },
    ],
    series: [
      {
        type: 'graph',
        layout: layoutType.value,
        data: nodes,
        links: links,
        categories: [
          { name: '技能' },
          { name: '工具' },
        ],
        roam: true,
        label: {
          show: true,
          position: 'right',
          fontSize: 12,
        },
        labelLayout: {
          hideOverlap: true,
        },
        scaleLimit: {
          min: 0.4,
          max: 2,
        },
        lineStyle: {
          color: 'source',
          curveness: 0.3,
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: {
            width: 10,
          },
        },
        force: layoutType.value === 'force' ? {
          repulsion: 100,
          edgeLength: [100, 200],
          gravity: 0.1,
        } : undefined,
      },
    ],
  };

  graph.setOption(option);
};

// 更新布局
const updateLayout = () => {
  if (!graph) {return;}

  const { nodes, links } = buildGraphData();

  graph.setOption({
    series: [
      {
        layout: layoutType.value,
        data: nodes,
        links: links,
        force: layoutType.value === 'force' ? {
          repulsion: 100,
          edgeLength: [100, 200],
          gravity: 0.1,
        } : undefined,
      },
    ],
  });
};

// 重置缩放
const resetZoom = () => {
  if (!graph) {return;}
  graph.dispatchAction({
    type: 'restore',
  });
};

// 响应式调整
const handleResize = () => {
  graph?.resize();
};

// 监听数据变化
watch(
  () => [props.skills, props.tools, props.skillTools],
  () => {
    initGraph();
  },
  { deep: true }
);

onMounted(() => {
  initGraph();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  graph?.dispose();
});
</script>

<style scoped>
.skill-dependency-graph {
  padding: 16px;
}

.graph-legend {
  margin-top: 16px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 4px;
}

.legend-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 4px;
}

.skill-node {
  background-color: #5470c6;
}

.tool-node {
  background-color: #91cc75;
}
</style>
