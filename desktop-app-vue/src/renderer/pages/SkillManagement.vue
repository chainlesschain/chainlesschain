<template>
  <div class="skill-management">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>技能管理</h1>
        <p class="subtitle">管理和配置 AI 助手的技能集</p>
      </div>
      <div class="header-right">
        <a-space :size="24" align="center">
          <a-statistic :value="skillStore.totalCount" title="总技能数" />
          <a-statistic :value="skillStore.enabledCount" title="已启用" :value-style="{ color: '#52c41a' }" />
          <a-statistic
            :value="skillStore.totalCount - skillStore.enabledCount"
            title="已禁用"
            :value-style="{ color: '#ff4d4f' }"
          />
        </a-space>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <a-space>
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="搜索技能..."
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
          <a-select-option value="code">代码开发</a-select-option>
          <a-select-option value="web">Web开发</a-select-option>
          <a-select-option value="data">数据处理</a-select-option>
          <a-select-option value="content">内容创作</a-select-option>
          <a-select-option value="document">文档处理</a-select-option>
          <a-select-option value="media">媒体处理</a-select-option>
          <a-select-option value="ai">AI功能</a-select-option>
          <a-select-option value="system">系统操作</a-select-option>
          <a-select-option value="network">网络请求</a-select-option>
          <a-select-option value="automation">自动化</a-select-option>
          <a-select-option value="project">项目管理</a-select-option>
          <a-select-option value="template">模板应用</a-select-option>
        </a-select>

        <a-button @click="handleRefresh" :loading="skillStore.loading">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>

      <a-space>
        <a-button type="primary" @click="handleCreateSkill">
          <template #icon><PlusOutlined /></template>
          创建技能
        </a-button>
        <a-button type="link" @click="showStats">
          <template #icon><BarChartOutlined /></template>
          统计分析
        </a-button>
        <a-button type="link" @click="showDependencyGraph">
          <template #icon><ApartmentOutlined /></template>
          依赖关系图
        </a-button>
      </a-space>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="selectedSkills.length > 0" class="batch-action-bar">
      <div class="selection-info">
        <a-checkbox
          :checked="isAllSelected"
          :indeterminate="selectedSkills.length > 0 && !isAllSelected"
          @change="handleSelectAll"
        >
          已选择 {{ selectedSkills.length }} 项
        </a-checkbox>
      </div>
      <a-space>
        <a-button @click="handleBatchEnable">
          <template #icon><CheckOutlined /></template>
          批量启用
        </a-button>
        <a-button @click="handleBatchDisable">
          <template #icon><CloseOutlined /></template>
          批量禁用
        </a-button>
        <a-button danger @click="handleBatchDelete">
          <template #icon><DeleteOutlined /></template>
          批量删除
        </a-button>
        <a-button @click="handleClearSelection">清空选择</a-button>
      </a-space>
    </div>

    <!-- 技能列表 -->
    <div v-if="skillStore.loading" class="loading-container">
      <a-spin size="large" tip="加载中...">
      </a-spin>
    </div>

    <div v-else-if="skillStore.filteredSkills.length === 0" class="empty-container">
      <a-empty description="暂无技能数据" />
    </div>

    <!-- 使用虚拟滚动优化大数据集 -->
    <div v-else class="skill-list-container">
      <VirtualGrid
        v-if="skillStore.filteredSkills.length > 50"
        :items="skillStore.filteredSkills"
        :item-height="240"
        :columns="gridColumns"
        :gap="16"
        item-key="id"
      >
        <template #default="{ item: skill }">
          <div class="skill-card-wrapper">
            <a-checkbox
              v-model:checked="selectedSkillIds[skill.id]"
              class="skill-checkbox"
              @change="handleSkillSelect(skill)"
            />
            <SkillCard
              :skill="skill"
              @view-details="handleViewDetails"
              @toggle-enabled="handleToggleEnabled"
              @view-doc="handleViewDoc"
            />
          </div>
        </template>
      </VirtualGrid>

      <!-- 少量数据直接渲染 -->
      <div v-else class="skill-grid">
        <div v-for="skill in skillStore.filteredSkills" :key="skill.id" class="skill-card-wrapper">
          <a-checkbox
            v-model:checked="selectedSkillIds[skill.id]"
            class="skill-checkbox"
            @change="handleSkillSelect(skill)"
          />
          <SkillCard
            :skill="skill"
            @view-details="handleViewDetails"
            @toggle-enabled="handleToggleEnabled"
            @view-doc="handleViewDoc"
          />
        </div>
      </div>
    </div>

    <!-- 技能详情抽屉 -->
    <a-drawer
      v-model:open="detailsVisible"
      title="技能详情"
      :width="720"
      placement="right"
    >
      <ErrorBoundary>
        <SkillDetails
          v-if="currentSkill"
          :skill="currentSkill"
          @update="handleUpdateSkill"
          @close="detailsVisible = false"
        />
      </ErrorBoundary>
    </a-drawer>

    <!-- 文档查看器抽屉 -->
    <a-drawer
      v-model:open="docVisible"
      title="技能文档"
      :width="800"
      placement="right"
    >
      <MarkdownViewer
        v-if="currentDoc"
        :content="currentDoc"
      />
      <a-spin v-else-if="loadingDoc" />
    </a-drawer>

    <!-- 技能编辑器模态框 -->
    <SkillEditor
      v-model:open="editorVisible"
      :skill="editingSkill"
      @save="handleSaveSkill"
    />

    <!-- 统计分析模态框 -->
    <a-modal
      v-model:open="statsVisible"
      title="技能统计分析"
      :width="1200"
      :footer="null"
    >
      <SkillStats :skills="skillStore.skills" />
    </a-modal>

    <!-- 依赖关系图模态框 -->
    <a-modal
      v-model:open="graphVisible"
      title="技能-工具依赖关系图"
      :width="1400"
      :footer="null"
    >
      <SkillDependencyGraph
        :skills="skillStore.skills"
        :tools="allTools"
        :skillTools="allSkillTools"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { useKeyboardShortcuts, SHORTCUTS } from '../composables/useKeyboardShortcuts';
