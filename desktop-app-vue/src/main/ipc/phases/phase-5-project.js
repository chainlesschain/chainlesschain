/**
 * Phase 5: Project Management Suite (5 safeRegister modules, 91 handlers).
 *
 *  - Project Core IPC (34 handlers)
 *  - Project AI IPC (16 handlers)
 *  - Project Export/Share IPC (17 handlers)
 *  - Project RAG IPC (10 handlers)
 *  - Project Git IPC (14 handlers)
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhase5Project({
  safeRegister,
  logger,
  deps,
  registeredModules: _registeredModules,
}) {
  const {
    app,
    database,
    mainWindow,
    llmManager,
    aiEngineManager,
    chatSkillBridge,
    mcpClientManager,
    mcpToolAdapter,
    gitManager,
    fileSyncManager,
    removeUndefinedValues,
    _replaceUndefinedWithNull,
  } = deps;

  // ============================================================
  // 第五阶段模块 (项目管理 - 最大模块组，分为多个子模块)
  // ============================================================

  // 项目核心管理 (函数模式 - 大模块，34 handlers)
  // 🔥 始终注册，handlers 内部会处理 database 为 null 的情况
  safeRegister("Project Core IPC", {
    register: () => {
      const {
        registerProjectCoreIPC,
      } = require("../../project/project-core-ipc");
      registerProjectCoreIPC({
        database: database || null,
        fileSyncManager,
        removeUndefinedValues,
        _replaceUndefinedWithNull,
      });
      if (!database) {
        logger.info(
          "[IPC Registry] ⚠️  Database not initialized (Project Core handlers registered with degraded functionality)",
        );
      }
    },
    handlers: 34,
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // 项目AI功能 (函数模式 - 中等模块，16 handlers)
  // 🔥 始终注册，handlers 内部会处理 llmManager/database 为 null 的情况
  safeRegister("Project AI IPC", {
    register: () => {
      const { registerProjectAIIPC } = require("../../project/project-ai-ipc");
      registerProjectAIIPC({
        database: database || null,
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
      if (!database) {
        logger.info(
          "[IPC Registry] ⚠️  Database not initialized (Project AI handlers registered with degraded functionality)",
        );
      }
      if (!llmManager) {
        logger.info(
          "[IPC Registry] ⚠️  LLM manager not initialized (Project AI handlers registered with degraded functionality)",
        );
      }
    },
    handlers: 16,
    fatal: true,
  });

  // 项目导出分享 (函数模式 - 大模块，17 handlers)
  // 🔥 始终注册，handlers 内部会处理 database/llmManager 为 null 的情况
  safeRegister("Project Export/Share IPC", {
    register: () => {
      const {
        registerProjectExportIPC,
      } = require("../../project/project-export-ipc");
      const { getDatabaseConnection, saveDatabase } = require("../../database");
      const { getProjectConfig } = require("../../project/project-config");
      const { copyDirectory } = require("../../utils/file-utils");

      registerProjectExportIPC({
        database: database || null,
        llmManager: llmManager || null,
        mainWindow: mainWindow || null,
        getDatabaseConnection,
        saveDatabase,
        getProjectConfig,
        copyDirectory,
        convertSlidesToOutline: app.convertSlidesToOutline?.bind(app),
      });
    },
    handlers: 17,
    fatal: true,
  });

  // 项目RAG检索 (函数模式 - 中等模块，10 handlers)
  safeRegister("Project RAG IPC", {
    register: () => {
      const {
        registerProjectRAGIPC,
      } = require("../../project/project-rag-ipc");
      const { getProjectRAGManager } = require("../../project/project-rag");
      const {
        getProjectConfig: getRagProjectConfig,
      } = require("../../project/project-config");
      const RAGAPI = require("../../project/rag-api");

      registerProjectRAGIPC({
        getProjectRAGManager,
        getProjectConfig: getRagProjectConfig,
        RAGAPI,
      });
    },
    handlers: 10,
    fatal: true,
  });

  // 项目Git集成 (函数模式 - 大模块，14 handlers)
  safeRegister("Project Git IPC", {
    register: () => {
      const {
        registerProjectGitIPC,
      } = require("../../project/project-git-ipc");
      const {
        getProjectConfig: getGitProjectConfig,
      } = require("../../project/project-config");
      const GitAPI = require("../../project/git-api");

      registerProjectGitIPC({
        getProjectConfig: getGitProjectConfig,
        GitAPI,
        gitManager,
        fileSyncManager,
        mainWindow,
      });
    },
    handlers: 14,
    fatal: true,
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 5 Complete: All 91 project: handlers migrated!",
  );
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhase5Project };
