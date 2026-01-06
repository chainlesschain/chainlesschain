import { createRouter, createWebHashHistory } from 'vue-router';
import { useAppStore } from '../stores/app';
import { setupCommonHints, preloadRouteResources } from '../utils/resource-hints';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../pages/LoginPage.vue'),
  },
  // 公开分享页面（无需认证）
  {
    path: '/share/project/:token',
    name: 'ShareProject',
    component: () => import('../pages/ShareProjectView.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    name: 'Main',
    component: () => import('../components/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Home',
        component: () => import('../pages/projects/ProjectsPage.vue'),
      },
      {
        path: 'knowledge/:id',
        name: 'KnowledgeDetail',
        component: () => import('../pages/KnowledgeDetailPage.vue'),
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('../pages/SettingsPage.vue'),
      },
      {
        path: 'settings/system',
        name: 'SystemSettings',
        component: () => import('../pages/settings/SystemSettings.vue'),
        meta: { title: '系统设置' },
      },
      {
        path: 'settings/plugins',
        name: 'PluginManagement',
        component: () => import('../pages/settings/PluginManagement.vue'),
        meta: { title: '插件管理' },
      },
      {
        path: 'settings/database-security',
        name: 'DatabaseSecurity',
        component: () => import('../pages/settings/DatabaseSecurity.vue'),
        meta: { title: '数据库安全' },
      },
      {
        path: 'settings/skills',
        name: 'SkillManagement',
        component: () => import('../pages/SkillManagement.vue'),
        meta: { title: '技能管理' },
      },
      {
        path: 'settings/tools',
        name: 'ToolManagement',
        component: () => import('../pages/ToolManagement.vue'),
        meta: { title: '工具管理' },
      },
      {
        path: 'settings/voice-input',
        name: 'VoiceInputTest',
        component: () => import('../pages/VoiceInputTestPage.vue'),
        meta: { title: '语音输入测试' },
      },
      {
        path: 'did',
        name: 'DIDManagement',
        component: () => import('../components/DIDManagement.vue'),
      },
      {
        path: 'contacts',
        name: 'ContactManagement',
        component: () => import('../components/ContactManagement.vue'),
      },
      {
        path: 'credentials',
        name: 'VCManagement',
        component: () => import('../components/VCManagement.vue'),
      },
      {
        path: 'p2p-messaging',
        name: 'P2PMessaging',
        component: () => import('../components/P2PMessaging.vue'),
        meta: { title: 'P2P加密消息' },
      },
      {
        path: 'chat',
        name: 'Chat',
        component: () => import('../components/social/ChatWindow.vue'),
        meta: { title: '聊天' },
      },
      {
        path: 'image-upload',
        name: 'ImageUpload',
        component: () => import('../components/ImageUpload.vue'),
        meta: { title: '图片上传' },
      },
      {
        path: 'file-import',
        name: 'FileImport',
        component: () => import('../components/FileImport.vue'),
        meta: { title: '文件导入' },
      },
      {
        path: 'prompt-templates',
        name: 'PromptTemplates',
        component: () => import('../components/PromptTemplates.vue'),
        meta: { title: '提示词模板' },
      },
      {
        path: 'template-management',
        name: 'TemplateManagement',
        component: () => import('../pages/templates/TemplateManagementPage.vue'),
        meta: { title: '项目模板管理' },
      },
      {
        path: 'friends',
        name: 'Friends',
        component: () => import('../components/Friends.vue'),
        meta: { title: '好友管理' },
      },
      {
        path: 'posts',
        name: 'PostFeed',
        component: () => import('../components/PostFeed.vue'),
        meta: { title: '动态' },
      },
      // ===== 交易系统 =====
      // 交易中心统一入口
      {
        path: 'trading',
        name: 'TradingHub',
        component: () => import('../pages/TradingHub.vue'),
        meta: { title: '交易中心' },
      },
      // 独立快捷入口（保留）
      {
        path: 'marketplace',
        name: 'Marketplace',
        component: () => import('../components/trade/Marketplace.vue'),
        meta: { title: '交易市场' },
      },
      {
        path: 'contracts',
        name: 'Contracts',
        component: () => import('../components/trade/ContractList.vue'),
        meta: { title: '智能合约' },
      },
      {
        path: 'knowledge-store',
        name: 'KnowledgeStore',
        component: () => import('../components/knowledge/ContentStore.vue'),
        meta: { title: '知识付费' },
      },
      {
        path: 'my-purchases',
        name: 'MyPurchases',
        component: () => import('../components/knowledge/MyPurchases.vue'),
        meta: { title: '我的购买' },
      },
      {
        path: 'credit-score',
        name: 'CreditScore',
        component: () => import('../components/trade/CreditScore.vue'),
        meta: { title: '信用评分' },
      },
      {
        path: 'my-reviews',
        name: 'MyReviews',
        component: () => import('../components/trade/MyReviews.vue'),
        meta: { title: '我的评价' },
      },
      // ===== 区块链钱包 =====
      {
        path: 'wallet',
        name: 'Wallet',
        component: () => import('../pages/Wallet.vue'),
        meta: { title: '钱包管理' },
      },
      {
        path: 'bridge',
        name: 'Bridge',
        component: () => import('../pages/Bridge.vue'),
        meta: { title: '跨链桥' },
      },
      // 项目管理模块
            {
        path: 'projects/categories',
        name: 'ProjectCategories',
        component: () => import('../pages/projects/CategoryManagePage.vue'),
        meta: { title: '项目分类' },
      },
      {
        path: 'projects/management',
        name: 'ProjectManagement',
        component: () => import('../pages/projects/ProjectManagementPage.vue'),
        meta: { title: '项目列表管理' },
      },
      {
        path: 'projects',
        name: 'Projects',
        component: () => import('../pages/projects/ProjectsPage.vue'),
        meta: { title: '我的项目' },
      },
      {
        path: 'projects/new',
        name: 'NewProject',
        component: () => import('../pages/projects/NewProjectPage.vue'),
        meta: { title: '新建项目' },
      },
      {
        path: 'projects/market',
        name: 'ProjectMarket',
        component: () => import('../pages/projects/MarketPage.vue'),
        meta: { title: '项目市场' },
      },
      {
        path: 'projects/collaboration',
        name: 'ProjectCollaboration',
        component: () => import('../pages/projects/CollaborationPage.vue'),
        meta: { title: '协作项目' },
      },
      {
        path: 'projects/archived',
        name: 'ProjectArchived',
        component: () => import('../pages/projects/ArchivedPage.vue'),
        meta: { title: '已归档项目' },
      },
      {
        path: 'projects/:id',
        name: 'ProjectDetail',
        component: () => import('../pages/projects/ProjectDetailPage.vue'),
        meta: { title: '项目详情' },
      },
      // 设计工具编辑器
      {
        path: 'design/:projectId',
        name: 'DesignEditor',
        component: () => import('../pages/design/DesignEditorPage.vue'),
        meta: { title: '设计编辑器' },
      },
      {
        path: 'projects/:id/edit',
        name: 'ProjectEdit',
        component: () => import('../pages/projects/ProjectDetailPage.vue'),
        meta: { title: '编辑项目' },
      },
      // 知识模块
      {
        path: 'knowledge/list',
        name: 'KnowledgeList',
        component: () => import('../pages/KnowledgeListPage.vue'),
        meta: { title: '我的知识' },
      },
      {
        path: 'knowledge/graph',
        name: 'KnowledgeGraph',
        component: () => import('../pages/KnowledgeGraphPage.vue'),
        meta: { title: '知识图谱' },
      },
      // AI对话
      {
        path: 'ai/chat',
        name: 'AIChat',
        component: () => import('../pages/AIChatPage.vue'),
        meta: { title: 'AI对话' },
      },
      // AI提示词模板
      {
        path: 'ai/prompts',
        name: 'AIPrompts',
        component: () => import('../pages/AIPromptsPage.vue'),
        meta: { title: 'AI助手' },
      },
      // Web IDE
      {
        path: 'webide',
        name: 'WebIDE',
        component: () => import('../pages/webide/WebIDEPage.vue'),
        meta: { title: 'Web IDE' },
      },
      // ===== 企业版: 组织管理 =====
      {
        path: 'organizations',
        name: 'Organizations',
        component: () => import('../pages/OrganizationsPage.vue'),
        meta: { title: '我的组织' },
      },
      {
        path: 'org/:orgId/members',
        name: 'OrganizationMembers',
        component: () => import('../pages/OrganizationMembersPage.vue'),
        meta: { title: '成员管理' },
      },
      {
        path: 'org/:orgId/roles',
        name: 'OrganizationRoles',
        component: () => import('../pages/OrganizationRolesPage.vue'),
        meta: { title: '角色管理' },
      },
      {
        path: 'org/:orgId/settings',
        name: 'OrganizationSettings',
        component: () => import('../pages/OrganizationSettingsPage.vue'),
        meta: { title: '组织设置' },
      },
      {
        path: 'org/:orgId/activities',
        name: 'OrganizationActivities',
        component: () => import('../pages/OrganizationActivityLogPage.vue'),
        meta: { title: '活动日志' },
      },
      {
        path: 'org/:orgId/knowledge',
        name: 'OrganizationKnowledge',
        component: () => import('../pages/OrganizationKnowledgePage.vue'),
        meta: { title: '组织知识库' },
      },
    ],
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// 路由守卫
router.beforeEach((to, from, next) => {
  // 测试环境：跳过认证检查
  // 检查URL查询参数或window全局标志
  const hasTestFlag = typeof window !== 'undefined' && window.__E2E_TEST_MODE__;
  const hasQueryParam = to.query && to.query.e2e === 'true';
  const isTestEnv = hasTestFlag || hasQueryParam;

  console.log('[Router] beforeEach:', {
    to: to.path,
    from: from.path,
    hasTestFlag,
    hasQueryParam,
    isTestEnv,
    requiresAuth: to.meta.requiresAuth
  });

  if (isTestEnv) {
    console.log('[Router] ✓ E2E测试环境，跳过认证检查');
    next();
    return;
  }

  const store = useAppStore();

  if (to.meta.requiresAuth && !store.isAuthenticated) {
    console.log('[Router] ⚠️  需要认证但未登录，重定向到 /login');
    next('/login');
  } else if (to.path === '/login' && store.isAuthenticated) {
    console.log('[Router] 已登录，重定向到首页');
    next('/');
  } else {
    console.log('[Router] ✓ 放行');
    next();
  }
});

// ===== Resource Hints 优化 =====
// 设置常用资源提示（DNS预解析、预连接等）
setupCommonHints();

// 路由导航后预加载下一个可能访问的资源
router.afterEach((to) => {
  // 根据当前路由预加载相关资源
  const routeResourceMap = {
    '/': {
      nextPages: ['/projects', '/knowledge/list', '/ai/chat'],
    },
    '/projects': {
      nextPages: ['/projects/new', '/projects/market'],
    },
    '/knowledge/list': {
      nextPages: ['/knowledge/graph'],
    },
    '/ai/chat': {
      nextPages: ['/ai/prompts'],
    },
  };

  // 预加载项目详情页资源
  if (to.path.startsWith('/projects/') && to.path !== '/projects') {
    preloadRouteResources(to.path, {
      // 项目详情页需要的资源
      scripts: [],
      styles: [],
      nextPages: ['/projects'], // 可能返回项目列表
    });
  }

  // 预加载配置的下一个页面
  const config = routeResourceMap[to.path];
  if (config?.nextPages) {
    config.nextPages.forEach(page => {
      preloadRouteResources(page, {
        nextPages: [page],
      });
    });
  }

  console.log('[Router] Resource hints applied for:', to.path);
});

export default router;
