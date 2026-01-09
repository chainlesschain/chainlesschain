<template>
  <div class="graph-analytics-panel">
    <a-card title="图分析工具" size="small">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 中心性分析 -->
        <a-tab-pane key="centrality" tab="中心性分析">
          <a-space direction="vertical" style="width: 100%">
            <a-button
              type="primary"
              block
              @click="calculateCentrality"
              :loading="calculating"
            >
              <CalculatorOutlined />
              计算中心性指标
            </a-button>

            <div v-if="centralityResults" class="results">
              <h4>度中心性 Top 10</h4>
              <a-list
                size="small"
                :data-source="topDegreeCentrality"
                :loading="calculating"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <a @click="$emit('node-click', item.id)">
                          {{ item.name }}
                        </a>
                      </template>
                      <template #description>
                        度数: {{ item.degree }} | 归一化: {{ item.normalized.toFixed(3) }}
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>

              <a-divider />

              <h4>PageRank Top 10</h4>
              <a-list
                size="small"
                :data-source="topPageRank"
                :loading="calculating"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <a @click="$emit('node-click', item.id)">
                          {{ item.name }}
                        </a>
                      </template>
                      <template #description>
                        PageRank: {{ item.score.toFixed(4) }}
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </div>
          </a-space>
        </a-tab-pane>

        <!-- 社区检测 -->
        <a-tab-pane key="community" tab="社区检测">
          <a-space direction="vertical" style="width: 100%">
            <a-button
              type="primary"
              block
              @click="detectCommunities"
              :loading="detecting"
            >
              <ClusterOutlined />
              检测社区结构
            </a-button>

            <div v-if="communityResults" class="results">
              <a-statistic
                title="社区数量"
                :value="communityResults.count"
                style="margin-bottom: 16px"
              />

              <a-button
                block
                @click="highlightCommunities"
              >
                <BgColorsOutlined />
                高亮显示社区
              </a-button>

              <a-divider />

              <h4>社区分布</h4>
              <div
                v-for="(nodes, communityId) in communitiesGrouped"
                :key="communityId"
                class="community-item"
              >
                <a-tag :color="getCommunityColor(communityId)">
                  社区 {{ communityId }}
                </a-tag>
                <span>{{ nodes.length }} 个节点</span>
              </div>
            </div>
          </a-space>
        </a-tab-pane>

        <!-- 路径分析 -->
        <a-tab-pane key="path" tab="路径分析">
          <a-space direction="vertical" style="width: 100%">
            <a-select
              v-model:value="pathSource"
              placeholder="选择起点"
              show-search
              style="width: 100%"
              :options="nodeOptions"
              :filter-option="filterOption"
            />

            <a-select
              v-model:value="pathTarget"
              placeholder="选择终点"
              show-search
              style="width: 100%"
              :options="nodeOptions"
              :filter-option="filterOption"
            />

            <a-button
              type="primary"
              block
              @click="findShortestPath"
              :loading="finding"
              :disabled="!pathSource || !pathTarget"
            >
              <AimOutlined />
              查找最短路径
            </a-button>

            <div v-if="pathResult" class="results">
              <a-result
                v-if="pathResult.exists"
                status="success"
                :title="`找到路径 (距离: ${pathResult.distance})`"
              >
                <template #subTitle>
                  <div class="path-display">
                    <a-tag
                      v-for="(nodeId, index) in pathResult.path"
                      :key="nodeId"
                      color="blue"
                    >
                      {{ getNodeName(nodeId) }}
                      <ArrowRightOutlined v-if="index < pathResult.path.length - 1" />
                    </a-tag>
                  </div>
                </template>
                <template #extra>
                  <a-button @click="highlightPath">
                    高亮路径
                  </a-button>
                </template>
              </a-result>

              <a-result
                v-else
                status="warning"
                title="未找到路径"
                sub-title="这两个节点之间不存在连接"
              />
            </div>
          </a-space>
        </a-tab-pane>

        <!-- 邻居探索 -->
        <a-tab-pane key="neighbors" tab="邻居探索">
          <a-space direction="vertical" style="width: 100%">
            <a-select
              v-model:value="neighborNode"
              placeholder="选择节点"
              show-search
              style="width: 100%"
              :options="nodeOptions"
              :filter-option="filterOption"
            />

            <a-slider
              v-model:value="neighborHops"
              :min="1"
              :max="5"
              :marks="{ 1: '1跳', 2: '2跳', 3: '3跳', 4: '4跳', 5: '5跳' }"
            />

            <a-button
              type="primary"
              block
              @click="exploreNeighbors"
              :loading="exploring"
              :disabled="!neighborNode"
            >
              <RadarChartOutlined />
              探索邻居节点
            </a-button>

            <div v-if="neighborResults" class="results">
              <a-statistic
                title="邻居节点数量"
                :value="neighborResults.size"
                style="margin-bottom: 16px"
              />

              <a-button
                block
                @click="showNeighborSubgraph"
              >
                <ShareAltOutlined />
                显示子图
              </a-button>

              <a-divider />

              <h4>按距离分组</h4>
              <div
                v-for="(nodes, hop) in neighborsGrouped"
                :key="hop"
                class="hop-group"
              >
                <a-tag color="blue">{{ hop }}跳</a-tag>
                <span>{{ nodes.length }} 个节点</span>
              </div>
            </div>
          </a-space>
        </a-tab-pane>

        <!-- 导出 -->
        <a-tab-pane key="export" tab="导出">
          <a-space direction="vertical" style="width: 100%">
            <a-select
              v-model:value="exportFormat"
              placeholder="选择导出格式"
              style="width: 100%"
            >
              <a-select-option value="graphml">GraphML (.graphml)</a-select-option>
              <a-select-option value="gexf">GEXF (.gexf)</a-select-option>
              <a-select-option value="json">JSON (.json)</a-select-option>
              <a-select-option value="csv">CSV (.csv)</a-select-option>
              <a-select-option value="dot">DOT (.dot)</a-select-option>
              <a-select-option value="png">PNG图像 (.png)</a-select-option>
              <a-select-option value="svg">SVG矢量图 (.svg)</a-select-option>
            </a-select>

            <a-button
              type="primary"
              block
              @click="exportGraph"
              :loading="exporting"
              :disabled="!exportFormat"
            >
              <ExportOutlined />
              导出图谱
            </a-button>

            <a-alert
              message="导出说明"
              description="GraphML和GEXF格式可以导入到Gephi等专业图分析工具中进行进一步分析"
              type="info"
              show-icon
            />
          </a-space>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  CalculatorOutlined,
  ClusterOutlined,
  AimOutlined,
  RadarChartOutlined,
  ExportOutlined,
  BgColorsOutlined,
  ShareAltOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  nodes: {
    type: Array,
    required: true
  },
  edges: {
    type: Array,
    required: true
  }
});

