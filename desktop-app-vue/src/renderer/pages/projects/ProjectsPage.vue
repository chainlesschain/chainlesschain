<template>
  <div class="projects-page-wrapper">
    <!-- 左侧导航栏 -->
    <ProjectSidebar
      :conversations="recentConversations"
      :active-conversation="activeConversationId"
      :active-item="activeNavItem"
      :user-name="userName"
      :user-avatar="userAvatar"
      @new-conversation="handleNewConversation"
      @conversation-click="handleConversationClick"
      @conversation-action="handleConversationAction"
      @nav-click="handleNavClick"
      @user-action="handleUserAction"
    />

    <!-- 中央内容区域 -->
    <div class="main-content">
      <!-- 欢迎头部 (无项目时显示) -->
      <div v-if="!hasProjects && !loading" class="welcome-header">
        <h1 class="welcome-title">又见面啦！有新的工作安排吗？</h1>
        <div class="welcome-suggestion">
          <BulbOutlined />
          <span>Logo 设计怎么选取权威网站？</span>
          <ArrowRightOutlined />
        </div>
      </div>

      <!-- 对话输入框 -->
      <div class="conversation-input-section">
        <ConversationInput
          :placeholder="inputPlaceholder"
          @submit="handleConversationalCreate"
          @file-upload="handleFileUpload"
        />
      </div>

      <!-- 项目类型标签栏 -->
      <div class="category-tabs-section">
        <a-tabs v-model:activeKey="activeCategory" @change="handleCategoryChange">
          <a-tab-pane key="all" tab="探索" />
          <a-tab-pane key="recent" tab="人命相关" />
          <a-tab-pane key="education" tab="教育学习" />
          <a-tab-pane key="finance" tab="财经分析" />
          <a-tab-pane key="life" tab="生活娱乐" />
          <a-tab-pane key="marketing" tab="市场营销" />
          <a-tab-pane key="travel" tab="旅游攻略" />
        </a-tabs>
      </div>

      <!-- 项目类型快捷按钮 -->
      <div class="project-type-buttons">
        <a-button
          v-for="type in projectTypes"
          :key="type.key"
          :type="selectedType === type.key ? 'primary' : 'default'"
          @click="handleTypeQuickSelect(type.key)"
        >
          {{ type.label }}
        </a-button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-container">
        <a-spin size="large" tip="加载中..." />
      </div>

      <!-- 项目卡片网格 -->
      <div v-else-if="filteredProjects.length > 0" class="projects-grid-section">
        <div class="projects-grid">
          <ProjectCard
            v-for="project in paginatedProjects"
            :key="project.id"
            :project="project"
            @view="handleViewProject"
            @edit="handleEditProject"
            @delete="handleDeleteProject"
          />
        </div>

        <!-- 分页 -->
        <div class="pagination-container" v-if="filteredTotal > pageSize">
          <a-pagination
            v-model:current="currentPage"
            v-model:page-size="pageSize"
            :total="filteredTotal"
            :show-total="total => `共 ${total} 个项目`"
            :show-size-changer="true"
            :page-size-options="['12', '24', '48']"
            @change="handlePageChange"
            @showSizeChange="handlePageSizeChange"
          />
        </div>
      </div>

      <!-- 空状态 (有筛选条件但无结果时) -->
      <div v-else-if="selectedType || activeCategory !== 'all'" class="empty-result">
        <div class="empty-icon">
          <SearchOutlined />
        </div>
        <h3>没有找到匹配的项目</h3>
        <p>尝试选择其他类别或创建新项目</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useProjectStore } from '@/stores/project';
