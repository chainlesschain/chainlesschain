import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    component: () => import('../components/AppLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard',  name: 'Dashboard',  component: () => import('../views/Dashboard.vue') },
      { path: 'chat',       name: 'Chat',        component: () => import('../views/Chat.vue') },
      { path: 'services',   name: 'Services',    component: () => import('../views/Services.vue') },
      { path: 'logs',       name: 'Logs',        component: () => import('../views/Logs.vue') },
      { path: 'skills',     name: 'Skills',      component: () => import('../views/Skills.vue') },
      { path: 'providers',  name: 'Providers',   component: () => import('../views/Providers.vue') },
      { path: 'mcp',        name: 'McpTools',    component: () => import('../views/McpTools.vue') },
      { path: 'notes',      name: 'Notes',       component: () => import('../views/Notes.vue') },
      { path: 'memory',     name: 'Memory',      component: () => import('../views/Memory.vue') },
      { path: 'cron',       name: 'Cron',        component: () => import('../views/Cron.vue') },
      { path: 'tasks',      name: 'Tasks',       component: () => import('../views/Tasks.vue') },
      { path: 'security',   name: 'Security',    component: () => import('../views/Security.vue') },
      { path: 'p2p',         name: 'P2P',         component: () => import('../views/P2P.vue') },
      { path: 'git',         name: 'Git',         component: () => import('../views/Git.vue') },
      { path: 'projects',    name: 'Projects',    component: () => import('../views/Projects.vue') },
    ]
  }
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
