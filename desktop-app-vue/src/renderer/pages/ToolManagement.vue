<template>
  <div class="tool-management">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>工具管理</h1>
        <p class="subtitle">管理和测试 AI 助手的工具库</p>
      </div>
      <div class="header-right">
        <a-statistic-group direction="horizontal">
          <a-statistic :value="toolStore.totalCount" title="总工具数" />
          <a-statistic :value="toolStore.enabledCount" title="已启用" :value-style="{ color: '#52c41a' }" />
          <a-statistic :value="toolStore.builtinCount" title="内置工具" :value-style="{ color: '#1890ff' }" />
          <a-statistic :value="toolStore.pluginCount" title="插件工具" :value-style="{ color: '#722ed1' }" />
        </a-statistic-group>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <a-space>
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="搜索工具..."
          style="width: 300px"
          allow-clear
          @search="handleSearch"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input-search>

        <a-select
          v-model:value="categoryFilter"
          placeholder="分类筛选"
          style="width: 150px"
          @change="handleCategoryChange"
        >
          <a-select-option value="all">全部分类</a-select-option>
          <a-select-option value="file">文件操作</a-select-option>
          <a-select-option value="code">代码生成</a-select-option>
          <a-select-option value="project">项目管理</a-select-option>
          <a-select-option value="system">系统操作</a-select-option>
          <a-select-option value="output">输出格式化</a-select-option>
          <a-select-option value="general">通用</a-select-option>
        </a-select>

        <a-select
          v-model:value="statusFilter"
          placeholder="状态筛选"
          style="width: 120px"
          @change="handleStatusChange"
        >
          <a-select-option value="all">全部状态</a-select-option>
          <a-select-option value="enabled">已启用</a-select-option>
          <a-select-option value="disabled">已禁用</a-select-option>
        </a-select>

        <a-button @click="handleRefresh" :loading="toolStore.loading">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>

      <a-space>
        <a-button type="primary" @click="handleCreateTool">
          <template #icon><PlusOutlined /></template>
          创建工具
        </a-button>
        <a-button type="link" @click="showAnalytics">
          <template #icon><BarChartOutlined /></template>
          使用统计
        </a-button>
        <a-button type="link" @click="showDependencyGraph">
          <template #icon><ApartmentOutlined /></template>
          依赖关系图
        </a-button>
      </a-space>
    </div>

    <!-- 工具列表 -->
    <div v-if="toolStore.loading" class="loading-container">
      <a-spin size="large" tip="加载中..."></a-spin>
    </div>

    <div v-else-if="toolStore.filteredTools.length === 0" class="empty-container">
      <a-empty description="暂无工具数据" />
    </div>

    <div v-else class="tool-list">
      <a-table
        :columns="columns"
        :data-source="toolStore.filteredTools"
        :row-key="record => record.id"
        :pagination="pagination"
        @change="handleTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div class="tool-name-cell">
              <strong>{{ record.display_name || record.name }}</strong>
              <div class="tool-description">{{ record.description || '-' }}</div>
            </div>
          </template>

          <template v-if="column.key === 'category'">
            <a-tag :color="getCategoryColor(record.category)">
              {{ getCategoryName(record.category) }}
            </a-tag>
          </template>

          <template v-if="column.key === 'type'">
            <a-tag>{{ record.tool_type }}</a-tag>
          </template>

          <template v-if="column.key === 'risk_level'">
            <a-tag :color="getRiskColor(record.risk_level)">
              {{ getRiskLabel(record.risk_level) }}
            </a-tag>
          </template>

          <template v-if="column.key === 'enabled'">
            <a-switch
              :checked="record.enabled === 1"
              :loading="switchingIds.has(record.id)"
              @change="() => handleToggleEnabled(record)"
              size="small"
            />
          </template>

          <template v-if="column.key === 'usage'">
            <a-space direction="vertical" size="small">
              <div>
                <span style="color: #8c8c8c; font-size: 12px">调用: </span>
                <strong>{{ record.usage_count || 0 }}</strong>
              </div>
              <div>
                <span style="color: #8c8c8c; font-size: 12px">成功率: </span>
                <strong :style="{ color: getSuccessRateColor(record) }">
                  {{ getSuccessRate(record) }}%
                </strong>
              </div>
            </a-space>
          </template>

          <template v-if="column.key === 'source'">
            <a-tag v-if="record.is_builtin" color="blue">内置</a-tag>
            <a-tag v-else-if="record.plugin_id" color="purple">
              插件
            </a-tag>
            <a-tag v-else>自定义</a-tag>
          </template>

          <template v-if="column.key === 'actions'">
            <a-space size="small">
              <a-button type="link" size="small" @click="handleViewDetails(record)">
                详情
              </a-button>
              <a-button type="link" size="small" @click="handleViewDoc(record)">
                文档
              </a-button>
              <a-button type="link" size="small" @click="handleTestTool(record)">
                测试
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <!-- 详情抽屉 -->
    <a-drawer
      v-model:open="detailsVisible"
      title="工具详情"
      :width="720"
      placement="right"
    >
      <ToolDetails
        v-if="currentTool"
        :tool="currentTool"
        @update="handleUpdateTool"
        @close="detailsVisible = false"
      />
    </a-drawer>

    <!-- 文档查看器 -->
    <a-drawer
      v-model:open="docVisible"
      title="工具文档"
      :width="800"
      placement="right"
    >
      <MarkdownViewer
        v-if="currentDoc"
        :content="currentDoc"
      />
      <a-spin v-else-if="loadingDoc" />
    </a-drawer>

    <!-- 测试工具模态框 -->
    <a-modal
      v-model:open="testVisible"
      title="测试工具"
      :width="700"
      @ok="runTest"
      :confirm-loading="testing"
    >
      <ToolTester
        v-if="currentTool"
        :tool="currentTool"
        v-model:params="testParams"
        v-model:result="testResult"
      />
    </a-modal>

    <!-- 工具编辑器模态框 -->
    <ToolEditor
      v-model:visible="editorVisible"
      :tool="editingTool"
      @save="handleSaveTool"
    />

    <!-- 工具统计分析模态框 -->
    <a-modal
      v-model:open="statsVisible"
      title="工具统计分析"
      :width="1200"
      :footer="null"
    >
      <ToolStats :tools="toolStore.tools" />
    </a-modal>

    <!-- 依赖关系图模态框 -->
    <a-modal
      v-model:open="graphVisible"
      title="技能-工具依赖关系图"
      :width="1400"
      :footer="null"
    >
      <SkillDependencyGraph
        :skills="allSkills"
        :tools="toolStore.tools"
        :skillTools="allSkillTools"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  ApartmentOutlined,
  BarChartOutlined,
} from '@ant-design/icons-vue';
import { useToolStore } from '../stores/tool';
import { useSkillStore } from '../stores/skill';
import ToolDetails from '../components/tool/ToolDetails.vue';
import ToolEditor from '../components/tool/ToolEditor.vue';
import ToolStats from '../components/tool/ToolStats.vue';
import ToolTester from '../components/tool/ToolTester.vue';
import SkillDependencyGraph from '../components/skill/SkillDependencyGraph.vue';
import MarkdownViewer from '../components/common/MarkdownViewer.vue';

