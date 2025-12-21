<template>
  <div class="archived-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <h1>
            <InboxOutlined />
            已归档项目
          </h1>
          <p>管理已归档的项目，支持恢复或永久删除</p>
        </div>
        <div class="header-right">
          <a-button @click="handleBackToProjects">
            <ArrowLeftOutlined />
            返回我的项目
          </a-button>
        </div>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-left">
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="搜索已归档项目..."
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
          v-model:value="sortConfig"
          placeholder="排序"
          style="width: 150px"
          @change="handleSortChange"
        >
          <a-select-option value="archived_at:desc">归档时间（最新）</a-select-option>
          <a-select-option value="archived_at:asc">归档时间（最早）</a-select-option>
          <a-select-option value="name:asc">名称 A-Z</a-select-option>
          <a-select-option value="name:desc">名称 Z-A</a-select-option>
        </a-select>
      </div>

      <div class="filter-right">
        <a-button
          :loading="loading"
          @click="handleRefresh"
        >
          <ReloadOutlined :spin="loading" />
          刷新
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
    <div class="stats-bar" v-if="archivedProjects.length > 0">
      <div class="stat-item">
        <div class="stat-value">{{ archivedProjects.length }}</div>
        <div class="stat-label">已归档项目</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ typeStats.web || 0 }}</div>
        <div class="stat-label">Web开发</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ typeStats.document || 0 }}</div>
        <div class="stat-label">文档处理</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ typeStats.data || 0 }}</div>
        <div class="stat-label">数据分析</div>
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
        <div
          v-for="project in paginatedProjects"
          :key="project.id"
          class="archived-project-card"
        >
          <div class="card-header">
            <div class="project-icon">
              <component :is="getProjectTypeIcon(project.project_type)" />
            </div>
            <div class="card-actions">
              <a-dropdown>
                <a-button type="text" size="small">
                  <MoreOutlined />
                </a-button>
                <template #overlay>
                  <a-menu @click="({ key }) => handleAction(key, project.id)">
                    <a-menu-item key="restore">
                      <RollbackOutlined />
                      恢复项目
                    </a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="delete" danger>
                      <DeleteOutlined />
                      永久删除
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </div>
          </div>

          <div class="card-body">
            <h3>{{ project.name }}</h3>
            <p class="description">{{ project.description || '暂无描述' }}</p>

            <div class="meta-info">
              <div class="meta-item">
                <CalendarOutlined />
                归档于: {{ formatDate(project.archived_at || project.updated_at) }}
              </div>
              <div class="meta-item">
                <FolderOutlined />
                {{ getProjectTypeName(project.project_type) }}
              </div>
            </div>
          </div>

          <div class="card-footer">
            <a-button type="primary" ghost block @click="handleRestore(project.id)">
              <RollbackOutlined />
              恢复项目
            </a-button>
          </div>
        </div>
      </div>

      <!-- 列表视图 -->
      <div v-else class="projects-list">
        <div
          v-for="project in paginatedProjects"
          :key="project.id"
          class="archived-project-item"
        >
          <div class="item-icon">
            <component :is="getProjectTypeIcon(project.project_type)" />
          </div>

          <div class="item-content">
            <h4>{{ project.name }}</h4>
            <p>{{ project.description || '暂无描述' }}</p>
            <div class="item-meta">
              <span><CalendarOutlined /> 归档于: {{ formatDate(project.archived_at || project.updated_at) }}</span>
              <span><FolderOutlined /> {{ getProjectTypeName(project.project_type) }}</span>
            </div>
          </div>

          <div class="item-actions">
            <a-button type="primary" ghost @click="handleRestore(project.id)">
              <RollbackOutlined />
              恢复
            </a-button>
            <a-button danger @click="handleDelete(project.id)">
              <DeleteOutlined />
              删除
            </a-button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div class="pagination-container">
        <a-pagination
          v-model:current="currentPage"
          v-model:page-size="pageSize"
          :total="filteredProjects.length"
          :show-total="total => `共 ${total} 个已归档项目`"
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
        <InboxOutlined />
      </div>
      <h3>{{ searchKeyword || selectedType ? '没有找到匹配的已归档项目' : '还没有归档项目' }}</h3>
      <p>{{ searchKeyword || selectedType ? '尝试调整筛选条件' : '归档的项目将显示在这里' }}</p>
      <a-button v-if="!searchKeyword && !selectedType" @click="handleBackToProjects">
        <ArrowLeftOutlined />
        返回我的项目
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useProjectStore } from '@/stores/project';
import { useAuthStore } from '@/stores/auth';
import {
  InboxOutlined,
  ArrowLeftOutlined,
  SearchOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  MoreOutlined,
  RollbackOutlined,
  DeleteOutlined,
  CalendarOutlined,
  FolderOutlined,
  CodeOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AppstoreAddOutlined,
} from '@ant-design/icons-vue';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const router = useRouter();
const projectStore = useProjectStore();
const authStore = useAuthStore();

// 响应式状态
const loading = ref(false);
const searchKeyword = ref('');
const selectedType = ref('');
const sortConfig = ref('archived_at:desc');
const viewMode = ref('grid');
const currentPage = ref(1);
const pageSize = ref(12);

// 计算属性
const archivedProjects = computed(() => {
  return projectStore.projects.filter(p => p.status === 'archived');
});

