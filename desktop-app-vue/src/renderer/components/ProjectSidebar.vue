<template>
  <div class="project-sidebar" :class="{ collapsed: collapsed }">
    <!-- 折叠/展开按钮 -->
    <div class="sidebar-header">
      <div class="header-content">
        <FolderOpenOutlined v-if="!collapsed" class="header-icon" />
        <span v-if="!collapsed" class="header-title">我的项目</span>
      </div>
      <a-button
        type="text"
        size="small"
        class="collapse-btn"
        @click="toggleCollapse"
      >
        <DoubleRightOutlined v-if="!collapsed" />
        <DoubleLeftOutlined v-else />
      </a-button>
    </div>

    <!-- 新建项目按钮 -->
    <div v-if="!collapsed" class="new-project-section">
      <a-button
        type="primary"
        block
        @click="handleQuickCreate"
        :icon="h(PlusOutlined)"
        class="quick-create-btn"
      >
        快速新建项目
      </a-button>
      <a-button
        block
        @click="handleAICreate"
        class="ai-create-btn"
      >
        <template #icon>
          <span class="ai-icon">AI</span>
        </template>
        AI模板新建
      </a-button>
    </div>

    <!-- 项目列表 -->
    <div class="project-list">
      <a-spin :spinning="loading" size="small">
        <template v-if="!collapsed">
          <!-- 搜索框 -->
          <div class="search-box">
            <a-input
              v-model:value="searchKeyword"
              placeholder="搜索项目..."
              size="small"
              :prefix="h(SearchOutlined)"
              allowClear
            />
          </div>

          <!-- 项目列表 -->
          <div class="list-content">
            <template v-if="filteredProjects.length > 0">
              <div
                v-for="project in filteredProjects"
                :key="project.id"
                class="project-item"
                :class="{ active: currentProjectId === project.id }"
                @click="handleSelectProject(project)"
              >
                <div class="project-icon">
                  <component :is="getProjectIcon(project.project_type)" />
                </div>
                <div class="project-info">
                  <div class="project-name" :title="project.name">
                    {{ project.name }}
                  </div>
                  <div class="project-meta">
                    {{ formatDate(project.updated_at) }}
                  </div>
                </div>
                <a-dropdown :trigger="['click']" @click.stop>
                  <a-button type="text" size="small" class="more-btn">
                    <MoreOutlined />
                  </a-button>
                  <template #overlay>
                    <a-menu @click="handleMenuClick($event, project)">
                      <a-menu-item key="open">
                        <FolderOpenOutlined />
                        打开
                      </a-menu-item>
                      <a-menu-item key="rename">
                        <EditOutlined />
                        重命名
                      </a-menu-item>
                      <a-menu-divider />
                      <a-menu-item key="delete" danger>
                        <DeleteOutlined />
                        删除
                      </a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
              </div>
            </template>
            <a-empty
              v-else
              :image="Empty.PRESENTED_IMAGE_SIMPLE"
              description="暂无项目"
            >
              <a-button type="primary" size="small" @click="handleNewProject">
                创建第一个项目
              </a-button>
            </a-empty>
          </div>
        </template>

        <!-- 折叠状态 -->
        <template v-else>
          <div class="collapsed-list">
            <a-tooltip
              v-for="project in recentProjects"
              :key="project.id"
              placement="right"
              :title="project.name"
            >
              <div
                class="collapsed-item"
                :class="{ active: currentProjectId === project.id }"
                @click="handleSelectProject(project)"
              >
                <component :is="getProjectIcon(project.project_type)" />
              </div>
            </a-tooltip>
          </div>
        </template>
      </a-spin>
    </div>

    <!-- 重命名对话框 -->
    <a-modal
      v-model:open="renameModalVisible"
      title="重命名项目"
      @ok="handleRename"
      @cancel="renameModalVisible = false"
    >
      <a-form :model="renameForm" layout="vertical">
        <a-form-item label="项目名称" required>
          <a-input
            v-model:value="renameForm.name"
            placeholder="请输入项目名称"
            @pressEnter="handleRename"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 快速新建项目弹窗 -->
    <a-modal
      v-model:open="showQuickCreateModal"
      title="快速新建项目"
      :width="500"
      @ok="handleQuickCreateSubmit"
      @cancel="showQuickCreateModal = false"
    >
      <a-form
        :model="quickCreateForm"
        layout="vertical"
        style="margin-top: 24px;"
      >
        <a-form-item
          label="项目名称"
          name="name"
          :rules="[{ required: true, message: '请输入项目名称' }]"
        >
          <a-input
            v-model:value="quickCreateForm.name"
            placeholder="请输入项目名称"
            size="large"
            @pressEnter="handleQuickCreateSubmit"
          />
        </a-form-item>
        <a-form-item
          label="项目描述（可选）"
          name="description"
        >
          <a-textarea
            v-model:value="quickCreateForm.description"
            placeholder="简要描述项目用途"
            :rows="3"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, h } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { message, Modal, Empty } from 'ant-design-vue';
