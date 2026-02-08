<template>
  <div class="graph-interaction-panel">
    <!-- 搜索节点 -->
    <a-card title="搜索节点" size="small" class="panel-card">
      <a-input-search
        v-model:value="searchQuery"
        placeholder="搜索笔记标题..."
        @search="handleSearch"
        @change="handleSearchChange"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input-search>

      <!-- 搜索结果 -->
      <div v-if="searchResults.length > 0" class="search-results">
        <a-list size="small" :data-source="searchResults">
          <template #renderItem="{ item }">
            <a-list-item @click="selectNode(item)">
              <a-list-item-meta>
                <template #title>
                  <a-typography-text :ellipsis="true">
                    {{ item.title }}
                  </a-typography-text>
                </template>
                <template #description>
                  <a-tag size="small">
                    {{ getNodeTypeLabel(item.type) }}
                  </a-tag>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-card>

    <!-- 节点筛选 -->
    <a-card title="节点筛选" size="small" class="panel-card">
      <a-form layout="vertical" size="small">
        <a-form-item label="节点类型">
          <a-checkbox-group
            v-model:value="selectedNodeTypes"
            :options="nodeTypeOptions"
            @change="handleFilterChange"
          />
        </a-form-item>

        <a-form-item label="关系类型">
          <a-checkbox-group
            v-model:value="selectedRelationTypes"
            :options="relationTypeOptions"
            @change="handleFilterChange"
          />
        </a-form-item>

        <a-form-item label="最小关联数">
          <a-slider
            v-model:value="minRelationCount"
            :min="0"
            :max="20"
            :marks="{ 0: '0', 10: '10', 20: '20' }"
            @change="handleFilterChange"
          />
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 路径查找 -->
    <a-card title="路径查找" size="small" class="panel-card">
      <a-form layout="vertical" size="small">
        <a-form-item label="起点">
          <a-select
            v-model:value="pathStart"
            show-search
            placeholder="选择起点节点"
            :options="nodeOptions"
            :filter-option="filterNodeOption"
          />
        </a-form-item>

        <a-form-item label="终点">
          <a-select
            v-model:value="pathEnd"
            show-search
            placeholder="选择终点节点"
            :options="nodeOptions"
            :filter-option="filterNodeOption"
          />
        </a-form-item>

        <a-form-item>
          <a-button
            type="primary"
            block
            :disabled="!pathStart || !pathEnd"
            @click="findPath"
          >
            <template #icon>
              <AimOutlined />
            </template>
            查找路径
          </a-button>
        </a-form-item>
      </a-form>

      <!-- 路径结果 -->
      <div v-if="pathResult" class="path-result">
        <a-alert
          :message="`找到 ${pathResult.length} 条路径`"
          type="success"
          show-icon
        />
        <a-list size="small" :data-source="pathResult">
          <template #renderItem="{ item, index }">
            <a-list-item @click="highlightPath(item)">
              <a-list-item-meta>
                <template #title>
                  路径 {{ index + 1 }} ({{ item.length }} 步)
                </template>
                <template #description>
                  <a-typography-text :ellipsis="{ rows: 2 }">
                    {{ formatPath(item) }}
                  </a-typography-text>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-card>

    <!-- 社区检测 -->
    <a-card title="社区检测" size="small" class="panel-card">
      <a-space direction="vertical" style="width: 100%">
        <a-button
          type="primary"
          block
          :loading="detectingCommunities"
          @click="detectCommunities"
        >
          <template #icon>
            <ClusterOutlined />
          </template>
          检测社区
        </a-button>

        <div v-if="communities.length > 0">
          <a-statistic
            title="社区数量"
            :value="communities.length"
            :value-style="{ color: '#3f8600' }"
          />

          <a-list size="small" :data-source="communities">
            <template #renderItem="{ item, index }">
              <a-list-item @click="highlightCommunity(item)">
                <a-list-item-meta>
                  <template #title> 社区 {{ index + 1 }} </template>
                  <template #description>
                    {{ item.nodes.length }} 个节点
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-tag :color="item.color">
                    {{ item.label }}
                  </a-tag>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </a-space>
    </a-card>

    <!-- 中心性分析 -->
    <a-card title="中心性分析" size="small" class="panel-card">
      <a-space direction="vertical" style="width: 100%">
        <a-button
          type="primary"
          block
          :loading="analyzingCentrality"
          @click="analyzeCentrality"
        >
          <template #icon>
            <DotChartOutlined />
          </template>
          分析中心性
        </a-button>

        <div v-if="centralityResults.length > 0">
          <a-tabs size="small">
            <a-tab-pane key="degree" tab="度中心性">
              <a-list
                size="small"
                :data-source="centralityResults.slice(0, 10)"
              >
                <template #renderItem="{ item }">
                  <a-list-item @click="selectNode(item.node)">
                    <a-list-item-meta>
                      <template #title>
                        {{ item.node.title }}
                      </template>
                      <template #description>
                        度数: {{ item.degree }}
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </a-tab-pane>

            <a-tab-pane key="betweenness" tab="介数中心性">
              <a-list
                size="small"
                :data-source="betweennessResults.slice(0, 10)"
              >
                <template #renderItem="{ item }">
                  <a-list-item @click="selectNode(item.node)">
                    <a-list-item-meta>
                      <template #title>
                        {{ item.node.title }}
                      </template>
                      <template #description>
                        介数: {{ item.betweenness.toFixed(2) }}
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </a-tab-pane>
          </a-tabs>
        </div>
      </a-space>
    </a-card>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  SearchOutlined,
  AimOutlined,
  ClusterOutlined,
  DotChartOutlined,
} from "@ant-design/icons-vue";

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

