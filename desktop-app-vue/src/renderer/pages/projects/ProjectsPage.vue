<template>
  <div class="projects-page-wrapper">
    <!-- 项目历史侧边栏 -->
    <ProjectSidebar />

    <!-- 中央内容区域 -->
    <div class="main-content">
      <!-- 欢迎头部 (总是显示，优化问候语) -->
      <div class="welcome-header">
        <h1 class="welcome-title">{{ greetingMessage }}</h1>
        <div class="welcome-suggestion" @click="handleSuggestionClick">
          <BulbOutlined />
          <span>{{ currentSuggestion }}</span>
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

      <!-- 第一行：项目类型按钮 -->
      <div class="project-type-buttons">
        <a-button
          v-for="type in projectTypes"
          :key="type.key"
          :type="selectedType === type.key ? 'primary' : 'default'"
          class="task-quick-button"
          size="large"
          @click="handleTypeQuickSelect(type.key)"
        >
          <span class="button-label">{{ type.label }}</span>
        </a-button>
      </div>

      <!-- 第二行：动态子分类按钮 -->
      <div class="category-buttons-section">
        <a-button
          v-for="category in currentCategories"
          :key="category.key"
          :type="activeCategory === category.key ? 'primary' : 'default'"
          class="category-button"
          @click="handleCategoryChange(category.key)"
        >
          {{ category.label }}
        </a-button>
      </div>

      <!-- 模板展示区域 -->
      <div v-if="!loading" class="templates-grid-section">
        <TemplateGallery
          :category="selectedType"
          :subcategory="activeCategory !== 'all' ? activeCategory : null"
          @template-use="handleTemplateUse"
          @create-custom="handleCreateCustom"
        />
      </div>

    </div>

    <!-- 模板变量填写对话框 -->
    <TemplateVariableModal
      v-model:visible="showTemplateModal"
      :template="selectedTemplate"
      @success="handleTemplateSuccess"
      @cancel="showTemplateModal = false"
    />

    <!-- 任务执行监控器弹窗 -->
    <a-modal
      v-model:open="showTaskMonitor"
      title="任务执行监控"
      :width="900"
      :footer="null"
      :maskClosable="false"
      :keyboard="!isExecutingTask"
      @cancel="handleCloseTaskMonitor"
      class="task-monitor-modal"
    >
      <TaskExecutionMonitor
        v-if="currentTaskPlan"
        :task-plan="currentTaskPlan"
        @cancel="handleCancelTask"
        @close="handleCloseTaskMonitor"
        @viewResults="handleViewTaskResults"
        @retry="handleRetryTask"
        @fileClick="handleFileClick"
        @continueEdit="handleContinueEdit"
        @suggestionClick="handleSuggestionClick"
      />
    </a-modal>

    <!-- 流式创建进度Modal -->
    <StreamProgressModal
      :open="showStreamProgress"
      :progress-data="streamProgressData"
      :error="createError"
      @cancel="handleCancelStream"
      @retry="handleRetryStream"
      @close="handleCloseStream"
      @view-project="handleViewCreatedProject"
      @continue="handleContinueCreate"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import { useProjectStore } from '@/stores/project';
