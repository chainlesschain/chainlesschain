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
        path: 'prompt-templates',
        name: 'PromptTemplates',
        component: () => import('../components/PromptTemplates.vue'),
        meta: { title: '提示词模板' },
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
