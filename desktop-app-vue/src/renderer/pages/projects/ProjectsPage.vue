<template>
  <div class="projects-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <h1>
            <FolderOpenOutlined />
            我的项目
          </h1>
          <p>AI驱动的项目管理，支持Web开发、文档处理、数据分析等多种项目类型</p>
        </div>
        <div class="header-right">
          <a-button type="primary" size="large" @click="handleCreateProject">
            <PlusOutlined />
            新建项目
          </a-button>
        </div>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-left">
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="搜索项目名称或描述..."
          style="width: 300px"
          @search="handleSearch"
          @change="debouncedSearch"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input-search>

        <a-select
          v-model:value="selectedType"
          placeholder="项目类型"
          style="width: 150px"
          @change="handleTypeChange"
        >
          <a-select-option value="">全部类型</a-select-option>
          <a-select-option value="web">Web开发</a-select-option>
          <a-select-option value="document">文档处理</a-select-option>
          <a-select-option value="data">数据分析</a-select-option>
          <a-select-option value="app">应用开发</a-select-option>
        </a-select>

        <a-select
          v-model:value="selectedStatus"
          placeholder="状态"
          style="width: 150px"
          @change="handleStatusChange"
        >
          <a-select-option value="">全部状态</a-select-option>
          <a-select-option value="draft">草稿</a-select-option>
          <a-select-option value="active">进行中</a-select-option>
          <a-select-option value="completed">已完成</a-select-option>
          <a-select-option value="archived">已归档</a-select-option>
        </a-select>

        <a-select
          v-model:value="sortConfig"
          placeholder="排序"
          style="width: 150px"
          @change="handleSortChange"
        >
          <a-select-option value="updated_at:desc">最近更新</a-select-option>
          <a-select-option value="created_at:desc">创建时间</a-select-option>
          <a-select-option value="name:asc">名称 A-Z</a-select-option>
          <a-select-option value="name:desc">名称 Z-A</a-select-option>
        </a-select>
      </div>

      <div class="filter-right">
        <a-button
          :loading="syncing"
          @click="handleSync"
        >
          <SyncOutlined :spin="syncing" />
          同步
        </a-button>

        <a-radio-group v-model:value="viewMode" button-style="solid" @change="handleViewModeChange">
          <a-radio-button value="grid">
            <AppstoreOutlined />
          </a-radio-button>
          <a-radio-button value="list">
            <UnorderedListOutlined />
          </a-radio-button>
        </a-radio-group>
      </div>
    </div>

    <!-- 统计栏 -->
    <div class="stats-bar" v-if="stats">
      <div class="stat-item">
        <div class="stat-value">{{ stats.total }}</div>
        <div class="stat-label">总项目数</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ stats.active }}</div>
        <div class="stat-label">进行中</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ stats.completed }}</div>
        <div class="stat-label">已完成</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ stats.draft }}</div>
        <div class="stat-label">草稿</div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" tip="加载中..." />
    </div>

    <!-- 项目列表 -->
    <div v-else-if="paginatedProjects.length > 0" class="projects-container">
      <!-- 网格视图 -->
      <div v-if="viewMode === 'grid'" class="projects-grid">
        <ProjectCard
          v-for="project in paginatedProjects"
          :key="project.id"
          :project="project"
          @view="handleViewProject"
          @edit="handleEditProject"
          @delete="handleDeleteProject"
        />
      </div>

      <!-- 列表视图 -->
      <div v-else class="projects-list">
        <ProjectListItem
          v-for="project in paginatedProjects"
          :key="project.id"
          :project="project"
          @view="handleViewProject"
          @edit="handleEditProject"
          @delete="handleDeleteProject"
        />
      </div>

      <!-- 分页 -->
      <div class="pagination-container">
        <a-pagination
          v-model:current="currentPage"
          v-model:page-size="pageSize"
          :total="filteredTotal"
          :show-total="total => `共 ${total} 个项目`"
          :show-size-changer="true"
          :page-size-options="['12', '24', '48', '96']"
          @change="handlePageChange"
          @showSizeChange="handlePageSizeChange"
        />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-icon">
        <FolderOpenOutlined />
      </div>
      <h3>{{ searchKeyword || selectedType || selectedStatus ? '没有找到匹配的项目' : '还没有项目' }}</h3>
      <p>{{ searchKeyword || selectedType || selectedStatus ? '尝试调整筛选条件' : '点击右上角"新建项目"按钮开始创建' }}</p>
      <a-button v-if="!searchKeyword && !selectedType && !selectedStatus" type="primary" size="large" @click="handleCreateProject">
        <PlusOutlined />
        创建第一个项目
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useProjectStore } from '@/stores/project';
import { useAuthStore } from '@/stores/auth';
import { useAppStore } from '@/stores/app';
import {
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined,
  SyncOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons-vue';
import ProjectCard from '@/components/projects/ProjectCard.vue';
import ProjectListItem from '@/components/projects/ProjectListItem.vue';

const router = useRouter();
const projectStore = useProjectStore();
const authStore = useAuthStore();
const appStore = useAppStore();

// 响应式状态
const searchKeyword = ref('');
const selectedType = ref('');
const selectedStatus = ref('');
const sortConfig = ref('updated_at:desc');
const viewMode = ref('grid');
const currentPage = ref(1);
const pageSize = ref(12);

// 计算属性
const loading = computed(() => projectStore.loading);
const syncing = computed(() => projectStore.syncing);
const paginatedProjects = computed(() => projectStore.paginatedProjects);
const filteredTotal = computed(() => projectStore.filteredProjects.length);
const stats = computed(() => projectStore.projectStats);

// 防抖搜索
let searchTimeout;
const debouncedSearch = () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    handleSearch();
  }, 300);
};

