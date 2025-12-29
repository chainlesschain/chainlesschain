<template>
  <div class="skill-management">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>技能管理</h1>
        <p class="subtitle">管理和配置 AI 助手的技能集</p>
      </div>
      <div class="header-right">
        <a-statistic-group direction="horizontal">
          <a-statistic :value="skillStore.totalCount" title="总技能数" />
          <a-statistic :value="skillStore.enabledCount" title="已启用" :value-style="{ color: '#52c41a' }" />
          <a-statistic
            :value="skillStore.totalCount - skillStore.enabledCount"
            title="已禁用"
            :value-style="{ color: '#ff4d4f' }"
          />
        </a-statistic-group>
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
    </div>

    <!-- 技能列表 -->
    <div v-if="skillStore.loading" class="loading-container">
      <a-spin size="large" tip="加载中...">
      </a-spin>
    </div>

    <div v-else-if="skillStore.filteredSkills.length === 0" class="empty-container">
      <a-empty description="暂无技能数据" />
    </div>

    <div v-else class="skill-grid">
      <SkillCard
        v-for="skill in skillStore.filteredSkills"
        :key="skill.id"
        :skill="skill"
        @view-details="handleViewDetails"
        @toggle-enabled="handleToggleEnabled"
        @view-doc="handleViewDoc"
      />
    </div>

    <!-- 技能详情抽屉 -->
    <a-drawer
      v-model:open="detailsVisible"
      title="技能详情"
      :width="720"
      placement="right"
    >
      <SkillDetails
        v-if="currentSkill"
        :skill="currentSkill"
        @update="handleUpdateSkill"
        @close="detailsVisible = false"
      />
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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons-vue';
import { useSkillStore } from '../stores/skill';
import SkillCard from '../components/skill/SkillCard.vue';
import SkillDetails from '../components/skill/SkillDetails.vue';
import MarkdownViewer from '../components/common/MarkdownViewer.vue';

const skillStore = useSkillStore();

// 搜索和筛选
const searchKeyword = ref('');
const categoryFilter = ref('all');

// 详情抽屉
const detailsVisible = ref(false);
const currentSkill = ref(null);

// 文档查看
const docVisible = ref(false);
const currentDoc = ref(null);
const loadingDoc = ref(false);

// 初始化
onMounted(async () => {
  await skillStore.fetchAll();
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

  .skill-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 16px;
    margin-top: 16px;
  }
}
</style>
