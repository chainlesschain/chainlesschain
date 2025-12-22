import { createRouter, createWebHashHistory } from 'vue-router';
import { useAppStore } from '../stores/app';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../pages/LoginPage.vue'),
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
        component: () => import('../pages/HomePage.vue'),
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
      // 项目管理模块
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
        path: 'projects/templates',
        name: 'ProjectTemplates',
        component: () => import('../pages/projects/TemplatesPage.vue'),
        meta: { title: '项目模板' },
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
      // AI对话
      {
        path: 'ai/chat',
        name: 'AIChat',
        component: () => import('../pages/AIChatPage.vue'),
        meta: { title: 'AI对话' },
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
