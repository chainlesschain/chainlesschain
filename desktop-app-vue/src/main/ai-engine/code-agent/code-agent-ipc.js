/**
 * Code Agent v2 IPC Handlers
 * 8 IPC handlers for Phase 86: Code Agent 2.0
 * @module ai-engine/code-agent/code-agent-ipc
 * @version 5.0.0
 */
const { logger } = require("../../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register Code Agent v2 IPC handlers
 * @param {Object} codeGenerator - CodeGeneratorV2 instance
 */
function registerCodeAgentIPC(codeGenerator) {
  // Generate code
  ipcMain.handle("code-agent:generate", async (_event, params) => {
    try {
      if (!codeGenerator) {
        return { success: false, error: "CodeGeneratorV2 not available" };
      }
      const result = await codeGenerator.generate(
        params.prompt,
        params.options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CodeAgentIPC] generate error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Review code
  ipcMain.handle("code-agent:review", async (_event, params) => {
    try {
      if (!codeGenerator) {
        return { success: false, error: "CodeGeneratorV2 not available" };
      }
      const result = await codeGenerator.review(params.code, params.options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CodeAgentIPC] review error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Fix code issues
  ipcMain.handle("code-agent:fix", async (_event, params) => {
    try {
      if (!codeGenerator) {
        return { success: false, error: "CodeGeneratorV2 not available" };
      }
      const result = await codeGenerator.fix(
        params.code,
        params.issues,
        params.options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CodeAgentIPC] fix error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Scaffold project
  ipcMain.handle("code-agent:scaffold", async (_event, params) => {
    try {
      if (!codeGenerator) {
        return { success: false, error: "CodeGeneratorV2 not available" };
      }
      const result = await codeGenerator.scaffold(
        params.template,
        params.options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CodeAgentIPC] scaffold error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Configure CI/CD
  ipcMain.handle("code-agent:configure-ci", async (_event, params) => {
    try {
      if (!codeGenerator) {
        return { success: false, error: "CodeGeneratorV2 not available" };
      }
      const result = await codeGenerator.configureCICD(
        params.projectType,
        params.options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CodeAgentIPC] configure-ci error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Analyze git context
  ipcMain.handle("code-agent:analyze-git", async (_event, params) => {
    try {
      if (!codeGenerator) {
        return { success: false, error: "CodeGeneratorV2 not available" };
      }
      const result = await codeGenerator.analyzeGit(
        params.repoPath,
        params.options,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CodeAgentIPC] analyze-git error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Explain code
  ipcMain.handle("code-agent:explain", async (_event, params) => {
    try {
      if (!codeGenerator) {
        return { success: false, error: "CodeGeneratorV2 not available" };
      }
      const result = await codeGenerator.explain(params.code, params.options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CodeAgentIPC] explain error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // Refactor code
  ipcMain.handle("code-agent:refactor", async (_event, params) => {
    try {
      if (!codeGenerator) {
        return { success: false, error: "CodeGeneratorV2 not available" };
      }
      const result = await codeGenerator.refactor(params.code, params.options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[CodeAgentIPC] refactor error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[CodeAgentIPC] Registered 8 handlers");
  return { handlerCount: 8 };
}

module.exports = { registerCodeAgentIPC };
