/**
 * Evolution System — Unified IPC Handlers (v2.1.0)
 *
 * Registers all IPC handlers for:
 * - Code Knowledge Graph (14 handlers)
 * - Decision Knowledge Base (6 handlers)
 * - Prompt Optimizer (5 handlers)
 * - Skill Discoverer (4 handlers)
 * - Debate Review (3 handlers)
 * - A/B Comparator (3 handlers)
 *
 * Total: 35 handlers
 *
 * @module ai-engine/cowork/evolution-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const EVOLUTION_CHANNELS = [
  // Code Knowledge Graph (14)
  "ckg:scan-workspace",
  "ckg:scan-file",
  "ckg:incremental-update",
  "ckg:query-entity",
  "ckg:get-dependency-tree",
  "ckg:find-hotspots",
  "ckg:find-circular-deps",
  "ckg:recommend-patterns",
  "ckg:compute-centrality",
  "ckg:export-graph",
  "ckg:get-stats",
  "ckg:build-context",
  "ckg:get-entity-types",
  "ckg:get-relationship-types",

  // Decision Knowledge Base (6)
  "dkb:record-decision",
  "dkb:find-similar",
  "dkb:get-history",
  "dkb:get-best-practice",
  "dkb:get-success-rates",
  "dkb:get-stats",

  // Prompt Optimizer (5)
  "prompt-opt:record-execution",
  "prompt-opt:create-variant",
  "prompt-opt:optimize",
  "prompt-opt:compare-variants",
  "prompt-opt:get-stats",

  // Skill Discoverer (4)
  "skill-disc:analyze-failure",
  "skill-disc:suggest-install",
  "skill-disc:get-history",
  "skill-disc:get-stats",

  // Debate Review (3)
  "debate:start",
  "debate:get-history",
  "debate:get-stats",

  // A/B Comparator (3)
  "ab:compare",
  "ab:get-history",
  "ab:get-stats",
];

/**
 * Register all evolution IPC handlers
 * @param {Object} deps - Manager instances
 */
