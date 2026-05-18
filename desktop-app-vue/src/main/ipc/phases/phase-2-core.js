/**
 * Phase 2 + Critical Early IPC.
 *
 * Phase 2 (core hardware/data layer):
 *  - U-Key IPC (9 handlers, gracefully handles null ukeyManager)
 *  - Database IPC (22 handlers, gracefully handles null database)
 *  - Git IPC (22 handlers, gracefully handles null gitManager + Git Hot Reload)
 *
 * Critical Early IPC (registered before optional services so the renderer
 * can boot even when MCP / system / notification managers are absent):
 *  - MCP Basic Config IPC (5 handlers)
 *  - System IPC early subset (16 handlers — window control)
 *  - Notification IPC (5 handlers)
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhase2Core({ safeRegister, logger, deps }) {
  const {
    ukeyManager,
    database,
    ragManager,
    gitManager,
    markdownExporter,
    llmManager,
    gitHotReload,
    mainWindow,
  } = deps;

  // ============================================================
  // 第二阶段模块 (核心功能)
  // ============================================================

  // U-Key 硬件管理 (函数模式 - 小模块，9 handlers)
  // 注意：即使 ukeyManager 为 null 也注册，handler 内部会处理 null 情况
  safeRegister("U-Key IPC", {
    register: () => {
      const { registerUKeyIPC } = require("../../ukey/ukey-ipc");
      registerUKeyIPC({ ukeyManager });
      if (!ukeyManager) {
        logger.info(
          "[IPC Registry] ⚠️  U-Key manager not initialized (handlers registered with degraded functionality)",
        );
      }
    },
    handlers: 9,
  });

  // 数据库管理 (函数模式 - 中等模块，22 handlers)
  // 注意：即使 database 为 null 也注册，handler 内部会处理 null 情况
  safeRegister("Database IPC", {
    register: () => {
      const { registerDatabaseIPC } = require("../../database/database-ipc");
      const { getAppConfig } = require("../../config/database-config");
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
    },
    handlers: 22,
  });

  // Git 版本控制 (函数模式 - 中等模块，16 handlers)
  // 注意：即使 gitManager 为 null 也注册 IPC，让 handler 内部处理
  safeRegister("Git IPC", {
    register: () => {
      const { registerGitIPC } = require("../../git/git-ipc");
      const { getGitConfig } = require("../../git/git-config");
      registerGitIPC({
        gitManager,
        markdownExporter,
        getGitConfig,
        llmManager,
        gitHotReload,
        mainWindow,
      });
      if (!gitManager) {
        logger.info(
          "[IPC Registry] ⚠️  Git manager not initialized (Git sync disabled in config)",
        );
      }
      if (gitHotReload) {
        logger.info("[IPC Registry] ✓ Git Hot Reload enabled");
      }
    },
    handlers: 22,
  });

  // ============================================================
  // 关键IPC模块 - 提前注册 (用于E2E测试)
  // ============================================================

  // 🔥 MCP 基础配置 IPC - 始终注册，允许用户通过UI启用/禁用MCP
  // 这是独立于MCP系统初始化的，因为用户需要先能配置MCP才能启用它
  safeRegister("MCP Basic Config IPC (early)", {
    register: () => {
      const { registerBasicMCPConfigIPC } = require("../../mcp/mcp-ipc");
      registerBasicMCPConfigIPC();
    },
    handlers: 5,
    fatal: true,
  });

  // 系统窗口控制 - 提前注册 (不需要 mainWindow 的部分)
  safeRegister("System IPC (early)", {
    register: () => {
      const { registerSystemIPC } = require("../../system/system-ipc");
      registerSystemIPC({ mainWindow: mainWindow || null });
    },
    handlers: 16,
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // 通知管理 - 提前注册
  safeRegister("Notification IPC (early)", {
    register: () => {
      const {
        registerNotificationIPC,
      } = require("../../notification/notification-ipc");
      registerNotificationIPC({ database: database || null });
    },
    handlers: 5,
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });
}

module.exports = { registerPhase2Core };
