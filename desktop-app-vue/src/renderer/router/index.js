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
