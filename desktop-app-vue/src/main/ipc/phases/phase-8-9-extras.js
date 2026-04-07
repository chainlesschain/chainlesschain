/**
 * Phase 8 + Phase 9: misc modules and the workflow pipeline.
 *
 * Phase 8 — Blockchain (lazy), Code Tools, Review, Collaboration,
 * VC Template, Automation, Knowledge Graph, Credit, Plugin (lazy),
 * Import, Sync, Preference, Conversation, File Sync, Config, Category.
 *
 * Phase 9 — Workflow pipeline (creates WorkflowManager + ProgressEmitter
 * and stashes them on app + registeredModules).
 *
 * All registrations now go through safeRegister so they share consistent
 * try/catch error handling and so the contract test can stub safeRegister
 * without running into Electron dependencies. The original ipc-registry.js
 * had several inline registrations; wrapping them in safeRegister is a
 * strict improvement (adds error isolation, no behavior change).
 *
 * Re-derives the advanced LLM-feature managers (sessionManager,
 * agentOrchestrator, promptCompressor, responseCache, tokenTracker,
 * errorMonitor) from `app` so the Conversation IPC closure has them
 * in scope (they used to be locally declared at the top of registerAllIPC
 * before the H2 split moved them into phase-1-ai.js).
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhases8to9Extras({
  safeRegister,
  logger,
  deps,
  registeredModules,
}) {
  const {
    app,
    database,
    mainWindow,
    llmManager,
    ragManager,
    reviewManager,
    vcTemplateManager,
    creditScoreManager,
    fileImporter,
    syncManager,
    fileSyncManager,
  } = deps;

  // Re-derive advanced LLM features from app (formerly locally scoped
  // alongside Phase 1; the Conversation IPC closure still needs them).
  const sessionManager = app ? app.sessionManager || null : null;
  const agentOrchestrator = app ? app.agentOrchestrator || null : null;
  const promptCompressor = app ? app.promptCompressor || null : null;
  const responseCache = app ? app.responseCache || null : null;
  const tokenTracker = app ? app.tokenTracker || null : null;
  const errorMonitor = app ? app.errorMonitor || null : null;

  // ============================================================
  // 第八阶段模块 (新增模块 - 区块链、代码工具、知识图谱等)
  // ============================================================

  // 区块链核心 (7个模块, 75 handlers) - 懒加载模式
  safeRegister("Blockchain IPC (Lazy)", {
    register: () => {
      const {
        registerLazyBlockchainIPC,
      } = require("../../blockchain/blockchain-lazy-ipc");
      registerLazyBlockchainIPC({ app, database, mainWindow });
    },
    handlers: 75,
    continueMessage: "Blockchain features will be unavailable",
  });

  // 代码工具 (2个模块, 20 handlers)
  if (llmManager) {
    safeRegister("Code Tools IPC", {
      register: () => {
        const { registerCodeIPC } = require("../../code-tools/code-ipc");
        registerCodeIPC({ llmManager });
      },
      handlers: 10,
    });
  }

  if (reviewManager) {
    safeRegister("Review System IPC", {
      register: () => {
        const { registerReviewIPC } = require("../../code-tools/review-ipc");
        registerReviewIPC({ reviewManager });
      },
      handlers: 10,
    });
  }

  // 企业协作 (3个模块, 28 handlers)
  safeRegister("Collaboration IPC", {
    register: () => {
      const {
        registerCollaborationIPC,
      } = require("../../collaboration/collaboration-ipc");
      registerCollaborationIPC();
    },
    handlers: 8,
  });

  if (vcTemplateManager) {
    safeRegister("VC Template IPC", {
      register: () => {
        const {
          registerVCTemplateIPC,
        } = require("../../vc-template/vc-template-ipc");
        registerVCTemplateIPC(vcTemplateManager);
      },
      handlers: 11,
    });
  }

  safeRegister("Automation IPC", {
    register: () => {
      const {
        registerAutomationIPC,
      } = require("../../automation/automation-ipc");
      registerAutomationIPC();
    },
    handlers: 9,
  });

  // 知识图谱与信用 (2个模块, 18 handlers)
  if (database || (app && app.graphExtractor)) {
    safeRegister("Knowledge Graph IPC", {
      register: () => {
        const { registerGraphIPC } = require("../../knowledge-graph/graph-ipc");
        registerGraphIPC({
          database,
          graphExtractor: app && app.graphExtractor,
          llmManager,
        });
      },
      handlers: 11,
    });
  }

  if (creditScoreManager) {
    safeRegister("Credit Score IPC", {
      register: () => {
        const { registerCreditIPC } = require("../../credit/credit-ipc");
        registerCreditIPC({ creditScoreManager });
      },
      handlers: 7,
    });
  }

  // 插件系统 - 懒加载模式
  safeRegister("Plugin IPC (Lazy)", {
    register: () => {
      const {
        registerLazyPluginIPC,
      } = require("../../plugins/plugin-lazy-ipc");
      registerLazyPluginIPC({ app, mainWindow });
    },
    continueMessage: "Plugin features will be unavailable",
  });

  // 其他功能 (3个模块, 13 handlers)
  if (fileImporter) {
    safeRegister("Import IPC", {
      register: () => {
        const { registerImportIPC } = require("../../import/import-ipc");
        registerImportIPC({
          fileImporter,
          mainWindow,
          database,
          ragManager,
        });
      },
      handlers: 5,
    });
  }

  safeRegister("Sync IPC", {
    register: () => {
      if (!syncManager) {
        logger.warn(
          "[IPC Registry] ⚠️ syncManager 未初始化，将注册降级的 Sync IPC handlers",
        );
      }
      const { registerSyncIPC } = require("../../sync/sync-ipc");
      registerSyncIPC({ syncManager: syncManager || null });
    },
    handlers: 4,
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // Notification IPC already registered early (phase-2-core)

  // Preference Manager IPC
  safeRegister("Preference Manager IPC", {
    register: () => {
      const preferenceManager = app ? app.preferenceManager || null : null;
      if (preferenceManager) {
        const {
          registerPreferenceManagerIPC,
        } = require("../../memory/preference-manager-ipc");
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
  // 🔥 v2.0: 整合高级特性（SessionManager, Manus, Multi-Agent, RAG等）
  safeRegister("Conversation IPC", {
    register: () => {
      const {
        registerConversationIPC,
      } = require("../../conversation/conversation-ipc");
      registerConversationIPC({
        database: database || null,
        llmManager: llmManager || null,
        mainWindow: mainWindow || null,
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
    safeRegister("File Sync IPC", {
      register: () => {
        if (!fileSyncManager) {
          logger.warn(
            "[IPC Registry] ⚠️ fileSyncManager 未初始化，将注册降级的 File Sync IPC handlers",
          );
        }
        const {
          registerFileSyncIPC,
        } = require("../../file-sync/file-sync-ipc");
        registerFileSyncIPC({
          fileSyncManager: fileSyncManager || null,
          database,
        });
      },
      handlers: 3,
    });
  } else {
    logger.warn("[IPC Registry] ⚠️ 数据库未初始化，跳过 File Sync IPC 注册");
  }

  // 配置管理 (函数模式 - 小模块，4 handlers)
  safeRegister("Config IPC", {
    register: () => {
      const { registerConfigIPC } = require("../../config/config-ipc");
      const {
        getAppConfig: getConfigForIPC,
      } = require("../../config/database-config");
      registerConfigIPC({ appConfig: getConfigForIPC() });
    },
    handlers: 4,
  });

  // 分类管理 (函数模式 - 中等模块，7 handlers)
  if (database) {
    safeRegister("Category IPC", {
      register: () => {
        const {
          registerCategoryIPCHandlers,
        } = require("../../organization/category-ipc");
        registerCategoryIPCHandlers(database, mainWindow);
      },
      handlers: 7,
    });
  }

  // System IPC already registered early (phase-2-core)

  // ============================================================
  // 第九阶段模块 (工作流系统)
  // ============================================================

  // 工作流管道 (函数模式 - 中等模块，14 handlers)
  safeRegister("Workflow IPC", {
    register: () => {
      const { registerWorkflowIPC } = require("../../workflow/workflow-ipc");
      const { WorkflowManager } = require("../../workflow/workflow-pipeline");
      const ProgressEmitter = require("../../utils/progress-emitter");

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

      if (app) {
        app.workflowManager = workflowManager;
        app.workflowProgressEmitter = progressEmitter;
      }

      const workflowIPC = registerWorkflowIPC({ workflowManager });
      if (workflowIPC && registeredModules) {
        registeredModules.workflowIPC = workflowIPC;
      }
    },
    handlers: 14,
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 8+9 Complete: 21 modules migrated (190 handlers)!",
  );
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhases8to9Extras };
