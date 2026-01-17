import { createRouter, createWebHashHistory } from "vue-router";
import { useAppStore } from "../stores/app";
import {
  setupCommonHints,
  preloadRouteResources,
} from "../utils/resource-hints";
import {
  lazyRoute,
  createRouteGroup,
  progressiveLoader,
} from "../utils/code-splitting";

// ===== 优化的路由组件加载器 =====
// 使用webpack magic comments进行代码分割命名

// 核心页面组（高优先级）
const corePages = createRouteGroup("core", {
  login: () =>
    import(/* webpackChunkName: "core-login" */ "../pages/LoginPage.vue"),
  mainLayout: () =>
    import(
      /* webpackChunkName: "core-layout" */ "../components/MainLayout.vue"
    ),
  projects: () =>
    import(
      /* webpackChunkName: "core-projects" */ "../pages/projects/ProjectsPage.vue"
    ),
});

// 项目相关页面组（高优先级）
const projectPages = createRouteGroup("project", {
  detail: () =>
    import(
      /* webpackChunkName: "project-detail" */ "../pages/projects/ProjectDetailPage.vue"
    ),
  new: () =>
    import(
      /* webpackChunkName: "project-new" */ "../pages/projects/NewProjectPage.vue"
    ),
  market: () =>
    import(
      /* webpackChunkName: "project-market" */ "../pages/projects/MarketPage.vue"
    ),
  management: () =>
    import(
      /* webpackChunkName: "project-management" */ "../pages/projects/ProjectManagementPage.vue"
    ),
  collaboration: () =>
    import(
      /* webpackChunkName: "project-collab" */ "../pages/projects/CollaborationPage.vue"
    ),
  archived: () =>
    import(
      /* webpackChunkName: "project-archived" */ "../pages/projects/ArchivedPage.vue"
    ),
  categories: () =>
    import(
      /* webpackChunkName: "project-categories" */ "../pages/projects/CategoryManagePage.vue"
    ),
  share: () =>
    import(
      /* webpackChunkName: "project-share" */ "../pages/ShareProjectView.vue"
    ),
  workspace: () =>
    import(
      /* webpackChunkName: "project-workspace" */ "../components/workspace/WorkspaceManager.vue"
    ),
});

// 知识库页面组（中优先级）
const knowledgePages = createRouteGroup("knowledge", {
  detail: () =>
    import(
      /* webpackChunkName: "knowledge-detail" */ "../pages/KnowledgeDetailPage.vue"
    ),
  list: () =>
    import(
      /* webpackChunkName: "knowledge-list" */ "../pages/KnowledgeListPage.vue"
    ),
  graph: () =>
    import(
      /* webpackChunkName: "knowledge-graph" */ "../pages/KnowledgeGraphPage.vue"
    ),
});

// AI相关页面组（中优先级）
const aiPages = createRouteGroup("ai", {
  chat: () =>
    import(/* webpackChunkName: "ai-chat" */ "../pages/AIChatPage.vue"),
  prompts: () =>
    import(/* webpackChunkName: "ai-prompts" */ "../pages/AIPromptsPage.vue"),
});

// 设置页面组（低优先级）
const settingsPages = createRouteGroup("settings", {
  main: () =>
    import(/* webpackChunkName: "settings-main" */ "../pages/SettingsPage.vue"),
  system: () =>
    import(
      /* webpackChunkName: "settings-system" */ "../pages/settings/SystemSettings.vue"
    ),
  plugins: () =>
    import(
      /* webpackChunkName: "settings-plugins" */ "../pages/settings/PluginManagement.vue"
    ),
  database: () =>
    import(
      /* webpackChunkName: "settings-db" */ "../pages/settings/DatabaseSecurity.vue"
    ),
  skills: () =>
    import(
      /* webpackChunkName: "settings-skills" */ "../pages/SkillManagement.vue"
    ),
  tools: () =>
    import(
      /* webpackChunkName: "settings-tools" */ "../pages/ToolManagement.vue"
    ),
  voice: () =>
    import(
      /* webpackChunkName: "settings-voice" */ "../pages/VoiceInputTestPage.vue"
    ),
});