import { useAuthStore } from '@/stores/auth';
import { useAppStore } from '@/stores/app';
import {
  SearchOutlined,
  BulbOutlined,
  ArrowRightOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';
import ConversationInput from '@/components/projects/ConversationInput.vue';
import TaskExecutionMonitor from '@/components/projects/TaskExecutionMonitor.vue';
import StreamProgressModal from '@/components/projects/StreamProgressModal.vue';
import ProjectSidebar from '@/components/ProjectSidebar.vue';
import TemplateGallery from '@/components/templates/TemplateGallery.vue';
import TemplateVariableModal from '@/components/templates/TemplateVariableModal.vue';

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

// 任务执行相关
const currentTaskPlan = ref(null);
const showTaskMonitor = ref(false);
const isExecutingTask = ref(false);

// 流式创建进度
const showStreamProgress = ref(false);
const streamProgressData = ref({
  currentStage: '',
  stages: [],
  contentByStage: {},
  logs: [],
  metadata: {},
});
const createError = ref('');
const createdProjectId = ref('');

// 项目类型按钮（第一行）
const projectTypes = ref([
  { key: 'writing', label: '写作', prompt: '帮我写一篇关于...的文章' },
  { key: 'marketing', label: '营销', prompt: '制定一份...的营销方案' },
  { key: 'excel', label: 'Excel', prompt: '分析...的数据并生成报表' },
  { key: 'resume', label: '简历', prompt: '制作一份专业简历' },
  { key: 'ppt', label: 'PPT', prompt: '制作一份关于...的演示文稿' },
  { key: 'research', label: '研究', prompt: '进行...的研究分析' },
  { key: 'education', label: '教育', prompt: '设计一门...的课程' },
  { key: 'lifestyle', label: '生活', prompt: '规划...的生活计划' },
  { key: 'podcast', label: '播客', prompt: '为...生成播客脚本' },
  { key: 'design', label: '设计', prompt: '设计一个...的海报/Logo' },
  { key: 'web', label: '网页', prompt: '创建一个...的网站' },
]);

// 子分类配置（第二行，根据项目类型动态变化）
const categoryConfig = ref({
  // 默认分类（未选择项目类型时）
  all: [
    { key: 'all', label: '全部模板' },
    { key: 'office', label: '办公文档' },
    { key: 'business', label: '商业' },
    { key: 'tech', label: '技术' },
    { key: 'event', label: '活动' },
    { key: 'finance', label: '财务' },
    { key: 'analysis', label: '分析' },
    { key: '职位', label: '求职' },
  ],
  // 写作子分类
  writing: [
    { key: 'all', label: '全部' },
    { key: 'office', label: '办公写作' },
    { key: 'business', label: '商业计划' },
    { key: 'tech', label: '技术文档' },
  ],
  // 营销子分类
  marketing: [
    { key: 'all', label: '全部' },
    { key: 'event', label: '活动策划' },
    { key: 'content', label: '内容营销' },
  ],
  // PPT子分类
  ppt: [
    { key: 'all', label: '全部' },
    { key: 'business', label: '商业路演' },
    { key: 'training', label: '培训课件' },
  ],
  // 设计子分类
  design: [
    { key: 'all', label: '全部' },
    { key: 'poster', label: '海报设计' },
  ],
  // Excel子分类
  excel: [
    { key: 'all', label: '全部' },
    { key: 'finance', label: '财务预算' },
    { key: 'analysis', label: '数据分析' },
  ],
  // 简历子分类
  resume: [
    { key: 'all', label: '全部' },
    { key: '职位', label: '产品经理' },
    { key: '职位', label: '设计师' },
    { key: '职位', label: '技术岗位' },
  ],
  // 研究子分类
  research: [
    { key: 'all', label: '全部' },
    { key: 'user', label: '用户研究' },
    { key: 'market', label: '竞品分析' },
  ],
  // 教育子分类
  education: [
    { key: 'all', label: '全部' },
    { key: 'course', label: '在线课程' },
  ],
  // 生活子分类
  lifestyle: [
    { key: 'all', label: '全部' },
    { key: 'travel', label: '旅游攻略' },
    { key: 'wellness', label: '健康计划' },
  ],
  // 播客子分类
  podcast: [
    { key: 'all', label: '全部' },
    { key: 'interview', label: '访谈节目' },
    { key: 'storytelling', label: '故事讲述' },
  ],
  // 网页子分类
  web: [
    { key: 'all', label: '全部' },
    { key: 'landing', label: '落地页' },
  ],
});

// 当前显示的子分类
const currentCategories = computed(() => {
  if (selectedType.value && categoryConfig.value[selectedType.value]) {
    return categoryConfig.value[selectedType.value];
  }
  return categoryConfig.value.all;
});


// 智能问候语（根据时间）
const greetingMessage = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '深夜好！有什么需要处理的吗？';
  if (hour < 12) return '早上好！有哪些工作要处理？';
  if (hour < 14) return '中午好！有哪些工作要处理？';
  if (hour < 18) return '下午好！有新的工作安排吗？';
  if (hour < 22) return '晚上好！今天还有什么要完成的？';
  return '夜深了！还在工作吗？';
});

