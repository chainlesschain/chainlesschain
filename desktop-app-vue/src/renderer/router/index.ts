import { logger } from '@/utils/logger';
import { createRouter, createWebHashHistory, type RouteRecordRaw, type RouteLocationNormalized } from 'vue-router';
import { useAppStore } from '../stores/app';
import { setupCommonHints, preloadRouteResources } from '../utils/resource-hints';
import { lazyRoute, createRouteGroup, progressiveLoader } from '../utils/code-splitting';

// 扩展路由元信息类型
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    title?: string;
    isPluginPage?: boolean;
  }
}

// 扩展 Window 类型
declare global {
  interface Window {
    __E2E_TEST_MODE__?: boolean;
  }
}

// ===== 优化的路由组件加载器 =====
// 使用webpack magic comments进行代码分割命名

// 核心页面组（高优先级）
const corePages = createRouteGroup('core', {
  login: () => import(/* webpackChunkName: "core-login" */ '../pages/LoginPage.vue'),
  mainLayout: () => import(/* webpackChunkName: "core-layout" */ '../components/MainLayout.vue'),
  projects: () => import(/* webpackChunkName: "core-projects" */ '../pages/projects/ProjectsPage.vue'),
});

// 项目相关页面组（高优先级）
const projectPages = createRouteGroup('project', {
  detail: () => import(/* webpackChunkName: "project-detail" */ '../pages/projects/ProjectDetailPage.vue'),
  new: () => import(/* webpackChunkName: "project-new" */ '../pages/projects/NewProjectPage.vue'),
  market: () => import(/* webpackChunkName: "project-market" */ '../pages/projects/MarketPage.vue'),
  management: () => import(/* webpackChunkName: "project-management" */ '../pages/projects/ProjectManagementPage.vue'),
  collaboration: () => import(/* webpackChunkName: "project-collab" */ '../pages/projects/CollaborationPage.vue'),
  archived: () => import(/* webpackChunkName: "project-archived" */ '../pages/projects/ArchivedPage.vue'),
  categories: () => import(/* webpackChunkName: "project-categories" */ '../pages/projects/CategoryManagePage.vue'),
  share: () => import(/* webpackChunkName: "project-share" */ '../pages/ShareProjectView.vue'),
  workspace: () => import(/* webpackChunkName: "project-workspace" */ '../components/workspace/WorkspaceManager.vue'),
});

// 知识库页面组（中优先级）
const knowledgePages = createRouteGroup('knowledge', {
  detail: () => import(/* webpackChunkName: "knowledge-detail" */ '../pages/KnowledgeDetailPage.vue'),
  list: () => import(/* webpackChunkName: "knowledge-list" */ '../pages/KnowledgeListPage.vue'),
  graph: () => import(/* webpackChunkName: "knowledge-graph" */ '../pages/KnowledgeGraphPage.vue'),
});

// AI相关页面组（中优先级）
const aiPages = createRouteGroup('ai', {
  chat: () => import(/* webpackChunkName: "ai-chat" */ '../pages/AIChatPage.vue'),
  prompts: () => import(/* webpackChunkName: "ai-prompts" */ '../pages/AIPromptsPage.vue'),
  browserControl: () => import(/* webpackChunkName: "ai-browser" */ '../pages/BrowserControl.vue'),
});

// 设置页面组（低优先级）
const settingsPages = createRouteGroup('settings', {
  main: () => import(/* webpackChunkName: "settings-main" */ '../pages/SettingsPage.vue'),
  system: () => import(/* webpackChunkName: "settings-system" */ '../pages/settings/SystemSettings.vue'),
  plugins: () => import(/* webpackChunkName: "settings-plugins" */ '../pages/settings/PluginManagement.vue'),
  database: () => import(/* webpackChunkName: "settings-db" */ '../pages/settings/DatabaseSecurity.vue'),
  skills: () => import(/* webpackChunkName: "settings-skills" */ '../pages/SkillManagement.vue'),
  tools: () => import(/* webpackChunkName: "settings-tools" */ '../pages/ToolManagement.vue'),
  voice: () => import(/* webpackChunkName: "settings-voice" */ '../pages/VoiceInputTestPage.vue'),
});