import {
  SearchOutlined,
  ReloadOutlined,
  PlusOutlined,
  BarChartOutlined,
  ApartmentOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { useSkillStore } from '../stores/skill';
import { useToolStore } from '../stores/tool';
import SkillCard from '../components/skill/SkillCard.vue';
import SkillDetails from '../components/skill/SkillDetails.vue';
import SkillEditor from '../components/skill/SkillEditor.vue';
import SkillStats from '../components/skill/SkillStats.vue';
import SkillDependencyGraph from '../components/skill/SkillDependencyGraph.vue';
import VirtualGrid from '../components/common/VirtualGrid.vue';
import MarkdownViewer from '../components/common/MarkdownViewer.vue';
import ErrorBoundary from '../components/common/ErrorBoundary.vue';

const skillStore = useSkillStore();
const toolStore = useToolStore();

// 键盘快捷键
const { registerShortcut, unregisterShortcut } = useKeyboardShortcuts();

// 搜索和筛选
const searchKeyword = ref('');
const categoryFilter = ref('all');
const searchInputRef = ref(null);

// 详情抽屉
const detailsVisible = ref(false);
const currentSkill = ref(null);

// 文档查看
const docVisible = ref(false);
const currentDoc = ref(null);
const loadingDoc = ref(false);

// 技能编辑
const editorVisible = ref(false);
const editingSkill = ref(null);

// 统计分析
const statsVisible = ref(false);

// 依赖关系图
const graphVisible = ref(false);
const allTools = ref([]);
const allSkillTools = ref([]);

// 批量操作
const selectedSkillIds = reactive({});
const selectedSkills = computed(() => {
  return skillStore.filteredSkills.filter(skill => selectedSkillIds[skill.id]);
});
const isAllSelected = computed(() => {
  return skillStore.filteredSkills.length > 0 &&
    skillStore.filteredSkills.every(skill => selectedSkillIds[skill.id]);
});

// 响应式网格列数
const gridColumns = ref(3);
const updateGridColumns = () => {
  const width = window.innerWidth;
  if (width < 768) {
    gridColumns.value = 1;
  } else if (width < 1200) {
    gridColumns.value = 2;
  } else if (width < 1600) {
    gridColumns.value = 3;
  } else {
    gridColumns.value = 4;
  }
};

// 初始化
onMounted(async () => {
  await skillStore.fetchAll();
  await toolStore.fetchAll();
  allTools.value = toolStore.tools;

  // 响应式网格
  updateGridColumns();
  window.addEventListener('resize', updateGridColumns);

  // 注册键盘快捷键
  registerShortcut(SHORTCUTS.SEARCH, () => {
    // 聚焦搜索框
    const searchInput = document.querySelector('.skill-management input[placeholder*="搜索"]');
    if (searchInput) {
      searchInput.focus();
    }
  }, { global: true });

  registerShortcut(SHORTCUTS.NEW, () => {
    handleCreateSkill();
  }, { global: true });

  registerShortcut(SHORTCUTS.REFRESH, () => {
    handleRefresh();
  }, { global: true });

  registerShortcut(SHORTCUTS.DELETE, () => {
    if (selectedSkills.value.length > 0) {
      handleBatchDelete();
    }
  });

  registerShortcut(SHORTCUTS.SELECT_ALL, () => {
    handleSelectAll({ target: { checked: true } });
  });

  registerShortcut(SHORTCUTS.DESELECT, () => {
    handleClearSelection();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateGridColumns);

  // 注销快捷键
  unregisterShortcut(SHORTCUTS.SEARCH);
  unregisterShortcut(SHORTCUTS.NEW);
  unregisterShortcut(SHORTCUTS.REFRESH);
  unregisterShortcut(SHORTCUTS.DELETE);
  unregisterShortcut(SHORTCUTS.SELECT_ALL);
  unregisterShortcut(SHORTCUTS.DESELECT);
});

// 搜索处理
const handleSearch = () => {
  skillStore.setSearchKeyword(searchKeyword.value);
};

// 分类筛选
const handleCategoryChange = () => {
  skillStore.setCategoryFilter(categoryFilter.value);
};

// 刷新
const handleRefresh = async () => {
  await skillStore.fetchAll();
  message.success('刷新成功');
};

// 查看详情
const handleViewDetails = async (skill) => {
  currentSkill.value = skill;
  detailsVisible.value = true;

  // 加载完整数据
  await skillStore.fetchById(skill.id);
  currentSkill.value = skillStore.currentSkill;
};

// 切换启用/禁用
const handleToggleEnabled = async (skill) => {
  const action = skill.enabled ? '禁用' : '启用';
  try {
    const success = skill.enabled
      ? await skillStore.disable(skill.id)
      : await skillStore.enable(skill.id);

    if (success) {
      message.success(`${action}技能成功`);
    } else {
      message.error(`${action}技能失败`);
    }
  } catch (error) {
    console.error(error);
    message.error(`${action}技能失败`);
  }
};

// 查看文档
const handleViewDoc = async (skill) => {
  docVisible.value = true;
  loadingDoc.value = true;
  currentDoc.value = null;

  try {
    const doc = await skillStore.fetchDoc(skill.id);
    currentDoc.value = doc;
  } catch (error) {
    console.error(error);
    message.error('加载文档失败');
  } finally {
    loadingDoc.value = false;
  }
};

// 更新技能
const handleUpdateSkill = async (skillId, updates) => {
  const success = await skillStore.update(skillId, updates);
  if (success) {
    message.success('更新成功');
    await skillStore.fetchById(skillId);
    currentSkill.value = skillStore.currentSkill;
  } else {
    message.error('更新失败');
  }
};

// 创建技能
const handleCreateSkill = () => {
  editingSkill.value = null;
  editorVisible.value = true;
};

// 保存技能
const handleSaveSkill = async (skillData) => {
  try {
    let success;
    if (editingSkill.value) {
      // 更新现有技能
      success = await skillStore.update(editingSkill.value.id, skillData);
    } else {
      // 创建新技能
      success = await skillStore.create(skillData);
    }

    if (success) {
      message.success(editingSkill.value ? '更新成功' : '创建成功');
      editorVisible.value = false;
      await skillStore.fetchAll();
    } else {
      message.error(editingSkill.value ? '更新失败' : '创建失败');
    }
  } catch (error) {
    console.error(error);
    message.error('操作失败');
  }
};

// 显示统计分析
const showStats = () => {
  statsVisible.value = true;
};

// 显示依赖关系图
const showDependencyGraph = async () => {
  // 加载技能-工具关联关系
  try {
    const relations = await window.electronAPI.skillTool.getAllRelations();
    allSkillTools.value = relations;
    graphVisible.value = true;
  } catch (error) {
    console.error(error);
    message.error('加载依赖关系失败');
  }
};

// 批量操作相关函数
const handleSkillSelect = (skill) => {
  // 选择状态已通过 v-model 自动更新
};

const handleSelectAll = (e) => {
  const checked = e.target.checked;
  skillStore.filteredSkills.forEach(skill => {
    selectedSkillIds[skill.id] = checked;
  });
};

const handleClearSelection = () => {
  Object.keys(selectedSkillIds).forEach(key => {
    delete selectedSkillIds[key];
  });
};

const handleBatchEnable = () => {
  const count = selectedSkills.value.length;
  Modal.confirm({
    title: '确认批量启用？',
    content: `将启用 ${count} 个技能，是否继续？`,
    okText: '确认',
    cancelText: '取消',
    async onOk() {
      try {
        let successCount = 0;
        for (const skill of selectedSkills.value) {
          if (!skill.enabled) {
            const success = await skillStore.enable(skill.id);
            if (success) successCount++;
          } else {
            successCount++; // 已启用的也算成功
          }
        }
        message.success(`成功启用 ${successCount} 个技能`);
        handleClearSelection();
        await skillStore.fetchAll();
      } catch (error) {
        console.error(error);
        message.error('批量启用失败');
      }
    },
  });
};

const handleBatchDisable = () => {
  const count = selectedSkills.value.length;
  Modal.confirm({
    title: '确认批量禁用？',
    content: `将禁用 ${count} 个技能，是否继续？`,
    okText: '确认',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        let successCount = 0;
        for (const skill of selectedSkills.value) {
          if (skill.enabled) {
            const success = await skillStore.disable(skill.id);
            if (success) successCount++;
          } else {
            successCount++; // 已禁用的也算成功
          }
        }
        message.success(`成功禁用 ${successCount} 个技能`);
        handleClearSelection();
        await skillStore.fetchAll();
      } catch (error) {
        console.error(error);
        message.error('批量禁用失败');
      }
    },
  });
};