function registerEvolutionIPC(deps) {
  const {
    codeKnowledgeGraph,
    decisionKnowledgeBase,
    promptOptimizer,
    skillDiscoverer,
    debateReview,
    abComparator,
  } = deps;

  // ============================================================
  // Code Knowledge Graph (14 handlers)
  // ============================================================

  ipcMain.handle("ckg:scan-workspace", async (_event, rootDir, options) => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const result = await codeKnowledgeGraph.scanWorkspace(rootDir, options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvolutionIPC] ckg:scan-workspace error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:scan-file", async (_event, filePath, rootDir) => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const result = await codeKnowledgeGraph.scanFile(filePath, rootDir);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvolutionIPC] ckg:scan-file error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "ckg:incremental-update",
    async (_event, filePath, rootDir) => {
      try {
        if (!codeKnowledgeGraph?.initialized) {
          return {
            success: false,
            error: "CodeKnowledgeGraph not initialized",
          };
        }
        const result = await codeKnowledgeGraph.incrementalUpdate(
          filePath,
          rootDir,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[EvolutionIPC] ckg:incremental-update error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("ckg:query-entity", async (_event, query) => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const results = codeKnowledgeGraph.queryEntity(query);
      return { success: true, data: results };
    } catch (error) {
      logger.error("[EvolutionIPC] ckg:query-entity error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:get-dependency-tree", async (_event, entityId, depth) => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return {
          success: false,
          error: "CodeKnowledgeGraph not initialized",
        };
      }
      const tree = codeKnowledgeGraph.getModuleDependencyTree(entityId, depth);
      return { success: true, data: tree };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] ckg:get-dependency-tree error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:find-hotspots", async (_event, threshold) => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const hotspots = codeKnowledgeGraph.findHotspots(threshold);
      return { success: true, data: hotspots };
    } catch (error) {
      logger.error("[EvolutionIPC] ckg:find-hotspots error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:find-circular-deps", async () => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const cycles = codeKnowledgeGraph.findCircularDependencies();
      return { success: true, data: cycles };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] ckg:find-circular-deps error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:recommend-patterns", async () => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const recommendations = codeKnowledgeGraph.recommendPatterns();
      return { success: true, data: recommendations };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] ckg:recommend-patterns error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:compute-centrality", async () => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const centrality = codeKnowledgeGraph.computeCentrality();
      return { success: true, data: centrality.slice(0, 50) };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] ckg:compute-centrality error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:export-graph", async () => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const data = codeKnowledgeGraph.exportGraph();
      return { success: true, data };
    } catch (error) {
      logger.error("[EvolutionIPC] ckg:export-graph error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:get-stats", async () => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: false, error: "CodeKnowledgeGraph not initialized" };
      }
      const stats = codeKnowledgeGraph.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[EvolutionIPC] ckg:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:build-context", async () => {
    try {
      if (!codeKnowledgeGraph?.initialized) {
        return { success: true, data: "" };
      }
      const context = codeKnowledgeGraph.buildKGContext();
      return { success: true, data: context };
    } catch (error) {
      logger.error("[EvolutionIPC] ckg:build-context error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:get-entity-types", async () => {
    try {
      const { ENTITY_TYPES } = require("./code-knowledge-graph");
      return { success: true, data: ENTITY_TYPES };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ckg:get-relationship-types", async () => {
    try {
      const { RELATIONSHIP_TYPES } = require("./code-knowledge-graph");
      return { success: true, data: RELATIONSHIP_TYPES };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Decision Knowledge Base (6 handlers)
  // ============================================================

  ipcMain.handle("dkb:record-decision", async (_event, data) => {
    try {
      if (!decisionKnowledgeBase?.initialized) {
        return {
          success: false,
          error: "DecisionKnowledgeBase not initialized",
        };
      }
      const record = decisionKnowledgeBase.recordDecision(data);
      return { success: true, data: record };
    } catch (error) {
      logger.error("[EvolutionIPC] dkb:record-decision error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dkb:find-similar", async (_event, problem, limit) => {
    try {
      if (!decisionKnowledgeBase?.initialized) {
        return {
          success: false,
          error: "DecisionKnowledgeBase not initialized",
        };
      }
      const results = decisionKnowledgeBase.findSimilarDecisions(
        problem,
        limit,
      );
      return { success: true, data: results };
    } catch (error) {
      logger.error("[EvolutionIPC] dkb:find-similar error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dkb:get-history", async (_event, filters) => {
    try {
      if (!decisionKnowledgeBase?.initialized) {
        return {
          success: false,
          error: "DecisionKnowledgeBase not initialized",
        };
      }
      const results = decisionKnowledgeBase.getDecisionHistory(filters);
      return { success: true, data: results };
    } catch (error) {
      logger.error("[EvolutionIPC] dkb:get-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dkb:get-best-practice", async (_event, category) => {
    try {
      if (!decisionKnowledgeBase?.initialized) {
        return {
          success: false,
          error: "DecisionKnowledgeBase not initialized",
        };
      }
      const result = decisionKnowledgeBase.getBestPractice(category);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] dkb:get-best-practice error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dkb:get-success-rates", async () => {
    try {
      if (!decisionKnowledgeBase?.initialized) {
        return {
          success: false,
          error: "DecisionKnowledgeBase not initialized",
        };
      }
      const rates = decisionKnowledgeBase.getSuccessRateByCategory();
      return { success: true, data: rates };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] dkb:get-success-rates error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dkb:get-stats", async () => {
    try {
      if (!decisionKnowledgeBase?.initialized) {
        return {
          success: false,
          error: "DecisionKnowledgeBase not initialized",
        };
      }
      const stats = decisionKnowledgeBase.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[EvolutionIPC] dkb:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Prompt Optimizer (5 handlers)
  // ============================================================

  ipcMain.handle("prompt-opt:record-execution", async (_event, data) => {
    try {
      if (!promptOptimizer?.initialized) {
        return { success: false, error: "PromptOptimizer not initialized" };
      }
      const result = promptOptimizer.recordExecution(data);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] prompt-opt:record-execution error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("prompt-opt:create-variant", async (_event, data) => {
    try {
      if (!promptOptimizer?.initialized) {
        return { success: false, error: "PromptOptimizer not initialized" };
      }
      const variant = promptOptimizer.createVariant(data);
      return { success: true, data: variant };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] prompt-opt:create-variant error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("prompt-opt:optimize", async (_event, skillName) => {
    try {
      if (!promptOptimizer?.initialized) {
        return { success: false, error: "PromptOptimizer not initialized" };
      }
      const result = promptOptimizer.optimizePrompt(skillName);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvolutionIPC] prompt-opt:optimize error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "prompt-opt:compare-variants",
    async (_event, variantIdA, variantIdB) => {
      try {
        if (!promptOptimizer?.initialized) {
          return { success: false, error: "PromptOptimizer not initialized" };
        }
        const result = promptOptimizer.compareVariants(variantIdA, variantIdB);
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[EvolutionIPC] prompt-opt:compare-variants error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("prompt-opt:get-stats", async () => {
    try {
      if (!promptOptimizer?.initialized) {
        return { success: false, error: "PromptOptimizer not initialized" };
      }
      const stats = promptOptimizer.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[EvolutionIPC] prompt-opt:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Skill Discoverer (4 handlers)
  // ============================================================

  ipcMain.handle("skill-disc:analyze-failure", async (_event, data) => {
    try {
      if (!skillDiscoverer?.initialized) {
        return { success: false, error: "SkillDiscoverer not initialized" };
      }
      const result = await skillDiscoverer.analyzeTaskFailure(data);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] skill-disc:analyze-failure error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("skill-disc:suggest-install", async (_event, logId) => {
    try {
      if (!skillDiscoverer?.initialized) {
        return { success: false, error: "SkillDiscoverer not initialized" };
      }
      const result = skillDiscoverer.suggestInstallation(logId);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] skill-disc:suggest-install error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("skill-disc:get-history", async (_event, filters) => {
    try {
      if (!skillDiscoverer?.initialized) {
        return { success: false, error: "SkillDiscoverer not initialized" };
      }
      const history = skillDiscoverer.getDiscoveryHistory(filters);
      return { success: true, data: history };
    } catch (error) {
      logger.error(
        "[EvolutionIPC] skill-disc:get-history error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("skill-disc:get-stats", async () => {
    try {
      if (!skillDiscoverer?.initialized) {
        return { success: false, error: "SkillDiscoverer not initialized" };
      }
      const stats = skillDiscoverer.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[EvolutionIPC] skill-disc:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Debate Review (3 handlers)
  // ============================================================

  ipcMain.handle("debate:start", async (_event, data) => {
    try {
      if (!debateReview?.initialized) {
        return { success: false, error: "DebateReview not initialized" };
      }
      const result = await debateReview.startDebate(data);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvolutionIPC] debate:start error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("debate:get-history", async (_event, filters) => {
    try {
      if (!debateReview?.initialized) {
        return { success: false, error: "DebateReview not initialized" };
      }
      const history = debateReview.getDebateHistory(filters);
      return { success: true, data: history };
    } catch (error) {
      logger.error("[EvolutionIPC] debate:get-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("debate:get-stats", async () => {
    try {
      if (!debateReview?.initialized) {
        return { success: false, error: "DebateReview not initialized" };
      }
      const stats = debateReview.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[EvolutionIPC] debate:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // A/B Comparator (3 handlers)
  // ============================================================

  ipcMain.handle("ab:compare", async (_event, data) => {
    try {
      if (!abComparator?.initialized) {
        return { success: false, error: "ABComparator not initialized" };
      }
      const result = await abComparator.compare(data);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvolutionIPC] ab:compare error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ab:get-history", async (_event, filters) => {
    try {
      if (!abComparator?.initialized) {
        return { success: false, error: "ABComparator not initialized" };
      }
      const history = abComparator.getComparisonHistory(filters);
      return { success: true, data: history };
    } catch (error) {
      logger.error("[EvolutionIPC] ab:get-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("ab:get-stats", async () => {
    try {
      if (!abComparator?.initialized) {
        return { success: false, error: "ABComparator not initialized" };
      }
      const stats = abComparator.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error("[EvolutionIPC] ab:get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info(
    `[EvolutionIPC] Registered ${EVOLUTION_CHANNELS.length} IPC handlers`,
  );

  return { handlerCount: EVOLUTION_CHANNELS.length };
}

/**
 * Unregister all evolution IPC handlers
 */
function unregisterEvolutionIPC() {
  for (const channel of EVOLUTION_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
  logger.info("[EvolutionIPC] Unregistered all handlers");
}

module.exports = {
  registerEvolutionIPC,
  unregisterEvolutionIPC,
  EVOLUTION_CHANNELS,
};
