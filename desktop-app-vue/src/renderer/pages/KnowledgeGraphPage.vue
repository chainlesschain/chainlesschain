<template>
  <div class="knowledge-graph-page">
    <a-layout>
      <!-- 侧边栏 - 控制面板 -->
      <a-layout-sider
        v-model:collapsed="collapsed"
        :width="300"
        collapsible
        theme="light"
        class="control-panel"
      >
        <div class="panel-content">
          <a-space direction="vertical" :size="16" style="width: 100%">
            <!-- 统计信息 -->
            <a-card title="图谱统计" size="small">
              <a-statistic-group>
                <a-row :gutter="[16, 16]">
                  <a-col :span="12">
                    <a-statistic
                      title="节点数"
                      :value="graphStore.stats.totalNodes"
                      :value-style="{ color: '#3f8600' }"
                    >
                      <template #prefix>
                        <NodeIndexOutlined />
                      </template>
                    </a-statistic>
                  </a-col>
                  <a-col :span="12">
                    <a-statistic
                      title="关系数"
                      :value="graphStore.stats.totalEdges"
                      :value-style="{ color: '#1890ff' }"
                    >
                      <template #prefix>
                        <LinkOutlined />
                      </template>
                    </a-statistic>
                  </a-col>
                </a-row>
              </a-statistic-group>

              <a-divider />

              <a-descriptions :column="1" size="small">
                <a-descriptions-item label="链接">
                  {{ graphStore.stats.linkRelations }}
                </a-descriptions-item>
                <a-descriptions-item label="标签">
                  {{ graphStore.stats.tagRelations }}
                </a-descriptions-item>
                <a-descriptions-item label="语义">
                  {{ graphStore.stats.semanticRelations }}
                </a-descriptions-item>
                <a-descriptions-item label="时间">
                  {{ graphStore.stats.temporalRelations }}
                </a-descriptions-item>
              </a-descriptions>
            </a-card>

            <!-- 筛选选项 -->
            <a-card title="筛选选项" size="small">
              <a-form layout="vertical">
                <a-form-item label="关系类型">
                  <a-checkbox-group
                    v-model:value="filters.relationTypes"
                    :options="relationTypeOptions"
                    @change="handleFilterChange"
                  />
                </a-form-item>

                <a-form-item label="节点类型">
                  <a-checkbox-group
                    v-model:value="filters.nodeTypes"
                    :options="nodeTypeOptions"
                    @change="handleFilterChange"
                  />
                </a-form-item>

                <a-form-item label="最小权重">
                  <a-slider
                    v-model:value="filters.minWeight"
                    :min="0"
                    :max="1"
                    :step="0.1"
                    :marks="{ 0: '0', 0.5: '0.5', 1: '1' }"
                    @change="handleFilterChange"
                  />
                </a-form-item>

                <a-form-item label="节点数量限制">
                  <a-input-number
                    v-model:value="filters.limit"
                    :min="10"
                    :max="1000"
                    :step="50"
                    style="width: 100%"
                    @change="handleFilterChange"
                  />
                </a-form-item>
              </a-form>
            </a-card>

            <!-- 操作按钮 -->
            <a-card title="图谱操作" size="small">
              <a-space direction="vertical" style="width: 100%">
                <a-button
                  type="primary"
                  block
                  :loading="graphStore.processing"
                  @click="handleProcessAllNotes"
                >
                  <template #icon><ThunderboltOutlined /></template>
                  重建图谱
                </a-button>

                <a-button
                  block
                  :loading="graphStore.processing"
                  @click="handleBuildTagRelations"
                >
                  <template #icon><TagsOutlined /></template>
                  重建标签关系
                </a-button>

                <a-button
                  block
                  :loading="graphStore.processing"
                  @click="handleBuildTemporalRelations"
                >
                  <template #icon><ClockCircleOutlined /></template>
                  重建时间关系
                </a-button>

                <a-button
                  block
                  :loading="graphStore.loading"
                  @click="handleRefresh"
                >
                  <template #icon><ReloadOutlined /></template>
                  刷新数据
                </a-button>
              </a-space>
            </a-card>
          </a-space>
        </div>
      </a-layout-sider>

      <!-- 主内容区 - 图谱画布 -->
      <a-layout-content class="graph-content">
        <a-spin :spinning="graphStore.loading" tip="加载图谱数据...">
          <div v-if="!graphStore.hasData" class="empty-state">
            <a-empty description="暂无图谱数据">
              <a-button type="primary" @click="handleProcessAllNotes">
                开始构建图谱
              </a-button>
            </a-empty>
          </div>

          <GraphCanvas
            v-else
            :nodes="graphStore.nodes"
            :edges="graphStore.edges"
            :layout="graphStore.layout"
            @node-click="handleNodeClick"
            @open-note="handleOpenNote"
          />
        </a-spin>
      </a-layout-content>
    </a-layout>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useRouter } from 'vue-router';