// 社交功能页面组（低优先级）
const socialPages = createRouteGroup('social', {
  did: () => import(/* webpackChunkName: "social-did" */ '../components/DIDManagement.vue'),
  contacts: () => import(/* webpackChunkName: "social-contacts" */ '../components/ContactManagement.vue'),
  credentials: () => import(/* webpackChunkName: "social-vc" */ '../components/VCManagement.vue'),
  p2pMessaging: () => import(/* webpackChunkName: "social-p2p" */ '../components/P2PMessaging.vue'),
  chat: () => import(/* webpackChunkName: "social-chat" */ '../components/social/ChatWindow.vue'),
  moments: () => import(/* webpackChunkName: "social-moments" */ '../components/social/MomentsTimeline.vue'),
  forums: () => import(/* webpackChunkName: "social-forums" */ '../components/social/ForumList.vue'),
  callHistory: () => import(/* webpackChunkName: "social-call-history" */ '../pages/CallHistoryPage.vue'),
});

// 监控与诊断页面组（中优先级）
const monitoringPages = createRouteGroup('monitoring', {
  sessionManager: () => import(/* webpackChunkName: "monitoring-sessions" */ '../pages/SessionManagerPage.vue'),
  errorMonitor: () => import(/* webpackChunkName: "monitoring-errors" */ '../pages/ErrorMonitorPage.vue'),
  memoryDashboard: () => import(/* webpackChunkName: "monitoring-memory" */ '../pages/MemoryDashboardPage.vue'),
  tagManager: () => import(/* webpackChunkName: "monitoring-tags" */ '../pages/TagManagerPage.vue'),
  llmPerformance: () => import(/* webpackChunkName: "monitoring-llm" */ '../pages/LLMPerformancePage.vue'),
  databasePerformance: () => import(/* webpackChunkName: "monitoring-database" */ '../pages/DatabasePerformancePage.vue'),
});

// Cowork 多代理协作页面组（中优先级）
const coworkPages = createRouteGroup('cowork', {
  dashboard: () => import(/* webpackChunkName: "cowork-dashboard" */ '../pages/CoworkDashboard.vue'),
  tasks: () => import(/* webpackChunkName: "cowork-tasks" */ '../pages/TaskMonitor.vue'),
  skills: () => import(/* webpackChunkName: "cowork-skills" */ '../pages/SkillManager.vue'),
  analytics: () => import(/* webpackChunkName: "cowork-analytics" */ '../pages/CoworkAnalytics.vue'),
});

// 企业版协作页面组（中优先级）
const enterpriseCollabPages = createRouteGroup('enterprise-collab', {
  collabEditor: () => import(/* webpackChunkName: "collab-editor" */ '../pages/collaboration/CollabEditorPage.vue'),
  taskDashboard: () => import(/* webpackChunkName: "task-dashboard" */ '../pages/tasks/TaskDashboardPage.vue'),
  taskBoard: () => import(/* webpackChunkName: "task-board" */ '../pages/tasks/TaskBoardPage.vue'),
  taskReports: () => import(/* webpackChunkName: "task-reports" */ '../pages/tasks/TaskReportsPage.vue'),
  permissionSettings: () =>
    import(/* webpackChunkName: "perm-settings" */ '../pages/permissions/PermissionSettingsPage.vue'),
  approvalCenter: () =>
    import(/* webpackChunkName: "approval-center" */ '../pages/permissions/ApprovalCenterPage.vue'),
  teamSettings: () => import(/* webpackChunkName: "team-settings" */ '../pages/permissions/TeamSettingsPage.vue'),
  partnerCenter: () => import(/* webpackChunkName: "partner-center" */ '../pages/crossorg/PartnerCenterPage.vue'),
  sharedWorkspaces: () =>
    import(/* webpackChunkName: "shared-workspaces" */ '../pages/crossorg/SharedWorkspacesPage.vue'),
});

