/**
 * 核心模块初始化器
 * 负责数据库、LLM、RAG等核心模块的初始化
 *
 * @module bootstrap/core-initializer
 */

const path = require("path");
const { app } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * 注册核心模块初始化器
 * @param {import('./initializer-factory').InitializerFactory} factory - 初始化器工厂
 */
function registerCoreInitializers(factory) {
  // ========================================
  // 数据库初始化
  // ========================================
  factory.register({
    name: "database",
    required: false, // 数据库失败也继续启动，使用降级模式
    async init(context) {
      const DatabaseManager = require("../database");
      const EncryptionConfigManager = require("../database/config-manager");

      // 检查加密配置
      const encryptionConfig = new EncryptionConfigManager(app);
      const encryptionEnabled = encryptionConfig.isEncryptionEnabled();
      logger.info(`数据库加密状态: ${encryptionEnabled ? "已启用" : "未启用"}`);

      const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || "123456";
      const database = new DatabaseManager(null, {
        password: DEFAULT_PASSWORD,
        encryptionEnabled,
      });

      await database.initialize();

      // 设置数据库单例
      const { setDatabase } = require("../database");
      setDatabase(database);

      return database;
    },
  });

  // ========================================
  // 知识图谱提取器
  // ========================================
  factory.register({
    name: "graphExtractor",
    dependsOn: ["database"],
    async init(context) {
      const GraphExtractor = require("../knowledge-graph/graph-extractor");
      return new GraphExtractor(context.database);
    },
  });

  // ========================================
  // 版本管理器
  // ========================================
  factory.register({
    name: "versionManager",
    dependsOn: ["database"],
    async init(context) {
      const {
        KnowledgeVersionManager,
      } = require("../knowledge/version-manager");
      return new KnowledgeVersionManager(context.database.db);
    },
  });

  // ========================================
  // 性能监控器
  // ========================================
  factory.register({
    name: "performanceMonitor",
    async init() {
      const {
        getPerformanceMonitor,
      } = require("../../utils/performance-monitor");
      const monitor = getPerformanceMonitor();
      monitor.start();
      return monitor;
    },
  });

  // ========================================
  // 文件导入器
  // ========================================
  factory.register({
    name: "fileImporter",
    dependsOn: ["database"],
    async init(context) {
      const FileImporter = require("../import/file-importer");
      return new FileImporter(context.database);
    },
  });

  // ========================================
  // 项目模板管理器
  // ========================================
  factory.register({
    name: "templateManager",
    required: false,  // Non-critical, app can run without templates
    async init(context) {
      try {
        if (!context.database || !context.database.db) {
          throw new Error("Database not initialized or missing db instance");
        }

        const ProjectTemplateManager = require("../template/template-manager");
        // BUGFIX: Pass DatabaseManager instance (needs both db and saveToFile())
        const manager = new ProjectTemplateManager(context.database);
        await manager.initialize();
        logger.info('[Bootstrap] ✓ TemplateManager initialized successfully');
        return manager;
      } catch (error) {
        logger.error('[Bootstrap] TemplateManager initialization failed:', error);
        // Return a mock manager to prevent IPC errors
        return {
          isMock: true,
          getAllTemplates: async () => [],
          getTemplateById: async () => null,
          searchTemplates: async () => [],
          getTemplateStats: async () => ({ total: 0, categories: {} }),
          getRecentTemplates: async () => [],
          getPopularTemplates: async () => [],
          recommendTemplates: async () => [],
          createTemplate: async (templateData = {}) => ({
            ...templateData,
            id: templateData.id || `mock-${Date.now()}`,
            is_mock: true,
          }),
          updateTemplate: async (templateId, updates = {}) => ({
            id: templateId,
            ...updates,
            is_mock: true,
          }),
          deleteTemplate: async () => true,
          recordTemplateUsage: async () => true,
          rateTemplate: async () => true,
          renderPrompt: () => '',
          renderTemplateString: () => '',
          validateTemplate: () => ({ valid: false, errors: ['Template manager unavailable'] }),
          previewTemplate: () => '',
          extractVariables: () => [],
          getDefaultVariables: () => ({})
        };
      }
    },
  });

  // ========================================
  // U-Key 管理器
  // ========================================
  factory.register({
    name: "ukeyManager",
    async init() {
      const { UKeyManager, DriverTypes } = require("../ukey/ukey-manager");
      const ukeyManager = new UKeyManager({
        driverType: DriverTypes.XINJINKE,
      });
      await ukeyManager.initialize();
      ukeyManager.startDeviceMonitor(5000);
      return ukeyManager;
    },
  });

  // ========================================
  // LLM 选择器
  // ========================================
  factory.register({
    name: "llmSelector",
    dependsOn: ["database"],
    async init(context) {
      const LLMSelector = require("../llm/llm-selector");
      return new LLMSelector(context.database);
    },
  });

  // ========================================
  // Token 追踪器
  // ========================================
  factory.register({
    name: "tokenTracker",
    dependsOn: ["database"],
    async init(context) {
      const { TokenTracker } = require("../llm/token-tracker");
      const tracker = new TokenTracker(context.database, {
        enableCostTracking: true,
        enableBudgetAlerts: true,
        exchangeRate: 7.2,
      });
      return tracker;
    },
  });

  // ========================================
  // Prompt 压缩器
  // ========================================
  factory.register({
    name: "promptCompressor",
    async init() {
      const { PromptCompressor } = require("../llm/prompt-compressor");
      return new PromptCompressor({
        enableDeduplication: true,
        enableSummarization: false,
        enableTruncation: true,
        maxHistoryMessages: 10,
        maxTotalTokens: 4000,
        similarityThreshold: 0.9,
        llmManager: null, // 稍后设置
      });
    },
  });

  // ========================================
  // 响应缓存
  // ========================================
  factory.register({
    name: "responseCache",
    dependsOn: ["database"],
    async init(context) {
      const { ResponseCache } = require("../llm/response-cache");
      return new ResponseCache(context.database, {
        ttl: 7 * 24 * 60 * 60 * 1000,
        maxSize: 1000,
        enableAutoCleanup: true,
        cleanupInterval: 60 * 60 * 1000,
      });
    },
  });

  // ========================================
  // LLM 管理器
  // ========================================
  factory.register({
    name: "llmManager",
    dependsOn: [
      "database",
      "tokenTracker",
      "promptCompressor",
      "responseCache",
    ],
    async init(context) {
      const { LLMManager } = require("../llm/llm-manager");
      const { getLLMConfig } = require("../llm/llm-config");
      const { getTestModeConfig } = require("../config/test-mode-config");

      // 检查测试模式
      const testModeConfig = getTestModeConfig();
      if (testModeConfig.mockLLM) {
        logger.info("[Core] 测试模式：使用Mock LLM服务");
        return testModeConfig.getMockLLMService();
      }

      // 从配置加载
      const llmConfig = getLLMConfig();
      const managerConfig = llmConfig.getManagerConfig();

      // 添加辅助服务
      if (context.tokenTracker) {
        managerConfig.tokenTracker = context.tokenTracker;
      }
      if (context.responseCache) {
        managerConfig.responseCache = context.responseCache;
      }
      if (context.promptCompressor) {
        managerConfig.promptCompressor = context.promptCompressor;
      }

      const llmManager = new LLMManager(managerConfig);
      await llmManager.initialize();

      // 设置 Prompt 压缩器的 LLM Manager 引用
      if (context.promptCompressor) {
        context.promptCompressor.llmManager = llmManager;
      }

      return llmManager;
    },
  });

  // ========================================
  // 永久记忆管理 (Clawdbot 风格)
  // ========================================
  factory.register({
    name: "permanentMemoryManager",
    dependsOn: ["database"],
    async init(context) {
      const {
        PermanentMemoryManager,
      } = require("../llm/permanent-memory-manager");
      const {
        getUnifiedConfigManager,
      } = require("../config/unified-config-manager");

      const configManager = getUnifiedConfigManager();
      const memoryDir = configManager.paths.memory;

      const permanentMemoryManager = new PermanentMemoryManager({
        memoryDir,
        database: context.database.db,
        llmManager: context.llmManager || null,
        ragManager: context.ragManager || null,
        enableDailyNotes: true,
        enableLongTermMemory: true,
        enableAutoIndexing: false, // Phase 5 实现后启用
        maxDailyNotesRetention: 30,
      });

      await permanentMemoryManager.initialize();
      logger.info("[PermanentMemoryManager] 永久记忆管理器已初始化");
      return permanentMemoryManager;
    },
  });

  // ========================================
  // Session 管理器 (Phase 3: 集成永久记忆刷新)
  // ========================================
  factory.register({
    name: "sessionManager",
    dependsOn: ["database", "llmManager", "permanentMemoryManager"],
    async init(context) {
      const { SessionManager } = require("../llm/session-manager");
      const {
        getUnifiedConfigManager,
      } = require("../config/unified-config-manager");

      const configManager = getUnifiedConfigManager();
      const sessionsDir = path.join(configManager.paths.memory, "sessions");

      const sessionManager = new SessionManager({
        database: context.database,
        llmManager: context.llmManager,
        permanentMemoryManager: context.permanentMemoryManager, // Phase 3
        sessionsDir,
        maxHistoryMessages: 10,
        compressionThreshold: 10,
        enableAutoSave: true,
        enableCompression: true,
        enableMemoryFlush: true, // Phase 3: 启用预压缩记忆刷新
      });

      await sessionManager.initialize();
      return sessionManager;
    },
  });

  // ========================================
  // 错误智能诊断
  // ========================================
  factory.register({
    name: "errorMonitor",
    dependsOn: ["database", "llmManager"],
    async init(context) {
      const { ErrorMonitor } = require("../monitoring/error-monitor");
      return new ErrorMonitor({
        llmManager: context.llmManager,
        database: context.database,
        enableAIDiagnosis: true,
        autoFixStrategies: [
          "retry",
          "timeout_increase",
          "fallback",
          "validation",
        ],
      });
    },
  });

  // ========================================
  // Multi-Agent 系统
  // ========================================
  factory.register({
    name: "multiAgent",
    dependsOn: ["llmManager"],
    async init(_context) {
      const { createMultiAgentSystem } = require("../ai-engine/multi-agent");
      const { orchestrator, agents } = createMultiAgentSystem({
        llmManager: _context.llmManager,
        functionCaller: _context.functionCaller,
      });
      return { orchestrator, agents };
    },
  });

  // ========================================
  // Memory Bank 系统
  // ========================================
  factory.register({
    name: "memoryBank",
    dependsOn: ["database", "llmManager", "errorMonitor", "sessionManager"],
    async init(context) {
      const { initializeMemorySystem } = require("../memory");
      const {
        getUnifiedConfigManager,
      } = require("../config/unified-config-manager");

      const configManager = getUnifiedConfigManager();
      return await initializeMemorySystem({
        database: context.database,
        configManager,
        llmManager: context.llmManager,
        errorMonitor: context.errorMonitor,
        sessionManager: context.sessionManager,
      });
    },
  });

  // ========================================
  // RAG 管理器
  // ========================================
  factory.register({
    name: "ragManager",
    dependsOn: ["database", "llmManager"],
    async init(context) {
      const { RAGManager } = require("../rag/rag-manager");
      const ragManager = new RAGManager(context.database, context.llmManager);
      await ragManager.initialize();
      return ragManager;
    },
  });

  // ========================================
  // 提示词模板管理器
  // ========================================
  factory.register({
    name: "promptTemplateManager",
    dependsOn: ["database"],
    async init(context) {
      const PromptTemplateManager = require("../prompt/prompt-template-manager");
      const manager = new PromptTemplateManager(context.database);
      await manager.initialize();
      return manager;
    },
  });

  // ========================================
  // Git 管理器
  // ========================================
  factory.register({
    name: "gitManager",
    dependsOn: ["database"],
    async init(context) {
      const GitManager = require("../git/git-manager");
      const MarkdownExporter = require("../git/markdown-exporter");
      const { getGitConfig } = require("../git/git-config");

      const gitConfig = getGitConfig();
      if (!gitConfig.isEnabled()) {
        logger.info("[Core] Git同步未启用");
        return null;
      }

      const repoPath =
        gitConfig.getRepoPath() ||
        path.join(app.getPath("userData"), "git-repo");
      const exportPath = path.join(repoPath, gitConfig.getExportPath());

      const gitManager = new GitManager({
        repoPath,
        remoteUrl: gitConfig.getRemoteUrl(),
        authorName: gitConfig.get("authorName"),
        authorEmail: gitConfig.get("authorEmail"),
        auth: gitConfig.getAuth(),
      });

      await gitManager.initialize();

      // 创建 Markdown 导出器
      const markdownExporter = new MarkdownExporter(
        context.database,
        exportPath,
      );

      // Git 热重载
      let gitHotReload = null;
      try {
        const GitHotReload = require("../git/git-hot-reload");
        gitHotReload = new GitHotReload(gitManager, {
          enabled: gitConfig.get("hotReloadEnabled") !== false,
          debounceDelay: gitConfig.get("hotReloadDebounceDelay") || 1000,
        });
        gitHotReload.start();
      } catch (error) {
        logger.warn("[Core] Git热重载初始化失败:", error.message);
      }

      return { gitManager, markdownExporter, gitHotReload, gitConfig };
    },
  });
}

module.exports = { registerCoreInitializers };
