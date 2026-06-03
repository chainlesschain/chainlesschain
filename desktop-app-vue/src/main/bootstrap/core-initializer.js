/**
 * 核心模块初始化器
 * 负责数据库、LLM、RAG等核心模块的初始化
 *
 * @module bootstrap/core-initializer
 */

const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * 是否已存在 legacy 加密库（曾用 "123456" 开过加密的 .encrypted 库）。
 * 用同 database-adapter.getEncryptedDbPath 的派生规则：<base>.encrypted<ext>。
 * @returns {boolean}
 */
function legacyEncryptedDbExists() {
  try {
    const { getAppConfig } = require("../config/database-config");
    const dbPath = getAppConfig().getDatabasePath();
    const ext = path.extname(dbPath);
    const encryptedDbPath = `${dbPath.slice(0, dbPath.length - ext.length)}.encrypted${ext}`;
    return fs.existsSync(encryptedDbPath);
  } catch (_err) {
    return false;
  }
}

/**
 * 解析 DB 加密口令来源（Phase 0：去硬编码 "123456"）。
 *
 * 优先 safeStorage 托管的随机口令；不可用 / 已有 legacy 库 / 出错时退回 legacy
 * 口令（不更弱）。仅在加密启用时调用 —— 当前打包生产 encryptionEnabled=false
 * （NODE_ENV 误判，见 docs/internal/db-master-key-hardening-design.md §1.0），
 * 故本逻辑在生产里休眠。
 *
 * @returns {{ password: string, source: string }}
 */
function resolveDbPassword() {
  const LEGACY_PASSWORD = process.env.DEFAULT_PASSWORD || "123456";
  try {
    const {
      createDbSecretProvider,
    } = require("../database/db-secret-provider");
    const secretPath = path.join(app.getPath("userData"), "db-secret.enc");
    const provider = createDbSecretProvider({ secretPath });

    if (!provider.isAvailable()) {
      logger.warn("[core-init] safeStorage 不可用，DB 口令退回 legacy（弱）");
      return { password: LEGACY_PASSWORD, source: "legacy-no-safestorage" };
    }
    if (provider.hasManagedPassphrase()) {
      return {
        password: provider.getOrCreateManagedPassphrase(),
        source: "managed",
      };
    }
    if (legacyEncryptedDbExists()) {
      // 已有 legacy .encrypted 库：保持 legacy 口令开库，rekey 留待后续阶段（不更弱）。
      logger.warn(
        "[core-init] 检测到 legacy 加密库，暂用 legacy 口令；rekey 待后续阶段",
      );
      return { password: LEGACY_PASSWORD, source: "legacy-pending-rekey" };
    }
    // 全新（或当前明文）库：用 safeStorage 托管随机口令。
    return {
      password: provider.getOrCreateManagedPassphrase(),
      source: "managed-new",
    };
  } catch (err) {
    logger.error(
      "[core-init] DB 口令 provider 失败，退回 legacy:",
      err.message,
    );
    return { password: LEGACY_PASSWORD, source: "legacy-error" };
  }
}

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
      const { DatabaseManager } = require("../database");
      const EncryptionConfigManager = require("../database/config-manager");

      // 检查加密配置
      const encryptionConfig = new EncryptionConfigManager(app);
      let encryptionEnabled = encryptionConfig.isEncryptionEnabled();

      // Phase 1（默认 OFF）：opt-in 时强制开启加密 + 明文→.encrypted 迁移 + fail-closed。
      // 默认不开 → encryptionEnabled 仍由 config 决定（打包生产为 false），行为零变化。
      const { isDbEncryptionOptIn } = require("../database/db-encryption-flag");
      const encryptionOptIn = isDbEncryptionOptIn();
      if (encryptionOptIn) {
        encryptionEnabled = true;
        logger.warn(
          "[core-init] DB 加密 opt-in 已开启（Phase 1，真机验证用）：将启用加密 + fail-closed",
        );
      }
      logger.info(`数据库加密状态: ${encryptionEnabled ? "已启用" : "未启用"}`);

      // Phase 0: 去硬编码 "123456"，加密启用时改用 safeStorage 托管随机口令。
      const { password: dbPassword, source: passwordSource } = encryptionEnabled
        ? resolveDbPassword()
        : {
            password: process.env.DEFAULT_PASSWORD || "123456",
            source: "legacy-encryption-off",
          };
      logger.info(`数据库口令来源: ${passwordSource}`);

      const database = new DatabaseManager(null, {
        password: dbPassword,
        encryptionEnabled,
        // fail-closed 仅在 opt-in 时启用，避免给未迁移用户造成可用性回归。
        requireEncryption: encryptionOptIn,
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
      } = require("../performance/performance-monitor");
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
    required: false, // Non-critical, app can run without templates
    async init(context) {
      try {
        if (!context.database || !context.database.db) {
          throw new Error("Database not initialized or missing db instance");
        }

        const ProjectTemplateManager = require("../template/template-manager");
        // BUGFIX: Pass DatabaseManager instance (needs both db and saveToFile())
        const manager = new ProjectTemplateManager(context.database);
        await manager.initialize();
        logger.info("[Bootstrap] ✓ TemplateManager initialized successfully");
        return manager;
      } catch (error) {
        logger.error(
          "[Bootstrap] TemplateManager initialization failed:",
          error,
        );
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
          renderPrompt: () => "",
          renderTemplateString: () => "",
          validateTemplate: () => ({
            valid: false,
            errors: ["Template manager unavailable"],
          }),
          previewTemplate: () => "",
          extractVariables: () => [],
          getDefaultVariables: () => ({}),
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
      const { prewarmLLMConfig } = require("../llm/llm-config");
      const { getTestModeConfig } = require("../config/test-mode-config");

      // 检查测试模式
      const testModeConfig = getTestModeConfig();
      if (testModeConfig.mockLLM) {
        logger.info("[Core] 测试模式：使用Mock LLM服务");
        return testModeConfig.getMockLLMService();
      }

      // 从配置加载 (M2: 异步预热，避免启动期阻塞事件循环)
      const llmConfig = await prewarmLLMConfig();
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

      // 把这个 instance 注册为 getLLMManager() singleton — 否则任何后续调用
      // getLLMManager() 的模块（PDH wiring、AI engine 各处 lazy hook）会创建
      // 第二个 LLMManager(空 config) 默认 fallback 到 ollama，user 在 LLM 配置
      // 页保存的 active provider (volcengine 等) 就被静默忽略了。
      const { _setLLMManagerInstance } = require("../llm/llm-manager");
      _setLLMManagerInstance(llmManager);

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
      const { getGitConfigAsync } = require("../git/git-config");

      // M2: 异步加载 git 配置，避免启动期阻塞事件循环
      const gitConfig = await getGitConfigAsync();
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
