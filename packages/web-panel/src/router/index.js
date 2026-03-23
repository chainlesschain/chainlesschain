import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    component: () => import('../components/AppLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue') },
      { path: 'chat', name: 'Chat', component: () => import('../views/Chat.vue') },
      { path: 'skills', name: 'Skills', component: () => import('../views/Skills.vue') },
      { path: 'providers', name: 'Providers', component: () => import('../views/Providers.vue') },
    ]
  }
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