const toolStore = useToolStore();
const skillStore = useSkillStore();

// 搜索和筛选
const searchKeyword = ref('');
const categoryFilter = ref('all');
const statusFilter = ref('all');

// 切换状态的工具ID集合
const switchingIds = ref(new Set());

// 详情抽屉
const detailsVisible = ref(false);
const currentTool = ref(null);

// 文档查看
const docVisible = ref(false);
const currentDoc = ref(null);
const loadingDoc = ref(false);

// 测试工具
const testVisible = ref(false);
const testing = ref(false);
const testParams = ref({});
const testResult = ref(null);

// 工具编辑
const editorVisible = ref(false);
const editingTool = ref(null);

// 统计分析
const statsVisible = ref(false);

// 依赖关系图
const graphVisible = ref(false);
const allSkills = ref([]);
const allSkillTools = ref([]);

// 分页
const pagination = reactive({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`,
});

// 表格列定义
const columns = [
  {
    title: '工具名称',
    key: 'name',
    width: 250,
  },
  {
    title: '分类',
    key: 'category',
    width: 120,
  },
  {
    title: '类型',
    key: 'type',
    width: 100,
  },
  {
    title: '风险等级',
    key: 'risk_level',
    width: 100,
  },
  {
    title: '使用情况',
    key: 'usage',
    width: 120,
  },
  {
    title: '来源',
    key: 'source',
    width: 100,
  },
  {
    title: '状态',
    key: 'enabled',
    width: 80,
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    fixed: 'right',
  },
];

// 初始化
onMounted(async () => {
  await toolStore.fetchAll();
  await skillStore.fetchAll();
  pagination.total = toolStore.totalCount;
  allSkills.value = skillStore.skills;
});

// 搜索处理
const handleSearch = () => {
  toolStore.setSearchKeyword(searchKeyword.value);
};

// 分类筛选
const handleCategoryChange = () => {
  toolStore.setCategoryFilter(categoryFilter.value);
};

// 状态筛选
const handleStatusChange = () => {
  toolStore.setStatusFilter(statusFilter.value);
};

// 刷新
const handleRefresh = async () => {
  await toolStore.fetchAll();
  pagination.total = toolStore.totalCount;
  message.success('刷新成功');
};

// 表格变化
const handleTableChange = (pag) => {
  pagination.current = pag.current;
  pagination.pageSize = pag.pageSize;
};

// 查看详情
const handleViewDetails = async (tool) => {
  currentTool.value = tool;
  detailsVisible.value = true;

  // 加载完整数据
  await toolStore.fetchById(tool.id);
  currentTool.value = toolStore.currentTool;
};

// 切换启用/禁用
const handleToggleEnabled = async (tool) => {
  const action = tool.enabled ? '禁用' : '启用';
  switchingIds.value.add(tool.id);

  try {
    const success = tool.enabled
      ? await toolStore.disable(tool.id)
      : await toolStore.enable(tool.id);

    if (success) {
      message.success(`${action}工具成功`);
    } else {
      message.error(`${action}工具失败`);
    }
  } catch (error) {
    console.error(error);
    message.error(`${action}工具失败`);
  } finally {
    switchingIds.value.delete(tool.id);
  }
};

// 查看文档
const handleViewDoc = async (tool) => {
  docVisible.value = true;
  loadingDoc.value = true;
  currentDoc.value = null;

  try {
    const doc = await toolStore.fetchDoc(tool.id);
    currentDoc.value = doc;
  } catch (error) {
    console.error(error);
    message.error('加载文档失败');
  } finally {
    loadingDoc.value = false;
  }
};

// 测试工具
const handleTestTool = (tool) => {
  currentTool.value = tool;
  testParams.value = {};
  testResult.value = null;
  testVisible.value = true;
};

// 运行测试
const runTest = async () => {
  testing.value = true;
  try {
    const result = await toolStore.test(currentTool.value.id, testParams.value);
    testResult.value = result;
    message.success('测试完成');
  } catch (error) {
    console.error(error);
    message.error('测试失败');
  } finally {
    testing.value = false;
  }
};

// 更新工具
const handleUpdateTool = async (toolId, updates) => {
  const success = await toolStore.update(toolId, updates);
  if (success) {
    message.success('更新成功');
    await toolStore.fetchById(toolId);
    currentTool.value = toolStore.currentTool;
  } else {
    message.error('更新失败');
  }
};

// 创建工具
const handleCreateTool = () => {
  editingTool.value = null;
  editorVisible.value = true;
};

// 保存工具
const handleSaveTool = async (toolData) => {
  try {
    let success;
    if (editingTool.value) {
      // 更新现有工具
      success = await toolStore.update(editingTool.value.id, toolData);
    } else {
      // 创建新工具
      success = await toolStore.create(toolData);
    }

    if (success) {
      message.success(editingTool.value ? '更新成功' : '创建成功');
      editorVisible.value = false;
      await toolStore.fetchAll();
    } else {
      message.error(editingTool.value ? '更新失败' : '创建失败');
    }
  } catch (error) {
    console.error(error);
    message.error('操作失败');
  }
};

// 显示依赖关系图
const showDependencyGraph = async () => {
  try {
    const relations = await window.electron.invoke('skill-tool:get-all-relations');
    allSkillTools.value = relations;
    graphVisible.value = true;
  } catch (error) {
    console.error(error);
    message.error('加载依赖关系失败');
  }
};

// 显示使用分析
const showAnalytics = () => {
  statsVisible.value = true;
};

// 辅助函数
const getCategoryColor = (category) => {
  const colorMap = {
    file: 'blue',
    code: 'cyan',
    project: 'green',
    system: 'volcano',
    output: 'orange',
    general: 'default',
  };
  return colorMap[category] || 'default';
};

const getCategoryName = (category) => {
  const nameMap = {
    file: '文件操作',
    code: '代码生成',
    project: '项目管理',
    system: '系统操作',
    output: '输出格式化',
    general: '通用',
  };
  return nameMap[category] || category;
};

const getRiskColor = (level) => {
  const colorMap = {
    1: 'success',
    2: 'warning',
    3: 'orange',
    4: 'error',
    5: 'red',
  };
  return colorMap[level] || 'default';
};

const getRiskLabel = (level) => {
  const labelMap = {
    1: '低',
    2: '中',
    3: '较高',
    4: '高',
    5: '极高',
  };
  return labelMap[level] || '未知';
};

const getSuccessRate = (tool) => {
  if (!tool.usage_count || tool.usage_count === 0) return 0;
  return ((tool.success_count / tool.usage_count) * 100).toFixed(1);
};

const getSuccessRateColor = (tool) => {
  const rate = getSuccessRate(tool);
  if (rate >= 90) return '#52c41a';
  if (rate >= 70) return '#faad14';
  return '#ff4d4f';
};
</script>

<style scoped lang="scss">
.tool-management {
  padding: 24px;
  background: #f0f2f5;
  min-height: 100vh;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    background: white;
    padding: 24px;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);

    .header-left {
      h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        color: #262626;
      }

      .subtitle {
        margin: 4px 0 0;
        color: #8c8c8c;
        font-size: 14px;
      }
    }

    .header-right {
      :deep(.ant-statistic) {
        margin-left: 32px;

        .ant-statistic-title {
          font-size: 14px;
          color: #8c8c8c;
        }

        .ant-statistic-content {
          font-size: 24px;
          font-weight: 600;
        }
      }
    }
  }

  .toolbar {
    background: white;
    padding: 16px 24px;
    border-radius: 8px;
    margin-bottom: 16px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .loading-container,
  .empty-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
    background: white;
    border-radius: 8px;
  }

  .tool-list {
    background: white;
    border-radius: 8px;
    padding: 24px;

    .tool-name-cell {
      strong {
        display: block;
        margin-bottom: 4px;
        color: #262626;
      }

      .tool-description {
        font-size: 12px;
        color: #8c8c8c;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    }
  }
}
</style>