const handleBatchDelete = () => {
  const count = selectedSkills.value.length;
  const skillNames = selectedSkills.value.map(s => s.display_name || s.name).join('、');

  Modal.confirm({
    title: '确认批量删除？',
    content: `<div>
      <p>将删除以下 ${count} 个技能：</p>
      <p style="color: #ff4d4f; max-height: 200px; overflow-y: auto;">
        ${skillNames}
      </p>
      <p style="font-weight: bold; color: #ff4d4f;">此操作不可恢复，是否继续？</p>
    </div>`,
    okText: '确认删除',
    okType: 'danger',
    cancelText: '取消',
    width: 600,
    async onOk() {
      try {
        let successCount = 0;
        const skillIds = selectedSkills.value.map(s => s.id);

        for (const skillId of skillIds) {
          const success = await skillStore.delete(skillId);
          if (success) successCount++;
        }

        message.success(`成功删除 ${successCount} 个技能`);
        handleClearSelection();
        await skillStore.fetchAll();
      } catch (error) {
        console.error(error);
        message.error('批量删除失败');
      }
    },
  });
};
</script>

<style scoped lang="scss">
.skill-management {
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

  .batch-action-bar {
    background: #e6f7ff;
    border: 1px solid #91d5ff;
    border-radius: 8px;
    padding: 12px 16px;
    margin: 16px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    animation: slideDown 0.3s ease;

    .selection-info {
      font-weight: 500;
      color: #0050b3;
    }
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .skill-list-container {
    height: calc(100vh - 320px);
    min-height: 600px;
  }

  .skill-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 16px;
    margin-top: 16px;

    :deep(.skill-card) {
      padding-left: 44px;
    }

    .skill-card-wrapper {
      position: relative;

      .skill-checkbox {
        position: absolute;
        top: 12px;
        left: 12px;
        z-index: 10;
        background: white;
        padding: 4px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

        &:hover {
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
        }
      }
    }
  }

  :deep(.virtual-grid) {
    :deep(.skill-card) {
      padding-left: 44px;
    }

    .skill-card-wrapper {
      position: relative;

      .skill-checkbox {
        position: absolute;
        top: 12px;
        left: 12px;
        z-index: 10;
        background: white;
        padding: 4px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

        &:hover {
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
        }
      }
    }
  }
}
</style>