import {
  FolderOpenOutlined,
  DoubleRightOutlined,
  DoubleLeftOutlined,
  PlusOutlined,
  SearchOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  FileTextOutlined,
  GlobalOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
} from '@ant-design/icons-vue';
import { useProjectStore } from '../stores/project';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const route = useRoute();
const projectStore = useProjectStore();
const authStore = useAuthStore();

// 状态
const collapsed = ref(false);
const loading = ref(false);
const searchKeyword = ref('');
const currentProjectId = ref(null);

// 重命名相关
const renameModalVisible = ref(false);
const renameForm = ref({
  projectId: null,
  name: '',
});

// 快速新建项目相关
const showQuickCreateModal = ref(false);
const quickCreateForm = ref({
  name: '',
  description: '',
});

// 从store获取项目列表
const projects = computed(() => projectStore.projects || []);

// 过滤后的项目
const filteredProjects = computed(() => {
  if (!searchKeyword.value) {
    return projects.value;
  }
  const keyword = searchKeyword.value.toLowerCase();
  return projects.value.filter(p =>
    p.name.toLowerCase().includes(keyword) ||
    (p.description && p.description.toLowerCase().includes(keyword))
  );
});

// 最近的项目（折叠状态显示）
const recentProjects = computed(() => {
  return [...projects.value]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 10);
});

// 切换折叠状态
const toggleCollapse = () => {
  collapsed.value = !collapsed.value;
  localStorage.setItem('project_sidebar_collapsed', collapsed.value ? '1' : '0');
};

// 获取项目图标
const getProjectIcon = (type) => {
  const icons = {
    web: GlobalOutlined,
    document: FileTextOutlined,
    data: DatabaseOutlined,
    app: AppstoreOutlined,
  };
  return icons[type] || FileTextOutlined;
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric'
  });
};

// 快速新建项目 - 打开弹窗
const handleQuickCreate = () => {
  showQuickCreateModal.value = true;
  quickCreateForm.value = { name: '', description: '' };
};

// AI模板新建 - 回到首页
const handleAICreate = () => {
  router.push('/');
};

// 快速新建项目提交
const handleQuickCreateSubmit = async () => {
  if (!quickCreateForm.value.name || !quickCreateForm.value.name.trim()) {
    message.warning('请输入项目名称');
    return;
  }

  try {
    const userId = authStore.currentUser?.id || 'default-user';
    const projectData = {
      name: quickCreateForm.value.name.trim(),
      description: quickCreateForm.value.description || '',
      projectType: 'document', // 使用document类型（允许的类型：web, document, data, app）
      userId: userId,
    };

    message.loading({ content: '正在创建项目...', key: 'quick-create', duration: 0 });

    // 调用快速创建API
    const project = await window.electronAPI.project.createQuick(projectData);

    message.success({ content: '项目创建成功！', key: 'quick-create', duration: 2 });

    // 关闭弹窗并重置表单
    showQuickCreateModal.value = false;
    quickCreateForm.value = { name: '', description: '' };

    // 刷新项目列表
    await loadProjects();

    // 跳转到项目详情页
    router.push(`/projects/${project.id || project.projectId}`);
  } catch (error) {
    console.error('快速创建项目失败:', error);
    message.error({ content: '创建失败：' + error.message, key: 'quick-create', duration: 3 });
  }
};

// 选择项目
const handleSelectProject = (project) => {
  currentProjectId.value = project.id;
  router.push(`/projects/${project.id}`);
};

// 菜单点击
const handleMenuClick = ({ key }, project) => {
  switch (key) {
    case 'open':
      handleSelectProject(project);
      break;
    case 'rename':
      renameForm.value = {
        projectId: project.id,
        name: project.name,
      };
      renameModalVisible.value = true;
      break;
    case 'delete':
      handleDelete(project);
      break;
  }
};