// 社交功能页面组（低优先级）
const socialPages = createRouteGroup("social", {
  did: () =>
    import(
      /* webpackChunkName: "social-did" */ "../components/DIDManagement.vue"
    ),
  contacts: () =>
    import(
      /* webpackChunkName: "social-contacts" */ "../components/ContactManagement.vue"
    ),
  credentials: () =>
    import(
      /* webpackChunkName: "social-vc" */ "../components/VCManagement.vue"
    ),
  p2pMessaging: () =>
    import(
      /* webpackChunkName: "social-p2p" */ "../components/P2PMessaging.vue"
    ),
  chat: () =>
    import(
      /* webpackChunkName: "social-chat" */ "../components/social/ChatWindow.vue"
    ),
  moments: () =>
    import(
      /* webpackChunkName: "social-moments" */ "../components/social/MomentsTimeline.vue"
    ),
  forums: () =>
    import(
      /* webpackChunkName: "social-forums" */ "../components/social/ForumList.vue"
    ),
  callHistory: () =>
    import(
      /* webpackChunkName: "social-call-history" */ "../pages/CallHistoryPage.vue"
    ),
});

// 其他功能页面（按需加载）
const miscPages = {
  webIDE: lazyRoute(
    () =>
      import(
        /* webpackChunkName: "misc-webide" */ "../pages/webide/WebIDEPage.vue"
      ),
    { chunkName: "webide" },
  ),
  designEditor: lazyRoute(
    () =>
      import(
        /* webpackChunkName: "misc-design" */ "../pages/design/DesignEditorPage.vue"
      ),
    { chunkName: "design" },
  ),
  organizations: lazyRoute(
    () =>
      import(
        /* webpackChunkName: "misc-orgs" */ "../pages/OrganizationsPage.vue"
      ),
    { chunkName: "orgs" },
  ),
};