// 处理搜索
const handleSearch = () => {
  projectStore.setFilter('searchKeyword', searchKeyword.value);
  currentPage.value = 1; // 重置到第一页
};

// 处理类型筛选
const handleTypeChange = (value) => {
  projectStore.setFilter('projectType', value);
  currentPage.value = 1;
};

// 处理状态筛选
const handleStatusChange = (value) => {
  projectStore.setFilter('status', value);
  currentPage.value = 1;
};

// 处理排序
const handleSortChange = (value) => {
  const [sortBy, sortOrder] = value.split(':');
  projectStore.setSort(sortBy, sortOrder);
};

// 处理视图模式切换
const handleViewModeChange = () => {
  projectStore.setViewMode(viewMode.value);
};

// 处理同步
const handleSync = async () => {
  try {
    await projectStore.syncProjects(authStore.currentUser?.id);
    message.success('同步成功');
  } catch (error) {
    console.error('Sync failed:', error);
    message.error('同步失败：' + error.message);
  }
};

// 处理分页变化
const handlePageChange = (page, size) => {
  currentPage.value = page;
  projectStore.setPagination(page, size);
};

const handlePageSizeChange = (current, size) => {
  pageSize.value = size;
  currentPage.value = 1;
  projectStore.setPagination(1, size);
};

// 处理创建项目
const handleCreateProject = () => {
  router.push('/projects/new');
};

// 处理查看项目
const handleViewProject = (projectId) => {
  // 查找项目信息
  const project = projectStore.projects.find(p => p.id === projectId);
  const projectName = project ? project.name : '项目详情';

  // 添加标签页
  appStore.addTab({
    key: `project-${projectId}`,
    title: projectName,
    path: `/projects/${projectId}`,
    closable: true,
  });

  // 跳转到项目详情页
  router.push(`/projects/${projectId}`);
};

// 处理编辑项目
const handleEditProject = (projectId) => {
  router.push(`/projects/${projectId}/edit`);
};

// 处理删除项目
const handleDeleteProject = async (projectId) => {
  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这个项目吗？此操作不可恢复。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await projectStore.deleteProject(projectId);
        message.success('项目已删除');
      } catch (error) {
        console.error('Delete project failed:', error);
        message.error('删除失败：' + error.message);
      }
    },
  });
};

// 监听分页参数变化
watch([currentPage, pageSize], () => {
  projectStore.setPagination(currentPage.value, pageSize.value);
});

// 组件挂载时加载项目
onMounted(async () => {
  try {
    const userId = authStore.currentUser?.id || 'default-user';
    await projectStore.fetchProjects(userId);

    // 从store恢复状态
    searchKeyword.value = projectStore.filters.searchKeyword;
    selectedType.value = projectStore.filters.projectType;
    selectedStatus.value = projectStore.filters.status;
    viewMode.value = projectStore.viewMode;
    currentPage.value = projectStore.pagination.current;
    pageSize.value = projectStore.pagination.pageSize;

    // 构建排序配置字符串
    sortConfig.value = `${projectStore.sortBy}:${projectStore.sortOrder}`;
  } catch (error) {
    console.error('Failed to load projects:', error);
    message.error('加载项目失败：' + error.message);
  }
});
</script>

<style scoped>
.projects-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

.page-header {
  background: white;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #1f2937;
}

.header-left p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

/* 筛选栏 */
.filter-bar {
  background: white;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.filter-left {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

/* 统计栏 */
.stats-bar {
  background: white;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  gap: 48px;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #667eea;
  line-height: 1;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  color: #6b7280;
}

/* 加载状态 */
.loading-container {
  background: white;
  border-radius: 8px;
  padding: 80px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 项目容器 */
.projects-container {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 网格视图 */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

/* 列表视图 */
.projects-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

/* 分页 */
.pagination-container {
  display: flex;
  justify-content: center;
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}

/* 空状态 */
.empty-state {
  background: white;
  border-radius: 8px;
  padding: 80px 40px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.empty-icon {
  font-size: 80px;
  color: #d1d5db;
  margin-bottom: 24px;
}

.empty-state h3 {
  font-size: 20px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 8px 0;
}

.empty-state p {
  font-size: 14px;
  color: #6b7280;
  margin: 0 0 24px 0;
}
</style>