// P2P高级功能页面组（低优先级）
const p2pAdvancedPages = createRouteGroup('p2p-advanced', {
  devicePairing: () => import(/* webpackChunkName: "p2p-device-pairing" */ '../pages/p2p/DevicePairingPage.vue'),
  deviceManagement: () => import(/* webpackChunkName: "p2p-device-mgmt" */ '../pages/p2p/DeviceManagementPage.vue'),
  fileTransfer: () => import(/* webpackChunkName: "p2p-file-transfer" */ '../pages/p2p/FileTransferPage.vue'),
  safetyNumbers: () => import(/* webpackChunkName: "p2p-safety-numbers" */ '../pages/p2p/SafetyNumbersPage.vue'),
  sessionFingerprint: () =>
    import(/* webpackChunkName: "p2p-session-fp" */ '../pages/p2p/SessionFingerprintPage.vue'),
  messageQueue: () => import(/* webpackChunkName: "p2p-msg-queue" */ '../pages/p2p/MessageQueuePage.vue'),
});

// 其他功能页面（按需加载）
const miscPages = {
  webIDE: lazyRoute(() => import(/* webpackChunkName: "misc-webide" */ '../pages/webide/WebIDEPage.vue'), {
    chunkName: 'webide',
  }),
  designEditor: lazyRoute(() => import(/* webpackChunkName: "misc-design" */ '../pages/design/DesignEditorPage.vue'), {
    chunkName: 'design',
  }),
  organizations: lazyRoute(() => import(/* webpackChunkName: "misc-orgs" */ '../pages/OrganizationsPage.vue'), {
    chunkName: 'orgs',
  }),
};

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: corePages.login,
  },
  // E2E测试路由（顶级路由，无需认证）
  {
    path: '/test/android-features-standalone',
    name: 'AndroidFeaturesTestStandalone',
    component: () => import('../pages/AndroidFeaturesTestPage.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/test/simple',
    name: 'SimpleTest',
    component: () => import('../pages/SimpleTestPage.vue'),
    meta: { requiresAuth: false },
  },
  // 公开分享页面（无需认证）
  {
    path: '/share/project/:token',
    name: 'ShareProject',
    component: projectPages.share,
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    name: 'Main',
    component: corePages.mainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Home',
        component: corePages.projects,
      },
      {
        path: 'knowledge/:id',
        name: 'KnowledgeDetail',
        component: knowledgePages.detail,
      },
      {
        path: 'settings',
        name: 'Settings',
        component: settingsPages.main,
      },
      {
        path: 'settings/system',
        name: 'SystemSettings',
        component: settingsPages.system,
        meta: { title: '系统设置' },
      },
      {
        path: 'settings/plugins',
        name: 'PluginManagement',
        component: settingsPages.plugins,
        meta: { title: '插件管理' },
      },
      {
        path: 'settings/database-security',
        name: 'DatabaseSecurity',
        component: settingsPages.database,
        meta: { title: '数据库安全' },
      },
      {
        path: 'settings/skills',
        name: 'SkillManagement',
        component: settingsPages.skills,
        meta: { title: '技能管理' },
      },
      {
        path: 'settings/tools',
        name: 'ToolManagement',
        component: settingsPages.tools,
        meta: { title: '工具管理' },
      },
      {
        path: 'settings/voice-input',
        name: 'VoiceInputTest',
        component: settingsPages.voice,
        meta: { title: '语音输入测试' },
      },
      {
        path: 'did',
        name: 'DIDManagement',
        component: socialPages.did,
      },
      {
        path: 'contacts',
        name: 'ContactManagement',
        component: socialPages.contacts,
      },
      {
        path: 'credentials',
        name: 'VCManagement',
        component: socialPages.credentials,
      },
      {
        path: 'p2p-messaging',
        name: 'P2PMessaging',
        component: socialPages.p2pMessaging,
        meta: { title: 'P2P加密消息' },
      },
      {
        path: 'external-devices',
        name: 'ExternalDevices',
        component: () => import(/* webpackChunkName: "external-devices" */ '../pages/ExternalDeviceBrowser.vue'),
        meta: { title: '设备文件浏览器' },
      },
      {
        path: 'offline-queue',
        name: 'OfflineQueue',
        component: () => import('../components/OfflineQueueManager.vue'),
        meta: { title: '离线消息队列' },
      },
      {
        path: 'chat',
        name: 'Chat',
        component: socialPages.chat,
        meta: { title: '聊天' },
      },
      {
        path: 'call-history',
        name: 'CallHistory',
        component: socialPages.callHistory,
        meta: { title: '通话记录' },
      },
      // ===== LLM 测试 =====
      {
        path: 'llm/test-chat',
        name: 'LLMTestChat',
        component: () => import('../pages/LLMTestChatPage.vue'),
        meta: { title: 'LLM 测试聊天', requiresAuth: false },
      },
      // ===== P2P 高级功能 =====
      {
        path: 'p2p/device-pairing',
        name: 'DevicePairing',
        component: () => import('../pages/p2p/DevicePairingPage.vue'),
        meta: { title: '设备配对', requiresAuth: false },
      },
      {
        path: 'p2p/safety-numbers',
        name: 'SafetyNumbers',
        component: () => import('../pages/p2p/SafetyNumbersPage.vue'),
        meta: { title: '安全号码验证', requiresAuth: false },
      },
      {
        path: 'p2p/session-fingerprint',
        name: 'SessionFingerprint',
        component: () => import('../pages/p2p/SessionFingerprintPage.vue'),
        meta: { title: '会话指纹验证', requiresAuth: false },
      },
      {
        path: 'p2p/device-management',
        name: 'DeviceManagement',
        component: () => import('../pages/p2p/DeviceManagementPage.vue'),
        meta: { title: '设备管理', requiresAuth: false },
      },
      {
        path: 'p2p/file-transfer',
        name: 'FileTransfer',
        component: () => import('../pages/p2p/FileTransferPage.vue'),
        meta: { title: '文件传输', requiresAuth: false },
      },
      {
        path: 'p2p/message-queue',
        name: 'MessageQueue',
        component: () => import('../pages/p2p/MessageQueuePage.vue'),
        meta: { title: '消息队列', requiresAuth: false },
      },
      // ===== 远程控制 =====
      {
        path: 'remote/control',
        name: 'RemoteControl',
        component: () => import(/* webpackChunkName: "remote-control" */ '../pages/RemoteControl.vue'),
        meta: { title: '远程控制', requiresAuth: false },
      },
      {
        path: 'remote/logs',
        name: 'CommandLogs',
        component: () => import(/* webpackChunkName: "command-logs" */ '../pages/CommandLogsPage.vue'),
        meta: { title: '命令日志', requiresAuth: false },
      },
      // ===== 测试页面 =====
      {
        path: 'test/android-features',
        name: 'AndroidFeaturesTest',
        component: () => import('../pages/AndroidFeaturesTestPage.vue'),
        meta: { title: '安卓端功能测试', requiresAuth: false },
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
        component: () => import('../pages/FriendsPage.vue'),
        meta: { title: '好友管理' },
      },
      {
        path: 'posts',
        name: 'PostFeed',
        component: () => import('../components/PostFeed.vue'),
        meta: { title: '动态' },
      },
      // ===== 交易系统 =====
      {
        path: 'trading',
        name: 'TradingHub',
        component: () => import('../pages/TradingHub.vue'),
        meta: { title: '交易中心' },
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
        path: 'projects/workspace',
        name: 'WorkspaceManagement',
        component: projectPages.workspace,
        meta: { title: '工作区管理' },
      },
      {
        path: 'projects',
        name: 'Projects',
        component: corePages.projects,
        meta: { title: '我的项目' },
      },
      {
        path: 'projects/new',
        name: 'NewProject',
        component: projectPages.new,
        meta: { title: '新建项目' },
      },
      {
        path: 'projects/market',
        name: 'ProjectMarket',
        component: projectPages.market,
        meta: { title: '项目市场' },
      },
      {
        path: 'projects/collaboration',
        name: 'ProjectCollaboration',
        component: projectPages.collaboration,
        meta: { title: '协作项目' },
      },
      {
        path: 'projects/archived',
        name: 'ProjectArchived',
        component: projectPages.archived,
        meta: { title: '已归档项目' },
      },
      {
        path: 'projects/:id',
        name: 'ProjectDetail',
        component: projectPages.detail,
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
        component: projectPages.detail,
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
      // 浏览器自动化控制
      {
        path: 'ai/browser',
        name: 'BrowserControl',
        component: () => import('../pages/BrowserControl.vue'),
        meta: { title: '浏览器控制' },
      },
      // ===== 工作流监控 =====
      {
        path: 'workflow',
        name: 'WorkflowMonitor',
        component: () => import('../pages/WorkflowMonitorPage.vue'),
        meta: { title: '工作流监控' },
      },
      {
        path: 'workflow/:id',
        name: 'WorkflowDetail',
        component: () => import('../pages/WorkflowMonitorPage.vue'),
        meta: { title: '工作流详情' },
      },
      // ===== 工作流优化 =====
      {
        path: 'workflow/optimizations',
        name: 'WorkflowOptimizations',
        component: () => import('../components/WorkflowOptimizationsDashboard.vue'),
        meta: { title: '工作流优化' },
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
      // ===== 内容聚合模块 =====
      {
        path: 'rss/feeds',
        name: 'RSSFeeds',
        component: () => import('../pages/rss/FeedList.vue'),
        meta: { title: 'RSS订阅' },
      },
      {
        path: 'rss/article/:feedId',
        name: 'RSSArticle',
        component: () => import('../pages/rss/ArticleReader.vue'),
        meta: { title: '文章阅读' },
      },
      {
        path: 'email/accounts',
        name: 'EmailAccounts',
        component: () => import('../pages/email/AccountManager.vue'),
        meta: { title: '邮件管理' },
      },
      {
        path: 'email/compose',
        name: 'EmailCompose',
        component: () => import('../pages/email/EmailComposer.vue'),
        meta: { title: '写邮件' },
      },
      {
        path: 'email/read/:id',
        name: 'EmailRead',
        component: () => import('../pages/email/EmailReader.vue'),
        meta: { title: '阅读邮件' },
      },
      // ===== 插件生态扩展 =====
      {
        path: 'plugins/marketplace',
        name: 'PluginMarketplace',
        component: () => import('../pages/PluginMarketplace.vue'),
        meta: { title: '插件市场' },
      },
      {
        path: 'plugins/publisher',
        name: 'PluginPublisher',
        component: () => import('../pages/PluginPublisher.vue'),
        meta: { title: '插件发布' },
      },
      // 插件页面通用路由
      {
        path: 'plugin/:pluginId',
        name: 'PluginPage',
        component: () => import('../components/plugins/PluginPageWrapper.vue'),
        meta: { title: '插件页面', isPluginPage: true },
        props: (route) => ({
          pluginId: route.params.pluginId,
          pageConfig: route.query,
        }),
      },
      {
        path: 'plugin/:pluginId/:pageId',
        name: 'PluginSubPage',
        component: () => import('../components/plugins/PluginPageWrapper.vue'),
        meta: { title: '插件页面', isPluginPage: true },
        props: (route) => ({
          pluginId: route.params.pluginId,
          pageConfig: {
            id: route.params.pageId,
            ...route.query,
          },
        }),
      },
      // ===== 多媒体处理 =====
      {
        path: 'audio/import',
        name: 'AudioImport',
        component: () => import('../pages/AudioImportPage.vue'),
        meta: { title: '音频导入' },
      },
      {
        path: 'multimedia/demo',
        name: 'MultimediaDemo',
        component: () => import('../pages/MultimediaDemo.vue'),
        meta: { title: '多媒体处理' },
      },
      // ===== 系统监控与维护 =====
      {
        path: 'database/performance',
        name: 'DatabasePerformance',
        component: () => import('../pages/DatabasePerformancePage.vue'),
        meta: { title: '数据库性能监控' },
      },
      {
        path: 'llm/performance',
        name: 'LLMPerformance',
        component: () => import('../pages/LLMPerformancePage.vue'),
        meta: { title: 'LLM 性能仪表板' },
      },
      {
        path: 'sessions',
        name: 'SessionManager',
        component: () => import('../pages/SessionManagerPage.vue'),
        meta: { title: '会话管理' },
      },
      {
        path: 'tags',
        name: 'TagManager',
        component: () => import('../pages/TagManagerPage.vue'),
        meta: { title: '标签管理' },
      },
      {
        path: 'memory',
        name: 'MemoryDashboard',
        component: () => import('../pages/MemoryDashboardPage.vue'),
        meta: { title: 'Memory Bank 仪表板' },
      },
      {
        path: 'memory/permanent',
        name: 'PermanentMemory',
        component: () => import('../pages/PermanentMemoryPage.vue'),
        meta: { title: '永久记忆' },
      },
      // ===== Cowork 多代理协作路由 =====
      {
        path: 'cowork',
        name: 'CoworkDashboard',
        component: coworkPages.dashboard,
        meta: { title: 'Cowork 多代理协作' },
      },
      {
        path: 'cowork/tasks',
        name: 'CoworkTasks',
        component: coworkPages.tasks,
        meta: { title: '任务监控' },
      },
      {
        path: 'cowork/skills',
        name: 'CoworkSkills',
        component: coworkPages.skills,
        meta: { title: '技能管理' },
      },
      {
        path: 'cowork/analytics',
        name: 'CoworkAnalytics',
        component: coworkPages.analytics,
        meta: { title: '数据分析' },
      },
      {
        path: 'error/monitor',
        name: 'ErrorMonitor',
        component: () => import('../pages/ErrorMonitorPage.vue'),
        meta: { title: '错误监控仪表板' },
      },
      {
        path: 'performance/dashboard',
        name: 'PerformanceDashboard',
        component: () => import('../components/PerformanceDashboard.vue'),
        meta: { title: '性能监控仪表板' },
      },
      {
        path: 'sync/conflicts',
        name: 'SyncConflicts',
        component: () => import('../pages/SyncConflictsPage.vue'),
        meta: { title: '同步冲突管理' },
      },
      // ===== 企业版功能 =====
      {
        path: 'enterprise/dashboard',
        name: 'EnterpriseDashboard',
        component: () => import('../pages/EnterpriseDashboard.vue'),
        meta: { title: '企业仪表板' },
      },
      {
        path: 'permissions',
        name: 'PermissionManagement',
        component: () => import('../pages/PermissionManagementPage.vue'),
        meta: { title: '权限管理' },
      },
      // ===== 企业版: 实时协作编辑 =====
      {
        path: 'collab/editor/:id',
        name: 'CollabEditor',
        component: enterpriseCollabPages.collabEditor,
        meta: { title: '协作编辑器' },
      },
      // ===== 企业版: 团队任务管理 =====
      {
        path: 'tasks/dashboard',
        name: 'TaskDashboard',
        component: enterpriseCollabPages.taskDashboard,
        meta: { title: '任务仪表板' },
      },
      {
        path: 'tasks/board/:id',
        name: 'TaskBoard',
        component: enterpriseCollabPages.taskBoard,
        meta: { title: '任务看板' },
      },
      {
        path: 'tasks/reports',
        name: 'TaskReports',
        component: enterpriseCollabPages.taskReports,
        meta: { title: '团队报告' },
      },
      // ===== 企业版: 权限和审批 =====
      {
        path: 'org/:orgId/permissions',
        name: 'OrgPermissions',
        component: enterpriseCollabPages.permissionSettings,
        meta: { title: '权限设置' },
      },
      {
        path: 'org/:orgId/approvals',
        name: 'ApprovalCenter',
        component: enterpriseCollabPages.approvalCenter,
        meta: { title: '审批中心' },
      },
      {
        path: 'org/:orgId/teams',
        name: 'TeamSettings',
        component: enterpriseCollabPages.teamSettings,
        meta: { title: '团队设置' },
      },
      // ===== 企业版: 跨组织协作 =====
      {
        path: 'crossorg/partners',
        name: 'PartnerCenter',
        component: enterpriseCollabPages.partnerCenter,
        meta: { title: '合作伙伴中心' },
      },
      {
        path: 'crossorg/workspaces',
        name: 'SharedWorkspaces',
        component: enterpriseCollabPages.sharedWorkspaces,
        meta: { title: '共享工作空间' },
      },
      {
        path: 'crossorg/workspace/:id',
        name: 'SharedWorkspaceDetail',
        component: () => import('../pages/crossorg/SharedWorkspaceDetailPage.vue'),
        meta: { title: '共享工作空间详情' },
      },
      {
        path: 'crossorg/transactions',
        name: 'B2BTransactions',
        component: () => import('../pages/crossorg/B2BTransactionsPage.vue'),
        meta: { title: 'B2B数据交换' },
      },
      {
        path: 'crossorg/audit',
        name: 'CrossOrgAudit',
        component: () => import('../pages/crossorg/CrossOrgAuditPage.vue'),
        meta: { title: '跨组织审计日志' },
      },
      // ===== 企业审计与合规 (v0.34.0) =====
      {
        path: 'enterprise/audit',
        name: 'EnterpriseAudit',
        component: () => import(/* webpackChunkName: "enterprise-audit" */ '../pages/EnterpriseAuditPage.vue'),
        meta: { title: '企业审计日志' },
      },
      {
        path: 'enterprise/compliance',
        name: 'ComplianceDashboard',
        component: () => import(/* webpackChunkName: "compliance-dashboard" */ '../pages/ComplianceDashboard.vue'),
        meta: { title: '合规管理仪表板' },
      },
      // ===== 插件市场 (v0.34.0) =====
      {
        path: 'plugin-marketplace',
        name: 'PluginMarketplaceBrowse',
        component: () => import(/* webpackChunkName: "plugin-marketplace" */ '../pages/PluginMarketplacePage.vue'),
        meta: { title: '插件市场' },
      },
      {
        path: 'plugin-marketplace/:pluginId/detail',
        name: 'PluginDetail',
        component: () => import(/* webpackChunkName: "plugin-detail" */ '../pages/PluginDetailPage.vue'),
        meta: { title: '插件详情' },
      },
      {
        path: 'plugin-marketplace/installed',
        name: 'InstalledPlugins',
        component: () => import(/* webpackChunkName: "installed-plugins" */ '../pages/InstalledPluginsPage.vue'),
        meta: { title: '已安装插件' },
      },
      // ===== 智能代理系统 (v0.34.0) =====
      {
        path: 'agents',
        name: 'AgentDashboard',
        component: () => import(/* webpackChunkName: "agent-dashboard" */ '../pages/AgentDashboardPage.vue'),
        meta: { title: '智能代理中心' },
      },
      {
        path: 'agents/templates/edit/:id?',
        name: 'AgentTemplateEditor',
        component: () => import(/* webpackChunkName: "agent-template-editor" */ '../pages/AgentTemplateEditorPage.vue'),
        meta: { title: '代理模板编辑' },
      },
      // ===== SSO 企业认证 (v0.34.0) =====
      {
        path: 'sso/config',
        name: 'SSOConfiguration',
        component: () => import(/* webpackChunkName: "sso-config" */ '../pages/SSOConfigurationPage.vue'),
        meta: { title: 'SSO 身份认证配置' },
      },
      {
        path: 'sso/login',
        name: 'SSOLogin',
        component: () => import(/* webpackChunkName: "sso-login" */ '../pages/SSOLoginPage.vue'),
        meta: { title: '企业单点登录' },
      },
      {
        path: 'sso/identities',
        name: 'IdentityLinking',
        component: () => import(/* webpackChunkName: "identity-linking" */ '../pages/IdentityLinkingPage.vue'),
        meta: { title: '身份关联管理' },
      },
      // ===== MCP 社区 (v0.34.0) =====
      {
        path: 'mcp/marketplace',
        name: 'MCPServerMarketplace',
        component: () => import(/* webpackChunkName: "mcp-marketplace" */ '../pages/MCPServerMarketplace.vue'),
        meta: { title: 'MCP 服务器市场' },
      },
    ],
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'ChunkLoadError',
];
const MAX_DYNAMIC_IMPORT_RETRIES = 2;
const dynamicImportRetryCount = new Map<string, number>();

function isDynamicImportLoadError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '');
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