const filteredProjects = computed(() => {
  let result = [...archivedProjects.value];

  // 类型筛选
  if (selectedType.value) {
    result = result.filter(p => p.project_type === selectedType.value);
  }

  // 搜索筛选
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(p =>
      p.name.toLowerCase().includes(keyword) ||
      (p.description && p.description.toLowerCase().includes(keyword))
    );
  }

  // 排序
  const [sortBy, sortOrder] = sortConfig.value.split(':');
  result.sort((a, b) => {
    let aVal = a[sortBy] || a.updated_at;
    let bVal = b[sortBy] || b.updated_at;

    if (sortBy === 'name') {
      return sortOrder === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
  });

  return result;
});

const paginatedProjects = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredProjects.value.slice(start, end);
});

const typeStats = computed(() => {
  const stats = {};
  archivedProjects.value.forEach(p => {
    stats[p.project_type] = (stats[p.project_type] || 0) + 1;
  });
  return stats;
});

// 项目类型图标
const getProjectTypeIcon = (type) => {
  const iconMap = {
    web: CodeOutlined,
    document: FileTextOutlined,
    data: BarChartOutlined,
    app: AppstoreAddOutlined,
  };
  return iconMap[type] || FolderOutlined;
};

// 项目类型名称
const getProjectTypeName = (type) => {
  const nameMap = {
    web: 'Web开发',
    document: '文档处理',
    data: '数据分析',
    app: '应用开发',
  };
  return nameMap[type] || type;
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) return '未知';
  try {
    return format(new Date(timestamp), 'yyyy-MM-dd HH:mm', { locale: zhCN });
  } catch {
    return '未知';
  }
};

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
  currentPage.value = 1;
};

// 处理类型筛选
const handleTypeChange = () => {
  currentPage.value = 1;
};

// 处理排序
const handleSortChange = () => {
  currentPage.value = 1;
};

// 处理视图模式切换
const handleViewModeChange = () => {
  localStorage.setItem('archived_view_mode', viewMode.value);
};

// 刷新
const handleRefresh = async () => {
  loading.value = true;
  try {
    const userId = authStore.currentUser?.id || 'default-user';
    await projectStore.fetchProjects(userId, true);
    message.success('刷新成功');
  } catch (error) {
    console.error('Refresh failed:', error);
    message.error('刷新失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

// 处理分页
const handlePageChange = (page) => {
  currentPage.value = page;
};

const handlePageSizeChange = (current, size) => {
  pageSize.value = size;
  currentPage.value = 1;
};

// 返回我的项目
const handleBackToProjects = () => {
  router.push('/projects');
};

// 恢复项目
const handleRestore = async (projectId) => {
  Modal.confirm({
    title: '确认恢复',
    content: '确定要恢复这个项目吗？项目将恢复到"进行中"状态。',
    okText: '恢复',
    cancelText: '取消',
    onOk: async () => {
      try {
        await projectStore.updateProject(projectId, {
          status: 'active',
          archived_at: null,
        });
        message.success('项目已恢复');
      } catch (error) {
        console.error('Restore project failed:', error);
        message.error('恢复失败：' + error.message);
      }
    },
  });
};

// 永久删除项目
const handleDelete = async (projectId) => {
  Modal.confirm({
    title: '确认删除',
    content: '确定要永久删除这个项目吗？此操作不可恢复！',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await projectStore.deleteProject(projectId);
        message.success('项目已永久删除');
      } catch (error) {
        console.error('Delete project failed:', error);
        message.error('删除失败：' + error.message);
      }
    },
  });
};

// 处理下拉菜单操作
const handleAction = (key, projectId) => {
  if (key === 'restore') {
    handleRestore(projectId);
  } else if (key === 'delete') {
    handleDelete(projectId);
  }
};

// 组件挂载
onMounted(async () => {
  loading.value = true;
  try {
    // 从localStorage恢复视图模式
    const savedViewMode = localStorage.getItem('archived_view_mode');
    if (savedViewMode) {
      viewMode.value = savedViewMode;
    }

    // 加载项目
    const userId = authStore.currentUser?.id || 'default-user';
    await projectStore.fetchProjects(userId);
  } catch (error) {
    console.error('Failed to load archived projects:', error);
    message.error('加载失败：' + error.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.archived-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

/* 页面头部 */
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
  flex-wrap: wrap;
  gap: 12px;
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
  color: #9ca3af;
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

/* 网格视图 - 归档项目卡片 */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

.archived-project-card {
  background: #fafafa;
  border-radius: 8px;
  border: 2px solid #e5e7eb;
  overflow: hidden;
  transition: all 0.3s;
}

.archived-project-card:hover {
  border-color: #9ca3af;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card-header {
  padding: 16px;
  background: #f3f4f6;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.project-icon {
  font-size: 24px;
  color: #9ca3af;
}

.card-body {
  padding: 20px;
}

.card-body h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: #374151;
}

.description {
  color: #6b7280;
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 16px 0;
  height: 42px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.meta-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #9ca3af;
}

.meta-item :deep(.anticon) {
  font-size: 14px;
}

.card-footer {
  padding: 16px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

/* 列表视图 - 归档项目项 */
.projects-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.archived-project-item {
  background: #fafafa;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 20px;
  transition: all 0.3s;
}

.archived-project-item:hover {
  border-color: #9ca3af;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.item-icon {
  font-size: 40px;
  color: #9ca3af;
  flex-shrink: 0;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-content h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #374151;
}

.item-content p {
  margin: 0 0 12px 0;
  color: #6b7280;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  gap: 24px;
  font-size: 13px;
  color: #9ca3af;
}

.item-meta span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.item-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
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