import { useAuthStore } from '@/stores/auth';
import { useAppStore } from '@/stores/app';
import {
  SearchOutlined,
  BulbOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue';
import ProjectSidebar from '@/components/projects/ProjectSidebar.vue';
import ConversationInput from '@/components/projects/ConversationInput.vue';
import ProjectCard from '@/components/projects/ProjectCard.vue';

const router = useRouter();
const projectStore = useProjectStore();
const authStore = useAuthStore();
const appStore = useAppStore();

// 响应式状态
const activeCategory = ref('all');
const selectedType = ref('');
const currentPage = ref(1);
const pageSize = ref(12);
const activeConversationId = ref('');
const activeNavItem = ref('');
const recentConversations = ref([]);

// 项目类型列表
const projectTypes = ref([
  { key: 'write', label: '写作' },
  { key: 'ppt', label: 'PPT' },
  { key: 'design', label: '设计' },
  { key: 'excel', label: 'Excel' },
  { key: 'web', label: '网页' },
  { key: 'video', label: '视频' },
  { key: 'image', label: '图库' },
]);

// 计算属性
const loading = computed(() => projectStore.loading);
const userName = computed(() => authStore.currentUser?.name || '访客');
const userAvatar = computed(() => authStore.currentUser?.avatar || '');
const hasProjects = computed(() => projectStore.projects.length > 0);
const inputPlaceholder = computed(() => '给我发消息或描述你的任务...');

// 过滤项目
const filteredProjects = computed(() => {
  let projects = projectStore.projects;

  // 按类型筛选
  if (selectedType.value) {
    projects = projects.filter(p => p.project_type === selectedType.value);
  }

  // 按类别筛选
  if (activeCategory.value !== 'all') {
    projects = projects.filter(p => p.category === activeCategory.value);
  }

  return projects;
});

// 分页项目
const paginatedProjects = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredProjects.value.slice(start, end);
});

const filteredTotal = computed(() => filteredProjects.value.length);

// 处理新对话
const handleNewConversation = () => {
  router.push('/projects/new');
};

// 处理对话点击
const handleConversationClick = (conversation) => {
  activeConversationId.value = conversation.id;
  router.push(`/projects/${conversation.project_id}`);
};

// 处理对话操作
const handleConversationAction = ({ action, conversation }) => {
  switch (action) {
    case 'rename':
      // TODO: 实现重命名功能
      message.info('重命名功能开发中...');
      break;
    case 'star':
      // TODO: 实现收藏功能
      message.info('收藏功能开发中...');
      break;
    case 'delete':
      handleDeleteConversation(conversation);
      break;
  }
};

// 处理导航点击
const handleNavClick = (item) => {
  activeNavItem.value = item.id;
  // 根据不同的导航项执行不同操作
  if (item.id.startsWith('proj-')) {
    const typeMap = {
      'proj-web': 'web',
      'proj-doc': 'document',
      'proj-excel': 'data',
      'proj-ppt': 'ppt',
      'proj-video': 'video',
      'proj-design': 'design',
      'proj-code': 'code',
    };
    selectedType.value = typeMap[item.id] || '';
  }
};

// 处理用户操作
const handleUserAction = (action) => {
  switch (action) {
    case 'profile':
      router.push('/profile');
      break;
    case 'settings':
      router.push('/settings');
      break;
    case 'logout':
      authStore.logout();
      router.push('/login');
      break;
  }
};

// 处理对话式创建项目
const handleConversationalCreate = async ({ text, attachments }) => {
  try {
    message.loading({ content: 'AI正在理解您的需求...', key: 'ai-create', duration: 0 });

    // TODO: 调用AI引擎处理用户输入
    // 临时实现：直接创建项目
    const userId = authStore.currentUser?.id || 'default-user';
    const projectData = {
      name: text.substring(0, 50) || '未命名项目',
      description: text,
      project_type: 'web', // 默认类型，后续由AI识别
      status: 'draft',
      user_id: userId,
    };

    const project = await projectStore.createProject(projectData);

    message.success({ content: '项目创建成功！', key: 'ai-create', duration: 2 });

    // 跳转到项目详情页
    router.push(`/projects/${project.id}`);
  } catch (error) {
    console.error('Failed to create project:', error);
    message.error({ content: '创建失败：' + error.message, key: 'ai-create', duration: 3 });
  }
};

// 处理文件上传
const handleFileUpload = (files) => {
  console.log('Files uploaded:', files);
  // TODO: 处理文件上传
};

// 处理类别切换
const handleCategoryChange = (category) => {
  activeCategory.value = category;
  currentPage.value = 1;
};

// 处理类型快捷选择
const handleTypeQuickSelect = (type) => {
  selectedType.value = selectedType.value === type ? '' : type;
  currentPage.value = 1;
};