// 智能建议列表
const suggestions = ref([
  'Logo 设计怎么选取权威网站？',
  '如何快速制作年度工作总结PPT？',
  '帮我分析最近3个月的销售数据趋势',
  '生成一份产品介绍网站需要哪些页面？',
  '制作一张古风美女插画需要什么提示词？',
  '如何为播客节目撰写吸引人的标题？',
  '数据可视化图表有哪些常见类型？',
  '个人简历网站应该包含哪些模块？',
]);

const currentSuggestion = computed(() => {
  const index = Math.floor(Date.now() / 10000) % suggestions.value.length;
  return suggestions.value[index];
});

// 模板相关
const showTemplateModal = ref(false);
const selectedTemplate = ref(null);


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

// 处理对话式创建项目（流式）
const handleConversationalCreate = async ({ text, attachments }) => {
  try {
    // 显示流式进度Modal
    showStreamProgress.value = true;
    createError.value = '';
    streamProgressData.value = {
      currentStage: '',
      stages: [],
      contentByStage: {},
      logs: [],
      metadata: {},
    };

    // 1. 流式创建项目
    const userId = authStore.currentUser?.id || 'default-user';
    const projectData = {
      userPrompt: text,
      name: text.substring(0, 50) || '未命名项目',
      projectType: '', // 留空让后端AI自动识别项目类型
      userId: userId,
    };

    const project = await projectStore.createProjectStream(projectData, (progressUpdate) => {
      console.log('[ProjectsPage] ===== Progress回调被触发 =====');
      console.log('[ProjectsPage] Progress update:', progressUpdate);
      console.log('[ProjectsPage] Progress type:', progressUpdate.type);

      // 更新进度数据
      streamProgressData.value = { ...progressUpdate };
      console.log('[ProjectsPage] streamProgressData.value已更新');

      // 处理不同类型
      if (progressUpdate.type === 'complete') {
        createdProjectId.value = progressUpdate.result.projectId;
        message.success('项目创建成功！');
      } else if (progressUpdate.type === 'error') {
        createError.value = progressUpdate.error;
        message.error('创建项目失败：' + progressUpdate.error);
        return; // 出错时直接返回，不执行任务拆解
      }
    });

    // 如果创建失败，不继续执行任务拆解
    if (createError.value) {
      return;
    }

    // 2. AI智能拆解任务
    try {
      message.loading({ content: 'AI正在拆解任务...', key: 'ai-decompose', duration: 0 });

      // 使用正确的projectId（从createProjectStream的回调中获取）
      console.log('[ProjectsPage] 准备拆解任务');
      console.log('[ProjectsPage] createdProjectId.value:', createdProjectId.value);
      console.log('[ProjectsPage] project:', project);
      console.log('[ProjectsPage] project?.projectId:', project?.projectId);
      console.log('[ProjectsPage] project?.id:', project?.id);

      const projectId = createdProjectId.value || project?.projectId || project?.id;

      console.log('[ProjectsPage] 最终使用的projectId:', projectId);

      if (!projectId) {
        console.error('[ProjectsPage] 错误：projectId为空！');
        throw new Error('项目ID不存在，无法进行任务拆解');
      }

      const contextData = {
        projectId: projectId,
        projectType: project?.project_type || project?.projectType,
        projectName: projectData.name,
        root_path: project?.root_path || project?.rootPath
      };

      console.log('[ProjectsPage] 任务拆解上下文:', contextData);

      const taskPlan = await window.electronAPI.project.decomposeTask(text, contextData);

      message.success({ content: '任务拆解完成', key: 'ai-decompose', duration: 2 });

      // 3. 显示任务执行监控器
      currentTaskPlan.value = taskPlan;
      showTaskMonitor.value = true;

      // 4. 自动开始执行
      executeTaskPlan(taskPlan);
    } catch (decomposeError) {
      console.error('Task decompose failed:', decomposeError);
      message.warning({
        content: '任务拆解失败，已创建项目。您可以手动编辑。',
        key: 'ai-decompose',
        duration: 3
      });

      // 即使拆解失败，也跳转到项目页
      router.push(`/projects/${project.projectId || createdProjectId.value}`);
    }
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
const handleTypeQuickSelect = (typeKey) => {
  // 切换选择状态
  if (selectedType.value === typeKey) {
    // 如果点击已选中的类型，则取消选择，回到默认状态
    selectedType.value = '';
    activeCategory.value = 'all';
  } else {
    // 选择新类型
    selectedType.value = typeKey;
    // 重置子分类为该类型的第一个子分类
    const categories = categoryConfig.value[typeKey];
    if (categories && categories.length > 0) {
      activeCategory.value = categories[0].key;
    }
  }
  currentPage.value = 1;
};

// 处理建议点击（支持两种调用方式）
const handleSuggestionClick = (params) => {
  // 如果有参数，说明来自TaskExecutionMonitor组件
  if (params && params.question) {
    console.log('Suggestion clicked from TaskMonitor:', params.question);
    message.info(`正在处理建议：${params.question}`);
    // TODO: 将建议作为新的对话输入，发送给AI处理
  } else {
    // 无参数，说明是点击欢迎区的建议
    console.log('Suggestion clicked from welcome:', currentSuggestion.value);
    message.info('功能开发中：将建议填充到输入框');
    // TODO: 实现填充输入框功能
  }
};

// 处理模板使用
const handleTemplateUse = (template) => {
  console.log('[ProjectsPage] 使用模板:', template);
  selectedTemplate.value = template;
  showTemplateModal.value = true;
};

// 处理模板创建成功
const handleTemplateSuccess = (result) => {
  console.log('[ProjectsPage] 项目创建成功:', result);
  // 跳转到项目详情页
  if (result.projectId) {
    router.push(`/projects/${result.projectId}`);
  }
};

// 处理创建自定义项目
const handleCreateCustom = () => {
  router.push('/projects/new');
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

// 执行任务计划
const executeTaskPlan = async (taskPlan) => {
  try {
    isExecutingTask.value = true;

    const result = await window.electronAPI.project.executeTaskPlan(
      taskPlan.id,
      {
        projectId: taskPlan.project_id,
        root_path: projectStore.projects.find(p => p.id === taskPlan.project_id)?.root_path
      }
    );

    isExecutingTask.value = false;

    if (result.success) {
      message.success('任务执行完成！');
    } else {
      message.error('任务执行失败：' + result.error);
    }
  } catch (error) {
    isExecutingTask.value = false;
    console.error('Execute task plan failed:', error);
    message.error('任务执行失败：' + error.message);
  }
};

// 处理任务进度更新
const handleTaskProgressUpdate = (progress) => {
  if (!currentTaskPlan.value || progress.taskPlan.id !== currentTaskPlan.value.id) {
    return;
  }

  // 更新任务计划状态
  currentTaskPlan.value = progress.taskPlan;

  // 根据进度类型显示消息
  if (progress.type === 'subtask-started') {
    console.log(`开始执行: ${progress.subtask.title}`);
  } else if (progress.type === 'subtask-completed') {
    console.log(`已完成: ${progress.subtask.title}`);
  } else if (progress.type === 'task-completed') {
    message.success('所有任务已完成！');
    isExecutingTask.value = false;
  } else if (progress.type === 'task-failed') {
    message.error('任务执行失败');
    isExecutingTask.value = false;
  }
};

// 取消任务
const handleCancelTask = async (taskPlanId) => {
  Modal.confirm({
    title: '确认取消',
    content: '确定要取消当前任务吗？',
    okText: '取消任务',
    okType: 'danger',
    cancelText: '继续执行',
    onOk: async () => {
      try {
        await window.electronAPI.project.cancelTaskPlan(taskPlanId);
        message.success('任务已取消');
        showTaskMonitor.value = false;
        currentTaskPlan.value = null;
        isExecutingTask.value = false;
      } catch (error) {
        console.error('Cancel task failed:', error);
        message.error('取消失败：' + error.message);
      }
    }
  });
};

// 关闭任务监控器
const handleCloseTaskMonitor = () => {
  if (isExecutingTask.value) {
    Modal.confirm({
      title: '任务正在执行',
      content: '任务仍在执行中，关闭监控器不会停止任务。确定要关闭吗？',
      okText: '关闭',
      cancelText: '取消',
      onOk: () => {
        showTaskMonitor.value = false;
      }
    });
  } else {
    showTaskMonitor.value = false;
  }
};

// 流式创建相关处理方法
const handleCancelStream = async () => {
  try {
    await projectStore.cancelProjectStream();
    showStreamProgress.value = false;
    message.info('已取消创建');
  } catch (error) {
    message.error('取消失败：' + error.message);
  }
};

const handleRetryStream = async () => {
  // 重试逻辑：重新开始创建
  showStreamProgress.value = false;
  createError.value = '';
};

const handleCloseStream = () => {
  showStreamProgress.value = false;
  streamProgressData.value = {
    currentStage: '',
    stages: [],
    contentByStage: {},
    logs: [],
    metadata: {},
  };
  createError.value = '';
};

const handleViewCreatedProject = () => {
  showStreamProgress.value = false;
  if (createdProjectId.value) {
    router.push(`/projects/${createdProjectId.value}`);
  }
};

const handleContinueCreate = () => {
  showStreamProgress.value = false;
  createError.value = '';
  createdProjectId.value = '';
};

// 查看任务结果
const handleViewTaskResults = (taskPlan) => {
  const project = projectStore.projects.find(p => p.id === taskPlan.project_id);
  if (project) {
    router.push(`/projects/${project.id}`);
    showTaskMonitor.value = false;
  }
};

// 重试任务
const handleRetryTask = async (taskPlan) => {
  message.info('重新执行任务...');
  executeTaskPlan(taskPlan);
};

// 处理文件点击（预览）
const handleFileClick = ({ file, subtask, taskPlan }) => {
  console.log('Preview file:', file);
  message.info(`预览文件: ${file}`);
  // TODO: 实现文件预览功能
};

// 处理继续编辑（根据这个来改）
const handleContinueEdit = ({ file, taskPlan }) => {
  console.log('Continue edit file:', file);
  message.success(`将基于 ${file.name} 继续编辑`);
  // TODO: 打开编辑器并加载文件内容
  // router.push(`/projects/${taskPlan.project_id}/edit?file=${file.path}`);
};

// 项目相关处理函数
// 组件挂载时加载项目并监听进度
// 处理文件更新事件
const handleFilesUpdated = async (data) => {
  console.log('项目文件已更新:', data);
  try {
    // 重新加载项目列表以显示最新文件数
    const userId = authStore.currentUser?.id || 'default-user';
    await projectStore.fetchProjects(userId);
    message.success(`成功注册 ${data.filesCount} 个新文件`);
  } catch (error) {
    console.error('刷新项目失败:', error);
  }
};

onMounted(async () => {
  try {
    const userId = authStore.currentUser?.id || 'default-user';
    await projectStore.fetchProjects(userId);
    await loadRecentConversations();

    // 监听任务进度更新
    window.electronAPI.project.onTaskProgressUpdate(handleTaskProgressUpdate);

    // 监听项目文件更新
    window.electronAPI.project.onFilesUpdated(handleFilesUpdated);
  } catch (error) {
    console.error('Failed to load projects:', error);
    message.error('加载项目失败：' + error.message);
  }
});

// 组件卸载时清理监听
onUnmounted(() => {
  if (window.electronAPI?.project?.offTaskProgressUpdate) {
    window.electronAPI.project.offTaskProgressUpdate(handleTaskProgressUpdate);
  }
  if (window.electronAPI?.project?.offFilesUpdated) {
    window.electronAPI.project.offFilesUpdated(handleFilesUpdated);
  }
});
</script>

<style scoped lang="scss">
/* 扣子空间风格 - 项目列表页 */
.projects-page-wrapper {
  display: flex;
  min-height: 100%;
  padding: 0;
  margin: -24px; /* 抵消 layout-content 的 padding */
  height: calc(100vh - 56px - 40px); /* 减去 header 和 tabs-bar 的高度 */
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

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.15);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.25);
  }
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


/* 第一行：项目类型按钮 */
.project-type-buttons {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  justify-content: center;

  .task-quick-button {
    border-radius: 20px;
    padding: 10px 28px;
    height: auto;
    font-size: 15px;
    border-color: #E5E7EB;
    color: #666666;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.3s;
    background: #FFFFFF;

    .button-label {
      font-weight: 500;
    }

    &:hover {
      border-color: #667eea;
      color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
    }

    &.ant-btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-color: transparent;
      color: white;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);

      &:hover {
        background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
      }
    }
  }
}