const emit = defineEmits([
  "filter-change",
  "node-select",
  "path-highlight",
  "community-highlight",
]);

// 搜索
const searchQuery = ref("");
const searchResults = ref([]);

// 筛选
const selectedNodeTypes = ref(["note", "document", "conversation", "web_clip"]);
const selectedRelationTypes = ref(["link", "tag", "semantic", "temporal"]);
const minRelationCount = ref(0);

// 路径查找
const pathStart = ref(null);
const pathEnd = ref(null);
const pathResult = ref(null);

// 社区检测
const detectingCommunities = ref(false);
const communities = ref([]);

// 中心性分析
const analyzingCentrality = ref(false);
const centralityResults = ref([]);
const betweennessResults = ref([]);

// 选项
const nodeTypeOptions = [
  { label: "笔记", value: "note" },
  { label: "文档", value: "document" },
  { label: "对话", value: "conversation" },
  { label: "网页剪藏", value: "web_clip" },
];

const relationTypeOptions = [
  { label: "链接关系", value: "link" },
  { label: "标签关系", value: "tag" },
  { label: "语义关系", value: "semantic" },
  { label: "时间关系", value: "temporal" },
];

const nodeOptions = computed(() => {
  return props.nodes.map((node) => ({
    label: node.title,
    value: node.id,
  }));
});

// 搜索处理
const handleSearch = () => {
  if (!searchQuery.value.trim()) {
    searchResults.value = [];
    return;
  }

  const query = searchQuery.value.toLowerCase();
  searchResults.value = props.nodes
    .filter((node) => node.title.toLowerCase().includes(query))
    .slice(0, 10);
};

const handleSearchChange = () => {
  if (!searchQuery.value.trim()) {
    searchResults.value = [];
  }
};

// 筛选处理
const handleFilterChange = () => {
  emit("filter-change", {
    nodeTypes: selectedNodeTypes.value,
    relationTypes: selectedRelationTypes.value,
    minRelationCount: minRelationCount.value,
  });
};

// 节点选择
const selectNode = (node) => {
  emit("node-select", node);
};

// 路径查找
const findPath = async () => {
  try {
    const result = await window.electronAPI.graph.findPath(
      pathStart.value,
      pathEnd.value,
    );
    pathResult.value = result;
    message.success(`找到 ${result.length} 条路径`);
  } catch (error) {
    logger.error("查找路径失败:", error);
    message.error("查找路径失败");
  }
};

const highlightPath = (path) => {
  emit("path-highlight", path);
};

const formatPath = (path) => {
  return path
    .map((nodeId) => {
      const node = props.nodes.find((n) => n.id === nodeId);
      return node ? node.title : nodeId;
    })
    .join(" → ");
};

// 社区检测
const detectCommunities = async () => {
  detectingCommunities.value = true;
  try {
    const result = await window.electronAPI.graph.detectCommunities();
    communities.value = result.map((community, index) => ({
      ...community,
      color: getColorForCommunity(index),
      label: `社区${index + 1}`,
    }));
    message.success(`检测到 ${result.length} 个社区`);
  } catch (error) {
    logger.error("社区检测失败:", error);
    message.error("社区检测失败");
  } finally {
    detectingCommunities.value = false;
  }
};

const highlightCommunity = (community) => {
  emit("community-highlight", community);
};

// 中心性分析
const analyzeCentrality = async () => {
  analyzingCentrality.value = true;
  try {
    const result = await window.electronAPI.graph.analyzeCentrality();

    // 度中心性
    centralityResults.value = result.degree
      .map((item) => ({
        node: props.nodes.find((n) => n.id === item.nodeId),
        degree: item.value,
      }))
      .filter((item) => item.node)
      .sort((a, b) => b.degree - a.degree);

    // 介数中心性
    betweennessResults.value = result.betweenness
      .map((item) => ({
        node: props.nodes.find((n) => n.id === item.nodeId),
        betweenness: item.value,
      }))
      .filter((item) => item.node)
      .sort((a, b) => b.betweenness - a.betweenness);

    message.success("中心性分析完成");
  } catch (error) {
    logger.error("中心性分析失败:", error);
    message.error("中心性分析失败");
  } finally {
    analyzingCentrality.value = false;
  }
};

// 工具函数
const getNodeTypeLabel = (type) => {
  const labels = {
    note: "笔记",
    document: "文档",
    conversation: "对话",
    web_clip: "网页剪藏",
  };
  return labels[type] || type;
};

const filterNodeOption = (input, option) => {
  return option.label.toLowerCase().includes(input.toLowerCase());
};

const getColorForCommunity = (index) => {
  const colors = [
    "#1890ff",
    "#52c41a",
    "#faad14",
    "#f5222d",
    "#722ed1",
    "#13c2c2",
    "#eb2f96",
    "#fa8c16",
  ];
  return colors[index % colors.length];
};
</script>

<style scoped lang="scss">
.graph-interaction-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  height: 100%;
  overflow-y: auto;
}

.panel-card {
  :deep(.ant-card-body) {
    padding: 12px;
  }
}

.search-results {
  margin-top: 12px;
  max-height: 300px;
  overflow-y: auto;

  .ant-list-item {
    cursor: pointer;
    transition: background 0.3s;

    &:hover {
      background: #f5f5f5;
    }
  }
}

.path-result {
  margin-top: 12px;

  .ant-alert {
    margin-bottom: 12px;
  }

  .ant-list-item {
    cursor: pointer;
    transition: background 0.3s;

    &:hover {
      background: #f5f5f5;
    }
  }
}

:deep(.ant-checkbox-group) {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

:deep(.ant-list-item) {
  padding: 8px 12px;
}

:deep(.ant-list-item-meta-title) {
  margin-bottom: 4px;
}
</style>
