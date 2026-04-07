/**
 * IPC 注册中心
 * 统一管理所有 IPC 模块的注册
 *
 * @module ipc-registry
 * @description 负责注册所有模块化的 IPC 处理器，实现主进程入口文件的解耦
 */

import { createRequire } from "module";
import { logger } from "../utils/logger.js";
import ipcGuard from "./ipc-guard.js";

const require = createRequire(import.meta.url);

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
 * 安全注册 IPC 模块的辅助函数
 *
 * 封装重复的 try/catch + 日志模式，每个 phase 从 ~25 行降到 ~10 行。
 *
 * @param {string} name - 模块显示名 (e.g., "Cowork IPC")
 * @param {Object} options
 * @param {Function} options.register - 实际注册逻辑（同步函数）
 * @param {number} [options.handlers] - handler 数量（用于日志）
 * @param {string[]} [options.subDetails] - 子模块详情列表（"TeammateTool: 15 handlers"）
 * @param {boolean} [options.fatal=false] - 失败时使用 error（true）还是 warn（false）
 * @param {string} [options.continueMessage] - 失败后的提示
 * @returns {boolean} 注册是否成功
 */
function safeRegister(name, options) {
  const {
    register,
    handlers,
    subDetails = [],
    fatal = false,
    continueMessage,
  } = options;
  try {
    logger.info(`[IPC Registry] Registering ${name}...`);
    register();
    const suffix = handlers != null ? ` (${handlers} handlers)` : "";
    logger.info(`[IPC Registry] ✓ ${name} registered${suffix}`);
    for (const detail of subDetails) {
      logger.info(`[IPC Registry]   - ${detail}`);
    }
    return true;
  } catch (err) {
    const level = fatal ? "error" : "warn";
    const icon = fatal ? "❌" : "⚠️ ";
    const tag = fatal ? "" : " (non-fatal)";
    logger[level](
      `[IPC Registry] ${icon} ${name} registration failed${tag}:`,
      err.message,
    );
    if (continueMessage) {
      logger.info(`[IPC Registry] ⚠️  ${continueMessage}`);
    }
    return false;
  }
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
    logger.warn(
      "[IPC Registry] ⚠️  IPC Registry already marked as initialized!",
    );
    logger.warn(
      "[IPC Registry] This may indicate a stale registration state. Clearing and re-registering...",
    );

    // 清除所有注册状态以便重新注册
    try {
      ipcGuard.resetAll();
      logger.info(
        "[IPC Registry] ✓ Registration state cleared, proceeding with fresh registration...",
      );
    } catch (e) {
      logger.error("[IPC Registry] ❌ Failed to clear registration state:", e);
      // 继续执行，不要返回
    }
  }

  try {
    // 解构所有依赖（便于后续传递给各个模块）
    // 注意：部分依赖在此文件中未使用，但保留用于保持兼容性
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
      // skillManager, // Kept in dependencies for future use
      // toolManager, // Kept in dependencies for future use
      imageUploader,
      fileImporter,
      templateManager,
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
      // projectStructureManager, // Kept for future use
      // pluginManager, // Kept for future use
      // webideManager, // Kept for future use
      // statsCollector, // Kept for future use
      fileSyncManager,
      // previewManager, // Kept for future use
      markdownExporter,
      // nativeMessagingServer, // Kept for future use
      gitAutoCommit,
      // skillExecutor, // Kept for future use
      // aiScheduler, // Kept for future use
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
    // 第一阶段模块 (AI 相关) — extracted to phases/phase-1-ai.js
    // ============================================================
    let hookSystem = null;
    {
      const { registerPhase1AI } = require("./phases/phase-1-ai");
      const phase1Result = registerPhase1AI({
        safeRegister,
        logger,
        deps: dependencies,
      });
      hookSystem = phase1Result.hookSystem;
    }

    // ============================================================
    // Phase 2 + Critical Early IPC — extracted to phases/phase-2-core.js
    // ============================================================
    {
      const { registerPhase2Core } = require("./phases/phase-2-core");
      registerPhase2Core({
        safeRegister,
        logger,
        deps: dependencies,
      });
    }

    // ============================================================
    // Phase 3+4: Social Network + Enterprise (DID/P2P/Social/VC/Org)
    // Extracted to ./phases/phase-3-4-social.js
    // ============================================================
    {
      const { registerPhases3to4Social } = require("./phases/phase-3-4-social");
      registerPhases3to4Social({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phase 5: Project Management Suite
    // Extracted to ./phases/phase-5-project.js
    // ============================================================
    {
      const { registerPhase5Project } = require("./phases/phase-5-project");
      registerPhase5Project({
        safeRegister,
        logger,
        deps: {
          ...dependencies,
          app,
          mainWindow,
          mcpClientManager,
          mcpToolAdapter,
          removeUndefinedValues,
          _replaceUndefinedWithNull,
        },
        registeredModules,
      });
    }

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

    // Office 文件操作 (类模式 - Office 文件处理)
    safeRegister("Office File IPC", {
      register: () => {
        const FileIPC = require("../ipc/file-ipc");
        const fileIPC = new FileIPC();
        fileIPC.registerHandlers(mainWindow);
      },
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 模板管理 (函数模式 - 大模块，20 handlers)
    safeRegister("Template IPC", {
      register: () => {
        const { registerTemplateIPC } = require("../template/template-ipc");
        registerTemplateIPC({
          templateManager: templateManager || null,
        });
        if (!templateManager) {
          logger.warn(
            "[IPC Registry] ⚠ templateManager not initialized, Template IPC running in degraded mode",
          );
        }
      },
      handlers: 20,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

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
      safeRegister("Speech IPC", {
        register: () => {
          const { registerSpeechIPC } = require("../speech/speech-ipc");
          const initializeSpeechManager = app.initializeSpeechManager.bind(app);
          registerSpeechIPC({
            initializeSpeechManager,
          });
        },
        handlers: 34,
        fatal: true,
        continueMessage: "Continuing with other IPC registrations...",
      });
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

    safeRegister("Sync IPC", {
      register: () => {
        if (!syncManager) {
          logger.warn(
            "[IPC Registry] ⚠️ syncManager 未初始化，将注册降级的 Sync IPC handlers",
          );
        }
        const { registerSyncIPC } = require("../sync/sync-ipc");
        registerSyncIPC({ syncManager: syncManager || null });
      },
      handlers: 4,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // Notification IPC already registered early (line 305-311)

    // Preference Manager IPC
    safeRegister("Preference Manager IPC", {
      register: () => {
        const preferenceManager = app ? app.preferenceManager || null : null;
        if (preferenceManager) {
          const {
            registerPreferenceManagerIPC,
          } = require("../memory/preference-manager-ipc");
          registerPreferenceManagerIPC({ preferenceManager });
        } else {
          logger.warn(
            "[IPC Registry] ⚠️ preferenceManager 未初始化，跳过 Preference IPC 注册",
          );
        }
      },
      handlers: 12,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    // 对话管理 (函数模式 - 中等模块，17 handlers)
    // 注意：即使 database 为 null 也注册，handler 内部会处理 null 情况
    // 🔥 v2.0: 整合高级特性（SessionManager, Manus, Multi-Agent, RAG等）
    safeRegister("Conversation IPC", {
      register: () => {
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
        logger.info("[IPC Registry] Conversation advanced features:", {
          sessionManager: !!sessionManager,
          agentOrchestrator: !!agentOrchestrator,
          ragManager: !!ragManager,
          promptCompressor: !!promptCompressor,
          tokenTracker: !!tokenTracker,
        });
      },
      handlers: 17,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
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
    const {
      getAppConfig: getConfigForIPC,
    } = require("../config/database-config");
    registerConfigIPC({ appConfig: getConfigForIPC() });
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
    safeRegister("Workflow IPC", {
      register: () => {
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
      },
      handlers: 14,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });

    logger.info("[IPC Registry] ========================================");
    logger.info(
      "[IPC Registry] Phase 8 Complete: 20 modules migrated (176 handlers)!",
    );
    logger.info("[IPC Registry] ========================================");

    // ============================================================
    // Phases 9-15: Cowork/Workflow/Audit/Marketplace/Agents/SSO/UnifiedTools
    // Extracted to ./phases/phase-9-15-core.js
    // ============================================================
    {
      const { registerPhases9to15 } = require("./phases/phase-9-15-core");
      registerPhases9to15({
        safeRegister,
        logger,
        deps: {
          ...dependencies,
          app,
          mainWindow,
          aiEngineManager,
          llmManager,
          mcpToolAdapter,
        },
        registeredModules,
      });
    }

    // ============================================================
    // Phases 16-20: Skill Pipeline/Instinct/Cowork v2/ML Sched/Self-Evolution
    // Extracted to ./phases/phase-16-20-skill-evo.js
    // ============================================================
    {
      const {
        registerPhases16to20,
      } = require("./phases/phase-16-20-skill-evo");
      registerPhases16to20({
        safeRegister,
        logger,
        deps: { ...dependencies, database, hookSystem },
        registeredModules,
      });
    }
    // ============================================================
    // Phases 21-30: Enterprise Edition + Multimodal/Skill/Trading/DeFi/Crypto
    // Extracted to ./phases/phase-21-30-enterprise.js
    // ============================================================
    {
      const {
        registerPhases21to30,
      } = require("./phases/phase-21-30-enterprise");
      registerPhases21to30({
        safeRegister,
        logger,
        deps: { ...dependencies, app, mainWindow },
        registeredModules,
      });
    }

    // ============================================================
    // Phase 31: AI Models — 7 Advanced Features (v1.1.0)
    // Extracted to ./phases/phase-31-ai-models.js
    // ============================================================
    {
      const { registerPhase31 } = require("./phases/phase-31-ai-models");
      registerPhase31({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phases 33-40: Git P2P/Collab/Pipeline/Ops/NL/Multimodal/Network
    // Extracted to ./phases/phase-33-40-collab-ops.js
    // ============================================================
    {
      const {
        registerPhases33to40,
      } = require("./phases/phase-33-40-collab-ops");
      registerPhases33to40({
        safeRegister,
        logger,
        deps: { ...dependencies, app },
        registeredModules,
      });
    }

    // ============================================================
    // Phase 41: EvoMap GEP Protocol Integration (v1.0.0)
    // Extracted to ./phases/phase-41-evomap-gep.js
    // ============================================================
    {
      const { registerPhase41 } = require("./phases/phase-41-evomap-gep");
      registerPhase41({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phases 42-50 (v1.1.0): Social, Compliance, Identity, U-Key, DLP
    // Extracted to ./phases/phase-42-50-v1-1.js
    // ============================================================
    {
      const { registerPhases42to50 } = require("./phases/phase-42-50-v1-1");
      registerPhases42to50({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phases 51-57 (v1.1.0): SIEM, PQC, Firmware OTA, Governance,
    // Matrix, Terraform, Production Hardening
    // Extracted to ./phases/phase-51-57-v1-1.js
    // ============================================================
    {
      const { registerPhases51to57 } = require("./phases/phase-51-57-v1-1");
      registerPhases51to57({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phases 58-77 (v1.1.0 - v3.4.0): Federation, Reputation, SLA,
    // Tech Learning, Autonomous Dev, Skill Service, Token, Inference,
    // Trust Root, PQC Ecosystem, Satellite, HSM, Protocol Fusion,
    // AI Social, Decentralized Storage, Anti-Censorship, EvoMap.
    // Extracted to ./phases/phase-58-77-v2-v3.js
    // ============================================================
    {
      const { registerPhases58to77 } = require("./phases/phase-58-77-v2-v3");
      registerPhases58to77({
        safeRegister,
        logger,
        deps: dependencies,
        registeredModules,
      });
    }

    // ============================================================
    // Phase 4 (2027 Q1): WebAuthn, ZKP, FL, IPFS Cluster, GraphQL API
    // Extracted to ./phases/phase-q1-2027.js
    // ============================================================
    {
      const { registerPhaseQ12027 } = require("./phases/phase-q1-2027");
      registerPhaseQ12027({
        safeRegister,
        logger,
        deps: dependencies,
      });
    }

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
 * @param {Object} ipcMain - Electron ipcMain 实例 (not used in this implementation)
 */
function unregisterAllIPC() {
  logger.info("[IPC Registry] Unregistering all IPC handlers...");
  // 使用IPC Guard的resetAll功能
  ipcGuard.resetAll();
  logger.info("[IPC Registry] ✓ All IPC handlers unregistered");
}

export {
  registerAllIPC,
  unregisterAllIPC,
  ipcGuard, // 导出IPC Guard供外部使用
};