import {
  NodeIndexOutlined,
  LinkOutlined,
  ThunderboltOutlined,
  TagsOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import { useGraphStore } from '../stores/graph';
import GraphCanvas from '../components/graph/GraphCanvasOptimized.vue';

const router = useRouter();
const graphStore = useGraphStore();

const collapsed = ref(false);

// 筛选选项
const filters = reactive({
  relationTypes: ['link', 'tag', 'semantic', 'temporal'],
  nodeTypes: ['note', 'document', 'conversation', 'web_clip'],
  minWeight: 0.0,
  limit: 500,
});

const relationTypeOptions = [
  { label: '链接关系', value: 'link' },
  { label: '标签关系', value: 'tag' },
  { label: '语义关系', value: 'semantic' },
  { label: '时间关系', value: 'temporal' },
];

const nodeTypeOptions = [
  { label: '笔记', value: 'note' },
  { label: '文档', value: 'document' },
  { label: '对话', value: 'conversation' },
  { label: '网页剪藏', value: 'web_clip' },
];

/**
 * 加载图谱数据
 */
const loadGraphData = async () => {
  try {
    await graphStore.loadGraphData(filters);
  } catch (error) {
    message.error('加载图谱数据失败: ' + error.message);
  }
};

/**
 * 处理筛选变化
 */
const handleFilterChange = () => {
  graphStore.updateFilters(filters);
  loadGraphData();
};

/**
 * 处理重建图谱
 */
const handleProcessAllNotes = async () => {
  try {
    const result = await graphStore.processAllNotes();
    message.success(
      `图谱重建完成！处理了 ${result.processed} 个笔记，创建了 ${
        result.linkRelations + result.tagRelations + result.temporalRelations
      } 个关系`
    );
  } catch (error) {
    message.error('重建图谱失败: ' + error.message);
  }
};

/**
 * 处理重建标签关系
 */
const handleBuildTagRelations = async () => {
  try {
    const count = await graphStore.buildTagRelations();
    message.success(`重建标签关系完成！创建了 ${count} 个关系`);
  } catch (error) {
    message.error('重建标签关系失败: ' + error.message);
  }
};

/**
 * 处理重建时间关系
 */
const handleBuildTemporalRelations = async () => {
  try {
    const count = await graphStore.buildTemporalRelations(7);
    message.success(`重建时间关系完成！创建了 ${count} 个关系`);
  } catch (error) {
    message.error('重建时间关系失败: ' + error.message);
  }
};

/**
 * 刷新数据
 */
const handleRefresh = async () => {
  await loadGraphData();
  message.success('数据已刷新');
};

/**
 * 处理节点点击
 */
const handleNodeClick = (node) => {
  console.log('节点被点击:', node);
};

/**
 * 打开笔记
 */
const handleOpenNote = (noteId) => {
  router.push({
    name: 'KnowledgeDetail',
    params: { id: noteId },
  });
};

onMounted(async () => {
  // 初始化筛选选项
  graphStore.updateFilters(filters);
  // 加载图谱数据
  await loadGraphData();
});
</script>

<style scoped>
.knowledge-graph-page {
  height: 100vh;
  overflow: hidden;
}

.control-panel {
  background: white;
  border-right: 1px solid #f0f0f0;
  overflow-y: auto;
}

.panel-content {
  padding: 16px;
}

.graph-content {
  position: relative;
  height: 100vh;
  background: #f5f5f5;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

:deep(.ant-layout-sider-children) {
  display: flex;
  flex-direction: column;
}

:deep(.ant-statistic-content) {
  font-size: 18px;
}

:deep(.ant-checkbox-group) {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
