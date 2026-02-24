/**
 * NL Programming IPC Handlers — Natural Language Programming (v3.1)
 *
 * Registers IPC handlers for NL→code pipeline:
 * Phase A: 5 handlers (translate, validate, refine, get-history, get-config)
 * Phase B: +3 handlers (generate, get-conventions, analyze-project)
 * Phase C: +2 handlers (get-stats, configure)
 *
 * @module ai-engine/cowork/nl-programming-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const NL_PROG_CHANNELS = [
  // Phase A — Spec Translation (5)
  "nl-prog:translate",
  "nl-prog:validate",
  "nl-prog:refine",
  "nl-prog:get-history",
  "nl-prog:get-config",

  // Phase B — Generation & Conventions (3)
  "nl-prog:generate",
  "nl-prog:get-conventions",
  "nl-prog:analyze-project",

  // Phase C — Stats & Config (2)
  "nl-prog:get-stats",
  "nl-prog:configure",
];

/**
 * Register all NL programming IPC handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.specTranslator - SpecTranslator instance
 * @param {Object} [deps.projectStyleAnalyzer] - ProjectStyleAnalyzer instance (Phase B)
 * @returns {Object} Registration metadata
 */
function registerNLProgrammingIPC(deps) {
  const { specTranslator, projectStyleAnalyzer } = deps;

  // ============================================================
  // Phase A — Spec Translation (5 handlers)
  // ============================================================

  ipcMain.handle("nl-prog:translate", async (_event, options) => {
    try {
      if (!specTranslator?.initialized) {
        return { success: false, error: "SpecTranslator not initialized" };
      }
      const { description, context } = options || {};
      if (!description) {
        return { success: false, error: "description is required" };
      }
      const result = await specTranslator.translate(description, context || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:translate error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("nl-prog:validate", async (_event, options) => {
    try {
      if (!specTranslator?.initialized) {
        return { success: false, error: "SpecTranslator not initialized" };
      }
      const { spec } = options || {};
      const result = specTranslator.validateSpec(spec);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:validate error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("nl-prog:refine", async (_event, options) => {
    try {
      if (!specTranslator?.initialized) {
        return { success: false, error: "SpecTranslator not initialized" };
      }
      const { specId, refinements } = options || {};
      if (!specId) {
        return { success: false, error: "specId is required" };
      }
      const result = await specTranslator.refineSpec(specId, refinements || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:refine error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("nl-prog:get-history", async (_event, options) => {
    try {
      if (!specTranslator?.initialized) {
        return { success: false, error: "SpecTranslator not initialized" };
      }
      const { limit } = options || {};
      const result = specTranslator.getHistory(limit);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:get-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("nl-prog:get-config", async () => {
    try {
      const translatorConfig = specTranslator?.initialized
        ? specTranslator.getConfig()
        : null;
      const analyzerConfig = projectStyleAnalyzer?.initialized
        ? projectStyleAnalyzer.getConfig()
        : null;

      return {
        success: true,
        data: {
          translator: translatorConfig,
          analyzer: analyzerConfig,
        },
      };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:get-config error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Phase B — Generation & Conventions (3 handlers)
  // ============================================================

  ipcMain.handle("nl-prog:generate", async (_event, options) => {
    try {
      // Phase B placeholder — code generation via Orchestrate + Conventions
      return {
        success: false,
        error: "nl-prog:generate — Phase B implementation pending",
      };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:generate error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("nl-prog:get-conventions", async (_event, options) => {
    try {
      if (!projectStyleAnalyzer?.initialized) {
        return {
          success: false,
          error: "ProjectStyleAnalyzer not initialized (Phase B)",
        };
      }
      const { projectPath } = options || {};
      const result = projectStyleAnalyzer.getConventions(projectPath);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:get-conventions error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("nl-prog:analyze-project", async (_event, options) => {
    try {
      if (!projectStyleAnalyzer?.initialized) {
        return {
          success: false,
          error: "ProjectStyleAnalyzer not initialized (Phase B)",
        };
      }
      const { directory } = options || {};
      const result = await projectStyleAnalyzer.analyze(directory);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:analyze-project error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Phase C — Stats & Config (2 handlers)
  // ============================================================

  ipcMain.handle("nl-prog:get-stats", async () => {
    try {
      const translatorStats = specTranslator?.initialized
        ? specTranslator.getStats()
        : null;
      const analyzerStats = projectStyleAnalyzer?.initialized
        ? projectStyleAnalyzer.getStats()
        : null;

      return {
        success: true,
        data: {
          translator: translatorStats,
          analyzer: analyzerStats,
        },
      };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("nl-prog:configure", async (_event, options) => {
    try {
      if (!specTranslator?.initialized) {
        return { success: false, error: "SpecTranslator not initialized" };
      }
      const { translator, analyzer } = options || {};
      const result = {};
      if (translator) {
        result.translator = specTranslator.configure(translator);
      }
      if (analyzer && projectStyleAnalyzer?.initialized) {
        result.analyzer = projectStyleAnalyzer.configure(analyzer);
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[NLProgIPC] nl-prog:configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[NLProgIPC] Registered ${NL_PROG_CHANNELS.length} handlers`);

  return { handlerCount: NL_PROG_CHANNELS.length };
}

/**
 * Unregister all NL programming IPC handlers
 */
function unregisterNLProgrammingIPC() {
  for (const channel of NL_PROG_CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore
    }
  }
  logger.info("[NLProgIPC] Unregistered all handlers");
}

module.exports = {
  registerNLProgrammingIPC,
  unregisterNLProgrammingIPC,
  NL_PROG_CHANNELS,
};
