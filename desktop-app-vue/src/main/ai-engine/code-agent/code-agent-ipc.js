/**
 * Code Agent v2 IPC Handlers
 * 8 IPC handlers for Phase 86: Code Agent 2.0
 * @module ai-engine/code-agent/code-agent-ipc
 * @version 5.0.0
 */
const { logger } = require("../../utils/logger.js");
const { ipcMain: electronIpcMain } = require("electron");

const CHANNELS = [
  "code-agent:generate",
  "code-agent:review",
  "code-agent:fix",
  "code-agent:scaffold",
  "code-agent:configure-ci",
  "code-agent:analyze-git",
  "code-agent:explain",
  "code-agent:refactor",
];

/**
 * Register Code Agent v2 IPC handlers.
 *
 * Accepts either a CodeGeneratorV2 instance directly (legacy positional
 * form) or a deps object `{ codeGenerator, ipcMain }` for DI/testing.
 */
function registerCodeAgentIPC(arg) {
  const deps =
    arg && typeof arg === "object" && "codeGenerator" in arg
      ? arg
      : { codeGenerator: arg };
  const { codeGenerator, ipcMain: injectedIpcMain } = deps;
  const ipcMain = injectedIpcMain || electronIpcMain;

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

  logger.info(`[CodeAgentIPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterCodeAgentIPC(deps = {}) {
  const ipcMain = deps.ipcMain || electronIpcMain;
  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* Intentionally empty */
    }
  }
  logger.info("[CodeAgentIPC] All handlers unregistered");
}

module.exports = { registerCodeAgentIPC, unregisterCodeAgentIPC, CHANNELS };
