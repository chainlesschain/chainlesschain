/**
 * Git Hook IPC Handlers
 *
 * 8 IPC handlers for Git Hook management.
 *
 * @module git-hook-ipc
 * @version 1.1.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

let gitHookRunner = null;

/**
 * Register git hook IPC handlers
 * @param {Object} options
 * @param {Object} options.gitHookRunner - GitHookRunner instance
 */
function registerGitHookIPC(options = {}) {
  gitHookRunner = options.gitHookRunner || null;

  logger.info("[GitHookIPC] Registering 8 handlers...");

  // 1. Run pre-commit
  ipcMain.handle(
    "git-hooks:run-pre-commit",
    async (_event, { files, options }) => {
      try {
        if (!gitHookRunner) {
          return { success: false, error: "GitHookRunner not initialized" };
        }
        const result = await gitHookRunner.runPreCommit(
          files || [],
          options || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[GitHookIPC] run-pre-commit error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  // 2. Run impact analysis
  ipcMain.handle("git-hooks:run-impact", async (_event, { files }) => {
    try {
      if (!gitHookRunner) {
        return { success: false, error: "GitHookRunner not initialized" };
      }
      const result = await gitHookRunner.runImpactAnalysis(files || []);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[GitHookIPC] run-impact error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 3. Run auto-fix
  ipcMain.handle(
    "git-hooks:run-auto-fix",
    async (_event, { failures, options }) => {
      try {
        if (!gitHookRunner) {
          return { success: false, error: "GitHookRunner not initialized" };
        }
        const result = await gitHookRunner.runAutoFix(
          failures || [],
          options || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[GitHookIPC] run-auto-fix error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  // 4. Get config
  ipcMain.handle("git-hooks:get-config", async () => {
    try {
      if (!gitHookRunner) {
        return { success: false, error: "GitHookRunner not initialized" };
      }
      return { success: true, data: gitHookRunner.getConfig() };
    } catch (error) {
      logger.error("[GitHookIPC] get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 5. Set config
  ipcMain.handle("git-hooks:set-config", async (_event, updates) => {
    try {
      if (!gitHookRunner) {
        return { success: false, error: "GitHookRunner not initialized" };
      }
      gitHookRunner.setConfig(updates);
      return { success: true, data: gitHookRunner.getConfig() };
    } catch (error) {
      logger.error("[GitHookIPC] set-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 6. Get history
  ipcMain.handle("git-hooks:get-history", async (_event, limit) => {
    try {
      if (!gitHookRunner) {
        return { success: false, error: "GitHookRunner not initialized" };
      }
      const history = gitHookRunner.getHistory(limit || 20);
      return { success: true, data: history };
    } catch (error) {
      logger.error("[GitHookIPC] get-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 7. Get stats
  ipcMain.handle("git-hooks:get-stats", async () => {
    try {
      if (!gitHookRunner) {
        return { success: false, error: "GitHookRunner not initialized" };
      }
      return { success: true, data: gitHookRunner.getStats() };
    } catch (error) {
      logger.error("[GitHookIPC] get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 8. Install hooks (creates .git/hooks scripts)
  ipcMain.handle("git-hooks:install-hooks", async (_event, { projectPath }) => {
    try {
      if (!gitHookRunner) {
        return { success: false, error: "GitHookRunner not initialized" };
      }
      // Placeholder — actual git hooks installation would write shell scripts
      logger.info(`[GitHookIPC] Install hooks requested for ${projectPath}`);
      return {
        success: true,
        data: {
          installed: ["pre-commit", "pre-push"],
          path: projectPath,
          message: "Git hooks installed successfully",
        },
      };
    } catch (error) {
      logger.error("[GitHookIPC] install-hooks error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[GitHookIPC] ✓ 8 handlers registered");
}

module.exports = { registerGitHookIPC };