router.onError((error, to) => {
  if (!isDynamicImportLoadError(error) || !to?.fullPath) {
    return;
  }

  const key = to.fullPath;
  const currentRetry = dynamicImportRetryCount.get(key) || 0;
  if (currentRetry >= MAX_DYNAMIC_IMPORT_RETRIES) {
    logger.error('[Router] Dynamic import failed after retries', { path: key, error });
    return;
  }

  const nextRetry = currentRetry + 1;
  const delay = 400 * nextRetry;
  dynamicImportRetryCount.set(key, nextRetry);

  logger.warn('[Router] Dynamic import failed, retrying navigation', {
    path: key,
    retry: nextRetry,
    delay,
  });

  setTimeout(() => {
    router.replace(key).catch((retryError: unknown) => {
      logger.warn('[Router] Retry navigation failed', {
        path: key,
        retry: nextRetry,
        error: retryError,
      });
    });
  }, delay);
});

// 路由守卫
router.beforeEach((to: RouteLocationNormalized, from: RouteLocationNormalized, next) => {
  // 测试环境：跳过认证检查
  // 检查URL查询参数或window全局标志
  const hasTestFlag = typeof window !== 'undefined' && window.__E2E_TEST_MODE__;
  const hasQueryParam = to.query && to.query.e2e === 'true';
  const isTestEnv = hasTestFlag || hasQueryParam;

  logger.info('[Router] beforeEach:', {
    to: to.path,
    from: from.path,
    hasTestFlag,
    hasQueryParam,
    isTestEnv,
    requiresAuth: to.meta.requiresAuth,
  });

  if (isTestEnv) {
    logger.info('[Router] E2E测试环境，跳过认证检查');
    next();
    return;
  }

  const store = useAppStore();

  if (to.meta.requiresAuth && !store.isAuthenticated) {
    logger.info('[Router] 需要认证但未登录，重定向到 /login');
    next('/login');
  } else if (to.path === '/login' && store.isAuthenticated) {
    logger.info('[Router] 已登录，重定向到首页');
    next('/');
  } else {
    logger.info('[Router] 放行');
    next();
  }
});

// ===== Resource Hints 优化 =====
// 设置常用资源提示（DNS预解析、预连接等）
setupCommonHints();

interface RouteResourceConfig {
  scripts?: string[];
  styles?: string[];
  nextPages?: string[];
}

// 路由导航后预加载下一个可能访问的资源
router.afterEach((to: RouteLocationNormalized) => {
  dynamicImportRetryCount.delete(to.fullPath);
  // 根据当前路由预加载相关资源
  const routeResourceMap: Record<string, RouteResourceConfig> = {
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
    config.nextPages.forEach((page) => {
      preloadRouteResources(page, {
        nextPages: [page],
      });
    });
  }

  logger.info('[Router] Resource hints applied for:', to.path);
});

export default router;
