/**
 * IPC 注册中心
 * 统一管理所有 IPC 模块的注册
 *
 * @module ipc-registry
 * @description 负责注册所有模块化的 IPC 处理器，实现主进程入口文件的解耦
 */

const { logger, createLogger } = require("../utils/logger.js");
const ipcGuard = require("./ipc-guard");

/**
 * 递归移除对象中的 undefined 值
 * @param {*} obj - 要处理的对象
 * @returns {*} 清理后的对象
 */
function removeUndefinedValues(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefinedValues(item));
  }
  if (typeof obj === "object") {
    const result = {};
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value !== undefined) {
        result[key] = removeUndefinedValues(value);
      }
    }
    return result;
  }
  return obj;
}

/**
 * 递归将对象中的 undefined 值替换为 null（用于 IPC 序列化）
 * @param {*} obj - 要处理的对象
 * @returns {*} 处理后的对象
 */
function _replaceUndefinedWithNull(obj) {
  if (obj === undefined) {
    return null;
  }
  if (obj === null) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => _replaceUndefinedWithNull(item));
  }
  if (typeof obj === "object") {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = _replaceUndefinedWithNull(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * 注册所有 IPC 处理器
 * @param {Object} dependencies - 依赖对象，包含所有管理器实例
 * @param {Object} dependencies.app - ChainlessChainApp 实例
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.ragManager - RAG 管理器
 * @param {Object} dependencies.ukeyManager - U-Key 管理器
 * @param {Object} dependencies.gitManager - Git 管理器
 * @param {Object} dependencies.didManager - DID 管理器
 * @param {Object} dependencies.p2pManager - P2P 管理器
 * @param {Object} dependencies.skillManager - 技能管理器
 * @param {Object} dependencies.toolManager - 工具管理器
 * @param {Object} [dependencies.*] - 其他管理器实例...
 * @returns {Object} 返回所有 IPC 模块实例，便于测试和调试
 */
function registerAllIPC(dependencies) {
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Starting modular IPC registration...");
  logger.info("[IPC Registry] ========================================");

  const startTime = Date.now();
  const registeredModules = {};

  // 检查是否已经注册过（防止重复注册）
  if (ipcGuard.isModuleRegistered("ipc-registry")) {
    logger.info(
      "[IPC Registry] ⚠️  IPC Registry already initialized, skipping registration...",
    );
    ipcGuard.printStats();
    return registeredModules;
  }

  try {
    // 解构所有依赖（便于后续传递给各个模块）
    const {
      app,
      database,
      mainWindow,
      llmManager,
      ragManager,
      ukeyManager,
      gitManager,
      gitHotReload,
      didManager,
      p2pManager,
      skillManager,
      toolManager,
      imageUploader,
      fileImporter,
      promptTemplateManager,
      knowledgePaymentManager,
      creditScoreManager,
      reviewManager,
      vcTemplateManager,
      identityContextManager,
      aiEngineManager,
      webEngine,
      documentEngine,
      dataEngine,
      projectStructureManager,
      pluginManager,
      webideManager,
      statsCollector,
      fileSyncManager,
      previewManager,
      markdownExporter,
      nativeMessagingServer,
      gitAutoCommit,
      skillExecutor,
      aiScheduler,
      chatSkillBridge,
      syncManager,
      contactManager,
      friendManager,
      postManager,
      vcManager,
      organizationManager,
      dbManager,
      versionManager,
    } = dependencies;

    // ============================================================
    // 第一阶段模块 (AI 相关 - 优先级最高，作为示范)
    // ============================================================

    // LLM 服务 (函数模式 - 小模块示范，14 handlers)
    // 注意：即使 llmManager 为 null 也注册，handler 内部会处理 null 情况
    logger.info("[IPC Registry] Registering LLM IPC...");
    const { registerLLMIPC } = require("../llm/llm-ipc");

    // 获取 LLM 智能选择器（如果已初始化）
    const llmSelector = app ? app.llmSelector || null : null;

    // 获取 Token 追踪器（如果已初始化）
    const tokenTracker = app ? app.tokenTracker || null : null;

    // 获取 Prompt 压缩器（如果已初始化）
    const promptCompressor = app ? app.promptCompressor || null : null;

    // 获取响应缓存（如果已初始化）
    const responseCache = app ? app.responseCache || null : null;

    // 获取 MCP 相关依赖（如果已初始化）
    const mcpClientManager = app ? app.mcpManager || null : null;
    const mcpToolAdapter = app ? app.mcpAdapter || null : null;

    // 🔥 获取高级特性依赖（SessionManager, ErrorMonitor, Multi-Agent, PermanentMemory）
    const sessionManager = app ? app.sessionManager || null : null;
    const errorMonitor = app ? app.errorMonitor || null : null;
    const agentOrchestrator = app ? app.agentOrchestrator || null : null;
    const permanentMemoryManager = app
      ? app.permanentMemoryManager || null
      : null;

    registerLLMIPC({
      llmManager: llmManager || null,
      mainWindow: mainWindow || null,
      ragManager: ragManager || null,
      promptTemplateManager: promptTemplateManager || null,
      llmSelector,
      tokenTracker,
      promptCompressor,
      responseCache,
      database: database || null,
      app: app || null,
      mcpClientManager,
      mcpToolAdapter,
      // 🔥 高级特性依赖
      sessionManager,
      agentOrchestrator,
      errorMonitor,
    });

    if (!llmManager) {
      logger.info(
        "[IPC Registry] ⚠️  LLM manager not initialized (handlers registered with degraded functionality)",
      );
    }
    logger.info("[IPC Registry] ✓ LLM IPC registered (14 handlers)");

    // PermanentMemory 永久记忆管理 (Clawdbot 风格, 7 handlers)
    if (permanentMemoryManager) {
      logger.info("[IPC Registry] Registering PermanentMemory IPC...");
      const {
        registerPermanentMemoryIPC,
      } = require("../llm/permanent-memory-ipc");
      registerPermanentMemoryIPC(permanentMemoryManager);
      logger.info(
        "[IPC Registry] ✓ PermanentMemory IPC registered (7 handlers)",
      );
    }

    // 🔥 Hooks 系统 (Claude Code 风格, 11 handlers)
    logger.info("[IPC Registry] Registering Hooks IPC...");
    let hookSystem = null;
    try {
      const { registerHooksIPC } = require("../hooks/hooks-ipc");
      const { getHookSystem } = require("../hooks");
      hookSystem = getHookSystem();
      registerHooksIPC({ hookSystem });
      logger.info("[IPC Registry] ✓ Hooks IPC registered (11 handlers)");
    } catch (hooksError) {
      logger.warn(
        "[IPC Registry] ⚠️  Hooks IPC registration failed (non-fatal):",
        hooksError.message,
      );
    }

    // 🔥 Plan Mode 系统 (Claude Code 风格, 14 handlers)
    logger.info("[IPC Registry] Registering Plan Mode IPC...");
    try {
      const { registerPlanModeIPC } = require("../ai-engine/plan-mode/plan-mode-ipc");
      registerPlanModeIPC({ hookSystem, functionCaller });
      logger.info("[IPC Registry] ✓ Plan Mode IPC registered (14 handlers)");
    } catch (planModeError) {
      logger.warn(
        "[IPC Registry] ⚠️  Plan Mode IPC registration failed (non-fatal):",
        planModeError.message,
      );
    }

    // 🔥 Markdown Skills 系统 (Claude Code 风格, 17 handlers)
    logger.info("[IPC Registry] Registering Markdown Skills IPC...");
    try {
      const { registerSkillsIPC } = require("../ai-engine/cowork/skills/skills-ipc");
      registerSkillsIPC({ hookSystem, workspacePath: process.cwd() });
      logger.info("[IPC Registry] ✓ Markdown Skills IPC registered (17 handlers)");
    } catch (skillsError) {
      logger.warn(
        "[IPC Registry] ⚠️  Markdown Skills IPC registration failed (non-fatal):",
        skillsError.message,
      );
    }

    // 🔥 Context Engineering 系统 (KV-Cache 优化, 17 handlers)
    logger.info("[IPC Registry] Registering Context Engineering IPC...");
    try {
      const { registerContextEngineeringIPC } = require("../llm/context-engineering-ipc");
      registerContextEngineeringIPC();
      logger.info("[IPC Registry] ✓ Context Engineering IPC registered (17 handlers)");
    } catch (contextError) {
      logger.warn(
        "[IPC Registry] ⚠️  Context Engineering IPC registration failed (non-fatal):",
        contextError.message,
      );
    }

    // 🔥 Prompt Compressor 系统 (上下文压缩, 10 handlers)
    logger.info("[IPC Registry] Registering Prompt Compressor IPC...");
    try {
      const { registerPromptCompressorIPC } = require("../llm/prompt-compressor-ipc");
      registerPromptCompressorIPC({ llmManager: llmManager || null });
      logger.info("[IPC Registry] ✓ Prompt Compressor IPC registered (10 handlers)");
    } catch (compressorError) {
      logger.warn(
        "[IPC Registry] ⚠️  Prompt Compressor IPC registration failed (non-fatal):",
        compressorError.message,
      );
    }

    // 🔥 Response Cache 系统 (响应缓存, 11 handlers)
    logger.info("[IPC Registry] Registering Response Cache IPC...");
    try {
      const { registerResponseCacheIPC } = require("../llm/response-cache-ipc");
      registerResponseCacheIPC({ responseCache: responseCache || null, database: database || null });
      logger.info("[IPC Registry] ✓ Response Cache IPC registered (11 handlers)");
    } catch (cacheError) {
      logger.warn(
        "[IPC Registry] ⚠️  Response Cache IPC registration failed (non-fatal):",
        cacheError.message,
      );
    }

    // 🔥 Token Tracker 系统 (Token 追踪与成本管理, 12 handlers)
    logger.info("[IPC Registry] Registering Token Tracker IPC...");
    try {
      const { registerTokenTrackerIPC } = require("../llm/token-tracker-ipc");
      registerTokenTrackerIPC({ tokenTracker: tokenTracker || null, database: database || null });
      logger.info("[IPC Registry] ✓ Token Tracker IPC registered (12 handlers)");
    } catch (trackerError) {
      logger.warn(
        "[IPC Registry] ⚠️  Token Tracker IPC registration failed (non-fatal):",
        trackerError.message,
      );
    }

    // 🔥 Stream Controller 系统 (流式输出控制, 12 handlers)
    logger.info("[IPC Registry] Registering Stream Controller IPC...");
    try {
      const { registerStreamControllerIPC } = require("../llm/stream-controller-ipc");
      registerStreamControllerIPC({ mainWindow: mainWindow || null });
      logger.info("[IPC Registry] ✓ Stream Controller IPC registered (12 handlers)");
    } catch (streamError) {
      logger.warn(
        "[IPC Registry] ⚠️  Stream Controller IPC registration failed (non-fatal):",
        streamError.message,
      );
    }

    // 🔥 Resource Monitor 系统 (资源监控与降级, 13 handlers)
    logger.info("[IPC Registry] Registering Resource Monitor IPC...");
    try {
      const { registerResourceMonitorIPC } = require("../utils/resource-monitor-ipc");
      registerResourceMonitorIPC({ mainWindow: mainWindow || null });
      logger.info("[IPC Registry] ✓ Resource Monitor IPC registered (13 handlers)");
    } catch (resourceError) {
      logger.warn(
        "[IPC Registry] ⚠️  Resource Monitor IPC registration failed (non-fatal):",
        resourceError.message,
      );
    }

    // 🔥 Message Aggregator 系统 (消息批量聚合, 10 handlers)
    logger.info("[IPC Registry] Registering Message Aggregator IPC...");
    try {
      const { registerMessageAggregatorIPC } = require("../utils/message-aggregator-ipc");
      registerMessageAggregatorIPC({ mainWindow: mainWindow || null });
      logger.info("[IPC Registry] ✓ Message Aggregator IPC registered (10 handlers)");
    } catch (aggregatorError) {
      logger.warn(
        "[IPC Registry] ⚠️  Message Aggregator IPC registration failed (non-fatal):",
        aggregatorError.message,
      );
    }

    // 🔥 Team Task Management 系统 (任务看板, 49 handlers)
    logger.info("[IPC Registry] Registering Team Task Management IPC...");
    try {
      const { registerTaskIPC } = require("../task/task-ipc");
      registerTaskIPC(database);
      logger.info("[IPC Registry] ✓ Team Task Management IPC registered (49 handlers)");
      logger.info("[IPC Registry]   - Board Management: 9 handlers");
      logger.info("[IPC Registry]   - Task Query: 4 handlers");
      logger.info("[IPC Registry]   - Task CRUD: 12 handlers");
      logger.info("[IPC Registry]   - Checklists: 5 handlers");
      logger.info("[IPC Registry]   - Comments/Activity: 6 handlers");
      logger.info("[IPC Registry]   - Attachments: 4 handlers");
      logger.info("[IPC Registry]   - Sprint Management: 5 handlers");
      logger.info("[IPC Registry]   - Reports/Analytics: 5 handlers");
    } catch (taskError) {
      logger.warn(
        "[IPC Registry] ⚠️  Team Task Management IPC registration failed (non-fatal):",
        taskError.message,
      );
    }

    // Logger 服务 (日志管理器)
    logger.info("[IPC Registry] Registering Logger IPC...");
    const { registerLoggerIPC } = require("./logger-ipc");
    registerLoggerIPC();
    logger.info("[IPC Registry] ✓ Logger IPC registered (6 handlers)");

    // RAG 检索 (函数模式 - 小模块示范，7 handlers)
    if (ragManager) {
      logger.info("[IPC Registry] Registering RAG IPC...");
      const { registerRAGIPC } = require("../rag/rag-ipc");
      registerRAGIPC({ ragManager, llmManager });
      logger.info("[IPC Registry] ✓ RAG IPC registered (7 handlers)");
    }

    // 后续输入意图分类器 (Follow-up Intent Classifier，3 handlers)
    logger.info(
      "[IPC Registry] Registering Follow-up Intent Classifier IPC...",
    );
    const {
      registerIPCHandlers: registerFollowupIntentIPC,
    } = require("../ai-engine/followup-intent-ipc");
    registerFollowupIntentIPC(llmManager);
    logger.info(
      "[IPC Registry] ✓ Follow-up Intent Classifier IPC registered (3 handlers)",
    );

    // 联网搜索工具 (Web Search，4 handlers)
    logger.info("[IPC Registry] Registering Web Search IPC...");
    const { registerWebSearchIPC } = require("../utils/web-search-ipc");
    registerWebSearchIPC();
    logger.info("[IPC Registry] ✓ Web Search IPC registered (4 handlers)");

    // ============================================================
    // 第二阶段模块 (核心功能)
    // ============================================================

    // U-Key 硬件管理 (函数模式 - 小模块，9 handlers)
    // 注意：即使 ukeyManager 为 null 也注册，handler 内部会处理 null 情况
    logger.info("[IPC Registry] Registering U-Key IPC...");
    const { registerUKeyIPC } = require("../ukey/ukey-ipc");
    registerUKeyIPC({ ukeyManager });
    if (!ukeyManager) {
      logger.info(
        "[IPC Registry] ⚠️  U-Key manager not initialized (handlers registered with degraded functionality)",
      );
    }
    logger.info("[IPC Registry] ✓ U-Key IPC registered (9 handlers)");

    // 数据库管理 (函数模式 - 中等模块，22 handlers)
    // 注意：即使 database 为 null 也注册，handler 内部会处理 null 情况
    logger.info("[IPC Registry] Registering Database IPC...");
    const { registerDatabaseIPC } = require("../database/database-ipc");

    // 获取 getAppConfig 函数
    const { getAppConfig } = require("../config/database-config");

    registerDatabaseIPC({
      database,
      ragManager,
      getAppConfig,
    });
    if (!database) {
      logger.info(
        "[IPC Registry] ⚠️  Database manager not initialized (handlers registered with degraded functionality)",
      );
    }
    logger.info("[IPC Registry] ✓ Database IPC registered (22 handlers)");

    // Git 版本控制 (函数模式 - 中等模块，16 handlers)
    // 注意：即使 gitManager 为 null 也注册 IPC，让 handler 内部处理
    logger.info("[IPC Registry] Registering Git IPC...");
    const { registerGitIPC } = require("../git/git-ipc");

    // 获取 getGitConfig 函数
    const { getGitConfig } = require("../git/git-config");

    registerGitIPC({
      gitManager,
      markdownExporter,
      getGitConfig,
      llmManager,
      gitHotReload,
      mainWindow,
    });
    logger.info("[IPC Registry] ✓ Git IPC registered (22 handlers)");
    if (!gitManager) {
      logger.info(
        "[IPC Registry] ⚠️  Git manager not initialized (Git sync disabled in config)",
      );
    }
    if (gitHotReload) {
      logger.info("[IPC Registry] ✓ Git Hot Reload enabled");
    }

    // ============================================================
    // 关键IPC模块 - 提前注册 (用于E2E测试)
    // ============================================================

    // 🔥 MCP 基础配置 IPC - 始终注册，允许用户通过UI启用/禁用MCP
    // 这是独立于MCP系统初始化的，因为用户需要先能配置MCP才能启用它
    logger.info("[IPC Registry] Registering MCP Basic Config IPC (early)...");
    try {
      const { registerBasicMCPConfigIPC } = require("../mcp/mcp-ipc");
      registerBasicMCPConfigIPC();
      logger.info(
        "[IPC Registry] ✓ MCP Basic Config IPC registered (early, 3 handlers)",
      );
    } catch (mcpError) {
      logger.error(
        "[IPC Registry] ❌ MCP Basic Config IPC registration failed:",
        mcpError.message,
      );
    }

    // 系统窗口控制 - 提前注册 (不需要 mainWindow 的部分)
    logger.info("[IPC Registry] Registering System IPC (early)...");
    const { registerSystemIPC } = require("../system/system-ipc");
    registerSystemIPC({ mainWindow: mainWindow || null });
    logger.info("[IPC Registry] ✓ System IPC registered (early, 16 handlers)");

    // 通知管理 - 提前注册
    logger.info("[IPC Registry] Registering Notification IPC (early)...");
    const {
      registerNotificationIPC,
    } = require("../notification/notification-ipc");
    registerNotificationIPC({ database: database || null });
    logger.info(
      "[IPC Registry] ✓ Notification IPC registered (early, 5 handlers)",
    );

    // ============================================================
    // 第三阶段模块 (社交网络 - DID, P2P, Social)
    // ============================================================

    // DID 身份管理 (函数模式 - 中等模块，24 handlers)
    if (didManager) {
      logger.info("[IPC Registry] Registering DID IPC...");
      const { registerDIDIPC } = require("../did/did-ipc");
      registerDIDIPC({ didManager });
      logger.info("[IPC Registry] ✓ DID IPC registered (24 handlers)");
    }

    // P2P 网络通信 (函数模式 - 中等模块，18 handlers)
    if (p2pManager) {
      logger.info("[IPC Registry] Registering P2P IPC...");
      const { registerP2PIPC } = require("../p2p/p2p-ipc");
      registerP2PIPC({ p2pManager });
      logger.info("[IPC Registry] ✓ P2P IPC registered (18 handlers)");
    }

    // 外部设备文件管理 (函数模式 - 中等模块，15 handlers)
    if (p2pManager && database) {
      const externalFileManager = dependencies.externalFileManager;
      if (externalFileManager) {
        logger.info("[IPC Registry] Registering External Device File IPC...");
        const {
          registerExternalDeviceFileIPC,
        } = require("../file/external-device-file-ipc");
        registerExternalDeviceFileIPC(
          require("electron").ipcMain,
          externalFileManager,
        );
        logger.info(
          "[IPC Registry] ✓ External Device File IPC registered (15 handlers)",
        );
      }
    }

    // 社交网络 (函数模式 - 大模块，33 handlers: contact + friend + post + chat)
    if (contactManager || friendManager || postManager || database) {
      logger.info("[IPC Registry] Registering Social IPC...");
      const { registerSocialIPC } = require("../social/social-ipc");
      registerSocialIPC({
        contactManager,
        friendManager,
        postManager,
        database,
      });
      logger.info("[IPC Registry] ✓ Social IPC registered (33 handlers)");
    }

    // ============================================================
    // 第四阶段模块 (企业版 - VC, Organization, Identity Context)
    // ============================================================

    // 可验证凭证 (函数模式 - 小模块，10 handlers)
    if (vcManager) {
      logger.info("[IPC Registry] Registering VC IPC...");
      const { registerVCIPC } = require("../vc/vc-ipc");
      registerVCIPC({ vcManager });
      logger.info("[IPC Registry] ✓ VC IPC registered (10 handlers)");
    }

    // 身份上下文 (函数模式 - 小模块，7 handlers)
    if (identityContextManager) {
      logger.info("[IPC Registry] Registering Identity Context IPC...");
      const {
        registerIdentityContextIPC,
      } = require("../identity-context/identity-context-ipc");
      registerIdentityContextIPC({ identityContextManager });
      logger.info(
        "[IPC Registry] ✓ Identity Context IPC registered (7 handlers)",
      );
    }

    // 组织管理 (函数模式 - 大模块，32 handlers)
    if (organizationManager || dbManager) {
      logger.info("[IPC Registry] Registering Organization IPC...");
      const {
        registerOrganizationIPC,
      } = require("../organization/organization-ipc");
      registerOrganizationIPC({
        organizationManager,
        dbManager,
        versionManager,
      });
      logger.info("[IPC Registry] ✓ Organization IPC registered (32 handlers)");
    }

    // 企业版仪表板 (函数模式 - 中模块，10 handlers)
    if (database) {
      logger.info("[IPC Registry] Registering Dashboard IPC...");
      const { registerDashboardIPC } = require("../organization/dashboard-ipc");
      registerDashboardIPC({
        database,
        organizationManager,
      });
      logger.info("[IPC Registry] ✓ Dashboard IPC registered (10 handlers)");
    }

    // ============================================================
    // 第五阶段模块 (项目管理 - 最大模块组，分为多个子模块)
    // ============================================================

    // 项目核心管理 (函数模式 - 大模块，34 handlers)
    if (database) {
      logger.info("[IPC Registry] Registering Project Core IPC...");
      const { registerProjectCoreIPC } = require("../project/project-core-ipc");
      registerProjectCoreIPC({
        database,
        fileSyncManager,
        removeUndefinedValues,
        _replaceUndefinedWithNull,
      });
      logger.info("[IPC Registry] ✓ Project Core IPC registered (34 handlers)");
    }

    // 项目AI功能 (函数模式 - 中等模块，16 handlers)
    // 🔥 只要有 database 就注册，handlers 内部会处理 llmManager 为 null 的情况
    if (database) {
      logger.info("[IPC Registry] Registering Project AI IPC...");
      const { registerProjectAIIPC } = require("../project/project-ai-ipc");
      registerProjectAIIPC({
        database,
        llmManager: llmManager || null,
        aiEngineManager: aiEngineManager || null,
        chatSkillBridge: chatSkillBridge || null,
        mainWindow: mainWindow || null,
        scanAndRegisterProjectFiles:
          app?.scanAndRegisterProjectFiles?.bind(app) || null,
        // 🔥 MCP 集成：传递 MCP 依赖用于项目AI会话工具调用
        mcpClientManager,
        mcpToolAdapter,
      });
      if (!llmManager) {
        logger.info(
          "[IPC Registry] ⚠️  LLM manager not initialized (Project AI handlers registered with degraded functionality)",
        );
      }
      logger.info("[IPC Registry] ✓ Project AI IPC registered (16 handlers)");
    }

    // 项目导出分享 (函数模式 - 大模块，17 handlers)
    if (database || llmManager) {
      logger.info("[IPC Registry] Registering Project Export/Share IPC...");
      const {
        registerProjectExportIPC,
      } = require("../project/project-export-ipc");

      // 获取必要的依赖函数
      const { getDatabaseConnection, saveDatabase } = require("../database");
      const { getProjectConfig } = require("../project/project-config");
      const { copyDirectory } = require("../utils/file-utils");

      registerProjectExportIPC({
        database,
        llmManager,
        mainWindow,
        getDatabaseConnection,
        saveDatabase,
        getProjectConfig,
        copyDirectory,
        convertSlidesToOutline: app.convertSlidesToOutline?.bind(app),
      });
      logger.info(
        "[IPC Registry] ✓ Project Export/Share IPC registered (17 handlers)",
      );
    }

    // 项目RAG检索 (函数模式 - 中等模块，10 handlers)
    logger.info("[IPC Registry] Registering Project RAG IPC...");
    const { registerProjectRAGIPC } = require("../project/project-rag-ipc");

    // 获取必要的依赖函数
    const { getProjectRAGManager } = require("../project/project-rag");
    const {
      getProjectConfig: getRagProjectConfig,
    } = require("../project/project-config");
    const RAGAPI = require("../project/rag-api");

    registerProjectRAGIPC({
      getProjectRAGManager,
      getProjectConfig: getRagProjectConfig,
      RAGAPI,
    });
    logger.info("[IPC Registry] ✓ Project RAG IPC registered (10 handlers)");

    // 项目Git集成 (函数模式 - 大模块，14 handlers)
    logger.info("[IPC Registry] Registering Project Git IPC...");
    const { registerProjectGitIPC } = require("../project/project-git-ipc");

    // 获取必要的依赖函数
    const {
      getProjectConfig: getGitProjectConfig,
    } = require("../project/project-config");
    const GitAPI = require("../project/git-api");

    registerProjectGitIPC({
      getProjectConfig: getGitProjectConfig,
      GitAPI,
      gitManager,
      fileSyncManager,
      mainWindow,
    });
    logger.info("[IPC Registry] ✓ Project Git IPC registered (14 handlers)");

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 5 Complete: All 91 project: handlers migrated!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // 第六阶段模块 (核心功能 - File, Template, Knowledge, Prompt, Image)
    // ============================================================

    // 文件操作 (函数模式 - 中等模块，17 handlers)
    if (database) {
      logger.info("[IPC Registry] Registering File IPC...");
      const { registerFileIPC } = require("../file/file-ipc");
      const { getProjectConfig } = require("../project/project-config");

      registerFileIPC({
        database,
        mainWindow,
        getProjectConfig,
      });
      logger.info("[IPC Registry] ✓ File IPC registered (17 handlers)");
    }

    // 模板管理 (函数模式 - 大模块，20 handlers)
    logger.info("[IPC Registry] Registering Template IPC...");
    const { registerTemplateIPC } = require("../template/template-ipc");

    registerTemplateIPC({
      templateManager: app.templateManager,
    });
    logger.info("[IPC Registry] ✓ Template IPC registered (20 handlers)");

    // 知识管理 (函数模式 - 中等模块，17 handlers)
    if (dbManager || versionManager || knowledgePaymentManager) {
      logger.info("[IPC Registry] Registering Knowledge IPC...");
      const { registerKnowledgeIPC } = require("../knowledge/knowledge-ipc");

      registerKnowledgeIPC({
        dbManager,
        versionManager,
        knowledgePaymentManager,
      });
      logger.info("[IPC Registry] ✓ Knowledge IPC registered (17 handlers)");
    }

    // 提示词模板 (函数模式 - 小模块，11 handlers)
    if (promptTemplateManager) {
      logger.info("[IPC Registry] Registering Prompt Template IPC...");
      const {
        registerPromptTemplateIPC,
      } = require("../prompt-template/prompt-template-ipc");

      registerPromptTemplateIPC({
        promptTemplateManager,
      });
      logger.info(
        "[IPC Registry] ✓ Prompt Template IPC registered (11 handlers)",
      );
    }

    // 图像管理 (函数模式 - 大模块，22 handlers)
    if (imageUploader) {
      logger.info("[IPC Registry] Registering Image IPC...");
      const { registerImageIPC } = require("../image/image-ipc");

      registerImageIPC({
        imageUploader,
        llmManager,
        mainWindow,
      });
      logger.info("[IPC Registry] ✓ Image IPC registered (22 handlers)");
    }

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 6 Complete: 5 modules migrated (87 handlers)!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // 第七阶段模块 (媒体处理 - Speech, Video, PDF, Document)
    // ============================================================

    // 语音处理 (函数模式 - 超大模块，34 handlers)
    // 注意：检查 initializeSpeechManager 是否存在
    if (
      app.initializeSpeechManager &&
      typeof app.initializeSpeechManager === "function"
    ) {
      try {
        logger.info("[IPC Registry] Registering Speech IPC...");
        const { registerSpeechIPC } = require("../speech/speech-ipc");

        // 获取 initializeSpeechManager 函数
        const initializeSpeechManager = app.initializeSpeechManager.bind(app);

        registerSpeechIPC({
          initializeSpeechManager,
        });
        logger.info("[IPC Registry] ✓ Speech IPC registered (34 handlers)");
      } catch (speechError) {
        logger.error(
          "[IPC Registry] ❌ Speech IPC registration failed:",
          speechError.message,
        );
        logger.info(
          "[IPC Registry] ⚠️  Continuing with other IPC registrations...",
        );
      }
    } else {
      logger.info(
        "[IPC Registry] ⚠️  Speech IPC skipped (initializeSpeechManager not available)",
      );
    }

    // 视频处理 (函数模式 - 大模块，18 handlers)
    if (app.videoImporter) {
      logger.info("[IPC Registry] Registering Video IPC...");
      const { registerVideoIPC } = require("../video/video-ipc");

      registerVideoIPC({
        videoImporter: app.videoImporter,
        mainWindow,
        llmManager,
      });
      logger.info("[IPC Registry] ✓ Video IPC registered (18 handlers)");
    }

    // PDF 处理 (函数模式 - 小模块，4 handlers)
    logger.info("[IPC Registry] Registering PDF IPC...");
    const { registerPDFIPC } = require("../pdf/pdf-ipc");

    // 获取 getPDFEngine 函数
    const { getPDFEngine } = require("../engines/pdf-engine");

    registerPDFIPC({
      getPDFEngine,
    });
    logger.info("[IPC Registry] ✓ PDF IPC registered (4 handlers)");

    // 文档处理 (函数模式 - 小模块，1 handler)
    logger.info("[IPC Registry] Registering Document IPC...");
    const { registerDocumentIPC } = require("../document/document-ipc");

    registerDocumentIPC({
      convertSlidesToOutline: app.convertSlidesToOutline?.bind(app),
    });
    logger.info("[IPC Registry] ✓ Document IPC registered (1 handler)");

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 7 Complete: 4 modules migrated (57 handlers)!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // 第八阶段模块 (新增模块 - 区块链、代码工具、知识图谱等)
    // ============================================================

    // 区块链核心 (7个模块, 75 handlers) - 懒加载模式
    // 注册懒加载的区块链 IPC 处理器，在首次访问时才初始化区块链模块
    logger.info("[IPC Registry] Registering Blockchain IPC (Lazy Loading)...");
    const {
      registerLazyBlockchainIPC,
    } = require("../blockchain/blockchain-lazy-ipc");
    registerLazyBlockchainIPC({ app, database, mainWindow });
    logger.info(
      "[IPC Registry] ✓ Blockchain IPC registered (75 handlers, lazy loading enabled)",
    );

    // 代码工具 (2个模块, 20 handlers)
    if (llmManager) {
      logger.info("[IPC Registry] Registering Code Tools IPC...");
      const { registerCodeIPC } = require("../code-tools/code-ipc");
      registerCodeIPC({ llmManager });
      logger.info("[IPC Registry] ✓ Code Tools IPC registered (10 handlers)");
    }

    if (reviewManager) {
      logger.info("[IPC Registry] Registering Review System IPC...");
      const { registerReviewIPC } = require("../code-tools/review-ipc");
      registerReviewIPC({ reviewManager });
      logger.info(
        "[IPC Registry] ✓ Review System IPC registered (10 handlers)",
      );
    }

    // 企业协作 (3个模块, 28 handlers)
    logger.info("[IPC Registry] Registering Collaboration IPC...");
    const {
      registerCollaborationIPC,
    } = require("../collaboration/collaboration-ipc");
    registerCollaborationIPC();
    logger.info("[IPC Registry] ✓ Collaboration IPC registered (8 handlers)");

    if (vcTemplateManager) {
      logger.info("[IPC Registry] Registering VC Template IPC...");
      const {
        registerVCTemplateIPC,
      } = require("../vc-template/vc-template-ipc");
      registerVCTemplateIPC(vcTemplateManager);
      logger.info("[IPC Registry] ✓ VC Template IPC registered (11 handlers)");
    }

    logger.info("[IPC Registry] Registering Automation IPC...");
    const { registerAutomationIPC } = require("../automation/automation-ipc");
    registerAutomationIPC();
    logger.info("[IPC Registry] ✓ Automation IPC registered (9 handlers)");

    // 知识图谱与信用 (2个模块, 18 handlers)
    if (database || app.graphExtractor) {
      logger.info("[IPC Registry] Registering Knowledge Graph IPC...");
      const { registerGraphIPC } = require("../knowledge-graph/graph-ipc");
      registerGraphIPC({
        database,
        graphExtractor: app.graphExtractor,
        llmManager,
      });
      logger.info(
        "[IPC Registry] ✓ Knowledge Graph IPC registered (11 handlers)",
      );
    }

    if (creditScoreManager) {
      logger.info("[IPC Registry] Registering Credit Score IPC...");
      const { registerCreditIPC } = require("../credit/credit-ipc");
      registerCreditIPC({ creditScoreManager });
      logger.info("[IPC Registry] ✓ Credit Score IPC registered (7 handlers)");
    }

    // 插件系统 - 懒加载模式
    logger.info("[IPC Registry] Registering Plugin IPC (Lazy Loading)...");
    const { registerLazyPluginIPC } = require("../plugins/plugin-lazy-ipc");
    registerLazyPluginIPC({ app, mainWindow });
    logger.info(
      "[IPC Registry] ✓ Plugin IPC registered (lazy loading enabled)",
    );

    // 其他功能 (3个模块, 13 handlers)
    if (fileImporter) {
      logger.info("[IPC Registry] Registering Import IPC...");
      const { registerImportIPC } = require("../import/import-ipc");
      registerImportIPC({
        fileImporter,
        mainWindow,
        database,
        ragManager,
      });
      logger.info("[IPC Registry] ✓ Import IPC registered (5 handlers)");
    }

    logger.info("[IPC Registry] Registering Sync IPC...");
    if (!syncManager) {
      logger.warn(
        "[IPC Registry] ⚠️ syncManager 未初始化，将注册降级的 Sync IPC handlers",
      );
    }
    const { registerSyncIPC } = require("../sync/sync-ipc");
    registerSyncIPC({ syncManager: syncManager || null });
    logger.info("[IPC Registry] ✓ Sync IPC registered (4 handlers)");

    // Notification IPC already registered early (line 305-311)

    // Preference Manager IPC
    logger.info("[IPC Registry] Registering Preference Manager IPC...");
    const preferenceManager = app ? app.preferenceManager || null : null;
    if (preferenceManager) {
      const {
        registerPreferenceManagerIPC,
      } = require("../memory/preference-manager-ipc");
      registerPreferenceManagerIPC({ preferenceManager });
      logger.info(
        "[IPC Registry] ✓ Preference Manager IPC registered (12 handlers)",
      );
    } else {
      logger.warn(
        "[IPC Registry] ⚠️ preferenceManager 未初始化，跳过 Preference IPC 注册",
      );
    }

    // 对话管理 (函数模式 - 中等模块，17 handlers)
    // 注意：即使 database 为 null 也注册，handler 内部会处理 null 情况
    // 🔥 v2.0: 整合高级特性（SessionManager, Manus, Multi-Agent, RAG等）
    logger.info("[IPC Registry] Registering Conversation IPC...");
    const {
      registerConversationIPC,
    } = require("../conversation/conversation-ipc");
    registerConversationIPC({
      database: database || null,
      llmManager: llmManager || null,
      mainWindow: mainWindow || null,
      // 🔥 高级特性依赖
      sessionManager,
      agentOrchestrator,
      ragManager: ragManager || null,
      promptCompressor,
      responseCache,
      tokenTracker,
      errorMonitor,
    });
    if (!database) {
      logger.info(
        "[IPC Registry] ⚠️  Database manager not initialized (handlers registered with degraded functionality)",
      );
    }
    if (!llmManager) {
      logger.info(
        "[IPC Registry] ⚠️  LLM manager not initialized (handlers registered with degraded functionality)",
      );
    }
    // 🔥 打印高级特性状态
    logger.info("[IPC Registry] ✓ Conversation IPC registered (17 handlers)", {
      sessionManager: !!sessionManager,
      agentOrchestrator: !!agentOrchestrator,
      ragManager: !!ragManager,
      promptCompressor: !!promptCompressor,
      tokenTracker: !!tokenTracker,
    });

    // 文件同步监听 (函数模式 - 小模块，3 handlers)
    if (database) {
      logger.info("[IPC Registry] Registering File Sync IPC...");
      if (!fileSyncManager) {
        logger.warn(
          "[IPC Registry] ⚠️ fileSyncManager 未初始化，将注册降级的 File Sync IPC handlers",
        );
      }
      const { registerFileSyncIPC } = require("../file-sync/file-sync-ipc");
      registerFileSyncIPC({
        fileSyncManager: fileSyncManager || null,
        database,
      });
      logger.info("[IPC Registry] ✓ File Sync IPC registered (3 handlers)");
    } else {
      logger.warn("[IPC Registry] ⚠️ 数据库未初始化，跳过 File Sync IPC 注册");
    }

    // 配置管理 (函数模式 - 小模块，4 handlers)
    logger.info("[IPC Registry] Registering Config IPC...");
    const { registerConfigIPC } = require("../config/config-ipc");
    // getAppConfig 已在第145行声明，此处复用
    registerConfigIPC({ appConfig: getAppConfig() });
    logger.info("[IPC Registry] ✓ Config IPC registered (4 handlers)");

    // 分类管理 (函数模式 - 中等模块，7 handlers)
    if (database) {
      logger.info("[IPC Registry] Registering Category IPC...");
      const {
        registerCategoryIPCHandlers,
      } = require("../organization/category-ipc");
      registerCategoryIPCHandlers(database, mainWindow);
      logger.info("[IPC Registry] ✓ Category IPC registered (7 handlers)");
    }

    // System IPC already registered early (line 299-303)

    // ============================================================
    // 第九阶段模块 (工作流系统)
    // ============================================================

    // 工作流管道 (函数模式 - 中等模块，14 handlers)
    logger.info("[IPC Registry] Registering Workflow IPC...");
    try {
      const { registerWorkflowIPC } = require("../workflow/workflow-ipc");
      const { WorkflowManager } = require("../workflow/workflow-pipeline");
      const ProgressEmitter = require("../utils/progress-emitter");

      // 创建工作流管理器
      const progressEmitter = new ProgressEmitter({
        autoForwardToIPC: true,
        throttleInterval: 100,
      });

      if (mainWindow) {
        progressEmitter.setMainWindow(mainWindow);
      }

      const workflowManager = new WorkflowManager({
        progressEmitter,
        llmService: llmManager,
      });

      if (mainWindow) {
        workflowManager.setMainWindow(mainWindow);
      }

      // 保存到 app 实例以便后续使用
      if (app) {
        app.workflowManager = workflowManager;
        app.workflowProgressEmitter = progressEmitter;
      }

      const workflowIPC = registerWorkflowIPC({ workflowManager });
      if (workflowIPC) {
        registeredModules.workflowIPC = workflowIPC;
      }
      logger.info("[IPC Registry] ✓ Workflow IPC registered (14 handlers)");
    } catch (workflowError) {
      logger.error(
        "[IPC Registry] ❌ Workflow IPC registration failed:",
        workflowError.message,
      );
      logger.info(
        "[IPC Registry] ⚠️  Continuing with other IPC registrations...",
      );
    }

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 8 Complete: 20 modules migrated (176 handlers)!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 9: Cowork 多代理协作系统
    // ============================================================

    try {
      logger.info("[IPC Registry] Registering Cowork IPC...");
      const { registerCoworkIPC } = require("../ai-engine/cowork/cowork-ipc");
      registerCoworkIPC({
        database: database || null,
        mainWindow: mainWindow || null,
      });
      logger.info("[IPC Registry] ✓ Cowork IPC registered (44 handlers)");
      logger.info("[IPC Registry]   - TeammateTool: 15 handlers");
      logger.info("[IPC Registry]   - FileSandbox: 11 handlers");
      logger.info("[IPC Registry]   - LongRunningTaskManager: 9 handlers");
      logger.info("[IPC Registry]   - SkillRegistry: 5 handlers");
      logger.info("[IPC Registry]   - Utilities: 4 handlers");
    } catch (coworkError) {
      logger.error(
        "[IPC Registry] ❌ Cowork IPC registration failed:",
        coworkError.message,
      );
      logger.info(
        "[IPC Registry] ⚠️  Continuing without Cowork functionality...",
      );
    }

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Phase 9 Complete: Cowork system ready!");
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phase 10: Workflow Optimizations
    // ============================================================

    try {
      logger.info("[IPC Registry] Registering Workflow Optimizations IPC...");
      const {
        registerWorkflowOptimizationsIPC,
      } = require("./workflow-optimizations-ipc");
      registerWorkflowOptimizationsIPC({
        database: database || null,
        aiEngineManager: aiEngineManager || null,
      });
      logger.info(
        "[IPC Registry] ✓ Workflow Optimizations IPC registered (7 handlers)",
      );
      logger.info("[IPC Registry]   - Status & Statistics: 2 handlers");
      logger.info("[IPC Registry]   - Toggle & Configuration: 3 handlers");
      logger.info("[IPC Registry]   - Reports & Health: 2 handlers");
    } catch (workflowError) {
      logger.error(
        "[IPC Registry] ❌ Workflow Optimizations IPC registration failed:",
        workflowError.message,
      );
      logger.info(
        "[IPC Registry] ⚠️  Continuing without Workflow Optimizations dashboard...",
      );
    }

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 10 Complete: Workflow Optimizations ready!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // 注册统计
    // ============================================================

    const endTime = Date.now();
    const duration = endTime - startTime;

    // 标记IPC Registry为已注册
    ipcGuard.markModuleRegistered("ipc-registry");

    logger.info("[IPC Registry] ========================================");
    logger.info("[IPC Registry] Registration complete!");
    logger.info(
      `[IPC Registry] Registered modules: ${Object.keys(registeredModules).length}`,
    );
    logger.info(`[IPC Registry] Duration: ${duration}ms`);
    logger.info("[IPC Registry] ========================================");

    // 打印IPC Guard统计信息
    ipcGuard.printStats();

    return registeredModules;
  } catch (error) {
    logger.error("[IPC Registry] ❌ Registration failed:", error);
    throw error;
  }
}

/**
 * 注销所有 IPC 处理器（用于测试和热重载）
 * @param {Object} ipcMain - Electron ipcMain 实例
 */
function unregisterAllIPC(ipcMain) {
  logger.info("[IPC Registry] Unregistering all IPC handlers...");
  // 使用IPC Guard的resetAll功能
  ipcGuard.resetAll();
  logger.info("[IPC Registry] ✓ All IPC handlers unregistered");
}

module.exports = {
  registerAllIPC,
  unregisterAllIPC,
  ipcGuard, // 导出IPC Guard供外部使用
};