// 重命名
const handleRename = async () => {
  if (!renameForm.value.name.trim()) {
    message.warning('请输入项目名称');
    return;
  }

  try {
    await projectStore.updateProject(renameForm.value.projectId, {
      name: renameForm.value.name,
    });
    message.success('重命名成功');
    renameModalVisible.value = false;
  } catch (error) {
    message.error('重命名失败：' + error.message);
  }
};

// 删除
const handleDelete = (project) => {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除项目"${project.name}"吗？此操作不可恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await projectStore.deleteProject(project.id);
        message.success('删除成功');
        if (currentProjectId.value === project.id) {
          currentProjectId.value = null;
          router.push('/projects');
        }
      } catch (error) {
        message.error('删除失败：' + error.message);
      }
    },
  });
};

// 加载项目列表
const loadProjects = async () => {
  loading.value = true;
  try {
    // 从authStore获取用户ID，或使用默认值
    const userId = authStore.currentUser?.id || 'default-user';
    console.log('[ProjectSidebar] 加载项目列表, userId:', userId);
    await projectStore.fetchProjects(userId);
    console.log('[ProjectSidebar] 项目列表加载完成, 项目数量:', projectStore.projects.length);
  } catch (error) {
    console.error('[ProjectSidebar] 加载项目列表失败:', error);
    message.error('加载项目列表失败');
  } finally {
    loading.value = false;
  }
};

// 监听路由变化，更新当前项目ID
watch(
  () => route.params.id,
  (newId) => {
    if (newId) {
      currentProjectId.value = newId;
      console.log('[ProjectSidebar] 路由变化，当前项目ID:', newId);
    }
  },
  { immediate: true }
);

// 初始化
onMounted(() => {
  // 恢复折叠状态
  const savedCollapsed = localStorage.getItem('project_sidebar_collapsed');
  if (savedCollapsed === '1') {
    collapsed.value = true;
  }

  // 加载项目列表
  loadProjects();
});
</script>

<style scoped>
.project-sidebar {
  width: 280px;
  height: 100%;
  background: #fafafa;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  transition: width 0.3s;
}

.project-sidebar.collapsed {
  width: 60px;
}

/* 头部 */
.sidebar-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid #e8e8e8;
  background: white;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.header-icon {
  font-size: 18px;
  color: #1890ff;
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-btn {
  flex-shrink: 0;
  font-size: 12px;
  padding: 4px;
}

/* 新建项目按钮 */
.new-project-section {
  padding: 12px;
  background: white;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-create-btn {
  font-weight: 500;
}

.ai-create-btn {
  border: 1px solid #d9d9d9;
  transition: all 0.3s;
}

.ai-create-btn:hover {
  border-color: #667eea;
  color: #667eea;
}

.ai-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 6px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  letter-spacing: 0.5px;
  margin-right: 4px;
}

/* 项目列表 */
.project-list {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 搜索框 */
.search-box {
  padding: 12px;
  background: white;
  border-bottom: 1px solid #e8e8e8;
}

/* 列表内容 */
.list-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.list-content::-webkit-scrollbar {
  width: 6px;
}

.list-content::-webkit-scrollbar-track {
  background: transparent;
}

.list-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

.list-content::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

/* 项目项 */
.project-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  background: white;
  border: 1px solid transparent;
}

.project-item:hover {
  background: #f0f5ff;
  border-color: #d6e4ff;
}

.project-item.active {
  background: #e6f7ff;
  border-color: #91d5ff;
}

.project-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 6px;
  color: white;
  font-size: 16px;
  flex-shrink: 0;
}

.project-info {
  flex: 1;
  min-width: 0;
}

.project-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.project-meta {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
}

.more-btn {
  opacity: 0;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.project-item:hover .more-btn {
  opacity: 1;
}

/* 折叠状态列表 */
.collapsed-list {
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.collapsed-item {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  margin: 0 auto;
  font-size: 18px;
  color: #1890ff;
}

.collapsed-item:hover {
  background: #f0f5ff;
  border-color: #d6e4ff;
}

.collapsed-item.active {
  background: #e6f7ff;
  border-color: #91d5ff;
}

/* Empty状态 */
:deep(.ant-empty) {
  margin: 40px 0;
}
</style>