/* 第二行：子分类按钮 */
.category-buttons-section {
  display: flex;
  gap: 12px;
  margin-bottom: 40px;
  flex-wrap: wrap;
  justify-content: center;

  .category-button {
    border-radius: 16px;
    padding: 8px 20px;
    height: auto;
    font-size: 14px;
    border-color: #E5E7EB;
    color: #666666;
    transition: all 0.3s;
    background: #F5F5F5;

    &:hover {
      border-color: #667eea;
      color: #667eea;
      background: #F0F5FF;
    }

    &.ant-btn-primary {
      background: #667eea;
      border-color: #667eea;
      color: white;

      &:hover {
        background: #764ba2;
        border-color: #764ba2;
      }
    }
  }
}

/* 模板展示区域 */
.templates-grid-section {
  margin: 40px 0;
  min-height: 400px;
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 24px;
  margin-bottom: 40px;
}

.template-card {
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    border-color: #667eea;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.15);
    transform: translateY(-4px);

    .template-preview img {
      transform: scale(1.05);
    }
  }

  .template-preview {
    width: 100%;
    height: 180px;
    background: #F5F5F5;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.3s;
    }

    .template-placeholder {
      font-size: 64px;
      color: #D1D5DB;
    }
  }

  .template-info {
    padding: 16px;
  }

  .template-name {
    font-size: 15px;
    font-weight: 600;
    color: #333333;
    margin-bottom: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .template-desc {
    font-size: 13px;
    color: #666666;
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}

.empty-templates {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  color: #9CA3AF;

  .empty-icon {
    font-size: 64px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  h3 {
    font-size: 18px;
    font-weight: 500;
    color: #6B7280;
    margin: 0 0 8px 0;
  }

  p {
    font-size: 14px;
    color: #9CA3AF;
    margin: 0;
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

/* 任务监控器弹窗样式 */
:deep(.task-monitor-modal) {
  .ant-modal-body {
    padding: 0;
    max-height: 70vh;
    overflow-y: auto;
  }

  .ant-modal-header {
    padding: 16px 24px;
    border-bottom: 1px solid #e8e8e8;
  }
}

</style>