const routes = [
  {
    path: "/login",
    name: "Login",
    component: corePages.login,
  },
  // 公开分享页面（无需认证）
  {
    path: "/share/project/:token",
    name: "ShareProject",
    component: projectPages.share,
    meta: { requiresAuth: false },
  },
  {
    path: "/",
    name: "Main",
    component: corePages.mainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        name: "Home",
        component: corePages.projects,
      },
      {
        path: "knowledge/:id",
        name: "KnowledgeDetail",
        component: knowledgePages.detail,
      },
      {
        path: "settings",
        name: "Settings",
        component: settingsPages.main,
      },
      {
        path: "settings/system",
        name: "SystemSettings",
        component: settingsPages.system,
        meta: { title: "系统设置" },
      },
      {
        path: "settings/plugins",
        name: "PluginManagement",
        component: settingsPages.plugins,
        meta: { title: "插件管理" },
      },
      {
        path: "settings/database-security",
        name: "DatabaseSecurity",
        component: settingsPages.database,
        meta: { title: "数据库安全" },
      },
      {
        path: "settings/skills",
        name: "SkillManagement",
        component: settingsPages.skills,
        meta: { title: "技能管理" },
      },
      {
        path: "settings/tools",
        name: "ToolManagement",
        component: settingsPages.tools,
        meta: { title: "工具管理" },
      },
      {
        path: "settings/voice-input",
        name: "VoiceInputTest",
        component: settingsPages.voice,
        meta: { title: "语音输入测试" },
      },
      {
        path: "did",
        name: "DIDManagement",
        component: socialPages.did,
      },
      {
        path: "contacts",
        name: "ContactManagement",
        component: socialPages.contacts,
      },
      {
        path: "credentials",
        name: "VCManagement",
        component: socialPages.credentials,
      },
      {
        path: "p2p-messaging",
        name: "P2PMessaging",
        component: socialPages.p2pMessaging,
        meta: { title: "P2P加密消息" },
      },
      {
        path: "offline-queue",
        name: "OfflineQueue",
        component: () => import("../components/OfflineQueueManager.vue"),
        meta: { title: "离线消息队列" },
      },
      {
        path: "chat",
        name: "Chat",
        component: socialPages.chat,
        meta: { title: "聊天" },
      },
      {
        path: "call-history",
        name: "CallHistory",
        component: socialPages.callHistory,
        meta: { title: "通话记录" },
      },
      {
        path: "image-upload",
        name: "ImageUpload",
        component: () => import("../components/ImageUpload.vue"),
        meta: { title: "图片上传" },
      },
      {
        path: "file-import",
        name: "FileImport",
        component: () => import("../components/FileImport.vue"),
        meta: { title: "文件导入" },
      },
      {
        path: "prompt-templates",
        name: "PromptTemplates",
        component: () => import("../components/PromptTemplates.vue"),
        meta: { title: "提示词模板" },
      },
      {
        path: "template-management",
        name: "TemplateManagement",
        component: () =>
          import("../pages/templates/TemplateManagementPage.vue"),
        meta: { title: "项目模板管理" },
      },
      {
        path: "friends",
        name: "Friends",
        component: () => import("../pages/FriendsPage.vue"),
        meta: { title: "好友管理" },
      },
      {
        path: "posts",
        name: "PostFeed",
        component: () => import("../components/PostFeed.vue"),
        meta: { title: "动态" },
      },
      // ===== 交易系统 =====
      // 交易中心统一入口
      {
        path: "trading",
        name: "TradingHub",
        component: () => import("../pages/TradingHub.vue"),
        meta: { title: "交易中心" },
      },
      // 独立快捷入口（保留）
      {
        path: "marketplace",
        name: "Marketplace",
        component: () => import("../components/trade/Marketplace.vue"),
        meta: { title: "交易市场" },
      },
      {
        path: "contracts",
        name: "Contracts",
        component: () => import("../components/trade/ContractList.vue"),
        meta: { title: "智能合约" },
      },
      {
        path: "knowledge-store",
        name: "KnowledgeStore",
        component: () => import("../components/knowledge/ContentStore.vue"),
        meta: { title: "知识付费" },
      },
      {
        path: "my-purchases",
        name: "MyPurchases",
        component: () => import("../components/knowledge/MyPurchases.vue"),
        meta: { title: "我的购买" },
      },
      {
        path: "credit-score",
        name: "CreditScore",
        component: () => import("../components/trade/CreditScore.vue"),
        meta: { title: "信用评分" },
      },
      {
        path: "my-reviews",
        name: "MyReviews",
        component: () => import("../components/trade/MyReviews.vue"),
        meta: { title: "我的评价" },
      },
      // ===== 区块链钱包 =====
      {
        path: "wallet",
        name: "Wallet",
        component: () => import("../pages/Wallet.vue"),
        meta: { title: "钱包管理" },
      },
      {
        path: "bridge",
        name: "Bridge",
        component: () => import("../pages/Bridge.vue"),
        meta: { title: "跨链桥" },
      },
      // 项目管理模块
      {
        path: "projects/categories",
        name: "ProjectCategories",
        component: () => import("../pages/projects/CategoryManagePage.vue"),
        meta: { title: "项目分类" },
      },
      {
        path: "projects/management",
        name: "ProjectManagement",
        component: () => import("../pages/projects/ProjectManagementPage.vue"),
        meta: { title: "项目列表管理" },
      },
      {
        path: "projects/workspace",
        name: "WorkspaceManagement",
        component: projectPages.workspace,
        meta: { title: "工作区管理" },
      },
      {
        path: "projects",
        name: "Projects",
        component: () => import("../pages/projects/ProjectsPage.vue"),
        meta: { title: "我的项目" },
      },
      {
        path: "projects/new",
        name: "NewProject",
        component: () => import("../pages/projects/NewProjectPage.vue"),
        meta: { title: "新建项目" },
      },
      {
        path: "projects/market",
        name: "ProjectMarket",
        component: () => import("../pages/projects/MarketPage.vue"),
        meta: { title: "项目市场" },
      },
      {
        path: "projects/collaboration",
        name: "ProjectCollaboration",
        component: () => import("../pages/projects/CollaborationPage.vue"),
        meta: { title: "协作项目" },
      },
      {
        path: "projects/archived",
        name: "ProjectArchived",
        component: () => import("../pages/projects/ArchivedPage.vue"),
        meta: { title: "已归档项目" },
      },
      {
        path: "projects/:id",
        name: "ProjectDetail",
        component: () => import("../pages/projects/ProjectDetailPage.vue"),
        meta: { title: "项目详情" },
      },
      // 设计工具编辑器
      {
        path: "design/:projectId",
        name: "DesignEditor",
        component: () => import("../pages/design/DesignEditorPage.vue"),
        meta: { title: "设计编辑器" },
      },
      {
        path: "projects/:id/edit",
        name: "ProjectEdit",
        component: () => import("../pages/projects/ProjectDetailPage.vue"),
        meta: { title: "编辑项目" },
      },
      // 知识模块
      {
        path: "knowledge/list",
        name: "KnowledgeList",
        component: () => import("../pages/KnowledgeListPage.vue"),
        meta: { title: "我的知识" },
      },
      {
        path: "knowledge/graph",
        name: "KnowledgeGraph",
        component: () => import("../pages/KnowledgeGraphPage.vue"),
        meta: { title: "知识图谱" },
      },
      // AI对话
      {
        path: "ai/chat",
        name: "AIChat",
        component: () => import("../pages/AIChatPage.vue"),
        meta: { title: "AI对话" },
      },
      // AI提示词模板
      {
        path: "ai/prompts",
        name: "AIPrompts",
        component: () => import("../pages/AIPromptsPage.vue"),
        meta: { title: "AI助手" },
      },
      // Web IDE
      {
        path: "webide",
        name: "WebIDE",
        component: () => import("../pages/webide/WebIDEPage.vue"),
        meta: { title: "Web IDE" },
      },
      // ===== 企业版: 组织管理 =====
      {
        path: "organizations",
        name: "Organizations",
        component: () => import("../pages/OrganizationsPage.vue"),
        meta: { title: "我的组织" },
      },
      {
        path: "org/:orgId/members",
        name: "OrganizationMembers",
        component: () => import("../pages/OrganizationMembersPage.vue"),
        meta: { title: "成员管理" },
      },
      {
        path: "org/:orgId/roles",
        name: "OrganizationRoles",
        component: () => import("../pages/OrganizationRolesPage.vue"),
        meta: { title: "角色管理" },
      },
      {
        path: "org/:orgId/settings",
        name: "OrganizationSettings",
        component: () => import("../pages/OrganizationSettingsPage.vue"),
        meta: { title: "组织设置" },
      },
      {
        path: "org/:orgId/activities",
        name: "OrganizationActivities",
        component: () => import("../pages/OrganizationActivityLogPage.vue"),
        meta: { title: "活动日志" },
      },
      {
        path: "org/:orgId/knowledge",
        name: "OrganizationKnowledge",
        component: () => import("../pages/OrganizationKnowledgePage.vue"),
        meta: { title: "组织知识库" },
      },
      // ===== 内容聚合模块 =====
      {
        path: "rss/feeds",
        name: "RSSFeeds",
        component: () => import("../pages/rss/FeedList.vue"),
        meta: { title: "RSS订阅" },
      },
      {
        path: "rss/article/:feedId",
        name: "RSSArticle",
        component: () => import("../pages/rss/ArticleReader.vue"),
        meta: { title: "文章阅读" },
      },
      {
        path: "email/accounts",
        name: "EmailAccounts",
        component: () => import("../pages/email/AccountManager.vue"),
        meta: { title: "邮件管理" },
      },
      {
        path: "email/compose",
        name: "EmailCompose",
        component: () => import("../pages/email/EmailComposer.vue"),
        meta: { title: "写邮件" },
      },
      {
        path: "email/read/:id",
        name: "EmailRead",
        component: () => import("../pages/email/EmailReader.vue"),
        meta: { title: "阅读邮件" },
      },
      // ===== 插件生态扩展 =====
      {
        path: "plugins/marketplace",
        name: "PluginMarketplace",
        component: () => import("../pages/PluginMarketplace.vue"),
        meta: { title: "插件市场" },
      },
      {
        path: "plugins/publisher",
        name: "PluginPublisher",
        component: () => import("../pages/PluginPublisher.vue"),
        meta: { title: "插件发布" },
      },
      // 插件页面通用路由
      {
        path: "plugin/:pluginId",
        name: "PluginPage",
        component: () => import("../components/plugins/PluginPageWrapper.vue"),
        meta: { title: "插件页面", isPluginPage: true },
        props: (route) => ({
          pluginId: route.params.pluginId,
          pageConfig: route.query,
        }),
      },
      {
        path: "plugin/:pluginId/:pageId",
        name: "PluginSubPage",
        component: () => import("../components/plugins/PluginPageWrapper.vue"),
        meta: { title: "插件页面", isPluginPage: true },
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
        path: "audio/import",
        name: "AudioImport",
        component: () => import("../pages/AudioImportPage.vue"),
        meta: { title: "音频导入" },
      },
      {
        path: "multimedia/demo",
        name: "MultimediaDemo",
        component: () => import("../pages/MultimediaDemo.vue"),
        meta: { title: "多媒体处理" },
      },
      // ===== 系统监控与维护 =====
      {
        path: "database/performance",
        name: "DatabasePerformance",
        component: () => import("../pages/DatabasePerformancePage.vue"),
        meta: { title: "数据库性能监控" },
      },
      {
        path: "llm/performance",
        name: "LLMPerformance",
        component: () => import("../pages/LLMPerformancePage.vue"),
        meta: { title: "LLM 性能仪表板" },
      },
      {
        path: "sessions",
        name: "SessionManager",
        component: () => import("../pages/SessionManagerPage.vue"),
        meta: { title: "会话管理" },
      },
      {
        path: "error/monitor",
        name: "ErrorMonitor",
        component: () => import("../pages/ErrorMonitorPage.vue"),
        meta: { title: "错误监控仪表板" },
      },
      {
        path: "performance/dashboard",
        name: "PerformanceDashboard",
        component: () => import("../components/PerformanceDashboard.vue"),
        meta: { title: "性能监控仪表板" },
      },
      {
        path: "sync/conflicts",
        name: "SyncConflicts",
        component: () => import("../pages/SyncConflictsPage.vue"),
        meta: { title: "同步冲突管理" },
      },
      // ===== 企业版功能 =====
      {
        path: "enterprise/dashboard",
        name: "EnterpriseDashboard",
        component: () => import("../pages/EnterpriseDashboard.vue"),
        meta: { title: "企业仪表板" },
      },
      {
        path: "permissions",
        name: "PermissionManagement",
        component: () => import("../pages/PermissionManagementPage.vue"),
        meta: { title: "权限管理" },
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
  const hasTestFlag = typeof window !== "undefined" && window.__E2E_TEST_MODE__;
  const hasQueryParam = to.query && to.query.e2e === "true";
  const isTestEnv = hasTestFlag || hasQueryParam;

  console.log("[Router] beforeEach:", {
    to: to.path,
    from: from.path,
    hasTestFlag,
    hasQueryParam,
    isTestEnv,
    requiresAuth: to.meta.requiresAuth,
  });

  if (isTestEnv) {
    console.log("[Router] ✓ E2E测试环境，跳过认证检查");
    next();
    return;
  }

  const store = useAppStore();

  if (to.meta.requiresAuth && !store.isAuthenticated) {
    console.log("[Router] ⚠️  需要认证但未登录，重定向到 /login");
    next("/login");
  } else if (to.path === "/login" && store.isAuthenticated) {
    console.log("[Router] 已登录，重定向到首页");
    next("/");
  } else {
    console.log("[Router] ✓ 放行");
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
    "/": {
      nextPages: ["/projects", "/knowledge/list", "/ai/chat"],
    },
    "/projects": {
      nextPages: ["/projects/new", "/projects/market"],
    },
    "/knowledge/list": {
      nextPages: ["/knowledge/graph"],
    },
    "/ai/chat": {
      nextPages: ["/ai/prompts"],
    },
  };

  // 预加载项目详情页资源
  if (to.path.startsWith("/projects/") && to.path !== "/projects") {
    preloadRouteResources(to.path, {
      // 项目详情页需要的资源
      scripts: [],
      styles: [],
      nextPages: ["/projects"], // 可能返回项目列表
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

  console.log("[Router] Resource hints applied for:", to.path);
});

export default router;