// Emits
const emit = defineEmits(['node-click', 'highlight-communities', 'highlight-path', 'show-subgraph']);

// 状态
const activeTab = ref('centrality');
const calculating = ref(false);
const detecting = ref(false);
const finding = ref(false);
const exploring = ref(false);
const exporting = ref(false);

// 中心性分析
const centralityResults = ref(null);
const topDegreeCentrality = computed(() => {
  if (!centralityResults.value) return [];

  return Object.entries(centralityResults.value.degree)
    .map(([id, data]) => ({
      id,
      name: getNodeName(id),
      ...data
    }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);
});

const topPageRank = computed(() => {
  if (!centralityResults.value) return [];

  return Object.entries(centralityResults.value.pageRank)
    .map(([id, score]) => ({
      id,
      name: getNodeName(id),
      score
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
});

// 社区检测
const communityResults = ref(null);
const communitiesGrouped = computed(() => {
  if (!communityResults.value) return {};

  const groups = {};
  Object.entries(communityResults.value.communities).forEach(([nodeId, communityId]) => {
    if (!groups[communityId]) {
      groups[communityId] = [];
    }
    groups[communityId].push(nodeId);
  });

  return groups;
});

// 路径分析
const pathSource = ref(null);
const pathTarget = ref(null);
const pathResult = ref(null);

// 邻居探索
const neighborNode = ref(null);
const neighborHops = ref(2);
const neighborResults = ref(null);
const neighborsGrouped = computed(() => {
  if (!neighborResults.value) return {};

  const groups = {};
  neighborResults.value.forEach((hop, nodeId) => {
    if (!groups[hop]) {
      groups[hop] = [];
    }
    groups[hop].push(nodeId);
  });

  return groups;
});

// 导出
const exportFormat = ref('graphml');

// 节点选项
const nodeOptions = computed(() => {
  return props.nodes.map(node => ({
    value: node.id,
    label: node.name || node.id
  }));
});

// 方法
const calculateCentrality = async () => {
  calculating.value = true;

  try {
    const result = await window.electronAPI.knowledgeGraph.calculateCentrality(
      props.nodes,
      props.edges
    );

    centralityResults.value = result;
    message.success('中心性分析完成');
  } catch (error) {
    message.error('分析失败: ' + error.message);
  } finally {
    calculating.value = false;
  }
};

const detectCommunities = async () => {
  detecting.value = true;

  try {
    const result = await window.electronAPI.knowledgeGraph.detectCommunities(
      props.nodes,
      props.edges
    );

    communityResults.value = result;
    message.success(`检测到 ${result.count} 个社区`);
  } catch (error) {
    message.error('检测失败: ' + error.message);
  } finally {
    detecting.value = false;
  }
};

const findShortestPath = async () => {
  finding.value = true;

  try {
    const result = await window.electronAPI.knowledgeGraph.findShortestPath(
      props.nodes,
      props.edges,
      pathSource.value,
      pathTarget.value
    );

    pathResult.value = result;

    if (result.exists) {
      message.success(`找到路径，距离为 ${result.distance}`);
    } else {
      message.warning('未找到路径');
    }
  } catch (error) {
    message.error('查找失败: ' + error.message);
  } finally {
    finding.value = false;
  }
};

const exploreNeighbors = async () => {
  exploring.value = true;

  try {
    const result = await window.electronAPI.knowledgeGraph.getNHopNeighbors(
      props.nodes,
      props.edges,
      neighborNode.value,
      neighborHops.value
    );

    neighborResults.value = result;
    message.success(`找到 ${result.size} 个邻居节点`);
  } catch (error) {
    message.error('探索失败: ' + error.message);
  } finally {
    exploring.value = false;
  }
};

const exportGraph = async () => {
  exporting.value = true;

  try {
    const result = await window.electronAPI.knowledgeGraph.exportGraph(
      props.nodes,
      props.edges,
      exportFormat.value
    );

    message.success(`图谱已导出到: ${result.path}`);
  } catch (error) {
    message.error('导出失败: ' + error.message);
  } finally {
    exporting.value = false;
  }
};

const highlightCommunities = () => {
  if (communityResults.value) {
    emit('highlight-communities', communityResults.value.communities);
  }
};

const highlightPath = () => {
  if (pathResult.value && pathResult.value.exists) {
    emit('highlight-path', pathResult.value.path);
  }
};

const showNeighborSubgraph = () => {
  if (neighborResults.value) {
    const nodeIds = [neighborNode.value, ...Array.from(neighborResults.value.keys())];
    emit('show-subgraph', nodeIds);
  }
};

const getNodeName = (nodeId) => {
  const node = props.nodes.find(n => n.id === nodeId);
  return node ? (node.name || node.id) : nodeId;
};

const getCommunityColor = (communityId) => {
  const colors = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta', 'red', 'volcano'];
  return colors[communityId % colors.length];
};

const filterOption = (input, option) => {
  return option.label.toLowerCase().includes(input.toLowerCase());
};
</script>

<style scoped lang="less">
.graph-analytics-panel {
  .results {
    margin-top: 16px;

    h4 {
      margin-bottom: 12px;
      font-weight: 600;
    }
  }

  .community-item,
  .hop-group {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #f0f0f0;

    &:last-child {
      border-bottom: none;
    }
  }

  .path-display {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 16px;
  }
}
</style>
