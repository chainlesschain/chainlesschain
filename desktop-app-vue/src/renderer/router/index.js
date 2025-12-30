import { createRouter, createWebHashHistory } from 'vue-router';
import { useAppStore } from '../stores/app';

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
      // Web IDE
      {
        path: 'webide',
        name: 'WebIDE',
        component: () => import('../pages/webide/WebIDEPage.vue'),
        meta: { title: 'Web IDE' },
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
  const store = useAppStore();

  if (to.meta.requiresAuth && !store.isAuthenticated) {
    next('/login');
  } else if (to.path === '/login' && store.isAuthenticated) {
    next('/');
  } else {
    next();
  }
});

export default router;
