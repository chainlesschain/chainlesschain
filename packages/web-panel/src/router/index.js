import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    component: () => import('../components/AppLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard',  name: 'Dashboard',  component: () => import('../views/Dashboard.vue') },
      { path: 'chat',       name: 'Chat',        component: () => import('../views/Chat.vue') },
      { path: 'cowork',     name: 'Cowork',      component: () => import('../views/Cowork.vue') },
      { path: 'services',   name: 'Services',    component: () => import('../views/Services.vue') },
      { path: 'logs',       name: 'Logs',        component: () => import('../views/Logs.vue') },
      { path: 'skills',     name: 'Skills',      component: () => import('../views/Skills.vue') },
      { path: 'providers',  name: 'Providers',   component: () => import('../views/Providers.vue') },
      { path: 'mcp',        name: 'McpTools',    component: () => import('../views/McpTools.vue') },
      { path: 'project-settings', name: 'ProjectSettings', component: () => import('../views/ProjectSettings.vue') },
      { path: 'notes',      name: 'Notes',       component: () => import('../views/Notes.vue') },
      { path: 'memory',     name: 'Memory',      component: () => import('../views/Memory.vue') },
      { path: 'knowledge',  name: 'Knowledge',   component: () => import('../views/KnowledgeGraph.vue') },
      { path: 'cron',       name: 'Cron',        component: () => import('../views/Cron.vue') },
      { path: 'workflow',   name: 'Workflow',    component: () => import('../views/WorkflowEditor.vue') },
      { path: 'tasks',      name: 'Tasks',       component: () => import('../views/Tasks.vue') },
      { path: 'security',   name: 'Security',    component: () => import('../views/Security.vue') },
      { path: 'did',        name: 'DID',         component: () => import('../views/DID.vue') },
      { path: 'permissions', name: 'Permissions', component: () => import('../views/Permissions.vue') },
      { path: 'p2p',         name: 'P2P',         component: () => import('../views/P2P.vue') },
      { path: 'git',         name: 'Git',         component: () => import('../views/Git.vue') },
      { path: 'projects',    name: 'Projects',    component: () => import('../views/Projects.vue') },
      { path: 'wallet',      name: 'Wallet',      component: () => import('../views/Wallet.vue') },
      { path: 'organization', name: 'Organization', component: () => import('../views/Organization.vue') },
      { path: 'analytics',   name: 'Analytics',   component: () => import('../views/Analytics.vue') },
      { path: 'templates',   name: 'Templates',   component: () => import('../views/Templates.vue') },
      { path: 'backup',      name: 'Backup',      component: () => import('../views/Backup.vue') },
      { path: 'rssfeed',     name: 'RssFeed',     component: () => import('../views/RssFeed.vue') },
      { path: 'webauthn',    name: 'WebAuthn',    component: () => import('../views/WebAuthn.vue') },
      { path: 'community',   name: 'Community',   component: () => import('../views/Community.vue') },
      { path: 'marketplace', name: 'Marketplace', component: () => import('../views/Marketplace.vue') },
      { path: 'crosschain',  name: 'Crosschain',  component: () => import('../views/Crosschain.vue') },
      { path: 'aiops',       name: 'AIOps',       component: () => import('../views/AIOps.vue') },
      { path: 'compliance',  name: 'Compliance',  component: () => import('../views/Compliance.vue') },
      { path: 'privacy',     name: 'Privacy',     component: () => import('../views/Privacy.vue') },
      { path: 'inference',   name: 'Inference',   component: () => import('../views/Inference.vue') },
      { path: 'video',       name: 'VideoEditing', component: () => import('../views/VideoEditing.vue') },
    ]
  }
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
