/**
 * IPC 注册中心
 * 统一管理所有 IPC 模块的注册
 *
 * @module ipc-registry
 * @description 负责注册所有模块化的 IPC 处理器，实现主进程入口文件的解耦
 */

const ipcGuard = require("./ipc-guard");

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
  console.log("[IPC Registry] ========================================");
  console.log("[IPC Registry] Starting modular IPC registration...");
  console.log("[IPC Registry] ========================================");

  const startTime = Date.now();
  const registeredModules = {};

  // 检查是否已经注册过（防止重复注册）
  if (ipcGuard.isModuleRegistered("ipc-registry")) {
    console.log(
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
    console.log("[IPC Registry] Registering LLM IPC...");
    const { registerLLMIPC } = require("./llm/llm-ipc");

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

    // 🔥 获取高级特性依赖（SessionManager, ErrorMonitor, Multi-Agent）
    const sessionManager = app ? app.sessionManager || null : null;
    const errorMonitor = app ? app.errorMonitor || null : null;
    const agentOrchestrator = app ? app.agentOrchestrator || null : null;

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
      console.log(
        "[IPC Registry] ⚠️  LLM manager not initialized (handlers registered with degraded functionality)",
      );
    }
    console.log("[IPC Registry] ✓ LLM IPC registered (14 handlers)");

    // RAG 检索 (函数模式 - 小模块示范，7 handlers)
    if (ragManager) {
      console.log("[IPC Registry] Registering RAG IPC...");
      const { registerRAGIPC } = require("./rag/rag-ipc");
      registerRAGIPC({ ragManager, llmManager });
      console.log("[IPC Registry] ✓ RAG IPC registered (7 handlers)");
    }

    // 后续输入意图分类器 (Follow-up Intent Classifier，3 handlers)
    console.log(
      "[IPC Registry] Registering Follow-up Intent Classifier IPC...",
    );
    const {
      registerIPCHandlers: registerFollowupIntentIPC,
    } = require("./ai-engine/followup-intent-ipc");
    registerFollowupIntentIPC(llmManager);
    console.log(
      "[IPC Registry] ✓ Follow-up Intent Classifier IPC registered (3 handlers)",
    );

    // 联网搜索工具 (Web Search，4 handlers)
    console.log("[IPC Registry] Registering Web Search IPC...");
    const { registerWebSearchIPC } = require("./utils/web-search-ipc");
    registerWebSearchIPC();
    console.log("[IPC Registry] ✓ Web Search IPC registered (4 handlers)");

    // ============================================================
    // 第二阶段模块 (核心功能)
    // ============================================================

    // U-Key 硬件管理 (函数模式 - 小模块，9 handlers)
    // 注意：即使 ukeyManager 为 null 也注册，handler 内部会处理 null 情况
    console.log("[IPC Registry] Registering U-Key IPC...");
    const { registerUKeyIPC } = require("./ukey/ukey-ipc");
    registerUKeyIPC({ ukeyManager });
    if (!ukeyManager) {
      console.log(
        "[IPC Registry] ⚠️  U-Key manager not initialized (handlers registered with degraded functionality)",
      );
    }
    console.log("[IPC Registry] ✓ U-Key IPC registered (9 handlers)");

    // 数据库管理 (函数模式 - 中等模块，22 handlers)
    // 注意：即使 database 为 null 也注册，handler 内部会处理 null 情况
    console.log("[IPC Registry] Registering Database IPC...");
    const { registerDatabaseIPC } = require("./database/database-ipc");

    // 获取 getAppConfig 函数
    const { getAppConfig } = require("./app-config");

    registerDatabaseIPC({
      database,
      ragManager,
      getAppConfig,
    });
    if (!database) {
      console.log(
        "[IPC Registry] ⚠️  Database manager not initialized (handlers registered with degraded functionality)",
      );
    }
    console.log("[IPC Registry] ✓ Database IPC registered (22 handlers)");

    // Git 版本控制 (函数模式 - 中等模块，16 handlers)
    // 注意：即使 gitManager 为 null 也注册 IPC，让 handler 内部处理
    console.log("[IPC Registry] Registering Git IPC...");
    const { registerGitIPC } = require("./git/git-ipc");

    // 获取 getGitConfig 函数
    const { getGitConfig } = require("./git/git-config");

    registerGitIPC({
      gitManager,
      markdownExporter,
      getGitConfig,
      llmManager,
      gitHotReload,
      mainWindow,
    });
    console.log("[IPC Registry] ✓ Git IPC registered (22 handlers)");
    if (!gitManager) {
      console.log(
        "[IPC Registry] ⚠️  Git manager not initialized (Git sync disabled in config)",
      );
    }
    if (gitHotReload) {
      console.log("[IPC Registry] ✓ Git Hot Reload enabled");
    }

    // ============================================================
    // 第三阶段模块 (社交网络 - DID, P2P, Social)
    // ============================================================

    // DID 身份管理 (函数模式 - 中等模块，24 handlers)
    if (didManager) {
      console.log("[IPC Registry] Registering DID IPC...");
      const { registerDIDIPC } = require("./did/did-ipc");
      registerDIDIPC({ didManager });
      console.log("[IPC Registry] ✓ DID IPC registered (24 handlers)");
    }

    // P2P 网络通信 (函数模式 - 中等模块，18 handlers)
    if (p2pManager) {
      console.log("[IPC Registry] Registering P2P IPC...");
      const { registerP2PIPC } = require("./p2p/p2p-ipc");
      registerP2PIPC({ p2pManager });
      console.log("[IPC Registry] ✓ P2P IPC registered (18 handlers)");
    }

    // 社交网络 (函数模式 - 大模块，33 handlers: contact + friend + post + chat)
    if (contactManager || friendManager || postManager || database) {
      console.log("[IPC Registry] Registering Social IPC...");
      const { registerSocialIPC } = require("./social/social-ipc");
      registerSocialIPC({
        contactManager,
        friendManager,
        postManager,
        database,
      });
      console.log("[IPC Registry] ✓ Social IPC registered (33 handlers)");
    }

    // ============================================================
    // 第四阶段模块 (企业版 - VC, Organization, Identity Context)
    // ============================================================

    // 可验证凭证 (函数模式 - 小模块，10 handlers)
    if (vcManager) {
      console.log("[IPC Registry] Registering VC IPC...");
      const { registerVCIPC } = require("./vc/vc-ipc");
      registerVCIPC({ vcManager });
      console.log("[IPC Registry] ✓ VC IPC registered (10 handlers)");
    }

    // 身份上下文 (函数模式 - 小模块，7 handlers)
    if (identityContextManager) {
      console.log("[IPC Registry] Registering Identity Context IPC...");
      const {
        registerIdentityContextIPC,
      } = require("./identity-context/identity-context-ipc");
      registerIdentityContextIPC({ identityContextManager });
      console.log(
        "[IPC Registry] ✓ Identity Context IPC registered (7 handlers)",
      );
    }

    // 组织管理 (函数模式 - 大模块，32 handlers)
    if (organizationManager || dbManager) {
      console.log("[IPC Registry] Registering Organization IPC...");
      const {
        registerOrganizationIPC,
      } = require("./organization/organization-ipc");
      registerOrganizationIPC({
        organizationManager,
        dbManager,
        versionManager,
      });
      console.log("[IPC Registry] ✓ Organization IPC registered (32 handlers)");
    }

    // 企业版仪表板 (函数模式 - 中模块，10 handlers)
    if (database) {
      console.log("[IPC Registry] Registering Dashboard IPC...");
      const { registerDashboardIPC } = require("./organization/dashboard-ipc");
      registerDashboardIPC({
        database,
        organizationManager,
      });
      console.log("[IPC Registry] ✓ Dashboard IPC registered (10 handlers)");
    }

    // ============================================================
    // 第五阶段模块 (项目管理 - 最大模块组，分为多个子模块)
    // ============================================================

    // 项目核心管理 (函数模式 - 大模块，34 handlers)
    if (database) {
      console.log("[IPC Registry] Registering Project Core IPC...");
      const { registerProjectCoreIPC } = require("./project/project-core-ipc");
      registerProjectCoreIPC({
        database,
        fileSyncManager,
        removeUndefinedValues: app.removeUndefinedValues?.bind(app),
        _replaceUndefinedWithNull: app._replaceUndefinedWithNull?.bind(app),
      });
      console.log("[IPC Registry] ✓ Project Core IPC registered (34 handlers)");
    }

    // 项目AI功能 (函数模式 - 中等模块，16 handlers)
    if (database && llmManager) {
      console.log("[IPC Registry] Registering Project AI IPC...");
      const { registerProjectAIIPC } = require("./project/project-ai-ipc");
      registerProjectAIIPC({
        database,
        llmManager,
        aiEngineManager,
        chatSkillBridge,
        mainWindow,
        scanAndRegisterProjectFiles: app.scanAndRegisterProjectFiles?.bind(app),
      });
      console.log("[IPC Registry] ✓ Project AI IPC registered (16 handlers)");
    }

    // 项目导出分享 (函数模式 - 大模块，17 handlers)
    if (database || llmManager) {
      console.log("[IPC Registry] Registering Project Export/Share IPC...");
      const {
        registerProjectExportIPC,
      } = require("./project/project-export-ipc");

      // 获取必要的依赖函数
      const { getDatabaseConnection, saveDatabase } = require("./database");
      const { getProjectConfig } = require("./project/project-config");
      const { copyDirectory } = require("./utils/file-utils");

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
      console.log(
        "[IPC Registry] ✓ Project Export/Share IPC registered (17 handlers)",
      );
    }

    // 项目RAG检索 (函数模式 - 中等模块，10 handlers)
    console.log("[IPC Registry] Registering Project RAG IPC...");
    const { registerProjectRAGIPC } = require("./project/project-rag-ipc");

    // 获取必要的依赖函数
    const { getProjectRAGManager } = require("./project/project-rag");
    const {
      getProjectConfig: getRagProjectConfig,
    } = require("./project/project-config");
    const RAGAPI = require("./project/rag-api");

    registerProjectRAGIPC({
      getProjectRAGManager,
      getProjectConfig: getRagProjectConfig,
      RAGAPI,
    });
    console.log("[IPC Registry] ✓ Project RAG IPC registered (10 handlers)");

    // 项目Git集成 (函数模式 - 大模块，14 handlers)
    console.log("[IPC Registry] Registering Project Git IPC...");
    const { registerProjectGitIPC } = require("./project/project-git-ipc");

    // 获取必要的依赖函数
    const {
      getProjectConfig: getGitProjectConfig,
    } = require("./project/project-config");
    const GitAPI = require("./project/git-api");

    registerProjectGitIPC({
      getProjectConfig: getGitProjectConfig,
      GitAPI,
      gitManager,
      fileSyncManager,
      mainWindow,
    });
    console.log("[IPC Registry] ✓ Project Git IPC registered (14 handlers)");

    console.log("[IPC Registry] ========================================");
    console.log(
      "[IPC Registry] Phase 5 Complete: All 91 project: handlers migrated!",
    );
    console.log("[IPC Registry] ========================================");

    // ============================================================
    // 第六阶段模块 (核心功能 - File, Template, Knowledge, Prompt, Image)
    // ============================================================

    // 文件操作 (函数模式 - 中等模块，17 handlers)
    if (database) {
      console.log("[IPC Registry] Registering File IPC...");
      const { registerFileIPC } = require("./file/file-ipc");
      const { getProjectConfig } = require("./project/project-config");

      registerFileIPC({
        database,
        mainWindow,
        getProjectConfig,
      });
      console.log("[IPC Registry] ✓ File IPC registered (17 handlers)");
    }

    // 模板管理 (函数模式 - 大模块，20 handlers)
    console.log("[IPC Registry] Registering Template IPC...");
    const { registerTemplateIPC } = require("./template/template-ipc");

    registerTemplateIPC({
      templateManager: app.templateManager,
    });
    console.log("[IPC Registry] ✓ Template IPC registered (20 handlers)");

    // 知识管理 (函数模式 - 中等模块，17 handlers)
    if (dbManager || versionManager || knowledgePaymentManager) {
      console.log("[IPC Registry] Registering Knowledge IPC...");
      const { registerKnowledgeIPC } = require("./knowledge/knowledge-ipc");

      registerKnowledgeIPC({
        dbManager,
        versionManager,
        knowledgePaymentManager,
      });
      console.log("[IPC Registry] ✓ Knowledge IPC registered (17 handlers)");
    }

    // 提示词模板 (函数模式 - 小模块，11 handlers)
    if (promptTemplateManager) {
      console.log("[IPC Registry] Registering Prompt Template IPC...");
      const {
        registerPromptTemplateIPC,
      } = require("./prompt-template/prompt-template-ipc");

      registerPromptTemplateIPC({
        promptTemplateManager,
      });
      console.log(
        "[IPC Registry] ✓ Prompt Template IPC registered (11 handlers)",
      );
    }

    // 图像管理 (函数模式 - 大模块，22 handlers)
    if (imageUploader) {
      console.log("[IPC Registry] Registering Image IPC...");
      const { registerImageIPC } = require("./image/image-ipc");

      registerImageIPC({
        imageUploader,
        llmManager,
        mainWindow,
      });
      console.log("[IPC Registry] ✓ Image IPC registered (22 handlers)");
    }

    console.log("[IPC Registry] ========================================");
    console.log(
      "[IPC Registry] Phase 6 Complete: 5 modules migrated (87 handlers)!",
    );
    console.log("[IPC Registry] ========================================");

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
        console.log("[IPC Registry] Registering Speech IPC...");
        const { registerSpeechIPC } = require("./speech/speech-ipc");

        // 获取 initializeSpeechManager 函数
        const initializeSpeechManager = app.initializeSpeechManager.bind(app);

        registerSpeechIPC({
          initializeSpeechManager,
        });
        console.log("[IPC Registry] ✓ Speech IPC registered (34 handlers)");
      } catch (speechError) {
        console.error(
          "[IPC Registry] ❌ Speech IPC registration failed:",
          speechError.message,
        );
        console.log(
          "[IPC Registry] ⚠️  Continuing with other IPC registrations...",
        );
      }
    } else {
      console.log(
        "[IPC Registry] ⚠️  Speech IPC skipped (initializeSpeechManager not available)",
      );
    }

    // 视频处理 (函数模式 - 大模块，18 handlers)
    if (app.videoImporter) {
      console.log("[IPC Registry] Registering Video IPC...");
      const { registerVideoIPC } = require("./video/video-ipc");

      registerVideoIPC({
        videoImporter: app.videoImporter,
        mainWindow,
        llmManager,
      });
      console.log("[IPC Registry] ✓ Video IPC registered (18 handlers)");
    }

    // PDF 处理 (函数模式 - 小模块，4 handlers)
    console.log("[IPC Registry] Registering PDF IPC...");
    const { registerPDFIPC } = require("./pdf/pdf-ipc");

    // 获取 getPDFEngine 函数
    const { getPDFEngine } = require("./engines/pdf-engine");

    registerPDFIPC({
      getPDFEngine,
    });
    console.log("[IPC Registry] ✓ PDF IPC registered (4 handlers)");

    // 文档处理 (函数模式 - 小模块，1 handler)
    console.log("[IPC Registry] Registering Document IPC...");
    const { registerDocumentIPC } = require("./document/document-ipc");

    registerDocumentIPC({
      convertSlidesToOutline: app.convertSlidesToOutline.bind(app),
    });
    console.log("[IPC Registry] ✓ Document IPC registered (1 handler)");

    console.log("[IPC Registry] ========================================");
    console.log(
      "[IPC Registry] Phase 7 Complete: 4 modules migrated (57 handlers)!",
    );
    console.log("[IPC Registry] ========================================");

    // ============================================================
    // 第八阶段模块 (新增模块 - 区块链、代码工具、知识图谱等)
    // ============================================================

    // 区块链核心 (7个模块, 75 handlers)
    if (app.walletManager) {
      console.log("[IPC Registry] Registering Blockchain Wallet IPC...");
      const { registerWalletIPC } = require("./blockchain/wallet-ipc");
      registerWalletIPC({
        walletManager: app.walletManager,
        externalWalletConnector: app.externalWalletConnector,
      });
      console.log(
        "[IPC Registry] ✓ Blockchain Wallet IPC registered (15 handlers)",
      );
    }

    if (app.contractEngine) {
      console.log("[IPC Registry] Registering Smart Contract IPC...");
      const { registerContractIPC } = require("./blockchain/contract-ipc");
      registerContractIPC({ contractEngine: app.contractEngine });
      console.log(
        "[IPC Registry] ✓ Smart Contract IPC registered (15 handlers)",
      );
    }

    if (app.blockchainAdapter || app.transactionMonitor) {
      console.log("[IPC Registry] Registering Blockchain IPC...");
      const { registerBlockchainIPC } = require("./blockchain/blockchain-ipc");
      registerBlockchainIPC({
        blockchainAdapter: app.blockchainAdapter,
        transactionMonitor: app.transactionMonitor,
        database,
        mainWindow,
      });
      console.log("[IPC Registry] ✓ Blockchain IPC registered (14 handlers)");
    }

    if (app.assetManager) {
      console.log("[IPC Registry] Registering Asset IPC...");
      const { registerAssetIPC } = require("./blockchain/asset-ipc");
      registerAssetIPC({ assetManager: app.assetManager });
      console.log("[IPC Registry] ✓ Asset IPC registered (10 handlers)");
    }

    if (app.marketplaceManager) {
      console.log("[IPC Registry] Registering Marketplace IPC...");
      const {
        registerMarketplaceIPC,
      } = require("./blockchain/marketplace-ipc");
      registerMarketplaceIPC({ marketplaceManager: app.marketplaceManager });
      console.log("[IPC Registry] ✓ Marketplace IPC registered (9 handlers)");
    }

    if (app.bridgeManager) {
      console.log("[IPC Registry] Registering Bridge IPC...");
      const { registerBridgeIPC } = require("./blockchain/bridge-ipc");
      registerBridgeIPC(app.bridgeManager);
      console.log("[IPC Registry] ✓ Bridge IPC registered (7 handlers)");
    }

    if (app.escrowManager) {
      console.log("[IPC Registry] Registering Escrow IPC...");
      const { registerEscrowIPC } = require("./blockchain/escrow-ipc");
      registerEscrowIPC(app.escrowManager);
      console.log("[IPC Registry] ✓ Escrow IPC registered (5 handlers)");
    }

    // 代码工具 (2个模块, 20 handlers)
    if (llmManager) {
      console.log("[IPC Registry] Registering Code Tools IPC...");
      const { registerCodeIPC } = require("./code-tools/code-ipc");
      registerCodeIPC({ llmManager });
      console.log("[IPC Registry] ✓ Code Tools IPC registered (10 handlers)");
    }

    if (reviewManager) {
      console.log("[IPC Registry] Registering Review System IPC...");
      const { registerReviewIPC } = require("./code-tools/review-ipc");
      registerReviewIPC({ reviewManager });
      console.log(
        "[IPC Registry] ✓ Review System IPC registered (10 handlers)",
      );
    }

    // 企业协作 (3个模块, 28 handlers)
    console.log("[IPC Registry] Registering Collaboration IPC...");
    const {
      registerCollaborationIPC,
    } = require("./collaboration/collaboration-ipc");
    registerCollaborationIPC();
    console.log("[IPC Registry] ✓ Collaboration IPC registered (8 handlers)");

    if (vcTemplateManager) {
      console.log("[IPC Registry] Registering VC Template IPC...");
      const {
        registerVCTemplateIPC,
      } = require("./vc-template/vc-template-ipc");
      registerVCTemplateIPC(vcTemplateManager);
      console.log("[IPC Registry] ✓ VC Template IPC registered (11 handlers)");
    }

    console.log("[IPC Registry] Registering Automation IPC...");
    const { registerAutomationIPC } = require("./automation/automation-ipc");
    registerAutomationIPC();
    console.log("[IPC Registry] ✓ Automation IPC registered (9 handlers)");

    // 知识图谱与信用 (2个模块, 18 handlers)
    if (database || app.graphExtractor) {
      console.log("[IPC Registry] Registering Knowledge Graph IPC...");
      const { registerGraphIPC } = require("./knowledge-graph/graph-ipc");
      registerGraphIPC({
        database,
        graphExtractor: app.graphExtractor,
        llmManager,
      });
      console.log(
        "[IPC Registry] ✓ Knowledge Graph IPC registered (11 handlers)",
      );
    }

    if (creditScoreManager) {
      console.log("[IPC Registry] Registering Credit Score IPC...");
      const { registerCreditIPC } = require("./credit/credit-ipc");
      registerCreditIPC({ creditScoreManager });
      console.log("[IPC Registry] ✓ Credit Score IPC registered (7 handlers)");
    }

    if (pluginManager) {
      console.log("[IPC Registry] Registering Plugin IPC...");
      const { registerPluginIPC } = require("./plugins/plugin-ipc");
      registerPluginIPC({ pluginManager });
      console.log("[IPC Registry] ✓ Plugin IPC registered");
    } else {
      console.warn(
        "[IPC Registry] ⚠️ 插件管理器未初始化，跳过 Plugin IPC 注册",
      );
    }

    // 其他功能 (3个模块, 13 handlers)
    if (fileImporter) {
      console.log("[IPC Registry] Registering Import IPC...");
      const { registerImportIPC } = require("./import/import-ipc");
      registerImportIPC({
        fileImporter,
        mainWindow,
        database,
        ragManager,
      });
      console.log("[IPC Registry] ✓ Import IPC registered (5 handlers)");
    }

    console.log("[IPC Registry] Registering Sync IPC...");
    if (!syncManager) {
      console.warn(
        "[IPC Registry] ⚠️ syncManager 未初始化，将注册降级的 Sync IPC handlers",
      );
    }
    const { registerSyncIPC } = require("./sync/sync-ipc");
    registerSyncIPC({ syncManager: syncManager || null });
    console.log("[IPC Registry] ✓ Sync IPC registered (4 handlers)");

    // Always register notification IPC (handle null database gracefully)
    console.log("[IPC Registry] Registering Notification IPC...");
    if (!database) {
      console.warn(
        "[IPC Registry] ⚠️ database 未初始化，将注册降级的 Notification IPC handlers",
      );
    }
    const {
      registerNotificationIPC,
    } = require("./notification/notification-ipc");
    registerNotificationIPC({ database: database || null });
    console.log("[IPC Registry] ✓ Notification IPC registered (5 handlers)");

    // 对话管理 (函数模式 - 中等模块，15 handlers)
    // 注意：即使 database 为 null 也注册，handler 内部会处理 null 情况
    console.log("[IPC Registry] Registering Conversation IPC...");
    const {
      registerConversationIPC,
    } = require("./conversation/conversation-ipc");
    registerConversationIPC({
      database: database || null,
      llmManager: llmManager || null,
      mainWindow: mainWindow || null,
    });
    if (!database) {
      console.log(
        "[IPC Registry] ⚠️  Database manager not initialized (handlers registered with degraded functionality)",
      );
    }
    if (!llmManager) {
      console.log(
        "[IPC Registry] ⚠️  LLM manager not initialized (handlers registered with degraded functionality)",
      );
    }
    console.log("[IPC Registry] ✓ Conversation IPC registered (15 handlers)");

    // 文件同步监听 (函数模式 - 小模块，3 handlers)
    if (database) {
      console.log("[IPC Registry] Registering File Sync IPC...");
      if (!fileSyncManager) {
        console.warn(
          "[IPC Registry] ⚠️ fileSyncManager 未初始化，将注册降级的 File Sync IPC handlers",
        );
      }
      const { registerFileSyncIPC } = require("./file-sync/file-sync-ipc");
      registerFileSyncIPC({
        fileSyncManager: fileSyncManager || null,
        database,
      });
      console.log("[IPC Registry] ✓ File Sync IPC registered (3 handlers)");
    } else {
      console.warn("[IPC Registry] ⚠️ 数据库未初始化，跳过 File Sync IPC 注册");
    }

    // 配置管理 (函数模式 - 小模块，4 handlers)
    console.log("[IPC Registry] Registering Config IPC...");
    const { registerConfigIPC } = require("./config/config-ipc");
    // getAppConfig 已在第145行声明，此处复用
    registerConfigIPC({ appConfig: getAppConfig() });
    console.log("[IPC Registry] ✓ Config IPC registered (4 handlers)");

    // 分类管理 (函数模式 - 中等模块，7 handlers)
    if (database) {
      console.log("[IPC Registry] Registering Category IPC...");
      const { registerCategoryIPCHandlers } = require("./category-ipc");
      registerCategoryIPCHandlers(database, mainWindow);
      console.log("[IPC Registry] ✓ Category IPC registered (7 handlers)");
    }

    // 系统窗口控制 (函数模式 - 小模块，16 handlers)
    console.log(
      "[IPC Registry] DEBUG: mainWindow =",
      mainWindow,
      ", type =",
      typeof mainWindow,
      ", isDestroyed =",
      mainWindow ? mainWindow.isDestroyed?.() : "N/A",
    );
    if (mainWindow) {
      console.log("[IPC Registry] Registering System IPC...");
      const { registerSystemIPC } = require("./system/system-ipc");
      registerSystemIPC({ mainWindow });
      console.log("[IPC Registry] ✓ System IPC registered (16 handlers)");
    } else {
      console.log(
        "[IPC Registry] ⚠️ System IPC NOT registered - mainWindow is falsy",
      );
    }

    console.log("[IPC Registry] ========================================");
    console.log(
      "[IPC Registry] Phase 8 Complete: 20 modules migrated (176 handlers)!",
    );
    console.log("[IPC Registry] ========================================");

    // ============================================================
    // 注册统计
    // ============================================================

    const endTime = Date.now();
    const duration = endTime - startTime;

    // 标记IPC Registry为已注册
    ipcGuard.markModuleRegistered("ipc-registry");

    console.log("[IPC Registry] ========================================");
    console.log("[IPC Registry] Registration complete!");
    console.log(
      `[IPC Registry] Registered modules: ${Object.keys(registeredModules).length}`,
    );
    console.log(`[IPC Registry] Duration: ${duration}ms`);
    console.log("[IPC Registry] ========================================");

    // 打印IPC Guard统计信息
    ipcGuard.printStats();

    return registeredModules;
  } catch (error) {
    console.error("[IPC Registry] ❌ Registration failed:", error);
    throw error;
  }
}

/**
 * 注销所有 IPC 处理器（用于测试和热重载）
 * @param {Object} ipcMain - Electron ipcMain 实例
 */
function unregisterAllIPC(ipcMain) {
  console.log("[IPC Registry] Unregistering all IPC handlers...");
  // 使用IPC Guard的resetAll功能
  ipcGuard.resetAll();
  console.log("[IPC Registry] ✓ All IPC handlers unregistered");
}

module.exports = {
  registerAllIPC,
  unregisterAllIPC,
  ipcGuard, // 导出IPC Guard供外部使用
};
