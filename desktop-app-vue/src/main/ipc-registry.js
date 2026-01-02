/**
 * IPC 注册中心
 * 统一管理所有 IPC 模块的注册
 *
 * @module ipc-registry
 * @description 负责注册所有模块化的 IPC 处理器，实现主进程入口文件的解耦
 */

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
  console.log('[IPC Registry] ========================================');
  console.log('[IPC Registry] Starting modular IPC registration...');
  console.log('[IPC Registry] ========================================');

  const startTime = Date.now();
  const registeredModules = {};

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
      contactManager,
      friendManager,
      postManager,
      vcManager,
      identityContextManager,
      organizationManager,
      dbManager,
      versionManager
    } = dependencies;

    // ============================================================
    // 第一阶段模块 (AI 相关 - 优先级最高，作为示范)
    // ============================================================

    // LLM 服务 (函数模式 - 小模块示范，14 handlers)
    if (llmManager) {
      console.log('[IPC Registry] Registering LLM IPC...');
      const { registerLLMIPC } = require('./llm/llm-ipc');

      // 获取 LLM 智能选择器（如果已初始化）
      const llmSelector = app.llmSelector || null;

      registerLLMIPC({
        llmManager,
        mainWindow,
        ragManager,
        promptTemplateManager,
        llmSelector,
        database
      });

      console.log('[IPC Registry] ✓ LLM IPC registered (14 handlers)');
    }

    // RAG 检索 (函数模式 - 小模块示范，7 handlers)
    if (ragManager) {
      console.log('[IPC Registry] Registering RAG IPC...');
      const { registerRAGIPC } = require('./rag/rag-ipc');
      registerRAGIPC({ ragManager, llmManager });
      console.log('[IPC Registry] ✓ RAG IPC registered (7 handlers)');
    }

    // ============================================================
    // 第二阶段模块 (核心功能)
    // ============================================================

    // U-Key 硬件管理 (函数模式 - 小模块，9 handlers)
    if (ukeyManager) {
      console.log('[IPC Registry] Registering U-Key IPC...');
      const { registerUKeyIPC } = require('./ukey/ukey-ipc');
      registerUKeyIPC({ ukeyManager });
      console.log('[IPC Registry] ✓ U-Key IPC registered (9 handlers)');
    }

    // 数据库管理 (函数模式 - 中等模块，22 handlers)
    if (database) {
      console.log('[IPC Registry] Registering Database IPC...');
      const { registerDatabaseIPC } = require('./database/database-ipc');

      // 获取 getAppConfig 函数
      const { getAppConfig } = require('./app-config');

      registerDatabaseIPC({
        database,
        ragManager,
        getAppConfig
      });
      console.log('[IPC Registry] ✓ Database IPC registered (22 handlers)');
    }

    // Git 版本控制 (函数模式 - 中等模块，16 handlers)
    if (gitManager) {
      console.log('[IPC Registry] Registering Git IPC...');
      const { registerGitIPC } = require('./git/git-ipc');

      // 获取 getGitConfig 函数
      const { getGitConfig } = require('./git/git-config');

      registerGitIPC({
        gitManager,
        markdownExporter,
        getGitConfig,
        llmManager
      });
      console.log('[IPC Registry] ✓ Git IPC registered (16 handlers)');
    }

    // ============================================================
    // 第三阶段模块 (社交网络 - DID, P2P, Social)
    // ============================================================

    // DID 身份管理 (函数模式 - 中等模块，24 handlers)
    if (didManager) {
      console.log('[IPC Registry] Registering DID IPC...');
      const { registerDIDIPC } = require('./did/did-ipc');
      registerDIDIPC({ didManager });
      console.log('[IPC Registry] ✓ DID IPC registered (24 handlers)');
    }

    // P2P 网络通信 (函数模式 - 中等模块，18 handlers)
    if (p2pManager) {
      console.log('[IPC Registry] Registering P2P IPC...');
      const { registerP2PIPC } = require('./p2p/p2p-ipc');
      registerP2PIPC({ p2pManager });
      console.log('[IPC Registry] ✓ P2P IPC registered (18 handlers)');
    }

    // 社交网络 (函数模式 - 大模块，33 handlers: contact + friend + post + chat)
    if (contactManager || friendManager || postManager || database) {
      console.log('[IPC Registry] Registering Social IPC...');
      const { registerSocialIPC } = require('./social/social-ipc');
      registerSocialIPC({
        contactManager,
        friendManager,
        postManager,
        database
      });
      console.log('[IPC Registry] ✓ Social IPC registered (33 handlers)');
    }

    // ============================================================
    // 第四阶段模块 (企业版 - VC, Organization, Identity Context)
    // ============================================================

    // 可验证凭证 (函数模式 - 小模块，10 handlers)
    if (vcManager) {
      console.log('[IPC Registry] Registering VC IPC...');
      const { registerVCIPC } = require('./vc/vc-ipc');
      registerVCIPC({ vcManager });
      console.log('[IPC Registry] ✓ VC IPC registered (10 handlers)');
    }

    // 身份上下文 (函数模式 - 小模块，7 handlers)
    if (identityContextManager) {
      console.log('[IPC Registry] Registering Identity Context IPC...');
      const { registerIdentityContextIPC } = require('./identity-context/identity-context-ipc');
      registerIdentityContextIPC({ identityContextManager });
      console.log('[IPC Registry] ✓ Identity Context IPC registered (7 handlers)');
    }

    // 组织管理 (函数模式 - 大模块，32 handlers)
    if (organizationManager || dbManager) {
      console.log('[IPC Registry] Registering Organization IPC...');
      const { registerOrganizationIPC } = require('./organization/organization-ipc');
      registerOrganizationIPC({
        organizationManager,
        dbManager,
        versionManager
      });
      console.log('[IPC Registry] ✓ Organization IPC registered (32 handlers)');
    }

    // ============================================================
    // 后续模块将在拆分时逐步添加
    // ============================================================

    // TODO: 项目管理 IPC (类模式 - 大模块)
    // const ProjectIPC = require('./project/project-ipc');
    // const projectIPC = new ProjectIPC();
    // projectIPC.setDependencies({ database, llmManager, mainWindow });
    // projectIPC.registerHandlers();
    // registeredModules.projectIPC = projectIPC;

    // TODO: 更多模块...

    // ============================================================
    // 注册统计
    // ============================================================

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('[IPC Registry] ========================================');
    console.log('[IPC Registry] Registration complete!');
    console.log(`[IPC Registry] Registered modules: ${Object.keys(registeredModules).length}`);
    console.log(`[IPC Registry] Duration: ${duration}ms`);
    console.log('[IPC Registry] ========================================');

    return registeredModules;
  } catch (error) {
    console.error('[IPC Registry] ❌ Registration failed:', error);
    throw error;
  }
}

/**
 * 注销所有 IPC 处理器（用于测试和热重载）
 * @param {Object} ipcMain - Electron ipcMain 实例
 */
function unregisterAllIPC(ipcMain) {
  console.log('[IPC Registry] Unregistering all IPC handlers...');
  // 移除所有 handler（Electron 会在 removeAllListeners 时处理）
  ipcMain.removeAllListeners();
  console.log('[IPC Registry] ✓ All IPC handlers unregistered');
}

module.exports = {
  registerAllIPC,
  unregisterAllIPC
};