// 处理分页变化
const handlePageChange = (page, size) => {
  currentPage.value = page;
};

const handlePageSizeChange = (current, size) => {
  pageSize.value = size;
  currentPage.value = 1;
};

// 处理查看项目
const handleViewProject = (projectId) => {
  const project = projectStore.projects.find(p => p.id === projectId);
  const projectName = project ? project.name : '项目详情';

  appStore.addTab({
    key: `project-${projectId}`,
    title: projectName,
    path: `/projects/${projectId}`,
    closable: true,
  });

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

// 处理删除对话
const handleDeleteConversation = (conversation) => {
  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这个对话吗？',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      // TODO: 实现删除对话功能
      message.success('对话已删除');
    },
  });
};

// 加载最近对话
const loadRecentConversations = async () => {
  // TODO: 从数据库加载最近对话
  recentConversations.value = [];
};

// 组件挂载时加载项目
onMounted(async () => {
  try {
    const userId = authStore.currentUser?.id || 'default-user';
    await projectStore.fetchProjects(userId);
    await loadRecentConversations();
  } catch (error) {
    console.error('Failed to load projects:', error);
    message.error('加载项目失败：' + error.message);
  }
});
</script>

<style scoped lang="scss">
/* 扣子空间风格 - 项目列表页 */
.projects-page-wrapper {
  display: flex;
  height: 100vh;
  background: #FFFFFF;
  overflow: hidden;
}

/* 中央内容区域 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 40px 80px;
  background: #FFFFFF;
}

/* 欢迎头部 */
.welcome-header {
  text-align: center;
  margin-bottom: 32px;
  padding: 60px 0 40px;
}

.welcome-title {
  font-size: 36px;
  font-weight: 400;
  color: #333333;
  margin: 0 0 24px 0;
  line-height: 1.4;
}

.welcome-suggestion {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: #F5F7FA;
  border-radius: 24px;
  color: #666666;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    background: #E5E7EB;
    color: #333333;
  }

  .anticon {
    color: #FF8C00;
  }
}

/* 对话输入框区域 */
.conversation-input-section {
  max-width: 900px;
  width: 100%;
  margin: 0 auto 32px;
}

/* 类别标签栏 */
.category-tabs-section {
  margin-bottom: 24px;

  :deep(.ant-tabs) {
    .ant-tabs-nav {
      margin-bottom: 0;
    }

    .ant-tabs-tab {
      padding: 12px 24px;
      font-size: 15px;
      color: #666666;

      &:hover {
        color: #333333;
      }

      &.ant-tabs-tab-active {
        .ant-tabs-tab-btn {
          color: #1677FF;
          font-weight: 500;
        }
      }
    }

    .ant-tabs-ink-bar {
      background: #1677FF;
    }
  }
}

/* 项目类型快捷按钮 */
.project-type-buttons {
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
  flex-wrap: wrap;

  :deep(.ant-btn) {
    border-radius: 20px;
    padding: 6px 20px;
    height: auto;
    font-size: 14px;
    border-color: #E5E7EB;
    color: #666666;

    &:hover {
      border-color: #1677FF;
      color: #1677FF;
    }

    &.ant-btn-primary {
      background: #1677FF;
      border-color: #1677FF;
      color: white;
    }
  }
}

/* 加载状态 */
.loading-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

/* 项目网格区域 */
.projects-grid-section {
  flex: 1;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: 40px;
}

/* 分页 */
.pagination-container {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}

/* 空结果状态 */
.empty-result {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  text-align: center;
  padding: 80px 40px;

  .empty-icon {
    font-size: 72px;
    color: #D1D5DB;
    margin-bottom: 24px;
  }

  h3 {
    font-size: 20px;
    font-weight: 500;
    color: #374151;
    margin: 0 0 12px 0;
  }

  p {
    font-size: 15px;
    color: #6B7280;
    margin: 0;
  }
}

/* 滚动条样式 */
.main-content {
  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: #D1D5DB;
    border-radius: 4px;

    &:hover {
      background: #9CA3AF;
    }
  }

  &::-webkit-scrollbar-track {
    background: #F9FAFB;
  }
}
</style>
